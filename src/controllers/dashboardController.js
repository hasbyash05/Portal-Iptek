const { User, Attendance, Payment, WeeklyReport, KasExpense, sequelize } = require('../models');
const { Op } = require('sequelize');

const getDashboardStats = async (req, res) => {
  try {
    // 1. Total active members
    const totalMembers = await User.count({ where: { role: 'anggota' } });
    const totalPengurus = await User.count({ where: { role: 'pengurus' } });

    // 2. Kas status count (QRIS Instan auto lunas untuk bulan berjalan)
    const now = new Date();
    const currentMonth = now.getMonth() + 1;
    const currentYear = now.getFullYear();

    const kasLunasBulanIni = await Payment.count({
      where: {
        status: 'lunas',
        month: currentMonth,
        year: currentYear
      }
    });
    const pendingPayments = await Payment.count({ where: { status: 'pending' } });
    
    const totalKasMasuk = await Payment.sum('amount', {
      where: { status: 'lunas' }
    }) || 0;
    const totalKasKeluar = await KasExpense.sum('amount') || 0;
    const totalKasTerkumpul = totalKasMasuk - totalKasKeluar;

    // 3. Attendance chart (count by date for recent Tuesday meetings)
    // Group attendance by date (MySQL)
    const attendanceChart = await Attendance.findAll({
      attributes: [
        'date',
        [sequelize.fn('COUNT', sequelize.col('id')), 'count']
      ],
      where: {
        status: 'hadir'
      },
      group: ['date'],
      order: [['date', 'DESC']],
      limit: 8
    });

    // 4. Payment chart (sum amount where status = lunas grouped by month and year)
    const paymentChart = await Payment.findAll({
      attributes: [
        'month',
        'year',
        [sequelize.fn('SUM', sequelize.col('amount')), 'total_amount'],
        [sequelize.fn('COUNT', sequelize.col('id')), 'total_transactions']
      ],
      where: {
        status: 'lunas'
      },
      group: ['month', 'year'],
      order: [['year', 'DESC'], ['month', 'DESC']],
      limit: 6
    });

    // 5. Recent weekly reports
    const recentReports = await WeeklyReport.findAll({
      include: [
        {
          model: User,
          as: 'user',
          attributes: ['id', 'nama_lengkap', 'divisi']
        }
      ],
      order: [['submitted_at', 'DESC']],
      limit: 5
    });

    return res.status(200).json({
      status: 'success',
      data: {
        overview: {
          totalMembers,
          totalPengurus,
          pendingPayments,
          kasLunasBulanIni,
          totalKasTerkumpul: totalKasTerkumpul || 0
        },
        attendanceChart,
        paymentChart,
        recentReports
      }
    });
  } catch (error) {
    return res.status(500).json({
      status: 'error',
      message: 'Terjadi kesalahan saat mengambil statistik dashboard.',
      error: error.message
    });
  }
};

const { generateAttendancePPT } = require('../utils/pptGenerator');

const exportPPT = async (req, res) => {
  try {
    const { month, year } = req.query;
    const currentMonth = month ? parseInt(month) : new Date().getMonth() + 1;
    const currentYear = year ? parseInt(year) : new Date().getFullYear();

    const attendanceData = await Attendance.findAll({
      attributes: [
        'date',
        [sequelize.fn('COUNT', sequelize.col('id')), 'count']
      ],
      where: {
        status: 'hadir'
      },
      group: ['date'],
      order: [['date', 'ASC']]
    });

    const periodLabel = `Bulan ${currentMonth} Tahun ${currentYear}`;
    const pptBuffer = await generateAttendancePPT(attendanceData, {}, periodLabel);

    res.setHeader('Content-Disposition', `attachment; filename="Laporan-Iptek-${currentMonth}-${currentYear}.pptx"`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.presentationml.presentation');
    return res.send(pptBuffer);
  } catch (error) {
    return res.status(500).json({
      status: 'error',
      message: 'Terjadi kesalahan saat mengunduh file presentasi PPT.',
      error: error.message
    });
  }
};

module.exports = { getDashboardStats, exportPPT };

