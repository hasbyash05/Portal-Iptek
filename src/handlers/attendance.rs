use axum::{
    extract::{Query, State},
    http::{header, HeaderValue, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use chrono::NaiveDate;
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::{BTreeSet, HashMap};

use crate::db::cleanup_garbage_sessions_internal;
use crate::error::{AppError, AppResult};
use crate::middleware::auth::AuthUser;
use crate::middleware::role_check::{is_kas_exempt, require_pengurus};
use crate::models::{de_opt_f64, AttendanceRow, AttendanceSessionRow, UserPublic};
use crate::state::AppState;
use crate::utils::date_helper::{
    format_naive_date, format_opt_jakarta_dt, get_jakarta_date_string, get_jakarta_month_year,
    naive_dt_to_jakarta_date_string, now_jakarta_naive,
};

#[derive(Debug, Deserialize)]
pub struct SubmitAttendanceBody {
    pub status: Option<String>,
    #[serde(default, deserialize_with = "de_opt_f64")]
    pub latitude: Option<f64>,
    #[serde(default, deserialize_with = "de_opt_f64")]
    pub longitude: Option<f64>,
    pub device_fingerprint: Option<String>,
}

pub async fn submit_attendance(
    State(state): State<AppState>,
    AuthUser(auth_user): AuthUser,
    Json(body): Json<SubmitAttendanceBody>,
) -> AppResult<(StatusCode, Json<Value>)> {
    // Middleware equivalent: checkAttendanceActive
    let session = sqlx::query_as::<_, AttendanceSessionRow>(
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
            "Gagal memeriksa status sesi presensi.",
        )
    })?;

    let Some(session) = session else {
        return Err(AppError::with_code(
            StatusCode::BAD_REQUEST,
            "Presensi belum dibuka. Silakan hubungi pengurus untuk mengaktifkan sesi presensi.",
            "ATTENDANCE_NOT_ACTIVE",
        ));
    };

    if body.status.as_deref() != Some("hadir") {
        return Err(AppError::bad_request(
            "Gagal absensi: Status kehadiran hanya boleh HADIR.",
        ));
    }

    let device_fp = body
        .device_fingerprint
        .as_deref()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty());

    let Some(device_fp) = device_fp else {
        return Err(AppError::with_code(
            StatusCode::BAD_REQUEST,
            "Gagal absensi: Identifikasi perangkat (device fingerprint) wajib dikirimkan.",
            "DEVICE_FINGERPRINT_REQUIRED",
        ));
    };

    let current_mode = if session.attendance_mode.is_empty() {
        "onsite"
    } else {
        session.attendance_mode.as_str()
    };

    if current_mode == "onsite" {
        let (Some(lat), Some(lon)) = (body.latitude, body.longitude) else {
            return Err(AppError::bad_request(
                "Gagal absensi: Koordinat lokasi GPS (latitude & longitude) wajib dikirimkan untuk verifikasi radius pertemuan.",
            ));
        };

        // Titik pertemuan: 7°02'02.4"S 110°22'07.8"E
        let target_lat: f64 = -7.034000;
        let target_lon: f64 = 110.36883333333333;
        let r: f64 = 6_371_000.0;
        let d_lat = (target_lat - lat).to_radians();
        let d_lon = (target_lon - lon).to_radians();
        let a = (d_lat / 2.0).sin().powi(2)
            + lat.to_radians().cos() * target_lat.to_radians().cos() * (d_lon / 2.0).sin().powi(2);
        let c = 2.0 * a.sqrt().atan2((1.0 - a).sqrt());
        let distance = r * c;

        if distance > 100.0 {
            return Err(AppError::forbidden(format!(
                "Gagal presensi: Lokasi Anda ({:.1} meter) berada di luar batas radius maksimal 100 meter dari titik koordinat pertemuan UKM Iptek (7\u{00b0}02'02.4\"S 110\u{00b0}22'07.8\"E).",
                distance
            )));
        }
    }

    let date_str = get_jakarta_date_string();
    let user_id = auth_user.id;

    // Kas gate check (wajib LUNAS bulan berjalan kecuali admin/bendahara)
    if !is_kas_exempt(&auth_user) {
        let (current_month, current_year) = get_jakarta_month_year();
        let kas_paid: Option<(i32,)> = sqlx::query_as(
            "SELECT id FROM payments WHERE user_id = ? AND month = ? AND year = ? AND status = 'lunas' LIMIT 1",
        )
        .bind(user_id)
        .bind(current_month)
        .bind(current_year)
        .fetch_optional(&state.pool)
        .await
        .map_err(|e| AppError::internal("Terjadi kesalahan saat mencatat absensi.", e))?;

        if kas_paid.is_none() {
            return Err(AppError::with_code(
                StatusCode::FORBIDDEN,
                format!(
                    "Gerbang Kas Terkunci: Anda belum melunasi uang kas untuk Bulan {} Tahun {} (Rp 10.000). Silakan bayar via QRIS terlebih dahulu agar dapat melakukan presensi.",
                    current_month, current_year
                ),
                "KAS_UNPAID_BLOCK",
            ));
        }
    }

    // Anti-Titip Absen: check device fingerprint used by another user today
    let device_used: Option<(i32,)> = sqlx::query_as(
        "SELECT id FROM attendances WHERE device_fingerprint = ? AND date = ? AND user_id != ? LIMIT 1",
    )
    .bind(device_fp)
    .bind(&date_str)
    .bind(user_id)
    .fetch_optional(&state.pool)
    .await
    .map_err(|e| AppError::internal("Terjadi kesalahan saat mencatat absensi.", e))?;

    if device_used.is_some() {
        return Err(AppError::with_code(
            StatusCode::FORBIDDEN,
            "Presensi DITOLAK: Perangkat ini sudah digunakan oleh anggota lain untuk absensi pada sesi hari ini. Setiap anggota wajib menggunakan perangkat masing-masing.",
            "DEVICE_ALREADY_USED",
        ));
    }

    let existing: Option<(String,)> =
        sqlx::query_as("SELECT status FROM attendances WHERE user_id = ? AND date = ? LIMIT 1")
            .bind(user_id)
            .bind(&date_str)
            .fetch_optional(&state.pool)
            .await
            .map_err(|e| AppError::internal("Terjadi kesalahan saat mencatat absensi.", e))?;

    if let Some((st,)) = existing {
        return Err(AppError::with_code(
            StatusCode::CONFLICT,
            format!(
                "Anda sudah melakukan absensi hari ini ({}) dengan status '{}'.",
                date_str, st
            ),
            "ATTENDANCE_ALREADY_SUBMITTED",
        ));
    }

    let now_jkt = now_jakarta_naive();
    let res = sqlx::query(
        "INSERT INTO attendances (user_id, date, status, device_fingerprint, created_at) VALUES (?, ?, 'hadir', ?, ?)",
    )
    .bind(user_id)
    .bind(&date_str)
    .bind(device_fp)
    .bind(now_jkt)
    .execute(&state.pool)
    .await
    .map_err(|e| AppError::internal("Terjadi kesalahan saat mencatat absensi.", e))?;

    let new_id = res.last_insert_id() as i32;
    let attendance = sqlx::query_as::<_, AttendanceRow>(
        "SELECT id, user_id, date, status, device_fingerprint, created_at FROM attendances WHERE id = ?",
    )
    .bind(new_id)
    .fetch_one(&state.pool)
    .await
    .map_err(|e| AppError::internal("Terjadi kesalahan saat mencatat absensi.", e))?;

    state.cache.clear_pattern(Some("dashboard:stats"));

    Ok((
        StatusCode::CREATED,
        Json(json!({
            "status": "success",
            "message": "Absensi berhasil dicatat.",
            "data": attendance.to_json()
        })),
    ))
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

    let (total,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM attendances WHERE user_id = ?")
        .bind(auth_user.id)
        .fetch_one(&state.pool)
        .await
        .map_err(|e| AppError::internal("Terjadi kesalahan saat mengambil riwayat absensi.", e))?;

    let rows = sqlx::query_as::<_, AttendanceRow>(
        "SELECT id, user_id, date, status, device_fingerprint, created_at
         FROM attendances
         WHERE user_id = ?
         ORDER BY date DESC
         LIMIT ? OFFSET ?",
    )
    .bind(auth_user.id)
    .bind(limit)
    .bind(offset)
    .fetch_all(&state.pool)
    .await
    .map_err(|e| AppError::internal("Terjadi kesalahan saat mengambil riwayat absensi.", e))?;

    let items: Vec<Value> = rows.iter().map(|r| r.to_json()).collect();
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
#[serde(rename_all = "camelCase")]
pub struct ReportFilterQuery {
    pub start_date: Option<String>,
    pub end_date: Option<String>,
    pub divisi: Option<String>,
}

async fn collect_meeting_dates(
    pool: &sqlx::MySqlPool,
    start_date: Option<&str>,
    end_date: Option<&str>,
    descending: bool,
) -> Result<Vec<String>, sqlx::Error> {
    let sessions: Vec<(Option<chrono::NaiveDateTime>,)> =
        sqlx::query_as("SELECT activated_at FROM attendance_sessions")
            .fetch_all(pool)
            .await?;

    let distinct_dates: Vec<(NaiveDate,)> =
        sqlx::query_as("SELECT DISTINCT `date` FROM attendances")
            .fetch_all(pool)
            .await?;

    let mut date_set: BTreeSet<String> = BTreeSet::new();
    for (dt_opt,) in sessions {
        if let Some(dt) = dt_opt {
            date_set.insert(naive_dt_to_jakarta_date_string(dt));
        }
    }
    for (d,) in distinct_dates {
        date_set.insert(format_naive_date(d));
    }

    let mut dates: Vec<String> = date_set
        .into_iter()
        .filter(|d| {
            let after_start = start_date.map(|s| d.as_str() >= s).unwrap_or(true);
            let before_end = end_date.map(|e| d.as_str() <= e).unwrap_or(true);
            after_start && before_end
        })
        .collect();

    if descending {
        dates.reverse();
    }
    Ok(dates)
}

pub async fn get_report(
    State(state): State<AppState>,
    AuthUser(auth_user): AuthUser,
    Query(query): Query<ReportFilterQuery>,
) -> AppResult<(StatusCode, Json<Value>)> {
    require_pengurus(&auth_user)?;

    let _ = cleanup_garbage_sessions_internal(&state.pool).await;

    let start_f = query.start_date.as_deref().filter(|s| !s.is_empty());
    let end_f = query.end_date.as_deref().filter(|s| !s.is_empty());
    let divisi_f = query.divisi.as_deref().filter(|s| !s.is_empty());

    let filtered_meeting_dates = collect_meeting_dates(&state.pool, start_f, end_f, true)
        .await
        .map_err(|e| AppError::internal("Terjadi kesalahan saat mengambil rekap absensi.", e))?;

    let users = if let Some(div) = divisi_f {
        sqlx::query_as::<_, UserPublic>(
            "SELECT id, username, nama_lengkap, role, divisi FROM users WHERE divisi = ? ORDER BY role DESC, nama_lengkap ASC",
        )
        .bind(div)
        .fetch_all(&state.pool)
        .await
    } else {
        sqlx::query_as::<_, UserPublic>(
            "SELECT id, username, nama_lengkap, role, divisi FROM users ORDER BY role DESC, nama_lengkap ASC",
        )
        .fetch_all(&state.pool)
        .await
    }
    .map_err(|e| AppError::internal("Terjadi kesalahan saat mengambil rekap absensi.", e))?;

    let attendances: Vec<AttendanceRow> = if !filtered_meeting_dates.is_empty() {
        let placeholders = filtered_meeting_dates
            .iter()
            .map(|_| "?")
            .collect::<Vec<_>>()
            .join(",");
        let sql = format!(
            "SELECT id, user_id, date, status, device_fingerprint, created_at
             FROM attendances
             WHERE date IN ({})
             ORDER BY date DESC, created_at DESC",
            placeholders
        );
        let mut q = sqlx::query_as::<_, AttendanceRow>(&sql);
        for d in &filtered_meeting_dates {
            q = q.bind(d);
        }
        q.fetch_all(&state.pool)
            .await
            .map_err(|e| AppError::internal("Terjadi kesalahan saat mengambil rekap absensi.", e))?
    } else {
        Vec::new()
    };

    let mut att_map: HashMap<(i32, String), AttendanceRow> = HashMap::new();
    for a in attendances {
        let key = (a.user_id, format_naive_date(a.date));
        att_map.entry(key).or_insert(a);
    }

    let total_meetings = filtered_meeting_dates.len() as i64;
    let mut total_hadir_all: i64 = 0;
    let mut total_alpa_all: i64 = 0;
    let mut pct_sum: i64 = 0;

    let mut rekap_members: Vec<Value> = Vec::with_capacity(users.len());
    for (idx, u) in users.iter().enumerate() {
        let mut hadir_count: i64 = 0;
        let mut izin_count: i64 = 0;
        let mut sakit_count: i64 = 0;

        let mut date_statuses: Vec<Value> = Vec::with_capacity(filtered_meeting_dates.len());
        for d in &filtered_meeting_dates {
            if let Some(att) = att_map.get(&(u.id, d.clone())) {
                match att.status.as_str() {
                    "hadir" => hadir_count += 1,
                    "izin" => izin_count += 1,
                    "sakit" => sakit_count += 1,
                    _ => {}
                }
                date_statuses.push(json!({
                    "date": d,
                    "status": att.status,
                    "id": att.id,
                    "created_at": format_opt_jakarta_dt(att.created_at)
                }));
            } else {
                date_statuses.push(json!({
                    "date": d,
                    "status": "alpa",
                    "id": Value::Null,
                    "created_at": Value::Null
                }));
            }
        }

        let alpa_count = (total_meetings - (hadir_count + izin_count + sakit_count)).max(0);
        let pct = if total_meetings > 0 {
            ((hadir_count as f64 / total_meetings as f64) * 100.0).round() as i64
        } else {
            0
        };

        total_hadir_all += hadir_count;
        total_alpa_all += alpa_count;
        pct_sum += pct;

        rekap_members.push(json!({
            "no": idx + 1,
            "id": u.id,
            "nama_lengkap": u.nama_lengkap,
            "role": u.role,
            "divisi": u.divisi.as_deref().unwrap_or("-"),
            "hadir": hadir_count,
            "izin": izin_count,
            "sakit": sakit_count,
            "alpa": alpa_count,
            "total_pertemuan": total_meetings,
            "persentase": pct,
            "date_statuses": date_statuses
        }));
    }

    let mut items: Vec<Value> = Vec::with_capacity(filtered_meeting_dates.len() * users.len());
    for d in &filtered_meeting_dates {
        for u in &users {
            let att = att_map.get(&(u.id, d.clone()));
            items.push(json!({
                "id": att.map(|a| json!(a.id)).unwrap_or(Value::Null),
                "date": d,
                "status": att.map(|a| a.status.as_str()).unwrap_or("alpa"),
                "created_at": att.and_then(|a| format_opt_jakarta_dt(a.created_at)),
                "user_id": u.id,
                "user": {
                    "id": u.id,
                    "username": u.username,
                    "nama_lengkap": u.nama_lengkap,
                    "role": u.role,
                    "divisi": u.divisi.as_deref().unwrap_or("-")
                }
            }));
        }
    }

    let avg_pct = if !users.is_empty() {
        (pct_sum as f64 / users.len() as f64).round() as i64
    } else {
        0
    };

    Ok((
        StatusCode::OK,
        Json(json!({
            "status": "success",
            "data": {
                "summary": {
                    "total_pertemuan": total_meetings,
                    "total_members": users.len(),
                    "total_hadir": total_hadir_all,
                    "total_alpa": total_alpa_all,
                    "avg_persentase": avg_pct,
                    "meeting_dates": filtered_meeting_dates
                },
                "rekap_members": rekap_members,
                "items": items,
                "total": items.len()
            }
        })),
    ))
}

fn escape_csv(val: &str) -> String {
    format!("\"{}\"", val.replace('"', "\"\""))
}

pub async fn export_attendance_csv(
    State(state): State<AppState>,
    AuthUser(auth_user): AuthUser,
    Query(query): Query<ReportFilterQuery>,
) -> AppResult<Response> {
    require_pengurus(&auth_user)?;

    let start_f = query.start_date.as_deref().filter(|s| !s.is_empty());
    let end_f = query.end_date.as_deref().filter(|s| !s.is_empty());
    let divisi_f = query.divisi.as_deref().filter(|s| !s.is_empty());

    let users = if let Some(div) = divisi_f {
        sqlx::query_as::<_, UserPublic>(
            "SELECT id, username, nama_lengkap, role, divisi FROM users WHERE divisi = ? ORDER BY role DESC, nama_lengkap ASC",
        )
        .bind(div)
        .fetch_all(&state.pool)
        .await
    } else {
        sqlx::query_as::<_, UserPublic>(
            "SELECT id, username, nama_lengkap, role, divisi FROM users ORDER BY role DESC, nama_lengkap ASC",
        )
        .fetch_all(&state.pool)
        .await
    }
    .map_err(|e| AppError::internal("Gagal mengekspor data absensi ke CSV.", e))?;

    let filtered_meeting_dates = collect_meeting_dates(&state.pool, start_f, end_f, false)
        .await
        .map_err(|e| AppError::internal("Gagal mengekspor data absensi ke CSV.", e))?;

    let mut att_map: HashMap<(i32, String), String> = HashMap::new();
    if !filtered_meeting_dates.is_empty() {
        let placeholders = filtered_meeting_dates
            .iter()
            .map(|_| "?")
            .collect::<Vec<_>>()
            .join(",");
        let sql = format!(
            "SELECT user_id, date, status FROM attendances WHERE date IN ({})",
            placeholders
        );
        let mut q = sqlx::query_as::<_, (i32, NaiveDate, String)>(&sql);
        for d in &filtered_meeting_dates {
            q = q.bind(d);
        }
        let rows = q
            .fetch_all(&state.pool)
            .await
            .map_err(|e| AppError::internal("Gagal mengekspor data absensi ke CSV.", e))?;
        for (uid, d, st) in rows {
            att_map
                .entry((uid, format_naive_date(d)))
                .or_insert(st);
        }
    }

    let mut headers: Vec<String> = vec![
        "No".into(),
        "Nama Anggota".into(),
        "Role".into(),
        "Divisi".into(),
    ];
    for d in &filtered_meeting_dates {
        headers.push(format!("Pertemuan ({})", d));
    }
    headers.push("Total Hadir".into());
    headers.push("Total Alpa (Tidak Hadir)".into());
    headers.push("Total Pertemuan".into());
    headers.push("Persentase Kehadiran".into());

    let mut lines: Vec<String> = Vec::with_capacity(users.len() + 1);
    lines.push(
        headers
            .iter()
            .map(|h| escape_csv(h))
            .collect::<Vec<_>>()
            .join(","),
    );

    let total_meetings = filtered_meeting_dates.len();
    for (idx, u) in users.iter().enumerate() {
        let mut hadir_count: usize = 0;
        let mut alpa_count: usize = 0;
        let mut cols: Vec<String> = vec![
            (idx + 1).to_string(),
            escape_csv(&u.nama_lengkap),
            escape_csv(&u.role.to_uppercase()),
            escape_csv(u.divisi.as_deref().unwrap_or("-")),
        ];

        for d in &filtered_meeting_dates {
            let label = match att_map.get(&(u.id, d.clone())).map(|s| s.as_str()) {
                Some("hadir") => {
                    hadir_count += 1;
                    "HADIR"
                }
                Some("izin") => "IZIN",
                Some("sakit") => "SAKIT",
                _ => {
                    alpa_count += 1;
                    "ALPA"
                }
            };
            cols.push(escape_csv(label));
        }

        let pct = if total_meetings > 0 {
            format!(
                "{}%",
                ((hadir_count as f64 / total_meetings as f64) * 100.0).round() as i64
            )
        } else {
            "0%".to_string()
        };

        cols.push(hadir_count.to_string());
        cols.push(alpa_count.to_string());
        cols.push(total_meetings.to_string());
        cols.push(escape_csv(&pct));
        lines.push(cols.join(","));
    }

    let csv_content = format!("\u{FEFF}{}", lines.join("\r\n"));
    let today_str = get_jakarta_date_string();

    let mut resp = (StatusCode::OK, csv_content).into_response();
    resp.headers_mut().insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static("text/csv; charset=utf-8"),
    );
    if let Ok(cd) = HeaderValue::from_str(&format!(
        "attachment; filename=\"Rekap_Kehadiran_Anggota_IPTEK_{}.csv\"",
        today_str
    )) {
        resp.headers_mut().insert(header::CONTENT_DISPOSITION, cd);
    }
    Ok(resp)
}
