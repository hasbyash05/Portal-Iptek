import { fetchAuth } from './auth.js';

export const API_BASE = '/api';

let currentElection = null;
let currentCandidates = [];
let hasVoted = false;
let userVotedAt = null;
let selectedCandidateForVote = null;
let barChartInstance = null;
let donutChartInstance = null;
let autoRefreshTimer = null;
let votersAuditData = [];

// ==========================================
// SUBTAB SWITCHING
// ==========================================
export function switchPemiluSubtab(subtabName) {
  const tabs = ['bilik', 'monitoring', 'panitia'];
  tabs.forEach(t => {
    const el = document.getElementById(`pemilu-subtab-${t}`);
    const btn = document.getElementById(`pemilu-tab-btn-${t}`);
    if (el) el.style.display = (t === subtabName) ? 'block' : 'none';
    if (btn) {
      if (t === subtabName) {
        btn.classList.add('active');
        btn.style.color = '#18181b';
        btn.style.borderBottom = '2px solid #18181b';
        btn.style.fontWeight = '700';
      } else {
        btn.classList.remove('active');
        btn.style.color = '#71717a';
        btn.style.borderBottom = '2px solid transparent';
        btn.style.fontWeight = '500';
      }
    }
  });

  if (subtabName === 'bilik') {
    loadElectionData();
    stopAutoRefresh();
  } else if (subtabName === 'monitoring') {
    loadMonitoringData();
    startAutoRefresh();
  } else if (subtabName === 'panitia') {
    loadPanitiaData();
    stopAutoRefresh();
  }
}

function startAutoRefresh() {
  stopAutoRefresh();
  // Refresh data monitoring setiap 15 detik jika subtab monitoring aktif
  autoRefreshTimer = setInterval(() => {
    const monitoringEl = document.getElementById('pemilu-subtab-monitoring');
    if (monitoringEl && monitoringEl.style.display !== 'none') {
      loadMonitoringData(true);
    } else {
      stopAutoRefresh();
    }
  }, 15000);
}

function stopAutoRefresh() {
  if (autoRefreshTimer) {
    clearInterval(autoRefreshTimer);
    autoRefreshTimer = null;
  }
}

// ==========================================
// 1. BILIK SUARA (PEMILIH)
// ==========================================
export async function loadElectionData() {
  const container = document.getElementById('candidates-grid');
  const banner = document.getElementById('voter-status-banner');
  const titleEl = document.getElementById('election-title-display');
  const periodeEl = document.getElementById('election-periode-display');
  const descEl = document.getElementById('election-desc-display');

  if (!container) return;

  try {
    container.innerHTML = `
      <div style="grid-column: 1 / -1; text-align: center; padding: 3rem 1rem; color: #71717a;">
        <i class="fa-solid fa-spinner fa-spin" style="font-size: 1.8rem; margin-bottom: 0.8rem; display: block;"></i>
        Memuat data bilik suara pemilihan...
      </div>
    `;

    const res = await fetchAuth(`${API_BASE}/elections/active`);
    const result = await res.json();

    if (result.status !== 'success' || !result.data) {
      container.innerHTML = `
        <div style="grid-column: 1 / -1; text-align: center; padding: 2.5rem 1rem; color: #dc2626; background: #fef2f2; border-radius: 8px;">
          <i class="fa-solid fa-triangle-exclamation" style="font-size: 1.5rem; margin-bottom: 0.5rem; display: block;"></i>
          ${result.message || 'Gagal memuat pemilihan.'}
        </div>
      `;
      return;
    }

    const { election, candidates, hasVoted: userHasVoted, votedAt } = result.data;
    currentElection = election;
    currentCandidates = candidates || [];
    hasVoted = !!userHasVoted;
    userVotedAt = votedAt;

    // Update Header Pemilihan
    if (titleEl) titleEl.textContent = election.judul || 'Pemilihan Calon Ketua Umum UKM IPTEK';
    if (periodeEl) periodeEl.textContent = `Periode ${election.periode || '2026/2027'}`;
    if (descEl) descEl.textContent = election.deskripsi || 'Sistem e-voting terpadu UKM IPTEK STIKES Semarang.';

    // Update Panitia Subtab Visibility (Hanya untuk Pengurus & Admin)
    const userStr = localStorage.getItem('iptek_user');
    const user = userStr ? JSON.parse(userStr) : null;
    const isPanitia = user && (user.role === 'admin' || user.role === 'pengurus');
    const panitiaTabBtn = document.getElementById('pemilu-tab-btn-panitia');
    if (panitiaTabBtn) {
      panitiaTabBtn.style.display = isPanitia ? 'inline-block' : 'none';
    }

    // Render Status Banner
    renderVoterBanner(banner, election, hasVoted, userVotedAt);

    // Render Daftar Calon
    renderCandidates(container, currentCandidates, election, hasVoted);

  } catch (err) {
    console.error('loadElectionData error:', err);
    if (container) {
      container.innerHTML = `
        <div style="grid-column: 1 / -1; text-align: center; padding: 2.5rem 1rem; color: #dc2626; background: #fef2f2; border-radius: 8px;">
          Terjadi kesalahan koneksi saat memuat data bilik suara.
        </div>
      `;
    }
  }
}

