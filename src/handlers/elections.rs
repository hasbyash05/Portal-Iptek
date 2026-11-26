use axum::{
    extract::{ConnectInfo, Multipart, Path, State},
    http::{header, HeaderMap, StatusCode},
    Json,
};
use chrono::NaiveDateTime;
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::net::SocketAddr;

use crate::error::{AppError, AppResult};
use crate::middleware::auth::AuthUser;
use crate::middleware::role_check::require_pengurus;
use crate::models::{de_opt_i32, CandidateRow, ElectionRow, UserPublic};
use crate::state::AppState;
use crate::utils::date_helper::{
    format_jakarta_dt, format_opt_jakarta_dt, now_jakarta, now_jakarta_naive,
};
use crate::utils::upload::{
    parse_multipart_upload, resolve_public_file, ALLOWED_GENERAL_MIMES, MAX_UPLOAD_SIZE,
};

pub async fn get_active_election(
    State(state): State<AppState>,
    AuthUser(auth_user): AuthUser,
) -> AppResult<(StatusCode, Json<Value>)> {
    let existing = sqlx::query_as::<_, ElectionRow>(
        "SELECT id, judul, periode, deskripsi, status, created_by, created_at, updated_at
         FROM elections ORDER BY id DESC LIMIT 1",
    )
    .fetch_optional(&state.pool)
    .await
    .map_err(|e| {
        AppError::new(
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Gagal memuat data pemilihan: {}", e),
        )
    })?;

    let election = match existing {
        Some(el) => el,
        None => {
            let now_jkt = now_jakarta_naive();
            let res = sqlx::query(
                "INSERT INTO elections (judul, periode, deskripsi, status, created_by, created_at, updated_at)
                 VALUES (?, ?, ?, 'active', ?, ?, ?)",
            )
            .bind("Pemilihan Calon Ketua Umum UKM IPTEK")
            .bind("2026/2027")
            .bind("Musyawarah Besar & Pemilihan Ketua Umum UKM IPTEK STIKES Semarang Periode 2026/2027. Sistem E-Voting terpadu menjamin 1 Akun = 1 Suara secara jujur dan transparan.")
            .bind(auth_user.id)
            .bind(now_jkt)
            .bind(now_jkt)
            .execute(&state.pool)
            .await
            .map_err(|e| {
                AppError::new(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    format!("Gagal memuat data pemilihan: {}", e),
                )
            })?;
            let new_id = res.last_insert_id() as i32;
            sqlx::query_as::<_, ElectionRow>(
                "SELECT id, judul, periode, deskripsi, status, created_by, created_at, updated_at
                 FROM elections WHERE id = ?",
            )
            .bind(new_id)
            .fetch_one(&state.pool)
            .await
            .map_err(|e| {
                AppError::new(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    format!("Gagal memuat data pemilihan: {}", e),
                )
            })?
        }
    };

    let candidates = sqlx::query_as::<_, CandidateRow>(
        "SELECT id, election_id, nomor_urut, nama_calon, nim, prodi, visi, misi, program_unggulan, foto_url, created_at, updated_at
         FROM candidates WHERE election_id = ? ORDER BY nomor_urut ASC",
    )
    .bind(election.id)
    .fetch_all(&state.pool)
    .await
    .map_err(|e| {
        AppError::new(
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Gagal memuat data pemilihan: {}", e),
        )
    })?;

    let existing_vote: Option<(NaiveDateTime,)> = sqlx::query_as(
        "SELECT voted_at FROM votes WHERE election_id = ? AND user_id = ? LIMIT 1",
    )
    .bind(election.id)
    .bind(auth_user.id)
    .fetch_optional(&state.pool)
    .await
    .map_err(|e| {
        AppError::new(
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Gagal memuat data pemilihan: {}", e),
        )
    })?;

    let has_voted = existing_vote.is_some();
    let voted_at = existing_vote.map(|(dt,)| format_jakarta_dt(dt));
    let candidates_json: Vec<Value> = candidates.iter().map(|c| c.to_json()).collect();

    Ok((
        StatusCode::OK,
        Json(json!({
            "status": "success",
            "data": {
                "election": election.to_json(),
                "candidates": candidates_json,
                "hasVoted": has_voted,
                "votedAt": voted_at
            }
        })),
    ))
}

