const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { User } = require('../models');

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

    let isMatch = false;
    if (password === user.password_hash) {
      isMatch = true;
    } else {
      try {
        isMatch = await bcrypt.compare(password, user.password_hash);
      } catch (err) {
        isMatch = false;
      }
    }

    if (!isMatch) {
      return res.status(401).json({
        status: 'error',
        message: 'Username atau password salah.'
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
      process.env.JWT_SECRET || 'supersecretkey_iptek_org_2026',
      { expiresIn: process.env.JWT_EXPIRES_IN || '24h' }
    );

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
