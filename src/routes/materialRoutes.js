const express = require('express');
const router = express.Router();
const { uploadMaterial, getMaterials, downloadMaterial, deleteMaterial } = require('../controllers/materialController');
const { createSchedule, getSchedules, linkMaterial, unlinkMaterial, deleteSchedule, getInstructors } = require('../controllers/scheduleController');
const { authenticate } = require('../middlewares/auth');
const { isPengurus } = require('../middlewares/roleCheck');
const { handleUpload } = require('../middlewares/uploadHandler');
const { cacheMiddleware, clearCacheOnSuccess } = require('../middlewares/cache');

router.use(authenticate);

// Jadwal pertemuan (di-cache 30 detik)
router.get('/schedules', cacheMiddleware(30, () => 'materials:schedules'), getSchedules);
router.post('/schedules', isPengurus, clearCacheOnSuccess('materials'), createSchedule);
router.put('/schedules/:id/link', isPengurus, clearCacheOnSuccess('materials'), linkMaterial);
router.delete('/schedules/:scheduleId/link/:materialId', isPengurus, clearCacheOnSuccess('materials'), unlinkMaterial);
router.delete('/schedules/:id', isPengurus, clearCacheOnSuccess('materials'), deleteSchedule);

// Daftar pemateri (pengurus) untuk dropdown (di-cache 60 detik)
router.get('/instructors', cacheMiddleware(60, () => 'materials:instructors'), getInstructors);

// Materi bahan ajar (di-cache 30 detik)
router.get('/', cacheMiddleware(30, (req) => `materials:list:${JSON.stringify(req.query)}`), getMaterials);
router.get('/download/:id', downloadMaterial);
router.post('/', isPengurus, handleUpload('material_file'), clearCacheOnSuccess('materials'), uploadMaterial);
router.delete('/:id', isPengurus, clearCacheOnSuccess('materials'), deleteMaterial);

module.exports = router;
