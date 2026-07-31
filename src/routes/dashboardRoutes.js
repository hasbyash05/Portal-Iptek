const express = require('express');
const router = express.Router();
const { getDashboardStats, exportPPT } = require('../controllers/dashboardController');
const { authenticate } = require('../middlewares/auth');
const { isPengurus } = require('../middlewares/roleCheck');

router.use(authenticate, isPengurus); // Dashboard dan ekspor hanya untuk Pengurus

router.get('/stats', getDashboardStats);
router.get('/export/ppt', exportPPT);

module.exports = router;
