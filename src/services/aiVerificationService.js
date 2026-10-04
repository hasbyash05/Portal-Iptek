/**
 * AI Payment Verification Service (Google Gemini Vision)
 * Memverifikasi bukti pembayaran kas secara otomatis:
 * 1. Cek validitas bukti transfer bank/e-wallet/QRIS.
 * 2. Cek nominal: jika < Rp 10.000 -> langsung DITOLAK.
 * 3. Cek nama pengirim vs nama akun:
 *    - Jika cocok (nominal >= 10.000 & nama sama) -> APPROVAL (LUNAS) otomatis.
 *    - Jika beda -> PENDING untuk verifikasi manual oleh Bendahara.
 */

const fs = require('fs');
const path = require('path');

const MIN_KAS_AMOUNT = 10000;

/**
 * Normalisasi dan pencocokan nama pengirim dengan nama akun pengguna
 */
function matchSenderName(detectedName, accountName) {
  if (!detectedName || !accountName) return false;

  const normalize = (str) =>
    str.toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

  const normDetected = normalize(detectedName);
  const normAccount = normalize(accountName);

  if (normDetected === normAccount) return true;

  // Substring matching jika nama cukup panjang
  if (normAccount.includes(normDetected) && normDetected.length >= 4) return true;
  if (normDetected.includes(normAccount) && normAccount.length >= 4) return true;

  // Token-based matching (kata per kata)
  const detectedTokens = normDetected.split(' ').filter(t => t.length > 1);
  const accountTokens = normAccount.split(' ').filter(t => t.length > 1);

  if (detectedTokens.length === 0 || accountTokens.length === 0) return false;

  let matchCount = 0;
  for (const t of detectedTokens) {
    if (accountTokens.some(at => at === t || (t.length >= 3 && (at.startsWith(t) || t.startsWith(at))))) {
      matchCount++;
    }
  }

  // Jika minimal 2 kata cocok atau seluruh kata pada nama pendek cocok
  if (matchCount >= 2) return true;
  if (matchCount >= 1 && (detectedTokens.length === 1 || accountTokens.length === 1)) return true;

  return false;
}

/**
 * Membaca file gambar dan mengubahnya ke Base64
 */
function fileToBase64(filePath) {
  let resolvedPath;
  if (path.isAbsolute(filePath) && fs.existsSync(filePath)) {
    resolvedPath = filePath;
  } else {
    resolvedPath = path.join(__dirname, '../../public', filePath.replace(/^[/\\]+/, ''));
  }

  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`File bukti pembayaran tidak ditemukan di server: ${resolvedPath}`);
  }

  const ext = path.extname(resolvedPath).toLowerCase();
  let mimeType = 'image/jpeg';
  if (ext === '.png') mimeType = 'image/png';
  else if (ext === '.webp') mimeType = 'image/webp';
  else if (ext === '.gif') mimeType = 'image/gif';
  else if (ext === '.pdf') mimeType = 'application/pdf';

  const buffer = fs.readFileSync(resolvedPath);
  return {
    base64Data: buffer.toString('base64'),
    mimeType
  };
}

/**
 * Memverifikasi bukti pembayaran kas menggunakan Google Gemini Vision AI
 * @param {string} proofRelativePath - Path file bukti relatif terhadap public/
 * @param {string} userAccountName - Nama lengkap pengguna akun yang mengunggah
 * @returns {Promise<{
 *   decision: 'lunas'|'ditolak'|'pending',
 *   amount: number,
 *   senderName: string,
 *   notes: string,
 *   confidence: number,
 *   isValidProof: boolean
 * }>}
 */
