/* =========================================================
   TAPIN — Mobile Employee Dashboard Script
   Same API endpoints as the desktop version; mobile UI only.
   ========================================================= */

const apiBaseUrl = (window.TAPIN_API_URL || '').replace(/\/+$/, '');

let currentUser = null;
let allEmployees = [];
let myLeaveRequests = [];

/* ---------- Auth ---------- */

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

/* Auth headers for multipart/form-data requests (file uploads).
   We must NOT set Content-Type — the browser sets it with the multipart
   boundary automatically. Only the Authorization token is sent. */
function getMultipartAuthHeaders() {
  const token = localStorage.getItem('tapinToken');
  return {
    'Authorization': `Bearer ${token}`
  };
}

function initialsOf(u) {
  return `${u.firstname || ''} ${u.lastname || ''}`
    .trim().split(/\s+/).map(p => p[0] || '').join('').slice(0, 2).toUpperCase() || '--';
}

function escapeHtml(v) {
  return String(v ?? '').replace(/[&<>'"]/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  }[c]));
}

function setText(id, v) {
  const el = document.getElementById(id);
  if (el) el.textContent = v;
}

/* ---------- Clock ---------- */

function updateClock() {
  const now = new Date();
  const dateEl = document.getElementById('dashboardDate');
  const timeEl = document.getElementById('dashboardTime');
  if (dateEl) dateEl.textContent = now.toLocaleDateString(undefined, {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  });
  if (timeEl) timeEl.textContent = now.toLocaleTimeString(undefined, {
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  });
}

/* ---------- Navigation (bottom nav + in-page links) ---------- */

function showPage(pageId) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  const page = document.getElementById(pageId);
  if (page) page.classList.add('active');

  document.querySelectorAll('.bottom-nav-item').forEach(item => {
    item.classList.toggle('active', item.dataset.nav === pageId);
  });

  window.scrollTo({ top: 0, behavior: 'instant' });
}

function initNav() {
  // Bottom nav taps
  document.querySelectorAll('.bottom-nav-item').forEach(item => {
    item.addEventListener('click', (e) => {
      e.preventDefault();
      showPage(item.dataset.nav);
    });
  });

  // In-page quick tiles
  document.querySelectorAll('[data-nav]').forEach(el => {
    el.addEventListener('click', (e) => {
      const target = el.dataset.nav;
      if (!target) return;
      e.preventDefault();
      showPage(target);
    });
  });
}

/* ---------- Session ---------- */

async function verifySession() {
  const token = localStorage.getItem('tapinToken');
  if (!token) { redirectToLogin(); return; }

  try {
    const res = await fetch(`${apiBaseUrl}/api/verify-token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      credentials: 'include',
      cache: 'no-store'
    });
    if (!res.ok) { redirectToLogin(); return; }

    const data = await res.json();
    currentUser = data.user || null;

    // Enrich with dashboard-data user
    await loadDashboardData();
    const enriched = allEmployees.find(e => e.rfid === currentUser?.rfid || e.uid === currentUser?.uid);
    if (enriched) currentUser = { ...currentUser, ...enriched };

    // Load leave requests BEFORE monthly stats so the "Leaves" counter
    // and the "Absent" calc both have the right data to work with.
    await loadLeaveRequests();

    // Load attendance data early so we have latest scan for paintUserInfo
    await loadAttendance();

    paintUserInfo();
    paintProfile();
    await loadDtrMonths();
    await loadMonthlyStats();
  } catch (err) {
    console.error(err);
    redirectToLogin();
  }
}

function paintUserInfo() {
  if (!currentUser) return;
  const name = currentUser.fullname
    || `${currentUser.firstname || ''} ${currentUser.lastname || ''}`.trim()
    || currentUser.username || 'Employee';

  setText('dashboardUserName', name);
  setText('employeeId', currentUser.employeeid || currentUser.uid || '--');
  setText('employeeFullname', name);
  setText('employeeDepartment', currentUser.department || '--');
  setText('employeeRfid', currentUser.rfid || '--');
  setText('employeeLatestScan', currentUser.latest_scan || '--');

  const avatar = document.getElementById('empTopAvatar');
  if (avatar) avatar.textContent = initialsOf(currentUser);
}

function getImageUrl(imagePath) {
  if (!imagePath) return '';
  if (imagePath.startsWith('http')) return imagePath;
  return `${apiBaseUrl}/${imagePath}`;
}

function paintProfile() {
  if (!currentUser) return;
  const name = currentUser.fullname
    || `${currentUser.firstname || ''} ${currentUser.lastname || ''}`.trim()
    || currentUser.username || 'Employee';

  setText('mobileProfileName', name);
  setText('mobileProfileRole', (currentUser.role || 'employee').toUpperCase());
  setText('profileEmpId', currentUser.employeeid || currentUser.uid || '--');
  setText('profileEmail', currentUser.email || '--');
  setText('profilePhone', currentUser.cpnumber || '--');
  setText('profileDept', currentUser.department || '--');
  setText('profilePosition', currentUser.position || '--');
  setText('profileAddress', currentUser.address || '--');

  const avatar = document.getElementById('mobileProfileAvatar');
  if (avatar) {
    const imageUrl = getImageUrl(currentUser.image);
    if (imageUrl) {
      avatar.innerHTML = `<img src="${imageUrl}" alt="${escapeHtml(name)}" onerror="this.style.display='none';this.parentElement.textContent='${initialsOf(currentUser)}';">`;
    } else {
      avatar.textContent = initialsOf(currentUser);
    }
  }
}

/* ---------- Dashboard data + monthly stats ---------- */

async function loadDashboardData() {
  try {
    const res = await fetch(`${apiBaseUrl}/api/dashboard-data`, {
      method: 'GET', headers: getAuthHeaders(), credentials: 'include', cache: 'no-store'
    });
    if (res.status === 401) { redirectToLogin(); return; }
    if (!res.ok) return;
    const result = await res.json();
    allEmployees = (result.data?.users) || [];
  } catch (err) { console.error(err); }
}

async function loadMonthlyStats() {
  if (!currentUser || !currentUser.rfid) return;

  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  try {
    const res = await fetch(`${apiBaseUrl}/api/dtr/record/${currentUser.rfid}?month=${currentMonth}`, {
      method: 'GET', headers: getAuthHeaders(), credentials: 'include', cache: 'no-store'
    });
    if (!res.ok) return;

    const result = await res.json();
    const record = result.data?.record;
    if (!record) return;
    const dtr = record.dtr || [];

    // Approved leave dates for this month
    const approvedLeaveDates = new Set();
    myLeaveRequests.filter(r => (r.status || '').toLowerCase() === 'approved').forEach(r => {
      const s = r.start_date ? new Date(r.start_date) : null;
      const e = r.end_date ? new Date(r.end_date) : null;
      if (!s || !e || isNaN(s) || isNaN(e)) return;
      const mStart = new Date(now.getFullYear(), now.getMonth(), 1);
      const mEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      const from = s < mStart ? mStart : s;
      const to = e > mEnd ? mEnd : e;
      for (let d = new Date(from); d <= to; d.setDate(d.getDate() + 1)) {
        approvedLeaveDates.add(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
      }
    });

    const isHolidayRow = (day) => {
      if (!day) return false;
      const status = String(day.status || '').toLowerCase();
      if (status === 'holiday' || status === 'legal_holiday' || status === 'special_holiday') return true;
      if (day.is_holiday === true || day.holiday === true || day.holiday_name) return true;
      return false;
    };

    let present = 0, absent = 0, hours = 0;
    const today = new Date();

    dtr.forEach(day => {
      const isWeekend = day.day === 'Sat' || day.day === 'Sun';
      const isLeave = day.status === 'on_leave';
      const holiday = isHolidayRow(day);
      const dateStr = (day.date || '').slice(0, 10);
      const dayDate = dateStr ? new Date(dateStr) : null;
      const isFuture = dayDate && dayDate > today;
      const hasScan = !!(day.am_in || day.am_out || day.pm_in || day.pm_out);

      if (holiday) return;

      if (hasScan) present++;
      else if (!isWeekend && !isLeave && !isFuture && dateStr && !approvedLeaveDates.has(dateStr)) absent++;

      const h = Number.parseFloat(day.hours);
      if (!Number.isNaN(h)) hours += h;
    });

    // "Leaves" counter — count approved + pending leaves that overlap the
    // current calendar month, matching the desktop dashboard logic.
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

    setText('statTotalPresent', String(present));
    setText('statTotalAbsent', String(absent));
    setText('statTotalHours', hours.toFixed(2));
    setText('statLeaveCount', String(leaveCount));
  } catch (err) { console.error(err); }
}

/* ---------- DTR ---------- */

async function loadDtrMonths() {
  try {
    const res = await fetch(`${apiBaseUrl}/api/dtr/months`, {
      method: 'GET', headers: getAuthHeaders(), credentials: 'include', cache: 'no-store'
    });
    if (!res.ok) return;
    const result = await res.json();
    if (result.status === 'success' && result.data) {
      const select = document.getElementById('mobileDtrMonthSelect');
      if (!select) return;
      while (select.options.length > 1) select.remove(1);
      result.data.forEach(m => {
        const opt = document.createElement('option');
        opt.value = m.value;
        opt.textContent = m.label;
        select.appendChild(opt);
      });
      const currentMonth = new Date().toISOString().slice(0, 7);
      for (let i = 0; i < select.options.length; i++) {
        if (select.options[i].value === currentMonth) { select.selectedIndex = i; break; }
      }
      if (select.value) loadMyDTR();
    }
  } catch (err) { console.error(err); }
}

async function loadMyDTR() {
  if (!currentUser || !currentUser.rfid) return;
  const select = document.getElementById('mobileDtrMonthSelect');
  const month = select?.value;
  if (!month) return;

  const tbody = document.getElementById('myDtrTableBody');
  if (tbody) {
    tbody.innerHTML = `<tr><td colspan="8" class="empty-cell">Loading…</td></tr>`;
  }

  try {
    const res = await fetch(`${apiBaseUrl}/api/dtr/record/${currentUser.rfid}?month=${month}`, {
      method: 'GET', headers: getAuthHeaders(), credentials: 'include', cache: 'no-store'
    });
    if (!res.ok) { showMsg('myDtrMessage', 'Failed to load DTR.', 'error'); return; }
    const result = await res.json();
    const record = result.data?.record;
    const dtr = record?.dtr || [];

    setText('myDtrTotalHours', record?.total_hours || '0.00');
    setText('myDtrTotalOt', record?.total_ot || '0.00');
    setText('myDtrTotalUt', record?.total_ut || '0.00');

    if (!tbody) return;
    if (!dtr.length) {
      tbody.innerHTML = `<tr><td colspan="8" class="empty-cell">No records for this month.</td></tr>`;
      return;
    }

    tbody.innerHTML = dtr.map(day => {
      const isWeekend = day.day === 'Sat' || day.day === 'Sun';
      const isLeave = day.status === 'on_leave';
      let rowStyle = '';
      if (isLeave) rowStyle = 'background:#FEF3C7;';
      else if (isWeekend) rowStyle = 'background:#F3F4F6;color:#94A3B8;';

      return `<tr style="${rowStyle}">
        <td>${escapeHtml(day.date || '')}</td>
        <td>${escapeHtml(day.am_in || '')}</td>
        <td>${escapeHtml(day.am_out || '')}</td>
        <td>${escapeHtml(day.pm_in || '')}</td>
        <td>${escapeHtml(day.pm_out || '')}</td>
        <td>${escapeHtml(day.hours || '0.00')}</td>
        <td>${escapeHtml(day.ut || '0.00')}</td>
        <td>${escapeHtml(day.ot || '0.00')}</td>
      </tr>`;
    }).join('');
  } catch (err) {
    console.error(err);
  }
}

function showMsg(id, msg, type = 'info') {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = msg;
  el.style.display = 'block';
  el.style.background = type === 'error' ? 'var(--danger-light)' :
                       type === 'success' ? 'var(--success-light)' :
                       'var(--primary-light)';
  el.style.color = type === 'error' ? '#991B1B' :
                   type === 'success' ? '#166534' :
                   'var(--primary-dark)';
  if (type === 'success') setTimeout(() => el.style.display = 'none', 4000);
}

/* ---------- Attendance ---------- */

async function loadAttendance() {
  const list = document.getElementById('myAttendanceList');
  const empty = document.getElementById('myAttendanceEmpty');
  if (!list || !currentUser) return;

  try {
    const res = await fetch(`${apiBaseUrl}/api/dashboard-data`, {
      method: 'GET', headers: getAuthHeaders(), credentials: 'include', cache: 'no-store'
    });
    if (!res.ok) return;
    const result = await res.json();
    const scans = (result.data?.scans || []).filter(s => s.rfid === currentUser.rfid);

    // Set latest scan for dashboard header
    if (scans.length > 0 && currentUser) {
      // Assuming scans are sorted with most recent first
      currentUser.latest_scan = scans[0].scanned_at;
    }

    if (!scans.length) {
      list.innerHTML = '';
      if (empty) empty.style.display = 'block';
      return;
    }
    if (empty) empty.style.display = 'none';

    list.innerHTML = scans.slice(0, 30).map(scan => {
      const d = new Date(scan.scanned_at);
      return `
        <div class="att-item">
          <div class="att-icon"><i class="fa-solid fa-fingerprint"></i></div>
          <div class="att-body">
            <div class="att-title">${escapeHtml(d.toLocaleDateString())}</div>
            <div class="att-sub">${escapeHtml(d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }))}</div>
          </div>
          <span class="badge badge-approved">Present</span>
        </div>`;
    }).join('');
  } catch (err) { console.error(err); }
}

/* ---------- Leave ---------- */

async function loadLeaveRequests() {
  if (!currentUser) return;
  const list = document.getElementById('leaveList');
  const empty = document.getElementById('leaveEmpty');
  if (!list) return;

  try {
    // FIXED: use the per-employee route. The plain /api/leave-requests
    // endpoint returns EVERY employee's leave records (HR/Admin view).
    // We only want this employee's requests, so we hit /api/leave-requests/<rfid>.
    const res = await fetch(`${apiBaseUrl}/api/leave-requests/${encodeURIComponent(currentUser.rfid || '')}`, {
      method: 'GET', headers: getAuthHeaders(), credentials: 'include', cache: 'no-store'
    });
    if (res.ok) {
      const result = await res.json();
      // Show ALL of this employee's requests (pending + approved + rejected)
      // so the "My Leave Requests" list is a complete history, not just
      // the still-pending ones.
      const pending = result.data?.requests || [];
      const approved = result.data?.approved || [];
      const rejected = result.data?.rejected || [];
      myLeaveRequests = [...pending, ...approved, ...rejected];
    } else {
      myLeaveRequests = [];
    }
  } catch (err) { myLeaveRequests = []; }

  if (!myLeaveRequests.length) {
    list.innerHTML = '';
    if (empty) empty.style.display = 'block';
    return;
  }
  if (empty) empty.style.display = 'none';

  list.innerHTML = myLeaveRequests.map((r, i) => {
    const status = (r.status || 'pending').toLowerCase();
    const cls = status === 'approved' ? 'badge-approved'
              : status === 'rejected' ? 'badge-rejected'
              : 'badge-pending';
    const canCancel = status === 'pending';

    // If the backend saved an attachment for this request, render a link
    // so the user can open/download it. The file lives under
    // storage/leave-request/<RFID>/<filename> and is served by the backend.
    const attachmentLink = r.attachment_path
      ? `<div class="leave-attachment" style="margin-top:6px;">
           <a href="javascript:void(0)" onclick="viewAttachment('${encodeURIComponent(r.attachment_path)}')">
             <i class="fa-solid fa-paperclip"></i> View Attachment
           </a>
         </div>`
      : '';

    return `
      <div class="leave-item">
        <div class="leave-header">
          <div class="leave-type">${escapeHtml((r.leave_type || '').toUpperCase())}</div>
          <span class="badge ${cls}">${escapeHtml(status.toUpperCase())}</span>
        </div>
        <div class="leave-dates">${escapeHtml(r.start_date || '--')} → ${escapeHtml(r.end_date || '--')}</div>
        <div class="leave-reason">${escapeHtml(r.reason || '')}</div>
        ${attachmentLink}
        ${canCancel ? `<div class="leave-actions"><button class="btn btn-outline" onclick="cancelLeave(${i})"><i class="fa-solid fa-xmark"></i> Cancel</button></div>` : ''}
      </div>`;
  }).join('');
}

function openLeaveModal() {
  const m = document.getElementById('leaveModal');
  if (m) m.classList.add('show');
  const f = document.getElementById('leaveRequestForm');
  if (f) f.reset();
}
function closeLeaveModal() {
  const m = document.getElementById('leaveModal');
  if (m) m.classList.remove('show');
}

async function submitLeaveRequest(e) {
  e.preventDefault();
  if (!currentUser) return false;

  const formData = new FormData();
  formData.append('rfid', currentUser.rfid);
  formData.append('employeeid', currentUser.employeeid || '');
  formData.append('leave_type', document.getElementById('leaveType').value);
  formData.append('start_date', document.getElementById('leaveStart').value);
  formData.append('end_date', document.getElementById('leaveEnd').value);
  // Reason is optional — we still send whatever the user typed, even if empty.
  formData.append('reason', document.getElementById('leaveReason').value.trim());

  // Handle file upload
  const attachmentInput = document.getElementById('leaveAttachment');
  if (attachmentInput.files && attachmentInput.files[0]) {
    formData.append('attachment', attachmentInput.files[0]);
  }

  // Only start/end dates are required; reason is optional.
  if (!formData.get('start_date') || !formData.get('end_date')) {
    showMsg('leaveMessage', 'Please fill in all fields.', 'error'); return false;
  }
  if (new Date(formData.get('start_date')) > new Date(formData.get('end_date'))) {
    showMsg('leaveMessage', 'Start date must be before end date.', 'error'); return false;
  }

  showMsg('leaveMessage', 'Submitting…', 'info');

  try {
    // FIXED: the backend POST route is /api/request-leave, not /api/leave-requests.
    // The plain /api/leave-requests route is GET-only and returns all employees'
    // leave data, so posting there 405s. We also use getMultipartAuthHeaders()
    // because FormData must NOT have Content-Type: application/json —
    // the browser needs to add the multipart boundary itself.
    const res = await fetch(`${apiBaseUrl}/api/request-leave`, {
      method: 'POST',
      headers: getMultipartAuthHeaders(),
      body: formData,
      credentials: 'include'
    });
    const result = await res.json().catch(() => ({}));
    if (!res.ok) { showMsg('leaveMessage', result.message || 'Failed.', 'error'); return false; }
    showMsg('leaveMessage', 'Leave request submitted!', 'success');
    await loadLeaveRequests();
    await loadMonthlyStats();
    setTimeout(closeLeaveModal, 1200);
  } catch (err) {
    showMsg('leaveMessage', 'Network error.', 'error');
  }
  return false;
}

async function cancelLeave(index) {
  const r = myLeaveRequests[index];
  if (!r) return;
  if (!confirm('Cancel this leave request?')) return;

  try {
    // FIXED: the backend DELETE route is /api/leave-requests/<id>,
    // which we've added to app.py. The previous code hit the same URL
    // but the route didn't exist yet, so it 404'd.
    const res = await fetch(`${apiBaseUrl}/api/leave-requests/${encodeURIComponent(r.id || r.uid || index)}`, {
      method: 'DELETE', headers: getAuthHeaders(), credentials: 'include'
    });
    if (!res.ok) { alert('Failed to cancel.'); return; }
    await loadLeaveRequests();
    await loadMonthlyStats();
  } catch (err) { alert('Network error.'); }
}

/* ---------- Profile edit ---------- */

function openEditProfileModal() {
  if (!currentUser) return;
  const m = document.getElementById('editProfileModal');
  if (!m) return;

  document.getElementById('editFirstname').value = currentUser.firstname || '';
  document.getElementById('editLastname').value = currentUser.lastname || '';
  document.getElementById('editEmail').value = currentUser.email || '';
  document.getElementById('editCpnumber').value = currentUser.cpnumber || '';
  document.getElementById('editBdate').value = currentUser.bdate || '';
  document.getElementById('editAddress').value = currentUser.address || '';
  document.getElementById('editPosition').value = currentUser.position || '';
  document.getElementById('editUsername').value = currentUser.username || '';

  m.classList.add('show');
}

function closeEditProfileModal() {
  const m = document.getElementById('editProfileModal');
  if (m) m.classList.remove('show');
}

async function submitEditProfile(e) {
  e.preventDefault();
  if (!currentUser) return false;

  const msgEl = document.getElementById('editProfileMessage');
  if (msgEl) { msgEl.style.display = 'block'; msgEl.textContent = 'Saving…'; }

  const fd = new FormData();
  fd.append('firstname', document.getElementById('editFirstname').value);
  fd.append('lastname', document.getElementById('editLastname').value);
  fd.append('email', document.getElementById('editEmail').value);
  fd.append('cpnumber', document.getElementById('editCpnumber').value);
  fd.append('bdate', document.getElementById('editBdate').value);
  fd.append('address', document.getElementById('editAddress').value);
  fd.append('position', document.getElementById('editPosition').value);
  fd.append('username', document.getElementById('editUsername').value);
  fd.append('rfid', currentUser.rfid);
  fd.append('role', currentUser.role || 'employee');
  fd.append('department', currentUser.department || '');

  const file = document.getElementById('editProfileImage').files[0];
  if (file) fd.append('image', file);

  try {
    const res = await fetch(`${apiBaseUrl}/api/update-employee/${currentUser.rfid}`, {
      method: 'PUT',
      headers: { 'Authorization': `Bearer ${localStorage.getItem('tapinToken')}` },
      body: fd,
      credentials: 'include'
    });
    const result = await res.json().catch(() => ({}));
    if (!res.ok) {
      showMsg('editProfileMessage', result.message || 'Update failed.', 'error');
      return false;
    }
    currentUser = { ...currentUser, ...(result.data || {}) };
    paintUserInfo();
    paintProfile();
    showMsg('editProfileMessage', 'Profile updated!', 'success');
    setTimeout(closeEditProfileModal, 1000);
  } catch (err) {
    showMsg('editProfileMessage', 'Network error.', 'error');
  }
  return false;
}

/* ---------- Change password ---------- */

async function changePassword() {
  const cur = document.getElementById('currentPassword').value;
  const np = document.getElementById('newPassword').value;
  const cf = document.getElementById('confirmPassword').value;

  if (!cur || !np || !cf) { showMsg('passwordMessage', 'Fill in all fields.', 'error'); return; }
  if (np !== cf) { showMsg('passwordMessage', 'Passwords do not match.', 'error'); return; }

  showMsg('passwordMessage', 'Updating…', 'info');

  try {
    const res = await fetch(`${apiBaseUrl}/api/change-password`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ rfid: currentUser.rfid, current_password: cur, new_password: np }),
      credentials: 'include'
    });
    const result = await res.json().catch(() => ({}));
    if (!res.ok) { showMsg('passwordMessage', result.message || 'Failed.', 'error'); return; }
    showMsg('passwordMessage', 'Password updated!', 'success');
    document.getElementById('currentPassword').value = '';
    document.getElementById('newPassword').value = '';
    document.getElementById('confirmPassword').value = '';
  } catch (err) { showMsg('passwordMessage', 'Network error.', 'error'); }
}

/* ---------- DTR Print / PDF ---------- */

async function fetchMyDtrData() {
  const select = document.getElementById('mobileDtrMonthSelect');
  const month = select?.value;
  if (!month) { showMsg('myDtrMessage', 'Select a month.', 'error'); return null; }
  const res = await fetch(`${apiBaseUrl}/api/dtr/record/${currentUser.rfid}?month=${month}`, {
    method: 'GET', headers: getAuthHeaders(), credentials: 'include', cache: 'no-store'
  });
  if (!res.ok) return null;
  const result = await res.json();
  return result.data || null;
}

function buildMobileDTRHtml(record, dtr, employee) {
  const fullname = (employee.lastname
    ? `${employee.lastname}, ${employee.firstname || ''}`.trim()
    : (employee.fullname || 'Unknown')).toUpperCase();

  const rows = dtr.map(day => `
    <tr>
      <td>${day.date || ''}</td>
      <td>${day.day || ''}</td>
      <td>${day.am_in || ''}</td>
      <td>${day.am_out || ''}</td>
      <td>${day.pm_in || ''}</td>
      <td>${day.pm_out || ''}</td>
      <td>${day.hours || '0.00'}</td>
      <td>${day.ut || '0.00'}</td>
      <td>${day.ot || '0.00'}</td>
    </tr>`).join('');

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>DTR</title>
  <style>
    @page { size: A4; margin: 10mm; }
    body { font-family: Arial, sans-serif; font-size: 10px; }
    h1 { text-align: center; font-size: 14px; margin: 0 0 2px; }
    h2 { text-align: center; font-size: 11px; margin: 0 0 6px; }
    .meta { display: grid; grid-template-columns: 1fr 1fr; gap: 4px; font-size: 10px; margin: 6px 0 10px; }
    table { width: 100%; border-collapse: collapse; }
    th, td { border: 1px solid #000; padding: 3px; text-align: center; font-size: 9px; }
    th { background: #eee; }
  </style></head><body>
  <h1>DAILY TIME RECORD</h1>
  <h2>${fullname}</h2>
  <div class="meta">
    <div><b>Position:</b> ${employee.position || ''}</div>
    <div><b>Department:</b> ${employee.department || ''}</div>
    <div><b>From:</b> ${record.from_date || ''}</div>
    <div><b>To:</b> ${record.to_date || ''}</div>
  </div>
  <table>
    <thead><tr>
      <th>Date</th><th>Day</th><th>AM In</th><th>AM Out</th><th>PM In</th><th>PM Out</th><th>Hrs</th><th>UT</th><th>OT</th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table>
  </body></html>`;
}

async function printMyDTR() {
  const data = await fetchMyDtrData();
  if (!data) return;
  const html = buildMobileDTRHtml(data.record, data.record.dtr || [], {
    ...currentUser, ...(data.record.employee || {})
  });
  const w = window.open('', '_blank');
  if (!w) return;
  w.document.write(html);
  w.document.close();
  w.onload = () => setTimeout(() => w.print(), 400);
}

async function generateMyDTRPDF() { return printMyDTR(); }

/* ---------- Logout ---------- */

function initLogout() {
  const openBtns = [document.getElementById('topLogoutBtn')];
  const modal = document.getElementById('logoutConfirmModal');
  const cancel = document.getElementById('logoutConfirmCancel');
  const confirm = document.getElementById('logoutConfirmYes');

  openBtns.forEach(b => b?.addEventListener('click', () => {
    if (modal) modal.style.display = 'flex';
  }));
  cancel?.addEventListener('click', () => { if (modal) modal.style.display = 'none'; });
  confirm?.addEventListener('click', async () => {
    if (modal) modal.style.display = 'none';
    try {
      await fetch(`${apiBaseUrl}/api/logout`, {
        method: 'POST', headers: getAuthHeaders(), credentials: 'include'
      });
    } finally {
      localStorage.removeItem('tapinToken');
      localStorage.removeItem('tapinUser');
      window.location.replace('../login.html');
    }
  });
}

/* ---------- Version ---------- */

async function loadVersion() {
  const el = document.getElementById('versionNumber');
  if (!el) return;
  try {
    const res = await fetch('https://raw.githubusercontent.com/lolenseu/tapin-rfid-attendance-system/refs/heads/main/version.txt', { cache: 'no-cache' });
    if (res.ok) {
      const text = await res.text();
      el.textContent = text.trim() || 'v0.1.40';
    }
  } catch { el.textContent = 'v0.1.40'; }
}

/* ---------- SETTINGS (bottom sheet) ---------- */

function openSettingsMobile() {
  if (!currentUser) return;
  const modal = document.getElementById('settingsModal');
  if (!modal) return;

  // Load current employee settings and populate the form
  loadEmployeeSettingsForMobile();

  modal.style.display = 'flex';
}

function closeSettingsModal() {
  const modal = document.getElementById('settingsModal');
  if (modal) modal.style.display = 'none';
}

async function loadEmployeeSettingsForMobile() {
  if (!currentUser || !currentUser.rfid) return;

  try {
    const res = await fetch(`${apiBaseUrl}/api/settings/${currentUser.rfid}`, {
      method: 'GET',
      headers: getAuthHeaders(),
      credentials: 'include',
      cache: 'no-store'
    });

    if (res.status === 401) { redirectToLogin(); return; }
    if (!res.ok) {
      console.warn('Failed to load employee settings, using system defaults');
      // Load system settings as fallback
      loadSystemSettingsForMobile();
      return;
    }

    const result = await res.json();
    if (result.status !== 'success' || !result.data) {
      console.warn('Failed to load employee settings, using system defaults');
      loadSystemSettingsForMobile();
      return;
    }

    const settings = result.data.settings;
    const employee = result.data.employee;

    // Populate form with settings values
    if (settings.attendance) {
      document.getElementById('workStartTime').value = settings.attendance.work_start || '08:00';
      document.getElementById('workEndTime').value = settings.attendance.work_end || '17:00';
      document.getElementById('lunchStartTime').value = settings.attendance.lunch_start || '12:00';
      document.getElementById('lunchEndTime').value = settings.attendance.lunch_end || '13:00';
      document.getElementById('gracePeriod').value = settings.attendance.grace_period || 10;
    }

    // Set notification preferences (default to true if not specified)
    document.getElementById('notifyTimeIn').checked = settings.notify_time_in !== false;
    document.getElementById('notifyTimeOut').checked = settings.notify_time_out !== false;
    document.getElementById('notifyLeaveApproval').checked = settings.notify_leave_approval !== false;

  } catch (err) {
    console.error('Load employee settings error:', err);
    // Fall back to system settings
    loadSystemSettingsForMobile();
  }
}

async function loadSystemSettingsForMobile() {
  try {
    const res = await fetch(`${apiBaseUrl}/api/settings`, {
      method: 'GET',
      headers: getAuthHeaders(),
      credentials: 'include',
      cache: 'no-store'
    });

    if (res.status === 401) { redirectToLogin(); return; }
    if (!res.ok) return;

    const result = await res.json();
    if (result.status !== 'success' || !result.data) return;

    const settings = result.data;

    // Populate form with system settings values
    if (settings.attendance) {
      document.getElementById('workStartTime').value = settings.attendance.work_start || '08:00';
      document.getElementById('workEndTime').value = settings.attendance.work_end || '17:00';
      document.getElementById('lunchStartTime').value = settings.attendance.lunch_start || '12:00';
      document.getElementById('lunchEndTime').value = settings.attendance.lunch_end || '13:00';
      document.getElementById('gracePeriod').value = settings.attendance.grace_period || 10;
    }

    // Set notification preferences (default to true if not specified)
    document.getElementById('notifyTimeIn').checked = settings.notify_time_in !== false;
    document.getElementById('notifyTimeOut').checked = settings.notify_time_out !== false;
    document.getElementById('notifyLeaveApproval').checked = settings.notify_leave_approval !== false;

  } catch (err) {
    console.error('Load system settings error:', err);
    // Set default values
    document.getElementById('workStartTime').value = '08:00';
    document.getElementById('workEndTime').value = '17:00';
    document.getElementById('lunchStartTime').value = '12:00';
    document.getElementById('lunchEndTime').value = '13:00';
    document.getElementById('gracePeriod').value = 10;
    document.getElementById('notifyTimeIn').checked = true;
    document.getElementById('notifyTimeOut').checked = true;
    document.getElementById('notifyLeaveApproval').checked = true;
  }
}

async function saveSettingsMobile() {
  if (!currentUser || !currentUser.rfid) return;

  const settingsData = {
    attendance: {
      work_start: document.getElementById('workStartTime').value,
      work_end: document.getElementById('workEndTime').value,
      lunch_start: document.getElementById('lunchStartTime').value,
      lunch_end: document.getElementById('lunchEndTime').value,
      grace_period: parseInt(document.getElementById('gracePeriod').value) || 10
    },
    notify_time_in: document.getElementById('notifyTimeIn').checked,
    notify_time_out: document.getElementById('notifyTimeOut').checked,
    notify_leave_approval: document.getElementById('notifyLeaveApproval').checked
  };

  try {
    const res = await fetch(`${apiBaseUrl}/api/settings/${currentUser.rfid}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${localStorage.getItem('tapinToken')}`
      },
      credentials: 'include',
      body: JSON.stringify(settingsData)
    });

    if (res.status === 401) { redirectToLogin(); return; }
    if (!res.ok) {
      throw new Error(`Failed to save settings: ${res.status}`);
    }

    const result = await res.json();
    if (result.status !== 'success') {
      throw new Error(result.message || 'Failed to save settings');
    }

    // Show success message
    showSettingsMessageMobile('Settings saved successfully!', 'success');

    // Close modal after delay
    setTimeout(() => {
      closeSettingsModal();
    }, 1200);

  } catch (err) {
    console.error('Save settings error:', err);
    showSettingsMessageMobile('Failed to save settings. Please try again.', 'error');
  }
}

