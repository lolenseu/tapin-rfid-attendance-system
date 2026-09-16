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
  if (sidebarOverlay) sidebarOverlay.classList.toggle('visible', isMobile && isOpen);
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
    await loadMyLeaveRequests();
    await loadDtrMonths();
    await loadMyAttendance();
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
    updateMonthlyStats(data);
  } catch (err) {
    console.error('Load dashboard users error:', err);
  }
}

/* ---------------- MONTHLY STATS ---------------- */

function updateMonthlyStats(data) {
  const me = allEmployees.find(e => e.rfid === currentUser?.rfid || e.uid === currentUser?.uid);
  const myScans = (data.scans || []).filter(s => me && s.rfid === me.rfid);

  // Determine current month
  const now = new Date();
  const currentMonth = now.getMonth();
  const currentYear = now.getFullYear();

  const monthScans = myScans.filter(s => {
    const d = new Date(s.scanned_at);
    return d.getMonth() === currentMonth && d.getFullYear() === currentYear;
  });

  // Unique working days present (distinct dates)
  const datesPresent = new Set();
  monthScans.forEach(s => {
    const d = new Date(s.scanned_at);
    datesPresent.add(d.toDateString());
  });
  const totalPresent = datesPresent.size;

  // Total working days in this month (exclude Sat/Sun)
  const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
  let workingDays = 0;
  for (let i = 1; i <= daysInMonth; i++) {
    const d = new Date(currentYear, currentMonth, i);
    const day = d.getDay();
    if (day !== 0 && day !== 6) workingDays++;
  }
  const totalAbsent = Math.max(workingDays - totalPresent, 0);

  // Total hours (from DTR aggregate if present)
  let totalHours = 0;
  myScans.forEach(s => { totalHours += parseFloat(s.hours || 0); });

  // Leave counts
  const approvedLeaves = myLeaveRequests.filter(r => r.status === 'approved').length;
  const pendingLeaves = myLeaveRequests.filter(r => r.status === 'pending').length;

  // Update DOM
  setText('statTotalPresent', totalPresent);
  setText('statTotalAbsent', totalAbsent);
  setText('statTotalHours', totalHours.toFixed(2));
  setText('statLeaveCount', approvedLeaves + pendingLeaves);

  // Progress bars (relative to workingDays max)
  const pct = (v) => workingDays > 0 ? Math.min((v / workingDays) * 100, 100) : 0;
  setWidth('statPresentBar', pct(totalPresent));
  setWidth('statAbsentBar', pct(totalAbsent));
  setWidth('statHoursBar', Math.min((totalHours / (workingDays * 8 || 1)) * 100, 100));
  setWidth('statLeaveBar', Math.min(((approvedLeaves + pendingLeaves) / 15) * 100, 100));
}

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

