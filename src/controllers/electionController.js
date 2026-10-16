const { Election, Candidate, Vote, User, sequelize } = require('../models');
const fs = require('fs');
const path = require('path');

// Ambil atau inisialisasi pemilihan aktif beserta daftar kandidat dan status hak suara user
const getActiveElection = async (req, res) => {
  try {
    let election = await Election.findOne({
      order: [['id', 'DESC']]
    });

    if (!election) {
      election = await Election.create({
        judul: 'Pemilihan Calon Ketua Umum UKM IPTEK',
        periode: '2026/2027',
        deskripsi: 'Musyawarah Besar & Pemilihan Ketua Umum UKM IPTEK STIKES Semarang Periode 2026/2027. Sistem E-Voting terpadu menjamin 1 Akun = 1 Suara secara jujur dan transparan.',
        status: 'active',
        created_by: req.user ? req.user.id : null
      });
    }

    const candidates = await Candidate.findAll({
      where: { election_id: election.id },
      order: [['nomor_urut', 'ASC']]
    });

    let hasVoted = false;
    let votedAt = null;

    if (req.user && req.user.id) {
      const existingVote = await Vote.findOne({
        where: {
          election_id: election.id,
          user_id: req.user.id
        }
      });
      if (existingVote) {
        hasVoted = true;
        votedAt = existingVote.voted_at;
      }
    }

    return res.json({
      status: 'success',
      data: {
        election,
        candidates,
        hasVoted,
        votedAt
      }
    });
  } catch (error) {
    console.error('getActiveElection error:', error);
    return res.status(500).json({
      status: 'error',
      message: 'Gagal memuat data pemilihan: ' + error.message
    });
  }
};

// Berikan suara (1 Akun = 1 Suara)
const castVote = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const electionId = req.params.id || req.body.election_id;
    const { candidate_id } = req.body;

    if (!candidate_id) {
      await t.rollback();
      return res.status(400).json({
        status: 'error',
        message: 'Silakan pilih salah satu calon ketua umum terlebih dahulu.'
      });
    }

    const election = await Election.findByPk(electionId, { transaction: t });
    if (!election) {
      await t.rollback();
      return res.status(404).json({
        status: 'error',
        message: 'Sesi pemilihan tidak ditemukan.'
      });
    }

    if (election.status !== 'active') {
      await t.rollback();
      return res.status(400).json({
        status: 'error',
        message: election.status === 'closed'
          ? 'Bilik suara telah ditutup. Pemilihan periode ini telah selesai.'
          : 'Pemilihan belum dibuka oleh panitia.'
      });
    }

    // Verifikasi calon ada di dalam pemilihan ini
    const candidate = await Candidate.findOne({
      where: {
        id: candidate_id,
        election_id: election.id
      },
      transaction: t
    });

    if (!candidate) {
      await t.rollback();
      return res.status(404).json({
        status: 'error',
        message: 'Calon yang dipilih tidak terdaftar dalam pemilihan ini.'
      });
    }

    // Cek apakah akun ini sudah pernah memilih
    const existingVote = await Vote.findOne({
      where: {
        election_id: election.id,
        user_id: req.user.id
      },
      transaction: t
    });

    if (existingVote) {
      await t.rollback();
      return res.status(400).json({
        status: 'error',
        message: 'Anda sudah menggunakan hak suara Anda. Sistem hanya memperbolehkan 1 suara per akun.'
      });
    }

    // Rekam suara
    const ipAddress = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip;
    const userAgent = req.headers['user-agent'] || '';

    const newVote = await Vote.create({
      election_id: election.id,
      candidate_id: candidate.id,
      user_id: req.user.id,
      voted_at: new Date(),
      ip_address: ipAddress,
      user_agent: userAgent.substring(0, 255)
    }, { transaction: t });

    await t.commit();

    return res.json({
      status: 'success',
      message: `Suara Anda untuk Calon No. ${candidate.nomor_urut} (${candidate.nama_calon}) berhasil dicatat secara sah. Terima kasih atas partisipasi Anda!`,
      data: {
        voted_at: newVote.voted_at
      }
    });
  } catch (error) {
    await t.rollback();
    if (error.name === 'SequelizeUniqueConstraintError') {
      return res.status(400).json({
        status: 'error',
        message: 'Anda sudah tercatat memberikan suara pada pemilihan ini.'
      });
    }
    console.error('castVote error:', error);
    return res.status(500).json({
      status: 'error',
      message: 'Gagal merekam suara: ' + error.message
    });
  }
};

