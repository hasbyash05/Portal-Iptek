use axum::{
    extract::State,
    http::StatusCode,
    response::Response,
    Json,
};
use chrono::{NaiveDate, NaiveDateTime};
use serde::Deserialize;
use serde_json::{json, Value};
use sqlx::FromRow;
use std::collections::HashSet;

use crate::error::{AppError, AppResult};
use crate::middleware::auth::AuthUser;
use crate::middleware::cache::MemoryCache;
use crate::middleware::role_check::{require_ketua, require_ketua_wakil};
use crate::models::AttendanceSessionRow;
use crate::state::AppState;
use crate::utils::date_helper::{
    format_opt_jakarta_dt, naive_dt_to_jakarta_date_string, now_jakarta_naive,
};

pub async fn open_session(
    State(state): State<AppState>,
    AuthUser(auth_user): AuthUser,
) -> AppResult<(StatusCode, Json<Value>)> {
    require_ketua_wakil(&auth_user)?;

    let existing = sqlx::query_as::<_, AttendanceSessionRow>(
        "SELECT id, is_active, activated_by, activated_at, attendance_mode
         FROM attendance_sessions
         WHERE is_active = 1
         LIMIT 1",
    )
    .fetch_optional(&state.pool)
    .await
    .map_err(|_| {
        AppError::new(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Terjadi kesalahan saat membuka sesi presensi.",
        )
    })?;

    if let Some(ex) = existing {
        let activator_name = if let Some(aid) = ex.activated_by {
            sqlx::query_as::<_, (String,)>("SELECT nama_lengkap FROM users WHERE id = ?")
                .bind(aid)
                .fetch_optional(&state.pool)
                .await
                .ok()
                .flatten()
                .map(|(n,)| n)
                .unwrap_or_else(|| "Pengurus".to_string())
        } else {
            "Pengurus".to_string()
        };

        return Err(AppError::with_code(
            StatusCode::CONFLICT,
            format!(
                "Sesi presensi sudah aktif (dibuka oleh {}).",
                activator_name
            ),
            "SESSION_ALREADY_ACTIVE",
        ));
    }

    let now_jkt = now_jakarta_naive();
    let res = sqlx::query(
        "INSERT INTO attendance_sessions (is_active, activated_by, activated_at, attendance_mode)
         VALUES (1, ?, ?, 'onsite')",
    )
    .bind(auth_user.id)
    .bind(now_jkt)
    .execute(&state.pool)
    .await
    .map_err(|_| {
        AppError::new(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Terjadi kesalahan saat membuka sesi presensi.",
        )
    })?;

    let new_id = res.last_insert_id() as i32;
    let session = sqlx::query_as::<_, AttendanceSessionRow>(
        "SELECT id, is_active, activated_by, activated_at, attendance_mode
         FROM attendance_sessions WHERE id = ?",
    )
    .bind(new_id)
    .fetch_one(&state.pool)
    .await
    .map_err(|_| {
        AppError::new(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Terjadi kesalahan saat membuka sesi presensi.",
        )
    })?;

    state.cache.clear_pattern(Some("attendance:session"));

    Ok((
        StatusCode::CREATED,
        Json(json!({
            "status": "success",
            "message": "Sesi presensi berhasil dibuka. Anggota sekarang dapat melakukan absensi.",
            "data": session.to_json()
        })),
    ))
}

pub async fn close_session(
    State(state): State<AppState>,
    AuthUser(auth_user): AuthUser,
) -> AppResult<(StatusCode, Json<Value>)> {
    require_ketua_wakil(&auth_user)?;

    let existing = sqlx::query_as::<_, AttendanceSessionRow>(
        "SELECT id, is_active, activated_by, activated_at, attendance_mode
         FROM attendance_sessions
         WHERE is_active = 1
         LIMIT 1",
    )
    .fetch_optional(&state.pool)
    .await
    .map_err(|_| {
        AppError::new(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Terjadi kesalahan saat menutup sesi presensi.",
        )
    })?;

    let Some(mut session) = existing else {
        return Err(AppError::with_code(
            StatusCode::BAD_REQUEST,
            "Tidak ada sesi presensi yang sedang aktif.",
            "NO_ACTIVE_SESSION",
        ));
    };

    sqlx::query("UPDATE attendance_sessions SET is_active = 0 WHERE id = ?")
        .bind(session.id)
        .execute(&state.pool)
        .await
        .map_err(|_| {
            AppError::new(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Terjadi kesalahan saat menutup sesi presensi.",
            )
        })?;

    session.is_active = false;
    state.cache.clear_pattern(Some("attendance:session"));

    Ok((
        StatusCode::OK,
        Json(json!({
            "status": "success",
            "message": "Sesi presensi berhasil ditutup. Anggota tidak dapat melakukan absensi sampai sesi dibuka kembali.",
            "data": session.to_json()
        })),
    ))
}

