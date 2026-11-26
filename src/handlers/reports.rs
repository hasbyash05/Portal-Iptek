use axum::{
    extract::{Multipart, Query, State},
    http::StatusCode,
    Json,
};
use chrono::NaiveDateTime;
use serde::Deserialize;
use serde_json::{json, Value};
use sqlx::FromRow;

use crate::error::{AppError, AppResult};
use crate::middleware::auth::AuthUser;
use crate::middleware::role_check::require_pengurus;
use crate::models::WeeklyReportRow;
use crate::state::AppState;
use crate::utils::date_helper::{
    format_opt_jakarta_dt, get_iso_week_number, now_jakarta_naive,
};
use crate::utils::upload::{parse_multipart_upload, ALLOWED_GENERAL_MIMES, MAX_UPLOAD_SIZE};

pub async fn submit_report(
    State(state): State<AppState>,
    AuthUser(auth_user): AuthUser,
    multipart: Multipart,
) -> AppResult<(StatusCode, Json<Value>)> {
    require_pengurus(&auth_user)?;

    let parsed = parse_multipart_upload(
        multipart,
        "public/uploads/reports",
        Some("attachment"),
        ALLOWED_GENERAL_MIMES,
        "Tipe file tidak diizinkan. Hanya PDF, PPT, MP4, JPEG, PNG, dan WebP.",
        MAX_UPLOAD_SIZE,
        1,
        None,
    )
    .await?;

    let activity = parsed
        .fields
        .get("activity")
        .map(|s| s.trim().to_string())
        .unwrap_or_default();

    if activity.is_empty() {
        return Err(AppError::bad_request("Aktivitas kegiatan wajib diisi."));
    }

    let (week_number, year) = get_iso_week_number();
    let user_id = auth_user.id;

    let existing: Option<(i32,)> = sqlx::query_as(
        "SELECT id FROM weekly_reports WHERE user_id = ? AND week_number = ? AND year = ? LIMIT 1",
    )
    .bind(user_id)
    .bind(week_number)
    .bind(year)
    .fetch_optional(&state.pool)
    .await
    .map_err(|e| AppError::internal("Terjadi kesalahan saat menyimpan laporan mingguan.", e))?;

    if existing.is_some() {
        return Err(AppError::with_code(
            StatusCode::CONFLICT,
            format!(
                "Anda sudah melapor kegiatan untuk Minggu ke-{} tahun {}.",
                week_number, year
            ),
            "REPORT_ALREADY_SUBMITTED",
        ));
    }

    let attachment_path = parsed
        .files
        .into_iter()
        .next()
        .map(|f| format!("/uploads/reports/{}", f.filename));

    let now_jkt = now_jakarta_naive();
    let res = sqlx::query(
        "INSERT INTO weekly_reports (user_id, week_number, year, activity, attachment_path, submitted_at)
         VALUES (?, ?, ?, ?, ?, ?)",
    )
    .bind(user_id)
    .bind(week_number)
    .bind(year)
    .bind(&activity)
    .bind(&attachment_path)
    .bind(now_jkt)
    .execute(&state.pool)
    .await
    .map_err(|e| AppError::internal("Terjadi kesalahan saat menyimpan laporan mingguan.", e))?;

    let new_id = res.last_insert_id() as i32;
    let report = sqlx::query_as::<_, WeeklyReportRow>(
        "SELECT id, user_id, week_number, year, activity, attachment_path, submitted_at FROM weekly_reports WHERE id = ?",
    )
    .bind(new_id)
    .fetch_one(&state.pool)
    .await
    .map_err(|e| AppError::internal("Terjadi kesalahan saat menyimpan laporan mingguan.", e))?;

    Ok((
        StatusCode::CREATED,
        Json(json!({
            "status": "success",
            "message": "Laporan mingguan berhasil disimpan.",
            "data": report.to_json()
        })),
    ))
}