function renderVoterBanner(bannerEl, election, userVoted, votedAt) {
  if (!bannerEl) return;

  const isClosed = election.status === 'closed';
  const isDraft = election.status === 'draft';

  if (isClosed) {
    bannerEl.innerHTML = `
      <div style="background: #ffffff; border: 1px solid #e4e4e7; border-left: 4px solid #18181b; border-radius: 8px; padding: 1.25rem 1.5rem; margin-bottom: 2rem; display: flex; align-items: center; justify-content: space-between; gap: 1rem; flex-wrap: wrap; box-shadow: 0 1px 3px rgba(0,0,0,0.04);">
        <div style="display: flex; align-items: center; gap: 1rem;">
          <div style="width: 44px; height: 44px; border-radius: 8px; background: #18181b; color: #ffffff; display: flex; align-items: center; justify-content: center; font-size: 1.2rem; flex-shrink: 0;">
            <i class="fa-solid fa-lock"></i>
          </div>
          <div>
            <h4 style="margin: 0; font-size: 1rem; color: #18181b; font-weight: 700;">Pemilihan Resmi Ditutup</h4>
            <p style="margin: 2px 0 0 0; font-size: 0.85rem; color: #71717a;">Periode pemungutan suara telah berakhir. Silakan lihat hasil akhir dan penetapan pemenang di tab Monitoring Suara.</p>
          </div>
        </div>
        <button onclick="switchPemiluSubtab('monitoring')" class="btn btn-outline" style="border-color: #18181b; color: #18181b; font-size: 0.85rem; padding: 0.5rem 1rem;">
          <i class="fa-solid fa-chart-column"></i> Lihat Hasil Akhir
        </button>
      </div>
    `;
    return;
  }

  if (isDraft) {
    bannerEl.innerHTML = `
      <div style="background: #ffffff; border: 1px solid #e4e4e7; border-left: 4px solid #71717a; border-radius: 8px; padding: 1.25rem 1.5rem; margin-bottom: 2rem; display: flex; align-items: center; gap: 1rem; box-shadow: 0 1px 3px rgba(0,0,0,0.04);">
        <div style="width: 44px; height: 44px; border-radius: 8px; background: #f4f4f5; color: #18181b; display: flex; align-items: center; justify-content: center; font-size: 1.2rem; flex-shrink: 0;">
          <i class="fa-solid fa-hourglass-start"></i>
        </div>
        <div>
          <h4 style="margin: 0; font-size: 1rem; color: #18181b; font-weight: 700;">Pemilihan Masih Dalam Tahap Persiapan</h4>
          <p style="margin: 2px 0 0 0; font-size: 0.85rem; color: #71717a;">Panitia pemilihan belum membuka bilik suara. Pemungutan suara akan dimulai segera setelah jadwal diumumkan.</p>
        </div>
      </div>
    `;
    return;
  }

  if (userVoted) {
    const formattedDate = votedAt ? new Date(votedAt).toLocaleString('id-ID', {
      timeZone: 'Asia/Jakarta',
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    }) : 'Waktu tercatat';

    bannerEl.innerHTML = `
      <div style="background: #ffffff; border: 1px solid #e4e4e7; border-left: 4px solid #18181b; border-radius: 8px; padding: 1.25rem 1.5rem; margin-bottom: 2rem; display: flex; align-items: center; justify-content: space-between; gap: 1rem; flex-wrap: wrap; box-shadow: 0 1px 3px rgba(0,0,0,0.04);">
        <div style="display: flex; align-items: center; gap: 1rem;">
          <div style="width: 44px; height: 44px; border-radius: 8px; background: #18181b; color: #ffffff; display: flex; align-items: center; justify-content: center; font-size: 1.2rem; flex-shrink: 0;">
            <i class="fa-solid fa-check"></i>
          </div>
          <div>
            <div style="display: flex; align-items: center; gap: 0.5rem; margin-bottom: 2px;">
              <h4 style="margin: 0; font-size: 1rem; color: #18181b; font-weight: 700;">Hak Suara Anda Telah Digunakan</h4>
              <span style="font-size: 0.7rem; font-weight: 700; background: #f4f4f5; color: #18181b; border: 1px solid #e4e4e7; padding: 2px 8px; border-radius: 4px; text-transform: uppercase;">1 Akun 1 Suara Sah</span>
            </div>
            <p style="margin: 0; font-size: 0.85rem; color: #71717a;">
              Tercatat pada ${formattedDate} WIB. Pilihan Anda dijamin rahasia dan telah masuk ke dalam rekapitulasi sistem.
            </p>
          </div>
        </div>
        <button onclick="switchPemiluSubtab('monitoring')" class="btn btn-outline" style="border-color: #18181b; color: #18181b; font-size: 0.85rem; padding: 0.5rem 1.1rem;">
          <i class="fa-solid fa-chart-column"></i> Pantau Live Count
        </button>
      </div>
    `;
  } else {
    bannerEl.innerHTML = `
      <div style="background: #ffffff; border: 1px solid #e4e4e7; border-left: 4px solid #18181b; border-radius: 8px; padding: 1.25rem 1.5rem; margin-bottom: 2rem; display: flex; align-items: center; gap: 1rem; box-shadow: 0 1px 3px rgba(0,0,0,0.04);">
        <div style="width: 44px; height: 44px; border-radius: 8px; background: #18181b; color: #ffffff; display: flex; align-items: center; justify-content: center; font-size: 1.2rem; flex-shrink: 0;">
          <i class="fa-solid fa-check-to-slot"></i>
        </div>
        <div style="flex: 1;">
          <div style="display: flex; align-items: center; gap: 0.5rem; margin-bottom: 2px;">
            <h4 style="margin: 0; font-size: 1rem; color: #18181b; font-weight: 700;">Bilik Pemilihan Dibuka</h4>
            <span style="font-size: 0.7rem; font-weight: 700; background: #f4f4f5; color: #18181b; border: 1px solid #e4e4e7; padding: 2px 8px; border-radius: 4px; text-transform: uppercase;">Belum Memberikan Suara</span>
          </div>
          <p style="margin: 0; font-size: 0.85rem; color: #71717a;">
            Setiap akun terdaftar berhak memberikan 1 suara sah. Pelajari visi, misi, dan program kerja para calon sebelum menetapkan pilihan Anda.
          </p>
        </div>
      </div>
    `;
  }
}

function renderCandidates(container, candidates, election, userVoted) {
  if (!candidates || candidates.length === 0) {
    container.innerHTML = `
      <div style="grid-column: 1 / -1; text-align: center; padding: 3rem 1rem; background: #ffffff; border: 1px solid #e4e4e7; border-radius: 8px;">
        <i class="fa-solid fa-users-slash" style="font-size: 2rem; color: #a1a1aa; margin-bottom: 0.8rem; display: block;"></i>
        <h4 style="color: #18181b; margin-bottom: 0.4rem; font-size: 1.1rem;">Belum Ada Calon Terdaftar</h4>
        <p style="color: #71717a; font-size: 0.9rem; max-width: 480px; margin: 0 auto;">Panitia pemilihan belum mendaftarkan calon ketua umum. Silakan cek kembali nanti atau hubungi panitia pemilihan.</p>
      </div>
    `;
    return;
  }

  const isVotingActive = election.status === 'active' && !userVoted;

  const html = candidates.map(c => {
    const numDisplay = String(c.nomor_urut).padStart(2, '0');
    const photoHtml = c.foto_url 
      ? `<img src="${c.foto_url}" alt="Foto Calon ${c.nama_calon}" style="width: 100%; height: 260px; object-fit: cover; border-radius: 8px 8px 0 0; background: #f4f4f5;">`
      : `<div style="width: 100%; height: 260px; background: #f4f4f5; border-radius: 8px 8px 0 0; display: flex; flex-direction: column; align-items: center; justify-content: center; color: #a1a1aa;">
           <i class="fa-solid fa-user-tie" style="font-size: 4rem; margin-bottom: 0.5rem; color: #71717a;"></i>
           <span style="font-size: 0.8rem; font-weight: 500;">Foto Belum Diunggah</span>
         </div>`;

    const buttonHtml = isVotingActive
      ? `<button onclick="openVoteConfirmModal(${c.id})" class="btn btn-primary" style="width: 100%; justify-content: center; padding: 0.75rem 1rem; font-size: 0.95rem; font-weight: 700; margin-top: 0.75rem; background: #18181b; color: #ffffff;">
           <i class="fa-solid fa-check-to-slot"></i> Beri Suara untuk No. ${numDisplay}
         </button>`
      : userVoted
        ? `<button disabled class="btn btn-outline" style="width: 100%; justify-content: center; padding: 0.7rem 1rem; font-size: 0.85rem; margin-top: 0.75rem; background: #f4f4f5; color: #a1a1aa; border-color: #e4e4e7; cursor: not-allowed;">
             <i class="fa-solid fa-check"></i> Suara Telah Digunakan
           </button>`
        : `<button disabled class="btn btn-outline" style="width: 100%; justify-content: center; padding: 0.7rem 1rem; font-size: 0.85rem; margin-top: 0.75rem; background: #f4f4f5; color: #a1a1aa; border-color: #e4e4e7; cursor: not-allowed;">
             <i class="fa-solid fa-lock"></i> Pemilihan Tidak Aktif
           </button>`;

    // Potongan visi untuk preview singkat
    const visiSnippet = c.visi && c.visi.length > 120 ? c.visi.substring(0, 120) + '...' : (c.visi || 'Visi belum diisi.');

    return `
      <div class="card" style="border: none; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.05); background: #ffffff; display: flex; flex-direction: column; overflow: hidden; position: relative;">
        <!-- Nomor Urut Badge -->
        <div style="position: absolute; top: 12px; left: 12px; background: #18181b; color: #ffffff; font-family: 'Outfit', sans-serif; font-size: 1.1rem; font-weight: 800; padding: 0.25rem 0.75rem; border-radius: 6px; z-index: 2; box-shadow: 0 2px 6px rgba(0,0,0,0.2);">
          ${numDisplay}
        </div>

        ${photoHtml}

        <div style="padding: 1.5rem; display: flex; flex-direction: column; flex-grow: 1;">
          <div style="margin-bottom: 0.75rem;">
            <div style="font-size: 0.75rem; font-weight: 700; color: #71717a; text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 2px;">
              Calon Ketua Umum
            </div>
            <h3 style="font-family: 'Outfit', sans-serif; font-size: 1.3rem; font-weight: 800; color: #18181b; margin: 0 0 4px 0; line-height: 1.3;">
              ${escapeHtml(c.nama_calon)}
            </h3>
            ${(c.nim || c.prodi) ? `
              <div style="font-size: 0.8rem; color: #71717a; font-weight: 500;">
                ${c.nim ? escapeHtml(c.nim) : ''} ${c.nim && c.prodi ? '&bull;' : ''} ${c.prodi ? escapeHtml(c.prodi) : ''}
              </div>
            ` : ''}
          </div>

          <!-- Cuplikan Visi -->
          <div style="margin: 0.5rem 0 1rem 0; flex-grow: 1;">
            <span style="font-size: 0.75rem; font-weight: 700; color: #18181b; text-transform: uppercase; letter-spacing: 0.05em; display: block; margin-bottom: 3px;">
              Visi Utama:
            </span>
            <p style="font-size: 0.88rem; color: #4b5563; line-height: 1.55; margin: 0;">
              ${escapeHtml(visisnippet)}
            </p>
          </div>

          <div style="border-top: 1px solid #f4f4f5; padding-top: 1rem; margin-top: auto;">
            <button type="button" onclick="openCandidateDetailModal(${c.id})" class="btn btn-outline" style="width: 100%; justify-content: center; padding: 0.55rem 0.8rem; font-size: 0.85rem; border-color: #e4e4e7; color: #18181b;">
              <i class="fa-solid fa-file-lines"></i> Pelajari Visi & Misi Lengkap
            </button>
            ${buttonHtml}
          </div>
        </div>
      </div>
    `;
  }).join('');

  container.innerHTML = html;
}