function showSettingsMessageMobile(msg, type = 'info') {
  const modalBody = document.getElementById('settingsModal').querySelector('.sheet');
  if (!modalBody) return;

  // Remove any existing message
  const existingMsg = document.getElementById('settingsMessageMobile');
  if (existingMsg) existingMsg.remove();

  const msgEl = document.createElement('div');
  msgEl.id = 'settingsMessageMobile';
  msgEl.style.marginTop = '16px';
  msgEl.style.padding = '12px';
  msgEl.style.borderRadius = '8px';
  msgEl.style.textAlign = 'center';
  msgEl.style.fontWeight = '600';
  msgEl.style.width = '100%';
  msgEl.style.boxSizing = 'border-box';

  if (type === 'success') {
    msgEl.style.backgroundColor = '#dcfce7';
    msgEl.style.color = '#166534';
    msgEl.style.border = '1px solid #bbf7d0';
  } else if (type === 'error') {
    msgEl.style.backgroundColor = '#fee2e2';
    msgEl.style.color = '#991b1b';
    msgEl.style.border = '1px solid #fecaca';
  } else {
    msgEl.style.backgroundColor = '#dbeafe';
    msgEl.style.color = '#1d4ed8';
    msgEl.style.border = '1px solid #bfdbfe';
  }

  msgEl.innerHTML = msg;
  modalBody.prepend(msgEl);

  // Remove message after 3 seconds for success/info
  if (type !== 'error') {
    setTimeout(() => {
      if (msgEl.parentNode) msgEl.remove();
    }, 3000);
  }
}

