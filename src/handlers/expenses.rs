use axum::{
    extract::{Path, State},
    http::StatusCode,
    Json,
};
use chrono::{NaiveDate, NaiveDateTime};
use serde::Deserialize;
use serde_json::{json, Value};
use sqlx::FromRow;

use crate::error::{AppError, AppResult};
use crate::middleware::auth::AuthUser;
use crate::middleware::role_check::require_bendahara;
use crate::models::{de_opt_f64, KasExpenseRow};
use crate::state::AppState;
use crate::utils::date_helper::{format_naive_date, format_opt_jakarta_dt, now_jakarta_naive};

#[derive(Debug, Deserialize)]
pub struct AddExpenseBody {
    #[serde(default, deserialize_with = "de_opt_f64")]
    pub amount: Option<f64>,
    pub description: Option<String>,
    pub date: Option<String>,
}

pub async fn add_expense(
    State(state): State<AppState>,
    AuthUser(auth_user): AuthUser,
    Json(body): Json<AddExpenseBody>,
) -> AppResult<(StatusCode, Json<Value>)> {
    require_bendahara(&auth_user)?;

    let (Some(amount), Some(description), Some(date_str)) =
        (body.amount, body.description, body.date)
    else {
        return Err(AppError::bad_request(
            "Semua field (amount, description, date) wajib diisi.",
        ));
    };

    if description.trim().is_empty() || date_str.trim().is_empty() {
        return Err(AppError::bad_request(
            "Semua field (amount, description, date) wajib diisi.",
        ));
    }

    let now_jkt = now_jakarta_naive();
    let res = sqlx::query(
        "INSERT INTO kas_expenses (amount, description, date, created_by, created_at) VALUES (?, ?, ?, ?, ?)",
    )
    .bind(amount)
    .bind(description.trim())
    .bind(date_str.trim())
    .bind(auth_user.id)
    .bind(now_jkt)
    .execute(&state.pool)
    .await
    .map_err(|e| AppError::internal("Terjadi kesalahan server.", e))?;

    let new_id = res.last_insert_id() as i32;
    let expense = sqlx::query_as::<_, KasExpenseRow>(
        "SELECT id, CAST(amount AS DOUBLE) AS amount, description, date, created_by, created_at FROM kas_expenses WHERE id = ?",
    )
    .bind(new_id)
    .fetch_one(&state.pool)
    .await
    .map_err(|e| AppError::internal("Terjadi kesalahan server.", e))?;

    state.cache.clear_pattern(Some("payments:total"));
    state.cache.clear_pattern(Some("dashboard:stats"));

    Ok((
        StatusCode::CREATED,
        Json(json!({
            "status": "success",
            "message": "Pengeluaran kas berhasil dicatat.",
            "data": expense.to_json()
        })),
    ))
}

#[derive(Debug, FromRow)]
struct ExpenseWithCreatorRow {
    id: i32,
    amount: f64,
    description: String,
    date: NaiveDate,
    created_by: i32,
    created_at: Option<NaiveDateTime>,
    creator_id: Option<i32>,
    creator_nama: Option<String>,
}

pub async fn get_expenses(
    State(state): State<AppState>,
    AuthUser(auth_user): AuthUser,
) -> AppResult<(StatusCode, Json<Value>)> {
    require_bendahara(&auth_user)?;

    let rows = sqlx::query_as::<_, ExpenseWithCreatorRow>(
        "SELECT e.id, CAST(e.amount AS DOUBLE) AS amount, e.description, e.date, e.created_by, e.created_at,
                u.id AS creator_id, u.nama_lengkap AS creator_nama
         FROM kas_expenses e
         LEFT JOIN users u ON e.created_by = u.id
         ORDER BY e.date DESC, e.created_at DESC",
    )
    .fetch_all(&state.pool)
    .await
    .map_err(|e| AppError::internal("Terjadi kesalahan server.", e))?;

    let items: Vec<Value> = rows
        .iter()
        .map(|r| {
            let creator = match (r.creator_id, &r.creator_nama) {
                (Some(cid), Some(cnama)) => json!({ "id": cid, "nama_lengkap": cnama }),
                _ => Value::Null,
            };
            json!({
                "id": r.id,
                "amount": r.amount,
                "description": r.description,
                "date": format_naive_date(r.date),
                "created_by": r.created_by,
                "created_at": format_opt_jakarta_dt(r.created_at),
                "creator": creator
            })
        })
        .collect();

    Ok((
        StatusCode::OK,
        Json(json!({
            "status": "success",
            "data": {
                "items": items,
                "total": items.len()
            }
        })),
    ))
}

pub async fn delete_expense(
    State(state): State<AppState>,
    AuthUser(auth_user): AuthUser,
    Path(id): Path<i32>,
) -> AppResult<(StatusCode, Json<Value>)> {
    require_bendahara(&auth_user)?;

    let existing: Option<(i32,)> =
        sqlx::query_as("SELECT id FROM kas_expenses WHERE id = ?")
            .bind(id)
            .fetch_optional(&state.pool)
            .await
            .map_err(|e| AppError::internal("Terjadi kesalahan server.", e))?;

    if existing.is_none() {
        return Err(AppError::not_found("Pengeluaran tidak ditemukan."));
    }

    sqlx::query("DELETE FROM kas_expenses WHERE id = ?")
        .bind(id)
        .execute(&state.pool)
        .await
        .map_err(|e| AppError::internal("Terjadi kesalahan server.", e))?;

    state.cache.clear_pattern(Some("payments:total"));
    state.cache.clear_pattern(Some("dashboard:stats"));

    Ok((
        StatusCode::OK,
        Json(json!({
            "status": "success",
            "message": "Pengeluaran berhasil dihapus."
        })),
    ))
}
