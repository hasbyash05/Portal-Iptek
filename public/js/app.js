// === DEVICE FINGERPRINTING ===
// Menghasilkan sidik jari unik perangkat untuk anti-titip absen

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
}

function getDeviceInfo() {
  return JSON.stringify({
    userAgent: navigator.userAgent,
    platform: navigator.platform,
    screen: `${screen.width}x${screen.height}`,
    language: navigator.language,
    touchPoints: navigator.maxTouchPoints || 0
  });
}

const API_BASE = '/api';

// Initialize App
document.addEventListener('DOMContentLoaded', () => {
  checkAuth();
});

// Authentication Checker
function checkAuth() {
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
}

function showView(viewId) {
  document.querySelectorAll('.view-section').forEach(sec => sec.classList.remove('active'));
  document.querySelectorAll('.view-section').forEach(sec => sec.style.display = 'none');
  const activeSec = document.getElementById(viewId);
  if (activeSec) {
    activeSec.style.display = 'block';
    activeSec.classList.add('active');
  }
}

// LOGIN ROUTine
async function handleLogin(e) {
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
}

function logout() {
  localStorage.removeItem('iptek_token');
  localStorage.removeItem('iptek_user');
  history.replaceState(null, null, window.location.pathname);
  checkAuth();
}

// Fetch helper with Auth Header
async function fetchAuth(url, options = {}) {
  const token = localStorage.getItem('iptek_token');
  if (!options.headers) options.headers = {};
  if (token) options.headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(url, options);
  if (res.status === 401) {
    logout();
    throw new Error('Sesi Anda telah berakhir. Silakan login kembali.');
  }
  return res;
}

/* ==========================================================
   HEADER NAVIGATION
========================================================== */
function toggleMobileMenu(open) {
  const navMenu = document.getElementById('navMenu');
  const backdrop = document.getElementById('navBackdrop');
  const toggle = document.getElementById('mobileToggle');
  if (!navMenu) return;
  const isOpen = typeof open === 'boolean' ? open : !navMenu.classList.contains('mobile-open');
  navMenu.classList.toggle('mobile-open', isOpen);
  if (backdrop) backdrop.classList.toggle('show', isOpen);
  if (toggle) {
    toggle.setAttribute('aria-expanded', isOpen);
    toggle.innerHTML = isOpen ? '<i class="fa-solid fa-xmark"></i>' : '<i class="fa-solid fa-bars"></i>';
  }
}

function toggleAccountMenu(e) {
  if (e) {
    e.preventDefault();
    e.stopPropagation();
  }
  const item = document.getElementById('nav-item-akun');
  if (item) {
    item.classList.toggle('active');
  }
}

document.addEventListener('click', (e) => {
  const item = document.getElementById('nav-item-akun');
  if (item && !item.contains(e.target)) {
    item.classList.remove('active');
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    const nav = document.getElementById('navMenu');
    if (nav && nav.classList.contains('mobile-open')) toggleMobileMenu(false);
    const item = document.getElementById('nav-item-akun');
    if (item && item.classList.contains('active')) item.classList.remove('active');
  }
});

function switchNavTab(tabName, fromHash = false) {
  toggleMobileMenu(false);
  const accountItem = document.getElementById('nav-item-akun');
  if (accountItem) accountItem.classList.remove('active');

  if (!fromHash && window.location.hash !== '#' + tabName) {
    history.pushState(null, null, '#' + tabName);
  }

  const userStr = localStorage.getItem('iptek_user');
  if (!userStr) return;
  const user = JSON.parse(userStr);

  document.querySelectorAll('.nav-link').forEach(link => {
    link.classList.remove('active');
    if (link.getAttribute('data-tab') === tabName) {
      link.classList.add('active');
    }
  });

  if (tabName === 'absensi') {
    checkKasAndUnlockAttendance();
    return;
  }

  switchTab(tabName, user);
}

// Dengarkan perubahan URL hash (misalnya saat tombol Back/Forward browser diubah)
window.addEventListener('hashchange', () => {
  const hashTab = window.location.hash.replace('#', '');
  const userStr = localStorage.getItem('iptek_user');
  if (!userStr || !hashTab) return;
  const user = JSON.parse(userStr);
  const validTabs = (user.role === 'pengurus' || user.role === 'admin') ? 
    ['overview', 'laporan', 'materi', 'absensi', 'kas', 'anggota'] : 
    ['overview', 'materi', 'absensi', 'kas'];

  if (validTabs.includes(hashTab)) {
    switchNavTab(hashTab, true);
  }
});

/* ==========================================================
   PENGURUS LOGIC & TABS
========================================================== */
function switchTab(tabName, user) {
  if (!user) {
    const userStr = localStorage.getItem('iptek_user');
    if (!userStr) return;
    user = JSON.parse(userStr);
  }

  document.querySelectorAll('#main-view .tab-content').forEach(c => {
    if (c.parentElement.id === 'main-view') c.style.display = 'none';
  });
  
  const contentEl = document.getElementById('tab-' + tabName);
  if (contentEl) contentEl.style.display = 'block';

  const role = user.role;
  const divisi = user.divisi ? user.divisi.toLowerCase() : '';

  const isOperasional = role === 'admin' || (role === 'pengurus' && divisi.includes('operasional'));
  const isKetuaWakil = role === 'admin' || (role === 'pengurus' && (divisi.includes('ketua') || divisi.includes('wakil')));
  const isBendahara = role === 'admin' || (role === 'pengurus' && divisi.includes('bendahara'));
  const isPengurusOrAdmin = role === 'admin' || role === 'pengurus';

  const el = (id) => document.getElementById(id);
  
  if (el('view-materi-pengurus')) el('view-materi-pengurus').style.display = isPengurusOrAdmin ? 'block' : 'none';
  if (el('view-absensi-pengurus')) el('view-absensi-pengurus').style.display = isKetuaWakil ? 'block' : 'none';
  if (el('view-kas-pengurus')) el('view-kas-pengurus').style.display = isBendahara ? 'block' : 'none';
  
  if (el('view-overview-pengurus')) el('view-overview-pengurus').style.display = isPengurusOrAdmin ? 'block' : 'none';
  if (el('view-overview-anggota')) el('view-overview-anggota').style.display = isPengurusOrAdmin ? 'none' : 'block';

  if (tabName === 'overview') {
    if (isPengurusOrAdmin) loadPengurusOverview();
    else loadAnggotaOverview();
  }
  if (tabName === 'laporan' && isPengurusOrAdmin) loadPengurusLaporan();
  if (tabName === 'materi') {
    loadAnggotaMateri();
    if (isPengurusOrAdmin) loadPengurusMateri();
  }
  if (tabName === 'absensi') {
    loadAnggotaAttendance();
    loadSessionStatus();
    if (isKetuaWakil) loadPengurusAbsensi();
  }
  if (tabName === 'kas') {
    loadAnggotaKas();
    if (isBendahara) loadKasReport('');
  }
  if (tabName === 'anggota' && isPengurusOrAdmin) loadAnggotaList();
}

async function loadPengurusOverview() {
  try {
    const res = await fetchAuth(`${API_BASE}/dashboard/stats`);
    const data = await res.json();
    if (data.status === 'success') {
      const stats = data.data.overview;
      document.getElementById('stat-total-anggota').textContent = stats.totalMembers || 0;
      document.getElementById('stat-total-pengurus').textContent = stats.totalPengurus || 0;
      const kasStatEl = document.getElementById('stat-lunas-kas') || document.getElementById('stat-pending-kas');
      if (kasStatEl) {
        kasStatEl.textContent = stats.kasLunasBulanIni !== undefined ? `${stats.kasLunasBulanIni}` : (stats.pendingPayments || 0);
      }

      // Check current weekly report status
      const repRes = await fetchAuth(`${API_BASE}/reports/check`);
      const repData = await repRes.json();
      const badge = document.getElementById('stat-report-badge');
      if (repData.data && repData.data.hasReported) {
        badge.textContent = 'Sudah Lapor';
        badge.style.color = '#18181b';
      } else {
        badge.textContent = 'Belum Lapor';
        badge.style.color = '#71717a';
      }

      // Render recent reports
      const listContainer = document.getElementById('recent-reports-list');
      const reports = data.data.recentReports || [];
      if (reports.length === 0) {
        listContainer.innerHTML = `<p class="text-muted">Belum ada aktivitas dilaporkan.</p>`;
      } else {
        listContainer.innerHTML = reports.map(r => `
          <div style="padding: 0.8rem 0; border-bottom: 1px solid var(--border-color);">
            <strong style="color: var(--accent-primary);">${r.user ? r.user.nama_lengkap : 'Admin'} (${r.user ? r.user.divisi : '-'})</strong>
            <p style="font-size: 0.85rem; margin-top: 4px;">${r.activity}</p>
            <small class="text-muted">Minggu ke-${r.week_number} (${r.year})</small>
          </div>
        `).join('');
      }
    }
  } catch (err) {
    console.error('Gagal memuat overview:', err);
  }
}

async function loadPengurusLaporan() {
  try {
    const checkRes = await fetchAuth(`${API_BASE}/reports/check`);
    const checkData = await checkRes.json();
    const statusBox = document.getElementById('laporan-status-box');

    if (checkData.data && checkData.data.hasReported) {
      statusBox.className = 'alert alert-success mb-3';
      statusBox.innerHTML = `Anda sudah melaporkan kegiatan untuk <strong>Minggu ke-${checkData.data.currentWeek}</strong> Tahun ${checkData.data.currentYear}.`;
      document.getElementById('form-laporan').style.display = 'none';
    } else {
      statusBox.className = 'alert alert-info mb-3';
      statusBox.innerHTML = `Silakan isi laporan kegiatan untuk <strong>Minggu ke-${checkData.data ? checkData.data.currentWeek : ''}</strong>.`;
      document.getElementById('form-laporan').style.display = 'block';
    }

    const histRes = await fetchAuth(`${API_BASE}/reports/history?limit=20`);
    const histData = await histRes.json();
    const tbody = document.getElementById('table-my-reports');
    const items = histData.data ? histData.data.items : [];

    if (items.length === 0) {
      tbody.innerHTML = `<tr><td colspan="4" class="text-center">Belum ada riwayat laporan kegiatan divisi.</td></tr>`;
    } else {
      tbody.innerHTML = items.map(r => `
        <tr>
          <td><strong>Minggu ke-${r.week_number}</strong><br><small class="text-muted">${r.year}</small></td>
          <td><span style="font-weight: 700; color: #18181b;">${r.user ? r.user.divisi : '-'}</span><br><small class="text-muted">${r.user ? r.user.nama_lengkap : ''}</small></td>
          <td style="white-space: pre-wrap; line-height: 1.6;">${r.activity}</td>
          <td>${r.attachment_path ? `<a href="${r.attachment_path}" target="_blank" class="btn btn-outline btn-sm"><i class="fa-solid fa-paperclip"></i> Lihat File</a>` : '-'}</td>
        </tr>
      `).join('');
    }
  } catch (err) {
    console.error('Gagal memuat laporan:', err);
  }
}

