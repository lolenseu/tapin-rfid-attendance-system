const API_BASE_URL = (window.TAPIN_API_URL || '').replace(/\/+$/, '');
const API_URL = `${API_BASE_URL}/api/get-latest-rfid`;
const SCAN_FEED_URL = `${API_BASE_URL}/api/scan-feed`;
const POLL_INTERVAL = 2000;
const VERSION_URL = 'https://raw.githubusercontent.com/lolenseu/tapin-rfid-attendance-system/refs/heads/main/version.txt';

const $ = (sel) => document.querySelector(sel);
const scannedAt = $('#scannedAt');
const employeeCard = $('#employeeCard');
const noData = $('#noData');
const statusDot = $('#statusDot');
const statusText = $('#statusText');
const lastUpdated = $('#lastUpdated');
const logoContainer = $('#logoContainer');
const emptyAvatar = $('#emptyAvatar');
const profileIconPlaceholder = $('#profileIconPlaceholder');

let currentData = null;
let isFirstLoad = true;
let currentRfid = null;
let lastAttendanceSignature = '';
let versionData = null;

// Cache of the most recent scan feed payload so we don't have to fetch it on
// every single render — we only refetch when the feed route is polled.
let scanFeedCache = [];

function loadLogo() {
    const logoPaths = [
        'storage/assets/tapin_logo.png',
        'storage/assets/tapin_logo.jpg',
        'assets/tapin_logo.png',
        'assets/tapin_logo.jpg',
        'tapin_logo.png',
        'tapin_logo.jpg'
    ];

    for (const path of logoPaths) {
        const img = new Image();
        img.onload = function() {
            logoContainer.innerHTML = '';
            logoContainer.appendChild(img);
        };
        img.src = path;
    }
}

function loadProfileIcon() {
    const iconPaths = [
        'storage/assets/profile_icon.png',
        'storage/assets/profile_icon.jpg',
        'assets/profile_icon.png',
        'assets/profile_icon.jpg',
        'profile_icon.png',
        'profile_icon.jpg'
    ];

    for (const path of iconPaths) {
        const img = new Image();
        img.onload = function() {
            profileIconPlaceholder.src = path;
        };
        img.src = path;
    }
}

function createVersionNotification() {
    if (document.getElementById('versionNotification')) {
        return;
    }

    const notification = document.createElement('div');
    notification.id = 'versionNotification';
    notification.style.cssText = `
        position: fixed;
        top: 16px;
        right: 16px;
        background: rgba(255, 255, 255, 0.95);
        backdrop-filter: blur(20px);
        -webkit-backdrop-filter: blur(20px);
        border: 1px solid #e2e8f0;
        border-radius: 16px;
        padding: 14px 20px;
        z-index: 1000;
        max-width: 260px;
        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.12);
        transition: all 0.3s ease;
        user-select: none;
        pointer-events: none;
        font-family: 'Poppins', system-ui, -apple-system, sans-serif;
    `;

    notification.innerHTML = `
        <div style="display: flex; align-items: center; gap: 12px;">
            <div style="flex-shrink: 0;">
                <span style="display: inline-block; background: #dbeafe; border-radius: 50%; width: 32px; height: 32px; text-align: center; line-height: 32px; font-size: 18px; border: 1px solid #93c5fd;">⚡</span>
            </div>
            <div>
                <div style="font-size: 11px; font-weight: 700; color: #2563eb; letter-spacing: 0.5px; text-transform: uppercase; margin-bottom: 1px;">
                    Beta Version
                </div>
                <div style="font-size: 14px; color: #0f172a; font-weight: 600; line-height: 1.3;">
                    ${versionData || 'v0.1.40'}
                </div>
                <div style="font-size: 11px; color: #64748b; margin-top: 2px;">
                    System in development
                </div>
            </div>
        </div>
    `;

    notification.addEventListener('mouseenter', function() {
        this.style.transform = 'scale(1.02)';
        this.style.boxShadow = '0 12px 40px rgba(37, 99, 235, 0.15)';
        this.style.borderColor = '#93c5fd';
    });

    notification.addEventListener('mouseleave', function() {
        this.style.transform = 'scale(1)';
        this.style.boxShadow = '0 8px 32px rgba(0, 0, 0, 0.12)';
        this.style.borderColor = '#e2e8f0';
    });

    document.body.appendChild(notification);

    if (!document.getElementById('versionAnimationStyle')) {
        const style = document.createElement('style');
        style.id = 'versionAnimationStyle';
        style.textContent = `
            @keyframes slideInRight {
                from {
                    opacity: 0;
                    transform: translateX(30px) scale(0.95);
                }
                to {
                    opacity: 1;
                    transform: translateX(0) scale(1);
                }
            }
            #versionNotification {
                animation: slideInRight 0.5s ease;
            }
        `;
        document.head.appendChild(style);
    }
}

