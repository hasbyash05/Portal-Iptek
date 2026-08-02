import { fetchAuth } from './auth.js';
import { checkKasAndUnlockAttendance, switchAnggotaTab } from './router.js';
export const API_BASE = '/api';

export async function loadKasReport(statusFilter = '') {
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

export async function confirmKas(id, status) {
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

export function openAdminBuktiModal(pEncoded) {
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

export function closeAdminBuktiModal() {
  const modal = document.getElementById('admin-bukti-modal');
  if (modal) {
    modal.style.display = 'none';
  }
}

export async function payQrisFromModal() {
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
    alert('PEMBAYARAN QRIS BERHASIL DIKIRIM!

Status: MENUNGGU VERIFIKASI BENDAHARA.
Silakan tunggu Pengurus bagian Bendahara memverifikasi pembayaran kas Anda menjadi Lunas agar Anda dapat melakukan presensi.');
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

export function closeLockModalAndGoHome() {
  document.getElementById('qris-lock-modal').style.display = 'none';
  switchAnggotaTab('overview');
}

export async function submitKasQris(e) {
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
    alert('PEMBAYARAN QRIS BERHASIL DIKIRIM!

Status: MENUNGGU VERIFIKASI BENDAHARA.
Silakan tunggu Pengurus bagian Bendahara memverifikasi pembayaran kas Anda menjadi Lunas.');
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

export async function loadAnggotaKas() {
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

export async function loadExpenses() {
  try {
    const res = await fetchAuth(`${API_BASE}/expenses`);
    const data = await res.json();
    const tbody = document.getElementById('table-expenses');

    if (data.status === 'success') {
      const items = data.data.items || [];
      if (items.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" class="text-center">Belum ada catatan pengeluaran.</td></tr>`;
      } else {
        tbody.innerHTML = items.map(exp => `
          <tr>
            <td>${exp.date}</td>
            <td>${exp.description}</td>
            <td style="color: #ef4444; font-weight: 600;">- Rp ${Number(exp.amount).toLocaleString('id-ID')}</td>
            <td><small>${exp.creator ? exp.creator.nama_lengkap : 'Admin'}</small></td>
            <td>
              <button onclick="deleteExpense(${exp.id})" class="btn btn-logout btn-sm"><i class="fa-solid fa-trash"></i></button>
            </td>
          </tr>
        `).join('');
      }
    }
  } catch (err) {
    console.error('Gagal memuat pengeluaran:', err);
  }
}

export async function submitExpense(e) {
  e.preventDefault();
  const btn = document.getElementById('btn-submit-expense');
  const originalText = btn.textContent;
  btn.textContent = 'Menyimpan...';
  btn.disabled = true;

  try {
    const payload = {
      description: document.getElementById('expense-desc').value,
      amount: document.getElementById('expense-amount').value,
      date: document.getElementById('expense-date').value
    };

    const res = await fetchAuth(`${API_BASE}/expenses`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await res.json();
    if (data.status === 'success') {
      alert('Pengeluaran berhasil dicatat!');
      document.getElementById('form-expense').reset();
      loadExpenses();
    } else {
      alert(data.message || 'Gagal mencatat pengeluaran.');
    }
  } catch (err) {
    alert('Terjadi kesalahan koneksi.');
    console.error(err);
  } finally {
    btn.textContent = originalText;
    btn.disabled = false;
  }
}

export async function deleteExpense(id) {
  if (!confirm('Yakin ingin menghapus catatan pengeluaran ini?')) return;

  try {
    const res = await fetchAuth(`${API_BASE}/expenses/${id}`, { method: 'DELETE' });
    const data = await res.json();
    if (data.status === 'success') {
      loadExpenses();
    } else {
      alert(data.message || 'Gagal menghapus pengeluaran.');
    }
  } catch (err) {
    alert('Terjadi kesalahan koneksi.');
  }
}

export async function exportKasCsv() {
  const year = document.getElementById('export-kas-year').value;
  if (!year) return alert('Pilih tahun terlebih dahulu.');

  try {
    const res = await fetchAuth(`${API_BASE}/payments/report?year=${year}&status=lunas`);
    const data = await res.json();

    if (data.status === 'success') {
      const items = data.data.items || [];
      if (items.length === 0) {
        alert(`Tidak ada data uang kas yang lunas pada tahun ${year}.`);
        return;
      }

      const summary = {};
      items.forEach(p => {
        const nama = p.user ? p.user.nama_lengkap : 'Tidak Diketahui';
        const nominal = p.amount ? parseFloat(p.amount) : 10000;

        if (!summary[nama]) {
          summary[nama] = {
            nama: `"${nama}"`,
            totalNominal: 0,
            tahun: p.year
          };
        }
        summary[nama].totalNominal += nominal;
      });

      const headers = ['No', 'Nama Anggota', 'Total Pembayaran', 'Tahun'];
      const rows = Object.values(summary).map((data, index) => {
        return [
          index + 1,
          data.nama,
          data.totalNominal,
          data.tahun
        ].join(',');
      });

      const csvContent = [headers.join(','), ...rows].join('
');
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);

      const a = document.createElement('a');
      a.href = url;
      a.download = `Laporan_Uang_Kas_Lunas_${year}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } else {
      alert(data.message || 'Gagal mengambil data laporan.');
    }
  } catch (err) {
    console.error('Export CSV Error:', err);
    alert('Terjadi kesalahan saat memproses export CSV.');
  }
}

export async function loadQrisConfig() {
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

export async function uploadQrisImage(e) {
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

