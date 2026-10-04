const { Op } = require('sequelize');
const { Payment, User, KasExpense } = require('../models');
const { verifyPaymentProof } = require('../services/aiVerificationService');

const submitPayment = async (req, res) => {
  try {
    const { month, year } = req.body;
    if (!month || !year) {
      return res.status(400).json({
        status: 'error',
        message: 'Bulan (month) dan tahun (year) pembayaran wajib diisi.'
      });
    }

    const monthNum = parseInt(month);
    const yearNum = parseInt(year);

    if (monthNum < 1 || monthNum > 12) {
      return res.status(400).json({
        status: 'error',
        message: 'Bulan harus bernilai antara 1 hingga 12.'
      });
    }

    const userId = req.user.id;

    // Check existing payment
    const existing = await Payment.findOne({
      where: {
        user_id: userId,
        month: monthNum,
        year: yearNum
      }
    });

    // Jika ada record lama yang masih berstatus pending tapi tidak ada file bukti,
    // otomatis ubah jadi ditolak agar user dapat mengajukan ulang dengan bukti sah
    if (existing && existing.status === 'pending' && (!existing.proof_path || !existing.proof_path.startsWith('/uploads'))) {
      existing.status = 'ditolak';
      existing.ai_status = 'ditolak';
      existing.ai_notes = 'Ditolak otomatis oleh AI: Tidak ada file gambar bukti pembayaran yang dilampirkan.';
      await existing.save();
    }

    if (existing && (existing.status === 'pending' || existing.status === 'lunas')) {
      return res.status(409).json({
        status: 'error',
        message: `Anda sudah mengajukan atau melunasi kas untuk Bulan ${monthNum} Tahun ${yearNum} (Status: ${existing.status}).`,
        code: 'PAYMENT_ALREADY_EXISTS'
      });
    }

    const proofPath = req.file ? `/uploads/proofs/${req.file.filename}` : null;

    // Force amount to 10000 regardless of client input
    const paymentData = {
      user_id: userId,
      amount: 10000,
      month: monthNum,
      year: yearNum,
      proof_path: proofPath,
      status: 'pending',
      confirmed_by: null,
      confirmed_at: null,
      ai_status: null,
      ai_notes: null,
      sender_name_detected: null
    };

    let responseMessage = 'Pengajuan pembayaran kas berhasil dikirim.';

    // =========================================================================
    // ATURAN VERIFIKASI:
    // 1. Jika TIDAK ADA file gambar bukti yang diunggah -> LANGSUNG DITOLAK OTOMATIS
    // =========================================================================
    if (!req.file) {
      paymentData.status = 'ditolak';
      paymentData.ai_status = 'ditolak';
      paymentData.ai_notes = 'Ditolak otomatis oleh AI: Tidak ada file gambar bukti transfer yang dilampirkan.';
      paymentData.confirmed_at = new Date();
      paymentData.confirmed_by = null;
      responseMessage = 'PEMBAYARAN DITOLAK OTOMATIS OLEH AI:\n\nAnda tidak melampirkan file gambar bukti transfer pembayaran kas. Pembayaran langsung ditolak.';
    } else {
      // 2. Jalankan verifikasi AI otomatis jika ada file bukti pembayaran gambar
      try {
        const user = await User.findByPk(userId);
        const userAccountName = user ? user.nama_lengkap : (req.user ? req.user.nama_lengkap : '');
        const aiResult = await verifyPaymentProof(proofPath, userAccountName);

        if (aiResult) {
          paymentData.ai_status = aiResult.decision;
          paymentData.ai_notes = aiResult.notes;
          paymentData.sender_name_detected = aiResult.senderName || null;

          if (aiResult.decision === 'lunas') {
            paymentData.status = 'lunas';
            paymentData.confirmed_at = new Date();
            paymentData.confirmed_by = null; // Terverifikasi otomatis oleh AI
            responseMessage = `PEMBAYARAN DIVERIFIKASI OTOMATIS OLEH AI (LUNAS)!\n\nNominal Rp ${aiResult.amount.toLocaleString('id-ID')} dan nama pengirim "${aiResult.senderName}" cocok dengan nama akun Anda. Gerbang presensi Anda kini terbuka.`;
          } else if (aiResult.decision === 'ditolak') {
            paymentData.status = 'ditolak';
            paymentData.confirmed_at = new Date();
            paymentData.confirmed_by = null;
            responseMessage = `PEMBAYARAN DITOLAK OTOMATIS OLEH AI:\n\n${aiResult.notes}\nSilakan periksa kembali dan unggah bukti transfer yang sesuai.`;
          } else {
            // 'pending': biarkan verifikasi manual oleh bendahara jika nama beda
            paymentData.status = 'pending';
            responseMessage = `Pembayaran kas berhasil dikirim!\n\nCatatan AI: ${aiResult.notes}`;
          }
        }
      } catch (aiErr) {
        console.warn('[AI Verification Warning]:', aiErr.message);
      }
    }

    let payment;
    if (existing && existing.status === 'ditolak') {
      // Update the rejected one
      existing.amount = 10000;
      existing.proof_path = proofPath || existing.proof_path;
      existing.status = paymentData.status;
      existing.confirmed_by = paymentData.confirmed_by;
      existing.confirmed_at = paymentData.confirmed_at;
      existing.ai_status = paymentData.ai_status;
      existing.ai_notes = paymentData.ai_notes;
      existing.sender_name_detected = paymentData.sender_name_detected;
      await existing.save();
      payment = existing;
    } else {
      payment = await Payment.create(paymentData);
    }

    return res.status(201).json({
      status: 'success',
      message: responseMessage,
      data: payment
    });
  } catch (error) {
    return res.status(500).json({
      status: 'error',
      message: 'Terjadi kesalahan saat mengajukan pembayaran kas.',
      error: error.message
    });
  }
};