// ==========================================
// MODAL DETAIL VISI & MISI
// ==========================================
export function openCandidateDetailModal(candidateId) {
  const candidate = currentCandidates.find(c => c.id === candidateId);
  if (!candidate) return;

  const modal = document.getElementById('modal-candidate-detail');
  const body = document.getElementById('modal-candidate-detail-body');
  if (!modal || !body) return;

  const numDisplay = String(candidate.nomor_urut).padStart(2, '0');

  // Format misi menjadi list teratur
  const misiLines = candidate.misi 
    ? candidate.misi.split('\n').filter(line => line.trim().length > 0)
    : [];

  const misiHtml = misiLines.length > 0
    ? `<ul style="padding-left: 1.25rem; margin: 0; font-size: 0.9rem; color: #4b5563; line-height: 1.7;">
         ${misiLines.map(line => `<li>${escapeHtml(line.replace(/^[-*•\d.]\s*/, ''))}</li>`).join('')}
       </ul>`
    : `<p style="font-size: 0.9rem; color: #71717a; margin: 0;">Misi belum diisi.</p>`;

  body.innerHTML = `
    <div style="display: flex; gap: 1.5rem; align-items: flex-start; margin-bottom: 1.5rem; border-bottom: 1px solid #f4f4f5; padding-bottom: 1.5rem; flex-wrap: wrap;">
      ${candidate.foto_url 
        ? `<img src="${candidate.foto_url}" alt="Foto ${candidate.nama_calon}" style="width: 120px; height: 140px; object-fit: cover; border-radius: 8px; background: #f4f4f5; flex-shrink: 0;">`
        : `<div style="width: 120px; height: 140px; background: #f4f4f5; border-radius: 8px; display: flex; align-items: center; justify-content: center; color: #a1a1aa; flex-shrink: 0;">
             <i class="fa-solid fa-user-tie" style="font-size: 3rem;"></i>
           </div>`
      }
      <div style="flex: 1; min-width: 200px;">
        <div style="display: inline-block; background: #18181b; color: #ffffff; font-family: 'Outfit', sans-serif; font-size: 0.85rem; font-weight: 800; padding: 0.2rem 0.6rem; border-radius: 4px; margin-bottom: 0.4rem;">
          NOMOR URUT ${numDisplay}
        </div>
        <h2 style="font-family: 'Outfit', sans-serif; font-size: 1.4rem; font-weight: 800; color: #18181b; margin: 0 0 4px 0;">
          ${escapeHtml(candidate.nama_calon)}
        </h2>
        <div style="font-size: 0.85rem; color: #71717a;">
          ${candidate.nim ? `NIM: ${escapeHtml(candidate.nim)}` : ''} 
          ${candidate.nim && candidate.prodi ? '&bull;' : ''}
          ${candidate.prodi ? escapeHtml(candidate.prodi) : ''}
        </div>
      </div>
    </div>

    <!-- Visi -->
    <div style="margin-bottom: 1.5rem;">
      <h4 style="font-family: 'Outfit', sans-serif; font-size: 0.85rem; font-weight: 800; color: #18181b; text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 0.5rem;">
        Visi Calon Ketua Umum
      </h4>
      <div style="background: #f8f9fa; padding: 1rem 1.25rem; border-radius: 6px; font-size: 0.92rem; color: #18181b; line-height: 1.65; border-left: 3px solid #18181b;">
        ${escapeHtml(candidate.visi || '-')}
      </div>
    </div>

    <!-- Misi -->
    <div style="margin-bottom: 1.5rem;">
      <h4 style="font-family: 'Outfit', sans-serif; font-size: 0.85rem; font-weight: 800; color: #18181b; text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 0.5rem;">
        Misi & Program Aksi
      </h4>
      <div style="background: #ffffff; border: 1px solid #e4e4e7; padding: 1rem 1.25rem; border-radius: 6px;">
        ${misiHtml}
      </div>
    </div>

    <!-- Program Unggulan -->
    ${candidate.program_unggulan ? `
      <div style="margin-bottom: 1rem;">
        <h4 style="font-family: 'Outfit', sans-serif; font-size: 0.85rem; font-weight: 800; color: #18181b; text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 0.5rem;">
          Program Kerja Unggulan / Gagasan Utama
        </h4>
        <div style="background: #f8f9fa; padding: 1rem 1.25rem; border-radius: 6px; font-size: 0.9rem; color: #4b5563; line-height: 1.65;">
          ${escapeHtml(candidate.program_unggulan).replace(/\n/g, '<br>')}
        </div>
      </div>
    ` : ''}
  `;

  modal.style.display = 'flex';
}

export function closeCandidateDetailModal() {
  const modal = document.getElementById('modal-candidate-detail');
  if (modal) modal.style.display = 'none';
}

