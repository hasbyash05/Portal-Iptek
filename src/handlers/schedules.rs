use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::Response,
    Json,
};
use chrono::{NaiveDate, NaiveDateTime};
use serde::Deserialize;
use serde_json::{json, Value};
use sqlx::FromRow;
use std::collections::HashMap;

use crate::error::{AppError, AppResult};
use crate::middleware::auth::AuthUser;
use crate::middleware::cache::MemoryCache;
use crate::middleware::role_check::require_pengurus;
use crate::models::{de_opt_i32, de_opt_string_or_int};
use crate::state::AppState;
use crate::utils::date_helper::{format_naive_date, format_opt_jakarta_dt, now_jakarta_naive};

#[derive(Debug, Deserialize)]
pub struct CreateScheduleBody {
    pub date: Option<String>,
    pub topic: Option<String>,
    pub description: Option<String>,
    #[serde(default, deserialize_with = "de_opt_string_or_int")]
    pub instructor_id: Option<String>,
    pub instructor_name: Option<String>,
}

#[derive(Debug, FromRow)]
struct ScheduleJoinedRow {
    id: i32,
    date: NaiveDate,
    topic: String,
    description: Option<String>,
    instructor_id: Option<i32>,
    instructor_name: Option<String>,
    material_id: Option<i32>,
    created_by: i32,
    created_at: Option<NaiveDateTime>,
    inst_id: Option<i32>,
    inst_nama: Option<String>,
    inst_divisi: Option<String>,
    creator_id: Option<i32>,
    creator_nama: Option<String>,
    mat_id: Option<i32>,
    mat_title: Option<String>,
    mat_file_path: Option<String>,
}

fn format_schedule_row(s: &ScheduleJoinedRow, linked_materials: Option<Vec<Value>>) -> Value {
    let instructor = if let Some(iid) = s.inst_id {
        json!({
            "id": iid,
            "nama_lengkap": s.inst_nama,
            "divisi": s.inst_divisi
        })
    } else if let Some(ref iname) = s.instructor_name {
        json!({
            "id": Value::Null,
            "nama_lengkap": iname,
            "divisi": "Dosen / Pemateri Tamu"
        })
    } else {
        Value::Null
    };

    let creator = match s.creator_id {
        Some(cid) => json!({ "id": cid, "nama_lengkap": s.creator_nama }),
        None => Value::Null,
    };

    let single_mat = match s.mat_id {
        Some(mid) => Some(json!({
            "id": mid,
            "title": s.mat_title,
            "file_path": s.mat_file_path
        })),
        None => None,
    };

    let mut obj = serde_json::Map::new();
    obj.insert("id".into(), json!(s.id));
    obj.insert("date".into(), json!(format_naive_date(s.date)));
    obj.insert("topic".into(), json!(s.topic));
    obj.insert("description".into(), json!(s.description));
    obj.insert("instructor_id".into(), json!(s.instructor_id));
    obj.insert("instructor_name".into(), json!(s.instructor_name));
    obj.insert("material_id".into(), json!(s.material_id));
    obj.insert("created_by".into(), json!(s.created_by));
    obj.insert("created_at".into(), json!(format_opt_jakarta_dt(s.created_at)));
    obj.insert("instructor".into(), instructor);
    obj.insert("creator".into(), creator);
    obj.insert("material".into(), single_mat.clone().unwrap_or(Value::Null));

    if let Some(mut list) = linked_materials {
        if let Some(sm) = single_mat {
            let sm_id = sm.get("id").and_then(|v| v.as_i64());
            if !list.iter().any(|m| m.get("id").and_then(|v| v.as_i64()) == sm_id) {
                list.push(sm);
            }
        }
        obj.insert("materials".into(), json!(list));
    }

    Value::Object(obj)
}

