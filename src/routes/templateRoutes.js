const express = require('express');
const router = express.Router();
const { uploadTemplate, getTemplates, downloadTemplate, deleteTemplate } = require('../controllers/templateController');
const { authenticate } = require('../middlewares/auth');
const { isPengurus } = require('../middlewares/roleCheck');
const { handleUpload } = require('../middlewares/uploadHandler');
const { cacheMiddleware, clearCacheOnSuccess } = require('../middlewares/cache');

router.use(authenticate);

router.get('/', cacheMiddleware(30, () => 'templates:list'), getTemplates);
router.get('/download/:id', downloadTemplate);
router.post('/', isPengurus, handleUpload('template_file'), clearCacheOnSuccess('templates'), uploadTemplate);
router.delete('/:id', isPengurus, clearCacheOnSuccess('templates'), deleteTemplate);

module.exports = router;
