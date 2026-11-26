use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    Json,
};
use rand::Rng;
use serde::Deserialize;
use serde_json::{json, Value};

use crate::error::{AppError, AppResult};
use crate::middleware::auth::AuthUser;
use crate::middleware::role_check::require_pengurus_or_admin_users;
use crate::models::{UserPublic, UserRow};
use crate::state::AppState;
use crate::utils::date_helper::now_jakarta_naive;

const BCRYPT_COST: u32 = 10;

fn generate_random_password(len: usize) -> String {
    const CHARS: &[u8] = b"abcdefghijklmnopqrstuvwxyz0123456789";
    let mut rng = rand::thread_rng();
    (0..len)
        .map(|_| {
            let idx = rng.gen_range(0..CHARS.len());
            CHARS[idx] as char
        })
        .collect()
}

#[derive(Debug, Deserialize)]
pub struct ListUsersQuery {
    pub role: Option<String>,
    pub search: Option<String>,
}

pub async fn get_all_users(
    State(state): State<AppState>,
    AuthUser(auth_user): AuthUser,
    Query(query): Query<ListUsersQuery>,
) -> AppResult<(StatusCode, Json<Value>)> {
    require_pengurus_or_admin_users(&auth_user)?;

    let role_filter = query
        .role
        .as_deref()
        .filter(|r| matches!(*r, "admin" | "pengurus" | "anggota"));
    let search_filter = query
        .search
        .as_deref()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty());

    let mut sql = String::from(
        "SELECT id, username, nama_lengkap, role, divisi FROM users WHERE 1=1",
    );
    if role_filter.is_some() {
        sql.push_str(" AND role = ?");
    }
    if search_filter.is_some() {
        sql.push_str(" AND (nama_lengkap LIKE ? OR username LIKE ?)");
    }
    sql.push_str(" ORDER BY role ASC, nama_lengkap ASC");

    let mut q = sqlx::query_as::<_, UserPublic>(&sql);
    if let Some(r) = role_filter {
        q = q.bind(r);
    }
    if let Some(s) = search_filter {
        let pattern = format!("%{}%", s);
        q = q.bind(pattern.clone()).bind(pattern);
    }

    let users = q
        .fetch_all(&state.pool)
        .await
        .map_err(|e| AppError::internal("Gagal memuat daftar anggota.", e))?;

    Ok((
        StatusCode::OK,
        Json(json!({
            "status": "success",
            "data": users
        })),
    ))
}

#[derive(Debug, Deserialize)]
pub struct CreateUserBody {
    pub username: Option<String>,
    pub password: Option<String>,
    pub nama_lengkap: Option<String>,
    pub role: Option<String>,
    pub divisi: Option<String>,
}

