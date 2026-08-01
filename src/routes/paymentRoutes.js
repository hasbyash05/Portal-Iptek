const express = require('express');
const router = express.Router();
const { submitPayment, checkStatus, getMyHistory, confirmPayment, getReport, getTotalKas } = require('../controllers/paymentController');
const { authenticate } = require('../middlewares/auth');
const { isBendahara } = require('../middlewares/roleCheck');
const { handleUpload } = require('../middlewares/uploadHandler');

router.use(authenticate);

// Semua role
router.get('/check', checkStatus);
router.get('/total', getTotalKas);
router.post('/', handleUpload('proof_file'), submitPayment);
router.get('/history', getMyHistory);

// Khusus Bendahara
router.put('/:id/confirm', isBendahara, confirmPayment);
router.get('/report', isBendahara, getReport);

module.exports = router;
