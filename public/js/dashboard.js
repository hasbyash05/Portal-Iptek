import { fetchAuth } from './auth.js';
import { loadDocumentTemplates } from './academic.js';
export const API_BASE = '/api';

let _anggotaDebounce = null;
let _previousTab = 'overview';
let _currentProfileUserId = null;

export async function loadPengurusOverview() {
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
      const totalKasEl = document.getElementById('stat-total-kas-pengurus');
      if (totalKasEl && stats.totalKasTerkumpul !== undefined) {
        totalKasEl.textContent = `Rp ${Number(stats.totalKasTerkumpul).toLocaleString('id-ID')}`;
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
        listContainer.innerHTML = '<p class="text-muted">Belum ada aktivitas dilaporkan.</p>';
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

export async function loadAnggotaOverview() {
  try {
    const res = await fetchAuth(`${API_BASE}/payments/total`);
    const data = await res.json();
    if (data.status === 'success') {
      const totalStr = Number(data.data.total).toLocaleString('id-ID');
      const el = document.getElementById('stat-total-kas-anggota');
      if (el) el.textContent = `Rp ${totalStr}`;
    }
  } catch (err) {
    console.error('Gagal memuat total kas anggota:', err);
  }
}

export async function loadPengurusLaporan() {
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
      tbody.innerHTML = '<tr><td colspan="4" class="text-center">Belum ada riwayat laporan kegiatan divisi.</td></tr>';
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

export async function submitLaporan(e) {
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

export async function loadAnggotaList() {
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
          msg = `Gagal: ${data.message} ${data.error ? '(' + data.error + ')' : ''}`;
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
          <td><a href="javascript:void(0)" onclick="openProfile(${u.id})" style="font-weight:500; color:#18181b; text-decoration:none; border-bottom:1px dashed #a1a1aa; cursor:pointer;" onmouseover="this.style.color='#4b5563'" onmouseout="this.style.color='#18181b'">${escapeHtml(u.nama_lengkap)}</a></td>
          <td><code style="font-size:0.8rem; background:#f4f4f5; padding:0.15rem 0.4rem; border-radius:4px;">${escapeHtml(u.username)}</code></td>
          <td><span style="display:inline-block; padding:0.2rem 0.6rem; border-radius:4px; font-size:0.75rem; font-weight:600; text-transform:uppercase; letter-spacing:0.03em; ${u.role === 'admin' ? 'background:#dc2626; color:#fff;' : (u.role === 'pengurus' ? 'background:#18181b; color:#fff;' : 'background:#f4f4f5; color:#4b5563;')}">${u.role}</span></td>
          <td style="color:${u.divisi ? '#18181b' : '#a1a1aa'};">${u.divisi || '-'}</td>
          <td>
            <div style="display:flex; gap:0.4rem; flex-wrap:wrap;">
              <button onclick="openProfile(${u.id})" title="Lihat Profil" style="background:none; border:1px solid #e4e4e7; border-radius:5px; padding:0.3rem 0.5rem; cursor:pointer; color:#4b5563; font-size:0.8rem;"><i class="fa-solid fa-user"></i></button>
              ${isAdminUser ? `
                <button onclick="showEditUserModal(${u.id})" title="Edit" style="background:none; border:1px solid #e4e4e7; border-radius:5px; padding:0.3rem 0.5rem; cursor:pointer; color:#4b5563; font-size:0.8rem;"><i class="fa-solid fa-pen-to-square"></i></button>
                <button onclick="showResetPasswordModal(${u.id})" title="Reset Password" style="background:none; border:1px solid #e4e4e7; border-radius:5px; padding:0.3rem 0.5rem; cursor:pointer; color:#4b5563; font-size:0.8rem;"><i class="fa-solid fa-key"></i></button>
                ${u.id !== currentUser.id ? `<button onclick="showDeleteUserModal(${u.id}, '${escapeHtml(u.nama_lengkap).replace(/'/g, "\\\\'")}')" title="Hapus (Pengurangan)" style="background:none; border:1px solid #fecaca; border-radius:5px; padding:0.3rem 0.5rem; cursor:pointer; color:#dc2626; font-size:0.8rem;"><i class="fa-solid fa-trash"></i></button>` : ''}
              ` : `<span style="font-size:0.75rem; color:#a1a1aa;"><i class="fa-solid fa-lock" style="font-size:0.7rem;"></i> Khusus Admin</span>`}
            </div>
          </td>
        </tr>
      `).join('');

      if (countEl) countEl.textContent = `Menampilkan ${data.data.length} akun`;

      // Tampilkan panel sertifikat untuk pengurus/admin
      const isPengurusOrAdmin = currentUser.role === 'admin' || currentUser.role === 'pengurus';
      const certPanel = document.getElementById('view-sertifikat-pengurus');
      if (certPanel) {
        certPanel.style.display = isPengurusOrAdmin ? 'block' : 'none';
        if (isPengurusOrAdmin) loadCertificates();
      }
    } catch (err) {
      console.error('loadAnggotaList error:', err);
    }
  }, 300);
}