async function fetchVersion() {
    try {
        const response = await fetch(VERSION_URL + '?t=' + Date.now());
        if (response.ok) {
            const text = await response.text();
            const lines = text.split('\n').filter(line => line.trim() !== '');
            const versionLine = lines.find(line => line.includes('v'));
            if (versionLine) {
                const match = versionLine.match(/v[\d.]+/);
                if (match) {
                    versionData = match[0];
                } else {
                    versionData = versionLine.trim();
                }
            } else if (lines.length > 0) {
                versionData = lines[0].trim();
            }
        } else {
            versionData = 'v0.1.40';
        }
    } catch (error) {
        console.warn('Could not fetch version:', error);
        versionData = 'v0.1.40';
    }
    
    createVersionNotification();
}

function formatDate(isoString) {
    if (!isoString) return 'Waiting for scan...';
    try {
        const d = new Date(isoString);
        return 'Scanned: ' + d.toLocaleString('en-PH', { 
            month: 'short', day: 'numeric', year: 'numeric',
            hour: '2-digit', minute: '2-digit', second: '2-digit',
            hour12: true
        });
    } catch {
        return isoString;
    }
}

function formatTime(timeStr) {
    if (!timeStr) return '--';
    if (timeStr.includes(':')) {
        try {
            const parts = timeStr.split(':');
            if (parts.length >= 2) {
                let hour = parseInt(parts[0]);
                const minute = parts[1];
                const ampm = hour >= 12 ? 'PM' : 'AM';
                hour = hour % 12 || 12;
                return `${hour}:${minute} ${ampm}`;
            }
            return timeStr;
        } catch {
            return timeStr;
        }
    }
    return timeStr;
}

function formatTimeFromISO(isoString) {
    if (!isoString) return '--';
    try {
        const d = new Date(isoString);
        return d.toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit', hour12: true });
    } catch {
        return isoString;
    }
}

// Format DTR time (stored as 12-hour without AM/PM) for display with correct
// AM/PM based on the field's own period context ("am"/"pm"). Used as a
// fallback only — the primary display path now derives AM/PM directly from
// the feed's scanned_at timestamp so it never lies about the actual time.
function formatDtrTimeForDisplay(timeStr, period) {
    if (!timeStr) return '--';
    if (timeStr.includes(':')) {
        try {
            const parts = timeStr.split(':');
            if (parts.length >= 2) {
                let hour = parseInt(parts[0]);
                const minute = parts[1];

                // For DTR times, we know the context (AM/PM field) so we can display correctly
                // Convert to 12-hour format for display
                hour = hour % 12;
                if (hour === 0) hour = 12;

                // Determine AM/PM based on the field context, not the hour value
                const ampm = period === 'pm' ? 'PM' : 'AM';
                return `${hour}:${minute} ${ampm}`;
            }
            return timeStr;
        } catch {
            return timeStr;
        }
    }
    return timeStr;
}

function getInitials(firstname, lastname) {
    const f = (firstname || '').charAt(0).toUpperCase();
    const l = (lastname || '').charAt(0).toUpperCase();
    return f + l || '?';
}

