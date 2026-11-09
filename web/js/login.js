const form = document.getElementById('loginForm');
const message = document.getElementById('formMessage');
const apiBaseUrl = (window.TAPIN_API_URL || '').replace(/\/+$/, '');
const submitButton = form ? form.querySelector('button[type="submit"]') : null;
const rememberInput = form ? form.querySelector('input[name="remember"]') : null;
const passwordInput = form ? form.querySelector('input[name="password"]') : null;
const passwordToggle = form ? document.getElementById('passwordToggle') : null;
const passwordToggleIcon = passwordToggle ? passwordToggle.querySelector('i') : null;
// FORGOT PASSWORD - TEMPORARILY DISABLED
// const forgotPasswordLink = document.getElementById('forgotPasswordLink');
// const forgotPasswordModal = document.getElementById('forgotPasswordModal');
// const closeForgotPasswordModal = document.getElementById('closeForgotPasswordModal');
// const forgotPasswordOk = document.getElementById('forgotPasswordOk');
const VERSION_URL = 'https://raw.githubusercontent.com/lolenseu/tapin-rfid-attendance-system/refs/heads/main/version.txt';

// Lockout modal elements - TEMPORARILY DISABLED
// const lockoutModal = document.getElementById('lockoutModal');
// const lockoutTimer = document.getElementById('lockoutTimer');
// const lockoutMessage = document.getElementById('lockoutMessage');
// const lockoutCloseBtn = document.getElementById('lockoutCloseBtn');

let versionData = null;

// Login attempt tracking for account/IP lockout
// Stores timestamps of failed attempts per username and per IP (simulated via localStorage)
const FAILED_ATTEMPTS_KEY = 'tapin_failed_attempts';
const LOCKOUT_KEY = 'tapin_lockout_until';
const IP_ATTEMPTS_KEY = 'tapin_ip_attempts';

// Configuration
const MAX_ATTEMPTS = 5;          // Maximum failures allowed
const ATTEMPT_WINDOW_MS = 10 * 60 * 1000;  // 10 minutes window
const LOCKOUT_DURATION_MS = 15 * 60 * 1000; // 15 minutes lockout
const SUSPICIOUS_THRESHOLD = 3;  // Alert if success follows 3+ failures

let lockoutCountdownInterval = null;

// Mobile breakpoint — screens at or below this width get the mobile employee dashboard
const MOBILE_BREAKPOINT = 768;
const isMobileViewport = () => window.innerWidth <= MOBILE_BREAKPOINT;

// Decide where to send the user based on their role + current viewport.
// Admins / HR always go to the admin dashboard.
// Employees get the mobile layout on small screens.
function resolveRedirect(role, serverRedirect) {
    const cleanRole = (role || 'employee').toLowerCase();
    const isStaff = cleanRole === 'admin' || cleanRole === 'hr';

    if (isStaff) {
        return 'pages/dashboard.html';
    }

    // Employee on a phone → mobile employee dashboard
    if (isMobileViewport()) {
        return 'pages/mobile-employee-dashboard.html';
    }

    // Desktop employee → use server redirect if it points to an employee dashboard
    if (serverRedirect && serverRedirect.includes('employee-dashboard')) {
        return serverRedirect.startsWith('/') ? serverRedirect.substring(1) : serverRedirect;
    }
    return 'pages/employee-dashboard.html';
}

