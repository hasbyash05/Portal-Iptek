import { fetchAuth } from './auth.js';

export const API_BASE = '/api';

let currentElection = null;
let currentCandidates = [];
let hasVoted = false;
let userVotedAt = null;
let selectedCandidateForVote = null;
let barChartInstance = null;
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
    if (btn) btn.classList.toggle('active', t === subtabName);
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
      <div style="grid-column: 1 / -1; text-align: center; padding: 2rem 1rem; color: #71717a;">
        Memuat data bilik suara...
      </div>
    `;

    const res = await fetchAuth(`${API_BASE}/elections/active`);
    const result = await res.json();

    if (result.status !== 'success' || !result.data) {
      container.innerHTML = `
        <div style="grid-column: 1 / -1; text-align: center; padding: 1.5rem 1rem; color: #dc2626; background: #ffffff; border-radius: 6px;">
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

    if (titleEl) titleEl.textContent = election.judul || 'Pemilihan Calon Ketua Umum UKM IPTEK';
    if (periodeEl) periodeEl.textContent = `Periode ${election.periode || '2026/2027'}`;
    if (descEl) descEl.textContent = election.deskripsi || 'Sistem e-voting terpadu UKM IPTEK STIKES Semarang.';

    const userStr = localStorage.getItem('iptek_user');
    const user = userStr ? JSON.parse(userStr) : null;
    const isPanitia = user && (user.role === 'admin' || user.role === 'pengurus');
    const panitiaTabBtn = document.getElementById('pemilu-tab-btn-panitia');
    if (panitiaTabBtn) {
      panitiaTabBtn.style.display = isPanitia ? 'inline-block' : 'none';
    }

    renderVoterBanner(banner, election, hasVoted, userVotedAt);
    renderCandidates(container, currentCandidates, election, hasVoted);

  } catch (err) {
    console.error('loadElectionData error:', err);
    if (container) {
      container.innerHTML = `
        <div style="grid-column: 1 / -1; text-align: center; padding: 1.5rem 1rem; color: #dc2626; background: #ffffff; border-radius: 6px;">
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
      <div class="card mb-4">
        <div class="card-body" style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 1rem;">
          <div>
            <h4 style="margin: 0 0 4px 0; font-size: 0.95rem; font-weight: 700; color: #18181b;">Bilik Suara Ditutup</h4>
            <p style="margin: 0; font-size: 0.85rem; color: #4b5563;">Periode pemungutan suara telah selesai. Silakan periksa hasil akhir pada tab Monitoring Suara.</p>
          </div>
          <button onclick="switchPemiluSubtab('monitoring')" class="btn btn-outline" style="font-size: 0.85rem;">
            Lihat Hasil Akhir
          </button>
        </div>
      </div>
    `;
    return;
  }

  if (isDraft) {
    bannerEl.innerHTML = `
      <div class="card mb-4">
        <div class="card-body">
          <h4 style="margin: 0 0 4px 0; font-size: 0.95rem; font-weight: 700; color: #18181b;">Tahap Persiapan</h4>
          <p style="margin: 0; font-size: 0.85rem; color: #4b5563;">Bilik suara belum dibuka oleh panitia pemilihan.</p>
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
      <div class="card mb-4">
        <div class="card-body" style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 1rem;">
          <div>
            <h4 style="margin: 0 0 4px 0; font-size: 0.95rem; font-weight: 700; color: #18181b;">Hak Suara Telah Digunakan</h4>
            <p style="margin: 0; font-size: 0.85rem; color: #4b5563;">Pilihan Anda tercatat pada ${formattedDate} WIB. Setiap akun hanya memiliki 1 hak suara sah.</p>
          </div>
          <button onclick="switchPemiluSubtab('monitoring')" class="btn btn-outline" style="font-size: 0.85rem;">
            Lihat Monitoring Suara
          </button>
        </div>
      </div>
    `;
  } else {
    bannerEl.innerHTML = `
      <div class="card mb-4">
        <div class="card-body">
          <h4 style="margin: 0 0 4px 0; font-size: 0.95rem; font-weight: 700; color: #18181b;">Pemungutan Suara Sedang Berlangsung</h4>
          <p style="margin: 0; font-size: 0.85rem; color: #4b5563;">Setiap akun berhak memberikan satu suara sah. Silakan pelajari profil calon ketua umum dan gunakan hak suara Anda.</p>
        </div>
      </div>
    `;
  }
}

