/* TapIn Face Scanner
   - Runs standalone (e.g. hosted on Vercel) — talks to the TapIn API over CORS
   - Camera frames stay in the browser
   - Loads profile images/templates from the API's /api/faces/employees route
   - Face detection + recognition runs locally in the browser
   - When a face is matched with enough confidence, attendance is recorded
     via /api/faces/record — no RFID tap required
   - Logs all face detections
   - The camera auto-starts on page load — there are no Start/Stop buttons.
   - Also polls /api/get-latest-rfid so an RFID tap opens a second modal
     with a green check (known) or red X (unknown). */

// ============================================================================
// API CONNECTION — mirrors dashboard.js
// ============================================================================
const API_ORIGIN = (window.TAPIN_API_URL || 'https://lolenseu.pythonanywhere.com').replace(/\/+$/, '');
const API_BASE = API_ORIGIN + '/api/faces';

// Diagnostic — remove once everything works
console.log("[faces.js] window.TAPIN_API_URL =", window.TAPIN_API_URL);
console.log("[faces.js] API_ORIGIN =", API_ORIGIN);
console.log("[faces.js] API_BASE =", API_BASE);

const MODEL_URL = "https://cdn.jsdelivr.net/gh/justadudewhohacks/face-api.js@0.22.2/weights";

// Distance threshold for face matching. Lower = stricter.
//
//   confidence = (1 − distance) × 100
//
// So:
//   distance 0.30  → accepts ≥ 70% similar  (VERY strict — rarely matches)
//   distance 0.40  → accepts ≥ 60% similar  ← THIS IS WHAT WE WANT
//   distance 0.50  → accepts ≥ 50% similar  (balanced)
//   distance 0.55  → accepts ≥ 45% similar  (lenient for webcam)
//   distance 0.60  → accepts ≥ 40% similar  (very lenient — may false-match)
//
// We use 0.40 = 60% confidence cutoff.
//
// NOTE: This is quite strict. Webcam-vs-profile-photo matches often land
// at 45–55%, so some real employees may not be recognized unless their
// profile photo is high-quality and taken under similar lighting.
// If recognition is unreliable, raise this to 0.50 (50% cutoff) or
// 0.55 (45% cutoff).
//
// IMPORTANT: the SERVER also has its own threshold (FACE_MIN_CONFIDENCE
// in app.py). If the client sends a confidence BELOW the server's
// threshold, the server returns HTTP 403 and no attendance is recorded.
// Both sides MUST agree on the same effective cutoff.
//
//   Client MATCH_THRESHOLD = 0.40  →  accepts ≥ 60%
//   Server FACE_MIN_CONFIDENCE = 60.0
//
const MATCH_THRESHOLD = 0.40;

// Detector input size. Lower = faster but less accurate.
//   416 = default (slow, accurate)
//   320 = balanced
//   224 = fast (what we use now, still plenty accurate for a webcam)
const DETECTOR_INPUT_SIZE = 224;

// Minimum detector confidence to consider a box a real face.
const DETECTOR_SCORE_THRESHOLD = 0.45;

// Live loop throttle. The recognition loop runs inside requestAnimationFrame
// (60 fps), but we only actually run the detector every N ms.
// 66 ms = ~15 fps — smooth enough to look real-time, cheap enough to run
// on a laptop without pinning the CPU.
const LIVE_SCAN_INTERVAL_MS = 66;

// How often the SAME person can be recorded. This is separate from the
// 3-minute cooldown: it only prevents the scanner from firing 15 POSTs
// per second while someone stands in front of the camera. The recorded
// timestamp always reflects the FIRST frame of that 1-second window.
const RECORD_INTERVAL_MS = 1000;

// How long to back off after the SERVER rejects a record with HTTP 403
// (usually because the client confidence is below the server's
// FACE_MIN_CONFIDENCE threshold). This prevents the browser from
// hammering the server with the same rejected face every 1 second.
const REJECT_BACKOFF_MS = 3000;

// Per-person cooldown between recorded attendance events. 3 minutes = 180000 ms.
// The cooldown ONLY starts AFTER a successful server record,
// never on a low-confidence or rejected scan.
//
// Behaviour:
//   1. First successful record → cooldown starts NOW.
//   2. Every subsequent frame within 3 minutes → skip entirely.
//   3. After 3 minutes have passed, if the face is seen again → send a NEW
//      scan to the API with a fresh timestamp.
const ATTENDANCE_COOLDOWN = 180000; // 3 minutes between scans per person

const STATS_REFRESH_MS = 10000; // Refresh "Present Today" + stats every 10s

// How long the employee profile modal stays on screen after a
// successful scan before auto-hiding. Currently 5 seconds.
const PROFILE_MODAL_DISPLAY_MS = 5000;

// --- Single-face-at-a-time setting ---------------------------------------
// The scanner now uses detectSingleFace(), which guarantees only ONE
// face is considered per frame. This constant is kept for clarity and
// to keep the recording path explicit.
const SINGLE_FACE_MODE = true;

const video = document.getElementById("video");
const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");
const statusEl = document.getElementById("statusText");
const statusDot = document.getElementById("statusDot");
const messageEl = document.getElementById("message");
const faceCountEl = document.getElementById("faceCount");
const logEntries = document.getElementById("logEntries");

let modelsReady = false;
let stream = null;
let running = false;
let busy = false;
let faceTemplates = [];
let lastSent = new Map();
let scanCount = 0;
let todayAttendance = [];
let statsRefreshTimer = null;
let initialTemplateCount = 0; // Baseline count for auto-refresh detection

// Live loop state — we use requestAnimationFrame + a throttle timestamp
// instead of setTimeout, so the box tracks the face smoothly in real time.
let liveLoopHandle = null;
let lastScanAt = 0;

// Per-person "last record attempt" timestamps. This throttles POSTs to
// at most one per second while the same person stays in frame.
let lastRecordAttemptAt = new Map();

// Tracks the last UID/RFID we recorded, so we can keep the message line
// showing "Waiting for next scan" instead of spamming the cooldown count.
let lastRecordedKey = null;
let lastRecordedName = "";

// Last drawn box — we keep it across frames so the box doesn't flicker
// on a single missed detection. Cleared only when the face has been
// absent for BOX_PERSIST_FRAMES consecutive scans.
let lastBox = null;
let lastBoxColor = "#22c55e";
let lastBoxLabel = "";
let missedFrames = 0;
const BOX_PERSIST_FRAMES = 20; // keep the box for ~20 scans after losing the face

// Server's minimum confidence (fetched from /api/faces/status on boot).
// Purely informational — used to log a warning if the client threshold
// is producing confidences the server will reject.
let serverMinConfidence = null;

// ========================================================================
// STATUS HELPERS
// ========================================================================

