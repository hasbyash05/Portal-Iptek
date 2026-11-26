use axum::{
    extract::{Multipart, Path, State},
    http::{header, HeaderValue, StatusCode, Uri},
    response::{IntoResponse, Response},
    Json,
};
use chrono::NaiveDateTime;
use serde_json::{json, Value};
use sqlx::FromRow;

use crate::error::{AppError, AppResult};
use crate::middleware::auth::AuthUser;
use crate::middleware::cache::MemoryCache;
use crate::middleware::role_check::require_pengurus;
use crate::models::TeachingMaterialRow;
use crate::state::AppState;
use crate::utils::date_helper::{
    format_opt_jakarta_dt, get_iso_week_number, now_jakarta_naive,
};
use crate::utils::upload::{
    parse_multipart_upload, resolve_public_file, ALLOWED_GENERAL_MIMES, MAX_UPLOAD_SIZE,
};

pub async fn upload_material(
    State(state): State<AppState>,
    AuthUser(auth_user): AuthUser,
    multipart: Multipart,
) -> AppResult<(StatusCode, Json<Value>)> {
    require_pengurus(&auth_user)?;

    let parsed = parse_multipart_upload(
        multipart,
        "public/uploads/materials",
        Some("material_file"),
        ALLOWED_GENERAL_MIMES,
        "Tipe file tidak diizinkan. Hanya PDF, PPT, MP4, JPEG, PNG, dan WebP.",
        MAX_UPLOAD_SIZE,
        1,
        None,
    )
    .await?;

    let title = parsed
        .fields
        .get("title")
        .map(|s| s.trim().to_string())
        .unwrap_or_default();
    let description = parsed
        .fields
        .get("description")
        .cloned()
        .unwrap_or_default();

    if title.is_empty() {
        return Err(AppError::bad_request("Judul bahan ajar wajib diisi."));
    }

    let Some(file) = parsed.files.into_iter().next() else {
        return Err(AppError::bad_request("File bahan ajar wajib diunggah."));
    };

    let (week_number, year) = get_iso_week_number();
    let file_path = format!("/uploads/materials/{}", file.filename);
    let now_jkt = now_jakarta_naive();

    let res = sqlx::query(
        "INSERT INTO teaching_materials (user_id, title, description, file_path, week_number, year, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(auth_user.id)
    .bind(&title)
    .bind(&description)
    .bind(&file_path)
    .bind(week_number)
    .bind(year)
    .bind(now_jkt)
    .execute(&state.pool)
    .await
    .map_err(|e| AppError::internal("Terjadi kesalahan saat mengunggah bahan ajar.", e))?;

    let new_id = res.last_insert_id() as i32;
    let material = sqlx::query_as::<_, TeachingMaterialRow>(
        "SELECT id, user_id, title, description, file_path, week_number, year, created_at FROM teaching_materials WHERE id = ?",
    )
    .bind(new_id)
    .fetch_one(&state.pool)
    .await
    .map_err(|e| AppError::internal("Terjadi kesalahan saat mengunggah bahan ajar.", e))?;

    state.cache.clear_pattern(Some("materials"));

    Ok((
        StatusCode::CREATED,
        Json(json!({
            "status": "success",
            "message": "Bahan ajar berhasil diunggah.",
            "data": material.to_json()
        })),
    ))
}

#[derive(Debug, FromRow)]
struct MaterialWithUploaderRow {
    id: i32,
    title: String,
    description: Option<String>,
    week_number: i32,
    year: i32,
    created_at: Option<NaiveDateTime>,
    uploader_nama: Option<String>,
    uploader_divisi: Option<String>,
}

pub async fn get_materials(
    State(state): State<AppState>,
    AuthUser(_user): AuthUser,
    uri: Uri,
) -> AppResult<Response> {
    let cache_key = format!("materials:list:{}", uri.query().unwrap_or(""));
    if let Some((status, body)) = state.cache.get(&cache_key) {
        return Ok(MemoryCache::hit_response(status, body));
    }

    let rows = sqlx::query_as::<_, MaterialWithUploaderRow>(
        "SELECT m.id, m.title, m.description, m.week_number, m.year, m.created_at,
                u.nama_lengkap AS uploader_nama, u.divisi AS uploader_divisi
         FROM teaching_materials m
         LEFT JOIN users u ON m.user_id = u.id
         ORDER BY m.created_at DESC",
    )
    .fetch_all(&state.pool)
    .await
    .map_err(|e| AppError::internal("Terjadi kesalahan saat mengambil daftar bahan ajar.", e))?;

    let formatted: Vec<Value> = rows
        .iter()
        .map(|m| {
            json!({
                "id": m.id,
                "title": m.title,
                "description": m.description,
                "week_number": m.week_number,
                "year": m.year,
                "uploaded_by": m.uploader_nama.as_deref().unwrap_or("Admin"),
                "divisi": m.uploader_divisi.as_deref().unwrap_or("-"),
                "download_url": format!("/api/materials/download/{}", m.id),
                "created_at": format_opt_jakarta_dt(m.created_at)
            })
        })
        .collect();

    let body = json!({
        "status": "success",
        "data": formatted
    });

    Ok(state.cache.miss_response(cache_key, StatusCode::OK, body, 30))
}

pub async fn download_material(
    State(state): State<AppState>,
    AuthUser(_user): AuthUser,
    Path(id): Path<i32>,
) -> AppResult<Response> {
    let row: Option<(String,)> =
        sqlx::query_as("SELECT file_path FROM teaching_materials WHERE id = ?")
            .bind(id)
            .fetch_optional(&state.pool)
            .await
            .map_err(|e| AppError::internal("Terjadi kesalahan saat mengunduh bahan ajar.", e))?;

    let Some((file_path,)) = row else {
        return Err(AppError::not_found("Bahan ajar tidak ditemukan."));
    };

    let abs_path = resolve_public_file(&file_path);
    if !abs_path.exists() {
        return Err(AppError::not_found("File fisik tidak ditemukan di server."));
    }

    let bytes = tokio::fs::read(&abs_path)
        .await
        .map_err(|e| AppError::internal("Terjadi kesalahan saat mengunduh bahan ajar.", e))?;

    let basename = abs_path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("material");
    let mime = mime_guess::from_path(&abs_path)
        .first_or_octet_stream()
        .to_string();

    let mut resp = (StatusCode::OK, bytes).into_response();
    if let Ok(v) = HeaderValue::from_str(&mime) {
        resp.headers_mut().insert(header::CONTENT_TYPE, v);
    }
    if let Ok(v) = HeaderValue::from_str(&format!("attachment; filename=\"{}\"", basename)) {
        resp.headers_mut().insert(header::CONTENT_DISPOSITION, v);
    }
    Ok(resp)
}

pub async fn delete_material(
    State(state): State<AppState>,
    AuthUser(auth_user): AuthUser,
    Path(id): Path<i32>,
) -> AppResult<(StatusCode, Json<Value>)> {
    require_pengurus(&auth_user)?;

    let row: Option<(String,)> =
        sqlx::query_as("SELECT file_path FROM teaching_materials WHERE id = ?")
            .bind(id)
            .fetch_optional(&state.pool)
            .await
            .map_err(|e| AppError::internal("Terjadi kesalahan saat menghapus bahan ajar.", e))?;

    let Some((file_path,)) = row else {
        return Err(AppError::not_found("Bahan ajar tidak ditemukan."));
    };

    let abs_path = resolve_public_file(&file_path);
    if abs_path.exists() {
        let _ = tokio::fs::remove_file(&abs_path).await;
    }

    sqlx::query("DELETE FROM teaching_materials WHERE id = ?")
        .bind(id)
        .execute(&state.pool)
        .await
        .map_err(|e| AppError::internal("Terjadi kesalahan saat menghapus bahan ajar.", e))?;

    state.cache.clear_pattern(Some("materials"));

    Ok((
        StatusCode::OK,
        Json(json!({
            "status": "success",
            "message": "Bahan ajar berhasil dihapus."
        })),
    ))
}
