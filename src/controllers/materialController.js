const path = require('path');
const fs = require('fs');
const { TeachingMaterial, User } = require('../models');
const { getISOWeekNumber } = require('../utils/dateHelper');

const uploadMaterial = async (req, res) => {
  try {
    const { title, description } = req.body;
    if (!title) {
      return res.status(400).json({
        status: 'error',
        message: 'Judul bahan ajar wajib diisi.'
      });
    }

    if (!req.file) {
      return res.status(400).json({
        status: 'error',
        message: 'File bahan ajar wajib diunggah.'
      });
    }

    const { weekNumber, year } = getISOWeekNumber();
    const filePath = `/uploads/materials/${req.file.filename}`;

    const material = await TeachingMaterial.create({
      user_id: req.user.id,
      title,
      description: description || '',
      file_path: filePath,
      week_number: weekNumber,
      year: year
    });

    return res.status(201).json({
      status: 'success',
      message: 'Bahan ajar berhasil diunggah.',
      data: material
    });
  } catch (error) {
    return res.status(500).json({
      status: 'error',
      message: 'Terjadi kesalahan saat mengunggah bahan ajar.',
      error: error.message
    });
  }
};

const getMaterials = async (req, res) => {
  try {
    const materials = await TeachingMaterial.findAll({
      include: [
        {
          model: User,
          as: 'uploader',
          attributes: ['id', 'nama_lengkap', 'divisi']
        }
      ],
      order: [['created_at', 'DESC']]
    });

    const formatted = materials.map(m => ({
      id: m.id,
      title: m.title,
      description: m.description,
      week_number: m.week_number,
      year: m.year,
      uploaded_by: m.uploader ? m.uploader.nama_lengkap : 'Admin',
      divisi: m.uploader ? m.uploader.divisi : '-',
      download_url: `/api/materials/download/${m.id}`,
      created_at: m.created_at
    }));

    return res.status(200).json({
      status: 'success',
      data: formatted
    });
  } catch (error) {
    return res.status(500).json({
      status: 'error',
      message: 'Terjadi kesalahan saat mengambil daftar bahan ajar.',
      error: error.message
    });
  }
};

const downloadMaterial = async (req, res) => {
  try {
    const { id } = req.params;
    const material = await TeachingMaterial.findByPk(id);

    if (!material) {
      return res.status(404).json({
        status: 'error',
        message: 'Bahan ajar tidak ditemukan.'
      });
    }

    const absolutePath = path.join(__dirname, '../../public', material.file_path);
    if (!fs.existsSync(absolutePath)) {
      return res.status(404).json({
        status: 'error',
        message: 'File fisik tidak ditemukan di server.'
      });
    }

    return res.download(absolutePath, path.basename(material.file_path));
  } catch (error) {
    return res.status(500).json({
      status: 'error',
      message: 'Terjadi kesalahan saat mengunduh bahan ajar.',
      error: error.message
    });
  }
};

const deleteMaterial = async (req, res) => {
  try {
    const { id } = req.params;
    const material = await TeachingMaterial.findByPk(id);

    if (!material) {
      return res.status(404).json({
        status: 'error',
        message: 'Bahan ajar tidak ditemukan.'
      });
    }

    // Remove file from disk
    const absolutePath = path.join(__dirname, '../../public', material.file_path);
    if (fs.existsSync(absolutePath)) {
      fs.unlinkSync(absolutePath);
    }

    await material.destroy();

    return res.status(200).json({
      status: 'success',
      message: 'Bahan ajar berhasil dihapus.'
    });
  } catch (error) {
    return res.status(500).json({
      status: 'error',
      message: 'Terjadi kesalahan saat menghapus bahan ajar.',
      error: error.message
    });
  }
};

module.exports = { uploadMaterial, getMaterials, downloadMaterial, deleteMaterial };
