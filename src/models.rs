use chrono::{NaiveDate, NaiveDateTime};
use serde::{Deserialize, Deserializer, Serialize};
use sqlx::FromRow;

use crate::utils::date_helper::{format_jakarta_dt, format_naive_date, format_opt_jakarta_dt};

// ---- Flexible Deserializers (accept both JSON string and JSON number) ----

pub fn de_opt_i32<'de, D>(deserializer: D) -> Result<Option<i32>, D::Error>
where
    D: Deserializer<'de>,
{
    let val: Option<serde_json::Value> = Option::deserialize(deserializer)?;
    match val {
        None | Some(serde_json::Value::Null) => Ok(None),
        Some(serde_json::Value::Number(n)) => n
            .as_i64()
            .map(|v| Some(v as i32))
            .ok_or_else(|| serde::de::Error::custom("invalid integer")),
        Some(serde_json::Value::String(s)) => {
            let t = s.trim();
            if t.is_empty() {
                Ok(None)
            } else {
                t.parse::<i32>()
                    .map(Some)
                    .map_err(|_| serde::de::Error::custom("invalid integer string"))
            }
        }
        _ => Err(serde::de::Error::custom("expected integer or string")),
    }
}

pub fn de_opt_f64<'de, D>(deserializer: D) -> Result<Option<f64>, D::Error>
where
    D: Deserializer<'de>,
{
    let val: Option<serde_json::Value> = Option::deserialize(deserializer)?;
    match val {
        None | Some(serde_json::Value::Null) => Ok(None),
        Some(serde_json::Value::Number(n)) => n
            .as_f64()
            .map(Some)
            .ok_or_else(|| serde::de::Error::custom("invalid float")),
        Some(serde_json::Value::String(s)) => {
            let t = s.trim();
            if t.is_empty() {
                Ok(None)
            } else {
                t.parse::<f64>()
                    .map(Some)
                    .map_err(|_| serde::de::Error::custom("invalid float string"))
            }
        }
        _ => Err(serde::de::Error::custom("expected number or string")),
    }
}

pub fn de_opt_string_or_int<'de, D>(deserializer: D) -> Result<Option<String>, D::Error>
where
    D: Deserializer<'de>,
{
    let val: Option<serde_json::Value> = Option::deserialize(deserializer)?;
    match val {
        None | Some(serde_json::Value::Null) => Ok(None),
        Some(serde_json::Value::String(s)) => Ok(Some(s)),
        Some(serde_json::Value::Number(n)) => Ok(Some(n.to_string())),
        _ => Ok(None),
    }
}

// ---- Database Row Structs ----

#[derive(Debug, Clone, FromRow)]
pub struct UserRow {
    pub id: i32,
    pub username: String,
    pub password_hash: String,
    pub nama_lengkap: String,
    pub role: String,
    pub divisi: Option<String>,
    pub created_at: Option<NaiveDateTime>,
}

#[derive(Debug, Clone, Serialize, FromRow)]
pub struct UserPublic {
    pub id: i32,
    pub username: String,
    pub nama_lengkap: String,
    pub role: String,
    pub divisi: Option<String>,
}

#[derive(Debug, Clone, FromRow)]
pub struct AttendanceRow {
    pub id: i32,
    pub user_id: i32,
    pub date: NaiveDate,
    pub status: String,
    pub device_fingerprint: Option<String>,
    pub created_at: Option<NaiveDateTime>,
}

impl AttendanceRow {
    pub fn to_json(&self) -> serde_json::Value {
        serde_json::json!({
            "id": self.id,
            "user_id": self.user_id,
            "date": format_naive_date(self.date),
            "status": self.status,
            "device_fingerprint": self.device_fingerprint,
            "created_at": format_opt_jakarta_dt(self.created_at),
        })
    }
}

#[derive(Debug, Clone, FromRow)]
pub struct AttendanceSessionRow {
    pub id: i32,
    pub is_active: bool,
    pub activated_by: Option<i32>,
    pub activated_at: Option<NaiveDateTime>,
    pub attendance_mode: String,
}

impl AttendanceSessionRow {
    pub fn to_json(&self) -> serde_json::Value {
        serde_json::json!({
            "id": self.id,
            "is_active": self.is_active,
            "activated_by": self.activated_by,
            "activated_at": format_opt_jakarta_dt(self.activated_at),
            "attendance_mode": self.attendance_mode,
        })
    }
}

#[derive(Debug, Clone, FromRow)]
pub struct PaymentRow {
    pub id: i32,
    pub user_id: i32,
    pub amount: f64,
    pub month: i32,
    pub year: i32,
    pub proof_path: Option<String>,
    pub status: String,
    pub confirmed_by: Option<i32>,
    pub confirmed_at: Option<NaiveDateTime>,
    pub ai_status: Option<String>,
    pub ai_notes: Option<String>,
    pub sender_name_detected: Option<String>,
    pub order_id: Option<String>,
    pub unique_code: Option<i32>,
    pub payable_amount: Option<i32>,
    pub qris_dynamic: Option<String>,
    pub expires_at: Option<NaiveDateTime>,
    pub payment_channel: Option<String>,
    pub created_at: Option<NaiveDateTime>,
}