async function verifyPaymentProof(proofRelativePath, userAccountName) {
  const apiKey = (process.env.GEMINI_API_KEY || '').trim();

  // Jika API key belum diisi, serahkan ke verifikasi manual Bendahara
  if (!apiKey) {
    return {
      decision: 'pending',
      amount: 0,
      senderName: '',
      notes: 'API Key Gemini belum disetel di .env. Memerlukan verifikasi manual Bendahara.',
      confidence: 0,
      isValidProof: false
    };
  }

  // Pastikan file bukti adalah gambar atau dokumen
  if (!proofRelativePath || !proofRelativePath.startsWith('/uploads')) {
    return {
      decision: 'pending',
      amount: 0,
      senderName: '',
      notes: 'Tidak ada file bukti pembayaran yang diunggah. Memerlukan verifikasi manual Bendahara.',
      confidence: 0,
      isValidProof: false
    };
  }

  let fileInfo;
  try {
    fileInfo = fileToBase64(proofRelativePath);
  } catch (fileErr) {
    return {
      decision: 'pending',
      amount: 0,
      senderName: '',
      notes: `Gagal membaca file bukti: ${fileErr.message}. Periksa manual oleh Bendahara.`,
      confidence: 0,
      isValidProof: false
    };
  }

  // Jika file adalah PDF (bukan gambar), serahkan verifikasi manual ke Bendahara
  if (fileInfo.mimeType === 'application/pdf') {
    return {
      decision: 'pending',
      amount: 0,
      senderName: '',
      notes: 'Bukti pembayaran berupa dokumen PDF. Diserahkan ke verifikasi manual Bendahara.',
      confidence: 0,
      isValidProof: true
    };
  }

  const promptText = `
Anda adalah sistem AI verifikasi bukti pembayaran kas organisasi UKM IPTEK.
Tugas Anda adalah memeriksa gambar screenshot/struk bukti transfer bank / e-wallet (seperti Dana, GoPay, OVO, ShopeePay, QRIS, BCA, BRI, Mandiri, BNI, dll).

Nama Akun Pengguna yang mengajukan: "${userAccountName}"
Nominal Minimal Wajib Kas: Rp 10.000

Analisis gambar ini dan berikan output dalam format JSON murni berikut:
{
  "is_valid_transfer_proof": true / false,
  "transaction_status": "BERHASIL" | "PENDING" | "GAGAL" | "BUKAN_TRANSFER",
  "detected_amount": <angka nominal yang ditransfer tanpa titik/koma, contoh 10000>,
  "detected_sender_name": "<nama pengirim / pemilik akun asal jika tertera, jika tidak ada isi kosong>",
  "detected_recipient_name": "<nama penerima / merchant tujuan jika ada>",
  "bank_or_wallet": "<nama bank atau e-wallet yang digunakan>",
  "confidence": <angka 0.0 sampai 1.0>,
  "summary": "<penjelasan singkat isi bukti transfer>"
}

Aturan Penilaian:
1. Jika gambar bukan bukti transfer (contoh: foto sembarangan, meme, screenshot tidak jelas), is_valid_transfer_proof = false.
2. Jika tertera status transaksi "Berhasil" / "Sukses" / "Transfer Berhasil" / "Pembayaran Berhasil", transaction_status = "BERHASIL".
3. Ekstrak nominal uang yang ditransfer seakurat mungkin sebagai angka murni (integer).
4. Ekstrak nama pengirim jika tertera di bukti transfer.
Kembalikan HANYA JSON tanpa teks lain.
`.trim();

  // Model yang dicoba secara berurutan sesuai ketersediaan API Google Gemini
  const models = [
    'gemini-3.8-flash',
    'gemini-3.5-flash',
    'gemini-3.1-flash-lite',
    'gemini-flash-latest',
    'gemini-flash-lite-latest'
  ];
  let aiData = null;
  let lastError = null;

  for (const model of models) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
      const payload = {
        contents: [
          {
            parts: [
              { text: promptText },
              {
                inlineData: {
                  mimeType: fileInfo.mimeType,
                  data: fileInfo.base64Data
                }
              }
            ]
          }
        ],
        generationConfig: {
          temperature: 0.1,
          responseMimeType: 'application/json'
        }
      };

      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(20000)
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Gemini API HTTP ${response.status}: ${errText}`);
      }

      const resJson = await response.json();
      const rawText = resJson.candidates?.[0]?.content?.parts?.[0]?.text;
      if (rawText) {
        // Bersihkan formatting markdown jika ada
        const cleanJsonStr = rawText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
        aiData = JSON.parse(cleanJsonStr);
        break; // Berhasil membaca respon JSON
      }
    } catch (err) {
      lastError = err;
      console.warn(`[AI Verification] Model ${model} gagal:`, err.message);
      // Tunggu 800ms sebelum mencoba model berikutnya jika terjadi rate limit / high demand
      await new Promise(r => setTimeout(r, 800));
    }
  }

  if (!aiData) {
    const isQuotaOrBusy = lastError && (lastError.message.includes('503') || lastError.message.includes('429'));
    const failureMsg = isQuotaOrBusy
      ? 'Layanan AI sedang sibuk (kuota/beban tinggi). Memerlukan verifikasi manual oleh Bendahara.'
      : `Gagal memproses AI (${lastError ? lastError.message.slice(0, 100) : 'Respon kosong'}). Memerlukan verifikasi manual oleh Bendahara.`;

    return {
      decision: 'pending',
      amount: 0,
      senderName: '',
      notes: failureMsg,
      confidence: 0,
      isValidProof: false
    };
  }

  const isValidProof = Boolean(aiData.is_valid_transfer_proof);
  const detectedAmount = Number(aiData.detected_amount) || 0;
  const detectedSender = (aiData.detected_sender_name || '').trim();
  const txStatus = (aiData.transaction_status || '').toUpperCase();
  const confidence = Number(aiData.confidence) || 0;

  // =========================================================================
  // PARAMETER VERIFIKASI SESUAI KETENTUAN:
  // 1. Gambar bukan bukti transfer yang sah ATAU status transaksi GAGAL:
  //    -> LANGSUNG DITOLAK
  // 2. Nominal < Rp 10.000 (kurang dari nominal minimal):
  //    -> LANGSUNG DITOLAK
  // 3. Nominal >= Rp 10.000:
  //    - Jika nama pengirim di screenshot sama dengan nama akun:
  //      -> APPROVAL (LUNAS) otomatis 
  //    - Jika nama pengirim beda (atau tidak tertera nama pengirim):
  //      -> BIARKAN VERIFIKASI MANUAL OLEH BENDAHARA (status PENDING)
  // =========================================================================

  // 1. Cek keabsahan bukti
  if (!isValidProof || txStatus === 'BUKAN_TRANSFER') {
    return {
      decision: 'ditolak',
      amount: detectedAmount,
      senderName: detectedSender,
      notes: 'Ditolak otomatis: Gambar yang diunggah bukan bukti transfer pembayaran yang sah.',
      confidence,
      isValidProof: false
    };
  }

  if (txStatus === 'GAGAL') {
    return {
      decision: 'ditolak',
      amount: detectedAmount,
      senderName: detectedSender,
      notes: 'Ditolak otomatis: Status transaksi pada bukti transfer tertera GAGAL.',
      confidence,
      isValidProof: true
    };
  }

  // 2. Cek nominal minimal
  if (detectedAmount > 0 && detectedAmount < MIN_KAS_AMOUNT) {
    return {
      decision: 'ditolak',
      amount: detectedAmount,
      senderName: detectedSender,
      notes: `Ditolak otomatis: Nominal pada bukti transfer (Rp ${detectedAmount.toLocaleString('id-ID')}) kurang dari nominal minimal Rp ${MIN_KAS_AMOUNT.toLocaleString('id-ID')}.`,
      confidence,
      isValidProof: true
    };
  }

  // 3. Cek pencocokan nama pengirim dengan nama akun
  const isNameMatch = matchSenderName(detectedSender, userAccountName);

  if (detectedAmount >= MIN_KAS_AMOUNT && isNameMatch) {
    // APPROVAL (LUNAS) OTOMATIS OLEH AI
    return {
      decision: 'lunas',
      amount: detectedAmount,
      senderName: detectedSender,
      notes: `Disetujui otomatis: Nominal sesuai (Rp ${detectedAmount.toLocaleString('id-ID')}) dan nama pengirim "${detectedSender}" cocok dengan nama akun "${userAccountName}".`,
      confidence,
      isValidProof: true
    };
  }

  // Jika nominal sesuai namun nama pengirim berbeda:
  // "kalau beda biarkan verifikasi manual oleh bendahara"
  if (detectedAmount >= MIN_KAS_AMOUNT && !isNameMatch) {
    const senderDisplay = detectedSender || 'Tidak tertera di struk';
    return {
      decision: 'pending',
      amount: detectedAmount,
      senderName: detectedSender,
      notes: `Nominal sesuai (Rp ${detectedAmount.toLocaleString('id-ID')}), namun nama pengirim ("${senderDisplay}") berbeda dari nama akun ("${userAccountName}"). Memerlukan verifikasi manual oleh Bendahara.`,
      confidence,
      isValidProof: true
    };
  }

  // Fallback jika nominal tidak terbaca jelas
  return {
    decision: 'pending',
    amount: detectedAmount,
    senderName: detectedSender,
    notes: 'Nominal atau detail transfer tidak terbaca jelas . Memerlukan verifikasi manual oleh Bendahara.',
    confidence,
    isValidProof: true
  };
}

module.exports = {
  verifyPaymentProof,
  matchSenderName
};
