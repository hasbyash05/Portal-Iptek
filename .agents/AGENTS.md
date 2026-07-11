# AGENTS.md — Sistem Informasi Manajemen (SIM) Internal UKM IPTEK STIKES Semarang

## Identitas & Fungsi Proyek
Sistem Informasi Manajemen (SIM) Internal organisasi UKM IPTEK STIKES Semarang untuk mengelola operasional internal dengan dua peran utama: **Pengurus** (dengan sub-divisi) dan **Anggota**.
Berbeda dengan folder `web` (yang berfungsi sebagai profil publik & informasi eksternal), folder `belajar` ini berfungsi sebagai **portal manajemen operasional rutin internal**.

## Design Direction: Minimalis Profesional (Konsisten dengan Profil Web)
- **Palette**: monocrome (hitam `#18181b`, putih `#ffffff`, abu-abu `#f8f9fa` / `#4b5563` dengan kontras bersih)
- **No gradients**, no glassmorphism, no animated blobs, no decorative animations
- **No Emojis**: Tidak boleh ada emoji atau emoticon apapun di seluruh antarmuka (UI/HTML), alert/notifikasi, teks JavaScript, maupun log/dokumentasi. Gunakan ikon profesional FontAwesome atau teks biasa yang bersih.
- **Cards**: no border (`border: none`), solid white bg, subtle shadow (`box-shadow: 0 1px 3px rgba(0,0,0,0.05)`), no blur
- **Typography**: clean hierarchy, restrained sizes (Google Fonts: Inter + Outfit, rapi dan profesional)
- **Interactions**: subtle opacity/hover effects, no floating/glow (fungsional, elegan, dan langsung pada tujuan)

## Spesifikasi Fungsi Khusus SIM Internal

### 1. Autentikasi Multi-Role
- Login menggunakan `username` dan `password` (bukan email).
- Akun dibuat dan dikelola sepenuhnya oleh Admin/Pengurus (tidak ada fitur reset password mandiri untuk menjaga keamanan internal).
- Sesi dikelola menggunakan JWT (`Bearer <token>`) di *localStorage*.

### 2. Mekanisme Uang Kas (QRIS Instan & Verifikasi Bendahara)
- **Nominal Wajib**: Tetap di angka **Rp 10.000 / bulan**.
- **Metode Pembayaran**: Menggunakan **QRIS** statis dari rekening Bendahara.
- **Verifikasi Bendahara**: Pembayaran QRIS **tidak otomatis lunas**, melainkan masuk dengan status **`pending`** (menunggu konfirmasi). Status **`LUNAS`** atau **`DITOLAK`** sepenuhnya diverifikasi dan diputuskan oleh **Pengurus bagian Bendahara** setelah memeriksa mutasi transaksi.

### 3. Gerbang Kunci Absensi Pertemuan (Lock Modal)
- **Jadwal Pertemuan**: Absensi hanya dibuka pada hari **Selasa** (menggunakan zona waktu `Asia/Jakarta`).
- **Gerbang QRIS Wajib**: Anggota **tidak dapat melakukan absensi** jika belum melunasi uang kas bulan berjalan (Rp 10.000) dan diverifikasi `LUNAS` oleh Bendahara.
- **Modal Pengunci**: Jika belum bayar atau pembayaran masih `pending`, antarmuka akan menampilkan modal *overlay* merah berisi barcode QRIS pembayaran instan dan status verifikasi. Begitu diverifikasi `LUNAS` oleh Bendahara, gerbang absensi terbuka otomatis.
- **Proteksi API**: Endpoint `POST /api/attendance` dijaga di tingkat database dan akan menolak request dengan status `403 Forbidden` jika kas bulan ini belum lunas.

### 4. Manajemen Laporan Mingguan & Bahan Ajar
- **Pengurus**: Wajib melaporkan kegiatan mingguan (dapat melampirkan file/foto), mengunggah bahan ajar sesuai minggu/tahun, dan memantau rekap absensi serta kas.
- **Anggota**: Membaca dan mengunduh bahan ajar mingguan, melunasi kas QRIS, dan melakukan absensi pertemuan Selasa.

### 5. Ekspor Laporan & Presentasi
- Ekspor rekapitulasi kinerja bulanan ke format presentasi PowerPoint (`.pptx`) secara otomatis menggunakan `pptxgenjs` dengan grafik statistik dari `chartjs-node-canvas` (tanpa Puppeteer).

### 6. Larangan Data Contoh / Dummy (Pure Real People Only)
- **Dilarang Ada File/Data Contoh**: Tidak boleh ada pembuatan atau penyertaan data contoh/dummy (seperti contoh absen dari anggota, contoh bayar kas, contoh bahan ajar pengantar dari pengurus, atau contoh laporan kegiatan mingguan) di dalam seeder maupun inisialisasi database.
- **Hanya Orang Asli & Interaksi Nyata**: Seeder database hanya boleh membuat akun resmi pengurus dan anggota nyata organisasi UKM IPTEK STIKES Semarang sesuai kredensial resmi. Seluruh data transaksi operasional (absensi, uang kas, materi, laporan mingguan) harus murni (*pure*) dari aktivitas orang/pengguna asli.
