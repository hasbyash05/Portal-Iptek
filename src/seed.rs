use rand::Rng;
use serde::Serialize;
use sqlx::MySqlPool;
use std::collections::{HashMap, HashSet};

use crate::db::ensure_tables;
use crate::utils::date_helper::now_jakarta_naive;

const BCRYPT_COST: u32 = 10;

#[derive(Debug, Serialize)]
struct GeneratedCredential {
    role: String,
    username: String,
    password: String,
    nama_lengkap: String,
    divisi: String,
}

fn generate_random_password(length: usize) -> String {
    const CHARS: &[u8] = b"abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    let mut rng = rand::thread_rng();
    (0..length)
        .map(|_| {
            let idx = rng.gen_range(0..CHARS.len());
            CHARS[idx] as char
        })
        .collect()
}

fn fixed_passwords() -> HashMap<&'static str, &'static str> {
    HashMap::from([
        ("admin", "iptekadmin2026"),
        // Pengurus
        ("hasby", "pu5my3h8"),
        ("wafiq", "2a5hqzxg"),
        ("laelatul", "zthk6nch"),
        ("inayah", "3tzkwqtn"),
        ("arifah", "dn434c7h"),
        ("alfia", "fg99jvqe"),
        ("wenang", "9abw8psh"),
        ("khirson", "utv7xbf9"),
        ("derx", "yqx9e6m3"),
        ("zahwa", "ybdbwng5"),
        // Anggota Sub-Divisi & Anggota Umum
        ("aisha", "33m74d72"),
        ("alwan", "cx5fpz6m"),
        ("alzena", "jnyevvew"),
        ("arjun", "h8kqq9s5"),
        ("arkan", "r72a5efb"),
        ("ayu", "bb99mjue"),
        ("bangun", "jh3ms75g"),
        ("bima", "ugmwpr9d"),
        ("satria", "z6qmupua"),
        ("cheryl", "rcjuzh3k"),
        ("dika", "s94wmjkh"),
        ("arya", "zdyrrnrf"),
        ("syahputri", "r4wrs7ax"),
        ("elfrida", "hgde6p7q"),
        ("elma", "2as36rdk"),
        ("ericco", "unaysjc5"),
        ("fairuziva", "fvj42sgh"),
        ("fathurrohman", "3xumjc2m"),
        ("galih", "4k66gkjf"),
        ("gathfaan", "7dna2vjj"),
        ("hengki", "hhdpec9g"),
        ("wahyu", "ham2c6bn"),
        ("isna", "aag46vhp"),
        ("khinza", "39ey6fe4"),
        ("kusumo", "9epvvh7g"),
        ("leissiano", "6hsfhzpf"),
        ("malik", "hq52qjfr"),
        ("kaprasia", "sdz9d82f"),
        ("arif", "fpj8kkmg"),
        ("gibran", "496tsu32"),
        ("yusuf", "abjpq2p7"),
        ("zufar", "64hjdy92"),
        ("qotrunnada", "p6k9dq6c"),
        ("najwa", "42ec35th"),
        ("naurah", "6u6xp9jq"),
        ("nazwa", "c265bs4a"),
        ("nova", "n4ggd7dg"),
        ("oktavianus", "w5crts74"),
        ("petrus", "udpw23wv"),
        ("zamharira", "389t74wx"),
        ("rayhan", "5yh28hm6"),
        ("refta", "wutj298f"),
        ("resendriya", "d75t88pm"),
        ("riyan", "f6w9ruqt"),
        ("safril", "y6yhtv52"),
        ("vivid", "wgr4mdk9"),
        ("wildan", "5vygmnxm"),
        ("xenia", "jntezvjg"),
        ("yasinta", "4k5vx6kv"),
        ("zulfikar", "7kfq4sfd"),
    ])
}

fn generate_username_from_name(nama: &str, existing: &mut HashSet<String>) -> String {
    let ignore_prefixes = [
        "muhammad", "m", "i", "dwi", "maria", "putri", "gusti", "made",
    ];
    let clean: String = nama
        .to_lowercase()
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || c.is_whitespace())
        .collect();
    let words: Vec<&str> = clean.split_whitespace().collect();

    let mut candidate = String::new();
    for w in &words {
        if !ignore_prefixes.contains(w) && w.len() >= 3 && !existing.contains(*w) {
            candidate = (*w).to_string();
            break;
        }
    }

    if candidate.is_empty() && !words.is_empty() && !existing.contains(words[0]) {
        candidate = words[0].to_string();
    }

    if candidate.is_empty() || existing.contains(&candidate) {
        let combined: String = words.iter().take(2).copied().collect();
        if !combined.is_empty() && !existing.contains(&combined) {
            candidate = combined;
        } else {
            let base = words.first().copied().unwrap_or("user");
            let mut num = 1usize;
            while existing.contains(&format!("{}{}", base, num)) {
                num += 1;
            }
            candidate = format!("{}{}", base, num);
        }
    }

    existing.insert(candidate.clone());
    candidate
}