function renderCandidates(container, candidates, election, userVoted) {
  if (!candidates || candidates.length === 0) {
    container.innerHTML = `
      <div class="card" style="grid-column: 1 / -1;">
        <div class="card-body text-center" style="padding: 2.5rem 1rem;">
          <h4 style="color: #18181b; margin-bottom: 0.35rem; font-size: 1rem;">Belum Ada Calon Terdaftar</h4>
          <p style="color: #71717a; font-size: 0.85rem; margin: 0;">Panitia pemilihan belum mendaftarkan calon ketua umum.</p>
        </div>
      </div>
    `;
    return;
  }

  const isVotingActive = election.status === 'active' && !userVoted;

  const html = candidates.map(c => {
    const numDisplay = String(c.nomor_urut).padStart(2, '0');
    const photoHtml = c.foto_url
      ? `<img src="${c.foto_url}" alt="Foto Calon" style="width: 100%; height: 100%; object-fit: cover;">`
      : `<div style="text-align: center; color: #9ca3af;"><i class="fa-solid fa-user" style="font-size: 3rem;"></i></div>`;

    const buttonHtml = isVotingActive
      ? `<button onclick="openVoteConfirmModal(${c.id})" class="btn btn-primary" style="width: 100%; font-size: 0.85rem; padding: 0.55rem;">
           Pilih Calon Ini
         </button>`
      : userVoted
        ? `<button disabled class="btn btn-outline" style="width: 100%; font-size: 0.85rem; padding: 0.55rem; cursor: not-allowed; opacity: 0.6;">
             Suara Telah Digunakan
           </button>`
        : `<button disabled class="btn btn-outline" style="width: 100%; font-size: 0.85rem; padding: 0.55rem; cursor: not-allowed; opacity: 0.6;">
             Pemilihan Tidak Aktif
           </button>`;

    const visiSnippet = c.visi && c.visi.length > 110 ? c.visi.substring(0, 110) + '...' : (c.visi || 'Visi belum diisi.');

    return `
      <div class="card" style="display: flex; flex-direction: column;">
        <div class="card-header" style="display: flex; justify-content: space-between; align-items: center; padding: 0.85rem 1.25rem;">
          <strong style="font-family: 'Outfit', sans-serif; font-size: 0.9rem; color: #18181b; text-transform: uppercase;">Calon Nomor ${numDisplay}</strong>
          <span style="font-size: 0.8rem; color: #71717a;">${escapeHtml(c.prodi || 'UKM IPTEK')}</span>
        </div>
        <div style="width: 100%; height: 240px; background: #f8f9fa; border-bottom: 1px solid var(--border-color); display: flex; align-items: center; justify-content: center; overflow: hidden;">
          ${photoHtml}
        </div>
        <div class="card-body" style="display: flex; flex-direction: column; flex-grow: 1; padding: 1.25rem;">
          <h4 style="font-family: 'Outfit', sans-serif; font-size: 1.15rem; font-weight: 700; color: #18181b; margin: 0 0 2px 0;">
            ${escapeHtml(c.nama_calon)}
          </h4>
          <div style="font-size: 0.8rem; color: #71717a; margin-bottom: 0.85rem;">
            ${c.nim ? `NIM ${escapeHtml(c.nim)}` : ''}
          </div>
          <div style="margin-bottom: 1.25rem; flex-grow: 1;">
            <div style="font-size: 0.75rem; font-weight: 700; color: #71717a; text-transform: uppercase; margin-bottom: 3px;">Ringkasan Visi</div>
            <p style="font-size: 0.85rem; color: #4b5563; line-height: 1.5; margin: 0;">${escapeHtml(visiSnippet)}</p>
          </div>
          <div style="display: flex; flex-direction: column; gap: 0.5rem; margin-top: auto;">
            <button type="button" onclick="openCandidateDetailModal(${c.id})" class="btn btn-outline" style="width: 100%; font-size: 0.82rem; padding: 0.5rem;">
              Visi dan Misi Lengkap
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

  const misiLines = candidate.misi
    ? candidate.misi.split('\n').filter(line => line.trim().length > 0)
    : [];

  const misiHtml = misiLines.length > 0
    ? `<ol style="padding-left: 1.25rem; margin: 0; font-size: 0.88rem; color: #4b5563; line-height: 1.6;">
         ${misiLines.map(line => `<li>${escapeHtml(line.replace(/^[-*•\d.]\s*/, ''))}</li>`).join('')}
       </ol>`
    : `<p style="font-size: 0.88rem; color: #71717a; margin: 0;">Misi belum diisi.</p>`;

  body.innerHTML = `
    <div style="display: flex; gap: 1.25rem; align-items: flex-start; margin-bottom: 1.25rem; border-bottom: 1px solid var(--border-color); padding-bottom: 1.25rem; flex-wrap: wrap;">
      <div style="width: 90px; height: 110px; background: #f8f9fa; border: 1px solid var(--border-color); border-radius: 4px; overflow: hidden; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">
        ${candidate.foto_url
      ? `<img src="${candidate.foto_url}" alt="Foto Calon" style="width: 100%; height: 100%; object-fit: cover;">`
      : `<i class="fa-solid fa-user" style="font-size: 2.2rem; color: #9ca3af;"></i>`
    }
      </div>
      <div style="flex: 1; min-width: 200px;">
        <span style="font-size: 0.75rem; font-weight: 700; color: #71717a; text-transform: uppercase;">Calon Nomor ${numDisplay}</span>
        <h3 style="font-family: 'Outfit', sans-serif; font-size: 1.25rem; font-weight: 800; color: #18181b; margin: 2px 0 2px 0;">
          ${escapeHtml(candidate.nama_calon)}
        </h3>
        <div style="font-size: 0.82rem; color: #71717a;">
          ${candidate.nim ? `NIM ${escapeHtml(candidate.nim)}, ` : ''}${escapeHtml(candidate.prodi || 'UKM IPTEK')}
        </div>
      </div>
    </div>

    <div style="margin-bottom: 1.25rem;">
      <div style="font-size: 0.75rem; font-weight: 700; color: #71717a; text-transform: uppercase; margin-bottom: 4px;">Visi</div>
      <p style="font-size: 0.9rem; color: #18181b; line-height: 1.6; margin: 0; background: #f8f9fa; padding: 0.85rem 1rem; border-radius: 4px;">
        ${escapeHtml(candidate.visi || '-')}
      </p>
    </div>

    <div style="margin-bottom: 1.25rem;">
      <div style="font-size: 0.75rem; font-weight: 700; color: #71717a; text-transform: uppercase; margin-bottom: 4px;">Misi</div>
      <div style="background: #ffffff; border: 1px solid var(--border-color); padding: 0.85rem 1rem; border-radius: 4px;">
        ${misiHtml}
      </div>
    </div>

    ${candidate.program_unggulan ? `
      <div>
        <div style="font-size: 0.75rem; font-weight: 700; color: #71717a; text-transform: uppercase; margin-bottom: 4px;">Program Kerja Unggulan</div>
        <p style="font-size: 0.88rem; color: #4b5563; line-height: 1.6; margin: 0; background: #f8f9fa; padding: 0.85rem 1rem; border-radius: 4px;">
          ${escapeHtml(candidate.program_unggulan).replace(/\n/g, '<br>')}
        </p>
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
    <div style="padding: 0.5rem 0;">
      <h3 style="font-family: 'Outfit', sans-serif; font-size: 1.2rem; font-weight: 800; color: #18181b; margin-bottom: 0.5rem;">
        Konfirmasi Pilihan Suara
      </h3>
      <p style="font-size: 0.88rem; color: #4b5563; margin-bottom: 1.25rem;">
        Anda akan memberikan satu suara untuk calon berikut:
      </p>

      <div class="card mb-3" style="background: #f8f9fa; box-shadow: none; border: 1px solid var(--border-color);">
        <div class="card-body" style="padding: 1rem;">
          <span style="font-size: 0.75rem; font-weight: 700; color: #71717a; text-transform: uppercase;">Calon Nomor ${numDisplay}</span>
          <h4 style="font-family: 'Outfit', sans-serif; font-size: 1.15rem; font-weight: 800; color: #18181b; margin: 2px 0 2px 0;">
            ${escapeHtml(candidate.nama_calon)}
          </h4>
          <div style="font-size: 0.8rem; color: #71717a;">${escapeHtml(candidate.prodi || 'UKM IPTEK')}</div>
        </div>
      </div>

      <p style="font-size: 0.8rem; color: #71717a; margin-bottom: 1.5rem;">
        Pilihan ini bersifat final dan tidak dapat diubah setelah dikonfirmasi.
      </p>

      <div style="display: flex; gap: 0.75rem; justify-content: flex-end;">
        <button type="button" onclick="closeVoteConfirmModal()" class="btn btn-outline" style="font-size: 0.85rem;">
          Batal
        </button>
        <button type="button" id="btn-submit-vote" onclick="submitCastVote()" class="btn btn-primary" style="font-size: 0.85rem;">
          Konfirmasi Suara
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
    btn.textContent = 'Merekam Suara...';
  }

  try {
    const res = await fetchAuth(`${API_BASE}/elections/${currentElection.id}/vote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        candidate_id: selectedCandidateForVote.id
      })
    });

    const result = await res.json();

    if (result.status === 'success') {
      closeVoteConfirmModal();
      alert(result.message || 'Suara Anda berhasil dicatat.');
      await loadElectionData();
    } else {
      alert(result.message || 'Gagal mengirimkan suara.');
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Konfirmasi Suara';
      }
    }
  } catch (err) {
    console.error('submitCastVote error:', err);
    alert('Terjadi kesalahan jaringan saat mengirimkan suara.');
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Konfirmasi Suara';
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

  try {
    const res = await fetchAuth(`${API_BASE}/elections/monitoring`);
    const result = await res.json();

    if (result.status !== 'success' || !result.data) {
      return;
    }

    const { election, stats, candidates, leader, chart_data, last_updated } = result.data;

    if (lastUpdatedEl) {
      const timeStr = new Date(last_updated).toLocaleTimeString('id-ID', {
        timeZone: 'Asia/Jakarta',
        hour: '2-digit',
        minute: '2-digit'
      });
      lastUpdatedEl.textContent = `Pembaruan terakhir: ${timeStr} WIB`;
    }

    renderMonitoringStats(statsBox, stats);
    renderWinnerCard(leaderBox, leader, election, stats);
    renderLeaderboardTable(tableBody, candidates);
    renderElectionCharts(chart_data, stats);

  } catch (err) {
    console.error('loadMonitoringData error:', err);
  }
}

