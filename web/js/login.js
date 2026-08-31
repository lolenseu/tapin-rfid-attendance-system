const form = document.getElementById('loginForm');
const message = document.getElementById('formMessage');
// Use Railway API by default, can be overridden with window.TAPIN_API_URL
const apiBaseUrl = window.TAPIN_API_URL || 'https://tapin-api.up.railway.app';
const submitButton = form ? form.querySelector('button[type="submit"]') : null;
const rememberInput = form ? form.querySelector('input[name="remember"]') : null;
const passwordInput = form ? form.querySelector('input[name="password"]') : null;
const passwordToggle = form ? document.getElementById('passwordToggle') : null;
const passwordToggleIcon = passwordToggle ? passwordToggle.querySelector('i') : null;
const VERSION_URL = 'https://raw.githubusercontent.com/lolenseu/tapin-rfid-attendance-system/refs/heads/main/version.txt';

let versionData = null;

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
                const redirectUrl = role === 'admin' || role === 'hr' 
                    ? 'pages/dashboard.html' 
                    : 'pages/employee-dashboard.html';
                window.location.replace(redirectUrl);
            }
        }
    } catch (error) {
        // Not logged in, show login page
    }
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

            // Use the redirect URL from the server
            const redirectPath = result.redirect || 'pages/dashboard.html';
            // Remove leading slash if present
            const cleanPath = redirectPath.startsWith('/') ? redirectPath.substring(1) : redirectPath;
            window.location.replace(cleanPath);
            
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