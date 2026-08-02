import { fetchAuth, logout, checkAuth } from './auth.js';
import { loadPengurusOverview, loadAnggotaOverview, loadPengurusLaporan, loadAnggotaList } from './dashboard.js';
import { loadAnggotaMateri, loadPengurusMateri } from './academic.js';
import { loadAnggotaAttendance, loadSessionStatus, loadPengurusAbsensi } from './attendance.js';
import { loadAnggotaKas, loadKasReport, loadExpenses, loadQrisConfig } from './finance.js';

export const API_BASE = '/api';

export function showView(viewId) {
  document.querySelectorAll('.view-section').forEach(sec => sec.classList.remove('active'));
  document.querySelectorAll('.view-section').forEach(sec => sec.style.display = 'none');
  const activeSec = document.getElementById(viewId);
  if (activeSec) {
    activeSec.style.display = 'block';
    activeSec.classList.add('active');
  }
}

export function toggleMobileMenu(open) {
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

export function toggleAccountMenu(e) {
  if (e) {
    e.preventDefault();
    e.stopPropagation();
  }
  const item = document.getElementById('nav-item-akun');
  if (item) {
    item.classList.toggle('active');
  }
}

export function switchNavTab(tabName, fromHash = false) {
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

export function switchTab(tabName, user) {
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
    if (isBendahara) {
      loadKasReport('');
      loadExpenses();
    }
  }
  if (tabName === 'anggota' && isPengurusOrAdmin) loadAnggotaList();
}

export function switchAnggotaTab(tabName) {
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

export async function checkKasAndUnlockAttendance() {
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

