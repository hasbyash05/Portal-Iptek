require('dotenv').config();
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');
const { sequelize, User } = require('../models');

const BCRYPT_SALT_ROUNDS = 10;

const generateRandomPassword = (length = 8) => {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let password = '';
  for (let i = 0; i < length; i++) {
    const randomIndex = crypto.randomInt(0, chars.length);
    password += chars[randomIndex];
  }
  return password;
};

const fixedPasswords = {
  // Admin System Permanen
  admin: 'iptekadmin2026',

  // Pengurus
  hasby: 'pu5my3h8',
  wafiq: '2a5hqzxg',
  laelatul: 'zthk6nch',
  inayah: '3tzkwqtn',
  arifah: 'dn434c7h',
  alfia: 'fg99jvqe',
  wenang: '9abw8psh',
  khirson: 'utv7xbf9',
  derx: 'yqx9e6m3',
  zahwa: 'ybdbwng5',

  // Anggota Sub-Divisi & Anggota Umum
  aisha: '33m74d72',
  alwan: 'cx5fpz6m',
  alzena: 'jnyevvew',
  arjun: 'h8kqq9s5',
  arkan: 'r72a5efb',
  ayu: 'bb99mjue',
  bangun: 'jh3ms75g',
  bima: 'ugmwpr9d',
  satria: 'z6qmupua',
  cheryl: 'rcjuzh3k',
  dika: 's94wmjkh',
  arya: 'zdyrrnrf',
  syahputri: 'r4wrs7ax',
  elfrida: 'hgde6p7q',
  elma: '2as36rdk',
  ericco: 'unaysjc5',
  fairuziva: 'fvj42sgh',
  fathurrohman: '3xumjc2m',
  galih: '4k66gkjf',
  gathfaan: '7dna2vjj',
  hengki: 'hhdpec9g',
  wahyu: 'ham2c6bn',
  isna: 'aag46vhp',
  khinza: '39ey6fe4',
  kusumo: '9epvvh7g',
  leissiano: '6hsfhzpf',
  malik: 'hq52qjfr',
  kaprasia: 'sdz9d82f',
  arif: 'fpj8kkmg',
  gibran: '496tsu32',
  yusuf: 'abjpq2p7',
  zufar: '64hjdy92',
  qotrunnada: 'p6k9dq6c',
  najwa: '42ec35th',
  naurah: '6u6xp9jq',
  nazwa: 'c265bs4a',
  nova: 'n4ggd7dg',
  oktavianus: 'w5crts74',
  petrus: 'udpw23wv',
  zamharira: '389t74wx',
  rayhan: '5yh28hm6',
  refta: 'wutj298f',
  resendriya: 'd75t88pm',
  riyan: 'f6w9ruqt',
  safril: 'y6yhtv52',
  vivid: 'wgr4mdk9',
  wildan: '5vygmnxm',
  xenia: 'jntezvjg',
  yasinta: '4k5vx6kv',
  zulfikar: '7kfq4sfd'
};

const generateUsernameFromName = (nama, existingSet) => {
  const ignorePrefixes = ['muhammad', 'm', 'i', 'dwi', 'maria', 'putri', 'gusti', 'made'];
  const words = nama
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .split(/\s+/)
    .filter(Boolean);

  let candidate = '';
  for (const word of words) {
    if (!ignorePrefixes.includes(word) && word.length >= 3) {
      if (!existingSet.has(word)) {
        candidate = word;
        break;
      }
    }
  }

  if (!candidate && words.length > 0) {
    if (!existingSet.has(words[0])) {
      candidate = words[0];
    }
  }

  if (!candidate || existingSet.has(candidate)) {
    const combined = words.slice(0, 2).join('');
    if (combined && !existingSet.has(combined)) {
      candidate = combined;
    } else {
      let base = words[0] || 'user';
      let num = 1;
      while (existingSet.has(`${base}${num}`)) {
        num++;
      }
      candidate = `${base}${num}`;
    }
  }

  existingSet.add(candidate);
  return candidate;
};

