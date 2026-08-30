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
    const name = document.getElementById('employeeUserName');
    const role = document.getElementById('employeeUserRole');
    const empId = document.getElementById('employeeId');
    if (name) name.textContent = user.fullname || user.username || 'User';
    if (role) role.textContent = (user.role || 'employee').toUpperCase();
    if (empId) empId.textContent = user.employeeid || user.uid || '--';
}

function updateClock() {
    const now = new Date();
    const date = document.getElementById('employeeDate');
    const time = document.getElementById('employeeTime');
    if (date) date.textContent = now.toLocaleDateString(undefined, {
        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
    });
    if (time) time.textContent = now.toLocaleTimeString(undefined, {
        hour: '2-digit', minute: '2-digit', second: '2-digit', timeZoneName: 'short'
    });
}

function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>'"]/g, (character) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
    }[character]));
}

function updateAttendanceSummary(records) {
    const today = new Date().toISOString().split('T')[0];
    let todayStatus = 'Not logged in';
    let todayHours = '0.00';
    
    for (const record of records) {
        for (const day of record.working_days || []) {
            if (day.date === today) {
                if (day.am_in || day.pm_in) {
                    todayStatus = 'Present';
                }
                todayHours = day.hours || '0.00';
                break;
            }
        }
    }
    
    const statusElement = document.getElementById('todayStatus');
    const hoursElement = document.getElementById('todayHours');
    if (statusElement) statusElement.textContent = todayStatus;
    if (hoursElement) hoursElement.textContent = `${todayHours} hrs`;
}

function updateMonthlyAttendance(records) {
    const body = document.getElementById('employeeAttendanceBody');
    if (!body) return;
    
    const currentMonth = new Date().getMonth();
    const currentYear = new Date().getFullYear();
    const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
    
    let html = '';
    for (let day = 1; day <= daysInMonth; day++) {
        const dateStr = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        const dayOfWeek = new Date(currentYear, currentMonth, day).toLocaleDateString(undefined, { weekday: 'short' });
        let amIn = '--', amOut = '--', pmIn = '--', pmOut = '--', hours = '0.00';
        
        for (const record of records) {
            for (const dayData of record.working_days || []) {
                if (dayData.date === dateStr) {
                    amIn = dayData.am_in || '--';
                    amOut = dayData.am_out || '--';
                    pmIn = dayData.pm_in || '--';
                    pmOut = dayData.pm_out || '--';
                    hours = dayData.hours || '0.00';
                    break;
                }
            }
        }
        
        html += `<tr>
            <td>${dateStr}</td>
            <td>${dayOfWeek}</td>
            <td>${amIn}</td>
            <td>${amOut}</td>
            <td>${pmIn}</td>
            <td>${pmOut}</td>
            <td>${hours}</td>
        </tr>`;
    }
    
    body.innerHTML = html;
}

async function loadEmployeeDashboardData() {
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
        
        // Get current user's records
        const user = JSON.parse(localStorage.getItem('tapinUser') || '{}');
        const userRecords = (data.attendance || []).filter(record => 
            record.uid === user.uid || record.employeeid === user.employeeid
        );
        
        updateAttendanceSummary(userRecords);
        updateMonthlyAttendance(userRecords);
    } catch (error) {
        console.error('Error loading employee dashboard:', error);
    }
}

async function verifyEmployeeDashboardSession() {
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
        await loadEmployeeDashboardData();
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
window.addEventListener('pageshow', verifyEmployeeDashboardSession);
setInterval(updateClock, 1000);
setInterval(loadEmployeeDashboardData, 5000);
updateClock();
verifyEmployeeDashboardSession();