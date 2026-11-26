use axum::{
    body::Bytes,
    extract::{Path, Query, State},
    http::{HeaderMap, StatusCode},
    response::Response,
    Json,
};
use chrono::{Duration as ChronoDuration, NaiveDateTime};
use rand::Rng;
use serde::Deserialize;
use serde_json::{json, Value};
use sqlx::FromRow;
use std::collections::HashSet;
use std::path::Path as StdPath;
use std::time::{Duration, SystemTime};

use crate::error::{AppError, AppResult};
use crate::middleware::auth::AuthUser;
use crate::middleware::cache::MemoryCache;
use crate::middleware::role_check::{is_kas_exempt, require_bendahara};
use crate::models::{de_opt_i32, PaymentRow};
use crate::services::qris_dynamic::{
    build_dynamic_qris, extract_amount_from_text, load_static_qris_payload, parse_qris_info,
    render_qr_svg_data_url,
};
use crate::state::AppState;
use crate::utils::date_helper::{
    format_idr, format_jakarta_dt, format_opt_jakarta_dt, get_jakarta_month_year,
    now_jakarta_naive,
};

const BASE_KAS_AMOUNT: i32 = 10000;

const PAYMENT_COLS: &str = "id, user_id, CAST(amount AS DOUBLE) AS amount, month, year, proof_path, status, confirmed_by, confirmed_at, ai_status, ai_notes, sender_name_detected, order_id, unique_code, payable_amount, qris_dynamic, expires_at, payment_channel, created_at";

#[derive(Debug, Deserialize)]
pub struct CreateInvoiceBody {
    #[serde(default, deserialize_with = "de_opt_i32")]
    pub month: Option<i32>,
    #[serde(default, deserialize_with = "de_opt_i32")]
    pub year: Option<i32>,
    pub force_new: Option<bool>,
}

/// Generates a unique 3-digit code (1..=999) not used by any active unexpired pending invoice.
async fn pick_unique_code(pool: &sqlx::MySqlPool, now_jkt: NaiveDateTime) -> AppResult<i32> {
    let used_rows: Vec<(Option<i32>,)> = sqlx::query_as(
        "SELECT unique_code FROM payments
         WHERE status = 'pending' AND unique_code IS NOT NULL
           AND (expires_at IS NULL OR expires_at > ?)",
    )
    .bind(now_jkt)
    .fetch_all(pool)
    .await
    .map_err(|e| AppError::internal("Gagal menghasilkan kode unik pembayaran.", e))?;

    let used: HashSet<i32> = used_rows.into_iter().filter_map(|(c,)| c).collect();
    let mut rng = rand::thread_rng();

    for _ in 0..200 {
        let candidate = rng.gen_range(1..=999);
        if !used.contains(&candidate) {
            return Ok(candidate);
        }
    }

    for candidate in 1..=999 {
        if !used.contains(&candidate) {
            return Ok(candidate);
        }
    }

    Err(AppError::new(
        StatusCode::SERVICE_UNAVAILABLE,
        "Antrean tagihan aktif sedang penuh. Silakan coba beberapa saat lagi.",
    ))
}

fn build_invoice_response(
    payment: &PaymentRow,
    merchant_name: &str,
    nmid: &str,
    now_jkt: NaiveDateTime,
) -> AppResult<Value> {
    let payable = payment.payable_amount.unwrap_or(BASE_KAS_AMOUNT);
    let unique_code = payment.unique_code.unwrap_or(0);
    let qris_str = payment.qris_dynamic.as_deref().unwrap_or("");
    let qris_svg_data_url = if !qris_str.is_empty() {
        Some(
            render_qr_svg_data_url(qris_str)
                .map_err(|e| AppError::internal("Gagal merender gambar QRIS dinamis.", e))?,
        )
    } else {
        None
    };

    let remaining_seconds = payment
        .expires_at
        .map(|exp| (exp - now_jkt).num_seconds().max(0))
        .unwrap_or(0);

    let effective_status = if payment.status == "pending" && payment.expires_at.is_some() && remaining_seconds == 0 {
        "expired"
    } else {
        payment.status.as_str()
    };

    Ok(json!({
        "payment_id": payment.id,
        "order_id": payment.order_id,
        "month": payment.month,
        "year": payment.year,
        "base_amount": BASE_KAS_AMOUNT,
        "unique_code": unique_code,
        "payable_amount": payable,
        "fee": 0,
        "status": effective_status,
        "merchant_name": merchant_name,
        "nmid": nmid,
        "qris_string": qris_str,
        "qris_svg_data_url": qris_svg_data_url,
        "expires_at": format_opt_jakarta_dt(payment.expires_at),
        "remaining_seconds": remaining_seconds,
        "confirmed_at": format_opt_jakarta_dt(payment.confirmed_at),
        "notes": payment.ai_notes
    }))
}

