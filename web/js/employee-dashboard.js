const dashboardApiBaseUrl = (window.TAPIN_API_URL || '').replace(/\/+$/, '');

let currentUser = null;
let allEmployees = [];
let myLeaveRequests = [];
let dtrMonthsLoaded = false;

/* ---------------- AUTH / SESSION ---------------- */

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

function initialsOf(u) {
  return `${u.firstname || ''} ${u.lastname || ''}`
    .trim().split(/\s+/).map(p => p[0] || '').join('').slice(0, 2).toUpperCase() || '--';
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  }[c]));
}

// Format a date value (e.g. "2026-09-01", with or without a time suffix, or
// a Date) into the DTR "D - Mon" style (e.g. "1 - Sep"). Works for any
// month/year — nothing here is hard-coded to a specific month.
const DTR_MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function formatDTRDate(value) {
  if (!value && value !== 0) return '';
  const isoMatch = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) {
    const day = parseInt(isoMatch[3], 10);
    const monthIndex = parseInt(isoMatch[2], 10) - 1;
    const monthAbbr = DTR_MONTH_ABBR[monthIndex] || '';
    return monthAbbr ? `${day} - ${monthAbbr}` : String(value);
  }
  if (value instanceof Date && !isNaN(value.getTime())) {
    return `${value.getDate()} - ${DTR_MONTH_ABBR[value.getMonth()]}`;
  }
  return String(value);
}

// Format a date value into short "M/D/YY" style used in the DTR header
// (e.g. "9/1/26"), no leading zeros.
function formatDTRHeaderDate(value) {
  if (!value && value !== 0) return '';
  let isoMatch = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) {
    const year = isoMatch[1].slice(-2);
    const month = parseInt(isoMatch[2], 10);
    const day = parseInt(isoMatch[3], 10);
    return `${month}/${day}/${year}`;
  }
  let shortMatch = String(value).match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (shortMatch) {
    const month = parseInt(shortMatch[1], 10);
    const day = parseInt(shortMatch[2], 10);
    const year = shortMatch[3].length > 2 ? shortMatch[3].slice(-2) : shortMatch[3];
    return `${month}/${day}/${year}`;
  }
  if (value instanceof Date && !isNaN(value.getTime())) {
    return `${value.getMonth() + 1}/${value.getDate()}/${String(value.getFullYear()).slice(-2)}`;
  }
  return String(value);
}

// Work out the "From : To :" range for the DTR header — prefers the
// record's own from_date/to_date, falls back to the first/last day actually
// present in the dtr rows, and only falls back to today's calendar month if
// neither is available. Works for any month, not just the current one.
function resolveDTRDateRange(record, dtr) {
  let from = record && record.from_date;
  let to = record && record.to_date;
  if (!from && dtr && dtr.length) from = dtr[0].date;
  if (!to && dtr && dtr.length) to = dtr[dtr.length - 1].date;
  if (!from || !to) {
    const now = new Date();
    const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
    const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    from = from || firstDay;
    to = to || lastDay;
  }
  return { from: formatDTRHeaderDate(from), to: formatDTRHeaderDate(to) };
}

// Resolve a complete employee info object for the DTR by combining whatever
// /api/dtr/record returned with the logged-in user's own profile — so the
// printed name/position/department never falls back to "Unknown".
function resolveMyEmployeeInfo(currentUser, apiEmployee) {
  apiEmployee = apiEmployee || {};
  currentUser = currentUser || {};
  const apiFullname = apiEmployee.fullname
    || `${apiEmployee.firstname || ''} ${apiEmployee.lastname || ''}`.trim();
  const userFullname = currentUser.fullname
    || `${currentUser.firstname || ''} ${currentUser.lastname || ''}`.trim();

  return {
    fullname: apiFullname || userFullname || 'Unknown',
    firstname: apiEmployee.firstname || currentUser.firstname || '',
    lastname: apiEmployee.lastname || currentUser.lastname || '',
    employeeid: apiEmployee.employeeid || currentUser.employeeid || currentUser.uid || '',
    position: apiEmployee.position || currentUser.position || '',
    department: apiEmployee.department || currentUser.department || '',
    role: apiEmployee.role || currentUser.role || 'employee',
    regularTime: apiEmployee.regular_time || apiEmployee.regularTime || 'DEFAULT'
  };
}

function updateUserDisplay(user) {
  if (!user) return;
  const name = document.getElementById('dashboardUserName');
  const role = document.getElementById('dashboardUserRole');
  const avatar = document.getElementById('empTopAvatar');
  if (name) name.textContent = user.fullname || `${user.firstname || ''} ${user.lastname || ''}`.trim() || user.username || 'User';
  if (role) role.textContent = (user.role || 'employee').toUpperCase();
  if (avatar) avatar.textContent = initialsOf(user);
}

/* ---------------- CLOCK ---------------- */

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

/* ---------------- SIDEBAR ---------------- */

const sidebar = document.querySelector('.sidebar');
const sidebarToggle = document.getElementById('sidebarToggle');
const sidebarOverlay = document.getElementById('sidebarOverlay');

function setSidebarState(isOpen) {
  const isMobile = window.innerWidth <= 768;
  document.body.classList.toggle('sidebar-collapsed', !isOpen && !isMobile);
  if (sidebar) sidebar.classList.toggle('is-open', isMobile ? isOpen : true);
  if (sidebarToggle) {
    sidebarToggle.classList.toggle('is-open', isOpen);
    sidebarToggle.setAttribute('aria-expanded', String(isOpen));
  }
  if (sidebarOverlay) sidebarOverlay.classList.toggle('is-visible', isMobile && isOpen);
}

