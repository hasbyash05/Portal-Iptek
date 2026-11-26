use axum::{
    extract::{Query, State},
    http::{header, HeaderValue, StatusCode},
    response::{IntoResponse, Response},
};
use chrono::{NaiveDate, NaiveDateTime};
use serde::Deserialize;
use serde_json::{json, Value};
use sqlx::FromRow;

use crate::error::{AppError, AppResult};
use crate::middleware::auth::AuthUser;
use crate::middleware::cache::MemoryCache;
use crate::middleware::role_check::require_pengurus;
use crate::state::AppState;
use crate::utils::date_helper::{
    format_naive_date, format_opt_jakarta_dt, get_jakarta_month_year,
};
use crate::utils::ppt_generator::{generate_attendance_ppt, AttendanceChartRow};

#[derive(Debug, FromRow)]
struct AttendanceCountRow {
    date: NaiveDate,
    count: i64,
}

#[derive(Debug, FromRow)]
struct PaymentChartRow {
    month: i32,
    year: i32,
    total_amount: f64,
    total_transactions: i64,
}

#[derive(Debug, FromRow)]
struct RecentReportRow {
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
}

pub async fn get_dashboard_stats(
    State(state): State<AppState>,
    AuthUser(auth_user): AuthUser,
) -> AppResult<Response> {
    require_pengurus(&auth_user)?;

    let cache_key = "dashboard:stats".to_string();
    if let Some((status, body)) = state.cache.get(&cache_key) {
        return Ok(MemoryCache::hit_response(status, body));
    }

    let (total_members,): (i64,) =
        sqlx::query_as("SELECT COUNT(*) FROM users WHERE role = 'anggota'")
            .fetch_one(&state.pool)
            .await
            .map_err(|e| AppError::internal("Terjadi kesalahan saat mengambil statistik dashboard.", e))?;

    let (total_pengurus,): (i64,) =
        sqlx::query_as("SELECT COUNT(*) FROM users WHERE role = 'pengurus'")
            .fetch_one(&state.pool)
            .await
            .map_err(|e| AppError::internal("Terjadi kesalahan saat mengambil statistik dashboard.", e))?;

    let (current_month, current_year) = get_jakarta_month_year();

    let (kas_lunas_bulan_ini,): (i64,) = sqlx::query_as(
        "SELECT COUNT(*) FROM payments WHERE status = 'lunas' AND month = ? AND year = ?",
    )
    .bind(current_month)
    .bind(current_year)
    .fetch_one(&state.pool)
    .await
    .map_err(|e| AppError::internal("Terjadi kesalahan saat mengambil statistik dashboard.", e))?;

    let (pending_payments,): (i64,) =
        sqlx::query_as("SELECT COUNT(*) FROM payments WHERE status = 'pending'")
            .fetch_one(&state.pool)
            .await
            .map_err(|e| AppError::internal("Terjadi kesalahan saat mengambil statistik dashboard.", e))?;

    let (total_kas_masuk,): (f64,) = sqlx::query_as(
        "SELECT CAST(COALESCE(SUM(amount), 0) AS DOUBLE) FROM payments WHERE status = 'lunas'",
    )
    .fetch_one(&state.pool)
    .await
    .map_err(|e| AppError::internal("Terjadi kesalahan saat mengambil statistik dashboard.", e))?;

    let (total_kas_keluar,): (f64,) =
        sqlx::query_as("SELECT CAST(COALESCE(SUM(amount), 0) AS DOUBLE) FROM kas_expenses")
            .fetch_one(&state.pool)
            .await
            .map_err(|e| AppError::internal("Terjadi kesalahan saat mengambil statistik dashboard.", e))?;

    let total_kas_terkumpul = total_kas_masuk - total_kas_keluar;

    let att_rows = sqlx::query_as::<_, AttendanceCountRow>(
        "SELECT date, COUNT(id) AS count
         FROM attendances
         WHERE status = 'hadir'
         GROUP BY date
         ORDER BY date DESC
         LIMIT 8",
    )
    .fetch_all(&state.pool)
    .await
    .map_err(|e| AppError::internal("Terjadi kesalahan saat mengambil statistik dashboard.", e))?;

    let attendance_chart: Vec<Value> = att_rows
        .iter()
        .map(|r| json!({ "date": format_naive_date(r.date), "count": r.count }))
        .collect();

    let pay_rows = sqlx::query_as::<_, PaymentChartRow>(
        "SELECT month, year, CAST(COALESCE(SUM(amount), 0) AS DOUBLE) AS total_amount, COUNT(id) AS total_transactions
         FROM payments
         WHERE status = 'lunas'
         GROUP BY month, year
         ORDER BY year DESC, month DESC
         LIMIT 6",
    )
    .fetch_all(&state.pool)
    .await
    .map_err(|e| AppError::internal("Terjadi kesalahan saat mengambil statistik dashboard.", e))?;

    let payment_chart: Vec<Value> = pay_rows
        .iter()
        .map(|r| {
            json!({
                "month": r.month,
                "year": r.year,
                "total_amount": r.total_amount,
                "total_transactions": r.total_transactions
            })
        })
        .collect();

    let report_rows = sqlx::query_as::<_, RecentReportRow>(
        "SELECT r.id, r.user_id, r.week_number, r.year, r.activity, r.attachment_path, r.submitted_at,
                u.id AS u_id, u.nama_lengkap AS u_nama, u.divisi AS u_divisi
         FROM weekly_reports r
         LEFT JOIN users u ON r.user_id = u.id
         ORDER BY r.submitted_at DESC
         LIMIT 5",
    )
    .fetch_all(&state.pool)
    .await
    .map_err(|e| AppError::internal("Terjadi kesalahan saat mengambil statistik dashboard.", e))?;

    let recent_reports: Vec<Value> = report_rows
        .iter()
        .map(|r| {
            let user_obj = match r.u_id {
                Some(uid) => json!({ "id": uid, "nama_lengkap": r.u_nama, "divisi": r.u_divisi }),
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

    let body = json!({
        "status": "success",
        "data": {
            "overview": {
                "totalMembers": total_members,
                "totalPengurus": total_pengurus,
                "pendingPayments": pending_payments,
                "kasLunasBulanIni": kas_lunas_bulan_ini,
                "totalKasTerkumpul": total_kas_terkumpul
            },
            "attendanceChart": attendance_chart,
            "paymentChart": payment_chart,
            "recentReports": recent_reports
        }
    });

    Ok(state.cache.miss_response(cache_key, StatusCode::OK, body, 15))
}

#[derive(Debug, Deserialize)]
pub struct ExportPptQuery {
    pub month: Option<i32>,
    pub year: Option<i32>,
}

pub async fn export_ppt(
    State(state): State<AppState>,
    AuthUser(auth_user): AuthUser,
    Query(query): Query<ExportPptQuery>,
) -> AppResult<Response> {
    require_pengurus(&auth_user)?;

    let (cur_m, cur_y) = get_jakarta_month_year();
    let month = query.month.unwrap_or(cur_m);
    let year = query.year.unwrap_or(cur_y);

    let rows = sqlx::query_as::<_, AttendanceCountRow>(
        "SELECT date, COUNT(id) AS count
         FROM attendances
         WHERE status = 'hadir'
         GROUP BY date
         ORDER BY date ASC",
    )
    .fetch_all(&state.pool)
    .await
    .map_err(|e| AppError::internal("Terjadi kesalahan saat mengunduh file presentasi PPT.", e))?;

    let chart_rows: Vec<AttendanceChartRow> = rows
        .into_iter()
        .map(|r| AttendanceChartRow {
            date: format_naive_date(r.date),
            count: r.count,
        })
        .collect();

    let period_label = format!("Bulan {} Tahun {}", month, year);
    let ppt_bytes = generate_attendance_ppt(&chart_rows, &period_label)
        .map_err(|e| AppError::internal("Terjadi kesalahan saat mengunduh file presentasi PPT.", e))?;

    let mut resp = (StatusCode::OK, ppt_bytes).into_response();
    resp.headers_mut().insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static(
            "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        ),
    );
    if let Ok(cd) = HeaderValue::from_str(&format!(
        "attachment; filename=\"Laporan-Iptek-{}-{}.pptx\"",
        month, year
    )) {
        resp.headers_mut().insert(header::CONTENT_DISPOSITION, cd);
    }
    Ok(resp)
}