function setStatus(text, state) {
  if (statusEl) statusEl.textContent = text;
  if (statusDot) {
    statusDot.className = "status-dot";
    if (state === "ready" || state === "online") statusDot.classList.add("online");
    else if (state === "error" || state === "offline") statusDot.classList.add("offline");
    else statusDot.classList.add("unknown");
  }
}

// Remove the "Waiting for face detection…" placeholder the moment we have
// a real log entry to show, so the panel doesn't stay stuck on that text.
function clearLogPlaceholder() {
  if (!logEntries) return;
  const empty = logEntries.querySelector(".log-empty");
  if (empty) empty.remove();
}

// Format a JS Date into the "YYYY-MM-DD HH:MM:SS" string the server expects.
// We deliberately build this in LOCAL time because the DTR stores local
// wall-clock times (the server parses "YYYY-MM-DD HH:MM:SS" as naive local
// time). Sending ISO/UTC would shift the times by the timezone offset.
function formatLocalTimestamp(date = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  const yyyy = date.getFullYear();
  const mm = pad(date.getMonth() + 1);
  const dd = pad(date.getDate());
  const hh = pad(date.getHours());
  const mi = pad(date.getMinutes());
  const ss = pad(date.getSeconds());
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}:${ss}`;
}

// Get employee initials from firstname and lastname
function getInitials(firstname, lastname) {
  const f = (firstname || '').charAt(0).toUpperCase();
  const l = (lastname || '').charAt(0).toUpperCase();
  return f + l || '?';
}

// Get absolute image URL from potentially relative path.
//
// Mirrors profile.js: the API sometimes returns bare paths like
// "storage/faces/juan.jpg" (no leading slash), so we insert one
// ourselves. Without this, "origin" + "storage/..." becomes
// "originstorage/..." which 404s.
function getImageUrl(imagePath) {
  if (!imagePath) return '';
  const trimmed = String(imagePath).trim();
  if (!trimmed) return '';
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (trimmed.startsWith('/')) return `${API_ORIGIN}${trimmed}`;
  return `${API_ORIGIN}/${trimmed}`;
}

// Get current time in HH:MM:SS AM/PM format
function getCurrentTime() {
  const now = new Date();
  return now.toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true });
}

// Format time from ISO string to HH:MM AM/PM format
function formatTimeFromISO(isoString) {
  if (!isoString) return '--';
  try {
    const d = new Date(isoString);
    return d.toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit', hour12: true });
  } catch {
    return isoString;
  }
}

// ========================================================================
// LOAD MODELS AND DATA
// ========================================================================

async function boot() {
  // ---- Phase 1: Load AI models. If this fails, nothing else can work. ----
  try {
    setStatus("Loading AI…", "unknown");
    await faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL);
    await faceapi.nets.faceLandmark68TinyNet.loadFromUri(MODEL_URL);
    await faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL);
    modelsReady = true;
    setStatus("Camera ready", "ready");
    messageEl.textContent = "Start the scanner to detect faces.";
    console.log("[faces.js] AI models loaded successfully");
  } catch (e) {
    console.error("[faces.js] Model load error:", e);
    setStatus("AI Load Failed", "error");
    messageEl.textContent = "Could not load face models. Check internet connection.";
    return; // Nothing else will work without models
  }

  // ---- Phase 2: Load data. Each call is isolated so one failure doesn't
  //              block the other two from running. ----
  await loadTemplates().catch(e => {
    console.error("[faces.js] loadTemplates failed:", e);
  });
  await loadAttendance().catch(e => {
    console.error("[faces.js] loadAttendance failed:", e);
  });
  await loadStats().catch(e => {
    console.error("[faces.js] loadStats failed:", e);
  });

  // ---- Phase 2b: Read the server's face threshold so we can log a
  //               warning if the client and server thresholds disagree. ----
  await loadServerConfig().catch(e => {
    console.warn("[faces.js] loadServerConfig failed:", e);
  });

  // ---- Phase 3: Start the periodic stats refresh. ----
  if (statsRefreshTimer) clearInterval(statsRefreshTimer);
  statsRefreshTimer = setInterval(() => {
    loadStats().catch(e => console.warn("[faces.js] background loadStats failed:", e));
  }, STATS_REFRESH_MS);

  console.log("[faces.js] Boot sequence complete");
}

// Fetch /api/faces/status once on boot so we know what the server's
// minimum confidence is. This is purely diagnostic — if the server
// threshold is much higher than what the client produces, every record
// will come back 403 and no attendance will be saved.
//
// NOTE: The mismatch warning is LOG-ONLY. We deliberately do NOT write
// anything to messageEl here, because the on-screen status line is
// reserved for actual scan feedback (recording, cooldown, errors).
async function loadServerConfig() {
  try {
    const res = await fetch(`${API_BASE}/status`);
    if (!res.ok) return;
    const data = await res.json();
    if (typeof data.min_confidence === "number") {
      serverMinConfidence = data.min_confidence;
      console.log("[faces.js] Server min confidence:", serverMinConfidence);

      // Rough client confidence ceiling based on the current threshold.
      const clientCeiling = Math.round((1 - MATCH_THRESHOLD) * 100);
      if (serverMinConfidence > clientCeiling) {
        // Console-only — the on-screen message line is reserved for scan
        // feedback (recording, cooldown, errors), not developer warnings.
        console.warn(
          `[faces.js] ⚠️ Threshold mismatch: client accepts down to ~${clientCeiling}%, ` +
          `but server requires ≥${serverMinConfidence}%. Records will be rejected with 403. ` +
          `Set FACE_MIN_CONFIDENCE=${clientCeiling} (or lower) on the server.`
        );
      }
    }
  } catch (e) {
    console.warn("[faces.js] Could not read /api/faces/status:", e.message);
  }
}

async function loadTemplates() {
  console.log("[faces.js] loadTemplates: fetching", `${API_BASE}/employees`);
  try {
    const res = await fetch(`${API_BASE}/employees`);
    console.log("[faces.js] /employees HTTP status:", res.status);

    if (!res.ok) {
      console.error(`[faces.js] /api/faces/employees returned HTTP ${res.status}`);
      throw new Error(`HTTP ${res.status}`);
    }

    const data = await res.json();
    console.log("[faces.js] /employees response:", data);

    const employees = data.employees || [];
    console.log(`[faces.js] ${employees.length} employee template(s) returned by API`);

    faceTemplates = [];

    for (const item of employees) {
      const employee = item.employee || {};
      const rawImageUrl = item.image_url || employee.image || "";
      if (!rawImageUrl) {
        console.warn("[faces.js] skipping employee with no image_url:", item);
        continue;
      }

      const imageUrl = /^https?:\/\//i.test(rawImageUrl)
        ? rawImageUrl
        : (rawImageUrl.startsWith('/') ? API_ORIGIN + rawImageUrl : API_ORIGIN + '/' + rawImageUrl);

      try {
        const img = await faceapi.fetchImage(imageUrl);

        // detectSingleFace() chains with .withFaceDescriptor() (SINGULAR).
        // detectAllFaces() chains with .withFaceDescriptors() (PLURAL).
        const detection = await faceapi.detectSingleFace(
            img,
            new faceapi.TinyFaceDetectorOptions({
              inputSize: 320,
              scoreThreshold: DETECTOR_SCORE_THRESHOLD
            })
          )
          .withFaceLandmarks(true)
          .withFaceDescriptor();

        if (!detection) {
          console.warn(`[faces.js] No face detected in profile image for ${employee.name || item.rfid} (${imageUrl})`);
          continue;
        }

        faceTemplates.push({
          ...employee,
          rfid: item.rfid || employee.rfid,
          uid: employee.uid,
          name: employee.name
            || `${employee.firstname || ""} ${employee.lastname || ""}`.trim()
            || "Unknown",
          imageUrl,                                   // absolute, for the modal
          rawImage: rawImageUrl,                      // keep the original path too
          descriptor: Array.from(detection.descriptor)
        });

        console.log(`[faces.js] ✔ template built for ${employee.name || item.rfid}`);
      } catch (imgErr) {
        console.warn(`[faces.js] Could not load face template for ${employee.name || item.rfid}:`, imgErr);
      }
    }

    console.log(`[faces.js] ✅ Loaded ${faceTemplates.length} face templates from profile images`);
    faceCountEl.textContent = `Faces: ${faceTemplates.length}`;

    if (faceTemplates.length) {
      setStatus("Profile templates ready", "ready");
    } else {
      setStatus("No profile images found", "unknown");
    }
  } catch (e) {
    console.error("[faces.js] Error loading templates:", e);
    faceTemplates = [];
    faceCountEl.textContent = "Faces: 0";
    setStatus("Template load failed", "error");
    throw e;
  }
}

async function loadAttendance() {
  console.log("[faces.js] loadAttendance: fetching", `${API_BASE}/recent-attendance`);
  try {
    const res = await fetch(`${API_BASE}/recent-attendance`);
    console.log("[faces.js] /recent-attendance HTTP status:", res.status);

    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const data = await res.json();
    console.log("[faces.js] /recent-attendance response:", data);

    if (data.status === "success") {
      todayAttendance = data.attendance || [];
      renderAttendance(todayAttendance);
      console.log(`[faces.js] rendered ${todayAttendance.length} attendance record(s)`);
    } else {
      console.warn("[faces.js] /recent-attendance returned non-success:", data);
      renderAttendance([]);
    }
  } catch (e) {
    console.error("[faces.js] Error loading attendance:", e);
    const container = document.getElementById("todayAttendance");
    if (container) {
      container.innerHTML = `<span class="help">⚠️ Could not load attendance (${e.message}).</span>`;
    }
    throw e;
  }
}

async function loadStats() {
  console.log("[faces.js] loadStats: fetching", `${API_BASE}/dashboard-stats`);
  try {
    const res = await fetch(`${API_BASE}/dashboard-stats`);
    console.log("[faces.js] /dashboard-stats HTTP status:", res.status);

    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const data = await res.json();
    console.log("[faces.js] /dashboard-stats response:", data);

    if (data.status === "success") {
      const stats = data.stats || {};

      const elTfs = document.getElementById("statTFS");
      const elPresent = document.getElementById("statPresent");
      const elTotal = document.getElementById("statTotal");
      const elRate = document.getElementById("statRate");

      if (elTfs) elTfs.textContent = stats.profile_images || 0;
      if (elPresent) elPresent.textContent = stats.present_today || 0;
      if (elTotal) elTotal.textContent = stats.total_employees || 0;
      if (elRate) elRate.textContent = stats.attendance_rate || "0%";

      console.log("[faces.js] stats rendered:", {
        profile_images: stats.profile_images,
        present_today: stats.present_today,
        total_employees: stats.total_employees,
        attendance_rate: stats.attendance_rate
      });
    } else {
      console.warn("[faces.js] /dashboard-stats returned non-success:", data);
    }
  } catch (e) {
    console.error("[faces.js] Error loading stats:", e);
    throw e;
  }
}

// ========================================================================
// CAMERA CONTROLS
// ========================================================================

async function startCamera() {
  if (!modelsReady) return alert("Face models are not ready yet.");

  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: "user" },
      audio: false
    });

    video.srcObject = stream;
    await video.play();

    // Wait for real video dimensions before sizing the canvas.
    // Falls back to 1280×720 if metadata never arrives, so the canvas
    // is never 0×0 (which would make all drawings invisible).
    await new Promise(resolve => {
      if (video.videoWidth > 0 && video.videoHeight > 0) return resolve();
      const onReady = () => resolve();
      video.addEventListener("loadedmetadata", onReady, { once: true });
      setTimeout(onReady, 3000);
    });

    canvas.width = video.videoWidth || 1280;
    canvas.height = video.videoHeight || 720;
    running = true;

    console.log("[faces.js] canvas sized:", canvas.width, "x", canvas.height);

    // The Start/Stop buttons no longer exist in the HTML, so we only
    // touch the cameraHint overlay and the message line here.
    const hintEl = document.getElementById("cameraHint");
    if (hintEl) hintEl.style.display = "none";
    messageEl.textContent = "🔍 Scanning for faces...";

    addLogEntry("Scanner", 0, "info", "Camera started — scanning for faces");
    clearLogPlaceholder();

    // Reset live-loop state and start it.
    lastScanAt = 0;
    missedFrames = 0;
    lastBox = null;
    startLiveLoop();
  } catch (e) {
    console.error("Camera error:", e);
    alert("Camera access failed. Allow camera permission and use HTTPS or localhost.");
  }
}

function stopCamera() {
  running = false;
  stopLiveLoop();

  // Clear profile watcher interval if it exists
  if (profileWatcherInterval) {
    clearInterval(profileWatcherInterval);
    profileWatcherInterval = null;
    console.log("[faces.js] Profile watcher interval cleared");
  }

  if (stream) {
    stream.getTracks().forEach(t => t.stop());
    stream = null;
  }
  video.srcObject = null;
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Same as startCamera — no more button refs, just the hint overlay.
  const hintEl = document.getElementById("cameraHint");
  if (hintEl) hintEl.style.display = "grid";
  messageEl.textContent = "Camera stopped.";

  addLogEntry("Scanner", 0, "info", "Camera stopped");
}

// Live detection loop. Runs inside requestAnimationFrame (60 fps), but
// the actual detection + matching work is throttled to once every
// LIVE_SCAN_INTERVAL_MS (66 ms ≈ 15 fps). This gives a smooth,
// real-time box that tracks the face without maxing out the CPU.
function startLiveLoop() {
  if (liveLoopHandle) cancelAnimationFrame(liveLoopHandle);

  const tick = async (now) => {
    if (!running) return;

    // Only actually run detection every LIVE_SCAN_INTERVAL_MS.
    if (now - lastScanAt >= LIVE_SCAN_INTERVAL_MS && !busy) {
      lastScanAt = now;
      try {
        await recognitionLoop();
      } catch (e) {
        console.error("[faces.js] recognition loop error:", e);
      }
    }

    liveLoopHandle = requestAnimationFrame(tick);
  };

  liveLoopHandle = requestAnimationFrame(tick);
}

function stopLiveLoop() {
  if (liveLoopHandle) {
    cancelAnimationFrame(liveLoopHandle);
    liveLoopHandle = null;
  }
}

// ========================================================================
// FACE RECOGNITION
// ========================================================================

function distance(a, b) {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    const d = a[i] - b[i];
    sum += d * d;
  }
  return Math.sqrt(sum);
}

function identify(descriptor) {
  let best = null;

  for (const record of faceTemplates) {
    const savedDescriptor = record.descriptor || [];
    if (!Array.isArray(savedDescriptor) || savedDescriptor.length !== descriptor.length) continue;

    const d = distance(descriptor, savedDescriptor);
    if (!best || d < best.distance) {
      const employee = record.employee || {};
      best = {
        employee,
        rfid: record.rfid || employee.rfid || "",
        uid: employee.uid || record.uid || "",
        distance: d,
        name: employee.name
          || `${employee.firstname || ""} ${employee.lastname || ""}`.trim()
          || record.name
          || "Unknown",
        imageUrl: record.imageUrl,        // absolute — used by the modal
        rawImage: record.rawImage,        // original path — fallback
        samples: 1
      };
    }
  }

  if (!best || best.distance > MATCH_THRESHOLD) return null;

  const confidence = Math.max(0, Math.min(100, (1 - best.distance) * 100));
  return { ...best, confidence };
}

// Cooldown check — only used AFTER a successful record.
function isWithinCooldown(key) {
  const previous = lastSent.get(key) || 0;
  if (!previous) return false;
  return (Date.now() - previous) < ATTENDANCE_COOLDOWN;
}

function cooldownRemainingSeconds(key) {
  const previous = lastSent.get(key) || 0;
  if (!previous) return 0;
  const elapsedMs = Date.now() - previous;
  const remainingMs = ATTENDANCE_COOLDOWN - elapsedMs;
  return Math.max(0, Math.ceil(remainingMs / 1000));
}

function formatCooldownMmSs(seconds) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

// Setup watcher to check for new profiles every 1 minute
let profileWatcherInterval = null;
function setupProfileCountWatcher() {
  console.log(`[faces.js] Setting up profile count watcher (baseline: ${initialTemplateCount})`);

  // Clear any existing interval
  if (profileWatcherInterval) {
    clearInterval(profileWatcherInterval);
    profileWatcherInterval = null;
  }

  // Set up interval to check every 1 minute (60000 ms)
  profileWatcherInterval = setInterval(async () => {
    try {
      console.log("[faces.js] Checking for new profiles...");

      // Fetch current template count from the API
      const res = await fetch(`${API_BASE}/employees`);
      if (!res.ok) {
        console.warn("[faces.js] Failed to fetch employee templates for watcher:", res.status);
        return;
      }

      const data = await res.json();
      const currentCount = data.employees?.length || 0;

      console.log(`[faces.js] Current profile count: ${currentCount}, baseline: ${initialTemplateCount}`);

      // If current count is greater than our initial loaded count, trigger refresh
      if (currentCount > initialTemplateCount) {
        console.log(`[faces.js] New profiles detected! Count increased from ${initialTemplateCount} to ${currentCount}. Refreshing data...`);

        // Clear the interval since we've detected new profiles
        if (profileWatcherInterval) {
          clearInterval(profileWatcherInterval);
          profileWatcherInterval = null;
        }

        // Refresh all data
        messageEl.textContent = "🔄 New profiles detected - refreshing data...";
        await Promise.all([
          loadTemplates().catch(e => console.error("refresh loadTemplates:", e)),
          loadAttendance().catch(e => console.error("refresh loadAttendance:", e)),
          loadStats().catch(e => console.error("refresh loadStats:", e)),
          loadServerConfig().catch(e => console.warn("refresh loadServerConfig:", e))
        ]);
        messageEl.textContent = "✅ Data refreshed with new profiles!";
      }
    } catch (err) {
      console.error("[faces.js] Error in profile count watcher:", err);
    }
  }, 60000); // Check every 1 minute
}

// Record-attempt throttle. Prevents the scanner from firing a POST on
// every single detection frame. At most one attempt per second per person.
function isWithinRecordThrottle(key) {
  const previous = lastRecordAttemptAt.get(key) || 0;
  if (!previous) return false;
  return (Date.now() - previous) < RECORD_INTERVAL_MS;
}

// Record attendance for a single face match.
//
// Flow:
//   1. Cooldown guard (3 min after a successful record) → skip.
//   2. Record-throttle guard (1 sec between POST attempts) → skip.
//   3. Capture the exact scan time, then POST.
//
// The cooldown is set ONLY after a successful server response, so low-
// confidence or rejected scans don't lock the person out.
//
// On HTTP 403 (server-side confidence too low), we apply a short back-off
// (REJECT_BACKOFF_MS) so the browser does not spam the server with the
// same rejected face every 1 second.
async function recordAttendance(match) {
  const uid = String(match.uid || match.employee?.uid || "");
  const rfid = String(match.rfid || match.employee?.rfid || "");

  if (!uid && !rfid) {
    console.warn("No UID or RFID found for match");
    return;
  }

  const key = uid || rfid;

  // ---- Cooldown guard (3 min) --------------------------------------------
  if (isWithinCooldown(key)) {
    const remaining = cooldownRemainingSeconds(key);
    messageEl.textContent =
      `⏳ ${match.name} — already scanned. Next scan in ${formatCooldownMmSs(remaining)}.`;
    return;
  }

  // ---- Record-throttle guard (1 sec) -------------------------------------
  // The live loop runs at ~15 fps. Without this, we'd fire 15 POSTs per
  // second while the person is standing in front of the camera. This
  // throttle allows at most one attempt per second per person.
  if (isWithinRecordThrottle(key)) {
    return;
  }

  // Mark the attempt time. We set this after checking the throttle but
  // before the fetch to prevent queuing multiple attempts while waiting
  // for a slow API response, yet we'll update it again in the finally
  // block to ensure the throttle period starts after we finish processing.
  lastRecordAttemptAt.set(key, Date.now());

  // Capture the exact scan time — the FIRST frame of this 1-second window.
  const scannedAt = formatLocalTimestamp(new Date());

  try {
    const res = await fetch(`${API_BASE}/record`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        uid: uid,
        rfid: rfid,
        confidence: match.confidence,
        scanned_at: scannedAt,
        face_detected: true
      })
    });

    const data = await res.json();

    if (res.ok && data.status === "success") {
      const empName = data.employee?.name || data.employee?.firstname || match.name;

      lastRecordedKey = key;
      lastRecordedName = empName;

      // ✅ Cooldown starts ONLY here, after a real successful record.
      lastSent.set(key, Date.now());

      addLogEntry(empName, data.confidence || match.confidence, "success", data.attendance_status || "recorded");

      // Show profile modal with employee data.
      //
      // Merge the local `match` (has absolute imageUrl + rawImage) with
      // the server's employee object (authoritative names/ids). Server
      // fields win when present; local fields survive otherwise. This
      // is what guarantees the picture shows up in the modal even when
      // the server's response omits or renames the image field.
      showProfileModal({ ...match, ...(data.employee || {}) }, scannedAt);

      loadAttendance().catch(() => {});
      loadStats().catch(() => {});

      messageEl.textContent =
        `✅ ${empName} — recorded at ${scannedAt.split(" ")[1]}. Waiting for next face…`;

    } else if (res.status === 403) {
      // Server rejected the record — usually because our client confidence
      // is below the server's FACE_MIN_CONFIDENCE threshold.
      addLogEntry(match.name, match.confidence, "warning", "server rejected (low confidence)");
      messageEl.textContent =
        `⚠️ Server rejected (needs ≥${serverMinConfidence ?? "?"}% confidence, sent ${match.confidence.toFixed(1)}%). ` +
        `Waiting…`;

      // Back off for a few seconds so the same rejected face doesn't
      // spam the server with a fresh POST every second.
      lastRecordAttemptAt.set(key, Date.now() + REJECT_BACKOFF_MS - RECORD_INTERVAL_MS);

    } else {
      addLogEntry(match.name, match.confidence, "error", "rejected");
      messageEl.textContent = "❌ Attendance not recorded.";
      // Also back off briefly so a broken endpoint doesn't spam.
      lastRecordAttemptAt.set(key, Date.now() + REJECT_BACKOFF_MS - RECORD_INTERVAL_MS);
    }
  } catch (e) {
    console.error("Attendance error:", e);
    addLogEntry(match.name, match.confidence, "error", "API error");
    messageEl.textContent = "⚠️ API connection failed.";
    // Network error → brief backoff to avoid hammering the endpoint.
    lastRecordAttemptAt.set(key, Date.now() + REJECT_BACKOFF_MS - RECORD_INTERVAL_MS);
  } finally {
    // Update the attempt time to NOW so the throttle period starts
    // after we finish processing (whether success, failure, or error).
    // This prevents rapid-fire detections when API calls are slow.
    lastRecordAttemptAt.set(key, Date.now());
  }
}

// ========================================================================
// RECOGNITION LOOP (called from the live loop, throttled to ~15 fps)
// ========================================================================
//
// Uses detectSingleFace — only ONE face is considered per scan.
//
// IMPORTANT: detectSingleFace() chains with .withFaceDescriptor() (SINGULAR).
// detectAllFaces() chains with .withFaceDescriptors() (PLURAL).
// Mixing them throws "withFaceDescriptors is not a function".

async function recognitionLoop() {
  if (!running || busy) return;
  busy = true;

  try {
    if (!video.videoWidth || !video.videoHeight) {
      return;
    }

    if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
    }

    // ✅ SINGULAR — detectSingleFace() chains with .withFaceDescriptor()
    const detection = await faceapi.detectSingleFace(
      video,
      new faceapi.TinyFaceDetectorOptions({
        inputSize: DETECTOR_INPUT_SIZE,
        scoreThreshold: DETECTOR_SCORE_THRESHOLD
      })
    ).withFaceLandmarks(true).withFaceDescriptor();

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // ---- No face in this frame --------------------------------------------
    if (!detection) {
      missedFrames++;

      // Keep the last box visible for a few frames so a single missed
      // detection doesn't cause the box to flicker off.
      if (lastBox && missedFrames < BOX_PERSIST_FRAMES) {
        drawBox(lastBox, lastBoxColor, lastBoxLabel);
        faceCountEl.textContent = "Faces: 1";
      } else {
        lastBox = null;
        faceCountEl.textContent = "Faces: 0";
      }
      return;
    }

    // ---- Face found --------------------------------------------------------
    missedFrames = 0;
    faceCountEl.textContent = "Faces: 1";

    const box = detection.detection.box;
    const match = identify(detection.descriptor);

    let label = "Unknown";
    let color = "#ef4444";

    if (match) {
      const key = String(match.uid || match.employee?.uid || match.rfid || "");
      const onCooldown = key && isWithinCooldown(key);

      if (onCooldown) {
        // Amber + countdown for someone still inside their 3-minute window.
        const remaining = cooldownRemainingSeconds(key);
        label = `${match.name} ⏳ ${formatCooldownMmSs(remaining)}`;
        color = "#f59e0b";
      } else {
        label = `${match.name} ${match.confidence.toFixed(1)}%`;
        color = "#22c55e";

        // Fire-and-forget: the internal throttle (1 sec) decides whether
        // an actual POST happens. We do NOT await it here, so the live
        // loop keeps running at full speed and the box stays smooth.
        recordAttendance(match);
      }
    }

    // Remember the current box so we can keep drawing it if the next
    // scan misses (flicker prevention).
    lastBox = box;
    lastBoxColor = color;
    lastBoxLabel = label;

    drawBox(box, color, label);

  } catch (e) {
    console.error("[faces.js] Recognition loop error:", e);
  } finally {
    busy = false;
  }
}

// Draw a bounding box + label on the canvas. Handles the horizontal flip
// because the video is CSS-mirrored but the canvas is not.
function drawBox(box, color, label) {
  const flippedX = canvas.width - box.x - box.width;

  ctx.strokeStyle = color;
  ctx.lineWidth = 3;
  ctx.strokeRect(flippedX, box.y, box.width, box.height);

  ctx.fillStyle = color;
  const labelWidth = Math.min(canvas.width - flippedX, 300);
  const labelY = Math.max(0, box.y - 28);
  ctx.fillRect(flippedX, labelY, labelWidth, 28);

  ctx.fillStyle = "#fff";
  ctx.font = "bold 14px sans-serif";
  ctx.textAlign = "left";
  ctx.fillText(label.trim(), flippedX + 6, Math.max(18, box.y - 9));
}

// ========================================================================
// UI HELPERS
// ========================================================================

function addLogEntry(name, confidence, type, message) {
  const time = new Date().toLocaleTimeString();
  const entry = document.createElement("div");
  entry.className = `log-entry log-${type}`;

  const icons = {
    success: "✅",
    warning: "⚠️",
    error: "❌",
    info: "ℹ️"
  };

  const confidenceText = (typeof confidence === "number" && confidence > 0)
    ? `${confidence.toFixed(1)}%`
    : "---";

  entry.innerHTML = `
    <span class="log-time">${time}</span>
    <span class="log-icon">${icons[type] || "ℹ️"}</span>
    <span class="log-name">${escapeHtml(name)}</span>
    <span class="log-confidence">${confidenceText}</span>
    <span class="log-message">${escapeHtml(message)}</span>
  `;

  logEntries.insertBefore(entry, logEntries.firstChild);

  while (logEntries.children.length > 50) {
    logEntries.removeChild(logEntries.lastChild);
  }

  clearLogPlaceholder();
}

function renderAttendance(records) {
  const container = document.getElementById("todayAttendance");

  if (!records || records.length === 0) {
    container.innerHTML = `<span class="help">📭 No face scans recorded today.</span>`;
    return;
  }

  container.innerHTML = records.map(r => {
    const timeParts = [];
    if (r.am_in && r.am_out) {
      timeParts.push(`AM: ${r.am_in} → ${r.am_out}`);
    } else if (r.am_in) {
      timeParts.push(`AM: ${r.am_in}`);
    }
    if (r.pm_in && r.pm_out) {
      timeParts.push(`PM: ${r.pm_in} → ${r.pm_out}`);
    } else if (r.pm_in) {
      timeParts.push(`PM: ${r.pm_in}`);
    }
    const timeText = timeParts.join("  ");

    const statusText = r.status === "on_leave" ? "🔵 On Leave" : "🟢 Present";
    const statusClass = r.status === "on_leave" ? "on-leave" : "";

    return `
      <div class="attendance-item">
        <div class="attendance-name"><strong>${escapeHtml(r.employee || "Unknown")}</strong></div>
        <div class="attendance-details">
          <span>${escapeHtml(r.employeeid || "")}</span>
          <span>${escapeHtml(timeText)}</span>
          <span class="attendance-status ${statusClass}">${statusText}</span>
        </div>
      </div>
    `;
  }).join("");
}

function escapeHtml(v) {
  return String(v).replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
  }[c]));
}

// Show employee profile modal with given employee data.
//
// The recorder passes in either:
//   • data.employee  → the raw employee object from the API response
//   • match          → the object built by identify(), which nests the
//                      employee under .employee and also carries a
//                      precomputed .imageUrl from the template loader.
//
// We normalise both shapes into one flat view here so the picture,
// name, role, employee ID, and RFID all render correctly regardless
// of which object the caller handed us.
//
// Image resolution mirrors profile.js:
//   getImageUrl("storage/faces/juan.jpg")
//      → "https://<api-origin>/storage/faces/juan.jpg"
//   If loading fails, the modal falls back to the employee's initials.
function showProfileModal(employeeData, scannedAtTime = null) {
  const modal = document.getElementById('profileModal');
  const modalBody = document.getElementById('profileModalBody');

  if (!modal || !modalBody) return;

  // Handle both the "raw employee" shape and the "nested match" shape.
  const nested = employeeData.employee || {};
  const firstname = employeeData.firstname || nested.firstname || '';
  const lastname  = employeeData.lastname  || nested.lastname  || '';
  const fullname  = (firstname + ' ' + lastname).trim()
    || employeeData.name
    || nested.name
    || 'Unknown';
  const initials  = getInitials(firstname, lastname);

  // Role — prefer direct, fall back to nested, then default.
  const role = employeeData.role || nested.role || 'employee';
  const roleLabel = role.charAt(0).toUpperCase() + role.slice(1);

  // Employee ID — prefer direct, fall back to nested.
  const employeeid = employeeData.employeeid !== undefined
    ? employeeData.employeeid
    : (nested.employeeid !== undefined ? nested.employeeid : 'N/A');

  // RFID — prefer direct, fall back to nested.
  const rfid = employeeData.rfid !== undefined
    ? employeeData.rfid
    : (nested.rfid !== undefined ? nested.rfid : 'N/A');

  // ---- Resolve the employee photo ------------------------------------
  // We accept any of these field names, in priority order:
  //   imageUrl      → already-absolute URL (set by loadTemplates)
  //   image         → profile.js uses this
  //   image_url     → sometimes returned by the faces API
  //   rawImage      → the original path from loadTemplates (fallback)
  //   photo         → legacy alias
  //   profile_image → legacy alias
  //
  // Then we normalise to an absolute URL. The rule mirrors profile.js:
  // bare paths get a leading slash before the origin is prepended.
  function pickImageField(obj) {
    if (!obj) return '';
    return obj.imageUrl
        || obj.image
        || obj.image_url
        || obj.rawImage
        || obj.photo
        || obj.profile_image
        || '';
  }

  const rawImage = pickImageField(employeeData) || pickImageField(nested);

  let imageUrl = '';
  if (rawImage) {
    if (/^https?:\/\//i.test(rawImage)) {
      imageUrl = rawImage;                                    // already absolute
    } else if (rawImage.startsWith('/')) {
      imageUrl = `${API_ORIGIN}${rawImage}`;                  // "/storage/..."
    } else {
      imageUrl = `${API_ORIGIN}/${rawImage}`;                 // "storage/..."
    }
  }

  // Debug — remove once the picture shows up reliably.
  console.log("[faces.js] modal image resolution:", {
    employeeData, nested, rawImage, imageUrl
  });

  // Build status badge if the employee is on leave.
  let statusBadge = '';
  const status = employeeData.status || nested.status || '';
  if (status === 'on_leave') {
    statusBadge = `<span class="status-badge work-status">On Leave (Work Status)</span>`;
  }

  // Format scan time.
  const lastScanTime = scannedAtTime ? formatTimeFromISO(scannedAtTime) : '--';

  // Build the profile HTML. The avatar falls back to the employee's
  // initials if the image URL is missing or the image fails to load.
  const profileHtml = `
    <div class="profile-section">
      <div class="profile-avatar">
        ${imageUrl
          ? `<img src="${imageUrl}" alt="${escapeHtml(fullname)}"
                onerror="this.style.display='none';this.parentElement.innerHTML='<span class=\\'initials-text\\'>${initials}</span>';" />`
          : `<span class="initials-text">${initials}</span>`}
      </div>
      <div class="profile-info">
        <div class="fullname">${escapeHtml(fullname)}</div>
        <span class="role-badge">${escapeHtml(roleLabel)}</span>
        ${statusBadge}
        <div class="id-row">
          <span>
            <span class="label">Employee ID:</span>
            <span class="value">${escapeHtml(employeeid)}</span>
          </span>
          <span>
            <span class="label">RFID:</span>
            <span class="value">${escapeHtml(rfid)}</span>
          </span>
        </div>
      </div>
    </div>
    <div class="time-section">
      <div class="time-row">
        <div class="time-item">
          <div class="label">Last Scan</div>
          <div class="value" id="modalLastScanTime">${escapeHtml(lastScanTime)}</div>
        </div>
        <div class="time-item rfid-prompt">
          <div class="rfid-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="28" height="28" fill="none"
                 stroke="currentColor" stroke-width="2"
                 stroke-linecap="round" stroke-linejoin="round">
              <path d="M4 8a12 12 0 0 1 16 0" />
              <path d="M7 11a8 8 0 0 1 10 0" />
              <path d="M10 14a4 4 0 0 1 4 0" />
              <circle cx="12" cy="18" r="1.2" fill="currentColor" stroke="none" />
            </svg>
          </div>
          <div class="rfid-text">Please tap your RFID</div>
        </div>
      </div>
    </div>
  `;

  modalBody.innerHTML = profileHtml;

  // Show modal.
  modal.style.display = 'flex';

  // Update the "Current Time" cell every second while the modal is open.
  const updateModalTime = () => {
    const currentTimeDisplay = document.getElementById('modalCurrentTimeDisplay');
    if (currentTimeDisplay) {
      currentTimeDisplay.textContent = getCurrentTime();
    }
  };
  updateModalTime();

  // Clear any interval/timeout left over from a previous scan so
  // rapid-fire scans don't stack up hidden intervals.
  if (window._profileModalTimeInterval) {
    clearInterval(window._profileModalTimeInterval);
  }
  window._profileModalTimeInterval = setInterval(updateModalTime, 1000);

  // Auto-hide after PROFILE_MODAL_DISPLAY_MS (currently 8 seconds).
  if (window._profileModalHideTimeout) {
    clearTimeout(window._profileModalHideTimeout);
  }
  window._profileModalHideTimeout = setTimeout(() => {
    modal.style.display = 'none';
    if (window._profileModalTimeInterval) {
      clearInterval(window._profileModalTimeInterval);
      window._profileModalTimeInterval = null;
    }
  }, PROFILE_MODAL_DISPLAY_MS);
}

// ========================================================================
// RFID TAP POLLING (mirrors profile.js)
// ========================================================================
//
// The profile page polls /api/get-latest-rfid every 2 seconds and shows
// the latest employee. We do the same here, but the result is rendered
// inside a modal that auto-hides. When a NEW RFID (different from the
// previous one) arrives, we open the modal again.
//
// On success (employee found):
//   • Show the employee photo, name, role, employee ID, RFID.
//   • Bottom strip: Last Scan + a GREEN CHECK + "Tap recorded".
//
// On unknown RFID:
//   • Show a "?" avatar with "Unknown".
//   • Bottom strip: Last Scan + a RED X + "Not registered".

const RFID_POLL_INTERVAL = 2000;                 // poll every 2 s
const RFID_MODAL_DISPLAY_MS = 8000;              // auto-hide after 8 s
const RFID_API_URL = `${API_ORIGIN}/api/get-latest-rfid`;

let rfidPollTimer = null;
let lastRfidSeen = null;                         // dedupe: only pop on NEW taps
let rfidModalHideTimeout = null;

// Fetch the latest RFID tap and render the modal if it's new.
async function pollLatestRfid() {
  try {
    const res = await fetch(RFID_API_URL, { headers: { Accept: 'application/json' } });
    if (!res.ok) return;
    const data = await res.json();
    if (data.status !== 'success') return;

    // Only react when the RFID actually changes (or the scanned_at
    // timestamp changes, for the same card being re-tapped).
    const signature = `${data.rfid || ''}|${data.scanned_at || ''}`;
    if (signature === lastRfidSeen) return;
    lastRfidSeen = signature;

    // Ignore empty heartbeats (no RFID ever tapped).
    if (!data.rfid) return;

    if (data.found && data.employee) {
      showRfidTapModal({
        employee: data.employee,
        rfid: data.rfid,
        scannedAt: data.scanned_at,
        known: true
      });
    } else {
      showRfidTapModal({
        rfid: data.rfid,
        scannedAt: data.scanned_at,
        known: false
      });
    }
  } catch (e) {
    // Silent — polling errors shouldn't spam the console.
    // console.warn('[faces.js] rfid poll failed:', e);
  }
}

// Render the RFID tap modal.
//
// `payload.known === true`  → show employee details + green check.
// `payload.known === false` → show "Unknown" + red X.
function showRfidTapModal(payload) {
  const modal = document.getElementById('rfidModal');
  const body = document.getElementById('rfidModalBody');
  if (!modal || !body) return;

  const known = payload.known === true;
  const emp = payload.employee || {};

  // ---- Known employee ---------------------------------------------------
  if (known) {
    const firstname = emp.firstname || '';
    const lastname = emp.lastname || '';
    const fullname = (firstname + ' ' + lastname).trim() || emp.name || 'Unknown';
    const initials = getInitials(firstname, lastname);
    const role = emp.role || 'employee';
    const roleLabel = role.charAt(0).toUpperCase() + role.slice(1);

    const employeeid = emp.employeeid !== undefined ? emp.employeeid : 'N/A';
    const rfid = emp.rfid || payload.rfid || 'N/A';

    // Resolve the photo (same chain as the scan modal).
    let rawImage = emp.imageUrl || emp.image || emp.image_url || emp.photo || emp.profile_image || '';
    let imageUrl = '';
    if (rawImage) {
      if (/^https?:\/\//i.test(rawImage)) imageUrl = rawImage;
      else if (rawImage.startsWith('/')) imageUrl = `${API_ORIGIN}${rawImage}`;
      else imageUrl = `${API_ORIGIN}/${rawImage}`;
    }

    const scanTime = payload.scannedAt ? formatTimeFromISO(payload.scannedAt) : '--';

    body.innerHTML = `
      <div class="profile-section">
        <div class="profile-avatar">
          ${imageUrl
            ? `<img src="${imageUrl}" alt="${escapeHtml(fullname)}"
                  onerror="this.style.display='none';this.parentElement.innerHTML='<span class=\\'initials-text\\'>${initials}</span>';" />`
            : `<span class="initials-text">${initials}</span>`}
        </div>
        <div class="profile-info">
          <div class="fullname">${escapeHtml(fullname)}</div>
          <span class="role-badge">${escapeHtml(roleLabel)}</span>
          <div class="id-row">
            <span>
              <span class="label">Employee ID:</span>
              <span class="value">${escapeHtml(employeeid)}</span>
            </span>
            <span>
              <span class="label">RFID:</span>
              <span class="value">${escapeHtml(rfid)}</span>
            </span>
          </div>
        </div>
      </div>
      <div class="time-section">
        <div class="time-row">
          <div class="time-item">
            <div class="label">Last Scan</div>
            <div class="value">${escapeHtml(scanTime)}</div>
          </div>
          <div class="time-item tap-result tap-ok">
            <div class="tap-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="32" height="32" fill="none"
                   stroke="currentColor" stroke-width="2.5"
                   stroke-linecap="round" stroke-linejoin="round">
                <circle cx="12" cy="12" r="10" />
                <path d="M7.5 12.5l3 3 6-6.5" />
              </svg>
            </div>
            <div class="tap-text">Tap recorded</div>
          </div>
        </div>
      </div>
    `;
  }
  // ---- Unknown RFID ----------------------------------------------------
  else {
    const rfid = payload.rfid || 'N/A';
    const scanTime = payload.scannedAt ? formatTimeFromISO(payload.scannedAt) : '--';

    body.innerHTML = `
      <div class="profile-section">
        <div class="profile-avatar unknown-avatar">
          <span class="initials-text">❓</span>
        </div>
        <div class="profile-info">
          <div class="fullname unknown-name">Unknown</div>
          <span class="role-badge unknown">Unknown</span>
          <div class="id-row">
            <span>
              <span class="label">Employee ID:</span>
              <span class="value unknown-value">—</span>
            </span>
            <span>
              <span class="label">RFID:</span>
              <span class="value unknown-value">${escapeHtml(rfid)}</span>
            </span>
          </div>
        </div>
      </div>
      <div class="time-section">
        <div class="time-row">
          <div class="time-item">
            <div class="label">Last Scan</div>
            <div class="value">${escapeHtml(scanTime)}</div>
          </div>
          <div class="time-item tap-result tap-fail">
            <div class="tap-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="32" height="32" fill="none"
                   stroke="currentColor" stroke-width="2.5"
                   stroke-linecap="round" stroke-linejoin="round">
                <circle cx="12" cy="12" r="10" />
                <path d="M8.5 8.5l7 7" />
                <path d="M15.5 8.5l-7 7" />
              </svg>
            </div>
            <div class="tap-text">Not registered</div>
          </div>
        </div>
      </div>
    `;
  }

  // Show the modal.
  modal.style.display = 'flex';

  // Auto-hide after RFID_MODAL_DISPLAY_MS.
  if (rfidModalHideTimeout) clearTimeout(rfidModalHideTimeout);
  rfidModalHideTimeout = setTimeout(() => {
    modal.style.display = 'none';
  }, RFID_MODAL_DISPLAY_MS);
}

// Start polling once the page is ready. Called from the boot chain
// so it runs after the models/templates load.
function startRfidPolling() {
  if (rfidPollTimer) clearInterval(rfidPollTimer);
  // Fire once immediately, then every RFID_POLL_INTERVAL.
  pollLatestRfid();
  rfidPollTimer = setInterval(pollLatestRfid, RFID_POLL_INTERVAL);
  console.log("[faces.js] RFID tap polling started");
}

// ========================================================================
// EVENT LISTENERS
// ========================================================================
//
// The Start/Stop buttons no longer exist in the HTML, so we no longer
// wire up click handlers for them. Only the Refresh button, the modal
// close buttons, and the beforeunload guard remain.

const refreshBtn = document.getElementById("refreshBtn");
if (refreshBtn) {
  refreshBtn.addEventListener("click", async () => {
    messageEl.textContent = "🔄 Refreshing data…";
    await loadTemplates().catch(e => console.error("refresh loadTemplates:", e));
    await loadAttendance().catch(e => console.error("refresh loadAttendance:", e));
    await loadStats().catch(e => console.error("refresh loadStats:", e));
    await loadServerConfig().catch(e => console.warn("refresh loadServerConfig:", e));
    messageEl.textContent = "🔄 Data refreshed!";
  });
}

// Profile modal close button (scan modal).
const profileModalClose = document.getElementById("profileModalClose");
if (profileModalClose) {
  profileModalClose.addEventListener("click", () => {
    const modal = document.getElementById('profileModal');
    if (modal) {
      modal.style.display = 'none';
    }
    // Also stop the live clock interval when the user manually closes.
    if (window._profileModalTimeInterval) {
      clearInterval(window._profileModalTimeInterval);
      window._profileModalTimeInterval = null;
    }
    if (window._profileModalHideTimeout) {
      clearTimeout(window._profileModalHideTimeout);
      window._profileModalHideTimeout = null;
    }
  });
}

// RFID modal close button (tap modal).
const rfidModalClose = document.getElementById('rfidModalClose');
if (rfidModalClose) {
  rfidModalClose.addEventListener('click', () => {
    const modal = document.getElementById('rfidModal');
    if (modal) modal.style.display = 'none';
    if (rfidModalHideTimeout) {
      clearTimeout(rfidModalHideTimeout);
      rfidModalHideTimeout = null;
    }
  });
}

window.addEventListener("beforeunload", stopCamera);

// ========================================================================
// START
// ========================================================================
//
// The Start/Stop buttons have been removed — the scanner now boots
// straight into camera mode as soon as the page loads. We still keep
// the `startCamera()` and `stopCamera()` functions because:
//   • `startCamera()` is what actually opens the camera stream
//   • `stopCamera()` is still called on page unload (beforeunload)
//     so the camera light turns off when the user navigates away.
boot().then(() => {
  // Only auto-start if the models loaded successfully.
  if (modelsReady) {
    // Small delay so the DOM is fully painted before getUserMedia runs —
    // this avoids a race on some browsers where the video element isn't
    // ready when the permission prompt resolves.
    setTimeout(() => {
      startCamera();
    }, 100);
  } else {
    messageEl.textContent = "Could not load AI models. Reload the page to retry.";
  }
}).then(() => {
  // Set up profile watcher after all initial data is loaded
  // We need to wait for stats to load so we can use profile_images as baseline
  // But we don't want to delay camera startup, so we'll check periodically
  // until we have the stats data, then set up the watcher
  const checkForStats = () => {
    // Check if we have stats data (statTFS element has been updated from initial "0")
    const statTfs = document.getElementById("statTFS");
    if (statTfs && statTfs.textContent !== "0") {
      // We have stats data, use it as baseline
      initialTemplateCount = parseInt(statTfs.textContent) || 0;
      console.log(`[faces.js] Setting up profile count watcher with baseline from stats: ${initialTemplateCount}`);
      setupProfileCountWatcher();
    } else {
      // Stats not ready yet, check again in 1 second
      setTimeout(checkForStats, 1000);
    }
  };

  // Start checking for stats data
  checkForStats();

  // Kick off RFID tap polling. Runs alongside the camera loop so an
  // RFID card tap opens the second modal with a check/X result.
  startRfidPolling();
});