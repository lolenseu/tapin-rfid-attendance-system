const dashboardApiBaseUrl = (window.TAPIN_API_URL || '').replace(/\/+$/, '');

function redirectToLogin() {
    localStorage.removeItem('tapinUser');
    localStorage.removeItem('tapinToken');
    window.location.replace('../login.html');
}

// Open / close the System Settings modal
function openSettingsModal() {
    const modal = document.getElementById('settingsModal');
    if (!modal) return;
    modal.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
    // Refresh settings from the server whenever the modal opens so it
    // always shows the latest stored values.
    loadSettings();
}

function closeSettingsModal() {
    const modal = document.getElementById('settingsModal');
    if (!modal) return;
    modal.classList.add('hidden');
    document.body.style.overflow = '';
}

// Open / close the My Profile modal
function openProfileModal() {
    const modal = document.getElementById('profileModal');
    if (!modal) return;
    // Refresh the profile fields with the latest known data before showing.
    populateProfileModalFromUser();
    modal.classList.remove('hidden');
    document.body.style.overflow = '';
}

function closeProfileModal() {
    const modal = document.getElementById('profileModal');
    if (!modal) return;
    modal.classList.add('hidden');
    document.body.style.overflow = '';
}

// Close either modal with the Escape key
document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    const settingsModal = document.getElementById('settingsModal');
    const profileModal = document.getElementById('profileModal');
    if (settingsModal && !settingsModal.classList.contains('hidden')) {
        closeSettingsModal();
    }
    if (profileModal && !profileModal.classList.contains('hidden')) {
        closeProfileModal();
    }
});

function getAuthHeaders() {
    const token = localStorage.getItem('tapinToken');
    return {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
    };
}

// Compute up-to-two-letter initials from a full name.
function computeInitials(fullname) {
    if (!fullname) return '--';
    const parts = String(fullname).trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return '--';
    const first = parts[0][0] || '';
    const second = parts.length > 1 ? (parts[parts.length - 1][0] || '') : '';
    return (first + second).toUpperCase() || '--';
}

function updateUserDisplay(user) {
    if (!user) return;

    const displayName = user.fullname || user.username || 'User';
    const displayRole = (user.role || 'employee').toUpperCase();
    const initials = computeInitials(displayName);

    // Topbar chip
    const nameEl = document.getElementById('dashboardUserName');
    const roleEl = document.getElementById('dashboardUserRole');
    const avatarEl = document.getElementById('dashboardUserAvatar');
    if (nameEl) nameEl.textContent = displayName;
    if (roleEl) roleEl.textContent = displayRole;
    if (avatarEl) avatarEl.textContent = initials;

    // Remember the session user so the profile modal can look it up later.
    window.__tapinSessionUser = user;

    // Refresh the profile modal fields (safe to call before the modal opens).
    populateProfileModalFromUser();
}

// Populate the profile modal header + account rows from the session user
// and from the full employee record in allEmployees (when available).
function populateProfileModalFromUser() {
    const sessionUser = window.__tapinSessionUser || null;
    if (!sessionUser) return;

    const displayName = sessionUser.fullname || sessionUser.username || 'User';
    const initials = computeInitials(displayName);
    const fallbackRole = (sessionUser.role || 'employee');

    // Try to find the full record in the employee directory for richer data
    // (email, phone, department). Fall back to the session payload if not
    // yet loaded — the modal will still show correct name + role.
    const full = (typeof allEmployees !== 'undefined' && Array.isArray(allEmployees))
        ? allEmployees.find(emp => emp && emp.uid === sessionUser.uid) || {}
        : {};

    const role = String(full.role || fallbackRole).toLowerCase();
    const roleLabel = role.toUpperCase();

    // Header
    const titleEl = document.getElementById('profileModalTitle');
    const subtitleEl = document.getElementById('profileModalSubtitle');
    const avatarModalEl = document.getElementById('profileModalAvatar');
    if (titleEl) titleEl.textContent = displayName;
    if (subtitleEl) {
        const dept = full.department || '';
        const position = full.position || '';
        // Prefer "Position · Department", else just Role · Institution.
        let subtitle;
        if (position && dept) subtitle = `${position} · ${dept}`;
        else if (position) subtitle = position;
        else if (dept) subtitle = `${roleLabel} · ${dept}`;
        else subtitle = `${roleLabel} · ISPSC Tagudin Campus`;
        subtitleEl.textContent = subtitle;
    }
    if (avatarModalEl) avatarModalEl.textContent = initials;

    // Account Information rows
    const email = full.email || sessionUser.email || '';
    const phone = full.cpnumber || '';
    const department = full.department || '';
    const employeeId = full.employeeid || sessionUser.employeeid || '';
    const rfid = full.rfid || sessionUser.rfid || '';

    const setText = (id, value) => {
        const el = document.getElementById(id);
        if (el) el.textContent = value || '--';
    };

    setText('profileEmail', email);
    setText('profilePhone', phone);
    setText('profileDepartment', department);
    setText('profileEmployeeId', employeeId);
    setText('profileRole', roleLabel);

    // RFID row (only if you added an id for it — optional).
    // If you want to display RFID too, add an id="profileRfid" span in HTML
    // and uncomment the next line:
    // setText('profileRfid', rfid);
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

// Report actions: preview, print, pdf, excel, generate
document.addEventListener('click', async (ev) => {
    const btn = ev.target.closest && ev.target.closest('.btn-report');
    if (!btn) return;
    const card = btn.closest('.report-card');
    const reportId = card ? card.dataset.report : null;

    // Determine action by class or icon text
    if (btn.classList.contains('btn-report-pdf')) {
        const url = (dashboardApiBaseUrl || '') + `/api/reports/${reportId}/pdf`;
        window.open(url, '_blank');
        return;
    }
    if (btn.classList.contains('btn-report-excel')) {
        const url = (dashboardApiBaseUrl || '') + `/api/reports/${reportId}/xlsx`;
        window.open(url, '_blank');
        return;
    }
    if (btn.classList.contains('btn-report-gen')) {
        // trigger server-side generation
        try {
            const res = await fetch((dashboardApiBaseUrl || '') + `/api/reports/${reportId}/generate`, { method: 'POST', headers: getAuthHeaders() });
            if (res.ok) alert('Report generation started.'); else alert('Failed to start generation.');
        } catch (e) { console.error(e); alert('Error generating report.'); }
        return;
    }
    // Print button
    if (btn.querySelector && btn.querySelector('.fa-print')) {
        // open printable preview and call print
        await openPreviewAndPrint(reportId);
        return;
    }
    // Preview
    if (btn.querySelector && btn.querySelector('.fa-eye')) {
        openReportPreview(reportId);
        return;
    }
});

async function fetchReportPreview(reportId) {
    const url = (dashboardApiBaseUrl || '') + `/api/reports/${reportId}/preview`;
    try {
        const res = await fetch(url, { headers: getAuthHeaders() });
        if (!res.ok) return `<div style="padding:12px;color:var(--text-muted);">Preview not available (status ${res.status}).</div>`;
        const text = await res.text();
        return text;
    } catch (err) {
        console.error('Preview fetch error', err);
        return `<div style="padding:12px;color:var(--text-muted);">Error loading preview.</div>`;
    }
}

async function openReportPreview(reportId) {
    const modal = document.getElementById('reportPreviewModal');
    const content = document.getElementById('reportPreviewContent');
    const title = document.getElementById('reportPreviewTitle');
    if (!modal || !content) return;
    title.textContent = `${reportId || 'Report'} — Preview`;
    content.innerHTML = 'Loading preview...';
    modal.classList.remove('hidden');
    const html = await fetchReportPreview(reportId);
    content.innerHTML = html;
}

document.getElementById && document.getElementById('reportPreviewClose')?.addEventListener('click', () => {
    document.getElementById('reportPreviewModal').classList.add('hidden');
});

document.getElementById && document.getElementById('reportPreviewPrint')?.addEventListener('click', async () => {
    const content = document.getElementById('reportPreviewContent');
    if (!content) return;
    const w = window.open('', '_blank');
    w.document.write(`<html><head><title>Print</title></head><body>${content.innerHTML}</body></html>`);
    w.document.close();
    w.focus();
    setTimeout(() => { w.print(); }, 300);
});

document.getElementById && document.getElementById('reportPreviewPdf')?.addEventListener('click', () => {
    const title = document.getElementById('reportPreviewTitle')?.textContent || 'report';
    // Attempt to derive reportId from title
    const reportId = (title || '').split(' ')[0].toLowerCase();
    const url = (dashboardApiBaseUrl || '') + `/api/reports/${reportId}/pdf`;
    window.open(url, '_blank');
});

document.getElementById && document.getElementById('reportPreviewExcel')?.addEventListener('click', () => {
    const title = document.getElementById('reportPreviewTitle')?.textContent || 'report';
    const reportId = (title || '').split(' ')[0].toLowerCase();
    const url = (dashboardApiBaseUrl || '') + `/api/reports/${reportId}/xlsx`;
    window.open(url, '_blank');
});

async function openPreviewAndPrint(reportId) {
    const html = await fetchReportPreview(reportId);
    const w = window.open('', '_blank');
    w.document.write(`<html><head><title>Print</title></head><body>${html}</body></html>`);
    w.document.close();
    w.focus();
    setTimeout(() => { w.print(); }, 300);
}

// Format a date value (e.g. "2026-09-01", "2026-09-01T00:00:00Z", or a Date)
// into the DTR "D - Mon" style (e.g. "1 - Sep"). Works for any month/year —
// nothing here is hard-coded to a specific month.
const DTR_MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function formatDTRDate(value) {
    if (!value && value !== 0) return '';

    // ISO-style "YYYY-MM-DD" (optionally with a time/zone suffix) — parse the
    // digits directly so we never lose a day to a timezone shift.
    const isoMatch = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (isoMatch) {
        const day = parseInt(isoMatch[3], 10);
        const monthIndex = parseInt(isoMatch[2], 10) - 1;
        const monthAbbr = DTR_MONTH_ABBR[monthIndex] || '';
        return monthAbbr ? `${day} - ${monthAbbr}` : String(value);
    }

    // A real Date object.
    if (value instanceof Date && !isNaN(value.getTime())) {
        return `${value.getDate()} - ${DTR_MONTH_ABBR[value.getMonth()]}`;
    }

    // Already formatted (e.g. "1 - Sep") or some other string — leave as-is.
    return String(value);
}

// Format a date value into short "M/D/YY" style used in the DTR header
// (e.g. "9/1/26"), no leading zeros — same style as the reference form.
function formatDTRHeaderDate(value) {
    if (!value && value !== 0) return '';

    // ISO "YYYY-MM-DD" (optionally with a time/zone suffix).
    let isoMatch = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (isoMatch) {
        const year = isoMatch[1].slice(-2);
        const month = parseInt(isoMatch[2], 10);
        const day = parseInt(isoMatch[3], 10);
        return `${month}/${day}/${year}`;
    }

    // Already "M/D/YY" or "MM/DD/YY" — normalize away any leading zeros.
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

// Work out the "From : To :" range for the DTR header. Prefers the record's
// own from_date/to_date (whatever month was selected), falls back to the
// first/last day actually present in the dtr rows, and only falls back to
// today's calendar month if neither is available — so it always reflects
// the month being viewed, for any month, not just the current one.
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

    return {
        from: formatDTRHeaderDate(from),
        to: formatDTRHeaderDate(to)
    };
}

function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>'"]/g, (character) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
    }[character]));
}

