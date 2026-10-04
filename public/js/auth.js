export const API_BASE = '/api';

export async function generateDeviceFingerprint() {
  const cached = localStorage.getItem('iptek_device_fp');
  if (cached) return cached;

  const components = [];

  // 1. User Agent
  components.push(navigator.userAgent || '');

  // 2. Screen properties
  components.push(`${screen.width}x${screen.height}x${screen.colorDepth}`);
  components.push(`${screen.availWidth}x${screen.availHeight}`);

  // 3. Timezone
  components.push(Intl.DateTimeFormat().resolvedOptions().timeZone || '');
  components.push(String(new Date().getTimezoneOffset()));

  // 4. Language
  components.push(navigator.language || '');
  components.push((navigator.languages || []).join(','));

  // 5. Platform
  components.push(navigator.platform || '');
  components.push(String(navigator.hardwareConcurrency || ''));
  components.push(String(navigator.maxTouchPoints || 0));

  // 6. Canvas fingerprint
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 200;
    canvas.height = 50;
    const ctx = canvas.getContext('2d');
    ctx.textBaseline = 'top';
    ctx.font = '14px Arial';
    ctx.fillStyle = '#f60';
    ctx.fillRect(40, 0, 80, 25);
    ctx.fillStyle = '#069';
    ctx.fillText('IPTEK-FP-2026', 2, 15);
    ctx.fillStyle = 'rgba(102, 204, 0, 0.7)';
    ctx.fillText('IPTEK-FP-2026', 4, 17);
    components.push(canvas.toDataURL());
  } catch (e) {
    components.push('canvas-unavailable');
  }

  // 7. WebGL renderer
  try {
    const glCanvas = document.createElement('canvas');
    const gl = glCanvas.getContext('webgl') || glCanvas.getContext('experimental-webgl');
    if (gl) {
      const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
      if (debugInfo) {
        components.push(gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL) || '');
        components.push(gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) || '');
      }
    }
  } catch (e) {
    components.push('webgl-unavailable');
  }

  // Hash semua komponen menggunakan SHA-256
  const raw = components.join('|||');

  let fingerprint;
  if (crypto && crypto.subtle) {
    const encoder = new TextEncoder();
    const data = encoder.encode(raw);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    fingerprint = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  } else {
    // Fallback sederhana jika diakses via HTTP
    fingerprint = btoa(unescape(encodeURIComponent(raw))).replace(/[^a-zA-Z0-9]/g, '').substring(0, 32);
  }

  localStorage.setItem('iptek_device_fp', fingerprint);
  return fingerprint;
}

export function getDeviceInfo() {
  return JSON.stringify({
    userAgent: navigator.userAgent,
    platform: navigator.platform,
    screen: `${screen.width}x${screen.height}`,
    language: navigator.language,
    touchPoints: navigator.maxTouchPoints || 0
  });
}

function safeShowView(viewId) {
  if (typeof window.showView === 'function') {
    window.showView(viewId);
  } else {
    document.querySelectorAll('.view-section').forEach(el => el.classList.remove('active'));
    const target = document.getElementById(viewId);
    if (target) target.classList.add('active');
  }
}

export function checkAuth() {
  const token = localStorage.getItem('iptek_token');
  const userStr = localStorage.getItem('iptek_user');

  if (!token || !userStr) {
    safeShowView('login-view');
    const header = document.getElementById('main-header');
    if (header) header.style.display = 'none';
    return;
  }

  const user = JSON.parse(userStr);
  const header = document.getElementById('main-header');
  if (header) header.style.display = 'block';

  const usernameEl = document.getElementById('nav-username');
  if (usernameEl) usernameEl.textContent = user.nama_lengkap ? user.nama_lengkap.split(' ')[0] : user.username;
  const fullnameEl = document.getElementById('nav-fullname');
  if (fullnameEl) fullnameEl.textContent = user.nama_lengkap || user.username;
  const divisiEl = document.getElementById('nav-divisi');
  if (divisiEl) divisiEl.textContent = user.divisi ? `${user.divisi} (${user.role.toUpperCase()})` : user.role.toUpperCase();

  const navLaporan = document.getElementById('nav-item-laporan');
  const navAnggota = document.getElementById('nav-item-anggota');

  if (user.role === 'pengurus' || user.role === 'admin') {
    safeShowView('main-view');
    if (navLaporan) navLaporan.style.display = 'block';
    if (navAnggota) navAnggota.style.display = 'block';
  } else {
    safeShowView('main-view');
    if (navLaporan) navLaporan.style.display = 'none';
    if (navAnggota) navAnggota.style.display = 'none';
  }

  // Cek adakah hash di URL saat refresh atau awal load
  const hashTab = window.location.hash.replace('#', '');
  const validTabsPengurus = ['overview', 'laporan', 'materi', 'absensi', 'kas', 'anggota'];
  const validTabsAnggota = ['overview', 'materi', 'absensi', 'kas'];
  const validTabs = (user.role === 'pengurus' || user.role === 'admin') ? validTabsPengurus : validTabsAnggota;

  if (typeof window.switchNavTab === 'function') {
    if (hashTab && validTabs.includes(hashTab)) {
      window.switchNavTab(hashTab, true);
    } else {
      window.switchNavTab('overview', true);
    }
  }

  // Muat konfigurasi QRIS (gambar QR Code Bendahara) untuk ditampilkan di UI
  if (typeof window.loadQrisConfig === 'function') {
    window.loadQrisConfig();
  }
}