if (sidebarToggle) {
  sidebarToggle.addEventListener('click', (e) => {
    e.stopPropagation();
    const isMobile = window.innerWidth <= 768;
    if (isMobile) {
      setSidebarState(!sidebar?.classList.contains('is-open'));
      return;
    }
    setSidebarState(document.body.classList.contains('sidebar-collapsed'));
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

/* ---------------- SCROLL / NAV ---------------- */

function setActiveNavForHash(hash) {
  const normalized = hash || '#employee-dashboard';
  document.querySelectorAll('.sidebar .nav-item').forEach(n => {
    const href = n.getAttribute('href');
    n.classList.toggle('active', href === normalized);
  });
}

function scrollToSection(hash) {
  const normalized = hash || '#employee-dashboard';
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

document.querySelectorAll('.sidebar .nav-item').forEach((navItem) => {
  navItem.addEventListener('click', (e) => {
    const href = navItem.getAttribute('href');
    if (href && href.startsWith('#')) {
      e.preventDefault();
      document.querySelectorAll('.sidebar .nav-item').forEach(n => n.classList.remove('active'));
      navItem.classList.add('active');
      scrollToSection(href);
      try { history.pushState(null, '', href); } catch (err) { location.hash = href; }
    }
  });
});

const initialHash = window.location.hash || '#employee-dashboard';
setActiveNavForHash(initialHash);
window.addEventListener('hashchange', () => setActiveNavForHash(window.location.hash || '#employee-dashboard'));
scrollToSection(initialHash);

/* ---------------- SESSION VERIFY ---------------- */

async function verifyEmployeeSession() {
  const token = localStorage.getItem('tapinToken');
  if (!token) { redirectToLogin(); return; }

  try {
    const response = await fetch(`${dashboardApiBaseUrl}/api/verify-token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      credentials: 'include',
      cache: 'no-store'
    });
    if (!response.ok) { redirectToLogin(); return; }

    const data = await response.json();
    currentUser = data.user || null;

    // Prefer enriched user pulled from dashboard users list
    await loadDashboardUsers();
    const enriched = allEmployees.find(e => e.rfid === currentUser?.rfid || e.uid === currentUser?.uid);
    if (enriched) currentUser = { ...currentUser, ...enriched };

    updateUserDisplay(currentUser);
    populateAccountInfo();
    populateProfileCard();

    // IMPORTANT: Load leave requests FIRST so the stats calculation can
    // exclude approved leave days from the "absent" count.
    await loadMyLeaveRequests();

    // Now compute this month's stats using the DTR record for this user.
    await loadMyMonthlyStats();

    await loadDtrMonths();
    await loadMyAttendance();
    await loadMyActivityTimeline();
  } catch (err) {
    console.error('Session verify error:', err);
    redirectToLogin();
  }
}

/* ---------------- DASHBOARD USERS ---------------- */

async function loadDashboardUsers() {
  try {
    const res = await fetch(`${dashboardApiBaseUrl}/api/dashboard-data`, {
      method: 'GET', headers: getAuthHeaders(), credentials: 'include', cache: 'no-store'
    });
    if (res.status === 401) { redirectToLogin(); return; }
    if (!res.ok) return;
    const result = await res.json();
    const data = result.data || {};
    allEmployees = data.users || [];
  } catch (err) {
    console.error('Load dashboard users error:', err);
  }
}

/* ---------------- MONTHLY STATS (driven by DTR record) ---------------- */

// Pulls this month's DTR record for the logged-in user and derives the
// Present / Absent / Hours / Leave stats from it. The DTR endpoint is the
// authoritative source of hours and per-day attendance, so we use it here
// instead of the raw dashboard scans list.
//
// Holidays: the DTR day rows may carry status === 'holiday' (or similar
// holiday flags from the API). Holiday rows are skipped from every count:
// they are not present, not absent, and do not contribute working days.
async function loadMyMonthlyStats() {
  if (!currentUser || !currentUser.rfid) {
    resetMonthlyStats();
    return;
  }

  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  try {
    const res = await fetch(`${dashboardApiBaseUrl}/api/dtr/record/${currentUser.rfid}?month=${currentMonth}`, {
      method: 'GET', headers: getAuthHeaders(), credentials: 'include', cache: 'no-store'
    });
    if (res.status === 401) { redirectToLogin(); return; }
    if (!res.ok) { resetMonthlyStats(); return; }

    const result = await res.json();
    if (result.status !== 'success' || !result.data || !result.data.record) {
      resetMonthlyStats();
      return;
    }

    const record = result.data.record;
    const dtr = record.dtr || [];

    // Approved leave dates for this month (used to exclude from "absent").
    const approvedLeaveDates = new Set();
    myLeaveRequests.filter(r => (r.status || '').toLowerCase() === 'approved').forEach(r => {
      const startStr = r.start_date;
      const endStr = r.end_date;
      if (!startStr || !endStr) return;
      const start = new Date(startStr);
      const end = new Date(endStr);
      if (isNaN(start.getTime()) || isNaN(end.getTime())) return;
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      const rangeStart = start < monthStart ? monthStart : start;
      const rangeEnd = end > monthEnd ? monthEnd : end;
      for (let d = new Date(rangeStart); d <= rangeEnd; d.setDate(d.getDate() + 1)) {
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        approvedLeaveDates.add(key);
      }
    });

    // Helper: does this DTR row represent a holiday?
    // The API may send one of several shapes; we cover the common ones so
    // this works whether the server sends `status: 'holiday'`, a boolean
    // `is_holiday` flag, or a `holiday_name` / `holiday` field.
    const isHolidayRow = (day) => {
      if (!day) return false;
      const status = String(day.status || '').toLowerCase();
      if (status === 'holiday' || status === 'legal_holiday' || status === 'special_holiday') return true;
      if (day.is_holiday === true) return true;
      if (day.holiday === true) return true;
      if (day.holiday_name) return true;
      return false;
    };

    // Walk the DTR rows and compute everything from them.
    let totalPresent = 0;      // days with at least one In/Out, EXCLUDING holidays
    let totalAbsent = 0;       // past weekdays with no scan, not on leave, not holiday, not future
    let totalHours = 0;        // hours are only added on non-holiday days with scans
    const today = new Date();

    dtr.forEach(day => {
      const dayName = day.day || '';
      const isWeekend = dayName === 'Sat' || dayName === 'Sun';
      const isLeave = day.status === 'on_leave';
      const holiday = isHolidayRow(day);
      const dateStr = (day.date || '').slice(0, 10);

      const dayDate = dateStr ? new Date(dateStr) : null;
      const isFuture = dayDate && dayDate > today;

      const hasScan = !!(day.am_in || day.am_out || day.pm_in || day.pm_out);

      // --- Holidays are completely skipped from every counter ---
      if (holiday) {
        return;
      }

      if (hasScan) {
        totalPresent += 1;
      } else if (!isWeekend && !isLeave && !isFuture && dateStr && !approvedLeaveDates.has(dateStr)) {
        totalAbsent += 1;
      }

      const hoursVal = Number.parseFloat(day.hours);
      if (!Number.isNaN(hoursVal)) totalHours += hoursVal;
    });

    // Leave count for this month (approved + pending overlapping this month).
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    const leaveCount = myLeaveRequests.filter(r => {
      const status = (r.status || '').toLowerCase();
      if (status !== 'approved' && status !== 'pending') return false;
      const start = new Date(r.start_date || '');
      const end = new Date(r.end_date || '');
      if (isNaN(start.getTime()) || isNaN(end.getTime())) return false;
      return start <= monthEnd && end >= monthStart;
    }).length;

    // Working days in this month (used for bar percentages).
    // Skip weekends, approved leaves, AND holidays so the bars stay accurate.
    const holidayDates = new Set();
    dtr.forEach(day => {
      if (isHolidayRow(day)) {
        const key = (day.date || '').slice(0, 10);
        if (key) holidayDates.add(key);
      }
    });

    let workingDaysInMonth = 0;
    for (let d = new Date(monthStart); d <= monthEnd; d.setDate(d.getDate() + 1)) {
      const wd = d.getDay();
      if (wd === 0 || wd === 6) continue; // skip weekends
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      if (approvedLeaveDates.has(key)) continue; // skip approved leave
      if (holidayDates.has(key)) continue;       // skip holidays
      workingDaysInMonth++;
    }

    // ---- Write to the DOM ----
    setText('statTotalPresent', String(totalPresent));
    setText('statTotalAbsent', String(totalAbsent));
    setText('statTotalHours', totalHours.toFixed(2));
    setText('statLeaveCount', String(leaveCount));

    const pct = (v) => workingDaysInMonth > 0 ? Math.min((v / workingDaysInMonth) * 100, 100) : 0;
    setWidth('statPresentBar', pct(totalPresent) + '%');
    setWidth('statAbsentBar', pct(totalAbsent) + '%');
    setWidth('statHoursBar', Math.min((totalHours / (workingDaysInMonth * 8 || 1)) * 100, 100) + '%');
    setWidth('statLeaveBar', Math.min((leaveCount / 15) * 100, 100) + '%');
  } catch (err) {
    console.error('Load monthly stats error:', err);
    resetMonthlyStats();
  }
}

// Zero out the stats cards when no data is available.
function resetMonthlyStats() {
  setText('statTotalPresent', '0');
  setText('statTotalAbsent', '0');
  setText('statTotalHours', '0.00');
  setText('statLeaveCount', '0');
  setWidth('statPresentBar', '0%');
  setWidth('statAbsentBar', '0%');
  setWidth('statHoursBar', '0%');
  setWidth('statLeaveBar', '0%');
}

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

function setWidth(id, pct) {
  const el = document.getElementById(id);
  if (el) el.style.width = typeof pct === 'string' ? pct : `${pct}%`;
}

/* ---------------- ACCOUNT INFO ---------------- */

function populateAccountInfo() {
  if (!currentUser) return;
  setText('employeeId', currentUser.employeeid || currentUser.uid || '--');
  setText('employeeFullname', currentUser.fullname || `${currentUser.firstname || ''} ${currentUser.lastname || ''}`.trim() || '--');
  setText('employeeRfid', currentUser.rfid || '--');
  setText('employeeDepartment', currentUser.department || '--');
  setText('employeeRole', (currentUser.role || 'employee').toUpperCase());
  setText('employeeLatestScan', currentUser.latest_scan || '--');
  setText('employeeStatus', currentUser.present ? 'Present Today' : 'Waiting');

  const activityEl = document.getElementById('employeeActivity');
  if (activityEl) {
    activityEl.textContent = currentUser.latest_scan
      ? `Last scan recorded at ${currentUser.latest_scan}.`
      : 'No RFID scan received yet.';
  }
}

/* ---------------- PROFILE CARD ---------------- */

function populateProfileCard() {
  if (!currentUser) return;
  setText('profileName', currentUser.fullname || `${currentUser.firstname || ''} ${currentUser.lastname || ''}`.trim() || '--');
  setText('profileRoleLabel', (currentUser.role || 'employee').toUpperCase());
  setText('profileEmpId', currentUser.employeeid || currentUser.uid || '--');
  setText('profileEmail', currentUser.email || '--');
  setText('profilePhone', currentUser.cpnumber || '--');
  setText('profileDept', currentUser.department || '--');
  setText('profilePosition', currentUser.position || '--');
  setText('profileAddress', currentUser.address || '--');
  setText('profileBdate', currentUser.bdate || '--');
  setText('profileRfid', currentUser.rfid || '--');

  const avatar = document.getElementById('profileAvatar');
  if (avatar) {
    if (currentUser.image) {
      avatar.innerHTML = `<img src="${dashboardApiBaseUrl}/uploads/${escapeHtml(currentUser.image)}" alt="avatar" />`;
    } else {
      avatar.textContent = initialsOf(currentUser);
    }
  }
}

/* ---------------- DTR ---------------- */

async function loadDtrMonths() {
  if (dtrMonthsLoaded) return;
  try {
    const res = await fetch(`${dashboardApiBaseUrl}/api/dtr/months`, {
      method: 'GET', headers: getAuthHeaders(), credentials: 'include', cache: 'no-store'
    });
    if (!res.ok) return;
    const result = await res.json();
    if (result.status === 'success' && result.data) {
      const select = document.getElementById('myDtrMonthSelect');
      if (!select) return;
      while (select.options.length > 1) select.remove(1);
      result.data.forEach(m => {
        const opt = document.createElement('option');
        opt.value = m.value;
        opt.textContent = m.label;
        select.appendChild(opt);
      });
      // Default: current month
      const currentMonth = new Date().toISOString().slice(0, 7);
      for (let i = 0; i < select.options.length; i++) {
        if (select.options[i].value === currentMonth) { select.selectedIndex = i; break; }
      }
      dtrMonthsLoaded = true;

      // Auto-load current month
      if (select.value) loadMyDTR();
    }
  } catch (err) {
    console.error('Load DTR months error:', err);
  }
}

async function loadMyDTR() {
  if (!currentUser || !currentUser.rfid) {
    showMyDtrMessage('Session not ready. Please reload.', 'error');
    return;
  }
  const monthSelect = document.getElementById('myDtrMonthSelect');
  const month = monthSelect ? monthSelect.value : '';
  if (!month) { showMyDtrMessage('Please select a month.', 'warning'); return; }

  setText('myDtrEmployeeName', currentUser.fullname || '--');
  setText('myDtrEmployeeId', currentUser.employeeid || currentUser.uid || '--');
  setText('myDtrDepartment', currentUser.department || '--');

  const tbody = document.getElementById('myDtrTableBody');
  if (tbody) {
    tbody.innerHTML = `<tr><td colspan="10" style="text-align:center;padding:20px;color:var(--text-muted);">
      <i class="fa-solid fa-spinner fa-spin" style="margin-right:8px;"></i> Loading DTR...
    </td></tr>`;
  }

  try {
    const res = await fetch(`${dashboardApiBaseUrl}/api/dtr/record/${currentUser.rfid}?month=${month}`, {
      method: 'GET', headers: getAuthHeaders(), credentials: 'include', cache: 'no-store'
    });
    if (res.status === 401) { redirectToLogin(); return; }
    if (!res.ok) { showMyDtrMessage('Failed to load DTR.', 'error'); return; }

    const result = await res.json();
    if (result.status !== 'success' || !result.data) {
      showMyDtrMessage('No DTR data available.', 'error');
      return;
    }

    const record = result.data.record;
    const dtr = record.dtr || [];

    setText('myDtrMonth', record.month_display || month);
    setText('myDtrTotalHours', record.total_hours || '0.00');
    setText('myDtrTotalOt', record.total_ot || '0.00');
    setText('myDtrTotalUt', record.total_ut || '0.00');

    if (!tbody) return;
    if (!dtr.length) {
      tbody.innerHTML = `<tr><td colspan="10" style="text-align:center;padding:20px;color:var(--text-muted);">
        No attendance records for this month.</td></tr>`;
      return;
    }

    tbody.innerHTML = dtr.map(day => {
      const isWeekend = day.day === 'Sat' || day.day === 'Sun';
      const isLeave = day.status === 'on_leave';
      const isHoliday = (String(day.status || '').toLowerCase() === 'holiday')
        || day.is_holiday === true
        || !!day.holiday_name;
      let rowStyle = '';
      let statusText = day.status || '';
      if (isHoliday) {
        rowStyle = 'background-color:#FCE7F3;';
        statusText = 'HOLIDAY';
      } else if (isLeave) {
        rowStyle = 'background-color:#FEF3C7;';
        statusText = 'ON LEAVE';
      } else if (isWeekend) {
        rowStyle = 'background-color:#F3F4F6;color:#9CA3AF;';
        statusText = 'Weekend';
      }

      return `<tr style="${rowStyle}">
        <td>${escapeHtml(formatDTRDate(day.date))}</td>
        <td>${escapeHtml(day.day || '')}</td>
        <td>${escapeHtml(day.am_in || '')}</td>
        <td>${escapeHtml(day.am_out || '')}</td>
        <td>${escapeHtml(day.pm_in || '')}</td>
        <td>${escapeHtml(day.pm_out || '')}</td>
        <td>${escapeHtml(day.hours || '0.00')}</td>
        <td>${escapeHtml(day.ut || '0.00')}</td>
        <td>${escapeHtml(day.ot || '0.00')}</td>
        <td>${escapeHtml(statusText)}</td>
      </tr>`;
    }).join('');

    showMyDtrMessage(`DTR loaded for ${record.month_display}.`, 'success');
  } catch (err) {
    console.error('Load DTR error:', err);
    showMyDtrMessage('Error loading DTR.', 'error');
  }
}

function showMyDtrMessage(msg, type = 'info') {
  const el = document.getElementById('myDtrMessage');
  if (!el) return;
  const colors = { success: '#10B981', error: '#EF4444', warning: '#F59E0B', info: '#3B82F6' };
  const icons = { success: 'fa-check-circle', error: 'fa-exclamation-circle', warning: 'fa-exclamation-triangle', info: 'fa-info-circle' };
  el.innerHTML = `<i class="fa-solid ${icons[type]}"></i> ${msg}`;
  el.style.color = colors[type];
  el.style.display = 'block';
  if (type === 'success') setTimeout(() => el.style.display = 'none', 5000);
}

/* ---------------- MY ATTENDANCE ---------------- */

async function loadMyAttendance() {
  const tbody = document.getElementById('myAttendanceBody');
  if (!tbody || !currentUser) return;

  try {
    const res = await fetch(`${dashboardApiBaseUrl}/api/dashboard-data`, {
      method: 'GET', headers: getAuthHeaders(), credentials: 'include', cache: 'no-store'
    });
    if (res.status === 401) { redirectToLogin(); return; }
    if (!res.ok) return;

    const result = await res.json();
    const scans = (result.data?.scans || []).filter(s => s.rfid === currentUser.rfid);

    if (!scans.length) {
      tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;padding:30px;color:var(--text-muted);">
        <i class="fa-solid fa-info-circle" style="font-size:20px;display:block;margin-bottom:10px;"></i>
        No attendance records yet.
      </td></tr>`;
      return;
    }

    tbody.innerHTML = scans.slice(0, 30).map(scan => {
      const d = new Date(scan.scanned_at);
      return `<tr>
        <td>${escapeHtml(d.toLocaleDateString())}</td>
        <td>${escapeHtml(d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }))}</td>
        <td>--</td>
        <td><span class="badge badge-present">Present</span></td>
        <td>${escapeHtml(scan.remarks || 'RFID scan')}</td>
      </tr>`;
    }).join('');
  } catch (err) {
    console.error('Load attendance error:', err);
  }
}

/* ---------------- LEAVE REQUESTS ---------------- */

async function loadMyLeaveRequests() {
  if (!currentUser) return;
  const tbody = document.getElementById('leaveRequestsBody');
  if (!tbody) return;

  try {
    const rfid = currentUser.rfid || '';
    // FIXED: use the per-employee route /api/leave-requests/<rfid>,
    // which filters by the employee's UID on the backend and returns
    // { requests, approved, rejected } for that employee only.
    const res = await fetch(`${dashboardApiBaseUrl}/api/leave-requests/${encodeURIComponent(rfid)}`, {
      method: 'GET', headers: getAuthHeaders(), credentials: 'include', cache: 'no-store'
    });
    if (res.status === 401) { redirectToLogin(); return; }

    if (res.ok) {
      const result = await res.json();
      // Combine all three statuses so the "My Requests" table shows every
      // request regardless of whether it's still pending, approved, or rejected.
      const pending = result.data?.requests || [];
      const approved = result.data?.approved || [];
      const rejected = result.data?.rejected || [];
      myLeaveRequests = [...pending, ...approved, ...rejected];
    } else {
      myLeaveRequests = [];
    }
  } catch (err) {
    myLeaveRequests = [];
  }

  if (!myLeaveRequests.length) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:30px;color:var(--text-muted);">
      <i class="fa-solid fa-inbox" style="font-size:20px;display:block;margin-bottom:10px;"></i>
      No leave requests yet.
    </td></tr>`;
    return;
  }

  tbody.innerHTML = myLeaveRequests.map((r, i) => {
    const status = (r.status || 'pending').toLowerCase();
    const badge = status === 'approved' ? 'badge-approved'
               : status === 'rejected' ? 'badge-rejected'
               : 'badge-pending';
    const canCancel = status === 'pending';
    return `<tr>
      <td>${escapeHtml(r.filed_at || r.requested_at || '--')}</td>
      <td>${escapeHtml((r.leave_type || '').toUpperCase())}</td>
      <td>${escapeHtml(r.start_date || '--')}</td>
      <td>${escapeHtml(r.end_date || '--')}</td>
      <td>${escapeHtml(r.reason || '--')}</td>
      <td><span class="badge ${badge}">${escapeHtml(status.toUpperCase())}</span></td>
      <td>${canCancel ? `<button class="btn btn-outline btn-sm" onclick="cancelLeaveRequest(${i})"><i class="fa-solid fa-times"></i> Cancel</button>` : '--'}</td>
    </tr>`;
  }).join('');
}

function openLeaveModal() {
  const modal = document.getElementById('leaveModal');
  if (modal) modal.style.display = 'flex';
  const form = document.getElementById('leaveRequestForm');
  if (form) form.reset();
  const msg = document.getElementById('leaveMessage');
  if (msg) msg.style.display = 'none';
}

function closeLeaveModal() {
  const modal = document.getElementById('leaveModal');
  if (modal) modal.style.display = 'none';
}

async function submitLeaveRequest(event) {
  event.preventDefault();
  if (!currentUser) return false;

  const formData = new FormData();
  formData.append('rfid', currentUser.rfid);
  formData.append('employeeid', currentUser.employeeid || '');
  formData.append('leave_type', document.getElementById('leaveType').value);
  formData.append('start_date', document.getElementById('leaveStart').value);
  formData.append('end_date', document.getElementById('leaveEnd').value);
  formData.append('reason', document.getElementById('leaveReason').value.trim());

  // Handle file upload
  const attachmentInput = document.getElementById('leaveAttachment');
  if (attachmentInput.files && attachmentInput.files[0]) {
    formData.append('attachment', attachmentInput.files[0]);
  }

  if (!formData.get('start_date') || !formData.get('end_date') || !formData.get('reason')) {
    showLeaveMessage('Please fill in all required fields.', 'warning');
    return false;
  }
  if (new Date(formData.get('start_date')) > new Date(formData.get('end_date'))) {
    showLeaveMessage('Start date cannot be after end date.', 'warning');
    return false;
  }

  showLeaveMessage('<i class="fa-solid fa-spinner fa-spin"></i> Submitting...', 'info');

  try {
    // FIXED: the backend POST route is /api/request-leave, not /api/leave-requests.
    // Also — for FormData we MUST NOT set Content-Type: application/json,
    // because the browser needs to add its own multipart boundary. So we
    // only send the Authorization header here, not getAuthHeaders().
    const res = await fetch(`${dashboardApiBaseUrl}/api/request-leave`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${localStorage.getItem('tapinToken')}` },
      body: formData,
      credentials: 'include'
    });

    if (res.status === 401) { redirectToLogin(); return false; }

    const result = await res.json().catch(() => ({}));
    if (!res.ok) {
      showLeaveMessage(result.message || 'Failed to submit request.', 'error');
      return false;
    }

    showLeaveMessage('Leave request submitted successfully!', 'success');
    await loadMyLeaveRequests();
    await loadMyMonthlyStats();
    setTimeout(() => closeLeaveModal(), 1200);
  } catch (err) {
    console.error('Leave submit error:', err);
    showLeaveMessage('Network error. Please try again.', 'error');
  }
  return false;
}

