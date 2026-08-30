// Use Railway API by default
const dashboardApiBaseUrl = window.TAPIN_API_URL || 'https://tapin-api.up.railway.app';

function redirectToLogin() {
    localStorage.removeItem('tapinUser');
    localStorage.removeItem('tapinToken');
    window.location.replace('../login.html');
}

function getAuthHeaders() {
    const token = localStorage.getItem('tapinToken');
    return {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
    };
}

function updateUserDisplay(user) {
    const name = document.getElementById('dashboardUserName');
    const role = document.getElementById('dashboardUserRole');
    if (name) name.textContent = user.fullname || user.username || 'User';
    if (role) role.textContent = (user.role || 'employee').toUpperCase();
}

function updateDeviceDisplay(devices) {
    const indicator = document.getElementById('readerStatusIndicator');
    const statusText = document.getElementById('readerStatusText');
    const online = devices.length > 0;

    if (indicator) {
        indicator.className = `status-indicator ${online ? 'status-online' : 'status-offline'}`;
    }
    if (statusText) {
        statusText.className = `status-text ${online ? 'text-online' : 'text-offline'}`;
        statusText.innerHTML = online
            ? '<i class="fa-solid fa-circle-check"></i> Online'
            : '<i class="fa-solid fa-circle-xmark"></i> Offline';
    }
}

function updateClock() {
    const now = new Date();
    const date = document.getElementById('dashboardDate');
    const time = document.getElementById('dashboardTime');
    if (date) date.textContent = now.toLocaleDateString(undefined, {
        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
    });
    if (time) time.textContent = now.toLocaleTimeString(undefined, {
        hour: '2-digit', minute: '2-digit', second: '2-digit', timeZoneName: 'short'
    });
}

function updateDashboardStatistics(stats) {
    const values = {
        statTotalEmployees: stats.total_employees,
        statPresentToday: stats.present_today,
        statAbsentToday: stats.absent_today,
        statEmployeesLate: stats.employees_late,
        statOnLeave: stats.on_leave,
        statAttendanceRate: `${stats.attendance_rate}%`,
        statRfidScans: stats.rfid_scans_today,
        statDepartments: stats.departments
    };
    Object.entries(values).forEach(([id, value]) => {
        const element = document.getElementById(id);
        if (element) element.textContent = value;
    });
}

function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>'"]/g, (character) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
    }[character]));
}

function initials(user) {
    return `${user.firstname || ''} ${user.lastname || ''}`.trim().split(/\s+/).map((part) => part[0] || '').join('').slice(0, 2).toUpperCase() || '--';
}

function updateEmployeeTable(users) {
    const body = document.getElementById('dashboardEmployeeBody');
    if (!body) return;
    body.innerHTML = users.map((user) => `<tr>
        <td><div class="emp-avatar" style="width:32px;height:32px;font-size:11px;">${escapeHtml(initials(user))}</div></td>
        <td><strong>${escapeHtml(user.employeeid || user.uid || '--')}</strong></td>
        <td><div class="emp-name">${escapeHtml(`${user.firstname || ''} ${user.lastname || ''}`.trim())}</div></td>
        <td>${escapeHtml(user.role || 'employee')}</td>
        <td>--</td>
        <td>${escapeHtml(user.email || '--')}</td>
        <td><span class="badge badge-approved">Registered</span></td>
        <td>--</td>
        <td><div class="table-actions"><button class="action-btn" title="View"><i class="fa-solid fa-eye"></i></button></div></td>
    </tr>`).join('') || '<tr><td colspan="9">No users registered.</td></tr>';
}