/// POST /api/payments/create-invoice
/// Membuat tagihan QRIS Dinamis otomatis tanpa potongan (0% MDR + kode unik).
pub async fn create_invoice(
    State(state): State<AppState>,
    AuthUser(auth_user): AuthUser,
    Json(body): Json<CreateInvoiceBody>,
) -> AppResult<(StatusCode, Json<Value>)> {
    let (cur_m, cur_y) = get_jakarta_month_year();
    let month_num = body.month.unwrap_or(cur_m);
    let year_num = body.year.unwrap_or(cur_y);

    if !(1..=12).contains(&month_num) {
        return Err(AppError::bad_request(
            "Bulan harus bernilai antara 1 hingga 12.",
        ));
    }

    let Some(static_payload) = load_static_qris_payload(&state.config.qris_static_payload) else {
        return Err(AppError::new(
            StatusCode::SERVICE_UNAVAILABLE,
            "QRIS Bendahara belum dikonfigurasi. Hubungi Bendahara untuk memasukkan payload QRIS statis.",
        ));
    };

    let qris_info = parse_qris_info(&static_payload).map_err(|e| {
        AppError::new(
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Payload QRIS statis tidak valid: {}", e),
        )
    })?;
    let merchant_name = qris_info
        .merchant_name
        .unwrap_or_else(|| state.config.qris_merchant_name.clone());
    let nmid = qris_info
        .nmid
        .unwrap_or_else(|| state.config.qris_nmid.clone());

    let now_jkt = now_jakarta_naive();
    let user_id = auth_user.id;
    let force_new = body.force_new.unwrap_or(false);

    let q_existing = format!(
        "SELECT {} FROM payments WHERE user_id = ? AND month = ? AND year = ? LIMIT 1",
        PAYMENT_COLS
    );
    let existing = sqlx::query_as::<_, PaymentRow>(&q_existing)
        .bind(user_id)
        .bind(month_num)
        .bind(year_num)
        .fetch_optional(&state.pool)
        .await
        .map_err(|e| AppError::internal("Gagal memeriksa status tagihan kas.", e))?;

    if let Some(ref ex) = existing {
        if ex.status == "lunas" {
            return Ok((
                StatusCode::OK,
                Json(json!({
                    "status": "success",
                    "already_paid": true,
                    "message": format!("Kas Bulan {} Tahun {} Anda sudah LUNAS.", month_num, year_num),
                    "data": build_invoice_response(ex, &merchant_name, &nmid, now_jkt)?
                })),
            ));
        }

        // Reuse active unexpired invoice unless force_new is requested
        if !force_new && ex.status == "pending" && ex.order_id.is_some() && ex.qris_dynamic.is_some() {
            let is_still_valid = ex
                .expires_at
                .map(|exp| exp > now_jkt)
                .unwrap_or(false);
            if is_still_valid {
                return Ok((
                    StatusCode::OK,
                    Json(json!({
                        "status": "success",
                        "already_paid": false,
                        "message": "Tagihan QRIS aktif dimuat. Silakan scan sesuai nominal tertera.",
                        "data": build_invoice_response(ex, &merchant_name, &nmid, now_jkt)?
                    })),
                ));
            }
        }
    }

    let unique_code = pick_unique_code(&state.pool, now_jkt).await?;
    let payable_amount = BASE_KAS_AMOUNT + unique_code;
    let dyn_qris = build_dynamic_qris(&static_payload, payable_amount as i64)
        .map_err(|e| AppError::internal("Gagal membuat QRIS dinamis.", e))?;

    let rand_suffix: u16 = rand::thread_rng().gen_range(1000..=9999);
    let order_id = format!(
        "KAS-{}{:02}-{}-{}",
        year_num, month_num, user_id, rand_suffix
    );
    let expires_at = now_jkt + ChronoDuration::minutes(state.config.invoice_expire_minutes);
    let init_notes = format!(
        "Menunggu pembayaran otomatis QRIS Dinamis (Order {} - Nominal Rp {}, tanpa potongan).",
        order_id,
        format_idr(payable_amount as i64)
    );

    let payment_id: i32 = if let Some(ex) = existing {
        sqlx::query(
            "UPDATE payments
             SET amount = ?, status = 'pending', proof_path = NULL, confirmed_by = NULL, confirmed_at = NULL,
                 ai_status = 'gateway_pending', ai_notes = ?, sender_name_detected = NULL,
                 order_id = ?, unique_code = ?, payable_amount = ?, qris_dynamic = ?, expires_at = ?, payment_channel = 'qris_dynamic'
             WHERE id = ?",
        )
        .bind(BASE_KAS_AMOUNT)
        .bind(&init_notes)
        .bind(&order_id)
        .bind(unique_code)
        .bind(payable_amount)
        .bind(&dyn_qris)
        .bind(expires_at)
        .bind(ex.id)
        .execute(&state.pool)
        .await
        .map_err(|e| AppError::internal("Gagal memperbarui tagihan pembayaran.", e))?;
        ex.id
    } else {
        let res = sqlx::query(
            "INSERT INTO payments (user_id, amount, month, year, proof_path, status, confirmed_by, confirmed_at, ai_status, ai_notes, order_id, unique_code, payable_amount, qris_dynamic, expires_at, payment_channel, created_at)
             VALUES (?, ?, ?, ?, NULL, 'pending', NULL, NULL, 'gateway_pending', ?, ?, ?, ?, ?, ?, 'qris_dynamic', ?)",
        )
        .bind(user_id)
        .bind(BASE_KAS_AMOUNT)
        .bind(month_num)
        .bind(year_num)
        .bind(&init_notes)
        .bind(&order_id)
        .bind(unique_code)
        .bind(payable_amount)
        .bind(&dyn_qris)
        .bind(expires_at)
        .bind(now_jkt)
        .execute(&state.pool)
        .await
        .map_err(|e| AppError::internal("Gagal membuat tagihan pembayaran.", e))?;
        res.last_insert_id() as i32
    };

    let q_one = format!("SELECT {} FROM payments WHERE id = ?", PAYMENT_COLS);
    let payment = sqlx::query_as::<_, PaymentRow>(&q_one)
        .bind(payment_id)
        .fetch_one(&state.pool)
        .await
        .map_err(|e| AppError::internal("Gagal memuat tagihan pembayaran.", e))?;

    state.cache.clear_pattern(Some("payments"));
    state.cache.clear_pattern(Some("dashboard:stats"));

    Ok((
        StatusCode::CREATED,
        Json(json!({
            "status": "success",
            "already_paid": false,
            "message": "Tagihan QRIS dinamis berhasil dibuat. Scan QRIS untuk pembayaran otomatis tanpa potongan.",
            "data": build_invoice_response(&payment, &merchant_name, &nmid, now_jkt)?
        })),
    ))
}

