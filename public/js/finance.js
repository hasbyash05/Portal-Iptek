import { fetchAuth, clearApiCache } from './auth.js';
import { checkKasAndUnlockAttendance, switchNavTab } from './router.js';
export const API_BASE = '/api';

let kasPollTimer = null;
let kasCountdownTimer = null;
let kasRemainingSeconds = 0;
let activeKasSvgUrl = null;
let activeKasOrderId = null;

let modalPollTimer = null;
let modalCountdownTimer = null;
let modalRemainingSeconds = 0;
let activeModalSvgUrl = null;

function formatTimer(secs) {
  const s = Math.max(0, Math.floor(secs));
  const m = String(Math.floor(s / 60)).padStart(2, '0');
  const r = String(s % 60).padStart(2, '0');
  return `${m}:${r}`;
}

export function stopKasPolling() {
  if (kasPollTimer) { clearInterval(kasPollTimer); kasPollTimer = null; }
  if (kasCountdownTimer) { clearInterval(kasCountdownTimer); kasCountdownTimer = null; }
}

export function stopModalPolling() {
  if (modalPollTimer) { clearInterval(modalPollTimer); modalPollTimer = null; }
  if (modalCountdownTimer) { clearInterval(modalCountdownTimer); modalCountdownTimer = null; }
}

function renderKasInvoiceUI(inv) {
  const startBox = document.getElementById('kas-gateway-start-box');
  const paidBox = document.getElementById('kas-gateway-paid-box');
  const invBox = document.getElementById('kas-gateway-invoice-box');
  const imgBox = document.getElementById('qris-image-kas');
  const amtEl = document.getElementById('kas-invoice-amount');
  const breakEl = document.getElementById('kas-invoice-breakdown');
  const orderEl = document.getElementById('kas-invoice-order');
  const countEl = document.getElementById('kas-invoice-countdown');
  const nmidEl = document.getElementById('qris-nmid-kas');
  const bannerEl = document.getElementById('kas-invoice-status-banner');

  if (inv.status === 'lunas') {
    stopKasPolling();
    if (startBox) startBox.style.display = 'none';
    if (invBox) invBox.style.display = 'none';
    if (paidBox) paidBox.style.display = 'block';
    return;
  }

  if (startBox) startBox.style.display = 'none';
  if (paidBox) paidBox.style.display = 'none';
  if (invBox) invBox.style.display = 'block';

  activeKasSvgUrl = inv.qris_svg_data_url || null;
  activeKasOrderId = inv.order_id || null;

  if (imgBox) {
    if (inv.qris_svg_data_url) {
      imgBox.innerHTML = `<img src="${inv.qris_svg_data_url}" alt="QRIS Dinamis ${inv.order_id}" style="width: 240px; max-width: 100%; height: auto; display: block;">`;
    } else {
      imgBox.innerHTML = `<p style="color: #71717a; font-size: 0.9rem;">QRIS belum tersedia.</p>`;
    }
  }
  if (amtEl) amtEl.textContent = `Rp ${Number(inv.payable_amount || 10000).toLocaleString('id-ID')}`;
  if (breakEl) {
    breakEl.textContent = `Kas Rp ${Number(inv.base_amount || 10000).toLocaleString('id-ID')} + Kode Unik Rp ${inv.unique_code || 0} | Admin Rp 0`;
  }
  if (orderEl) orderEl.textContent = inv.order_id || '-';
  if (nmidEl) nmidEl.textContent = `${inv.merchant_name || 'Bendahara UKM IPTEK'} | NMID: ${inv.nmid || '-'}`;

  kasRemainingSeconds = inv.remaining_seconds || 0;
  if (countEl) countEl.textContent = formatTimer(kasRemainingSeconds);

  stopKasPolling();

  if (inv.status === 'expired' || kasRemainingSeconds <= 0) {
    if (bannerEl) {
      bannerEl.innerHTML = `<i class="fa-solid fa-clock" style="margin-right: 6px;"></i> Kode QRIS telah kedaluwarsa. Klik <strong>Buat Kode Baru</strong> untuk melanjutkan.`;
    }
    return;
  }

  if (bannerEl) {
    bannerEl.innerHTML = `<i class="fa-solid fa-rotate fa-spin" style="margin-right: 6px;"></i> Menunggu pembayaran sebesar <strong>Rp ${Number(inv.payable_amount).toLocaleString('id-ID')}</strong> (deteksi otomatis aktif)...`;
  }

  kasCountdownTimer = setInterval(() => {
    kasRemainingSeconds = Math.max(0, kasRemainingSeconds - 1);
    if (countEl) countEl.textContent = formatTimer(kasRemainingSeconds);
    if (kasRemainingSeconds <= 0) {
      stopKasPolling();
      if (bannerEl) {
        bannerEl.innerHTML = `<i class="fa-solid fa-clock" style="margin-right: 6px;"></i> Kode QRIS kedaluwarsa. Klik <strong>Buat Kode Baru</strong> untuk membuat tagihan baru.`;
      }
    }
  }, 1000);

  kasPollTimer = setInterval(async () => {
    if (!activeKasOrderId) return;
    try {
      const res = await fetchAuth(`${API_BASE}/payments/invoice/${encodeURIComponent(activeKasOrderId)}/status`, { noCache: true });
      const data = await res.json();
      if (data.status === 'success' && data.data) {
        if (data.data.is_paid || data.data.status === 'lunas') {
          stopKasPolling();
          clearApiCache('payments');
          renderKasInvoiceUI({ ...inv, status: 'lunas' });
          loadAnggotaKasHistory();
          if (typeof checkKasAndUnlockAttendance === 'function') {
            checkKasAndUnlockAttendance();
          }
        } else if (data.data.status === 'expired') {
          stopKasPolling();
          if (bannerEl) {
            bannerEl.innerHTML = `<i class="fa-solid fa-clock" style="margin-right: 6px;"></i> Kode QRIS kedaluwarsa. Klik <strong>Buat Kode Baru</strong>.`;
          }
        }
      }
    } catch (e) {
      // ignore transient network hiccups during polling
    }
  }, 3000);
}