/* ---------- Attachment Modal ---------- */

function viewAttachment(filePath) {
  if (!filePath) return;

  const modal = document.getElementById('attachmentModal');
  const contentEl = document.getElementById('attachmentContent');
  if (!modal || !contentEl) return;

  // Clear previous content
  contentEl.innerHTML = '';

  // Show loading indicator
  contentEl.innerHTML = '<div class="loading">Loading attachment...</div>';

  modal.classList.add('show');

  // Determine file type and display accordingly
  const fileExtension = filePath.split('.').pop().toLowerCase();
  const fullUrl = `${apiBaseUrl}/${filePath}`;

  // For images
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'].includes(fileExtension)) {
    contentEl.innerHTML = `<img src="${fullUrl}" alt="Attachment" style="max-width:100%; height:auto; border-radius:8px;" onerror="this.onerror=null;this.src='https://via.placeholder.com/400x300?text=Image+Not+Available'; this.style.display='block';">`;
  }
  // For PDFs
  else if (fileExtension === 'pdf') {
    contentEl.innerHTML = `
      <div style="position:relative; width:100%; height:500px;">
        <iframe src="${fullUrl}" style="width:100%; height:100%; border:none; border-radius:8px;" allowfullscreen></iframe>
      </div>
      <div style="margin-top:10px;">
        <a href="${fullUrl}" target="_blank" rel="noopener" class="btn btn-outline">
          <i class="fa-solid fa-download"></i> Download PDF
        </a>
      </div>
    `;
  }
  // For text files
  else if (['txt', 'log', 'md', 'csv', 'json', 'xml', 'html', 'htm'].includes(fileExtension)) {
    fetch(fullUrl)
      .then(response => {
        if (!response.ok) throw new Error('Failed to fetch file');
        return response.text();
      })
      .then(text => {
        contentEl.innerHTML = `<div style="text-align:left; background:#f8f9fa; padding:15px; border-radius:8px; font-family:monospace; white-space:pre-wrap; max-height:400px; overflow-y:auto;">${escapeHtml(text)}</div>`;
      })
      .catch(error => {
        contentEl.innerHTML = `<div style="color:#dc2626;">Error loading file: ${error.message}</div>`;
        // Fallback to download link
        contentEl.innerHTML += `<div style="margin-top:15px;"><a href="${fullUrl}" target="_blank" rel="noopener" class="btn btn-outline"><i class="fa-solid fa-download"></i> Download File</a></div>`;
      });
  }
  // For other files (show download link)
  else {
    contentEl.innerHTML = `
      <div style="text-align:center; padding:40px;">
        <i class="fa-solid fa-file" style="font-size:48px; color:#6b7280; margin-bottom:20px;"></i>
        <h3>Attachment</h3>
        <p>File type not supported for preview</p>
        <a href="${fullUrl}" target="_blank" rel="noopener" class="btn btn-primary">
          <i class="fa-solid fa-download"></i> Download File
        </a>
      </div>
    `;
  }
}

function closeAttachmentModal() {
  const modal = document.getElementById('attachmentModal');
  if (modal) modal.classList.remove('show');
}

/* ---------- Init ---------- */

initNav();
initLogout();
setInterval(updateClock, 1000);
updateClock();
window.addEventListener('pageshow', verifySession);
verifySession();
loadVersion();

// Settings button event listener
const settingsBtn = document.getElementById('topSettingsBtn');
if (settingsBtn) {
  settingsBtn.addEventListener('click', () => {
    openSettingsMobile();
  });
}