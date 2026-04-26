// NEXCOM Exchange — Cryptographic Security Service (Rust)
// ========================================================
// High-assurance cryptographic service providing:
//  1. Replay Attack Prevention  — nonce registry with TTL expiry
//  2. HMAC Request Signing      — SHA-256 HMAC for API request integrity
//  3. Request Signature Verify  — verify inbound signed requests
//  4. Idempotency Key Registry  — deduplicate financial operations
//  5. Token Generation          — CSRF tokens, API keys, nonces
//  6. Timestamp Drift Detection — reject requests with stale timestamps
//  7. Audit Trail               — immutable append-only event log
//
// Build: cargo build --release
// Run:   HMAC_SECRET=<secret> CRYPTO_GUARD_PORT=7070 ./target/release/crypto-guard

use actix_web::{web, App, HttpServer, HttpResponse, middleware::Logger};
use chrono::{DateTime, Duration, Utc};
use hmac::{Hmac, Mac};
use sha2::Sha256;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{Arc, RwLock};
use std::env;
use uuid::Uuid;
use rand::Rng;
use log::{info, warn};

type HmacSha256 = Hmac<Sha256>;

#[derive(Clone)]
struct Config {
    port: u16,
    hmac_secret: String,
    nonce_ttl_seconds: i64,
    idempotency_ttl_seconds: i64,
    max_timestamp_drift_seconds: i64,
    audit_max_events: usize,
}

impl Config {
    fn from_env() -> Self {
        Config {
            port: env::var("CRYPTO_GUARD_PORT").unwrap_or_else(|_| "7070".to_string()).parse().unwrap_or(7070),
            hmac_secret: env::var("HMAC_SECRET").unwrap_or_else(|_| "nexcom-default-hmac-secret-change-in-production".to_string()),
            nonce_ttl_seconds: env::var("NONCE_TTL_SECONDS").unwrap_or_else(|_| "300".to_string()).parse().unwrap_or(300),
            idempotency_ttl_seconds: env::var("IDEMPOTENCY_TTL_SECONDS").unwrap_or_else(|_| "86400".to_string()).parse().unwrap_or(86400),
            max_timestamp_drift_seconds: env::var("MAX_TIMESTAMP_DRIFT_SECONDS").unwrap_or_else(|_| "30".to_string()).parse().unwrap_or(30),
            audit_max_events: env::var("AUDIT_MAX_EVENTS").unwrap_or_else(|_| "10000".to_string()).parse().unwrap_or(10000),
        }
    }
}

#[derive(Clone, Serialize)]
struct IdempotencyEntry {
    key: String,
    operation: String,
    result: serde_json::Value,
    created_at: DateTime<Utc>,
    expires_at: DateTime<Utc>,
}

#[derive(Clone, Serialize)]
struct AuditEvent {
    id: String,
    timestamp: DateTime<Utc>,
    event_type: String,
    details: serde_json::Value,
}

#[derive(Clone)]
struct AppState {
    config: Config,
    nonce_store: Arc<RwLock<HashMap<String, DateTime<Utc>>>>,
    idempotency_store: Arc<RwLock<HashMap<String, IdempotencyEntry>>>,
    audit_log: Arc<RwLock<Vec<AuditEvent>>>,
}

impl AppState {
    fn new(config: Config) -> Self {
        AppState {
            config,
            nonce_store: Arc::new(RwLock::new(HashMap::new())),
            idempotency_store: Arc::new(RwLock::new(HashMap::new())),
            audit_log: Arc::new(RwLock::new(Vec::new())),
        }
    }

    fn add_audit(&self, event_type: &str, details: serde_json::Value) {
        let event = AuditEvent {
            id: Uuid::new_v4().to_string(),
            timestamp: Utc::now(),
            event_type: event_type.to_string(),
            details,
        };
        let mut log = self.audit_log.write().unwrap();
        log.push(event);
        if log.len() > self.config.audit_max_events {
            let drain = log.len() - self.config.audit_max_events;
            log.drain(0..drain);
        }
    }

    fn cleanup_expired(&self) {
        let now = Utc::now();
        self.nonce_store.write().unwrap().retain(|_, expiry| *expiry > now);
        self.idempotency_store.write().unwrap().retain(|_, e| e.expires_at > now);
    }
}