const checkStatus = async (req, res) => {
  try {
    const { month, year } = req.query;
    const currentMonth = month ? parseInt(month) : new Date().getMonth() + 1;
    const currentYear = year ? parseInt(year) : new Date().getFullYear();

    // Auto-reject jika ada pengajuan pending tanpa gambar bukti
    try {
      await Payment.update(
        {
          status: 'ditolak',
          ai_status: 'ditolak',
          ai_notes: 'Ditolak otomatis oleh AI: Anggota tidak melampirkan file gambar bukti pembayaran.'
        },
        {
          where: {
            user_id: req.user.id,
            month: currentMonth,
            year: currentYear,
            status: 'pending',
            [Op.or]: [
              { proof_path: null },
              { proof_path: { [Op.notLike]: '/uploads%' } }
            ]
          }
        }
      );
    } catch (cleanErr) {
      console.warn('Auto-reject clean error in checkStatus:', cleanErr.message);
    }

    const payment = await Payment.findOne({
      where: {
        user_id: req.user.id,
        month: currentMonth,
        year: currentYear
      },
      order: [['id', 'DESC']]
    });

    const isBendahara = req.user.role === 'pengurus' && req.user.divisi && req.user.divisi.toLowerCase().includes('bendahara');
    const isExempt = req.user.role === 'admin' || isBendahara;

    return res.status(200).json({
      status: 'success',
      data: {
        hasPaid: isExempt || (payment && payment.status === 'lunas'),
        month: currentMonth,
        year: currentYear,
        payment: payment || null
      }
    });
  } catch (error) {
    return res.status(500).json({
      status: 'error',
      message: 'Terjadi kesalahan saat mengecek status kas.',
      error: error.message
    });
  }
};

const getMyHistory = async (req, res) => {
  try {
    // Otomatis ubah status pending lama yang tidak memiliki bukti gambar menjadi 'ditolak'
    try {
      await Payment.update(
        {
          status: 'ditolak',
          ai_status: 'ditolak',
          ai_notes: 'Ditolak otomatis oleh AI: Tidak ada file gambar bukti pembayaran yang dilampirkan.'
        },
        {
          where: {
            user_id: req.user.id,
            status: 'pending',
            [Op.or]: [
              { proof_path: null },
              { proof_path: { [Op.notLike]: '/uploads%' } }
            ]
          }
        }
      );
    } catch (cleanErr) {
      console.warn('Auto-reject clean error:', cleanErr.message);
    }

    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const offset = (page - 1) * limit;

    const { count, rows } = await Payment.findAndCountAll({
      where: { user_id: req.user.id },
      order: [['year', 'DESC'], ['month', 'DESC']],
      limit,
      offset
    });

    return res.status(200).json({
      status: 'success',
      data: {
        total: count,
        page,
        totalPages: Math.ceil(count / limit),
        items: rows
      }
    });
  } catch (error) {
    return res.status(500).json({
      status: 'error',
      message: 'Terjadi kesalahan saat mengambil riwayat pembayaran.',
      error: error.message
    });
  }
};