function renderMonitoringStats(container, stats) {
  if (!container) return;

  const totalDpt = stats.total_dpt || 0;
  const totalVoted = stats.total_voted || 0;
  const totalUnvoted = stats.total_unvoted || 0;
  const rate = stats.participation_rate || 0;

  container.innerHTML = `
    <div class="card">
      <div class="card-body">
        <span class="stat-label">Total Pemilih</span>
        <h3 class="stat-value" style="font-size: 1.8rem; font-weight: 800; color: #18181b; margin-top: 0.25rem;">
          ${totalDpt.toLocaleString('id-ID')}
        </h3>
        <div style="font-size: 0.78rem; color: #71717a; margin-top: 4px;">Daftar Pemilih Tetap</div>
      </div>
    </div>

    <div class="card">
      <div class="card-body">
        <span class="stat-label">Suara Masuk</span>
        <h3 class="stat-value" style="font-size: 1.8rem; font-weight: 800; color: #18181b; margin-top: 0.25rem;">
          ${totalVoted.toLocaleString('id-ID')}
        </h3>
        <div style="font-size: 0.78rem; color: #71717a; margin-top: 4px;">Suara Sah Tercatat</div>
      </div>
    </div>

    <div class="card">
      <div class="card-body">
        <span class="stat-label">Belum Memilih</span>
        <h3 class="stat-value" style="font-size: 1.8rem; font-weight: 800; color: #71717a; margin-top: 0.25rem;">
          ${totalUnvoted.toLocaleString('id-ID')}
        </h3>
        <div style="font-size: 0.78rem; color: #71717a; margin-top: 4px;">Sisa Pemilih Terdaftar</div>
      </div>
    </div>

    <div class="card">
      <div class="card-body">
        <span class="stat-label">Tingkat Partisipasi</span>
        <h3 class="stat-value" style="font-size: 1.8rem; font-weight: 800; color: #18181b; margin-top: 0.25rem;">
          ${rate}%
        </h3>
        <div style="font-size: 0.78rem; color: #71717a; margin-top: 4px;">Partisipasi Pemilih</div>
      </div>
    </div>
  `;
}

