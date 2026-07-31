const API_BASE = '/api';

document.addEventListener('DOMContentLoaded', () => {
  checkAdminAuth();
});

function checkAdminAuth() {
  const token = localStorage.getItem('iptek_admin_token');
  const userStr = localStorage.getItem('iptek_admin_user');

  if (!token || !userStr) {
    showAdminView('admin-login-view');
    return;
  }

  try {
    const user = JSON.parse(userStr);
    if (user.role !== 'admin') {
      adminLogout();
      return;
    }

    const displayEl = document.getElementById('admin-user-display');
    if (displayEl) displayEl.textContent = user.nama_lengkap || user.username;

    showAdminView('admin-dashboard-view');
    loadUserList();
  } catch (e) {
    adminLogout();
  }
}

function showAdminView(viewId) {
  document.getElementById('admin-login-view').style.display = viewId === 'admin-login-view' ? 'flex' : 'none';
  document.getElementById('admin-dashboard-view').style.display = viewId === 'admin-dashboard-view' ? 'block' : 'none';
}

async function fetchAdminAuth(url, options = {}) {
  const token = localStorage.getItem('iptek_admin_token');
  if (!options.headers) options.headers = {};
  if (token) options.headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(url, options);
  if (res.status === 401 || res.status === 403) {
    adminLogout();
    throw new Error('Sesi admin berakhir atau akses ditolak. Silakan login kembali.');
  }
  return res;
}

