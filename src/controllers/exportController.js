const { Attendance, Payment, sequelize } = require('../models');
const { generateAttendancePPT } = require('../utils/pptGenerator');

const exportPPT = async (req, res) => {
  try {
    const { month, year } = req.query;
    const currentMonth = month ? parseInt(month) : new Date().getMonth() + 1;
    const currentYear = year ? parseInt(year) : new Date().getFullYear();

    // Fetch aggregated attendance data
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

module.exports = { exportPPT };
