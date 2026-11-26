use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

struct WindowEntry {
    count: u32,
    window_start: Instant,
}

/// Login rate limiter matching express-rate-limit: max 10 requests per 30 seconds per IP.
pub struct LoginRateLimiter {
    window: Duration,
    max_requests: u32,
    buckets: Mutex<HashMap<String, WindowEntry>>,
}

impl LoginRateLimiter {
    pub fn new(max_requests: u32, window_secs: u64) -> Self {
        Self {
            window: Duration::from_secs(window_secs),
            max_requests,
            buckets: Mutex::new(HashMap::new()),
        }
    }

    /// Returns true if allowed, false if rate-limited.
    pub fn check_and_increment(&self, ip: &str) -> bool {
        let mut guard = match self.buckets.lock() {
            Ok(g) => g,
            Err(_) => return true,
        };
        let now = Instant::now();

        // Occasional cleanup
        if guard.len() > 2000 {
            guard.retain(|_, v| now.duration_since(v.window_start) < self.window);
        }

        let entry = guard.entry(ip.to_string()).or_insert(WindowEntry {
            count: 0,
            window_start: now,
        });

        if now.duration_since(entry.window_start) >= self.window {
            entry.count = 1;
            entry.window_start = now;
            return true;
        }

        if entry.count >= self.max_requests {
            return false;
        }

        entry.count += 1;
        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn enforces_max_attempts_per_ip() {
        let limiter = LoginRateLimiter::new(3, 30);
        assert!(limiter.check_and_increment("1.2.3.4"));
        assert!(limiter.check_and_increment("1.2.3.4"));
        assert!(limiter.check_and_increment("1.2.3.4"));
        assert!(!limiter.check_and_increment("1.2.3.4"));
        assert!(limiter.check_and_increment("5.6.7.8"));
    }
}
