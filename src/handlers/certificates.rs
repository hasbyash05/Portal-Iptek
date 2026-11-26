use axum::{
    extract::{Multipart, Path, Query, State},
    http::StatusCode,
    Json,
};
use chrono::{NaiveDate, NaiveDateTime};
use regex::Regex;
use serde::Deserialize;
use serde_json::{json, Value};
use sqlx::FromRow;
use std::collections::{BTreeSet, HashMap};
use std::path::Path as StdPath;
use std::time::{SystemTime, UNIX_EPOCH};

use crate::db::cleanup_garbage_sessions_internal;
use crate::error::{AppError, AppResult};
use crate::middleware::auth::AuthUser;
use crate::middleware::role_check::require_pengurus;
use crate::models::{AttendanceRow, UserRow};
use crate::state::AppState;
use crate::utils::date_helper::{
    format_naive_date, format_opt_jakarta_dt, get_jakarta_date_string,
    naive_dt_to_jakarta_date_string, now_jakarta_naive,
};
use crate::utils::upload::{
    get_extension, parse_multipart_upload, resolve_public_file, sanitize_filename_segment,
    ALLOWED_GENERAL_MIMES, MAX_UPLOAD_SIZE,
};

#[derive(Debug, FromRow)]
struct CertWithUploaderRow {
    id: i32,
    nama_sertifikat: String,
    file_path: String,
    created_at: Option<NaiveDateTime>,
    uploader_nama: Option<String>,
}

pub async fn get_profile(
    State(state): State<AppState>,
    AuthUser(_auth_user): AuthUser,
    Path(id): Path<i32>,
) -> AppResult<(StatusCode, Json<Value>)> {
    let user = sqlx::query_as::<_, UserRow>(
        "SELECT id, username, password_hash, nama_lengkap, role, divisi, created_at FROM users WHERE id = ?",
    )
    .bind(id)
    .fetch_optional(&state.pool)
    .await
    .map_err(|e| AppError::internal("Gagal memuat profil anggota.", e))?;

    let Some(user) = user else {
        return Err(AppError::not_found("User tidak ditemukan."));
    };

    let _ = cleanup_garbage_sessions_internal(&state.pool).await;

    let sessions: Vec<(Option<NaiveDateTime>,)> =
        sqlx::query_as("SELECT activated_at FROM attendance_sessions")
            .fetch_all(&state.pool)
            .await
            .map_err(|e| AppError::internal("Gagal memuat profil anggota.", e))?;

    let distinct_dates: Vec<(NaiveDate,)> =
        sqlx::query_as("SELECT DISTINCT `date` FROM attendances ORDER BY `date` DESC")
            .fetch_all(&state.pool)
            .await
            .map_err(|e| AppError::internal("Gagal memuat profil anggota.", e))?;

    let user_attendances = sqlx::query_as::<_, AttendanceRow>(
        "SELECT id, user_id, date, status, device_fingerprint, created_at
         FROM attendances
         WHERE user_id = ?
         ORDER BY date DESC, created_at DESC",
    )
    .bind(id)
    .fetch_all(&state.pool)
    .await
    .map_err(|e| AppError::internal("Gagal memuat profil anggota.", e))?;

    let mut user_att_map: HashMap<String, &AttendanceRow> = HashMap::new();
    let mut total_hadir: i64 = 0;
    let mut total_izin: i64 = 0;
    let mut total_sakit: i64 = 0;

    for a in &user_attendances {
        let d_str = format_naive_date(a.date);
        user_att_map.insert(d_str, a);
        match a.status.to_lowercase().as_str() {
            "hadir" => total_hadir += 1,
            "izin" => total_izin += 1,
            "sakit" => total_sakit += 1,
            _ => {}
        }
    }

    let mut meeting_dates_set: BTreeSet<String> = BTreeSet::new();
    for (dt_opt,) in sessions {
        if let Some(dt) = dt_opt {
            meeting_dates_set.insert(naive_dt_to_jakarta_date_string(dt));
        }
    }
    for (d,) in distinct_dates {
        meeting_dates_set.insert(format_naive_date(d));
    }

    let sorted_meeting_dates: Vec<String> = meeting_dates_set.into_iter().rev().collect();
    let total_pertemuan = sorted_meeting_dates.len() as i64;
    let total_alpa = (total_pertemuan - (total_hadir + total_izin + total_sakit)).max(0);
    let persentase = if total_pertemuan > 0 {
        ((total_hadir as f64 / total_pertemuan as f64) * 100.0).round() as i64
    } else {
        0
    };

    let today_str = get_jakarta_date_string();
    let today_att = user_attendances
        .iter()
        .find(|a| format_naive_date(a.date) == today_str);

    let attendance_records: Vec<Value> = sorted_meeting_dates
        .iter()
        .map(|date| {
            if let Some(att) = user_att_map.get(date) {
                json!({
                    "id": att.id,
                    "date": format_naive_date(att.date),
                    "status": att.status,
                    "created_at": format_opt_jakarta_dt(att.created_at)
                })
            } else {
                json!({
                    "id": Value::Null,
                    "date": date,
                    "status": "alpa",
                    "created_at": Value::Null
                })
            }
        })
        .collect();

    let certs = sqlx::query_as::<_, CertWithUploaderRow>(
        "SELECT c.id, c.nama_sertifikat, c.file_path, c.created_at, u.nama_lengkap AS uploader_nama
         FROM certificates c
         LEFT JOIN users u ON c.uploaded_by = u.id
         WHERE c.user_id = ?
         ORDER BY c.created_at DESC",
    )
    .bind(id)
    .fetch_all(&state.pool)
    .await
    .map_err(|e| AppError::internal("Gagal memuat profil anggota.", e))?;

    let certs_json: Vec<Value> = certs
        .iter()
        .map(|c| {
            json!({
                "id": c.id,
                "nama_sertifikat": c.nama_sertifikat,
                "file_path": c.file_path,
                "uploaded_by_name": c.uploader_nama.as_deref().unwrap_or("-"),
                "created_at": format_opt_jakarta_dt(c.created_at)
            })
        })
        .collect();

    let today_json = today_att.map(|a| {
        json!({
            "status": a.status,
            "waktu": format_opt_jakarta_dt(a.created_at)
        })
    });

    Ok((
        StatusCode::OK,
        Json(json!({
            "status": "success",
            "data": {
                "user": {
                    "id": user.id,
                    "username": user.username,
                    "nama_lengkap": user.nama_lengkap,
                    "role": user.role,
                    "divisi": user.divisi,
                    "created_at": format_opt_jakarta_dt(user.created_at)
                },
                "attendance": {
                    "total_pertemuan": total_pertemuan,
                    "hadir": total_hadir,
                    "izin": total_izin,
                    "sakit": total_sakit,
                    "alpa": total_alpa,
                    "persentase": persentase,
                    "today": today_json,
                    "recent": attendance_records,
                    "records": attendance_records
                },
                "certificates": certs_json
            }
        })),
    ))
}