export async function generateKasInvoice(forceNew = false) {
  const btn = document.getElementById('btn-pay-qris');
  const orig = btn ? btn.innerHTML : '';
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Membuat Kode QRIS Otomatis...`;
  }

  const now = new Date();
  try {
    const res = await fetchAuth(`${API_BASE}/payments/create-invoice`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        month: now.getMonth() + 1,
        year: now.getFullYear(),
        force_new: !!forceNew
      })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || 'Gagal membuat tagihan QRIS');

    clearApiCache('payments');
    renderKasInvoiceUI(data.data);
    loadAnggotaKasHistory();
  } catch (err) {
    alert(`Gagal membuat kode QRIS: ${err.message}`);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = orig;
    }
  }
}

export function downloadActiveQrisSvg(target = 'kas') {
  const url = target === 'modal' ? activeModalSvgUrl : activeKasSvgUrl;
  if (!url) {
    alert('Belum ada kode QRIS aktif untuk disimpan.');
    return;
  }
  const a = document.createElement('a');
  a.href = url;
  a.download = `QRIS-Kas-IPTEK-${activeKasOrderId || 'tagihan'}.svg`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

export async function openLockModalWithInvoice(forceNew = false) {
  const imgBox = document.getElementById('qris-image-modal');
  const amtEl = document.getElementById('qris-modal-amount');
  const breakEl = document.getElementById('qris-modal-breakdown');
  const orderEl = document.getElementById('qris-modal-order');
  const countEl = document.getElementById('qris-modal-countdown');
  const statusBox = document.getElementById('qris-modal-status-box');

  if (imgBox) imgBox.innerHTML = `<p style="color: #71717a; font-size: 0.85rem;"><i class="fa-solid fa-spinner fa-spin"></i> Membuat QRIS Dinamis...</p>`;
  stopModalPolling();

  const now = new Date();
  try {
    const res = await fetchAuth(`${API_BASE}/payments/create-invoice`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        month: now.getMonth() + 1,
        year: now.getFullYear(),
        force_new: !!forceNew
      })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || 'Gagal membuat tagihan QRIS');

    const inv = data.data;
    if (inv.status === 'lunas' || data.already_paid) {
      const modal = document.getElementById('qris-lock-modal');
      if (modal) modal.style.display = 'none';
      clearApiCache('payments');
      checkKasAndUnlockAttendance();
      return;
    }

    activeModalSvgUrl = inv.qris_svg_data_url || null;
    if (imgBox && inv.qris_svg_data_url) {
      imgBox.innerHTML = `<img src="${inv.qris_svg_data_url}" alt="QRIS Dinamis" style="width: 220px; max-width: 100%; height: auto; display: block;">`;
    }
    if (amtEl) amtEl.textContent = `Rp ${Number(inv.payable_amount || 10000).toLocaleString('id-ID')}`;
    if (breakEl) {
      breakEl.textContent = `Kas Rp ${Number(inv.base_amount || 10000).toLocaleString('id-ID')} + Kode Unik Rp ${inv.unique_code || 0} | Admin Rp 0`;
    }
    if (orderEl) orderEl.textContent = inv.order_id || '-';

    modalRemainingSeconds = inv.remaining_seconds || 0;
    if (countEl) countEl.textContent = formatTimer(modalRemainingSeconds);

    if (statusBox) {
      statusBox.innerHTML = `<div style="padding: 0.65rem 0.9rem; background: #f8f9fa; border: 1px solid #e4e4e7; border-radius: 6px; font-size: 0.82rem; color: #18181b;"><i class="fa-solid fa-rotate fa-spin" style="margin-right: 6px;"></i> Menunggu pembayaran otomatis sebesar <strong>Rp ${Number(inv.payable_amount).toLocaleString('id-ID')}</strong>...</div>`;
    }

    modalCountdownTimer = setInterval(() => {
      modalRemainingSeconds = Math.max(0, modalRemainingSeconds - 1);
      if (countEl) countEl.textContent = formatTimer(modalRemainingSeconds);
      if (modalRemainingSeconds <= 0) {
        stopModalPolling();
        if (statusBox) {
          statusBox.innerHTML = `<div style="padding: 0.65rem 0.9rem; background: #f8f9fa; border: 1px solid #d4d4d8; border-radius: 6px; font-size: 0.82rem; color: #18181b;">Kode QRIS kedaluwarsa. Klik <strong>Buat Ulang Kode QRIS</strong> di bawah.</div>`;
        }
      }
    }, 1000);

    const orderId = inv.order_id;
    modalPollTimer = setInterval(async () => {
      const modal = document.getElementById('qris-lock-modal');
      if (!modal || modal.style.display === 'none') {
        stopModalPolling();
        return;
      }
      try {
        const stRes = await fetchAuth(`${API_BASE}/payments/invoice/${encodeURIComponent(orderId)}/status`, { noCache: true });
        const stData = await stRes.json();
        if (stData.status === 'success' && stData.data && (stData.data.is_paid || stData.data.status === 'lunas')) {
          stopModalPolling();
          clearApiCache('payments');
          if (modal) modal.style.display = 'none';
          alert('Pembayaran kas berhasil terverifikasi otomatis (LUNAS). Gerbang presensi kini terbuka.');
          checkKasAndUnlockAttendance();
        }
      } catch (e) {
        // ignore transient polling error
      }
    }, 3000);
  } catch (err) {
    if (imgBox) imgBox.innerHTML = `<p style="color: #ef4444; font-size: 0.85rem;">${err.message}</p>`;
  }
}

export async function payQrisFromModal() {
  await openLockModalWithInvoice(true);
}

export function closeLockModalAndGoHome() {
  stopModalPolling();
  const modal = document.getElementById('qris-lock-modal');
  if (modal) modal.style.display = 'none';
  if (typeof switchNavTab === 'function') {
    switchNavTab('overview');
  } else if (typeof window.switchNavTab === 'function') {
    window.switchNavTab('overview');
  }
}

export async function submitKasQris(e) {
  if (e && e.preventDefault) e.preventDefault();
  await generateKasInvoice(false);
}

async function loadAnggotaKasHistory() {
  try {
    const res = await fetchAuth(`${API_BASE}/payments/history?limit=10`, { noCache: true });
    const data = await res.json();
    const tbody = document.getElementById('table-my-kas');
    const items = data.data ? data.data.items : [];

    if (!tbody) return;
    if (items.length === 0) {
      tbody.innerHTML = `<tr><td colspan="3" class="text-center">Belum ada riwayat pembayaran kas.</td></tr>`;
    } else {
      tbody.innerHTML = items.map(p => `
        <tr>
          <td>
            <strong>Bulan ${p.month} / ${p.year}</strong>
            ${p.order_id ? `<br><small class="text-muted">${p.order_id}</small>` : ''}
          </td>
          <td>
            <strong>Rp ${Number(p.payable_amount || p.amount).toLocaleString('id-ID')}</strong>
            ${p.unique_code ? `<br><small class="text-muted">Kas Rp 10.000 + Unik ${p.unique_code}</small>` : ''}
          </td>
          <td>
            <span style="padding: 4px 8px; border-radius: 4px; font-weight: bold; font-size: 0.8rem; background: #f4f4f5; color: #18181b;">
              ${p.status.toUpperCase()}
            </span>
          </td>
        </tr>
      `).join('');
    }
  } catch (err) {
    console.error('Gagal memuat riwayat kas anggota:', err);
  }
}

export async function loadAnggotaKas() {
  const monthNames = [
    'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
    'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'
  ];
  const now = new Date();
  const periodEl = document.getElementById('kas-current-period-display');
  if (periodEl) {
    periodEl.textContent = `Bulan ${monthNames[now.getMonth()]} ${now.getFullYear()}`;
  }

  await loadAnggotaKasHistory();

  try {
    const res = await fetchAuth(`${API_BASE}/payments/check`, { noCache: true });
    const data = await res.json();
    const startBox = document.getElementById('kas-gateway-start-box');
    const paidBox = document.getElementById('kas-gateway-paid-box');
    const invBox = document.getElementById('kas-gateway-invoice-box');

    if (data.status === 'success' && data.data) {
      if (data.data.hasPaid) {
        stopKasPolling();
        if (startBox) startBox.style.display = 'none';
        if (invBox) invBox.style.display = 'none';
        if (paidBox) paidBox.style.display = 'block';
      } else if (data.data.payment && data.data.payment.status === 'pending' && data.data.payment.order_id) {
        // Automatically resume active pending invoice
        await generateKasInvoice(false);
      } else {
        stopKasPolling();
        if (paidBox) paidBox.style.display = 'none';
        if (invBox) invBox.style.display = 'none';
        if (startBox) startBox.style.display = 'block';
      }
    }
  } catch (err) {
    console.error('Gagal mengecek status kas anggota:', err);
  }
}

export async function loadKasReport(statusFilter = '') {
  document.querySelectorAll('.filter-buttons .btn').forEach(btn => btn.classList.remove('active'));
  const filterBtns = document.querySelectorAll('.filter-buttons .btn');
  if (filterBtns.length >= 4) {
    if (!statusFilter) filterBtns[0].classList.add('active');
    if (statusFilter === 'pending') filterBtns[1].classList.add('active');
    if (statusFilter === 'lunas') filterBtns[2].classList.add('active');
    if (statusFilter === 'ditolak') filterBtns[3].classList.add('active');
  }

  try {
    const query = statusFilter ? `?status=${statusFilter}` : '';
    const res = await fetchAuth(`${API_BASE}/payments/report${query}`, { noCache: true });
    const data = await res.json();
    const tbody = document.getElementById('table-rekap-kas');
    const items = data.data ? data.data.items : [];

    const userStr = localStorage.getItem('iptek_user');
    const currentUser = userStr ? JSON.parse(userStr) : null;
    const isBendahara = currentUser && (currentUser.role === 'admin' || (currentUser.divisi && currentUser.divisi.toLowerCase().includes('bendahara')));

    if (items.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" class="text-center">Belum ada data pembayaran kas.</td></tr>`;
    } else {
      tbody.innerHTML = items.map(p => `
        <tr>
          <td><strong>Bulan ${p.month} / ${p.year}</strong></td>
          <td>${p.user ? p.user.nama_lengkap : '-'} <br><small class="text-muted">${p.user && p.user.divisi ? p.user.divisi : ''}</small></td>
          <td><strong style="color: #18181b;">Rp ${Number(p.amount).toLocaleString('id-ID')}</strong></td>
          <td>
            <div style="font-size: 0.82rem; color: #18181b; margin-bottom: 4px;">
              <strong>${p.order_id || 'Transaksi Lama'}</strong>
              ${p.payable_amount ? `<br><span class="text-muted">Bayar: Rp ${Number(p.payable_amount).toLocaleString('id-ID')}</span>` : ''}
            </div>
            <button onclick="openAdminBuktiModal('${encodeURIComponent(JSON.stringify(p))}')" class="btn btn-outline btn-sm" style="border-color: #d4d4d8; color: #18181b; font-weight: 600;">
              <i class="fa-solid fa-receipt"></i> Detail
            </button>
          </td>
          <td>
            <span style="padding: 4px 8px; border-radius: 4px; font-weight: bold; font-size: 0.8rem; background: #f4f4f5; color: #18181b;">
              ${p.status.toUpperCase()}
            </span>
          </td>
          <td>
            ${p.status === 'pending' ? (isBendahara ? `
              <div style="display: flex; gap: 4px; flex-wrap: wrap;">
                <button onclick="confirmKas(${p.id}, 'lunas')" class="btn btn-primary btn-sm" style="background: #18181b;"><i class="fa-solid fa-check"></i> Lunas</button>
                <button onclick="confirmKas(${p.id}, 'ditolak')" class="btn btn-logout btn-sm"><i class="fa-solid fa-xmark"></i> Tolak</button>
              </div>
            ` : `<small class="text-muted">Menunggu Pembayaran</small>`) : `
              <small class="text-muted">
                ${p.confirmed_by ? `Manual oleh ${p.verifier ? p.verifier.nama_lengkap : 'Bendahara'}` : (p.ai_status === 'gateway_auto' ? 'Lunas Otomatis (Gateway)' : 'Terverifikasi Otomatis')}
              </small>
            `}
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
    clearApiCache('payments');
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

    const userStr = localStorage.getItem('iptek_user');
    const currentUser = userStr ? JSON.parse(userStr) : null;
    const isBendahara = currentUser && (currentUser.role === 'admin' || (currentUser.divisi && currentUser.divisi.toLowerCase().includes('bendahara')));

    const hasLegacyFile = p.proof_path && (p.proof_path.startsWith('/uploads') || p.proof_path.startsWith('http'));
    const legacyHtml = hasLegacyFile
      ? `<div style="text-align: center; margin-bottom: 1rem;"><a href="${p.proof_path}" target="_blank"><img src="${p.proof_path}" style="max-width: 100%; max-height: 40vh; object-fit: contain; border-radius: 6px; border: 1px solid #e4e4e7;" alt="Bukti Lama"></a></div>`
      : '';

    body.innerHTML = `
      ${legacyHtml}
      <div style="padding: 1rem; background: #f8f9fa; border-radius: 8px; border: 1px solid #e4e4e7; font-size: 0.88rem; color: #4b5563; line-height: 1.7;">
        <p style="margin: 0 0 6px 0;"><strong>Nama Anggota:</strong> ${p.user ? p.user.nama_lengkap : '-'}</p>
        <p style="margin: 0 0 6px 0;"><strong>Order ID:</strong> ${p.order_id || '-'}</p>
        <p style="margin: 0 0 6px 0;"><strong>Nominal Kas:</strong> Rp ${Number(p.amount).toLocaleString('id-ID')}</p>
        <p style="margin: 0 0 6px 0;"><strong>Nominal QRIS (dengan Kode Unik):</strong> ${p.payable_amount ? `Rp ${Number(p.payable_amount).toLocaleString('id-ID')} (Kode Unik: ${p.unique_code || 0})` : '-'}</p>
        <p style="margin: 0 0 6px 0;"><strong>Status:</strong> <strong style="color: #18181b;">${String(p.status || '').toUpperCase()}</strong></p>
        <p style="margin: 0;"><strong>Catatan Sistem:</strong> ${p.ai_notes || '-'}</p>
        ${isBendahara && p.status === 'pending' ? `
          <div style="margin-top: 12px; padding-top: 10px; border-top: 1px solid #e4e4e7; display: flex; gap: 8px; flex-wrap: wrap;">
            <button onclick="confirmKas(${p.id}, 'lunas'); closeAdminBuktiModal();" class="btn btn-primary btn-sm" style="background: #18181b;"><i class="fa-solid fa-check"></i> Konfirmasi Lunas Manual</button>
            <button onclick="confirmKas(${p.id}, 'ditolak'); closeAdminBuktiModal();" class="btn btn-logout btn-sm"><i class="fa-solid fa-xmark"></i> Tolak</button>
          </div>
        ` : ''}
      </div>
    `;
    modal.style.display = 'flex';
  } catch (err) {
    console.error('Error opening detail modal:', err);
  }
}

export function closeAdminBuktiModal() {
  const modal = document.getElementById('admin-bukti-modal');
  if (modal) modal.style.display = 'none';
}

export async function loadGatewayAdminPanel() {
  try {
    const res = await fetchAuth(`${API_BASE}/payments/gateway/info`, { noCache: true });
    const data = await res.json();
    if (data.status === 'success' && data.data) {
      const info = data.data;
      const urlEl = document.getElementById('gw-webhook-url');
      const secEl = document.getElementById('gw-webhook-secret-status');
      const metaEl = document.getElementById('gw-merchant-meta');

      if (urlEl) urlEl.textContent = info.webhook_url;
      if (secEl) {
        secEl.textContent = info.webhook_secret_configured
          ? `Aktif (${info.webhook_secret_masked})`
          : 'BELUM DIKONFIGURASI di .env (PAYMENT_WEBHOOK_SECRET)';
        secEl.style.color = info.webhook_secret_configured ? '#18181b' : '#ef4444';
      }
      if (metaEl) {
        metaEl.innerHTML = `
          <strong>${info.merchant_name}</strong><br>
          NMID: ${info.nmid}<br>
          <span>${info.is_umi ? 'QRIS UMI (0% MDR / Tanpa Potongan)' : 'QRIS Dinamis Aktif'} | Tagihan Pending Aktif: <strong>${info.active_pending_invoices}</strong></span>
        `;
      }
    }
  } catch (err) {
    console.error('Gagal memuat info gateway:', err);
  }

  await loadWebhookLogs();
}

export async function loadWebhookLogs() {
  const tbody = document.getElementById('table-webhook-logs');
  if (!tbody) return;
  try {
    const res = await fetchAuth(`${API_BASE}/payments/webhook/logs`, { noCache: true });
    const data = await res.json();
    const items = data.data || [];
    if (items.length === 0) {
      tbody.innerHTML = `<tr><td colspan="5" class="text-center">Belum ada mutasi webhook yang masuk.</td></tr>`;
    } else {
      tbody.innerHTML = items.map(log => {
        const dt = log.received_at ? new Date(log.received_at).toLocaleString('id-ID') : '-';
        const amt = log.detected_amount ? `Rp ${Number(log.detected_amount).toLocaleString('id-ID')}` : '-';
        return `
          <tr>
            <td><small>${dt}</small></td>
            <td><strong>${log.source_app || '-'}</strong><br><small class="text-muted">${log.raw_text || log.raw_title || '-'}</small></td>
            <td><strong>${amt}</strong></td>
            <td>${log.matched_order_id || '-'}</td>
            <td><span style="padding: 3px 8px; border-radius: 4px; font-weight: 700; font-size: 0.75rem; background: #f4f4f5; color: #18181b;">${String(log.status).toUpperCase()}</span></td>
          </tr>
        `;
      }).join('');
    }
  } catch (err) {
    console.error('Gagal memuat log webhook:', err);
  }
}

export async function saveQrisPayload(e) {
  e.preventDefault();
  const input = document.getElementById('qris-payload-input');
  const btn = document.getElementById('btn-save-qris-payload');
  const orig = btn.innerHTML;
  const payload = input ? input.value.trim() : '';
  if (!payload) return alert('Tempel string payload QRIS terlebih dahulu.');

  btn.disabled = true;
  btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Memvalidasi CRC16...`;

  try {
    const res = await fetchAuth(`${API_BASE}/qris/payload`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ qris_payload: payload })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || 'Gagal menyimpan payload QRIS');
    clearApiCache('qris');
    alert(data.message);
    input.value = '';
    loadQrisConfig();
    loadGatewayAdminPanel();
  } catch (err) {
    alert(`Error: ${err.message}`);
  } finally {
    btn.disabled = false;
    btn.innerHTML = orig;
  }
}

