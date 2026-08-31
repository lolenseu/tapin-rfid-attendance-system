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

const sidebar = document.querySelector('.sidebar');
const sidebarToggle = document.getElementById('sidebarToggle');
const sidebarOverlay = document.getElementById('sidebarOverlay');
const logoutLink = document.getElementById('tapinLogout');
const logoutModal = document.getElementById('logoutConfirmModal');
const logoutConfirmYes = document.getElementById('logoutConfirmYes');
const logoutConfirmCancel = document.getElementById('logoutConfirmCancel');

function setSidebarState(isOpen) {
    const isMobile = window.innerWidth <= 768;
    document.body.classList.toggle('sidebar-collapsed', !isOpen && !isMobile);

    if (sidebar) {
        sidebar.classList.toggle('is-open', isMobile ? isOpen : true);
    }

    if (sidebarToggle) {
        sidebarToggle.classList.toggle('is-open', isOpen);
        sidebarToggle.setAttribute('aria-expanded', String(isOpen));
    }

    if (sidebarOverlay) {
        sidebarOverlay.classList.toggle('visible', isMobile && isOpen);
    }
}

if (sidebarToggle) {
    sidebarToggle.addEventListener('click', (e) => {
        e.stopPropagation();
        const isMobile = window.innerWidth <= 768;
        if (isMobile) {
            const nextOpenState = !sidebar?.classList.contains('is-open');
            setSidebarState(nextOpenState);
            return;
        }

        const isCollapsed = document.body.classList.contains('sidebar-collapsed');
        // if collapsed -> open (true), otherwise collapse (false)
        setSidebarState(isCollapsed);
    });
}

if (sidebarOverlay) {
    sidebarOverlay.addEventListener('click', () => setSidebarState(false));
}

window.addEventListener('resize', () => {
    if (window.innerWidth > 768) {
        document.body.classList.remove('sidebar-collapsed');
        if (sidebar) sidebar.classList.remove('is-open');
        if (sidebarToggle) {
            sidebarToggle.classList.remove('is-open');
            sidebarToggle.setAttribute('aria-expanded', 'true');
        }
        if (sidebarOverlay) sidebarOverlay.classList.remove('visible');
    } else {
        setSidebarState(false);
    }
});

setSidebarState(true);

// Sidebar nav: toggle active class when clicking items so the blue icon box updates
document.querySelectorAll('.sidebar .nav-item').forEach((navItem) => {
    navItem.addEventListener('click', (e) => {
        // if it's an anchor with a hash, update header, active state, and scroll explicitly
        const href = navItem.getAttribute('href');
        document.querySelectorAll('.sidebar .nav-item').forEach((n) => n.classList.remove('active'));
        navItem.classList.add('active');
        if (href && href.startsWith('#')) {
            e.preventDefault();
            // smooth scroll to section
            scrollToSection(href);
            // update the URL hash without causing a page jump event
            // Use pushState so the click creates a history entry instead of replacing the current one
            try { history.pushState(null, '', href); } catch (err) { location.hash = href; }
        }
    });
});

// Page header mapping for sidebar links (update breadcrumb, title, subtitle)
const pageHeaderMap = {
    '#dashboard': {
        breadcrumb: 'Dashboard',
        title: 'Dashboard Overview',
        subtitle: 'Real-time attendance statistics and system activities.'
    },
    '#employees': {
        breadcrumb: 'IPO — Employees Personal Info',
        title: 'Employee Directory',
        subtitle: 'Manage employee personal information and records.'
    },
    '#employee-list': {
        breadcrumb: 'IPO — Employees Personal Info',
        title: 'Employee List',
        subtitle: 'Browse and search registered employees.'
    },
    '#dtr': {
        breadcrumb: 'IPO — Employees Personal Info',
        title: 'DTR CSC Form',
        subtitle: 'Daily time record forms and employee time logs.'
    },
    '#realtime': {
        breadcrumb: 'Monitoring',
        title: 'Realtime Employee Dashboard',
        subtitle: 'Live RFID scans and activity timeline.'
    },
    '#admin-dashboard': {
        breadcrumb: 'Monitoring',
        title: 'Admin / HR Dashboard',
        subtitle: 'Administrative overview and HR actions.'
    },
    '#introduction': {
        breadcrumb: 'Information',
        title: 'Introduction',
        subtitle: 'Overview and background information.'
    },
    '#iot-attendance': {
        breadcrumb: 'Information',
        title: 'IoT-Based Attendance',
        subtitle: 'Attendance captured via IoT devices.'
    },
    '#reports': {
        breadcrumb: 'HR Documents',
        title: 'Reports',
        subtitle: 'Generate and export attendance reports.'
    },
    '#settings': {
        breadcrumb: 'Settings',
        title: 'Application Settings',
        subtitle: 'Manage application preferences and integrations.'
    },
    '#profile': {
        breadcrumb: 'Profile',
        title: 'User Profile',
        subtitle: 'View and edit your profile details.'
    }
};

