use axum::{
    body::{to_bytes, Body},
    extract::ConnectInfo,
    http::{HeaderName, HeaderValue, Method, Request},
    Router,
};
use std::collections::HashMap;
use std::io::{self, Read, Write};
use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use tower::ServiceExt;

/// Builds an Axum HTTP Request from CGI environment variables and raw stdin body bytes.
pub fn build_request_from_cgi_env(
    env_map: &HashMap<String, String>,
    body_bytes: Vec<u8>,
) -> Result<Request<Body>, String> {
    let method_str = env_map
        .get("REQUEST_METHOD")
        .map(|s| s.as_str())
        .unwrap_or("GET");
    let method = Method::from_bytes(method_str.as_bytes())
        .map_err(|e| format!("Invalid REQUEST_METHOD: {}", e))?;

    // Determine request URI (prefer PATH_INFO when rewritten to api.cgi/api/...)
    let path_info = env_map.get("PATH_INFO").map(|s| s.trim()).unwrap_or("");
    let query_string = env_map.get("QUERY_STRING").map(|s| s.trim()).unwrap_or("");
    let request_uri = env_map.get("REQUEST_URI").map(|s| s.trim()).unwrap_or("");

    let full_uri = if !path_info.is_empty() && path_info.starts_with('/') {
        if query_string.is_empty() {
            path_info.to_string()
        } else {
            format!("{}?{}", path_info, query_string)
        }
    } else if !request_uri.is_empty() {
        request_uri.to_string()
    } else {
        "/".to_string()
    };

    let mut builder = Request::builder().method(method).uri(&full_uri);

    // Map HTTP_* CGI env vars to standard HTTP headers
    let mut has_auth = false;
    let mut has_webhook_secret = false;

    for (k, v) in env_map {
        if let Some(rest) = k.strip_prefix("HTTP_") {
            let header_key = rest.to_lowercase().replace('_', "-");
            if header_key == "authorization" {
                has_auth = true;
            } else if header_key == "x-webhook-secret" {
                has_webhook_secret = true;
            }
            if let (Ok(hn), Ok(hv)) = (
                HeaderName::from_bytes(header_key.as_bytes()),
                HeaderValue::from_str(v),
            ) {
                builder = builder.header(hn, hv);
            }
        }
    }

    // Fallback for Apache/LiteSpeed REDIRECT_HTTP_* variables
    if !has_auth {
        if let Some(v) = env_map.get("REDIRECT_HTTP_AUTHORIZATION").filter(|s| !s.is_empty()) {
            if let Ok(hv) = HeaderValue::from_str(v) {
                builder = builder.header("authorization", hv);
            }
        }
    }
    if !has_webhook_secret {
        if let Some(v) = env_map.get("REDIRECT_HTTP_X_WEBHOOK_SECRET").filter(|s| !s.is_empty()) {
            if let Ok(hv) = HeaderValue::from_str(v) {
                builder = builder.header("x-webhook-secret", hv);
            }
        }
    }

    if let Some(ct) = env_map.get("CONTENT_TYPE").filter(|s| !s.is_empty()) {
        if let Ok(hv) = HeaderValue::from_str(ct) {
            builder = builder.header("content-type", hv);
        }
    }
    if let Some(cl) = env_map.get("CONTENT_LENGTH").filter(|s| !s.is_empty()) {
        if let Ok(hv) = HeaderValue::from_str(cl) {
            builder = builder.header("content-length", hv);
        }
    }

    let mut req = builder
        .body(Body::from(body_bytes))
        .map_err(|e| format!("Failed building CGI request: {}", e))?;

    let remote_ip: IpAddr = env_map
        .get("REMOTE_ADDR")
        .and_then(|s| s.trim().parse().ok())
        .unwrap_or(IpAddr::V4(Ipv4Addr::LOCALHOST));
    req.extensions_mut()
        .insert(ConnectInfo(SocketAddr::new(remote_ip, 0)));

    Ok(req)
}

