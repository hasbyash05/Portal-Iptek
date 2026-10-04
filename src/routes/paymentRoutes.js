const express = require('express');
const router = express.Router();
const { submitPayment, checkStatus, getMyHistory, confirmPayment, getReport, getTotalKas, verifyPaymentWithAI, verifyAllPendingWithAI } = require('../controllers/paymentController');
const { authenticate } = require('../middlewares/auth');
const { isBendahara } = require('../middlewares/roleCheck');
const { handleUpload } = require('../middlewares/uploadHandler');
const { cacheMiddleware, clearCacheOnSuccess } = require('../middlewares/cache');

router.use(authenticate);

// Status bayar kas user di-cache 10 detik per user
router.get('/check', cacheMiddleware(10, (req) => `payments:check:${req.user ? req.user.id : 'anon'}`), checkStatus);
router.get('/total', cacheMiddleware(15, () => 'payments:total'), getTotalKas);
router.post('/', handleUpload('proof_file'), clearCacheOnSuccess('payments'), clearCacheOnSuccess('dashboard:stats'), submitPayment);
router.get('/history', getMyHistory);

// Khusus Bendahara: Verifikasi Manual & AI
router.put('/:id/confirm', isBendahara, clearCacheOnSuccess('payments'), clearCacheOnSuccess('dashboard:stats'), confirmPayment);
router.post('/:id/verify-ai', isBendahara, clearCacheOnSuccess('payments'), clearCacheOnSuccess('dashboard:stats'), verifyPaymentWithAI);
router.post('/verify-ai-all', isBendahara, clearCacheOnSuccess('payments'), clearCacheOnSuccess('dashboard:stats'), verifyAllPendingWithAI);
router.get('/report', isBendahara, getReport);

module.exports = router;