#[derive(Debug, Deserialize)]
pub struct CastVoteBody {
    #[serde(default, deserialize_with = "de_opt_i32")]
    pub election_id: Option<i32>,
    #[serde(default, deserialize_with = "de_opt_i32")]
    pub candidate_id: Option<i32>,
}

async fn cast_vote_inner(
    state: AppState,
    auth_user_id: i32,
    election_id_opt: Option<i32>,
    body: CastVoteBody,
    headers: HeaderMap,
    addr: SocketAddr,
) -> AppResult<(StatusCode, Json<Value>)> {
    let Some(candidate_id) = body.candidate_id else {
        return Err(AppError::bad_request(
            "Silakan pilih salah satu calon ketua umum terlebih dahulu.",
        ));
    };

    let Some(election_id) = election_id_opt.or(body.election_id) else {
        return Err(AppError::not_found("Sesi pemilihan tidak ditemukan."));
    };

    let mut tx = state.pool.begin().await.map_err(|e| {
        AppError::new(
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Gagal merekam suara: {}", e),
        )
    })?;

    let election = sqlx::query_as::<_, ElectionRow>(
        "SELECT id, judul, periode, deskripsi, status, created_by, created_at, updated_at
         FROM elections WHERE id = ?",
    )
    .bind(election_id)
    .fetch_optional(&mut *tx)
    .await
    .map_err(|e| {
        AppError::new(
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Gagal merekam suara: {}", e),
        )
    })?;

    let Some(election) = election else {
        let _ = tx.rollback().await;
        return Err(AppError::not_found("Sesi pemilihan tidak ditemukan."));
    };

    if election.status != "active" {
        let _ = tx.rollback().await;
        let msg = if election.status == "closed" {
            "Bilik suara telah ditutup. Pemilihan periode ini telah selesai."
        } else {
            "Pemilihan belum dibuka oleh panitia."
        };
        return Err(AppError::bad_request(msg));
    }

    let candidate: Option<(i32, i32, String)> = sqlx::query_as(
        "SELECT id, nomor_urut, nama_calon FROM candidates WHERE id = ? AND election_id = ?",
    )
    .bind(candidate_id)
    .bind(election.id)
    .fetch_optional(&mut *tx)
    .await
    .map_err(|e| {
        AppError::new(
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Gagal merekam suara: {}", e),
        )
    })?;

    let Some((cand_id, nomor_urut, nama_calon)) = candidate else {
        let _ = tx.rollback().await;
        return Err(AppError::not_found(
            "Calon yang dipilih tidak terdaftar dalam pemilihan ini.",
        ));
    };

    let existing_vote: Option<(i32,)> =
        sqlx::query_as("SELECT id FROM votes WHERE election_id = ? AND user_id = ? LIMIT 1")
            .bind(election.id)
            .bind(auth_user_id)
            .fetch_optional(&mut *tx)
            .await
            .map_err(|e| {
                AppError::new(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    format!("Gagal merekam suara: {}", e),
                )
            })?;

    if existing_vote.is_some() {
        let _ = tx.rollback().await;
        return Err(AppError::bad_request(
            "Anda sudah menggunakan hak suara Anda. Sistem hanya memperbolehkan 1 suara per akun.",
        ));
    }

    let ip_address = headers
        .get("x-forwarded-for")
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.split(',').next())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| addr.ip().to_string());

    let user_agent: String = headers
        .get(header::USER_AGENT)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .chars()
        .take(255)
        .collect();

    let now_jkt = now_jakarta_naive();
    let insert_res = sqlx::query(
        "INSERT INTO votes (election_id, candidate_id, user_id, voted_at, ip_address, user_agent)
         VALUES (?, ?, ?, ?, ?, ?)",
    )
    .bind(election.id)
    .bind(cand_id)
    .bind(auth_user_id)
    .bind(now_jkt)
    .bind(&ip_address)
    .bind(&user_agent)
    .execute(&mut *tx)
    .await;

    if let Err(e) = insert_res {
        let _ = tx.rollback().await;
        let err_str = e.to_string();
        if err_str.contains("Duplicate entry") || err_str.contains("1062") {
            return Err(AppError::bad_request(
                "Anda sudah tercatat memberikan suara pada pemilihan ini.",
            ));
        }
        return Err(AppError::new(
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Gagal merekam suara: {}", e),
        ));
    }

    tx.commit().await.map_err(|e| {
        AppError::new(
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Gagal merekam suara: {}", e),
        )
    })?;

    Ok((
        StatusCode::OK,
        Json(json!({
            "status": "success",
            "message": format!(
                "Suara Anda untuk Calon No. {} ({}) berhasil dicatat secara sah. Terima kasih atas partisipasi Anda!",
                nomor_urut, nama_calon
            ),
            "data": {
                "voted_at": format_jakarta_dt(now_jkt)
            }
        })),
    ))
}

