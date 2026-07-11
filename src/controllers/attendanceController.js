const { Attendance, User, Payment } = require('../models');
const { getJakartaDateString } = require('../utils/dateHelper');
const { Op } = require('sequelize');

const submitAttendance = async (req, res) => {
  try {
    const { status, latitude, longitude } = req.body;
    if (status !== 'hadir') {
      return res.status(400).json({
        status: 'error',
        message: 'Gagal absensi: Status kehadiran hanya boleh HADIR.'
      });
    }

    if (latitude === undefined || longitude === undefined || latitude === null || longitude === null) {
      return res.status(400).json({
        status: 'error',
        message: 'Gagal absensi: Koordinat lokasi GPS (latitude & longitude) wajib dikirimkan untuk verifikasi radius pertemuan.'
      });
    }

    // Titik pertemuan: 7°02'02.4"S 110°22'07.8"E
    const targetLat = -7.034000;
    const targetLon = 110.36883333333333;
    const toRad = (val) => (val * Math.PI) / 180;
    const R = 6371000;
    const dLat = toRad(targetLat - latitude);
    const dLon = toRad(targetLon - longitude);
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(toRad(latitude)) * Math.cos(toRad(targetLat)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const distance = R * c;

    if (distance > 10) {
      return res.status(403).json({
        status: 'error',
        message: `Gagal presensi: Lokasi Anda (${distance.toFixed(1)} meter) berada di luar batas radius maksimal 10 meter dari titik koordinat pertemuan UKM Iptek (7°02'02.4"S 110°22'07.8"E).`
      });
    }

    const dateStr = getJakartaDateString();
    const userId = req.user.id;

    // Cek apakah user sudah membayar uang kas bulan berjalan (Wajib LUNAS)
    const currentMonth = new Date().getMonth() + 1;
    const currentYear = new Date().getFullYear();
    const kasPaid = await Payment.findOne({
      where: {
        user_id: userId,
        month: currentMonth,
        year: currentYear,
        status: 'lunas'
      }
    });

    if (!kasPaid) {
      return res.status(403).json({
        status: 'error',
        message: `Gerbang Kas Terkunci: Anda belum melunasi uang kas untuk Bulan ${currentMonth} Tahun ${currentYear} (Rp 10.000). Silakan bayar via QRIS terlebih dahulu agar dapat melakukan presensi.`,
        code: 'KAS_UNPAID_BLOCK'
      });
    }

    const existing = await Attendance.findOne({
      where: {
        user_id: userId,
        date: dateStr
      }
    });

    if (existing) {
      return res.status(409).json({
        status: 'error',
        message: `Anda sudah melakukan absensi hari ini (${dateStr}) dengan status '${existing.status}'.`,
        code: 'ATTENDANCE_ALREADY_SUBMITTED'
      });
    }

    const attendance = await Attendance.create({
      user_id: userId,
      date: dateStr,
      status
    });

    return res.status(201).json({
      status: 'success',
      message: 'Absensi berhasil dicatat.',
      data: attendance
    });
  } catch (error) {
    return res.status(500).json({
      status: 'error',
      message: 'Terjadi kesalahan saat mencatat absensi.',
      error: error.message
    });
  }
};

const getMyHistory = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const offset = (page - 1) * limit;

    const { count, rows } = await Attendance.findAndCountAll({
      where: { user_id: req.user.id },
      order: [['date', 'DESC']],
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
      message: 'Terjadi kesalahan saat mengambil riwayat absensi.',
      error: error.message
    });
  }
};

const getReport = async (req, res) => {
  try {
    const { startDate, endDate, divisi } = req.query;
    const whereClause = {};

    if (startDate && endDate) {
      whereClause.date = { [Op.between]: [startDate, endDate] };
    } else if (startDate) {
      whereClause.date = { [Op.gte]: startDate };
    } else if (endDate) {
      whereClause.date = { [Op.lte]: endDate };
    }

    const userWhereClause = {};
    if (divisi) {
      userWhereClause.divisi = divisi;
    }

    const attendances = await Attendance.findAll({
      where: whereClause,
      include: [
        {
          model: User,
          as: 'user',
          where: userWhereClause,
          attributes: ['id', 'username', 'nama_lengkap', 'role', 'divisi']
        }
      ],
      order: [['date', 'DESC']]
    });

    return res.status(200).json({
      status: 'success',
      data: {
        total: attendances.length,
        items: attendances
      }
    });
  } catch (error) {
    return res.status(500).json({
      status: 'error',
      message: 'Terjadi kesalahan saat mengambil rekap absensi.',
      error: error.message
    });
  }
};

module.exports = { submitAttendance, getMyHistory, getReport };