const confirmPayment = async (req, res) => {
  try {
    if (!req.user || req.user.role !== 'pengurus' || !req.user.divisi || !req.user.divisi.toLowerCase().includes('bendahara')) {
      return res.status(403).json({
        status: 'error',
        message: 'Akses ditolak. Verifikasi lunas/ditolak uang kas hanya berhak dilakukan oleh Pengurus bagian Bendahara.'
      });
    }

    const { id } = req.params;
    const { status } = req.body;

    if (!status || !['lunas', 'ditolak'].includes(status)) {
      return res.status(400).json({
        status: 'error',
        message: 'Status verifikasi harus bernilai "lunas" atau "ditolak".'
      });
    }

    const payment = await Payment.findByPk(id);
    if (!payment) {
      return res.status(404).json({
        status: 'error',
        message: 'Data pembayaran tidak ditemukan.'
      });
    }

    payment.status = status;
    payment.confirmed_by = req.user.id;
    payment.confirmed_at = new Date();
    await payment.save();

    return res.status(200).json({
      status: 'success',
      message: `Pembayaran kas berhasil diperbarui menjadi '${status}'.`,
      data: payment
    });
  } catch (error) {
    return res.status(500).json({
      status: 'error',
      message: 'Terjadi kesalahan saat memverifikasi pembayaran.',
      error: error.message
    });
  }
};

const getReport = async (req, res) => {
  try {
    // Otomatis ubah status pembayaran pending lama tanpa gambar bukti menjadi 'ditolak'
    try {
      await Payment.update(
        {
          status: 'ditolak',
          ai_status: 'ditolak',
          ai_notes: 'Ditolak otomatis oleh AI: Anggota tidak melampirkan file gambar bukti pembayaran.'
        },
        {
          where: {
            status: 'pending',
            [Op.or]: [
              { proof_path: null },
              { proof_path: { [Op.notLike]: '/uploads%' } }
            ]
          }
        }
      );
    } catch (cleanErr) {
      console.warn('Auto-reject clean error in getReport:', cleanErr.message);
    }

    const { month, year, status } = req.query;
    const whereClause = {};

    if (month) whereClause.month = parseInt(month);
    if (year) whereClause.year = parseInt(year);
    if (status) whereClause.status = status;

    const payments = await Payment.findAll({
      where: whereClause,
      include: [
        {
          model: User,
          as: 'user',
          attributes: ['id', 'username', 'nama_lengkap', 'role', 'divisi']
        },
        {
          model: User,
          as: 'verifier',
          attributes: ['id', 'nama_lengkap']
        }
      ],
      order: [['year', 'DESC'], ['month', 'DESC'], ['created_at', 'DESC']]
    });

    return res.status(200).json({
      status: 'success',
      data: {
        total: payments.length,
        items: payments
      }
    });
  } catch (error) {
    return res.status(500).json({
      status: 'error',
      message: 'Terjadi kesalahan saat mengambil laporan pembayaran.',
      error: error.message
    });
  }
};

const getTotalKas = async (req, res) => {
  try {
    const totalKasMasuk = await Payment.sum('amount', {
      where: { status: 'lunas' }
    }) || 0;
    
    const totalKasKeluar = await KasExpense.sum('amount') || 0;
    const total = totalKasMasuk - totalKasKeluar;

    return res.status(200).json({
      status: 'success',
      data: {
        total: total || 0
      }
    });
  } catch (error) {
    return res.status(500).json({
      status: 'error',
      message: 'Terjadi kesalahan saat mengambil total kas.',
      error: error.message
    });
  }
};

