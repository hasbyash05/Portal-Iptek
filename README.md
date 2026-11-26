# Sistem Informasi Manajemen Iptek (Backend Rust & MySQL)

Sistem Informasi Manajemen internal organisasi UKM IPTEK STIKES Semarang yang memiliki dua peran utama: **Pengurus** (dengan sub-divisi) dan **Anggota**. Backend dibangun sepenuhnya menggunakan **Rust** (`axum`, `tokio`, `sqlx` MySQL, `jsonwebtoken`, `bcrypt`, `reqwest`, dan generator `.pptx` OpenXML murni Rust).

---

## Fitur Utama & Aturan Bisnis

1. **Autentikasi Username & Password (Tanpa Email)**
   * Login menggunakan `username` dan `password` dengan hashing `bcrypt` dan sesi **JWT (HS256)**.
   * Rate limiting login per IP (maksimal 10 percobaan per 30 detik).
   * Pencatatan perangkat (`user_devices`) untuk keamanan absensi.
2. **Laporan Mingguan (Khusus Pengurus)**
   * Laporan kegiatan mingguan berdasarkan nomor minggu ISO (*ISO Week Number*) zona waktu `Asia/Jakarta`.
   * Pencegahan duplikasi laporan pada minggu yang sama dan dukungan lampiran file.
3. **Bahan Ajar & Jadwal Pertemuan**
   * Pengurus mengunggah bahan ajar (PDF, PPT, Video maksimal 50MB) serta mengelola jadwal pertemuan dan tautan banyak materi.
4. **Presensi Pertemuan & Gerbang Kunci Kas**
   * Sesi presensi dibuka/ditutup oleh Ketua/Wakil dengan mode `onsite` (validasi GPS radius 100m) atau `anywhere`.
   * Anggota wajib melunasi uang kas bulan berjalan (`lunas`) agar gerbang absensi terbuka.
   * Proteksi anti-titip absen berbasis `device_fingerprint` dan ekspor matriks kehadiran CSV (UTF-8 BOM).
5. **Pembayaran Uang Kas Tetap Rp 10.000 / Bulan & Verifikasi AI Gemini**
   * Nominal kas dipaksa tetap **Rp 10.000** oleh backend.
   * Verifikasi otomatis bukti transfer menggunakan Google Gemini Vision API (dengan fallback 3 model) dan verifikasi manual oleh Bendahara.
   * Manajemen pengeluaran kas (`kas_expenses`), konfigurasi QRIS statis, dan pembersihan file bukti bulan lama.
6. **Sertifikat, Template Dokumen & E-Voting (Pemilu)**
   * Unggah sertifikat satuan dan massal (*batch*) dengan pencocokan nama otomatis ke akun anggota.
   * Sistem E-Voting transaksional (1 akun = 1 suara), monitoring real-time, audit DPT, dan manajemen kandidat.
7. **Dashboard Statistik & Ekspor PPTX Murni Rust**
   * Dashboard statistik keanggotaan, kas, dan kehadiran dengan caching in-memory.
   * Ekspor presentasi PowerPoint (`.pptx`) dengan grafik batang dan tabel OpenXML asli tanpa runtime eksternal.

---

## Langkah Instalasi & Menjalankan Proyek

### 1. Prasyarat
Pastikan toolchain Rust (`rustc` & `cargo`) dan database **MySQL** sudah tersedia.

### 2. Konfigurasi Environment (`.env`)
Salin file `.env.example` menjadi `.env` dan sesuaikan kredensial MySQL, `JWT_SECRET`, serta `GEMINI_API_KEY`:
```bash
cp .env.example .env
```

### 3. Seeding Database (Akun Resmi)
Untuk membuat ulang tabel dan mengisi seluruh akun resmi pengurus serta anggota (hasil kredensial disimpan di `login_credentials.json`):
```bash
cargo run --release -- --seed
```

### 4. Build & Menjalankan Server
Mode development:
```bash
cargo run
```
Mode production (binari optimal):
```bash
cargo build --release
./target/release/iptek-backend
```
Server akan berjalan pada port sesuai `PORT` di `.env` (default `http://localhost:4000`).

---

## Menjalankan Unit Test
```bash
cargo test
```
