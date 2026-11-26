use axum::{
    extract::FromRequestParts,
    http::{header, request::Parts},
};
use jsonwebtoken::{decode, DecodingKey, Validation};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

use crate::error::AppError;
use crate::models::UserRow;
use crate::state::AppState;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JwtClaims {
    pub id: i32,
    pub username: String,
    pub role: String,
    pub divisi: Option<String>,
    pub exp: usize,
    #[serde(default)]
    pub iat: Option<usize>,
}

#[derive(Debug, Clone)]
pub struct AuthUser(pub UserRow);

impl FromRequestParts<AppState> for AuthUser {
    type Rejection = AppError;

    async fn from_request_parts(parts: &mut Parts, state: &AppState) -> Result<Self, Self::Rejection> {
        // Extract token from Authorization: Bearer <token> OR ?token=<token>
        let mut token: Option<String> = None;

        if let Some(auth_val) = parts.headers.get(header::AUTHORIZATION) {
            if let Ok(auth_str) = auth_val.to_str() {
                if let Some(stripped) = auth_str.strip_prefix("Bearer ") {
                    let t = stripped.trim();
                    if !t.is_empty() {
                        token = Some(t.to_string());
                    }
                }
            }
        }

        if token.is_none() {
            if let Some(query) = parts.uri.query() {
                let params: HashMap<String, String> = query
                    .split('&')
                    .filter_map(|pair| {
                        let mut parts = pair.splitn(2, '=');
                        let k = parts.next()?;
                        let v = parts.next().unwrap_or("");
                        Some((k.to_string(), v.to_string()))
                    })
                    .collect();
                if let Some(t) = params.get("token") {
                    if !t.is_empty() {
                        token = Some(t.clone());
                    }
                }
            }
        }

        let token = token.ok_or_else(|| {
            AppError::unauthorized("Akses ditolak. Token autentikasi tidak ditemukan.")
        })?;

        if state.config.jwt_secret.is_empty() {
            eprintln!("[FATAL] JWT_SECRET belum dikonfigurasi di file .env");
            return Err(AppError::unauthorized(
                "Konfigurasi server belum lengkap. Hubungi administrator.",
            ));
        }

        let token_data = decode::<JwtClaims>(
            &token,
            &DecodingKey::from_secret(state.config.jwt_secret.as_bytes()),
            &Validation::default(),
        )
        .map_err(|e| {
            AppError::with_detail(
                axum::http::StatusCode::UNAUTHORIZED,
                "Token tidak valid atau telah kedaluwarsa.",
                e.to_string(),
            )
        })?;

        let user = sqlx::query_as::<_, UserRow>(
            "SELECT id, username, password_hash, nama_lengkap, role, divisi, created_at FROM users WHERE id = ?",
        )
        .bind(token_data.claims.id)
        .fetch_optional(&state.pool)
        .await
        .map_err(|e| {
            AppError::with_detail(
                axum::http::StatusCode::UNAUTHORIZED,
                "Token tidak valid atau telah kedaluwarsa.",
                e.to_string(),
            )
        })?;

        match user {
            Some(u) => Ok(AuthUser(u)),
            None => Err(AppError::unauthorized(
                "Token tidak valid. User tidak ditemukan.",
            )),
        }
    }
}
