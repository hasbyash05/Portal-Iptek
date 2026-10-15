const path = require('path');
const fs = require('fs');
const { Op } = require('sequelize');
const { Certificate, User, Attendance, Payment, AttendanceSession, sequelize } = require('../models');
const { getJakartaDateString } = require('../utils/dateHelper');

// GET /api/profile/:id - Ambil profil anggota beserta statistik kehadiran dan sertifikat
const getProfile = async (req, res) => {
  try {
    const { id } = req.params;

    const user = await User.findByPk(id, {
      attributes: ['id', 'username', 'nama_lengkap', 'role', 'divisi', 'created_at']
    });

    if (!user) {
      return res.status(404).json({
        status: 'error',
        message: 'User tidak ditemukan.'
      });
    }

    // 1. Bersihkan sesi presensi duplikat & sampah (sisakan hanya 1 sesi per tanggal pertemuan resmi yang dihadiri)
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
      console.warn('[Auto-clean sessions warning]:', cleanErr.message);
    }

    // 2. Ambil seluruh sesi presensi resmi yang tersisa
    const allSessions = await AttendanceSession.findAll({
      attributes: ['id', 'activated_by', 'activated_at', 'attendance_mode'],
      order: [['activated_at', 'DESC'], ['id', 'DESC']]
    });

    // 3. Ambil seluruh tanggal unik presensi dari seluruh user di organisasi
    const distinctDates = await Attendance.findAll({
      attributes: [[sequelize.fn('DISTINCT', sequelize.col('date')), 'date']],
      order: [['date', 'DESC']],
      raw: true
    });
    const uniqueAttDates = distinctDates.map(d => d.date).filter(Boolean);

    // 4. Ambil seluruh presensi user target
    const userAttendances = await Attendance.findAll({
      where: { user_id: id },
      order: [['date', 'DESC'], ['created_at', 'DESC']],
      attributes: ['id', 'date', 'status', 'created_at']
    });

    const userAttMap = new Map();
    let totalHadir = 0;
    let totalIzin = 0;
    let totalSakit = 0;

    userAttendances.forEach(a => {
      userAttMap.set(a.date, a);
      const s = String(a.status).toLowerCase();
      if (s === 'hadir') totalHadir++;
      else if (s === 'izin') totalIzin++;
      else if (s === 'sakit') totalSakit++;
    });

    // 5. Susun daftar tanggal pertemuan resmi unik (Hari & Tanggal)
    const meetingDatesSet = new Set();
    allSessions.forEach(s => {
      if (s.activated_at) {
        meetingDatesSet.add(getJakartaDateString(new Date(s.activated_at)));
      }
    });
    uniqueAttDates.forEach(d => {
      if (d) meetingDatesSet.add(d);
    });

    // Urutkan tanggal pertemuan dari yang terbaru ke terlama
    const sortedMeetingDates = Array.from(meetingDatesSet).sort().reverse();

    // Total pertemuan diambil dari jumlah tanggal pertemuan resmi (sisakan 2 pertemuan yang dihadiri)
    const totalPertemuan = sortedMeetingDates.length;
    const totalAlpa = Math.max(0, totalPertemuan - (totalHadir + totalIzin + totalSakit));
    const persentase = totalPertemuan > 0 ? Math.round((totalHadir / totalPertemuan) * 100) : 0;

    // 6. Cek kehadiran hari ini
    const todayStr = getJakartaDateString();
    const todayAttendance = userAttendances.find(a => a.date === todayStr);

    // 7. Susun riwayat pertemuan untuk tabel profil (1 baris per tanggal pertemuan resmi)
    const attendanceRecords = sortedMeetingDates.map(date => {
      if (userAttMap.has(date)) {
        const att = userAttMap.get(date);
        return {
          id: att.id,
          date: att.date,
          status: att.status,
          created_at: att.created_at
        };
      } else {
        return {
          id: null,
          date: date,
          status: 'alpa',
          created_at: null
        };
      }
    });

    // 7. Sertifikat milik anggota
    const certificates = await Certificate.findAll({
      where: { user_id: id },
      include: [{ model: User, as: 'uploader', attributes: ['nama_lengkap'] }],
      order: [['created_at', 'DESC']]
    });

    return res.status(200).json({
      status: 'success',
      data: {
        user: user.toJSON(),
        attendance: {
          total_pertemuan: totalPertemuan,
          hadir: totalHadir,
          izin: totalIzin,
          sakit: totalSakit,
          alpa: totalAlpa,
          persentase: persentase,
          today: todayAttendance ? {
            status: todayAttendance.status,
            waktu: todayAttendance.created_at
          } : null,
          recent: attendanceRecords,
          records: attendanceRecords
        },
        certificates: certificates.map(c => ({
          id: c.id,
          nama_sertifikat: c.nama_sertifikat,
          file_path: c.file_path,
          uploaded_by_name: c.uploader ? c.uploader.nama_lengkap : '-',
          created_at: c.created_at
        }))
      }
    });
  } catch (error) {
    console.error('getProfile error:', error);
    return res.status(500).json({
      status: 'error',
      message: 'Gagal memuat profil anggota.',
      error: error.message
    });
  }
};