/// GET /api/payments/invoice/{order_id}/status
/// Polling status pembayaran real-time oleh frontend anggota.
pub async fn get_invoice_status(
    State(state): State<AppState>,
    AuthUser(auth_user): AuthUser,
    Path(order_id): Path<String>,
) -> AppResult<(StatusCode, Json<Value>)> {
    let q = format!(
        "SELECT {} FROM payments WHERE order_id = ? LIMIT 1",
        PAYMENT_COLS
    );
    let payment = sqlx::query_as::<_, PaymentRow>(&q)
        .bind(order_id.trim())
        .fetch_optional(&state.pool)
        .await
        .map_err(|e| AppError::internal("Gagal mengecek status invoice.", e))?;

    let Some(payment) = payment else {
        return Err(AppError::not_found("Tagihan pembayaran tidak ditemukan."));
    };

    let is_owner = payment.user_id == auth_user.id;
    let is_bendahara_or_admin = is_kas_exempt(&auth_user);
    if !is_owner && !is_bendahara_or_admin {
        return Err(AppError::forbidden(
            "Anda tidak memiliki izin melihat tagihan ini.",
        ));
    }

    let now_jkt = now_jakarta_naive();
    let remaining_seconds = payment
        .expires_at
        .map(|exp| (exp - now_jkt).num_seconds().max(0))
        .unwrap_or(0);

    let effective_status = if payment.status == "pending" && payment.expires_at.is_some() && remaining_seconds == 0 {
        "expired"
    } else {
        payment.status.as_str()
    };

    Ok((
        StatusCode::OK,
        Json(json!({
            "status": "success",
            "data": {
                "payment_id": payment.id,
                "order_id": payment.order_id,
                "status": effective_status,
                "is_paid": payment.status == "lunas",
                "payable_amount": payment.payable_amount.unwrap_or(BASE_KAS_AMOUNT),
                "remaining_seconds": remaining_seconds,
                "expires_at": format_opt_jakarta_dt(payment.expires_at),
                "confirmed_at": format_opt_jakarta_dt(payment.confirmed_at),
                "notes": payment.ai_notes
            }
        })),
    ))
}

#[derive(Debug, Deserialize)]
pub struct WebhookQuery {
    pub secret: Option<String>,
}