pub async fn cast_vote_with_id(
    State(state): State<AppState>,
    AuthUser(auth_user): AuthUser,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Path(id): Path<i32>,
    Json(body): Json<CastVoteBody>,
) -> AppResult<(StatusCode, Json<Value>)> {
    cast_vote_inner(state, auth_user.id, Some(id), body, headers, addr).await
}

pub async fn cast_vote_no_id(
    State(state): State<AppState>,
    AuthUser(auth_user): AuthUser,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Json(body): Json<CastVoteBody>,
) -> AppResult<(StatusCode, Json<Value>)> {
    cast_vote_inner(state, auth_user.id, None, body, headers, addr).await
}

async fn get_monitoring_stats_inner(
    state: AppState,
    id_opt: Option<i32>,
) -> AppResult<(StatusCode, Json<Value>)> {
    let election = if let Some(id) = id_opt {
        sqlx::query_as::<_, ElectionRow>(
            "SELECT id, judul, periode, deskripsi, status, created_by, created_at, updated_at
             FROM elections WHERE id = ?",
        )
        .bind(id)
        .fetch_optional(&state.pool)
        .await
    } else {
        sqlx::query_as::<_, ElectionRow>(
            "SELECT id, judul, periode, deskripsi, status, created_by, created_at, updated_at
             FROM elections ORDER BY id DESC LIMIT 1",
        )
        .fetch_optional(&state.pool)
        .await
    }
    .map_err(|e| {
        AppError::new(
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Gagal memuat monitoring suara: {}", e),
        )
    })?;

    let Some(election) = election else {
        return Err(AppError::not_found("Data pemilihan tidak ditemukan."));
    };

    let (total_dpt,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM users")
        .fetch_one(&state.pool)
        .await
        .map_err(|e| {
            AppError::new(
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Gagal memuat monitoring suara: {}", e),
            )
        })?;

    let (total_voted,): (i64,) =
        sqlx::query_as("SELECT COUNT(*) FROM votes WHERE election_id = ?")
            .bind(election.id)
            .fetch_one(&state.pool)
            .await
            .map_err(|e| {
                AppError::new(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    format!("Gagal memuat monitoring suara: {}", e),
                )
            })?;

    let total_unvoted = (total_dpt - total_voted).max(0);
    let participation_rate = if total_dpt > 0 {
        (((total_voted as f64 / total_dpt as f64) * 100.0) * 10.0).round() / 10.0
    } else {
        0.0
    };

    let candidates = sqlx::query_as::<_, CandidateRow>(
        "SELECT id, election_id, nomor_urut, nama_calon, nim, prodi, visi, misi, program_unggulan, foto_url, created_at, updated_at
         FROM candidates WHERE election_id = ? ORDER BY nomor_urut ASC",
    )
    .bind(election.id)
    .fetch_all(&state.pool)
    .await
    .map_err(|e| {
        AppError::new(
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Gagal memuat monitoring suara: {}", e),
        )
    })?;

    let vote_counts: Vec<(i32, i64)> = sqlx::query_as(
        "SELECT candidate_id, COUNT(*) FROM votes WHERE election_id = ? GROUP BY candidate_id",
    )
    .bind(election.id)
    .fetch_all(&state.pool)
    .await
    .map_err(|e| {
        AppError::new(
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Gagal memuat monitoring suara: {}", e),
        )
    })?;

    let count_map: HashMap<i32, i64> = vote_counts.into_iter().collect();

    struct CandStat {
        c: CandidateRow,
        vote_count: i64,
        percentage: f64,
    }

    let stats_list: Vec<CandStat> = candidates
        .into_iter()
        .map(|c| {
            let vc = *count_map.get(&c.id).unwrap_or(&0);
            let pct = if total_voted > 0 {
                (((vc as f64 / total_voted as f64) * 100.0) * 10.0).round() / 10.0
            } else {
                0.0
            };
            CandStat {
                c,
                vote_count: vc,
                percentage: pct,
            }
        })
        .collect();

    let chart_data = json!({
        "labels": stats_list.iter().map(|s| format!("No. {} - {}", s.c.nomor_urut, s.c.nama_calon)).collect::<Vec<_>>(),
        "shortLabels": stats_list.iter().map(|s| format!("No. {}", s.c.nomor_urut)).collect::<Vec<_>>(),
        "votes": stats_list.iter().map(|s| s.vote_count).collect::<Vec<_>>(),
        "percentages": stats_list.iter().map(|s| s.percentage).collect::<Vec<_>>(),
        "colors": ["#18181b", "#3f3f46", "#71717a", "#a1a1aa", "#d4d4d8", "#27272a"]
    });

    let mut leaderboard: Vec<&CandStat> = stats_list.iter().collect();
    leaderboard.sort_by(|a, b| {
        b.vote_count
            .cmp(&a.vote_count)
            .then_with(|| a.c.nomor_urut.cmp(&b.c.nomor_urut))
    });

    let cand_to_stat_json = |s: &CandStat| {
        json!({
            "id": s.c.id,
            "nomor_urut": s.c.nomor_urut,
            "nama_calon": s.c.nama_calon,
            "nim": s.c.nim,
            "prodi": s.c.prodi,
            "visi": s.c.visi,
            "misi": s.c.misi,
            "program_unggulan": s.c.program_unggulan,
            "foto_url": s.c.foto_url,
            "vote_count": s.vote_count,
            "percentage": s.percentage
        })
    };

    let leader = if let Some(top) = leaderboard.first() {
        let runner_up = leaderboard.get(1).copied();
        let lead_margin = runner_up
            .map(|r| top.vote_count - r.vote_count)
            .unwrap_or(top.vote_count);
        let is_tie = runner_up
            .map(|r| r.vote_count == top.vote_count && top.vote_count > 0)
            .unwrap_or(false);
        let is_winner = election.status == "closed" && top.vote_count > 0 && !is_tie;

        json!({
            "id": top.c.id,
            "nomor_urut": top.c.nomor_urut,
            "nama_calon": top.c.nama_calon,
            "nim": top.c.nim,
            "prodi": top.c.prodi,
            "visi": top.c.visi,
            "misi": top.c.misi,
            "program_unggulan": top.c.program_unggulan,
            "foto_url": top.c.foto_url,
            "vote_count": top.vote_count,
            "percentage": top.percentage,
            "lead_margin": lead_margin,
            "is_tie": is_tie,
            "is_winner": is_winner
        })
    } else {
        Value::Null
    };

    let sorted_json: Vec<Value> = leaderboard.iter().map(|s| cand_to_stat_json(s)).collect();

    Ok((
        StatusCode::OK,
        Json(json!({
            "status": "success",
            "data": {
                "election": election.to_json(),
                "stats": {
                    "total_dpt": total_dpt,
                    "total_voted": total_voted,
                    "total_unvoted": total_unvoted,
                    "participation_rate": participation_rate
                },
                "candidates": sorted_json,
                "leader": leader,
                "chart_data": chart_data,
                "last_updated": now_jakarta().to_rfc3339()
            }
        })),
    ))
}

pub async fn get_monitoring_stats_no_id(
    State(state): State<AppState>,
    AuthUser(_user): AuthUser,
) -> AppResult<(StatusCode, Json<Value>)> {
    get_monitoring_stats_inner(state, None).await
}

pub async fn get_monitoring_stats_with_id(
    State(state): State<AppState>,
    AuthUser(_user): AuthUser,
    Path(id): Path<i32>,
) -> AppResult<(StatusCode, Json<Value>)> {
    get_monitoring_stats_inner(state, Some(id)).await
}

pub async fn add_candidate(
    State(state): State<AppState>,
    AuthUser(auth_user): AuthUser,
    Path(election_id): Path<i32>,
    multipart: Multipart,
) -> AppResult<(StatusCode, Json<Value>)> {
    require_pengurus(&auth_user)?;

    let parsed = parse_multipart_upload(
        multipart,
        "public/uploads/candidates",
        Some("candidate_photo"),
        ALLOWED_GENERAL_MIMES,
        "Tipe file tidak diizinkan. Hanya PDF, PPT, MP4, JPEG, PNG, dan WebP.",
        MAX_UPLOAD_SIZE,
        1,
        None,
    )
    .await?;

    let nomor_str = parsed
        .fields
        .get("nomor_urut")
        .map(|s| s.trim())
        .unwrap_or("");
    let nama_calon = parsed
        .fields
        .get("nama_calon")
        .map(|s| s.trim())
        .unwrap_or("");
    let visi = parsed.fields.get("visi").map(|s| s.trim()).unwrap_or("");
    let misi = parsed.fields.get("misi").map(|s| s.trim()).unwrap_or("");

    if nomor_str.is_empty() || nama_calon.is_empty() || visi.is_empty() || misi.is_empty() {
        return Err(AppError::bad_request(
            "Nomor urut, nama calon, visi, dan misi wajib diisi.",
        ));
    }

    let nomor_urut: i32 = nomor_str
        .parse()
        .map_err(|_| AppError::bad_request("Nomor urut harus berupa angka."))?;

    let el_exists: Option<(i32,)> = sqlx::query_as("SELECT id FROM elections WHERE id = ?")
        .bind(election_id)
        .fetch_optional(&state.pool)
        .await
        .map_err(|e| {
            AppError::new(
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Gagal menambahkan calon: {}", e),
            )
        })?;

    if el_exists.is_none() {
        return Err(AppError::not_found("Sesi pemilihan tidak ditemukan."));
    }

    let dup: Option<(String,)> = sqlx::query_as(
        "SELECT nama_calon FROM candidates WHERE election_id = ? AND nomor_urut = ? LIMIT 1",
    )
    .bind(election_id)
    .bind(nomor_urut)
    .fetch_optional(&state.pool)
    .await
    .map_err(|e| {
        AppError::new(
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Gagal menambahkan calon: {}", e),
        )
    })?;

    if let Some((ex_name,)) = dup {
        return Err(AppError::bad_request(format!(
            "Nomor urut {} sudah digunakan oleh calon {}.",
            nomor_urut, ex_name
        )));
    }

    let nim = parsed
        .fields
        .get("nim")
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());
    let prodi = parsed
        .fields
        .get("prodi")
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());
    let program_unggulan = parsed
        .fields
        .get("program_unggulan")
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());
    let foto_url = parsed
        .files
        .into_iter()
        .next()
        .map(|f| format!("/uploads/candidates/{}", f.filename));

    let now_jkt = now_jakarta_naive();
    let res = sqlx::query(
        "INSERT INTO candidates (election_id, nomor_urut, nama_calon, nim, prodi, visi, misi, program_unggulan, foto_url, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(election_id)
    .bind(nomor_urut)
    .bind(nama_calon)
    .bind(&nim)
    .bind(&prodi)
    .bind(visi)
    .bind(misi)
    .bind(&program_unggulan)
    .bind(&foto_url)
    .bind(now_jkt)
    .bind(now_jkt)
    .execute(&state.pool)
    .await
    .map_err(|e| {
        AppError::new(
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Gagal menambahkan calon: {}", e),
        )
    })?;

    let new_id = res.last_insert_id() as i32;
    let candidate = sqlx::query_as::<_, CandidateRow>(
        "SELECT id, election_id, nomor_urut, nama_calon, nim, prodi, visi, misi, program_unggulan, foto_url, created_at, updated_at
         FROM candidates WHERE id = ?",
    )
    .bind(new_id)
    .fetch_one(&state.pool)
    .await
    .map_err(|e| {
        AppError::new(
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Gagal menambahkan calon: {}", e),
        )
    })?;

    Ok((
        StatusCode::CREATED,
        Json(json!({
            "status": "success",
            "message": format!("Calon No. {} ({}) berhasil didaftarkan.", candidate.nomor_urut, candidate.nama_calon),
            "data": candidate.to_json()
        })),
    ))
}