function initials(user) {
    return `${user.firstname || ''} ${user.lastname || ''}`.trim().split(/\s+/).map((part) => part[0] || '').join('').slice(0, 2).toUpperCase() || '--';
}

// ============ SEARCH FUNCTIONALITY ============

// Store search results for autocomplete
let searchSuggestions = [];
let selectedSuggestionIndex = -1;

// Initialize search functionality
function initSearch() {
    const searchInput = document.querySelector('.search-input');
    if (!searchInput) return;
    
    // Create autocomplete dropdown container
    let dropdown = document.getElementById('searchAutocomplete');
    if (!dropdown) {
        dropdown = document.createElement('div');
        dropdown.id = 'searchAutocomplete';
        dropdown.style.cssText = `
            position: absolute;
            top: 100%;
            left: 0;
            right: 0;
            background: var(--card-bg);
            border: 1px solid var(--border);
            border-radius: var(--radius);
            box-shadow: var(--shadow-lg);
            max-height: 320px;
            overflow-y: auto;
            z-index: 1000;
            display: none;
            margin-top: 4px;
        `;
        // Add scrollbar styling
        dropdown.style.scrollbarWidth = 'thin';
        dropdown.style.scrollbarColor = 'var(--border-dark) transparent';
        searchInput.parentNode.style.position = 'relative';
        searchInput.parentNode.appendChild(dropdown);
    }
    
    // Search on input with debounce
    let searchTimeout;
    searchInput.addEventListener('input', function() {
        clearTimeout(searchTimeout);
        const searchTerm = this.value.trim();
        selectedSuggestionIndex = -1;
        
        if (searchTerm.length >= 1) {
            searchTimeout = setTimeout(() => {
                performSearch(searchTerm);
            }, 300);
        } else {
            dropdown.style.display = 'none';
            clearSearchHighlights();
            searchSuggestions = [];
        }
    });
    
    // Search on Enter key - go to first result
    searchInput.addEventListener('keydown', function(event) {
        const items = dropdown.querySelectorAll('.search-suggestion-item');
        
        if (event.key === 'Enter') {
            event.preventDefault();
            const searchTerm = this.value.trim();
            if (searchTerm) {
                // If an item is selected via arrow keys, go to that
                if (selectedSuggestionIndex >= 0 && items.length > 0) {
                    const selectedItem = items[selectedSuggestionIndex];
                    const sectionId = selectedItem.dataset.sectionId;
                    if (sectionId) {
                        goToSearchResult(sectionId);
                        dropdown.style.display = 'none';
                        this.value = '';
                        clearSearchHighlights();
                        return;
                    }
                }
                // Otherwise go to first result
                if (searchSuggestions.length > 0) {
                    goToSearchResult(searchSuggestions[0].id);
                }
                dropdown.style.display = 'none';
                this.value = '';
                clearSearchHighlights();
            }
        }
        
        // Arrow key navigation
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            if (items.length === 0) return;
            
            // Remove active class from all items
            items.forEach(item => item.classList.remove('active'));
            
            if (event.key === 'ArrowDown') {
                selectedSuggestionIndex = Math.min(selectedSuggestionIndex + 1, items.length - 1);
            } else {
                selectedSuggestionIndex = Math.max(selectedSuggestionIndex - 1, 0);
            }
            
            items[selectedSuggestionIndex].classList.add('active');
            // Scroll to the active item
            items[selectedSuggestionIndex].scrollIntoView({ block: 'nearest' });
        }
        
        // Escape key - close dropdown
        if (event.key === 'Escape') {
            dropdown.style.display = 'none';
            clearSearchHighlights();
            this.value = '';
            searchSuggestions = [];
            selectedSuggestionIndex = -1;
        }
    });
    
    // Close dropdown when clicking outside
    document.addEventListener('click', function(event) {
        if (!searchInput.parentNode.contains(event.target)) {
            dropdown.style.display = 'none';
        }
    });
}

// Perform search across all sections
function performSearch(searchTerm) {
    const term = searchTerm.toLowerCase().trim();
    if (!term) {
        hideAutocomplete();
        clearSearchHighlights();
        return;
    }
    
    // Clear previous highlights
    clearSearchHighlights();
    
    // Search in all sections
    const sections = document.querySelectorAll('.page-section');
    let matchedSections = [];
    let totalMatches = 0;
    
    sections.forEach(section => {
        const sectionText = section.textContent.toLowerCase();
        if (sectionText.includes(term)) {
            const sectionId = section.id;
            if (sectionId) {
                const title = section.querySelector('.section-title')?.textContent || 
                             section.querySelector('h1')?.textContent ||
                             sectionId.replace('-', ' ').toUpperCase();
                const matchCount = countMatchesInElement(section, term);
                matchedSections.push({
                    id: sectionId,
                    title: title,
                    element: section,
                    matchCount: matchCount
                });
                totalMatches += matchCount;
                
                // Highlight matching section
                section.style.border = '3px solid var(--primary)';
                section.style.boxShadow = '0 0 20px rgba(37,99,235,0.3)';
                section.style.transition = 'all 0.5s ease';
                section.classList.add('search-match');
                
                // Highlight matching text within the section
                highlightTextInElement(section, term);
            }
        }
    });
    
    // Also search employees
    const employeeMatches = searchEmployees(term);
    if (employeeMatches) {
        totalMatches += employeeMatches;
    }
    
    // Store suggestions and show autocomplete
    searchSuggestions = matchedSections;
    if (matchedSections.length > 0) {
        showAutocomplete(term, matchedSections, totalMatches);
    } else if (totalMatches > 0) {
        // If only employee matches, show a message
        showAutocomplete(term, [], totalMatches);
    } else {
        showAutocomplete(term, [], 0);
    }
}

// Count matches in an element
function countMatchesInElement(element, term) {
    let count = 0;
    const walker = document.createTreeWalker(
        element,
        NodeFilter.SHOW_TEXT,
        {
            acceptNode: function(node) {
                if (node.parentElement.tagName === 'SCRIPT' || 
                    node.parentElement.tagName === 'STYLE' ||
                    node.parentElement.tagName === 'INPUT' ||
                    node.parentElement.tagName === 'TEXTAREA' ||
                    node.parentElement.tagName === 'SELECT') {
                    return NodeFilter.FILTER_REJECT;
                }
                return NodeFilter.FILTER_ACCEPT;
            }
        }
    );
    
    let currentNode;
    while (currentNode = walker.nextNode()) {
        const text = currentNode.textContent.toLowerCase();
        const matches = (text.match(new RegExp(term, 'gi')) || []).length;
        count += matches;
    }
    return count;
}

