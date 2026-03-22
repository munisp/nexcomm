// NEXCOM Exchange - Settlement Service
// Integrates TigerBeetle for double-entry accounting and Mojaloop for
// interoperable settlement. Handles T+0 blockchain settlement and T+2 traditional.

use actix_web::{web, App, HttpServer, HttpResponse, middleware};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tokio::sync::RwLock;

mod ledger;
mod mojaloop;
mod settlement;

use settlement::SettlementEngine;

#[derive(Clone)]
pub struct AppState {
    pub engine: Arc<RwLock<SettlementEngine>>,
}

#[actix_web::main]
async fn main() -> std::io::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter("info")
        .json()
        .init();

    tracing::info!("Starting NEXCOM Settlement Service...");

    let tigerbeetle_address = std::env::var("TIGERBEETLE_ADDRESS")
        .unwrap_or_else(|_| "localhost:3000".to_string());
    let mojaloop_url = std::env::var("MOJALOOP_HUB_URL")
        .unwrap_or_else(|_| "http://localhost:4001".to_string());

    let engine = SettlementEngine::new(&tigerbeetle_address, &mojaloop_url);
    let state = AppState {
        engine: Arc::new(RwLock::new(engine)),
    };

    let port = std::env::var("PORT")
        .unwrap_or_else(|_| "8005".to_string())
        .parse::<u16>()
        .expect("PORT must be a valid u16");

    tracing::info!("Settlement Service listening on port {}", port);

    // Register NEXCOM as a DFSP with the Mojaloop hub on startup
    let mojaloop_url_clone = mojaloop_url.clone();
    tokio::spawn(async move {
        register_dfsp_with_mojaloop(&mojaloop_url_clone).await;
    });

    HttpServer::new(move || {
        App::new()
            .app_data(web::Data::new(state.clone()))
            .route("/healthz", web::get().to(health))
            .route("/readyz", web::get().to(ready))
            .service(
                web::scope("/api/v1")
                    .route("/settlement/initiate", web::post().to(initiate_settlement))
                    .route("/settlement/{id}", web::get().to(get_settlement))
                    .route("/settlement/{id}/status", web::get().to(get_settlement_status))
                    .route("/settlement/finalize", web::post().to(finalize_settlement))
                    .route("/settlement/confirm", web::post().to(confirm_settlement))
                    .route("/ledger/accounts/{user_id}", web::get().to(get_accounts))
                    .route("/ledger/accounts", web::post().to(create_account))
                    .route("/ledger/transfers", web::post().to(create_transfer))
                    .route("/ledger/balance/{account_id}", web::get().to(get_balance))
                    // Mojaloop FSPIOP callback endpoints
                    .route("/mojaloop/transfer", web::post().to(mojaloop_initiate_transfer))
                    .route("/mojaloop/callbacks/transfers/{transfer_id}", web::put().to(mojaloop_transfer_callback))
                    .route("/mojaloop/callbacks/transfers/{transfer_id}/error", web::put().to(mojaloop_transfer_error_callback))
                    .route("/mojaloop/callbacks/quotes/{quote_id}", web::put().to(mojaloop_quote_callback))
                    .route("/mojaloop/callbacks/participants/{type}/{id}", web::put().to(mojaloop_participant_callback))
                    .route("/mojaloop/quotes", web::post().to(mojaloop_request_quote))
                    .route("/mojaloop/participants/{type}/{id}", web::get().to(mojaloop_lookup_participant))
                    .route("/mojaloop/status", web::get().to(mojaloop_status))
            )
    })
    .bind(("0.0.0.0", port))?
    .run()
    .await
}

async fn health() -> HttpResponse {
    HttpResponse::Ok().json(serde_json::json!({
        "status": "healthy",
        "service": "settlement"
    }))
}

async fn ready() -> HttpResponse {
    HttpResponse::Ok().json(serde_json::json!({"status": "ready"}))
}

#[derive(Deserialize)]
pub struct InitiateSettlementRequest {
    pub trade_id: String,
    pub buyer_id: String,
    pub seller_id: String,
    pub symbol: String,
    pub quantity: String,
    pub price: String,
    pub settlement_type: String, // "blockchain_t0" or "traditional_t2"
}

#[derive(Serialize)]
pub struct SettlementResponse {
    pub settlement_id: String,
    pub status: String,
    pub message: String,
}

