mod config;
mod db;
mod error;
mod handlers;
mod middleware;
mod models;
mod seed;
mod services;
mod state;
mod utils;

use axum::{
    extract::{DefaultBodyLimit, Request},
    http::{header, HeaderValue, Method, StatusCode, Uri},
    middleware::{self as axum_mw, Next},
    response::Response,
    routing::{delete, get, post, put},
    Json, Router,
};
use serde_json::json;
use std::net::SocketAddr;
use tower_http::{
    cors::{Any, CorsLayer},
    services::ServeDir,
};

use crate::config::Config;
use crate::state::AppState;

/// Adds Helmet-equivalent HTTP security headers and static asset Cache-Control headers.
async fn security_and_cache_headers(req: Request, next: Next) -> Response {
    let path = req.uri().path().to_string();
    let is_api = path.starts_with("/api");

    let mut res = next.run(req).await;
    let headers = res.headers_mut();

    // Security headers (Helmet equivalent without CSP/COEP so static UI isn't blocked)
    headers.insert("X-Content-Type-Options", HeaderValue::from_static("nosniff"));
    headers.insert("X-Frame-Options", HeaderValue::from_static("SAMEORIGIN"));
    headers.insert("Referrer-Policy", HeaderValue::from_static("no-referrer"));
    headers.insert(
        "X-DNS-Prefetch-Control",
        HeaderValue::from_static("off"),
    );
    headers.insert(
        "X-Download-Options",
        HeaderValue::from_static("noopen"),
    );
    headers.insert(
        "X-Permitted-Cross-Domain-Policies",
        HeaderValue::from_static("none"),
    );

    // Static asset HTTP caching matching src/app.js
    if !is_api && !headers.contains_key(header::CACHE_CONTROL) {
        let lower = path.to_lowercase();
        if lower == "/" || lower.ends_with(".html") {
            headers.insert(
                header::CACHE_CONTROL,
                HeaderValue::from_static("no-cache, must-revalidate"),
            );
        } else if lower.ends_with(".jpg")
            || lower.ends_with(".jpeg")
            || lower.ends_with(".png")
            || lower.ends_with(".gif")
            || lower.ends_with(".svg")
            || lower.ends_with(".ico")
            || lower.ends_with(".webp")
            || lower.ends_with(".pdf")
        {
            headers.insert(
                header::CACHE_CONTROL,
                HeaderValue::from_static("public, max-age=604800, immutable"),
            );
        } else if lower.ends_with(".css") || lower.ends_with(".js") {
            headers.insert(
                header::CACHE_CONTROL,
                HeaderValue::from_static("public, max-age=86400, must-revalidate"),
            );
        }
    }

    res
}

async fn api_not_found(uri: Uri) -> (StatusCode, Json<serde_json::Value>) {
    (
        StatusCode::NOT_FOUND,
        Json(json!({
            "status": "error",
            "message": format!("Endpoint API '{}' tidak ditemukan.", uri)
        })),
    )
}

