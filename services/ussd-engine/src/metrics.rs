/*!
 * Prometheus metrics for the NEXCOM USSD engine.
 * Exposed on :8021/metrics for Prometheus scraping.
 */

use axum::{http::StatusCode, response::IntoResponse, routing::get, Router};
use lazy_static::lazy_static;
use prometheus::{
    register_counter, register_gauge, register_histogram, Counter, Gauge, Histogram,
};
use tokio::net::TcpListener;

lazy_static! {
    pub static ref USSD_REQUESTS_TOTAL: Counter = register_counter!(
        "nexcom_ussd_requests_total",
        "Total USSD callback requests received"
    ).unwrap();

    pub static ref USSD_SESSIONS_ACTIVE: Gauge = register_gauge!(
        "nexcom_ussd_sessions_active",
        "Currently active USSD sessions"
    ).unwrap();

    pub static ref USSD_SESSIONS_COMPLETED: Counter = register_counter!(
        "nexcom_ussd_sessions_completed_total",
        "Total completed USSD sessions"
    ).unwrap();

    pub static ref USSD_ERRORS_TOTAL: Counter = register_counter!(
        "nexcom_ussd_errors_total",
        "Total USSD handler errors"
    ).unwrap();

    pub static ref USSD_RESPONSE_DURATION: Histogram = register_histogram!(
        "nexcom_ussd_response_duration_seconds",
        "USSD handler response duration in seconds",
        vec![0.01, 0.05, 0.1, 0.25, 0.5, 1.0, 2.0]
    ).unwrap();

    pub static ref USSD_ORDERS_PLACED: Counter = register_counter!(
        "nexcom_ussd_orders_placed_total",
        "Total orders placed via USSD"
    ).unwrap();
}

pub fn register_metrics() {
    // Force lazy_static initialization
    let _ = &*USSD_REQUESTS_TOTAL;
    let _ = &*USSD_SESSIONS_ACTIVE;
    let _ = &*USSD_SESSIONS_COMPLETED;
    let _ = &*USSD_ERRORS_TOTAL;
    let _ = &*USSD_RESPONSE_DURATION;
    let _ = &*USSD_ORDERS_PLACED;
}

pub async fn serve_metrics(port: u16) {
    let app = Router::new().route("/metrics", get(metrics_handler));
    let listener = TcpListener::bind(format!("0.0.0.0:{}", port))
        .await
        .expect("Failed to bind metrics port");
    axum::serve(listener, app).await.ok();
}

async fn metrics_handler() -> impl IntoResponse {
    use prometheus::Encoder;
    let encoder = prometheus::TextEncoder::new();
    let mut buffer = Vec::new();
    encoder
        .encode(&prometheus::gather(), &mut buffer)
        .unwrap_or_default();
    (
        StatusCode::OK,
        [(axum::http::header::CONTENT_TYPE, "text/plain; version=0.0.4")],
        buffer,
    )
}
