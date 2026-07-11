const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { User, UserDevice } = require('../models');

const login = async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({
        status: 'error',
        message: 'Username dan password wajib diisi.'
      });
    }

    const user = await User.findOne({ where: { username } });
    if (!user) {
      return res.status(401).json({
        status: 'error',
        message: 'Username atau password salah.'
      });
    }

    const isMatch = await bcrypt.compare(password, user.password_hash);

    if (!isMatch) {
      return res.status(401).json({
        status: 'error',
        message: 'Username atau password salah.'
      });
    }

    if (!process.env.JWT_SECRET) {
      console.error('[FATAL] JWT_SECRET belum dikonfigurasi di file .env');
      return res.status(500).json({
        status: 'error',
        message: 'Konfigurasi server belum lengkap. Hubungi administrator.'
      });
    }

    const payload = {
      id: user.id,
      username: user.username,
      role: user.role,
      divisi: user.divisi
    };

    const token = jwt.sign(
      payload,
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '24h' }
    );

    // Catat device fingerprint jika dikirim oleh frontend
    const { device_fingerprint, device_info } = req.body;
    if (device_fingerprint) {
      try {
        const existing = await UserDevice.findOne({
          where: { user_id: user.id, device_fingerprint }
        });
        if (existing) {
          existing.last_seen = new Date();
          if (device_info) existing.device_info = device_info;
          await existing.save();
        } else {
          await UserDevice.create({
            user_id: user.id,
            device_fingerprint,
            device_info: device_info || null,
            first_seen: new Date(),
            last_seen: new Date()
          });
        }
      } catch (devErr) {
        console.error('[WARN] Gagal mencatat device fingerprint:', devErr.message);
      }
    }

    return res.status(200).json({
      status: 'success',
      message: 'Login berhasil.',
      token,
      user: {
        id: user.id,
        username: user.username,
        nama_lengkap: user.nama_lengkap,
        role: user.role,
        divisi: user.divisi
      }
    });
  } catch (error) {
    return res.status(500).json({
      status: 'error',
      message: 'Terjadi kesalahan pada server saat proses login.',
      error: error.message
    });
  }
};

const getMe = async (req, res) => {
  try {
    const user = req.user;
    return res.status(200).json({
      status: 'success',
      data: {
        id: user.id,
        username: user.username,
        nama_lengkap: user.nama_lengkap,
        role: user.role,
        divisi: user.divisi,
        created_at: user.created_at
      }
    });
  } catch (error) {
    return res.status(500).json({
      status: 'error',
      message: 'Terjadi kesalahan saat mengambil data profil.',
      error: error.message
    });
  }
};

module.exports = { login, getMe };