fn build_api_router() -> Router<AppState> {
    let auth_routes = Router::new()
        .route("/login", post(handlers::auth::login))
        .route("/me", get(handlers::auth::get_me));

    let report_routes = Router::new()
        .route("/", post(handlers::reports::submit_report))
        .route("/check", get(handlers::reports::check_status))
        .route("/history", get(handlers::reports::get_history));

    let material_routes = Router::new()
        .route(
            "/schedules",
            get(handlers::schedules::get_schedules).post(handlers::schedules::create_schedule),
        )
        .route(
            "/schedules/{id}/link",
            put(handlers::schedules::link_material),
        )
        .route(
            "/schedules/{scheduleId}/link/{materialId}",
            delete(handlers::schedules::unlink_material),
        )
        .route(
            "/schedules/{id}",
            delete(handlers::schedules::delete_schedule),
        )
        .route("/instructors", get(handlers::schedules::get_instructors))
        .route("/download/{id}", get(handlers::materials::download_material))
        .route(
            "/",
            get(handlers::materials::get_materials).post(handlers::materials::upload_material),
        )
        .route("/{id}", delete(handlers::materials::delete_material));

    let attendance_routes = Router::new()
        .route(
            "/session/status",
            get(handlers::attendance_session::get_session_status),
        )
        .route(
            "/session/open",
            post(handlers::attendance_session::open_session),
        )
        .route(
            "/session/close",
            post(handlers::attendance_session::close_session),
        )
        .route(
            "/session/cleanup",
            post(handlers::attendance_session::cleanup_duplicate_sessions),
        )
        .route(
            "/session/mode",
            put(handlers::attendance_session::set_attendance_mode),
        )
        .route("/", post(handlers::attendance::submit_attendance))
        .route("/history", get(handlers::attendance::get_my_history))
        .route("/report", get(handlers::attendance::get_report))
        .route(
            "/export-csv",
            get(handlers::attendance::export_attendance_csv),
        );

    let payment_routes = Router::new()
        .route("/check", get(handlers::payments::check_status))
        .route("/total", get(handlers::payments::get_total_kas))
        .route(
            "/create-invoice",
            post(handlers::payments::create_invoice),
        )
        .route(
            "/invoice/{order_id}/status",
            get(handlers::payments::get_invoice_status),
        )
        .route(
            "/webhook/mutasi",
            post(handlers::payments::webhook_mutasi),
        )
        .route(
            "/webhook/logs",
            get(handlers::payments::get_webhook_logs),
        )
        .route(
            "/webhook/test",
            post(handlers::payments::test_webhook_mutasi),
        )
        .route(
            "/gateway/info",
            get(handlers::payments::get_gateway_info),
        )
        .route("/history", get(handlers::payments::get_my_history))
        .route("/{id}/confirm", put(handlers::payments::confirm_payment))
        .route(
            "/cleanup-proofs",
            post(handlers::payments::cleanup_old_payment_proofs),
        )
        .route("/report", get(handlers::payments::get_report));

    let dashboard_routes = Router::new()
        .route("/stats", get(handlers::dashboard::get_dashboard_stats))
        .route("/export/ppt", get(handlers::dashboard::export_ppt));

    let export_routes = Router::new()
        .route("/ppt", get(handlers::dashboard::export_ppt))
        .route("/export/ppt", get(handlers::dashboard::export_ppt))
        .route("/stats", get(handlers::dashboard::get_dashboard_stats));

    let qris_routes = Router::new()
        .route("/config", get(handlers::qris::get_config))
        .route("/payload", post(handlers::qris::save_qris_payload))
        .route("/upload", post(handlers::qris::upload_qris));

    let template_routes = Router::new()
        .route(
            "/",
            get(handlers::templates::get_templates).post(handlers::templates::upload_template),
        )
        .route(
            "/download/{id}",
            get(handlers::templates::download_template),
        )
        .route("/{id}", delete(handlers::templates::delete_template));

    let user_routes = Router::new()
        .route(
            "/",
            get(handlers::users::get_all_users).post(handlers::users::create_user),
        )
        .route(
            "/{id}",
            put(handlers::users::update_user).delete(handlers::users::delete_user),
        )
        .route(
            "/{id}/reset-password",
            put(handlers::users::reset_password),
        );

    let expense_routes = Router::new()
        .route(
            "/",
            get(handlers::expenses::get_expenses).post(handlers::expenses::add_expense),
        )
        .route("/{id}", delete(handlers::expenses::delete_expense));

    let certificate_routes = Router::new()
        .route("/profile/{id}", get(handlers::certificates::get_profile))
        .route(
            "/",
            get(handlers::certificates::get_all_certificates)
                .post(handlers::certificates::upload_certificate),
        )
        .route(
            "/batch",
            post(handlers::certificates::upload_batch_certificates)
                .layer(DefaultBodyLimit::max(250 * 1024 * 1024)),
        )
        .route("/{id}", delete(handlers::certificates::delete_certificate));

    let election_routes = Router::new()
        .route("/active", get(handlers::elections::get_active_election))
        .route(
            "/monitoring",
            get(handlers::elections::get_monitoring_stats_no_id),
        )
        .route(
            "/{id}/monitoring",
            get(handlers::elections::get_monitoring_stats_with_id),
        )
        .route("/{id}/vote", post(handlers::elections::cast_vote_with_id))
        .route("/vote", post(handlers::elections::cast_vote_no_id))
        .route("/{id}/candidates", post(handlers::elections::add_candidate))
        .route(
            "/candidates/{candidateId}",
            put(handlers::elections::update_candidate)
                .delete(handlers::elections::delete_candidate),
        )
        .route(
            "/{id}/status",
            put(handlers::elections::update_election_status),
        )
        .route("/{id}/voters", get(handlers::elections::get_voters_audit))
        .route(
            "/{id}/reset",
            post(handlers::elections::reset_election_votes),
        );

    Router::new()
        .nest("/auth", auth_routes)
        .nest("/reports", report_routes)
        .nest("/materials", material_routes)
        .nest("/attendance", attendance_routes)
        .nest("/payments", payment_routes)
        .nest("/dashboard", dashboard_routes)
        .nest("/export", export_routes)
        .nest("/qris", qris_routes)
        .nest("/templates", template_routes)
        .nest("/users", user_routes)
        .nest("/expenses", expense_routes)
        .nest("/certificates", certificate_routes)
        .nest("/elections", election_routes)
        .route("/profile/{id}", get(handlers::certificates::get_profile))
        .fallback(api_not_found)
}