export function copyWebhookUrl() {
  const urlEl = document.getElementById('gw-webhook-url');
  if (!urlEl) return;
  navigator.clipboard.writeText(urlEl.textContent).then(() => {
    alert('URL Webhook berhasil disalin ke clipboard.');
  }).catch(() => {
    prompt('Salin URL Webhook ini:', urlEl.textContent);
  });
}

export async function testGatewayWebhook() {
  const input = prompt('Masukkan nominal mutasi simulasi (contoh: 10247) atau teks notifikasi DANA (contoh: Pembayaran QRIS sebesar Rp10.247 berhasil):');
  if (!input || !input.trim()) return;

  try {
    const res = await fetchAuth(`${API_BASE}/payments/webhook/test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: input.trim() })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || 'Simulasi gagal');
    clearApiCache('payments');
    alert(data.message);
    loadWebhookLogs();
    loadKasReport('');
  } catch (err) {
    alert(`Error: ${err.message}`);
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
      const rows = Object.values(summary).map((d, index) => [index + 1, d.nama, d.totalNominal, d.tahun].join(','));

      const csvContent = [headers.join(','), ...rows].join('\n');
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
    const res = await fetchAuth(`${API_BASE}/qris/config`, { noCache: true });
    const data = await res.json();
    if (data.status !== 'success') return;

    const cfg = data.data;
    const previewSrc = cfg.qris_preview_svg || cfg.qris_image_url;
    const imgHtml = previewSrc
      ? `<img src="${previewSrc}" alt="QRIS ${cfg.merchant_name}" style="max-width: 220px; width: 100%; height: auto; border-radius: 4px; background: #ffffff; padding: 6px;">`
      : `<div style="padding: 2rem 1rem; text-align: center;"><i class="fa-solid fa-qrcode" style="font-size: 3rem; color: #d4d4d8; margin-bottom: 0.5rem; display: block;"></i><p style="color: #71717a; font-size: 0.85rem; margin: 0;">QRIS belum dikonfigurasi.<br>Masukkan payload QRIS statis terlebih dahulu.</p></div>`;

    const adminPreview = document.getElementById('qris-preview-admin');
    if (adminPreview) adminPreview.innerHTML = imgHtml;
  } catch (err) {
    console.error('Gagal memuat konfigurasi QRIS:', err);
  }
}

export async function uploadQrisImage(e) {
  if (e && e.preventDefault) e.preventDefault();
}

export async function cleanupOldProofs() {
  if (!confirm('Bersihkan file bukti lama dari server untuk menghemat kapasitas penyimpanan? Status lunas dan riwayat database tetap aman.')) {
    return;
  }

  try {
    const res = await fetchAuth(`${API_BASE}/payments/cleanup-proofs`, { method: 'POST' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || 'Gagal membersihkan bukti lama');
    alert(data.message);
    loadKasReport('');
  } catch (err) {
    alert(`Error: ${err.message}`);
  }
}