pub async fn create_schedule(
    State(state): State<AppState>,
    AuthUser(auth_user): AuthUser,
    Json(body): Json<CreateScheduleBody>,
) -> AppResult<(StatusCode, Json<Value>)> {
    require_pengurus(&auth_user)?;

    let date = body.date.as_deref().unwrap_or("").trim();
    let topic = body.topic.as_deref().unwrap_or("").trim();
    let inst_id_str = body
        .instructor_id
        .as_deref()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty());
    let inst_name_str = body
        .instructor_name
        .as_deref()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty());

    if date.is_empty() || topic.is_empty() || (inst_id_str.is_none() && inst_name_str.is_none()) {
        return Err(AppError::bad_request(
            "Tanggal, topik, dan pemateri wajib diisi.",
        ));
    }

    let mut final_instructor_id: Option<i32> = None;
    let mut final_instructor_name: Option<String> = None;

    if let Some(id_s) = inst_id_str.filter(|s| *s != "other") {
        let parsed_id = id_s
            .parse::<i32>()
            .map_err(|_| AppError::bad_request("Pemateri yang dipilih tidak ditemukan."))?;
        let exists: Option<(i32,)> = sqlx::query_as("SELECT id FROM users WHERE id = ?")
            .bind(parsed_id)
            .fetch_optional(&state.pool)
            .await
            .map_err(|e| AppError::internal("Terjadi kesalahan saat membuat jadwal.", e))?;
        if exists.is_none() {
            return Err(AppError::bad_request(
                "Pemateri yang dipilih tidak ditemukan.",
            ));
        }
        final_instructor_id = Some(parsed_id);
    } else if let Some(name) = inst_name_str {
        final_instructor_name = Some(name.to_string());
    } else {
        return Err(AppError::bad_request("Nama pemateri wajib diisi."));
    }

    let desc = body
        .description
        .filter(|s| !s.trim().is_empty());

    let res = sqlx::query(
        "INSERT INTO teaching_schedules (date, topic, description, instructor_id, instructor_name, material_id, created_by, created_at)
         VALUES (?, ?, ?, ?, ?, NULL, ?, ?)",
    )
    .bind(date)
    .bind(topic)
    .bind(desc)
    .bind(final_instructor_id)
    .bind(&final_instructor_name)
    .bind(auth_user.id)
    .bind(now_jakarta_naive())
    .execute(&state.pool)
    .await
    .map_err(|e| AppError::internal("Terjadi kesalahan saat membuat jadwal.", e))?;

    let new_id = res.last_insert_id() as i32;
    let row = sqlx::query_as::<_, ScheduleJoinedRow>(
        "SELECT s.id, s.date, s.topic, s.description, s.instructor_id, s.instructor_name, s.material_id, s.created_by, s.created_at,
                ui.id AS inst_id, ui.nama_lengkap AS inst_nama, ui.divisi AS inst_divisi,
                uc.id AS creator_id, uc.nama_lengkap AS creator_nama,
                m.id AS mat_id, m.title AS mat_title, m.file_path AS mat_file_path
         FROM teaching_schedules s
         LEFT JOIN users ui ON s.instructor_id = ui.id
         LEFT JOIN users uc ON s.created_by = uc.id
         LEFT JOIN teaching_materials m ON s.material_id = m.id
         WHERE s.id = ?",
    )
    .bind(new_id)
    .fetch_one(&state.pool)
    .await
    .map_err(|e| AppError::internal("Terjadi kesalahan saat membuat jadwal.", e))?;

    state.cache.clear_pattern(Some("materials"));

    Ok((
        StatusCode::CREATED,
        Json(json!({
            "status": "success",
            "message": "Jadwal pertemuan berhasil dibuat.",
            "data": format_schedule_row(&row, None)
        })),
    ))
}

#[derive(Debug, FromRow)]
struct LinkedMaterialRow {
    schedule_id: i32,
    id: i32,
    title: String,
    file_path: String,
}