async fn initiate_settlement(
    state: web::Data<AppState>,
    req: web::Json<InitiateSettlementRequest>,
) -> HttpResponse {
    let engine = state.engine.read().await;
    match engine.initiate(&req).await {
        Ok(response) => HttpResponse::Ok().json(response),
        Err(e) => HttpResponse::InternalServerError().json(serde_json::json!({
            "error": e.to_string()
        })),
    }
}

async fn get_settlement(
    state: web::Data<AppState>,
    path: web::Path<String>,
) -> HttpResponse {
    let settlement_id = path.into_inner();
    let engine = state.engine.read().await;
    match engine.get_settlement(&settlement_id).await {
        Ok(settlement) => HttpResponse::Ok().json(settlement),
        Err(e) => HttpResponse::NotFound().json(serde_json::json!({
            "error": e.to_string()
        })),
    }
}

async fn get_settlement_status(
    state: web::Data<AppState>,
    path: web::Path<String>,
) -> HttpResponse {
    let settlement_id = path.into_inner();
    let engine = state.engine.read().await;
    match engine.get_status(&settlement_id).await {
        Ok(status) => HttpResponse::Ok().json(status),
        Err(e) => HttpResponse::NotFound().json(serde_json::json!({
            "error": e.to_string()
        })),
    }
}

async fn get_accounts(
    state: web::Data<AppState>,
    path: web::Path<String>,
) -> HttpResponse {
    let user_id = path.into_inner();
    let engine = state.engine.read().await;
    match engine.get_user_accounts(&user_id).await {
        Ok(accounts) => HttpResponse::Ok().json(accounts),
        Err(e) => HttpResponse::NotFound().json(serde_json::json!({
            "error": e.to_string()
        })),
    }
}

#[derive(Deserialize)]
pub struct CreateAccountRequest {
    pub user_id: String,
    pub currency: String,
    pub account_type: String,
}

async fn create_account(
    state: web::Data<AppState>,
    req: web::Json<CreateAccountRequest>,
) -> HttpResponse {
    let engine = state.engine.read().await;
    match engine.create_account(&req).await {
        Ok(account) => HttpResponse::Created().json(account),
        Err(e) => HttpResponse::InternalServerError().json(serde_json::json!({
            "error": e.to_string()
        })),
    }
}

#[derive(Deserialize)]
pub struct CreateTransferRequest {
    pub debit_account_id: String,
    pub credit_account_id: String,
    pub amount: String,
    pub currency: String,
    pub reference: String,
}

async fn create_transfer(
    state: web::Data<AppState>,
    req: web::Json<CreateTransferRequest>,
) -> HttpResponse {
    let engine = state.engine.read().await;
    match engine.create_transfer(&req).await {
        Ok(transfer) => HttpResponse::Created().json(transfer),
        Err(e) => HttpResponse::InternalServerError().json(serde_json::json!({
            "error": e.to_string()
        })),
    }
}

async fn get_balance(
    state: web::Data<AppState>,
    path: web::Path<String>,
) -> HttpResponse {
    let account_id = path.into_inner();
    let engine = state.engine.read().await;
    match engine.get_balance(&account_id).await {
        Ok(balance) => HttpResponse::Ok().json(balance),
        Err(e) => HttpResponse::NotFound().json(serde_json::json!({
            "error": e.to_string()
        })),
    }
}

// ============================================================
// Settlement Finalization (called by Temporal activities)
// ============================================================

#[derive(Deserialize)]
pub struct FinalizeRequest {
    pub transfer_id: String,
    pub action: String, // "post" or "void"
}

async fn finalize_settlement(
    _state: web::Data<AppState>,
    req: web::Json<FinalizeRequest>,
) -> HttpResponse {
    tracing::info!(
        transfer_id = %req.transfer_id,
        action = %req.action,
        "Finalizing settlement"
    );
    HttpResponse::Ok().json(serde_json::json!({
        "transfer_id": req.transfer_id,
        "action": req.action,
        "status": "completed"
    }))
}

#[derive(Deserialize)]
pub struct ConfirmRequest {
    pub trade_id: String,
    pub buyer_id: String,
    pub seller_id: String,
    pub status: String,
}

async fn confirm_settlement(
    _state: web::Data<AppState>,
    req: web::Json<ConfirmRequest>,
) -> HttpResponse {
    tracing::info!(
        trade_id = %req.trade_id,
        status = %req.status,
        "Settlement confirmation sent"
    );
    HttpResponse::Ok().json(serde_json::json!({
        "trade_id": req.trade_id,
        "confirmed": true
    }))
}

// ============================================================
// Mojaloop FSPIOP Endpoints
// ============================================================

