const { AttendanceSession } = require('../models');

const checkAttendanceActive = async (req, res, next) => {
  try {
    const session = await AttendanceSession.findOne({ where: { is_active: true } });
    if (!session) {
      return res.status(400).json({
        status: 'error',
        message: 'Presensi belum dibuka. Silakan hubungi pengurus untuk mengaktifkan sesi presensi.',
        code: 'ATTENDANCE_NOT_ACTIVE'
      });
    }
    req.attendanceSession = session;
    next();
  } catch (error) {
    return res.status(500).json({
      status: 'error',
      message: 'Gagal memeriksa status sesi presensi.'
    });
  }
};

module.exports = { checkAttendanceActive };
