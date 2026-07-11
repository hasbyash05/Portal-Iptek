const jwt = require('jsonwebtoken');
const { User } = require('../models');

const authenticate = async (req, res, next) => {
  try {
    let token = null;
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.split(' ')[1];
    } else if (req.query && req.query.token) {
      token = req.query.token;
    }

    if (!token) {
      return res.status(401).json({
        status: 'error',
        message: 'Akses ditolak. Token autentikasi tidak ditemukan.'
      });
    }

    if (!process.env.JWT_SECRET) {
      console.error('[FATAL] JWT_SECRET belum dikonfigurasi di file .env');
      return res.status(401).json({
        status: 'error',
        message: 'Konfigurasi server belum lengkap. Hubungi administrator.'
      });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    const user = await User.findByPk(decoded.id);
    if (!user) {
      return res.status(401).json({
        status: 'error',
        message: 'Token tidak valid. User tidak ditemukan.'
      });
    }

    req.user = user;
    next();
  } catch (error) {
    return res.status(401).json({
      status: 'error',
      message: 'Token tidak valid atau telah kedaluwarsa.',
      error: error.message
    });
  }
};

module.exports = { authenticate };
