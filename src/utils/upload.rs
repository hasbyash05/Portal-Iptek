use axum::extract::Multipart;
use rand::Rng;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use crate::error::{AppError, AppResult};

pub const MAX_UPLOAD_SIZE: usize = 50 * 1024 * 1024; // 50 MB
pub const MAX_QRIS_SIZE: usize = 5 * 1024 * 1024; // 5 MB

pub const ALLOWED_GENERAL_MIMES: &[&str] = &[
    "application/pdf",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.ms-powerpoint",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "application/zip",
    "video/mp4",
    "image/jpeg",
    "image/png",
    "image/jpg",
    "image/webp",
];

pub const ALLOWED_IMAGE_MIMES: &[&str] = &["image/jpeg", "image/png", "image/jpg", "image/webp"];

#[derive(Debug, Clone)]
pub struct UploadedFile {
    #[allow(dead_code)]
    pub field_name: String,
    pub original_name: String,
    pub filename: String,
    pub disk_path: PathBuf,
    pub destination: PathBuf,
    pub size: usize,
    #[allow(dead_code)]
    pub content_type: String,
}

#[derive(Debug, Default)]
pub struct ParsedMultipart {
    pub fields: HashMap<String, String>,
    pub files: Vec<UploadedFile>,
}

pub fn get_extension(filename: &str) -> String {
    Path::new(filename)
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| format!(".{}", e))
        .unwrap_or_default()
}

pub async fn parse_multipart_upload(
    mut multipart: Multipart,
    target_folder: &str,
    expected_file_field: Option<&str>,
    allowed_mimes: &[&str],
    mime_error_msg: &str,
    max_file_size: usize,
    max_files: usize,
    fixed_base_name: Option<&str>,
) -> AppResult<ParsedMultipart> {
    let mut parsed = ParsedMultipart::default();
    let dest_dir = PathBuf::from(target_folder);

    while let Some(field) = multipart
        .next_field()
        .await
        .map_err(|e| AppError::bad_request(format!("Gagal membaca multipart form: {}", e)))?
    {
        let field_name = field.name().unwrap_or("").to_string();
        let file_name_opt = field.file_name().map(|s| s.to_string());

        if let Some(original_name) = file_name_opt {
            if original_name.is_empty() {
                continue;
            }
            if let Some(expected) = expected_file_field {
                if field_name != expected {
                    continue;
                }
            }
            if parsed.files.len() >= max_files {
                return Err(AppError::bad_request(format!(
                    "Jumlah file melebihi batas maksimal ({} file).",
                    max_files
                )));
            }

            let content_type = field
                .content_type()
                .map(|s| s.to_string())
                .unwrap_or_else(|| {
                    mime_guess::from_path(&original_name)
                        .first_or_octet_stream()
                        .to_string()
                });

            if !allowed_mimes.contains(&content_type.as_str()) {
                return Err(AppError::bad_request(mime_error_msg));
            }

            let data = field
                .bytes()
                .await
                .map_err(|e| AppError::bad_request(format!("Gagal mengunggah file: {}", e)))?;

            if data.len() > max_file_size {
                return Err(AppError::bad_request(format!(
                    "Ukuran file melebihi batas maksimal {}MB.",
                    max_file_size / (1024 * 1024)
                )));
            }

            tokio::fs::create_dir_all(&dest_dir)
                .await
                .map_err(|e| AppError::internal("Gagal membuat direktori upload.", e))?;

            let ext = get_extension(&original_name);
            let saved_filename = if let Some(base) = fixed_base_name {
                // Clean old files with same base name and different extensions
                if let Ok(mut rd) = tokio::fs::read_dir(&dest_dir).await {
                    while let Ok(Some(entry)) = rd.next_entry().await {
                        if let Some(name) = entry.file_name().to_str() {
                            if name.starts_with(base) {
                                let _ = tokio::fs::remove_file(entry.path()).await;
                            }
                        }
                    }
                }
                format!("{}{}", base, ext)
            } else {
                let now_ms = SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .map(|d| d.as_millis())
                    .unwrap_or(0);
                let rnd: u32 = rand::thread_rng().gen_range(0..1_000_000_000);
                format!("{}-{}-{}{}", field_name, now_ms, rnd, ext)
            };

            let disk_path = dest_dir.join(&saved_filename);
            tokio::fs::write(&disk_path, &data)
                .await
                .map_err(|e| AppError::internal("Gagal menyimpan file ke server.", e))?;

            parsed.files.push(UploadedFile {
                field_name,
                original_name,
                filename: saved_filename,
                disk_path,
                destination: dest_dir.clone(),
                size: data.len(),
                content_type,
            });
        } else {
            let text = field
                .text()
                .await
                .map_err(|e| AppError::bad_request(format!("Gagal membaca field form: {}", e)))?;
            parsed.fields.insert(field_name, text);
        }
    }

    Ok(parsed)
}

pub fn sanitize_filename_segment(s: &str) -> String {
    let filtered: String = s
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || c.is_whitespace())
        .collect();
    filtered
        .split_whitespace()
        .collect::<Vec<_>>()
        .join("_")
}

pub fn resolve_public_file(relative_url: &str) -> PathBuf {
    let trimmed = relative_url.trim_start_matches(['/', '\\']);
    PathBuf::from("public").join(trimmed)
}