// ==========================================
// MODAL KONFIRMASI SUARA
// ==========================================
export function openVoteConfirmModal(candidateId) {
  const candidate = currentCandidates.find(c => c.id === candidateId);
  if (!candidate) return;

  selectedCandidateForVote = candidate;
  const modal = document.getElementById('modal-vote-confirm');
  const body = document.getElementById('modal-vote-confirm-body');
  if (!modal || !body) return;

  const numDisplay = String(candidate.nomor_urut).padStart(2, '0');

  body.innerHTML = `
    <div style="text-align: center; padding: 1rem 0;">
      <div style="width: 80px; height: 80px; border-radius: 50%; background: #18181b; color: #ffffff; display: inline-flex; align-items: center; justify-content: center; font-size: 2rem; margin-bottom: 1rem; box-shadow: 0 4px 10px rgba(0,0,0,0.15);">
        <i class="fa-solid fa-check-to-slot"></i>
      </div>
      <h3 style="font-family: 'Outfit', sans-serif; font-size: 1.35rem; font-weight: 800; color: #18181b; margin-bottom: 0.5rem;">
        Konfirmasi Pilihan Suara
      </h3>
      <p style="font-size: 0.9rem; color: #71717a; margin-bottom: 1.5rem;">
        Anda akan memberikan 1 suara sah Anda untuk calon ketua umum berikut:
      </p>

      <div style="background: #f8f9fa; border: 1px solid #e4e4e7; border-radius: 8px; padding: 1.25rem; margin-bottom: 1.5rem; text-align: left; display: flex; align-items: center; gap: 1rem;">
        <div style="background: #18181b; color: #ffffff; font-family: 'Outfit', sans-serif; font-size: 1.3rem; font-weight: 800; width: 48px; height: 48px; border-radius: 8px; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">
          ${numDisplay}
        </div>
        <div>
          <div style="font-size: 0.75rem; font-weight: 700; color: #71717a; text-transform: uppercase; letter-spacing: 0.05em;">Calon Pilihan Anda</div>
          <h4 style="font-family: 'Outfit', sans-serif; font-size: 1.15rem; font-weight: 800; color: #18181b; margin: 2px 0 0 0;">
            ${escapeHtml(candidate.nama_calon)}
          </h4>
          ${candidate.prodi ? `<div style="font-size: 0.8rem; color: #71717a;">${escapeHtml(candidate.prodi)}</div>` : ''}
        </div>
      </div>

      <div style="background: #fef2f2; border-left: 3px solid #dc2626; padding: 0.75rem 1rem; border-radius: 4px; text-align: left; margin-bottom: 1.5rem; font-size: 0.8rem; color: #991b1b; line-height: 1.5;">
        <i class="fa-solid fa-circle-exclamation" style="margin-right: 4px;"></i>
        <strong>Perhatian:</strong> Sesuai asas 1 Akun 1 Suara, pilihan yang telah dikonfirmasi bersifat <strong>final dan tidak dapat diubah</strong> kembali.
      </div>

      <div style="display: flex; gap: 0.75rem;">
        <button type="button" onclick="closeVoteConfirmModal()" class="btn btn-outline" style="flex: 1; justify-content: center; padding: 0.75rem;">
          Batal
        </button>
        <button type="button" id="btn-submit-vote" onclick="submitCastVote()" class="btn btn-primary" style="flex: 1.5; justify-content: center; padding: 0.75rem; background: #18181b; color: #ffffff; font-weight: 700;">
          <i class="fa-solid fa-check"></i> Ya, Kirim Suara Saya
        </button>
      </div>
    </div>
  `;

  modal.style.display = 'flex';
}

export function closeVoteConfirmModal() {
  const modal = document.getElementById('modal-vote-confirm');
  if (modal) modal.style.display = 'none';
  selectedCandidateForVote = null;
}

export async function submitCastVote() {
  if (!selectedCandidateForVote || !currentElection) return;

  const btn = document.getElementById('btn-submit-vote');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Merekam Suara...';
  }

  try {
    const res = await fetchAuth(`${API_BASE}/elections/${currentElection.id}/vote`, {
      method: 'POST',
      body: JSON.stringify({
        candidate_id: selectedCandidateForVote.id
      })
    });

    const result = await res.json();

    if (result.status === 'success') {
      closeVoteConfirmModal();
      alert(result.message || 'Suara Anda berhasil dicatat secara resmi.');
      // Muat ulang data bilik suara agar status berubah menjadi sudah memilih
      await loadElectionData();
    } else {
      alert(result.message || 'Gagal mengirimkan suara.');
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = '<i class="fa-solid fa-check"></i> Ya, Kirim Suara Saya';
      }
    }
  } catch (err) {
    console.error('submitCastVote error:', err);
    alert('Terjadi kesalahan jaringan saat mengirimkan suara.');
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<i class="fa-solid fa-check"></i> Ya, Kirim Suara Saya';
    }
  }
}

// ==========================================
// 2. MONITORING & HASIL QUICK COUNT
// ==========================================
export async function loadMonitoringData(isSilent = false) {
  const leaderBox = document.getElementById('monitoring-leader-card');
  const statsBox = document.getElementById('monitoring-stats-grid');
  const tableBody = document.getElementById('monitoring-leaderboard-body');
  const lastUpdatedEl = document.getElementById('monitoring-last-updated');

  if (!statsBox && !leaderBox) return;

  if (!isSilent && statsBox) {
    statsBox.style.opacity = '0.5';
  }

  try {
    const res = await fetchAuth(`${API_BASE}/elections/monitoring`);
    const result = await res.json();

    if (statsBox) statsBox.style.opacity = '1';

    if (result.status !== 'success' || !result.data) {
      if (!isSilent && leaderBox) {
        leaderBox.innerHTML = `
          <div style="padding: 2rem; text-align: center; color: #dc2626; background: #fef2f2; border-radius: 8px;">
            ${result.message || 'Gagal memuat monitoring suara.'}
          </div>
        `;
      }
      return;
    }

    const { election, stats, candidates, leader, chart_data, last_updated } = result.data;

    if (lastUpdatedEl) {
      const timeStr = new Date(last_updated).toLocaleTimeString('id-ID', {
        timeZone: 'Asia/Jakarta',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      });
      lastUpdatedEl.textContent = `Pembaruan Terakhir: ${timeStr} WIB`;
    }

    // 1. Render 4 Stat Cards
    renderMonitoringStats(statsBox, stats, election);

    // 2. Render Winner / Leader Card
    renderWinnerCard(leaderBox, leader, election, stats);

    // 3. Render Leaderboard Table
    renderLeaderboardTable(tableBody, candidates, stats.total_voted);

    // 4. Render Visualisasi Grafik Suara (Chart.js)
    renderElectionCharts(chart_data, stats);

  } catch (err) {
    console.error('loadMonitoringData error:', err);
    if (statsBox) statsBox.style.opacity = '1';
  }
}