pub async fn update_candidate(
    State(state): State<AppState>,
    AuthUser(auth_user): AuthUser,
    Path(candidate_id): Path<i32>,
    multipart: Multipart,
) -> AppResult<(StatusCode, Json<Value>)> {
    require_pengurus(&auth_user)?;

    let parsed = parse_multipart_upload(
        multipart,
        "public/uploads/candidates",
        Some("candidate_photo"),
        ALLOWED_GENERAL_MIMES,
        "Tipe file tidak diizinkan. Hanya PDF, PPT, MP4, JPEG, PNG, dan WebP.",
        MAX_UPLOAD_SIZE,
        1,
        None,
    )
    .await?;

    let candidate = sqlx::query_as::<_, CandidateRow>(
        "SELECT id, election_id, nomor_urut, nama_calon, nim, prodi, visi, misi, program_unggulan, foto_url, created_at, updated_at
         FROM candidates WHERE id = ?",
    )
    .bind(candidate_id)
    .fetch_optional(&state.pool)
    .await
    .map_err(|e| {
        AppError::new(
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Gagal memperbarui data calon: {}", e),
        )
    })?;

    let Some(mut cand) = candidate else {
        return Err(AppError::not_found("Calon tidak ditemukan."));
    };

    if let Some(nomor_str) = parsed.fields.get("nomor_urut").filter(|s| !s.trim().is_empty()) {
        if let Ok(new_no) = nomor_str.trim().parse::<i32>() {
            if new_no != cand.nomor_urut {
                let dup: Option<(i32,)> = sqlx::query_as(
                    "SELECT id FROM candidates WHERE election_id = ? AND nomor_urut = ? AND id != ? LIMIT 1",
                )
                .bind(cand.election_id)
                .bind(new_no)
                .bind(cand.id)
                .fetch_optional(&state.pool)
                .await
                .map_err(|e| {
                    AppError::new(
                        StatusCode::INTERNAL_SERVER_ERROR,
                        format!("Gagal memperbarui data calon: {}", e),
                    )
                })?;
                if dup.is_some() {
                    return Err(AppError::bad_request(format!(
                        "Nomor urut {} sudah digunakan oleh calon lain.",
                        new_no
                    )));
                }
                cand.nomor_urut = new_no;
            }
        }
    }

    if let Some(v) = parsed.fields.get("nama_calon").filter(|s| !s.trim().is_empty()) {
        cand.nama_calon = v.trim().to_string();
    }
    if let Some(v) = parsed.fields.get("nim") {
        cand.nim = if v.trim().is_empty() { None } else { Some(v.trim().to_string()) };
    }
    if let Some(v) = parsed.fields.get("prodi") {
        cand.prodi = if v.trim().is_empty() { None } else { Some(v.trim().to_string()) };
    }
    if let Some(v) = parsed.fields.get("visi").filter(|s| !s.trim().is_empty()) {
        cand.visi = v.trim().to_string();
    }
    if let Some(v) = parsed.fields.get("misi").filter(|s| !s.trim().is_empty()) {
        cand.misi = v.trim().to_string();
    }
    if let Some(v) = parsed.fields.get("program_unggulan") {
        cand.program_unggulan = if v.trim().is_empty() { None } else { Some(v.trim().to_string()) };
    }

    if let Some(file) = parsed.files.into_iter().next() {
        if let Some(ref old_url) = cand.foto_url {
            let old_path = resolve_public_file(old_url);
            if old_path.exists() {
                let _ = tokio::fs::remove_file(&old_path).await;
            }
        }
        cand.foto_url = Some(format!("/uploads/candidates/{}", file.filename));
    }

    let now_jkt = now_jakarta_naive();
    sqlx::query(
        "UPDATE candidates
         SET nomor_urut = ?, nama_calon = ?, nim = ?, prodi = ?, visi = ?, misi = ?, program_unggulan = ?, foto_url = ?, updated_at = ?
         WHERE id = ?",
    )
    .bind(cand.nomor_urut)
    .bind(&cand.nama_calon)
    .bind(&cand.nim)
    .bind(&cand.prodi)
    .bind(&cand.visi)
    .bind(&cand.misi)
    .bind(&cand.program_unggulan)
    .bind(&cand.foto_url)
    .bind(now_jkt)
    .bind(cand.id)
    .execute(&state.pool)
    .await
    .map_err(|e| {
        AppError::new(
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Gagal memperbarui data calon: {}", e),
        )
    })?;

    cand.updated_at = Some(now_jkt);

    Ok((
        StatusCode::OK,
        Json(json!({
            "status": "success",
            "message": format!("Data Calon No. {} berhasil diperbarui.", cand.nomor_urut),
            "data": cand.to_json()
        })),
    ))
}

