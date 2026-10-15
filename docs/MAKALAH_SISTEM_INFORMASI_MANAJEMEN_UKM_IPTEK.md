# MAKALAH
## PENGEMBANGAN SISTEM INFORMASI MANAJEMEN (SIM) OPERASIONAL INTERNAL BERBASIS WEB PADA UNIT KEGIATAN MAHASISWA ILMU PENGETAHUAN DAN TEKNOLOGI (UKM IPTEK) STIKES SEMARANG

---

### Disusun Oleh:
**Tim Pengembang Sistem Informasi Manajemen UKM IPTEK**  
STIKES Semarang  
Tahun Akademik 2025/2026

---

## DAFTAR ISI

- **BAB I: PENDAHULUAN**
  - 1.1 Latar Belakang
  - 1.2 Rumusan Masalah
  - 1.3 Tujuan Pengembangan
  - 1.4 Manfaat Sistem
  - 1.5 Batasan Sistem
- **BAB II: PEMBAHASAN (ISI)**
  - 2.1 Arsitektur Sistem dan Landasan Teknologi
  - 2.2 Struktur Peran dan Hak Akses Pengguna (*Role-Based Access Control*)
  - 2.3 Implementasi Modul Fungsional Utama
    - 2.3.1 Autentikasi Pengguna & Keamanan Data Organisasi
    - 2.3.2 Sistem Presensi Cerdas & Validasi Geolocation (GPS)
    - 2.3.3 Rekapitulasi Kehadiran Sinkron Berbasis Sesi Resmi Ketua
    - 2.3.4 Tata Kelola Iuran Kas Digital QRIS & Verifikasi Khusus Bendahara
    - 2.3.5 Sistem Otomasi Unggah Folder & Distribusi Sertifikat Anggota (*Smart Matching*)
    - 2.3.6 Repositori Akademik Bahan Ajar & Laporan Kegiatan Mingguan Pengurus
    - 2.3.7 Subpage Profil Anggota Terpadu & Dasbor Analitik Organisasi
  - 2.4 Pendekatan Desain Antarmuka (*Minimalist Professional UI/UX*)
  - 2.5 Integritas Data Operasional (*Pure Real Data Policy*)
- **BAB III: PENUTUP**
  - 3.1 Kesimpulan
  - 3.2 Saran dan Pengembangan Lanjutan
- **DAFTAR PUSTAKA**

---

## BAB I: PENDAHULUAN

### 1.1 Latar Belakang
Organisasi kemahasiswaan di lingkungan perguruan tinggi memegang peranan krusial dalam mengembangkan kompetensi teknis, kepemimpinan, dan profesionalisme mahasiswa. Unit Kegiatan Mahasiswa Ilmu Pengetahuan dan Teknologi (UKM IPTEK) STIKES Semarang merupakan wadah strategis bagi sivitas akademika dalam memperdalam literasi digital, rekayasa perangkat lunak, serta penerapan teknologi informasi di bidang kesehatan dan sains terapan.

Seiring bertambahnya jumlah anggota aktif yang mencapai lebih dari 88 mahasiswa, UKM IPTEK menghadapi tantangan operasional internal yang kian kompleks. Pengelolaan rutin yang sebelumnya dilakukan secara manual atau semi-digital—seperti pencatatan presensi mingguan melalui formulir lepas, pengumpulan iuran kas bulanan secara tunai atau mutasi transfer manual tanpa gerbang verifikasi yang ketat, serta pengunggahan dan pembagian sertifikat kegiatan secara perorangan—menimbulkan inefisiensi administratif, kerentanan kehilangan rekam jejak (*audit trail*), dan beban kerja klerikal yang tinggi bagi jajaran pengurus.

Untuk mengatasi permasalahan tersebut, dibutuhkan sebuah platform terintegrasi berupa **Sistem Informasi Manajemen (SIM) Operasional Internal**. Sistem ini dirancang untuk mendigitalkan seluruh siklus manajemen rutin organisasi secara terpusat, akuntabel, dan berbasis aturan (*rule-based*), mulai dari pembukaan sesi pertemuan resmi, validasi presensi berbasis lokasi, penguncian prasyarat presensi berbasis pelunasan kas QRIS, pembagian sertifikat digital secara massal (*batch processing*), hingga rekapitulasi data kehadiran otomatis.