fn build_cors(origin: &str) -> CorsLayer {
    let methods = [
        Method::GET,
        Method::POST,
        Method::PUT,
        Method::DELETE,
        Method::OPTIONS,
    ];
    let headers = [header::CONTENT_TYPE, header::AUTHORIZATION];

    if origin.trim() == "*" || origin.trim().is_empty() {
        CorsLayer::new()
            .allow_origin(Any)
            .allow_methods(methods)
            .allow_headers(headers)
    } else if let Ok(hv) = HeaderValue::from_str(origin.trim()) {
        CorsLayer::new()
            .allow_origin(hv)
            .allow_methods(methods)
            .allow_headers(headers)
    } else {
        CorsLayer::new()
            .allow_origin(Any)
            .allow_methods(methods)
            .allow_headers(headers)
    }
}

fn main() {
    // Batasi jumlah thread & stack size agar hemat RAM dan tidak melebihi batas NPROC CloudLinux/cPanel
    let runtime = tokio::runtime::Builder::new_multi_thread()
        .worker_threads(2)
        .max_blocking_threads(2)
        .thread_stack_size(1024 * 1024)
        .enable_all()
        .build()
        .expect("Gagal membuat Tokio runtime");

    runtime.block_on(async_main());
}

async fn async_main() {
    let _ = dotenvy::dotenv();
    let config = Config::from_env();

    let args: Vec<String> = std::env::args().collect();
    let run_seed = args.iter().any(|a| a == "--seed");

    let pool = match db::create_pool(&config).await {
        Ok(p) => {
            println!("[DB] Koneksi ke database MySQL berhasil.");
            p
        }
        Err(e) => {
            eprintln!("[DB ERROR] Gagal menginisialisasi database: {}", e);
            std::process::exit(1);
        }
    };

    if run_seed {
        if let Err(e) = seed::seed_database(&pool, true).await {
            eprintln!("[ERROR] Gagal melakukan seeding database: {}", e);
            std::process::exit(1);
        }
        return;
    }

    db::run_startup_maintenance(&pool, &config).await;

    let cors = build_cors(&config.client_origin);
    let port = config.port;
    let state = AppState::new(pool, config);

    let app = Router::new()
        .nest("/api", build_api_router())
        .nest_service("/uploads", ServeDir::new("public/uploads"))
        .nest_service("/asset", ServeDir::new("asset"))
        .fallback_service(ServeDir::new("public"))
        .layer(DefaultBodyLimit::max(55 * 1024 * 1024))
        .layer(cors)
        .layer(axum_mw::from_fn(security_and_cache_headers))
        .with_state(state);

    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    let listener = match tokio::net::TcpListener::bind(addr).await {
        Ok(l) => l,
        Err(e) => {
            eprintln!("[SERVER ERROR] Gagal bind port {}: {}", port, e);
            std::process::exit(1);
        }
    };

    println!("[SERVER] Backend Rust berjalan di http://localhost:{}", port);

    if let Err(e) = axum::serve(
        listener,
        app.into_make_service_with_connect_info::<SocketAddr>(),
    )
    .await
    {
        eprintln!("[SERVER ERROR] {}", e);
        std::process::exit(1);
    }
}
