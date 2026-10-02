const express = require('express');
const router = express.Router();
const { authenticate } = require('../middlewares/auth');
const { isBendahara } = require('../middlewares/roleCheck');
const { getConfig, uploadQris, qrisUpload } = require('../controllers/qrisController');
const { cacheMiddleware, clearCacheOnSuccess } = require('../middlewares/cache');

// GET /api/qris/config - Ambil konfigurasi QRIS aktif (di-cache 60 detik)
router.get('/config', authenticate, cacheMiddleware(60, () => 'qris:config'), getConfig);

// POST /api/qris/upload - Upload gambar QRIS Bendahara (khusus Bendahara, otomatis clear cache)
router.post('/upload', authenticate, isBendahara, qrisUpload.single('qris_image'), clearCacheOnSuccess('qris:config'), uploadQris);

module.exports = router;
