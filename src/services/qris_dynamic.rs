use base64::Engine;
use qrcode::render::svg;
use qrcode::{EcLevel, QrCode};
use regex::Regex;
use std::path::Path;

pub const QRIS_PAYLOAD_FILE: &str = "public/uploads/qris/qris_payload.txt";

#[derive(Debug, Clone)]
pub struct QrisInfo {
    pub raw_payload: String,
    pub merchant_name: Option<String>,
    pub merchant_city: Option<String>,
    pub nmid: Option<String>,
    pub is_umi: bool,
}

/// EMVCo QRIS CRC16-CCITT (init = 0xFFFF, poly = 0x1021)
pub fn crc16_ccitt(data: &[u8]) -> u16 {
    let mut crc: u16 = 0xFFFF;
    for &byte in data {
        crc ^= (byte as u16) << 8;
        for _ in 0..8 {
            if (crc & 0x8000) != 0 {
                crc = (crc << 1) ^ 0x1021;
            } else {
                crc <<= 1;
            }
        }
    }
    crc
}

/// Parse top-level EMVCo TLV fields: Vec<(tag, value)>
pub fn parse_tlv(payload: &str) -> Result<Vec<(String, String)>, String> {
    let bytes = payload.as_bytes();
    let mut idx = 0usize;
    let mut fields = Vec::new();

    while idx < bytes.len() {
        if idx + 4 > bytes.len() {
            return Err("Format QRIS tidak lengkap (header TLV terpotong).".to_string());
        }
        let tag = std::str::from_utf8(&bytes[idx..idx + 2])
            .map_err(|_| "Tag QRIS bukan UTF-8 valid.".to_string())?
            .to_string();
        let len_str = std::str::from_utf8(&bytes[idx + 2..idx + 4])
            .map_err(|_| "Panjang TLV QRIS bukan UTF-8 valid.".to_string())?;
        let len: usize = len_str
            .parse()
            .map_err(|_| format!("Panjang TLV tidak valid untuk tag {}: {}", tag, len_str))?;
        idx += 4;
        if idx + len > bytes.len() {
            return Err(format!(
                "Nilai TLV tag {} melebihi panjang payload QRIS.",
                tag
            ));
        }
        let val = std::str::from_utf8(&bytes[idx..idx + len])
            .map_err(|_| format!("Nilai tag {} bukan UTF-8 valid.", tag))?
            .to_string();
        idx += len;
        fields.push((tag, val));
    }

    Ok(fields)
}

/// Validate raw EMVCo QRIS string and extract merchant info + NMID.
pub fn parse_qris_info(raw: &str) -> Result<QrisInfo, String> {
    let trimmed = raw.trim();
    if trimmed.len() < 40 || !trimmed.starts_with("000201") {
        return Err(
            "Payload QRIS tidak valid. String QRIS harus diawali dengan '000201'.".to_string(),
        );
    }

    let fields = parse_tlv(trimmed)?;

    // Validate CRC if Tag 63 is at the end
    if let Some((last_tag, last_val)) = fields.last() {
        if last_tag == "63" && last_val.len() == 4 {
            let body_without_crc = &trimmed[..trimmed.len() - 4];
            let expected = format!("{:04X}", crc16_ccitt(body_without_crc.as_bytes()));
            if !expected.eq_ignore_ascii_case(last_val) {
                return Err(format!(
                    "Checksum CRC16 QRIS tidak cocok (terbaca {}, seharusnya {}). Pastikan seluruh teks QRIS disalin utuh.",
                    last_val, expected
                ));
            }
        }
    }

    let mut merchant_name = None;
    let mut merchant_city = None;
    let mut nmid = None;
    let mut is_umi = false;

    for (tag, val) in &fields {
        match tag.as_str() {
            "59" => merchant_name = Some(val.clone()),
            "60" => merchant_city = Some(val.clone()),
            "51" => {
                if let Ok(sub) = parse_tlv(val) {
                    for (stag, sval) in sub {
                        if stag == "02" && nmid.is_none() {
                            nmid = Some(sval);
                        } else if stag == "03" && sval.eq_ignore_ascii_case("UMI") {
                            is_umi = true;
                        }
                    }
                }
            }
            t if (t >= "26" && t <= "45") => {
                if let Ok(sub) = parse_tlv(val) {
                    for (stag, sval) in sub {
                        if stag == "03" && sval.eq_ignore_ascii_case("UMI") {
                            is_umi = true;
                        }
                    }
                }
            }
            _ => {}
        }
    }

    Ok(QrisInfo {
        raw_payload: trimmed.to_string(),
        merchant_name,
        merchant_city,
        nmid,
        is_umi,
    })
}