function renderMonitoringStats(container, stats, election) {
  if (!container) return;

  const totalDpt = stats.total_dpt || 0;
  const totalVoted = stats.total_voted || 0;
  const totalUnvoted = stats.total_unvoted || 0;
  const rate = stats.participation_rate || 0;

  container.innerHTML = `
    <div class="stat-card" style="background:#ffffff !important; border:1px solid #e4e4e7 !important; padding:1.25rem 1.5rem !important; border-radius:8px; box-shadow:0 1px 3px rgba(0,0,0,0.04) !important;">
      <span class="stat-label">Total Pemilih (DPT)</span>
      <h3 class="stat-value" style="font-size: 2rem; font-weight: 800; color: #18181b; margin-top: 0.25rem;">
        ${totalDpt.toLocaleString('id-ID')}
      </h3>
      <span style="font-size: 0.75rem; color: #71717a; display: block; margin-top: 4px;">Seluruh Akun Terdaftar</span>
    </div>

    <div class="stat-card" style="background:#ffffff !important; border:1px solid #e4e4e7 !important; padding:1.25rem 1.5rem !important; border-radius:8px; box-shadow:0 1px 3px rgba(0,0,0,0.04) !important;">
      <span class="stat-label">Suara Masuk (Sah)</span>
      <h3 class="stat-value" style="font-size: 2rem; font-weight: 800; color: #18181b; margin-top: 0.25rem;">
        ${totalVoted.toLocaleString('id-ID')}
      </h3>
      <span style="font-size: 0.75rem; color: #71717a; display: block; margin-top: 4px;">Akun Telah Memilih</span>
    </div>

    <div class="stat-card" style="background:#ffffff !important; border:1px solid #e4e4e7 !important; padding:1.25rem 1.5rem !important; border-radius:8px; box-shadow:0 1px 3px rgba(0,0,0,0.04) !important;">
      <span class="stat-label">Belum Memberikan Suara</span>
      <h3 class="stat-value" style="font-size: 2rem; font-weight: 800; color: #71717a; margin-top: 0.25rem;">
        ${totalUnvoted.toLocaleString('id-ID')}
      </h3>
      <span style="font-size: 0.75rem; color: #71717a; display: block; margin-top: 4px;">Sisa Pemilih Terdaftar</span>
    </div>

    <div class="stat-card" style="background:#ffffff !important; border:1px solid #e4e4e7 !important; padding:1.25rem 1.5rem !important; border-radius:8px; box-shadow:0 1px 3px rgba(0,0,0,0.04) !important;">
      <span class="stat-label">Tingkat Partisipasi</span>
      <h3 class="stat-value" style="font-size: 2rem; font-weight: 800; color: #18181b; margin-top: 0.25rem;">
        ${rate}%
      </h3>
      <div style="width: 100%; height: 5px; background: #f4f4f5; border-radius: 3px; margin-top: 8px; overflow: hidden;">
        <div style="width: ${rate}%; height: 100%; background: #18181b; border-radius: 3px;"></div>
      </div>
    </div>
  `;
}

function renderWinnerCard(container, leader, election, stats) {
  if (!container) return;

  const isClosed = election.status === 'closed';

  if (!leader || stats.total_voted === 0) {
    container.innerHTML = `
      <div style="background: #ffffff; border: 1px solid #e4e4e7; border-radius: 8px; padding: 2.5rem; text-align: center; box-shadow: 0 1px 3px rgba(0,0,0,0.04); margin-bottom: 2rem;">
        <div style="width: 56px; height: 56px; border-radius: 50%; background: #f4f4f5; color: #71717a; display: inline-flex; align-items: center; justify-content: center; font-size: 1.5rem; margin-bottom: 0.75rem;">
          <i class="fa-solid fa-square-poll-vertical"></i>
        </div>
        <h3 style="font-family: 'Outfit', sans-serif; font-size: 1.25rem; font-weight: 800; color: #18181b; margin-bottom: 0.35rem;">
          Menunggu Suara Masuk
        </h3>
        <p style="font-size: 0.88rem; color: #71717a; margin: 0; max-width: 440px; margin: 0 auto;">
          Belum ada suara yang tercatat di bilik suara. Pemimpin suara terbanyak akan ditampilkan segera setelah suara pertama masuk.
        </p>
      </div>
    `;
    return;
  }

  const numDisplay = String(leader.nomor_urut).padStart(2, '0');
  const badgeTitle = isClosed ? 'KETUA UMUM TERPILIH' : 'MEMIMPIN PEROLEHAN SUARA SEMENTARA';
  const badgeIcon = isClosed ? 'fa-trophy' : 'fa-award';

  container.innerHTML = `
    <div style="background: #ffffff; border: 1px solid #e4e4e7; border-left: 5px solid #18181b; border-radius: 8px; padding: 1.75rem 2rem; margin-bottom: 2rem; box-shadow: 0 1px 3px rgba(0,0,0,0.04); display: flex; align-items: center; justify-content: space-between; gap: 2rem; flex-wrap: wrap;">
      <div style="display: flex; align-items: center; gap: 1.5rem; flex-wrap: wrap;">
        ${leader.foto_url 
          ? `<img src="${leader.foto_url}" alt="Foto ${leader.nama_calon}" style="width: 100px; height: 115px; object-fit: cover; border-radius: 8px; background: #f4f4f5; flex-shrink: 0; border: 1px solid #e4e4e7;">`
          : `<div style="width: 100px; height: 115px; border-radius: 8px; background: #f4f4f5; display: flex; align-items: center; justify-content: center; font-size: 2.5rem; color: #71717a; flex-shrink: 0;">
               <i class="fa-solid fa-user-tie"></i>
             </div>`
        }
        <div>
          <div style="display: inline-flex; align-items: center; gap: 0.4rem; background: #18181b; color: #ffffff; font-size: 0.72rem; font-weight: 800; padding: 0.25rem 0.65rem; border-radius: 4px; text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 0.5rem;">
            <i class="fa-solid ${badgeIcon}"></i> ${badgeTitle}
          </div>
          <h2 style="font-family: 'Outfit', sans-serif; font-size: clamp(1.4rem, 2.5vw, 1.8rem); font-weight: 800; color: #18181b; margin: 0 0 4px 0; line-height: 1.2;">
            No. ${numDisplay} &mdash; ${escapeHtml(leader.nama_calon)}
          </h2>
          <div style="font-size: 0.88rem; color: #71717a;">
            ${leader.nim ? `NIM: ${escapeHtml(leader.nim)}` : ''} 
            ${leader.nim && leader.prodi ? '&bull;' : ''}
            ${leader.prodi ? escapeHtml(leader.prodi) : ''}
          </div>
        </div>
      </div>

      <div style="display: flex; gap: 2.5rem; align-items: center; text-align: right; margin-left: auto;">
        <div>
          <span style="font-size: 0.75rem; font-weight: 700; color: #71717a; text-transform: uppercase; letter-spacing: 0.08em; display: block;">Perolehan Suara</span>
          <div style="font-family: 'Outfit', sans-serif; font-size: 2.2rem; font-weight: 800; color: #18181b; line-height: 1;">
            ${leader.vote_count.toLocaleString('id-ID')}
          </div>
          <span style="font-size: 0.8rem; font-weight: 600; color: #4b5563;">suara sah</span>
        </div>

        <div style="border-left: 1px solid #e4e4e7; padding-left: 2.5rem;">
          <span style="font-size: 0.75rem; font-weight: 700; color: #71717a; text-transform: uppercase; letter-spacing: 0.08em; display: block;">Persentase</span>
          <div style="font-family: 'Outfit', sans-serif; font-size: 2.2rem; font-weight: 800; color: #18181b; line-height: 1;">
            ${leader.percentage}%
          </div>
          <span style="font-size: 0.8rem; font-weight: 600; color: #4b5563;">dari total suara</span>
        </div>
      </div>
    </div>
  `;
}