function getCurrentTime() {
    const now = new Date();
    return now.toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true });
}

function getImageUrl(imagePath) {
    if (!imagePath) return '';
    if (imagePath.startsWith('http')) return imagePath;
    return `${API_BASE_URL}/${imagePath}`;
}

/* ============================================================
   SCAN FEED HELPERS
   The profile screen pulls its AM/PM time-in and time-out values
   from the scan feed (via /api/scan-feed) instead of relying on
   the DTR row. That way each time is displayed with the true
   AM/PM of the moment it was actually recorded.
   ============================================================ */

// Fetch the scan feed once and cache it.
async function fetchScanFeed() {
    try {
        const res = await fetch(SCAN_FEED_URL, {
            headers: { 'Accept': 'application/json' },
            cache: 'no-store'
        });
        if (!res.ok) {
            console.warn('scan-feed fetch failed:', res.status);
            return;
        }
        const payload = await res.json();
        if (payload && payload.status === 'success' && payload.data && Array.isArray(payload.data.scans)) {
            scanFeedCache = payload.data.scans;
        }
    } catch (err) {
        console.warn('scan-feed fetch error:', err);
    }
}

// Build a display string "H:MM AM/PM" from a scanned_at timestamp like
// "2026-09-20 01:26:32". This is what makes the displayed AM/PM always
// match the physical moment the tap happened.
function labelFromScannedAt(scannedAt) {
    if (!scannedAt) return '';
    try {
        // Turn "YYYY-MM-DD HH:MM:SS" into an ISO string the Date parser likes.
        const iso = String(scannedAt).replace(' ', 'T');
        const d = new Date(iso);
        if (isNaN(d.getTime())) return '';
        return d.toLocaleTimeString('en-PH', {
            hour: '2-digit',
            minute: '2-digit',
            hour12: true
        });
    } catch {
        return '';
    }
}

// Given an RFID, walk the scan feed (today only), keep the FIRST tap of each
// scan_type, and return { am_in, am_out, pm_in, pm_out } strings ready to be
// dropped straight into the profile cards.
function extractTimesFromFeed(rfid, todayLocalDate) {
    const result = { am_in: '', am_out: '', pm_in: '', pm_out: '' };
    if (!rfid || !Array.isArray(scanFeedCache) || scanFeedCache.length === 0) {
        return result;
    }

    // The feed is newest-first (inserted at index 0), so reverse to process
    // chronologically and grab the earliest tap of each type.
    const chronological = [...scanFeedCache].reverse();

    for (const entry of chronological) {
        if (!entry) continue;
        if (String(entry.rfid || '').toUpperCase() !== String(rfid).toUpperCase()) continue;

        // Only consider taps that belong to today (compare on the calendar
        // date portion of scanned_at, falling back to scanned_on).
        const scannedAt = entry.scanned_at || '';
        const datePart = scannedAt ? String(scannedAt).slice(0, 10) : (entry.scanned_on || '');
        if (todayLocalDate && datePart && datePart !== todayLocalDate) continue;

        const type = String(entry.scan_type || '').toLowerCase();
        if (!type) continue;

        // Keep the first tap of each type only.
        if (type === 'am_in'  && !result.am_in)  result.am_in  = labelFromScannedAt(scannedAt);
        if (type === 'am_out' && !result.am_out) result.am_out = labelFromScannedAt(scannedAt);
        if (type === 'pm_in'  && !result.pm_in)  result.pm_in  = labelFromScannedAt(scannedAt);
        if (type === 'pm_out' && !result.pm_out) result.pm_out = labelFromScannedAt(scannedAt);
    }

    return result;
}

// Return today's date as "YYYY-MM-DD" in the user's local timezone.
function getLocalTodayString() {
    const d = new Date();
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
}

