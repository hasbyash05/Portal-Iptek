const path = require('path');
const fs = require('fs');
const multer = require('multer');

// Konfigurasi multer khusus untuk upload gambar QRIS
const qrisStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, '../../public/uploads/qris');
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    // Selalu timpa dengan nama file tetap agar hanya ada 1 gambar QRIS aktif
    const ext = path.extname(file.originalname);
    cb(null, `qris_bendahara${ext}`);
  }
});

const qrisUpload = multer({
  storage: qrisStorage,
  limits: { fileSize: 5 * 1024 * 1024 }, // Maks 5MB
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/jpg', 'image/webp'];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Tipe file tidak diizinkan. Hanya JPEG, PNG, dan WebP.'), false);
    }
  }
});

/**
 * GET /api/qris/config
 * Mengambil konfigurasi QRIS aktif (gambar + info merchant).
 * Dapat diakses oleh semua user yang sudah login.
 */
const getConfig = async (req, res) => {
  try {
    const uploadsDir = path.join(__dirname, '../../public/uploads/qris');
    let qrisImageUrl = null;

    // Cari file gambar QRIS yang sudah diupload
    if (fs.existsSync(uploadsDir)) {
      const files = fs.readdirSync(uploadsDir);
      const qrisFile = files.find(f => f.startsWith('qris_bendahara'));
      if (qrisFile) {
        qrisImageUrl = `/uploads/qris/${qrisFile}`;
      }
    }

    return res.status(200).json({
      status: 'success',
      data: {
        qris_image_url: qrisImageUrl,
        merchant_name: process.env.QRIS_MERCHANT_NAME || 'Bendahara UKM IPTEK',
        nmid: process.env.QRIS_NMID || 'BELUM_DIKONFIGURASI',
        is_configured: qrisImageUrl !== null
      }
    });
  } catch (error) {
    return res.status(500).json({
      status: 'error',
      message: 'Gagal mengambil konfigurasi QRIS.',
      error: error.message
    });
  }
};

/**
 * POST /api/qris/upload
 * Mengunggah gambar QRIS statis dari Bendahara.
 * Hanya dapat diakses oleh Pengurus.
 */
const uploadQris = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        status: 'error',
        message: 'File gambar QRIS wajib diunggah.'
      });
    }

    const relativePath = `/uploads/qris/${req.file.filename}`;

    return res.status(200).json({
      status: 'success',
      message: 'Gambar QRIS Bendahara berhasil diunggah dan diaktifkan.',
      data: {
        qris_image_url: relativePath,
        filename: req.file.filename,
        size: req.file.size
      }
    });
  } catch (error) {
    return res.status(500).json({
      status: 'error',
      message: 'Gagal mengunggah gambar QRIS.',
      error: error.message
    });
  }
};

module.exports = { getConfig, uploadQris, qrisUpload };