// POST /api/certificates - Upload sertifikat ke anggota (Pengurus only)
const uploadCertificate = async (req, res) => {
  try {
    const { user_id, nama_sertifikat } = req.body;

    if (!user_id || !nama_sertifikat) {
      return res.status(400).json({
        status: 'error',
        message: 'user_id dan nama_sertifikat wajib diisi.'
      });
    }

    const targetUser = await User.findByPk(user_id);
    if (!targetUser) {
      return res.status(404).json({
        status: 'error',
        message: 'User tujuan tidak ditemukan.'
      });
    }

    if (!req.file) {
      return res.status(400).json({
        status: 'error',
        message: 'File sertifikat wajib diunggah.'
      });
    }

    // Rename file agar mengikuti format: NamaLengkap_NamaSertifikat.ext
    const ext = path.extname(req.file.originalname);
    const sanitizedName = targetUser.nama_lengkap.replace(/[^a-zA-Z0-9\s]/g, '').replace(/\s+/g, '_');
    const sanitizedCertName = nama_sertifikat.replace(/[^a-zA-Z0-9\s]/g, '').replace(/\s+/g, '_');
    const newFilename = `${sanitizedName}_${sanitizedCertName}_${Date.now()}${ext}`;
    const newPath = path.join(req.file.destination, newFilename);

    fs.renameSync(req.file.path, newPath);

    const filePath = `/uploads/certificates/${newFilename}`;

    const certificate = await Certificate.create({
      user_id: parseInt(user_id),
      nama_sertifikat: nama_sertifikat.trim(),
      file_path: filePath,
      uploaded_by: req.user.id
    });

    return res.status(201).json({
      status: 'success',
      message: `Sertifikat "${nama_sertifikat}" berhasil diunggah untuk ${targetUser.nama_lengkap}.`,
      data: {
        id: certificate.id,
        user_id: certificate.user_id,
        nama_sertifikat: certificate.nama_sertifikat,
        file_path: certificate.file_path,
        target_name: targetUser.nama_lengkap
      }
    });
  } catch (error) {
    console.error('uploadCertificate error:', error);
    return res.status(500).json({
      status: 'error',
      message: 'Gagal mengunggah sertifikat.',
      error: error.message
    });
  }
};

// GET /api/certificates - Daftar semua sertifikat (Pengurus only)
const getAllCertificates = async (req, res) => {
  try {
    const { user_id } = req.query;
    const where = {};
    if (user_id) where.user_id = user_id;

    const certificates = await Certificate.findAll({
      where,
      include: [
        { model: User, as: 'owner', attributes: ['id', 'nama_lengkap', 'role'] },
        { model: User, as: 'uploader', attributes: ['nama_lengkap'] }
      ],
      order: [['created_at', 'DESC']]
    });

    return res.status(200).json({
      status: 'success',
      data: certificates.map(c => ({
        id: c.id,
        user_id: c.user_id,
        owner_name: c.owner ? c.owner.nama_lengkap : '-',
        nama_sertifikat: c.nama_sertifikat,
        file_path: c.file_path,
        uploaded_by_name: c.uploader ? c.uploader.nama_lengkap : '-',
        created_at: c.created_at
      }))
    });
  } catch (error) {
    return res.status(500).json({
      status: 'error',
      message: 'Gagal memuat daftar sertifikat.',
      error: error.message
    });
  }
};

// DELETE /api/certificates/:id - Hapus sertifikat (Pengurus only)
const deleteCertificate = async (req, res) => {
  try {
    const { id } = req.params;

    const cert = await Certificate.findByPk(id);
    if (!cert) {
      return res.status(404).json({
        status: 'error',
        message: 'Sertifikat tidak ditemukan.'
      });
    }

    // Hapus file fisik
    const filePath = path.join(__dirname, '../../public', cert.file_path);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }

    const nama = cert.nama_sertifikat;
    await cert.destroy();

    return res.status(200).json({
      status: 'success',
      message: `Sertifikat "${nama}" berhasil dihapus.`
    });
  } catch (error) {
    return res.status(500).json({
      status: 'error',
      message: 'Gagal menghapus sertifikat.',
      error: error.message
    });
  }
};

module.exports = { getProfile, uploadCertificate, getAllCertificates, deleteCertificate };
