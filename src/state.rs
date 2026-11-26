use sqlx::MySqlPool;
use std::sync::Arc;

use crate::config::Config;
use crate::middleware::cache::MemoryCache;
use crate::middleware::rate_limit::LoginRateLimiter;

#[derive(Clone)]
pub struct AppState {
    pub pool: MySqlPool,
    pub config: Arc<Config>,
    pub cache: Arc<MemoryCache>,
    pub login_limiter: Arc<LoginRateLimiter>,
    pub http_client: reqwest::Client,
}

impl AppState {
    pub fn new(pool: MySqlPool, config: Config) -> Self {
        let http_client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(25))
            .build()
            .unwrap_or_else(|_| reqwest::Client::new());

        Self {
            pool,
            config: Arc::new(config),
            cache: Arc::new(MemoryCache::new()),
            login_limiter: Arc::new(LoginRateLimiter::new(10, 30)),
            http_client,
        }
    }
}