pub async fn seed_database(pool: &MySqlPool, force_reset: bool) -> Result<(), String> {
    println!("[INFO] Menghubungkan ke database...");

    if force_reset {
        println!("[INFO] Membuat ulang tabel (Force Reset)...");
        sqlx::query("SET FOREIGN_KEY_CHECKS = 0")
            .execute(pool)
            .await
            .map_err(|e| e.to_string())?;
        let tables = [
            "votes",
            "candidates",
            "elections",
            "certificates",
            "document_templates",
            "kas_expenses",
            "schedule_materials",
            "teaching_schedules",
            "user_devices",
            "attendance_sessions",
            "payments",
            "attendances",
            "teaching_materials",
            "weekly_reports",
            "users",
        ];
        for tbl in tables {
            sqlx::query(&format!("DROP TABLE IF EXISTS `{}`", tbl))
                .execute(pool)
                .await
                .map_err(|e| e.to_string())?;
        }
        sqlx::query("SET FOREIGN_KEY_CHECKS = 1")
            .execute(pool)
            .await
            .map_err(|e| e.to_string())?;
    }

    ensure_tables(pool).await.map_err(|e| e.to_string())?;

    println!("[INFO] Membuat akun user resmi UKM IPTEK STIKES Semarang...");
    let fixed = fixed_passwords();
    let mut generated_credentials: Vec<GeneratedCredential> = Vec::new();
    let now_jkt = now_jakarta_naive();

    // 0. Admin
    let admin_pass = fixed
        .get("admin")
        .map(|s| (*s).to_string())
        .unwrap_or_else(|| generate_random_password(10));
    let admin_hash = bcrypt::hash(&admin_pass, BCRYPT_COST).map_err(|e| e.to_string())?;
    sqlx::query(
        "INSERT INTO users (username, password_hash, nama_lengkap, role, divisi, created_at)
         VALUES ('admin', ?, 'System Administrator', 'admin', NULL, ?)",
    )
    .bind(&admin_hash)
    .bind(now_jkt)
    .execute(pool)
    .await
    .map_err(|e| e.to_string())?;

    generated_credentials.push(GeneratedCredential {
        nama_lengkap: "System Administrator".to_string(),
        username: "admin".to_string(),
        password: admin_pass,
        role: "admin".to_string(),
        divisi: "-".to_string(),
    });

    // 1. Pengurus
    let daftar_pengurus = [
        ("hasby", "Muhammad Hasby Ash Shidiqy Pua Rangga", "Ketua"),
        ("wafiq", "Muhammad Wafiq Gheraeldy", "Wakil Ketua"),
        ("laelatul", "Laelatul Faridah", "Sekretaris"),
        ("inayah", "Inayah Mahardika", "Sekretaris"),
        ("arifah", "Arifah Naufali", "Bendahara"),
        ("alfia", "Alfia Rizka Putri Permana", "Bendahara"),
        ("wenang", "Wenang Amin Mahardika (Koordinator)", "Operasional"),
        (
            "khirson",
            "Muhammad Khirson Afu Asofu (Koordinator)",
            "Komunikasi dan Informasi",
        ),
        ("derx", "Derx Oktavianus Siwabessy (Koordinator)", "Perlengkapan"),
        ("zahwa", "Zahwa Rizqi Nurjanah (Koordinator)", "Humas"),
    ];

    let mut existing_usernames: HashSet<String> = HashSet::new();
    existing_usernames.insert("admin".to_string());

    for (uname, nama, divisi) in daftar_pengurus {
        existing_usernames.insert(uname.to_string());
        let pass = fixed
            .get(uname)
            .map(|s| (*s).to_string())
            .unwrap_or_else(|| generate_random_password(8));
        let hash = bcrypt::hash(&pass, BCRYPT_COST).map_err(|e| e.to_string())?;
        sqlx::query(
            "INSERT INTO users (username, password_hash, nama_lengkap, role, divisi, created_at)
             VALUES (?, ?, ?, 'pengurus', ?, ?)",
        )
        .bind(uname)
        .bind(&hash)
        .bind(nama)
        .bind(divisi)
        .bind(now_jkt)
        .execute(pool)
        .await
        .map_err(|e| e.to_string())?;

        generated_credentials.push(GeneratedCredential {
            role: "Pengurus".to_string(),
            username: uname.to_string(),
            password: pass,
            nama_lengkap: nama.to_string(),
            divisi: divisi.to_string(),
        });
    }

    // 2. Anggota Sub-Divisi
    let daftar_anggota_divisi = [
        ("Muhammad Gibran Muhson", "Operasional"),
        ("Naurah Faadhilah Meska", "Operasional"),
        ("Wildan Samudra Nur Mahdi", "Operasional"),
        ("I Gusti Made Wahyu Wardana", "Operasional"),
        ("Nova Sheila Rahmawati", "Operasional"),
        ("Aisha Cheryl Amelia", "Komunikasi dan Informasi"),
        ("Riyan Abdul Aziz", "Komunikasi dan Informasi"),
        ("Dwi Syahputri Ramadhani", "Komunikasi dan Informasi"),
        ("Vivid Puspita Yhulyana Sari", "Komunikasi dan Informasi"),
        ("Kusumo Harjo", "Perlengkapan"),
        ("Dika Bambang Hendriana", "Perlengkapan"),
        ("Malik Athallah Zain", "Perlengkapan"),
        ("Khinza Nur Riyadthus Solikhin", "Perlengkapan"),
        ("Cheryl Asfy", "Perlengkapan"),
        ("Gathfaan Zafran Putra Dianggra", "Perlengkapan"),
        ("Resendriya Labib Arzani", "Perlengkapan"),
        ("Dwi Arya Wirana", "Perlengkapan"),
        ("Arjun Cipto Nugroho", "Perlengkapan"),
        ("Yasinta Anggun Rahmawati", "Humas"),
        ("Xenia Fatwa Dzi Fadlillah", "Humas"),
        ("Safril Sarifudin", "Humas"),
        ("Muhammad Arif Fadlur Rahman", "Humas"),
    ];

    for (nama, divisi) in daftar_anggota_divisi {
        let username = generate_username_from_name(nama, &mut existing_usernames);
        let pass = fixed
            .get(username.as_str())
            .map(|s| (*s).to_string())
            .unwrap_or_else(|| generate_random_password(8));
        let hash = bcrypt::hash(&pass, BCRYPT_COST).map_err(|e| e.to_string())?;
        sqlx::query(
            "INSERT INTO users (username, password_hash, nama_lengkap, role, divisi, created_at)
             VALUES (?, ?, ?, 'anggota', ?, ?)",
        )
        .bind(&username)
        .bind(&hash)
        .bind(nama)
        .bind(divisi)
        .bind(now_jkt)
        .execute(pool)
        .await
        .map_err(|e| e.to_string())?;

        generated_credentials.push(GeneratedCredential {
            role: "Anggota".to_string(),
            username,
            password: pass,
            nama_lengkap: nama.to_string(),
            divisi: divisi.to_string(),
        });
    }

    // 3. Anggota Umum
    let daftar_anggota = [
        "Bima Pratama Putra (Koordinator)",
        "Alwan Aziz Habibi",
        "Alzena Naura Mezzaluna",
        "Arkan Faizul Haq",
        "Ayu Bening Devina Sari",
        "Bangun Vionata",
        "Bima Satria Pamungkas",
        "Elfrida Agnesia Klau",
        "Elma Landak",
        "Fathurrohman",
        "Fairuziva Sofinatha Mahendra",
        "Galih Ridho S",
        "Hengki Bagaskara",
        "Isna Anisauzzalfa",
        "Leissiano Arya Firmansyah",
        "Maria Kaprasia Wasi Baun",
        "Muhammad Zufar Ibrahimovic",
        "Najwa Saniya Zahra",
        "Najwa Qotrunnada",
        "Nazwa Putri Anjani",
        "Oktavianus Aswin Wandung",
        "Petrus Hutardo Richard",
        "Putri Zamharira",
        "Refta Maulana Wahyudi",
        "Zulfikar Syifa Fuadi",
        "Rayhan Atha Syarif",
        "Ericco Hadhimas Calik",
        "Muhammad Yusuf Saputra",
    ];

    for nama in daftar_anggota {
        let username = generate_username_from_name(nama, &mut existing_usernames);
        let pass = fixed
            .get(username.as_str())
            .map(|s| (*s).to_string())
            .unwrap_or_else(|| generate_random_password(8));
        let hash = bcrypt::hash(&pass, BCRYPT_COST).map_err(|e| e.to_string())?;
        let is_koord = nama.contains("(Koordinator)");

        sqlx::query(
            "INSERT INTO users (username, password_hash, nama_lengkap, role, divisi, created_at)
             VALUES (?, ?, ?, 'anggota', NULL, ?)",
        )
        .bind(&username)
        .bind(&hash)
        .bind(nama)
        .bind(now_jkt)
        .execute(pool)
        .await
        .map_err(|e| e.to_string())?;

        generated_credentials.push(GeneratedCredential {
            role: if is_koord {
                "Anggota (Koordinator)".to_string()
            } else {
                "Anggota".to_string()
            },
            username,
            password: pass,
            nama_lengkap: nama.to_string(),
            divisi: if is_koord {
                "Koordinator Anggota".to_string()
            } else {
                "-".to_string()
            },
        });
    }

    let json_text =
        serde_json::to_string_pretty(&generated_credentials).map_err(|e| e.to_string())?;
    std::fs::write("login_credentials.json", json_text).map_err(|e| e.to_string())?;

    println!(
        "[SUCCESS] Seeding database selesai! Total {} akun disimpan di login_credentials.json.",
        generated_credentials.len()
    );
    Ok(())
}
