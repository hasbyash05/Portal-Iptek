const express = require('express');
const router = express.Router();
const { uploadTemplate, getTemplates, downloadTemplate, deleteTemplate } = require('../controllers/templateController');
const { authenticate } = require('../middlewares/auth');
const { isPengurus } = require('../middlewares/roleCheck');
const { handleUpload } = require('../middlewares/uploadHandler');

router.use(authenticate);

router.get('/', getTemplates);
router.get('/download/:id', downloadTemplate);
router.post('/', isPengurus, handleUpload('template_file'), uploadTemplate);
router.delete('/:id', isPengurus, deleteTemplate);

module.exports = router;