#[derive(Debug, Deserialize)]
pub struct SetModeBody {
    pub mode: Option<String>,
}

pub async fn set_attendance_mode(
    State(state): State<AppState>,
    AuthUser(auth_user): AuthUser,
    Json(body): Json<SetModeBody>,
) -> AppResult<(StatusCode, Json<Value>)> {
    require_ketua(&auth_user)?;

    let mode = body.mode.as_deref().unwrap_or("");
    if mode != "onsite" && mode != "anywhere" {
        return Err(AppError::bad_request(
            "Mode tidak valid. Pilihan: onsite (di tempat) atau anywhere (dimana saja).",
        ));
    }

    let existing: Option<(i32,)> =
        sqlx::query_as("SELECT id FROM attendance_sessions WHERE is_active = 1 LIMIT 1")
            .fetch_optional(&state.pool)
            .await
            .map_err(|_| {
                AppError::new(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "Terjadi kesalahan saat mengubah mode presensi.",
                )
            })?;

    let Some((session_id,)) = existing else {
        return Err(AppError::with_code(
            StatusCode::BAD_REQUEST,
            "Tidak ada sesi presensi yang sedang aktif. Buka sesi terlebih dahulu sebelum mengubah mode.",
            "NO_ACTIVE_SESSION",
        ));
    };

    if let Err(_) =
        sqlx::query("UPDATE attendance_sessions SET attendance_mode = ? WHERE id = ?")
            .bind(mode)
            .bind(session_id)
            .execute(&state.pool)
            .await
    {
        let _ = sqlx::query(
            "ALTER TABLE `attendance_sessions` ADD COLUMN `attendance_mode` ENUM('onsite','anywhere') NOT NULL DEFAULT 'onsite'",
        )
        .execute(&state.pool)
        .await;
        sqlx::query("UPDATE attendance_sessions SET attendance_mode = ? WHERE id = ?")
            .bind(mode)
            .bind(session_id)
            .execute(&state.pool)
            .await
            .map_err(|_| {
                AppError::new(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "Terjadi kesalahan saat mengubah mode presensi.",
                )
            })?;
    }

    state.cache.clear_pattern(Some("attendance:session"));

    let mode_label = if mode == "onsite" {
        "Di Tempat (GPS 100m)"
    } else {
        "Dimana Saja"
    };

    Ok((
        StatusCode::OK,
        Json(json!({
            "status": "success",
            "message": format!("Mode presensi berhasil diubah ke: {}.", mode_label),
            "data": { "attendance_mode": mode }
        })),
    ))
}

#[derive(Debug, FromRow)]
struct SessionWithActivatorRow {
    id: i32,
    is_active: bool,
    activated_by: Option<i32>,
    activated_at: Option<NaiveDateTime>,
    attendance_mode: String,
    act_id: Option<i32>,
    act_nama: Option<String>,
    act_divisi: Option<String>,
}

pub async fn get_session_status(
    State(state): State<AppState>,
    AuthUser(_user): AuthUser,
) -> AppResult<Response> {
    let cache_key = "attendance:session:status".to_string();
    if let Some((status, body)) = state.cache.get(&cache_key) {
        return Ok(MemoryCache::hit_response(status, body));
    }

    let row = sqlx::query_as::<_, SessionWithActivatorRow>(
        "SELECT s.id, s.is_active, s.activated_by, s.activated_at, s.attendance_mode,
                u.id AS act_id, u.nama_lengkap AS act_nama, u.divisi AS act_divisi
         FROM attendance_sessions s
         LEFT JOIN users u ON s.activated_by = u.id
         WHERE s.is_active = 1
         LIMIT 1",
    )
    .fetch_optional(&state.pool)
    .await
    .map_err(|_| {
        AppError::new(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Terjadi kesalahan saat mengecek status sesi presensi.",
        )
    })?;

    let (is_active, attendance_mode, session_val) = match row {
        Some(s) => {
            let activator = match s.act_id {
                Some(aid) => json!({
                    "id": aid,
                    "nama_lengkap": s.act_nama,
                    "divisi": s.act_divisi
                }),
                None => Value::Null,
            };
            let mode = if s.attendance_mode.is_empty() {
                "onsite".to_string()
            } else {
                s.attendance_mode.clone()
            };
            let s_json = json!({
                "id": s.id,
                "is_active": s.is_active,
                "activated_by": s.activated_by,
                "activated_at": format_opt_jakarta_dt(s.activated_at),
                "attendance_mode": mode,
                "activator": activator
            });
            (true, mode, s_json)
        }
        None => (false, "onsite".to_string(), Value::Null),
    };

    let body = json!({
        "status": "success",
        "data": {
            "is_active": is_active,
            "attendance_mode": attendance_mode,
            "session": session_val
        }
    });

    Ok(state.cache.miss_response(cache_key, StatusCode::OK, body, 10))
}