async function handleAdminLogin(e) {
  e.preventDefault();
  const usernameInput = document.getElementById('admin-username').value.trim();
  const passwordInput = document.getElementById('admin-password').value;
  const btn = document.getElementById('btn-admin-login');

  if (!usernameInput || !passwordInput) {
    alert('Username dan password wajib diisi.');
    return;
  }

  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Memproses...';

  try {
    const res = await fetch(`${API_BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: usernameInput, password: passwordInput })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.message || 'Login gagal.');

    if (data.user.role !== 'admin') {
      throw new Error('Akses khusus Admin. Akun Anda bukan role Admin.');
    }

    localStorage.setItem('iptek_admin_token', data.token);
    localStorage.setItem('iptek_admin_user', JSON.stringify(data.user));

    checkAdminAuth();
  } catch (err) {
    alert(err.message);
  } font-size
  finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="fa-solid fa-lock"></i> Masuk Administrator';
  }
}

function adminLogout() {
  localStorage.removeItem('iptek_admin_token');
  localStorage.removeItem('iptek_admin_user');
  showAdminView('admin-login-view');
}

let _userDebounce = null;

async function loadUserList() {
  clearTimeout(_userDebounce);
  _userDebounce = setTimeout(async () => {
    try {
      const role = document.getElementById('filter-user-role').value;
      const search = document.getElementById('search-user').value.trim();
      let query = '?';
      if (role) query += `role=${role}&`;
      if (search) query += `search=${encodeURIComponent(search)}&`;

      const res = await fetchAdminAuth(`${API_BASE}/users${query}`);
      const data = await res.json();

      const tbody = document.getElementById('table-users');
      const countEl = document.getElementById('users-count');

      if (data.status !== 'success' || !data.data.length) {
        tbody.innerHTML = '<tr><td colspan="6" class="text-center" style="color:#71717a;">Tidak ada data ditemukan.</td></tr>';
        if (countEl) countEl.textContent = '';
        return;
      }

      const currentUser = JSON.parse(localStorage.getItem('iptek_admin_user') || '{}');

      tbody.innerHTML = data.data.map((u, i) => `
        <tr>
          <td>${i + 1}</td>
          <td style="font-weight:500;">${escapeHtml(u.nama_lengkap)}</td>
          <td><code style="font-size:0.8rem; background:#f4f4f5; padding:0.15rem 0.4rem; border-radius:4px;">${escapeHtml(u.username)}</code></td>
          <td><span style="display:inline-block; padding:0.2rem 0.6rem; border-radius:4px; font-size:0.75rem; font-weight:600; text-transform:uppercase; letter-spacing:0.03em; ${u.role === 'admin' ? 'background:#dc2626; color:#fff;' : (u.role === 'pengurus' ? 'background:#18181b; color:#fff;' : 'background:#f4f4f5; color:#4b5563;')}">${u.role}</span></td>
          <td style="color:${u.divisi ? '#18181b' : '#a1a1aa'};">${u.divisi || '-'}</td>
          <td>
            <div style="display:flex; gap:0.4rem; flex-wrap:wrap;">
              <button onclick="showEditUserModal(${u.id})" title="Edit" style="background:none; border:1px solid #e4e4e7; border-radius:5px; padding:0.35rem 0.6rem; cursor:pointer; color:#4b5563; font-size:0.8rem;"><i class="fa-solid fa-pen-to-square"></i></button>
              <button onclick="resetUserPassword(${u.id})" title="Reset Password" style="background:none; border:1px solid #e4e4e7; border-radius:5px; padding:0.35rem 0.6rem; cursor:pointer; color:#4b5563; font-size:0.8rem;"><i class="fa-solid fa-key"></i></button>
              ${u.id !== currentUser.id ? `<button onclick="showDeleteUserModal(${u.id}, '${escapeHtml(u.nama_lengkap).replace(/'/g, "\\'")}')" title="Hapus" style="background:none; border:1px solid #fecaca; border-radius:5px; padding:0.35rem 0.6rem; cursor:pointer; color:#dc2626; font-size:0.8rem;"><i class="fa-solid fa-trash"></i></button>` : ''}
            </div>
          </td>
        </tr>
      `).join('');

      if (countEl) countEl.textContent = `Menampilkan ${data.data.length} akun`;
    } catch (err) {
      console.error('loadUserList error:', err);
    }
  }, 300);
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function showAddUserModal() {
  document.getElementById('modal-user-title').textContent = 'Tambah Akun Baru';
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
    const res = await fetchAdminAuth(`${API_BASE}/users?search=`);
    const data = await res.json();
    if (data.status !== 'success') return;

    const user = data.data.find(u => u.id === id);
    if (!user) return alert('User tidak ditemukan.');

    document.getElementById('modal-user-title').textContent = 'Edit Akun';
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

    const res = await fetchAdminAuth(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.message || 'Gagal menyimpan.');

    closeUserModal();
    loadUserList();

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

async function resetUserPassword(id) {
  if (!confirm('Reset password user ini? Password baru akan di-generate otomatis.')) return;

  try {
    const res = await fetchAdminAuth(`${API_BASE}/users/${id}/reset-password`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.message || 'Gagal reset password.');

    document.getElementById('reset-result-name').textContent = data.data.nama_lengkap + ' (@' + data.data.username + ')';
    document.getElementById('reset-result-password').textContent = data.data.new_password;
    document.getElementById('modal-reset-result').style.display = 'flex';
  } catch (err) {
    alert(err.message);
  }
}

function closeResetResultModal() {
  document.getElementById('modal-reset-result').style.display = 'none';
}

function showDeleteUserModal(id, nama) {
  document.getElementById('delete-user-id').value = id;
  document.getElementById('delete-user-msg').textContent = `Yakin ingin menghapus "${nama}"? Semua data terkait (absensi, pembayaran) juga akan terhapus.`;
  document.getElementById('modal-delete-user').style.display = 'flex';
}

function closeDeleteModal() {
  document.getElementById('modal-delete-user').style.display = 'none';
}

async function confirmDeleteUser() {
  const id = document.getElementById('delete-user-id').value;
  try {
    const res = await fetchAdminAuth(`${API_BASE}/users/${id}`, { method: 'DELETE' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || 'Gagal menghapus.');

    closeDeleteModal();
    loadUserList();
    alert(data.message || 'Akun berhasil dihapus.');
  } catch (err) {
    alert(err.message);
  }
}