/// Core matching engine shared between live webhook & Bendahara test webhook.
async fn process_mutasi_event(
    state: &AppState,
    source_app: Option<String>,
    raw_title: Option<String>,
    raw_text: Option<String>,
    explicit_amount: Option<i64>,
    explicit_order_id: Option<String>,
) -> AppResult<Value> {
    let combined_text = format!(
        "{} {}",
        raw_title.as_deref().unwrap_or(""),
        raw_text.as_deref().unwrap_or("")
    );

    let detected_amount = explicit_amount
        .filter(|&a| a > 0)
        .or_else(|| extract_amount_from_text(&combined_text));

    let now_jkt = now_jakarta_naive();

    let mut matched_payment: Option<PaymentRow> = None;

    if let Some(ref oid) = explicit_order_id.as_deref().filter(|s| !s.is_empty()) {
        let q = format!(
            "SELECT {} FROM payments WHERE order_id = ? AND status = 'pending' LIMIT 1",
            PAYMENT_COLS
        );
        matched_payment = sqlx::query_as::<_, PaymentRow>(&q)
            .bind(oid)
            .fetch_optional(&state.pool)
            .await
            .map_err(|e| AppError::internal("Gagal mencocokkan order_id.", e))?;
    } else if let Some(amt) = detected_amount {
        let q = format!(
            "SELECT {} FROM payments
             WHERE status = 'pending'
               AND payable_amount = ?
               AND (expires_at IS NULL OR expires_at >= ?)
             ORDER BY id DESC
             LIMIT 1",
            PAYMENT_COLS
        );
        matched_payment = sqlx::query_as::<_, PaymentRow>(&q)
            .bind(amt as i32)
            .bind(now_jkt)
            .fetch_optional(&state.pool)
            .await
            .map_err(|e| AppError::internal("Gagal mencocokkan mutasi pembayaran.", e))?;
    }

    if let Some(payment) = matched_payment {
        let final_amt = detected_amount
            .unwrap_or_else(|| payment.payable_amount.unwrap_or(BASE_KAS_AMOUNT) as i64);
        let src_label = source_app
            .as_deref()
            .filter(|s| !s.is_empty())
            .unwrap_or("QRIS UMI");
        let note = format!(
            "Lunas otomatis via Payment Gateway QRIS Dinamis (Mutasi Rp {} dari {} terdeteksi pada {}).",
            format_idr(final_amt),
            src_label,
            format_jakarta_dt(now_jkt)
        );

        sqlx::query(
            "UPDATE payments
             SET status = 'lunas', confirmed_by = NULL, confirmed_at = ?,
                 ai_status = 'gateway_auto', ai_notes = ?
             WHERE id = ? AND status = 'pending'",
        )
        .bind(now_jkt)
        .bind(&note)
        .bind(payment.id)
        .execute(&state.pool)
        .await
        .map_err(|e| AppError::internal("Gagal memperbarui status pembayaran.", e))?;

        let _ = sqlx::query(
            "INSERT INTO payment_webhook_logs (source_app, raw_title, raw_text, detected_amount, matched_payment_id, matched_order_id, status, received_at)
             VALUES (?, ?, ?, ?, ?, ?, 'matched', ?)",
        )
        .bind(source_app.as_deref())
        .bind(raw_title.as_deref())
        .bind(raw_text.as_deref())
        .bind(Some(final_amt as i32))
        .bind(Some(payment.id))
        .bind(payment.order_id.as_deref())
        .bind(now_jkt)
        .execute(&state.pool)
        .await;

        state.cache.clear_pattern(Some("payments"));
        state.cache.clear_pattern(Some("dashboard:stats"));

        return Ok(json!({
            "matched": true,
            "payment_id": payment.id,
            "order_id": payment.order_id,
            "user_id": payment.user_id,
            "detected_amount": final_amt,
            "status": "lunas",
            "notes": note
        }));
    }

    // Log unmatched notification for Bendahara audit
    let log_status = if detected_amount.is_some() {
        "unmatched"
    } else {
        "ignored_no_amount"
    };
    let _ = sqlx::query(
        "INSERT INTO payment_webhook_logs (source_app, raw_title, raw_text, detected_amount, matched_payment_id, matched_order_id, status, received_at)
         VALUES (?, ?, ?, ?, NULL, NULL, ?, ?)",
    )
    .bind(source_app.as_deref())
    .bind(raw_title.as_deref())
    .bind(raw_text.as_deref())
    .bind(detected_amount.map(|a| a as i32))
    .bind(log_status)
    .bind(now_jkt)
    .execute(&state.pool)
    .await;

    Ok(json!({
        "matched": false,
        "detected_amount": detected_amount,
        "status": log_status,
        "notes": "Tidak ditemukan tagihan pending aktif yang cocok dengan nominal mutasi ini."
    }))
}

fn parse_flexible_amount(val: Option<&Value>) -> Option<i64> {
    match val {
        Some(Value::Number(n)) => n.as_i64().or_else(|| n.as_f64().map(|f| f.round() as i64)),
        Some(Value::String(s)) => {
            if let Ok(direct) = s.trim().parse::<i64>() {
                Some(direct)
            } else {
                extract_amount_from_text(s)
            }
        }
        _ => None,
    }
}

/// POST /api/payments/webhook/mutasi
/// Endpoint webhook otomatis untuk menerima notifikasi mutasi masuk (DANA Bisnis / GoPay / m-Banking)
/// via MacroDroid / Tasker / Android Notification Forwarder tanpa potongan biaya gateway.
pub async fn webhook_mutasi(
    State(state): State<AppState>,
    Query(query): Query<WebhookQuery>,
    headers: HeaderMap,
    body_bytes: Bytes,
) -> AppResult<(StatusCode, Json<Value>)> {
    if state.config.payment_webhook_secret.is_empty() {
        return Err(AppError::new(
            StatusCode::SERVICE_UNAVAILABLE,
            "PAYMENT_WEBHOOK_SECRET belum dikonfigurasi di file .env server.",
        ));
    }

    let raw_body_str = String::from_utf8_lossy(&body_bytes).to_string();

    // Parse JSON or form-urlencoded or plain text
    let json_val: Value = if let Ok(v) = serde_json::from_str::<Value>(&raw_body_str) {
        v
    } else if raw_body_str.contains('=') {
        let mut map = serde_json::Map::new();
        for (k, v) in url_form_decode(&raw_body_str) {
            map.insert(k, Value::String(v));
        }
        Value::Object(map)
    } else {
        json!({ "text": raw_body_str })
    };

    let provided_secret = headers
        .get("x-webhook-secret")
        .and_then(|v| v.to_str().ok())
        .map(|s| s.trim().to_string())
        .or_else(|| {
            headers
                .get("authorization")
                .and_then(|v| v.to_str().ok())
                .and_then(|s| s.strip_prefix("Bearer "))
                .map(|s| s.trim().to_string())
        })
        .or_else(|| query.secret.clone())
        .or_else(|| {
            json_val
                .get("secret")
                .and_then(|v| v.as_str())
                .map(|s| s.trim().to_string())
        })
        .unwrap_or_default();

    if provided_secret != state.config.payment_webhook_secret {
        return Err(AppError::unauthorized(
            "Webhook ditolak: X-Webhook-Secret tidak valid.",
        ));
    }

    let source_app = json_val
        .get("package_name")
        .or_else(|| json_val.get("app"))
        .or_else(|| json_val.get("source"))
        .and_then(|v| v.as_str())
        .map(|s| s.trim().to_string());

    let raw_title = json_val
        .get("title")
        .or_else(|| json_val.get("subject"))
        .and_then(|v| v.as_str())
        .map(|s| s.trim().to_string());

    let raw_text = json_val
        .get("text")
        .or_else(|| json_val.get("message"))
        .or_else(|| json_val.get("body"))
        .or_else(|| json_val.get("content"))
        .and_then(|v| v.as_str())
        .map(|s| s.trim().to_string());

    let explicit_amount = parse_flexible_amount(
        json_val
            .get("amount")
            .or_else(|| json_val.get("nominal")),
    );

    let explicit_order_id = json_val
        .get("order_id")
        .and_then(|v| v.as_str())
        .map(|s| s.trim().to_string());

    let result = process_mutasi_event(
        &state,
        source_app,
        raw_title,
        raw_text,
        explicit_amount,
        explicit_order_id,
    )
    .await?;

    Ok((
        StatusCode::OK,
        Json(json!({
            "status": "success",
            "data": result
        })),
    ))
}

