const express = require('express');
const router = express.Router();
const { authenticate } = require('../middlewares/auth');
const { isBendahara } = require('../middlewares/roleCheck');
const { getConfig, uploadQris, qrisUpload } = require('../controllers/qrisController');

// GET /api/qris/config - Ambil konfigurasi QRIS aktif (semua user login)
router.get('/config', authenticate, getConfig);

// POST /api/qris/upload - Upload gambar QRIS Bendahara (khusus Bendahara)
router.post('/upload', authenticate, isBendahara, qrisUpload.single('qris_image'), uploadQris);

module.exports = router;