function renderWinnerCard(container, leader, election, stats) {
  if (!container) return;

  const isClosed = election.status === 'closed';

  if (!leader || stats.total_voted === 0) {
    container.innerHTML = `
      <div class="card mb-4">
        <div class="card-body text-center" style="padding: 2rem 1rem;">
          <h4 style="font-family: 'Outfit', sans-serif; font-size: 1.1rem; font-weight: 700; color: #18181b; margin-bottom: 0.25rem;">
            Menunggu Suara Masuk
          </h4>
          <p style="font-size: 0.85rem; color: #71717a; margin: 0;">
            Data perolehan suara tertinggi akan ditampilkan setelah suara masuk tercatat.
          </p>
        </div>
      </div>
    `;
    return;
  }

  const numDisplay = String(leader.nomor_urut).padStart(2, '0');
  const title = isClosed ? 'Ketua Umum Terpilih' : 'Perolehan Suara Tertinggi Sementara';
  const subtext = isClosed ? 'Keputusan Akhir' : 'Data Sementara';

  container.innerHTML = `
    <div class="card mb-4">
      <div class="card-header" style="display: flex; justify-content: space-between; align-items: center;">
        <h3>${title}</h3>
        <span style="font-size: 0.8rem; color: #71717a;">${subtext}</span>
      </div>
      <div class="card-body" style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 1.5rem;">
        <div style="display: flex; align-items: center; gap: 1.25rem;">
          <div style="width: 64px; height: 64px; border-radius: 4px; background: #f8f9fa; border: 1px solid var(--border-color); overflow: hidden; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">
            ${leader.foto_url
      ? `<img src="${leader.foto_url}" alt="Foto Calon" style="width: 100%; height: 100%; object-fit: cover;">`
      : `<i class="fa-solid fa-user" style="font-size: 1.8rem; color: #71717a;"></i>`
    }
          </div>
          <div>
            <div style="font-size: 0.75rem; font-weight: 700; color: #71717a; text-transform: uppercase;">Calon Nomor ${numDisplay}</div>
            <h4 style="font-family: 'Outfit', sans-serif; font-size: 1.3rem; font-weight: 800; color: #18181b; margin: 2px 0 2px 0;">
              ${escapeHtml(leader.nama_calon)}
            </h4>
            <div style="font-size: 0.82rem; color: #71717a;">
              ${leader.nim ? `NIM ${escapeHtml(leader.nim)}, ` : ''}${escapeHtml(leader.prodi || 'UKM IPTEK')}
            </div>
          </div>
        </div>
        <div style="text-align: right;">
          <div style="font-family: 'Outfit', sans-serif; font-size: 2rem; font-weight: 800; color: #18181b; line-height: 1;">
            ${leader.vote_count.toLocaleString('id-ID')} Suara
          </div>
          <div style="font-size: 0.85rem; color: #71717a; margin-top: 4px;">
            ${leader.percentage}% dari total suara masuk
          </div>
        </div>
      </div>
    </div>
  `;
}

