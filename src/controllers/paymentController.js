const { Payment, User } = require('../models');

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

    if (existing && (existing.status === 'pending' || existing.status === 'lunas')) {
      return res.status(409).json({
        status: 'error',
        message: `Anda sudah mengajukan atau melunasi kas untuk Bulan ${monthNum} Tahun ${yearNum} (Status: ${existing.status}).`,
        code: 'PAYMENT_ALREADY_EXISTS'
      });
    }

    const isQris = req.body.payment_method === 'qris';
    const proofPath = req.file ? `/uploads/proofs/${req.file.filename}` : (isQris ? `QRIS (Menunggu Verifikasi Bendahara)` : null);


    // Force amount to 10000 regardless of client input
    const paymentData = {
      user_id: userId,
      amount: 10000,
      month: monthNum,
      year: yearNum,
      proof_path: proofPath,
      status: 'pending',
      confirmed_by: null,
      confirmed_at: null
    };

    let payment;
    if (existing && existing.status === 'ditolak') {
      // Update the rejected one
      existing.amount = 10000;
      existing.proof_path = proofPath || existing.proof_path;
      existing.status = 'pending';
      existing.confirmed_by = null;
      existing.confirmed_at = null;
      await existing.save();
      payment = existing;
    } else {
      payment = await Payment.create(paymentData);
    }

    return res.status(201).json({
      status: 'success',
      message: 'Pengajuan pembayaran kas sebesar Rp 10.000 berhasil dikirim dan menunggu verifikasi dari Pengurus bagian Bendahara.',
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

    const payment = await Payment.findOne({
      where: {
        user_id: req.user.id,
        month: currentMonth,
        year: currentYear
      },
      order: [['id', 'DESC']]
    });

    return res.status(200).json({
      status: 'success',
      data: {
        hasPaid: payment && payment.status === 'lunas',
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

module.exports = { submitPayment, checkStatus, getMyHistory, confirmPayment, getReport };