// Monitoring & Hasil Quick Count Real-time
const getMonitoringStats = async (req, res) => {
  try {
    let election;
    if (req.params.id) {
      election = await Election.findByPk(req.params.id);
    } else {
      election = await Election.findOne({ order: [['id', 'DESC']] });
    }

    if (!election) {
      return res.status(404).json({
        status: 'error',
        message: 'Data pemilihan tidak ditemukan.'
      });
    }

    // Hitung total DPT (seluruh akun user terdaftar di portal)
    const totalDpt = await User.count();

    // Hitung total suara masuk
    const totalVoted = await Vote.count({
      where: { election_id: election.id }
    });

    const totalUnvoted = Math.max(0, totalDpt - totalVoted);
    const participationRate = totalDpt > 0 ? Number(((totalVoted / totalDpt) * 100).toFixed(1)) : 0;

    // Ambil daftar kandidat beserta jumlah suaranya
    const candidates = await Candidate.findAll({
      where: { election_id: election.id },
      order: [['nomor_urut', 'ASC']]
    });

    const candidateStats = await Promise.all(candidates.map(async (c) => {
      const voteCount = await Vote.count({
        where: {
          election_id: election.id,
          candidate_id: c.id
        }
      });
      const percentage = totalVoted > 0 ? Number(((voteCount / totalVoted) * 100).toFixed(1)) : 0;
      return {
        id: c.id,
        nomor_urut: c.nomor_urut,
        nama_calon: c.nama_calon,
        nim: c.nim,
        prodi: c.prodi,
        visi: c.visi,
        misi: c.misi,
        program_unggulan: c.program_unggulan,
        foto_url: c.foto_url,
        vote_count: voteCount,
        percentage
      };
    }));

    // Urutkan kandidat berdasarkan suara terbanyak (peringkat 1, 2, dst)
    const sortedLeaderboard = [...candidateStats].sort((a, b) => b.vote_count - a.vote_count || a.nomor_urut - b.nomor_urut);

    // Tentukan pemimpin suara / pemenang
    let leader = null;
    if (sortedLeaderboard.length > 0) {
      const top = sortedLeaderboard[0];
      const runnerUp = sortedLeaderboard[1] || null;
      const leadMargin = runnerUp ? top.vote_count - runnerUp.vote_count : top.vote_count;
      const isTie = runnerUp && runnerUp.vote_count === top.vote_count && top.vote_count > 0;

      leader = {
        ...top,
        lead_margin: leadMargin,
        is_tie: isTie,
        is_winner: election.status === 'closed' && top.vote_count > 0 && !isTie
      };
    }

    // Format dataset grafik Chart.js
    const chartData = {
      labels: candidateStats.map(c => `No. ${c.nomor_urut} - ${c.nama_calon}`),
      shortLabels: candidateStats.map(c => `No. ${c.nomor_urut}`),
      votes: candidateStats.map(c => c.vote_count),
      percentages: candidateStats.map(c => c.percentage),
      colors: ['#18181b', '#3f3f46', '#71717a', '#a1a1aa', '#d4d4d8', '#27272a']
    };

    return res.json({
      status: 'success',
      data: {
        election,
        stats: {
          total_dpt: totalDpt,
          total_voted: totalVoted,
          total_unvoted: totalUnvoted,
          participation_rate: participationRate
        },
        candidates: sortedLeaderboard,
        leader,
        chart_data: chartData,
        last_updated: new Date()
      }
    });
  } catch (error) {
    console.error('getMonitoringStats error:', error);
    return res.status(500).json({
      status: 'error',
      message: 'Gagal memuat monitoring suara: ' + error.message
    });
  }
};

