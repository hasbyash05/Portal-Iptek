# Panduan Konfigurasi QRIS untuk Bendahara UKM IPTEK

Dokumen ini berisi langkah-langkah bagi **Bendahara** untuk menyiapkan dan mengaktifkan gambar QRIS pada Sistem Informasi Manajemen (SIM) Internal UKM IPTEK STIKES Semarang.

---

## Prasyarat

- Anda memiliki akun e-wallet (GoPay, OVO, Dana, ShopeePay, dll) atau rekening bank yang sudah mendukung **QRIS statis** (hampir semua bank dan e-wallet di Indonesia sudah mendukung fitur ini).
- Anda memiliki akun **Pengurus** pada SIM Internal UKM IPTEK.

---

## Langkah 1: Buat QRIS Statis dari Rekening Pribadi

Setiap aplikasi bank/e-wallet memiliki menu untuk membuat QRIS statis Anda sendiri. Berikut contoh umum:

### GoPay (via Gojek)
1. Buka aplikasi **Gojek**.
2. Tap ikon **GoPay** di halaman utama.
3. Pilih menu **Terima Pembayaran** atau **QR Code Saya**.
4. QR Code QRIS statis Anda akan muncul di layar.
5. **Screenshot** atau gunakan tombol **Simpan** untuk menyimpan gambar QR tersebut ke galeri HP.

### OVO
1. Buka aplikasi **OVO**.
2. Tap menu **Terima Uang** atau **QR Code Saya**.
3. QR Code QRIS akan ditampilkan.
4. **Screenshot** dan simpan gambar ke galeri.

### Dana
1. Buka aplikasi **Dana**.
2. Tap ikon **QR** di halaman utama.
3. Pilih tab **Terima** atau **My QR**.
4. **Screenshot** dan simpan gambar ke galeri.

### Aplikasi Bank (BCA, BRI, Mandiri, BNI, dll)
1. Buka aplikasi mobile banking Anda.
2. Cari menu **QRIS** atau **QR Code Saya** / **Terima Pembayaran**.
3. QR Code akan ditampilkan. Simpan gambar ke galeri.

> **Catatan:** QRIS statis bersifat tetap (tidak berubah) dan dapat digunakan berulang kali untuk menerima pembayaran dari siapa saja. Nominal pembayaran ditentukan oleh pengirim.

---

## Langkah 2: Unggah Gambar QRIS ke Sistem

1. **Login** ke SIM Internal UKM IPTEK menggunakan akun Pengurus Anda.
2. Klik tab **Uang Kas** di menu navigasi atas.
3. Di bagian atas halaman, Anda akan melihat card **Pengaturan QRIS Bendahara**.
4. Klik tombol **Choose File** / **Pilih File** dan pilih gambar QRIS yang sudah Anda simpan di Langkah 1.
5. Klik tombol **Unggah dan Aktifkan QRIS**.
6. Sistem akan mengonfirmasi bahwa gambar QRIS berhasil diunggah.
7. Preview gambar QRIS yang aktif akan muncul di sebelah kanan form.

---

## Langkah 3: Verifikasi Tampilan di Sisi Anggota

Setelah gambar QRIS diunggah, gambar tersebut akan langsung muncul di dua tempat bagi Anggota:

1. **Tab Uang Kas** -- Anggota melihat gambar QRIS saat membuka halaman pembayaran kas bulanan.
2. **Modal Gerbang Presensi** -- Jika anggota belum membayar kas dan mencoba mengakses menu Presensi, modal pengunci akan menampilkan gambar QRIS ini agar mereka bisa langsung membayar.

---

## Cara Kerja Pembayaran (Alur Anggota & Verifikasi Bendahara)

1. Anggota membuka tab **Uang Kas** atau dicegat oleh modal pengunci saat mengakses **Presensi**.
2. Anggota melihat gambar QRIS Bendahara yang sudah Anda unggah.
3. Anggota membuka aplikasi bank/e-wallet di HP mereka, memilih **Scan QR / QRIS**, dan memindai QR Code tersebut.
4. Anggota mentransfer **Rp 10.000**.
5. Setelah uang terkirim, anggota menekan tombol konfirmasi di sistem.
6. Status pembayaran masuk dengan status **`PENDING` (Menunggu Verifikasi Bendahara)**.
7. **Khusus Pengurus Bagian Bendahara (Arifah / Alfia)**: Login ke portal Pengurus, buka tab **Uang Kas**, lalu pilih filter **Pending (Need Confirm)**.
8. Periksa mutasi rekening/e-wallet Anda. Jika uang Rp 10.000 sudah masuk, klik tombol **`Lunas`**. Jika tidak ada uang masuk atau tidak valid, klik tombol **`Tolak`**.
9. Setelah diverifikasi menjadi **`LUNAS`**, gerbang presensi anggota tersebut otomatis terbuka.

---

## Pengecekan dan Keamanan Akses

- **Pembatasan Hak Verifikasi**: Tombol verifikasi Lunas/Ditolak pada sistem dijaga secara ketat dan **hanya dapat diakses oleh Pengurus dengan divisi Bendahara**. Pengurus dari divisi lain (Operasional, Kominfo, dll) hanya dapat melihat rekapitulasi tanpa bisa mengubah status pembayaran.
- **Audit Rutin**: Bendahara disarankan melakukan pemeriksaan mutasi secara berkala (terutama pada hari Senin dan Selasa sebelum pertemuan dimulai) agar anggota yang sudah membayar dapat segera melakukan presensi tepat waktu.

---

## Informasi NMID (Opsional)

Jika Anda mengetahui Nomor Merchant ID (NMID) dari QRIS Anda, Anda dapat mengubahnya di file `.env` pada server:

```
QRIS_MERCHANT_NAME=Nama Anda / Bendahara UKM IPTEK
QRIS_NMID=ID10XXXXXXXXXX
```

Informasi ini akan ditampilkan sebagai keterangan di bawah gambar QRIS pada halaman anggota.

---

*Dokumen ini dibuat untuk membantu transisi dari sistem simulasi ke sistem pembayaran QRIS nyata.*
