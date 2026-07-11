# Sistem Informasi Manajemen Iptek (Backend Node.js & PostgreSQL/SQLite)

Sistem Informasi Manajemen untuk organisasi Iptek yang memiliki dua peran utama: **Pengurus** (dengan sub-divisi) dan **Anggota**. Backend dibangun menggunakan Node.js (Express.js), ORM Sequelize, dan mendukung database **PostgreSQL** maupun **SQLite** untuk uji coba cepat lokal.

---

## Fitur Utama & Aturan Bisnis

1. **Autentikasi Username & Password (Tanpa Email)**
   * Login hanya menggunakan `username` dan `password` (karena UI Login sudah disiapkan oleh admin).
   * Token autentikasi menggunakan **JWT (JSON Web Token)**.
   * **Tidak ada API lupa password**; reset password hanya dilakukan oleh Admin secara manual di database.
2. **Laporan Mingguan (Khusus Pengurus)**
   * Pengurus wajib mengisi laporan kegiatan mingguan yang tercatat berdasarkan nomor minggu ISO (*ISO Week Number*).
   * Pencegahan duplikasi laporan pada minggu yang sama.
   * Fitur cek status laporan minggu berjalan (`/api/reports/check`).
3. **Bahan Ajar (Materi)**
   * Pengurus dapat mengunggah file (PDF, PPT, Video maksimal 50MB).
   * Anggota dan Pengurus dapat mengunduh dan melihat materi per minggu.
4. **Presensi Khusus Hari Selasa**
   * Presensi **hanya dapat dilakukan pada hari Selasa** (sesuai jadwal pertemuan organisasi Iptek) menggunakan zona waktu `Asia/Jakarta`.
   * User hanya dapat melakukan presensi 1 kali per hari.
   * Pengurus dapat melihat rekapitulasi kehadiran dengan filter tanggal dan divisi.
5. **Pembayaran Uang Kas Tetap Rp 10.000 / Bulan**
   * Nominal kas dipaksa tetap **Rp 10.000** secara otomatis oleh sistem. User tidak dapat mengubah nominal iuran.
   * User mengirimkan bulan (`month`), tahun (`year`), dan opsional bukti transfer.
   * Pengurus dapat melakukan verifikasi status (`lunas` atau `ditolak`).
6. **Dashboard Statistik & Ekspor PPT (Khusus Pengurus)**
   * Dashboard menyajikan statistik keanggotaan, grafik tren kehadiran per minggu, dan grafik kas terkumpul.
   * **Ekspor presentasi PowerPoint (.pptx)** secara asli (*native chart & table*) menggunakan **`pptxgenjs`** (tanpa Puppeteer sehingga sangat ringan).

---

## Langkah Instalasi & Menjalankan Proyek

### 1. Instalasi Dependensi
Pastikan Node.js (v18+) telah terinstal, lalu jalankan:
```bash
npm install
```

### 2. Konfigurasi Environment (`.env`)
Salin file `.env.example` menjadi `.env`:
```bash
cp .env.example .env
```
secara default, aplikasi akan menggunakan **SQLite** (`./database.sqlite`) agar Anda bisa langsung mencoba tanpa instalasi server database. Jika ingin menggunakan **PostgreSQL**, ubah `DB_DIALECT=postgres` dan sesuaikan `DB_HOST`, `DB_USER`, `DB_PASSWORD`, dan `DB_NAME` di file `.env`.

### 3. Migrasi & Seeding Database
Untuk membuat tabel dan mengisi akun pengurus dan anggota resmi, jalankan:
```bash
npm run seed
```

#### Kredensial Akun Hasil Seeder:
Seluruh akun resmi (pengurus, koordinator, dan anggota) akan di-generate dengan kata sandi acak yang aman. Daftar lengkap username dan password disimpan secara otomatis ke dalam file **`login_credentials.json`**.

### 4. Menjalankan Server
Untuk mode development (dengan auto-reload):
```bash
npm run dev
```
Atau untuk mode production:
```bash
npm start
```
Server akan berjalan di `http://localhost:4000`.

---

## Daftar Endpoint API

### Autentikasi
* `POST /api/auth/login` -> Login dengan `{ username, password }`
* `GET /api/auth/me` -> Ambil data profil user yang login *(Bearer Token)*

### Laporan Mingguan *(Khusus Pengurus)*
* `POST /api/reports` -> Kirim laporan mingguan `multipart/form-data` *(activity, attachment)*
* `GET /api/reports/check` -> Cek status apakah sudah melapor minggu ini
* `GET /api/reports/history` -> Riwayat laporan pengurus *(Pagination)*

### Bahan Ajar *(Materi)*
* `GET /api/materials` -> Daftar semua bahan ajar
* `GET /api/materials/download/:id` -> Download file bahan ajar
* `POST /api/materials` -> Upload bahan ajar `multipart/form-data` *(title, description, material_file)* *(Khusus Pengurus)*
* `DELETE /api/materials/:id` -> Hapus bahan ajar *(Khusus Pengurus)*

### Presensi *(Hanya Hari Selasa)*
* `POST /api/attendance` -> Presensi pertemuan `{ "status": "hadir" | "izin" | "sakit" | "alpa" }`
* `GET /api/attendance/history` -> Riwayat presensi diri sendiri
* `GET /api/attendance/report` -> Rekap presensi dengan filter query `?startDate=&endDate=&divisi=` *(Khusus Pengurus)*

### Pembayaran Kas *(Tetap Rp 10.000)*
* `POST /api/payments` -> Bayar kas `multipart/form-data` *(month, year, proof_file)*
* `GET /api/payments/history` -> Riwayat pembayaran kas diri sendiri
* `PUT /api/payments/:id/confirm` -> Verifikasi kas `{ "status": "lunas" | "ditolak" }` *(Khusus Pengurus)*
* `GET /api/payments/report` -> Laporan tagihan kas query `?month=&year=&status=` *(Khusus Pengurus)*

### Dashboard & Ekspor PPT *(Khusus Pengurus)*
* `GET /api/dashboard/stats` -> Data statistik dan grafik dashboard
* `GET /api/dashboard/export/ppt` -> Download presentasi PowerPoint (.pptx) dengan grafik dan tabel rekapitulasi query `?month=&year=`

---
*Dibuat oleh Tim Pengembang AI - Antigravity IDE.*