function setWidth(id, pct) {
  const el = document.getElementById(id);
  if (el) el.style.width = `${pct}%`;
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
      let rowStyle = '';
      let statusText = day.status || '';
      if (isLeave) { rowStyle = 'background-color:#FEF3C7;'; statusText = 'ON LEAVE'; }
      else if (isWeekend) { rowStyle = 'background-color:#F3F4F6;color:#9CA3AF;'; statusText = 'Weekend'; }

      return `<tr style="${rowStyle}">
        <td>${escapeHtml(day.day || '')}</td>
        <td>${escapeHtml(day.date || '')}</td>
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
    const res = await fetch(`${dashboardApiBaseUrl}/api/leave-requests?rfid=${encodeURIComponent(rfid)}`, {
      method: 'GET', headers: getAuthHeaders(), credentials: 'include', cache: 'no-store'
    });
    if (res.status === 401) { redirectToLogin(); return; }

    if (res.ok) {
      const result = await res.json();
      myLeaveRequests = result.data?.requests || [];
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
      <td>${escapeHtml(r.filed_at || '--')}</td>
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

  const payload = {
    rfid: currentUser.rfid,
    employeeid: currentUser.employeeid || '',
    leave_type: document.getElementById('leaveType').value,
    start_date: document.getElementById('leaveStart').value,
    end_date: document.getElementById('leaveEnd').value,
    reason: document.getElementById('leaveReason').value.trim()
  };

  if (!payload.start_date || !payload.end_date || !payload.reason) {
    showLeaveMessage('Please fill in all required fields.', 'warning');
    return false;
  }
  if (new Date(payload.start_date) > new Date(payload.end_date)) {
    showLeaveMessage('Start date cannot be after end date.', 'warning');
    return false;
  }

  showLeaveMessage('<i class="fa-solid fa-spinner fa-spin"></i> Submitting...', 'info');

  try {
    const res = await fetch(`${dashboardApiBaseUrl}/api/leave-requests`, {
      method: 'POST',
      headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
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
  const fullname = employee.fullname || `${employee.firstname || ''} ${employee.lastname || ''}`.trim() || '--';
  const position = employee.position || '';
  const department = employee.department || '';
  const employeeId = employee.employeeid || '';
  const fromDate = record.from_date || '';
  const toDate = record.to_date || '';
  const totalHours = record.total_hours || '0.00';
  const totalOt = record.total_ot || '0.00';
  const totalUt = record.total_ut || '0.00';
  const workingDays = dtr.filter(d => d.status !== 'on_leave' && d.day !== 'Sat' && d.day !== 'Sun').length;

  // Two-column table
  let rows = '';
  const half = Math.ceil(dtr.length / 2);
  for (let i = 0; i < half; i++) {
    const left = dtr[i] || {};
    const right = dtr[i + half] || {};
    const cell = (v) => `<td style="border:1px solid #000;padding:3px 2px;font-size:9px;text-align:center;">${v || ''}</td>`;
    rows += `<tr>
      ${cell(left.day ? `${left.day} - ${left.date || ''}` : '')}
      ${cell(left.am_in)} ${cell(left.am_out)}
      ${cell(left.pm_in)} ${cell(left.pm_out)}
      ${cell(left.hours)} ${cell(left.ut)} ${cell(left.ot)}
      ${cell(right.day ? `${right.day} - ${right.date || ''}` : '')}
      ${cell(right.am_in)} ${cell(right.am_out)}
      ${cell(right.pm_in)} ${cell(right.pm_out)}
      ${cell(right.hours)} ${cell(right.ut)} ${cell(right.ot)}
    </tr>`;
  }

  return `<!DOCTYPE html><html><head><meta charset="UTF-8">
  <title>DTR - ${escapeHtml(fullname)}</title>
  <style>
    @page { size: legal; margin: 8mm 10mm; }
    body { font-family: 'Times New Roman', serif; font-size: 11px; }
    .title { text-align:center; font-size:16px; font-weight:bold; letter-spacing:2px; border-bottom:2px solid #000; padding-bottom:4px; margin-bottom:6px;}
    .header { display:flex; justify-content:space-between; font-size:11px; margin-bottom:6px; }
    .info { display:grid; grid-template-columns:1.5fr 1fr 1fr 1fr; gap:2px; font-size:11px; padding:4px 0; border-bottom:1px solid #000; margin-bottom:6px;}
    table { width:100%; border-collapse:collapse; font-size:9px; }
    th { border:1px solid #000; padding:2px; background:#eee; font-size:8px; }
    .summary { display:grid; grid-template-columns:1fr 1fr 1fr 1fr 1fr; gap:2px; font-size:10px; padding:4px 0; border-top:1px solid #000; margin-top:2px;}
    .cert { font-style:italic; font-size:10px; padding:4px 0; border-top:1px solid #000; margin-top:4px;}
    .sig { display:grid; grid-template-columns:1fr 1fr 1fr 1fr; gap:10px; margin-top:8px; padding-top:8px; border-top:1px solid #000; font-size:10px; text-align:center;}
    .sig-line { margin-top:20px; border-top:1px solid #000; padding-top:2px;}
    .copy { text-align:center; font-weight:bold; font-size:10px; margin-top:4px; padding:2px; border:1px solid #000; background:#f9f9f9;}
  </style></head><body>
    <div class="title">DAILY TIME RECORD</div>
    <div class="header">
      <div><b>From :</b> ${fromDate} &nbsp; <b>To :</b> ${toDate}</div>
      <div><b>Payroll No. :</b> ${employeeId}</div>
    </div>
    <div class="info">
      <div><b>Name :</b> ${escapeHtml(fullname)}</div>
      <div><b>Position :</b> ${escapeHtml(position)}</div>
      <div><b>Department :</b> ${escapeHtml(department)}</div>
      <div><b>Regular Time :</b> DEFAULT</div>
    </div>
    <table>
      <thead>
        <tr>
          <th colspan="9">WORKING</th>
          <th colspan="9">WORKING</th>
        </tr>
        <tr>
          <th>Date</th><th>In 1</th><th>Out 1</th><th>In 2</th><th>Out 2</th><th>HOURS</th><th>UT</th><th>OT</th>
          <th>Date</th><th>In 1</th><th>Out 1</th><th>In 2</th><th>Out 2</th><th>HOURS</th><th>UT</th><th>OT</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
    <div class="summary">
      <div><b>A =</b> ${workingDays.toFixed(2)}</div>
      <div><b>ROT =</b> 0.00</div>
      <div><b>LOT =</b> </div>
      <div><b>U =</b> ${totalUt}</div>
      <div><b>SOT =</b> </div>
    </div>
    <div class="cert">I Certify on my honor that the above is a true and correct report of the hours work performed, record of which was daily at the time of arrival and departure from office.</div>
    <div class="sig">
      <div><div class="sig-line"></div>Signature</div>
      <div><div class="sig-line"></div>In Charge</div>
      <div><div class="sig-line"></div>Signature</div>
      <div><div class="sig-line"></div>In Charge</div>
    </div>
    <div class="copy">>>>> EMPLOYEE'S COPY</div>
  </body></html>`;
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
  const employee = { ...currentUser, ...(record.employee || {}) };
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
  const employee = { ...currentUser, ...(record.employee || {}) };
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
setInterval(updateClock, 1000);
updateClock();
verifyEmployeeSession();