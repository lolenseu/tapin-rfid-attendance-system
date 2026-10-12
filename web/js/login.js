const form = document.getElementById('loginForm');
const message = document.getElementById('formMessage');
const apiBaseUrl = (window.TAPIN_API_URL || '').replace(/\/+$/, '');
const submitButton = form ? form.querySelector('button[type="submit"]') : null;
const rememberInput = form ? form.querySelector('input[name="remember"]') : null;
const passwordInput = form ? form.querySelector('input[name="password"]') : null;
const passwordToggle = form ? document.getElementById('passwordToggle') : null;
const passwordToggleIcon = passwordToggle ? passwordToggle.querySelector('i') : null;
const forgotPasswordLink = document.getElementById('forgotPasswordLink');
const forgotPasswordModal = document.getElementById('forgotPasswordModal');
const closeForgotPasswordModal = document.getElementById('closeForgotPasswordModal');
const forgotPasswordOk = document.getElementById('forgotPasswordOk');
const VERSION_URL = 'https://raw.githubusercontent.com/lolenseu/tapin-rfid-attendance-system/refs/heads/main/version.txt';

let versionData = null;

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

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const username = form.username.value.trim();
        const pass = passwordInput.value;

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
                throw new Error(result.message || 'Username or password is incorrect.');
            }

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

    // Fetch version once when page loads
    fetchVersion();
    checkAlreadyLoggedIn();
}