fn url_form_decode(s: &str) -> Vec<(String, String)> {
    s.split('&')
        .filter_map(|pair| {
            let mut parts = pair.splitn(2, '=');
            let k = parts.next()?.trim();
            if k.is_empty() {
                return None;
            }
            let v = parts.next().unwrap_or("").replace('+', " ");
            Some((percent_decode(k), percent_decode(&v)))
        })
        .collect()
}

fn percent_decode(input: &str) -> String {
    let bytes = input.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let Ok(hex_str) = std::str::from_utf8(&bytes[i + 1..i + 3]) {
                if let Ok(b) = u8::from_str_radix(hex_str, 16) {
                    out.push(b);
                    i += 3;
                    continue;
                }
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).to_string()
}

#[derive(Debug, Deserialize)]
pub struct TestWebhookBody {
    pub text: Option<String>,
    #[serde(default, deserialize_with = "de_opt_i32")]
    pub amount: Option<i32>,
    pub order_id: Option<String>,
}

/// POST /api/payments/webhook/test (Bendahara only)
/// Menguji pencocokan webhook mutasi secara langsung dari dashboard Bendahara.
pub async fn test_webhook_mutasi(
    State(state): State<AppState>,
    AuthUser(auth_user): AuthUser,
    Json(body): Json<TestWebhookBody>,
) -> AppResult<(StatusCode, Json<Value>)> {
    require_bendahara(&auth_user)?;

    let result = process_mutasi_event(
        &state,
        Some("Simulasi Bendahara".to_string()),
        Some("Uji Webhook Mutasi".to_string()),
        body.text,
        body.amount.map(|a| a as i64),
        body.order_id,
    )
    .await?;

    let matched = result
        .get("matched")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    let msg = if matched {
        "Simulasi berhasil: tagihan pending yang cocok otomatis diubah menjadi LUNAS."
    } else {
        "Simulasi dicatat, tetapi tidak ada tagihan pending aktif yang cocok dengan nominal tersebut."
    };

    Ok((
        StatusCode::OK,
        Json(json!({
            "status": "success",
            "message": msg,
            "data": result
        })),
    ))
}

#[derive(Debug, FromRow)]
struct WebhookLogRow {
    id: i32,
    source_app: Option<String>,
    raw_title: Option<String>,
    raw_text: Option<String>,
    detected_amount: Option<i32>,
    matched_payment_id: Option<i32>,
    matched_order_id: Option<String>,
    status: String,
    received_at: Option<NaiveDateTime>,
}

/// GET /api/payments/webhook/logs (Bendahara only)
pub async fn get_webhook_logs(
    State(state): State<AppState>,
    AuthUser(auth_user): AuthUser,
) -> AppResult<(StatusCode, Json<Value>)> {
    require_bendahara(&auth_user)?;

    let rows = sqlx::query_as::<_, WebhookLogRow>(
        "SELECT id, source_app, raw_title, raw_text, detected_amount, matched_payment_id, matched_order_id, status, received_at
         FROM payment_webhook_logs
         ORDER BY id DESC
         LIMIT 50",
    )
    .fetch_all(&state.pool)
    .await
    .map_err(|e| AppError::internal("Gagal memuat log webhook mutasi.", e))?;

    let items: Vec<Value> = rows
        .iter()
        .map(|r| {
            json!({
                "id": r.id,
                "source_app": r.source_app,
                "raw_title": r.raw_title,
                "raw_text": r.raw_text,
                "detected_amount": r.detected_amount,
                "matched_payment_id": r.matched_payment_id,
                "matched_order_id": r.matched_order_id,
                "status": r.status,
                "received_at": format_opt_jakarta_dt(r.received_at)
            })
        })
        .collect();

    Ok((
        StatusCode::OK,
        Json(json!({
            "status": "success",
            "data": items
        })),
    ))
}