function showLeaveMessage(msg, type = 'info') {
  const el = document.getElementById('leaveMessage');
  if (!el) return;
  const colors = { success: '#10B981', error: '#EF4444', warning: '#F59E0B', info: '#3B82F6' };
  el.innerHTML = typeof msg === 'string' && msg.startsWith('<i') ? msg : `<i class="fa-solid fa-circle-info"></i> ${msg}`;
  el.style.color = colors[type] || colors.info;
  el.style.display = 'block';
}

async function cancelLeaveRequest(index) {
  const r = myLeaveRequests[index];
  if (!r) return;
  if (!confirm('Cancel this leave request?')) return;

  try {
    const res = await fetch(`${dashboardApiBaseUrl}/api/leave-requests/${r.id || r.uid || index}`, {
      method: 'DELETE',
      headers: getAuthHeaders(),
      credentials: 'include'
    });
    if (res.status === 401) { redirectToLogin(); return; }
    if (!res.ok) { alert('Failed to cancel request.'); return; }
    await loadMyLeaveRequests();
    await loadMyMonthlyStats();
  } catch (err) {
    console.error('Cancel leave error:', err);
    alert('Network error.');
  }
}

/* ---------------- EDIT PROFILE ---------------- */

function openEditProfileModal() {
  if (!currentUser) return;
  const modal = document.getElementById('editProfileModal');
  if (!modal) return;

  document.getElementById('editFirstname').value = currentUser.firstname || '';
  document.getElementById('editLastname').value = currentUser.lastname || '';
  document.getElementById('editEmail').value = currentUser.email || '';
  document.getElementById('editCpnumber').value = currentUser.cpnumber || '';
  document.getElementById('editBdate').value = currentUser.bdate || '';
  document.getElementById('editAddress').value = currentUser.address || '';
  document.getElementById('editDepartment').value = currentUser.department || '';
  document.getElementById('editPosition').value = currentUser.position || '';
  document.getElementById('editUsername').value = currentUser.username || '';
  document.getElementById('editRfid').value = currentUser.rfid || '';
  document.getElementById('editProfileSubtitle').textContent = currentUser.fullname || 'Update your information';

  const avatar = document.getElementById('editProfileAvatar');
  if (avatar) {
    if (currentUser.image) {
      avatar.innerHTML = `<img src="${dashboardApiBaseUrl}/uploads/${escapeHtml(currentUser.image)}" alt="avatar" />`;
    } else {
      avatar.textContent = initialsOf(currentUser);
    }
  }

  const preview = document.getElementById('editProfileImagePreview');
  if (preview) preview.style.display = 'none';
  const msg = document.getElementById('editProfileMessage');
  if (msg) msg.style.display = 'none';

  modal.style.display = 'flex';

  const fileInput = document.getElementById('editProfileImage');
  fileInput.onchange = function () {
    const reader = new FileReader();
    reader.onload = (e) => {
      document.getElementById('editProfileImagePreviewImg').src = e.target.result;
      document.getElementById('editProfileImagePreview').style.display = 'block';
    };
    if (this.files && this.files[0]) reader.readAsDataURL(this.files[0]);
  };
}

