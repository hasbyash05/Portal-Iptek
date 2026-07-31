const express = require('express');
const router = express.Router();
const { authenticate } = require('../middlewares/auth');
const { isAdmin } = require('../middlewares/roleCheck');
const {
  getAllUsers,
  createUser,
  updateUser,
  resetPassword,
  deleteUser
} = require('../controllers/userController');

// Semua endpoint dilindungi: harus login + role admin
router.use(authenticate, isAdmin);

router.get('/', getAllUsers);
router.post('/', createUser);
router.put('/:id', updateUser);
router.put('/:id/reset-password', resetPassword);
router.delete('/:id', deleteUser);

module.exports = router;