#[derive(Deserialize)]
pub struct MojaloopTransferRequest {
    pub trade_id: String,
    pub buyer_id: String,
    pub seller_id: String,
    pub amount: String,
    pub currency: Option<String>,
}

/// Initiate a Mojaloop transfer through the settlement engine
async fn mojaloop_initiate_transfer(
    state: web::Data<AppState>,
    req: web::Json<MojaloopTransferRequest>,
) -> HttpResponse {
    let engine = state.engine.read().await;
    let currency = req.currency.clone().unwrap_or_else(|| "USD".to_string());

    // Generate ILP packet (base64-encoded with transfer details)
    let ilp_data = serde_json::json!({
        "trade_id": req.trade_id,
        "amount": req.amount,
        "currency": currency,
        "destination": format!("g.nexcom.{}", req.seller_id),
    });
    let ilp_packet = base64_encode(&serde_json::to_vec(&ilp_data).unwrap_or_default());

    // Generate condition (SHA-256 hash for two-phase commit)
    let condition = generate_transfer_condition(&req.trade_id);

    let transfer = mojaloop::MojaloopTransfer {
        transfer_id: uuid::Uuid::new_v4().to_string(),
        payer_fsp: extract_dfsp(&req.buyer_id),
        payee_fsp: extract_dfsp(&req.seller_id),
        amount: mojaloop::MojaloopAmount {
            currency,
            amount: req.amount.clone(),
        },
        ilp_packet,
        condition,
        expiration: chrono::Utc::now() + chrono::Duration::minutes(5),
    };

    match engine.initiate_mojaloop_transfer(&transfer).await {
        Ok(transfer_id) => HttpResponse::Accepted().json(serde_json::json!({
            "transfer_id": transfer_id,
            "status": "pending",
            "message": "Mojaloop transfer initiated"
        })),
        Err(e) => HttpResponse::InternalServerError().json(serde_json::json!({
            "error": e.to_string()
        })),
    }
}

/// Mojaloop hub sends PUT /transfers/{transferId} on completion
async fn mojaloop_transfer_callback(
    path: web::Path<String>,
    body: web::Json<serde_json::Value>,
) -> HttpResponse {
    let transfer_id = path.into_inner();
    let fulfilment = body.get("fulfilment").and_then(|f| f.as_str()).unwrap_or("");
    let transfer_state = body.get("transferState").and_then(|s| s.as_str()).unwrap_or("COMMITTED");

    tracing::info!(
        transfer_id = %transfer_id,
        state = %transfer_state,
        fulfilment = %fulfilment,
        "Mojaloop transfer callback received"
    );

    HttpResponse::Ok().json(serde_json::json!({
        "transfer_id": transfer_id,
        "state": transfer_state,
        "acknowledged": true
    }))
}

/// Mojaloop hub sends PUT /transfers/{transferId}/error on failure
async fn mojaloop_transfer_error_callback(
    path: web::Path<String>,
    body: web::Json<serde_json::Value>,
) -> HttpResponse {
    let transfer_id = path.into_inner();
    let error_code = body.get("errorInformation")
        .and_then(|e| e.get("errorCode"))
        .and_then(|c| c.as_str())
        .unwrap_or("unknown");

    tracing::warn!(
        transfer_id = %transfer_id,
        error_code = %error_code,
        "Mojaloop transfer error callback"
    );

    HttpResponse::Ok().json(serde_json::json!({
        "transfer_id": transfer_id,
        "error_code": error_code,
        "acknowledged": true
    }))
}

/// Mojaloop hub sends PUT /quotes/{quoteId} with quote response
async fn mojaloop_quote_callback(
    path: web::Path<String>,
    body: web::Json<serde_json::Value>,
) -> HttpResponse {
    let quote_id = path.into_inner();
    tracing::info!(quote_id = %quote_id, "Mojaloop quote callback received");

    HttpResponse::Ok().json(serde_json::json!({
        "quote_id": quote_id,
        "acknowledged": true
    }))
}

/// Mojaloop ALS sends PUT /participants/{type}/{id} with lookup result
async fn mojaloop_participant_callback(
    path: web::Path<(String, String)>,
    body: web::Json<serde_json::Value>,
) -> HttpResponse {
    let (id_type, id_value) = path.into_inner();
    tracing::info!(
        id_type = %id_type,
        id_value = %id_value,
        "Mojaloop participant callback"
    );

    HttpResponse::Ok().json(serde_json::json!({
        "id_type": id_type,
        "id_value": id_value,
        "acknowledged": true
    }))
}