pub async fn upload_certificate(
    State(state): State<AppState>,
    AuthUser(auth_user): AuthUser,
    multipart: Multipart,
) -> AppResult<(StatusCode, Json<Value>)> {
    require_pengurus(&auth_user)?;

    let parsed = parse_multipart_upload(
        multipart,
        "public/uploads/certificates",
        Some("certificate_file"),
        ALLOWED_GENERAL_MIMES,
        "Tipe file tidak diizinkan. Hanya PDF, PPT, MP4, JPEG, PNG, dan WebP.",
        MAX_UPLOAD_SIZE,
        1,
        None,
    )
    .await?;

    let user_id_str = parsed.fields.get("user_id").map(|s| s.trim()).unwrap_or("");
    let nama_sertifikat = parsed
        .fields
        .get("nama_sertifikat")
        .map(|s| s.trim())
        .unwrap_or("");

    if user_id_str.is_empty() || nama_sertifikat.is_empty() {
        return Err(AppError::bad_request(
            "user_id dan nama_sertifikat wajib diisi.",
        ));
    }

    let user_id: i32 = user_id_str
        .parse()
        .map_err(|_| AppError::bad_request("user_id tidak valid."))?;

    let target_user: Option<(i32, String)> =
        sqlx::query_as("SELECT id, nama_lengkap FROM users WHERE id = ?")
            .bind(user_id)
            .fetch_optional(&state.pool)
            .await
            .map_err(|e| AppError::internal("Gagal mengunggah sertifikat.", e))?;

    let Some((_, target_nama)) = target_user else {
        return Err(AppError::not_found("User tujuan tidak ditemukan."));
    };

    let Some(file) = parsed.files.into_iter().next() else {
        return Err(AppError::bad_request("File sertifikat wajib diunggah."));
    };

    let ext = get_extension(&file.original_name);
    let sanitized_name = sanitize_filename_segment(&target_nama);
    let sanitized_cert = sanitize_filename_segment(nama_sertifikat);
    let now_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let new_filename = format!("{}_{}_{}{}", sanitized_name, sanitized_cert, now_ms, ext);
    let new_path = file.destination.join(&new_filename);

    tokio::fs::rename(&file.disk_path, &new_path)
        .await
        .map_err(|e| AppError::internal("Gagal mengunggah sertifikat.", e))?;

    let file_path = format!("/uploads/certificates/{}", new_filename);

    let res = sqlx::query(
        "INSERT INTO certificates (user_id, nama_sertifikat, file_path, uploaded_by, created_at)
         VALUES (?, ?, ?, ?, ?)",
    )
    .bind(user_id)
    .bind(nama_sertifikat)
    .bind(&file_path)
    .bind(auth_user.id)
    .bind(now_jakarta_naive())
    .execute(&state.pool)
    .await
    .map_err(|e| AppError::internal("Gagal mengunggah sertifikat.", e))?;

    let cert_id = res.last_insert_id() as i32;

    Ok((
        StatusCode::CREATED,
        Json(json!({
            "status": "success",
            "message": format!("Sertifikat \"{}\" berhasil diunggah untuk {}.", nama_sertifikat, target_nama),
            "data": {
                "id": cert_id,
                "user_id": user_id,
                "nama_sertifikat": nama_sertifikat,
                "file_path": file_path,
                "target_name": target_nama
            }
        })),
    ))
}