// Highlight text within an element
function highlightTextInElement(element, term) {
    const walker = document.createTreeWalker(
        element,
        NodeFilter.SHOW_TEXT,
        {
            acceptNode: function(node) {
                if (node.parentElement.tagName === 'SCRIPT' || 
                    node.parentElement.tagName === 'STYLE' ||
                    node.parentElement.tagName === 'INPUT' ||
                    node.parentElement.tagName === 'TEXTAREA' ||
                    node.parentElement.tagName === 'SELECT') {
                    return NodeFilter.FILTER_REJECT;
                }
                return NodeFilter.FILTER_ACCEPT;
            }
        }
    );
    
    const nodesToReplace = [];
    let currentNode;
    while (currentNode = walker.nextNode()) {
        if (currentNode.textContent.toLowerCase().includes(term)) {
            nodesToReplace.push(currentNode);
        }
    }
    
    nodesToReplace.forEach(node => {
        const parent = node.parentNode;
        const text = node.textContent;
        const parts = text.split(new RegExp(`(${term})`, 'gi'));
        
        const fragment = document.createDocumentFragment();
        parts.forEach(part => {
            if (part && part.toLowerCase() === term.toLowerCase()) {
                const span = document.createElement('span');
                span.textContent = part;
                span.style.backgroundColor = '#FEF3C7';
                span.style.color = '#92400E';
                span.style.padding = '1px 3px';
                span.style.borderRadius = '3px';
                span.style.fontWeight = '700';
                span.className = 'search-highlight';
                fragment.appendChild(span);
            } else if (part) {
                const textNode = document.createTextNode(part);
                fragment.appendChild(textNode);
            }
        });
        
        parent.replaceChild(fragment, node);
    });
}

// Clear search highlights
function clearSearchHighlights() {
    // Remove border highlights from sections
    document.querySelectorAll('.page-section').forEach(section => {
        section.style.border = '';
        section.style.boxShadow = '';
        section.style.transition = '';
        section.classList.remove('search-match');
    });
    
    // Remove text highlights
    document.querySelectorAll('.search-highlight').forEach(el => {
        const parent = el.parentNode;
        const text = el.textContent;
        const textNode = document.createTextNode(text);
        parent.replaceChild(textNode, el);
        parent.normalize();
    });
}

// Show autocomplete dropdown
function showAutocomplete(searchTerm, matchedSections, totalMatches) {
    const dropdown = document.getElementById('searchAutocomplete');
    if (!dropdown) return;
    
    let html = '';
    
    // Header with search info
    html += `
        <div style="padding:8px 14px;border-bottom:1px solid var(--border);font-size:12px;color:var(--text-muted);background:var(--bg);border-radius:var(--radius) var(--radius) 0 0;">
            <strong style="color:var(--text);">${totalMatches}</strong> result${totalMatches !== 1 ? 's' : ''} found for "<strong>${escapeHtml(searchTerm)}</strong>"
        </div>
    `;
    
    if (matchedSections.length > 0) {
        matchedSections.forEach((section, index) => {
            const isActive = index === selectedSuggestionIndex;
            html += `
                <div class="search-suggestion-item ${isActive ? 'active' : ''}" 
                     data-section-id="${escapeHtml(section.id)}"
                     style="padding:8px 14px;cursor:pointer;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid var(--border);transition:background 0.15s ease;${isActive ? 'background:var(--primary-light);' : ''}"
                     onmouseenter="this.style.background='var(--primary-light)'" 
                     onmouseleave="this.style.background='${isActive ? 'var(--primary-light)' : 'transparent'}'"
                     onclick="goToSearchResult('${escapeHtml(section.id)}')">
                    <div style="display:flex;align-items:center;gap:10px;flex:1;min-width:0;">
                        <i class="fa-solid fa-file-lines" style="color:var(--primary);font-size:13px;flex-shrink:0;"></i>
                        <span style="font-weight:500;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(section.title)}</span>
                    </div>
                    <span class="badge badge-info" style="font-size:10px;flex-shrink:0;background:var(--primary-light);color:var(--primary);">${section.matchCount} match${section.matchCount !== 1 ? 'es' : ''}</span>
                </div>
            `;
        });
    } else if (totalMatches > 0) {
        // Only employee matches
        html += `
            <div style="padding:12px 14px;color:var(--text-muted);text-align:center;font-size:13px;">
                <i class="fa-solid fa-users" style="margin-right:8px;color:var(--primary);"></i>
                Found ${totalMatches} employee(s) matching "<strong>${escapeHtml(searchTerm)}</strong>"
                <br><span style="font-size:12px;">Check the Employee Directory section</span>
            </div>
        `;
    } else {
        html += `
            <div style="padding:12px 14px;color:var(--text-muted);text-align:center;font-size:13px;">
                <i class="fa-solid fa-search" style="margin-right:8px;opacity:0.5;"></i>
                No results found for "<strong>${escapeHtml(searchTerm)}</strong>"
            </div>
        `;
    }
    
    dropdown.innerHTML = html;
    dropdown.style.display = 'block';
}

// Hide autocomplete dropdown
function hideAutocomplete() {
    const dropdown = document.getElementById('searchAutocomplete');
    if (dropdown) {
        dropdown.style.display = 'none';
    }
}

// Go to a specific search result
function goToSearchResult(sectionId) {
    if (sectionId) {
        // Close dropdown
        hideAutocomplete();
        // Clear search input
        const searchInput = document.querySelector('.search-input');
        if (searchInput) searchInput.value = '';
        // Scroll to section
        scrollToSection(`#${sectionId}`);
        setActiveNavForHash(`#${sectionId}`);
        // Highlight the selected section
        document.querySelectorAll('.page-section').forEach(s => {
            s.style.border = '';
            s.style.boxShadow = '';
        });
        const selectedSection = document.getElementById(sectionId);
        if (selectedSection) {
            selectedSection.style.border = '3px solid var(--primary)';
            selectedSection.style.boxShadow = '0 0 20px rgba(37,99,235,0.3)';
            // Remove highlight after 3 seconds
            setTimeout(() => {
                selectedSection.style.border = '';
                selectedSection.style.boxShadow = '';
            }, 3000);
        }
        // Clear highlights after 4 seconds
        setTimeout(() => {
            clearSearchHighlights();
        }, 4000);
    }
}

// Search for employees in the directory
function searchEmployees(term) {
    // Check if we have employee data
    if (allEmployees.length === 0) {
        return 0;
    }
    
    const matchingEmployees = allEmployees.filter(emp => {
        const fullname = `${emp.firstname || ''} ${emp.lastname || ''}`.toLowerCase();
        const employeeId = (emp.employeeid || '').toLowerCase();
        const email = (emp.email || '').toLowerCase();
        const department = (emp.department || '').toLowerCase();
        
        return fullname.includes(term) || 
               employeeId.includes(term) || 
               email.includes(term) ||
               department.includes(term);
    });
    
    if (matchingEmployees.length > 0) {
        // Navigate to employee section
        scrollToSection('#employees');
        setActiveNavForHash('#employees');
        
        // Apply filter to show matching employees
        const searchInput = document.getElementById('employeeSearchInput');
        if (searchInput) {
            searchInput.value = term;
            // Show filter bar if hidden
            const filterBar = document.getElementById('employeeFilterBar');
            if (filterBar && filterBar.style.display === 'none') {
                filterBar.style.display = 'block';
                const btn = document.querySelector('.section-actions .btn-outline');
                if (btn) {
                    btn.innerHTML = '<i class="fa-solid fa-filter"></i> Hide Filter';
                }
            }
            // Trigger filter
            filterEmployees();
        }
        
        // Highlight the employee section
        const employeeSection = document.getElementById('employees');
        if (employeeSection) {
            employeeSection.style.border = '3px solid var(--primary)';
            employeeSection.style.boxShadow = '0 0 20px rgba(37,99,235,0.3)';
            setTimeout(() => {
                employeeSection.style.border = '';
                employeeSection.style.boxShadow = '';
            }, 3000);
        }
        
        return matchingEmployees.length;
    }
    
    return 0;
}

// ============ END SEARCH FUNCTIONALITY ============

// ============ EMPLOYEE DIRECTORY FUNCTIONS ============

// Store all employees for filtering
let allEmployees = [];
let filteredEmployees = [];
let currentPage = 1;
const CARDS_PER_PAGE = 5;
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
        // Reset to page 1 when new data loads
        currentPage = 1;
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