impl PaymentRow {
    pub fn to_json(&self) -> serde_json::Value {
        serde_json::json!({
            "id": self.id,
            "user_id": self.user_id,
            "amount": self.amount,
            "month": self.month,
            "year": self.year,
            "proof_path": self.proof_path,
            "status": self.status,
            "confirmed_by": self.confirmed_by,
            "confirmed_at": format_opt_jakarta_dt(self.confirmed_at),
            "ai_status": self.ai_status,
            "ai_notes": self.ai_notes,
            "sender_name_detected": self.sender_name_detected,
            "order_id": self.order_id,
            "unique_code": self.unique_code,
            "payable_amount": self.payable_amount,
            "qris_dynamic": self.qris_dynamic,
            "expires_at": format_opt_jakarta_dt(self.expires_at),
            "payment_channel": self.payment_channel,
            "created_at": format_opt_jakarta_dt(self.created_at),
        })
    }
}

#[derive(Debug, Clone, FromRow)]
pub struct KasExpenseRow {
    pub id: i32,
    pub amount: f64,
    pub description: String,
    pub date: NaiveDate,
    pub created_by: i32,
    pub created_at: Option<NaiveDateTime>,
}

impl KasExpenseRow {
    pub fn to_json(&self) -> serde_json::Value {
        serde_json::json!({
            "id": self.id,
            "amount": self.amount,
            "description": self.description,
            "date": format_naive_date(self.date),
            "created_by": self.created_by,
            "created_at": format_opt_jakarta_dt(self.created_at),
        })
    }
}

#[derive(Debug, Clone, FromRow)]
pub struct WeeklyReportRow {
    pub id: i32,
    pub user_id: i32,
    pub week_number: i32,
    pub year: i32,
    pub activity: String,
    pub attachment_path: Option<String>,
    pub submitted_at: Option<NaiveDateTime>,
}

impl WeeklyReportRow {
    pub fn to_json(&self) -> serde_json::Value {
        serde_json::json!({
            "id": self.id,
            "user_id": self.user_id,
            "week_number": self.week_number,
            "year": self.year,
            "activity": self.activity,
            "attachment_path": self.attachment_path,
            "submitted_at": format_opt_jakarta_dt(self.submitted_at),
        })
    }
}

#[derive(Debug, Clone, FromRow)]
pub struct TeachingMaterialRow {
    pub id: i32,
    pub user_id: i32,
    pub title: String,
    pub description: Option<String>,
    pub file_path: String,
    pub week_number: i32,
    pub year: i32,
    pub created_at: Option<NaiveDateTime>,
}

impl TeachingMaterialRow {
    pub fn to_json(&self) -> serde_json::Value {
        serde_json::json!({
            "id": self.id,
            "user_id": self.user_id,
            "title": self.title,
            "description": self.description,
            "file_path": self.file_path,
            "week_number": self.week_number,
            "year": self.year,
            "created_at": format_opt_jakarta_dt(self.created_at),
        })
    }
}

#[derive(Debug, Clone, FromRow)]
pub struct DocumentTemplateRow {
    pub id: i32,
    pub title: String,
    pub category: String,
    pub description: Option<String>,
    pub file_path: String,
    pub uploaded_by: i32,
    pub created_at: Option<NaiveDateTime>,
}

impl DocumentTemplateRow {
    pub fn to_json(&self) -> serde_json::Value {
        serde_json::json!({
            "id": self.id,
            "title": self.title,
            "category": self.category,
            "description": self.description,
            "file_path": self.file_path,
            "uploaded_by": self.uploaded_by,
            "created_at": format_opt_jakarta_dt(self.created_at),
        })
    }
}

#[derive(Debug, Clone, FromRow)]
pub struct ElectionRow {
    pub id: i32,
    pub judul: String,
    pub periode: String,
    pub deskripsi: Option<String>,
    pub status: String,
    pub created_by: Option<i32>,
    pub created_at: Option<NaiveDateTime>,
    pub updated_at: Option<NaiveDateTime>,
}

impl ElectionRow {
    pub fn to_json(&self) -> serde_json::Value {
        serde_json::json!({
            "id": self.id,
            "judul": self.judul,
            "periode": self.periode,
            "deskripsi": self.deskripsi,
            "status": self.status,
            "created_by": self.created_by,
            "created_at": format_opt_jakarta_dt(self.created_at),
            "updated_at": format_opt_jakarta_dt(self.updated_at),
        })
    }
}

#[derive(Debug, Clone, FromRow)]
pub struct CandidateRow {
    pub id: i32,
    pub election_id: i32,
    pub nomor_urut: i32,
    pub nama_calon: String,
    pub nim: Option<String>,
    pub prodi: Option<String>,
    pub visi: String,
    pub misi: String,
    pub program_unggulan: Option<String>,
    pub foto_url: Option<String>,
    pub created_at: Option<NaiveDateTime>,
    pub updated_at: Option<NaiveDateTime>,
}

impl CandidateRow {
    pub fn to_json(&self) -> serde_json::Value {
        serde_json::json!({
            "id": self.id,
            "election_id": self.election_id,
            "nomor_urut": self.nomor_urut,
            "nama_calon": self.nama_calon,
            "nim": self.nim,
            "prodi": self.prodi,
            "visi": self.visi,
            "misi": self.misi,
            "program_unggulan": self.program_unggulan,
            "foto_url": self.foto_url,
            "created_at": format_opt_jakarta_dt(self.created_at),
            "updated_at": format_opt_jakarta_dt(self.updated_at),
        })
    }
}

#[allow(dead_code)]
pub fn fmt_dt(dt: NaiveDateTime) -> String {
    format_jakarta_dt(dt)
}
