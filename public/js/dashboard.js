import { fetchAuth } from './auth.js';
import { loadDocumentTemplates } from './academic.js';
export const API_BASE = '/api';

let _anggotaDebounce = null;
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
          <td style="font-weight:500;">${escapeHtml(u.nama_lengkap)}</td>
          <td><code style="font-size:0.8rem; background:#f4f4f5; padding:0.15rem 0.4rem; border-radius:4px;">${escapeHtml(u.username)}</code></td>
          <td><span style="display:inline-block; padding:0.2rem 0.6rem; border-radius:4px; font-size:0.75rem; font-weight:600; text-transform:uppercase; letter-spacing:0.03em; ${u.role === 'admin' ? 'background:#dc2626; color:#fff;' : (u.role === 'pengurus' ? 'background:#18181b; color:#fff;' : 'background:#f4f4f5; color:#4b5563;')}">${u.role}</span></td>
          <td style="color:${u.divisi ? '#18181b' : '#a1a1aa'};">${u.divisi || '-'}</td>
          <td>
            <div style="display:flex; gap:0.4rem; flex-wrap:wrap;">
              ${isAdminUser ? `
                <button onclick="showEditUserModal(${u.id})" title="Edit" style="background:none; border:1px solid #e4e4e7; border-radius:5px; padding:0.3rem 0.5rem; cursor:pointer; color:#4b5563; font-size:0.8rem;"><i class="fa-solid fa-pen-to-square"></i></button>
                <button onclick="showResetPasswordModal(${u.id})" title="Reset Password" style="background:none; border:1px solid #e4e4e7; border-radius:5px; padding:0.3rem 0.5rem; cursor:pointer; color:#4b5563; font-size:0.8rem;"><i class="fa-solid fa-key"></i></button>
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

export function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
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

