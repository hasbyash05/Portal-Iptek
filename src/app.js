require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
const { sequelize, User } = require('./models');
const apiRoutes = require('./routes');

const app = express();

// Helmet: HTTP security headers
app.use(helmet({
  contentSecurityPolicy: false, // Dimatikan agar frontend statis tidak terblokir
  crossOriginEmbedderPolicy: false
}));

// Rate limiting khusus endpoint login (maks 10 percobaan per 15 menit per IP)
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    status: 'error',
    message: 'Terlalu banyak percobaan login. Silakan coba lagi setelah 15 menit.'
  }
});
app.use('/api/auth/login', loginLimiter);

// CORS
app.use(cors({
  origin: process.env.CLIENT_ORIGIN || '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static files from public directory (UI & Uploads)
app.use(express.static(path.join(__dirname, '../public')));
app.use('/uploads', express.static(path.join(__dirname, '../public/uploads')));
app.use('/asset', express.static(path.join(__dirname, '../asset')));

// Routes
app.use('/api', apiRoutes);


// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({
    status: 'error',
    message: 'Terjadi kesalahan internal pada server.',
    error: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

const PORT = process.env.PORT || 4000;

// Start server function
const startServer = async () => {
  try {
    await sequelize.authenticate();
    console.log('✅ Koneksi ke database berhasil.');

    // Auto sync tables in development
    if (process.env.NODE_ENV === 'development') {
      await sequelize.sync({ alter: false });
      console.log('✅ Database tersinkronisasi.');

      const userCount = await User.count();
      if (userCount === 0) {
        console.log('⚠️ Database kosong. Mengisi data awal (seeding) secara otomatis dengan password tetap...');
        const { seedDatabase } = require('./seeders/seed');
        await seedDatabase();
      }
    }

    app.listen(PORT, '0.0.0.0', () => {
      console.log(`🚀 Server berjalan di http://localhost:${PORT} dan siap diakses via Wi-Fi!`);
    });
  } catch (error) {
    console.error('❌ Gagal menginisialisasi server:', error.message);
  }
};

if (require.main === module) {
  startServer();
}

module.exports = app;
