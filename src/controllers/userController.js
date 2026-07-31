const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { Op } = require('sequelize');
const { User } = require('../models');

const BCRYPT_SALT_ROUNDS = 10;

const generateRandomPassword = (length = 8) => {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let password = '';
  for (let i = 0; i < length; i++) {
    const randomIndex = crypto.randomInt(0, chars.length);
    password += chars[randomIndex];
  }
  return password;
};

// GET /api/users - Daftar semua user
const getAllUsers = async (req, res) => {
  try {
    const { role, search } = req.query;
    const where = {};

    if (role && ['admin', 'pengurus', 'anggota'].includes(role)) {
      where.role = role;
    }

    if (search) {
      where[Op.or] = [
        { nama_lengkap: { [Op.like]: `%${search}%` } },
        { username: { [Op.like]: `%${search}%` } }
      ];
    }

    const users = await User.findAll({
      where,
      attributes: ['id', 'username', 'nama_lengkap', 'role', 'divisi', 'created_at'],
      order: [['role', 'ASC'], ['nama_lengkap', 'ASC']]
    });

    return res.status(200).json({
      status: 'success',
      data: users
    });
  } catch (error) {
    return res.status(500).json({
      status: 'error',
      message: 'Gagal memuat daftar anggota.',
      error: error.message
    });
  }
};

// POST /api/users - Tambah user baru
const createUser = async (req, res) => {
  try {
    const { username, password, nama_lengkap, role, divisi } = req.body;

    if (!username || !nama_lengkap || !role) {
      return res.status(400).json({
        status: 'error',
        message: 'Username, nama lengkap, dan role wajib diisi.'
      });
    }

    if (!['admin', 'pengurus', 'anggota'].includes(role)) {
      return res.status(400).json({
        status: 'error',
        message: 'Role harus admin, pengurus, atau anggota.'
      });
    }

    const existing = await User.findOne({ where: { username } });
    if (existing) {
      return res.status(409).json({
        status: 'error',
        message: `Username "${username}" sudah digunakan.`
      });
    }

    const finalPassword = password || generateRandomPassword();
    const password_hash = await bcrypt.hash(finalPassword, BCRYPT_SALT_ROUNDS);

    const user = await User.create({
      username: username.toLowerCase().trim(),
      password_hash,
      nama_lengkap: nama_lengkap.trim(),
      role,
      divisi: role === 'pengurus' ? (divisi || null) : null
    });

    return res.status(201).json({
      status: 'success',
      message: `Anggota "${nama_lengkap}" berhasil ditambahkan.`,
      data: {
        id: user.id,
        username: user.username,
        nama_lengkap: user.nama_lengkap,
        role: user.role,
        divisi: user.divisi,
        generated_password: finalPassword
      }
    });
  } catch (error) {
    return res.status(500).json({
      status: 'error',
      message: 'Gagal menambahkan anggota.',
      error: error.message
    });
  }
};

// PUT /api/users/:id - Edit data user
const updateUser = async (req, res) => {
  try {
    const { id } = req.params;
    const { username, nama_lengkap, role, divisi } = req.body;

    const user = await User.findByPk(id);
    if (!user) {
      return res.status(404).json({
        status: 'error',
        message: 'User tidak ditemukan.'
      });
    }

    if (username && username !== user.username) {
      const existing = await User.findOne({ where: { username, id: { [Op.ne]: id } } });
      if (existing) {
        return res.status(409).json({
          status: 'error',
          message: `Username "${username}" sudah digunakan oleh user lain.`
        });
      }
      user.username = username.toLowerCase().trim();
    }

    if (nama_lengkap) user.nama_lengkap = nama_lengkap.trim();
    if (role && ['admin', 'pengurus', 'anggota'].includes(role)) {
      user.role = role;
      user.divisi = role === 'pengurus' ? (divisi || user.divisi) : null;
    }
    if (role === 'pengurus' && divisi !== undefined) {
      user.divisi = divisi || null;
    }

    await user.save();

    return res.status(200).json({
      status: 'success',
      message: `Data "${user.nama_lengkap}" berhasil diperbarui.`,
      data: {
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
      message: 'Gagal memperbarui data anggota.',
      error: error.message
    });
  }
};

// PUT /api/users/:id/reset-password - Reset password
const resetPassword = async (req, res) => {
  try {
    const { id } = req.params;
    const { new_password } = req.body;

    const user = await User.findByPk(id);
    if (!user) {
      return res.status(404).json({
        status: 'error',
        message: 'User tidak ditemukan.'
      });
    }

    const finalPassword = new_password || generateRandomPassword();
    user.password_hash = await bcrypt.hash(finalPassword, BCRYPT_SALT_ROUNDS);
    await user.save();

    return res.status(200).json({
      status: 'success',
      message: `Password "${user.nama_lengkap}" berhasil direset.`,
      data: {
        id: user.id,
        username: user.username,
        nama_lengkap: user.nama_lengkap,
        new_password: finalPassword
      }
    });
  } catch (error) {
    return res.status(500).json({
      status: 'error',
      message: 'Gagal mereset password.',
      error: error.message
    });
  }
};

// DELETE /api/users/:id - Hapus user
const deleteUser = async (req, res) => {
  try {
    const { id } = req.params;

    if (parseInt(id) === req.user.id) {
      return res.status(400).json({
        status: 'error',
        message: 'Tidak bisa menghapus akun sendiri.'
      });
    }

    const user = await User.findByPk(id);
    if (!user) {
      return res.status(404).json({
        status: 'error',
        message: 'User tidak ditemukan.'
      });
    }

    const nama = user.nama_lengkap;
    await user.destroy();

    return res.status(200).json({
      status: 'success',
      message: `Anggota "${nama}" berhasil dihapus.`
    });
  } catch (error) {
    return res.status(500).json({
      status: 'error',
      message: 'Gagal menghapus anggota.',
      error: error.message
    });
  }
};

module.exports = { getAllUsers, createUser, updateUser, resetPassword, deleteUser };
