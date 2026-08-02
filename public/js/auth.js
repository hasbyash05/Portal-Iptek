export const API_BASE = '/api';

export async function generateDeviceFingerprint() {
  const cached = localStorage.getItem('iptek_device_fp');
  if (cached) return cached;
  
  const fp = btoa(navigator.userAgent + screen.width + navigator.language).substring(0, 32);
  localStorage.setItem('iptek_device_fp', fp);
  return fp;
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

export function checkAuth() {
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