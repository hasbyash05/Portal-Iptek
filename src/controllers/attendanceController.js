const { Attendance, User, Payment, UserDevice } = require('../models');
const { getJakartaDateString } = require('../utils/dateHelper');
const { Op } = require('sequelize');

const submitAttendance = async (req, res) => {
  try {
    const { status, latitude, longitude, device_fingerprint } = req.body;
    if (status !== 'hadir') {
      return res.status(400).json({
        status: 'error',
        message: 'Gagal absensi: Status kehadiran hanya boleh HADIR.'
      });
    }

    // Validasi device fingerprint wajib
    if (!device_fingerprint) {
      return res.status(400).json({
        status: 'error',
        message: 'Gagal absensi: Identifikasi perangkat (device fingerprint) wajib dikirimkan.',
        code: 'DEVICE_FINGERPRINT_REQUIRED'
      });
    }

    // Cek mode presensi dari sesi aktif (di-set oleh middleware checkAttendanceActive)
    const currentMode = req.attendanceSession ? req.attendanceSession.attendance_mode : 'onsite';

    if (currentMode === 'onsite') {
      // Mode Di Tempat: validasi GPS wajib
      if (latitude === undefined || longitude === undefined || latitude === null || longitude === null) {
        return res.status(400).json({
          status: 'error',
          message: 'Gagal absensi: Koordinat lokasi GPS (latitude & longitude) wajib dikirimkan untuk verifikasi radius pertemuan.'
        });
      }

      // Titik pertemuan: 7\u00b002'02.4"S 110\u00b022'07.8"E
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

      if (distance > 100) {
        return res.status(403).json({
          status: 'error',
          message: `Gagal presensi: Lokasi Anda (${distance.toFixed(1)} meter) berada di luar batas radius maksimal 100 meter dari titik koordinat pertemuan UKM Iptek (7\u00b002'02.4"S 110\u00b022'07.8"E).`
        });
      }
    }
    // Mode Dimana Saja: skip validasi GPS, langsung lanjut

    const dateStr = getJakartaDateString();
    const userId = req.user.id;

    // Cek apakah user sudah membayar uang kas bulan berjalan (Wajib LUNAS untuk Anggota)
    const isBendahara = req.user.role === 'pengurus' && req.user.divisi && req.user.divisi.toLowerCase().includes('bendahara');
    const isExemptRole = req.user.role === 'admin' || isBendahara;
    if (!isExemptRole) {
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
    }

    // Anti-Titip Absen: Cek apakah perangkat ini sudah digunakan user lain hari ini
    const deviceUsedByOther = await Attendance.findOne({
      where: {
        device_fingerprint,
        date: dateStr,
        user_id: { [Op.ne]: userId }
      },
      include: [{
        model: User,
        as: 'user',
        attributes: ['nama_lengkap']
      }]
    });

    if (deviceUsedByOther) {
      return res.status(403).json({
        status: 'error',
        message: 'Presensi DITOLAK: Perangkat ini sudah digunakan oleh anggota lain untuk absensi pada sesi hari ini. Setiap anggota wajib menggunakan perangkat masing-masing.',
        code: 'DEVICE_ALREADY_USED'
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
      status,
      device_fingerprint
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

/**
 * GET /api/attendance/export-csv
 * Ekspor matriks rekap kehadiran ke format CSV:
 * - Baris: Semua anggota organisasi (pengurus & anggota)
 * - Kolom: Tanggal-tanggal pertemuan
 * - Nilai: HADIR atau TIDAK HADIR
 * - Rekapitulasi: Total Hadir, Total Tidak Hadir, Persentase Kehadiran
 */
const exportAttendanceCsv = async (req, res) => {
  try {
    const { startDate, endDate, divisi } = req.query;

    // 1. Ambil seluruh anggota dan pengurus (urutan pengurus dulu, lalu anggota, abjad nama)
    const userWhereClause = {};
    if (divisi) {
      userWhereClause.divisi = divisi;
    }

    const users = await User.findAll({
      where: userWhereClause,
      attributes: ['id', 'username', 'nama_lengkap', 'role', 'divisi'],
      order: [
        ['role', 'DESC'],
        ['nama_lengkap', 'ASC']
      ]
    });

    // 2. Ambil seluruh data absensi dengan filter tanggal (jika ada)
    const attendanceWhere = {};
    if (startDate && endDate) {
      attendanceWhere.date = { [Op.between]: [startDate, endDate] };
    } else if (startDate) {
      attendanceWhere.date = { [Op.gte]: startDate };
    } else if (endDate) {
      attendanceWhere.date = { [Op.lte]: endDate };
    }

    const attendances = await Attendance.findAll({
      where: attendanceWhere,
      attributes: ['user_id', 'date', 'status'],
      order: [['date', 'ASC']]
    });

    // 3. Ambil seluruh tanggal unik pertemuan (diurutkan kronologis)
    const uniqueDates = [...new Set(attendances.map(a => a.date))].filter(Boolean).sort();

    // Mapping presensi untuk pencarian instan: `${user_id}_${date}` -> status
    const attendanceMap = new Map();
    attendances.forEach(a => {
      attendanceMap.set(`${a.user_id}_${a.date}`, a.status);
    });

    // 4. Susun baris CSV
    const headers = [
      'No',
      'Nama Anggota',
      'Role',
      'Divisi',
      ...uniqueDates,
      'Total Hadir',
      'Total Tidak Hadir',
      'Persentase Kehadiran'
    ];

    const escapeCsv = (str) => {
      if (str === null || str === undefined) return '""';
      const clean = String(str).replace(/"/g, '""');
      return `"${clean}"`;
    };

    const rows = users.map((u, idx) => {
      let userHadirCount = 0;
      let userTidakHadirCount = 0;

      const dateStatuses = uniqueDates.map(d => {
        const rawStatus = attendanceMap.get(`${u.id}_${d}`);
        if (rawStatus === 'hadir') {
          userHadirCount++;
          return 'HADIR';
        } else if (rawStatus === 'izin') {
          return 'IZIN';
        } else if (rawStatus === 'sakit') {
          return 'SAKIT';
        } else {
          userTidakHadirCount++;
          return 'TIDAK HADIR';
        }
      });

      const totalMeetings = uniqueDates.length;
      const pct = totalMeetings > 0 
        ? Math.round((userHadirCount / totalMeetings) * 100) + '%' 
        : '0%';

      return [
        idx + 1,
        escapeCsv(u.nama_lengkap),
        escapeCsv(u.role ? u.role.toUpperCase() : '-'),
        escapeCsv(u.divisi || '-'),
        ...dateStatuses.map(s => escapeCsv(s)),
        userHadirCount,
        userTidakHadirCount,
        escapeCsv(pct)
      ].join(',');
    });

    // Berikan UTF-8 BOM (\uFEFF) agar Microsoft Excel langsung membaca rapi aksen & pemisah kolom
    const csvContent = '\uFEFF' + [headers.map(escapeCsv).join(','), ...rows].join('\r\n');

    const todayStr = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="Rekap_Kehadiran_Anggota_IPTEK_${todayStr}.csv"`);
    return res.status(200).send(csvContent);
  } catch (error) {
    console.error('[Export Attendance CSV Error]', error);
    return res.status(500).json({
      status: 'error',
      message: 'Gagal mengekspor data absensi ke CSV.',
      error: error.message
    });
  }
};

module.exports = { submitAttendance, getMyHistory, getReport, exportAttendanceCsv };

