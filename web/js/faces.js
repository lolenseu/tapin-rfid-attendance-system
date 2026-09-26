/* TapIn Face Scanner
   - Runs standalone (e.g. hosted on Vercel) — talks to the TapIn API over CORS
   - Camera frames stay in the browser
   - Loads profile images/templates from the API's /api/faces/employees route
   - Face detection + recognition runs locally in the browser
   - When a face is matched with enough confidence, attendance is recorded
     via /api/faces/record — no RFID tap required
   - Logs all face detections */

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
const MATCH_THRESHOLD = 0.50; // Lower = stricter
const ATTENDANCE_COOLDOWN = 10000; // 10 seconds between scans

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

  console.log("[faces.js] Boot sequence complete");
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

      // The API returns paths like "/storage/profiles/xxx.jpg" that are
      // relative to the API host, not this page's own (Vercel) origin.
      const imageUrl = /^https?:\/\//i.test(rawImageUrl)
        ? rawImageUrl
        : API_ORIGIN + rawImageUrl;

      try {
        const img = await faceapi.fetchImage(imageUrl);
        const detection = await faceapi.detectSingleFace(
            img,
            new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.5 })
          )
          .withFaceLandmarks(true) // true = use the tiny landmark net (matches boot())
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
          imageUrl,
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
    // Re-throw so boot() can log it, but boot() already catches per-call.
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
    // Make sure the UI doesn't stay stuck on "Loading…"
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
    // Set visible placeholders so the UI doesn't stay at "0" silently
    const elTfs = document.getElementById("statTFS");
    if (elTfs && elTfs.textContent === "0") elTfs.textContent = "—";
    const elPresent = document.getElementById("statPresent");
    if (elPresent && elPresent.textContent === "0") elPresent.textContent = "—";
    const elTotal = document.getElementById("statTotal");
    if (elTotal && elTotal.textContent === "0") elTotal.textContent = "—";
    const elRate = document.getElementById("statRate");
    if (elRate && elRate.textContent === "0%") elRate.textContent = "—";
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

    // Wait for metadata so videoWidth/videoHeight are correct
    if (!video.videoWidth) {
      await new Promise(resolve => {
        video.onloadedmetadata = () => resolve();
      });
    }

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    running = true;

    document.getElementById("start").disabled = true;
    document.getElementById("stop").disabled = false;
    document.getElementById("cameraHint").style.display = "none";
    messageEl.textContent = "🔍 Scanning for faces...";

    recognitionLoop();
  } catch (e) {
    console.error("Camera error:", e);
    alert("Camera access failed. Allow camera permission and use HTTPS or localhost.");
  }
}

function stopCamera() {
  running = false;
  if (stream) {
    stream.getTracks().forEach(t => t.stop());
    stream = null;
  }
  video.srcObject = null;
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  document.getElementById("start").disabled = false;
  document.getElementById("stop").disabled = true;
  document.getElementById("cameraHint").style.display = "grid";
  messageEl.textContent = "Camera stopped.";
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
        samples: 1
      };
    }
  }

  if (!best || best.distance > MATCH_THRESHOLD) return null;

  const confidence = Math.max(0, Math.min(100, (1 - best.distance) * 100));
  return { ...best, confidence };
}

async function recordAttendance(match) {
  const uid = String(match.uid || match.employee?.uid || "");
  const rfid = String(match.rfid || match.employee?.rfid || "");

  if (!uid && !rfid) {
    console.warn("No UID or RFID found for match");
    return;
  }

  const key = uid || rfid;
  const now = Date.now();
  const previous = lastSent.get(key) || 0;

  if (now - previous < ATTENDANCE_COOLDOWN) {
    return;
  }

  // ⚠️ CRITICAL: set the cooldown timestamp BEFORE the async fetch() call.
  lastSent.set(key, now);

  try {
    const res = await fetch(`${API_BASE}/record`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        uid: uid,
        rfid: rfid,
        confidence: match.confidence,
        scanned_at: new Date().toISOString(),
        face_detected: true
      })
    });

    const data = await res.json();

    if (res.ok && data.status === "success") {
      const empName = data.employee?.name || data.employee?.firstname || match.name;

      addLogEntry(empName, data.confidence || match.confidence, "success", data.attendance_status || "recorded");

      await loadAttendance();
      await loadStats();

      messageEl.textContent = `✅ ${empName} - Attendance recorded`;

    } else if (res.status === 403) {
      addLogEntry(match.name, match.confidence, "warning", "low confidence");
      messageEl.textContent = "⚠️ Confidence too low for attendance.";

    } else {
      addLogEntry(match.name, match.confidence, "error", "rejected");
      messageEl.textContent = "❌ Attendance not recorded.";
    }
  } catch (e) {
    console.error("Attendance error:", e);
    addLogEntry(match.name, match.confidence, "error", "API error");
    messageEl.textContent = "⚠️ API connection failed.";
  }
}

