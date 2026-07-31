const express = require('express');
const router = express.Router();
const { authenticate } = require('../middlewares/auth');
const isPengurusOrAdmin = (req, res, next) => {
  if (!req.user || !['pengurus', 'admin'].includes(req.user.role)) {
    return res.status(403).json({
      status: 'error',
      message: 'Akses ditolak. Endpoint ini khusus untuk Pengurus / Admin.'
    });
  }
  next();
};

const {
  getAllUsers,
  createUser,
  updateUser,
  resetPassword,
  deleteUser
} = require('../controllers/userController');

// Semua endpoint dilindungi: harus login + role pengurus atau admin
router.use(authenticate, isPengurusOrAdmin);

router.get('/', getAllUsers);
router.post('/', createUser);
router.put('/:id', updateUser);
router.put('/:id/reset-password', resetPassword);
router.delete('/:id', deleteUser);

module.exports = router;