function updatePageHeaderForHash(hash) {
    const info = pageHeaderMap[hash] || pageHeaderMap['#dashboard'];
    // Prefer the global header elements if present
    // Target the global breadcrumb/title/subtitle elements (per-section breadcrumbs removed)
    const bc = document.querySelector('.global-section-actions .breadcrumb') || document.querySelector('.breadcrumb');
    const title = document.querySelector('.global-section-actions .section-title') || document.querySelector('.section-title');
    const subtitle = document.querySelector('.global-section-actions .section-subtitle') || document.querySelector('.section-subtitle');
    if (bc) bc.textContent = info.breadcrumb;
    if (title) title.textContent = info.title;
    if (subtitle) subtitle.textContent = info.subtitle;
}

// Note: header is intentionally kept fixed to Dashboard Overview; do not update it on nav clicks.

// Keep header and active nav in sync on load and when the hash changes
function setActiveNavForHash(hash) {
    const normalized = hash || '#dashboard';
    document.querySelectorAll('.sidebar .nav-item').forEach((n) => {
        try {
            const href = n.getAttribute('href');
            n.classList.toggle('active', href === normalized);
        } catch (e) {}
    });
}

// Initialize header (fixed to dashboard) and active nav on page load
const initialHash = window.location.hash || '#dashboard';
// Keep the visible page header fixed to Dashboard Overview
updatePageHeaderForHash('#dashboard');
setActiveNavForHash(initialHash);

window.addEventListener('hashchange', () => {
    const h = window.location.hash || '#dashboard';
    // keep header fixed; only sync active nav
    setActiveNavForHash(h);
});

// Scroll to the section matching the hash so sections stack vertically
function scrollToSection(hash) {
    const normalized = hash || '#dashboard';
    const id = normalized.replace('#', '');
    const el = document.getElementById(id);
    if (el) {
        const topbar = document.querySelector('.topbar');
        const offset = (topbar ? topbar.offsetHeight : 0) + 8;
        const rect = el.getBoundingClientRect();
        const targetY = window.scrollY + rect.top - offset;
        window.scrollTo({ top: targetY, behavior: 'smooth' });
    } else {
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }
}

// Scroll to initial section on load
scrollToSection(initialHash);
window.addEventListener('hashchange', () => {
    const h = window.location.hash || '#dashboard';
    scrollToSection(h);
});

