require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
const { sequelize, User } = require('./models');
const apiRoutes = require('./routes');

const app = express();

// Trust proxy agar express-rate-limit membaca IP asli pengguna
// (wajib jika di belakang reverse proxy: cPanel Passenger, Nginx, dsb.)
app.set('trust proxy', 1);

// Helmet: HTTP security headers
app.use(helmet({
  contentSecurityPolicy: false, // Dimatikan agar frontend statis tidak terblokir
  crossOriginEmbedderPolicy: false
}));

// Rate limiting khusus endpoint login (maks 10 percobaan per 30 detik per IP)
const loginLimiter = rateLimit({
  windowMs: 30 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    // Ambil IP asli dari header proxy, fallback ke req.ip
    return req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip;
  },
  message: {
    status: 'error',
    message: 'Terlalu banyak percobaan login. Silakan coba lagi setelah 30 detik.'
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

// Konfigurasi HTTP Caching untuk aset statis agar browser tidak membebani server
const staticCacheOptions = {
  maxAge: '1d',
  etag: true,
  lastModified: true,
  setHeaders: (res, filePath) => {
    if (!res.headersSent) {
      // HTML jangan di-cache permanen agar pembaruan kode frontend langsung tampil
      if (filePath.endsWith('.html')) {
        res.setHeader('Cache-Control', 'no-cache, must-revalidate');
      } else if (filePath.match(/\.(jpg|jpeg|png|gif|svg|ico|webp|pdf)$/i)) {
        // Gambar dan media di-cache 7 hari
        res.setHeader('Cache-Control', 'public, max-age=604800, immutable');
      } else if (filePath.match(/\.(css|js)$/i)) {
        // File CSS dan JS di-cache 1 hari dengan revalidasi
        res.setHeader('Cache-Control', 'public, max-age=86400, must-revalidate');
      }
    }
  }
};

// Serve static files from public directory (UI & Uploads)
app.use(express.static(path.join(__dirname, '../public'), staticCacheOptions));
app.use('/uploads', express.static(path.join(__dirname, '../public/uploads'), staticCacheOptions));
app.use('/asset', express.static(path.join(__dirname, '../asset'), staticCacheOptions));

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

// Inisialisasi Database
sequelize.authenticate()
  .then(async () => {
    console.log('[DB] Koneksi ke database MySQL berhasil.');
    if (process.env.NODE_ENV === 'development') {
      await sequelize.sync({ alter: true });
      console.log('[DB] Tabel database tersinkronisasi.');
      const userCount = await User.count();
      if (userCount === 0) {
        console.log('[DB] Database kosong. Mengisi data awal (seeding)...');
        const { seedDatabase } = require('./seeders/seed');
        await seedDatabase();
      }
    } else {
      // Production: sync tanpa alter, tabel harus sudah ada
      await sequelize.sync({ alter: false });
      console.log('[DB] Tabel database tersinkronisasi (production mode).');

      // Migrasi aman: tambah kolom attendance_mode jika belum ada
      try {
        const [columns] = await sequelize.query("SHOW COLUMNS FROM `attendance_sessions` LIKE 'attendance_mode'");
        if (columns.length === 0) {
          await sequelize.query("ALTER TABLE `attendance_sessions` ADD COLUMN `attendance_mode` ENUM('onsite','anywhere') NOT NULL DEFAULT 'onsite'");
          console.log("[DB] Kolom 'attendance_mode' berhasil ditambahkan ke tabel attendance_sessions.");
        }
      } catch (migErr) {
        console.warn('[DB] Migrasi attendance_mode:', migErr.message);
      }
    }
  })
  .catch((error) => {
    console.error('[DB ERROR] Gagal menginisialisasi database:', error.message);
  });

// Deteksi jika berjalan di cPanel (Phusion Passenger)
if (typeof PhusionPassenger !== 'undefined') {
  // Passenger akan otomatis mengambil server dari sini
  app.listen('passenger'); 
} else {
  // Berjalan di komputer lokal (Development)
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[SERVER] Berjalan di http://localhost:${PORT}`);
  });
}

module.exports = app;