export function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ========== PROFIL ANGGOTA ==========

export function openMyProfile() {
  const userStr = localStorage.getItem('iptek_user');
  if (!userStr) return;
  const user = JSON.parse(userStr);
  openProfile(user.id);
}

export function openProfile(userId) {
  // Simpan tab sebelumnya agar bisa kembali
  const activeTab = document.querySelector('.nav-link.active');
  if (activeTab) _previousTab = activeTab.getAttribute('data-tab') || 'overview';

  // Sembunyikan semua tab, tampilkan profil
  document.querySelectorAll('#main-view .tab-content').forEach(c => {
    if (c.parentElement.id === 'main-view') c.style.display = 'none';
  });
  const profilTab = document.getElementById('tab-profil');
  if (profilTab) profilTab.style.display = 'block';

  // Tutup dropdown akun
  const accountItem = document.getElementById('nav-item-akun');
  if (accountItem) accountItem.classList.remove('active');

  // Deaktifkan semua nav link
  document.querySelectorAll('.nav-link').forEach(link => link.classList.remove('active'));

  if (window.location.hash !== '#profil') {
    history.pushState(null, null, '#profil');
  }

  loadProfileData(userId);
}

export function closeProfile() {
  if (typeof window.switchNavTab === 'function') {
    window.switchNavTab(_previousTab || 'overview');
  }
}

