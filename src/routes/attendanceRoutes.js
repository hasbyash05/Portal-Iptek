const express = require('express');
const router = express.Router();
const { submitAttendance, getMyHistory, getReport } = require('../controllers/attendanceController');
const { openSession, closeSession, setAttendanceMode, getSessionStatus } = require('../controllers/attendanceSessionController');
const { authenticate } = require('../middlewares/auth');
const { isKetuaWakil, isKetua } = require('../middlewares/roleCheck');
const { checkAttendanceActive } = require('../middlewares/checkAttendanceActive');
const { cacheMiddleware, clearCacheOnSuccess } = require('../middlewares/cache');

router.use(authenticate);

// Status sesi presensi (di-cache 10 detik, shared semua user agar query database tidak membludak saat jam presensi)
router.get('/session/status', cacheMiddleware(10, () => 'attendance:session:status'), getSessionStatus);

// Absensi hanya bisa dilakukan jika sesi aktif (dibuka oleh Pengurus)
router.post('/', checkAttendanceActive, clearCacheOnSuccess('dashboard:stats'), submitAttendance);
router.get('/history', getMyHistory);

// Khusus Ketua & Wakil: kelola sesi presensi dan lihat rekap (otomatis invalidate cache sesi)
router.post('/session/open', isKetuaWakil, clearCacheOnSuccess('attendance:session'), openSession);
router.post('/session/close', isKetuaWakil, clearCacheOnSuccess('attendance:session'), closeSession);
router.get('/report', isKetuaWakil, getReport);

// Khusus Ketua saja: ubah mode presensi (onsite / anywhere)
router.put('/session/mode', isKetua, clearCacheOnSuccess('attendance:session'), setAttendanceMode);

module.exports = router;