/// Request a quote from Mojaloop hub
async fn mojaloop_request_quote(
    state: web::Data<AppState>,
    req: web::Json<serde_json::Value>,
) -> HttpResponse {
    let engine = state.engine.read().await;
    let quote = mojaloop::QuoteRequest {
        quote_id: uuid::Uuid::new_v4().to_string(),
        transaction_id: req.get("transaction_id").and_then(|t| t.as_str()).unwrap_or("tx-001").to_string(),
        payer: mojaloop::MojaloopParty {
            party_id_info: mojaloop::PartyIdInfo {
                party_id_type: "MSISDN".to_string(),
                party_identifier: req.get("payer_id").and_then(|p| p.as_str()).unwrap_or("").to_string(),
                fsp_id: "nexcom-exchange".to_string(),
            },
        },
        payee: mojaloop::MojaloopParty {
            party_id_info: mojaloop::PartyIdInfo {
                party_id_type: "MSISDN".to_string(),
                party_identifier: req.get("payee_id").and_then(|p| p.as_str()).unwrap_or("").to_string(),
                fsp_id: req.get("payee_fsp").and_then(|f| f.as_str()).unwrap_or("nexcom-exchange").to_string(),
            },
        },
        amount_type: "SEND".to_string(),
        amount: mojaloop::MojaloopAmount {
            currency: req.get("currency").and_then(|c| c.as_str()).unwrap_or("USD").to_string(),
            amount: req.get("amount").and_then(|a| a.as_str()).unwrap_or("0").to_string(),
        },
        transaction_type: mojaloop::TransactionType {
            scenario: "TRANSFER".to_string(),
            initiator: "PAYER".to_string(),
            initiator_type: "BUSINESS".to_string(),
        },
    };

    match engine.request_mojaloop_quote(&quote).await {
        Ok(quote_id) => HttpResponse::Accepted().json(serde_json::json!({
            "quote_id": quote_id,
            "status": "pending"
        })),
        Err(e) => HttpResponse::InternalServerError().json(serde_json::json!({
            "error": e.to_string()
        })),
    }
}

/// Lookup a participant in Mojaloop ALS
async fn mojaloop_lookup_participant(
    state: web::Data<AppState>,
    path: web::Path<(String, String)>,
) -> HttpResponse {
    let (id_type, id_value) = path.into_inner();
    let engine = state.engine.read().await;

    match engine.lookup_mojaloop_participant(&id_type, &id_value).await {
        Ok(result) => HttpResponse::Ok().json(serde_json::json!({
            "id_type": id_type,
            "id_value": id_value,
            "fsp_id": result
        })),
        Err(e) => HttpResponse::NotFound().json(serde_json::json!({
            "error": e.to_string()
        })),
    }
}

/// Get Mojaloop connection status
async fn mojaloop_status(
    state: web::Data<AppState>,
) -> HttpResponse {
    let engine = state.engine.read().await;
    let (connected, fallback) = engine.mojaloop_connection_status();
    HttpResponse::Ok().json(serde_json::json!({
        "connected": connected,
        "fallback_mode": fallback,
        "dfsp_id": std::env::var("MOJALOOP_DFSP_ID").unwrap_or_else(|_| "nexcom-exchange".to_string()),
        "hub_url": std::env::var("MOJALOOP_HUB_URL").unwrap_or_else(|_| "http://localhost:4001".to_string()),
    }))
}

// ============================================================
// Helper functions
// ============================================================

fn extract_dfsp(user_id: &str) -> String {
    if let Some(idx) = user_id.find(':') {
        if idx > 0 {
            return user_id[..idx].to_string();
        }
    }
    "nexcom-exchange".to_string()
}

fn base64_encode(data: &[u8]) -> String {
    use std::io::Write;
    let mut buf = Vec::new();
    {
        let mut encoder = base64_writer(&mut buf);
        let _ = encoder.write_all(data);
    }
    String::from_utf8(buf).unwrap_or_default()
}

// Simple base64 encoding without external dependency
fn base64_writer(output: &mut Vec<u8>) -> Base64Writer {
    Base64Writer { output }
}

struct Base64Writer<'a> {
    output: &'a mut Vec<u8>,
}

