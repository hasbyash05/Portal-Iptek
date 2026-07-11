const express = require('express');
const router = express.Router();
const { submitReport, checkStatus, getHistory } = require('../controllers/reportController');
const { authenticate } = require('../middlewares/auth');
const { isPengurus } = require('../middlewares/roleCheck');
const { handleUpload } = require('../middlewares/uploadHandler');

router.use(authenticate, isPengurus); // Semua endpoint laporan hanya untuk pengurus

router.post('/', handleUpload('attachment'), submitReport);
router.get('/check', checkStatus);
router.get('/history', getHistory);

module.exports = router;