// Render employee cards with pagination (5 cards per page)
function renderEmployeeCards(employees) {
    const grid = document.getElementById('employeesGrid');
    if (!grid) return;
    
    const footer = document.getElementById('employeeGridFooter');
    const countDisplay = document.getElementById('employeeCountDisplay');
    const paginationContainer = document.getElementById('employeePagination');
    
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
    
    // Calculate pagination
    const totalPages = Math.ceil(employees.length / CARDS_PER_PAGE);
    const startIndex = (currentPage - 1) * CARDS_PER_PAGE;
    const endIndex = Math.min(startIndex + CARDS_PER_PAGE, employees.length);
    const visibleEmployees = employees.slice(startIndex, endIndex);
    
    // Generate card HTML
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
            <div class="emp-card" data-index="${startIndex + index}" data-role="${escapeHtml(role)}" data-name="${escapeHtml(fullname.toLowerCase())}" data-id="${escapeHtml(employeeId)}" data-email="${escapeHtml(email)}">
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
    
    // Handle footer and pagination
    if (footer) {
        if (employees.length > CARDS_PER_PAGE) {
            footer.style.display = 'block';
            
            // Update count display
            if (countDisplay) {
                countDisplay.textContent = `Showing ${startIndex + 1} - ${endIndex} of ${employees.length} employees`;
            }
            
            // Generate pagination buttons - Updated with Prev/Next text
            if (paginationContainer) {
                let paginationHTML = '<div class="pagination-controls" style="display:flex;gap:6px;justify-content:center;align-items:center;flex-wrap:wrap;margin-top:8px;">';
                
                // Previous button with text
                paginationHTML += `
                    <button class="btn btn-outline btn-sm pagination-btn" onclick="goToPage(${currentPage - 1})" ${currentPage <= 1 ? 'disabled style="opacity:0.5;cursor:not-allowed;"' : ''}>
                        Prev
                    </button>
                `;
                
                // Page numbers
                const maxVisiblePages = 5;
                let startPage = Math.max(1, currentPage - Math.floor(maxVisiblePages / 2));
                let endPage = Math.min(totalPages, startPage + maxVisiblePages - 1);
                
                if (endPage - startPage < maxVisiblePages - 1) {
                    startPage = Math.max(1, endPage - maxVisiblePages + 1);
                }
                
                if (startPage > 1) {
                    paginationHTML += `<button class="btn btn-outline btn-sm pagination-btn" onclick="goToPage(1)">1</button>`;
                    if (startPage > 2) {
                        paginationHTML += `<span style="color:var(--text-muted);padding:0 4px;">…</span>`;
                    }
                }
                
                for (let i = startPage; i <= endPage; i++) {
                    const isActive = i === currentPage;
                    paginationHTML += `
                        <button class="btn ${isActive ? 'btn-primary' : 'btn-outline'} btn-sm pagination-btn" onclick="goToPage(${i})" ${isActive ? 'style="font-weight:700;"' : ''}>
                            ${i}
                        </button>
                    `;
                }
                
                if (endPage < totalPages) {
                    if (endPage < totalPages - 1) {
                        paginationHTML += `<span style="color:var(--text-muted);padding:0 4px;">…</span>`;
                    }
                    paginationHTML += `<button class="btn btn-outline btn-sm pagination-btn" onclick="goToPage(${totalPages})">${totalPages}</button>`;
                }
                
                // Next button with text
                paginationHTML += `
                    <button class="btn btn-outline btn-sm pagination-btn" onclick="goToPage(${currentPage + 1})" ${currentPage >= totalPages ? 'disabled style="opacity:0.5;cursor:not-allowed;"' : ''}>
                        Next
                    </button>
                `;
                
                paginationHTML += '</div>';
                paginationContainer.innerHTML = paginationHTML;
            }
        } else {
            footer.style.display = 'none';
        }
    }
}

// Go to specific page
function goToPage(page) {
    const totalPages = Math.ceil(filteredEmployees.length / CARDS_PER_PAGE);
    if (page < 1 || page > totalPages) return;
    currentPage = page;
    renderEmployeeCards(filteredEmployees);
    
    // Scroll to grid
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
    
    // Reset to page 1 when filtering
    currentPage = 1;
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
    
    currentPage = 1;
    filteredEmployees = [...allEmployees];
    renderEmployeeCards(filteredEmployees);
}