// ========================================================================
// RECOGNITION LOOP
// ========================================================================

async function recognitionLoop() {
  if (!running || busy) return;
  busy = true;

  try {
    const detections = await faceapi.detectAllFaces(
      video,
      new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.5 })
    ).withFaceLandmarks(true).withFaceDescriptors();

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    faceCountEl.textContent = `Faces: ${detections.length}`;

    const resized = faceapi.resizeResults(detections, {
      width: canvas.width,
      height: canvas.height
    });

    for (let i = 0; i < resized.length; i++) {
      const box = resized[i].detection.box;
      const match = identify(detections[i].descriptor);

      let label = "Unknown";
      let color = "#ef4444";

      if (match) {
        label = `${match.name} ${match.confidence.toFixed(1)}%`;
        color = "#22c55e";
        await recordAttendance(match);
      }

      // Manual flip: canvas has NO CSS mirror, video DOES.
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

  } catch (e) {
    console.error("Recognition loop error:", e);
  } finally {
    busy = false;
    if (running) requestAnimationFrame(recognitionLoop);
  }
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

  entry.innerHTML = `
    <span class="log-time">${time}</span>
    <span class="log-icon">${icons[type] || "ℹ️"}</span>
    <span class="log-name">${escapeHtml(name)}</span>
    <span class="log-confidence">${confidence?.toFixed(1) || "---"}%</span>
    <span class="log-message">${escapeHtml(message)}</span>
  `;

  logEntries.insertBefore(entry, logEntries.firstChild);

  while (logEntries.children.length > 50) {
    logEntries.removeChild(logEntries.lastChild);
  }

  const empty = logEntries.querySelector(".log-empty");
  if (empty) empty.remove();
}

function renderAttendance(records) {
  const container = document.getElementById("todayAttendance");

  if (!records || records.length === 0) {
    container.innerHTML = `<span class="help">📭 No attendance records for today.</span>`;
    return;
  }

  container.innerHTML = records.map(r => {
    const status = r.status === "on_leave" ? "🔵 On Leave" : "🟢 Present";
    return `
      <div class="attendance-item">
        <div class="attendance-name"><strong>${escapeHtml(r.employee || "Unknown")}</strong></div>
        <div class="attendance-details">
          <span>${escapeHtml(r.employeeid || "")}</span>
          <span>${r.am_in ? `AM: ${r.am_in}` : ""} ${r.pm_in ? `PM: ${r.pm_in}` : ""}</span>
          <span class="attendance-status ${r.status === "on_leave" ? "on-leave" : ""}">${status}</span>
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

// ========================================================================
// EVENT LISTENERS
// ========================================================================

document.getElementById("start").addEventListener("click", startCamera);
document.getElementById("stop").addEventListener("click", stopCamera);
document.getElementById("refreshBtn").addEventListener("click", async () => {
  messageEl.textContent = "🔄 Refreshing data…";
  await loadTemplates().catch(e => console.error("refresh loadTemplates:", e));
  await loadAttendance().catch(e => console.error("refresh loadAttendance:", e));
  await loadStats().catch(e => console.error("refresh loadStats:", e));
  messageEl.textContent = "🔄 Data refreshed!";
});

window.addEventListener("beforeunload", stopCamera);

// ========================================================================
// START
// ========================================================================

boot();