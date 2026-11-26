use sqlx::mysql::{MySqlConnectOptions, MySqlPoolOptions};
use sqlx::{Executor, MySqlPool};
use std::collections::HashSet;
use std::time::Duration;

use crate::config::Config;
use crate::utils::date_helper::naive_dt_to_jakarta_date_string;

pub async fn create_pool(config: &Config) -> Result<MySqlPool, sqlx::Error> {
    let opts = MySqlConnectOptions::new()
        .host(&config.db_host)
        .port(config.db_port)
        .username(&config.db_user)
        .password(&config.db_password)
        .database(&config.db_name)
        .charset("utf8mb4")
        .collation("utf8mb4_unicode_ci");

    MySqlPoolOptions::new()
        .max_connections(20)
        .acquire_timeout(Duration::from_secs(10))
        .after_connect(|conn, _meta| {
            Box::pin(async move {
                conn.execute("SET time_zone = '+07:00'").await?;
                Ok(())
            })
        })
        .connect_with(opts)
        .await
}

pub async fn ensure_tables(pool: &MySqlPool) -> Result<(), sqlx::Error> {
    let ddl_statements = [
        r#"CREATE TABLE IF NOT EXISTS `users` (
            `id` INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
            `username` VARCHAR(50) NOT NULL UNIQUE,
            `password_hash` TEXT NOT NULL,
            `nama_lengkap` VARCHAR(100) NOT NULL,
            `role` ENUM('admin','pengurus','anggota') NOT NULL,
            `divisi` VARCHAR(50) NULL,
            `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"#,
        r#"CREATE TABLE IF NOT EXISTS `weekly_reports` (
            `id` INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
            `user_id` INT NOT NULL,
            `week_number` INT NOT NULL,
            `year` INT NOT NULL,
            `activity` TEXT NOT NULL,
            `attachment_path` VARCHAR(255) NULL,
            `submitted_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            UNIQUE KEY `weekly_reports_user_week_year` (`user_id`, `week_number`, `year`),
            CONSTRAINT `fk_weekly_reports_user` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"#,
        r#"CREATE TABLE IF NOT EXISTS `teaching_materials` (
            `id` INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
            `user_id` INT NOT NULL,
            `title` VARCHAR(200) NOT NULL,
            `description` TEXT NULL,
            `file_path` VARCHAR(255) NOT NULL,
            `week_number` INT NOT NULL,
            `year` INT NOT NULL,
            `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            CONSTRAINT `fk_teaching_materials_user` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"#,
        r#"CREATE TABLE IF NOT EXISTS `attendances` (
            `id` INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
            `user_id` INT NOT NULL,
            `date` DATE NOT NULL,
            `status` ENUM('hadir','izin','sakit','alpa') NOT NULL,
            `device_fingerprint` VARCHAR(64) NULL,
            `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            UNIQUE KEY `attendances_user_id_date` (`user_id`, `date`),
            CONSTRAINT `fk_attendances_user` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"#,
        r#"CREATE TABLE IF NOT EXISTS `payments` (
            `id` INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
            `user_id` INT NOT NULL,
            `amount` DECIMAL(10,2) NOT NULL DEFAULT 10000.00,
            `month` INT NOT NULL,
            `year` INT NOT NULL,
            `proof_path` VARCHAR(255) NULL,
            `status` ENUM('pending','lunas','ditolak') NOT NULL DEFAULT 'pending',
            `confirmed_by` INT NULL,
            `confirmed_at` DATETIME NULL,
            `ai_status` VARCHAR(50) NULL DEFAULT NULL,
            `ai_notes` TEXT NULL DEFAULT NULL,
            `sender_name_detected` VARCHAR(255) NULL DEFAULT NULL,
            `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            UNIQUE KEY `payments_user_month_year` (`user_id`, `month`, `year`),
            CONSTRAINT `fk_payments_user` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
            CONSTRAINT `fk_payments_verifier` FOREIGN KEY (`confirmed_by`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"#,
        r#"CREATE TABLE IF NOT EXISTS `attendance_sessions` (
            `id` INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
            `is_active` TINYINT(1) NOT NULL DEFAULT 0,
            `activated_by` INT NULL,
            `activated_at` DATETIME NULL,
            `attendance_mode` ENUM('onsite','anywhere') NOT NULL DEFAULT 'onsite',
            CONSTRAINT `fk_attendance_sessions_activator` FOREIGN KEY (`activated_by`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"#,
        r#"CREATE TABLE IF NOT EXISTS `user_devices` (
            `id` INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
            `user_id` INT NOT NULL,
            `device_fingerprint` VARCHAR(64) NOT NULL,
            `device_info` TEXT NULL,
            `first_seen` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            `last_seen` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            UNIQUE KEY `user_devices_user_fp` (`user_id`, `device_fingerprint`),
            KEY `user_devices_fp` (`device_fingerprint`),
            CONSTRAINT `fk_user_devices_user` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"#,
        r#"CREATE TABLE IF NOT EXISTS `teaching_schedules` (
            `id` INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
            `date` DATE NOT NULL,
            `topic` VARCHAR(200) NOT NULL,
            `description` TEXT NULL,
            `instructor_id` INT NULL,
            `instructor_name` VARCHAR(150) NULL,
            `material_id` INT NULL,
            `created_by` INT NOT NULL,
            `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            CONSTRAINT `fk_teaching_schedules_instructor` FOREIGN KEY (`instructor_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
            CONSTRAINT `fk_teaching_schedules_creator` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
            CONSTRAINT `fk_teaching_schedules_material` FOREIGN KEY (`material_id`) REFERENCES `teaching_materials`(`id`) ON DELETE SET NULL ON UPDATE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"#,
        r#"CREATE TABLE IF NOT EXISTS `schedule_materials` (
            `id` INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
            `schedule_id` INT NOT NULL,
            `material_id` INT NOT NULL,
            CONSTRAINT `fk_sm_schedule` FOREIGN KEY (`schedule_id`) REFERENCES `teaching_schedules`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
            CONSTRAINT `fk_sm_material` FOREIGN KEY (`material_id`) REFERENCES `teaching_materials`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"#,
        r#"CREATE TABLE IF NOT EXISTS `kas_expenses` (
            `id` INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
            `amount` DECIMAL(10,2) NOT NULL,
            `description` VARCHAR(255) NOT NULL,
            `date` DATE NOT NULL,
            `created_by` INT NOT NULL,
            `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            CONSTRAINT `fk_kas_expenses_creator` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"#,
        r#"CREATE TABLE IF NOT EXISTS `document_templates` (
            `id` INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
            `title` VARCHAR(200) NOT NULL,
            `category` VARCHAR(100) NOT NULL,
            `description` TEXT NULL,
            `file_path` VARCHAR(255) NOT NULL,
            `uploaded_by` INT NOT NULL,
            `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            CONSTRAINT `fk_document_templates_uploader` FOREIGN KEY (`uploaded_by`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"#,
        r#"CREATE TABLE IF NOT EXISTS `certificates` (
            `id` INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
            `user_id` INT NOT NULL,
            `nama_sertifikat` VARCHAR(255) NOT NULL,
            `file_path` TEXT NOT NULL,
            `uploaded_by` INT NOT NULL,
            `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            CONSTRAINT `fk_certificates_owner` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
            CONSTRAINT `fk_certificates_uploader` FOREIGN KEY (`uploaded_by`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"#,
        r#"CREATE TABLE IF NOT EXISTS `elections` (
            `id` INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
            `judul` VARCHAR(150) NOT NULL DEFAULT 'Pemilihan Calon Ketua Umum UKM IPTEK',
            `periode` VARCHAR(50) NOT NULL DEFAULT '2026/2027',
            `deskripsi` TEXT NULL,
            `status` ENUM('draft','active','closed') NOT NULL DEFAULT 'active',
            `created_by` INT NULL,
            `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            CONSTRAINT `fk_elections_creator` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"#,
        r#"CREATE TABLE IF NOT EXISTS `candidates` (
            `id` INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
            `election_id` INT NOT NULL,
            `nomor_urut` INT NOT NULL,
            `nama_calon` VARCHAR(150) NOT NULL,
            `nim` VARCHAR(50) NULL,
            `prodi` VARCHAR(100) NULL,
            `visi` TEXT NOT NULL,
            `misi` TEXT NOT NULL,
            `program_unggulan` TEXT NULL,
            `foto_url` VARCHAR(255) NULL,
            `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            CONSTRAINT `fk_candidates_election` FOREIGN KEY (`election_id`) REFERENCES `elections`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"#,
        r#"CREATE TABLE IF NOT EXISTS `votes` (
            `id` INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
            `election_id` INT NOT NULL,
            `candidate_id` INT NOT NULL,
            `user_id` INT NOT NULL,
            `voted_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            `ip_address` VARCHAR(100) NULL,
            `user_agent` VARCHAR(255) NULL,
            UNIQUE KEY `unique_vote_per_user_election` (`election_id`, `user_id`),
            CONSTRAINT `fk_votes_election` FOREIGN KEY (`election_id`) REFERENCES `elections`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
            CONSTRAINT `fk_votes_candidate` FOREIGN KEY (`candidate_id`) REFERENCES `candidates`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
            CONSTRAINT `fk_votes_user` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"#,
    ];

    for sql in ddl_statements {
        sqlx::query(sql).execute(pool).await?;
    }
    Ok(())
}

pub async fn run_startup_maintenance(pool: &MySqlPool, config: &Config) {
    if let Err(e) = ensure_tables(pool).await {
        eprintln!("[DB WARN] Gagal memastikan tabel database: {}", e);
    } else {
        println!("[DB] Tabel database tersinkronisasi.");
    }

    // Safe migration: add attendance_mode column if missing
    match sqlx::query("SHOW COLUMNS FROM `attendance_sessions` LIKE 'attendance_mode'")
        .fetch_all(pool)
        .await
    {
        Ok(cols) if cols.is_empty() => {
            if let Err(e) = sqlx::query(
                "ALTER TABLE `attendance_sessions` ADD COLUMN `attendance_mode` ENUM('onsite','anywhere') NOT NULL DEFAULT 'onsite'",
            )
            .execute(pool)
            .await
            {
                eprintln!("[DB] Migrasi attendance_mode: {}", e);
            } else {
                println!("[DB] Kolom 'attendance_mode' berhasil ditambahkan ke tabel attendance_sessions.");
            }
        }
        Err(e) => eprintln!("[DB] Migrasi attendance_mode: {}", e),
        _ => {}
    }

    // Safe migration: add AI verification columns on payments if missing
    match sqlx::query("SHOW COLUMNS FROM `payments` LIKE 'ai_status'")
        .fetch_all(pool)
        .await
    {
        Ok(cols) if cols.is_empty() => {
            let _ = sqlx::query("ALTER TABLE `payments` ADD COLUMN `ai_status` VARCHAR(50) NULL DEFAULT NULL").execute(pool).await;
            let _ = sqlx::query("ALTER TABLE `payments` ADD COLUMN `ai_notes` TEXT NULL DEFAULT NULL").execute(pool).await;
            let _ = sqlx::query("ALTER TABLE `payments` ADD COLUMN `sender_name_detected` VARCHAR(255) NULL DEFAULT NULL").execute(pool).await;
            println!("[DB] Kolom AI verification berhasil ditambahkan ke tabel payments.");
        }
        Err(e) => eprintln!("[DB] Migrasi AI verification payments: {}", e),
        _ => {}
    }

    // In development mode, seed if users table is empty
    if config.is_development() {
        if let Ok((user_count,)) = sqlx::query_as::<_, (i64,)>("SELECT COUNT(*) FROM users")
            .fetch_one(pool)
            .await
        {
            if user_count == 0 {
                println!("[DB] Database kosong. Mengisi data awal (seeding)...");
                if let Err(e) = crate::seed::seed_database(pool, false).await {
                    eprintln!("[DB ERROR] Gagal seeding awal: {}", e);
                }
            }
        }
    } else {
        // Production startup cleanup matching src/app.js
        let _ = sqlx::query(
            "UPDATE `payments`
             SET `status` = 'ditolak',
                 `ai_status` = 'ditolak',
                 `ai_notes` = 'Ditolak otomatis: Tidak ada file gambar bukti pembayaran yang dilampirkan.'
             WHERE `status` = 'pending' AND (`proof_path` IS NULL OR `proof_path` NOT LIKE '/uploads%')",
        )
        .execute(pool)
        .await;
        println!("[DB] Auto-reject pembayaran pending tanpa bukti pembayaran selesai.");

        let _ = cleanup_garbage_sessions_internal(pool).await;
    }
}

/// Shared helper to clean duplicate/garbage attendance sessions
pub async fn cleanup_garbage_sessions_internal(pool: &MySqlPool) -> Result<usize, sqlx::Error> {
    let att_dates: Vec<(chrono::NaiveDate,)> =
        sqlx::query_as("SELECT DISTINCT `date` FROM `attendances`")
            .fetch_all(pool)
            .await?;
    let valid_dates: HashSet<String> = att_dates
        .into_iter()
        .map(|(d,)| d.format("%Y-%m-%d").to_string())
        .collect();

    if valid_dates.is_empty() {
        return Ok(0);
    }

    let sessions: Vec<(i32, Option<chrono::NaiveDateTime>, bool)> = sqlx::query_as(
        "SELECT `id`, `activated_at`, `is_active` FROM `attendance_sessions` ORDER BY `id` ASC",
    )
    .fetch_all(pool)
    .await?;

    let mut kept_ids: Vec<i32> = Vec::new();
    let mut covered: HashSet<String> = HashSet::new();

    for (id, activated_at, is_active) in &sessions {
        if *is_active {
            kept_ids.push(*id);
            continue;
        }
        if let Some(dt) = activated_at {
            let s_date = naive_dt_to_jakarta_date_string(*dt);
            if valid_dates.contains(&s_date) && !covered.contains(&s_date) {
                kept_ids.push(*id);
                covered.insert(s_date);
            }
        }
    }

    if !kept_ids.is_empty() && sessions.len() > kept_ids.len() {
        let ids_csv = kept_ids
            .iter()
            .map(|id| id.to_string())
            .collect::<Vec<_>>()
            .join(",");
        let sql = format!(
            "DELETE FROM `attendance_sessions` WHERE `id` NOT IN ({})",
            ids_csv
        );
        let res = sqlx::query(&sql).execute(pool).await?;
        let deleted = res.rows_affected() as usize;
        println!(
            "[DB] Pembersihan sesi presensi selesai. Menyisakan {} sesi pertemuan resmi.",
            kept_ids.len()
        );
        return Ok(deleted);
    }

    Ok(0)
}