export async function loadProfileData(userId) {
  try {
    _currentProfileUserId = userId;
    const res = await fetchAuth(`${API_BASE}/certificates/profile/${userId}`);
    const data = await res.json();

    if (data.status !== 'success') {
      alert(data.message || 'Gagal memuat profil.');
      return;
    }

    const { user, attendance, certificates } = data.data;

    // Header
    document.getElementById('profile-nama').textContent = user.nama_lengkap;
    document.getElementById('profile-role').textContent = user.role.toUpperCase();
    const divBadge = document.getElementById('profile-divisi-badge');
    if (divBadge) divBadge.textContent = user.divisi ? user.divisi : (user.role === 'admin' ? 'Administrator' : 'Anggota Organisasi');
    const joinDate = user.created_at ? new Date(user.created_at).toLocaleDateString('id-ID', { year: 'numeric', month: 'long', day: 'numeric' }) : '-';
    document.getElementById('profile-joined').textContent = `Bergabung: ${joinDate}`;

    // Header Persentase
    const pHeader = document.getElementById('profile-persentase-header');
    if (pHeader) pHeader.textContent = `${attendance.persentase || 0}%`;

    // Tombol upload sertifikat (khusus Pengurus / Admin)
    const curUserStr = localStorage.getItem('iptek_user');
    const curUser = curUserStr ? JSON.parse(curUserStr) : null;
    const isPengurusOrAdmin = curUser && (curUser.role === 'admin' || curUser.role === 'pengurus');
    const btnUpload = document.getElementById('btn-upload-cert-profile');
    if (btnUpload) btnUpload.style.display = isPengurusOrAdmin ? 'inline-flex' : 'none';

    // Statistik kehadiran
    const rateEl = document.getElementById('profile-persentase');
    if (rateEl) rateEl.textContent = `${attendance.persentase || 0}%`;
    const rateHeader = document.getElementById('profile-persentase-header');
    if (rateHeader) rateHeader.textContent = `${attendance.persentase || 0}%`;
    const rateBadge = document.getElementById('profile-attendance-rate-badge');
    if (rateBadge) {
      const p = attendance.persentase || 0;
      rateBadge.textContent = `${p}% Kehadiran`;
      rateBadge.style.color = '#18181b';
      rateBadge.style.background = '#f4f4f5';
      rateBadge.style.border = '1px solid #e4e4e7';
    }

    document.getElementById('profile-total-pertemuan').textContent = attendance.total_pertemuan || 0;
    document.getElementById('profile-hadir').textContent = attendance.hadir || 0;
    document.getElementById('profile-izin').textContent = attendance.izin || 0;
    document.getElementById('profile-sakit').textContent = attendance.sakit || 0;
    document.getElementById('profile-alpa').textContent = attendance.alpa || 0;

    // Status absen hari ini banner
    const todayBox = document.getElementById('profile-today-attendance');
    if (todayBox) {
      if (attendance.today) {
        let timeStr = '';
        if (attendance.today.waktu) {
          try {
            timeStr = ' pukul ' + new Date(attendance.today.waktu).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) + ' WIB';
          } catch (e) {
            timeStr = '';
          }
        }
        todayBox.style.display = 'block';
        todayBox.innerHTML = `
          <div style="background: #ffffff; border: 1px solid #e4e4e7; border-left: 4px solid #18181b; border-radius: 6px; padding: 0.85rem 1.25rem; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 0.75rem; font-size: 0.88rem; color: #18181b;">
            <div style="display: flex; align-items: center; gap: 0.75rem;">
              <i class="fa-solid fa-circle-check" style="font-size: 1.1rem; color: #18181b;"></i>
              <div><strong>Status Hari Ini:</strong> Tercatat sebagai <span style="background: #18181b; color: #ffffff; padding: 0.15rem 0.5rem; border-radius: 4px; font-size: 0.75rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em;">${attendance.today.status}</span>${timeStr}</div>
            </div>
            <span style="font-size: 0.78rem; color: #71717a; font-weight: 600;"><i class="fa-solid fa-check" style="margin-right: 4px;"></i>Presensi Selesai</span>
          </div>
        `;
      } else {
        const isSelf = curUser && String(curUser.id) === String(userId);
        todayBox.style.display = 'block';
        todayBox.innerHTML = `
          <div style="background: #ffffff; border: 1px solid #e4e4e7; border-left: 4px solid #71717a; border-radius: 6px; padding: 0.85rem 1.25rem; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 0.75rem; font-size: 0.88rem; color: #4b5563;">
            <div style="display: flex; align-items: center; gap: 0.75rem;">
              <i class="fa-solid fa-clock" style="font-size: 1.1rem; color: #71717a;"></i>
              <div><strong>Status Hari Ini:</strong> Belum ada catatan absensi untuk hari ini.</div>
            </div>
            ${isSelf ? `
              <button onclick="switchNavTab('absensi')" class="btn btn-primary" style="font-size: 0.8rem; padding: 0.35rem 0.85rem; border-radius: 4px;">
                Buka Presensi <i class="fa-solid fa-arrow-right" style="font-size: 0.7rem; margin-left: 4px;"></i>
              </button>
            ` : ''}
          </div>
        `;
      }
    }

    // Riwayat absensi orang tersebut
    const attList = attendance.records || attendance.recent || [];
    const attCount = document.getElementById('profile-attendance-count');
    if (attCount) attCount.textContent = `${attendance.total_pertemuan || attList.length} total pertemuan`;

    const attBody = document.getElementById('profile-attendance-list');
    if (attList.length > 0) {
      attBody.innerHTML = attList.map((a, i) => {
        let dateStr = a.date;
        try {
          const parts = a.date.split('-');
          if (parts.length === 3) {
            const d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
            dateStr = d.toLocaleDateString('id-ID', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
          }
        } catch (e) {
          dateStr = a.date;
        }

        let timeStr = '-';
        if (a.created_at) {
          try {
            timeStr = new Date(a.created_at).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) + ' WIB';
          } catch (e) {
            timeStr = '-';
          }
        }

        const statusColors = {
          hadir: 'background: #18181b; color: #ffffff;',
          izin: 'background: #f4f4f5; color: #52525b; border: 1px solid #e4e4e7;',
          sakit: 'background: #f4f4f5; color: #52525b; border: 1px solid #e4e4e7;',
          alpa: 'background: #f4f4f5; color: #71717a; border: 1px solid #e4e4e7;'
        };
        const statusStyle = statusColors[a.status] || 'background: #f4f4f5; color: #71717a;';

        return `<tr>
          <td style="width: 60px; text-align: center; color: #71717a; font-size: 0.85rem;">${i + 1}</td>
          <td style="font-weight: 600; color: #18181b; font-size: 0.88rem;">${escapeHtml(dateStr)}</td>
          <td style="color: #71717a; font-size: 0.85rem;">${a.created_at ? `<i class="fa-regular fa-clock" style="font-size: 0.75rem; margin-right: 6px;"></i>${timeStr}` : '-'}</td>
          <td><span style="display: inline-block; padding: 0.2rem 0.6rem; border-radius: 4px; font-size: 0.72rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; ${statusStyle}">${escapeHtml(a.status)}</span></td>
        </tr>`;
      }).join('');
    } else {
      attBody.innerHTML = '<tr><td colspan="4" class="text-center" style="color: #a1a1aa; padding: 2rem 0;">Belum ada riwayat absensi untuk anggota ini.</td></tr>';
    }

    // Sertifikat
    const certContainer = document.getElementById('profile-cert-list');
    const certCount = document.getElementById('profile-cert-count');
    if (certCount) certCount.textContent = `${certificates.length} sertifikat`;

    if (certificates.length === 0) {
      certContainer.innerHTML = '<p style="color: #a1a1aa; font-size: 0.85rem; padding: 1rem 0;">Belum ada sertifikat yang diperoleh.</p>';
    } else {
      certContainer.innerHTML = certificates.map(c => {
        const dateStr = c.created_at ? new Date(c.created_at).toLocaleDateString('id-ID', { year: 'numeric', month: 'long', day: 'numeric' }) : '-';
        const isImage = c.file_path && c.file_path.match(/\.(jpg|jpeg|png|gif|webp)$/i);
        return `<div style="background: #ffffff; border: 1px solid #e4e4e7; border-radius: 6px; padding: 1rem 1.25rem; display: flex; align-items: center; justify-content: space-between; gap: 1rem; flex-wrap: wrap;">
          <div style="display: flex; align-items: center; gap: 1rem; min-width: 0;">
            <div style="width: 44px; height: 44px; background: #f4f4f5; border-radius: 6px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; color: #18181b;">
              <i class="fa-solid ${isImage ? 'fa-image' : 'fa-file-pdf'}" style="font-size: 1.15rem;"></i>
            </div>
            <div style="min-width: 0;">
              <div style="font-weight: 700; color: #18181b; font-size: 0.95rem; font-family: 'Outfit', sans-serif;">${escapeHtml(c.nama_sertifikat)}</div>
              <div style="font-size: 0.8rem; color: #71717a; margin-top: 0.2rem;">Diunggah oleh ${escapeHtml(c.uploaded_by_name)} • ${dateStr}</div>
            </div>
          </div>
          <a href="${c.file_path}" target="_blank" class="btn btn-secondary" style="font-size: 0.8rem; padding: 0.4rem 0.95rem; background: #ffffff; border: 1px solid #e4e4e7; border-radius: 6px; color: #18181b; display: inline-flex; align-items: center; gap: 6px; font-weight: 600; text-decoration: none; box-shadow: 0 1px 2px rgba(0,0,0,0.03);" onmouseover="this.style.background='#f4f4f5'" onmouseout="this.style.background='#ffffff'">
            <i class="fa-solid fa-download"></i> Unduh
          </a>
        </div>`;
      }).join('');
    }
  } catch (err) {
    console.error('loadProfileData error:', err);
    alert('Gagal memuat data profil.');
  }
}