// ========================
// LOCKOUT & SECURITY FUNCTIONS - TEMPORARILY DISABLED
// ========================
/*
// Get failed attempts from localStorage
function getFailedAttempts() {
    try {
        const data = localStorage.getItem(FAILED_ATTEMPTS_KEY);
        return data ? JSON.parse(data) : {};
    } catch {
        return {};
    }
}

// Save failed attempts to localStorage
function saveFailedAttempts(attempts) {
    localStorage.setItem(FAILED_ATTEMPTS_KEY, JSON.stringify(attempts));
}

// Get lockout expiry timestamp
function getLockoutUntil() {
    const until = localStorage.getItem(LOCKOUT_KEY);
    return until ? parseInt(until, 10) : 0;
}

// Set lockout expiry timestamp
function setLockoutUntil(timestamp) {
    localStorage.setItem(LOCKOUT_KEY, timestamp.toString());
}

// Clear lockout
function clearLockout() {
    localStorage.removeItem(LOCKOUT_KEY);
}

// Check if currently locked out
function isLockedOut() {
    const until = getLockoutUntil();
    return until > Date.now();
}

// Get remaining lockout time in ms
function getRemainingLockoutMs() {
    const until = getLockoutUntil();
    const remaining = until - Date.now();
    return remaining > 0 ? remaining : 0;
}

// Format time for display (MM:SS)
function formatTime(ms) {
    const totalSeconds = Math.ceil(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

// Show lockout modal with countdown
function showLockoutModal() {
    if (!lockoutModal) return;

    // Update message
    if (lockoutMessage) {
        lockoutMessage.textContent = 'Too many failed login attempts. Please try again in 15 minutes.';
    }

    // Show modal
    lockoutModal.classList.add('show');
    lockoutModal.setAttribute('aria-hidden', 'false');

    // Start countdown
    startLockoutCountdown();
}

// Hide lockout modal
function hideLockoutModal() {
    if (!lockoutModal) return;
    lockoutModal.classList.remove('show');
    lockoutModal.setAttribute('aria-hidden', 'true');

    // Stop countdown
    if (lockoutCountdownInterval) {
        clearInterval(lockoutCountdownInterval);
        lockoutCountdownInterval = null;
    }
}

// Start lockout countdown timer
function startLockoutCountdown() {
    if (lockoutCountdownInterval) {
        clearInterval(lockoutCountdownInterval);
    }

    const updateTimer = () => {
        const remaining = getRemainingLockoutMs();
        if (remaining <= 0) {
            // Lockout expired
            clearLockout();
            hideLockoutModal();
            if (lockoutTimer) {
                lockoutTimer.textContent = '00:00';
            }
            // Re-enable form
            if (submitButton) {
                submitButton.disabled = false;
                submitButton.classList.remove('is-loading');
                submitButton.removeAttribute('aria-busy');
            }
            if (message) {
                message.textContent = 'Lockout expired. You may try again.';
                message.className = 'form-message success';
            }
            return;
        }

        if (lockoutTimer) {
            lockoutTimer.textContent = formatTime(remaining);
        }
    };

    // Update immediately
    updateTimer();

    // Update every second
    lockoutCountdownInterval = setInterval(updateTimer, 1000);
}

// Record a failed attempt for the given username
function recordFailedAttempt(username) {
    const now = Date.now();
    const attempts = getFailedAttempts();

    // Initialize attempts array for this username if not exists
    if (!attempts[username]) {
        attempts[username] = [];
    }

    // Add current timestamp
    attempts[username].push(now);

    // Remove old attempts outside the window
    attempts[username] = attempts[username].filter(
        ts => now - ts <= ATTEMPT_WINDOW_MS
    );

    // Save
    saveFailedAttempts(attempts);

    return attempts[username].length;
}

// Clear failed attempts for username (on successful login)
function clearFailedAttempts(username) {
    const attempts = getFailedAttempts();
    delete attempts[username];
    saveFailedAttempts(attempts);
}

// Get count of recent failed attempts for username
function getRecentFailedCount(username) {
    const now = Date.now();
    const attempts = getFailedAttempts();
    const userAttempts = attempts[username] || [];

    // Filter to only recent attempts
    const recent = userAttempts.filter(ts => now - ts <= ATTEMPT_WINDOW_MS);

    // Update stored attempts to only recent
    if (recent.length !== userAttempts.length) {
        if (recent.length > 0) {
            attempts[username] = recent;
        } else {
            delete attempts[username];
        }
        saveFailedAttempts(attempts);
    }

    return recent.length;
}

// Get recent failed attempts for IP (simulated using localStorage)
function getIPFailedCount() {
    try {
        const data = localStorage.getItem(IP_ATTEMPTS_KEY);
        if (!data) return 0;

        const ipAttempts = JSON.parse(data);
        const now = Date.now();

        // Filter to only recent attempts
        const recent = (ipAttempts.timestamps || []).filter(
            ts => now - ts <= ATTEMPT_WINDOW_MS
        );

        // Save filtered
        if (recent.length !== (ipAttempts.timestamps || []).length) {
            localStorage.setItem(IP_ATTEMPTS_KEY, JSON.stringify({ timestamps: recent }));
        }

        return recent.length;
    } catch {
        return 0;
    }
}

// Record a failed attempt for IP
function recordIPFailedAttempt() {
    const now = Date.now();
    let ipAttempts = { timestamps: [] };

    try {
        const data = localStorage.getItem(IP_ATTEMPTS_KEY);
        if (data) {
            ipAttempts = JSON.parse(data);
        }
    } catch {
        ipAttempts = { timestamps: [] };
    }

    // Add current timestamp
    if (!ipAttempts.timestamps) ipAttempts.timestamps = [];
    ipAttempts.timestamps.push(now);

    // Remove old attempts
    ipAttempts.timestamps = ipAttempts.timestamps.filter(
        ts => now - ts <= ATTEMPT_WINDOW_MS
    );

    // Save
    localStorage.setItem(IP_ATTEMPTS_KEY, JSON.stringify(ipAttempts));

    return ipAttempts.timestamps.length;
}

// Clear IP failed attempts
function clearIPFailedAttempts() {
    localStorage.removeItem(IP_ATTEMPTS_KEY);
}
*/

