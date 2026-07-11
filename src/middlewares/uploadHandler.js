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

module.exports = { handleUpload };
