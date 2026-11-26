use base64::Engine;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::path::{Path, PathBuf};

use crate::utils::date_helper::format_idr;

const MIN_KAS_AMOUNT: i64 = 10000;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiVerificationResult {
    pub decision: String, // "lunas" | "ditolak" | "pending"
    pub amount: i64,
    pub sender_name: String,
    pub notes: String,
    pub confidence: f64,
    pub is_valid_proof: bool,
}

#[derive(Debug, Deserialize)]
struct GeminiParsedOutput {
    is_valid_transfer_proof: Option<bool>,
    transaction_status: Option<String>,
    detected_amount: Option<Value>,
    detected_sender_name: Option<String>,
    confidence: Option<Value>,
}

fn normalize_name(s: &str) -> String {
    let lower = s.to_lowercase();
    let replaced: String = lower
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || c.is_whitespace() { c } else { ' ' })
        .collect();
    replaced.split_whitespace().collect::<Vec<_>>().join(" ")
}

pub fn match_sender_name(detected_name: &str, account_name: &str) -> bool {
    if detected_name.trim().is_empty() || account_name.trim().is_empty() {
        return false;
    }
    let norm_detected = normalize_name(detected_name);
    let norm_account = normalize_name(account_name);

    if norm_detected == norm_account {
        return true;
    }

    if norm_account.contains(&norm_detected) && norm_detected.len() >= 4 {
        return true;
    }
    if norm_detected.contains(&norm_account) && norm_account.len() >= 4 {
        return true;
    }

    let detected_tokens: Vec<&str> = norm_detected
        .split(' ')
        .filter(|t| t.len() > 1)
        .collect();
    let account_tokens: Vec<&str> = norm_account
        .split(' ')
        .filter(|t| t.len() > 1)
        .collect();

    if detected_tokens.is_empty() || account_tokens.is_empty() {
        return false;
    }

    let mut match_count = 0usize;
    for t in &detected_tokens {
        if account_tokens.iter().any(|at| {
            *at == *t || (t.len() >= 3 && (at.starts_with(t) || t.starts_with(at)))
        }) {
            match_count += 1;
        }
    }

    if match_count >= 2 {
        return true;
    }
    if match_count >= 1 && (detected_tokens.len() == 1 || account_tokens.len() == 1) {
        return true;
    }

    false
}

fn file_to_base64(file_path: &str) -> Result<(String, String), String> {
    let p = Path::new(file_path);
    let resolved = if p.is_absolute() && p.exists() {
        p.to_path_buf()
    } else {
        PathBuf::from("public").join(file_path.trim_start_matches(['/', '\\']))
    };

    if !resolved.exists() {
        return Err(format!(
            "File bukti pembayaran tidak ditemukan di server: {}",
            resolved.display()
        ));
    }

    let ext = resolved
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();

    let mime_type = match ext.as_str() {
        "png" => "image/png",
        "webp" => "image/webp",
        "gif" => "image/gif",
        "pdf" => "application/pdf",
        _ => "image/jpeg",
    };

    let bytes = std::fs::read(&resolved).map_err(|e| e.to_string())?;
    let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
    Ok((b64, mime_type.to_string()))
}

fn value_to_i64(val: Option<&Value>) -> i64 {
    match val {
        Some(Value::Number(n)) => n
            .as_i64()
            .or_else(|| n.as_f64().map(|f| f.round() as i64))
            .unwrap_or(0),
        Some(Value::String(s)) => {
            let digits: String = s.chars().filter(|c| c.is_ascii_digit()).collect();
            digits.parse::<i64>().unwrap_or(0)
        }
        _ => 0,
    }
}

fn value_to_f64(val: Option<&Value>) -> f64 {
    match val {
        Some(Value::Number(n)) => n.as_f64().unwrap_or(0.0),
        Some(Value::String(s)) => s.trim().parse::<f64>().unwrap_or(0.0),
        _ => 0.0,
    }
}