function closeEditProfileModal() {
  const modal = document.getElementById('editProfileModal');
  if (modal) modal.style.display = 'none';
}

async function submitEditProfile(event) {
  event.preventDefault();
  if (!currentUser || !currentUser.rfid) return false;

  const msgEl = document.getElementById('editProfileMessage');
  msgEl.style.display = 'block';
  msgEl.style.color = '#3B82F6';
  msgEl.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Saving changes...';

  const formData = new FormData();
  formData.append('firstname', document.getElementById('editFirstname').value);
  formData.append('lastname', document.getElementById('editLastname').value);
  formData.append('email', document.getElementById('editEmail').value);
  formData.append('cpnumber', document.getElementById('editCpnumber').value);
  formData.append('bdate', document.getElementById('editBdate').value);
  formData.append('address', document.getElementById('editAddress').value);
  formData.append('department', document.getElementById('editDepartment').value);
  formData.append('position', document.getElementById('editPosition').value);
  formData.append('username', document.getElementById('editUsername').value);
  formData.append('rfid', currentUser.rfid);
  formData.append('role', currentUser.role || 'employee');

  const imageFile = document.getElementById('editProfileImage').files[0];
  if (imageFile) formData.append('image', imageFile);

  try {
    const res = await fetch(`${dashboardApiBaseUrl}/api/update-employee/${currentUser.rfid}`, {
      method: 'PUT',
      headers: { 'Authorization': `Bearer ${localStorage.getItem('tapinToken')}` },
      body: formData,
      credentials: 'include'
    });

    if (res.status === 401) { redirectToLogin(); return false; }

    const result = await res.json().catch(() => ({}));
    if (!res.ok) {
      msgEl.style.color = '#EF4444';
      msgEl.innerHTML = `<i class="fa-solid fa-exclamation-circle"></i> ${result.message || 'Update failed.'}`;
      return false;
    }

    // Merge updated data
    currentUser = { ...currentUser, ...(result.data || {}) };
    const idx = allEmployees.findIndex(e => e.rfid === currentUser.rfid);
    if (idx !== -1) allEmployees[idx] = { ...allEmployees[idx], ...(result.data || {}) };

    updateUserDisplay(currentUser);
    populateAccountInfo();
    populateProfileCard();

    msgEl.style.color = '#10B981';
    msgEl.innerHTML = '<i class="fa-solid fa-check-circle"></i> Profile updated successfully!';

    setTimeout(() => closeEditProfileModal(), 1200);
  } catch (err) {
    console.error('Update profile error:', err);
    msgEl.style.color = '#EF4444';
    msgEl.innerHTML = '<i class="fa-solid fa-exclamation-circle"></i> Network error. Please try again.';
  }
  return false;
}

