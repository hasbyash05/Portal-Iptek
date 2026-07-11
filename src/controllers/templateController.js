const path = require('path');
const fs = require('fs');
const { DocumentTemplate, User } = require('../models');

const uploadTemplate = async (req, res) => {
  try {
    const { title, category, description } = req.body;
    if (!title || !category) {
      return res.status(400).json({
        status: 'error',
        message: 'Judul dan kategori template dokumen wajib diisi.'
      });
    }

    if (!req.file) {
      return res.status(400).json({
        status: 'error',
        message: 'File template dokumen wajib diunggah.'
      });
    }

    const filePath = `/uploads/templates/${req.file.filename}`;

    const template = await DocumentTemplate.create({
      title,
      category,
      description: description || '',
      file_path: filePath,
      uploaded_by: req.user.id
    });

    return res.status(201).json({
      status: 'success',
      message: 'Template dokumen berhasil diunggah.',
      data: template
    });
  } catch (error) {
    return res.status(500).json({
      status: 'error',
      message: 'Terjadi kesalahan saat mengunggah template dokumen.',
      error: error.message
    });
  }
};

const getTemplates = async (req, res) => {
  try {
    const templates = await DocumentTemplate.findAll({
      include: [
        {
          model: User,
          as: 'uploader',
          attributes: ['id', 'nama_lengkap', 'divisi']
        }
      ],
      order: [['created_at', 'DESC']]
    });

    const formatted = templates.map(t => ({
      id: t.id,
      title: t.title,
      category: t.category,
      description: t.description,
      uploaded_by: t.uploader ? t.uploader.nama_lengkap : 'Admin',
      divisi: t.uploader ? t.uploader.divisi : '-',
      download_url: `/api/templates/download/${t.id}`,
      created_at: t.created_at
    }));

    return res.status(200).json({
      status: 'success',
      data: formatted
    });
  } catch (error) {
    return res.status(500).json({
      status: 'error',
      message: 'Terjadi kesalahan saat mengambil daftar template dokumen.',
      error: error.message
    });
  }
};

const downloadTemplate = async (req, res) => {
  try {
    const { id } = req.params;
    const template = await DocumentTemplate.findByPk(id);

    if (!template) {
      return res.status(404).json({
        status: 'error',
        message: 'Template dokumen tidak ditemukan.'
      });
    }

    const absolutePath = path.join(__dirname, '../../public', template.file_path);
    if (!fs.existsSync(absolutePath)) {
      return res.status(404).json({
        status: 'error',
        message: 'File fisik tidak ditemukan di server.'
      });
    }

    return res.download(absolutePath, path.basename(template.file_path));
  } catch (error) {
    return res.status(500).json({
      status: 'error',
      message: 'Terjadi kesalahan saat mengunduh template dokumen.',
      error: error.message
    });
  }
};

const deleteTemplate = async (req, res) => {
  try {
    const { id } = req.params;
    const template = await DocumentTemplate.findByPk(id);

    if (!template) {
      return res.status(404).json({
        status: 'error',
        message: 'Template dokumen tidak ditemukan.'
      });
    }

    const absolutePath = path.join(__dirname, '../../public', template.file_path);
    if (fs.existsSync(absolutePath)) {
      fs.unlinkSync(absolutePath);
    }

    await template.destroy();

    return res.status(200).json({
      status: 'success',
      message: 'Template dokumen berhasil dihapus.'
    });
  } catch (error) {
    return res.status(500).json({
      status: 'error',
      message: 'Terjadi kesalahan saat menghapus template dokumen.',
      error: error.message
    });
  }
};

module.exports = { uploadTemplate, getTemplates, downloadTemplate, deleteTemplate };
