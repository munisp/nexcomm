/*!
 * NEXCOM Exchange — USSD Session Engine (Rust)
 * =============================================
 * High-throughput USSD session state machine for Africa's Talking gateway.
 *
 * Architecture:
 *   - Axum HTTP server on :8020 receives POST /ussd/callback from AT gateway
 *   - Redis stores session state (TTL 300s per USSD spec)
 *   - PostgreSQL persists completed sessions + PIN hashes
 *   - Kafka emits ussd.session.completed events to the lakehouse
 *   - Prometheus metrics on :8021/metrics
 *
 * Menu Tree:
 *   MAIN        → 1: Price Check | 2: My Portfolio | 3: Place Order | 4: Loan Status | 5: Account | 0: Exit
 *   PRICE       → list of commodities → show price + change
 *   PORTFOLIO   → show positions summary
 *   ORDER       → 1: Buy | 2: Sell → symbol → qty → confirm
 *   LOAN        → show active loans + repayment status
 *   ACCOUNT     → 1: Balance | 2: Set PIN | 3: Opt-out alerts
 */

mod db;
mod kafka;
mod menu;
mod metrics;
mod pin;
mod session;

use axum::{
    extract::{Form, State},
    http::StatusCode,
    response::IntoResponse,
    routing::post,
    Router,
};
use serde::Deserialize;
use std::sync::Arc;
use tokio::net::TcpListener;
use tower_http::cors::CorsLayer;
use tracing::{error, info};
use tracing_subscriber::{fmt, EnvFilter};

use crate::db::DbPool;
use crate::kafka::KafkaProducer;
use crate::menu::{handle_input, MenuResponse};
use crate::metrics::register_metrics;
use crate::session::SessionStore;

/// Africa's Talking USSD callback payload
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UssdRequest {
    /// Unique session ID from AT (persists for the session lifetime)
    pub session_id: String,
    /// Service code dialled (e.g. *347*99#)
    pub service_code: String,
    /// MSISDN of the caller (e.g. +2348012345678)
    pub phone_number: String,
    /// Text accumulated from all inputs in this session (e.g. "1*2*500")
    pub text: String,
    /// Network operator code
    #[serde(default)]
    pub network_code: String,
}

/// Application state shared across handlers
#[derive(Clone)]
pub struct AppState {
    pub db: DbPool,
    pub sessions: SessionStore,
    pub kafka: Arc<KafkaProducer>,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // Initialise tracing
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::from_default_env().add_directive("nexcom_ussd=info".parse()?))
        .json()
        .init();

    dotenvy::dotenv().ok();

    let database_url = std::env::var("DATABASE_URL")
        .unwrap_or_else(|_| "postgresql://nexcom:nexcom_secure_2026@localhost:5432/nexcom".to_string());
    let redis_url = std::env::var("REDIS_URL")
        .unwrap_or_else(|_| "redis://localhost:6379".to_string());
    let kafka_brokers = std::env::var("KAFKA_BROKERS")
        .unwrap_or_else(|_| "localhost:9092".to_string());

    info!("Connecting to PostgreSQL...");
    let db = db::connect(&database_url).await?;

    info!("Connecting to Redis...");
    let sessions = session::SessionStore::new(&redis_url).await?;

    info!("Connecting to Kafka...");
    let kafka = Arc::new(kafka::KafkaProducer::new(&kafka_brokers));

    let state = AppState { db, sessions, kafka };

    // Prometheus metrics endpoint on :8021
    let metrics_handle = tokio::spawn(metrics::serve_metrics(8021));

    // Main USSD HTTP server on :8020
    let port: u16 = std::env::var("USSD_PORT")
        .unwrap_or_else(|_| "8020".to_string())
        .parse()
        .unwrap_or(8020);

    let app = Router::new()
        .route("/ussd/callback", post(ussd_callback))
        .route("/ussd/health", axum::routing::get(health))
        .layer(CorsLayer::permissive())
        .with_state(state);

    let listener = TcpListener::bind(format!("0.0.0.0:{}", port)).await?;
    info!("NEXCOM USSD Engine listening on :{}", port);

    register_metrics();

    tokio::select! {
        result = axum::serve(listener, app) => {
            if let Err(e) = result { error!("Server error: {}", e); }
        }
        _ = metrics_handle => {}
    }

    Ok(())
}

/// Main USSD callback handler — called by Africa's Talking on every user input
async fn ussd_callback(
    State(state): State<AppState>,
    Form(req): Form<UssdRequest>,
) -> impl IntoResponse {
    metrics::USSD_REQUESTS_TOTAL.inc();
    let timer = metrics::USSD_RESPONSE_DURATION.start_timer();

    let result = handle_input(&state, &req).await;

    timer.observe_duration();

    match result {
        Ok(MenuResponse::Continue(text)) => {
            metrics::USSD_SESSIONS_ACTIVE.inc();
            (StatusCode::OK, format!("CON {}", text))
        }
        Ok(MenuResponse::End(text)) => {
            metrics::USSD_SESSIONS_ACTIVE.dec();
            metrics::USSD_SESSIONS_COMPLETED.inc();
            (StatusCode::OK, format!("END {}", text))
        }
        Err(e) => {
            error!("USSD handler error for session {}: {}", req.session_id, e);
            metrics::USSD_ERRORS_TOTAL.inc();
            (
                StatusCode::OK,
                "END An error occurred. Please try again later.".to_string(),
            )
        }
    }
}

async fn health() -> impl IntoResponse {
    (StatusCode::OK, r#"{"status":"healthy","service":"nexcom-ussd-engine"}"#)
}
