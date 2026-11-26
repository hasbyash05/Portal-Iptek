use axum::{
    extract::{Multipart, State},
    http::StatusCode,
    response::Response,
    Json,
};
use serde::Deserialize;
use serde_json::{json, Value};
use std::path::Path;

use crate::error::{AppError, AppResult};
use crate::middleware::auth::AuthUser;
use crate::middleware::cache::MemoryCache;
use crate::middleware::role_check::require_bendahara;
use crate::services::qris_dynamic::{
    load_static_qris_payload, parse_qris_info, render_qr_svg_data_url, QRIS_PAYLOAD_FILE,
};
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

    let payload_opt = load_static_qris_payload(&state.config.qris_static_payload);
    let parsed_info = payload_opt.as_deref().and_then(|p| parse_qris_info(p).ok());

    let merchant_name = parsed_info
        .as_ref()
        .and_then(|i| i.merchant_name.clone())
        .unwrap_or_else(|| state.config.qris_merchant_name.clone());
    let nmid = parsed_info
        .as_ref()
        .and_then(|i| i.nmid.clone())
        .unwrap_or_else(|| state.config.qris_nmid.clone());
    let is_umi = parsed_info.as_ref().map(|i| i.is_umi).unwrap_or(false);
    let has_dynamic_qris = parsed_info.is_some();
    let qris_preview_svg = payload_opt
        .as_deref()
        .and_then(|p| render_qr_svg_data_url(p).ok());

    let body = json!({
        "status": "success",
        "data": {
            "qris_image_url": qris_image_url,
            "qris_preview_svg": qris_preview_svg,
            "merchant_name": merchant_name,
            "nmid": nmid,
            "is_umi": is_umi,
            "has_dynamic_qris": has_dynamic_qris,
            "is_configured": has_dynamic_qris || qris_image_url.is_some(),
            "fee_info": "Rp 0 (Tanpa Potongan / 0% MDR QRIS UMI)"
        }
    });

    Ok(state.cache.miss_response(cache_key, StatusCode::OK, body, 60))
}

#[derive(Debug, Deserialize)]
pub struct SavePayloadBody {
    pub qris_payload: Option<String>,
}

pub async fn save_qris_payload(
    State(state): State<AppState>,
    AuthUser(auth_user): AuthUser,
    Json(body): Json<SavePayloadBody>,
) -> AppResult<(StatusCode, Json<Value>)> {
    require_bendahara(&auth_user)?;

    let raw = body.qris_payload.as_deref().unwrap_or("").trim();
    if raw.is_empty() {
        return Err(AppError::bad_request(
            "String payload QRIS statis wajib diisi.",
        ));
    }

    let info = parse_qris_info(raw).map_err(AppError::bad_request)?;

    let dir = Path::new("public/uploads/qris");
    tokio::fs::create_dir_all(dir)
        .await
        .map_err(|e| AppError::internal("Gagal membuat folder konfigurasi QRIS.", e))?;
    tokio::fs::write(QRIS_PAYLOAD_FILE, &info.raw_payload)
        .await
        .map_err(|e| AppError::internal("Gagal menyimpan payload QRIS.", e))?;

    let preview_svg = render_qr_svg_data_url(&info.raw_payload).ok();
    state.cache.clear_pattern(Some("qris:config"));

    Ok((
        StatusCode::OK,
        Json(json!({
            "status": "success",
            "message": "Payload QRIS Dinamis berhasil diverifikasi (CRC16 valid) dan diaktifkan.",
            "data": {
                "merchant_name": info.merchant_name.unwrap_or_else(|| state.config.qris_merchant_name.clone()),
                "merchant_city": info.merchant_city,
                "nmid": info.nmid.unwrap_or_else(|| state.config.qris_nmid.clone()),
                "is_umi": info.is_umi,
                "qris_preview_svg": preview_svg
            }
        })),
    ))
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
