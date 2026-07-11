const express = require('express');
const router = express.Router();
const { authenticate } = require('../middlewares/auth');
const { isPengurus } = require('../middlewares/roleCheck');
const { getConfig, uploadQris, qrisUpload } = require('../controllers/qrisController');

// GET /api/qris/config - Ambil konfigurasi QRIS aktif (semua user login)
router.get('/config', authenticate, getConfig);

// POST /api/qris/upload - Upload gambar QRIS Bendahara (khusus Pengurus)
router.post('/upload', authenticate, isPengurus, qrisUpload.single('qris_image'), uploadQris);

module.exports = router;