export async function handleLogin(e) {
  if (e && e.preventDefault) e.preventDefault();
  const usernameInput = (document.getElementById('username')?.value || '').trim();
  const passwordInput = (document.getElementById('password')?.value || '').trim();
  const alertBox = document.getElementById('login-alert');
  const btnLogin = document.getElementById('btn-login');

  if (alertBox) alertBox.style.display = 'none';
  if (btnLogin) {
    btnLogin.disabled = true;
    btnLogin.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Memvalidasi...`;
  }

  try {
    const fingerprint = await generateDeviceFingerprint();
    const res = await fetch(`${API_BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: usernameInput,
        password: passwordInput,
        device_fingerprint: fingerprint,
        device_info: getDeviceInfo()
      })
    });
    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.message || 'Login gagal');
    }

    localStorage.setItem('iptek_token', data.token);
    localStorage.setItem('iptek_user', JSON.stringify(data.user));

    if (alertBox) {
      alertBox.className = 'alert alert-success';
      alertBox.textContent = 'Login berhasil! Mengalihkan ke dashboard...';
      alertBox.style.display = 'block';
    }

    setTimeout(() => {
      checkAuth();
    }, 500);
  } catch (err) {
    if (alertBox) {
      alertBox.className = 'alert alert-error';
      alertBox.textContent = err.message;
      alertBox.style.display = 'block';
    }
  } finally {
    if (btnLogin) {
      btnLogin.disabled = false;
      btnLogin.innerHTML = `<span>Masuk ke Portal</span> <i class="fa-solid fa-arrow-right"></i>`;
    }
  }
}

export function logout() {
  localStorage.removeItem('iptek_token');
  localStorage.removeItem('iptek_user');
  history.replaceState(null, null, window.location.pathname);
  checkAuth();
}

// Client-side In-Memory Cache & In-flight Request Deduplication
const apiCache = new Map();
const inFlightRequests = new Map();

export function clearApiCache(pattern = null) {
  if (!pattern) {
    apiCache.clear();
    return;
  }
  for (const key of apiCache.keys()) {
    if (typeof pattern === 'string' && key.includes(pattern)) {
      apiCache.delete(key);
    } else if (pattern instanceof RegExp && pattern.test(key)) {
      apiCache.delete(key);
    }
  }
}

export async function fetchAuth(url, options = {}) {
  const token = localStorage.getItem('iptek_token');
  if (!options.headers) options.headers = {};
  if (token) options.headers['Authorization'] = `Bearer ${token}`;

  const method = (options.method || 'GET').toUpperCase();

  // Jika mutasi data (POST, PUT, DELETE), bersihkan cache agar data terbaru langsung tampil
  if (method !== 'GET') {
    clearApiCache();
    const res = await fetch(url, options);
    if (res.status === 401) {
      logout();
      throw new Error('Sesi Anda telah berakhir. Silakan login kembali.');
    }
    return res;
  }

  // Khusus GET: gunakan smart in-memory cache & deduplikasi request
  const noCache = options.noCache === true;
  const cacheKey = `${url}:${token || ''}`;
  const ttl = options.cacheTimeMs || 10000; // 10 detik default

  if (!noCache) {
    const cached = apiCache.get(cacheKey);
    if (cached && cached.expiry > Date.now()) {
      return new Response(JSON.stringify(cached.data), {
        status: cached.status,
        statusText: cached.statusText,
        headers: { 'Content-Type': 'application/json', 'X-Client-Cache': 'HIT' }
      });
    }

    if (inFlightRequests.has(cacheKey)) {
      const inflightRes = await inFlightRequests.get(cacheKey);
      return inflightRes.clone();
    }
  }

  const fetchPromise = (async () => {
    try {
      const res = await fetch(url, options);
      if (res.status === 401) {
        logout();
        throw new Error('Sesi Anda telah berakhir. Silakan login kembali.');
      }

      if (res.ok && !noCache) {
        const contentType = res.headers.get('content-type') || '';
        if (contentType.includes('application/json')) {
          const cloned = res.clone();
          cloned.json().then(data => {
            apiCache.set(cacheKey, {
              data,
              status: res.status,
              statusText: res.statusText,
              expiry: Date.now() + ttl
            });
          }).catch(() => {});
        }
      }

      return res;
    } finally {
      inFlightRequests.delete(cacheKey);
    }
  })();

  if (!noCache) {
    inFlightRequests.set(cacheKey, fetchPromise);
  }

  return fetchPromise;
}

// Global window exposure
window.checkAuth = checkAuth;
window.handleLogin = handleLogin;
window.logout = logout;
window.fetchAuth = fetchAuth;
window.clearApiCache = clearApiCache;
window.generateDeviceFingerprint = generateDeviceFingerprint;