const { isTuesday } = require('../utils/dateHelper');

const checkTuesday = (req, res, next) => {
  // Allow overriding for testing if BYPASS_TUESDAY_CHECK env is set to 'true'
  if (process.env.BYPASS_TUESDAY_CHECK === 'true') {
    return next();
  }

  if (!isTuesday()) {
    return res.status(400).json({
      status: 'error',
      message: 'Absensi hanya dapat dilakukan pada hari Selasa (sesuai jadwal pertemuan Iptek).',
      code: 'ONLY_TUESDAY_ALLOWED'
    });
  }

  next();
};

module.exports = { checkTuesday };
