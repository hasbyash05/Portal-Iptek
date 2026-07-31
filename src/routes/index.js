const express = require('express');
const router = express.Router();

const authRoutes = require('./authRoutes');
const reportRoutes = require('./reportRoutes');
const materialRoutes = require('./materialRoutes');
const attendanceRoutes = require('./attendanceRoutes');
const paymentRoutes = require('./paymentRoutes');
const dashboardRoutes = require('./dashboardRoutes');
const qrisRoutes = require('./qrisRoutes');
const templateRoutes = require('./templateRoutes');
const userRoutes = require('./userRoutes');

router.use('/auth', authRoutes);
router.use('/reports', reportRoutes);
router.use('/materials', materialRoutes);
router.use('/attendance', attendanceRoutes);
router.use('/payments', paymentRoutes);
router.use('/dashboard', dashboardRoutes);
router.use('/qris', qrisRoutes);
router.use('/templates', templateRoutes);
router.use('/users', userRoutes);

// Helper route for direct export if frontend calls /api/export/ppt
router.use('/export', dashboardRoutes);

// 404 Handler for API
router.use((req, res) => {
  res.status(404).json({
    status: 'error',
    message: `Endpoint API '${req.originalUrl}' tidak ditemukan.`
  });
});

module.exports = router;