/// Converts a static EMVCo QRIS string into a Dynamic QRIS string locked to exact `amount` (IDR).
pub fn build_dynamic_qris(static_payload: &str, amount: i64) -> Result<String, String> {
    if amount <= 0 {
        return Err("Nominal QRIS dinamis harus lebih dari 0.".to_string());
    }

    let fields = parse_tlv(static_payload.trim())?;
    let amount_str = amount.to_string();
    let amount_tag = format!("54{:02}{}", amount_str.len(), amount_str);

    let mut out = String::with_capacity(static_payload.len() + 16);
    let mut inserted_amount = false;

    for (tag, val) in fields {
        if tag == "54" || tag == "63" {
            // Strip old amount & old CRC
            continue;
        }
        if tag == "01" {
            // Point of Initiation Method: 12 = Dynamic QR (single-use fixed amount)
            out.push_str("010212");
            continue;
        }
        if tag == "58" && !inserted_amount {
            out.push_str(&amount_tag);
            inserted_amount = true;
        }
        out.push_str(&format!("{}{:02}{}", tag, val.len(), val));
    }

    if !inserted_amount {
        out.push_str(&amount_tag);
    }

    out.push_str("6304");
    let crc = crc16_ccitt(out.as_bytes());
    out.push_str(&format!("{:04X}", crc));

    Ok(out)
}

/// Renders a QR code string into a crisp monochrome SVG data URL (`data:image/svg+xml;base64,...`).
pub fn render_qr_svg_data_url(payload: &str) -> Result<String, String> {
    let code = QrCode::with_error_correction_level(payload.as_bytes(), EcLevel::M)
        .map_err(|e| format!("Gagal membuat gambar QRIS: {}", e))?;

    let svg_str = code
        .render::<svg::Color>()
        .min_dimensions(260, 260)
        .quiet_zone(true)
        .dark_color(svg::Color("#18181b"))
        .light_color(svg::Color("#ffffff"))
        .build();

    let encoded = base64::engine::general_purpose::STANDARD.encode(svg_str.as_bytes());
    Ok(format!("data:image/svg+xml;base64,{}", encoded))
}

/// Loads static QRIS payload from `public/uploads/qris/qris_payload.txt`, falling back to `env_fallback`.
pub fn load_static_qris_payload(env_fallback: &str) -> Option<String> {
    if Path::new(QRIS_PAYLOAD_FILE).exists() {
        if let Ok(content) = std::fs::read_to_string(QRIS_PAYLOAD_FILE) {
            let trimmed = content.trim().to_string();
            if !trimmed.is_empty() {
                return Some(trimmed);
            }
        }
    }
    let fb = env_fallback.trim();
    if !fb.is_empty() {
        Some(fb.to_string())
    } else {
        None
    }
}