### 1.2 Rumusan Masalah
Berdasarkan latar belakang tersebut, rumusan masalah dalam pengembangan sistem ini adalah:
1. Bagaimana merancang arsitektur sistem informasi manajemen internal yang mampu mengintegrasikan operasional presensi, kas, bahan ajar, pelaporan, dan profil anggota secara aman dan terpusat?
2. Bagaimana membangun mekanisme gerbang kunci (*lock-gate mechanism*) yang mewajibkan penyelesaian kewajiban iuran kas bulanan via QRIS sebelum anggota diizinkan mencatatkan kehadiran presensi?
3. Bagaimana merancang algoritma pencocokan cerdas (*smart matching algorithm*) untuk otomasi pemrosesan folder sertifikat massal dan pendistribusiannya langsung ke akun masing-masing anggota?
4. Bagaimana memastikan parameter perhitungan rekapitulasi kehadiran dan persentase kedisiplinan organisasi berlandaskan murni pada sesi presensi resmi yang dibuka oleh Ketua UKM?

### 1.3 Tujuan Pengembangan
Tujuan dari perancangan dan implementasi aplikasi web ini adalah:
1. Membangun platform Sistem Informasi Manajemen (SIM) Internal berbasis web yang andal, aman, dan responsif bagi seluruh pengurus dan anggota UKM IPTEK STIKES Semarang.
2. Mengotomatiskan validasi kehadiran menggunakan verifikasi lokasi (GPS Radius 100m) serta kontrol pembukaan sesi langsung dari Ketua/Wakil Ketua UKM.
3. Mengimplementasikan sistem pembayaran uang kas tetap Rp 10.000/bulan berbasis kode QRIS statis dengan alur verifikasi ketat yang dikhususkan bagi divisi Bendahara.
4. Menciptakan fitur unggah folder sertifikat otomatis (*batch folder upload*) dengan sistem pencocokan nama pemilik (*name extraction & token matching*) sehingga ratusan sertifikat terdistribusi ke akun anggota secara instan.
5. Menyediakan instrumen rekapitulasi kehadiran dengan tampilan ganda (*dual-view matrix*) dan ekspor laporan tabular terstandardisasi (.CSV dan .PPTX).

### 1.4 Manfaat Sistem
Pengembangan sistem ini memberikan sejumlah manfaat nyata:
- **Bagi Pengurus**: Meringkas waktu administratif pengurus hingga lebih dari 80%, menghilangkan pencatatan berulang, memberikan visibilitas mutasi kas secara riil, memfasilitasi pelaporan mingguan terstruktur, dan mempermudah ekspor presentasi laporan bulanan.
- **Bagi Anggota**: Memberikan transparansi status keanggotaan, histori kehadiran per pertemuan, kemudahan akses bahan ajar mingguan, kepastian status lunas uang kas, serta akses mandiri terhadap seluruh sertifikat prestasi/keikutsertaan yang pernah diperoleh.
- **Bagi Organisasi**: Memperkuat tata kelola organisasi (*good student-governance*), menegakkan kedisiplinan berbasis sistem, menjaga integritas data tanpa manipulasi, dan mencerminkan citra organisasi IPTEK yang modern dan profesional.

### 1.5 Batasan Sistem
Batasan-batasan ruang lingkup pada sistem ini meliputi:
1. Sistem ini difungsikan murni untuk portal manajemen operasional rutin internal (berbeda dengan portal profil publik eksternal organisasi).
2. Autentikasi menggunakan kredensial `username` dan `password` resmi yang dikelola terpusat oleh Admin (tidak menyediakan fitur reset password mandiri demi keamanan internal organisasi).
3. Jadwal pertemuan presensi rutin dipusatkan pada hari Selasa (*zona waktu Asia/Jakarta*).
4. Besaran iuran kas wajib terkunci pada nilai tetap Rp 10.000 per bulan per anggota.
5. Sistem menolak penggunaan data contoh (*dummy data*); seluruh entitas dan transaksi harus beroperasi di atas data riil anggota dan pengurus resmi UKM IPTEK STIKES Semarang.

---

## BAB II: PEMBAHASAN (ISI)

### 2.1 Arsitektur Sistem dan Landasan Teknologi
Sistem Informasi Manajemen UKM IPTEK dibangun dengan arsitektur modern berprinsip *Client-Server RESTful API* yang memisahkan secara tegas lapisan logika antarmuka (*front-end*) dan lapisan komputasi layanan (*back-end*).

