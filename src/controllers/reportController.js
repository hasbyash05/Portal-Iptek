const { WeeklyReport, User } = require('../models');
const { getISOWeekNumber } = require('../utils/dateHelper');

const submitReport = async (req, res) => {
  try {
    const { activity } = req.body;
    if (!activity) {
      return res.status(400).json({
        status: 'error',
        message: 'Aktivitas kegiatan wajib diisi.'
      });
    }

    const { weekNumber, year } = getISOWeekNumber();
    const userId = req.user.id;

    // Check if report already exists for this week
    const existingReport = await WeeklyReport.findOne({
      where: {
        user_id: userId,
        week_number: weekNumber,
        year: year
      }
    });

    if (existingReport) {
      return res.status(409).json({
        status: 'error',
        message: `Anda sudah melapor kegiatan untuk Minggu ke-${weekNumber} tahun ${year}.`,
        code: 'REPORT_ALREADY_SUBMITTED'
      });
    }

    const attachmentPath = req.file ? `/uploads/reports/${req.file.filename}` : null;

    const report = await WeeklyReport.create({
      user_id: userId,
      week_number: weekNumber,
      year: year,
      activity,
      attachment_path: attachmentPath
    });

    return res.status(201).json({
      status: 'success',
      message: 'Laporan mingguan berhasil disimpan.',
      data: report
    });
  } catch (error) {
    return res.status(500).json({
      status: 'error',
      message: 'Terjadi kesalahan saat menyimpan laporan mingguan.',
      error: error.message
    });
  }
};

const checkStatus = async (req, res) => {
  try {
    const { weekNumber, year } = getISOWeekNumber();
    const userId = req.user.id;

    const report = await WeeklyReport.findOne({
      where: {
        user_id: userId,
        week_number: weekNumber,
        year: year
      }
    });

    return res.status(200).json({
      status: 'success',
      data: {
        hasReported: !!report,
        currentWeek: weekNumber,
        currentYear: year,
        reportDetails: report || null
      }
    });
  } catch (error) {
    return res.status(500).json({
      status: 'error',
      message: 'Terjadi kesalahan saat memeriksa status laporan.',
      error: error.message
    });
  }
};

const getHistory = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const offset = (page - 1) * limit;

    const whereClause = req.user.role === 'pengurus' ? {} : { user_id: req.user.id };

    const { count, rows } = await WeeklyReport.findAndCountAll({
      where: whereClause,
      include: [
        {
          model: User,
          as: 'user',
          attributes: ['id', 'nama_lengkap', 'divisi', 'username']
        }
      ],
      order: [['year', 'DESC'], ['week_number', 'DESC'], ['submitted_at', 'DESC']],
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
      message: 'Terjadi kesalahan saat mengambil riwayat laporan.',
      error: error.message
    });
  }
};

module.exports = { submitReport, checkStatus, getHistory };