/// GET /api/payments/gateway/info (Bendahara only)
pub async fn get_gateway_info(
    State(state): State<AppState>,
    AuthUser(auth_user): AuthUser,
) -> AppResult<(StatusCode, Json<Value>)> {
    require_bendahara(&auth_user)?;

    let origin = state.config.client_origin.trim_end_matches('/');
    let base_url = if origin.is_empty() || origin == "*" {
        "https://gate.ukmiptek.org"
    } else {
        origin
    };

    let payload_opt = load_static_qris_payload(&state.config.qris_static_payload);
    let parsed_info = payload_opt.as_deref().and_then(|p| parse_qris_info(p).ok());
    let now_jkt = now_jakarta_naive();

    let (active_pending_count,): (i64,) = sqlx::query_as(
        "SELECT COUNT(*) FROM payments WHERE status = 'pending' AND order_id IS NOT NULL AND (expires_at IS NULL OR expires_at > ?)",
    )
    .bind(now_jkt)
    .fetch_one(&state.pool)
    .await
    .unwrap_or((0,));

    let secret_configured = !state.config.payment_webhook_secret.is_empty();
    let masked_secret = if secret_configured {
        let s = &state.config.payment_webhook_secret;
        if s.len() > 8 {
            format!("{}...{}", &s[..4], &s[s.len() - 4..])
        } else {
            "********".to_string()
        }
    } else {
        "BELUM_DIKONFIGURASI".to_string()
    };

    Ok((
        StatusCode::OK,
        Json(json!({
            "status": "success",
            "data": {
                "webhook_url": format!("{}/api/payments/webhook/mutasi", base_url),
                "webhook_secret_configured": secret_configured,
                "webhook_secret_masked": masked_secret,
                "invoice_expire_minutes": state.config.invoice_expire_minutes,
                "has_dynamic_qris": parsed_info.is_some(),
                "merchant_name": parsed_info.as_ref().and_then(|i| i.merchant_name.clone()).unwrap_or_else(|| state.config.qris_merchant_name.clone()),
                "nmid": parsed_info.as_ref().and_then(|i| i.nmid.clone()).unwrap_or_else(|| state.config.qris_nmid.clone()),
                "is_umi": parsed_info.as_ref().map(|i| i.is_umi).unwrap_or(false),
                "active_pending_invoices": active_pending_count,
                "fee_info": "Rp 0 (0% MDR QRIS UMI + Kode Unik Otomatis)"
            }
        })),
    ))
}

#[derive(Debug, Deserialize)]
pub struct CheckStatusQuery {
    pub month: Option<i32>,
    pub year: Option<i32>,
}

pub async fn check_status(
    State(state): State<AppState>,
    AuthUser(auth_user): AuthUser,
    Query(query): Query<CheckStatusQuery>,
) -> AppResult<Response> {
    let cache_key = format!("payments:check:{}", auth_user.id);
    if query.month.is_none() && query.year.is_none() {
        if let Some((status, body)) = state.cache.get(&cache_key) {
            return Ok(MemoryCache::hit_response(status, body));
        }
    }

    let (cur_m, cur_y) = get_jakarta_month_year();
    let current_month = query.month.unwrap_or(cur_m);
    let current_year = query.year.unwrap_or(cur_y);

    let q_pay = format!(
        "SELECT {} FROM payments WHERE user_id = ? AND month = ? AND year = ? ORDER BY id DESC LIMIT 1",
        PAYMENT_COLS
    );
    let payment = sqlx::query_as::<_, PaymentRow>(&q_pay)
        .bind(auth_user.id)
        .bind(current_month)
        .bind(current_year)
        .fetch_optional(&state.pool)
        .await
        .map_err(|e| AppError::internal("Terjadi kesalahan saat mengecek status kas.", e))?;

    let is_exempt = is_kas_exempt(&auth_user);
    let has_paid = is_exempt
        || payment
            .as_ref()
            .map(|p| p.status == "lunas")
            .unwrap_or(false);

    let body = json!({
        "status": "success",
        "data": {
            "hasPaid": has_paid,
            "month": current_month,
            "year": current_year,
            "payment": payment.map(|p| p.to_json())
        }
    });

    if query.month.is_none() && query.year.is_none() {
        Ok(state.cache.miss_response(cache_key, StatusCode::OK, body, 5))
    } else {
        Ok(MemoryCache::hit_response(StatusCode::OK, body))
    }
}

#[derive(Debug, Deserialize)]
pub struct HistoryQuery {
    pub page: Option<i64>,
    pub limit: Option<i64>,
}

