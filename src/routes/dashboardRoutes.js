const express = require('express');
const router = express.Router();
const { getDashboardStats, exportPPT } = require('../controllers/dashboardController');
const { authenticate } = require('../middlewares/auth');
const { isPengurus } = require('../middlewares/roleCheck');
const { cacheMiddleware } = require('../middlewares/cache');

router.use(authenticate, isPengurus); // Dashboard dan ekspor hanya untuk Pengurus

// Stats dashboard di-cache 15 detik untuk menghindari query agregasi database berulang
router.get('/stats', cacheMiddleware(15, () => 'dashboard:stats'), getDashboardStats);
router.get('/export/ppt', exportPPT);

module.exports = router;