pub async fn delete_candidate(
    State(state): State<AppState>,
    AuthUser(auth_user): AuthUser,
    Path(candidate_id): Path<i32>,
) -> AppResult<(StatusCode, Json<Value>)> {
    require_pengurus(&auth_user)?;

    let row: Option<(i32, String, Option<String>)> =
        sqlx::query_as("SELECT nomor_urut, nama_calon, foto_url FROM candidates WHERE id = ?")
            .bind(candidate_id)
            .fetch_optional(&state.pool)
            .await
            .map_err(|e| {
                AppError::new(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    format!("Gagal menghapus calon: {}", e),
                )
            })?;

    let Some((nomor_urut, nama_calon, foto_url)) = row else {
        return Err(AppError::not_found("Calon tidak ditemukan."));
    };

    if let Some(ref old_url) = foto_url {
        let old_path = resolve_public_file(old_url);
        if old_path.exists() {
            let _ = tokio::fs::remove_file(&old_path).await;
        }
    }

    sqlx::query("DELETE FROM votes WHERE candidate_id = ?")
        .bind(candidate_id)
        .execute(&state.pool)
        .await
        .map_err(|e| {
            AppError::new(
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Gagal menghapus calon: {}", e),
            )
        })?;

    sqlx::query("DELETE FROM candidates WHERE id = ?")
        .bind(candidate_id)
        .execute(&state.pool)
        .await
        .map_err(|e| {
            AppError::new(
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Gagal menghapus calon: {}", e),
            )
        })?;

    Ok((
        StatusCode::OK,
        Json(json!({
            "status": "success",
            "message": format!("Calon No. {} ({}) berhasil dihapus.", nomor_urut, nama_calon)
        })),
    ))
}

