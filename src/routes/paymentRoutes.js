const express = require('express');
const router = express.Router();
const { submitPayment, checkStatus, getMyHistory, confirmPayment, getReport } = require('../controllers/paymentController');
const { authenticate } = require('../middlewares/auth');
const { isPengurus } = require('../middlewares/roleCheck');
const { handleUpload } = require('../middlewares/uploadHandler');

router.use(authenticate);

// Semua role
router.get('/check', checkStatus);
router.post('/', handleUpload('proof_file'), submitPayment);
router.get('/history', getMyHistory);

// Khusus Pengurus
router.put('/:id/confirm', isPengurus, confirmPayment);
router.get('/report', isPengurus, getReport);

module.exports = router;