#[derive(Debug, FromRow)]
struct SimpleUserMatch {
    id: i32,
    username: String,
    nama_lengkap: String,
}

fn normalize_cert_str(s: &str) -> String {
    let lower = s.to_lowercase();
    let replaced: String = lower
        .chars()
        .map(|c| {
            if matches!(c, '_' | '-' | '.' | '(' | ')' | '[' | ']' | ',') || c.is_ascii_digit() {
                ' '
            } else {
                c
            }
        })
        .collect();
    replaced.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn match_cert_user<'a>(
    filename: &str,
    users: &'a [SimpleUserMatch],
) -> (Option<&'a SimpleUserMatch>, String) {
    let p = StdPath::new(filename);
    let raw_base = p
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or(filename);
    let norm_base = normalize_cert_str(raw_base);
    let file_words: Vec<&str> = norm_base.split(' ').filter(|w| w.len() > 1).collect();

    let mut best_user: Option<&SimpleUserMatch> = None;
    let mut best_score: i64 = 0;

    for u in users {
        let norm_full = normalize_cert_str(&u.nama_lengkap);
        let user_words: Vec<&str> = norm_full.split(' ').filter(|w| w.len() > 1).collect();
        let mut score: i64 = 0;

        if !norm_full.is_empty() && norm_base.contains(&norm_full) {
            score = 1000 + norm_full.len() as i64;
        } else {
            let mut match_count = 0usize;
            for uw in &user_words {
                if file_words.contains(uw) {
                    match_count += 1;
                }
            }
            if match_count >= 2 || (user_words.len() == 1 && match_count == 1) {
                let pct = match_count as f64 / user_words.len() as f64;
                score = (pct * 500.0).round() as i64 + (match_count as i64 * 50);
            } else {
                let norm_uname = normalize_cert_str(&u.username);
                if !norm_uname.is_empty() && norm_base.contains(&norm_uname) {
                    score = 250;
                }
            }
        }

        if score > best_score {
            best_score = score;
            best_user = Some(u);
        }
    }

    if best_score < 200 {
        return (None, String::new());
    }

    let mut detected_title = String::new();
    if let Some(bu) = best_user {
        let parts: Vec<String> = bu
            .nama_lengkap
            .split_whitespace()
            .map(regex::escape)
            .collect();
        let mut remaining = raw_base.to_string();
        if !parts.is_empty() {
            let pat = format!("(?i){}", parts.join(r"[\s_\-]+"));
            if let Ok(re) = Regex::new(&pat) {
                remaining = re.replace(&remaining, "").to_string();
            }
        }
        let cleaned = remaining
            .replace(['_', '-'], " ")
            .trim_matches(|c: char| {
                c.is_whitespace() || c.is_ascii_digit() || matches!(c, '.' | '(' | ')')
            })
            .split_whitespace()
            .collect::<Vec<_>>()
            .join(" ");
        if cleaned.len() >= 3 {
            detected_title = cleaned;
        }
    }

    (best_user, detected_title)
}