// ========================
// VERSION NOTIFICATION - TEMPORARILY DISABLED
// ========================
/*
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
        font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
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
*/

async function checkAlreadyLoggedIn() {
    const token = localStorage.getItem('tapinToken');
    if (!token) {
        return;
    }

    try {
        const response = await fetch(`${apiBaseUrl}/api/verify-token`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            cache: 'no-store'
        });
        if (response.ok) {
            const data = await response.json();
            if (data.user) {
                const role = data.user.role || 'employee';
                const redirectUrl = resolveRedirect(role, null);
                window.location.replace(redirectUrl);
            }
        }
    } catch (error) {
        // Not logged in, show login page
    }
}

// ========================
// FORGOT PASSWORD - TEMPORARILY DISABLED
// ========================
/*
if (forgotPasswordLink && forgotPasswordModal) {
    forgotPasswordLink.addEventListener('click', (event) => {
        event.preventDefault();
        // Reset to step 1 when opening modal
        resetForgotPasswordModal();
        forgotPasswordModal.classList.add('show');
        forgotPasswordModal.setAttribute('aria-hidden', 'false');
    });
}

// Forgot password modal functionality
let resetTimer = null;
let resetTimeLeft = 0;

function startResendCountdown() {
    const timerElement = document.getElementById('resendTimer');

    if (resetTimer) {
        clearInterval(resetTimer);
    }

    resetTimeLeft = 60;
    timerElement.textContent = resetTimeLeft;
    resendCodeButton.disabled = true;

    resetTimer = setInterval(() => {
        resetTimeLeft -= 1;
        timerElement.textContent = resetTimeLeft;

        if (resetTimeLeft <= 0) {
            clearInterval(resetTimer);
            resetTimer = null;
            resendCodeButton.disabled = false;
        }
    }, 1000);
}

function resetForgotPasswordModal() {
    const steps = [
        document.getElementById('forgotPasswordStep1'),
        document.getElementById('forgotPasswordStep2'),
        document.getElementById('forgotPasswordStep3')
    ];

    // Hide all steps, show first
    steps.forEach((step, i) => {
        if (step) {
            step.classList.toggle('active', i === 0);
            step.style.display = i === 0 ? 'block' : 'none';
        }
    });

    // Clear forms and messages
    document.getElementById('forgotPasswordEmailForm').reset();
    document.getElementById('forgotPasswordCodeForm').reset();
    document.getElementById('forgotPasswordResetForm').reset();

    document.getElementById('forgotPasswordEmailMessage').textContent = '';
    document.getElementById('forgotPasswordCodeMessage').textContent = '';
    document.getElementById('forgotPasswordResetMessage').textContent = '';

    // Clear code inputs
    document.querySelectorAll('.code-input').forEach(input => input.value = '');

    // Clear timer
    if (resetTimer) {
        clearInterval(resetTimer);
        resetTimer = null;
    }
    document.getElementById('resendTimer').textContent = '60';
    document.getElementById('forgotPasswordResendCode').disabled = false;
}

// Handle forgot password modal close events
if (closeForgotPasswordModal && forgotPasswordModal) {
    closeForgotPasswordModal.addEventListener('click', () => {
        forgotPasswordModal.classList.remove('show');
        forgotPasswordModal.setAttribute('aria-hidden', 'true');
        resetForgotPasswordModal();
    });
}

if (forgotPasswordModal) {
    forgotPasswordModal.addEventListener('click', (event) => {
        if (event.target === forgotPasswordModal) {
            forgotPasswordModal.classList.remove('show');
            forgotPasswordModal.setAttribute('aria-hidden', 'true');
            resetForgotPasswordModal();
        }
    });
}

// Step 1: Submit email to send code
const forgotPasswordEmailForm = document.getElementById('forgotPasswordEmailForm');
if (forgotPasswordEmailForm) {
    forgotPasswordEmailForm.addEventListener('submit', async (e) => {
        e.preventDefault();

        const emailInput = document.getElementById('forgotPasswordEmail');
        const messageElement = document.getElementById('forgotPasswordEmailMessage');
        const submitButton = document.getElementById('forgotPasswordEmailSubmit');

        const email = emailInput.value.trim();

        if (!email) {
            messageElement.textContent = 'Please enter your email address.';
            messageElement.className = 'form-message error';
            return;
        }

        // Basic email format validation
        const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailPattern.test(email)) {
            messageElement.textContent = 'Please enter a valid email address.';
            messageElement.className = 'form-message error';
            return;
        }

        messageElement.textContent = 'Sending recovery code...';
        messageElement.className = 'form-message pending';
        submitButton.disabled = true;

        try {
            const response = await fetch(`${apiBaseUrl}/api/forgot-password/send-code`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email })
            });

            const result = await response.json();

            if (!response.ok || result.status !== 'success') {
                throw new Error(result.message || 'Failed to send recovery code');
            }

            // Move to step 2 after the code request succeeds.
            const step1 = document.getElementById('forgotPasswordStep1');
            const step2 = document.getElementById('forgotPasswordStep2');
            step1.classList.remove('active');
            step1.style.display = 'none';
            step2.classList.add('active');
            step2.style.display = 'block';
            document.getElementById('forgotPasswordCodeMessage').textContent =
                'If this email is registered, a recovery code has been sent.';
            document.getElementById('forgotPasswordCodeMessage').className = 'form-message success';
            startResendCountdown();

            // Focus on first code input
            setTimeout(() => {
                const firstCode = document.querySelector('.code-input');
                if (firstCode) firstCode.focus();
            }, 100);

        } catch (error) {
            messageElement.textContent = error.message || 'Unable to process request. Please try again.';
            messageElement.className = 'form-message error';
            submitButton.disabled = false;
        }
    });
}

// Step 2: Verify code
const forgotPasswordCodeForm = document.getElementById('forgotPasswordCodeForm');
if (forgotPasswordCodeForm) {
    const codeInputs = Array.from(forgotPasswordCodeForm.querySelectorAll('.code-input'));
    const hiddenCodeInput = document.getElementById('forgotPasswordCode');
    const syncRecoveryCode = () => {
        hiddenCodeInput.value = codeInputs.map(input => input.value).join('');
    };

    codeInputs.forEach((input, index) => {
        input.addEventListener('input', () => {
            input.value = input.value.replace(/\D/g, '').slice(-1);
            syncRecoveryCode();
            if (input.value && codeInputs[index + 1]) {
                codeInputs[index + 1].focus();
            }
        });

        input.addEventListener('paste', (event) => {
            event.preventDefault();
            const digits = event.clipboardData.getData('text').replace(/\D/g, '').slice(0, codeInputs.length);
            codeInputs.forEach((codeInput, codeIndex) => {
                codeInput.value = digits[codeIndex] || '';
            });
            syncRecoveryCode();
            codeInputs[Math.min(digits.length, codeInputs.length - 1)]?.focus();
        });
    });

    forgotPasswordCodeForm.addEventListener('submit', async (e) => {
        e.preventDefault();

        const emailInput = document.getElementById('forgotPasswordEmail');
        const codeInput = document.getElementById('forgotPasswordCode');
        const messageElement = document.getElementById('forgotPasswordCodeMessage');
        const submitButton = document.getElementById('forgotPasswordCodeSubmit');

        const email = emailInput.value.trim();
        const code = codeInput.value.trim();

        if (!email) {
            messageElement.textContent = 'Email is required.';
            messageElement.className = 'form-message error';
            return;
        }

        if (!code || code.length !== 6 || !/^\d{6}$/.test(code)) {
            messageElement.textContent = 'Please enter a valid 6-digit code.';
            messageElement.className = 'form-message error';
            return;
        }

        messageElement.textContent = 'Verifying code...';
        messageElement.className = 'form-message pending';
        submitButton.disabled = true;

        try {
            const response = await fetch(`${apiBaseUrl}/api/forgot-password/verify-code`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, code })
            });

            const result = await response.json();

            if (!response.ok || result.status !== 'success') {
                throw new Error(result.message || 'Invalid code');
            }

            // Move to step 3
            const step2 = document.getElementById('forgotPasswordStep2');
            const step3 = document.getElementById('forgotPasswordStep3');
            step2.classList.remove('active');
            step2.style.display = 'none';
            step3.classList.add('active');
            step3.style.display = 'block';

            // Focus on password input
            setTimeout(() => {
                document.getElementById('forgotPasswordNewPassword').focus();
            }, 100);

        } catch (error) {
            messageElement.textContent = error.message || 'Verification failed. Please try again.';
            messageElement.className = 'form-message error';
            submitButton.disabled = false;
        }
    });
}

// Step 3: Reset password
const forgotPasswordResetForm = document.getElementById('forgotPasswordResetForm');
if (forgotPasswordResetForm) {
    forgotPasswordResetForm.addEventListener('submit', async (e) => {
        e.preventDefault();

        const newPasswordInput = document.getElementById('forgotPasswordNewPassword');
        const confirmPasswordInput = document.getElementById('forgotPasswordConfirmPassword');
        const messageElement = document.getElementById('forgotPasswordResetMessage');
        const submitButton = document.getElementById('forgotPasswordResetSubmit');

        const newPassword = newPasswordInput.value;
        const confirmPassword = confirmPasswordInput.value;

        if (!newPassword) {
            messageElement.textContent = 'Please enter a new password.';
            messageElement.className = 'form-message error';
            return;
        }

        if (newPassword.length < 8) {
            messageElement.textContent = 'Password must be at least 8 characters long.';
            messageElement.className = 'form-message error';
            return;
        }

        if (newPassword !== confirmPassword) {
            messageElement.textContent = 'Passwords do not match.';
            messageElement.className = 'form-message error';
            return;
        }

        messageElement.textContent = 'Resetting password...';
        messageElement.className = 'form-message pending';
        submitButton.disabled = true;

        try {
            const response = await fetch(`${apiBaseUrl}/api/forgot-password/verify-code`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    email: document.getElementById('forgotPasswordEmail').value.trim(),
                    code: document.getElementById('forgotPasswordCode').value.trim(),
                    new_password: newPassword
                })
            });

            const result = await response.json();

            if (!response.ok || result.status !== 'success') {
                throw new Error(result.message || 'Failed to reset password');
            }

            // Success! Show message and close modal after delay
            messageElement.textContent = 'Password has been reset successfully!';
            messageElement.className = 'form-message success';

            // Close modal after 2 seconds
            setTimeout(() => {
                forgotPasswordModal.classList.remove('show');
                forgotPasswordModal.setAttribute('aria-hidden', 'true');
                resetForgotPasswordModal();
            }, 2000);

        } catch (error) {
            messageElement.textContent = error.message || 'Failed to reset password. Please try again.';
            messageElement.className = 'form-message error';
            submitButton.disabled = false;
        }
    });
}

// Resend code functionality
const resendCodeButton = document.getElementById('forgotPasswordResendCode');
if (resendCodeButton) {
    resendCodeButton.addEventListener('click', async () => {
        const emailInput = document.getElementById('forgotPasswordEmail');
        const email = emailInput.value.trim();
        const messageElement = document.getElementById('forgotPasswordCodeMessage');

        if (!email) {
            messageElement.textContent = 'Email is required.';
            messageElement.className = 'form-message error';
            return;
        }

        messageElement.textContent = 'Resending code...';
        messageElement.className = 'form-message pending';
        resendCodeButton.disabled = true;

        try {
            const response = await fetch(`${apiBaseUrl}/api/forgot-password/send-code`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email })
            });

            const result = await response.json();

            if (!response.ok || result.status !== 'success') {
                throw new Error(result.message || 'Failed to resend code');
            }

            startResendCountdown();

            messageElement.textContent = 'If this email is registered, a new recovery code has been sent.';
            messageElement.className = 'form-message success';

        } catch (error) {
            messageElement.textContent = error.message || 'Failed to resend code. Please try again.';
            messageElement.className = 'form-message error';
            resendCodeButton.disabled = false;
        }
    });
}
*/
// END FORGOT PASSWORD - TEMPORARILY DISABLED