#[derive(Deserialize)] struct NonceVerifyReq { nonce: String, timestamp: Option<i64> }
#[derive(Deserialize)] struct HmacSignReq { payload: String }
#[derive(Deserialize)] struct HmacVerifyReq { payload: String, signature: String, timestamp: Option<i64> }
#[derive(Deserialize)] struct IdempotencyCheckReq { key: String, operation: String }
#[derive(Deserialize)] struct IdempotencyCommitReq { key: String, operation: String, result: serde_json::Value }
#[derive(Deserialize)] struct TokenGenReq { length: Option<usize>, format: Option<String> }

fn resp_ok(data: serde_json::Value) -> HttpResponse {
    HttpResponse::Ok().json(serde_json::json!({ "success": true, "data": data }))
}
fn resp_err(msg: &str) -> HttpResponse {
    HttpResponse::BadRequest().json(serde_json::json!({ "success": false, "error": msg }))
}
fn resp_unauth(msg: &str) -> HttpResponse {
    HttpResponse::Unauthorized().json(serde_json::json!({ "success": false, "error": msg }))
}

async fn nonce_generate(state: web::Data<AppState>) -> HttpResponse {
    let nonce = Uuid::new_v4().to_string().replace('-', "");
    let expiry = Utc::now() + Duration::seconds(state.config.nonce_ttl_seconds);
    state.nonce_store.write().unwrap().insert(nonce.clone(), expiry);
    state.add_audit("NONCE_GENERATED", serde_json::json!({ "prefix": &nonce[..8] }));
    resp_ok(serde_json::json!({ "nonce": nonce, "expires_at": expiry.timestamp(), "ttl_seconds": state.config.nonce_ttl_seconds }))
}

async fn nonce_verify(state: web::Data<AppState>, req: web::Json<NonceVerifyReq>) -> HttpResponse {
    if let Some(ts) = req.timestamp {
        if let Some(rt) = DateTime::from_timestamp(ts, 0) {
            let drift = (Utc::now() - rt).num_seconds().abs();
            if drift > state.config.max_timestamp_drift_seconds {
                warn!("[CryptoGuard] Timestamp drift: {}s", drift);
                return resp_err(&format!("Timestamp drift too large: {}s", drift));
            }
        }
    }
    let now = Utc::now();
    let mut store = state.nonce_store.write().unwrap();
    match store.get(&req.nonce) {
        None => { drop(store); state.add_audit("NONCE_VERIFY_FAILED", serde_json::json!({ "reason": "not_found" })); resp_unauth("Nonce not found or already used") }
        Some(expiry) if *expiry < now => { store.remove(&req.nonce); drop(store); state.add_audit("NONCE_EXPIRED", serde_json::json!({})); resp_unauth("Nonce expired") }
        Some(_) => { store.remove(&req.nonce); drop(store); state.add_audit("NONCE_VERIFY_OK", serde_json::json!({})); resp_ok(serde_json::json!({ "valid": true })) }
    }
}

async fn hmac_sign(state: web::Data<AppState>, req: web::Json<HmacSignReq>) -> HttpResponse {
    let ts = Utc::now().timestamp();
    let message = format!("{}.{}", ts, req.payload);
    let mut mac = HmacSha256::new_from_slice(state.config.hmac_secret.as_bytes()).unwrap();
    mac.update(message.as_bytes());
    let sig = hex::encode(mac.finalize().into_bytes());
    resp_ok(serde_json::json!({ "signature": sig, "timestamp": ts, "algorithm": "HMAC-SHA256" }))
}

async fn hmac_verify(state: web::Data<AppState>, req: web::Json<HmacVerifyReq>) -> HttpResponse {
    if let Some(ts) = req.timestamp {
        if let Some(rt) = DateTime::from_timestamp(ts, 0) {
            let drift = (Utc::now() - rt).num_seconds().abs();
            if drift > state.config.max_timestamp_drift_seconds {
                return resp_err(&format!("Timestamp drift too large: {}s", drift));
            }
        }
    }
    let message = if let Some(ts) = req.timestamp { format!("{}.{}", ts, req.payload) } else { req.payload.clone() };
    let mut mac = HmacSha256::new_from_slice(state.config.hmac_secret.as_bytes()).unwrap();
    mac.update(message.as_bytes());
    let expected = hex::encode(mac.finalize().into_bytes());
    let valid = constant_time_eq(expected.as_bytes(), req.signature.as_bytes());
    if valid {
        state.add_audit("HMAC_VERIFY_OK", serde_json::json!({}));
        resp_ok(serde_json::json!({ "valid": true }))
    } else {
        warn!("[CryptoGuard] HMAC verification failed");
        state.add_audit("HMAC_VERIFY_FAILED", serde_json::json!({}));
        resp_unauth("Signature verification failed")
    }
}

fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() { return false; }
    let mut result = 0u8;
    for (x, y) in a.iter().zip(b.iter()) { result |= x ^ y; }
    result == 0
}

async fn idempotency_check(state: web::Data<AppState>, req: web::Json<IdempotencyCheckReq>) -> HttpResponse {
    state.cleanup_expired();
    let key = format!("{}:{}", req.operation, req.key);
    let store = state.idempotency_store.read().unwrap();
    match store.get(&key) {
        Some(entry) => resp_ok(serde_json::json!({ "exists": true, "result": entry.result, "created_at": entry.created_at.timestamp() })),
        None => resp_ok(serde_json::json!({ "exists": false }))
    }
}

async fn idempotency_commit(state: web::Data<AppState>, req: web::Json<IdempotencyCommitReq>) -> HttpResponse {
    let key = format!("{}:{}", req.operation, req.key);
    let now = Utc::now();
    let entry = IdempotencyEntry {
        key: req.key.clone(), operation: req.operation.clone(), result: req.result.clone(),
        created_at: now, expires_at: now + Duration::seconds(state.config.idempotency_ttl_seconds),
    };
    state.idempotency_store.write().unwrap().insert(key, entry);
    state.add_audit("IDEMPOTENCY_COMMITTED", serde_json::json!({ "operation": req.operation }));
    resp_ok(serde_json::json!({ "committed": true }))
}

async fn token_generate(_state: web::Data<AppState>, req: web::Json<TokenGenReq>) -> HttpResponse {
    let length = req.length.unwrap_or(32);
    let format = req.format.as_deref().unwrap_or("hex");
    let token = match format {
        "uuid" => Uuid::new_v4().to_string(),
        "base64" => {
            let bytes: Vec<u8> = (0..length).map(|_| rand::thread_rng().gen::<u8>()).collect();
            base64::Engine::encode(&base64::engine::general_purpose::URL_SAFE_NO_PAD, &bytes)
        }
        _ => {
            let bytes: Vec<u8> = (0..length).map(|_| rand::thread_rng().gen::<u8>()).collect();
            hex::encode(bytes)
        }
    };
    resp_ok(serde_json::json!({ "token": token, "format": format, "length": token.len() }))
}

async fn audit_events(state: web::Data<AppState>) -> HttpResponse {
    let log = state.audit_log.read().unwrap();
    let events: Vec<&AuditEvent> = log.iter().rev().take(100).collect();
    resp_ok(serde_json::json!(events))
}

async fn health_check() -> HttpResponse {
    HttpResponse::Ok().json(serde_json::json!({ "status": "ok", "service": "crypto-guard", "version": "1.0.0" }))
}

#[actix_web::main]
async fn main() -> std::io::Result<()> {
    env_logger::init_from_env(env_logger::Env::new().default_filter_or("info"));
    let _ = dotenvy::dotenv();
    let config = Config::from_env();
    let port = config.port;
    let state = web::Data::new(AppState::new(config));
    info!("[CryptoGuard] Starting on port {}", port);
    HttpServer::new(move || {
        App::new()
            .app_data(state.clone())
            .wrap(Logger::default())
            .route("/health", web::get().to(health_check))
            .route("/nonce/generate", web::post().to(nonce_generate))
            .route("/nonce/verify", web::post().to(nonce_verify))
            .route("/hmac/sign", web::post().to(hmac_sign))
            .route("/hmac/verify", web::post().to(hmac_verify))
            .route("/idempotency/check", web::post().to(idempotency_check))
            .route("/idempotency/commit", web::post().to(idempotency_commit))
            .route("/token/generate", web::post().to(token_generate))
            .route("/audit/events", web::get().to(audit_events))
    })
    .bind(format!("0.0.0.0:{}", port))?
    .run()
    .await
}