function renderLeaderboardTable(tableBody, candidates) {
  if (!tableBody) return;

  if (!candidates || candidates.length === 0) {
    tableBody.innerHTML = `
      <tr>
        <td colspan="5" class="text-center" style="padding: 1.5rem; color: #71717a;">Belum ada data calon.</td>
      </tr>
    `;
    return;
  }

  tableBody.innerHTML = candidates.map(c => {
    const numDisplay = String(c.nomor_urut).padStart(2, '0');
    return `
      <tr>
        <td style="text-align: center; font-weight: 700; color: #18181b;">${numDisplay}</td>
        <td style="font-weight: 600; color: #18181b;">${escapeHtml(c.nama_calon)}</td>
        <td style="color: #4b5563;">${escapeHtml(c.prodi || '-')}</td>
        <td style="text-align: right; font-weight: 700; color: #18181b;">${c.vote_count.toLocaleString('id-ID')}</td>
        <td style="text-align: right; font-weight: 600; color: #18181b;">${c.percentage}%</td>
      </tr>
    `;
  }).join('');
}

// ==========================================
// RENDER GRAFIK CHART.JS (BAR MINIMALIS)
// ==========================================
function renderElectionCharts(chartData, stats) {
  if (typeof window.Chart === 'undefined') {
    return;
  }

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
          backgroundColor: '#18181b',
          borderRadius: 4,
          barPercentage: 0.5,
          categoryPercentage: 0.7
        }]
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            display: false
          },
          tooltip: {
            backgroundColor: '#18181b',
            titleFont: { family: 'Outfit', size: 12, weight: 'bold' },
            bodyFont: { family: 'Inter', size: 12 },
            padding: 8,
            cornerRadius: 4,
            callbacks: {
              label: function (context) {
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
}

// ==========================================
// 3. PANEL PANITIA PEMILIHAN
// ==========================================
export async function loadPanitiaData() {
  await loadElectionData();
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
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status, judul, periode, deskripsi })
    });

    const result = await res.json();
    if (result.status === 'success') {
      currentElection = result.data;
      renderPanitiaElectionSettings();
      await loadElectionData();
      alert(result.message || 'Pengaturan berhasil diperbarui.');
    } else {
      alert(result.message || 'Gagal memperbarui pengaturan.');
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
        <td colspan="5" class="text-center" style="padding: 1.5rem; color: #71717a;">
          Belum ada calon ketua umum. Gunakan tombol Tambah Calon di atas.
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = currentCandidates.map(c => {
    const numDisplay = String(c.nomor_urut).padStart(2, '0');
    return `
      <tr>
        <td style="text-align: center; font-weight: 700; color: #18181b;">${numDisplay}</td>
        <td>
          <strong style="color: #18181b; font-size: 0.9rem; display: block;">${escapeHtml(c.nama_calon)}</strong>
          <small style="color: #71717a; font-size: 0.78rem;">${c.nim ? `NIM ${escapeHtml(c.nim)}, ` : ''}${escapeHtml(c.prodi || '-')}</small>
        </td>
        <td style="max-width: 200px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: #4b5563;">
          ${escapeHtml(c.visi || '-')}
        </td>
        <td style="max-width: 200px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: #4b5563;">
          ${escapeHtml(c.misi || '-')}
        </td>
        <td style="text-align: right; white-space: nowrap;">
          <button onclick="openEditCandidateModal(${c.id})" class="btn btn-outline" style="padding: 0.35rem 0.65rem; font-size: 0.8rem; margin-right: 4px;">
            Edit
          </button>
          <button onclick="confirmDeleteCandidate(${c.id}, '${escapeHtml(c.nama_calon)}')" class="btn btn-outline" style="padding: 0.35rem 0.65rem; font-size: 0.8rem; color: #dc2626;">
            Hapus
          </button>
        </td>
      </tr>
    `;
  }).join('');
}

