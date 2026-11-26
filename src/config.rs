use std::env;

#[derive(Clone, Debug)]
pub struct Config {
    pub port: u16,
    pub node_env: String,
    pub db_host: String,
    pub db_port: u16,
    pub db_user: String,
    pub db_password: String,
    pub db_name: String,
    pub jwt_secret: String,
    pub jwt_expires_in_secs: i64,
    pub client_origin: String,
    pub qris_merchant_name: String,
    pub qris_nmid: String,
    pub gemini_api_key: String,
    #[allow(dead_code)]
    pub bypass_tuesday_check: bool,
}

impl Config {
    pub fn from_env() -> Self {
        let port = env::var("PORT")
            .ok()
            .and_then(|v| v.parse::<u16>().ok())
            .unwrap_or(4000);

        let node_env = env::var("NODE_ENV").unwrap_or_else(|_| "production".to_string());
        let db_host = env::var("DB_HOST").unwrap_or_else(|_| "localhost".to_string());
        let db_port = env::var("DB_PORT")
            .ok()
            .and_then(|v| v.parse::<u16>().ok())
            .unwrap_or(3306);
        let db_user = env::var("DB_USER").unwrap_or_else(|_| "root".to_string());
        let db_password = env::var("DB_PASSWORD").unwrap_or_default();
        let db_name = env::var("DB_NAME").unwrap_or_else(|_| "db_iptek".to_string());
        let jwt_secret = env::var("JWT_SECRET").unwrap_or_default();
        let jwt_expires_raw = env::var("JWT_EXPIRES_IN").unwrap_or_else(|_| "24h".to_string());
        let jwt_expires_in_secs = parse_duration_seconds(&jwt_expires_raw);
        let client_origin = env::var("CLIENT_ORIGIN").unwrap_or_else(|_| "*".to_string());
        let qris_merchant_name =
            env::var("QRIS_MERCHANT_NAME").unwrap_or_else(|_| "Bendahara UKM IPTEK".to_string());
        let qris_nmid =
            env::var("QRIS_NMID").unwrap_or_else(|_| "BELUM_DIKONFIGURASI".to_string());
        let gemini_api_key = env::var("GEMINI_API_KEY").unwrap_or_default().trim().to_string();
        let bypass_tuesday_check = env::var("BYPASS_TUESDAY_CHECK")
            .map(|v| v.eq_ignore_ascii_case("true"))
            .unwrap_or(false);

        Self {
            port,
            node_env,
            db_host,
            db_port,
            db_user,
            db_password,
            db_name,
            jwt_secret,
            jwt_expires_in_secs,
            client_origin,
            qris_merchant_name,
            qris_nmid,
            gemini_api_key,
            bypass_tuesday_check,
        }
    }

    pub fn is_development(&self) -> bool {
        self.node_env.eq_ignore_ascii_case("development")
    }
}

pub fn parse_duration_seconds(input: &str) -> i64 {
    let trimmed = input.trim();
    if let Ok(secs) = trimmed.parse::<i64>() {
        return secs;
    }
    if trimmed.len() >= 2 {
        let (num_part, unit) = trimmed.split_at(trimmed.len() - 1);
        if let Ok(n) = num_part.trim().parse::<i64>() {
            return match unit {
                "s" | "S" => n,
                "m" | "M" => n * 60,
                "h" | "H" => n * 3600,
                "d" | "D" => n * 86400,
                _ => 86400,
            };
        }
    }
    86400
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_jwt_duration_formats() {
        assert_eq!(parse_duration_seconds("24h"), 86400);
        assert_eq!(parse_duration_seconds("7d"), 604800);
        assert_eq!(parse_duration_seconds("30m"), 1800);
        assert_eq!(parse_duration_seconds("90s"), 90);
        assert_eq!(parse_duration_seconds("3600"), 3600);
    }
}