// ========================
// LOCKOUT MODAL EVENTS - TEMPORARILY DISABLED
// ========================
/*
if (lockoutCloseBtn) {
    lockoutCloseBtn.addEventListener('click', () => {
        hideLockoutModal();
        // Keep form disabled if still locked out
        if (isLockedOut()) {
            if (submitButton) {
                submitButton.disabled = true;
            }
            if (message) {
                message.textContent = `Account locked. Try again in ${formatTime(getRemainingLockoutMs())}.`;
                message.className = 'form-message error';
            }
        }
    });
}

if (lockoutModal) {
    lockoutModal.addEventListener('click', (event) => {
        if (event.target === lockoutModal) {
            hideLockoutModal();
            if (isLockedOut()) {
                if (submitButton) {
                    submitButton.disabled = true;
                }
                if (message) {
                    message.textContent = `Account locked. Try again in ${formatTime(getRemainingLockoutMs())}.`;
                    message.className = 'form-message error';
                }
            }
        }
    });
}
*/

// ========================
// MAIN LOGIN FORM
// ========================

if (form) {
    passwordToggle.addEventListener('click', () => {
        const showingPassword = passwordInput.type === 'text';
        passwordInput.type = showingPassword ? 'password' : 'text';
        passwordToggleIcon.className = showingPassword ? 'fa-solid fa-eye' : 'fa-solid fa-eye-slash';
        passwordToggle.setAttribute('aria-label', showingPassword ? 'Show password' : 'Hide password');
        passwordToggle.setAttribute('title', showingPassword ? 'Show password' : 'Hide password');
    });

    // Load remembered credentials
    const rememberedUsername = localStorage.getItem('tapinRememberedUsername');
    const rememberedPassword = localStorage.getItem('tapinRememberedPassword');

    if (rememberedUsername && rememberedPassword) {
        form.username.value = rememberedUsername;
        passwordInput.value = rememberedPassword;
        if (rememberInput) rememberInput.checked = true;
    } else if (rememberedUsername) {
        form.username.value = rememberedUsername;
        if (rememberInput) rememberInput.checked = true;
    }

    // Check lockout status on page load - TEMPORARILY DISABLED
    /*
    if (isLockedOut()) {
        showLockoutModal();
        if (submitButton) {
            submitButton.disabled = true;
        }
        if (message) {
            message.textContent = `Account locked. Try again in ${formatTime(getRemainingLockoutMs())}.`;
            message.className = 'form-message error';
        }
    }
    */

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const username = form.username.value.trim();
        const pass = passwordInput.value;

        // Check lockout first - TEMPORARILY DISABLED
        /*
        if (isLockedOut()) {
            showLockoutModal();
            return;
        }
        */

        if (!username || !pass) {
            message.textContent = 'Please enter both username and password.';
            message.className = 'form-message error';
            return;
        }

        message.textContent = 'Checking credentials...';
        message.className = 'form-message pending';
        submitButton.disabled = true;
        submitButton.classList.add('is-loading');
        submitButton.setAttribute('aria-busy', 'true');

        try {
            const response = await fetch(`${apiBaseUrl}/api/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ username, password: pass })
            });
            const result = await response.json();

            if (!response.ok || result.status !== 'success') {
                // ====== FAILED LOGIN ======
                // Record failed attempt for this username - TEMPORARILY DISABLED
                /*
                const failedCount = recordFailedAttempt(username);

                // Record failed attempt for IP (simulated)
                recordIPFailedAttempt();
                const ipFailedCount = getIPFailedCount();

                // Check if lockout threshold reached
                if (failedCount >= MAX_ATTEMPTS || ipFailedCount >= MAX_ATTEMPTS) {
                    // Set lockout for 15 minutes
                    setLockoutUntil(Date.now() + LOCKOUT_DURATION_MS);
                    showLockoutModal();

                    // Clear failed attempts after lockout is set
                    clearFailedAttempts(username);
                    clearIPFailedAttempts();

                    throw new Error('Too many failed attempts. Account locked for 15 minutes.');
                }

                // Show remaining attempts
                const remaining = MAX_ATTEMPTS - Math.max(failedCount, ipFailedCount);
                throw new Error(
                    result.message ||
                    `Username or password is incorrect. ${remaining} attempt${remaining !== 1 ? 's' : ''} remaining.`
                );
                */
                throw new Error(result.message || 'Username or password is incorrect.');
            }

            // ====== SUCCESSFUL LOGIN ======
            // Check if there were prior failures (suspicious pattern) - TEMPORARILY DISABLED
            /*
            const priorFailures = getRecentFailedCount(username);
            if (priorFailures >= SUSPICIOUS_THRESHOLD) {
                // Raise alert - suspicious login pattern
                const alertMsg = `⚠️ SECURITY ALERT: Successful login for "${username}" after ${priorFailures} failed attempts within 10 minutes.`;

                // Show browser alert
                setTimeout(() => {
                    alert(alertMsg);
                }, 100);

                // Log to console
                console.warn(alertMsg);

                // Also show in form message area as warning
                if (message) {
                    message.textContent = `⚠️ Suspicious activity detected. ${priorFailures} failed attempts before this login.`;
                    message.className = 'form-message warning';
                }
            }
            */

            // Clear failed attempts on success - TEMPORARILY DISABLED
            /*
            clearFailedAttempts(username);
            clearIPFailedAttempts();
            clearLockout();
            */

            // Prevent admin/hr from logging in on mobile
            const userRole = result.user?.role || '';
            const cleanRole = (userRole || 'employee').toLowerCase();
            const isStaff = cleanRole === 'admin' || cleanRole === 'hr';
            if (isStaff && isMobileViewport()) {
                throw new Error('Admin and HR login is not available on mobile devices. Please use a desktop computer.');
            }

            // Save to localStorage based on remember me checkbox
            if (rememberInput && rememberInput.checked) {
                localStorage.setItem('tapinRememberedUsername', username);
                localStorage.setItem('tapinRememberedPassword', pass);
            } else {
                localStorage.removeItem('tapinRememberedUsername');
                localStorage.removeItem('tapinRememberedPassword');
            }

            localStorage.setItem('tapinUser', JSON.stringify(result.user));
            localStorage.setItem('tapinToken', result.token);

            // Decide where to send the user
            const redirectPath = resolveRedirect(result.user?.role, result.redirect);
            window.location.replace(redirectPath);

        } catch (error) {
            message.textContent = error.message || 'Unable to connect to the server.';
            message.className = 'form-message error';
            submitButton.disabled = false;
            submitButton.classList.remove('is-loading');
            submitButton.removeAttribute('aria-busy');
        }
    });

    // Fetch version once when page loads - TEMPORARILY DISABLED
    // fetchVersion();
    checkAlreadyLoggedIn();
}