function render(data) {
    currentData = data;
    const isFound = data.found === true;
    const hasEmployee = data.employee !== null && data.employee !== undefined;

    if (data.scanned_at) {
        scannedAt.textContent = formatDate(data.scanned_at);
    } else {
        scannedAt.textContent = 'Waiting for scan...';
    }

    lastUpdated.textContent = 'Updated: ' + new Date().toLocaleTimeString('en-PH', { hour12: true });

    const rfidChanged = (data.rfid !== currentRfid);
    const stateChanged = (isFound && hasEmployee) !== employeeCard.classList.contains('visible');
    const attendanceSignature = JSON.stringify(data.attendance || null);
    const attendanceChanged = attendanceSignature !== lastAttendanceSignature;

    if (rfidChanged || stateChanged || attendanceChanged || isFirstLoad) {
        currentRfid = data.rfid;
        lastAttendanceSignature = attendanceSignature;

        if (isFound && hasEmployee) {
            // Pull AM/PM times from the scan feed for this employee's card.
            const today = getLocalTodayString();
            const feedTimes = extractTimesFromFeed(data.employee.rfid, today);
            renderEmployee(data.employee, data.attendance, feedTimes);
            employeeCard.classList.add('visible');
            noData.style.display = 'none';
        } else if (data.rfid && !isFound) {
            renderUnknownEmployee(data.rfid, data.scanned_at);
            employeeCard.classList.add('visible');
            noData.style.display = 'none';
        } else {
            employeeCard.classList.remove('visible');
            noData.style.display = 'flex';
        }

        if (isFound && hasEmployee) {
            statusDot.className = 'status-dot online';
            statusText.textContent = 'Employee registered';
        } else if (data.rfid && !isFound) {
            statusDot.className = 'status-dot unknown';
            statusText.textContent = 'Employee not registered';
        } else {
            statusDot.className = 'status-dot offline';
            statusText.textContent = 'Waiting for scan';
        }

        isFirstLoad = false;
    }
}

