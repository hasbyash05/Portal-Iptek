const express = require('express');
const router = express.Router();
const { authenticate } = require('../middlewares/auth');
const { isPengurus } = require('../middlewares/roleCheck');
const { handleUpload, handleUploadMultiple } = require('../middlewares/uploadHandler');
const { getProfile, uploadCertificate, uploadBatchCertificates, getAllCertificates, deleteCertificate } = require('../controllers/certificateController');

router.use(authenticate);

// Profil anggota (semua user bisa melihat)
router.get('/profile/:id', getProfile);

// Sertifikat: hanya Pengurus/Admin yang bisa CRUD
router.get('/', isPengurus, getAllCertificates);
router.post('/', isPengurus, handleUpload('certificate_file'), uploadCertificate);
router.post('/batch', isPengurus, handleUploadMultiple('certificate_files', 200), uploadBatchCertificates);
router.delete('/:id', isPengurus, deleteCertificate);

module.exports = router;
