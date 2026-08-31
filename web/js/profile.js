const API_BASE_URL = 'https://tapin-api.up.railway.app';
const API_URL = `${API_BASE_URL}/api/get-latest-rfid`;
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
let versionData = null;

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

function formatTime(isoString) {
    if (!isoString) return '--';
    try {
        const d = new Date(isoString);
        return d.toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit', hour12: true });
    } catch {
        return isoString;
    }
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

    if (rfidChanged || stateChanged || isFirstLoad) {
        currentRfid = data.rfid;

        if (isFound && hasEmployee) {
            renderEmployee(data.employee, data.attendance);
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

function renderEmployee(emp, attendance) {
    const fullname = (emp.firstname || '') + ' ' + (emp.lastname || '');
    const initials = getInitials(emp.firstname, emp.lastname);
    const role = emp.role || 'employee';
    const roleLabel = role.charAt(0).toUpperCase() + role.slice(1);
    const scannedTime = currentData.scanned_at ? formatTime(currentData.scanned_at) : '--';
    const currentTime = getCurrentTime();
    const imageUrl = getImageUrl(emp.image);
    
    const amIn = attendance && attendance.am_in ? attendance.am_in : '--';
    const amOut = attendance && attendance.am_out ? attendance.am_out : '--';
    const pmIn = attendance && attendance.pm_in ? attendance.pm_in : '--';
    const pmOut = attendance && attendance.pm_out ? attendance.pm_out : '--';

    const currentHtml = employeeCard.innerHTML;
    const newHtml = `
        <div class="profile-section">
            <div class="profile-avatar">
                ${imageUrl ? `<img src="${imageUrl}" alt="${fullname}" onerror="this.style.display='none';this.parentElement.textContent='${initials}';">` : `<span class="initials-text">${initials}</span>`}
            </div>
            <div class="profile-info">
                <div class="fullname">${fullname || 'Unknown'}</div>
                <span class="role-badge">${roleLabel}</span>
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
                    <div class="value clock-in" id="amTimeIn">${amIn}</div>
                </div>
                <div class="time-item">
                    <div class="label">AM Time Out</div>
                    <div class="value clock-out" id="amTimeOut">${amOut}</div>
                </div>
            </div>
            <div class="time-row">
                <div class="time-item">
                    <div class="label">PM Time In</div>
                    <div class="value clock-in" id="pmTimeIn">${pmIn}</div>
                </div>
                <div class="time-item">
                    <div class="label">PM Time Out</div>
                    <div class="value clock-out" id="pmTimeOut">${pmOut}</div>
                </div>
            </div>
            <div class="time-row">
                <div class="time-item">
                    <div class="label">Current Time</div>
                    <div class="value" id="currentTimeDisplay">${currentTime}</div>
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
        const amInElem = document.getElementById('amTimeIn');
        const amOutElem = document.getElementById('amTimeOut');
        const pmInElem = document.getElementById('pmTimeIn');
        const pmOutElem = document.getElementById('pmTimeOut');
        const currentTimeElem = document.getElementById('currentTimeDisplay');
        const lastScanElem = document.getElementById('lastScanTime');
        
        if (amInElem) amInElem.textContent = amIn;
        if (amOutElem) amOutElem.textContent = amOut;
        if (pmInElem) pmInElem.textContent = pmIn;
        if (pmOutElem) pmOutElem.textContent = pmOut;
        if (lastScanElem) lastScanElem.textContent = scannedTime;
        if (currentTimeElem) currentTimeElem.textContent = currentTime;
    }

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
    const scannedTime = scannedAtTime ? formatTime(scannedAtTime) : '--';
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
                    <div class="value" id="currentTimeDisplayUnknown">${currentTime}</div>
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
        const response = await fetch(API_URL, {
            headers: { 'Accept': 'application/json' }
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const data = await response.json();

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

function startPolling() {
    loadLogo();
    loadProfileIcon();
    fetchVersion(); // Fetch version once when page loads
    fetchData();
    setInterval(fetchData, POLL_INTERVAL);
}

document.addEventListener('DOMContentLoaded', startPolling);

document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
        fetchData();
    }
});