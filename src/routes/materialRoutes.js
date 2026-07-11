const express = require('express');
const router = express.Router();
const { uploadMaterial, getMaterials, downloadMaterial, deleteMaterial } = require('../controllers/materialController');
const { createSchedule, getSchedules, linkMaterial, unlinkMaterial, deleteSchedule, getInstructors } = require('../controllers/scheduleController');
const { authenticate } = require('../middlewares/auth');
const { isPengurus } = require('../middlewares/roleCheck');
const { handleUpload } = require('../middlewares/uploadHandler');

router.use(authenticate);

// Jadwal pertemuan (specific routes first)
router.get('/schedules', getSchedules);
router.post('/schedules', isPengurus, createSchedule);
router.put('/schedules/:id/link', isPengurus, linkMaterial);
router.delete('/schedules/:scheduleId/link/:materialId', isPengurus, unlinkMaterial);
router.delete('/schedules/:id', isPengurus, deleteSchedule);

// Daftar pemateri (pengurus) untuk dropdown
router.get('/instructors', getInstructors);

// Materi bahan ajar
router.get('/', getMaterials);
router.get('/download/:id', downloadMaterial);
router.post('/', isPengurus, handleUpload('material_file'), uploadMaterial);
router.delete('/:id', isPengurus, deleteMaterial);

module.exports = router;