pub async fn update_election_status(
    State(state): State<AppState>,
    AuthUser(auth_user): AuthUser,
    Path(election_id): Path<i32>,
    Json(body): Json<Value>,
) -> AppResult<(StatusCode, Json<Value>)> {
    require_pengurus(&auth_user)?;

    let Some(map) = body.as_object() else {
        return Err(AppError::bad_request(
            "Data pembaruan tidak valid atau kosong.",
        ));
    };
    if map.is_empty() {
        return Err(AppError::bad_request(
            "Data pembaruan tidak valid atau kosong.",
        ));
    }

    let election = sqlx::query_as::<_, ElectionRow>(
        "SELECT id, judul, periode, deskripsi, status, created_by, created_at, updated_at
         FROM elections WHERE id = ?",
    )
    .bind(election_id)
    .fetch_optional(&state.pool)
    .await
    .map_err(|e| {
        AppError::new(
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Gagal memperbarui status pemilihan: {}", e),
        )
    })?;

    let Some(mut el) = election else {
        return Err(AppError::not_found("Pemilihan tidak ditemukan."));
    };

    if let Some(st) = map.get("status").and_then(|v| v.as_str()) {
        let clean = st.trim().to_lowercase();
        if matches!(clean.as_str(), "draft" | "active" | "closed") {
            el.status = clean;
        }
    }
    if let Some(j) = map.get("judul").and_then(|v| v.as_str()) {
        if !j.trim().is_empty() {
            el.judul = j.trim().to_string();
        }
    }
    if let Some(p) = map.get("periode").and_then(|v| v.as_str()) {
        if !p.trim().is_empty() {
            el.periode = p.trim().to_string();
        }
    }
    if let Some(d_val) = map.get("deskripsi") {
        el.deskripsi = d_val
            .as_str()
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty());
    }

    let now_jkt = now_jakarta_naive();
    sqlx::query(
        "UPDATE elections SET status = ?, judul = ?, periode = ?, deskripsi = ?, updated_at = ? WHERE id = ?",
    )
    .bind(&el.status)
    .bind(&el.judul)
    .bind(&el.periode)
    .bind(&el.deskripsi)
    .bind(now_jkt)
    .bind(el.id)
    .execute(&state.pool)
    .await
    .map_err(|e| {
        AppError::new(
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Gagal memperbarui status pemilihan: {}", e),
        )
    })?;

    el.updated_at = Some(now_jkt);

    let status_text = match el.status.as_str() {
        "active" => "dibuka untuk pemungutan suara",
        "closed" => "ditutup secara resmi",
        "draft" => "disimpan sebagai draft",
        _ => "diperbarui",
    };

    Ok((
        StatusCode::OK,
        Json(json!({
            "status": "success",
            "message": format!("Status pemilihan berhasil {}.", status_text),
            "data": el.to_json()
        })),
    ))
}