/* ---------------- CHANGE PASSWORD ---------------- */

async function changePassword() {
  const msgEl = document.getElementById('passwordMessage');
  const current = document.getElementById('currentPassword').value;
  const newPwd = document.getElementById('newPassword').value;
  const confirm = document.getElementById('confirmPassword').value;

  msgEl.style.display = 'block';
  msgEl.style.color = '#3B82F6';
  msgEl.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Updating...';

  if (!current || !newPwd || !confirm) {
    msgEl.style.color = '#EF4444';
    msgEl.innerHTML = '<i class="fa-solid fa-exclamation-circle"></i> Please fill in all fields.';
    return;
  }
  if (newPwd !== confirm) {
    msgEl.style.color = '#EF4444';
    msgEl.innerHTML = '<i class="fa-solid fa-exclamation-circle"></i> New passwords do not match.';
    return;
  }

  try {
    const res = await fetch(`${dashboardApiBaseUrl}/api/change-password`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ rfid: currentUser.rfid, current_password: current, new_password: newPwd }),
      credentials: 'include'
    });

    if (res.status === 401) { redirectToLogin(); return; }

    const result = await res.json().catch(() => ({}));
    if (!res.ok) {
      msgEl.style.color = '#EF4444';
      msgEl.innerHTML = `<i class="fa-solid fa-exclamation-circle"></i> ${result.message || 'Failed to update password.'}`;
      return;
    }

    msgEl.style.color = '#10B981';
    msgEl.innerHTML = '<i class="fa-solid fa-check-circle"></i> Password updated successfully!';
    document.getElementById('currentPassword').value = '';
    document.getElementById('newPassword').value = '';
    document.getElementById('confirmPassword').value = '';
  } catch (err) {
    console.error('Change password error:', err);
    msgEl.style.color = '#EF4444';
    msgEl.innerHTML = '<i class="fa-solid fa-exclamation-circle"></i> Network error.';
  }
}

/* ---------------- DTR PRINT / PDF ---------------- */