/// Executes a single CGI HTTP request against the Axum Router and writes the CGI response to stdout.
pub async fn handle_cgi_request(app: Router) {
    let env_map: HashMap<String, String> = std::env::vars().collect();

    let content_len: Option<usize> = env_map
        .get("CONTENT_LENGTH")
        .and_then(|s| s.trim().parse::<usize>().ok());

    let mut body_bytes = Vec::new();
    let mut stdin = io::stdin().lock();
    match content_len {
        Some(0) => {}
        Some(len) => {
            body_bytes.reserve(len.min(64 * 1024 * 1024));
            let _ = stdin.take(len as u64).read_to_end(&mut body_bytes);
        }
        None => {
            // Only read stdin if method typically carries a body
            let m = env_map.get("REQUEST_METHOD").map(|s| s.as_str()).unwrap_or("GET");
            if matches!(m, "POST" | "PUT" | "PATCH") {
                let _ = stdin.read_to_end(&mut body_bytes);
            }
        }
    }

    let req = match build_request_from_cgi_env(&env_map, body_bytes) {
        Ok(r) => r,
        Err(msg) => {
            write_cgi_error(400, "Bad Request", &msg);
            return;
        }
    };

    let response = match app.oneshot(req).await {
        Ok(res) => res,
        Err(infallible) => match infallible {},
    };

    let status = response.status();
    let headers = response.headers().clone();
    let resp_bytes = match to_bytes(response.into_body(), usize::MAX).await {
        Ok(b) => b,
        Err(e) => {
            write_cgi_error(500, "Internal Server Error", &e.to_string());
            return;
        }
    };

    let mut out = io::stdout().lock();
    let reason = status.canonical_reason().unwrap_or("");
    let _ = write!(out, "Status: {} {}\r\n", status.as_u16(), reason);

    for (name, val) in headers.iter() {
        let lower = name.as_str().to_lowercase();
        if lower == "transfer-encoding" || lower == "connection" {
            continue;
        }
        if let Ok(v_str) = val.to_str() {
            let _ = write!(out, "{}: {}\r\n", name.as_str(), v_str);
        }
    }
    let _ = write!(out, "\r\n");
    let _ = out.write_all(&resp_bytes);
    let _ = out.flush();
}

pub fn write_cgi_error(code: u16, reason: &str, msg: &str) {
    let body = serde_json::json!({
        "status": "error",
        "message": msg
    })
    .to_string();
    let mut out = io::stdout().lock();
    let _ = write!(
        out,
        "Status: {} {}\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r\n{}",
        code,
        reason,
        body.len(),
        body
    );
    let _ = out.flush();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builds_cgi_request_with_path_info_query_and_auth() {
        let mut env = HashMap::new();
        env.insert("REQUEST_METHOD".to_string(), "GET".to_string());
        env.insert("PATH_INFO".to_string(), "/api/payments/report".to_string());
        env.insert("QUERY_STRING".to_string(), "status=lunas&year=2026".to_string());
        env.insert(
            "REDIRECT_HTTP_AUTHORIZATION".to_string(),
            "Bearer testtoken123".to_string(),
        );
        env.insert(
            "HTTP_X_WEBHOOK_SECRET".to_string(),
            "mysecret".to_string(),
        );
        env.insert("REMOTE_ADDR".to_string(), "203.0.113.10".to_string());

        let req = build_request_from_cgi_env(&env, Vec::new()).expect("valid cgi request");
        assert_eq!(req.method(), Method::GET);
        assert_eq!(req.uri().to_string(), "/api/payments/report?status=lunas&year=2026");
        assert_eq!(
            req.headers().get("authorization").and_then(|v| v.to_str().ok()),
            Some("Bearer testtoken123")
        );
        assert_eq!(
            req.headers().get("x-webhook-secret").and_then(|v| v.to_str().ok()),
            Some("mysecret")
        );
    }
}