function updateScanTable(scans) {
    const body = document.getElementById('dashboardScanBody');
    if (!body) return;
    body.innerHTML = scans.slice(0, 10).map((scan) => {
        const employee = scan.employee;
        const name = employee ? `${employee.firstname || ''} ${employee.lastname || ''}`.trim() : 'Unknown card';
        return `<tr>
            <td><div class="emp-cell"><div class="emp-avatar">${escapeHtml(employee ? initials(employee) : '--')}</div><div><div class="emp-name">${escapeHtml(name)}</div><div class="emp-id">${escapeHtml(scan.rfid)}</div></div></div></td>
            <td>${escapeHtml(employee ? employee.role : 'Unregistered')}</td><td>${escapeHtml(scan.scanned_at)}</td><td>--</td>
            <td><span class="badge ${employee ? 'badge-present' : 'badge-absent'}"><span class="badge-dot"></span>${employee ? 'Recognized' : 'Unknown'}</span></td>
        </tr>`;
    }).join('') || '<tr><td colspan="5">No RFID scans received today.</td></tr>';
}

function updateAttendanceTable(scans) {
    const body = document.getElementById('dashboardAttendanceBody');
    if (!body) return;
    body.innerHTML = scans.slice(0, 20).map((scan) => {
        const employee = scan.employee;
        const name = employee ? `${employee.firstname || ''} ${employee.lastname || ''}`.trim() : 'Unknown card';
        return `<tr><td><strong>${escapeHtml(employee ? employee.employeeid || employee.uid : '--')}</strong></td><td>${escapeHtml(name)}</td><td>${escapeHtml(employee ? employee.role : 'Unregistered')}</td><td>--</td><td><code>${escapeHtml(scan.rfid)}</code></td><td>${escapeHtml(scan.scanned_at)}</td><td>--</td><td><span class="badge ${employee ? 'badge-present' : 'badge-absent'}"><span class="badge-dot"></span>${employee ? 'Present' : 'Unknown'}</span></td><td>RFID device</td><td>Live scan</td></tr>`;
    }).join('') || '<tr><td colspan="10">No RFID scans received.</td></tr>';
}

async function loadDashboardData() {
    try {
        const response = await fetch(`${dashboardApiBaseUrl}/api/dashboard-data`, {
            method: 'GET',
            headers: getAuthHeaders(),
            credentials: 'include',
            cache: 'no-store'
        });
        if (response.status === 401) {
            redirectToLogin();
            return;
        }
        if (!response.ok) throw new Error('Dashboard data unavailable');

        const result = await response.json();
        const data = result.data || {};
        updateDashboardStatistics(data.stats || {});
        updateEmployeeTable(data.users || []);
        updateScanTable(data.scans || []);
        updateAttendanceTable(data.scans || []);
        updateDeviceDisplay(data.devices || []);

        const latestScanTime = document.getElementById('latestScanTime');
        if (latestScanTime) {
            const latest = data.latest_scan;
            latestScanTime.textContent = latest
                ? `${latest.scanned_at}${latest.employee ? ` - ${latest.employee.firstname} ${latest.employee.lastname}` : ''}`
                : 'No scan received';
        }
    } catch (error) {
        updateDeviceDisplay([]);
    }
}

async function verifyDashboardSession() {
    const token = localStorage.getItem('tapinToken');
    if (!token) {
        redirectToLogin();
        return;
    }
    
    try {
        const response = await fetch(`${dashboardApiBaseUrl}/api/verify-token`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            credentials: 'include',
            cache: 'no-store'
        });
        if (!response.ok) {
            redirectToLogin();
            return;
        }
        const data = await response.json();
        updateUserDisplay(data.user);
        await loadDashboardData();
    } catch (error) {
        redirectToLogin();
    }
}

const logoutLink = document.getElementById('tapinLogout');
if (logoutLink) {
    logoutLink.addEventListener('click', async (event) => {
        event.preventDefault();
        try {
            await fetch(`${dashboardApiBaseUrl}/api/logout`, {
                method: 'POST',
                headers: getAuthHeaders(),
                credentials: 'include'
            });
        } finally {
            localStorage.removeItem('tapinToken');
            localStorage.removeItem('tapinUser');
            window.location.replace('../login.html');
        }
    });
}

history.replaceState({ dashboard: true }, '', window.location.href);
window.addEventListener('popstate', () => {
    history.pushState({ dashboard: true }, '', window.location.href);
});
window.addEventListener('pageshow', verifyDashboardSession);
setInterval(updateClock, 1000);
setInterval(loadDashboardData, 5000);
updateClock();
verifyDashboardSession();