function buildMyDtrHTML(record, dtr, employee) {
    // Name is ALWAYS "LASTNAME, FIRSTNAME" format (lastname first, uppercase).
    // We build this from lastname + firstname directly so we never fall back to
    // a pre-formatted "Firstname Lastname" string coming from the API.
    const rawLast = (employee.lastname || '').trim();
    const rawFirst = (employee.firstname || '').trim();
    let fullname;
    if (rawLast || rawFirst) {
        fullname = rawLast
            ? `${rawLast}, ${rawFirst}`.replace(/,\s*$/, '')
            : rawFirst;
    } else {
        // Last resort: parse an existing "Firstname Lastname" string and flip it
        const src = (employee.fullname || 'Unknown').trim();
        const parts = src.split(/\s+/);
        if (parts.length >= 2) {
            const last = parts.pop();
            fullname = `${last}, ${parts.join(' ')}`;
        } else {
            fullname = src;
        }
    }
    fullname = fullname.toUpperCase();
  const position = employee.position || '';
  const department = employee.department || '';
  const totalUt = record.total_ut || '0.00';

  // Get the month range — formatted "M/D/YY" and derived from whatever
  // month this record actually covers (works for any month, not just now).
  const { from: fromDate, to: toDate } = resolveDTRDateRange(record, dtr);

  // Calculate total working days (A)
  const workingDays = dtr.filter(day => day.status !== 'on_leave' && day.day !== 'Sat' && day.day !== 'Sun').length;
  const totalWorkingDays = Number(workingDays) || 0;
  const totalUndertime = totalUt;

  // Build the table body rows once — each copy prints the FULL date range (1..end),
    // exactly like the two side-by-side originals on the reference form.
    const tableRows = dtr.map(day => {
        const isWeekend = day.day === 'Sat' || day.day === 'Sun';
        const isLeave = day.status === 'on_leave';
        const rowStyle = isWeekend ? 'background-color:#f2f2f2;' : (isLeave ? 'background-color:#fef3c7;' : '');
        const ut = day.ut && day.ut !== '0.00' && day.ut !== 0 ? day.ut : '';
        const ot = day.ot && day.ot !== '0.00' && day.ot !== 0 ? day.ot : '';

        return `
            <tr style="${rowStyle}">
                <td class="c-date">${formatDTRDate(day.date)}</td>
                <td class="c-day">${day.day || ''}</td>
                <td class="c-time">${day.am_in || ''}</td>
                <td class="c-time">${day.am_out || ''}</td>
                <td class="c-time">${day.pm_in || ''}</td>
                <td class="c-time">${day.pm_out || ''}</td>
                <td class="c-small">${ut}</td>
                <td class="c-small">${ot}</td>
            </tr>`;
    }).join('');

  function buildCopy(copyLabel, isPersonnelCopy) {
        return `
        <div class="dtr-copy">
            <div class="dtr-title">DAILY TIME RECORD</div>
            <div class="dtr-title-space">&nbsp;</div>
            <div class="dtr-subtitle">DAILY TIME RECORD</div>
            <div class="dtr-daterange">From: ${fromDate} To: ${toDate}</div>
            <div class="dtr-title-space">&nbsp;</div>

        <div class="dtr-info">
                <div class="info-row"><span class="info-label">Name :</span><span class="info-value name">${fullname}</span></div>
                <div class="info-row"><span class="info-label">Position :</span><span class="info-value">${position}</span></div>
                <div class="info-row"><span class="info-label">Department :</span><span class="info-value">${department}</span></div>
                <div class="info-row two-col">
                    <span class="info-half"><span class="info-label">Regular Time :</span><span class="info-value">${employee.regularTime || 'DEFAULT'}</span></span>
                    <span class="info-half"><span class="info-label label-auto">Payroll No. :</span><span class="info-value payroll-underline">1</span></span>
                </div>
            </div>

        <table class="dtr-table">
                <colgroup>
                    <col class="col-date"><col class="col-day">
                    <col class="col-time"><col class="col-time">
                    <col class="col-time"><col class="col-time">
                    <col class="col-small"><col class="col-small">
                </colgroup>
                <thead>
                    <tr class="grp-row">
                        <th colspan="2">WORKING</th>
                        <th colspan="2">A M</th>
                        <th colspan="2">P M</th>
                        <th colspan="2">HOURS</th>
                    </tr>
                    <tr class="sub-row">
                        <th>Date</th>
                        <th>Days</th>
                        <th>In 1</th>
                        <th>Out 1</th>
                        <th>In 2</th>
                        <th>Out 2</th>
                        <th>UT</th>
                        <th>OT</th>
                    </tr>
                </thead>
                <tbody>
                    ${tableRows}
                </tbody>
            </table>

        <div class="dtr-summary">
                <div class="summary-line">
                    <span class="summary-item"><label>A =</label><span class="fill">${totalWorkingDays.toFixed(2)}</span></span>
                    <span class="summary-item"><label>ROT =</label><span class="fill">0.00</span></span>
                    <span class="summary-item"><label>LOT =</label><span class="fill">&nbsp;</span></span>
                </div>
                <div class="summary-line">
                    <span class="summary-item"><label>U =</label><span class="fill">${totalUndertime}</span></span>
                    <span class="summary-item"><label>SOT =</label><span class="fill">&nbsp;</span></span>
                </div>
            </div>

        <div class="dtr-cert">
                I Certify on my honor that the above is a true and correct report of the hours work perfomed, record of which was daily at the time of arrival and departure from office.
            </div>

        <div class="dtr-sig">
                <div class="sig-line"></div>
                <div class="sig-caption">Signature</div>
            </div>

        <div class="dtr-divider">${'&#61;'.repeat(160)}</div>

        <div class="dtr-verified-label">VERIFIED as to the prescribed office hours</div>

        <div class="dtr-sig">
          <div class="sig-line"></div>
          <div class="sig-caption">In Charge</div>
        </div>

        <div class="dtr-copy-tag">&gt;&gt;&gt;&gt;&gt;${copyLabel}</div>

        ${isPersonnelCopy ? `
        <div class="dtr-recorded">
          <div class="recorded-row"><span class="recorded-label">RECORDED BY:</span><span class="recorded-line"></span></div>
          <div class="recorded-row"><span class="recorded-label">DATE:</span><span class="recorded-line"></span></div>
        </div>` : ''}
      </div>`;
  }

  const employeeCopyHTML = buildCopy("EMPLOYEE'S COPY", false);
  const personnelCopyHTML = buildCopy("PERSONNEL'S COPY", true);

  return `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <title>Daily Time Record - ${fullname}</title>
            <style>
                @page {
                    size: A4 portrait;
                    margin: 8mm 8mm;
                }
                * {
                    margin: 0;
                    padding: 0;
                    box-sizing: border-box;
                }
                html, body {
                    width: 100%;
                    height: 100%;
                }
                body {
                    font-family: Arial, Helvetica, sans-serif;
                    font-size: 9px;
                    color: #000;
                }
                .dtr-page {
                    display: flex;
                    align-items: stretch;
                    width: 100%;
                }
                .dtr-copy {
                    flex: 1 1 50%;
                    width: 50%;
                    min-width: 0;
                    padding: 2px 14px; /* padding left & right to center the text */
                }
                .dtr-vertical-divider {
                    width: 0;
                    border-left: 1px solid #000;
                    margin: 4px 4px 4px 0;
                }
                .dtr-title {
                    text-align: center;
                    font-size: 15px;
                    font-weight: bold;
                    text-transform: uppercase;
                }
                /* Blank spacing line between big title and small subtitle,
                   and between date range and employee info block */
                .dtr-title-space {
                    height: 8px;
                    line-height: 8px;
                }
                .dtr-subtitle {
                    text-align: center;
                    font-size: 9px;
                    font-weight: bold;
                    text-transform: uppercase;
                }
                .dtr-daterange {
                    text-align: center;
                    font-size: 9px;
                    font-weight: bold;
                }
                .dtr-info {
                    font-size: 9px;
                    margin-bottom: 5px;
                }
                .info-row {
                    display: flex;
                    gap: 4px;
                    padding: 1px 0;
                }
                .info-row.two-col {
                    justify-content: space-between;
                }
                .info-half {
                    display: flex;
                    gap: 4px;
                    align-items: flex-end;
                }
                .info-label {
                    font-weight: bold;
                    white-space: nowrap;
                    display: inline-block;
                    width: 90px;
                    flex-shrink: 0;
                }
                .info-label.label-auto {
                    width: auto;
                }
                .info-value {
                    border-bottom: 1px solid transparent;
                }
                .info-value.name {
                    font-weight: bold;
                    text-transform: uppercase;
                }
                /* Payroll No. value with underline under the "1" */
                .info-value.payroll-underline {
                    border-bottom: 1px solid #000;
                    min-width: 24px;
                    text-align: center;
                    display: inline-block;
                }
                .dtr-table {
                    width: 100%;
                    border-collapse: collapse;
                    table-layout: fixed;
                    font-size: 8px;
                    margin-bottom: 4px;
                }
                .dtr-table col.col-date { width: 15%; }
                .dtr-table col.col-day { width: 11%; }
                .dtr-table col.col-time { width: 13%; }
                .dtr-table col.col-small { width: 9%; }
                .dtr-table th,
                .dtr-table td {
                    border: 1px solid #000;
                    text-align: center;
                    padding: 1px 2px;
                    overflow: hidden;
                    white-space: nowrap;
                }
                .dtr-table thead th {
                    font-weight: bold;
                    font-size: 8px;
                    background-color: #fff;
                }
                .dtr-table tbody td {
                    font-size: 8px;
                    height: 13px;
                }
                .dtr-summary {
                    font-size: 9px;
                    margin: 3px 0;
                }
                .summary-line {
                    display: grid;
                    grid-template-columns: 1fr 1fr 1fr;
                    column-gap: 10px;
                    padding: 1px 0;
                }
                .summary-item {
                    display: flex;
                    align-items: flex-end;
                    gap: 3px;
                }
                .summary-item label {
                    font-weight: bold;
                    white-space: nowrap;
                }
                .summary-item .fill {
                    border-bottom: 1px solid #000;
                    min-width: 34px;
                    display: inline-block;
                    text-align: center;
                }
                .dtr-cert {
                    font-size: 7.5px;
                    text-align: center;
                    line-height: 1.35;
                    margin: 6px 0 2px 0;
                    padding: 0 45px;
                }
                .dtr-sig {
                    text-align: center;
                    margin-top: 16px;
                }
                .dtr-sig .sig-line {
                    border-top: 1px solid #000;
                    width: 85%;
                    margin: 0 auto;
                }
                .dtr-sig .sig-caption {
                    font-size: 8px;
                    font-weight: bold;
                    margin-top: 1px;
                }
                .dtr-divider {
                    font-size: 7px;
                    line-height: 1;
                    letter-spacing: -0.5px;
                    margin: 6px 0 2px 0;
                    overflow: hidden;
                    white-space: nowrap;
                }
                .dtr-verified-label {
                    text-align: center;
                    font-size: 8px;
                    font-weight: bold;
                    margin-bottom: 2px;
                }
                .dtr-copy-tag {
                    font-weight: bold;
                    font-size: 8.5px;
                    margin-top: 6px;
                }
                .dtr-recorded {
                    margin-top: 10px;
                    font-size: 8.5px;
                    font-weight: bold;
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    padding: 0 45px;
                    gap: 4px;
                }
                .recorded-row {
                    display: flex;
                    align-items: flex-end;
                    justify-content: flex-start;
                    width: 100%;
                    gap: 0;
                }
                .recorded-row .recorded-label {
                    font-weight: bold;
                    white-space: nowrap;
                    flex-shrink: 0;
                    display: inline-block;
                    width: 78px;
                }
                .recorded-row .recorded-line {
                    flex: 1;
                    border-bottom: 1px solid #000;
                    height: 10px;
                    min-width: 120px;
                    margin-left: 2px;
                }
                @media print {
                    .dtr-page {
                        page-break-inside: avoid;
                    }
                }
            </style>
        </head>
        <body>
            <div class="dtr-page">
                ${employeeCopyHTML}
                <div class="dtr-vertical-divider"></div>
                ${personnelCopyHTML}
            </div>
        </body>
        </html>
    `;
}

