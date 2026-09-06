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
    
    // Update progress bars based on stats
    updateStatProgressBars(stats);
}

// Update stat card progress bars based on actual data
function updateStatProgressBars(stats) {
    const total = stats.total_employees || 1;
    const present = stats.present_today || 0;
    const absent = stats.absent_today || 0;
    const onLeave = stats.on_leave || 0;
    const attendanceRate = stats.attendance_rate || 0;
    const rfidScans = stats.rfid_scans_today || 0;
    
    // Total Employees bar (always full)
    const totalBar = document.querySelector('.stat-blue .stat-progress-bar');
    if (totalBar) totalBar.style.width = '100%';
    
    // Present Today bar
    const presentBar = document.querySelector('.stat-green .stat-progress-bar');
    if (presentBar) {
        const pct = total > 0 ? (present / total) * 100 : 0;
        presentBar.style.width = `${Math.min(pct, 100)}%`;
    }
    
    // Absent Today bar
    const absentBar = document.querySelector('.stat-red .stat-progress-bar');
    if (absentBar) {
        const pct = total > 0 ? (absent / total) * 100 : 0;
        absentBar.style.width = `${Math.min(pct, 100)}%`;
    }
    
    // On Leave bar
    const leaveBar = document.querySelector('.stat-purple .stat-progress-bar');
    if (leaveBar) {
        const pct = total > 0 ? (onLeave / total) * 100 : 0;
        leaveBar.style.width = `${Math.min(pct, 100)}%`;
    }
    
    // Attendance Rate bar
    const rateBar = document.querySelector('.stat-cyan .stat-progress-bar');
    if (rateBar) {
        rateBar.style.width = `${Math.min(attendanceRate, 100)}%`;
    }
    
    // RFID Scans bar
    const rfidBar = document.querySelector('.stat-blue:last-child .stat-progress-bar');
    if (rfidBar) {
        // Use a reasonable max (e.g., 100 scans) or scale dynamically
        const maxScans = 100;
        const pct = Math.min((rfidScans / maxScans) * 100, 100);
        rfidBar.style.width = `${pct}%`;
    }
}

function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>'"]/g, (character) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
    }[character]));
}

function initials(user) {
    return `${user.firstname || ''} ${user.lastname || ''}`.trim().split(/\s+/).map((part) => part[0] || '').join('').slice(0, 2).toUpperCase() || '--';
}

// ============ EMPLOYEE DIRECTORY FUNCTIONS ============

// Store all employees for filtering
let allEmployees = [];
let filteredEmployees = [];
let employeeCardsExpanded = false;
let previousEmployeesData = '';

// Update the employees grid with cards
function updateEmployeesGrid(users) {
    const grid = document.getElementById('employeesGrid');
    if (!grid) return;
    
    // Store all employees for filtering (only update if data changed)
    const currentData = JSON.stringify(users || []);
    if (currentData !== previousEmployeesData) {
        allEmployees = users || [];
        filteredEmployees = [...allEmployees];
        previousEmployeesData = currentData;
        // Populate department filter dropdown
        populateDepartmentFilter(allEmployees);
        // Reset filter values to 'all' when data changes
        document.getElementById('employeeRoleFilter').value = 'all';
        document.getElementById('employeeDeptFilter').value = 'all';
        document.getElementById('employeeSearchInput').value = '';
    }
    
    // Render the grid
    renderEmployeeCards(filteredEmployees);
}

// Populate department filter dropdown with unique departments
function populateDepartmentFilter(employees) {
    const deptFilter = document.getElementById('employeeDeptFilter');
    if (!deptFilter) return;
    
    // Get unique departments
    const departments = new Set();
    employees.forEach(emp => {
        if (emp.department && emp.department.trim()) {
            departments.add(emp.department.trim());
        }
    });
    
    // Clear existing options except the first one (All Departments)
    while (deptFilter.options.length > 1) {
        deptFilter.remove(1);
    }
    
    // Sort departments alphabetically
    const sortedDepts = Array.from(departments).sort();
    
    // Add departments to dropdown
    sortedDepts.forEach(dept => {
        const option = document.createElement('option');
        option.value = dept;
        option.textContent = dept;
        deptFilter.appendChild(option);
    });
}

