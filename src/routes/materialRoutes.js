const express = require('express');
const router = express.Router();
const { uploadMaterial, getMaterials, downloadMaterial, deleteMaterial } = require('../controllers/materialController');
const { authenticate } = require('../middlewares/auth');
const { isPengurus } = require('../middlewares/roleCheck');
const { handleUpload } = require('../middlewares/uploadHandler');

// Endpoint publik atau untuk semua role
router.get('/', authenticate, getMaterials);
router.get('/download/:id', downloadMaterial); // Bisa diakses tanpa token atau dengan token

// Endpoint khusus pengurus
router.post('/', authenticate, isPengurus, handleUpload('material_file'), uploadMaterial);
router.delete('/:id', authenticate, isPengurus, deleteMaterial);

module.exports = router;