```
+---------------------------------------------------------------+
|                      CLIENT-SIDE (BROWSER)                    |
|   HTML5 Semantic · Vanilla CSS (Monochrome) · Vanilla JS      |
|   (SPA Hash-Routing · State Management · GPS Geolocation)     |
+-------------------------------+-------------------------------+
                                |  HTTPS / REST API (JWT Bearer)
+-------------------------------v-------------------------------+
|                    SERVER-SIDE (NODE.JS ENGINE)               |
|   Express.js Application Server · Custom Security Middlewares |
|   (Auth Check · Role Authorization · Cache Manager · Multer)  |
+-------------------------------+-------------------------------+
                                |  Object-Relational Mapping (Sequelize)
+-------------------------------v-------------------------------+
|                      PERSISTENCE / DATABASE                   |
|   Relational Database (MySQL Production / SQLite Engine)      |
|   (Users · Attendances · Sessions · Payments · Certificates)  |
+---------------------------------------------------------------+
```

Adapun rincian teknologi yang diimplementasikan adalah:
- **Server Engine**: Node.js versi Long-Term Support (LTS) dengan framework Express.js sebagai penyedia endpoint REST API berkecepatan tinggi.
- **Persistence & ORM**: Sequelize ORM sebagai lapisan pemetaan objek ke relasi database (*Object-Relational Mapping*), mendukung basis data MySQL pada lingkungan *production* (cPanel) dan SQLite untuk pengujian lokal.
- **Autentikasi & Keamanan**: JSON Web Token (JWT) dengan penandatanganan kriptografis, enkripsi sandi menggunakan *bcryptjs*, perlindungan integritas header via *Helmet*, serta pencegahan serangan *Cross-Site Scripting* (XSS) dan *SQL Injection*.
- **Manajemen File & Multi-Part**: Multer engine yang dikonfigurasi dengan pembatasan tipe berkas (*MIME type filtering*), direktori terisolasi, dan batas ukuran 50MB.
- **Front-End Architecture**: Vanilla HTML5, Vanilla JavaScript (ES Modules), dan Vanilla CSS murni tanpa ketergantungan framework berlebih, menjamin kecepatan rendering *sub-second*, kompatibilitas lintas perangkat HP/Desktop, serta efisiensi beban jaringan.

### 2.2 Struktur Peran dan Hak Akses Pengguna (*Role-Based Access Control*)
Aplikasi menerapkan pembagian hak akses bertingkat (*Role-Based Access Control* / RBAC) yang ketat guna menjamin wewenang operasional:
1. **Administrator**: Memiliki hak tertinggi dalam mengelola data master pengguna, penambahan dan penonaktifan akun, pemeliharaan basis data, serta pengaturan konfigurasi global.
2. **Pengurus Inti (Ketua & Wakil Ketua)**: Bertanggung jawab penuh terhadap kendali pembukaan dan penutupan sesi presensi, pemilihan mode presensi (Di Tempat vs Dimana Saja), pengawasan rekapitulasi kehadiran organisasi, dan pemantauan kinerja divisi.
3. **Pengurus Divisi Bendahara**: Pemegang hak eksklusif dalam memverifikasi mutasi pembayaran kas QRIS (menyetujui status `LUNAS` atau `DITOLAK`), mencatatkan pengeluaran kas operasional, dan mengunduh laporan keuangan.
4. **Pengurus Divisi Akademik & Kominfo**: Mengelola distribusi bahan ajar mingguan, pengunggahan materi, serta penerbitan dan pembagian sertifikat digital.
5. **Anggota Umum**: Memiliki hak akses terhadap pencatatan presensi mandiri (jika sesi terbuka dan kas lunas), pembayaran kas QRIS, pengunduhan bahan ajar, serta pengecekan histori kehadiran dan sertifikat di subpage profil.

### 2.3 Implementasi Modul Fungsional Utama

#### 2.3.1 Autentikasi Pengguna & Keamanan Data Organisasi
Sistem mengeliminasi autentikasi via email publik demi memitigasi kerentanan pengambilalihan akun. Pengguna hanya dapat melakukan autentikasi menggunakan `username` resmi dan kata sandi terenkripsi. Sesi pengguna disimpan dalam *JSON Web Token* pada *browser local storage* dan dikirimkan pada setiap *request* melalui *Authorization Header* (`Bearer <token>`). Tidak disediakan opsi lupa kata sandi mandiri; seluruh permintaan peremajaan kredensial wajib diverifikasi secara tatap muka oleh Administrator.

