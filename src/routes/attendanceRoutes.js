const express = require('express');
const router = express.Router();
const { submitAttendance, getMyHistory, getReport } = require('../controllers/attendanceController');
const { openSession, closeSession, getSessionStatus } = require('../controllers/attendanceSessionController');
const { authenticate } = require('../middlewares/auth');
const { isKetuaWakil } = require('../middlewares/roleCheck');
const { checkAttendanceActive } = require('../middlewares/checkAttendanceActive');

router.use(authenticate);

// Status sesi presensi (semua user yang login)
router.get('/session/status', getSessionStatus);

// Absensi hanya bisa dilakukan jika sesi aktif (dibuka oleh Pengurus)
router.post('/', checkAttendanceActive, submitAttendance);
router.get('/history', getMyHistory);

// Khusus Ketua & Wakil: kelola sesi presensi dan lihat rekap
router.post('/session/open', isKetuaWakil, openSession);
router.post('/session/close', isKetuaWakil, closeSession);
router.get('/report', isKetuaWakil, getReport);

module.exports = router;
