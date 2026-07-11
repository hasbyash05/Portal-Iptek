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
  if (user.role === 'pengurus') {
    showView('pengurus-view');
    if (navLaporan) navLaporan.style.display = 'block';
  } else {
    showView('anggota-view');
    if (navLaporan) navLaporan.style.display = 'none';
  }

  // Cek adakah hash di URL saat refresh atau awal load
  const hashTab = window.location.hash.replace('#', '');
  const validTabsPengurus = ['overview', 'laporan', 'materi', 'absensi', 'kas'];
  const validTabsAnggota = ['overview', 'materi', 'absensi', 'kas'];
  const validTabs = user.role === 'pengurus' ? validTabsPengurus : validTabsAnggota;

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
    const res = await fetch(`${API_BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: usernameInput, password: passwordInput })
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

  // Perbarui URL hash di browser jika bukan dari event hashchange/initial load
  if (!fromHash && window.location.hash !== `#${tabName}`) {
    history.pushState(null, null, `#${tabName}`);
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

  if (user.role === 'pengurus') {
    switchPengurusTab(tabName);
  } else {
    switchAnggotaTab(tabName);
  }
}

// Dengarkan perubahan URL hash (misalnya saat tombol Back/Forward browser diubah)
window.addEventListener('hashchange', () => {
  const hashTab = window.location.hash.replace('#', '');
  const userStr = localStorage.getItem('iptek_user');
  if (!userStr || !hashTab) return;
  const user = JSON.parse(userStr);
  const validTabs = user.role === 'pengurus' ? 
    ['overview', 'laporan', 'materi', 'absensi', 'kas'] : 
    ['overview', 'materi', 'absensi', 'kas'];

  if (validTabs.includes(hashTab)) {
    switchNavTab(hashTab, true);
  }
});