function renderEmployee(emp, attendance, feedTimes) {
    const fullname = (emp.firstname || '') + ' ' + (emp.lastname || '');
    const initials = getInitials(emp.firstname, emp.lastname);
    const role = emp.role || 'employee';
    const roleLabel = role.charAt(0).toUpperCase() + role.slice(1);
    const scannedTime = currentData.scanned_at ? formatTimeFromISO(currentData.scanned_at) : '--';
    const currentTime = getCurrentTime();
    const imageUrl = getImageUrl(emp.image);

    // Prefer the AM/PM time-in and time-out values that came straight from
    // the scan feed (labels built from the actual scanned_at timestamps).
    // If the feed has nothing for a slot yet, fall back to the DTR value
    // formatted with the field's own period context.
    feedTimes = feedTimes || {};

    const amIn  = feedTimes.am_in  || (attendance && attendance.am_in  ? formatDtrTimeForDisplay(attendance.am_in,  'am') : '--');
    const amOut = feedTimes.am_out || (attendance && attendance.am_out ? formatDtrTimeForDisplay(attendance.am_out, 'am') : '--');
    const pmIn  = feedTimes.pm_in  || (attendance && attendance.pm_in  ? formatDtrTimeForDisplay(attendance.pm_in,  'pm') : '--');
    const pmOut = feedTimes.pm_out || (attendance && attendance.pm_out ? formatDtrTimeForDisplay(attendance.pm_out, 'pm') : '--');
    const status = attendance && attendance.status ? attendance.status : '';

    // Ensure empty feed slots show the placeholder instead of an empty string.
    const amInDisplay  = amIn  || '--';
    const amOutDisplay = amOut || '--';
    const pmInDisplay  = pmIn  || '--';
    const pmOutDisplay = pmOut || '--';

    // Build status badge if on leave
    let statusBadge = '';
    if (status === 'on_leave') {
        statusBadge = `<span class="status-badge leave">On Leave</span>`;
    }

    const currentHtml = employeeCard.innerHTML;
    const newHtml = `
        <div class="profile-section">
            <div class="profile-avatar">
                ${imageUrl ? `<img src="${imageUrl}" alt="${fullname}" onerror="this.style.display='none';this.parentElement.textContent='${initials}';">` : `<span class="initials-text">${initials}</span>`}
            </div>
            <div class="profile-info">
                <div class="fullname">${fullname || 'Unknown'}</div>
                <span class="role-badge">${roleLabel}</span>
                ${statusBadge}
                <div class="id-row">
                    <span>
                        <span class="label">Employee ID:</span>
                        <span class="value">${emp.employeeid || 'N/A'}</span>
                    </span>
                    <span>
                        <span class="label">RFID:</span>
                        <span class="value">${emp.rfid || 'N/A'}</span>
                    </span>
                </div>
            </div>
        </div>
        <div class="time-section">
            <div class="time-row">
                <div class="time-item">
                    <div class="label">AM Time In</div>
                    <div class="value clock-in" id="amTimeIn">${amInDisplay}</div>
                </div>
                <div class="time-item">
                    <div class="label">AM Time Out</div>
                    <div class="value clock-out" id="amTimeOut">${amOutDisplay}</div>
                </div>
            </div>
            <div class="time-row">
                <div class="time-item">
                    <div class="label">PM Time In</div>
                    <div class="value clock-in" id="pmTimeIn">${pmInDisplay}</div>
                </div>
                <div class="time-item">
                    <div class="label">PM Time Out</div>
                    <div class="value clock-out" id="pmTimeOut">${pmOutDisplay}</div>
                </div>
            </div>
            <div class="time-row">
                <div class="time-item">
                    <div class="label">Current Time</div>
                    <div class="value live-time" id="currentTimeDisplay">${currentTime}</div>
                </div>
                <div class="time-item">
                    <div class="label">Last Scan</div>
                    <div class="value" id="lastScanTime">${scannedTime}</div>
                </div>
            </div>
        </div>
    `;

    if (currentHtml !== newHtml) {
        employeeCard.innerHTML = newHtml;
    } else {
        // Update only the time values
        const amInElem = document.getElementById('amTimeIn');
        const amOutElem = document.getElementById('amTimeOut');
        const pmInElem = document.getElementById('pmTimeIn');
        const pmOutElem = document.getElementById('pmTimeOut');
        const currentTimeElem = document.getElementById('currentTimeDisplay');
        const lastScanElem = document.getElementById('lastScanTime');

        if (amInElem) amInElem.textContent = amInDisplay;
        if (amOutElem) amOutElem.textContent = amOutDisplay;
        if (pmInElem) pmInElem.textContent = pmInDisplay;
        if (pmOutElem) pmOutElem.textContent = pmOutDisplay;
        if (lastScanElem) lastScanElem.textContent = scannedTime;
        if (currentTimeElem) currentTimeElem.textContent = currentTime;
    }

    // Keep current time updating
    const currentTimeDisplay = document.getElementById('currentTimeDisplay');
    if (currentTimeDisplay) {
        if (window._timeInterval) {
            clearInterval(window._timeInterval);
        }
        window._timeInterval = setInterval(() => {
            const elem = document.getElementById('currentTimeDisplay');
            if (elem) elem.textContent = getCurrentTime();
        }, 1000);
    }
}