// ============ END EMPLOYEE FUNCTIONS ============

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
                    <form id="editEmployeeForm" enctype="multipart/form-data" onsubmit="return submitEditEmployee(event)">
                        <div class="edit-grid">
                            <div class="form-group">
                                <label>Employee ID</label>
                                <input class="form-control" type="text" id="editEmployeeId" value="${escapeHtml(employee.employeeid || '')}" required />
                            </div>
                            <div class="form-group">
                                <label>RFID</label>
                                <input class="form-control" type="text" id="editRfid" value="${escapeHtml(employee.rfid || '')}" required />
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
                        <!-- Image upload field for editing -->
                        <div class="form-group" style="margin-top:12px;">
                            <label>Profile Image</label>
                            <input class="form-control" type="file" id="editImage" name="image" accept=".jpg,.jpeg,.png,.gif,.webp,image/*" />
                            <small style="color:var(--text-muted);font-size:11px;display:block;margin-top:4px;">Leave blank to keep current image. Upload new image to replace.</small>
                            <div id="editImagePreview" style="margin-top:8px;display:none;">
                                <img id="editImagePreviewImg" src="" alt="Preview" style="max-width:100px;max-height:100px;border-radius:8px;border:1px solid var(--border);padding:4px;" />
                                <button type="button" class="btn btn-outline btn-sm" onclick="document.getElementById('editImage').value='';document.getElementById('editImagePreview').style.display='none';" style="margin-left:8px;padding:2px 8px;font-size:11px;">Remove</button>
                            </div>
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
    
    // Add image preview functionality
    const imageInput = document.getElementById('editImage');
    if (imageInput) {
        imageInput.addEventListener('change', function() {
            const previewDiv = document.getElementById('editImagePreview');
            const previewImg = document.getElementById('editImagePreviewImg');
            if (this.files && this.files[0]) {
                const reader = new FileReader();
                reader.onload = function(e) {
                    previewImg.src = e.target.result;
                    previewDiv.style.display = 'block';
                };
                reader.readAsDataURL(this.files[0]);
            } else {
                previewDiv.style.display = 'none';
            }
        });
    }
    
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
    
    // Get form data - use FormData to handle file upload
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
    
    // Get image file if selected
    const imageFile = document.getElementById('editImage').files[0];
    if (imageFile) {
        formData.append('image', imageFile);
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
                // Do not set Content-Type for FormData - browser will set it with boundary
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

// ============ ATTENDANCE TABLE FUNCTIONS ============

// Store attendance data for pagination
let attendanceData = [];
let attendanceCurrentPage = 1;
const ATTENDANCE_PER_PAGE = 20;
let attendanceFilteredData = [];

// Update attendance table with pagination
function updateAttendanceTable(scans) {
    const body = document.getElementById('dashboardAttendanceBody');
    if (!body) return;
    
    // Store raw data for filtering
    attendanceData = scans || [];
    applyAttendanceFilters();
}

// Apply filters and render attendance table
function applyAttendanceFilters() {
    const deptFilter = document.getElementById('attendanceFilterDept');
    const statusFilter = document.getElementById('attendanceFilterStatus');
    
    const dept = deptFilter ? deptFilter.value : 'all';
    const status = statusFilter ? statusFilter.value : 'all';
    
    // Filter data
    attendanceFilteredData = attendanceData.filter(scan => {
        const employee = scan.employee;
        
        // Department filter
        let matchesDept = true;
        if (dept !== 'all') {
            const empDept = (employee && employee.department) || '';
            matchesDept = empDept.toLowerCase() === dept.toLowerCase();
        }
        
        // Status filter - only filter by present/absent/leave
        let matchesStatus = true;
        if (status !== 'all') {
            const isPresent = employee ? true : false;
            const isOnLeave = false; // We don't have leave status in scan data
            
            if (status === 'present') {
                matchesStatus = isPresent;
            } else if (status === 'absent') {
                matchesStatus = !isPresent;
            } else if (status === 'leave') {
                matchesStatus = isOnLeave;
            }
        }
        
        return matchesDept && matchesStatus;
    });
    
    // Reset to page 1 when filtering
    attendanceCurrentPage = 1;
    renderAttendanceTable();
}

// Helper: format a scan_type like "am_in" / "pm_out" into a readable label.
// Returns empty string when the scan_type is missing/unknown so callers can
// filter those entries out instead of displaying "Unknown".
function formatScanEventLabel(scanType) {
    const t = String(scanType || '').toLowerCase();
    if (t.endsWith('_in')) {
        const period = t.startsWith('am') ? 'AM' : t.startsWith('pm') ? 'PM' : '';
        return period ? `Time In (${period})` : 'Time In';
    }
    if (t.endsWith('_out')) {
        const period = t.startsWith('am') ? 'AM' : t.startsWith('pm') ? 'PM' : '';
        return period ? `Time Out (${period})` : 'Time Out';
    }
    return '';
}
// Helper: pick badge class for a scan_type
function scanEventBadgeClass(scanType) {
    const t = String(scanType || '').toLowerCase();
    if (t.endsWith('_in')) return 'badge-present';
    if (t.endsWith('_out')) return 'badge-late';
    return 'badge-draft';
}

// Render attendance table with pagination
function renderAttendanceTable() {
    const body = document.getElementById('dashboardAttendanceBody');
    const paginationContainer = document.getElementById('attendancePagination');
    const countDisplay = document.getElementById('attendanceCountDisplay');
    
    if (!body) return;
    
    // Calculate pagination
    const totalItems = attendanceFilteredData.length;
    const totalPages = Math.ceil(totalItems / ATTENDANCE_PER_PAGE);
    const startIndex = (attendanceCurrentPage - 1) * ATTENDANCE_PER_PAGE;
    const endIndex = Math.min(startIndex + ATTENDANCE_PER_PAGE, totalItems);
    const pageData = attendanceFilteredData.slice(startIndex, endIndex);
    
    if (pageData.length === 0) {
        body.innerHTML = `<tr><td colspan="10" style="text-align:center;padding:30px;color:var(--text-muted);">
            <i class="fa-solid fa-info-circle" style="font-size:20px;display:block;margin-bottom:10px;"></i>
            No attendance records found.
        </td></tr>`;
        if (paginationContainer) paginationContainer.innerHTML = '';
        if (countDisplay) countDisplay.textContent = '';
        return;
    }
    
    // Generate table rows
    body.innerHTML = pageData.map((scan) => {
        const employee = scan.employee;
        const name = employee ? `${employee.firstname || ''} ${employee.lastname || ''}`.trim() : 'Unknown card';
        const role = employee ? employee.role || 'Unregistered' : 'Unregistered';
        const department = employee ? employee.department || '--' : '--';
        const position = employee ? employee.position || '--' : '--';
        const rfid = scan.rfid || '--';
        const scannedAt = scan.scanned_at || '--';
        const isPresent = employee ? true : false;

        // Event label from scan_type — skip entries that have no real
        // time-in / time-out value so "Unknown" rows don't appear.
        const st = String(scan.scan_type || '').toLowerCase();
        const isRealEvent = st === 'am_in' || st === 'am_out'
                         || st === 'pm_in' || st === 'pm_out';
        const eventLabel = isRealEvent ? formatScanEventLabel(scan.scan_type) : '';
        const badgeClass = isRealEvent ? scanEventBadgeClass(scan.scan_type) : 'badge-draft';

        return `<tr>
            <td><strong>${escapeHtml(employee ? employee.employeeid || employee.uid || '--' : '--')}</strong></td>
            <td>${escapeHtml(name)}</td>
            <td>${escapeHtml(department)}</td>
            <td>${escapeHtml(position)}</td>
            <td><code>${escapeHtml(rfid)}</code></td>
            <td>${escapeHtml(scannedAt)}</td>
            <td><span class="badge ${badgeClass}"><span class="badge-dot"></span>${escapeHtml(eventLabel)}</span></td>
            <td>RFID device</td>
            <td>Live scan</td>
        </tr>`;
    }).join('');
    
    // Update count display (above pagination)
    if (countDisplay) {
        if (totalItems > 0) {
            countDisplay.textContent = `Showing ${startIndex + 1} - ${endIndex} of ${totalItems}`;
        } else {
            countDisplay.textContent = '';
        }
    }
    
    // Generate pagination controls
    if (paginationContainer) {
        if (totalPages > 1) {
            let paginationHTML = '<div class="pagination-controls" style="display:flex;gap:6px;justify-content:center;align-items:center;flex-wrap:wrap;margin-top:8px;">';
            
            // Previous button with text
            paginationHTML += `
                <button class="btn btn-outline btn-sm pagination-btn" onclick="goToAttendancePage(${attendanceCurrentPage - 1})" ${attendanceCurrentPage <= 1 ? 'disabled style="opacity:0.5;cursor:not-allowed;"' : ''}>
                    Prev
                </button>
            `;
            
            // Page numbers
            const maxVisiblePages = 5;
            let startPage = Math.max(1, attendanceCurrentPage - Math.floor(maxVisiblePages / 2));
            let endPage = Math.min(totalPages, startPage + maxVisiblePages - 1);
            
            if (endPage - startPage < maxVisiblePages - 1) {
                startPage = Math.max(1, endPage - maxVisiblePages + 1);
            }
            
            if (startPage > 1) {
                paginationHTML += `<button class="btn btn-outline btn-sm pagination-btn" onclick="goToAttendancePage(1)">1</button>`;
                if (startPage > 2) {
                    paginationHTML += `<span style="color:var(--text-muted);padding:0 4px;">…</span>`;
                }
            }
            
            for (let i = startPage; i <= endPage; i++) {
                const isActive = i === attendanceCurrentPage;
                paginationHTML += `
                    <button class="btn ${isActive ? 'btn-primary' : 'btn-outline'} btn-sm pagination-btn" onclick="goToAttendancePage(${i})" ${isActive ? 'style="font-weight:700;"' : ''}>
                        ${i}
                    </button>
                `;
            }
            
            if (endPage < totalPages) {
                if (endPage < totalPages - 1) {
                    paginationHTML += `<span style="color:var(--text-muted);padding:0 4px;">…</span>`;
                }
                paginationHTML += `<button class="btn btn-outline btn-sm pagination-btn" onclick="goToAttendancePage(${totalPages})">${totalPages}</button>`;
            }
            
            // Next button with text
            paginationHTML += `
                <button class="btn btn-outline btn-sm pagination-btn" onclick="goToAttendancePage(${attendanceCurrentPage + 1})" ${attendanceCurrentPage >= totalPages ? 'disabled style="opacity:0.5;cursor:not-allowed;"' : ''}>
                    Next
                </button>
            `;
            
            paginationHTML += '</div>';
            paginationContainer.innerHTML = paginationHTML;
        } else {
            // No pagination buttons needed, just clear the container
            paginationContainer.innerHTML = '';
        }
    }
}

// Go to specific attendance page
function goToAttendancePage(page) {
    const totalPages = Math.ceil(attendanceFilteredData.length / ATTENDANCE_PER_PAGE);
    if (page < 1 || page > totalPages) return;
    attendanceCurrentPage = page;
    renderAttendanceTable();
    
    // Scroll to table
    const table = document.querySelector('#realtime .card');
    if (table) {
        setTimeout(() => {
            table.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 100);
    }
}

// Populate department filter with unique departments
function populateAttendanceDepartmentFilter(scans) {
    const deptFilter = document.getElementById('attendanceFilterDept');
    if (!deptFilter) return;
    
    // Get unique departments from employee data
    const departments = new Set();
    scans.forEach(scan => {
        if (scan.employee && scan.employee.department) {
            departments.add(scan.employee.department);
        }
    });
    
    // Clear existing options except the first one
    while (deptFilter.options.length > 1) {
        deptFilter.remove(1);
    }
    
    // Sort departments alphabetically
    const sortedDepts = Array.from(departments).sort();
    
    // Add departments to dropdown
    sortedDepts.forEach(dept => {
        if (dept && dept.trim()) {
            const option = document.createElement('option');
            option.value = dept;
            option.textContent = dept;
            deptFilter.appendChild(option);
        }
    });
}

// ============ END ATTENDANCE TABLE FUNCTIONS ============

// ============ REALTIME RFID SCANS TABLE (Dashboard card) ============
//
// This table reads scan_type ("am_in", "am_out", "pm_in", "pm_out") so it can
// show "Time In (AM)" / "Time Out (PM)" instead of a generic "Present" label.

// Format "2026-09-17 17:15:07" -> "5:15:07 PM"
function formatTimeStamp12h(ts) {
    if (!ts) return '--';
    try {
        const timePart = String(ts).split(' ')[1];
        if (!timePart) return ts;
        const [hStr, mStr, sStr] = timePart.split(':');
        let h = parseInt(hStr, 10);
        const ampm = h >= 12 ? 'PM' : 'AM';
        h = h % 12;
        if (h === 0) h = 12;
        return `${h}:${mStr}:${sStr} ${ampm}`;
    } catch {
        return ts;
    }
}

async function updateScanTable(scansFromDashboard) {
    const body = document.getElementById('dashboardScanBody');
    if (!body) return;

    const scans = Array.isArray(scansFromDashboard) ? scansFromDashboard : [];

    if (scans.length === 0) {
        body.innerHTML = '<tr><td colspan="4" style="text-align:center;padding:20px;color:var(--text-muted);">No RFID scans received today.</td></tr>';
        return;
    }

    // Deduplicate defensively on the frontend too, in case the same
    // (rfid, scanned_at) pair ever slips through from the API.
    const seen = new Set();
    const cleaned = [];
    for (const scan of scans) {
        const key = `${scan.rfid || ''}|${scan.scanned_at || ''}`;
        if (seen.has(key)) continue;
        seen.add(key);
        cleaned.push(scan);
    }

    body.innerHTML = cleaned.slice(0, 10).map((scan) => {
        const employee = scan.employee;
        const name = employee
            ? `${employee.firstname || ''} ${employee.lastname || ''}`.trim()
            : 'Unknown card';
        const dept = (employee && employee.department) ? employee.department : '--';
        const timeLabel = formatTimeStamp12h(scan.scanned_at);
        const statusLabel = employee ? formatScanEventLabel(scan.scan_type) : 'Unknown';
        const badgeClass = employee
            ? scanEventBadgeClass(scan.scan_type)
            : 'badge-absent';

        return `<tr>
            <td>
                <div class="emp-cell">
                    <div class="emp-avatar">${escapeHtml(employee ? initials(employee) : '--')}</div>
                    <div>
                        <div class="emp-name">${escapeHtml(name)}</div>
                        <div class="emp-id">${escapeHtml(scan.rfid)}</div>
                    </div>
                </div>
            </td>
            <td>${escapeHtml(dept)}</td>
            <td>${escapeHtml(timeLabel)}</td>
            <td><span class="badge ${badgeClass}"><span class="badge-dot"></span>${escapeHtml(statusLabel)}</span></td>
        </tr>`;
    }).join('');
}

// ============ END REALTIME RFID SCANS TABLE ============

// Update the activity timeline with data from the activity feed
function updateActivityTimeline(activities) {
    const timeline = document.getElementById('dashboardTimeline');
    if (!timeline) return;
    
    if (!activities || activities.length === 0) {
        timeline.innerHTML = `
            <div style="display:flex;justify-content:center;align-items:center;padding:30px 0;color:var(--text-muted);font-size:13px;">
                <i class="fa-solid fa-info-circle" style="margin-right:8px;"></i> No recent activities
            </div>
        `;
        return;
    }
    
    // Show latest 15 activities for better visibility
    const displayActivities = activities.slice(0, 15);
    
    timeline.innerHTML = displayActivities.map((activity) => {
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
                    icon = 'fa-solid fa-house';
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

// Cache of DTR employees returned by /api/dtr/employees so the search
// combobox can filter locally without hitting the network on every keypress.
let dtrEmployeesCache = [];
let dtrSelectedEmployee = null;
let dtrActiveSuggestionIndex = -1;
let dtrCurrentSuggestions = [];

// Toggle the DTR filter + preview area visibility
function toggleDTRFilter() {
    const area = document.getElementById('dtrFilterArea');
    const btn = document.getElementById('dtrHideFilterBtn');
    if (!area || !btn) return;

    const isHidden = area.style.display === 'none';

    if (isHidden) {
        // Currently hidden → show it
        area.style.display = '';
        btn.innerHTML = '<i class="fa-solid fa-eye-slash"></i> Hide Filter';
    } else {
        // Currently visible → hide it
        area.style.display = 'none';
        btn.innerHTML = '<i class="fa-solid fa-eye"></i> Show Filter';
    }
}

// Load DTR employees for the searchable combobox
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
        if (result.status === 'success' && Array.isArray(result.data)) {
            dtrEmployeesCache = result.data;

            // Auto-select the first employee and load their DTR, matching
            // the previous behavior of the old <select> element.
            if (dtrEmployeesCache.length > 0) {
                selectDTREmployeeByRfid(dtrEmployeesCache[0].rfid, true);
                // Also trigger the initial DTR load for the first employee.
                loadDTRRecord();
            }
        }
    } catch (error) {
        console.error('Error loading DTR employees:', error);
    }
}

// Select a DTR employee by RFID — used both by the auto-select on load and
// by the combobox suggestions when the user picks one.
function selectDTREmployeeByRfid(rfid, skipLoad) {
    const emp = dtrEmployeesCache.find(e => e.rfid === rfid);
    if (!emp) return;

    dtrSelectedEmployee = emp;

    const searchInput = document.getElementById('dtrEmployeeSearch');
    const hiddenInput = document.getElementById('dtrEmployeeSelect');
    const clearBtn = document.getElementById('dtrSearchClear');
    const dropdown = document.getElementById('dtrEmployeeDropdown');

    if (searchInput) searchInput.value = `${emp.fullname} (${emp.employeeid || 'N/A'})`;
    if (hiddenInput) hiddenInput.value = emp.rfid;
    if (clearBtn) clearBtn.style.display = 'flex';
    if (dropdown) dropdown.style.display = 'none';

    if (!skipLoad) {
        loadDTRRecord();
    }
}

// Clear the DTR employee search input and reset state
function clearDTRSearch() {
    const searchInput = document.getElementById('dtrEmployeeSearch');
    const hiddenInput = document.getElementById('dtrEmployeeSelect');
    const clearBtn = document.getElementById('dtrSearchClear');
    const dropdown = document.getElementById('dtrEmployeeDropdown');

    if (searchInput) searchInput.value = '';
    if (hiddenInput) hiddenInput.value = '';
    if (clearBtn) clearBtn.style.display = 'none';
    if (dropdown) dropdown.style.display = 'none';

    dtrSelectedEmployee = null;
    dtrActiveSuggestionIndex = -1;
    dtrCurrentSuggestions = [];

    if (searchInput) searchInput.focus();
}

// Filter the employee cache based on what the user has typed and render
// matching suggestions in the dropdown.
function filterDTREmployees() {
    const searchInput = document.getElementById('dtrEmployeeSearch');
    const dropdown = document.getElementById('dtrEmployeeDropdown');
    if (!searchInput || !dropdown) return;

    const term = searchInput.value.trim().toLowerCase();
    dtrActiveSuggestionIndex = -1;

    // If the user is just re-focusing the box without having typed anything,
    // don't blow away a previously chosen employee.
    if (term === '' && dtrSelectedEmployee) {
        dropdown.style.display = 'none';
        return;
    }

    // Match against fullname, employeeid, department, position, role.
    let matches = dtrEmployeesCache;
    if (term !== '') {
        matches = dtrEmployeesCache.filter(emp => {
            const haystack = [
                emp.fullname || '',
                emp.employeeid || '',
                emp.department || '',
                emp.position || '',
                emp.role || ''
            ].join(' ').toLowerCase();
            return haystack.includes(term);
        });
    }

    dtrCurrentSuggestions = matches;

    if (matches.length === 0) {
        dropdown.innerHTML = `<div class="dtr-suggestion-empty">
            <i class="fa-solid fa-user-slash" style="margin-right:6px;"></i>
            No employees match "${escapeHtml(searchInput.value)}"
        </div>`;
        dropdown.style.display = 'block';
        return;
    }

    dropdown.innerHTML = matches.slice(0, 50).map((emp, idx) => {
        const fullname = emp.fullname || 'Unknown';
        const initialsText = fullname.split(/\s+/).map(w => w[0] || '').join('').slice(0, 2).toUpperCase() || '--';
        const role = (emp.role || 'employee').toLowerCase();
        const employeeId = emp.employeeid || 'N/A';
        const dept = emp.department || '';

        // Highlight the matched substring inside the name for clarity.
        const nameHtml = term
            ? fullname.replace(new RegExp(`(${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'ig'), '<span class="dtr-suggestion-highlight">$1</span>')
            : escapeHtml(fullname);

        return `
            <div class="dtr-suggestion" data-index="${idx}" data-rfid="${escapeHtml(emp.rfid)}" onmousedown="event.preventDefault(); selectDTREmployeeByRfid('${escapeHtml(emp.rfid)}')">
                <div class="dtr-suggestion-avatar">${escapeHtml(initialsText)}</div>
                <div class="dtr-suggestion-body">
                    <div class="dtr-suggestion-name">${nameHtml}</div>
                    <div class="dtr-suggestion-meta">
                        ${escapeHtml(employeeId)}${dept ? ' · ' + escapeHtml(dept) : ''}
                    </div>
                </div>
                <span class="dtr-suggestion-badge role-${escapeHtml(role)}">${escapeHtml(role)}</span>
            </div>
        `;
    }).join('');

    dropdown.style.display = 'block';
}

// Keyboard navigation: Up/Down to move through suggestions, Enter to pick,
// Escape to close.
function handleDTRSearchKeydown(event) {
    const dropdown = document.getElementById('dtrEmployeeDropdown');
    if (!dropdown) return;

    const items = dropdown.querySelectorAll('.dtr-suggestion');
    const isOpen = dropdown.style.display !== 'none';

    if (event.key === 'Escape') {
        dropdown.style.display = 'none';
        return;
    }

    if (!isOpen || items.length === 0) {
        if (event.key === 'Enter') {
            event.preventDefault();
        }
        return;
    }

    if (event.key === 'ArrowDown') {
        event.preventDefault();
        dtrActiveSuggestionIndex = Math.min(dtrActiveSuggestionIndex + 1, items.length - 1);
    } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        dtrActiveSuggestionIndex = Math.max(dtrActiveSuggestionIndex - 1, 0);
    } else if (event.key === 'Enter') {
        event.preventDefault();
        if (dtrActiveSuggestionIndex >= 0 && items[dtrActiveSuggestionIndex]) {
            const rfid = items[dtrActiveSuggestionIndex].dataset.rfid;
            selectDTREmployeeByRfid(rfid);
        } else if (items[0]) {
            const rfid = items[0].dataset.rfid;
            selectDTREmployeeByRfid(rfid);
        }
        return;
    } else {
        return;
    }

    items.forEach(item => item.classList.remove('active'));
    if (items[dtrActiveSuggestionIndex]) {
        items[dtrActiveSuggestionIndex].classList.add('active');
        items[dtrActiveSuggestionIndex].scrollIntoView({ block: 'nearest' });
    }
}

// Close the dropdown when clicking outside the combobox.
document.addEventListener('click', (event) => {
    const wrap = document.querySelector('.dtr-search-wrap');
    const dropdown = document.getElementById('dtrEmployeeDropdown');
    if (!wrap || !dropdown) return;
    if (!wrap.contains(event.target) && !dropdown.contains(event.target)) {
        dropdown.style.display = 'none';
    }
});

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

// Resolve a complete, reliable employee info object for the DTR by combining
// whatever the /api/dtr/record endpoint returned (apiEmployee) with the info
// already known from the cached employee (populated by loadDTREmployees).
// This is what stops the printed/PDF name from ever showing "Unknown" —
// the cache always has fullname/position/department even if the record
// endpoint's employee object is incomplete.
function resolveDTREmployeeInfo(_selectIgnored, apiEmployee, apiRecord) {
    apiEmployee = apiEmployee || {};

    const cached = dtrSelectedEmployee || {};
    const fromCache = {
        fullname: cached.fullname || '',
        employeeid: cached.employeeid || '',
        position: cached.position || '',
        department: cached.department || '',
        role: cached.role || ''
    };

    const apiFullname = apiEmployee.fullname
        || `${apiEmployee.firstname || ''} ${apiEmployee.lastname || ''}`.trim();

    return {
        fullname: apiFullname || fromCache.fullname || 'Unknown',
        employeeid: apiEmployee.employeeid || fromCache.employeeid || (apiRecord && apiRecord.employee_id) || '',
        position: apiEmployee.position || fromCache.position || '',
        department: apiEmployee.department || fromCache.department || '',
        role: apiEmployee.role || fromCache.role || 'employee',
        regularTime: apiEmployee.regular_time || apiEmployee.regularTime || 'DEFAULT'
    };
}

// Render the on-screen DTR employee info panel — Name / Position / Department /
// Regular Time, each on its own line with aligned labels, same fields shown
// on the printed form. Creates the panel above the DTR table the first time
// it's needed, then just updates its content on every subsequent load.
function renderDTREmployeeInfoPanel(info) {
    let panel = document.getElementById('dtrEmployeeInfoPanel');

    if (!panel) {
        panel = document.createElement('div');
        panel.id = 'dtrEmployeeInfoPanel';
        panel.className = 'dtr-employee-info-panel';

        const tbody = document.getElementById('dtrTableBody');
        const table = tbody ? tbody.closest('table') : null;
        if (table && table.parentNode) {
            table.parentNode.insertBefore(panel, table);
        } else {
            const nameEl = document.getElementById('dtrEmployeeName');
            const anchor = nameEl ? nameEl.closest('div') : null;
            if (anchor && anchor.parentNode) {
                anchor.parentNode.insertBefore(panel, anchor.nextSibling);
            }
        }
    }

    panel.innerHTML = `
        <div class="dtr-info-row"><span class="dtr-info-label">Name:</span><span class="dtr-info-value">${escapeHtml(info.fullname || '--')}</span></div>
        <div class="dtr-info-row"><span class="dtr-info-label">Position:</span><span class="dtr-info-value">${escapeHtml(info.position || '--')}</span></div>
        <div class="dtr-info-row"><span class="dtr-info-label">Department:</span><span class="dtr-info-value">${escapeHtml(info.department || '--')}</span></div>
        <div class="dtr-info-row"><span class="dtr-info-label">Regular Time:</span><span class="dtr-info-value">${escapeHtml(info.regularTime || 'DEFAULT')}</span></div>
    `;

    if (!document.getElementById('dtrEmployeeInfoPanelStyles')) {
        const style = document.createElement('style');
        style.id = 'dtrEmployeeInfoPanelStyles';
        style.textContent = `
            .dtr-employee-info-panel {
                display: flex;
                flex-direction: column;
                gap: 4px;
                font-size: 13px;
                margin: 10px 0 16px 0;
                padding: 10px 14px;
                border: 1px solid var(--border, #e5e7eb);
                border-radius: 8px;
                background: var(--card-bg, #ffffff);
            }
            .dtr-employee-info-panel .dtr-info-row {
                display: flex;
                align-items: baseline;
            }
            .dtr-employee-info-panel .dtr-info-label {
                font-weight: 700;
                width: 120px;
                flex-shrink: 0;
            }
            .dtr-employee-info-panel .dtr-info-value {
                font-weight: 500;
            }
        `;
        document.head.appendChild(style);
    }
}

// Load DTR record for selected employee
async function loadDTRRecord() {
    const hiddenInput = document.getElementById('dtrEmployeeSelect');
    const monthSelect = document.getElementById('dtrMonthSelect');
    const rfid = hiddenInput ? hiddenInput.value : '';
    const month = monthSelect ? monthSelect.value : '';
    
    if (!rfid || rfid === '') {
        showDTRMessage('Please select an employee.', 'warning');
        return;
    }
    
    if (!month || month === '') {
        showDTRMessage('Please select a month.', 'warning');
        return;
    }
    
    // Prefer the cached employee object (from the search dropdown) over
    // reading from a <select> that no longer exists.
    const emp = dtrSelectedEmployee
        || dtrEmployeesCache.find(e => e.rfid === rfid)
        || {};
    const fullname = emp.fullname || '';
    const employeeid = emp.employeeid || '';
    const position = emp.position || '';
    const department = emp.department || '';
    const role = emp.role || 'employee';
    
    // Update employee info display - simplified (only name, ID, role, month)
    document.getElementById('dtrEmployeeName').textContent = fullname || '--';
    document.getElementById('dtrEmployeeId').textContent = employeeid || '--';
    document.getElementById('dtrRole').textContent = role ? role.toUpperCase() : '--';

    // Show the full Name / Position / Department / Regular Time block,
    // aligned the same way it appears on the printed DTR.
    renderDTREmployeeInfoPanel({
        fullname: fullname || 'Unknown',
        position,
        department,
        regularTime: 'DEFAULT'
    });
    
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

// Build DTR HTML matching the exact two-copy layout from the reference image
function buildDTRHTML(record, dtr, employee) {
    const fullname = employee.fullname || `${employee.firstname || ''} ${employee.lastname || ''}`.trim() || 'Unknown';
    const position = employee.position || '';
    const department = employee.department || '';
    const employeeId = employee.employeeid || record.employee_id || '';
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

    // One full copy (either Employee's or Personnel's) — identical table/content,
    // only the bottom copy label (and Personnel-only "Recorded By" block) differ.
    function buildCopy(copyLabel, isPersonnelCopy) {
        return `
        <div class="dtr-copy">
            <div class="dtr-title">DAILY TIME RECORD</div>
            <div class="dtr-subtitle">DAILY TIME RECORD</div>
            <div class="dtr-daterange">From: ${fromDate} To: ${toDate}</div>

            <div class="dtr-info">
                <div class="info-row"><span class="info-label">Name :</span><span class="info-value name">${fullname}</span></div>
                <div class="info-row"><span class="info-label">Position :</span><span class="info-value">${position}</span></div>
                <div class="info-row"><span class="info-label">Department :</span><span class="info-value">${department}</span></div>
                <div class="info-row two-col">
                    <span class="info-half"><span class="info-label">Regular Time :</span><span class="info-value">${employee.regularTime || 'DEFAULT'}</span></span>
                    <span class="info-half"><span class="info-label label-auto">Payroll No.</span><span class="info-blank"></span></span>
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

            <div class="dtr-divider">&#61;&#61;&#61;&#61;&#61;&#61;&#61;&#61;&#61;&#61;&#61;&#61;&#61;&#61;&#61;&#61;&#61;&#61;&#61;&#61;&#61;&#61;&#61;&#61;&#61;&#61;&#61;&#61;&#61;&#61;&#61;&#61;&#61;&#61;&#61;&#61;&#61;&#61;&#61;&#61;&#61;&#61;&#61;&#61;&#61;&#61;&#61;&#61;&#61;&#61;&#61;&#61;&#61;&#61;&#61;&#61;&#61;&#61;</div>

            <div class="dtr-verified-label">VERIFIED as to the prescribed office hours</div>

            <div class="dtr-sig">
                <div class="sig-line"></div>
                <div class="sig-caption">In Charge</div>
            </div>

            <div class="dtr-copy-tag">&gt;&gt;&gt;&gt;&gt;${copyLabel}</div>

            ${isPersonnelCopy ? `
            <div class="dtr-recorded">
                <div class="recorded-row">RECORDED BY :<span class="recorded-line"></span></div>
                <div class="recorded-row">DATE<span class="recorded-colon">:</span><span class="recorded-line"></span></div>
            </div>` : ''}
        </div>`;
    }

    const employeeCopyHTML = buildCopy("EMPLOYEE'S COPY", false);
    const personnelCopyHTML = buildCopy("PERSONNEL'S COPY", true);

    // Build the complete DTR HTML — two full copies side by side on one page,
    // matching the exact structure of the reference form image.
    return `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <title>Daily Time Record - ${fullname}</title>
            <style>
                @page {
                    size: letter portrait;
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
                    padding: 2px 6px;
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
                    margin-bottom: 1px;
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
                    margin-bottom: 4px;
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
                .info-blank {
                    display: inline-block;
                    min-width: 55px;
                    border-bottom: 1px solid #000;
                    height: 10px;
                    margin-left: 2px;
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
                    display: flex;
                    gap: 14px;
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
                    line-height: 1.25;
                    margin: 4px 0 2px 0;
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
                    margin-top: 4px;
                    font-size: 8px;
                    font-weight: bold;
                }
                .recorded-row {
                    display: flex;
                    align-items: flex-end;
                    gap: 4px;
                    margin-top: 4px;
                }
                .recorded-colon {
                    margin-left: -2px;
                }
                .recorded-line {
                    flex: 1;
                    border-bottom: 1px solid #000;
                    height: 10px;
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

// Shared helper: opens a new window, writes the DTR HTML into it, and
// triggers the browser print dialog. Falls back to a Blob URL if
// window.open is blocked by the browser.
function openPrintWindow(html) {
    const w = window.open('', '_blank', 'width=1100,height=800');
    if (!w) {
        // Popup blocked — fall back to a Blob URL that opens in a new tab
        const blob = new Blob([html], { type: 'text/html' });
        const url = URL.createObjectURL(blob);
        const fallback = window.open(url, '_blank');
        if (!fallback) {
            // Last resort: navigate in the current tab
            const blob2 = new Blob([html], { type: 'text/html' });
            window.location.href = URL.createObjectURL(blob2);
        }
        return;
    }

    // Write the HTML document into the new window
    w.document.open();
    w.document.write(html);
    w.document.close();

    // Give the browser a moment to parse the document and load the
    // styles before invoking print(). Using an explicit timeout is far
    // more reliable than relying on `onload`, which often fires before
    // the document is ready in the popup.
    setTimeout(() => {
        try {
            w.focus();
            w.print();
        } catch (e) {
            console.error('Print invocation failed:', e);
        }
    }, 500);
}

// Print DTR - Uses browser print functionality with formatted HTML
async function printDTR() {
    const hiddenInput = document.getElementById('dtrEmployeeSelect');
    const monthSelect = document.getElementById('dtrMonthSelect');
    let rfid = hiddenInput ? hiddenInput.value : '';
    let month = monthSelect ? monthSelect.value : '';

    // If the user hasn't picked an employee yet but there are employees in
    // the cache, auto-select the first one so print still works.
    if (!rfid && dtrEmployeesCache.length > 0) {
        selectDTREmployeeByRfid(dtrEmployeesCache[0].rfid, true);
        rfid = hiddenInput ? hiddenInput.value : '';
    }

    // If the month hasn't been picked yet, use the current month.
    if (!month) {
        month = new Date().toISOString().slice(0, 7);
    }

    if (!rfid) {
        showDTRMessage('Please select an employee first.', 'warning');
        return;
    }

    try {
        showDTRMessage('Preparing print view...', 'info');

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
            showDTRMessage('Failed to load DTR data.', 'error');
            return;
        }

        const result = await response.json();
        if (!result || result.status !== 'success' || !result.data) {
            showDTRMessage('No DTR data available.', 'error');
            return;
        }

        const record = result.data.record;
        const dtr = record.dtr || [];
        const employee = resolveDTREmployeeInfo(null, record.employee, record);
        const dtrHTML = buildDTRHTML(record, dtr, employee);

        openPrintWindow(dtrHTML);
        showDTRMessage('Print window opened.', 'success');
    } catch (error) {
        console.error('Error printing DTR:', error);
        showDTRMessage('Error printing DTR.', 'error');
    }
}

// Generate DTR PDF - Builds HTML and opens print dialog for PDF
async function generateDTRPDF() {
    const hiddenInput = document.getElementById('dtrEmployeeSelect');
    const monthSelect = document.getElementById('dtrMonthSelect');
    let rfid = hiddenInput ? hiddenInput.value : '';
    let month = monthSelect ? monthSelect.value : '';

    // Auto-select the first employee if none is selected yet, so the
    // button works even before the user touches the dropdown.
    if (!rfid && dtrEmployeesCache.length > 0) {
        selectDTREmployeeByRfid(dtrEmployeesCache[0].rfid, true);
        rfid = hiddenInput ? hiddenInput.value : '';
    }

    // Default to the current month if the month picker is empty.
    if (!month) {
        month = new Date().toISOString().slice(0, 7);
    }

    if (!rfid) {
        showDTRMessage('Please select an employee first.', 'warning');
        return;
    }

    try {
        showDTRMessage('Generating PDF...', 'info');

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
            showDTRMessage('Failed to load DTR data.', 'error');
            return;
        }

        const result = await response.json();
        if (result.status !== 'success' || !result.data) {
            showDTRMessage('No DTR data available.', 'error');
            return;
        }

        const record = result.data.record;
        const dtr = record.dtr || [];
        const employee = resolveDTREmployeeInfo(null, record.employee, record);
        const dtrHTML = buildDTRHTML(record, dtr, employee);

        openPrintWindow(dtrHTML);
        showDTRMessage('PDF window opened — choose "Save as PDF" in the print dialog.', 'success');
    } catch (error) {
        console.error('Error generating PDF:', error);
        showDTRMessage('Error generating PDF.', 'error');
    }
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
        // Once the directory is loaded, refresh the profile modal fields
        // (they read from allEmployees for email/phone/department).
        populateProfileModalFromUser();
        // updateScanTable is async (may fall back to /api/scan-feed); await it
        await updateScanTable(data.scans || []);
        
        // Update attendance table with pagination
        updateAttendanceTable(data.scans || []);
        
        // Populate department filter
        populateAttendanceDepartmentFilter(data.scans || []);
        
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
}

// Update version display with GitHub version info
function updateVersionDisplay(settings) {
    const versionInput = document.getElementById('settingsVersion');
    const versionStatus = document.getElementById('settingsVersionStatus');
    
    if (!versionInput) return;
    
    const currentVersion = settings.system?.version || '1.0.0';
    const githubVersion = settings.system?.github_version || null;
    
    // If GitHub version exists, use that as the displayed version
    // Otherwise use the current version from settings
    const displayVersion = githubVersion || currentVersion;
    versionInput.value = displayVersion;
    
    // Hide the status message completely
    if (versionStatus) {
        versionStatus.style.display = 'none';
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

        // Refresh settings to get updated version info, then close the
        // modal after a short pause so the user sees the success message.
        setTimeout(() => {
            loadSettings();
        }, 800);
        setTimeout(() => {
            closeSettingsModal();
            msgEl.style.display = 'none';
        }, 1400);
        
    } catch (error) {
        console.error('Error saving settings:', error);
        msgEl.style.color = '#EF4444';
        msgEl.innerHTML = '<i class="fa-solid fa-exclamation-circle"></i> Network error. Please try again.';
    }
}

// ============ END SETTINGS FUNCTIONS ============

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
        // Load months first so loadDTREmployees() can trigger a DTR load
        // with a valid month already selected.
        await loadDTRMonths();
        await loadDTREmployees();
        // Load settings (which auto-checks version)
        await loadSettings();
        // Initialize search functionality
        initSearch();
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
        // The Settings and Profile links open modals — don't run the
        // scroll / nav-highlight logic for them.
        if (navItem.id === 'openSettingsBtn' || navItem.id === 'openProfileBtn') {
            return;
        }

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
/* ---------------- VERSION AUTO-PULL ---------------- */
const VERSION_URL = 'https://raw.githubusercontent.com/lolenseu/tapin-rfid-attendance-system/refs/heads/main/version.txt';

function loadAppVersion() {
  const versionEl = document.getElementById('versionNumber');
  if (!versionEl) return;
  fetch(VERSION_URL, { cache: 'no-cache' })
    .then((res) => res.ok ? res.text() : null)
    .then((text) => {
      if (!text) return;
      const version = text.trim();
      if (version) versionEl.textContent = version;
    })
    .catch(() => { /* keep fallback version */ });
}

loadAppVersion();
/* ----------------------------------------------- */
setInterval(updateClock, 1000);
setInterval(loadDashboardData, 5000);
setInterval(loadActivityFeed, 10000); // Refresh activity feed every 10 seconds
updateClock();

// Remove the old employee card collapse function since we have a new one
// The new functions handle everything
verifyDashboardSession();