#### 2.3.2 Sistem Presensi Cerdas & Validasi Geolocation (GPS)
Presensi dirancang dengan aturan operasional spesifik:
- **Pembatasan Hari Pertemuan**: Mengacu pada aturan organisasi, presensi hanya dibuka pada hari **Selasa** (dikonversi ke zona waktu `Asia/Jakarta`).
- **Kontrol Pembukaan Sesi**: Anggota tidak dapat melakukan presensi secara acak. Formulir presensi hanya aktif apabila Ketua atau Wakil Ketua telah mengaktifkan tombol **Buka Sesi** di dasbor operasional.
- **Mode Di Tempat (*On-Site GPS Verification*)**: Menggunakan API *HTML5 Geolocation* untuk menangkap koordinat presisi perangkat pengguna. Sistem menghitung jarak menggunakan rumus geosfer *Haversine* terhadap titik koordinat markas organisasi STIKES Semarang (-7.034000, 110.368833). Presensi ditolak otomatis apabila jarak melebihi radius batas toleransi (maksimal 100 meter).
- **Mode Dimana Saja (*Anywhere Mode*)**: Opsi darurat yang hanya dapat diaktifkan oleh Ketua UKM saat pertemuan diselenggarakan secara daring (online) atau penugasan eksternal.

#### 2.3.3 Rekapitulasi Kehadiran Sinkron Berbasis Sesi Resmi Ketua
Salah satu keunggulan utama sistem baru adalah penentuan parameter total pertemuan. Berbeda dengan sistem konvensional yang menghitung pertemuan dari transaksi presensi yang masuk, sistem ini menetapkan parameter total pertemuan berdasarkan **jumlah sesi presensi resmi yang diaktifkan oleh pimpinan (Ketua UKM)**.
- Sistem secara otomatis membersihkan sesi duplikat atau sesi kosong yang tidak valid (*garbage session auto-cleanup*), menyisakan sesi pertemuan riil.
- Untuk setiap pertemuan resmi, seluruh anggota organisasi dievaluasi:
  $$\text{Status} = \begin{cases} \text{HADIR}, & \text{jika mencatatkan presensi valid} \\ \text{ALPA}, & \text{jika tidak mencatatkan presensi} \end{cases}$$
- **Tampilan Dual-Tab**:
  1. *Rekapitulasi Anggota (Ringkasan Kinerja)*: Menyajikan tabel komprehensif berisi No, Nama Anggota, Role, Divisi, Akumulasi Hadir, Alpa, Total Pertemuan Resmi, Persentase Kehadiran, serta tombol tautan instan ke profil anggota.
  2. *Detail Log per Pertemuan*: Menyajikan log historis baris per tanggal resmi untuk menelusuri status presensi secara rinci.
- **Ekspor Matriks CSV**: Menghasilkan dokumen spreadsheet terstandardisasi dengan penanda UTF-8 BOM, memetakan status seluruh anggota di setiap kolom tanggal pertemuan resmi beserta total persentasenya.

#### 2.3.4 Tata Kelola Iuran Kas Digital QRIS & Verifikasi Khusus Bendahara
Modul kas menerapkan tata kelola keuangan digital transparan:
- **Nominal Terkunci**: Nilai tagihan dipatok tepat sebesar **Rp 10.000 / bulan**. Antarmuka dan API backend secara tegas menolak manipulasi nominal.
- **QRIS Statis Interaktif**: Sistem merender kode QRIS resmi rekening organisasi. Anggota dapat memindai atau mengunggah bukti transaksi secara instan.
- **Gerbang Kunci Presensi (*Attendance Lock Modal*)**: Sistem menautkan modul presensi dengan modul kas. Apabila anggota belum menyelesaikan kas bulan berjalan (status belum `LUNAS`), antarmuka presensi akan diblokir dengan *modal overlay* merah yang memuat QRIS instan dan notifikasi status.
- **Verifikasi Khusus Bendahara**: Pembayaran QRIS masuk dengan status awal `pending`. Hanya akun pengurus divisi **Bendahara** yang memiliki tombol otorisasi untuk mengubah status transaksi menjadi `lunas` atau `ditolak` setelah melakukan rekonsiliasi mutasi rekening.

