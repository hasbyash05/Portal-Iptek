const { AttendanceSession, User } = require('../models');

/**
 * POST /api/attendance/session/open
 * Pengurus membuka sesi presensi.
 */
const openSession = async (req, res) => {
  try {
    // Cek apakah sudah ada sesi aktif
    const existing = await AttendanceSession.findOne({ where: { is_active: true } });
    if (existing) {
      const activator = await User.findByPk(existing.activated_by, { attributes: ['nama_lengkap'] });
      return res.status(409).json({
        status: 'error',
        message: `Sesi presensi sudah aktif (dibuka oleh ${activator ? activator.nama_lengkap : 'Pengurus'}).`,
        code: 'SESSION_ALREADY_ACTIVE'
      });
    }

    const session = await AttendanceSession.create({
      is_active: true,
      activated_by: req.user.id,
      activated_at: new Date()
    });

    return res.status(201).json({
      status: 'success',
      message: 'Sesi presensi berhasil dibuka. Anggota sekarang dapat melakukan absensi.',
      data: session
    });
  } catch (error) {
    return res.status(500).json({
      status: 'error',
      message: 'Terjadi kesalahan saat membuka sesi presensi.'
    });
  }
};

/**
 * POST /api/attendance/session/close
 * Pengurus menutup sesi presensi.
 */
const closeSession = async (req, res) => {
  try {
    const session = await AttendanceSession.findOne({ where: { is_active: true } });
    if (!session) {
      return res.status(400).json({
        status: 'error',
        message: 'Tidak ada sesi presensi yang sedang aktif.',
        code: 'NO_ACTIVE_SESSION'
      });
    }

    session.is_active = false;
    await session.save();

    return res.status(200).json({
      status: 'success',
      message: 'Sesi presensi berhasil ditutup. Anggota tidak dapat melakukan absensi sampai sesi dibuka kembali.',
      data: session
    });
  } catch (error) {
    return res.status(500).json({
      status: 'error',
      message: 'Terjadi kesalahan saat menutup sesi presensi.'
    });
  }
};

/**
 * GET /api/attendance/session/status
 * Mengecek status sesi presensi saat ini (semua user yang login).
 */
const getSessionStatus = async (req, res) => {
  try {
    const session = await AttendanceSession.findOne({
      where: { is_active: true },
      include: [{
        model: User,
        as: 'activator',
        attributes: ['id', 'nama_lengkap', 'divisi']
      }]
    });

    return res.status(200).json({
      status: 'success',
      data: {
        is_active: !!session,
        session: session || null
      }
    });
  } catch (error) {
    return res.status(500).json({
      status: 'error',
      message: 'Terjadi kesalahan saat mengecek status sesi presensi.'
    });
  }
};

module.exports = { openSession, closeSession, getSessionStatus };