async function submitLaporan(e) {
  e.preventDefault();
  const activity = document.getElementById('laporan-activity').value;
  const fileInput = document.getElementById('laporan-file');
  
  const formData = new FormData();
  formData.append('activity', activity);
  if (fileInput.files[0]) {
    formData.append('attachment', fileInput.files[0]);
  }

  try {
    const res = await fetchAuth(`${API_BASE}/reports`, {
      method: 'POST',
      body: formData
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || 'Gagal menyimpan laporan');

    alert('Laporan mingguan berhasil disimpan!');
    document.getElementById('laporan-activity').value = '';
    fileInput.value = '';
    loadPengurusLaporan();
  } catch (err) {
    alert(`Error: ${err.message}`);
  }
}

async function loadPengurusMateri() {
  loadInstructors();
  loadSchedules();
  loadMateriList('list-pengurus-materi', true);
  loadDocumentTemplates('list-pengurus-templates', true);
}

function getAuthTokenParam() {
  const token = localStorage.getItem('iptek_token');
  return token ? `?token=${encodeURIComponent(token)}` : '';
}

async function loadDocumentTemplates(containerId, showActions) {
  try {
    const res = await fetchAuth(`${API_BASE}/templates`);
    const data = await res.json();
    const container = document.getElementById(containerId);
    if (!container) return;
    const items = data.data || [];

    if (items.length === 0) {
      container.innerHTML = '<p class="text-muted">Belum ada template dokumen yang diunggah.</p>';
    } else {
      container.innerHTML = items.map(t => `
        <div class="materi-item" style="border: 1px solid #e4e4e7; padding: 1.2rem; border-radius: 8px; margin-bottom: 1rem; background: #ffffff;">
          <div class="materi-content">
            <span style="font-size: 0.75rem; font-weight: 700; background: #f4f4f5; color: #27272a; padding: 3px 8px; border-radius: 4px; text-transform: uppercase;">${t.category}</span>
            <h4 style="margin-top: 0.5rem; margin-bottom: 0.3rem; font-size: 1.05rem; color: #18181b;">${t.title}</h4>
            <p style="color: #4b5563; font-size: 0.88rem; margin-bottom: 0.8rem;">${t.description || 'Tidak ada deskripsi'}</p>
            <div class="materi-meta" style="font-size: 0.78rem; color: #71717a;">
              <span><i class="fa-solid fa-user"></i> Diunggah oleh: ${t.uploaded_by}</span>
            </div>
          </div>
          <div class="materi-actions" style="margin-top: 1rem; display: flex; gap: 0.5rem;">
            <a href="${t.download_url}${getAuthTokenParam()}" target="_blank" class="btn btn-primary btn-sm"><i class="fa-solid fa-download"></i> Unduh Dokumen</a>
            ${showActions ? `<button onclick="deleteDocumentTemplate(${t.id})" class="btn btn-logout btn-sm"><i class="fa-solid fa-trash"></i> Hapus</button>` : ''}
          </div>
        </div>
      `).join('');
    }
  } catch (err) {
    console.error('Gagal memuat template dokumen:', err);
  }
}

async function submitDocumentTemplate(e) {
  e.preventDefault();
  const title = document.getElementById('template-title').value;
  const category = document.getElementById('template-category').value;
  const desc = document.getElementById('template-desc').value;
  const fileInput = document.getElementById('template-file');

  if (!fileInput.files[0]) {
    alert('Silakan pilih file template dokumen terlebih dahulu.');
    return;
  }

  const formData = new FormData();
  formData.append('title', title);
  formData.append('category', category);
  formData.append('description', desc);
  formData.append('template_file', fileInput.files[0]);

  try {
    const res = await fetchAuth(`${API_BASE}/templates`, {
      method: 'POST',
      body: formData
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || 'Gagal mengunggah template dokumen');

    alert('Template dokumen berhasil diunggah!');
    document.getElementById('template-title').value = '';
    document.getElementById('template-category').value = '';
    document.getElementById('template-desc').value = '';
    fileInput.value = '';
    loadDocumentTemplates('list-pengurus-templates', true);
  } catch (err) {
    alert(`Error: ${err.message}`);
  }
}

async function deleteDocumentTemplate(id) {
  if (!confirm('Apakah Anda yakin ingin menghapus template dokumen ini?')) return;
  try {
    const res = await fetchAuth(`${API_BASE}/templates/${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Gagal menghapus template dokumen');
    alert('Template dokumen berhasil dihapus.');
    loadDocumentTemplates('list-pengurus-templates', true);
  } catch (err) {
    alert(`Error: ${err.message}`);
  }
}

async function loadInstructors() {
  try {
    const res = await fetchAuth(`${API_BASE}/materials/instructors`);
    const data = await res.json();
    const select = document.getElementById('jadwal-instructor');
    if (!select) return;
    const items = data.data || [];
    select.innerHTML = '<option value="">-- Pilih Pemateri --</option>' +
      items.map(i => `<option value="${i.id}">${i.nama_lengkap}${i.divisi ? ' (' + i.divisi + ')' : ''}</option>`).join('') +
      '<option value="other" style="font-weight: bold; color: #18181b;">+ Pemateri Lainnya / Dosen Pembimbing...</option>';
  } catch (err) {
    console.error('Gagal memuat daftar pemateri:', err);
  }
}

function toggleCustomInstructor(val) {
  const groupEl = document.getElementById('group-instructor-other');
  const inputEl = document.getElementById('jadwal-instructor-other');
  if (!groupEl) return;
  if (val === 'other') {
    groupEl.style.display = 'block';
    if (inputEl) inputEl.required = true;
  } else {
    groupEl.style.display = 'none';
    if (inputEl) {
      inputEl.required = false;
      inputEl.value = '';
    }
  }
}

async function loadSchedules() {
  try {
    const res = await fetchAuth(`${API_BASE}/materials/schedules`);
    const data = await res.json();
    const items = data.data || [];

    // Render tabel Pengurus
    const tbody = document.getElementById('table-jadwal');
    if (tbody) {
      if (items.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" class="text-center">Belum ada jadwal pertemuan.</td></tr>';
      } else {
        tbody.innerHTML = items.map(s => {
          const dateFormatted = new Date(s.date).toLocaleDateString('id-ID', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
          const materialsList = s.materials || [];
          const materialsBadge = materialsList.map(m => `
            <span style="display: inline-flex; align-items: center; gap: 6px; background: #f4f4f5; border: 1px solid #e4e4e7; padding: 3px 8px; border-radius: 6px; font-size: 0.8rem; margin: 2px;">
              <a href="/api/materials/download/${m.id}${getAuthTokenParam()}" target="_blank" style="color: #18181b; text-decoration: none; font-weight: 600;"><i class="fa-solid fa-download"></i> ${m.title}</a>
              <button onclick="unlinkMaterial(${s.id}, ${m.id})" style="background: none; border: none; color: #dc2626; cursor: pointer; font-size: 0.85rem;" title="Lepas file ini">&times;</button>
            </span>
          `).join('');
          const materialCell = `
            <div style="display: flex; flex-wrap: wrap; gap: 4px; align-items: center;">
              ${materialsBadge}
              <button onclick="showLinkMaterial(${s.id})" class="btn btn-outline btn-sm" style="padding: 3px 8px; font-size: 0.78rem;"><i class="fa-solid fa-plus"></i> ${materialsList.length > 0 ? 'Tambah Materi' : 'Tautkan Materi'}</button>
            </div>`;
          return `
            <tr>
              <td><strong>${dateFormatted}</strong></td>
              <td>${s.topic}${s.description ? '<br><small style="color: #71717a;">' + s.description + '</small>' : ''}</td>
              <td>${s.instructor ? s.instructor.nama_lengkap : '-'}${s.instructor && s.instructor.divisi ? '<br><small style="color: #71717a;">' + s.instructor.divisi + '</small>' : ''}</td>
              <td>${materialCell}</td>
              <td><button onclick="deleteSchedule(${s.id})" class="btn btn-logout btn-sm"><i class="fa-solid fa-trash"></i></button></td>
            </tr>`;
        }).join('');
      }
    }

    // Render tabel Anggota
    const tbodyAnggota = document.getElementById('table-jadwal-anggota');
    if (tbodyAnggota) {
      if (items.length === 0) {
        tbodyAnggota.innerHTML = '<tr><td colspan="4" class="text-center">Belum ada jadwal pertemuan.</td></tr>';
      } else {
        tbodyAnggota.innerHTML = items.map(s => {
          const dateFormatted = new Date(s.date).toLocaleDateString('id-ID', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
          const materialsList = s.materials || [];
          const materialCell = materialsList.length === 0
            ? '<span style="color: #71717a;">Belum ada materi</span>'
            : `<div style="display: flex; flex-wrap: wrap; gap: 4px;">
                ${materialsList.map(m => `
                  <a href="/api/materials/download/${m.id}${getAuthTokenParam()}" target="_blank" class="btn btn-outline btn-sm" style="padding: 3px 8px; font-size: 0.8rem;"><i class="fa-solid fa-download"></i> ${m.title}</a>
                `).join('')}
               </div>`;
          return `
            <tr>
              <td><strong>${dateFormatted}</strong></td>
              <td>${s.topic}${s.description ? '<br><small style="color: #71717a;">' + s.description + '</small>' : ''}</td>
              <td>${s.instructor ? s.instructor.nama_lengkap : '-'}</td>
              <td>${materialCell}</td>
            </tr>`;
        }).join('');
      }
    }
  } catch (err) {
    console.error('Gagal memuat jadwal:', err);
  }
}

async function unlinkMaterial(scheduleId, materialId) {
  if (!confirm('Apakah Anda yakin ingin melepaskan materi ini dari jadwal?')) return;
  try {
    const res = await fetchAuth(`${API_BASE}/materials/schedules/${scheduleId}/link/${materialId}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Gagal melepaskan materi');
    loadSchedules();
  } catch (err) {
    alert(`Error: ${err.message}`);
  }
}

async function submitJadwal(e) {
  e.preventDefault();
  const date = document.getElementById('jadwal-date').value;
  const topic = document.getElementById('jadwal-topic').value;
  const description = document.getElementById('jadwal-desc').value;
  const instructorSelect = document.getElementById('jadwal-instructor').value;
  const instructorOther = document.getElementById('jadwal-instructor-other') ? document.getElementById('jadwal-instructor-other').value : '';

  const payload = { date, topic, description };
  if (instructorSelect === 'other') {
    if (!instructorOther || !instructorOther.trim()) {
      alert('Silakan masukkan nama pemateri / dosen pembimbing.');
      return;
    }
    payload.instructor_name = instructorOther.trim();
  } else {
    payload.instructor_id = parseInt(instructorSelect);
  }

  try {
    const res = await fetchAuth(`${API_BASE}/materials/schedules`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || 'Gagal menyimpan jadwal');

    alert('Jadwal pertemuan berhasil dibuat!');
    document.getElementById('jadwal-date').value = '';
    document.getElementById('jadwal-topic').value = '';
    document.getElementById('jadwal-desc').value = '';
    document.getElementById('jadwal-instructor').value = '';
    toggleCustomInstructor('');
    loadSchedules();
  } catch (err) {
    alert(`Error: ${err.message}`);
  }
}

async function deleteSchedule(id) {
  if (!confirm('Apakah Anda yakin ingin menghapus jadwal ini?')) return;
  try {
    const res = await fetchAuth(`${API_BASE}/materials/schedules/${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Gagal menghapus jadwal');
    alert('Jadwal berhasil dihapus.');
    loadSchedules();
  } catch (err) {
    alert(`Error: ${err.message}`);
  }
}

async function showLinkMaterial(scheduleId) {
  try {
    const res = await fetchAuth(`${API_BASE}/materials`);
    const data = await res.json();
    const items = data.data || [];

    if (items.length === 0) {
      alert('Belum ada materi yang diunggah. Silakan upload materi terlebih dahulu.');
      return;
    }

    document.getElementById('link-schedule-id').value = scheduleId;
    const select = document.getElementById('link-materi-select');
    select.innerHTML = '<option value="">-- Pilih Materi Pembelajaran --</option>' +
      items.map(m => `<option value="${m.id}">${m.title} (Minggu ke-${m.week_number})</option>`).join('');

    const modal = document.getElementById('link-materi-modal');
    modal.style.display = 'flex';
  } catch (err) {
    alert(`Error: ${err.message}`);
  }
}

function closeLinkMaterialModal() {
  const modal = document.getElementById('link-materi-modal');
  if (modal) modal.style.display = 'none';
}

async function submitLinkMaterial(e) {
  e.preventDefault();
  const scheduleId = document.getElementById('link-schedule-id').value;
  const materialId = document.getElementById('link-materi-select').value;

  if (!materialId) {
    alert('Silakan pilih materi terlebih dahulu.');
    return;
  }

  try {
    const linkRes = await fetchAuth(`${API_BASE}/materials/schedules/${scheduleId}/link`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ material_id: parseInt(materialId) })
    });
    const linkData = await linkRes.json();
    if (!linkRes.ok) throw new Error(linkData.message || 'Gagal menautkan materi');

    closeLinkMaterialModal();
    alert(linkData.message);
    loadSchedules();
  } catch (err) {
    alert(`Error: ${err.message}`);
  }
}

async function loadMateriList(containerId, showActions) {
  try {
    const res = await fetchAuth(`${API_BASE}/materials`);
    const data = await res.json();
    const container = document.getElementById(containerId);
    const items = data.data || [];

    if (items.length === 0) {
      container.innerHTML = '<p class="text-muted">Belum ada materi yang diunggah.</p>';
    } else {
      container.innerHTML = items.map(m => `
        <div class="materi-item">
          <div class="materi-content">
            <h4>${m.title}</h4>
            <p>${m.description || 'Tidak ada deskripsi'}</p>
            <div class="materi-meta">
              <span><i class="fa-solid fa-user"></i> ${m.uploaded_by} (${m.divisi})</span>
              <span><i class="fa-solid fa-calendar"></i> Minggu ke-${m.week_number} (${m.year})</span>
            </div>
          </div>
          <div class="materi-actions">
            <a href="${m.download_url}${getAuthTokenParam()}" target="_blank" class="btn btn-outline btn-sm"><i class="fa-solid fa-download"></i> Download</a>
            ${showActions ? `<button onclick="deleteMateri(${m.id})" class="btn btn-logout btn-sm"><i class="fa-solid fa-trash"></i></button>` : ''}
          </div>
        </div>
      `).join('');
    }
  } catch (err) {
    console.error('Gagal memuat materi:', err);
  }
}

async function submitMateri(e) {
  e.preventDefault();
  const title = document.getElementById('materi-title').value;
  const desc = document.getElementById('materi-desc').value;
  const fileInput = document.getElementById('materi-file');

  const formData = new FormData();
  formData.append('title', title);
  formData.append('description', desc);
  if (fileInput.files[0]) {
    formData.append('material_file', fileInput.files[0]);
  }

  try {
    const res = await fetchAuth(`${API_BASE}/materials`, {
      method: 'POST',
      body: formData
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || 'Gagal mengunggah materi');

    alert('Materi berhasil diunggah!');
    document.getElementById('materi-title').value = '';
    document.getElementById('materi-desc').value = '';
    fileInput.value = '';
    loadPengurusMateri();
  } catch (err) {
    alert(`Error: ${err.message}`);
  }
}

async function deleteMateri(id) {
  if (!confirm('Apakah Anda yakin ingin menghapus materi ini?')) return;
  try {
    const res = await fetchAuth(`${API_BASE}/materials/${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Gagal menghapus materi');
    alert('Materi dihapus.');
    loadPengurusMateri();
  } catch (err) {
    alert(`Error: ${err.message}`);
  }
}

// === SESI PRESENSI (Pengurus buka/tutup manual) ===

async function loadSessionStatus() {
  try {
    const res = await fetchAuth(`${API_BASE}/attendance/session/status`);
    const data = await res.json();
    const isActive = data.data && data.data.is_active;

    // Update badge Pengurus
    const badge = document.getElementById('session-status-badge');
    const btnOpen = document.getElementById('btn-open-session');
    const btnClose = document.getElementById('btn-close-session');

    if (badge) {
      if (isActive) {
        badge.textContent = 'SESI AKTIF';
        badge.style.background = 'transparent';
        badge.style.color = '#18181b';
      } else {
        badge.textContent = 'SESI DITUTUP';
        badge.style.background = 'transparent';
        badge.style.color = '#71717a';
      }
    }
    if (btnOpen) btnOpen.style.display = isActive ? 'none' : 'inline-flex';
    if (btnClose) btnClose.style.display = isActive ? 'inline-flex' : 'none';

    // Update status di sisi Anggota
    const anggotaStatus = document.getElementById('anggota-session-status');
    const btnSubmit = document.getElementById('btn-submit-absensi');

    if (anggotaStatus) {
      if (isActive) {
        const activator = data.data.session && data.data.session.activator ? data.data.session.activator.nama_lengkap : 'Pengurus';
        anggotaStatus.style.background = '#f0fdf4';
        anggotaStatus.innerHTML = `<p style="color: #166534; font-size: 0.95rem; margin: 0; font-weight: 600;"><i class="fa-solid fa-circle-check"></i> Sesi presensi sedang <strong>DIBUKA</strong> oleh ${activator}. Anda dapat melakukan absensi sekarang.</p>`;
      } else {
        anggotaStatus.style.background = '#fef2f2';
        anggotaStatus.innerHTML = `<p style="color: #991b1b; font-size: 0.95rem; margin: 0; font-weight: 600;"><i class="fa-solid fa-circle-xmark"></i> Sesi presensi sedang <strong>DITUTUP</strong>. Silakan tunggu Pengurus membuka sesi presensi.</p>`;
      }
    }
    if (btnSubmit) btnSubmit.disabled = !isActive;

    return isActive;
  } catch (err) {
    console.error('Gagal memuat status sesi:', err);
    return false;
  }
}

async function toggleSession(action) {
  const endpoint = action === 'open' ? '/attendance/session/open' : '/attendance/session/close';
  try {
    const res = await fetchAuth(`${API_BASE}${endpoint}`, { method: 'POST' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || 'Gagal mengubah status sesi');
    alert(data.message);
    loadSessionStatus();
  } catch (err) {
    alert(`Error: ${err.message}`);
  }
}

async function loadPengurusAbsensi(query = '') {
  try {
    loadSessionStatus();

    const res = await fetchAuth(`${API_BASE}/attendance/report${query}`);
    const data = await res.json();
    const tbody = document.getElementById('table-rekap-absensi');
    const items = data.data ? data.data.items : [];

    if (items.length === 0) {
      tbody.innerHTML = `<tr><td colspan="5" class="text-center">Belum ada data absensi yang sesuai filter.</td></tr>`;
    } else {
      tbody.innerHTML = items.map(a => `
        <tr>
          <td><strong>${a.date}</strong></td>
          <td>${a.user ? a.user.nama_lengkap : '-'}</td>
          <td><span class="user-badge">${a.user ? a.user.role : '-'}</span></td>
          <td>${a.user && a.user.divisi ? a.user.divisi : '-'}</td>
          <td><strong style="color: ${a.status === 'hadir' ? '#18181b' : '#71717a'}">${a.status.toUpperCase()}</strong></td>
        </tr>
      `).join('');
    }
  } catch (err) {
    console.error('Gagal memuat absensi:', err);
  }
}


function filterAbsensi(e) {
  e.preventDefault();
  const start = document.getElementById('filter-start-date').value;
  const end = document.getElementById('filter-end-date').value;
  const div = document.getElementById('filter-divisi').value;

  const params = new URLSearchParams();
  if (start) params.append('startDate', start);
  if (end) params.append('endDate', end);
  if (div) params.append('divisi', div);

  loadPengurusAbsensi(`?${params.toString()}`);
}

async function loadKasReport(statusFilter = '') {
  // Update button active states
  document.querySelectorAll('.filter-buttons .btn').forEach(btn => {
    btn.classList.remove('active');
  });
  if (!statusFilter) document.querySelectorAll('.filter-buttons .btn')[0].classList.add('active');
  if (statusFilter === 'pending') document.querySelectorAll('.filter-buttons .btn')[1].classList.add('active');
  if (statusFilter === 'lunas') document.querySelectorAll('.filter-buttons .btn')[2].classList.add('active');
  if (statusFilter === 'ditolak') document.querySelectorAll('.filter-buttons .btn')[3].classList.add('active');

  try {
    const query = statusFilter ? `?status=${statusFilter}` : '';
    const res = await fetchAuth(`${API_BASE}/payments/report${query}`);
    const data = await res.json();
    const tbody = document.getElementById('table-rekap-kas');
    const items = data.data ? data.data.items : [];

    const userStr = localStorage.getItem('iptek_user');
    const currentUser = userStr ? JSON.parse(userStr) : null;
    const isBendahara = currentUser && (currentUser.role === 'Pengurus' || (currentUser.divisi && currentUser.divisi.toLowerCase().includes('bendahara')));

    if (items.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" class="text-center">Belum ada data pembayaran kas.</td></tr>`;
    } else {
      tbody.innerHTML = items.map(p => `
        <tr>
          <td><strong>Bulan ${p.month} / ${p.year}</strong></td>
          <td>${p.user ? p.user.nama_lengkap : '-'} <br><small class="text-muted">${p.user && p.user.divisi ? p.user.divisi : ''}</small></td>
          <td><strong style="color: #18181b;">Rp ${Number(p.amount).toLocaleString('id-ID')}</strong></td>
          <td>
            <button onclick="openAdminBuktiModal('${encodeURIComponent(JSON.stringify(p))}')" class="btn btn-outline btn-sm" style="border-color: #18181b; color: #18181b; font-weight: 600;">
              <i class="fa-solid fa-file-image"></i> Lihat Bukti
            </button>
          </td>

          <td>
            <span style="padding: 4px 8px; border-radius: 4px; font-weight: bold; font-size: 0.8rem; background: #f4f4f5; color: #18181b;">
              ${p.status.toUpperCase()}
            </span>
          </td>
          <td>
            ${p.status === 'pending' ? (isBendahara ? `
              <button onclick="confirmKas(${p.id}, 'lunas')" class="btn btn-primary btn-sm" style="background: #18181b;"><i class="fa-solid fa-check"></i> Lunas</button>
              <button onclick="confirmKas(${p.id}, 'ditolak')" class="btn btn-logout btn-sm"><i class="fa-solid fa-xmark"></i> Tolak</button>
            ` : `<small class="text-muted" style="font-weight: 600;"><i class="fa-solid fa-clock"></i> Menunggu Verifikasi Bendahara</small>`) : `<small class="text-muted">Terverifikasi oleh ${p.verifier ? p.verifier.nama_lengkap : 'Bendahara'}</small>`}
          </td>
        </tr>
      `).join('');
    }
  } catch (err) {
    console.error('Gagal memuat kas report:', err);
  }
}

async function confirmKas(id, status) {
  if (!confirm(`Ubah status pembayaran menjadi '${status.toUpperCase()}'?`)) return;
  try {
    const res = await fetchAuth(`${API_BASE}/payments/${id}/confirm`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || 'Gagal memverifikasi');
    alert(`Pembayaran kas berhasil diubah menjadi ${status}`);
    const activeBtn = document.querySelector('.filter-buttons .btn.active');
    let filterVal = '';
    if (activeBtn) {
      const txt = activeBtn.textContent.toLowerCase();
      if (txt.includes('pending')) filterVal = 'pending';
      else if (txt.includes('lunas')) filterVal = 'lunas';
      else if (txt.includes('ditolak')) filterVal = 'ditolak';
    }
    loadKasReport(filterVal);
  } catch (err) {
    alert(`Error: ${err.message}`);
  }
}

function openAdminBuktiModal(pEncoded) {
  try {
    const p = typeof pEncoded === 'string' ? JSON.parse(decodeURIComponent(pEncoded)) : pEncoded;
    const modal = document.getElementById('admin-bukti-modal');
    const body = document.getElementById('admin-bukti-modal-body');
    if (!modal || !body) return;

    const hasUploadedFile = p.proof_path && (p.proof_path.startsWith('/uploads') || p.proof_path.startsWith('http'));
    const isImage = hasUploadedFile && /\.(jpg|jpeg|png|webp|gif)$/i.test(p.proof_path);

    if (hasUploadedFile) {
      if (isImage) {
        body.innerHTML = `
          <div style="text-align: center; padding: 0.5rem;">
            <a href="${p.proof_path}" target="_blank" title="Klik untuk ukuran penuh">
              <img src="${p.proof_path}" style="max-width: 100%; max-height: 70vh; object-fit: contain; border-radius: 6px; border: 1px solid #e4e4e7; box-shadow: 0 4px 12px rgba(0,0,0,0.08);" alt="Bukti Pembayaran">
            </a>
            <p style="font-size: 0.75rem; color: #71717a; margin-top: 10px; margin-bottom: 0;">Klik gambar untuk membuka di tab baru</p>
          </div>
        `;
      } else {
        body.innerHTML = `
          <div style="text-align: center; padding: 2.5rem 1rem; background: #f8f9fa; border-radius: 8px;">
            <p style="font-size: 0.9rem; font-weight: 700; color: #18181b; margin-bottom: 1rem;">Dokumen Bukti Transfer (PDF / File)</p>
            <a href="${p.proof_path}" target="_blank" class="btn btn-primary" style="background: #18181b; padding: 0.8rem 1.5rem;">
              <i class="fa-solid fa-file-arrow-down"></i> Buka File Bukti Pembayaran
            </a>
          </div>
        `;
      }
    } else {
      body.innerHTML = `
        <div style="text-align: center; padding: 2.5rem 1rem; background: #f8f9fa; border-radius: 8px;">
          <p style="font-size: 0.9rem; font-weight: 600; color: #4b5563; margin: 0;">
            Anggota tidak melampirkan gambar bukti pembayaran.
          </p>
        </div>
      `;
    }

    modal.style.display = 'flex';
  } catch (err) {
    console.error('Error opening bukti modal:', err);
  }
}

function closeAdminBuktiModal() {
  const modal = document.getElementById('admin-bukti-modal');
  if (modal) {
    modal.style.display = 'none';
  }
}


/* ==========================================================
   ANGGOTA LOGIC & TABS
========================================================== */
function switchAnggotaTab(tabName) {
  if (tabName === 'absensi') {
    checkKasAndUnlockAttendance();
    return;
  }

  document.querySelectorAll('#anggota-view .tab-btn').forEach(btn => btn.classList.remove('active'));
  document.querySelectorAll('#anggota-view .tab-content').forEach(c => c.style.display = 'none');

  const tabs = ['overview', 'materi', 'absensi', 'kas'];
  const idx = tabs.indexOf(tabName);
  if (idx >= 0) {
    const btns = document.querySelectorAll('#anggota-view .tab-btn');
    if (btns[idx]) btns[idx].classList.add('active');
    const contentEl = document.getElementById(`a-tab-${tabName}`);
    if (contentEl) contentEl.style.display = 'block';
  }

  if (tabName === 'materi') loadAnggotaMateri();
  if (tabName === 'kas') loadAnggotaKas();
}

async function checkKasAndUnlockAttendance() {
  const userStr = localStorage.getItem('iptek_user');
  if (!userStr) return;
  const user = JSON.parse(userStr);
  
  const isBendahara = user.role === 'pengurus' && user.divisi && user.divisi.toLowerCase().includes('bendahara');
  if (user.role === 'admin' || isBendahara) {
    document.getElementById('qris-lock-modal').style.display = 'none';
    switchTab('absensi', user);
    return;
  }

  try {
    const res = await fetchAuth(API_BASE + '/payments/check');
    const data = await res.json();
    const modal = document.getElementById('qris-lock-modal');
    const statusText = document.getElementById('qris-modal-status-box');

    if (data.status === 'success' && data.data && data.data.hasPaid) {
      if (modal) modal.style.display = 'none';
      switchTab('absensi', user);
    } else {
      if (modal) modal.style.display = 'flex';
      if (statusText && data.data && data.data.payment) {
         if (data.data.payment.status === 'pending') {
           statusText.innerHTML = '<div class="alert alert-info" style="margin-bottom: 1rem; font-size: 0.85rem;">Pembayaran Kas Anda sedang <strong>menunggu verifikasi</strong> Bendahara.</div>';
         } else if (data.data.payment.status === 'ditolak') {
           statusText.innerHTML = '<div class="alert alert-danger" style="margin-bottom: 1rem; font-size: 0.85rem;">Pembayaran Kas Anda <strong>ditolak</strong>. Silakan periksa kembali.</div>';
         }
      }
      switchTab('absensi', user);
    }
  } catch (err) {
    console.error('Kas check error:', err);
    switchTab('absensi', user);
  }
}

// === DEVICE FINGERPRINTING ===
// Menghasilkan sidik jari unik perangkat untuk anti-titip absen

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
}

function getDeviceInfo() {
  return JSON.stringify({
    userAgent: navigator.userAgent,
    platform: navigator.platform,
    screen: `${screen.width}x${screen.height}`,
    language: navigator.language,
    touchPoints: navigator.maxTouchPoints || 0
  });
}


// Initialize App
document.addEventListener('DOMContentLoaded', () => {
  checkAuth();
});

// Authentication Checker
function checkAuth() {
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
}

function showView(viewId) {
  document.querySelectorAll('.view-section').forEach(sec => sec.classList.remove('active'));
  document.querySelectorAll('.view-section').forEach(sec => sec.style.display = 'none');
  const activeSec = document.getElementById(viewId);
  if (activeSec) {
    activeSec.style.display = 'block';
    activeSec.classList.add('active');
  }
}

// LOGIN ROUTine
async function handleLogin(e) {
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
}

function logout() {
  localStorage.removeItem('iptek_token');
  localStorage.removeItem('iptek_user');
  history.replaceState(null, null, window.location.pathname);
  checkAuth();
}

// Fetch helper with Auth Header
async function fetchAuth(url, options = {}) {
  const token = localStorage.getItem('iptek_token');
  if (!options.headers) options.headers = {};
  if (token) options.headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(url, options);
  if (res.status === 401) {
    logout();
    throw new Error('Sesi Anda telah berakhir. Silakan login kembali.');
  }
  return res;
}

/* ==========================================================
   HEADER NAVIGATION
========================================================== */
function toggleMobileMenu(open) {
  const navMenu = document.getElementById('navMenu');
  const backdrop = document.getElementById('navBackdrop');
  const toggle = document.getElementById('mobileToggle');
  if (!navMenu) return;
  const isOpen = typeof open === 'boolean' ? open : !navMenu.classList.contains('mobile-open');
  navMenu.classList.toggle('mobile-open', isOpen);
  if (backdrop) backdrop.classList.toggle('show', isOpen);
  if (toggle) {
    toggle.setAttribute('aria-expanded', isOpen);
    toggle.innerHTML = isOpen ? '<i class="fa-solid fa-xmark"></i>' : '<i class="fa-solid fa-bars"></i>';
  }
}

function toggleAccountMenu(e) {
  if (e) {
    e.preventDefault();
    e.stopPropagation();
  }
  const item = document.getElementById('nav-item-akun');
  if (item) {
    item.classList.toggle('active');
  }
}

document.addEventListener('click', (e) => {
  const item = document.getElementById('nav-item-akun');
  if (item && !item.contains(e.target)) {
    item.classList.remove('active');
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    const nav = document.getElementById('navMenu');
    if (nav && nav.classList.contains('mobile-open')) toggleMobileMenu(false);
    const item = document.getElementById('nav-item-akun');
    if (item && item.classList.contains('active')) item.classList.remove('active');
  }
});

function switchNavTab(tabName, fromHash = false) {
  toggleMobileMenu(false);
  const accountItem = document.getElementById('nav-item-akun');
  if (accountItem) accountItem.classList.remove('active');

  if (!fromHash && window.location.hash !== '#' + tabName) {
    history.pushState(null, null, '#' + tabName);
  }

  const userStr = localStorage.getItem('iptek_user');
  if (!userStr) return;
  const user = JSON.parse(userStr);

  document.querySelectorAll('.nav-link').forEach(link => {
    link.classList.remove('active');
    if (link.getAttribute('data-tab') === tabName) {
      link.classList.add('active');
    }
  });

  if (tabName === 'absensi') {
    checkKasAndUnlockAttendance();
    return;
  }

  switchTab(tabName, user);
}

// Dengarkan perubahan URL hash (misalnya saat tombol Back/Forward browser diubah)
window.addEventListener('hashchange', () => {
  const hashTab = window.location.hash.replace('#', '');
  const userStr = localStorage.getItem('iptek_user');
  if (!userStr || !hashTab) return;
  const user = JSON.parse(userStr);
  const validTabs = (user.role === 'pengurus' || user.role === 'admin') ? 
    ['overview', 'laporan', 'materi', 'absensi', 'kas', 'anggota'] : 
    ['overview', 'materi', 'absensi', 'kas'];

  if (validTabs.includes(hashTab)) {
    switchNavTab(hashTab, true);
  }
});

/* ==========================================================
   PENGURUS LOGIC & TABS
========================================================== */
function switchTab(tabName, user) {
  if (!user) {
    const userStr = localStorage.getItem('iptek_user');
    if (!userStr) return;
    user = JSON.parse(userStr);
  }

  document.querySelectorAll('#main-view .tab-content').forEach(c => {
    if (c.parentElement.id === 'main-view') c.style.display = 'none';
  });
  
  const contentEl = document.getElementById('tab-' + tabName);
  if (contentEl) contentEl.style.display = 'block';

  const role = user.role;
  const divisi = user.divisi ? user.divisi.toLowerCase() : '';

  const isOperasional = role === 'admin' || (role === 'pengurus' && divisi.includes('operasional'));
  const isKetuaWakil = role === 'admin' || (role === 'pengurus' && (divisi.includes('ketua') || divisi.includes('wakil')));
  const isBendahara = role === 'admin' || (role === 'pengurus' && divisi.includes('bendahara'));
  const isPengurusOrAdmin = role === 'admin' || role === 'pengurus';

  const el = (id) => document.getElementById(id);
  
  if (el('view-materi-pengurus')) el('view-materi-pengurus').style.display = isPengurusOrAdmin ? 'block' : 'none';
  if (el('view-absensi-pengurus')) el('view-absensi-pengurus').style.display = isKetuaWakil ? 'block' : 'none';
  if (el('view-kas-pengurus')) el('view-kas-pengurus').style.display = isBendahara ? 'block' : 'none';
  
  if (el('view-overview-pengurus')) el('view-overview-pengurus').style.display = isPengurusOrAdmin ? 'block' : 'none';
  if (el('view-overview-anggota')) el('view-overview-anggota').style.display = isPengurusOrAdmin ? 'none' : 'block';

  if (tabName === 'overview') {
    if (isPengurusOrAdmin) loadPengurusOverview();
    else loadAnggotaOverview();
  }
  if (tabName === 'laporan' && isPengurusOrAdmin) loadPengurusLaporan();
  if (tabName === 'materi') {
    loadAnggotaMateri();
    if (isPengurusOrAdmin) loadPengurusMateri();
  }
  if (tabName === 'absensi') {
    loadAnggotaAttendance();
    loadSessionStatus();
    if (isKetuaWakil) loadPengurusAbsensi();
  }
  if (tabName === 'kas') {
    loadAnggotaKas();
    if (isBendahara) loadKasReport('');
  }
  if (tabName === 'anggota' && isPengurusOrAdmin) loadAnggotaList();
}

async function loadPengurusOverview() {
  try {
    const res = await fetchAuth(`${API_BASE}/dashboard/stats`);
    const data = await res.json();
    if (data.status === 'success') {
      const stats = data.data.overview;
      document.getElementById('stat-total-anggota').textContent = stats.totalMembers || 0;
      document.getElementById('stat-total-pengurus').textContent = stats.totalPengurus || 0;
      const kasStatEl = document.getElementById('stat-lunas-kas') || document.getElementById('stat-pending-kas');
      if (kasStatEl) {
        kasStatEl.textContent = stats.kasLunasBulanIni !== undefined ? `${stats.kasLunasBulanIni}` : (stats.pendingPayments || 0);
      }

      // Check current weekly report status
      const repRes = await fetchAuth(`${API_BASE}/reports/check`);
      const repData = await repRes.json();
      const badge = document.getElementById('stat-report-badge');
      if (repData.data && repData.data.hasReported) {
        badge.textContent = 'Sudah Lapor';
        badge.style.color = '#18181b';
      } else {
        badge.textContent = 'Belum Lapor';
        badge.style.color = '#71717a';
      }

      // Render recent reports
      const listContainer = document.getElementById('recent-reports-list');
      const reports = data.data.recentReports || [];
      if (reports.length === 0) {
        listContainer.innerHTML = `<p class="text-muted">Belum ada aktivitas dilaporkan.</p>`;
      } else {
        listContainer.innerHTML = reports.map(r => `
          <div style="padding: 0.8rem 0; border-bottom: 1px solid var(--border-color);">
            <strong style="color: var(--accent-primary);">${r.user ? r.user.nama_lengkap : 'Admin'} (${r.user ? r.user.divisi : '-'})</strong>
            <p style="font-size: 0.85rem; margin-top: 4px;">${r.activity}</p>
            <small class="text-muted">Minggu ke-${r.week_number} (${r.year})</small>
          </div>
        `).join('');
      }
    }
  } catch (err) {
    console.error('Gagal memuat overview:', err);
  }
}

async function loadPengurusLaporan() {
  try {
    const checkRes = await fetchAuth(`${API_BASE}/reports/check`);
    const checkData = await checkRes.json();
    const statusBox = document.getElementById('laporan-status-box');

    if (checkData.data && checkData.data.hasReported) {
      statusBox.className = 'alert alert-success mb-3';
      statusBox.innerHTML = `Anda sudah melaporkan kegiatan untuk <strong>Minggu ke-${checkData.data.currentWeek}</strong> Tahun ${checkData.data.currentYear}.`;
      document.getElementById('form-laporan').style.display = 'none';
    } else {
      statusBox.className = 'alert alert-info mb-3';
      statusBox.innerHTML = `Silakan isi laporan kegiatan untuk <strong>Minggu ke-${checkData.data ? checkData.data.currentWeek : ''}</strong>.`;
      document.getElementById('form-laporan').style.display = 'block';
    }

    const histRes = await fetchAuth(`${API_BASE}/reports/history?limit=20`);
    const histData = await histRes.json();
    const tbody = document.getElementById('table-my-reports');
    const items = histData.data ? histData.data.items : [];

    if (items.length === 0) {
      tbody.innerHTML = `<tr><td colspan="4" class="text-center">Belum ada riwayat laporan kegiatan divisi.</td></tr>`;
    } else {
      tbody.innerHTML = items.map(r => `
        <tr>
          <td><strong>Minggu ke-${r.week_number}</strong><br><small class="text-muted">${r.year}</small></td>
          <td><span style="font-weight: 700; color: #18181b;">${r.user ? r.user.divisi : '-'}</span><br><small class="text-muted">${r.user ? r.user.nama_lengkap : ''}</small></td>
          <td style="white-space: pre-wrap; line-height: 1.6;">${r.activity}</td>
          <td>${r.attachment_path ? `<a href="${r.attachment_path}" target="_blank" class="btn btn-outline btn-sm"><i class="fa-solid fa-paperclip"></i> Lihat File</a>` : '-'}</td>
        </tr>
      `).join('');
    }
  } catch (err) {
    console.error('Gagal memuat laporan:', err);
  }
}

async function submitLaporan(e) {
  e.preventDefault();
  const activity = document.getElementById('laporan-activity').value;
  const fileInput = document.getElementById('laporan-file');
  
  const formData = new FormData();
  formData.append('activity', activity);
  if (fileInput.files[0]) {
    formData.append('attachment', fileInput.files[0]);
  }

  try {
    const res = await fetchAuth(`${API_BASE}/reports`, {
      method: 'POST',
      body: formData
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || 'Gagal menyimpan laporan');

    alert('Laporan mingguan berhasil disimpan!');
    document.getElementById('laporan-activity').value = '';
    fileInput.value = '';
    loadPengurusLaporan();
  } catch (err) {
    alert(`Error: ${err.message}`);
  }
}

async function loadPengurusMateri() {
  loadInstructors();
  loadSchedules();
  loadMateriList('list-pengurus-materi', true);
  loadDocumentTemplates('list-pengurus-templates', true);
}

function getAuthTokenParam() {
  const token = localStorage.getItem('iptek_token');
  return token ? `?token=${encodeURIComponent(token)}` : '';
}

async function loadDocumentTemplates(containerId, showActions) {
  try {
    const res = await fetchAuth(`${API_BASE}/templates`);
    const data = await res.json();
    const container = document.getElementById(containerId);
    if (!container) return;
    const items = data.data || [];

    if (items.length === 0) {
      container.innerHTML = '<p class="text-muted">Belum ada template dokumen yang diunggah.</p>';
    } else {
      container.innerHTML = items.map(t => `
        <div class="materi-item" style="border: 1px solid #e4e4e7; padding: 1.2rem; border-radius: 8px; margin-bottom: 1rem; background: #ffffff;">
          <div class="materi-content">
            <span style="font-size: 0.75rem; font-weight: 700; background: #f4f4f5; color: #27272a; padding: 3px 8px; border-radius: 4px; text-transform: uppercase;">${t.category}</span>
            <h4 style="margin-top: 0.5rem; margin-bottom: 0.3rem; font-size: 1.05rem; color: #18181b;">${t.title}</h4>
            <p style="color: #4b5563; font-size: 0.88rem; margin-bottom: 0.8rem;">${t.description || 'Tidak ada deskripsi'}</p>
            <div class="materi-meta" style="font-size: 0.78rem; color: #71717a;">
              <span><i class="fa-solid fa-user"></i> Diunggah oleh: ${t.uploaded_by}</span>
            </div>
          </div>
          <div class="materi-actions" style="margin-top: 1rem; display: flex; gap: 0.5rem;">
            <a href="${t.download_url}${getAuthTokenParam()}" target="_blank" class="btn btn-primary btn-sm"><i class="fa-solid fa-download"></i> Unduh Dokumen</a>
            ${showActions ? `<button onclick="deleteDocumentTemplate(${t.id})" class="btn btn-logout btn-sm"><i class="fa-solid fa-trash"></i> Hapus</button>` : ''}
          </div>
        </div>
      `).join('');
    }
  } catch (err) {
    console.error('Gagal memuat template dokumen:', err);
  }
}

async function submitDocumentTemplate(e) {
  e.preventDefault();
  const title = document.getElementById('template-title').value;
  const category = document.getElementById('template-category').value;
  const desc = document.getElementById('template-desc').value;
  const fileInput = document.getElementById('template-file');

  if (!fileInput.files[0]) {
    alert('Silakan pilih file template dokumen terlebih dahulu.');
    return;
  }

  const formData = new FormData();
  formData.append('title', title);
  formData.append('category', category);
  formData.append('description', desc);
  formData.append('template_file', fileInput.files[0]);

  try {
    const res = await fetchAuth(`${API_BASE}/templates`, {
      method: 'POST',
      body: formData
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || 'Gagal mengunggah template dokumen');

    alert('Template dokumen berhasil diunggah!');
    document.getElementById('template-title').value = '';
    document.getElementById('template-category').value = '';
    document.getElementById('template-desc').value = '';
    fileInput.value = '';
    loadDocumentTemplates('list-pengurus-templates', true);
  } catch (err) {
    alert(`Error: ${err.message}`);
  }
}

async function deleteDocumentTemplate(id) {
  if (!confirm('Apakah Anda yakin ingin menghapus template dokumen ini?')) return;
  try {
    const res = await fetchAuth(`${API_BASE}/templates/${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Gagal menghapus template dokumen');
    alert('Template dokumen berhasil dihapus.');
    loadDocumentTemplates('list-pengurus-templates', true);
  } catch (err) {
    alert(`Error: ${err.message}`);
  }
}

async function loadInstructors() {
  try {
    const res = await fetchAuth(`${API_BASE}/materials/instructors`);
    const data = await res.json();
    const select = document.getElementById('jadwal-instructor');
    if (!select) return;
    const items = data.data || [];
    select.innerHTML = '<option value="">-- Pilih Pemateri --</option>' +
      items.map(i => `<option value="${i.id}">${i.nama_lengkap}${i.divisi ? ' (' + i.divisi + ')' : ''}</option>`).join('') +
      '<option value="other" style="font-weight: bold; color: #18181b;">+ Pemateri Lainnya / Dosen Pembimbing...</option>';
  } catch (err) {
    console.error('Gagal memuat daftar pemateri:', err);
  }
}

function toggleCustomInstructor(val) {
  const groupEl = document.getElementById('group-instructor-other');
  const inputEl = document.getElementById('jadwal-instructor-other');
  if (!groupEl) return;
  if (val === 'other') {
    groupEl.style.display = 'block';
    if (inputEl) inputEl.required = true;
  } else {
    groupEl.style.display = 'none';
    if (inputEl) {
      inputEl.required = false;
      inputEl.value = '';
    }
  }
}

async function loadSchedules() {
  try {
    const res = await fetchAuth(`${API_BASE}/materials/schedules`);
    const data = await res.json();
    const items = data.data || [];

    // Render tabel Pengurus
    const tbody = document.getElementById('table-jadwal');
    if (tbody) {
      if (items.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" class="text-center">Belum ada jadwal pertemuan.</td></tr>';
      } else {
        tbody.innerHTML = items.map(s => {
          const dateFormatted = new Date(s.date).toLocaleDateString('id-ID', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
          const materialsList = s.materials || [];
          const materialsBadge = materialsList.map(m => `
            <span style="display: inline-flex; align-items: center; gap: 6px; background: #f4f4f5; border: 1px solid #e4e4e7; padding: 3px 8px; border-radius: 6px; font-size: 0.8rem; margin: 2px;">
              <a href="/api/materials/download/${m.id}${getAuthTokenParam()}" target="_blank" style="color: #18181b; text-decoration: none; font-weight: 600;"><i class="fa-solid fa-download"></i> ${m.title}</a>
              <button onclick="unlinkMaterial(${s.id}, ${m.id})" style="background: none; border: none; color: #dc2626; cursor: pointer; font-size: 0.85rem;" title="Lepas file ini">&times;</button>
            </span>
          `).join('');
          const materialCell = `
            <div style="display: flex; flex-wrap: wrap; gap: 4px; align-items: center;">
              ${materialsBadge}
              <button onclick="showLinkMaterial(${s.id})" class="btn btn-outline btn-sm" style="padding: 3px 8px; font-size: 0.78rem;"><i class="fa-solid fa-plus"></i> ${materialsList.length > 0 ? 'Tambah Materi' : 'Tautkan Materi'}</button>
            </div>`;
          return `
            <tr>
              <td><strong>${dateFormatted}</strong></td>
              <td>${s.topic}${s.description ? '<br><small style="color: #71717a;">' + s.description + '</small>' : ''}</td>
              <td>${s.instructor ? s.instructor.nama_lengkap : '-'}${s.instructor && s.instructor.divisi ? '<br><small style="color: #71717a;">' + s.instructor.divisi + '</small>' : ''}</td>
              <td>${materialCell}</td>
              <td><button onclick="deleteSchedule(${s.id})" class="btn btn-logout btn-sm"><i class="fa-solid fa-trash"></i></button></td>
            </tr>`;
        }).join('');
      }
    }

    // Render tabel Anggota
    const tbodyAnggota = document.getElementById('table-jadwal-anggota');
    if (tbodyAnggota) {
      if (items.length === 0) {
        tbodyAnggota.innerHTML = '<tr><td colspan="4" class="text-center">Belum ada jadwal pertemuan.</td></tr>';
      } else {
        tbodyAnggota.innerHTML = items.map(s => {
          const dateFormatted = new Date(s.date).toLocaleDateString('id-ID', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
          const materialsList = s.materials || [];
          const materialCell = materialsList.length === 0
            ? '<span style="color: #71717a;">Belum ada materi</span>'
            : `<div style="display: flex; flex-wrap: wrap; gap: 4px;">
                ${materialsList.map(m => `
                  <a href="/api/materials/download/${m.id}${getAuthTokenParam()}" target="_blank" class="btn btn-outline btn-sm" style="padding: 3px 8px; font-size: 0.8rem;"><i class="fa-solid fa-download"></i> ${m.title}</a>
                `).join('')}
               </div>`;
          return `
            <tr>
              <td><strong>${dateFormatted}</strong></td>
              <td>${s.topic}${s.description ? '<br><small style="color: #71717a;">' + s.description + '</small>' : ''}</td>
              <td>${s.instructor ? s.instructor.nama_lengkap : '-'}</td>
              <td>${materialCell}</td>
            </tr>`;
        }).join('');
      }
    }
  } catch (err) {
    console.error('Gagal memuat jadwal:', err);
  }
}

async function unlinkMaterial(scheduleId, materialId) {
  if (!confirm('Apakah Anda yakin ingin melepaskan materi ini dari jadwal?')) return;
  try {
    const res = await fetchAuth(`${API_BASE}/materials/schedules/${scheduleId}/link/${materialId}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Gagal melepaskan materi');
    loadSchedules();
  } catch (err) {
    alert(`Error: ${err.message}`);
  }
}

async function submitJadwal(e) {
  e.preventDefault();
  const date = document.getElementById('jadwal-date').value;
  const topic = document.getElementById('jadwal-topic').value;
  const description = document.getElementById('jadwal-desc').value;
  const instructorSelect = document.getElementById('jadwal-instructor').value;
  const instructorOther = document.getElementById('jadwal-instructor-other') ? document.getElementById('jadwal-instructor-other').value : '';

  const payload = { date, topic, description };
  if (instructorSelect === 'other') {
    if (!instructorOther || !instructorOther.trim()) {
      alert('Silakan masukkan nama pemateri / dosen pembimbing.');
      return;
    }
    payload.instructor_name = instructorOther.trim();
  } else {
    payload.instructor_id = parseInt(instructorSelect);
  }

  try {
    const res = await fetchAuth(`${API_BASE}/materials/schedules`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || 'Gagal menyimpan jadwal');

    alert('Jadwal pertemuan berhasil dibuat!');
    document.getElementById('jadwal-date').value = '';
    document.getElementById('jadwal-topic').value = '';
    document.getElementById('jadwal-desc').value = '';
    document.getElementById('jadwal-instructor').value = '';
    toggleCustomInstructor('');
    loadSchedules();
  } catch (err) {
    alert(`Error: ${err.message}`);
  }
}

async function deleteSchedule(id) {
  if (!confirm('Apakah Anda yakin ingin menghapus jadwal ini?')) return;
  try {
    const res = await fetchAuth(`${API_BASE}/materials/schedules/${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Gagal menghapus jadwal');
    alert('Jadwal berhasil dihapus.');
    loadSchedules();
  } catch (err) {
    alert(`Error: ${err.message}`);
  }
}

async function showLinkMaterial(scheduleId) {
  try {
    const res = await fetchAuth(`${API_BASE}/materials`);
    const data = await res.json();
    const items = data.data || [];

    if (items.length === 0) {
      alert('Belum ada materi yang diunggah. Silakan upload materi terlebih dahulu.');
      return;
    }

    document.getElementById('link-schedule-id').value = scheduleId;
    const select = document.getElementById('link-materi-select');
    select.innerHTML = '<option value="">-- Pilih Materi Pembelajaran --</option>' +
      items.map(m => `<option value="${m.id}">${m.title} (Minggu ke-${m.week_number})</option>`).join('');

    const modal = document.getElementById('link-materi-modal');
    modal.style.display = 'flex';
  } catch (err) {
    alert(`Error: ${err.message}`);
  }
}

function closeLinkMaterialModal() {
  const modal = document.getElementById('link-materi-modal');
  if (modal) modal.style.display = 'none';
}

async function submitLinkMaterial(e) {
  e.preventDefault();
  const scheduleId = document.getElementById('link-schedule-id').value;
  const materialId = document.getElementById('link-materi-select').value;

  if (!materialId) {
    alert('Silakan pilih materi terlebih dahulu.');
    return;
  }

  try {
    const linkRes = await fetchAuth(`${API_BASE}/materials/schedules/${scheduleId}/link`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ material_id: parseInt(materialId) })
    });
    const linkData = await linkRes.json();
    if (!linkRes.ok) throw new Error(linkData.message || 'Gagal menautkan materi');

    closeLinkMaterialModal();
    alert(linkData.message);
    loadSchedules();
  } catch (err) {
    alert(`Error: ${err.message}`);
  }
}

async function loadMateriList(containerId, showActions) {
  try {
    const res = await fetchAuth(`${API_BASE}/materials`);
    const data = await res.json();
    const container = document.getElementById(containerId);
    const items = data.data || [];

    if (items.length === 0) {
      container.innerHTML = '<p class="text-muted">Belum ada materi yang diunggah.</p>';
    } else {
      container.innerHTML = items.map(m => `
        <div class="materi-item">
          <div class="materi-content">
            <h4>${m.title}</h4>
            <p>${m.description || 'Tidak ada deskripsi'}</p>
            <div class="materi-meta">
              <span><i class="fa-solid fa-user"></i> ${m.uploaded_by} (${m.divisi})</span>
              <span><i class="fa-solid fa-calendar"></i> Minggu ke-${m.week_number} (${m.year})</span>
            </div>
          </div>
          <div class="materi-actions">
            <a href="${m.download_url}${getAuthTokenParam()}" target="_blank" class="btn btn-outline btn-sm"><i class="fa-solid fa-download"></i> Download</a>
            ${showActions ? `<button onclick="deleteMateri(${m.id})" class="btn btn-logout btn-sm"><i class="fa-solid fa-trash"></i></button>` : ''}
          </div>
        </div>
      `).join('');
    }
  } catch (err) {
    console.error('Gagal memuat materi:', err);
  }
}

async function submitMateri(e) {
  e.preventDefault();
  const title = document.getElementById('materi-title').value;
  const desc = document.getElementById('materi-desc').value;
  const fileInput = document.getElementById('materi-file');

  const formData = new FormData();
  formData.append('title', title);
  formData.append('description', desc);
  if (fileInput.files[0]) {
    formData.append('material_file', fileInput.files[0]);
  }

  try {
    const res = await fetchAuth(`${API_BASE}/materials`, {
      method: 'POST',
      body: formData
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || 'Gagal mengunggah materi');

    alert('Materi berhasil diunggah!');
    document.getElementById('materi-title').value = '';
    document.getElementById('materi-desc').value = '';
    fileInput.value = '';
    loadPengurusMateri();
  } catch (err) {
    alert(`Error: ${err.message}`);
  }
}

async function deleteMateri(id) {
  if (!confirm('Apakah Anda yakin ingin menghapus materi ini?')) return;
  try {
    const res = await fetchAuth(`${API_BASE}/materials/${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Gagal menghapus materi');
    alert('Materi dihapus.');
    loadPengurusMateri();
  } catch (err) {
    alert(`Error: ${err.message}`);
  }
}

// === SESI PRESENSI (Pengurus buka/tutup manual) ===

async function loadSessionStatus() {
  try {
    const res = await fetchAuth(`${API_BASE}/attendance/session/status`);
    const data = await res.json();
    const isActive = data.data && data.data.is_active;

    // Update badge Pengurus
    const badge = document.getElementById('session-status-badge');
    const btnOpen = document.getElementById('btn-open-session');
    const btnClose = document.getElementById('btn-close-session');

    if (badge) {
      if (isActive) {
        badge.textContent = 'SESI AKTIF';
        badge.style.background = 'transparent';
        badge.style.color = '#18181b';
      } else {
        badge.textContent = 'SESI DITUTUP';
        badge.style.background = 'transparent';
        badge.style.color = '#71717a';
      }
    }
    if (btnOpen) btnOpen.style.display = isActive ? 'none' : 'inline-flex';
    if (btnClose) btnClose.style.display = isActive ? 'inline-flex' : 'none';

    // Update status di sisi Anggota
    const anggotaStatus = document.getElementById('anggota-session-status');
    const btnSubmit = document.getElementById('btn-submit-absensi');

    if (anggotaStatus) {
      if (isActive) {
        const activator = data.data.session && data.data.session.activator ? data.data.session.activator.nama_lengkap : 'Pengurus';
        anggotaStatus.style.background = '#f0fdf4';
        anggotaStatus.innerHTML = `<p style="color: #166534; font-size: 0.95rem; margin: 0; font-weight: 600;"><i class="fa-solid fa-circle-check"></i> Sesi presensi sedang <strong>DIBUKA</strong> oleh ${activator}. Anda dapat melakukan absensi sekarang.</p>`;
      } else {
        anggotaStatus.style.background = '#fef2f2';
        anggotaStatus.innerHTML = `<p style="color: #991b1b; font-size: 0.95rem; margin: 0; font-weight: 600;"><i class="fa-solid fa-circle-xmark"></i> Sesi presensi sedang <strong>DITUTUP</strong>. Silakan tunggu Pengurus membuka sesi presensi.</p>`;
      }
    }
    if (btnSubmit) btnSubmit.disabled = !isActive;

    return isActive;
  } catch (err) {
    console.error('Gagal memuat status sesi:', err);
    return false;
  }
}

async function toggleSession(action) {
  const endpoint = action === 'open' ? '/attendance/session/open' : '/attendance/session/close';
  try {
    const res = await fetchAuth(`${API_BASE}${endpoint}`, { method: 'POST' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || 'Gagal mengubah status sesi');
    alert(data.message);
    loadSessionStatus();
  } catch (err) {
    alert(`Error: ${err.message}`);
  }
}

async function loadPengurusAbsensi(query = '') {
  try {
    loadSessionStatus();

    const res = await fetchAuth(`${API_BASE}/attendance/report${query}`);
    const data = await res.json();
    const tbody = document.getElementById('table-rekap-absensi');
    const items = data.data ? data.data.items : [];

    if (items.length === 0) {
      tbody.innerHTML = `<tr><td colspan="5" class="text-center">Belum ada data absensi yang sesuai filter.</td></tr>`;
    } else {
      tbody.innerHTML = items.map(a => `
        <tr>
          <td><strong>${a.date}</strong></td>
          <td>${a.user ? a.user.nama_lengkap : '-'}</td>
          <td><span class="user-badge">${a.user ? a.user.role : '-'}</span></td>
          <td>${a.user && a.user.divisi ? a.user.divisi : '-'}</td>
          <td><strong style="color: ${a.status === 'hadir' ? '#18181b' : '#71717a'}">${a.status.toUpperCase()}</strong></td>
        </tr>
      `).join('');
    }
  } catch (err) {
    console.error('Gagal memuat absensi:', err);
  }
}


function filterAbsensi(e) {
  e.preventDefault();
  const start = document.getElementById('filter-start-date').value;
  const end = document.getElementById('filter-end-date').value;
  const div = document.getElementById('filter-divisi').value;

  const params = new URLSearchParams();
  if (start) params.append('startDate', start);
  if (end) params.append('endDate', end);
  if (div) params.append('divisi', div);

  loadPengurusAbsensi(`?${params.toString()}`);
}

async function loadKasReport(statusFilter = '') {
  // Update button active states
  document.querySelectorAll('.filter-buttons .btn').forEach(btn => {
    btn.classList.remove('active');
  });
  if (!statusFilter) document.querySelectorAll('.filter-buttons .btn')[0].classList.add('active');
  if (statusFilter === 'pending') document.querySelectorAll('.filter-buttons .btn')[1].classList.add('active');
  if (statusFilter === 'lunas') document.querySelectorAll('.filter-buttons .btn')[2].classList.add('active');
  if (statusFilter === 'ditolak') document.querySelectorAll('.filter-buttons .btn')[3].classList.add('active');

  try {
    const query = statusFilter ? `?status=${statusFilter}` : '';
    const res = await fetchAuth(`${API_BASE}/payments/report${query}`);
    const data = await res.json();
    const tbody = document.getElementById('table-rekap-kas');
    const items = data.data ? data.data.items : [];

    const userStr = localStorage.getItem('iptek_user');
    const currentUser = userStr ? JSON.parse(userStr) : null;
    const isBendahara = currentUser && (currentUser.role === 'Pengurus' || (currentUser.divisi && currentUser.divisi.toLowerCase().includes('bendahara')));

    if (items.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" class="text-center">Belum ada data pembayaran kas.</td></tr>`;
    } else {
      tbody.innerHTML = items.map(p => `
        <tr>
          <td><strong>Bulan ${p.month} / ${p.year}</strong></td>
          <td>${p.user ? p.user.nama_lengkap : '-'} <br><small class="text-muted">${p.user && p.user.divisi ? p.user.divisi : ''}</small></td>
          <td><strong style="color: #18181b;">Rp ${Number(p.amount).toLocaleString('id-ID')}</strong></td>
          <td>
            <button onclick="openAdminBuktiModal('${encodeURIComponent(JSON.stringify(p))}')" class="btn btn-outline btn-sm" style="border-color: #18181b; color: #18181b; font-weight: 600;">
              <i class="fa-solid fa-file-image"></i> Lihat Bukti
            </button>
          </td>

          <td>
            <span style="padding: 4px 8px; border-radius: 4px; font-weight: bold; font-size: 0.8rem; background: #f4f4f5; color: #18181b;">
              ${p.status.toUpperCase()}
            </span>
          </td>
          <td>
            ${p.status === 'pending' ? (isBendahara ? `
              <button onclick="confirmKas(${p.id}, 'lunas')" class="btn btn-primary btn-sm" style="background: #18181b;"><i class="fa-solid fa-check"></i> Lunas</button>
              <button onclick="confirmKas(${p.id}, 'ditolak')" class="btn btn-logout btn-sm"><i class="fa-solid fa-xmark"></i> Tolak</button>
            ` : `<small class="text-muted" style="font-weight: 600;"><i class="fa-solid fa-clock"></i> Menunggu Verifikasi Bendahara</small>`) : `<small class="text-muted">Terverifikasi oleh ${p.verifier ? p.verifier.nama_lengkap : 'Bendahara'}</small>`}
          </td>
        </tr>
      `).join('');
    }
  } catch (err) {
    console.error('Gagal memuat kas report:', err);
  }
}

async function confirmKas(id, status) {
  if (!confirm(`Ubah status pembayaran menjadi '${status.toUpperCase()}'?`)) return;
  try {
    const res = await fetchAuth(`${API_BASE}/payments/${id}/confirm`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || 'Gagal memverifikasi');
    alert(`Pembayaran kas berhasil diubah menjadi ${status}`);
    const activeBtn = document.querySelector('.filter-buttons .btn.active');
    let filterVal = '';
    if (activeBtn) {
      const txt = activeBtn.textContent.toLowerCase();
      if (txt.includes('pending')) filterVal = 'pending';
      else if (txt.includes('lunas')) filterVal = 'lunas';
      else if (txt.includes('ditolak')) filterVal = 'ditolak';
    }
    loadKasReport(filterVal);
  } catch (err) {
    alert(`Error: ${err.message}`);
  }
}

function openAdminBuktiModal(pEncoded) {
  try {
    const p = typeof pEncoded === 'string' ? JSON.parse(decodeURIComponent(pEncoded)) : pEncoded;
    const modal = document.getElementById('admin-bukti-modal');
    const body = document.getElementById('admin-bukti-modal-body');
    if (!modal || !body) return;

    const hasUploadedFile = p.proof_path && (p.proof_path.startsWith('/uploads') || p.proof_path.startsWith('http'));
    const isImage = hasUploadedFile && /\.(jpg|jpeg|png|webp|gif)$/i.test(p.proof_path);

    if (hasUploadedFile) {
      if (isImage) {
        body.innerHTML = `
          <div style="text-align: center; padding: 0.5rem;">
            <a href="${p.proof_path}" target="_blank" title="Klik untuk ukuran penuh">
              <img src="${p.proof_path}" style="max-width: 100%; max-height: 70vh; object-fit: contain; border-radius: 6px; border: 1px solid #e4e4e7; box-shadow: 0 4px 12px rgba(0,0,0,0.08);" alt="Bukti Pembayaran">
            </a>
            <p style="font-size: 0.75rem; color: #71717a; margin-top: 10px; margin-bottom: 0;">Klik gambar untuk membuka di tab baru</p>
          </div>
        `;
      } else {
        body.innerHTML = `
          <div style="text-align: center; padding: 2.5rem 1rem; background: #f8f9fa; border-radius: 8px;">
            <p style="font-size: 0.9rem; font-weight: 700; color: #18181b; margin-bottom: 1rem;">Dokumen Bukti Transfer (PDF / File)</p>
            <a href="${p.proof_path}" target="_blank" class="btn btn-primary" style="background: #18181b; padding: 0.8rem 1.5rem;">
              <i class="fa-solid fa-file-arrow-down"></i> Buka File Bukti Pembayaran
            </a>
          </div>
        `;
      }
    } else {
      body.innerHTML = `
        <div style="text-align: center; padding: 2.5rem 1rem; background: #f8f9fa; border-radius: 8px;">
          <p style="font-size: 0.9rem; font-weight: 600; color: #4b5563; margin: 0;">
            Anggota tidak melampirkan gambar bukti pembayaran.
          </p>
        </div>
      `;
    }

    modal.style.display = 'flex';
  } catch (err) {
    console.error('Error opening bukti modal:', err);
  }
}

function closeAdminBuktiModal() {
  const modal = document.getElementById('admin-bukti-modal');
  if (modal) {
    modal.style.display = 'none';
  }
}


async function payQrisFromModal() {
  const btn = document.getElementById('btn-modal-qris');
  const originalText = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Mengirim Pembayaran QRIS...`;

  const month = new Date().getMonth() + 1;
  const year = new Date().getFullYear();
  const fileInput = document.getElementById('modal-kas-proof');

  try {
    const formData = new FormData();
    formData.append('month', month);
    formData.append('year', year);
    formData.append('payment_method', 'qris');
    if (fileInput && fileInput.files && fileInput.files[0]) {
      formData.append('proof_file', fileInput.files[0]);
    }

    const res = await fetchAuth(`${API_BASE}/payments`, {
      method: 'POST',
      body: formData
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || 'Gagal mengirim pembayaran QRIS');

    if (fileInput) fileInput.value = '';
    alert('PEMBAYARAN QRIS BERHASIL DIKIRIM!\n\nStatus: MENUNGGU VERIFIKASI BENDAHARA.\nSilakan tunggu Pengurus bagian Bendahara memverifikasi pembayaran kas Anda menjadi Lunas agar Anda dapat melakukan presensi.');
    checkKasAndUnlockAttendance();
  } catch (err) {
    alert(`Gagal: ${err.message}`);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = originalText;
    }
  }
}

function closeLockModalAndGoHome() {
  document.getElementById('qris-lock-modal').style.display = 'none';
  switchAnggotaTab('overview');
}

async function loadAnggotaMateri() {
  loadSchedules();
  loadDocumentTemplates('list-anggota-templates', false);
}

async function submitAbsensiAnggota(e) {
  e.preventDefault();
  const statusEl = document.getElementById('anggota-status-absen');
  const status = statusEl ? statusEl.value : 'hadir';

  if (status !== 'hadir') {
    alert('Error: Status kehadiran hanya boleh HADIR.');
    return;
  }

  if (!navigator.geolocation) {
    alert('Error: Browser HP Anda tidak mendukung fitur Geolocation atau memblokirnya karena akses lewat jaringan lokal HTTP tanpa enkripsi (HTTPS).');
    return;
  }

  const submitBtn = e.target.querySelector('button[type="submit"]');
  const originalText = submitBtn ? submitBtn.textContent : 'Kirim Presensi Sekarang';
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = 'Memeriksa Lokasi GPS...';
  }

  try {
    let position;
    try {
      position = await new Promise((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          timeout: 10000,
          maximumAge: 0
        });
      });
    } catch (gpsErr) {
      console.warn('GPS akurasi tinggi gagal (ruangan tertutup/sinyal lemah), mencoba akurasi jaringan Wi-Fi/Seluler...', gpsErr);
      if (gpsErr.code === 1) throw gpsErr;
      position = await new Promise((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: false,
          timeout: 15000,
          maximumAge: 60000
        });
      });
    }

    const latitude = position.coords.latitude;
    const longitude = position.coords.longitude;

    // Titik koordinat pertemuan: 7°02'02.4"S 110°22'07.8"E
    const targetLat = -7.034000;
    const targetLon = 110.36883333333333;

    // Haversine formula untuk menghitung jarak dalam meter
    const toRad = (value) => (value * Math.PI) / 180;
    const R = 6371000; // Radius Bumi dalam meter
    const dLat = toRad(targetLat - latitude);
    const dLon = toRad(targetLon - longitude);
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(toRad(latitude)) * Math.cos(toRad(targetLat)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const distance = R * c; // dalam meter

    if (distance > 100) {
      throw new Error(`Gagal presensi: Lokasi Anda (${distance.toFixed(1)} meter) berada di luar radius maksimal 100 meter dari titik pertemuan.`);
    }

    if (submitBtn) submitBtn.textContent = 'Mengirim Presensi...';

    const fingerprint = await generateDeviceFingerprint();
    const res = await fetchAuth(`${API_BASE}/attendance`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status, latitude, longitude, device_fingerprint: fingerprint })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || 'Gagal mencatat presensi');

    alert(`Presensi hari ini berhasil dicatat dengan status: ${status.toUpperCase()} (Terverifikasi dalam radius ${distance.toFixed(1)} meter dari titik pertemuan)`);
    loadAnggotaAttendance();
  } catch (err) {
    let msg = err.message;
    if (err.code === 1) {
      if (window.location.protocol === 'http:' && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
        msg = `Browser HP memblokir pop-up izin lokasi karena Anda mengakses lewat IP LAN HTTP (${window.location.origin}) tanpa HTTPS.\n\n🛠️ CARA AGAR HP BISA IZIN LOKASI DI CHROME:\n1. Buka tab baru di Chrome HP, ketik: chrome://flags\n2. Cari di kolom search: Insecure origins treated as secure\n3. Ubah jadi ENABLED, lalu isi kolom dengan: ${window.location.origin}\n4. Klik tombol Relaunch di bawah layar HP.\n5. Setelah Chrome restart, klik presensi lagi. HP akan memunculkan izin lokasi!`;
      } else {
        msg = 'Anda menolak izin akses lokasi (GPS) di HP. Silakan klik ikon gembok/pengaturan di samping alamat web pada browser HP Anda, lalu aktifkan izin Lokasi (Location).';
      }
    }
    else if (err.code === 2) msg = 'Sinyal GPS tidak ditemukan oleh perangkat HP Anda. Pastikan fitur Lokasi/GPS di HP Anda dalam keadaan aktif.';
    else if (err.code === 3) msg = 'Waktu pencarian sinyal GPS habis (timeout). Sinyal satelit terhalang gedung/ruangan. Coba lagi di dekat jendela atau area terbuka.';
    alert(`PEMBERITAHUAN LOKASI:\n\n${msg}`);
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = originalText;
    }
  }
}

async function loadAnggotaAttendance() {
  try {
    const res = await fetchAuth(`${API_BASE}/attendance/history?limit=10`);
    const data = await res.json();
    const tbody = document.getElementById('table-my-attendance');
    const items = data.data ? data.data.items : [];

    if (items.length === 0) {
      tbody.innerHTML = `<tr><td colspan="2" class="text-center">Belum ada riwayat absensi.</td></tr>`;
    } else {
      tbody.innerHTML = items.map(a => `
        <tr>
          <td><strong>${a.date}</strong></td>
          <td><strong style="color: ${a.status === 'hadir' ? '#18181b' : '#71717a'}">${a.status.toUpperCase()}</strong></td>
        </tr>
      `).join('');
    }
  } catch (err) {
    console.error('Gagal memuat absensi anggota:', err);
  }
}

async function submitKasQris(e) {
  e.preventDefault();
  const month = document.getElementById('kas-month').value;
  const year = document.getElementById('kas-year').value;
  const fileInput = document.getElementById('kas-proof');
  const btn = document.getElementById('btn-pay-qris');
  const originalText = btn.innerHTML;

  btn.disabled = true;
  btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Mengirim Pembayaran QRIS...`;

  try {
    const formData = new FormData();
    formData.append('month', month);
    formData.append('year', year);
    formData.append('payment_method', 'qris');
    if (fileInput && fileInput.files && fileInput.files[0]) {
      formData.append('proof_file', fileInput.files[0]);
    }

    const res = await fetchAuth(`${API_BASE}/payments`, {
      method: 'POST',
      body: formData
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || 'Gagal mengajukan kas');

    if (fileInput) fileInput.value = '';
    alert('PEMBAYARAN QRIS BERHASIL DIKIRIM!\n\nStatus: MENUNGGU VERIFIKASI BENDAHARA.\nSilakan tunggu Pengurus bagian Bendahara memverifikasi pembayaran kas Anda menjadi Lunas.');
    loadAnggotaKas();
  } catch (err) {
    alert(`Error: ${err.message}`);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = originalText;
    }
  }
}

async function loadAnggotaKas() {
  try {
    const res = await fetchAuth(`${API_BASE}/payments/history?limit=10`);
    const data = await res.json();
    const tbody = document.getElementById('table-my-kas');
    const items = data.data ? data.data.items : [];

    if (items.length === 0) {
      tbody.innerHTML = `<tr><td colspan="3" class="text-center">Belum ada riwayat pembayaran kas.</td></tr>`;
    } else {
      tbody.innerHTML = items.map(p => `
        <tr>
          <td><strong>Bulan ${p.month} / ${p.year}</strong></td>
          <td><strong>Rp ${Number(p.amount).toLocaleString('id-ID')}</strong></td>
          <td>
            <span style="padding: 4px 8px; border-radius: 4px; font-weight: bold; font-size: 0.8rem; background: #f4f4f5; color: #18181b;">
              ${p.status.toUpperCase()}
            </span>
          </td>
        </tr>
      `).join('');
    }
  } catch (err) {
    console.error('Gagal memuat kas anggota:', err);
  }
}

/* ==========================================================
   QRIS CONFIGURATION
========================================================== */

/**
 * Memuat konfigurasi QRIS dari server dan menampilkan gambar QR Code
 * di tiga lokasi: preview admin, tab kas anggota, dan modal pengunci.
 */
async function loadQrisConfig() {
  try {
    const res = await fetchAuth(`${API_BASE}/qris/config`);
    const data = await res.json();

    if (data.status !== 'success') return;

    const cfg = data.data;
    const imgHtml = cfg.is_configured
      ? `<img src="${cfg.qris_image_url}" alt="QRIS ${cfg.merchant_name}" style="max-width: 220px; width: 100%; height: auto; border-radius: 4px;">`
      : `<div style="padding: 2rem 1rem; text-align: center;"><i class="fa-solid fa-qrcode" style="font-size: 3rem; color: #d4d4d8; margin-bottom: 0.5rem; display: block;"></i><p style="color: #71717a; font-size: 0.85rem; margin: 0;">QRIS belum dikonfigurasi.<br>Hubungi Bendahara untuk mengunggah gambar QRIS.</p></div>`;

    const merchantInfo = cfg.is_configured
      ? `${cfg.merchant_name} | NMID: ${cfg.nmid}`
      : 'QRIS belum dikonfigurasi';

    // 1. Preview admin (halaman pengurus tab kas)
    const adminPreview = document.getElementById('qris-preview-admin');
    if (adminPreview) {
      adminPreview.innerHTML = imgHtml;
    }

    // 2. Tab kas anggota
    const kasImage = document.getElementById('qris-image-kas');
    if (kasImage) {
      kasImage.innerHTML = imgHtml;
    }
    const kasNmid = document.getElementById('qris-nmid-kas');
    if (kasNmid) {
      kasNmid.textContent = merchantInfo;
    }

    // 3. Modal pengunci QRIS
    const modalImage = document.getElementById('qris-image-modal');
    if (modalImage) {
      modalImage.innerHTML = imgHtml;
    }
  } catch (err) {
    console.error('Gagal memuat konfigurasi QRIS:', err);
  }
}

/**
 * Upload gambar QRIS oleh Pengurus.
 */
async function uploadQrisImage(e) {
  e.preventDefault();
  const fileInput = document.getElementById('qris-file-input');
  const btn = document.getElementById('btn-upload-qris');
  const originalText = btn.textContent;

  if (!fileInput.files[0]) {
    alert('Pilih file gambar QRIS terlebih dahulu.');
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Mengunggah...';

  try {
    const formData = new FormData();
    formData.append('qris_image', fileInput.files[0]);

    const res = await fetchAuth(`${API_BASE}/qris/upload`, {
      method: 'POST',
      body: formData
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || 'Gagal mengunggah');

    alert('Gambar QRIS Bendahara berhasil diunggah dan diaktifkan. Seluruh anggota sekarang akan melihat QRIS ini saat melakukan pembayaran kas.');
    fileInput.value = '';
    loadQrisConfig();
  } catch (err) {
    alert(`Error: ${err.message}`);
  } finally {
    btn.disabled = false;
    btn.textContent = originalText;
  }
}

/* ==========================================================
   MANAJEMEN ANGGOTA (PENAMBAHAN & PENGURANGAN)
========================================================== */
let _anggotaDebounce = null;

async function loadAnggotaList() {
  clearTimeout(_anggotaDebounce);
  _anggotaDebounce = setTimeout(async () => {
    try {
      const roleSelect = document.getElementById('filter-user-role');
      const searchInput = document.getElementById('search-user');
      const role = roleSelect ? roleSelect.value : '';
      const search = searchInput ? searchInput.value.trim() : '';
      let query = '?';
      if (role) query += `role=${role}&`;
      if (search) query += `search=${encodeURIComponent(search)}&`;

      const res = await fetchAuth(`${API_BASE}/users${query}`);
      const data = await res.json();

      const tbody = document.getElementById('table-anggota');
      const countEl = document.getElementById('anggota-count');

      if (!tbody) return;

      if (data.status !== 'success' || !data.data || !data.data.length) {
        let msg = 'Tidak ada data ditemukan.';
        if (data.status === 'error') {
          msg = `Gagal: ${data.message} ${data.error ? '('+data.error+')' : ''}`;
          console.error(msg);
        }
        tbody.innerHTML = `<tr><td colspan="6" class="text-center" style="color:#71717a;">${escapeHtml(msg)}</td></tr>`;
        if (countEl) countEl.textContent = '';
        return;
      }

      const currentUser = JSON.parse(localStorage.getItem('iptek_user') || '{}');
      const isAdminUser = currentUser.role === 'admin';

      // Sembunyikan/Tampilkan tombol Tambah berdasarkan role (Hanya Admin yang bisa Tambah & Hapus)
      const btnAdd = document.getElementById('btn-add-user-container');
      if (btnAdd) btnAdd.style.display = isAdminUser ? 'block' : 'none';

      tbody.innerHTML = data.data.map((u, i) => `
        <tr>
          <td>${i + 1}</td>
          <td style="font-weight:500;">${escapeHtml(u.nama_lengkap)}</td>
          <td><code style="font-size:0.8rem; background:#f4f4f5; padding:0.15rem 0.4rem; border-radius:4px;">${escapeHtml(u.username)}</code></td>
          <td><span style="display:inline-block; padding:0.2rem 0.6rem; border-radius:4px; font-size:0.75rem; font-weight:600; text-transform:uppercase; letter-spacing:0.03em; ${u.role === 'admin' ? 'background:#dc2626; color:#fff;' : (u.role === 'pengurus' ? 'background:#18181b; color:#fff;' : 'background:#f4f4f5; color:#4b5563;')}">${u.role}</span></td>
          <td style="color:${u.divisi ? '#18181b' : '#a1a1aa'};">${u.divisi || '-'}</td>
          <td>
            <div style="display:flex; gap:0.4rem; flex-wrap:wrap;">
              ${isAdminUser ? `
                <button onclick="showEditUserModal(${u.id})" title="Edit" style="background:none; border:1px solid #e4e4e7; border-radius:5px; padding:0.3rem 0.5rem; cursor:pointer; color:#4b5563; font-size:0.8rem;"><i class="fa-solid fa-pen-to-square"></i></button>
                <button onclick="resetUserPassword(${u.id})" title="Reset Password" style="background:none; border:1px solid #e4e4e7; border-radius:5px; padding:0.3rem 0.5rem; cursor:pointer; color:#4b5563; font-size:0.8rem;"><i class="fa-solid fa-key"></i></button>
                ${u.id !== currentUser.id ? `<button onclick="showDeleteUserModal(${u.id}, '${escapeHtml(u.nama_lengkap).replace(/'/g, "\\'")}')" title="Hapus (Pengurangan)" style="background:none; border:1px solid #fecaca; border-radius:5px; padding:0.3rem 0.5rem; cursor:pointer; color:#dc2626; font-size:0.8rem;"><i class="fa-solid fa-trash"></i></button>` : ''}
              ` : `<span style="font-size:0.75rem; color:#a1a1aa;"><i class="fa-solid fa-lock" style="font-size:0.7rem;"></i> Khusus Admin</span>`}
            </div>
          </td>
        </tr>
      `).join('');

      if (countEl) countEl.textContent = `Menampilkan ${data.data.length} akun`;
    } catch (err) {
      console.error('loadAnggotaList error:', err);
    }
  }, 300);
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function showAddUserModal() {
  document.getElementById('modal-user-title').textContent = 'Penambahan Anggota Baru';
  document.getElementById('edit-user-id').value = '';
  document.getElementById('form-user-nama').value = '';
  document.getElementById('form-user-username').value = '';
  document.getElementById('form-user-password').value = '';
  document.getElementById('form-user-role').value = 'anggota';
  document.getElementById('form-user-divisi').value = '';
  document.getElementById('form-user-password-group').style.display = 'block';
  toggleDivisiField();
  document.getElementById('modal-user-form').style.display = 'flex';
}

async function showEditUserModal(id) {
  try {
    const res = await fetchAuth(`${API_BASE}/users?search=`);
    const data = await res.json();
    if (data.status !== 'success') return;

    const user = data.data.find(u => u.id === id);
    if (!user) return alert('User tidak ditemukan.');

    document.getElementById('modal-user-title').textContent = 'Edit Data Anggota';
    document.getElementById('edit-user-id').value = user.id;
    document.getElementById('form-user-nama').value = user.nama_lengkap;
    document.getElementById('form-user-username').value = user.username;
    document.getElementById('form-user-password').value = '';
    document.getElementById('form-user-password-group').style.display = 'none';
    document.getElementById('form-user-role').value = user.role;
    document.getElementById('form-user-divisi').value = user.divisi || '';
    toggleDivisiField();
    document.getElementById('modal-user-form').style.display = 'flex';
  } catch (err) {
    alert('Gagal memuat data user.');
  }
}

function toggleDivisiField() {
  const role = document.getElementById('form-user-role').value;
  document.getElementById('form-user-divisi-group').style.display = role === 'pengurus' ? 'block' : 'none';
}

function closeUserModal() {
  document.getElementById('modal-user-form').style.display = 'none';
}

async function submitUserForm() {
  const id = document.getElementById('edit-user-id').value;
  const nama_lengkap = document.getElementById('form-user-nama').value.trim();
  const username = document.getElementById('form-user-username').value.trim();
  const password = document.getElementById('form-user-password').value.trim();
  const role = document.getElementById('form-user-role').value;
  const divisi = document.getElementById('form-user-divisi').value.trim();

  if (!nama_lengkap || !username) {
    return alert('Nama lengkap dan username wajib diisi.');
  }

  try {
    const body = { nama_lengkap, username, role, divisi };
    if (!id && password) body.password = password;

    const url = id ? `${API_BASE}/users/${id}` : `${API_BASE}/users`;
    const method = id ? 'PUT' : 'POST';

    const res = await fetchAuth(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.message || 'Gagal menyimpan.');

    closeUserModal();
    loadAnggotaList();

    if (!id && data.data && data.data.generated_password) {
      document.getElementById('reset-result-name').textContent = data.data.nama_lengkap + ' (@' + data.data.username + ')';
      document.getElementById('reset-result-password').textContent = data.data.generated_password;
      document.getElementById('modal-reset-result').style.display = 'flex';
    } else {
      alert(data.message || 'Berhasil disimpan.');
    }
  } catch (err) {
    alert(err.message);
  }
}

function showResetPasswordModal(id) {
  document.getElementById('reset-user-id').value = id;
  // Reset form to default (Auto)
  const form = document.getElementById('form-reset-password');
  form.reset();
  toggleResetManual(false);
  document.getElementById('modal-reset-password').style.display = 'flex';
}

function closeResetPasswordModal() {
  document.getElementById('modal-reset-password').style.display = 'none';
}

function toggleResetManual(show) {
  const manualGroup = document.getElementById('reset-manual-group');
  const manualInput = document.getElementById('reset-manual-password');
  if (show) {
    manualGroup.style.display = 'block';
    manualInput.required = true;
  } else {
    manualGroup.style.display = 'none';
    manualInput.required = false;
    manualInput.value = '';
  }
}

async function submitResetPassword(e) {
  e.preventDefault();
  const id = document.getElementById('reset-user-id').value;
  const mode = document.querySelector('input[name="reset-mode"]:checked').value;
  const newPassword = document.getElementById('reset-manual-password').value.trim();
  
  if (mode === 'manual' && !newPassword) {
    return alert('Silakan masukkan password baru.');
  }

  const btn = document.getElementById('btn-submit-reset');
  const originalText = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Mereset...';

  try {
    const bodyData = {};
    if (mode === 'manual') {
      bodyData.new_password = newPassword;
    }

    const res = await fetchAuth(`${API_BASE}/users/${id}/reset-password`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(bodyData)
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.message || 'Gagal reset password.');

    closeResetPasswordModal();
    
    // Show the result modal (existing logic)
    document.getElementById('reset-result-name').textContent = data.data.nama_lengkap + ' (@' + data.data.username + ')';
    document.getElementById('reset-result-password').textContent = data.data.new_password;
    document.getElementById('modal-reset-result').style.display = 'flex';
  } catch (err) {
    alert(err.message);
  } finally {
    btn.disabled = false;
    btn.innerHTML = originalText;
  }
}

function closeResetResultModal() {
  document.getElementById('modal-reset-result').style.display = 'none';
}

function showDeleteUserModal(id, nama) {
  document.getElementById('delete-user-id').value = id;
  document.getElementById('delete-user-msg').textContent = `Yakin ingin menghapus (mengurangi) anggota "${nama}"? Semua data terkait juga akan dibersihkan.`;
  document.getElementById('modal-delete-user').style.display = 'flex';
}

function closeDeleteModal() {
  document.getElementById('modal-delete-user').style.display = 'none';
}

async function confirmDeleteUser() {
  const id = document.getElementById('delete-user-id').value;
  try {
    const res = await fetchAuth(`${API_BASE}/users/${id}`, { method: 'DELETE' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || 'Gagal menghapus.');

    closeDeleteModal();
    loadAnggotaList();
    alert(data.message || 'Anggota berhasil dihapus.');
  } catch (err) {
    alert(err.message);
  }
}


