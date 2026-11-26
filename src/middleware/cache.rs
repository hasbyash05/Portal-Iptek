use axum::http::{HeaderValue, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde_json::Value;
use std::collections::HashMap;
use std::sync::RwLock;
use std::time::{Duration, Instant};

struct CacheEntry {
    body: Value,
    status: StatusCode,
    expiry: Instant,
}

pub struct MemoryCache {
    store: RwLock<HashMap<String, CacheEntry>>,
}

impl Default for MemoryCache {
    fn default() -> Self {
        Self::new()
    }
}

impl MemoryCache {
    pub fn new() -> Self {
        Self {
            store: RwLock::new(HashMap::new()),
        }
    }

    pub fn get(&self, key: &str) -> Option<(StatusCode, Value)> {
        let guard = self.store.read().ok()?;
        let entry = guard.get(key)?;
        if entry.expiry > Instant::now() {
            Some((entry.status, entry.body.clone()))
        } else {
            None
        }
    }

    pub fn set(&self, key: String, status: StatusCode, body: Value, ttl_secs: u64) {
        if let Ok(mut guard) = self.store.write() {
            let now = Instant::now();
            if guard.len() > 300 {
                guard.retain(|_, v| v.expiry > now);
                if guard.len() > 200 {
                    let keys_to_remove: Vec<String> = guard
                        .keys()
                        .take(guard.len() - 200)
                        .cloned()
                        .collect();
                    for k in keys_to_remove {
                        guard.remove(&k);
                    }
                }
            }
            guard.insert(
                key,
                CacheEntry {
                    body,
                    status,
                    expiry: now + Duration::from_secs(ttl_secs),
                },
            );
        }
    }

    pub fn clear_pattern(&self, pattern: Option<&str>) {
        if let Ok(mut guard) = self.store.write() {
            match pattern {
                None => guard.clear(),
                Some(pat) => guard.retain(|k, _| !k.contains(pat)),
            }
        }
    }

    pub fn hit_response(status: StatusCode, body: Value) -> Response {
        let mut resp = (status, Json(body)).into_response();
        resp.headers_mut()
            .insert("X-Server-Cache", HeaderValue::from_static("HIT"));
        resp
    }

    pub fn miss_response(&self, key: String, status: StatusCode, body: Value, ttl_secs: u64) -> Response {
        if status.is_success() {
            self.set(key, status, body.clone(), ttl_secs);
        }
        let mut resp = (status, Json(body)).into_response();
        resp.headers_mut()
            .insert("X-Server-Cache", HeaderValue::from_static("MISS"));
        resp
    }
}
