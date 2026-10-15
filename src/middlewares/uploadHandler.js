const { upload } = require('../config/multer');

const handleUpload = (fieldName) => {
  return (req, res, next) => {
    const uploadSingle = upload.single(fieldName);
    uploadSingle(req, res, (err) => {
      if (err) {
        return res.status(400).json({
          status: 'error',
          message: err.message || 'Gagal mengunggah file.'
        });
      }
      next();
    });
  };
};

const handleUploadMultiple = (fieldName, maxCount = 200) => {
  return (req, res, next) => {
    const uploadMulti = upload.array(fieldName, maxCount);
    uploadMulti(req, res, (err) => {
      if (err) {
        return res.status(400).json({
          status: 'error',
          message: err.message || 'Gagal mengunggah file-file sertifikat.'
        });
      }
      next();
    });
  };
};

module.exports = { handleUpload, handleUploadMultiple };