#### 2.3.5 Sistem Otomasi Unggah Folder & Distribusi Sertifikat Anggota (*Smart Matching*)
Fitur inovatif ini memecahkan inefisiensi pengunggahan sertifikat satu per satu bagi 88+ anggota:
- **Folder Picker Berbasis Web (`webkitdirectory`)**: Pengurus cukup memilih satu folder di komputer yang berisi puluhan hingga ratusan berkas sertifikat (.PDF, .PNG, .JPG).
- **Algoritma Pencocokan Cerdas (*Smart Matching Algorithm*)**:
  1. Sistem melakukan normalisasi terhadap nama file (menghapus tanda baca, underscore, angka urut, ekstensi).
  2. Sistem melakukan pencocokan bertingkat (*tokenized word matching* & *Levenshtein similarity*) terhadap seluruh basis data anggota aktif.
  3. Sistem mendeteksi judul sertifikat secara otomatis dari sisa kata pada nama file (contoh: berkas `Muhammad_Hasby_Sertifikat_Pelatihan_Web.pdf` otomatis terdistribusi ke akun Muhammad Hasby dengan judul sertifikat *"Pelatihan Web"*).
- **Distribusi Otomatis**: Berkas disimpan ke penyimpanan aman dan langsung dikaitkan dengan ID akun anggota yang cocok. Anggota dapat langsung mengakses dan mengunduh sertifikat resmi mereka pada subpage profil.
- **Laporan Distribusi Transparan**: Sistem menampilkan ringkasan pasca-unggah berisi total sertifikat berhasil terdistribusi serta daftar berkas yang tidak cocok (jika nama tidak terdaftar).

#### 2.3.6 Repositori Akademik Bahan Ajar & Laporan Kegiatan Mingguan Pengurus
- **Bahan Ajar**: Pengurus divisi akademik dapat mengunggah modul kuliah/praktikum, slide presentasi, atau video pembelajaran yang terkelompokkan rapi untuk diunduh anggota secara mandiri.
- **Laporan Mingguan (*Weekly Report*)**: Pengurus dari seluruh divisi diwajibkan menyusun laporan kegiatan berkala dengan validasi kalender *ISO-8601 Week Number*, memastikan tidak terjadi kekosongan pelaporan kinerja pengurus.

#### 2.3.7 Subpage Profil Anggota Terpadu & Dasbor Analitik Organisasi
Setiap anggota memiliki halaman profil internal (`#profil`) yang menampilkan:
- Biodata resmi, Nomor Induk Mahasiswa/Username, Peran, dan Divisi.
- Kartu rekapitulasi kehadiran pribadi (Total Pertemuan Resmi, Total Hadir, Total Alpa, dan Persentase).
- Riwayat tabel kehadiran pertemuan resmi (menunjukkan riwayat per tanggal: HADIR atau ALPA).
- Lemari penyimpanan sertifikat digital yang dapat diunduh kapan saja secara resmi.

### 2.4 Pendekatan Desain Antarmuka (*Minimalist Professional UI/UX*)
Sesuai dengan pedoman estetika organisasi (*Design Direction*), antarmuka web dibangun dengan prinsip minimalis profesional:
- **Skema Warna Monokrom Modern**: Menggunakan kombinasi hitam pekat (`#18181b`), abu-abu netral (`#71717a`, `#f4f4f5`, `#e4e4e7`), dan putih bersih (`#ffffff`) yang menjamin kontras tinggi dan kenyamanan visual.
- **Tanpa Efek Berlebih**: Mengeliminasi efek gradien mencolok, *glassmorphism*, maupun animasi dekoratif yang membebani kinerja perangkat seluler mahasiswa.
- **Bebas Karakter Emoji**: Seluruh elemen informasi, tombol, alert, dan log menggunakan tipografi profesional (Google Fonts *Inter* dan *Outfit*) serta ikon vektor standar FontAwesome.
- **Desain Kartu Bersih**: Seluruh kontainer informasi mengadopsi elevasi bayangan halus (*subtle shadow: 0 1px 3px rgba(0,0,0,0.05)*) dengan sudut membulat proporsional.