// Render employee cards with limit (6 cards initially)
function renderEmployeeCards(employees) {
    const grid = document.getElementById('employeesGrid');
    if (!grid) return;
    
    const footer = document.getElementById('employeeGridFooter');
    const countDisplay = document.getElementById('employeeCountDisplay');
    
    if (!employees || employees.length === 0) {
        grid.innerHTML = `
            <div class="empty-state" style="grid-column:1/-1;padding:40px 20px;">
                <i class="fa-solid fa-users-slash"></i>
                <p style="font-size:14px;color:var(--text-muted);">No employees found matching your filters.</p>
            </div>
        `;
        if (footer) footer.style.display = 'none';
        return;
    }
    
    // Determine how many cards to show (6 initially, all if expanded)
    const showCount = employeeCardsExpanded ? employees.length : Math.min(employees.length, 6);
    const visibleEmployees = employees.slice(0, showCount);
    
    // Generate card HTML - Simplified display: ID, Name, Email, Department, Role only
    grid.innerHTML = visibleEmployees.map((user, index) => {
        const fullname = `${user.firstname || ''} ${user.lastname || ''}`.trim() || 'Unknown';
        const initialsText = fullname.split(' ').map(w => w[0] || '').join('').slice(0, 2).toUpperCase() || '--';
        const role = user.role || 'employee';
        const roleColor = role === 'admin' ? 'var(--danger)' : role === 'hr' ? 'var(--primary)' : 'var(--success)';
        const roleBg = role === 'admin' ? 'var(--danger-light)' : role === 'hr' ? 'var(--primary-light)' : 'var(--success-light)';
        const employeeId = user.employeeid || user.uid || 'N/A';
        const email = user.email || 'N/A';
        const department = user.department || 'N/A';
        
        return `
            <div class="emp-card" data-index="${index}" data-role="${escapeHtml(role)}" data-name="${escapeHtml(fullname.toLowerCase())}" data-id="${escapeHtml(employeeId)}" data-email="${escapeHtml(email)}">
                <div class="emp-card-header" style="background:linear-gradient(135deg, ${roleColor}, ${role === 'admin' ? '#DC2626' : role === 'hr' ? '#2563EB' : '#16A34A'});">
                    <div class="emp-card-avatar" style="display:flex;align-items:center;justify-content:center;font-size:26px;font-weight:800;color:white;">
                        ${escapeHtml(initialsText)}
                    </div>
                    <div class="emp-card-name">${escapeHtml(fullname)}</div>
                    <div class="emp-card-pos">${escapeHtml(role.toUpperCase())}</div>
                </div>
                <div class="emp-card-body">
                    <div class="emp-card-info">
                        <div class="emp-info-row">
                            <i class="fa-solid fa-id-badge"></i>
                            <span class="emp-info-val">${escapeHtml(employeeId)}</span>
                        </div>
                        <div class="emp-info-row">
                            <i class="fa-solid fa-envelope"></i>
                            <span class="emp-info-val">${escapeHtml(email)}</span>
                        </div>
                        <div class="emp-info-row">
                            <i class="fa-solid fa-building"></i>
                            <span class="emp-info-val">${escapeHtml(department)}</span>
                        </div>
                        <div class="emp-info-row">
                            <i class="fa-solid fa-user-tag"></i>
                            <span class="emp-info-val" style="display:inline-flex;align-items:center;gap:6px;">
                                <span class="badge" style="background:${roleBg};color:${roleColor};font-size:10px;padding:2px 10px;">${escapeHtml(role.toUpperCase())}</span>
                            </span>
                        </div>
                    </div>
                    <div style="display:flex;gap:8px;margin-top:8px;">
                        <button class="btn btn-outline btn-sm" onclick="viewEmployee('${escapeHtml(user.uid || '')}')" style="flex:1;justify-content:center;">
                            <i class="fa-solid fa-eye"></i> View
                        </button>
                        <button class="btn btn-primary btn-sm" onclick="editEmployee('${escapeHtml(user.uid || '')}')" style="flex:1;justify-content:center;">
                            <i class="fa-solid fa-edit"></i> Edit
                        </button>
                    </div>
                </div>
            </div>
        `;
    }).join('');
    
    // Handle footer visibility
    if (footer) {
        if (employees.length > 6) {
            footer.style.display = 'block';
            const btn = document.getElementById('employeeToggleBtn');
            if (btn) {
                btn.innerHTML = employeeCardsExpanded 
                    ? '<i class="fa-solid fa-chevron-up"></i> View Less Employees' 
                    : `<i class="fa-solid fa-chevron-down"></i> View More Employees (${employees.length - 6} more)`;
            }
            if (countDisplay) {
                countDisplay.textContent = `Showing ${visibleEmployees.length} of ${employees.length} employees`;
            }
        } else {
            footer.style.display = 'none';
        }
    }
}