async function fetchMyDtrData() {
  const monthSelect = document.getElementById('myDtrMonthSelect');
  const month = monthSelect ? monthSelect.value : '';
  if (!month) { showMyDtrMessage('Please select a month.', 'warning'); return null; }

  const res = await fetch(`${dashboardApiBaseUrl}/api/dtr/record/${currentUser.rfid}?month=${month}`, {
    method: 'GET', headers: getAuthHeaders(), credentials: 'include', cache: 'no-store'
  });
  if (res.status === 401) { redirectToLogin(); return null; }
  if (!res.ok) { showMyDtrMessage('Failed to load DTR.', 'error'); return null; }
  const result = await res.json();
  if (result.status !== 'success' || !result.data) { showMyDtrMessage('No DTR data.', 'error'); return null; }
  return result.data;
}

async function printMyDTR() {
  const data = await fetchMyDtrData();
  if (!data) return;
  const record = data.record;
  const dtr = record.dtr || [];
  const employee = resolveMyEmployeeInfo(currentUser, record.employee);
  const html = buildMyDtrHTML(record, dtr, employee);
  const w = window.open('', '_blank', 'width=1100,height=800');
  if (!w) { showMyDtrMessage('Allow popups to print.', 'warning'); return; }
  w.document.write(html);
  w.document.close();
  w.onload = () => setTimeout(() => w.print(), 400);
}

async function generateMyDTRPDF() {
  const data = await fetchMyDtrData();
  if (!data) return;
  const record = data.record;
  const dtr = record.dtr || [];
  const employee = resolveMyEmployeeInfo(currentUser, record.employee);
  const html = buildMyDtrHTML(record, dtr, employee);
  const w = window.open('', '_blank', 'width=1100,height=800');
  if (!w) { showMyDtrMessage('Allow popups to export PDF.', 'warning'); return; }
  w.document.write(html);
  w.document.close();
  w.onload = () => setTimeout(() => w.print(), 400);
  showMyDtrMessage('Use "Save as PDF" from the print dialog.', 'info');
}

/* ---------------- LOGOUT ---------------- */

const logoutLink = document.getElementById('tapinLogout');
const logoutModal = document.getElementById('logoutConfirmModal');
const logoutYes = document.getElementById('logoutConfirmYes');
const logoutCancel = document.getElementById('logoutConfirmCancel');