### 2.5 Integritas Data Operasional (*Pure Real Data Policy*)
Sistem menerapkan kebijakan integritas data mutlak:
- Tidak diperkenankan menyisipkan data contoh (*dummy/mock data*) pada proses *seeding* maupun inisialisasi basis data.
- Basis data hanya memuat entitas akun resmi pengurus dan anggota riil organisasi.
- Seluruh histori absensi, mutasi kas, bahan ajar, dan sertifikat yang tercatat merupakan cerminan murni dari aktivitas dan partisipasi nyata anggota UKM IPTEK STIKES Semarang.

---

## BAB III: PENUTUP

### 3.1 Kesimpulan
Berdasarkan tahapan perancangan, pengembangan, dan pengujian Sistem Informasi Manajemen (SIM) Internal UKM IPTEK STIKES Semarang, dapat ditarik beberapa kesimpulan utama:
1. Telah berhasil dikembangkan sebuah platform Sistem Informasi Manajemen berbasis web yang menyatukan tata kelola presensi, kas, materi akademik, pelaporan mingguan pengurus, dan arsip sertifikat dalam satu portal tunggal yang efisien dan aman.
2. Mekanisme gerbang kunci (*lock-gate mechanism*) terbukti efektif meningkatkan kedisiplinan finansial organisasi dengan mewajibkan verifikasi kas bulanan via QRIS sebelum anggota diizinkan mencatatkan kehadiran presensi.
3. Penerapan algoritma *Smart Matching* pada fitur unggah folder massal berhasil memangkas proses distribusi puluhan sertifikat anggota dari yang sebelumnya membutuhkan waktu berjam-jam menjadi beberapa detik dengan akurasi pencocokan nama yang tinggi.
4. Sistem rekapitulasi kehadiran baru yang berlandaskan parameter pembukaan sesi resmi oleh Ketua UKM memberikan gambaran statistik kedisiplinan organisasi yang akurat, adil, dan transparan, baik pada tampilan antarmuka web maupun hasil ekspor CSV.
5. Pendekatan antarmuka monokrom profesional tanpa emoji berhasil menciptakan pengalaman pengguna yang rapi, ringan diakses pada berbagai tipe gawai, serta mencerminkan integritas organisasi kemahasiswaan berbasis teknologi.

### 3.2 Saran dan Pengembangan Lanjutan
Untuk pengembangan sistem di masa mendatang, beberapa saran yang dapat dipertimbangkan adalah:
1. **Integrasi Notifikasi Real-Time**: Menambahkan integrasi bot perpesanan (WhatsApp Bot atau Telegram API) untuk mengirimkan pemberitahuan otomatis saat sesi presensi resmi dibuka oleh Ketua atau saat sertifikat baru telah masuk ke akun anggota.
2. **PWA (Progressive Web App) Lanjutan**: Mengoptimalkan kemampuan *caching service worker* untuk memungkinkan pembacaan bahan ajar secara luring (*offline reading*).
3. **Validasi Biometrik Wajah (*Face Recognition*)**: Mempertimbangkan penambahan verifikasi biometrik citra wajah berbasis kecerdasan buatan (AI) ringan untuk melengkapi verifikasi lokasi GPS pada presensi di tempat.

---

## DAFTAR PUSTAKA

1. Pressman, R. S., & Maxim, B. R. (2020). *Software Engineering: A Practitioner's Approach* (9th ed.). McGraw-Hill Education.
2. Sommerville, I. (2016). *Software Engineering* (10th ed.). Pearson Education.
3. Chodorow, K. (2013). *High Performance Web Sites: Essential Knowledge for Front-End Engineers*. O'Reilly Media.
4. Express.js Documentation. (2026). *Fast, unopinionated, minimalist web framework for Node.js*. Diakses dari https://expressjs.com/
5. Sequelize Organization. (2026). *Sequelize: A modern TypeScript and Node.js ORM for Postgres, MySQL, MariaDB, SQLite and SQL Server*. Diakses dari https://sequelize.org/
6. World Wide Web Consortium (W3C). (2026). *Geolocation API Specification 2nd Edition*. W3C Recommendation.
7. Unit Kegiatan Mahasiswa IPTEK STIKES Semarang. (2026). *Anggaran Dasar, Anggaran Rumah Tangga, dan Panduan Operasional Internal Organisasi*. STIKES Semarang.
