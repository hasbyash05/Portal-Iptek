use axum::{
    extract::{Multipart, Path, State},
    http::{header, HeaderValue, StatusCode},
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
use crate::models::DocumentTemplateRow;
use crate::state::AppState;
use crate::utils::date_helper::{format_opt_jakarta_dt, now_jakarta_naive};
use crate::utils::upload::{
    parse_multipart_upload, resolve_public_file, ALLOWED_GENERAL_MIMES, MAX_UPLOAD_SIZE,
};

pub async fn upload_template(
    State(state): State<AppState>,
    AuthUser(auth_user): AuthUser,
    multipart: Multipart,
) -> AppResult<(StatusCode, Json<Value>)> {
    require_pengurus(&auth_user)?;

    let parsed = parse_multipart_upload(
        multipart,
        "public/uploads/templates",
        Some("template_file"),
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
    let category = parsed
        .fields
        .get("category")
        .map(|s| s.trim().to_string())
        .unwrap_or_default();
    let description = parsed
        .fields
        .get("description")
        .cloned()
        .unwrap_or_default();

    if title.is_empty() || category.is_empty() {
        return Err(AppError::bad_request(
            "Judul dan kategori template dokumen wajib diisi.",
        ));
    }

    let Some(file) = parsed.files.into_iter().next() else {
        return Err(AppError::bad_request(
            "File template dokumen wajib diunggah.",
        ));
    };

    let file_path = format!("/uploads/templates/{}", file.filename);
    let now_jkt = now_jakarta_naive();

    let res = sqlx::query(
        "INSERT INTO document_templates (title, category, description, file_path, uploaded_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?)",
    )
    .bind(&title)
    .bind(&category)
    .bind(&description)
    .bind(&file_path)
    .bind(auth_user.id)
    .bind(now_jkt)
    .execute(&state.pool)
    .await
    .map_err(|e| AppError::internal("Terjadi kesalahan saat mengunggah template dokumen.", e))?;

    let new_id = res.last_insert_id() as i32;
    let template = sqlx::query_as::<_, DocumentTemplateRow>(
        "SELECT id, title, category, description, file_path, uploaded_by, created_at FROM document_templates WHERE id = ?",
    )
    .bind(new_id)
    .fetch_one(&state.pool)
    .await
    .map_err(|e| AppError::internal("Terjadi kesalahan saat mengunggah template dokumen.", e))?;

    state.cache.clear_pattern(Some("templates"));

    Ok((
        StatusCode::CREATED,
        Json(json!({
            "status": "success",
            "message": "Template dokumen berhasil diunggah.",
            "data": template.to_json()
        })),
    ))
}

#[derive(Debug, FromRow)]
struct TemplateWithUploaderRow {
    id: i32,
    title: String,
    category: String,
    description: Option<String>,
    created_at: Option<NaiveDateTime>,
    uploader_nama: Option<String>,
    uploader_divisi: Option<String>,
}

pub async fn get_templates(
    State(state): State<AppState>,
    AuthUser(_user): AuthUser,
) -> AppResult<Response> {
    let cache_key = "templates:list".to_string();
    if let Some((status, body)) = state.cache.get(&cache_key) {
        return Ok(MemoryCache::hit_response(status, body));
    }

    let rows = sqlx::query_as::<_, TemplateWithUploaderRow>(
        "SELECT t.id, t.title, t.category, t.description, t.created_at,
                u.nama_lengkap AS uploader_nama, u.divisi AS uploader_divisi
         FROM document_templates t
         LEFT JOIN users u ON t.uploaded_by = u.id
         ORDER BY t.created_at DESC",
    )
    .fetch_all(&state.pool)
    .await
    .map_err(|e| {
        AppError::internal(
            "Terjadi kesalahan saat mengambil daftar template dokumen.",
            e,
        )
    })?;

    let formatted: Vec<Value> = rows
        .iter()
        .map(|t| {
            json!({
                "id": t.id,
                "title": t.title,
                "category": t.category,
                "description": t.description,
                "uploaded_by": t.uploader_nama.as_deref().unwrap_or("Admin"),
                "divisi": t.uploader_divisi.as_deref().unwrap_or("-"),
                "download_url": format!("/api/templates/download/{}", t.id),
                "created_at": format_opt_jakarta_dt(t.created_at)
            })
        })
        .collect();

    let body = json!({
        "status": "success",
        "data": formatted
    });

    Ok(state.cache.miss_response(cache_key, StatusCode::OK, body, 30))
}

pub async fn download_template(
    State(state): State<AppState>,
    AuthUser(_user): AuthUser,
    Path(id): Path<i32>,
) -> AppResult<Response> {
    let row: Option<(String,)> =
        sqlx::query_as("SELECT file_path FROM document_templates WHERE id = ?")
            .bind(id)
            .fetch_optional(&state.pool)
            .await
            .map_err(|e| {
                AppError::internal("Terjadi kesalahan saat mengunduh template dokumen.", e)
            })?;

    let Some((file_path,)) = row else {
        return Err(AppError::not_found("Template dokumen tidak ditemukan."));
    };

    let abs_path = resolve_public_file(&file_path);
    if !abs_path.exists() {
        return Err(AppError::not_found("File fisik tidak ditemukan di server."));
    }

    let bytes = tokio::fs::read(&abs_path)
        .await
        .map_err(|e| AppError::internal("Terjadi kesalahan saat mengunduh template dokumen.", e))?;

    let basename = abs_path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("template");
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

pub async fn delete_template(
    State(state): State<AppState>,
    AuthUser(auth_user): AuthUser,
    Path(id): Path<i32>,
) -> AppResult<(StatusCode, Json<Value>)> {
    require_pengurus(&auth_user)?;

    let row: Option<(String,)> =
        sqlx::query_as("SELECT file_path FROM document_templates WHERE id = ?")
            .bind(id)
            .fetch_optional(&state.pool)
            .await
            .map_err(|e| {
                AppError::internal("Terjadi kesalahan saat menghapus template dokumen.", e)
            })?;

    let Some((file_path,)) = row else {
        return Err(AppError::not_found("Template dokumen tidak ditemukan."));
    };

    let abs_path = resolve_public_file(&file_path);
    if abs_path.exists() {
        let _ = tokio::fs::remove_file(&abs_path).await;
    }

    sqlx::query("DELETE FROM document_templates WHERE id = ?")
        .bind(id)
        .execute(&state.pool)
        .await
        .map_err(|e| AppError::internal("Terjadi kesalahan saat menghapus template dokumen.", e))?;

    state.cache.clear_pattern(Some("templates"));

    Ok((
        StatusCode::OK,
        Json(json!({
            "status": "success",
            "message": "Template dokumen berhasil dihapus."
        })),
    ))
}