if (logoutLink) {
  logoutLink.addEventListener('click', (e) => {
    e.preventDefault();
    logoutModal?.classList.remove('hidden');
  });
}
if (logoutCancel) logoutCancel.addEventListener('click', () => logoutModal?.classList.add('hidden'));
if (logoutModal) {
  logoutModal.addEventListener('click', (e) => { if (e.target === logoutModal) logoutModal.classList.add('hidden'); });
}
if (logoutYes) {
  logoutYes.addEventListener('click', async () => {
    logoutModal?.classList.add('hidden');
    try {
      await fetch(`${dashboardApiBaseUrl}/api/logout`, {
        method: 'POST', headers: getAuthHeaders(), credentials: 'include'
      });
    } finally {
      localStorage.removeItem('tapinToken');
      localStorage.removeItem('tapinUser');
      window.location.replace('../login.html');
    }
  });
}

/* ---------------- INIT ---------------- */

window.addEventListener('pageshow', verifyEmployeeSession);

/* ---------------- EMPLOYEE ACTIVITY TIMELINE ---------------- */
async function loadMyActivityTimeline() {
  const timeline = document.getElementById('myActivityTimeline');
  if (!timeline) return;

  try {
    const response = await fetch(`${dashboardApiBaseUrl}/api/activity-feed?limit=20&rfid=${currentUser?.rfid || ''}`, {
      method: 'GET',
      headers: getAuthHeaders(),
      credentials: 'include',
      cache: 'no-store'
    });

    if (response.status === 401) {
      redirectToLogin();
      return;
    }

    if (!response.ok) {
      console.error('Failed to load activity feed:', response.status);
      timeline.innerHTML = `<div style="display:flex;justify-content:center;align-items:center;padding:20px 0;color:var(--text-muted);font-size:13px;">
        <i class="fa-solid fa-exclamation-triangle"></i> Failed to load activities
      </div>`;
      return;
    }

    const result = await response.json();
    if (result.status === 'success' && result.data) {
      const activities = result.data.activities || [];

      if (!activities || activities.length === 0) {
        timeline.innerHTML = `<div style="display:flex;justify-content:center;align-items:center;padding:20px 0;color:var(--text-muted);font-size:13px;">
          <i class="fa-solid fa-info-circle"></i> No recent activities
        </div>`;
        return;
      }

      timeline.innerHTML = activities.slice(0, 15).map((activity) => {
        const timestamp = new Date(activity.timestamp);
        const timeStr = timestamp.toLocaleTimeString(undefined, {
          hour: '2-digit',
          minute: '2-digit'
        });
        const dateStr = timestamp.toLocaleDateString(undefined, {
          month: 'short',
          day: 'numeric'
        });

        // Determine icon and color based on activity type
        let icon = 'fa-solid fa-circle-info';
        let color = 'var(--primary)';
        let bgColor = 'var(--primary-light)';

        switch (activity.type) {
          case 'attendance':
            if (activity.action === 'attendance_time_in') {
              icon = 'fa-solid fa-sign-in-alt';
              color = 'var(--success)';
              bgColor = 'var(--success-light)';
            } else if (activity.action === 'attendance_time_out') {
              icon = 'fa-solid fa-sign-out-alt';
              color = 'var(--warning)';
              bgColor = 'var(--warning-light)';
            } else {
              icon = 'fa-solid fa-clock';
              color = 'var(--primary)';
              bgColor = 'var(--primary-light)';
            }
            break;
          case 'leave':
            if (activity.action === 'leave_approved') {
              icon = 'fa-solid fa-check-circle';
              color = 'var(--success)';
              bgColor = 'var(--success-light)';
            } else if (activity.action === 'leave_rejected') {
              icon = 'fa-solid fa-times-circle';
              color = 'var(--danger)';
              bgColor = 'var(--danger-light)';
            } else {
              icon = 'fa-solid fa-umbrella-beach';
              color = 'var(--leave)';
              bgColor = 'var(--leave-light)';
            }
            break;
          case 'employee':
            if (activity.action === 'employee_registered') {
              icon = 'fa-solid fa-user-plus';
              color = 'var(--success)';
              bgColor = 'var(--success-light)';
            } else {
              icon = 'fa-solid fa-user-edit';
              color = 'var(--primary)';
              bgColor = 'var(--primary-light)';
            }
            break;
          case 'system':
            if (activity.action === 'user_login') {
              icon = 'fa-solid fa-sign-in-alt';
              color = 'var(--primary)';
              bgColor = 'var(--primary-light)';
            } else if (activity.action === 'user_logout') {
              icon = 'fa-solid fa-sign-out-alt';
              color = 'var(--warning)';
              bgColor = 'var(--warning-light)';
            } else {
              icon = 'fa-solid fa-server';
              color = 'var(--accent)';
              bgColor = 'var(--accent-light)';
            }
            break;
          default:
            icon = 'fa-solid fa-circle-info';
            color = 'var(--primary)';
            bgColor = 'var(--primary-light)';
        }

        // Get user info for display
        let userDisplay = '';
        if (activity.user && activity.user.name) {
          userDisplay = `<span class="timeline-user">${escapeHtml(activity.user.name)}</span>`;
        }

        return `
          <div class="timeline-item">
            <div class="timeline-icon" style="background:${bgColor};color:${color};">
              <i class="${icon}"></i>
            </div>
            <div class="timeline-content">
              <div class="timeline-text">${escapeHtml(activity.details)}</div>
              <div class="timeline-meta">
                <span>${escapeHtml(dateStr)} ${escapeHtml(timeStr)}</span>
                ${userDisplay ? `&nbsp;·&nbsp;${userDisplay}` : ''}
                <span class="timeline-badge" style="background:${bgColor};color:${color};">
                  ${escapeHtml(activity.type)}
                </span>
              </div>
            </div>
          </div>
        `;
      }).join('');
    } else {
        timeline.innerHTML = `<div style="display:flex;justify-content:center;align-items:center;padding:20px 0;color:var(--text-muted);font-size:13px;">
          <i class="fa-solid fa-exclamation-circle"></i> ${result.message || 'Failed to load activities'}
        </div>`;
      }
    } catch (error) {
      console.error('Error loading activity timeline:', error);
      const timeline = document.getElementById('myActivityTimeline');
      if (timeline) {
        timeline.innerHTML = `<div style="display:flex;justify-content:center;align-items:center;padding:20px 0;color:var(--text-muted);font-size:13px;">
          <i class="fa-solid fa-exclamation-triangle"></i> Error loading activities
        </div>`;
      }
    }
}

/* ---------------- VERSION AUTO-PULL ---------------- */
const VERSION_URL = 'https://raw.githubusercontent.com/lolenseu/tapin-rfid-attendance-system/refs/heads/main/version.txt';

function loadAppVersion() {
  const versionEl = document.getElementById('versionNumber');
  if (!versionEl) return;

  // Show loading state
  versionEl.textContent = 'Loading...';

  fetch(VERSION_URL, { cache: 'no-cache' })
    .then((res) => {
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      return res.text();
    })
    .then((text) => {
      if (!text) {
        throw new Error('Empty response');
      }
      const version = text.trim();
      if (version) {
        versionEl.textContent = version;
      } else {
        throw new Error('No version found');
      }
    })
    .catch((error) => {
      console.warn('Could not load version:', error);
      // Fallback to showing we tried
      versionEl.textContent = 'Version unavailable';
    });
}

loadAppVersion();
/* ----------------------------------------------- */
setInterval(updateClock, 1000);
updateClock();
verifyEmployeeSession();
// Load activity timeline periodicallysetInterval(loadMyActivityTimeline, 10000); // Refresh every 10 seconds
loadMyActivityTimeline(); // Initial load