export function openAddCandidateModal() {
  const modal = document.getElementById('modal-candidate-form');
  const title = document.getElementById('modal-candidate-form-title');
  const form = document.getElementById('form-candidate-crud');
  if (!modal || !form) return;

  form.reset();
  document.getElementById('candidate-form-id').value = '';
  if (title) title.textContent = 'Pendaftaran Calon Ketua Umum';

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

  if (title) title.textContent = 'Edit Calon Ketua Umum';
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
      alert(result.message || 'Data calon berhasil disimpan.');
      closeCandidateFormModal();
      await loadElectionData();
      renderPanitiaCandidatesTable();
    } else {
      alert(result.message || 'Gagal menyimpan calon.');
    }
  } catch (err) {
    console.error('submitCandidateForm error:', err);
    alert('Terjadi kesalahan jaringan.');
  }
}

export async function confirmDeleteCandidate(candidateId, candidateName) {
  if (!confirm(`Hapus calon "${candidateName}" beserta seluruh suara yang telah masuk?`)) {
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
    alert('Terjadi kesalahan jaringan.');
  }
}

// Rekapitulasi & Audit Pemilih
export async function loadVotersAudit() {
  const tbody = document.getElementById('panitia-audit-table-body');
  if (!tbody || !currentElection) return;

  try {
    tbody.innerHTML = `
      <tr>
        <td colspan="5" class="text-center" style="padding: 1.5rem; color: #71717a;">
          Memuat daftar pemilih...
        </td>
      </tr>
    `;

    const res = await fetchAuth(`${API_BASE}/elections/${currentElection.id}/voters`);
    const result = await res.json();

    if (result.status !== 'success' || !result.data) {
      tbody.innerHTML = `<tr><td colspan="5" class="text-center" style="color:#dc2626; padding:1.5rem;">${result.message || 'Gagal memuat pemilih.'}</td></tr>`;
      return;
    }

    const { voters } = result.data;
    votersAuditData = voters || [];
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
        <td colspan="5" class="text-center" style="padding: 1.5rem; color: #71717a;">
          Tidak ada data pemilih yang sesuai kriteria.
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
          <strong style="color: #18181b; font-size: 0.9rem; display: block;">${escapeHtml(v.nama_lengkap)}</strong>
          <small style="color: #71717a; font-size: 0.78rem;">${escapeHtml(v.username)}</small>
        </td>
        <td>
          <span style="font-size: 0.8rem; text-transform: uppercase; color: #18181b;">${escapeHtml(v.role)}</span>
          ${v.divisi ? `<small style="color: #71717a; display: block; font-size: 0.75rem;">${escapeHtml(v.divisi)}</small>` : ''}
        </td>
        <td style="text-align: center;">
          <span style="font-size: 0.8rem; font-weight: 600; color: ${v.has_voted ? '#18181b' : '#71717a'};">
            ${v.has_voted ? 'Sudah Memilih' : 'Belum Memilih'}
          </span>
        </td>
        <td style="font-size: 0.85rem; color: #71717a; text-align: center;">
          ${formattedDate}
        </td>
      </tr>
    `;
  }).join('');
}

export function exportVotersCsv() {
  if (!votersAuditData || votersAuditData.length === 0) {
    alert('Tidak ada data pemilih untuk diekspor.');
    return;
  }

  let csv = 'No,Nama Lengkap,Username,Peran,Divisi,Status Memilih,Waktu Memilih\r\n';
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

export async function confirmResetVotes() {
  if (!currentElection) return;

  const code = prompt('Tindakan ini akan mereset seluruh suara masuk kembali ke 0.\nKetik kata "RESET" untuk mengonfirmasi:');
  if (code !== 'RESET') {
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

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