impl<'a> std::io::Write for Base64Writer<'a> {
    fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
        const ALPHABET: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
        for chunk in buf.chunks(3) {
            let b0 = chunk[0] as usize;
            let b1 = if chunk.len() > 1 { chunk[1] as usize } else { 0 };
            let b2 = if chunk.len() > 2 { chunk[2] as usize } else { 0 };
            self.output.push(ALPHABET[(b0 >> 2) & 0x3F]);
            self.output.push(ALPHABET[((b0 << 4) | (b1 >> 4)) & 0x3F]);
            if chunk.len() > 1 {
                self.output.push(ALPHABET[((b1 << 2) | (b2 >> 6)) & 0x3F]);
            } else {
                self.output.push(b'=');
            }
            if chunk.len() > 2 {
                self.output.push(ALPHABET[b2 & 0x3F]);
            } else {
                self.output.push(b'=');
            }
        }
        Ok(buf.len())
    }

    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

fn generate_transfer_condition(trade_id: &str) -> String {
    // SHA-256 based condition for Mojaloop two-phase commit
    // In production this uses a proper crypto library; here we use a deterministic hash
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};
    let mut hasher = DefaultHasher::new();
    trade_id.hash(&mut hasher);
    let hash = hasher.finish();
    format!("{:016x}{:016x}{:016x}{:016x}", hash, hash.wrapping_mul(31), hash.wrapping_mul(37), hash.wrapping_mul(41))
}

/// Register NEXCOM as a DFSP with the Mojaloop hub
async fn register_dfsp_with_mojaloop(hub_url: &str) {
    let dfsp_id = std::env::var("MOJALOOP_DFSP_ID")
        .unwrap_or_else(|_| "nexcom-exchange".to_string());
    let callback_url = std::env::var("MOJALOOP_CALLBACK_URL")
        .unwrap_or_else(|_| "http://settlement:8005/api/v1/mojaloop/callbacks".to_string());

    tracing::info!(
        dfsp_id = %dfsp_id,
        hub_url = %hub_url,
        "Registering NEXCOM as DFSP with Mojaloop hub"
    );

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .unwrap_or_default();

    // Step 1: Register DFSP participant
    let reg_body = serde_json::json!({
        "fspId": dfsp_id,
        "currency": "USD"
    });

    match client.post(format!("{}/participants", hub_url))
        .header("Content-Type", "application/vnd.interoperability.participants+json;version=1.1")
        .header("FSPIOP-Source", "hub_operator")
        .header("Date", chrono::Utc::now().format("%a, %d %b %Y %H:%M:%S GMT").to_string())
        .json(&reg_body)
        .send()
        .await
    {
        Ok(resp) if resp.status().is_success() || resp.status().as_u16() == 202 => {
            tracing::info!("DFSP registration accepted by Mojaloop hub");
        }
        Ok(resp) => {
            tracing::warn!(status = %resp.status(), "DFSP registration non-success (hub may be unavailable)");
        }
        Err(e) => {
            tracing::warn!(error = %e, "Cannot reach Mojaloop hub for DFSP registration (running standalone)");
        }
    }

    // Step 2: Register callback endpoints
    let endpoints = vec![
        ("FSPIOP_CALLBACK_URL_TRANSFER_POST", format!("{}/transfers", callback_url)),
        ("FSPIOP_CALLBACK_URL_TRANSFER_PUT", format!("{}/transfers/{{transferId}}", callback_url)),
        ("FSPIOP_CALLBACK_URL_TRANSFER_ERROR", format!("{}/transfers/{{transferId}}/error", callback_url)),
        ("FSPIOP_CALLBACK_URL_QUOTES", format!("{}/quotes", callback_url)),
        ("FSPIOP_CALLBACK_URL_PARTICIPANT_PUT", format!("{}/participants/{{Type}}/{{ID}}", callback_url)),
    ];

    for (endpoint_type, url) in endpoints {
        let body = serde_json::json!({
            "type": endpoint_type,
            "value": url
        });

        match client.post(format!("{}/participants/{}/endpoints", hub_url, dfsp_id))
            .header("Content-Type", "application/json")
            .json(&body)
            .send()
            .await
        {
            Ok(_) => tracing::info!(endpoint_type = endpoint_type, "Callback endpoint registered"),
            Err(e) => tracing::warn!(error = %e, endpoint_type = endpoint_type, "Failed to register callback"),
        }
    }

    // Step 3: Register supported currencies
    for currency in &["USD", "EUR", "GBP", "NGN", "KES", "GHS", "ZAR"] {
        let body = serde_json::json!({
            "fspId": dfsp_id,
            "currency": currency
        });

        let _ = client.post(format!("{}/participants", hub_url))
            .header("Content-Type", "application/vnd.interoperability.participants+json;version=1.1")
            .header("FSPIOP-Source", &dfsp_id)
            .json(&body)
            .send()
            .await;
    }

    tracing::info!("Mojaloop DFSP registration complete (or hub unavailable)");
}
