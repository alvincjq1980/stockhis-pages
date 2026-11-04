/**
 * StockHis Cloudflare Login controller
 */

let turnstileWidgetId = null;
let currentTurnstileToken = null;
let turnstileSiteKey = '';

// DOM Elements
const el = {
  form: document.getElementById('login-form'),
  username: document.getElementById('username'),
  password: document.getElementById('password'),
  errorAlert: document.getElementById('error-alert'),
  loginBtn: document.getElementById('login-btn')
};

// Main Initialize Callback called when Turnstile loads
window.onloadTurnstileCallback = function () {
  initTurnstile();
};

// Safe check: If Turnstile script has already loaded and executed before login.js parses
if (typeof turnstile !== 'undefined') {
  initTurnstile();
}

async function initTurnstile() {
  try {
    // 1. Fetch site key from backend config
    const res = await fetch(API_BASE + '/api/auth/config', { credentials: 'include' });
    if (res.ok) {
      const data = await res.json();
      turnstileSiteKey = data.turnstileSiteKey;
      
      if (turnstileSiteKey) {
        // 2. Render turnstile widget
        if (typeof turnstile !== 'undefined') {
          turnstileWidgetId = turnstile.render('#my-turnstile', {
            sitekey: turnstileSiteKey,
            callback: function (token) {
              currentTurnstileToken = token;
              el.loginBtn.disabled = false;
            },
            'error-callback': function () {
              showError('人机校验初始化错误，请重试。');
              el.loginBtn.disabled = true;
            },
            'expired-callback': function () {
              currentTurnstileToken = null;
              showError('人机校验已过期，请重新校验。');
              el.loginBtn.disabled = true;
            }
          });
        }
      } else {
        // No site key (Turnstile disabled on server)
        const wrapper = document.querySelector('.turnstile-wrapper');
        if (wrapper) wrapper.style.display = 'none';
        console.log('Turnstile site key not configured on server. Bypassing Turnstile...');
      }
    }
  } catch (err) {
    console.error('Failed to initialize Turnstile config:', err);
  }
}

// Intercept form submission
el.form.addEventListener('submit', async (e) => {
  e.preventDefault();
  
  const username = el.username.value.trim();
  const password = el.password.value;

  if (turnstileSiteKey && !currentTurnstileToken) {
    showError('请先完成安全验证。');
    return;
  }

  el.loginBtn.disabled = true;
  el.loginBtn.textContent = '正在登录...';
  hideError();

  try {
    const response = await fetch(API_BASE + '/api/auth/login', {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        username,
        password,
        turnstileToken: currentTurnstileToken
      })
    });

    const data = await response.json();

    if (response.ok && data.success) {
      // Login successful! Redirect to index
      window.location.href = '/index.html';
    } else {
      // Login failed
      showError(data.error || '登录失败，请检查账密。');
      el.loginBtn.disabled = false;
      el.loginBtn.textContent = '登录系统';
      
      // Reset Turnstile
      if (turnstileWidgetId && typeof turnstile !== 'undefined') {
        turnstile.reset(turnstileWidgetId);
        currentTurnstileToken = null;
        if (turnstileSiteKey) el.loginBtn.disabled = true; // Wait for turnstile verification again
      }
    }
  } catch (err) {
    console.error('Login error:', err);
    showError('网络连接失败: ' + err.message);
    el.loginBtn.disabled = false;
    el.loginBtn.textContent = '登录系统';
  }
});

function showError(msg) {
  el.errorAlert.textContent = msg;
  el.errorAlert.style.display = 'block';
}

function hideError() {
  el.errorAlert.style.display = 'none';
}
