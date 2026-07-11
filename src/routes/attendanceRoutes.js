const express = require('express');
const router = express.Router();
const { submitAttendance, getMyHistory, getReport } = require('../controllers/attendanceController');
const { authenticate } = require('../middlewares/auth');
const { isPengurus } = require('../middlewares/roleCheck');
const { checkTuesday } = require('../middlewares/tuesdayCheck');

router.use(authenticate);

// Semua role (absen hanya hari Selasa)
router.post('/', checkTuesday, submitAttendance);
router.get('/history', getMyHistory);

// Khusus Pengurus
router.get('/report', isPengurus, getReport);

module.exports = router;
