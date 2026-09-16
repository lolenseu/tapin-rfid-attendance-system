/* TapIn Face Scanner
   - Camera frames stay in the browser
   - Loads .tfs files from storage/samples/
   - Face detection + recognition runs locally
   - Attendance recorded via RFID verification
   - Logs all face detections */

const BASE = (window.TAPIN_API_URL || "https://lolenseu.pythonanywhere.com").replace(/\/+$/, "") + "/facialrecognition";
const MODEL_URL = "https://cdn.jsdelivr.net/gh/justadudewhohacks/face-api.js@0.22.2/weights";
const MATCH_THRESHOLD = 0.50; // Lower = stricter
const ATTENDANCE_COOLDOWN = 10000; // 10 seconds between scans

const video = document.getElementById("video");
const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");
const statusEl = document.getElementById("status");
const messageEl = document.getElementById("message");
const resultEl = document.getElementById("result");
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
// LOAD MODELS AND DATA
// ========================================================================

async function boot() {
  try {
    statusEl.textContent = "Loading AI…";
    await faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL);
    await faceapi.nets.faceLandmark68TinyNet.loadFromUri(MODEL_URL);
    await faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL);
    modelsReady = true;
    statusEl.textContent = "Camera ready";
    messageEl.textContent = "Start the scanner to detect faces.";
    await loadTemplates();
    await loadAttendance();
    await loadStats();
  } catch (e) {
    console.error("Boot error:", e);
    statusEl.textContent = "AI Load Failed";
    messageEl.textContent = "Could not load face models. Check internet connection.";
  }
}

async function loadTemplates() {
  try {
    const res = await fetch(`${BASE}/api/employees`);
    const data = await res.json();
    const employees = data.employees || [];

    faceTemplates = [];

    for (const item of employees) {
      const employee = item.employee || {};
      const imageUrl = item.image_url || employee.image || "";
      if (!imageUrl) continue;

      try {
        const img = await faceapi.fetchImage(imageUrl);
        const detection = await faceapi.detectSingleFace(img)
          .withFaceLandmarks()
          .withFaceDescriptor();

        if (!detection) {
          console.warn(`No face detected in profile image for ${employee.name || item.rfid}`);
          continue;
        }

        faceTemplates.push({
          ...employee,
          rfid: item.rfid || employee.rfid,
          uid: employee.uid,
          name: employee.name || `${employee.firstname || ""} ${employee.lastname || ""}`.trim() || "Unknown",
          imageUrl,
          descriptor: Array.from(detection.descriptor)
        });
      } catch (imgErr) {
        console.warn(`Could not load face template for ${employee.name || item.rfid}:`, imgErr);
      }
    }

    console.log(`✅ Loaded ${faceTemplates.length} face templates from profile images`);
    faceCountEl.textContent = `Faces: ${faceTemplates.length}`;
    statusEl.textContent = faceTemplates.length ? "Profile templates ready" : "No profile images found";
    statusEl.className = faceTemplates.length ? "pill status-ready" : "pill status-error";
  } catch (e) {
    console.error("Error loading templates:", e);
    faceTemplates = [];
    faceCountEl.textContent = "Faces: 0";
    statusEl.textContent = "Template load failed";
    statusEl.className = "pill status-error";
  }
}

async function loadAttendance() {
  try {
    const res = await fetch(`${BASE}/api/recent-attendance`);
    const data = await res.json();
    if (data.status === "success") {
      todayAttendance = data.attendance || [];
      renderAttendance(todayAttendance);
    }
  } catch (e) {
    console.error("Error loading attendance:", e);
  }
}

