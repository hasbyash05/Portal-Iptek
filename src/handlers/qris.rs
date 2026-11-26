use axum::{
    extract::{Multipart, State},
    http::StatusCode,
    response::Response,
    Json,
};
use serde_json::{json, Value};
use std::path::Path;

use crate::error::{AppError, AppResult};
use crate::middleware::auth::AuthUser;
use crate::middleware::cache::MemoryCache;
use crate::middleware::role_check::require_bendahara;
use crate::state::AppState;
use crate::utils::upload::{parse_multipart_upload, ALLOWED_IMAGE_MIMES, MAX_QRIS_SIZE};

pub async fn get_config(
    State(state): State<AppState>,
    AuthUser(_user): AuthUser,
) -> AppResult<Response> {
    let cache_key = "qris:config".to_string();
    if let Some((status, body)) = state.cache.get(&cache_key) {
        return Ok(MemoryCache::hit_response(status, body));
    }

    let uploads_dir = Path::new("public/uploads/qris");
    let mut qris_image_url: Option<String> = None;

    if uploads_dir.exists() {
        if let Ok(mut rd) = tokio::fs::read_dir(uploads_dir).await {
            while let Ok(Some(entry)) = rd.next_entry().await {
                if let Some(name) = entry.file_name().to_str() {
                    if name.starts_with("qris_bendahara") {
                        qris_image_url = Some(format!("/uploads/qris/{}", name));
                        break;
                    }
                }
            }
        }
    }

    let body = json!({
        "status": "success",
        "data": {
            "qris_image_url": qris_image_url,
            "merchant_name": state.config.qris_merchant_name,
            "nmid": state.config.qris_nmid,
            "is_configured": qris_image_url.is_some()
        }
    });

    Ok(state.cache.miss_response(cache_key, StatusCode::OK, body, 60))
}

pub async fn upload_qris(
    State(state): State<AppState>,
    AuthUser(auth_user): AuthUser,
    multipart: Multipart,
) -> AppResult<(StatusCode, Json<Value>)> {
    require_bendahara(&auth_user)?;

    let parsed = parse_multipart_upload(
        multipart,
        "public/uploads/qris",
        Some("qris_image"),
        ALLOWED_IMAGE_MIMES,
        "Tipe file tidak diizinkan. Hanya JPEG, PNG, dan WebP.",
        MAX_QRIS_SIZE,
        1,
        Some("qris_bendahara"),
    )
    .await?;

    let Some(file) = parsed.files.into_iter().next() else {
        return Err(AppError::bad_request("File gambar QRIS wajib diunggah."));
    };

    let relative_path = format!("/uploads/qris/{}", file.filename);
    state.cache.clear_pattern(Some("qris:config"));

    Ok((
        StatusCode::OK,
        Json(json!({
            "status": "success",
            "message": "Gambar QRIS Bendahara berhasil diunggah dan diaktifkan.",
            "data": {
                "qris_image_url": relative_path,
                "filename": file.filename,
                "size": file.size
            }
        })),
    ))
}