pub async fn get_schedules(
    State(state): State<AppState>,
    AuthUser(_user): AuthUser,
) -> AppResult<Response> {
    let cache_key = "materials:schedules".to_string();
    if let Some((status, body)) = state.cache.get(&cache_key) {
        return Ok(MemoryCache::hit_response(status, body));
    }

    let rows = sqlx::query_as::<_, ScheduleJoinedRow>(
        "SELECT s.id, s.date, s.topic, s.description, s.instructor_id, s.instructor_name, s.material_id, s.created_by, s.created_at,
                ui.id AS inst_id, ui.nama_lengkap AS inst_nama, ui.divisi AS inst_divisi,
                uc.id AS creator_id, uc.nama_lengkap AS creator_nama,
                m.id AS mat_id, m.title AS mat_title, m.file_path AS mat_file_path
         FROM teaching_schedules s
         LEFT JOIN users ui ON s.instructor_id = ui.id
         LEFT JOIN users uc ON s.created_by = uc.id
         LEFT JOIN teaching_materials m ON s.material_id = m.id
         ORDER BY s.date DESC",
    )
    .fetch_all(&state.pool)
    .await
    .map_err(|e| AppError::internal("Terjadi kesalahan saat mengambil jadwal.", e))?;

    let linked_rows = sqlx::query_as::<_, LinkedMaterialRow>(
        "SELECT sm.schedule_id, m.id, m.title, m.file_path
         FROM schedule_materials sm
         INNER JOIN teaching_materials m ON sm.material_id = m.id",
    )
    .fetch_all(&state.pool)
    .await
    .map_err(|e| AppError::internal("Terjadi kesalahan saat mengambil jadwal.", e))?;

    let mut mat_map: HashMap<i32, Vec<Value>> = HashMap::new();
    for lm in linked_rows {
        mat_map.entry(lm.schedule_id).or_default().push(json!({
            "id": lm.id,
            "title": lm.title,
            "file_path": lm.file_path
        }));
    }

    let formatted: Vec<Value> = rows
        .iter()
        .map(|s| {
            let list = mat_map.remove(&s.id).unwrap_or_default();
            format_schedule_row(s, Some(list))
        })
        .collect();

    let body = json!({
        "status": "success",
        "data": formatted
    });

    Ok(state.cache.miss_response(cache_key, StatusCode::OK, body, 30))
}

#[derive(Debug, Deserialize)]
pub struct LinkMaterialBody {
    #[serde(default, deserialize_with = "de_opt_i32")]
    pub material_id: Option<i32>,
}

pub async fn link_material(
    State(state): State<AppState>,
    AuthUser(auth_user): AuthUser,
    Path(id): Path<i32>,
    Json(body): Json<LinkMaterialBody>,
) -> AppResult<(StatusCode, Json<Value>)> {
    require_pengurus(&auth_user)?;

    let schedule_exists: Option<(i32,)> =
        sqlx::query_as("SELECT id FROM teaching_schedules WHERE id = ?")
            .bind(id)
            .fetch_optional(&state.pool)
            .await
            .map_err(|e| AppError::internal("Terjadi kesalahan saat menautkan materi.", e))?;

    if schedule_exists.is_none() {
        return Err(AppError::not_found("Jadwal tidak ditemukan."));
    }

    if let Some(material_id) = body.material_id {
        let mat_exists: Option<(i32,)> =
            sqlx::query_as("SELECT id FROM teaching_materials WHERE id = ?")
                .bind(material_id)
                .fetch_optional(&state.pool)
                .await
                .map_err(|e| AppError::internal("Terjadi kesalahan saat menautkan materi.", e))?;

        if mat_exists.is_none() {
            return Err(AppError::not_found("Materi tidak ditemukan."));
        }

        let link_exists: Option<(i32,)> = sqlx::query_as(
            "SELECT id FROM schedule_materials WHERE schedule_id = ? AND material_id = ? LIMIT 1",
        )
        .bind(id)
        .bind(material_id)
        .fetch_optional(&state.pool)
        .await
        .map_err(|e| AppError::internal("Terjadi kesalahan saat menautkan materi.", e))?;

        if link_exists.is_none() {
            sqlx::query("INSERT INTO schedule_materials (schedule_id, material_id) VALUES (?, ?)")
                .bind(id)
                .bind(material_id)
                .execute(&state.pool)
                .await
                .map_err(|e| AppError::internal("Terjadi kesalahan saat menautkan materi.", e))?;
        }

        sqlx::query("UPDATE teaching_schedules SET material_id = ? WHERE id = ?")
            .bind(material_id)
            .bind(id)
            .execute(&state.pool)
            .await
            .map_err(|e| AppError::internal("Terjadi kesalahan saat menautkan materi.", e))?;
    }

    state.cache.clear_pattern(Some("materials"));

    Ok((
        StatusCode::OK,
        Json(json!({
            "status": "success",
            "message": "Materi berhasil ditautkan ke jadwal."
        })),
    ))
}