pub async fn get_voters_audit(
    State(state): State<AppState>,
    AuthUser(auth_user): AuthUser,
    Path(election_id): Path<i32>,
) -> AppResult<(StatusCode, Json<Value>)> {
    require_pengurus(&auth_user)?;

    let el_exists: Option<(i32,)> = sqlx::query_as("SELECT id FROM elections WHERE id = ?")
        .bind(election_id)
        .fetch_optional(&state.pool)
        .await
        .map_err(|e| {
            AppError::new(
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Gagal memuat data audit pemilih: {}", e),
            )
        })?;

    if el_exists.is_none() {
        return Err(AppError::not_found("Pemilihan tidak ditemukan."));
    }

    let users = sqlx::query_as::<_, UserPublic>(
        "SELECT id, username, nama_lengkap, role, divisi FROM users ORDER BY role ASC, nama_lengkap ASC",
    )
    .fetch_all(&state.pool)
    .await
    .map_err(|e| {
        AppError::new(
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Gagal memuat data audit pemilih: {}", e),
        )
    })?;

    let votes: Vec<(i32, NaiveDateTime)> =
        sqlx::query_as("SELECT user_id, voted_at FROM votes WHERE election_id = ?")
            .bind(election_id)
            .fetch_all(&state.pool)
            .await
            .map_err(|e| {
                AppError::new(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    format!("Gagal memuat data audit pemilih: {}", e),
                )
            })?;

    let total_voted = votes.len();
    let vote_map: HashMap<i32, NaiveDateTime> = votes.into_iter().collect();

    let voters_list: Vec<Value> = users
        .iter()
        .map(|u| {
            let voted_dt = vote_map.get(&u.id).copied();
            json!({
                "id": u.id,
                "username": u.username,
                "nama_lengkap": u.nama_lengkap,
                "role": u.role,
                "divisi": u.divisi,
                "has_voted": voted_dt.is_some(),
                "voted_at": format_opt_jakarta_dt(voted_dt)
            })
        })
        .collect();

    let total_dpt = voters_list.len();
    let total_unvoted = total_dpt.saturating_sub(total_voted);

    Ok((
        StatusCode::OK,
        Json(json!({
            "status": "success",
            "data": {
                "stats": {
                    "total_dpt": total_dpt,
                    "total_voted": total_voted,
                    "total_unvoted": total_unvoted
                },
                "voters": voters_list
            }
        })),
    ))
}

pub async fn reset_election_votes(
    State(state): State<AppState>,
    AuthUser(auth_user): AuthUser,
    Path(election_id): Path<i32>,
) -> AppResult<(StatusCode, Json<Value>)> {
    require_pengurus(&auth_user)?;

    let el_exists: Option<(i32,)> = sqlx::query_as("SELECT id FROM elections WHERE id = ?")
        .bind(election_id)
        .fetch_optional(&state.pool)
        .await
        .map_err(|e| {
            AppError::new(
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Gagal mereset perolehan suara: {}", e),
            )
        })?;

    if el_exists.is_none() {
        return Err(AppError::not_found("Pemilihan tidak ditemukan."));
    }

    let res = sqlx::query("DELETE FROM votes WHERE election_id = ?")
        .bind(election_id)
        .execute(&state.pool)
        .await
        .map_err(|e| {
            AppError::new(
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Gagal mereset perolehan suara: {}", e),
            )
        })?;

    Ok((
        StatusCode::OK,
        Json(json!({
            "status": "success",
            "message": format!("Seluruh perolehan suara ({} suara) berhasil direset ke nol.", res.rows_affected())
        })),
    ))
}
