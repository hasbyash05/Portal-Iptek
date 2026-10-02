const { sequelize, AttendanceSession, User } = require('../models');

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
      activated_at: new Date(),
      attendance_mode: 'onsite'
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
 * PUT /api/attendance/session/mode
 * Ketua mengubah mode presensi (onsite / anywhere).
 */
const setAttendanceMode = async (req, res) => {
  try {
    const { mode } = req.body;
    if (!mode || !['onsite', 'anywhere'].includes(mode)) {
      return res.status(400).json({
        status: 'error',
        message: 'Mode tidak valid. Pilihan: onsite (di tempat) atau anywhere (dimana saja).'
      });
    }

    const session = await AttendanceSession.findOne({ where: { is_active: true } });
    if (!session) {
      return res.status(400).json({
        status: 'error',
        message: 'Tidak ada sesi presensi yang sedang aktif. Buka sesi terlebih dahulu sebelum mengubah mode.',
        code: 'NO_ACTIVE_SESSION'
      });
    }

    try {
      session.attendance_mode = mode;
      await session.save();
    } catch (saveErr) {
      console.warn('[SESSION] Gagal update via model, mencoba migrasi kolom & raw SQL:', saveErr.message);
      try {
        await sequelize.query("ALTER TABLE `attendance_sessions` ADD COLUMN `attendance_mode` ENUM('onsite','anywhere') NOT NULL DEFAULT 'onsite'");
      } catch (alterErr) {
        // Kolom mungkin sudah ada
      }
      await sequelize.query("UPDATE `attendance_sessions` SET `attendance_mode` = :mode WHERE `id` = :id", {
        replacements: { mode, id: session.id }
      });
    }

    const modeLabel = mode === 'onsite' ? 'Di Tempat (GPS 100m)' : 'Dimana Saja';
    return res.status(200).json({
      status: 'success',
      message: `Mode presensi berhasil diubah ke: ${modeLabel}.`,
      data: { attendance_mode: mode }
    });
  } catch (error) {
    console.error('[SESSION ERROR] setAttendanceMode:', error);
    return res.status(500).json({
      status: 'error',
      message: 'Terjadi kesalahan saat mengubah mode presensi.'
    });
  }
};

/**
 * GET /api/attendance/session/status
 * Mengecek status sesi presensi saat ini (semua user yang login).
 */
const getSessionStatus = async (req, res) => {
  try {
    let session;
    try {
      session = await AttendanceSession.findOne({
        where: { is_active: true },
        include: [{
          model: User,
          as: 'activator',
          attributes: ['id', 'nama_lengkap', 'divisi']
        }]
      });
    } catch (queryErr) {
      // Fallback jika kolom attendance_mode belum ada di database
      console.warn('[SESSION] Fallback query (kolom attendance_mode mungkin belum ada):', queryErr.message);
      const [rows] = await sequelize.query(
        "SELECT s.id, s.is_active, s.activated_by, s.activated_at, u.id AS `activator.id`, u.nama_lengkap AS `activator.nama_lengkap`, u.divisi AS `activator.divisi` FROM attendance_sessions s LEFT JOIN users u ON s.activated_by = u.id WHERE s.is_active = 1 LIMIT 1",
        { type: sequelize.QueryTypes.SELECT }
      );
      if (rows) {
        session = {
          ...rows,
          attendance_mode: 'onsite',
          activator: rows['activator.id'] ? {
            id: rows['activator.id'],
            nama_lengkap: rows['activator.nama_lengkap'],
            divisi: rows['activator.divisi']
          } : null
        };
      }
    }

    return res.status(200).json({
      status: 'success',
      data: {
        is_active: !!session,
        attendance_mode: (session && session.attendance_mode) || 'onsite',
        session: session || null
      }
    });
  } catch (error) {
    console.error('[SESSION STATUS ERROR]', error.message);
    return res.status(500).json({
      status: 'error',
      message: 'Terjadi kesalahan saat mengecek status sesi presensi.'
    });
  }
};

module.exports = { openSession, closeSession, setAttendanceMode, getSessionStatus };