pub async fn cleanup_duplicate_sessions(
    State(state): State<AppState>,
    AuthUser(auth_user): AuthUser,
) -> AppResult<(StatusCode, Json<Value>)> {
    require_ketua_wakil(&auth_user)?;

    let att_dates: Vec<(NaiveDate,)> =
        sqlx::query_as("SELECT DISTINCT `date` FROM `attendances`")
            .fetch_all(&state.pool)
            .await
            .map_err(|e| AppError::internal("Gagal membersihkan sesi presensi.", e))?;
    let valid_dates: HashSet<String> = att_dates
        .into_iter()
        .map(|(d,)| d.format("%Y-%m-%d").to_string())
        .collect();

    let all_sessions = sqlx::query_as::<_, AttendanceSessionRow>(
        "SELECT id, is_active, activated_by, activated_at, attendance_mode FROM attendance_sessions ORDER BY id ASC",
    )
    .fetch_all(&state.pool)
    .await
    .map_err(|e| AppError::internal("Gagal membersihkan sesi presensi.", e))?;

    let mut kept_ids: HashSet<i32> = HashSet::new();
    let mut covered_dates: HashSet<String> = HashSet::new();

    for s in &all_sessions {
        if s.is_active {
            kept_ids.insert(s.id);
            continue;
        }
        if let Some(dt) = s.activated_at {
            let s_date = naive_dt_to_jakarta_date_string(dt);
            if valid_dates.contains(&s_date) && !covered_dates.contains(&s_date) {
                kept_ids.insert(s.id);
                covered_dates.insert(s_date);
            }
        }
    }

    for v_date in &valid_dates {
        if !covered_dates.contains(v_date) {
            let dt_str = format!("{} 09:00:00", v_date);
            let res = sqlx::query(
                "INSERT INTO attendance_sessions (is_active, activated_by, activated_at, attendance_mode) VALUES (0, NULL, ?, 'onsite')",
            )
            .bind(&dt_str)
            .execute(&state.pool)
            .await
            .map_err(|e| AppError::internal("Gagal membersihkan sesi presensi.", e))?;
            kept_ids.insert(res.last_insert_id() as i32);
            covered_dates.insert(v_date.clone());
        }
    }

    let mut deleted_count: u64 = 0;
    if !kept_ids.is_empty() && all_sessions.len() > kept_ids.len() {
        let ids_csv = kept_ids
            .iter()
            .map(|id| id.to_string())
            .collect::<Vec<_>>()
            .join(",");
        let sql = format!(
            "DELETE FROM attendance_sessions WHERE id NOT IN ({})",
            ids_csv
        );
        let res = sqlx::query(&sql)
            .execute(&state.pool)
            .await
            .map_err(|e| AppError::internal("Gagal membersihkan sesi presensi.", e))?;
        deleted_count = res.rows_affected();
    }

    state.cache.clear_pattern(None);

    let remaining = sqlx::query_as::<_, AttendanceSessionRow>(
        "SELECT id, is_active, activated_by, activated_at, attendance_mode FROM attendance_sessions",
    )
    .fetch_all(&state.pool)
    .await
    .map_err(|e| AppError::internal("Gagal membersihkan sesi presensi.", e))?;

    let remaining_json: Vec<Value> = remaining.iter().map(|s| s.to_json()).collect();

    Ok((
        StatusCode::OK,
        Json(json!({
            "status": "success",
            "message": format!(
                "Pembersihan berhasil. {} sesi duplikat/sampah dihapus, tersisa {} sesi pertemuan resmi.",
                deleted_count,
                remaining_json.len()
            ),
            "data": {
                "deletedCount": deleted_count,
                "remainingCount": remaining_json.len(),
                "remainingSessions": remaining_json
            }
        })),
    ))
}