// Tambah Calon Baru (Panitia / Admin)
const addCandidate = async (req, res) => {
  try {
    const electionId = req.params.id || req.body.election_id;
    const { nomor_urut, nama_calon, nim, prodi, visi, misi, program_unggulan } = req.body;

    if (!nomor_urut || !nama_calon || !visi || !misi) {
      return res.status(400).json({
        status: 'error',
        message: 'Nomor urut, nama calon, visi, dan misi wajib diisi.'
      });
    }

    const election = await Election.findByPk(electionId);
    if (!election) {
      return res.status(404).json({
        status: 'error',
        message: 'Sesi pemilihan tidak ditemukan.'
      });
    }

    // Cek nomor urut duplikat
    const existing = await Candidate.findOne({
      where: {
        election_id: election.id,
        nomor_urut: parseInt(nomor_urut, 10)
      }
    });

    if (existing) {
      return res.status(400).json({
        status: 'error',
        message: `Nomor urut ${nomor_urut} sudah digunakan oleh calon ${existing.nama_calon}.`
      });
    }

    let fotoUrl = null;
    if (req.file) {
      fotoUrl = `/uploads/candidates/${req.file.filename}`;
    }

    const candidate = await Candidate.create({
      election_id: election.id,
      nomor_urut: parseInt(nomor_urut, 10),
      nama_calon: nama_calon.trim(),
      nim: nim ? nim.trim() : null,
      prodi: prodi ? prodi.trim() : null,
      visi: visi.trim(),
      misi: misi.trim(),
      program_unggulan: program_unggulan ? program_unggulan.trim() : null,
      foto_url: fotoUrl
    });

    return res.status(201).json({
      status: 'success',
      message: `Calon No. ${candidate.nomor_urut} (${candidate.nama_calon}) berhasil didaftarkan.`,
      data: candidate
    });
  } catch (error) {
    console.error('addCandidate error:', error);
    return res.status(500).json({
      status: 'error',
      message: 'Gagal menambahkan calon: ' + error.message
    });
  }
};

// Perbarui Calon (Panitia / Admin)
const updateCandidate = async (req, res) => {
  try {
    const { candidateId } = req.params;
    const { nomor_urut, nama_calon, nim, prodi, visi, misi, program_unggulan } = req.body;

    const candidate = await Candidate.findByPk(candidateId);
    if (!candidate) {
      return res.status(404).json({
        status: 'error',
        message: 'Calon tidak ditemukan.'
      });
    }

    if (nomor_urut && parseInt(nomor_urut, 10) !== candidate.nomor_urut) {
      const existing = await Candidate.findOne({
        where: {
          election_id: candidate.election_id,
          nomor_urut: parseInt(nomor_urut, 10)
        }
      });
      if (existing && existing.id !== candidate.id) {
        return res.status(400).json({
          status: 'error',
          message: `Nomor urut ${nomor_urut} sudah digunakan oleh calon lain.`
        });
      }
      candidate.nomor_urut = parseInt(nomor_urut, 10);
    }

    if (nama_calon) candidate.nama_calon = nama_calon.trim();
    if (nim !== undefined) candidate.nim = nim ? nim.trim() : null;
    if (prodi !== undefined) candidate.prodi = prodi ? prodi.trim() : null;
    if (visi) candidate.visi = visi.trim();
    if (misi) candidate.misi = misi.trim();
    if (program_unggulan !== undefined) candidate.program_unggulan = program_unggulan ? program_unggulan.trim() : null;

    if (req.file) {
      // Hapus foto lama jika ada
      if (candidate.foto_url) {
        const oldPath = path.join(__dirname, '../../public', candidate.foto_url);
        if (fs.existsSync(oldPath)) {
          try { fs.unlinkSync(oldPath); } catch (e) { /* ignore */ }
        }
      }
      candidate.foto_url = `/uploads/candidates/${req.file.filename}`;
    }

    await candidate.save();

    return res.json({
      status: 'success',
      message: `Data Calon No. ${candidate.nomor_urut} berhasil diperbarui.`,
      data: candidate
    });
  } catch (error) {
    console.error('updateCandidate error:', error);
    return res.status(500).json({
      status: 'error',
      message: 'Gagal memperbarui data calon: ' + error.message
    });
  }
};

// Hapus Calon (Panitia / Admin)
const deleteCandidate = async (req, res) => {
  try {
    const { candidateId } = req.params;
    const candidate = await Candidate.findByPk(candidateId);
    if (!candidate) {
      return res.status(404).json({
        status: 'error',
        message: 'Calon tidak ditemukan.'
      });
    }

    if (candidate.foto_url) {
      const oldPath = path.join(__dirname, '../../public', candidate.foto_url);
      if (fs.existsSync(oldPath)) {
        try { fs.unlinkSync(oldPath); } catch (e) { /* ignore */ }
      }
    }

    // Hapus juga suara yang terkait calon ini
    await Vote.destroy({ where: { candidate_id: candidate.id } });
    await candidate.destroy();

    return res.json({
      status: 'success',
      message: `Calon No. ${candidate.nomor_urut} (${candidate.nama_calon}) berhasil dihapus.`
    });
  } catch (error) {
    console.error('deleteCandidate error:', error);
    return res.status(500).json({
      status: 'error',
      message: 'Gagal menghapus calon: ' + error.message
    });
  }
};