// ========== MANAJEMEN SERTIFIKAT (Pengurus) ==========

export async function loadCertificates() {
  try {
    const res = await fetchAuth(`${API_BASE}/certificates`);
    const data = await res.json();
    const tbody = document.getElementById('table-sertifikat');
    if (!tbody) return;

    if (data.status !== 'success' || !data.data || data.data.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" class="text-center" style="color:#71717a;">Belum ada sertifikat yang diunggah.</td></tr>';
      return;
    }

    tbody.innerHTML = data.data.map((c, i) => {
      const dateStr = c.created_at ? new Date(c.created_at).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' }) : '-';
      return `<tr>
        <td>${i + 1}</td>
        <td style="font-weight:500;">${escapeHtml(c.owner_name)}</td>
        <td>${escapeHtml(c.nama_sertifikat)}</td>
        <td style="font-size:0.85rem; color:#71717a;">${escapeHtml(c.uploaded_by_name)}</td>
        <td style="font-size:0.85rem; color:#71717a;">${dateStr}</td>
        <td>
          <div style="display:flex; gap:0.4rem;">
            <a href="${c.file_path}" target="_blank" title="Lihat" style="background:none; border:1px solid #e4e4e7; border-radius:5px; padding:0.3rem 0.5rem; cursor:pointer; color:#4b5563; font-size:0.8rem; text-decoration:none;"><i class="fa-solid fa-eye"></i></a>
            <button onclick="deleteCertificate(${c.id})" title="Hapus" style="background:none; border:1px solid #fecaca; border-radius:5px; padding:0.3rem 0.5rem; cursor:pointer; color:#dc2626; font-size:0.8rem;"><i class="fa-solid fa-trash"></i></button>
          </div>
        </td>
      </tr>`;
    }).join('');
  } catch (err) {
    console.error('loadCertificates error:', err);
  }
}

