use axum::{
    extract::{ConnectInfo, State},
    http::{HeaderMap, StatusCode},
    Json,
};
use chrono::Utc;
use jsonwebtoken::{encode, EncodingKey, Header};
use serde::Deserialize;
use serde_json::{json, Value};
use std::net::SocketAddr;

use crate::error::{AppError, AppResult};
use crate::middleware::auth::{AuthUser, JwtClaims};
use crate::models::UserRow;
use crate::state::AppState;
use crate::utils::date_helper::{format_opt_jakarta_dt, now_jakarta_naive};

#[derive(Debug, Deserialize)]
pub struct LoginRequest {
    pub username: Option<String>,
    pub password: Option<String>,
    pub device_fingerprint: Option<String>,
    pub device_info: Option<String>,
}

fn extract_client_ip(headers: &HeaderMap, addr: &ConnectInfo<SocketAddr>) -> String {
    if let Some(xff) = headers.get("x-forwarded-for").and_then(|v| v.to_str().ok()) {
        if let Some(first) = xff.split(',').next() {
            let trimmed = first.trim();
            if !trimmed.is_empty() {
                return trimmed.to_string();
            }
        }
    }
    addr.0.ip().to_string()
}

pub async fn login(
    State(state): State<AppState>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Json(body): Json<LoginRequest>,
) -> AppResult<(StatusCode, Json<Value>)> {
    let client_ip = extract_client_ip(&headers, &ConnectInfo(addr));
    if !state.login_limiter.check_and_increment(&client_ip) {
        return Err(AppError::new(
            StatusCode::TOO_MANY_REQUESTS,
            "Terjadi terlalu banyak percobaan login. Silakan coba lagi setelah 30 detik.",
        ));
    }

    let username = body.username.as_deref().unwrap_or("").trim();
    let password = body.password.as_deref().unwrap_or("");
    if username.is_empty() || password.is_empty() {
        return Err(AppError::bad_request("Username dan password wajib diisi."));
    }

    let user = sqlx::query_as::<_, UserRow>(
        "SELECT id, username, password_hash, nama_lengkap, role, divisi, created_at FROM users WHERE username = ? LIMIT 1",
    )
    .bind(username)
    .fetch_optional(&state.pool)
    .await
    .map_err(|e| AppError::internal("Terjadi kesalahan pada server saat proses login.", e))?;

    let Some(user) = user else {
        return Err(AppError::unauthorized("Username atau password salah."));
    };

    let hash_clone = user.password_hash.clone();
    let pass_clone = password.to_string();
    let is_match = tokio::task::spawn_blocking(move || bcrypt::verify(&pass_clone, &hash_clone))
        .await
        .map_err(|e| AppError::internal("Terjadi kesalahan pada server saat proses login.", e))?
        .unwrap_or(false);

    if !is_match {
        return Err(AppError::unauthorized("Username atau password salah."));
    }

    if state.config.jwt_secret.is_empty() {
        eprintln!("[FATAL] JWT_SECRET belum dikonfigurasi di file .env");
        return Err(AppError::new(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Konfigurasi server belum lengkap. Hubungi administrator.",
        ));
    }

    let now_ts = Utc::now().timestamp();
    let claims = JwtClaims {
        id: user.id,
        username: user.username.clone(),
        role: user.role.clone(),
        divisi: user.divisi.clone(),
        exp: (now_ts + state.config.jwt_expires_in_secs) as usize,
        iat: Some(now_ts as usize),
    };

    let token = encode(
        &Header::default(),
        &claims,
        &EncodingKey::from_secret(state.config.jwt_secret.as_bytes()),
    )
    .map_err(|e| AppError::internal("Terjadi kesalahan pada server saat proses login.", e))?;

    // Record device fingerprint if provided
    if let Some(fp) = body.device_fingerprint.as_deref().filter(|s| !s.is_empty()) {
        let now_jkt = now_jakarta_naive();
        let existing: Option<(i32,)> = sqlx::query_as(
            "SELECT id FROM user_devices WHERE user_id = ? AND device_fingerprint = ? LIMIT 1",
        )
        .bind(user.id)
        .bind(fp)
        .fetch_optional(&state.pool)
        .await
        .ok()
        .flatten();

        if let Some((dev_id,)) = existing {
            let res = if let Some(ref info) = body.device_info {
                sqlx::query("UPDATE user_devices SET last_seen = ?, device_info = ? WHERE id = ?")
                    .bind(now_jkt)
                    .bind(info)
                    .bind(dev_id)
                    .execute(&state.pool)
                    .await
            } else {
                sqlx::query("UPDATE user_devices SET last_seen = ? WHERE id = ?")
                    .bind(now_jkt)
                    .bind(dev_id)
                    .execute(&state.pool)
                    .await
            };
            if let Err(e) = res {
                eprintln!("[WARN] Gagal mencatat device fingerprint: {}", e);
            }
        } else {
            let res = sqlx::query(
                "INSERT INTO user_devices (user_id, device_fingerprint, device_info, first_seen, last_seen) VALUES (?, ?, ?, ?, ?)",
            )
            .bind(user.id)
            .bind(fp)
            .bind(body.device_info.as_deref())
            .bind(now_jkt)
            .bind(now_jkt)
            .execute(&state.pool)
            .await;
            if let Err(e) = res {
                eprintln!("[WARN] Gagal mencatat device fingerprint: {}", e);
            }
        }
    }

    Ok((
        StatusCode::OK,
        Json(json!({
            "status": "success",
            "message": "Login berhasil.",
            "token": token,
            "user": {
                "id": user.id,
                "username": user.username,
                "nama_lengkap": user.nama_lengkap,
                "role": user.role,
                "divisi": user.divisi
            }
        })),
    ))
}

pub async fn get_me(AuthUser(user): AuthUser) -> AppResult<(StatusCode, Json<Value>)> {
    Ok((
        StatusCode::OK,
        Json(json!({
            "status": "success",
            "data": {
                "id": user.id,
                "username": user.username,
                "nama_lengkap": user.nama_lengkap,
                "role": user.role,
                "divisi": user.divisi,
                "created_at": format_opt_jakarta_dt(user.created_at)
            }
        })),
    ))
}
