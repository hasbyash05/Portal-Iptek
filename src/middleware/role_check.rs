use crate::error::{AppError, AppResult};
use crate::models::UserRow;

#[allow(dead_code)]
pub fn require_admin(user: &UserRow) -> AppResult<()> {
    if user.role != "admin" {
        return Err(AppError::forbidden(
            "Akses ditolak. Endpoint ini khusus untuk role Admin.",
        ));
    }
    Ok(())
}

pub fn require_pengurus(user: &UserRow) -> AppResult<()> {
    if user.role != "pengurus" && user.role != "admin" {
        return Err(AppError::forbidden(
            "Akses ditolak. Endpoint ini khusus untuk role Pengurus / Admin.",
        ));
    }
    Ok(())
}

pub fn require_pengurus_or_admin_users(user: &UserRow) -> AppResult<()> {
    if user.role != "pengurus" && user.role != "admin" {
        return Err(AppError::forbidden(
            "Akses ditolak. Endpoint ini khusus untuk Pengurus / Admin.",
        ));
    }
    Ok(())
}

#[allow(dead_code)]
pub fn require_anggota(user: &UserRow) -> AppResult<()> {
    if user.role != "anggota" {
        return Err(AppError::forbidden(
            "Akses ditolak. Endpoint ini khusus untuk role Anggota.",
        ));
    }
    Ok(())
}

#[allow(dead_code)]
pub fn require_operasional(user: &UserRow) -> AppResult<()> {
    let div = user.divisi.as_deref().unwrap_or("").to_lowercase();
    let eligible = user.role == "admin" || (user.role == "pengurus" && div.contains("operasional"));
    if !eligible {
        return Err(AppError::forbidden(
            "Akses ditolak. Endpoint ini khusus untuk divisi Operasional / Admin.",
        ));
    }
    Ok(())
}

pub fn require_ketua_wakil(user: &UserRow) -> AppResult<()> {
    let div = user.divisi.as_deref().unwrap_or("").to_lowercase();
    let eligible = user.role == "admin"
        || (user.role == "pengurus" && (div.contains("ketua") || div.contains("wakil")));
    if !eligible {
        return Err(AppError::forbidden(
            "Akses ditolak. Endpoint ini khusus untuk Ketua, Wakil Ketua / Admin.",
        ));
    }
    Ok(())
}

pub fn require_ketua(user: &UserRow) -> AppResult<()> {
    let div = user.divisi.as_deref().unwrap_or("").to_lowercase();
    let eligible = user.role == "admin"
        || (user.role == "pengurus" && div.contains("ketua") && !div.contains("wakil"));
    if !eligible {
        return Err(AppError::forbidden(
            "Akses ditolak. Hanya Ketua UKM / Admin yang dapat mengubah mode presensi.",
        ));
    }
    Ok(())
}

pub fn require_bendahara(user: &UserRow) -> AppResult<()> {
    let div = user.divisi.as_deref().unwrap_or("").to_lowercase();
    let eligible = user.role == "admin" || (user.role == "pengurus" && div.contains("bendahara"));
    if !eligible {
        return Err(AppError::forbidden(
            "Akses ditolak. Endpoint ini khusus untuk Bendahara / Admin.",
        ));
    }
    Ok(())
}

pub fn is_bendahara_only(user: &UserRow) -> bool {
    let div = user.divisi.as_deref().unwrap_or("").to_lowercase();
    user.role == "pengurus" && div.contains("bendahara")
}

pub fn is_kas_exempt(user: &UserRow) -> bool {
    user.role == "admin" || is_bendahara_only(user)
}