function renderLeaderboardTable(tableBody, candidates, totalVoted) {
  if (!tableBody) return;

  if (!candidates || candidates.length === 0) {
    tableBody.innerHTML = `
      <tr>
        <td colspan="6" style="text-align: center; padding: 2rem; color: #71717a;">Belum ada data calon.</td>
      </tr>
    `;
    return;
  }

  tableBody.innerHTML = candidates.map((c, index) => {
    const rank = index + 1;
    const numDisplay = String(c.nomor_urut).padStart(2, '0');
    const isFirst = rank === 1 && c.vote_count > 0;

    return `
      <tr style="${isFirst ? 'background: #fafafa;' : ''}">
        <td style="font-family: 'Outfit', sans-serif; font-weight: 700; font-size: 1.1rem; color: ${isFirst ? '#18181b' : '#71717a'}; text-align: center; width: 60px;">
          ${isFirst ? '<i class="fa-solid fa-trophy" style="font-size: 0.95rem; margin-right: 4px;"></i>' : ''} ${rank}
        </td>
        <td style="font-family: 'Outfit', sans-serif; font-weight: 800; font-size: 1rem; color: #18181b; text-align: center; width: 80px;">
          ${numDisplay}
        </td>
        <td>
          <div style="display: flex; align-items: center; gap: 0.75rem;">
            ${c.foto_url 
              ? `<img src="${c.foto_url}" alt="${c.nama_calon}" style="width: 40px; height: 40px; object-fit: cover; border-radius: 6px; background: #f4f4f5;">`
              : `<div style="width: 40px; height: 40px; border-radius: 6px; background: #f4f4f5; display: flex; align-items: center; justify-content: center; color: #71717a;"><i class="fa-solid fa-user"></i></div>`
            }
            <div>
              <strong style="color: #18181b; font-size: 0.95rem; display: block;">${escapeHtml(c.nama_calon)}</strong>
              <small style="color: #71717a; font-size: 0.78rem;">${c.prodi ? escapeHtml(c.prodi) : 'UKM IPTEK'}</small>
            </div>
          </div>
        </td>
        <td style="font-family: 'Outfit', sans-serif; font-weight: 700; font-size: 1.1rem; color: #18181b; text-align: right; width: 140px;">
          ${c.vote_count.toLocaleString('id-ID')}
        </td>
        <td style="width: 220px;">
          <div style="display: flex; align-items: center; gap: 0.75rem;">
            <div style="flex: 1; height: 8px; background: #f4f4f5; border-radius: 4px; overflow: hidden;">
              <div style="width: ${c.percentage}%; height: 100%; background: ${isFirst ? '#18181b' : '#71717a'}; border-radius: 4px;"></div>
            </div>
            <strong style="font-family: 'Outfit', sans-serif; font-size: 0.95rem; color: #18181b; min-width: 48px; text-align: right;">
              ${c.percentage}%
            </strong>
          </div>
        </td>
        <td style="text-align: center; width: 120px;">
          <span style="font-size: 0.72rem; font-weight: 700; padding: 3px 8px; border-radius: 4px; text-transform: uppercase; ${isFirst ? 'background: #18181b; color: #ffffff;' : 'background: #f4f4f5; color: #71717a; border: 1px solid #e4e4e7;'}">
            ${isFirst ? 'Peringkat 1' : `Peringkat ${rank}`}
          </span>
        </td>
      </tr>
    `;
  }).join('');
}