pub async fn get_my_history(
    State(state): State<AppState>,
    AuthUser(auth_user): AuthUser,
    Query(query): Query<HistoryQuery>,
) -> AppResult<(StatusCode, Json<Value>)> {
    let page = query.page.unwrap_or(1).max(1);
    let limit = query.limit.unwrap_or(10).clamp(1, 200);
    let offset = (page - 1) * limit;

    let (total,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM payments WHERE user_id = ?")
        .bind(auth_user.id)
        .fetch_one(&state.pool)
        .await
        .map_err(|e| AppError::internal("Terjadi kesalahan saat mengambil riwayat pembayaran.", e))?;

    let q_list = format!(
        "SELECT {} FROM payments WHERE user_id = ? ORDER BY year DESC, month DESC LIMIT ? OFFSET ?",
        PAYMENT_COLS
    );
    let rows = sqlx::query_as::<_, PaymentRow>(&q_list)
        .bind(auth_user.id)
        .bind(limit)
        .bind(offset)
        .fetch_all(&state.pool)
        .await
        .map_err(|e| AppError::internal("Terjadi kesalahan saat mengambil riwayat pembayaran.", e))?;

    let items: Vec<Value> = rows.iter().map(|p| p.to_json()).collect();
    let total_pages = (total + limit - 1) / limit;

    Ok((
        StatusCode::OK,
        Json(json!({
            "status": "success",
            "data": {
                "total": total,
                "page": page,
                "totalPages": total_pages,
                "items": items
            }
        })),
    ))
}

#[derive(Debug, Deserialize)]
pub struct ConfirmPaymentBody {
    pub status: Option<String>,
}

pub async fn confirm_payment(
    State(state): State<AppState>,
    AuthUser(auth_user): AuthUser,
    Path(id): Path<i32>,
    Json(body): Json<ConfirmPaymentBody>,
) -> AppResult<(StatusCode, Json<Value>)> {
    require_bendahara(&auth_user)?;

    let status = body.status.as_deref().unwrap_or("");
    if status != "lunas" && status != "ditolak" {
        return Err(AppError::bad_request(
            "Status verifikasi harus bernilai \"lunas\" atau \"ditolak\".",
        ));
    }

    let exists: Option<(i32,)> = sqlx::query_as("SELECT id FROM payments WHERE id = ?")
        .bind(id)
        .fetch_optional(&state.pool)
        .await
        .map_err(|e| AppError::internal("Terjadi kesalahan saat memverifikasi pembayaran.", e))?;

    if exists.is_none() {
        return Err(AppError::not_found("Data pembayaran tidak ditemukan."));
    }

    let now_jkt = now_jakarta_naive();
    let note = if status == "lunas" {
        format!(
            "Diverifikasi manual LUNAS oleh {} (Bendahara).",
            auth_user.nama_lengkap
        )
    } else {
        format!(
            "Ditolak oleh {} (Bendahara).",
            auth_user.nama_lengkap
        )
    };

    sqlx::query(
        "UPDATE payments SET status = ?, confirmed_by = ?, confirmed_at = ?, ai_notes = ? WHERE id = ?",
    )
    .bind(status)
    .bind(auth_user.id)
    .bind(now_jkt)
    .bind(&note)
    .bind(id)
    .execute(&state.pool)
    .await
    .map_err(|e| AppError::internal("Terjadi kesalahan saat memverifikasi pembayaran.", e))?;

    let q_one = format!("SELECT {} FROM payments WHERE id = ?", PAYMENT_COLS);
    let payment = sqlx::query_as::<_, PaymentRow>(&q_one)
        .bind(id)
        .fetch_one(&state.pool)
        .await
        .map_err(|e| AppError::internal("Terjadi kesalahan saat memverifikasi pembayaran.", e))?;

    state.cache.clear_pattern(Some("payments"));
    state.cache.clear_pattern(Some("dashboard:stats"));

    Ok((
        StatusCode::OK,
        Json(json!({
            "status": "success",
            "message": format!("Pembayaran kas berhasil diperbarui menjadi '{}'.", status),
            "data": payment.to_json()
        })),
    ))
}

#[derive(Debug, Deserialize)]
pub struct PaymentReportQuery {
    pub month: Option<i32>,
    pub year: Option<i32>,
    pub status: Option<String>,
}

#[derive(Debug, FromRow)]
struct PaymentJoinedRow {
    id: i32,
    user_id: i32,
    amount: f64,
    month: i32,
    year: i32,
    proof_path: Option<String>,
    status: String,
    confirmed_by: Option<i32>,
    confirmed_at: Option<NaiveDateTime>,
    ai_status: Option<String>,
    ai_notes: Option<String>,
    sender_name_detected: Option<String>,
    order_id: Option<String>,
    unique_code: Option<i32>,
    payable_amount: Option<i32>,
    expires_at: Option<NaiveDateTime>,
    payment_channel: Option<String>,
    created_at: Option<NaiveDateTime>,
    u_id: Option<i32>,
    u_username: Option<String>,
    u_nama: Option<String>,
    u_role: Option<String>,
    u_divisi: Option<String>,
    v_id: Option<i32>,
    v_nama: Option<String>,
}

pub async fn get_report(
    State(state): State<AppState>,
    AuthUser(auth_user): AuthUser,
    Query(query): Query<PaymentReportQuery>,
) -> AppResult<(StatusCode, Json<Value>)> {
    require_bendahara(&auth_user)?;

    let mut sql = String::from(
        "SELECT p.id, p.user_id, CAST(p.amount AS DOUBLE) AS amount, p.month, p.year, p.proof_path,
                p.status, p.confirmed_by, p.confirmed_at, p.ai_status, p.ai_notes, p.sender_name_detected,
                p.order_id, p.unique_code, p.payable_amount, p.expires_at, p.payment_channel, p.created_at,
                u.id AS u_id, u.username AS u_username, u.nama_lengkap AS u_nama, u.role AS u_role, u.divisi AS u_divisi,
                v.id AS v_id, v.nama_lengkap AS v_nama
         FROM payments p
         LEFT JOIN users u ON p.user_id = u.id
         LEFT JOIN users v ON p.confirmed_by = v.id
         WHERE 1=1",
    );

    if query.month.is_some() {
        sql.push_str(" AND p.month = ?");
    }
    if query.year.is_some() {
        sql.push_str(" AND p.year = ?");
    }
    let status_f = query.status.as_deref().filter(|s| !s.is_empty());
    if status_f.is_some() {
        sql.push_str(" AND p.status = ?");
    }
    sql.push_str(" ORDER BY p.year DESC, p.month DESC, p.created_at DESC");

    let mut q = sqlx::query_as::<_, PaymentJoinedRow>(&sql);
    if let Some(m) = query.month {
        q = q.bind(m);
    }
    if let Some(y) = query.year {
        q = q.bind(y);
    }
    if let Some(st) = status_f {
        q = q.bind(st);
    }

    let rows = q
        .fetch_all(&state.pool)
        .await
        .map_err(|e| AppError::internal("Terjadi kesalahan saat mengambil laporan pembayaran.", e))?;

    let items: Vec<Value> = rows
        .iter()
        .map(|p| {
            let user_obj = match p.u_id {
                Some(uid) => json!({
                    "id": uid,
                    "username": p.u_username,
                    "nama_lengkap": p.u_nama,
                    "role": p.u_role,
                    "divisi": p.u_divisi
                }),
                None => Value::Null,
            };
            let verifier_obj = match p.v_id {
                Some(vid) => json!({
                    "id": vid,
                    "nama_lengkap": p.v_nama
                }),
                None => Value::Null,
            };
            json!({
                "id": p.id,
                "user_id": p.user_id,
                "amount": p.amount,
                "month": p.month,
                "year": p.year,
                "proof_path": p.proof_path,
                "status": p.status,
                "confirmed_by": p.confirmed_by,
                "confirmed_at": format_opt_jakarta_dt(p.confirmed_at),
                "ai_status": p.ai_status,
                "ai_notes": p.ai_notes,
                "sender_name_detected": p.sender_name_detected,
                "order_id": p.order_id,
                "unique_code": p.unique_code,
                "payable_amount": p.payable_amount,
                "expires_at": format_opt_jakarta_dt(p.expires_at),
                "payment_channel": p.payment_channel,
                "created_at": format_opt_jakarta_dt(p.created_at),
                "user": user_obj,
                "verifier": verifier_obj
            })
        })
        .collect();

    Ok((
        StatusCode::OK,
        Json(json!({
            "status": "success",
            "data": {
                "total": items.len(),
                "items": items
            }
        })),
    ))
}

pub async fn get_total_kas(
    State(state): State<AppState>,
    AuthUser(_user): AuthUser,
) -> AppResult<Response> {
    let cache_key = "payments:total".to_string();
    if let Some((status, body)) = state.cache.get(&cache_key) {
        return Ok(MemoryCache::hit_response(status, body));
    }

    let (total_in,): (f64,) = sqlx::query_as(
        "SELECT CAST(COALESCE(SUM(amount), 0) AS DOUBLE) FROM payments WHERE status = 'lunas'",
    )
    .fetch_one(&state.pool)
    .await
    .map_err(|e| AppError::internal("Terjadi kesalahan saat mengambil total kas.", e))?;

    let (total_out,): (f64,) =
        sqlx::query_as("SELECT CAST(COALESCE(SUM(amount), 0) AS DOUBLE) FROM kas_expenses")
            .fetch_one(&state.pool)
            .await
            .map_err(|e| AppError::internal("Terjadi kesalahan saat mengambil total kas.", e))?;

    let total = total_in - total_out;
    let body = json!({
        "status": "success",
        "data": {
            "total": total
        }
    });

    Ok(state.cache.miss_response(cache_key, StatusCode::OK, body, 15))
}

pub async fn cleanup_old_payment_proofs(
    State(state): State<AppState>,
    AuthUser(auth_user): AuthUser,
) -> AppResult<(StatusCode, Json<Value>)> {
    require_bendahara(&auth_user)?;

    let (current_month, current_year) = get_jakarta_month_year();
    let proofs_dir = StdPath::new("public/uploads/proofs");

    let old_payments: Vec<(i32, Option<String>)> = sqlx::query_as(
        "SELECT id, proof_path FROM payments
         WHERE (year < ? OR (year = ? AND month < ?)) AND proof_path IS NOT NULL",
    )
    .bind(current_year)
    .bind(current_year)
    .bind(current_month)
    .fetch_all(&state.pool)
    .await
    .map_err(|e| AppError::internal("Gagal membersihkan bukti pembayaran lama.", e))?;

    let mut deleted_files_count: usize = 0;
    let mut updated_records_count: usize = 0;

    for (pid, proof_opt) in old_payments {
        if let Some(proof_path) = proof_opt {
            if let Some(fname) = StdPath::new(&proof_path).file_name() {
                let full_path = proofs_dir.join(fname);
                if full_path.exists() && tokio::fs::remove_file(&full_path).await.is_ok() {
                    deleted_files_count += 1;
                }
            }
            if sqlx::query("UPDATE payments SET proof_path = NULL WHERE id = ?")
                .bind(pid)
                .execute(&state.pool)
                .await
                .is_ok()
            {
                updated_records_count += 1;
            }
        }
    }

    if proofs_dir.exists() {
        let cutoff = SystemTime::now()
            .checked_sub(Duration::from_secs(30 * 24 * 3600))
            .unwrap_or(SystemTime::UNIX_EPOCH);
        if let Ok(mut rd) = tokio::fs::read_dir(proofs_dir).await {
            while let Ok(Some(entry)) = rd.next_entry().await {
                if let Ok(meta) = entry.metadata().await {
                    if let Ok(mtime) = meta.modified() {
                        if mtime < cutoff && tokio::fs::remove_file(entry.path()).await.is_ok() {
                            deleted_files_count += 1;
                        }
                    }
                }
            }
        }
    }

    state.cache.clear_pattern(Some("payments"));

    Ok((
        StatusCode::OK,
        Json(json!({
            "status": "success",
            "message": format!(
                "Pembersihan selesai: {} file bukti lama telah dihapus dari server. Data keuangan dan status lunas tetap tersimpan aman.",
                deleted_files_count
            ),
            "data": {
                "deletedFilesCount": deleted_files_count,
                "updatedRecordsCount": updated_records_count
            }
        })),
    ))
}