function renderUnknownEmployee(rfid, scannedAtTime) {
    const scannedTime = scannedAtTime ? formatTimeFromISO(scannedAtTime) : '--';
    const currentTime = getCurrentTime();

    const currentHtml = employeeCard.innerHTML;
    const newHtml = `
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
                        <span class="value unknown-value">${rfid || 'N/A'}</span>
                    </span>
                </div>
            </div>
        </div>
        <div class="time-section">
            <div class="time-row">
                <div class="time-item">
                    <div class="label">AM Time In</div>
                    <div class="value clock-in" id="amTimeInUnknown">--</div>
                </div>
                <div class="time-item">
                    <div class="label">AM Time Out</div>
                    <div class="value clock-out" id="amTimeOutUnknown">--</div>
                </div>
            </div>
            <div class="time-row">
                <div class="time-item">
                    <div class="label">PM Time In</div>
                    <div class="value clock-in" id="pmTimeInUnknown">--</div>
                </div>
                <div class="time-item">
                    <div class="label">PM Time Out</div>
                    <div class="value clock-out" id="pmTimeOutUnknown">--</div>
                </div>
            </div>
            <div class="time-row">
                <div class="time-item">
                    <div class="label">Current Time</div>
                    <div class="value live-time" id="currentTimeDisplayUnknown">${currentTime}</div>
                </div>
                <div class="time-item">
                    <div class="label">Last Scan</div>
                    <div class="value" id="lastScanTimeUnknown">${scannedTime}</div>
                </div>
            </div>
        </div>
    `;

    if (currentHtml !== newHtml) {
        employeeCard.innerHTML = newHtml;
    } else {
        const lastScanElem = document.getElementById('lastScanTimeUnknown');
        const currentTimeElem = document.getElementById('currentTimeDisplayUnknown');
        if (lastScanElem) lastScanElem.textContent = scannedTime;
        if (currentTimeElem) currentTimeElem.textContent = currentTime;
    }

    const currentTimeDisplay = document.getElementById('currentTimeDisplayUnknown');
    if (currentTimeDisplay) {
        if (window._timeInterval) {
            clearInterval(window._timeInterval);
        }
        window._timeInterval = setInterval(() => {
            const elem = document.getElementById('currentTimeDisplayUnknown');
            if (elem) elem.textContent = getCurrentTime();
        }, 1000);
    }
}

async function fetchData() {
    try {
        // Refresh the scan feed cache alongside the profile data so the
        // AM/PM times are always in sync with the latest taps.
        await fetchScanFeed();

        const response = await fetch(API_URL, {
            headers: { 'Accept': 'application/json' }
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const data = await response.json();
        console.log('API Response:', data); // Debug log

        if (data.status === 'success') {
            render(data);
        } else {
            console.warn('API returned non-success status:', data);
        }
    } catch (error) {
        console.error('Fetch error:', error);
        statusDot.className = 'status-dot offline';
        statusText.textContent = 'Connection error';
        if (isFirstLoad) {
            scannedAt.textContent = 'Unable to connect to server';
        }
    }
}

// Auto-clear the profile display at 12:00 AM (midnight) so the screen
// resets to the "Waiting for scan" state when a new day begins.
let lastClearedDate = null;

function checkMidnightClear() {
    const now = new Date();
    const today = now.toDateString();
    if (lastClearedDate === today) {
        return;
    }
    lastClearedDate = today;
    currentRfid = null;
    lastAttendanceSignature = '';
    currentData = null;
    if (employeeCard) {
        employeeCard.classList.remove('visible');
        employeeCard.innerHTML = '';
    }
    if (noData) {
        noData.style.display = 'flex';
    }
    if (scannedAt) {
        scannedAt.textContent = 'Waiting for scan...';
    }
    if (statusDot) {
        statusDot.className = 'status-dot offline';
    }
    if (statusText) {
        statusText.textContent = 'Waiting for scan';
    }
    if (lastUpdated) {
        lastUpdated.textContent = 'Updated: ' + now.toLocaleTimeString('en-PH', { hour12: true });
    }
    console.log('[Midnight] Profile display auto-cleared for new day.');
}

function startPolling() {
    loadLogo();
    loadProfileIcon();
    fetchVersion(); // Fetch version once when page loads
    checkMidnightClear();
    fetchData();
    setInterval(fetchData, POLL_INTERVAL);
    // Check for midnight every minute so the clear happens promptly at 12:00 AM.
    setInterval(checkMidnightClear, 60000);
}

document.addEventListener('DOMContentLoaded', startPolling);

document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
        fetchData();
    }
});