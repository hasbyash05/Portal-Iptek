import { fetchAuth, generateDeviceFingerprint } from './auth.js';
export const API_BASE = '/api';

export async function loadSessionStatus() {
  try {
    const res = await fetchAuth(`${API_BASE}/attendance/session/status`);
    const data = await res.json();
    const isActive = data.data && data.data.is_active;
    const attendanceMode = data.data ? data.data.attendance_mode : 'onsite';

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

    // Update mode toggle UI (hanya tampil untuk Ketua saat sesi aktif)
    const modeToggleWrap = document.getElementById('mode-toggle-wrap');
    const btnModeOnsite = document.getElementById('btn-mode-onsite');
    const btnModeAnywhere = document.getElementById('btn-mode-anywhere');
    if (modeToggleWrap) {
      const userStr = localStorage.getItem('iptek_user');
      const user = userStr ? JSON.parse(userStr) : null;
      const divisi = user && user.divisi ? user.divisi.toLowerCase() : '';
      const isKetua = (user && user.role === 'admin') || (user && user.role === 'pengurus' && divisi.includes('ketua') && !divisi.includes('wakil'));
      modeToggleWrap.style.display = (isActive && isKetua) ? 'flex' : 'none';
    }
    if (btnModeOnsite && btnModeAnywhere) {
      if (attendanceMode === 'onsite') {
        btnModeOnsite.classList.add('mode-active');
        btnModeAnywhere.classList.remove('mode-active');
      } else {
        btnModeAnywhere.classList.add('mode-active');
        btnModeOnsite.classList.remove('mode-active');
      }

      // Bind click handlers jika belum terikat
      if (!btnModeOnsite._boundMode) {
        btnModeOnsite._boundMode = true;
        btnModeOnsite.addEventListener('click', (e) => {
          e.preventDefault();
          setAttendanceMode('onsite');
        });
      }
      if (!btnModeAnywhere._boundMode) {
        btnModeAnywhere._boundMode = true;
        btnModeAnywhere.addEventListener('click', (e) => {
          e.preventDefault();
          setAttendanceMode('anywhere');
        });
      }
    }

    // Update mode indicator di sisi Pengurus
    const modeIndicator = document.getElementById('pengurus-mode-indicator');
    if (modeIndicator && isActive) {
      const modeLabel = attendanceMode === 'onsite' ? 'Di Tempat (GPS 100m)' : 'Dimana Saja';
      const modeIcon = attendanceMode === 'onsite' ? 'fa-location-dot' : 'fa-globe';
      modeIndicator.innerHTML = `
        <div style="display: inline-flex; align-items: center; gap: 0.5rem; background: #f4f4f5; border: 1px solid #e4e4e7; padding: 0.35rem 0.8rem; border-radius: 6px; font-size: 0.78rem; font-weight: 600; color: #18181b;">
          <i class="fa-solid ${modeIcon}"></i>
          <span>Mode: <strong>${modeLabel}</strong></span>
        </div>`;
      modeIndicator.style.display = 'block';
    } else if (modeIndicator) {
      modeIndicator.style.display = 'none';
    }

    // Update status di sisi Anggota
    const anggotaStatus = document.getElementById('anggota-session-status');
    const btnSubmit = document.getElementById('btn-submit-absensi');
    const anggotaModeInfo = document.getElementById('anggota-mode-info');

    if (anggotaStatus) {
      if (isActive) {
        const activator = data.data.session && data.data.session.activator ? data.data.session.activator.nama_lengkap : 'Pengurus';
        anggotaStatus.style.padding = '0';
        anggotaStatus.style.background = 'transparent';
        anggotaStatus.innerHTML = `
          <div style="display: flex; align-items: center; gap: 0.85rem; padding: 0.9rem 1.15rem; background: #ffffff; border: 1px solid #e4e4e7; border-left: 4px solid #18181b; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.03);">
            <div style="width: 36px; height: 36px; border-radius: 6px; background: #f4f4f5; display: flex; align-items: center; justify-content: center; flex-shrink: 0; color: #18181b; font-size: 1rem;">
              <i class="fa-solid fa-lock-open"></i>
            </div>
            <div>
              <p style="margin: 0; font-size: 0.92rem; font-weight: 700; color: #18181b; font-family: 'Outfit', sans-serif;">Sesi Presensi Sedang Dibuka</p>
              <p style="margin: 0; font-size: 0.82rem; color: #71717a;">Dibuka oleh <strong>${activator}</strong>. Anda dapat mengirimkan presensi sekarang.</p>
            </div>
          </div>`;
      } else {
        anggotaStatus.style.padding = '0';
        anggotaStatus.style.background = 'transparent';
        anggotaStatus.innerHTML = `
          <div style="display: flex; align-items: center; gap: 0.85rem; padding: 0.9rem 1.15rem; background: #ffffff; border: 1px solid #e4e4e7; border-left: 4px solid #a1a1aa; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.03);">
            <div style="width: 36px; height: 36px; border-radius: 6px; background: #f4f4f5; display: flex; align-items: center; justify-content: center; flex-shrink: 0; color: #71717a; font-size: 1rem;">
              <i class="fa-solid fa-lock"></i>
            </div>
            <div>
              <p style="margin: 0; font-size: 0.92rem; font-weight: 700; color: #18181b; font-family: 'Outfit', sans-serif;">Sesi Presensi Ditutup</p>
              <p style="margin: 0; font-size: 0.82rem; color: #71717a;">Silakan menunggu Pengurus membuka sesi presensi pertemuan hari ini.</p>
            </div>
          </div>`;
      }
    }

    // Update info mode & panduan dinamis di sisi anggota
    if (anggotaModeInfo) {
      if (isActive) {
        if (attendanceMode === 'onsite') {
          anggotaModeInfo.innerHTML = `
            <div class="mode-card-badge">
              <div class="mode-card-icon">
                <i class="fa-solid fa-location-dot"></i>
              </div>
              <div class="mode-card-content">
                <div class="mode-card-header">
                  <h5 class="mode-card-title">Mode: Di Tempat</h5>
                  <span class="mode-pill-badge">GPS Radius 100M</span>
                </div>
                <p class="mode-card-desc">Anda wajib berada dalam radius maksimal 100 meter dari titik koordinat pertemuan untuk mencatatkan kehadiran.</p>
                <div class="mode-card-meta">
                  <span><i class="fa-solid fa-crosshairs"></i> Radius Maks: 100m</span>
                  <span><i class="fa-solid fa-location-crosshairs"></i> Deteksi Koordinat Aktif</span>
                </div>
              </div>
            </div>`;
        } else {
          anggotaModeInfo.innerHTML = `
            <div class="mode-card-badge">
              <div class="mode-card-icon">
                <i class="fa-solid fa-globe"></i>
              </div>
              <div class="mode-card-content">
                <div class="mode-card-header">
                  <h5 class="mode-card-title">Mode: Dimana Saja</h5>
                  <span class="mode-pill-badge">Akses Jarak Jauh</span>
                </div>
                <p class="mode-card-desc">Ketua UKM mengaktifkan mode presensi jarak jauh. Anda dapat mencatatkan presensi dari lokasi manapun tanpa batasan radius GPS.</p>
                <div class="mode-card-meta">
                  <span style="color: #18181b; font-weight: 600;"><i class="fa-solid fa-circle-check"></i> Bebas Radius GPS</span>
                  <span><i class="fa-solid fa-laptop"></i> Presensi Mandiri</span>
                </div>
              </div>
            </div>`;
        }
        anggotaModeInfo.style.display = 'block';
      } else {
        anggotaModeInfo.style.display = 'none';
      }
    }

    // Update teks ketentuan & pilihan dropdown sesuai mode
    const ketentuanTitle = document.getElementById('ketentuan-title');
    const ketentuanDesc = document.getElementById('ketentuan-desc');
    const selectStatusAbsen = document.getElementById('anggota-status-absen');

    if (attendanceMode === 'anywhere') {
      if (ketentuanTitle) ketentuanTitle.textContent = 'Presensi Bebas Lokasi (Dimana Saja)';
      if (ketentuanDesc) {
        ketentuanDesc.innerHTML = 'Sesi pertemuan saat ini dibuka dalam <strong style="color: #18181b;">Mode Dimana Saja</strong> oleh Ketua UKM. Anda dapat langsung mengirimkan absensi secara fleksibel tanpa verifikasi radius jarak GPS.';
      }
      if (selectStatusAbsen) {
        selectStatusAbsen.innerHTML = '<option value="hadir">Hadir (Presensi Dimana Saja)</option>';
      }
    } else {
      if (ketentuanTitle) ketentuanTitle.textContent = 'Verifikasi GPS (Maks. 100 Meter)';
      if (ketentuanDesc) {
        ketentuanDesc.innerHTML = 'Presensi dibuka dalam <strong style="color: #18181b;">Mode Di Tempat</strong>. Sistem secara otomatis memeriksa GPS, Anda harus berada dalam radius maksimal <strong style="color: #18181b;">100 meter</strong> dari titik pertemuan.';
      }
      if (selectStatusAbsen) {
        selectStatusAbsen.innerHTML = '<option value="hadir">Hadir (Verifikasi GPS Radius 100m)</option>';
      }
    }

    if (btnSubmit) btnSubmit.disabled = !isActive;

    // Simpan mode ke window agar bisa diakses saat submit
    window._attendanceMode = attendanceMode;

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

export async function setAttendanceMode(mode) {
  try {
    // Instant UI feedback
    const btnModeOnsite = document.getElementById('btn-mode-onsite');
    const btnModeAnywhere = document.getElementById('btn-mode-anywhere');
    if (btnModeOnsite && btnModeAnywhere) {
      if (mode === 'onsite') {
        btnModeOnsite.classList.add('mode-active');
        btnModeAnywhere.classList.remove('mode-active');
      } else {
        btnModeAnywhere.classList.add('mode-active');
        btnModeOnsite.classList.remove('mode-active');
      }
    }

    const res = await fetchAuth(`${API_BASE}/attendance/session/mode`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || 'Gagal mengubah mode presensi');
    alert(data.message);
    loadSessionStatus();
  } catch (err) {
    alert(`Error: ${err.message}`);
    loadSessionStatus();
  }
}
window.setAttendanceMode = setAttendanceMode;

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

  const submitBtn = e.target.querySelector('button[type="submit"]');
  const originalText = submitBtn ? submitBtn.textContent : 'Kirim Presensi Sekarang';
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = 'Memproses Presensi...';
  }

  try {
    const currentMode = window._attendanceMode || 'onsite';
    let latitude = null;
    let longitude = null;

    if (currentMode === 'onsite') {
      // Mode Di Tempat: wajib GPS
      if (!navigator.geolocation) {
        alert('Error: Browser HP Anda tidak mendukung fitur Geolocation atau memblokirnya karena akses lewat jaringan lokal HTTP tanpa enkripsi (HTTPS).');
        return;
      }

      if (submitBtn) submitBtn.textContent = 'Memeriksa Lokasi GPS...';

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

      latitude = position.coords.latitude;
      longitude = position.coords.longitude;

      // Titik koordinat pertemuan: 7\u00b002'02.4"S 110\u00b022'07.8"E
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
    }
    // Mode Dimana Saja: tidak perlu GPS

    if (submitBtn) submitBtn.textContent = 'Mengirim Presensi...';

    const fingerprint = await generateDeviceFingerprint();
    const bodyPayload = { status, device_fingerprint: fingerprint };
    if (latitude !== null && longitude !== null) {
      bodyPayload.latitude = latitude;
      bodyPayload.longitude = longitude;
    }

    const res = await fetchAuth(`${API_BASE}/attendance`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(bodyPayload)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || 'Gagal mencatat presensi');

    if (currentMode === 'onsite') {
      // Hitung distance untuk pesan
      const targetLat = -7.034000;
      const targetLon = 110.36883333333333;
      const toRad = (value) => (value * Math.PI) / 180;
      const R = 6371000;
      const dLat = toRad(targetLat - latitude);
      const dLon = toRad(targetLon - longitude);
      const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(toRad(latitude)) * Math.cos(toRad(targetLat)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      const distance = R * c;
      alert(`Presensi hari ini berhasil dicatat dengan status: ${status.toUpperCase()} (Terverifikasi dalam radius ${distance.toFixed(1)} meter dari titik pertemuan)`);
    } else {
      alert(`Presensi hari ini berhasil dicatat dengan status: ${status.toUpperCase()} (Mode: Dimana Saja)`);
    }
    loadAnggotaAttendance();
  } catch (err) {
    let msg = err.message;
    if (err.code === 1) {
      if (window.location.protocol === 'http:' && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
        msg = `Browser HP memblokir pop-up izin lokasi karena Anda mengakses lewat IP LAN HTTP (${window.location.origin}) tanpa HTTPS.

CARA AGAR HP BISA IZIN LOKASI DI CHROME:
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
    alert(`PEMBERITAHUAN LOKASI:\n\n${msg}`);
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
