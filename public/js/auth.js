export const API_BASE = '/api';

async function generateDeviceFingerprint() {
  // Cek cache di localStorage
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
    // Fallback sederhana jika diakses via HTTP (karena crypto.subtle butuh HTTPS)
    fingerprint = btoa(unescape(encodeURIComponent(raw))).replace(/[^a-zA-Z0-9]/g, '').substring(0, 32);
  }

  // Cache fingerprint
  localStorage.setItem('iptek_device_fp', fingerprint);
  return fingerprint;
}\n\nexport function getDeviceInfo() {
  return JSON.stringify({
    userAgent: navigator.userAgent,
    platform: navigator.platform,
    screen: `${screen.width}x${screen.height}`,
    language: navigator.language,
    touchPoints: navigator.maxTouchPoints || 0
  });
}\n\nexport function checkAuth() {
  const token = localStorage.getItem('iptek_token');
  const userStr = localStorage.getItem('iptek_user');

  if (!token || !userStr) {
    showView('login-view');
    document.getElementById('main-header').style.display = 'none';
    return;
  }

  const user = JSON.parse(userStr);
  document.getElementById('main-header').style.display = 'block';
  const usernameEl = document.getElementById('nav-username');
  if (usernameEl) usernameEl.textContent = user.nama_lengkap ? user.nama_lengkap.split(' ')[0] : user.username;
  const fullnameEl = document.getElementById('nav-fullname');
  if (fullnameEl) fullnameEl.textContent = user.nama_lengkap || user.username;
  const divisiEl = document.getElementById('nav-divisi');
  if (divisiEl) divisiEl.textContent = user.divisi ? `${user.divisi} (${user.role.toUpperCase()})` : user.role.toUpperCase();

  const navLaporan = document.getElementById('nav-item-laporan');
  const navAnggota = document.getElementById('nav-item-anggota');

  if (user.role === 'pengurus' || user.role === 'admin') {
    showView('main-view');
    if (navLaporan) navLaporan.style.display = 'block';
    if (navAnggota) navAnggota.style.display = 'block';
  } else {
    showView('main-view');
    if (navLaporan) navLaporan.style.display = 'none';
    if (navAnggota) navAnggota.style.display = 'none';
  }

  // Cek adakah hash di URL saat refresh atau awal load
  const hashTab = window.location.hash.replace('#', '');
  const validTabsPengurus = ['overview', 'laporan', 'materi', 'absensi', 'kas', 'anggota'];
  const validTabsAnggota = ['overview', 'materi', 'absensi', 'kas'];
  const validTabs = (user.role === 'pengurus' || user.role === 'admin') ? validTabsPengurus : validTabsAnggota;

  if (hashTab && validTabs.includes(hashTab)) {
    switchNavTab(hashTab, true);
  } else {
    switchNavTab('overview', true);
  }

  // Muat konfigurasi QRIS (gambar QR Code Bendahara) untuk ditampilkan di UI
  loadQrisConfig();
}\n\nasync function handleLogin(e) {
  e.preventDefault();
  const usernameInput = document.getElementById('username').value.trim();
  const passwordInput = document.getElementById('password').value.trim();
  const alertBox = document.getElementById('login-alert');
  const btnLogin = document.getElementById('btn-login');

  alertBox.style.display = 'none';
  btnLogin.disabled = true;
  btnLogin.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Memvalidasi...`;

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

    alertBox.className = 'alert alert-success';
    alertBox.textContent = 'Login berhasil! Mengalihkan ke dashboard...';
    alertBox.style.display = 'block';

    setTimeout(() => {
      checkAuth();
    }, 800);
  } catch (err) {
    alertBox.className = 'alert alert-error';
    alertBox.textContent = err.message;
    alertBox.style.display = 'block';
  } finally {
    btnLogin.disabled = false;
    btnLogin.innerHTML = `<span>Masuk ke Portal</span> <i class="fa-solid fa-arrow-right"></i>`;
  }
}\n\nexport function logout() {
  localStorage.removeItem('iptek_token');
  localStorage.removeItem('iptek_user');
  history.replaceState(null, null, window.location.pathname);
  checkAuth();
}\n\nasync function fetchAuth(url, options = {}) {
  const token = localStorage.getItem('iptek_token');
  if (!options.headers) options.headers = {};
  if (token) options.headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(url, options);
  if (res.status === 401) {
    logout();
    throw new Error('Sesi Anda telah berakhir. Silakan login kembali.');
  }
  return res;
}\n\n