pub async fn create_user(
    State(state): State<AppState>,
    AuthUser(auth_user): AuthUser,
    Json(body): Json<CreateUserBody>,
) -> AppResult<(StatusCode, Json<Value>)> {
    require_pengurus_or_admin_users(&auth_user)?;

    let username_raw = body.username.as_deref().unwrap_or("").trim();
    let nama_raw = body.nama_lengkap.as_deref().unwrap_or("").trim();
    let role_raw = body.role.as_deref().unwrap_or("").trim();

    if username_raw.is_empty() || nama_raw.is_empty() || role_raw.is_empty() {
        return Err(AppError::bad_request(
            "Username, nama lengkap, dan role wajib diisi.",
        ));
    }

    if !matches!(role_raw, "admin" | "pengurus" | "anggota") {
        return Err(AppError::bad_request(
            "Role harus admin, pengurus, atau anggota.",
        ));
    }

    let existing: Option<(i32,)> =
        sqlx::query_as("SELECT id FROM users WHERE username = ? LIMIT 1")
            .bind(username_raw)
            .fetch_optional(&state.pool)
            .await
            .map_err(|e| AppError::internal("Gagal menambahkan anggota.", e))?;

    if existing.is_some() {
        return Err(AppError::conflict(format!(
            "Username \"{}\" sudah digunakan.",
            username_raw
        )));
    }

    let final_password = body
        .password
        .as_deref()
        .filter(|p| !p.is_empty())
        .map(|s| s.to_string())
        .unwrap_or_else(|| generate_random_password(8));

    let pass_for_hash = final_password.clone();
    let password_hash =
        tokio::task::spawn_blocking(move || bcrypt::hash(&pass_for_hash, BCRYPT_COST))
            .await
            .map_err(|e| AppError::internal("Gagal menambahkan anggota.", e))?
            .map_err(|e| AppError::internal("Gagal menambahkan anggota.", e))?;

    let clean_username = username_raw.to_lowercase();
    let clean_divisi = if role_raw == "pengurus" {
        body.divisi.filter(|d| !d.trim().is_empty())
    } else {
        None
    };

    let res = sqlx::query(
        "INSERT INTO users (username, password_hash, nama_lengkap, role, divisi, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    )
    .bind(&clean_username)
    .bind(&password_hash)
    .bind(nama_raw)
    .bind(role_raw)
    .bind(&clean_divisi)
    .bind(now_jakarta_naive())
    .execute(&state.pool)
    .await
    .map_err(|e| AppError::internal("Gagal menambahkan anggota.", e))?;

    let new_id = res.last_insert_id() as i32;

    Ok((
        StatusCode::CREATED,
        Json(json!({
            "status": "success",
            "message": format!("Anggota \"{}\" berhasil ditambahkan.", nama_raw),
            "data": {
                "id": new_id,
                "username": clean_username,
                "nama_lengkap": nama_raw,
                "role": role_raw,
                "divisi": clean_divisi,
                "generated_password": final_password
            }
        })),
    ))
}

#[derive(Debug, Deserialize)]
pub struct UpdateUserBody {
    pub username: Option<String>,
    pub nama_lengkap: Option<String>,
    pub role: Option<String>,
    pub divisi: Option<Value>,
}

pub async fn update_user(
    State(state): State<AppState>,
    AuthUser(auth_user): AuthUser,
    Path(id): Path<i32>,
    Json(body): Json<UpdateUserBody>,
) -> AppResult<(StatusCode, Json<Value>)> {
    require_pengurus_or_admin_users(&auth_user)?;

    let user = sqlx::query_as::<_, UserRow>(
        "SELECT id, username, password_hash, nama_lengkap, role, divisi, created_at FROM users WHERE id = ?",
    )
    .bind(id)
    .fetch_optional(&state.pool)
    .await
    .map_err(|e| AppError::internal("Gagal memperbarui data anggota.", e))?;

    let Some(mut user) = user else {
        return Err(AppError::not_found("User tidak ditemukan."));
    };

    if let Some(ref uname) = body.username {
        if !uname.is_empty() && uname != &user.username {
            let existing: Option<(i32,)> =
                sqlx::query_as("SELECT id FROM users WHERE username = ? AND id != ? LIMIT 1")
                    .bind(uname)
                    .bind(id)
                    .fetch_optional(&state.pool)
                    .await
                    .map_err(|e| AppError::internal("Gagal memperbarui data anggota.", e))?;
            if existing.is_some() {
                return Err(AppError::conflict(format!(
                    "Username \"{}\" sudah digunakan oleh user lain.",
                    uname
                )));
            }
            user.username = uname.to_lowercase().trim().to_string();
        }
    }

    if let Some(ref nama) = body.nama_lengkap {
        if !nama.trim().is_empty() {
            user.nama_lengkap = nama.trim().to_string();
        }
    }

    let divisi_str_opt = body.divisi.as_ref().and_then(|v| match v {
        Value::String(s) if !s.trim().is_empty() => Some(s.clone()),
        _ => None,
    });

    if let Some(ref role) = body.role {
        if matches!(role.as_str(), "admin" | "pengurus" | "anggota") {
            user.role = role.clone();
            if role == "pengurus" {
                if let Some(d) = divisi_str_opt.clone() {
                    user.divisi = Some(d);
                }
            } else {
                user.divisi = None;
            }
        }
    }

    if user.role == "pengurus" && body.divisi.is_some() {
        user.divisi = divisi_str_opt;
    }

    sqlx::query(
        "UPDATE users SET username = ?, nama_lengkap = ?, role = ?, divisi = ? WHERE id = ?",
    )
    .bind(&user.username)
    .bind(&user.nama_lengkap)
    .bind(&user.role)
    .bind(&user.divisi)
    .bind(id)
    .execute(&state.pool)
    .await
    .map_err(|e| AppError::internal("Gagal memperbarui data anggota.", e))?;

    Ok((
        StatusCode::OK,
        Json(json!({
            "status": "success",
            "message": format!("Data \"{}\" berhasil diperbarui.", user.nama_lengkap),
            "data": {
                "id": user.id,
                "username": user.username,
                "nama_lengkap": user.nama_lengkap,
                "role": user.role,
                "divisi": user.divisi
            }
        })),
    ))
}

#[derive(Debug, Deserialize)]
pub struct ResetPasswordBody {
    pub new_password: Option<String>,
}

pub async fn reset_password(
    State(state): State<AppState>,
    AuthUser(auth_user): AuthUser,
    Path(id): Path<i32>,
    Json(body): Json<ResetPasswordBody>,
) -> AppResult<(StatusCode, Json<Value>)> {
    require_pengurus_or_admin_users(&auth_user)?;

    let user = sqlx::query_as::<_, UserRow>(
        "SELECT id, username, password_hash, nama_lengkap, role, divisi, created_at FROM users WHERE id = ?",
    )
    .bind(id)
    .fetch_optional(&state.pool)
    .await
    .map_err(|e| AppError::internal("Gagal mereset password.", e))?;

    let Some(user) = user else {
        return Err(AppError::not_found("User tidak ditemukan."));
    };

    let final_password = body
        .new_password
        .as_deref()
        .filter(|p| !p.is_empty())
        .map(|s| s.to_string())
        .unwrap_or_else(|| generate_random_password(8));

    let pass_for_hash = final_password.clone();
    let password_hash =
        tokio::task::spawn_blocking(move || bcrypt::hash(&pass_for_hash, BCRYPT_COST))
            .await
            .map_err(|e| AppError::internal("Gagal mereset password.", e))?
            .map_err(|e| AppError::internal("Gagal mereset password.", e))?;

    sqlx::query("UPDATE users SET password_hash = ? WHERE id = ?")
        .bind(&password_hash)
        .bind(id)
        .execute(&state.pool)
        .await
        .map_err(|e| AppError::internal("Gagal mereset password.", e))?;

    Ok((
        StatusCode::OK,
        Json(json!({
            "status": "success",
            "message": format!("Password \"{}\" berhasil direset.", user.nama_lengkap),
            "data": {
                "id": user.id,
                "username": user.username,
                "nama_lengkap": user.nama_lengkap,
                "new_password": final_password
            }
        })),
    ))
}

pub async fn delete_user(
    State(state): State<AppState>,
    AuthUser(auth_user): AuthUser,
    Path(id): Path<i32>,
) -> AppResult<(StatusCode, Json<Value>)> {
    require_pengurus_or_admin_users(&auth_user)?;

    if id == auth_user.id {
        return Err(AppError::bad_request("Tidak bisa menghapus akun sendiri."));
    }

    let user: Option<(String,)> =
        sqlx::query_as("SELECT nama_lengkap FROM users WHERE id = ?")
            .bind(id)
            .fetch_optional(&state.pool)
            .await
            .map_err(|e| AppError::internal("Gagal menghapus anggota.", e))?;

    let Some((nama,)) = user else {
        return Err(AppError::not_found("User tidak ditemukan."));
    };

    sqlx::query("DELETE FROM users WHERE id = ?")
        .bind(id)
        .execute(&state.pool)
        .await
        .map_err(|e| AppError::internal("Gagal menghapus anggota.", e))?;

    Ok((
        StatusCode::OK,
        Json(json!({
            "status": "success",
            "message": format!("Anggota \"{}\" berhasil dihapus.", nama)
        })),
    ))
}