// Toggle employee cards between 6 and all
function toggleEmployeeCards() {
    employeeCardsExpanded = !employeeCardsExpanded;
    renderEmployeeCards(filteredEmployees);
    
    // Scroll to grid after toggle
    const grid = document.getElementById('employeesGrid');
    if (grid) {
        setTimeout(() => {
            grid.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 100);
    }
}

// Toggle filter bar visibility
function toggleEmployeeFilter() {
    const filterBar = document.getElementById('employeeFilterBar');
    if (filterBar) {
        const isVisible = filterBar.style.display !== 'none';
        filterBar.style.display = isVisible ? 'none' : 'block';
        
        // Update button text
        const btn = document.querySelector('.section-actions .btn-outline');
        if (btn) {
            btn.innerHTML = isVisible ? '<i class="fa-solid fa-filter"></i> Filter' : '<i class="fa-solid fa-filter"></i> Hide Filter';
        }
    }
}

// Filter employees based on search and dropdowns
function filterEmployees() {
    const searchInput = document.getElementById('employeeSearchInput');
    const roleFilter = document.getElementById('employeeRoleFilter');
    const deptFilter = document.getElementById('employeeDeptFilter');
    
    const searchTerm = searchInput ? searchInput.value.toLowerCase().trim() : '';
    const role = roleFilter ? roleFilter.value : 'all';
    const department = deptFilter ? deptFilter.value : 'all';
    
    filteredEmployees = allEmployees.filter(emp => {
        // Search filter
        let matchesSearch = true;
        if (searchTerm) {
            const fullname = `${emp.firstname || ''} ${emp.lastname || ''}`.toLowerCase();
            const employeeId = (emp.employeeid || '').toLowerCase();
            const email = (emp.email || '').toLowerCase();
            matchesSearch = fullname.includes(searchTerm) || 
                           employeeId.includes(searchTerm) || 
                           email.includes(searchTerm);
        }
        
        // Role filter
        let matchesRole = true;
        if (role !== 'all') {
            matchesRole = (emp.role || 'employee').toLowerCase() === role;
        }
        
        // Department filter
        let matchesDept = true;
        if (department !== 'all') {
            const empDept = (emp.department || '').toLowerCase();
            matchesDept = empDept === department.toLowerCase();
        }
        
        return matchesSearch && matchesRole && matchesDept;
    });
    
    // Reset expansion state when filtering
    employeeCardsExpanded = false;
    renderEmployeeCards(filteredEmployees);
}

// Clear all filters
function clearEmployeeFilters() {
    const searchInput = document.getElementById('employeeSearchInput');
    const roleFilter = document.getElementById('employeeRoleFilter');
    const deptFilter = document.getElementById('employeeDeptFilter');
    
    if (searchInput) searchInput.value = '';
    if (roleFilter) roleFilter.value = 'all';
    if (deptFilter) deptFilter.value = 'all';
    
    employeeCardsExpanded = false;
    filteredEmployees = [...allEmployees];
    renderEmployeeCards(filteredEmployees);
}

// ============ VIEW EMPLOYEE MODAL ============

// Get employee by UID
function getEmployeeByUid(uid) {
    return allEmployees.find(emp => emp.uid === uid);
}

// View employee details in modal
function viewEmployee(uid) {
    const employee = getEmployeeByUid(uid);
    if (!employee) {
        showNotification('Employee not found.', 'error');
        return;
    }
    
    const fullname = `${employee.firstname || ''} ${employee.lastname || ''}`.trim() || 'Unknown';
    const role = employee.role || 'employee';
    const roleColor = role === 'admin' ? 'var(--danger)' : role === 'hr' ? 'var(--primary)' : 'var(--success)';
    const roleBg = role === 'admin' ? 'var(--danger-light)' : role === 'hr' ? 'var(--primary-light)' : 'var(--success-light)';
    
    // Build modal HTML
    const modalHtml = `
        <div class="modal-overlay" id="viewEmployeeModal" onclick="if(event.target===this) closeViewEmployeeModal()">
            <div class="modal-content view-modal">
                <div class="modal-header" style="background:linear-gradient(135deg, ${roleColor}, ${role === 'admin' ? '#DC2626' : role === 'hr' ? '#2563EB' : '#16A34A'});">
                    <div class="modal-avatar">${escapeHtml(fullname.split(' ').map(w => w[0] || '').join('').slice(0, 2).toUpperCase() || '--')}</div>
                    <div class="modal-user-info">
                        <h2>${escapeHtml(fullname)}</h2>
                        <span class="badge" style="background:${roleBg};color:${roleColor};font-size:12px;padding:4px 14px;">${escapeHtml(role.toUpperCase())}</span>
                    </div>
                    <button class="modal-close" onclick="closeViewEmployeeModal()">&times;</button>
                </div>
                <div class="modal-body">
                    <div class="detail-grid">
                        <div class="detail-item">
                            <span class="detail-label"><i class="fa-solid fa-id-badge"></i> Employee ID</span>
                            <span class="detail-value">${escapeHtml(employee.employeeid || employee.uid || 'N/A')}</span>
                        </div>
                        <div class="detail-item">
                            <span class="detail-label"><i class="fa-solid fa-envelope"></i> Email</span>
                            <span class="detail-value">${escapeHtml(employee.email || 'N/A')}</span>
                        </div>
                        <div class="detail-item">
                            <span class="detail-label"><i class="fa-solid fa-building"></i> Department</span>
                            <span class="detail-value">${escapeHtml(employee.department || 'N/A')}</span>
                        </div>
                        <div class="detail-item">
                            <span class="detail-label"><i class="fa-solid fa-briefcase"></i> Position</span>
                            <span class="detail-value">${escapeHtml(employee.position || 'N/A')}</span>
                        </div>
                        <div class="detail-item">
                            <span class="detail-label"><i class="fa-solid fa-phone"></i> Contact Number</span>
                            <span class="detail-value">${escapeHtml(employee.cpnumber || 'N/A')}</span>
                        </div>
                        <div class="detail-item">
                            <span class="detail-label"><i class="fa-solid fa-calendar"></i> Birth Date</span>
                            <span class="detail-value">${escapeHtml(employee.bdate || 'N/A')}</span>
                        </div>
                        <div class="detail-item">
                            <span class="detail-label"><i class="fa-solid fa-home"></i> Address</span>
                            <span class="detail-value">${escapeHtml(employee.address || 'N/A')}</span>
                        </div>
                        <div class="detail-item">
                            <span class="detail-label"><i class="fa-solid fa-user-tag"></i> Role</span>
                            <span class="detail-value"><span class="badge" style="background:${roleBg};color:${roleColor};">${escapeHtml(role.toUpperCase())}</span></span>
                        </div>
                        <div class="detail-item">
                            <span class="detail-label"><i class="fa-solid fa-id-card"></i> RFID</span>
                            <span class="detail-value"><code>${escapeHtml(employee.rfid || 'N/A')}</code></span>
                        </div>
                        <div class="detail-item">
                            <span class="detail-label"><i class="fa-solid fa-clock"></i> Registered</span>
                            <span class="detail-value">${employee.timestamp_creation ? new Date(employee.timestamp_creation).toLocaleString() : 'N/A'}</span>
                        </div>
                    </div>
                </div>
                <div class="modal-footer">
                    <button class="btn btn-outline" onclick="closeViewEmployeeModal()"><i class="fa-solid fa-times"></i> Close</button>
                    <button class="btn btn-primary" onclick="closeViewEmployeeModal(); editEmployee('${escapeHtml(employee.uid || '')}')"><i class="fa-solid fa-edit"></i> Edit</button>
                </div>
            </div>
        </div>
    `;
    
    // Remove existing modal if any
    const existingModal = document.getElementById('viewEmployeeModal');
    if (existingModal) existingModal.remove();
    
    // Add modal to body
    document.body.insertAdjacentHTML('beforeend', modalHtml);
    
    // Prevent body scroll
    document.body.style.overflow = 'hidden';
}

// Close view employee modal
function closeViewEmployeeModal() {
    const modal = document.getElementById('viewEmployeeModal');
    if (modal) modal.remove();
    document.body.style.overflow = '';
}

// ============ EDIT EMPLOYEE MODAL ============

// Edit employee details in modal
function editEmployee(uid) {
    const employee = getEmployeeByUid(uid);
    if (!employee) {
        showNotification('Employee not found.', 'error');
        return;
    }
    
    const fullname = `${employee.firstname || ''} ${employee.lastname || ''}`.trim() || 'Unknown';
    const role = employee.role || 'employee';
    const roleColor = role === 'admin' ? 'var(--danger)' : role === 'hr' ? 'var(--primary)' : 'var(--success)';
    
    // Build edit modal HTML
    const modalHtml = `
        <div class="modal-overlay" id="editEmployeeModal" onclick="if(event.target===this) closeEditEmployeeModal()">
            <div class="modal-content edit-modal">
                <div class="modal-header" style="background:linear-gradient(135deg, ${roleColor}, ${role === 'admin' ? '#DC2626' : role === 'hr' ? '#2563EB' : '#16A34A'});">
                    <div class="modal-avatar">${escapeHtml(fullname.split(' ').map(w => w[0] || '').join('').slice(0, 2).toUpperCase() || '--')}</div>
                    <div class="modal-user-info">
                        <h2>Edit Employee</h2>
                        <span style="font-size:13px;opacity:0.8;">${escapeHtml(fullname)}</span>
                    </div>
                    <button class="modal-close" onclick="closeEditEmployeeModal()">&times;</button>
                </div>
                <div class="modal-body">
                    <form id="editEmployeeForm" onsubmit="return submitEditEmployee(event)">
                        <div class="edit-grid">
                            <div class="form-group">
                                <label>Employee ID</label>
                                <input class="form-control" type="text" id="editEmployeeId" value="${escapeHtml(employee.employeeid || '')}" required />
                            </div>
                            <div class="form-group">
                                <label>RFID</label>
                                <input class="form-control" type="text" id="editRfid" value="${escapeHtml(employee.rfid || '')}" required readonly />
                            </div>
                            <div class="form-group">
                                <label>First Name</label>
                                <input class="form-control" type="text" id="editFirstname" value="${escapeHtml(employee.firstname || '')}" required />
                            </div>
                            <div class="form-group">
                                <label>Last Name</label>
                                <input class="form-control" type="text" id="editLastname" value="${escapeHtml(employee.lastname || '')}" required />
                            </div>
                            <div class="form-group">
                                <label>Email</label>
                                <input class="form-control" type="email" id="editEmail" value="${escapeHtml(employee.email || '')}" required />
                            </div>
                            <div class="form-group">
                                <label>Contact Number</label>
                                <input class="form-control" type="text" id="editCpnumber" value="${escapeHtml(employee.cpnumber || '')}" required />
                            </div>
                            <div class="form-group">
                                <label>Address</label>
                                <input class="form-control" type="text" id="editAddress" value="${escapeHtml(employee.address || '')}" required />
                            </div>
                            <div class="form-group">
                                <label>Birth Date</label>
                                <input class="form-control" type="date" id="editBdate" value="${escapeHtml(employee.bdate || '')}" required />
                            </div>
                            <div class="form-group">
                                <label>Department</label>
                                <input class="form-control" type="text" id="editDepartment" value="${escapeHtml(employee.department || '')}" />
                            </div>
                            <div class="form-group">
                                <label>Position</label>
                                <input class="form-control" type="text" id="editPosition" value="${escapeHtml(employee.position || '')}" />
                            </div>
                            <div class="form-group">
                                <label>Role</label>
                                <select class="form-control" id="editRole">
                                    <option value="employee" ${employee.role === 'employee' ? 'selected' : ''}>Employee</option>
                                    <option value="hr" ${employee.role === 'hr' ? 'selected' : ''}>HR</option>
                                    <option value="admin" ${employee.role === 'admin' ? 'selected' : ''}>Admin</option>
                                </select>
                            </div>
                            <div class="form-group">
                                <label>Username</label>
                                <input class="form-control" type="text" id="editUsername" value="${escapeHtml(employee.username || '')}" required />
                            </div>
                        </div>
                        <div class="form-group" style="margin-top:12px;">
                            <label>New Password (leave blank to keep current)</label>
                            <input class="form-control" type="password" id="editPassword" placeholder="Enter new password to change" />
                        </div>
                        <input type="hidden" id="editUid" value="${escapeHtml(employee.uid || '')}" />
                        <input type="hidden" id="editRfidHidden" value="${escapeHtml(employee.rfid || '')}" />
                        <div id="editMessage" style="margin-top:10px;font-size:13px;display:none;"></div>
                        <div class="modal-footer" style="margin-top:16px;padding-top:16px;border-top:1px solid var(--border);">
                            <button type="button" class="btn btn-outline" onclick="closeEditEmployeeModal()"><i class="fa-solid fa-times"></i> Cancel</button>
                            <button type="submit" class="btn btn-primary"><i class="fa-solid fa-save"></i> Save Changes</button>
                        </div>
                    </form>
                </div>
            </div>
        </div>
    `;
    
    // Remove existing modal if any
    const existingModal = document.getElementById('editEmployeeModal');
    if (existingModal) existingModal.remove();
    
    // Add modal to body
    document.body.insertAdjacentHTML('beforeend', modalHtml);
    
    // Prevent body scroll
    document.body.style.overflow = 'hidden';
}

// Close edit employee modal
function closeEditEmployeeModal() {
    const modal = document.getElementById('editEmployeeModal');
    if (modal) modal.remove();
    document.body.style.overflow = '';
}

// Submit edit employee form
async function submitEditEmployee(event) {
    event.preventDefault();
    
    const uid = document.getElementById('editUid').value;
    const rfid = document.getElementById('editRfidHidden').value;
    
    // Get form data
    const formData = new FormData();
    formData.append('employeeid', document.getElementById('editEmployeeId').value);
    formData.append('rfid', document.getElementById('editRfid').value);
    formData.append('firstname', document.getElementById('editFirstname').value);
    formData.append('lastname', document.getElementById('editLastname').value);
    formData.append('email', document.getElementById('editEmail').value);
    formData.append('cpnumber', document.getElementById('editCpnumber').value);
    formData.append('address', document.getElementById('editAddress').value);
    formData.append('bdate', document.getElementById('editBdate').value);
    formData.append('department', document.getElementById('editDepartment').value);
    formData.append('position', document.getElementById('editPosition').value);
    formData.append('role', document.getElementById('editRole').value);
    formData.append('username', document.getElementById('editUsername').value);
    
    const password = document.getElementById('editPassword').value;
    if (password) {
        formData.append('password', password);
    }
    
    const msgEl = document.getElementById('editMessage');
    msgEl.style.display = 'block';
    msgEl.style.color = '#3B82F6';
    msgEl.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Updating employee...';
    
    try {
        const response = await fetch(`${dashboardApiBaseUrl}/api/update-employee/${rfid}`, {
            method: 'PUT',
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('tapinToken')}`
            },
            body: formData,
            credentials: 'include'
        });
        
        const result = await response.json();
        
        if (response.status === 401) {
            redirectToLogin();
            return;
        }
        
        if (!response.ok) {
            msgEl.style.color = '#EF4444';
            msgEl.innerHTML = `<i class="fa-solid fa-exclamation-circle"></i> ${result.message || 'Update failed.'}`;
            return;
        }
        
        msgEl.style.color = '#10B981';
        msgEl.innerHTML = '<i class="fa-solid fa-check-circle"></i> Employee updated successfully!';
        
        // Update the local data
        const updatedEmp = result.data;
        const index = allEmployees.findIndex(e => e.uid === uid);
        if (index !== -1) {
            allEmployees[index] = updatedEmp;
            filteredEmployees = [...allEmployees];
            renderEmployeeCards(filteredEmployees);
            populateDepartmentFilter(allEmployees);
        }
        
        // Close modal after delay
        setTimeout(() => {
            closeEditEmployeeModal();
            showNotification('Employee updated successfully!', 'success');
        }, 1500);
        
    } catch (error) {
        console.error('Error updating employee:', error);
        msgEl.style.color = '#EF4444';
        msgEl.innerHTML = '<i class="fa-solid fa-exclamation-circle"></i> Network error. Please try again.';
    }
}

// Show notification
function showNotification(message, type = 'info') {
    const colors = {
        success: '#10B981',
        error: '#EF4444',
        warning: '#F59E0B',
        info: '#3B82F6'
    };
    
    const notification = document.createElement('div');
    notification.style.cssText = `
        position: fixed;
        bottom: 20px;
        right: 20px;
        padding: 12px 20px;
        background: ${colors[type] || colors.info};
        color: white;
        border-radius: 8px;
        font-size: 14px;
        font-weight: 500;
        box-shadow: 0 4px 12px rgba(0,0,0,0.15);
        z-index: 9999;
        max-width: 400px;
        transition: all 0.3s ease;
        opacity: 0;
        transform: translateY(20px);
    `;
    notification.textContent = message;
    document.body.appendChild(notification);
    
    setTimeout(() => {
        notification.style.opacity = '1';
        notification.style.transform = 'translateY(0)';
    }, 50);
    
    setTimeout(() => {
        notification.style.opacity = '0';
        notification.style.transform = 'translateY(20px)';
        setTimeout(() => {
            if (notification.parentNode) {
                notification.remove();
            }
        }, 300);
    }, 3000);
}

// Override the updateEmployeeTable function to use cards
function updateEmployeeTable(users) {
    // Use the new card-based display instead of table
    updateEmployeesGrid(users);
}

// ============ END EMPLOYEE FUNCTIONS ============

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

// Update the activity timeline with data from the activity feed
function updateActivityTimeline(activities) {
    const timeline = document.getElementById('dashboardTimeline');
    if (!timeline) return;
    
    if (!activities || activities.length === 0) {
        timeline.innerHTML = `
            <div class="timeline-item" style="display:flex;justify-content:center;align-items:center;padding:20px 0;color:var(--text-muted);font-size:13px;">
                No recent activities
            </div>
        `;
        return;
    }
    
    // Show latest 10 activities
    const displayActivities = activities.slice(0, 10);
    
    timeline.innerHTML = displayActivities.map((activity) => {
        const timestamp = new Date(activity.timestamp);
        const timeStr = timestamp.toLocaleTimeString(undefined, {
            hour: '2-digit',
            minute: '2-digit'
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
                        <span>${escapeHtml(timeStr)}</span>
                        ${userDisplay ? `&nbsp;·&nbsp;${userDisplay}` : ''}
                        <span class="timeline-badge" style="background:${bgColor};color:${color};">
                            ${escapeHtml(activity.type)}
                        </span>
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

// Fetch activity feed data
async function loadActivityFeed() {
    try {
        const response = await fetch(`${dashboardApiBaseUrl}/api/activity-feed?limit=50`, {
            method: 'GET',
            headers: getAuthHeaders(),
            credentials: 'include',
            cache: 'no-store'
        });
        
        if (response.status === 401) {
            return;
        }
        
        if (!response.ok) {
            console.error('Failed to load activity feed:', response.status);
            return;
        }
        
        const result = await response.json();
        if (result.status === 'success' && result.data) {
            updateActivityTimeline(result.data.activities);
        }
    } catch (error) {
        console.error('Error loading activity feed:', error);
    }
}

// ============ DTR FUNCTIONS ============

// Load DTR employees for the dropdown
async function loadDTREmployees() {
    try {
        const response = await fetch(`${dashboardApiBaseUrl}/api/dtr/employees`, {
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
            console.error('Failed to load DTR employees:', response.status);
            return;
        }
        
        const result = await response.json();
        if (result.status === 'success' && result.data) {
            const select = document.getElementById('dtrEmployeeSelect');
            if (!select) return;
            
            // Clear existing options except the first one
            while (select.options.length > 1) {
                select.remove(1);
            }
            
            // Add employees to dropdown
            result.data.forEach(emp => {
                const option = document.createElement('option');
                option.value = emp.rfid;
                option.textContent = `${emp.fullname} (${emp.employeeid || 'N/A'})`;
                option.dataset.fullname = emp.fullname;
                option.dataset.employeeid = emp.employeeid || '';
                option.dataset.position = emp.position || '';
                option.dataset.department = emp.department || '';
                option.dataset.role = emp.role || 'employee';
                select.appendChild(option);
            });
            
            // Auto-load first employee if available
            if (result.data.length > 0) {
                select.value = result.data[0].rfid;
                // Load the DTR automatically
                loadDTRRecord();
            }
        }
    } catch (error) {
        console.error('Error loading DTR employees:', error);
    }
}

// Load available months for DTR
async function loadDTRMonths() {
    try {
        const response = await fetch(`${dashboardApiBaseUrl}/api/dtr/months`, {
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
            console.error('Failed to load DTR months:', response.status);
            return;
        }
        
        const result = await response.json();
        if (result.status === 'success' && result.data) {
            const select = document.getElementById('dtrMonthSelect');
            if (!select) return;
            
            // Clear existing options except the first one
            while (select.options.length > 1) {
                select.remove(1);
            }
            
            // Add months to dropdown
            result.data.forEach(month => {
                const option = document.createElement('option');
                option.value = month.value;
                option.textContent = month.label;
                select.appendChild(option);
            });
            
            // Set current month as default if available
            const currentMonth = new Date().toISOString().slice(0, 7);
            for (let i = 0; i < select.options.length; i++) {
                if (select.options[i].value === currentMonth) {
                    select.selectedIndex = i;
                    break;
                }
            }
        }
    } catch (error) {
        console.error('Error loading DTR months:', error);
    }
}

// Load DTR record for selected employee
async function loadDTRRecord() {
    const select = document.getElementById('dtrEmployeeSelect');
    const monthSelect = document.getElementById('dtrMonthSelect');
    const rfid = select.value;
    const month = monthSelect.value;
    
    if (!rfid || rfid === '') {
        showDTRMessage('Please select an employee.', 'warning');
        return;
    }
    
    if (!month || month === '') {
        showDTRMessage('Please select a month.', 'warning');
        return;
    }
    
    // Get employee info from selected option
    const option = select.options[select.selectedIndex];
    const fullname = option.dataset.fullname || '';
    const employeeid = option.dataset.employeeid || '';
    const role = option.dataset.role || 'employee';
    
    // Update employee info display - simplified (only name, ID, role, month)
    document.getElementById('dtrEmployeeName').textContent = fullname || '--';
    document.getElementById('dtrEmployeeId').textContent = employeeid || '--';
    document.getElementById('dtrRole').textContent = role ? role.toUpperCase() : '--';
    document.getElementById('dtrSigEmployee').textContent = fullname || 'Employee Signature';
    
    try {
        // Show loading state
        const tbody = document.getElementById('dtrTableBody');
        if (tbody) {
            tbody.innerHTML = `<tr><td colspan="10" style="text-align:center;padding:20px;color:var(--text-muted);">
                <i class="fa-solid fa-spinner fa-spin" style="margin-right:8px;"></i> Loading DTR...
            </td></tr>`;
        }
        
        const response = await fetch(`${dashboardApiBaseUrl}/api/dtr/record/${rfid}?month=${month}`, {
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
            console.error('Failed to load DTR record:', response.status);
            showDTRMessage('Failed to load DTR record.', 'error');
            return;
        }
        
        const result = await response.json();
        if (result.status === 'success' && result.data) {
            const record = result.data.record;
            const dtr = record.dtr || [];
            
            // Update month display
            document.getElementById('dtrMonth').textContent = record.month_display || month;
            
            // Update totals
            document.getElementById('dtrTotalHours').textContent = record.total_hours || '0.00';
            document.getElementById('dtrTotalOt').textContent = record.total_ot || '0.00';
            document.getElementById('dtrTotalUt').textContent = record.total_ut || '0.00';
            
            // Update DTR table
            const tbody = document.getElementById('dtrTableBody');
            if (!tbody) return;
            
            if (!dtr || dtr.length === 0) {
                tbody.innerHTML = `<tr><td colspan="10" style="text-align:center;padding:20px;color:var(--text-muted);">
                    No attendance records for this month.
                </td></tr>`;
                showDTRMessage('No attendance records found for this month.', 'info');
                return;
            }
            
            // Display all days
            tbody.innerHTML = dtr.map(day => {
                const isWeekend = day.day === 'Sat' || day.day === 'Sun';
                const isLeave = day.status === 'on_leave';
                let rowStyle = '';
                let statusText = day.status || '';
                
                if (isLeave) {
                    rowStyle = 'background-color:#FEF3C7;';
                    statusText = 'ON LEAVE';
                } else if (isWeekend) {
                    rowStyle = 'background-color:#F3F4F6;color:#9CA3AF;';
                    statusText = 'Weekend';
                }
                
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
            
            showDTRMessage(`DTR loaded for ${fullname} (${record.month_display})`, 'success');
        }
    } catch (error) {
        console.error('Error loading DTR record:', error);
        showDTRMessage('Error loading DTR record.', 'error');
    }
}

// Show DTR message
function showDTRMessage(message, type = 'info') {
    const msgEl = document.getElementById('dtrMessage');
    if (!msgEl) return;
    
    const colors = {
        success: '#10B981',
        error: '#EF4444',
        warning: '#F59E0B',
        info: '#3B82F6'
    };
    
    const icons = {
        success: 'fa-check-circle',
        error: 'fa-exclamation-circle',
        warning: 'fa-exclamation-triangle',
        info: 'fa-info-circle'
    };
    
    msgEl.innerHTML = `<i class="fa-solid ${icons[type] || icons.info}"></i> ${message}`;
    msgEl.style.color = colors[type] || colors.info;
    msgEl.style.display = 'block';
    msgEl.className = `dtr-message dtr-message-${type}`;
    
    // Auto hide after 5 seconds for success messages
    if (type === 'success') {
        clearTimeout(msgEl._timeout);
        msgEl._timeout = setTimeout(() => {
            msgEl.style.display = 'none';
        }, 5000);
    }
}

// Generate DTR PDF - Downloads the PDF using the API
async function generateDTRPDF() {
    const select = document.getElementById('dtrEmployeeSelect');
    const monthSelect = document.getElementById('dtrMonthSelect');
    const rfid = select.value;
    const month = monthSelect.value;
    
    if (!rfid || rfid === '') {
        showDTRMessage('Please select an employee first.', 'warning');
        return;
    }
    
    if (!month || month === '') {
        showDTRMessage('Please select a month.', 'warning');
        return;
    }
    
    try {
        showDTRMessage('Generating PDF...', 'info');
        
        // The API endpoint that generates the PDF
        const url = `${dashboardApiBaseUrl}/api/dtr/generate-pdf/${rfid}?month=${month}`;
        
        // Fetch with authorization
        const response = await fetch(url, {
            method: 'GET',
            headers: getAuthHeaders(),
            credentials: 'include'
        });
        
        if (response.status === 401) {
            redirectToLogin();
            return;
        }
        
        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            showDTRMessage(errorData.message || 'Failed to generate PDF.', 'error');
            return;
        }
        
        // Get the blob from response
        const blob = await response.blob();
        
        // Create download link
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        
        // Get filename from Content-Disposition header or generate one
        const contentDisposition = response.headers.get('Content-Disposition');
        let filename = 'DTR.pdf';
        if (contentDisposition) {
            const match = contentDisposition.match(/filename="([^"]+)"/);
            if (match) {
                filename = match[1];
            }
        }
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        
        // Revoke the URL after a delay
        setTimeout(() => {
            URL.revokeObjectURL(link.href);
        }, 1000);
        
        showDTRMessage('PDF downloaded successfully!', 'success');
    } catch (error) {
        console.error('Error generating PDF:', error);
        showDTRMessage('Error generating PDF.', 'error');
    }
}

// Print DTR - Uses browser print functionality
function printDTR() {
    window.print();
}

// ============ END DTR FUNCTIONS ============

// Update Realtime Attendance rate circle and progress bars
function updateAttendanceRate(stats) {
    const total = stats.total_employees || 0;
    const present = stats.present_today || 0;
    const absent = stats.absent_today || 0;
    const onLeave = stats.on_leave || 0;
    const rate = stats.attendance_rate || 0;
    
    // Update rate circle
    const rateCircle = document.querySelector('.rate-circle');
    const rateValue = document.querySelector('.rate-value');
    if (rateCircle && rateValue) {
        const percentage = Math.min(rate, 100);
        rateCircle.style.background = `conic-gradient(var(--success) 0% ${percentage}%, var(--border) ${percentage}% 100%)`;
        rateValue.textContent = `${percentage}%`;
    }
    
    // Update attendance rate text
    const rateText = document.getElementById('attendanceRateText');
    if (rateText) {
        rateText.textContent = `${present} of ${total} employees present`;
    }
    
    // Update progress bars
    const presentFill = document.getElementById('presentFill');
    const lateFill = document.getElementById('lateFill');
    const absentFill = document.getElementById('absentFill');
    const leaveFill = document.getElementById('leaveFill');
    
    const presentCount = document.getElementById('presentCount');
    const lateCount = document.getElementById('lateCount');
    const absentCount = document.getElementById('absentCount');
    const leaveCount = document.getElementById('leaveCount');
    
    if (total > 0) {
        const presentPct = (present / total) * 100;
        const latePct = 0; // No late data from API yet
        const absentPct = (absent / total) * 100;
        const leavePct = (onLeave / total) * 100;
        
        if (presentFill) presentFill.style.width = `${Math.min(presentPct, 100)}%`;
        if (lateFill) lateFill.style.width = `${Math.min(latePct, 100)}%`;
        if (absentFill) absentFill.style.width = `${Math.min(absentPct, 100)}%`;
        if (leaveFill) leaveFill.style.width = `${Math.min(leavePct, 100)}%`;
        
        if (presentCount) presentCount.textContent = present;
        if (lateCount) lateCount.textContent = 0;
        if (absentCount) absentCount.textContent = absent;
        if (leaveCount) leaveCount.textContent = onLeave;
    } else {
        if (presentFill) presentFill.style.width = '0%';
        if (lateFill) lateFill.style.width = '0%';
        if (absentFill) absentFill.style.width = '0%';
        if (leaveFill) leaveFill.style.width = '0%';
        
        if (presentCount) presentCount.textContent = 0;
        if (lateCount) lateCount.textContent = 0;
        if (absentCount) absentCount.textContent = 0;
        if (leaveCount) leaveCount.textContent = 0;
    }
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
        const stats = data.stats || {};
        
        updateDashboardStatistics(stats);
        updateAttendanceRate(stats);
        updateEmployeeTable(data.users || []);
        updateScanTable(data.scans || []);
        updateAttendanceTable(data.scans || []);
        updateDeviceDisplay(data.devices || []);
        
        // Update system status indicators
        updateSystemStatus(data);
        
        // Update activity timeline from dashboard data or fetch separately
        if (data.activities && data.activities.length > 0) {
            updateActivityTimeline(data.activities);
        } else {
            // If activities not in dashboard data, fetch separately
            loadActivityFeed();
        }

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

// Update system status indicators (RFID Reader, Database, Server, Network)
function updateSystemStatus(data) {
    const devices = data.devices || [];
    const isOnline = devices.length > 0;
    
    // RFID Reader status
    const readerIndicator = document.getElementById('readerStatusIndicator');
    const readerStatusText = document.getElementById('readerStatusText');
    if (readerIndicator) {
        readerIndicator.className = `status-indicator ${isOnline ? 'status-online' : 'status-offline'}`;
    }
    if (readerStatusText) {
        readerStatusText.className = `status-text ${isOnline ? 'text-online' : 'text-offline'}`;
        readerStatusText.innerHTML = isOnline
            ? '<i class="fa-solid fa-circle-check"></i> Online'
            : '<i class="fa-solid fa-circle-xmark"></i> Offline';
    }
    
    // Database status - always online if API responds
    // Server status - always online if API responds
    // Network status - always online if API responds
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
        // Load DTR data after dashboard loads
        await loadDTREmployees();
        await loadDTRMonths();
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
    '#employee-register': {
        breadcrumb: 'IPO — Employees Personal Info',
        title: 'Employee Register',
        subtitle: 'Register new employees and manage user accounts.'
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

// ============ SETTINGS FUNCTIONS ============

// Load settings
async function loadSettings() {
    try {
        const response = await fetch(`${dashboardApiBaseUrl}/api/settings`, {
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
            console.error('Failed to load settings:', response.status);
            return;
        }
        
        const result = await response.json();
        if (result.status === 'success' && result.data) {
            populateSettingsForm(result.data);
            
            // Update version display with GitHub version info
            updateVersionDisplay(result.data);
        }
    } catch (error) {
        console.error('Error loading settings:', error);
    }
}

// Populate settings form with data
function populateSettingsForm(settings) {
    // Attendance settings
    if (settings.attendance) {
        const att = settings.attendance;
        document.getElementById('settingsWorkStart').value = att.work_start || '08:00';
        document.getElementById('settingsWorkEnd').value = att.work_end || '17:00';
        document.getElementById('settingsLunchStart').value = att.lunch_start || '12:00';
        document.getElementById('settingsLunchEnd').value = att.lunch_end || '13:00';
        document.getElementById('settingsGracePeriod').value = att.grace_period || 10;
    }
    
    // Institution settings
    if (settings.institution) {
        const inst = settings.institution;
        document.getElementById('settingsInstitutionName').value = inst.name || '';
        document.getElementById('settingsSystemName').value = inst.system_name || '';
        document.getElementById('settingsAcademicYear').value = inst.academic_year || '';
        document.getElementById('settingsHREmail').value = inst.hr_email || '';
    }
    
    // System settings
    if (settings.system) {
        document.getElementById('settingsVersion').value = settings.system.version || '1.0.0';
        document.getElementById('settingsVersionUrl').value = settings.system.version_url || '';
    }
}

// Update version display with GitHub version info
function updateVersionDisplay(settings) {
    const versionInput = document.getElementById('settingsVersion');
    const versionStatus = document.getElementById('settingsVersionStatus');
    const checkBtn = document.getElementById('checkVersionBtn');
    
    if (!versionInput || !versionStatus) return;
    
    const currentVersion = settings.system?.version || '1.0.0';
    const githubVersion = settings.system?.github_version || null;
    
    versionInput.value = currentVersion;
    
    if (githubVersion) {
        const isNewer = settings.system?.is_newer_available || false;
        if (isNewer) {
            versionStatus.innerHTML = `
                <span style="color:var(--warning);">
                    <i class="fa-solid fa-arrow-up"></i> New version ${githubVersion} available!
                </span>
            `;
            if (checkBtn) {
                checkBtn.innerHTML = '<i class="fa-solid fa-download"></i> Update Available';
                checkBtn.style.background = 'var(--warning)';
                checkBtn.style.color = 'white';
            }
        } else {
            versionStatus.innerHTML = `
                <span style="color:var(--success);">
                    <i class="fa-solid fa-check-circle"></i> Up to date (v${githubVersion})
                </span>
            `;
            if (checkBtn) {
                checkBtn.innerHTML = '<i class="fa-solid fa-rotate"></i> Check for Updates';
                checkBtn.style.background = '';
                checkBtn.style.color = '';
            }
        }
    } else {
        versionStatus.innerHTML = `
            <span style="color:var(--text-muted);">
                <i class="fa-solid fa-link"></i> Unable to check for updates
            </span>
        `;
    }
}

// Save settings
async function saveSettings() {
    const settingsData = {
        attendance: {
            work_start: document.getElementById('settingsWorkStart').value,
            work_end: document.getElementById('settingsWorkEnd').value,
            lunch_start: document.getElementById('settingsLunchStart').value,
            lunch_end: document.getElementById('settingsLunchEnd').value,
            grace_period: parseInt(document.getElementById('settingsGracePeriod').value) || 10
        },
        institution: {
            name: document.getElementById('settingsInstitutionName').value,
            system_name: document.getElementById('settingsSystemName').value,
            academic_year: document.getElementById('settingsAcademicYear').value,
            hr_email: document.getElementById('settingsHREmail').value
        },
        system: {
            version_url: document.getElementById('settingsVersionUrl').value
        }
    };
    
    const msgEl = document.getElementById('settingsMessage');
    msgEl.style.display = 'block';
    msgEl.style.color = '#3B82F6';
    msgEl.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Saving settings...';
    
    try {
        const response = await fetch(`${dashboardApiBaseUrl}/api/settings`, {
            method: 'PUT',
            headers: {
                ...getAuthHeaders(),
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(settingsData),
            credentials: 'include'
        });
        
        if (response.status === 401) {
            redirectToLogin();
            return;
        }
        
        const result = await response.json();
        
        if (!response.ok) {
            msgEl.style.color = '#EF4444';
            msgEl.innerHTML = `<i class="fa-solid fa-exclamation-circle"></i> ${result.message || 'Failed to save settings.'}`;
            return;
        }
        
        msgEl.style.color = '#10B981';
        msgEl.innerHTML = '<i class="fa-solid fa-check-circle"></i> Settings saved successfully!';
        
        // Refresh settings to get updated version info
        setTimeout(() => {
            loadSettings();
        }, 1000);
        
        // Auto hide after 3 seconds
        setTimeout(() => {
            msgEl.style.display = 'none';
        }, 5000);
        
    } catch (error) {
        console.error('Error saving settings:', error);
        msgEl.style.color = '#EF4444';
        msgEl.innerHTML = '<i class="fa-solid fa-exclamation-circle"></i> Network error. Please try again.';
    }
}

// Check for version update
async function checkVersionUpdate() {
    const msgEl = document.getElementById('settingsMessage');
    const checkBtn = document.getElementById('checkVersionBtn');
    
    msgEl.style.display = 'block';
    msgEl.style.color = '#3B82F6';
    msgEl.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Checking for updates...';
    
    if (checkBtn) {
        checkBtn.disabled = true;
        checkBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Checking...';
    }
    
    try {
        const response = await fetch(`${dashboardApiBaseUrl}/api/settings/check-version`, {
            method: 'GET',
            headers: getAuthHeaders(),
            credentials: 'include'
        });
        
        if (response.status === 401) {
            redirectToLogin();
            return;
        }
        
        const result = await response.json();
        
        if (!response.ok) {
            msgEl.style.color = '#EF4444';
            msgEl.innerHTML = `<i class="fa-solid fa-exclamation-circle"></i> ${result.message || 'Failed to check version.'}`;
            return;
        }
        
        if (result.status === 'success' && result.data) {
            const data = result.data;
            const versionInput = document.getElementById('settingsVersion');
            const versionStatus = document.getElementById('settingsVersionStatus');
            
            versionInput.value = data.current_version;
            
            if (data.is_newer_available) {
                versionStatus.innerHTML = `
                    <span style="color:var(--warning);">
                        <i class="fa-solid fa-arrow-up"></i> New version ${data.github_version} available! (Current: ${data.current_version})
                    </span>
                `;
                if (checkBtn) {
                    checkBtn.innerHTML = '<i class="fa-solid fa-download"></i> Update Available';
                    checkBtn.style.background = 'var(--warning)';
                    checkBtn.style.color = 'white';
                }
                msgEl.style.color = '#F59E0B';
                msgEl.innerHTML = `<i class="fa-solid fa-arrow-up"></i> Version ${data.github_version} is available!`;
            } else {
                versionStatus.innerHTML = `
                    <span style="color:var(--success);">
                        <i class="fa-solid fa-check-circle"></i> Up to date (v${data.github_version || data.current_version})
                    </span>
                `;
                if (checkBtn) {
                    checkBtn.innerHTML = '<i class="fa-solid fa-rotate"></i> Check for Updates';
                    checkBtn.style.background = '';
                    checkBtn.style.color = '';
                }
                msgEl.style.color = '#10B981';
                msgEl.innerHTML = '<i class="fa-solid fa-check-circle"></i> You have the latest version!';
            }
        }
        
        setTimeout(() => {
            msgEl.style.display = 'none';
        }, 5000);
        
    } catch (error) {
        console.error('Error checking version:', error);
        msgEl.style.color = '#EF4444';
        msgEl.innerHTML = '<i class="fa-solid fa-exclamation-circle"></i> Error checking for updates.';
    } finally {
        if (checkBtn) {
            checkBtn.disabled = false;
        }
    }
}

// Reset settings to defaults
async function resetSettings() {
    if (!confirm('Are you sure you want to reset all settings to default values?')) {
        return;
    }
    
    const msgEl = document.getElementById('settingsMessage');
    msgEl.style.display = 'block';
    msgEl.style.color = '#3B82F6';
    msgEl.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Resetting settings...';
    
    try {
        const response = await fetch(`${dashboardApiBaseUrl}/api/settings/reset`, {
            method: 'POST',
            headers: getAuthHeaders(),
            credentials: 'include'
        });
        
        if (response.status === 401) {
            redirectToLogin();
            return;
        }
        
        const result = await response.json();
        
        if (!response.ok) {
            msgEl.style.color = '#EF4444';
            msgEl.innerHTML = `<i class="fa-solid fa-exclamation-circle"></i> ${result.message || 'Failed to reset settings.'}`;
            return;
        }
        
        msgEl.style.color = '#10B981';
        msgEl.innerHTML = '<i class="fa-solid fa-check-circle"></i> Settings reset to defaults!';
        
        // Reload settings
        setTimeout(() => {
            loadSettings();
        }, 1000);
        
        setTimeout(() => {
            msgEl.style.display = 'none';
        }, 5000);
        
    } catch (error) {
        console.error('Error resetting settings:', error);
        msgEl.style.color = '#EF4444';
        msgEl.innerHTML = '<i class="fa-solid fa-exclamation-circle"></i> Network error. Please try again.';
    }
}

// ============ END SETTINGS FUNCTIONS ============

window.addEventListener('pageshow', verifyDashboardSession);
setInterval(updateClock, 1000);
setInterval(loadDashboardData, 5000);
setInterval(loadActivityFeed, 10000); // Refresh activity feed every 10 seconds
updateClock();

// Remove the old employee card collapse function since we have a new one
// The new functions handle everything
verifyDashboardSession();