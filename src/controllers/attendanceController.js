const { Attendance, User, Payment, UserDevice, AttendanceSession, sequelize } = require('../models');
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

    // 1. Auto-clean duplicate/garbage sessions agar selalu sinkron dengan sistem resmi
    try {
      const distinctAttDates = await Attendance.findAll({
        attributes: [[sequelize.fn('DISTINCT', sequelize.col('date')), 'date']],
        raw: true
      });
      const validDates = new Set(distinctAttDates.map(d => d.date).filter(Boolean));

      const existingSessions = await AttendanceSession.findAll({ order: [['id', 'ASC']] });
      const keptIds = new Set();
      const coveredDates = new Set();

      for (const s of existingSessions) {
        if (s.is_active) {
          keptIds.add(s.id);
          continue;
        }
        const sDate = s.activated_at 
          ? getJakartaDateString(new Date(s.activated_at)) 
          : null;

        // Hanya simpan 1 sesi per tanggal yang benar-benar ada presensinya (sisakan 2 yang hadir itu)
        if (sDate && validDates.has(sDate) && !coveredDates.has(sDate)) {
          keptIds.add(s.id);
          coveredDates.add(sDate);
        }
      }

      // Hapus seluruh sesi sampah/duplikat lainnya
      if (keptIds.size > 0 && existingSessions.length > keptIds.size) {
        await AttendanceSession.destroy({
          where: {
            id: { [Op.notIn]: Array.from(keptIds) }
          }
        });
      }
    } catch (cleanErr) {
      console.warn('[Auto-clean sessions warning in getReport]:', cleanErr.message);
    }

    // 2. Ambil seluruh sesi presensi resmi yang tersisa
    const allSessions = await AttendanceSession.findAll({
      attributes: ['id', 'activated_by', 'activated_at', 'attendance_mode', 'is_active'],
      order: [['activated_at', 'DESC'], ['id', 'DESC']]
    });

    // 3. Ambil seluruh tanggal unik presensi dari seluruh user di organisasi
    const distinctDates = await Attendance.findAll({
      attributes: [[sequelize.fn('DISTINCT', sequelize.col('date')), 'date']],
      order: [['date', 'DESC']],
      raw: true
    });
    const uniqueAttDates = distinctDates.map(d => d.date).filter(Boolean);

    // 4. Susun daftar tanggal pertemuan resmi unik (Hari & Tanggal)
    const meetingDatesSet = new Set();
    allSessions.forEach(s => {
      if (s.activated_at) {
        meetingDatesSet.add(getJakartaDateString(new Date(s.activated_at)));
      }
    });
    uniqueAttDates.forEach(d => {
      if (d) meetingDatesSet.add(d);
    });

    const allSortedMeetingDates = Array.from(meetingDatesSet).sort().reverse();

    // 5. Terapkan filter tanggal (jika ada)
    let filteredMeetingDates = allSortedMeetingDates;
    if (startDate && endDate) {
      filteredMeetingDates = allSortedMeetingDates.filter(d => d >= startDate && d <= endDate);
    } else if (startDate) {
      filteredMeetingDates = allSortedMeetingDates.filter(d => d >= startDate);
    } else if (endDate) {
      filteredMeetingDates = allSortedMeetingDates.filter(d => d <= endDate);
    }

    // 6. Ambil seluruh anggota dan pengurus (filter divisi jika ada)
    const userWhereClause = {};
    if (divisi) {
      userWhereClause.divisi = divisi;
    }
    const users = await User.findAll({
      where: userWhereClause,
      attributes: ['id', 'username', 'nama_lengkap', 'role', 'divisi'],
      order: [
        ['role', 'DESC'], // Pengurus dulu, lalu Anggota
        ['nama_lengkap', 'ASC']
      ]
    });

    // 7. Ambil seluruh absensi pada tanggal-tanggal pertemuan yang difilter
    const attendanceWhere = {};
    if (filteredMeetingDates.length > 0) {
      attendanceWhere.date = { [Op.in]: filteredMeetingDates };
    } else {
      attendanceWhere.date = '1970-01-01';
    }

    const attendances = await Attendance.findAll({
      where: attendanceWhere,
      attributes: ['id', 'user_id', 'date', 'status', 'created_at'],
      order: [['date', 'DESC'], ['created_at', 'DESC']]
    });

    // Mapping: `${user_id}_${date}` -> attendance
    const attMap = new Map();
    attendances.forEach(a => {
      if (!attMap.has(`${a.user_id}_${a.date}`)) {
        attMap.set(`${a.user_id}_${a.date}`, a);
      }
    });

    // 8. Susun matriks rekapitulasi anggota (Rekapitulasi Anggota)
    const totalMeetings = filteredMeetingDates.length;
    let totalHadirAll = 0;
    let totalAlpaAll = 0;

    const rekapMembers = users.map((u, index) => {
      let hadirCount = 0;
      let izinCount = 0;
      let sakitCount = 0;

      const dateStatuses = filteredMeetingDates.map(d => {
        const att = attMap.get(`${u.id}_${d}`);
        const status = att ? att.status : 'alpa';
        if (status === 'hadir') hadirCount++;
        else if (status === 'izin') izinCount++;
        else if (status === 'sakit') sakitCount++;
        return {
          date: d,
          status: status,
          id: att ? att.id : null,
          created_at: att ? att.created_at : null
        };
      });

      const alpaCount = Math.max(0, totalMeetings - (hadirCount + izinCount + sakitCount));
      const pct = totalMeetings > 0 ? Math.round((hadirCount / totalMeetings) * 100) : 0;

      totalHadirAll += hadirCount;
      totalAlpaAll += alpaCount;

      return {
        no: index + 1,
        id: u.id,
        nama_lengkap: u.nama_lengkap,
        role: u.role,
        divisi: u.divisi || '-',
        hadir: hadirCount,
        izin: izinCount,
        sakit: sakitCount,
        alpa: alpaCount,
        total_pertemuan: totalMeetings,
        persentase: pct,
        date_statuses: dateStatuses
      };
    });

    // 9. Susun detail baris log per pertemuan (Detail Log Pertemuan)
    const items = [];
    filteredMeetingDates.forEach(date => {
      users.forEach(u => {
        const att = attMap.get(`${u.id}_${date}`);
        items.push({
          id: att ? att.id : null,
          date: date,
          status: att ? att.status : 'alpa',
          created_at: att ? att.created_at : null,
          user_id: u.id,
          user: {
            id: u.id,
            username: u.username,
            nama_lengkap: u.nama_lengkap,
            role: u.role,
            divisi: u.divisi || '-'
          }
        });
      });
    });

    const avgPct = users.length > 0 
      ? Math.round(rekapMembers.reduce((acc, m) => acc + m.persentase, 0) / users.length) 
      : 0;

    return res.status(200).json({
      status: 'success',
      data: {
        summary: {
          total_pertemuan: totalMeetings,
          total_members: users.length,
          total_hadir: totalHadirAll,
          total_alpa: totalAlpaAll,
          avg_persentase: avgPct,
          meeting_dates: filteredMeetingDates
        },
        rekap_members: rekapMembers,
        items: items,
        total: items.length
      }
    });
  } catch (error) {
    console.error('getReport error:', error);
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
 * - Kolom: Tanggal-tanggal pertemuan resmi yang dibuka Ketua
 * - Nilai: HADIR atau ALPA
 * - Rekapitulasi: Total Hadir, Total Alpa, Total Pertemuan, Persentase Kehadiran
 */
const exportAttendanceCsv = async (req, res) => {
  try {
    const { startDate, endDate, divisi } = req.query;

    // 1. Ambil seluruh anggota dan pengurus
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

    // 2. Ambil seluruh sesi presensi resmi
    const allSessions = await AttendanceSession.findAll({
      attributes: ['id', 'activated_by', 'activated_at', 'attendance_mode'],
      order: [['activated_at', 'ASC']]
    });

    const distinctDates = await Attendance.findAll({
      attributes: [[sequelize.fn('DISTINCT', sequelize.col('date')), 'date']],
      order: [['date', 'ASC']],
      raw: true
    });
    const uniqueAttDates = distinctDates.map(d => d.date).filter(Boolean);

    const meetingDatesSet = new Set();
    allSessions.forEach(s => {
      if (s.activated_at) {
        meetingDatesSet.add(getJakartaDateString(new Date(s.activated_at)));
      }
    });
    uniqueAttDates.forEach(d => {
      if (d) meetingDatesSet.add(d);
    });

    const allSortedMeetingDates = Array.from(meetingDatesSet).sort(); // Urutan kronologis ASC

    // Filter tanggal
    let filteredMeetingDates = allSortedMeetingDates;
    if (startDate && endDate) {
      filteredMeetingDates = allSortedMeetingDates.filter(d => d >= startDate && d <= endDate);
    } else if (startDate) {
      filteredMeetingDates = allSortedMeetingDates.filter(d => d >= startDate);
    } else if (endDate) {
      filteredMeetingDates = allSortedMeetingDates.filter(d => d <= endDate);
    }

    const attendanceWhere = {};
    if (filteredMeetingDates.length > 0) {
      attendanceWhere.date = { [Op.in]: filteredMeetingDates };
    } else {
      attendanceWhere.date = '1970-01-01';
    }

    const attendances = await Attendance.findAll({
      where: attendanceWhere,
      attributes: ['user_id', 'date', 'status']
    });

    const attendanceMap = new Map();
    attendances.forEach(a => {
      if (!attendanceMap.has(`${a.user_id}_${a.date}`)) {
        attendanceMap.set(`${a.user_id}_${a.date}`, a.status);
      }
    });

    // 4. Susun baris CSV
    const headers = [
      'No',
      'Nama Anggota',
      'Role',
      'Divisi',
      ...filteredMeetingDates.map(d => `Pertemuan (${d})`),
      'Total Hadir',
      'Total Alpa (Tidak Hadir)',
      'Total Pertemuan',
      'Persentase Kehadiran'
    ];

    const escapeCsv = (str) => {
      if (str === null || str === undefined) return '""';
      const clean = String(str).replace(/"/g, '""');
      return `"${clean}"`;
    };

    const rows = users.map((u, idx) => {
      let userHadirCount = 0;
      let userAlpaCount = 0;

      const dateStatuses = filteredMeetingDates.map(d => {
        const rawStatus = attendanceMap.get(`${u.id}_${d}`);
        if (rawStatus === 'hadir') {
          userHadirCount++;
          return 'HADIR';
        } else if (rawStatus === 'izin') {
          return 'IZIN';
        } else if (rawStatus === 'sakit') {
          return 'SAKIT';
        } else {
          userAlpaCount++;
          return 'ALPA';
        }
      });

      const totalMeetings = filteredMeetingDates.length;
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
        userAlpaCount,
        totalMeetings,
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