/// Extracts Rupiah integer amount from Indonesian bank / e-wallet notification text.
/// Handles formats like:
/// - "Pembayaran QRIS sebesar Rp10.247 berhasil diterima"
/// - "DANA Bisnis: Uang masuk Rp 10.247,00 dari BUDI"
/// - "GoPay Merchant: Transaksi QRIS IDR 10,247.00 sukses"
/// - "Saldo Anda Rp 550.000. Pembayaran masuk Rp10.247"
pub fn extract_amount_from_text(text: &str) -> Option<i64> {
    // Match currency-prefixed numbers first (Rp / IDR)
    let currency_re =
        Regex::new(r"(?i)(?:rp\.?|idr)\s*([0-9]{1,3}(?:[.,][0-9]{3})+|[0-9]{4,9})(?:[.,]([0-9]{2}))?(?:\b|[^0-9])")
            .ok()?;

    let mut candidates: Vec<i64> = Vec::new();
    for cap in currency_re.captures_iter(text) {
        if let Some(m) = cap.get(1) {
            let digits: String = m.as_str().chars().filter(|c| c.is_ascii_digit()).collect();
            if let Ok(val) = digits.parse::<i64>() {
                if val > 0 {
                    candidates.push(val);
                }
            }
        }
    }

    // Prefer amount in Kas dynamic range (10000..=10999) when multiple amounts appear (e.g. balance + tx amount)
    if let Some(&kas_match) = candidates.iter().find(|&&v| (10000..=10999).contains(&v)) {
        return Some(kas_match);
    }
    if let Some(&first) = candidates.first() {
        return Some(first);
    }

    // Fallback: standalone formatted number like "10.247" or "10247"
    let plain_re = Regex::new(r"\b([0-9]{1,3}(?:[.,][0-9]{3})+|[0-9]{5,7})\b").ok()?;
    let mut plain_candidates: Vec<i64> = Vec::new();
    for cap in plain_re.captures_iter(text) {
        if let Some(m) = cap.get(1) {
            let digits: String = m.as_str().chars().filter(|c| c.is_ascii_digit()).collect();
            if let Ok(val) = digits.parse::<i64>() {
                if val >= 1000 {
                    plain_candidates.push(val);
                }
            }
        }
    }

    if let Some(&kas_match) = plain_candidates
        .iter()
        .find(|&&v| (10000..=10999).contains(&v))
    {
        return Some(kas_match);
    }
    plain_candidates.into_iter().next()
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE_DANA_QRIS: &str = "00020101021126570011ID.DANA.WWW011893600915302449173602090244917360303UMI51440014ID.CO.QRIS.WWW0215ID10265201456280303UMI5204581353033605802ID5913Kitchen mania6013Kab. Banyumas6105531626304476E";

    #[test]
    fn parses_real_dana_umi_payload() {
        let info = parse_qris_info(SAMPLE_DANA_QRIS).expect("valid DANA UMI QRIS");
        assert_eq!(info.merchant_name.as_deref(), Some("Kitchen mania"));
        assert_eq!(info.merchant_city.as_deref(), Some("Kab. Banyumas"));
        assert_eq!(info.nmid.as_deref(), Some("ID1026520145628"));
        assert!(info.is_umi);
    }

    #[test]
    fn builds_valid_dynamic_qris_with_amount_and_crc() {
        let dyn_qris = build_dynamic_qris(SAMPLE_DANA_QRIS, 10247).expect("dynamic qris");
        assert!(dyn_qris.starts_with("000201010212"));
        assert!(dyn_qris.contains("5405102475802ID"));
        // Verify CRC of generated dynamic QRIS
        let info = parse_qris_info(&dyn_qris).expect("generated dynamic QRIS must pass CRC check");
        assert_eq!(info.merchant_name.as_deref(), Some("Kitchen mania"));

        let svg_url = render_qr_svg_data_url(&dyn_qris).expect("svg data url");
        assert!(svg_url.starts_with("data:image/svg+xml;base64,"));
    }

    #[test]
    fn extracts_indonesian_notification_amounts() {
        assert_eq!(
            extract_amount_from_text("Pembayaran QRIS sebesar Rp10.247 berhasil diterima"),
            Some(10247)
        );
        assert_eq!(
            extract_amount_from_text("DANA Bisnis: Anda menerima Rp 10.089,00 dari AHMAD"),
            Some(10089)
        );
        assert_eq!(
            extract_amount_from_text("Saldo Anda Rp 1.500.000. Uang masuk QRIS Rp10.512 sukses"),
            Some(10512)
        );
        assert_eq!(
            extract_amount_from_text("Transaksi QRIS IDR 10,333.00 berhasil"),
            Some(10333)
        );
    }
}