// Perbarui Status Pemilihan (Panitia / Admin)
const updateElectionStatus = async (req, res) => {
  try {
    const electionId = req.params.id;
    const { status, judul, periode, deskripsi } = req.body || {};

    if (!req.body || typeof req.body !== 'object' || Object.keys(req.body).length === 0) {
      return res.status(400).json({
        status: 'error',
        message: 'Data pembaruan tidak valid atau kosong.'
      });
    }

    const election = await Election.findByPk(electionId);
    if (!election) {
      return res.status(404).json({
        status: 'error',
        message: 'Pemilihan tidak ditemukan.'
      });
    }

    const cleanStatus = status ? String(status).trim().toLowerCase() : null;
    if (cleanStatus && ['draft', 'active', 'closed'].includes(cleanStatus)) {
      election.status = cleanStatus;
    }
    if (judul && typeof judul === 'string' && judul.trim()) {
      election.judul = judul.trim();
    }
    if (periode && typeof periode === 'string' && periode.trim()) {
      election.periode = periode.trim();
    }
    if (deskripsi !== undefined) {
      election.deskripsi = deskripsi ? String(deskripsi).trim() : null;
    }

    await election.save();

    let statusText = 'diperbarui';
    if (election.status === 'active') statusText = 'dibuka untuk pemungutan suara';
    else if (election.status === 'closed') statusText = 'ditutup secara resmi';
    else if (election.status === 'draft') statusText = 'disimpan sebagai draft';

    return res.json({
      status: 'success',
      message: `Status pemilihan berhasil ${statusText}.`,
      data: election
    });
  } catch (error) {
    console.error('updateElectionStatus error:', error);
    return res.status(500).json({
      status: 'error',
      message: 'Gagal memperbarui status pemilihan: ' + error.message
    });
  }
};

// Audit Pemilih (Daftar Akun yang Sudah / Belum Memilih)
// Mematuhi asas LUBER (tidak menampilkan pilihan calon spesifik)
const getVotersAudit = async (req, res) => {
  try {
    const electionId = req.params.id;
    const election = await Election.findByPk(electionId);
    if (!election) {
      return res.status(404).json({
        status: 'error',
        message: 'Pemilihan tidak ditemukan.'
      });
    }

    const users = await User.findAll({
      attributes: ['id', 'username', 'nama_lengkap', 'role', 'divisi'],
      order: [['role', 'ASC'], ['nama_lengkap', 'ASC']]
    });

    const votes = await Vote.findAll({
      where: { election_id: election.id },
      attributes: ['user_id', 'voted_at']
    });

    const voteMap = new Map();
    votes.forEach(v => {
      voteMap.set(v.user_id, v.voted_at);
    });

    const votersList = users.map(u => {
      const isVoted = voteMap.has(u.id);
      return {
        id: u.id,
        username: u.username,
        nama_lengkap: u.nama_lengkap,
        role: u.role,
        divisi: u.divisi,
        has_voted: isVoted,
        voted_at: isVoted ? voteMap.get(u.id) : null
      };
    });

    const totalDpt = votersList.length;
    const totalVoted = votes.length;
    const totalUnvoted = totalDpt - totalVoted;

    return res.json({
      status: 'success',
      data: {
        stats: {
          total_dpt: totalDpt,
          total_voted: totalVoted,
          total_unvoted: totalUnvoted
        },
        voters: votersList
      }
    });
  } catch (error) {
    console.error('getVotersAudit error:', error);
    return res.status(500).json({
      status: 'error',
      message: 'Gagal memuat data audit pemilih: ' + error.message
    });
  }
};

// Reset Seluruh Suara Pemilihan (Hanya Panitia / Admin)
const resetElectionVotes = async (req, res) => {
  try {
    const electionId = req.params.id;
    const election = await Election.findByPk(electionId);
    if (!election) {
      return res.status(404).json({
        status: 'error',
        message: 'Pemilihan tidak ditemukan.'
      });
    }

    const deletedCount = await Vote.destroy({
      where: { election_id: election.id }
    });

    return res.json({
      status: 'success',
      message: `Seluruh perolehan suara (${deletedCount} suara) berhasil direset ke nol.`
    });
  } catch (error) {
    console.error('resetElectionVotes error:', error);
    return res.status(500).json({
      status: 'error',
      message: 'Gagal mereset perolehan suara: ' + error.message
    });
  }
};

module.exports = {
  getActiveElection,
  castVote,
  getMonitoringStats,
  addCandidate,
  updateCandidate,
  deleteCandidate,
  updateElectionStatus,
  getVotersAudit,
  resetElectionVotes
};