pub async fn unlink_material(
    State(state): State<AppState>,
    AuthUser(auth_user): AuthUser,
    Path((schedule_id, material_id)): Path<(i32, i32)>,
) -> AppResult<(StatusCode, Json<Value>)> {
    require_pengurus(&auth_user)?;

    sqlx::query("DELETE FROM schedule_materials WHERE schedule_id = ? AND material_id = ?")
        .bind(schedule_id)
        .bind(material_id)
        .execute(&state.pool)
        .await
        .map_err(|e| AppError::internal("Terjadi kesalahan saat melepas tautan materi.", e))?;

    sqlx::query(
        "UPDATE teaching_schedules SET material_id = NULL WHERE id = ? AND material_id = ?",
    )
    .bind(schedule_id)
    .bind(material_id)
    .execute(&state.pool)
    .await
    .map_err(|e| AppError::internal("Terjadi kesalahan saat melepas tautan materi.", e))?;

    state.cache.clear_pattern(Some("materials"));

    Ok((
        StatusCode::OK,
        Json(json!({
            "status": "success",
            "message": "Tautan materi berhasil dilepas dari jadwal."
        })),
    ))
}

pub async fn delete_schedule(
    State(state): State<AppState>,
    AuthUser(auth_user): AuthUser,
    Path(id): Path<i32>,
) -> AppResult<(StatusCode, Json<Value>)> {
    require_pengurus(&auth_user)?;

    let exists: Option<(i32,)> = sqlx::query_as("SELECT id FROM teaching_schedules WHERE id = ?")
        .bind(id)
        .fetch_optional(&state.pool)
        .await
        .map_err(|e| AppError::internal("Terjadi kesalahan saat menghapus jadwal.", e))?;

    if exists.is_none() {
        return Err(AppError::not_found("Jadwal tidak ditemukan."));
    }

    sqlx::query("DELETE FROM teaching_schedules WHERE id = ?")
        .bind(id)
        .execute(&state.pool)
        .await
        .map_err(|e| AppError::internal("Terjadi kesalahan saat menghapus jadwal.", e))?;

    state.cache.clear_pattern(Some("materials"));

    Ok((
        StatusCode::OK,
        Json(json!({
            "status": "success",
            "message": "Jadwal pertemuan berhasil dihapus."
        })),
    ))
}

#[derive(Debug, FromRow)]
struct InstructorRow {
    id: i32,
    nama_lengkap: String,
    divisi: Option<String>,
}

pub async fn get_instructors(
    State(state): State<AppState>,
    AuthUser(_user): AuthUser,
) -> AppResult<Response> {
    let cache_key = "materials:instructors".to_string();
    if let Some((status, body)) = state.cache.get(&cache_key) {
        return Ok(MemoryCache::hit_response(status, body));
    }

    let rows = sqlx::query_as::<_, InstructorRow>(
        "SELECT id, nama_lengkap, divisi FROM users WHERE role = 'pengurus' ORDER BY nama_lengkap ASC",
    )
    .fetch_all(&state.pool)
    .await
    .map_err(|_| {
        AppError::new(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Terjadi kesalahan saat mengambil daftar pemateri.",
        )
    })?;

    let data: Vec<Value> = rows
        .iter()
        .map(|i| {
            json!({
                "id": i.id,
                "nama_lengkap": i.nama_lengkap,
                "divisi": i.divisi
            })
        })
        .collect();

    let body = json!({
        "status": "success",
        "data": data
    });

    Ok(state.cache.miss_response(cache_key, StatusCode::OK, body, 60))
}