const verifyPaymentWithAI = async (req, res) => {
  try {
    const { id } = req.params;
    const payment = await Payment.findByPk(id, {
      include: [{ model: User, as: 'user', attributes: ['id', 'nama_lengkap', 'username'] }]
    });

    if (!payment) {
      return res.status(404).json({
        status: 'error',
        message: 'Data pembayaran kas tidak ditemukan.'
      });
    }

    if (!payment.proof_path || !payment.proof_path.startsWith('/uploads')) {
      return res.status(400).json({
        status: 'error',
        message: 'Pembayaran ini tidak memiliki file gambar bukti transfer yang dapat dianalisis AI.'
      });
    }

    const userName = payment.user ? payment.user.nama_lengkap : '';
    const aiResult = await verifyPaymentProof(payment.proof_path, userName);

    payment.ai_status = aiResult.decision;
    payment.ai_notes = aiResult.notes;
    payment.sender_name_detected = aiResult.senderName || null;

    if (aiResult.decision === 'lunas') {
      payment.status = 'lunas';
      payment.confirmed_at = new Date();
      payment.confirmed_by = null;
    } else if (aiResult.decision === 'ditolak') {
      payment.status = 'ditolak';
      payment.confirmed_at = new Date();
      payment.confirmed_by = null;
    } else {
      payment.status = 'pending';
    }

    await payment.save();

    return res.status(200).json({
      status: 'success',
      message: `Hasil Verifikasi AI: ${aiResult.notes}`,
      data: {
        payment,
        aiResult
      }
    });
  } catch (error) {
    return res.status(500).json({
      status: 'error',
      message: 'Gagal memproses verifikasi AI.',
      error: error.message
    });
  }
};

const verifyAllPendingWithAI = async (req, res) => {
  try {
    const pendingPayments = await Payment.findAll({
      where: {
        status: 'pending'
      },
      include: [{ model: User, as: 'user', attributes: ['id', 'nama_lengkap'] }]
    });

    const eligible = pendingPayments.filter(p => p.proof_path && p.proof_path.startsWith('/uploads'));

    if (eligible.length === 0) {
      return res.status(200).json({
        status: 'success',
        message: 'Tidak ada pembayaran pending dengan lampiran gambar bukti transfer.',
        data: { total: 0, approved: 0, rejected: 0, keptPending: 0 }
      });
    }

    let approved = 0;
    let rejected = 0;
    let keptPending = 0;
    const results = [];

    for (const payment of eligible) {
      try {
        const userName = payment.user ? payment.user.nama_lengkap : '';
        const aiResult = await verifyPaymentProof(payment.proof_path, userName);

        payment.ai_status = aiResult.decision;
        payment.ai_notes = aiResult.notes;
        payment.sender_name_detected = aiResult.senderName || null;

        if (aiResult.decision === 'lunas') {
          payment.status = 'lunas';
          payment.confirmed_at = new Date();
          payment.confirmed_by = null;
          approved++;
        } else if (aiResult.decision === 'ditolak') {
          payment.status = 'ditolak';
          payment.confirmed_at = new Date();
          payment.confirmed_by = null;
          rejected++;
        } else {
          payment.status = 'pending';
          keptPending++;
        }

        await payment.save();
        results.push({ id: payment.id, user: userName, decision: aiResult.decision, notes: aiResult.notes });
      } catch (err) {
        keptPending++;
        results.push({ id: payment.id, error: err.message });
      }
    }

    return res.status(200).json({
      status: 'success',
      message: `Pemindaian AI selesai: ${approved} Lunas (disetujui), ${rejected} ditolak, ${keptPending} tetap pending untuk verifikasi manual Bendahara.`,
      data: {
        total: eligible.length,
        approved,
        rejected,
        keptPending,
        details: results
      }
    });
  } catch (error) {
    return res.status(500).json({
      status: 'error',
      message: 'Gagal menjalankan pemindaian AI massal.',
      error: error.message
    });
  }
};

module.exports = {
  submitPayment,
  checkStatus,
  getMyHistory,
  confirmPayment,
  getReport,
  getTotalKas,
  verifyPaymentWithAI,
  verifyAllPendingWithAI
};