pub async fn upload_batch_certificates(
    State(state): State<AppState>,
    AuthUser(auth_user): AuthUser,
    multipart: Multipart,
) -> AppResult<(StatusCode, Json<Value>)> {
    require_pengurus(&auth_user)?;

    let parsed = parse_multipart_upload(
        multipart,
        "public/uploads/certificates",
        Some("certificate_files"),
        ALLOWED_GENERAL_MIMES,
        "Tipe file tidak diizinkan. Hanya PDF, PPT, MP4, JPEG, PNG, dan WebP.",
        MAX_UPLOAD_SIZE,
        200,
        None,
    )
    .await?;

    if parsed.files.is_empty() {
        return Err(AppError::bad_request(
            "Tidak ada file yang diunggah. Silakan pilih folder atau file sertifikat.",
        ));
    }

    let default_title = parsed
        .fields
        .get("default_nama_sertifikat")
        .map(|s| s.trim().to_string())
        .unwrap_or_default();

    let users = sqlx::query_as::<_, SimpleUserMatch>(
        "SELECT id, username, nama_lengkap FROM users",
    )
    .fetch_all(&state.pool)
    .await
    .map_err(|e| AppError::internal("Gagal memproses unggah sertifikat massal.", e))?;

    let mut success_list: Vec<Value> = Vec::new();
    let mut unmatched_list: Vec<Value> = Vec::new();
    let total_files = parsed.files.len();

    for (i, file) in parsed.files.into_iter().enumerate() {
        let (matched_user, detected_title) = match_cert_user(&file.original_name, &users);

        let Some(target_user) = matched_user else {
            let _ = tokio::fs::remove_file(&file.disk_path).await;
            unmatched_list.push(json!({
                "filename": file.original_name,
                "reason": "Nama pemilik tidak ditemukan di data anggota"
            }));
            continue;
        };

        let cert_title = if !default_title.is_empty() {
            default_title.clone()
        } else if !detected_title.is_empty() {
            detected_title
        } else {
            "Sertifikat UKM IPTEK".to_string()
        };

        let ext = get_extension(&file.original_name);
        let sanitized_name = sanitize_filename_segment(&target_user.nama_lengkap);
        let sanitized_cert = sanitize_filename_segment(&cert_title);
        let now_ms = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_millis())
            .unwrap_or(0);
        let new_filename = format!(
            "{}_{}_{}_{}{}",
            sanitized_name, sanitized_cert, now_ms, i, ext
        );
        let new_path = file.destination.join(&new_filename);

        if file.disk_path.exists() {
            tokio::fs::rename(&file.disk_path, &new_path)
                .await
                .map_err(|e| AppError::internal("Gagal memproses unggah sertifikat massal.", e))?;
        }

        let file_path = format!("/uploads/certificates/{}", new_filename);
        let res = sqlx::query(
            "INSERT INTO certificates (user_id, nama_sertifikat, file_path, uploaded_by, created_at)
             VALUES (?, ?, ?, ?, ?)",
        )
        .bind(target_user.id)
        .bind(&cert_title)
        .bind(&file_path)
        .bind(auth_user.id)
        .bind(now_jakarta_naive())
        .execute(&state.pool)
        .await
        .map_err(|e| AppError::internal("Gagal memproses unggah sertifikat massal.", e))?;

        let cert_id = res.last_insert_id() as i32;
        success_list.push(json!({
            "id": cert_id,
            "filename": file.original_name,
            "user_id": target_user.id,
            "user_name": target_user.nama_lengkap,
            "nama_sertifikat": cert_title,
            "file_path": file_path
        }));
    }

    let unmatched_suffix = if !unmatched_list.is_empty() {
        format!(" ({} file tidak cocok)", unmatched_list.len())
    } else {
        String::new()
    };

    Ok((
        StatusCode::OK,
        Json(json!({
            "status": "success",
            "message": format!(
                "Berhasil memproses {} file. {} sertifikat berhasil dibagikan ke masing-masing akun anggota.{}",
                total_files,
                success_list.len(),
                unmatched_suffix
            ),
            "data": {
                "total_files": total_files,
                "success_count": success_list.len(),
                "unmatched_count": unmatched_list.len(),
                "success_list": success_list,
                "unmatched_list": unmatched_list
            }
        })),
    ))
}