/* ==========================================================
   PENGURUS LOGIC & TABS
========================================================== */
function switchPengurusTab(tabName) {
  document.querySelectorAll('#pengurus-view .tab-btn').forEach(btn => btn.classList.remove('active'));
  document.querySelectorAll('#pengurus-view .tab-content').forEach(c => c.style.display = 'none');

  const tabs = ['overview', 'laporan', 'materi', 'absensi', 'kas'];
  const idx = tabs.indexOf(tabName);
  if (idx >= 0) {
    const btns = document.querySelectorAll('#pengurus-view .tab-btn');
    if (btns[idx]) btns[idx].classList.add('active');
    const contentEl = document.getElementById(`p-tab-${tabName}`);
    if (contentEl) contentEl.style.display = 'block';
  }

  if (tabName === 'overview') loadPengurusOverview();
  if (tabName === 'laporan') loadPengurusLaporan();
  if (tabName === 'materi') loadPengurusMateri();
  if (tabName === 'absensi') loadPengurusAbsensi();
  if (tabName === 'kas') loadKasReport('');
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
  try {
    const res = await fetchAuth(`${API_BASE}/materials`);
    const data = await res.json();
    const container = document.getElementById('list-pengurus-materi');
    const items = data.data || [];

    if (items.length === 0) {
      container.innerHTML = `<p class="text-muted">Belum ada bahan ajar yang diunggah.</p>`;
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
            <a href="${m.download_url}" target="_blank" class="btn btn-outline btn-sm"><i class="fa-solid fa-download"></i> Download</a>
            <button onclick="deleteMateri(${m.id})" class="btn btn-logout btn-sm"><i class="fa-solid fa-trash"></i></button>
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

    alert('Bahan ajar berhasil diunggah!');
    document.getElementById('materi-title').value = '';
    document.getElementById('materi-desc').value = '';
    fileInput.value = '';
    loadPengurusMateri();
  } catch (err) {
    alert(`Error: ${err.message}`);
  }
}

async function deleteMateri(id) {
  if (!confirm('Apakah Anda yakin ingin menghapus bahan ajar ini?')) return;
  try {
    const res = await fetchAuth(`${API_BASE}/materials/${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Gagal menghapus materi');
    alert('Bahan ajar dihapus.');
    loadPengurusMateri();
  } catch (err) {
    alert(`Error: ${err.message}`);
  }
}

async function loadPengurusAbsensi(query = '') {
  try {
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
  document.querySelectorAll('#p-tab-kas .filter-buttons .btn').forEach(btn => {
    btn.classList.remove('active');
  });
  if (!statusFilter) document.querySelectorAll('#p-tab-kas .filter-buttons .btn')[0].classList.add('active');
  if (statusFilter === 'pending') document.querySelectorAll('#p-tab-kas .filter-buttons .btn')[1].classList.add('active');
  if (statusFilter === 'lunas') document.querySelectorAll('#p-tab-kas .filter-buttons .btn')[2].classList.add('active');
  if (statusFilter === 'ditolak') document.querySelectorAll('#p-tab-kas .filter-buttons .btn')[3].classList.add('active');

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
    const activeBtn = document.querySelector('#p-tab-kas .filter-buttons .btn.active');
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
  try {
    const res = await fetchAuth(`${API_BASE}/payments/check`);
    const data = await res.json();

    if (data.status === 'success' && data.data && data.data.hasPaid) {
      // Sudah bayar kas -> Buka Tab Absensi
      document.getElementById('qris-lock-modal').style.display = 'none';
      document.querySelectorAll('#anggota-view .tab-btn').forEach(btn => btn.classList.remove('active'));
      document.querySelectorAll('#anggota-view .tab-content').forEach(c => c.style.display = 'none');
      const btns = document.querySelectorAll('#anggota-view .tab-btn');
      if (btns[2]) btns[2].classList.add('active');
      document.getElementById('a-tab-absensi').style.display = 'block';
      document.querySelectorAll('.nav-link').forEach(link => {
        link.classList.remove('active');
        if (link.getAttribute('data-tab') === 'absensi') link.classList.add('active');
      });
      if (window.location.hash !== '#absensi') {
        history.replaceState(null, null, '#absensi');
      }
      loadAnggotaAttendance();
    } else {
      // Belum bayar kas atau masih pending -> Tampilkan Modal Pengunci!
      const statusBox = document.getElementById('qris-modal-status-box');
      const btnPay = document.getElementById('btn-modal-qris');
      if (data.data && data.data.payment && data.data.payment.status === 'pending') {
        if (statusBox) {
          statusBox.innerHTML = `<div style="background: #fef3c7; color: #92400e; padding: 0.8rem; border-radius: 6px; font-size: 0.85rem; font-weight: 600; margin-bottom: 1rem;"><i class="fa-solid fa-clock"></i> Pembayaran QRIS Anda sedang MENUNGGU VERIFIKASI BENDAHARA. Anda baru dapat melakukan presensi setelah diverifikasi Lunas.</div>`;
        }
        if (btnPay) {
          btnPay.disabled = true;
          btnPay.innerHTML = `<i class="fa-solid fa-clock"></i> Menunggu Verifikasi Bendahara...`;
          btnPay.style.background = '#71717a';
        }
      } else {
        if (statusBox) statusBox.innerHTML = '';
        if (btnPay) {
          btnPay.disabled = false;
          btnPay.innerHTML = 'Bayar QRIS Rp 10.000 Sekarang';
          btnPay.style.background = '#18181b';
        }
      }
      document.getElementById('qris-lock-modal').style.display = 'flex';
    }
  } catch (err) {
    alert(`Error: ${err.message}`);
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
  try {
    const res = await fetchAuth(`${API_BASE}/materials`);
    const data = await res.json();
    const container = document.getElementById('list-anggota-materi');
    const items = data.data || [];

    if (items.length === 0) {
      container.innerHTML = `<p class="text-muted">Belum ada bahan ajar yang tersedia.</p>`;
    } else {
      container.innerHTML = items.map(m => `
        <div class="materi-item">
          <div class="materi-content">
            <h4><i class="fa-solid fa-file-lines"></i> ${m.title}</h4>
            <p>${m.description || 'Tidak ada deskripsi'}</p>
            <div class="materi-meta">
              <span><i class="fa-solid fa-user-tie"></i> Diunggah oleh: ${m.uploaded_by}</span>
              <span><i class="fa-solid fa-calendar-week"></i> Minggu ke-${m.week_number} (${m.year})</span>
            </div>
          </div>
          <div class="materi-actions">
            <a href="${m.download_url}" target="_blank" class="btn btn-primary btn-sm"><i class="fa-solid fa-download"></i> Unduh Materi</a>
          </div>
        </div>
      `).join('');
    }
  } catch (err) {
    console.error('Gagal memuat materi anggota:', err);
  }
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

    if (distance > 10) {
      throw new Error(`Gagal presensi: Lokasi Anda (${distance.toFixed(1)} meter) berada di luar radius maksimal 10 meter dari titik pertemuan.`);
    }

    if (submitBtn) submitBtn.textContent = 'Mengirim Presensi...';

    const res = await fetchAuth(`${API_BASE}/attendance`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status, latitude, longitude })
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
