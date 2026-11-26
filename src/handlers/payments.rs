use axum::{
    extract::{Multipart, Path, Query, State},
    http::StatusCode,
    response::Response,
    Json,
};
use chrono::NaiveDateTime;
use serde::Deserialize;
use serde_json::{json, Value};
use sqlx::FromRow;
use std::path::Path as StdPath;
use std::time::{Duration, SystemTime};

use crate::error::{AppError, AppResult};
use crate::middleware::auth::AuthUser;
use crate::middleware::cache::MemoryCache;
use crate::middleware::role_check::{is_bendahara_only, is_kas_exempt, require_bendahara};
use crate::models::PaymentRow;
use crate::services::ai_verification::verify_payment_proof;
use crate::state::AppState;
use crate::utils::date_helper::{
    format_idr, format_opt_jakarta_dt, get_jakarta_month_year, now_jakarta_naive,
};
use crate::utils::upload::{parse_multipart_upload, ALLOWED_GENERAL_MIMES, MAX_UPLOAD_SIZE};

const PAYMENT_COLS: &str = "id, user_id, CAST(amount AS DOUBLE) AS amount, month, year, proof_path, status, confirmed_by, confirmed_at, ai_status, ai_notes, sender_name_detected, created_at";

pub async fn submit_payment(
    State(state): State<AppState>,
    AuthUser(auth_user): AuthUser,
    multipart: Multipart,
) -> AppResult<(StatusCode, Json<Value>)> {
    let parsed = parse_multipart_upload(
        multipart,
        "public/uploads/proofs",
        Some("proof_file"),
        ALLOWED_GENERAL_MIMES,
        "Tipe file tidak diizinkan. Hanya PDF, PPT, MP4, JPEG, PNG, dan WebP.",
        MAX_UPLOAD_SIZE,
        1,
        None,
    )
    .await?;

    let month_str = parsed.fields.get("month").map(|s| s.trim()).unwrap_or("");
    let year_str = parsed.fields.get("year").map(|s| s.trim()).unwrap_or("");

    if month_str.is_empty() || year_str.is_empty() {
        return Err(AppError::bad_request(
            "Bulan (month) dan tahun (year) pembayaran wajib diisi.",
        ));
    }

    let month_num: i32 = month_str
        .parse()
        .map_err(|_| AppError::bad_request("Bulan harus bernilai antara 1 hingga 12."))?;
    let year_num: i32 = year_str
        .parse()
        .map_err(|_| AppError::bad_request("Tahun pembayaran tidak valid."))?;

    if !(1..=12).contains(&month_num) {
        return Err(AppError::bad_request(
            "Bulan harus bernilai antara 1 hingga 12.",
        ));
    }

    let user_id = auth_user.id;
    let q_existing = format!(
        "SELECT {} FROM payments WHERE user_id = ? AND month = ? AND year = ? LIMIT 1",
        PAYMENT_COLS
    );
    let mut existing = sqlx::query_as::<_, PaymentRow>(&q_existing)
        .bind(user_id)
        .bind(month_num)
        .bind(year_num)
        .fetch_optional(&state.pool)
        .await
        .map_err(|e| AppError::internal("Terjadi kesalahan saat mengajukan pembayaran kas.", e))?;

    // Auto-reject old pending record with no proof image
    if let Some(ref mut ex) = existing {
        let has_valid_proof = ex
            .proof_path
            .as_deref()
            .map(|p| p.starts_with("/uploads"))
            .unwrap_or(false);
        if ex.status == "pending" && !has_valid_proof {
            sqlx::query(
                "UPDATE payments SET status = 'ditolak', ai_status = 'ditolak',
                 ai_notes = 'Ditolak otomatis: Tidak ada file gambar bukti pembayaran yang dilampirkan.'
                 WHERE id = ?",
            )
            .bind(ex.id)
            .execute(&state.pool)
            .await
            .ok();
            ex.status = "ditolak".to_string();
        }
    }

    if let Some(ref ex) = existing {
        if ex.status == "pending" || ex.status == "lunas" {
            return Err(AppError::with_code(
                StatusCode::CONFLICT,
                format!(
                    "Anda sudah mengajukan atau melunasi kas untuk Bulan {} Tahun {} (Status: {}).",
                    month_num, year_num, ex.status
                ),
                "PAYMENT_ALREADY_EXISTS",
            ));
        }
    }

    let uploaded_file = parsed.files.into_iter().next();
    let proof_path = uploaded_file
        .as_ref()
        .map(|f| format!("/uploads/proofs/{}", f.filename));

    let mut status = "pending".to_string();
    let mut confirmed_by: Option<i32> = None;
    let mut confirmed_at: Option<NaiveDateTime> = None;
    let mut ai_status: Option<String> = None;
    let mut ai_notes: Option<String> = None;
    let mut sender_name_detected: Option<String> = None;
    let mut response_message = "Pengajuan pembayaran kas berhasil dikirim.".to_string();

    if uploaded_file.is_none() {
        status = "ditolak".to_string();
        ai_status = Some("ditolak".to_string());
        ai_notes =
            Some("Ditolak otomatis: Tidak ada file gambar bukti transfer yang dilampirkan.".to_string());
        confirmed_at = Some(now_jakarta_naive());
        confirmed_by = None;
        response_message = "PEMBAYARAN DITOLAK:\n\nAnda tidak melampirkan file gambar bukti transfer pembayaran kas. Pembayaran langsung ditolak.".to_string();
    } else if let Some(ref p_path) = proof_path {
        let ai_result = verify_payment_proof(
            &state.http_client,
            &state.config.gemini_api_key,
            p_path,
            &auth_user.nama_lengkap,
        )
        .await;

        ai_status = Some(ai_result.decision.clone());
        ai_notes = Some(ai_result.notes.clone());
        sender_name_detected = if ai_result.sender_name.is_empty() {
            None
        } else {
            Some(ai_result.sender_name.clone())
        };

        if ai_result.decision == "lunas" {
            status = "lunas".to_string();
            confirmed_at = Some(now_jakarta_naive());
            confirmed_by = None;
            response_message = format!(
                "PEMBAYARAN DIVERIFIKASI (LUNAS)!\n\nNominal Rp {} dan nama pengirim \"{}\" cocok dengan nama akun Anda. Gerbang presensi Anda kini terbuka.",
                format_idr(ai_result.amount),
                ai_result.sender_name
            );
        } else if ai_result.decision == "ditolak" {
            status = "ditolak".to_string();
            confirmed_at = Some(now_jakarta_naive());
            confirmed_by = None;
            response_message = format!(
                "PEMBAYARAN DITOLAK:\n\n{}\nSilakan periksa kembali dan unggah bukti transfer yang sesuai.",
                ai_result.notes
            );
        } else {
            status = "pending".to_string();
            response_message = format!(
                "Pembayaran kas berhasil dikirim!\n\nCatatan AI: {}",
                ai_result.notes
            );
        }
    }

    let payment_id: i32 = if let Some(ex) = existing.filter(|e| e.status == "ditolak") {
        let final_proof = proof_path.or(ex.proof_path);
        sqlx::query(
            "UPDATE payments
             SET amount = 10000, proof_path = ?, status = ?, confirmed_by = ?, confirmed_at = ?,
                 ai_status = ?, ai_notes = ?, sender_name_detected = ?
             WHERE id = ?",
        )
        .bind(&final_proof)
        .bind(&status)
        .bind(confirmed_by)
        .bind(confirmed_at)
        .bind(&ai_status)
        .bind(&ai_notes)
        .bind(&sender_name_detected)
        .bind(ex.id)
        .execute(&state.pool)
        .await
        .map_err(|e| AppError::internal("Terjadi kesalahan saat mengajukan pembayaran kas.", e))?;
        ex.id
    } else {
        let now_jkt = now_jakarta_naive();
        let res = sqlx::query(
            "INSERT INTO payments (user_id, amount, month, year, proof_path, status, confirmed_by, confirmed_at, ai_status, ai_notes, sender_name_detected, created_at)
             VALUES (?, 10000, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(user_id)
        .bind(month_num)
        .bind(year_num)
        .bind(&proof_path)
        .bind(&status)
        .bind(confirmed_by)
        .bind(confirmed_at)
        .bind(&ai_status)
        .bind(&ai_notes)
        .bind(&sender_name_detected)
        .bind(now_jkt)
        .execute(&state.pool)
        .await
        .map_err(|e| AppError::internal("Terjadi kesalahan saat mengajukan pembayaran kas.", e))?;
        res.last_insert_id() as i32
    };

    let q_one = format!("SELECT {} FROM payments WHERE id = ?", PAYMENT_COLS);
    let payment = sqlx::query_as::<_, PaymentRow>(&q_one)
        .bind(payment_id)
        .fetch_one(&state.pool)
        .await
        .map_err(|e| AppError::internal("Terjadi kesalahan saat mengajukan pembayaran kas.", e))?;

    state.cache.clear_pattern(Some("payments"));
    state.cache.clear_pattern(Some("dashboard:stats"));

    Ok((
        StatusCode::CREATED,
        Json(json!({
            "status": "success",
            "message": response_message,
            "data": payment.to_json()
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

    // Auto-reject pending without proof
    let _ = sqlx::query(
        "UPDATE payments
         SET status = 'ditolak', ai_status = 'ditolak',
             ai_notes = 'Ditolak otomatis: Anggota tidak melampirkan file gambar bukti pembayaran.'
         WHERE user_id = ? AND month = ? AND year = ? AND status = 'pending'
           AND (proof_path IS NULL OR proof_path NOT LIKE '/uploads%')",
    )
    .bind(auth_user.id)
    .bind(current_month)
    .bind(current_year)
    .execute(&state.pool)
    .await;

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
        Ok(state.cache.miss_response(cache_key, StatusCode::OK, body, 10))
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
    let _ = sqlx::query(
        "UPDATE payments
         SET status = 'ditolak', ai_status = 'ditolak',
             ai_notes = 'Ditolak otomatis: Tidak ada file gambar bukti pembayaran yang dilampirkan.'
         WHERE user_id = ? AND status = 'pending'
           AND (proof_path IS NULL OR proof_path NOT LIKE '/uploads%')",
    )
    .bind(auth_user.id)
    .execute(&state.pool)
    .await;

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

    // Exact match to paymentController.js line 266: only pengurus with divisi bendahara
    if !is_bendahara_only(&auth_user) {
        return Err(AppError::forbidden(
            "Akses ditolak. Verifikasi lunas/ditolak uang kas hanya berhak dilakukan oleh Pengurus bagian Bendahara.",
        ));
    }

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
    sqlx::query("UPDATE payments SET status = ?, confirmed_by = ?, confirmed_at = ? WHERE id = ?")
        .bind(status)
        .bind(auth_user.id)
        .bind(now_jkt)
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

    let _ = sqlx::query(
        "UPDATE payments
         SET status = 'ditolak', ai_status = 'ditolak',
             ai_notes = 'Ditolak otomatis: Anggota tidak melampirkan file gambar bukti pembayaran.'
         WHERE status = 'pending' AND (proof_path IS NULL OR proof_path NOT LIKE '/uploads%')",
    )
    .execute(&state.pool)
    .await;

    let mut sql = String::from(
        "SELECT p.id, p.user_id, CAST(p.amount AS DOUBLE) AS amount, p.month, p.year, p.proof_path,
                p.status, p.confirmed_by, p.confirmed_at, p.ai_status, p.ai_notes, p.sender_name_detected, p.created_at,
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

pub async fn verify_payment_with_ai(
    State(state): State<AppState>,
    AuthUser(auth_user): AuthUser,
    Path(id): Path<i32>,
) -> AppResult<(StatusCode, Json<Value>)> {
    require_bendahara(&auth_user)?;

    let q_one = format!("SELECT {} FROM payments WHERE id = ?", PAYMENT_COLS);
    let payment = sqlx::query_as::<_, PaymentRow>(&q_one)
        .bind(id)
        .fetch_optional(&state.pool)
        .await
        .map_err(|e| AppError::internal("Gagal memproses verifikasi AI.", e))?;

    let Some(payment) = payment else {
        return Err(AppError::not_found("Data pembayaran kas tidak ditemukan."));
    };

    let Some(ref proof_path) = payment.proof_path.as_deref().filter(|p| p.starts_with("/uploads"))
    else {
        return Err(AppError::bad_request(
            "Pembayaran ini tidak memiliki file gambar bukti transfer yang dapat dianalisis AI.",
        ));
    };

    let user_name: String =
        sqlx::query_as::<_, (String,)>("SELECT nama_lengkap FROM users WHERE id = ?")
            .bind(payment.user_id)
            .fetch_optional(&state.pool)
            .await
            .ok()
            .flatten()
            .map(|(n,)| n)
            .unwrap_or_default();

    let ai_result = verify_payment_proof(
        &state.http_client,
        &state.config.gemini_api_key,
        proof_path,
        &user_name,
    )
    .await;

    let sender_opt = if ai_result.sender_name.is_empty() {
        None
    } else {
        Some(ai_result.sender_name.clone())
    };

    let (new_status, conf_at, conf_by) = if ai_result.decision == "lunas" {
        ("lunas", Some(now_jakarta_naive()), None::<i32>)
    } else if ai_result.decision == "ditolak" {
        ("ditolak", Some(now_jakarta_naive()), None::<i32>)
    } else {
        ("pending", payment.confirmed_at, payment.confirmed_by)
    };

    sqlx::query(
        "UPDATE payments
         SET status = ?, confirmed_at = ?, confirmed_by = ?, ai_status = ?, ai_notes = ?, sender_name_detected = ?
         WHERE id = ?",
    )
    .bind(new_status)
    .bind(conf_at)
    .bind(conf_by)
    .bind(&ai_result.decision)
    .bind(&ai_result.notes)
    .bind(&sender_opt)
    .bind(id)
    .execute(&state.pool)
    .await
    .map_err(|e| AppError::internal("Gagal memproses verifikasi AI.", e))?;

    let updated = sqlx::query_as::<_, PaymentRow>(&q_one)
        .bind(id)
        .fetch_one(&state.pool)
        .await
        .map_err(|e| AppError::internal("Gagal memproses verifikasi AI.", e))?;

    state.cache.clear_pattern(Some("payments"));
    state.cache.clear_pattern(Some("dashboard:stats"));

    Ok((
        StatusCode::OK,
        Json(json!({
            "status": "success",
            "message": format!("Hasil Verifikasi AI: {}", ai_result.notes),
            "data": {
                "payment": updated.to_json(),
                "aiResult": ai_result
            }
        })),
    ))
}

#[derive(Debug, FromRow)]
struct PendingPaymentAiRow {
    id: i32,
    proof_path: Option<String>,
    user_nama: Option<String>,
}

pub async fn verify_all_pending_with_ai(
    State(state): State<AppState>,
    AuthUser(auth_user): AuthUser,
) -> AppResult<(StatusCode, Json<Value>)> {
    require_bendahara(&auth_user)?;

    let pending = sqlx::query_as::<_, PendingPaymentAiRow>(
        "SELECT p.id, p.proof_path, u.nama_lengkap AS user_nama
         FROM payments p
         LEFT JOIN users u ON p.user_id = u.id
         WHERE p.status = 'pending'",
    )
    .fetch_all(&state.pool)
    .await
    .map_err(|e| AppError::internal("Gagal menjalankan pemindaian AI massal.", e))?;

    let eligible: Vec<PendingPaymentAiRow> = pending
        .into_iter()
        .filter(|p| {
            p.proof_path
                .as_deref()
                .map(|s| s.starts_with("/uploads"))
                .unwrap_or(false)
        })
        .collect();

    if eligible.is_empty() {
        return Ok((
            StatusCode::OK,
            Json(json!({
                "status": "success",
                "message": "Tidak ada pembayaran pending dengan lampiran gambar bukti transfer.",
                "data": { "total": 0, "approved": 0, "rejected": 0, "keptPending": 0 }
            })),
        ));
    }

    let mut approved = 0usize;
    let mut rejected = 0usize;
    let mut kept_pending = 0usize;
    let mut results: Vec<Value> = Vec::new();
    let total = eligible.len();

    for p in eligible {
        let proof = p.proof_path.as_deref().unwrap_or("");
        let user_name = p.user_nama.as_deref().unwrap_or("");
        let ai_result = verify_payment_proof(
            &state.http_client,
            &state.config.gemini_api_key,
            proof,
            user_name,
        )
        .await;

        let sender_opt = if ai_result.sender_name.is_empty() {
            None
        } else {
            Some(ai_result.sender_name.clone())
        };

        let (new_status, conf_at) = if ai_result.decision == "lunas" {
            approved += 1;
            ("lunas", Some(now_jakarta_naive()))
        } else if ai_result.decision == "ditolak" {
            rejected += 1;
            ("ditolak", Some(now_jakarta_naive()))
        } else {
            kept_pending += 1;
            ("pending", None)
        };

        let update_res = if conf_at.is_some() {
            sqlx::query(
                "UPDATE payments SET status = ?, confirmed_at = ?, confirmed_by = NULL, ai_status = ?, ai_notes = ?, sender_name_detected = ? WHERE id = ?",
            )
            .bind(new_status)
            .bind(conf_at)
            .bind(&ai_result.decision)
            .bind(&ai_result.notes)
            .bind(&sender_opt)
            .bind(p.id)
            .execute(&state.pool)
            .await
        } else {
            sqlx::query(
                "UPDATE payments SET status = 'pending', ai_status = ?, ai_notes = ?, sender_name_detected = ? WHERE id = ?",
            )
            .bind(&ai_result.decision)
            .bind(&ai_result.notes)
            .bind(&sender_opt)
            .bind(p.id)
            .execute(&state.pool)
            .await
        };

        if let Err(e) = update_res {
            results.push(json!({ "id": p.id, "error": e.to_string() }));
        } else {
            results.push(json!({
                "id": p.id,
                "user": user_name,
                "decision": ai_result.decision,
                "notes": ai_result.notes
            }));
        }
    }

    state.cache.clear_pattern(Some("payments"));
    state.cache.clear_pattern(Some("dashboard:stats"));

    Ok((
        StatusCode::OK,
        Json(json!({
            "status": "success",
            "message": format!(
                "Pemindaian AI selesai: {} Lunas (disetujui), {} ditolak, {} tetap pending untuk verifikasi manual Bendahara.",
                approved, rejected, kept_pending
            ),
            "data": {
                "total": total,
                "approved": approved,
                "rejected": rejected,
                "keptPending": kept_pending,
                "details": results
            }
        })),
    ))
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

    // Remove orphan files older than 30 days
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
                "Pembersihan selesai: {} file screenshot bukti pembayaran bulan lalu telah dihapus dari server. Data keuangan dan status lunas tetap tersimpan aman.",
                deleted_files_count
            ),
            "data": {
                "deletedFilesCount": deleted_files_count,
                "updatedRecordsCount": updated_records_count
            }
        })),
    ))
}