// ==========================================
// RENDER GRAFIK CHART.JS (BAR & DONUT)
// ==========================================
function renderElectionCharts(chartData, stats) {
  if (typeof window.Chart === 'undefined') {
    console.warn('Chart.js library belum siap.');
    return;
  }

  // 1. Horizontal Bar Chart (Suara Terbanyak)
  const barCanvas = document.getElementById('chart-votes-bar');
  if (barCanvas && chartData) {
    if (barChartInstance) {
      barChartInstance.destroy();
      barChartInstance = null;
    }

    const ctxBar = barCanvas.getContext('2d');
    barChartInstance = new window.Chart(ctxBar, {
      type: 'bar',
      data: {
        labels: chartData.labels,
        datasets: [{
          label: 'Jumlah Suara',
          data: chartData.votes,
          backgroundColor: chartData.colors || ['#18181b', '#3f3f46', '#71717a', '#a1a1aa'],
          borderRadius: 6,
          barPercentage: 0.6,
          categoryPercentage: 0.8
        }]
      },
      options: {
        indexAxis: 'y', // Horizontal Bar Chart
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            display: false
          },
          tooltip: {
            backgroundColor: '#18181b',
            titleFont: { family: 'Outfit', size: 13, weight: 'bold' },
            bodyFont: { family: 'Inter', size: 12 },
            padding: 10,
            cornerRadius: 6,
            callbacks: {
              label: function(context) {
                const val = context.raw || 0;
                const total = stats.total_voted || 1;
                const pct = ((val / total) * 100).toFixed(1);
                return ` ${val} Suara Sah (${pct}%)`;
              }
            }
          }
        },
        scales: {
          x: {
            beginAtZero: true,
            ticks: {
              precision: 0,
              font: { family: 'Inter', size: 11 },
              color: '#71717a'
            },
            grid: {
              color: '#f4f4f5'
            }
          },
          y: {
            ticks: {
              font: { family: 'Outfit', size: 12, weight: '600' },
              color: '#18181b'
            },
            grid: {
              display: false
            }
          }
        }
      }
    });
  }

  // 2. Donut Chart (Persentase Distribusi)
  const donutCanvas = document.getElementById('chart-votes-donut');
  if (donutCanvas && chartData) {
    if (donutChartInstance) {
      donutChartInstance.destroy();
      donutChartInstance = null;
    }

    const ctxDonut = donutCanvas.getContext('2d');
    const hasAnyVote = stats.total_voted > 0;

    const donutLabels = hasAnyVote ? chartData.shortLabels : ['Belum Ada Suara'];
    const donutData = hasAnyVote ? chartData.votes : [1];
    const donutColors = hasAnyVote 
      ? (chartData.colors || ['#18181b', '#3f3f46', '#71717a', '#a1a1aa'])
      : ['#e4e4e7'];

    donutChartInstance = new window.Chart(ctxDonut, {
      type: 'doughnut',
      data: {
        labels: donutLabels,
        datasets: [{
          data: donutData,
          backgroundColor: donutColors,
          borderWidth: 2,
          borderColor: '#ffffff',
          hoverOffset: 4
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '72%',
        plugins: {
          legend: {
            position: 'bottom',
            labels: {
              font: { family: 'Inter', size: 11, weight: '500' },
              color: '#18181b',
              padding: 12,
              usePointStyle: true,
              pointStyle: 'circle'
            }
          },
          tooltip: {
            enabled: hasAnyVote,
            backgroundColor: '#18181b',
            titleFont: { family: 'Outfit', size: 12, weight: 'bold' },
            bodyFont: { family: 'Inter', size: 12 },
            cornerRadius: 6,
            callbacks: {
              label: function(context) {
                const val = context.raw || 0;
                const total = stats.total_voted || 1;
                const pct = ((val / total) * 100).toFixed(1);
                return ` ${val} Suara (${pct}%)`;
              }
            }
          }
        }
      }
    });
  }
}

// ==========================================
// 3. PANEL PANITIA PEMILIHAN
// ==========================================
export async function loadPanitiaData() {
  await loadElectionData(); // Memastikan currentElection & currentCandidates termuat
  renderPanitiaCandidatesTable();
  renderPanitiaElectionSettings();
  loadVotersAudit();
}

function renderPanitiaElectionSettings() {
  const statusSelect = document.getElementById('panitia-election-status');
  const judulInput = document.getElementById('panitia-election-judul');
  const periodeInput = document.getElementById('panitia-election-periode');
  const descInput = document.getElementById('panitia-election-desc');

  if (currentElection) {
    if (statusSelect) statusSelect.value = currentElection.status;
    if (judulInput) judulInput.value = currentElection.judul || '';
    if (periodeInput) periodeInput.value = currentElection.periode || '';
    if (descInput) descInput.value = currentElection.deskripsi || '';
  }
}

export async function submitElectionSettings(e) {
  if (e) e.preventDefault();
  if (!currentElection) return;

  const status = document.getElementById('panitia-election-status')?.value;
  const judul = document.getElementById('panitia-election-judul')?.value;
  const periode = document.getElementById('panitia-election-periode')?.value;
  const deskripsi = document.getElementById('panitia-election-desc')?.value;

  try {
    const res = await fetchAuth(`${API_BASE}/elections/${currentElection.id}/status`, {
      method: 'PUT',
      body: JSON.stringify({ status, judul, periode, deskripsi })
    });

    const result = await res.json();
    if (result.status === 'success') {
      alert(result.message || 'Status dan pengaturan pemilihan berhasil diperbarui.');
      currentElection = result.data;
      loadElectionData();
    } else {
      alert(result.message || 'Gagal memperbarui pengaturan pemilihan.');
    }
  } catch (err) {
    console.error('submitElectionSettings error:', err);
    alert('Terjadi kesalahan jaringan.');
  }
}

function renderPanitiaCandidatesTable() {
  const tbody = document.getElementById('panitia-candidates-table-body');
  if (!tbody) return;

  if (!currentCandidates || currentCandidates.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="5" style="text-align: center; padding: 2rem; color: #71717a;">
          Belum ada calon ketua umum yang didaftarkan. Klik tombol "+ Tambah Calon Baru" di atas.
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = currentCandidates.map(c => {
    const numDisplay = String(c.nomor_urut).padStart(2, '0');
    return `
      <tr>
        <td style="font-family: 'Outfit', sans-serif; font-weight: 800; font-size: 1.1rem; color: #18181b; text-align: center;">
          ${numDisplay}
        </td>
        <td>
          <div style="display: flex; align-items: center; gap: 0.75rem;">
            ${c.foto_url 
              ? `<img src="${c.foto_url}" alt="${c.nama_calon}" style="width: 44px; height: 50px; object-fit: cover; border-radius: 6px; background: #f4f4f5;">`
              : `<div style="width: 44px; height: 50px; border-radius: 6px; background: #f4f4f5; display: flex; align-items: center; justify-content: center; color: #71717a;"><i class="fa-solid fa-user"></i></div>`
            }
            <div>
              <strong style="color: #18181b; font-size: 0.95rem; display: block;">${escapeHtml(c.nama_calon)}</strong>
              <small style="color: #71717a; font-size: 0.78rem;">${c.nim ? `${escapeHtml(c.nim)} &bull; ` : ''}${c.prodi ? escapeHtml(c.prodi) : '-'}</small>
            </div>
          </div>
        </td>
        <td style="max-width: 250px;">
          <div style="font-size: 0.85rem; color: #4b5563; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
            ${escapeHtml(c.visi || '-')}
          </div>
        </td>
        <td style="max-width: 250px;">
          <div style="font-size: 0.85rem; color: #4b5563; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
            ${escapeHtml(c.misi || '-')}
          </div>
        </td>
        <td style="text-align: right; white-space: nowrap;">
          <button onclick="openEditCandidateModal(${c.id})" class="btn btn-outline" style="padding: 0.35rem 0.65rem; font-size: 0.8rem; margin-right: 4px;" title="Edit Calon">
            <i class="fa-solid fa-pen-to-square"></i> Edit
          </button>
          <button onclick="confirmDeleteCandidate(${c.id}, '${escapeHtml(c.nama_calon)}')" class="btn btn-outline" style="padding: 0.35rem 0.65rem; font-size: 0.8rem; color: #dc2626; border-color: #fecaca;" title="Hapus Calon">
            <i class="fa-solid fa-trash"></i>
          </button>
        </td>
      </tr>
    `;
  }).join('');
}

// Form Modal Tambah / Edit Calon
export function openAddCandidateModal() {
  const modal = document.getElementById('modal-candidate-form');
  const title = document.getElementById('modal-candidate-form-title');
  const form = document.getElementById('form-candidate-crud');
  if (!modal || !form) return;

  form.reset();
  document.getElementById('candidate-form-id').value = '';
  if (title) title.textContent = 'Pendaftaran Calon Ketua Umum';

  // Otomatis tentukan nomor urut berikutnya
  const nextNum = currentCandidates.length > 0 
    ? Math.max(...currentCandidates.map(c => c.nomor_urut)) + 1 
    : 1;
  document.getElementById('candidate-form-nomor').value = nextNum;

  modal.style.display = 'flex';
}

export function openEditCandidateModal(candidateId) {
  const candidate = currentCandidates.find(c => c.id === candidateId);
  if (!candidate) return;

  const modal = document.getElementById('modal-candidate-form');
  const title = document.getElementById('modal-candidate-form-title');
  if (!modal) return;

  if (title) title.textContent = 'Edit Data Calon Ketua Umum';
  document.getElementById('candidate-form-id').value = candidate.id;
  document.getElementById('candidate-form-nomor').value = candidate.nomor_urut;
  document.getElementById('candidate-form-nama').value = candidate.nama_calon;
  document.getElementById('candidate-form-nim').value = candidate.nim || '';
  document.getElementById('candidate-form-prodi').value = candidate.prodi || '';
  document.getElementById('candidate-form-visi').value = candidate.visi || '';
  document.getElementById('candidate-form-misi').value = candidate.misi || '';
  document.getElementById('candidate-form-program').value = candidate.program_unggulan || '';
  document.getElementById('candidate-form-foto').value = '';

  modal.style.display = 'flex';
}

export function closeCandidateFormModal() {
  const modal = document.getElementById('modal-candidate-form');
  if (modal) modal.style.display = 'none';
}

export async function submitCandidateForm(e) {
  if (e) e.preventDefault();
  if (!currentElection) return;

  const candidateId = document.getElementById('candidate-form-id').value;
  const isEdit = !!candidateId;

  const formData = new FormData();
  formData.append('nomor_urut', document.getElementById('candidate-form-nomor').value);
  formData.append('nama_calon', document.getElementById('candidate-form-nama').value);
  formData.append('nim', document.getElementById('candidate-form-nim').value);
  formData.append('prodi', document.getElementById('candidate-form-prodi').value);
  formData.append('visi', document.getElementById('candidate-form-visi').value);
  formData.append('misi', document.getElementById('candidate-form-misi').value);
  formData.append('program_unggulan', document.getElementById('candidate-form-program').value);

  const fotoInput = document.getElementById('candidate-form-foto');
  if (fotoInput && fotoInput.files[0]) {
    formData.append('candidate_photo', fotoInput.files[0]);
  }

  const url = isEdit 
    ? `${API_BASE}/elections/candidates/${candidateId}`
    : `${API_BASE}/elections/${currentElection.id}/candidates`;

  const method = isEdit ? 'PUT' : 'POST';

  try {
    const token = localStorage.getItem('iptek_token');
    const res = await fetch(url, {
      method: method,
      headers: {
        'Authorization': `Bearer ${token}`
      },
      body: formData
    });

    const result = await res.json();
    if (result.status === 'success') {
      alert(result.message || 'Calon berhasil disimpan.');
      closeCandidateFormModal();
      await loadElectionData();
      renderPanitiaCandidatesTable();
    } else {
      alert(result.message || 'Gagal menyimpan data calon.');
    }
  } catch (err) {
    console.error('submitCandidateForm error:', err);
    alert('Terjadi kesalahan jaringan.');
  }
}

export async function confirmDeleteCandidate(candidateId, candidateName) {
  if (!confirm(`Apakah Anda yakin ingin menghapus Calon "${candidateName}"?\nSeluruh suara yang terkait calon ini juga akan terhapus.`)) {
    return;
  }

  try {
    const res = await fetchAuth(`${API_BASE}/elections/candidates/${candidateId}`, {
      method: 'DELETE'
    });

    const result = await res.json();
    if (result.status === 'success') {
      alert(result.message || 'Calon berhasil dihapus.');
      await loadElectionData();
      renderPanitiaCandidatesTable();
    } else {
      alert(result.message || 'Gagal menghapus calon.');
    }
  } catch (err) {
    console.error('deleteCandidate error:', err);
    alert('Terjadi kesalahan jaringan saat menghapus calon.');
  }
}

// Rekapitulasi & Audit Pemilih (Siapa Sudah / Belum Memilih)
export async function loadVotersAudit() {
  const tbody = document.getElementById('panitia-audit-table-body');
  const dptEl = document.getElementById('audit-stat-dpt');
  const votedEl = document.getElementById('audit-stat-voted');
  const unvotedEl = document.getElementById('audit-stat-unvoted');

  if (!tbody || !currentElection) return;

  try {
    tbody.innerHTML = `
      <tr>
        <td colspan="5" style="text-align: center; padding: 2rem; color: #71717a;">
          <i class="fa-solid fa-spinner fa-spin"></i> Memuat daftar pemilih...
        </td>
      </tr>
    `;

    const res = await fetchAuth(`${API_BASE}/elections/${currentElection.id}/voters`);
    const result = await res.json();

    if (result.status !== 'success' || !result.data) {
      tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; color:#dc2626; padding:1.5rem;">${result.message || 'Gagal memuat pemilih.'}</td></tr>`;
      return;
    }

    const { stats, voters } = result.data;
    votersAuditData = voters || [];

    if (dptEl) dptEl.textContent = stats.total_dpt;
    if (votedEl) votedEl.textContent = stats.total_voted;
    if (unvotedEl) unvotedEl.textContent = stats.total_unvoted;

    filterAndRenderVoters();

  } catch (err) {
    console.error('loadVotersAudit error:', err);
  }
}

export function filterAndRenderVoters() {
  const tbody = document.getElementById('panitia-audit-table-body');
  const searchInput = document.getElementById('audit-search-input')?.value.toLowerCase() || '';
  const filterStatus = document.getElementById('audit-status-filter')?.value || 'all';

  if (!tbody) return;

  const filtered = votersAuditData.filter(v => {
    const matchSearch = v.nama_lengkap.toLowerCase().includes(searchInput) || v.username.toLowerCase().includes(searchInput);
    if (!matchSearch) return false;

    if (filterStatus === 'voted') return v.has_voted;
    if (filterStatus === 'unvoted') return !v.has_voted;
    return true;
  });

  if (filtered.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="5" style="text-align: center; padding: 2rem; color: #71717a;">
          Tidak ada data pemilih yang sesuai kriteria pencarian.
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = filtered.map((v, i) => {
    const formattedDate = v.voted_at 
      ? new Date(v.voted_at).toLocaleString('id-ID', {
          timeZone: 'Asia/Jakarta',
          day: 'numeric',
          month: 'short',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit'
        })
      : '-';

    return `
      <tr>
        <td style="text-align: center; color: #71717a; width: 50px;">${i + 1}</td>
        <td>
          <strong style="color: #18181b; font-size: 0.92rem; display: block;">${escapeHtml(v.nama_lengkap)}</strong>
          <small style="color: #71717a; font-size: 0.78rem;">@${escapeHtml(v.username)}</small>
        </td>
        <td>
          <span style="font-size: 0.78rem; text-transform: uppercase; font-weight: 600; color: #18181b;">${escapeHtml(v.role)}</span>
          ${v.divisi ? `<small style="color: #71717a; display: block; font-size: 0.72rem;">${escapeHtml(v.divisi)}</small>` : ''}
        </td>
        <td style="text-align: center;">
          ${v.has_voted 
            ? `<span style="display: inline-flex; align-items: center; gap: 4px; font-size: 0.72rem; font-weight: 700; background: #18181b; color: #ffffff; padding: 3px 8px; border-radius: 4px; text-transform: uppercase;">
                 <i class="fa-solid fa-check"></i> Sudah Memilih
               </span>`
            : `<span style="display: inline-flex; align-items: center; gap: 4px; font-size: 0.72rem; font-weight: 700; background: #f4f4f5; color: #71717a; border: 1px solid #e4e4e7; padding: 3px 8px; border-radius: 4px; text-transform: uppercase;">
                 Belum Memilih
               </span>`
          }
        </td>
        <td style="font-size: 0.85rem; color: #71717a; text-align: center;">
          ${formattedDate}
        </td>
      </tr>
    `;
  }).join('');
}

// Ekspor Rekapitulasi Pemilih ke CSV
export function exportVotersCsv() {
  if (!votersAuditData || votersAuditData.length === 0) {
    alert('Tidak ada data pemilih untuk diekspor.');
    return;
  }

  let csv = 'No,Nama Lengkap,Username,Peran,Divisi,Status Memilih,Waktu Memilih (WIB)\r\n';
  votersAuditData.forEach((v, idx) => {
    const status = v.has_voted ? 'Sudah Memilih' : 'Belum Memilih';
    const time = v.voted_at ? new Date(v.voted_at).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' }) : '-';
    csv += `"${idx + 1}","${v.nama_lengkap.replace(/"/g, '""')}","${v.username}","${v.role}","${(v.divisi || '-').replace(/"/g, '""')}","${status}","${time}"\r\n`;
  });

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `Rekap_Pemilih_Pemilu_IPTEK_${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// Reset Seluruh Perolehan Suara
export async function confirmResetVotes() {
  if (!currentElection) return;

  const code = prompt('PERINGATAN: Tindakan ini akan menghapus SELURUH suara pemilih yang telah masuk ke nol (0).\n\nKetik kata "RESET" (huruf kapital) untuk melanjutkan:');
  if (code !== 'RESET') {
    alert('Reset dibatalkan.');
    return;
  }

  try {
    const res = await fetchAuth(`${API_BASE}/elections/${currentElection.id}/reset`, {
      method: 'POST'
    });

    const result = await res.json();
    if (result.status === 'success') {
      alert(result.message || 'Perolehan suara berhasil direset.');
      await loadElectionData();
      if (document.getElementById('pemilu-subtab-monitoring').style.display !== 'none') {
        loadMonitoringData();
      }
      if (document.getElementById('pemilu-subtab-panitia').style.display !== 'none') {
        loadVotersAudit();
      }
    } else {
      alert(result.message || 'Gagal mereset perolehan suara.');
    }
  } catch (err) {
    console.error('resetVotes error:', err);
    alert('Terjadi kesalahan jaringan.');
  }
}

// Helper sanitasi HTML sederhana
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