pub async fn check_status(
    State(state): State<AppState>,
    AuthUser(auth_user): AuthUser,
) -> AppResult<(StatusCode, Json<Value>)> {
    require_pengurus(&auth_user)?;

    let (week_number, year) = get_iso_week_number();
    let report = sqlx::query_as::<_, WeeklyReportRow>(
        "SELECT id, user_id, week_number, year, activity, attachment_path, submitted_at
         FROM weekly_reports
         WHERE user_id = ? AND week_number = ? AND year = ?
         LIMIT 1",
    )
    .bind(auth_user.id)
    .bind(week_number)
    .bind(year)
    .fetch_optional(&state.pool)
    .await
    .map_err(|e| AppError::internal("Terjadi kesalahan saat memeriksa status laporan.", e))?;

    Ok((
        StatusCode::OK,
        Json(json!({
            "status": "success",
            "data": {
                "hasReported": report.is_some(),
                "currentWeek": week_number,
                "currentYear": year,
                "reportDetails": report.map(|r| r.to_json())
            }
        })),
    ))
}

#[derive(Debug, Deserialize)]
pub struct PaginationQuery {
    pub page: Option<i64>,
    pub limit: Option<i64>,
}

#[derive(Debug, FromRow)]
struct ReportWithUserRow {
    id: i32,
    user_id: i32,
    week_number: i32,
    year: i32,
    activity: String,
    attachment_path: Option<String>,
    submitted_at: Option<NaiveDateTime>,
    u_id: Option<i32>,
    u_nama: Option<String>,
    u_divisi: Option<String>,
    u_username: Option<String>,
}

pub async fn get_history(
    State(state): State<AppState>,
    AuthUser(auth_user): AuthUser,
    Query(query): Query<PaginationQuery>,
) -> AppResult<(StatusCode, Json<Value>)> {
    require_pengurus(&auth_user)?;

    let page = query.page.unwrap_or(1).max(1);
    let limit = query.limit.unwrap_or(10).clamp(1, 200);
    let offset = (page - 1) * limit;

    let see_all = auth_user.role == "pengurus" || auth_user.role == "admin";

    let total: i64 = if see_all {
        sqlx::query_as::<_, (i64,)>("SELECT COUNT(*) FROM weekly_reports")
            .fetch_one(&state.pool)
            .await
            .map_err(|e| AppError::internal("Terjadi kesalahan saat mengambil riwayat laporan.", e))?
            .0
    } else {
        sqlx::query_as::<_, (i64,)>("SELECT COUNT(*) FROM weekly_reports WHERE user_id = ?")
            .bind(auth_user.id)
            .fetch_one(&state.pool)
            .await
            .map_err(|e| AppError::internal("Terjadi kesalahan saat mengambil riwayat laporan.", e))?
            .0
    };

    let rows = if see_all {
        sqlx::query_as::<_, ReportWithUserRow>(
            "SELECT r.id, r.user_id, r.week_number, r.year, r.activity, r.attachment_path, r.submitted_at,
                    u.id AS u_id, u.nama_lengkap AS u_nama, u.divisi AS u_divisi, u.username AS u_username
             FROM weekly_reports r
             LEFT JOIN users u ON r.user_id = u.id
             ORDER BY r.year DESC, r.week_number DESC, r.submitted_at DESC
             LIMIT ? OFFSET ?",
        )
        .bind(limit)
        .bind(offset)
        .fetch_all(&state.pool)
        .await
    } else {
        sqlx::query_as::<_, ReportWithUserRow>(
            "SELECT r.id, r.user_id, r.week_number, r.year, r.activity, r.attachment_path, r.submitted_at,
                    u.id AS u_id, u.nama_lengkap AS u_nama, u.divisi AS u_divisi, u.username AS u_username
             FROM weekly_reports r
             LEFT JOIN users u ON r.user_id = u.id
             WHERE r.user_id = ?
             ORDER BY r.year DESC, r.week_number DESC, r.submitted_at DESC
             LIMIT ? OFFSET ?",
        )
        .bind(auth_user.id)
        .bind(limit)
        .bind(offset)
        .fetch_all(&state.pool)
        .await
    }
    .map_err(|e| AppError::internal("Terjadi kesalahan saat mengambil riwayat laporan.", e))?;

    let items: Vec<Value> = rows
        .iter()
        .map(|r| {
            let user_obj = match r.u_id {
                Some(uid) => json!({
                    "id": uid,
                    "nama_lengkap": r.u_nama,
                    "divisi": r.u_divisi,
                    "username": r.u_username
                }),
                None => Value::Null,
            };
            json!({
                "id": r.id,
                "user_id": r.user_id,
                "week_number": r.week_number,
                "year": r.year,
                "activity": r.activity,
                "attachment_path": r.attachment_path,
                "submitted_at": format_opt_jakarta_dt(r.submitted_at),
                "user": user_obj
            })
        })
        .collect();

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
