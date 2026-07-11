const express = require('express');
const router = express.Router();
const { submitAttendance, getMyHistory, getReport } = require('../controllers/attendanceController');
const { openSession, closeSession, getSessionStatus } = require('../controllers/attendanceSessionController');
const { authenticate } = require('../middlewares/auth');
const { isPengurus } = require('../middlewares/roleCheck');
const { checkAttendanceActive } = require('../middlewares/checkAttendanceActive');

router.use(authenticate);

// Status sesi presensi (semua user yang login)
router.get('/session/status', getSessionStatus);

// Absensi hanya bisa dilakukan jika sesi aktif (dibuka oleh Pengurus)
router.post('/', checkAttendanceActive, submitAttendance);
router.get('/history', getMyHistory);

// Khusus Pengurus: kelola sesi presensi dan lihat rekap
router.post('/session/open', isPengurus, openSession);
router.post('/session/close', isPengurus, closeSession);
router.get('/report', isPengurus, getReport);

module.exports = router;