pub async fn verify_payment_proof(
    http_client: &reqwest::Client,
    api_key: &str,
    proof_relative_path: &str,
    user_account_name: &str,
) -> AiVerificationResult {
    let api_key = api_key.trim();
    if api_key.is_empty() {
        return AiVerificationResult {
            decision: "pending".to_string(),
            amount: 0,
            sender_name: String::new(),
            notes: "API Key Gemini belum disetel di .env. Memerlukan verifikasi manual Bendahara."
                .to_string(),
            confidence: 0.0,
            is_valid_proof: false,
        };
    }

    if proof_relative_path.is_empty()
        || (!proof_relative_path.starts_with("/uploads")
            && !Path::new(proof_relative_path).is_absolute())
    {
        return AiVerificationResult {
            decision: "pending".to_string(),
            amount: 0,
            sender_name: String::new(),
            notes: "Tidak ada file bukti pembayaran yang diunggah. Memerlukan verifikasi manual Bendahara."
                .to_string(),
            confidence: 0.0,
            is_valid_proof: false,
        };
    }

    let (base64_data, mime_type) = match file_to_base64(proof_relative_path) {
        Ok(v) => v,
        Err(err_msg) => {
            return AiVerificationResult {
                decision: "pending".to_string(),
                amount: 0,
                sender_name: String::new(),
                notes: format!(
                    "Gagal membaca file bukti: {}. Periksa manual oleh Bendahara.",
                    err_msg
                ),
                confidence: 0.0,
                is_valid_proof: false,
            };
        }
    };

    if mime_type == "application/pdf" {
        return AiVerificationResult {
            decision: "pending".to_string(),
            amount: 0,
            sender_name: String::new(),
            notes: "Bukti pembayaran berupa dokumen PDF. Diserahkan ke verifikasi manual Bendahara."
                .to_string(),
            confidence: 0.0,
            is_valid_proof: true,
        };
    }

    let prompt_text = r#"Anda adalah sistem AI pemeriksa bukti pembayaran transfer bank dan e-wallet.
Tugas Anda adalah memeriksa apakah gambar yang diunggah adalah bukti transfer / struk pembayaran bank atau e-wallet yang sah dan asli (seperti BRI / BRImo, BCA, Mandiri, BNI, Dana, GoPay, OVO, ShopeePay, LinkAja, QRIS, dll).

Analisis gambar ini dan berikan output dalam format JSON murni berikut:
{
  "is_valid_transfer_proof": true / false,
  "transaction_status": "BERHASIL" | "PENDING" | "GAGAL" | "BUKAN_TRANSFER",
  "detected_amount": <angka nominal yang ditransfer tanpa titik/koma, contoh 450000 atau 10000>,
  "detected_sender_name": "<nama pengirim / pemilik sumber dana jika tertera di struk, jika tidak ada kosongkan>",
  "detected_recipient_name": "<nama penerima / tujuan transfer jika tertera di struk>",
  "bank_or_wallet": "<nama bank atau aplikasi yang digunakan>",
  "confidence": <angka 0.0 sampai 1.0>,
  "summary": "<penjelasan singkat isi bukti transfer>"
}

Panduan Penilaian:
1. is_valid_transfer_proof = true jika gambar adalah screenshot/struk/bukti transfer bank atau e-wallet yang nyata dan valid. JANGAN PERNAH menyetel false hanya karena nama pengirim atau penerima tidak cocok dengan pihak tertentu.
2. is_valid_transfer_proof = false HANYA jika gambar sama sekali bukan bukti transfer (misalnya: foto diri, gambar acak, meme, screenshot chat WhatsApp biasa tanpa bukti transaksi, dokumen tidak terkait, atau layar kosong).
3. transaction_status = "BERHASIL" jika transaksi sukses, berhasil, atau selesai. "GAGAL" jika transaksi gagal/ditolak. "BUKAN_TRANSFER" jika bukan bukti transfer.
4. detected_amount: ekstrak angka nominal transaksi yang ditransfer secara akurat (integer).
5. detected_sender_name: baca nama pemilik rekening pengirim / sumber dana bila tertera.

Kembalikan HANYA JSON tanpa format teks markdown lain."#;

    let models = [
        "gemini-3.1-flash-lite",
        "gemini-flash-lite-latest",
        "gemini-flash-latest",
    ];

    let mut ai_data: Option<GeminiParsedOutput> = None;
    let mut last_error: Option<String> = None;

    for model in models {
        let url = format!(
            "https://generativelanguage.googleapis.com/v1beta/models/{}:generateContent?key={}",
            model, api_key
        );
        let payload = json!({
            "contents": [{
                "parts": [
                    { "text": prompt_text },
                    {
                        "inlineData": {
                            "mimeType": mime_type,
                            "data": base64_data
                        }
                    }
                ]
            }],
            "generationConfig": {
                "temperature": 0.1,
                "responseMimeType": "application/json"
            }
        });

        match http_client.post(&url).json(&payload).send().await {
            Ok(resp) => {
                let status = resp.status();
                match resp.text().await {
                    Ok(body_text) if status.is_success() => {
                        if let Ok(parsed_resp) = serde_json::from_str::<Value>(&body_text) {
                            if let Some(raw_text) = parsed_resp
                                .pointer("/candidates/0/content/parts/0/text")
                                .and_then(|v| v.as_str())
                            {
                                let clean = raw_text
                                    .replace("```json", "")
                                    .replace("```", "")
                                    .trim()
                                    .to_string();
                                match serde_json::from_str::<GeminiParsedOutput>(&clean) {
                                    Ok(parsed) => {
                                        ai_data = Some(parsed);
                                        break;
                                    }
                                    Err(e) => {
                                        last_error = Some(format!("Gagal parse JSON dari Gemini: {}", e));
                                    }
                                }
                            } else {
                                last_error = Some("Respon Gemini kosong.".to_string());
                            }
                        } else {
                            last_error = Some(format!(
                                "Gagal parse JSON dari Gemini: {}",
                                &body_text.chars().take(100).collect::<String>()
                            ));
                        }
                    }
                    Ok(body_text) => {
                        let snippet: String = body_text.chars().take(150).collect();
                        last_error = Some(format!("Gemini API HTTP {}: {}", status.as_u16(), snippet));
                    }
                    Err(e) => {
                        last_error = Some(format!("Gagal membaca respon Gemini: {}", e));
                    }
                }
            }
            Err(e) => {
                last_error = Some(format!("Koneksi API gagal: {}", e));
            }
        }

        if let Some(ref err) = last_error {
            eprintln!("[AI Verification] Model {} gagal: {}", model, err);
        }
        tokio::time::sleep(std::time::Duration::from_millis(500)).await;
    }

    let Some(ai) = ai_data else {
        let err_str = last_error.unwrap_or_else(|| "Respon kosong".to_string());
        let is_quota_or_busy = err_str.contains("503") || err_str.contains("429");
        let failure_msg = if is_quota_or_busy {
            "Layanan AI sedang sibuk (kuota/beban tinggi). Memerlukan verifikasi manual oleh Bendahara.".to_string()
        } else {
            let snippet: String = err_str.chars().take(100).collect();
            format!(
                "Gagal memproses AI ({}). Memerlukan verifikasi manual oleh Bendahara.",
                snippet
            )
        };
        return AiVerificationResult {
            decision: "pending".to_string(),
            amount: 0,
            sender_name: String::new(),
            notes: failure_msg,
            confidence: 0.0,
            is_valid_proof: false,
        };
    };

    let is_valid_proof_raw = ai.is_valid_transfer_proof.unwrap_or(false);
    let detected_amount = value_to_i64(ai.detected_amount.as_ref());
    let detected_sender = ai.detected_sender_name.unwrap_or_default().trim().to_string();
    let tx_status = ai
        .transaction_status
        .unwrap_or_default()
        .trim()
        .to_uppercase();
    let confidence = value_to_f64(ai.confidence.as_ref());

    let is_real_transfer_proof =
        (is_valid_proof_raw || detected_amount > 0) && tx_status != "BUKAN_TRANSFER";

    if !is_real_transfer_proof {
        return AiVerificationResult {
            decision: "ditolak".to_string(),
            amount: detected_amount,
            sender_name: detected_sender,
            notes: "Ditolak otomatis: Gambar yang diunggah bukan bukti transfer pembayaran yang sah."
                .to_string(),
            confidence,
            is_valid_proof: false,
        };
    }

    if tx_status == "GAGAL" {
        return AiVerificationResult {
            decision: "ditolak".to_string(),
            amount: detected_amount,
            sender_name: detected_sender,
            notes: "Ditolak otomatis: Status transaksi pada bukti transfer tertera GAGAL."
                .to_string(),
            confidence,
            is_valid_proof: true,
        };
    }

    if detected_amount > 0 && detected_amount < MIN_KAS_AMOUNT {
        return AiVerificationResult {
            decision: "ditolak".to_string(),
            amount: detected_amount,
            sender_name: detected_sender,
            notes: format!(
                "Ditolak otomatis: Nominal pada bukti transfer (Rp {}) kurang dari nominal minimal Rp {}.",
                format_idr(detected_amount),
                format_idr(MIN_KAS_AMOUNT)
            ),
            confidence,
            is_valid_proof: true,
        };
    }

    let is_name_match = match_sender_name(&detected_sender, user_account_name);

    if detected_amount >= MIN_KAS_AMOUNT && is_name_match {
        return AiVerificationResult {
            decision: "lunas".to_string(),
            amount: detected_amount,
            sender_name: detected_sender.clone(),
            notes: format!(
                "Disetujui otomatis: Nominal sesuai (Rp {}) dan nama pengirim \"{}\" cocok dengan nama akun \"{}\".",
                format_idr(detected_amount),
                detected_sender,
                user_account_name
            ),
            confidence,
            is_valid_proof: true,
        };
    }

    if detected_amount >= MIN_KAS_AMOUNT && !is_name_match {
        let sender_display = if detected_sender.is_empty() {
            "Tidak tertera di struk"
        } else {
            &detected_sender
        };
        return AiVerificationResult {
            decision: "pending".to_string(),
            amount: detected_amount,
            sender_name: detected_sender.clone(),
            notes: format!(
                "Nominal sesuai (Rp {}), namun nama pengirim (\"{}\") berbeda dari nama akun (\"{}\"). Memerlukan verifikasi manual oleh Bendahara.",
                format_idr(detected_amount),
                sender_display,
                user_account_name
            ),
            confidence,
            is_valid_proof: true,
        };
    }

    AiVerificationResult {
        decision: "pending".to_string(),
        amount: detected_amount,
        sender_name: detected_sender,
        notes: "Nominal atau detail transfer tidak terbaca jelas . Memerlukan verifikasi manual oleh Bendahara."
            .to_string(),
        confidence,
        is_valid_proof: true,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sender_name_matching_cases() {
        assert!(match_sender_name("MUHAMMAD HASBY", "Muhammad Hasby Ash Shidiqy"));
        assert!(match_sender_name("Arifah Naufali", "Arifah Naufali"));
        assert!(match_sender_name("bima pratama", "Bima Pratama Putra (Koordinator)"));
        assert!(!match_sender_name("Orang Lain", "Arifah Naufali"));
        assert!(!match_sender_name("", "Arifah Naufali"));
    }
}