#[derive(Debug, Deserialize)]
pub struct ListCertQuery {
    pub user_id: Option<i32>,
}

#[derive(Debug, FromRow)]
struct AllCertRow {
    id: i32,
    user_id: i32,
    nama_sertifikat: String,
    file_path: String,
    created_at: Option<NaiveDateTime>,
    owner_nama: Option<String>,
    uploader_nama: Option<String>,
}

pub async fn get_all_certificates(
    State(state): State<AppState>,
    AuthUser(auth_user): AuthUser,
    Query(query): Query<ListCertQuery>,
) -> AppResult<(StatusCode, Json<Value>)> {
    require_pengurus(&auth_user)?;

    let rows = if let Some(uid) = query.user_id {
        sqlx::query_as::<_, AllCertRow>(
            "SELECT c.id, c.user_id, c.nama_sertifikat, c.file_path, c.created_at,
                    uo.nama_lengkap AS owner_nama, uu.nama_lengkap AS uploader_nama
             FROM certificates c
             LEFT JOIN users uo ON c.user_id = uo.id
             LEFT JOIN users uu ON c.uploaded_by = uu.id
             WHERE c.user_id = ?
             ORDER BY c.created_at DESC",
        )
        .bind(uid)
        .fetch_all(&state.pool)
        .await
    } else {
        sqlx::query_as::<_, AllCertRow>(
            "SELECT c.id, c.user_id, c.nama_sertifikat, c.file_path, c.created_at,
                    uo.nama_lengkap AS owner_nama, uu.nama_lengkap AS uploader_nama
             FROM certificates c
             LEFT JOIN users uo ON c.user_id = uo.id
             LEFT JOIN users uu ON c.uploaded_by = uu.id
             ORDER BY c.created_at DESC",
        )
        .fetch_all(&state.pool)
        .await
    }
    .map_err(|e| AppError::internal("Gagal memuat daftar sertifikat.", e))?;

    let data: Vec<Value> = rows
        .iter()
        .map(|c| {
            json!({
                "id": c.id,
                "user_id": c.user_id,
                "owner_name": c.owner_nama.as_deref().unwrap_or("-"),
                "nama_sertifikat": c.nama_sertifikat,
                "file_path": c.file_path,
                "uploaded_by_name": c.uploader_nama.as_deref().unwrap_or("-"),
                "created_at": format_opt_jakarta_dt(c.created_at)
            })
        })
        .collect();

    Ok((
        StatusCode::OK,
        Json(json!({
            "status": "success",
            "data": data
        })),
    ))
}

pub async fn delete_certificate(
    State(state): State<AppState>,
    AuthUser(auth_user): AuthUser,
    Path(id): Path<i32>,
) -> AppResult<(StatusCode, Json<Value>)> {
    require_pengurus(&auth_user)?;

    let row: Option<(String, String)> =
        sqlx::query_as("SELECT nama_sertifikat, file_path FROM certificates WHERE id = ?")
            .bind(id)
            .fetch_optional(&state.pool)
            .await
            .map_err(|e| AppError::internal("Gagal menghapus sertifikat.", e))?;

    let Some((nama, file_path)) = row else {
        return Err(AppError::not_found("Sertifikat tidak ditemukan."));
    };

    let abs_path = resolve_public_file(&file_path);
    if abs_path.exists() {
        let _ = tokio::fs::remove_file(&abs_path).await;
    }

    sqlx::query("DELETE FROM certificates WHERE id = ?")
        .bind(id)
        .execute(&state.pool)
        .await
        .map_err(|e| AppError::internal("Gagal menghapus sertifikat.", e))?;

    Ok((
        StatusCode::OK,
        Json(json!({
            "status": "success",
            "message": format!("Sertifikat \"{}\" berhasil dihapus.", nama)
        })),
    ))
}