// Scrollspy: update sidebar active state and page header based on scroll position
(function setupScrollSpy() {
    const sections = Array.from(document.querySelectorAll('.page-section[id]'));
    if (!sections.length) return;

    let current = null;
    // Debounce to avoid rapid flicker when scrolling quickly between sections
    let pendingTimeout = null;
    let pendingHash = null;
    // Slightly increase stability window to reduce rapid flicker when scrolling quickly
    const STABILITY_MS = 200;

    const observer = new IntersectionObserver((entries) => {
        // choose the most visible intersecting section; fall back to nearest-to-top when none intersect
        const visible = entries.filter(e => e.isIntersecting).sort((a,b) => b.intersectionRatio - a.intersectionRatio);
        let id = null;
        if (visible.length > 0 && visible[0].intersectionRatio >= 0.12) {
            id = visible[0].target.id;
        } else {
            // Fallback heuristic: pick the section whose top is closest to the topbar offset
            const topbar = document.querySelector('.topbar');
            const offset = (topbar ? topbar.offsetHeight : 0) + 8;
            let closest = { idx: 0, dist: Infinity };
            sections.forEach((s, idx) => {
                const rectTop = s.getBoundingClientRect().top;
                const dist = Math.abs(rectTop - offset);
                if (dist < closest.dist) closest = { idx, dist };
            });
            if (sections[closest.idx]) id = sections[closest.idx].id;
        }

        if (!id) return;
        const hash = `#${id}`;
        // If already current, nothing to do
        if (current === hash) return;

        // debounce updates: require the same candidate to be present for STABILITY_MS
        pendingHash = hash;
        if (pendingTimeout) clearTimeout(pendingTimeout);
        pendingTimeout = setTimeout(() => {
            // only apply if pendingHash still matches (no newer candidate)
                if (pendingHash === hash) {
                current = hash;
                // keep header fixed; only update active nav state on scroll
                setActiveNavForHash(hash);
            }
            pendingTimeout = null;
        }, STABILITY_MS);
    }, { root: null, rootMargin: '0px 0px -35% 0px', threshold: [0.1, 0.25, 0.5, 0.75] });

    sections.forEach(s => observer.observe(s));
})();

function openLogoutModal() {
    if (logoutModal) logoutModal.classList.remove('hidden');
}

function closeLogoutModal() {
    if (logoutModal) logoutModal.classList.add('hidden');
}

if (logoutLink) {
    logoutLink.addEventListener('click', (event) => {
        event.preventDefault();
        openLogoutModal();
    });
}

if (logoutConfirmCancel) {
    logoutConfirmCancel.addEventListener('click', closeLogoutModal);
}

if (logoutModal) {
    logoutModal.addEventListener('click', (event) => {
        if (event.target === logoutModal) closeLogoutModal();
    });
}

if (logoutConfirmYes) {
    logoutConfirmYes.addEventListener('click', async () => {
        closeLogoutModal();
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

window.addEventListener('pageshow', verifyDashboardSession);
setInterval(updateClock, 1000);
setInterval(loadDashboardData, 5000);
updateClock();
// Collapse employee cards to first 5 with a "View more" toggle
function setupEmployeeCardCollapse() {
    const grid = document.querySelector('.employees-grid');
    if (!grid) return;
    const cards = Array.from(grid.querySelectorAll('.emp-card'));
    const MAX_VISIBLE = 5;
    if (cards.length <= MAX_VISIBLE) return;
    // hide cards beyond MAX_VISIBLE
    cards.forEach((c, i) => { if (i >= MAX_VISIBLE) c.style.display = 'none'; });

    // create footer toggle
    const footer = document.createElement('div');
    footer.className = 'emp-grid-footer';
    footer.style.textAlign = 'center';
    footer.style.marginTop = '12px';
    const btn = document.createElement('button');
    btn.className = 'btn btn-outline emp-toggle-btn';
    btn.type = 'button';
    btn.textContent = `View more (${cards.length - MAX_VISIBLE})`;
    btn.setAttribute('data-expanded', 'false');
    btn.addEventListener('click', () => {
        const expanded = btn.getAttribute('data-expanded') === 'true';
        if (!expanded) {
            cards.forEach((c) => c.style.display = '');
            btn.textContent = 'View less';
            btn.setAttribute('data-expanded', 'true');
        } else {
            cards.forEach((c, idx) => { if (idx >= MAX_VISIBLE) c.style.display = 'none'; });
            btn.textContent = `View more (${cards.length - MAX_VISIBLE})`;
            btn.setAttribute('data-expanded', 'false');
            // bring grid into view
            grid.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
    });
    footer.appendChild(btn);
    grid.parentNode.insertBefore(footer, grid.nextSibling);
}

setupEmployeeCardCollapse();
verifyDashboardSession();