export async function showUploadCertModal(defaultUserId = null) {
  // Muat daftar user ke dropdown
  try {
    const res = await fetchAuth(`${API_BASE}/users`);
    const data = await res.json();
    const select = document.getElementById('cert-user-select');
    if (data.status === 'success' && data.data) {
      select.innerHTML = '<option value="">-- Pilih Anggota --</option>' +
        data.data.map(u => `<option value="${u.id}">${escapeHtml(u.nama_lengkap)} (${u.role})</option>`).join('');

      const targetId = defaultUserId || _currentProfileUserId;
      if (targetId) {
        select.value = String(targetId);
      }
    }
  } catch (err) {
    console.error('Gagal memuat daftar user:', err);
  }
  document.getElementById('cert-nama').value = '';
  document.getElementById('cert-file').value = '';
  document.getElementById('modal-upload-cert').style.display = 'flex';
}

export function closeUploadCertModal() {
  document.getElementById('modal-upload-cert').style.display = 'none';
}

export async function submitCertificate() {
  const userId = document.getElementById('cert-user-select').value;
  const nama = document.getElementById('cert-nama').value.trim();
  const fileInput = document.getElementById('cert-file');

  if (!userId) return alert('Pilih penerima sertifikat.');
  if (!nama) return alert('Nama sertifikat wajib diisi.');
  if (!fileInput.files[0]) return alert('Pilih file sertifikat.');

  const btn = document.getElementById('btn-submit-cert');
  const originalText = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Mengunggah...';

  try {
    const formData = new FormData();
    formData.append('user_id', userId);
    formData.append('nama_sertifikat', nama);
    formData.append('certificate_file', fileInput.files[0]);

    const res = await fetchAuth(`${API_BASE}/certificates`, {
      method: 'POST',
      body: formData
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || 'Gagal mengunggah sertifikat.');

    closeUploadCertModal();
    loadCertificates();
    if (_currentProfileUserId && document.getElementById('tab-profil') && document.getElementById('tab-profil').style.display !== 'none') {
      loadProfileData(_currentProfileUserId);
    }
    alert(data.message || 'Sertifikat berhasil diunggah.');
  } catch (err) {
    alert(err.message);
  } finally {
    btn.disabled = false;
    btn.innerHTML = originalText;
  }
}

export async function deleteCertificate(id) {
  if (!confirm('Yakin ingin menghapus sertifikat ini?')) return;
  try {
    const res = await fetchAuth(`${API_BASE}/certificates/${id}`, { method: 'DELETE' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || 'Gagal menghapus.');
    loadCertificates();
    if (_currentProfileUserId && document.getElementById('tab-profil') && document.getElementById('tab-profil').style.display !== 'none') {
      loadProfileData(_currentProfileUserId);
    }
    alert(data.message || 'Sertifikat berhasil dihapus.');
  } catch (err) {
    alert(err.message);
  }
}

export function showAddUserModal() {
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

export async function showEditUserModal(id) {
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

export function toggleDivisiField() {
  const role = document.getElementById('form-user-role').value;
  document.getElementById('form-user-divisi-group').style.display = role === 'pengurus' ? 'block' : 'none';
}

export function closeUserModal() {
  document.getElementById('modal-user-form').style.display = 'none';
}

export async function submitUserForm() {
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

export function showResetPasswordModal(id) {
  // Reset form to default (Auto)
  const form = document.getElementById('form-reset-password');
  form.reset();

  // Set ID after reset so it doesn't get cleared
  document.getElementById('reset-user-id').value = id;

  toggleResetManual(false);
  document.getElementById('modal-reset-password').style.display = 'flex';
}

export function closeResetPasswordModal() {
  document.getElementById('modal-reset-password').style.display = 'none';
}

export function toggleResetManual(show) {
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

export async function submitResetPassword(e) {
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

export function closeResetResultModal() {
  document.getElementById('modal-reset-result').style.display = 'none';
}

export function showDeleteUserModal(id, nama) {
  document.getElementById('delete-user-id').value = id;
  document.getElementById('delete-user-msg').textContent = `Yakin ingin menghapus (mengurangi) anggota "${nama}"? Semua data terkait juga akan dibersihkan.`;
  document.getElementById('modal-delete-user').style.display = 'flex';
}

export function closeDeleteModal() {
  document.getElementById('modal-delete-user').style.display = 'none';
}

export async function confirmDeleteUser() {
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