async function loadStats() {
  try {
    const res = await fetch(`${BASE}/api/dashboard-stats`);
    const data = await res.json();
    if (data.status === "success") {
      const stats = data.stats;
      document.getElementById("statTFS").textContent = stats.profile_images || 0;
      document.getElementById("statPresent").textContent = stats.present_today || 0;
      document.getElementById("statTotal").textContent = stats.total_employees || 0;
      document.getElementById("statRate").textContent = stats.attendance_rate || "0%";
    }
  } catch (e) {
    console.error("Error loading stats:", e);
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
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    running = true;

    document.getElementById("start").disabled = true;
    document.getElementById("stop").disabled = false;
    document.getElementById("cameraHint").style.display = "none";
    messageEl.textContent = "🔍 Scanning for faces...";
    
    resultEl.innerHTML = `<strong>👤 Scanning...</strong><span>Looking for registered faces.</span>`;
    
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
        uid: employee.uid || "",
        distance: d,
        name: `${employee.firstname || ""} ${employee.lastname || ""}`.trim() || employee.name || "Unknown",
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

  const now = Date.now();
  const key = uid || rfid;
  const previous = lastSent.get(key) || 0;
  if (now - previous < ATTENDANCE_COOLDOWN) {
    console.log(`⏳ Cooldown active for ${match.name}`);
    return;
  }
  lastSent.set(key, now);

  // Update UI
  resultEl.className = "result recognized";
  resultEl.innerHTML = `
    <strong>🔄 ${escapeHtml(match.name)}</strong>
    <span>Confidence: ${match.confidence.toFixed(1)}% · Recording attendance...</span>
  `;

  try {
    const res = await fetch(`${BASE}/api/verify-and-record`, {
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
      const statusIcon = data.is_present ? "✅" : "⏳";
      
      resultEl.className = "result recognized";
      resultEl.innerHTML = `
        <strong>${statusIcon} ${escapeHtml(empName)}</strong>
        <span>Attendance recorded: ${escapeHtml(data.message || "Success")}</span>
      `;
      
      // Add to log
      addLogEntry(empName, data.confidence || match.confidence, "success", data.attendance_status || "recorded");
      
      // Refresh attendance
      await loadAttendance();
      await loadStats();
      
      messageEl.textContent = `✅ ${empName} - Attendance recorded`;

    } else if (res.status === 403) {
      resultEl.className = "result rejected";
      resultEl.innerHTML = `
        <strong>⚠️ Low Confidence</strong>
        <span>${escapeHtml(data.message || "Confidence below threshold")}</span>
      `;
      addLogEntry(match.name, match.confidence, "warning", "low confidence");
      messageEl.textContent = "⚠️ Confidence too low for attendance.";
      
    } else {
      resultEl.className = "result rejected";
      resultEl.innerHTML = `
        <strong>❌ Recognition rejected</strong>
        <span>${escapeHtml(data.message || "Verification failed")}</span>
      `;
      addLogEntry(match.name, match.confidence, "error", "rejected");
      messageEl.textContent = "❌ Attendance not recorded.";
    }
  } catch (e) {
    console.error("Attendance error:", e);
    resultEl.className = "result rejected";
    resultEl.innerHTML = `
      <strong>⚠️ API Error</strong>
      <span>Could not connect to server. Try again.</span>
    `;
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
      width: canvas.width, height: canvas.height
    });

    for (let i = 0; i < resized.length; i++) {
      const box = resized[i].detection.box;
      const match = identify(detections[i].descriptor);
      
      let label = "Unknown";
      let color = "#ef4444";
      let isMatch = false;

      if (match) {
        label = `${match.name} ${match.confidence.toFixed(1)}%`;
        color = "#22c55e";
        isMatch = true;
        
        // Record attendance for this match
        await recordAttendance(match);
      }

      // Draw bounding box
      ctx.strokeStyle = color;
      ctx.lineWidth = 3;
      ctx.strokeRect(box.x, box.y, box.width, box.height);

      // Draw label background
      ctx.fillStyle = color;
      ctx.fillRect(box.x, Math.max(0, box.y - 28), Math.min(canvas.width - box.x, 300), 28);
      ctx.fillStyle = "#fff";
      ctx.font = "bold 14px sans-serif";
      ctx.fillText(label.trim(), box.x + 6, Math.max(18, box.y - 9));
    }

    // If no faces detected, update result
    if (detections.length === 0 && running) {
      const currentText = resultEl.querySelector("strong")?.textContent || "";
      if (!currentText.includes("Scanning") && !currentText.includes("No face")) {
        resultEl.className = "result";
        resultEl.innerHTML = `
          <strong>👤 No face detected</strong>
          <span>Look at the camera to scan your face.</span>
        `;
      }
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
  
  // Keep only last 50 entries
  while (logEntries.children.length > 50) {
    logEntries.removeChild(logEntries.lastChild);
  }
  
  // Remove empty state
  const empty = logEntries.querySelector(".log-empty");
  if (empty) empty.remove();
}

function renderAttendance(records) {
  const container = document.getElementById("todayAttendance");
  
  if (!records || records.length === 0) {
    container.innerHTML = `
      <span class="help">📭 No attendance records for today.</span>
    `;
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
  await loadTemplates();
  await loadAttendance();
  await loadStats();
  messageEl.textContent = "🔄 Data refreshed!";
});

window.addEventListener("beforeunload", stopCamera);

// ========================================================================
// START
// ========================================================================

boot();