const seedDatabase = async () => {
  try {
    console.log('[INFO] Menghubungkan ke database...');
    await sequelize.authenticate();

    console.log('[INFO] Membuat ulang tabel (Sync Force)...');
    await sequelize.sync({ force: true });

    console.log('[INFO] Membuat akun user resmi UKM IPTEK STIKES Semarang...');
    const generatedCredentials = [];

    // 0. Akun Admin Permanen System
    const adminPassword = fixedPasswords.admin || generateRandomPassword(10);
    const adminHash = await bcrypt.hash(adminPassword, BCRYPT_SALT_ROUNDS);
    await User.create({
      username: 'admin',
      password_hash: adminHash,
      nama_lengkap: 'System Administrator',
      role: 'admin',
      divisi: null
    });
    generatedCredentials.push({
      nama_lengkap: 'System Administrator',
      username: 'admin',
      password: adminPassword,
      role: 'admin',
      divisi: '-'
    });

    // 1. Struktur Resmi Pengurus UKM IPTEK STIKES Semarang
    const daftarPengurus = [
      { username: 'hasby', nama: 'Muhammad Hasby Ash Shidiqy Pua Rangga', divisi: 'Ketua' },
      { username: 'wafiq', nama: 'Muhammad Wafiq Gheraeldy', divisi: 'Wakil Ketua' },
      { username: 'laelatul', nama: 'Laelatul Faridah', divisi: 'Sekretaris' },
      { username: 'inayah', nama: 'Inayah Mahardika', divisi: 'Sekretaris' },
      { username: 'arifah', nama: 'Arifah Naufali', divisi: 'Bendahara' },
      { username: 'alfia', nama: 'Alfia Rizka Putri Permana', divisi: 'Bendahara' },
      { username: 'wenang', nama: 'Wenang Amin Mahardika (Koordinator)', divisi: 'Operasional' },
      { username: 'khirson', nama: 'Muhammad Khirson Afu Asofu (Koordinator)', divisi: 'Komunikasi dan Informasi' },
      { username: 'derx', nama: 'Derx Oktavianus Siwabessy (Koordinator)', divisi: 'Perlengkapan' },
      { username: 'zahwa', nama: 'Zahwa Rizqi Nurjanah (Koordinator)', divisi: 'Humas' }
    ];

    const createdPengurus = {};
    for (const p of daftarPengurus) {
      const pPass = fixedPasswords[p.username] || generateRandomPassword(8);
      const hashedPassword = await bcrypt.hash(pPass, BCRYPT_SALT_ROUNDS);
      const user = await User.create({
        username: p.username,
        password_hash: hashedPassword,
        nama_lengkap: p.nama,
        role: 'pengurus',
        divisi: p.divisi
      });
      createdPengurus[p.username] = user;
      generatedCredentials.push({
        role: 'Pengurus',
        username: p.username,
        password: pPass,
        nama_lengkap: p.nama,
        divisi: p.divisi
      });
    }

    // 2. Anggota Sub-Divisi
    const daftarAnggotaDivisi = [
      // Operasional
      { nama: 'Muhammad Gibran Muhson', divisi: 'Operasional' },
      { nama: 'Naurah Faadhilah Meska', divisi: 'Operasional' },
      { nama: 'Wildan Samudra Nur Mahdi', divisi: 'Operasional' },
      { nama: 'I Gusti Made Wahyu Wardana', divisi: 'Operasional' },
      { nama: 'Nova Sheila Rahmawati', divisi: 'Operasional' },
      // Komunikasi dan Informasi
      { nama: 'Aisha Cheryl Amelia', divisi: 'Komunikasi dan Informasi' },
      { nama: 'Riyan Abdul Aziz', divisi: 'Komunikasi dan Informasi' },
      { nama: 'Dwi Syahputri Ramadhani', divisi: 'Komunikasi dan Informasi' },
      { nama: 'Vivid Puspita Yhulyana Sari', divisi: 'Komunikasi dan Informasi' },
      // Perlengkapan
      { nama: 'Kusumo Harjo', divisi: 'Perlengkapan' },
      { nama: 'Dika Bambang Hendriana', divisi: 'Perlengkapan' },
      { nama: 'Malik Athallah Zain', divisi: 'Perlengkapan' },
      { nama: 'Khinza Nur Riyadthus Solikhin', divisi: 'Perlengkapan' },
      { nama: 'Cheryl Asfy', divisi: 'Perlengkapan' },
      { nama: 'Gathfaan Zafran Putra Dianggra', divisi: 'Perlengkapan' },
      { nama: 'Resendriya Labib Arzani', divisi: 'Perlengkapan' },
      { nama: 'Dwi Arya Wirana', divisi: 'Perlengkapan' },
      { nama: 'Arjun Cipto Nugroho', divisi: 'Perlengkapan' },
      // Humas
      { nama: 'Yasinta Anggun Rahmawati', divisi: 'Humas' },
      { nama: 'Xenia Fatwa Dzi Fadlillah', divisi: 'Humas' },
      { nama: 'Safril Sarifudin', divisi: 'Humas' },
      { nama: 'Muhammad Arif Fadlur Rahman', divisi: 'Humas' }
    ];

    // 3. Anggota Umum
    const daftarAnggota = [
      'Bima Pratama Putra (Koordinator)',
      'Alwan Aziz Habibi',
      'Alzena Naura Mezzaluna',
      'Arkan Faizul Haq',
      'Ayu Bening Devina Sari',
      'Bangun Vionata',
      'Bima Satria Pamungkas',
      'Elfrida Agnesia Klau',
      'Elma Landak',
      'Fathurrohman',
      'Fairuziva Sofinatha Mahendra',
      'Galih Ridho S',
      'Hengki Bagaskara',
      'Isna Anisauzzalfa',
      'Leissiano Arya Firmansyah',
      'Maria Kaprasia Wasi Baun',
      'Muhammad Zufar Ibrahimovic',
      'Najwa Saniya Zahra',
      'Najwa Qotrunnada',
      'Nazwa Putri Anjani',
      'Oktavianus Aswin Wandung',
      'Petrus Hutardo Richard',
      'Putri Zamharira',
      'Refta Maulana Wahyudi',
      'Zulfikar Syifa Fuadi',
      'Rayhan Atha Syarif',
      'Ericco Hadhimas Calik',
      'Muhammad Yusuf Saputra'
    ];

    const existingUsernames = new Set(['admin', ...daftarPengurus.map(p => p.username)]);

    const createdAnggota = [];

    for (const item of daftarAnggotaDivisi) {
      const username = generateUsernameFromName(item.nama, existingUsernames);
      const aPass = fixedPasswords[username] || generateRandomPassword(8);
      const hashedPassword = await bcrypt.hash(aPass, BCRYPT_SALT_ROUNDS);
      const user = await User.create({
        username: username,
        password_hash: hashedPassword,
        nama_lengkap: item.nama,
        role: 'anggota',
        divisi: item.divisi
      });
      createdAnggota.push(user);
      generatedCredentials.push({
        role: 'Anggota',
        username: username,
        password: aPass,
        nama_lengkap: item.nama,
        divisi: item.divisi
      });
    }

    for (const nama of daftarAnggota) {
      const username = generateUsernameFromName(nama, existingUsernames);
      const aPass = fixedPasswords[username] || generateRandomPassword(8);
      const hashedPassword = await bcrypt.hash(aPass, BCRYPT_SALT_ROUNDS);
      const isKoord = nama.includes('(Koordinator)');
      const user = await User.create({
        username: username,
        password_hash: hashedPassword,
        nama_lengkap: nama,
        role: 'anggota',
        divisi: null
      });
      createdAnggota.push(user);
      generatedCredentials.push({
        role: isKoord ? 'Anggota (Koordinator)' : 'Anggota',
        username: username,
        password: aPass,
        nama_lengkap: nama,
        divisi: isKoord ? 'Koordinator Anggota' : '-'
      });
    }

    const credFilePath = path.join(__dirname, '../../login_credentials.json');
    fs.writeFileSync(credFilePath, JSON.stringify(generatedCredentials, null, 2), 'utf8');

    console.log('[SUCCESS] Seeding database selesai!');
    console.log('\n=== CONTOH KREDENSIAL LOGIN YANG DI-GENERATE ===');
    console.log(`Ketua UKM (hasby)       -> Username: ${generatedCredentials[0].username} | Password: ${generatedCredentials[0].password}`);
    console.log(`Wakil Ketua (wafiq)     -> Username: ${generatedCredentials[1].username} | Password: ${generatedCredentials[1].password}`);
    console.log(`Koord. Kominfo (khirson)-> Username: ${generatedCredentials[7].username} | Password: ${generatedCredentials[7].password}`);
    console.log(`Koord. Anggota (bima)   -> Username: ${generatedCredentials[32].username} | Password: ${generatedCredentials[32].password}`);
    console.log('================================================');
    console.log(`\n[INFO] Kredensial login lengkap (tanpa hash) untuk seluruh ${generatedCredentials.length} akun telah disimpan di file: login_credentials.json\n`);

    if (require.main === module) {
      process.exit(0);
    }
  } catch (error) {
    console.error('[ERROR] Gagal melakukan seeding database:', error);
    if (require.main === module) {
      process.exit(1);
    } else {
      throw error;
    }
  }
};

if (require.main === module) {
  seedDatabase();
}

module.exports = { seedDatabase };
