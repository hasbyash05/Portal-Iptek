import { fetchAuth, generateDeviceFingerprint } from './auth.js';
export const API_BASE = '/api';

export async function loadSessionStatus() {
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

export async function toggleSession(action) {
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

export async function loadPengurusAbsensi(query = '') {
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

export function filterAbsensi(e) {
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

export async function submitAbsensiAnggota(e) {
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
        msg = `Browser HP memblokir pop-up izin lokasi karena Anda mengakses lewat IP LAN HTTP (${window.location.origin}) tanpa HTTPS.

🛠️ CARA AGAR HP BISA IZIN LOKASI DI CHROME:
1. Buka tab baru di Chrome HP, ketik: chrome://flags
2. Cari di kolom search: Insecure origins treated as secure
3. Ubah jadi ENABLED, lalu isi kolom dengan: ${window.location.origin}
4. Klik tombol Relaunch di bawah layar HP.
5. Setelah Chrome restart, klik presensi lagi. HP akan memunculkan izin lokasi!`;
      } else {
        msg = 'Anda menolak izin akses lokasi (GPS) di HP. Silakan klik ikon gembok/pengaturan di samping alamat web pada browser HP Anda, lalu aktifkan izin Lokasi (Location).';
      }
    }
    else if (err.code === 2) msg = 'Sinyal GPS tidak ditemukan oleh perangkat HP Anda. Pastikan fitur Lokasi/GPS di HP Anda dalam keadaan aktif.';
    else if (err.code === 3) msg = 'Waktu pencarian sinyal GPS habis (timeout). Sinyal satelit terhalang gedung/ruangan. Coba lagi di dekat jendela atau area terbuka.';
    alert(`PEMBERITAHUAN LOKASI:

${msg}`);
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = originalText;
    }
  }
}

export async function loadAnggotaAttendance() {
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

