//! NEXCOM Exchange Matching Engine
//! High-performance commodity exchange with microsecond-latency orderbook,
//! futures/options lifecycle, CCP clearing, FIX 4.4 gateway, market surveillance,
//! physical delivery infrastructure, and HA/DR failover.

mod auction;
mod broker;
mod circuit_breaker;
mod clearing;
mod corporate_actions;
mod delivery;
mod engine;
mod fees;
mod fix;
mod futures;
mod ha;
mod indices;
mod investor_protection;
mod market_data;
mod market_maker;
mod options;
mod orderbook;
pub mod persistence;
mod kafka;
mod surveillance;
mod types;

use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    response::Json,
    routing::{delete, get, post, put},
    Router,
};
use engine::ExchangeEngine;
use std::collections::HashMap;
use std::sync::Arc;
use tower_http::cors::{Any, CorsLayer};
use tower_http::limit::RequestBodyLimitLayer;
use tracing::info;
use types::*;

#[derive(Clone)]
struct AppState {
    engine: Arc<ExchangeEngine>,
    kafka: Arc<kafka::KafkaPublisher>,
}
impl std::ops::Deref for AppState {
    type Target = ExchangeEngine;
    fn deref(&self) -> &Self::Target {
        &self.engine
    }
}

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "nexcom_matching_engine=info,tower_http=info".into()),
        )
        .with_target(false)
        .init();

    let port = std::env::var("PORT").unwrap_or_else(|_| "8080".to_string());

    info!(
        "Starting NEXCOM Matching Engine v{}",
        env!("CARGO_PKG_VERSION")
    );

    let ingestion_url = std::env::var("INGESTION_ENGINE_URL")
        .unwrap_or_else(|_| "http://localhost:8009".to_string());
    let kafka_publisher = Arc::new(kafka::KafkaPublisher::new(
        ingestion_url,
        std::env::var("NODE_ID").unwrap_or_else(|_| "nexcom-primary".to_string()),
    ));
    let engine = Arc::new(ExchangeEngine::new(
        std::env::var("NODE_ID").unwrap_or_else(|_| "nexcom-primary".to_string()),
        match std::env::var("NODE_ROLE")
            .unwrap_or_else(|_| "primary".to_string())
            .as_str()
        {
            "standby" => NodeRole::Standby,
            _ => NodeRole::Primary,
        },
    ));
    let state = AppState {
        engine: engine.clone(),
        kafka: kafka_publisher.clone(),
    };

    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    let app = Router::new()
        // Health & Status
        .route("/health", get(health))
        .route("/api/v1/status", get(exchange_status))
        .route("/api/v1/cluster", get(cluster_status))
        // Orders
        .route("/api/v1/orders", post(submit_order))
        .route(
            "/api/v1/orders/:symbol/:order_id",
            delete(cancel_order),
        )
        .route(
            "/api/v1/orders/:symbol/:order_id/amend",
            put(amend_order),
        )
        // Market Data
        .route("/api/v1/depth/:symbol", get(market_depth))
        .route("/api/v1/symbols", get(list_symbols))
        // Futures
        .route("/api/v1/futures/contracts", get(list_futures))
        .route("/api/v1/futures/contracts/:symbol", get(get_future))
        .route("/api/v1/futures/specs", get(list_specs))
        // Options
        .route("/api/v1/options/contracts", get(list_options))
        .route("/api/v1/options/price", get(price_option))
        .route("/api/v1/options/chain/:underlying", get(option_chain))
        // Clearing
        .route("/api/v1/clearing/margins/:account_id", get(get_margins))
        .route(
            "/api/v1/clearing/positions/:account_id",
            get(get_positions),
        )
        .route("/api/v1/clearing/guarantee-fund", get(guarantee_fund))
        // Surveillance
        .route("/api/v1/surveillance/alerts", get(surveillance_alerts))
        .route(
            "/api/v1/surveillance/position-limits/:account_id/:symbol",
            get(check_position),
        )
        .route("/api/v1/surveillance/reports/daily", get(daily_report))
        // Delivery
        .route("/api/v1/delivery/warehouses", get(list_warehouses))
        .route(
            "/api/v1/delivery/warehouses/:commodity",
            get(warehouses_for_commodity),
        )
        .route(
            "/api/v1/delivery/receipts/:account_id",
            get(account_receipts),
        )
        .route("/api/v1/delivery/receipts", post(issue_receipt))
        .route(
            "/api/v1/delivery/grades/:commodity",
            get(commodity_grades),
        )
        .route("/api/v1/delivery/stocks", get(warehouse_stocks))
        // Audit
        .route("/api/v1/audit/entries", get(audit_entries))
        .route("/api/v1/audit/integrity", get(audit_integrity))
        // FIX
        .route("/api/v1/fix/sessions", get(fix_sessions))
        .route("/api/v1/fix/message", post(fix_message))
        // Market Makers
        .route("/api/v1/market-makers", get(list_market_makers))
        .route("/api/v1/market-makers/:id", get(get_market_maker))
        .route("/api/v1/market-makers/:id/performance", get(market_maker_performance))
        .route("/api/v1/market-makers/quotes/:symbol", get(market_maker_quotes))
        .route("/api/v1/market-makers/quotes", post(submit_quote))
        // Indices
        .route("/api/v1/indices", get(list_indices))
        .route("/api/v1/indices/values", get(index_values))
        .route("/api/v1/indices/:id", get(get_index))
        .route("/api/v1/indices/:id/value", get(get_index_value))
        // Corporate Actions
        .route("/api/v1/corporate-actions", get(list_corporate_actions))
        .route("/api/v1/corporate-actions/pending", get(pending_corporate_actions))
        .route("/api/v1/corporate-actions/:symbol", get(corporate_actions_for_symbol))
        .route("/api/v1/corporate-actions/:id/process", post(process_corporate_action))
        // Brokers
        .route("/api/v1/brokers", get(list_brokers))
        .route("/api/v1/brokers/:id", get(get_broker))
        .route("/api/v1/brokers/connected", get(connected_brokers))
        .route("/api/v1/brokers/route", post(route_order))
        // Circuit Breakers (NYSE-equivalent)
        .route("/api/v1/circuit-breaker/bands", get(circuit_breaker_bands))
        .route("/api/v1/circuit-breaker/bands/:symbol", get(circuit_breaker_band))
        .route("/api/v1/circuit-breaker/market-wide", get(market_wide_status))
        .route("/api/v1/circuit-breaker/interruptions", get(volatility_interruptions))
        // Auctions (NYSE-equivalent)
        .route("/api/v1/auctions/active", get(active_auctions))
        .route("/api/v1/auctions/history", get(auction_history))
        .route("/api/v1/auctions/:symbol/indicative", get(auction_indicative))
        .route("/api/v1/auctions/:symbol/start", post(start_auction))
        .route("/api/v1/auctions/:symbol/run", post(run_auction))
        // Market Data Infrastructure (NYSE-equivalent)
        .route("/api/v1/market-data/tape", get(consolidated_tape))
        .route("/api/v1/market-data/tape/:symbol", get(symbol_tape))
        .route("/api/v1/market-data/nbbo/:symbol", get(nbbo_quote))
        .route("/api/v1/market-data/snapshot/:symbol", get(market_snapshot))
        .route("/api/v1/market-data/stats", get(all_stats))
        // Investor Protection Fund (NYSE SIPC-equivalent)
        .route("/api/v1/investor-protection/status", get(ipf_status))
        .route("/api/v1/investor-protection/claims", get(ipf_claims))
        .route("/api/v1/investor-protection/claims", post(ipf_submit_claim))
        // Fee Engine & Revenue Management
        .route("/api/v1/fees/status", get(fee_status))
        .route("/api/v1/fees/schedules", get(fee_schedules))
        .route("/api/v1/fees/schedules/:key", get(fee_schedule_by_key))
        .route("/api/v1/fees/api-tiers", get(fee_api_tiers))
        .route("/api/v1/fees/charges/recent", get(fee_recent_charges))
        .route("/api/v1/fees/charges/:account_id", get(fee_account_charges))
        .route("/api/v1/fees/calculate", post(fee_calculate_trade))
        .route("/api/v1/fees/subscriptions", get(fee_subscriptions))
        .route("/api/v1/fees/subscriptions", post(fee_create_subscription))
        .route("/api/v1/fees/memberships", get(fee_memberships))
        .route("/api/v1/fees/memberships", post(fee_register_membership))
        .route("/api/v1/fees/revenue", get(fee_revenue_summary))
        .route("/api/v1/fees/invoices", get(fee_invoices))
        .route("/api/v1/fees/invoices/generate", post(fee_generate_invoice))
        .route("/api/v1/fees/listing", post(fee_charge_listing))
        .route("/api/v1/fees/tokenization", post(fee_charge_tokenization))
        .route("/metrics", get(prometheus_metrics))
        .route("/readiness", get(readiness_probe))
        .layer(RequestBodyLimitLayer::new(1024 * 1024)) // 1MB request body limit
        .layer(cors)
        .with_state(state);

    let addr = format!("0.0.0.0:{}", port);
    info!("NEXCOM Matching Engine v{} listening on {}", env!("CARGO_PKG_VERSION"), addr);

    let listener = tokio::net::TcpListener::bind(&addr).await.unwrap();
    // Graceful shutdown: drain in-flight requests on SIGTERM/SIGINT
    axum::serve(listener, app)
        .with_graceful_shutdown(async {
            let mut sigterm = tokio::signal::unix::signal(
                tokio::signal::unix::SignalKind::terminate()
            ).expect("failed to install SIGTERM handler");
            tokio::select! {
                _ = tokio::signal::ctrl_c() => { info!("Received SIGINT, initiating graceful shutdown"); }
                _ = sigterm.recv() => { info!("Received SIGTERM, initiating graceful shutdown"); }
            }
        })
        .await
        .unwrap();
    info!("Matching engine shutdown complete");
}

// ─── Prometheus Metrics Endpoint ───────────────────────────────────────────────────
async fn prometheus_metrics(
    State(state): State<AppState>,
) -> axum::response::Response {
    let status = state.engine.status();
    let total_orders = status.get("total_orders").and_then(|v| v.as_u64()).unwrap_or(0);
    let total_trades = status.get("total_trades").and_then(|v| v.as_u64()).unwrap_or(0);
    let symbols_count = status.get("symbols_count").and_then(|v| v.as_u64()).unwrap_or(0);
    let is_primary = state.engine.cluster.role() == NodeRole::Primary;
    let body = format!(
        "# HELP nexcom_matching_orders_total Total orders submitted to matching engine\n\
         # TYPE nexcom_matching_orders_total counter\n\
         nexcom_matching_orders_total {{service=\"matching-engine\"}} {}\n\
         # HELP nexcom_matching_trades_total Total trades executed\n\
         # TYPE nexcom_matching_trades_total counter\n\
         nexcom_matching_trades_total {{service=\"matching-engine\"}} {}\n\
         # HELP nexcom_matching_symbols_active Active trading symbols\n\
         # TYPE nexcom_matching_symbols_active gauge\n\
         nexcom_matching_symbols_active {{service=\"matching-engine\"}} {}\n\
         # HELP nexcom_matching_is_primary Whether this node is primary (1) or standby (0)\n\
         # TYPE nexcom_matching_is_primary gauge\n\
         nexcom_matching_is_primary {{service=\"matching-engine\"}} {}\n",
        total_orders,
        total_trades,
        symbols_count,
        if is_primary { 1 } else { 0 },
    );
    axum::response::Response::builder()
        .status(200)
        .header("Content-Type", "text/plain; version=0.0.4; charset=utf-8")
        .body(axum::body::Body::from(body))
        .unwrap()
}

// ─── Kubernetes Readiness Probe ──────────────────────────────────────────────────────
async fn readiness_probe(
    State(state): State<AppState>,
) -> axum::response::Response {
    let accepting = state.engine.cluster.is_accepting_orders();
    if accepting {
        axum::response::Response::builder()
            .status(200)
            .header("Content-Type", "application/json")
            .body(axum::body::Body::from(r#"{"status":"ready","accepting_orders":true}"#))
            .unwrap()
    } else {
        axum::response::Response::builder()
            .status(503)
            .header("Content-Type", "application/json")
            .body(axum::body::Body::from(r#"{"status":"not_ready","accepting_orders":false}"#))
            .unwrap()
    }
}

// ─── Health & Status ─────────────────────────────────────────────────────────

async fn health(State(engine): State<AppState>) -> Json<serde_json::Value> {
    Json(serde_json::json!({
        "status": "ok",
        "service": "nexcom-matching-engine",
        "version": env!("CARGO_PKG_VERSION"),
        "role": engine.cluster.role(),
        "accepting_orders": engine.cluster.is_accepting_orders(),
    }))
}

async fn exchange_status(State(engine): State<AppState>) -> Json<serde_json::Value> {
    Json(engine.status())
}

async fn cluster_status(State(engine): State<AppState>) -> Json<serde_json::Value> {
    Json(engine.cluster.cluster_status())
}

// ─── Orders ──────────────────────────────────────────────────────────────────

async fn submit_order(
    State(engine): State<AppState>,
    Json(req): Json<NewOrderRequest>,
) -> Result<Json<ApiResponse<serde_json::Value>>, StatusCode> {
    let order = Order::new(
        req.client_order_id,
        req.account_id,
        req.symbol,
        req.side,
        req.order_type,
        req.time_in_force,
        req.price.map(to_price).unwrap_or(0),
        req.stop_price.map(to_price).unwrap_or(0),
        (req.quantity * 1_000_000.0) as Qty,
    );

    match engine.submit_order(order) {
        Ok((trades, result_order)) => {
            // Publish OrderCreated event to Kafka
            engine.kafka.publish(kafka::MatchingEvent::OrderCreated(kafka::OrderCreatedEvent {
                order_id: result_order.id.to_string(),
                account_id: result_order.account_id.clone(),
                symbol: result_order.symbol.clone(),
                side: format!("{:?}", result_order.side).to_lowercase(),
                order_type: format!("{:?}", result_order.order_type).to_lowercase(),
                quantity: result_order.quantity as f64 / 1_000_000.0,
                price: if result_order.price > 0 { Some(from_price(result_order.price)) } else { None },
                stop_price: if result_order.stop_price > 0 { Some(from_price(result_order.stop_price)) } else { None },
                time_in_force: format!("{:?}", result_order.time_in_force).to_lowercase(),
                timestamp_us: kafka::now_us(),
                node_id: std::env::var("NODE_ID").unwrap_or_else(|_| "nexcom-primary".to_string()),
            }));
            // Publish TradeExecuted and OrderFilled events for each fill
            for trade in &trades {
                engine.kafka.publish(kafka::MatchingEvent::TradeExecuted(kafka::TradeExecutedEvent {
                    trade_id: trade.id.to_string(),
                    symbol: trade.symbol.clone(),
                    buyer_order_id: trade.buyer_order_id.to_string(),
                    seller_order_id: trade.seller_order_id.to_string(),
                    buyer_account_id: trade.buyer_account.clone(),
                    seller_account_id: trade.seller_account.clone(),
                    quantity: trade.quantity as f64 / 1_000_000.0,
                    price: from_price(trade.price),
                    aggressor_side: format!("{:?}", trade.aggressor_side).to_lowercase(),
                    timestamp_us: kafka::now_us(),
                    node_id: std::env::var("NODE_ID").unwrap_or_else(|_| "nexcom-primary".to_string()),
                }));
            }
            // Publish OrderFilled if the order is fully or partially filled
            if !trades.is_empty() {
                engine.kafka.publish(kafka::MatchingEvent::OrderFilled(kafka::OrderFilledEvent {
                    order_id: result_order.id.to_string(),
                    account_id: result_order.account_id.clone(),
                    symbol: result_order.symbol.clone(),
                    side: format!("{:?}", result_order.side).to_lowercase(),
                    filled_quantity: result_order.filled_quantity as f64 / 1_000_000.0,
                    remaining_quantity: result_order.remaining_quantity as f64 / 1_000_000.0,
                    fill_price: from_price(result_order.average_price),
                    is_fully_filled: result_order.remaining_quantity == 0,
                    trade_id: trades.last().map(|t| t.id.to_string()).unwrap_or_default(),
                    timestamp_us: kafka::now_us(),
                    node_id: std::env::var("NODE_ID").unwrap_or_else(|_| "nexcom-primary".to_string()),
                }));
            }
            let response = serde_json::json!({
                "order": {
                    "id": result_order.id,
                    "status": result_order.status,
                    "filled_quantity": result_order.filled_quantity,
                    "remaining_quantity": result_order.remaining_quantity,
                    "average_price": from_price(result_order.average_price),
                },
                "trades": trades.iter().map(|t| serde_json::json!({
                    "id": t.id,
                    "price": from_price(t.price),
                    "quantity": t.quantity,
                    "buyer": t.buyer_account,
                    "seller": t.seller_account,
                    "timestamp": t.timestamp,
                })).collect::<Vec<_>>(),
            });
            Ok(Json(ApiResponse::ok(response)))
        }
        Err(e) => {
            // Publish OrderRejected event
            engine.kafka.publish(kafka::MatchingEvent::OrderRejected(kafka::OrderRejectedEvent {
                order_id: String::new(), // no order ID on rejection
                account_id: String::new(),
                symbol: String::new(),
                reason: e.clone(),
                timestamp_us: kafka::now_us(),
                node_id: std::env::var("NODE_ID").unwrap_or_else(|_| "nexcom-primary".to_string()),
            }));
            Ok(Json(ApiResponse::<serde_json::Value>::err(e)))
        }
    }
}

async fn cancel_order(
    State(engine): State<AppState>,
    Path((symbol, order_id)): Path<(String, String)>,
) -> Result<Json<ApiResponse<serde_json::Value>>, StatusCode> {
    let uuid = uuid::Uuid::parse_str(&order_id).map_err(|_| StatusCode::BAD_REQUEST)?;
    match engine.cancel_order(&symbol, uuid, "system") {
        Ok(order) => {
            engine.kafka.publish(kafka::MatchingEvent::OrderCancelled(kafka::OrderCancelledEvent {
                order_id: order.id.to_string(),
                account_id: order.account_id.clone(),
                symbol: order.symbol.clone(),
                reason: "user_request".to_string(),
                remaining_quantity: order.remaining_quantity as f64 / 1_000_000.0,
                timestamp_us: kafka::now_us(),
                node_id: std::env::var("NODE_ID").unwrap_or_else(|_| "nexcom-primary".to_string()),
            }));
            Ok(Json(ApiResponse::ok(serde_json::json!({
                "order_id": order.id,
                "status": order.status,
            }))))
        }
        Err(e) => Ok(Json(ApiResponse::<serde_json::Value>::err(e))),
    }
}

#[derive(serde::Deserialize)]
struct AmendOrderRequest {
    price: Option<f64>,
    quantity: Option<f64>,
}

async fn amend_order(
    State(engine): State<AppState>,
    Path((symbol, order_id)): Path<(String, String)>,
    Json(req): Json<AmendOrderRequest>,
) -> Result<Json<ApiResponse<serde_json::Value>>, StatusCode> {
    let uuid = uuid::Uuid::parse_str(&order_id).map_err(|_| StatusCode::BAD_REQUEST)?;
    let new_price = req.price.map(to_price);
    let new_quantity = req.quantity.map(|q| (q * 1_000_000.0) as Qty);

    match engine.amend_order(&symbol, uuid, new_price, new_quantity) {
        Ok((trades, new_order, old_order)) => {
            let response = serde_json::json!({
                "old_order": {
                    "id": old_order.id,
                    "status": old_order.status,
                },
                "new_order": {
                    "id": new_order.id,
                    "status": new_order.status,
                    "price": from_price(new_order.price),
                    "quantity": new_order.quantity,
                    "filled_quantity": new_order.filled_quantity,
                },
                "trades": trades.iter().map(|t| serde_json::json!({
                    "id": t.id,
                    "price": from_price(t.price),
                    "quantity": t.quantity,
                })).collect::<Vec<_>>(),
            });
            Ok(Json(ApiResponse::ok(response)))
        }
        Err(e) => Ok(Json(ApiResponse::<serde_json::Value>::err(e))),
    }
}

// ─── Market Data ─────────────────────────────────────────────────────────────

#[derive(serde::Deserialize)]
struct DepthQuery {
    levels: Option<usize>,
}

async fn market_depth(
    State(engine): State<AppState>,
    Path(symbol): Path<String>,
    Query(params): Query<DepthQuery>,
) -> Json<ApiResponse<MarketDepth>> {
    let levels = params.levels.unwrap_or(20);
    match engine.orderbooks.depth(&symbol, levels) {
        Some(depth) => Json(ApiResponse::ok(depth)),
        None => Json(ApiResponse::err(format!("Symbol {} not found", symbol))),
    }
}

async fn list_symbols(State(engine): State<AppState>) -> Json<ApiResponse<Vec<String>>> {
    Json(ApiResponse::ok(engine.orderbooks.symbols()))
}

// ─── Futures ─────────────────────────────────────────────────────────────────

async fn list_futures(
    State(engine): State<AppState>,
) -> Json<ApiResponse<Vec<FuturesContract>>> {
    Json(ApiResponse::ok(engine.futures.active_contracts()))
}

async fn get_future(
    State(engine): State<AppState>,
    Path(symbol): Path<String>,
) -> Json<ApiResponse<FuturesContract>> {
    match engine.futures.get_contract(&symbol) {
        Some(contract) => Json(ApiResponse::ok(contract)),
        None => Json(ApiResponse::err(format!("Contract {} not found", symbol))),
    }
}

async fn list_specs(State(engine): State<AppState>) -> Json<ApiResponse<serde_json::Value>> {
    let specs: Vec<serde_json::Value> = engine
        .futures
        .get_specs()
        .into_iter()
        .map(|(name, spec)| {
            serde_json::json!({
                "underlying": name,
                "contract_size": spec.contract_size,
                "tick_size": from_price(spec.tick_size),
                "initial_margin_pct": spec.initial_margin_pct,
                "maintenance_margin_pct": spec.maintenance_margin_pct,
                "daily_limit_pct": spec.daily_limit_pct,
                "settlement_type": spec.settlement_type,
                "delivery_months": spec.delivery_months,
                "trading_hours": spec.trading_hours,
            })
        })
        .collect();
    Json(ApiResponse::ok(serde_json::json!(specs)))
}

// ─── Options ─────────────────────────────────────────────────────────────────

async fn list_options(
    State(engine): State<AppState>,
) -> Json<ApiResponse<Vec<OptionsContract>>> {
    Json(ApiResponse::ok(engine.options.active_contracts()))
}

#[derive(serde::Deserialize)]
struct PriceOptionQuery {
    symbol: String,
    futures_price: f64,
    volatility: f64,
}

async fn price_option(
    State(engine): State<AppState>,
    Query(params): Query<PriceOptionQuery>,
) -> Json<ApiResponse<serde_json::Value>> {
    match engine
        .options
        .price_option(&params.symbol, params.futures_price, params.volatility)
    {
        Some((price, greeks)) => Json(ApiResponse::ok(serde_json::json!({
            "symbol": params.symbol,
            "theoretical_price": price,
            "greeks": greeks,
        }))),
        None => Json(ApiResponse::err("Option not found")),
    }
}

async fn option_chain(
    State(engine): State<AppState>,
    Path(underlying): Path<String>,
) -> Json<ApiResponse<Vec<OptionsContract>>> {
    let contracts = engine.options.options_for_underlying(&underlying);
    Json(ApiResponse::ok(contracts))
}

// ─── Clearing ────────────────────────────────────────────────────────────────

async fn get_margins(
    State(engine): State<AppState>,
    Path(account_id): Path<String>,
) -> Json<ApiResponse<MarginRequirement>> {
    let positions = engine.clearing.get_positions(&account_id);
    if positions.is_empty() {
        return Json(ApiResponse::err("No positions found"));
    }

    let mut prices = HashMap::new();
    for pos in &positions {
        prices.insert(pos.symbol.clone(), from_price(pos.average_price));
    }

    let margin = engine.clearing.span.calculate_margin(&positions, &prices);
    Json(ApiResponse::ok(margin))
}

async fn get_positions(
    State(engine): State<AppState>,
    Path(account_id): Path<String>,
) -> Json<ApiResponse<Vec<Position>>> {
    Json(ApiResponse::ok(engine.clearing.get_positions(&account_id)))
}

async fn guarantee_fund(
    State(engine): State<AppState>,
) -> Json<ApiResponse<serde_json::Value>> {
    Json(ApiResponse::ok(serde_json::json!({
        "total": from_price(engine.clearing.guarantee_fund_total()),
        "members": engine.clearing.member_count(),
    })))
}

// ─── Surveillance ────────────────────────────────────────────────────────────

async fn surveillance_alerts(
    State(engine): State<AppState>,
) -> Json<ApiResponse<Vec<SurveillanceAlert>>> {
    Json(ApiResponse::ok(engine.surveillance.unresolved_alerts()))
}

async fn check_position(
    State(engine): State<AppState>,
    Path((account_id, symbol)): Path<(String, String)>,
) -> Json<ApiResponse<serde_json::Value>> {
    let pos = engine
        .surveillance
        .position_limits
        .get_position(&account_id, &symbol);
    Json(ApiResponse::ok(serde_json::json!({
        "account_id": account_id,
        "symbol": symbol,
        "net_position": pos,
    })))
}

async fn daily_report(
    State(_engine): State<AppState>,
) -> Json<ApiResponse<serde_json::Value>> {
    let report = surveillance::RegulatoryReporter::daily_trade_report(&[]);
    Json(ApiResponse::ok(report))
}

// ─── Delivery ────────────────────────────────────────────────────────────────

async fn list_warehouses(
    State(engine): State<AppState>,
) -> Json<ApiResponse<Vec<Warehouse>>> {
    Json(ApiResponse::ok(engine.delivery.get_warehouses()))
}

async fn warehouses_for_commodity(
    State(engine): State<AppState>,
    Path(commodity): Path<String>,
) -> Json<ApiResponse<Vec<Warehouse>>> {
    Json(ApiResponse::ok(
        engine
            .delivery
            .get_warehouses_for_commodity(&commodity.to_uppercase()),
    ))
}

async fn account_receipts(
    State(engine): State<AppState>,
    Path(account_id): Path<String>,
) -> Json<ApiResponse<Vec<WarehouseReceipt>>> {
    Json(ApiResponse::ok(
        engine.delivery.get_receipts_for_account(&account_id),
    ))
}

#[derive(serde::Deserialize)]
struct IssueReceiptRequest {
    warehouse_id: String,
    commodity: String,
    quantity_tonnes: f64,
    grade: String,
    owner_account: String,
}

async fn issue_receipt(
    State(engine): State<AppState>,
    Json(req): Json<IssueReceiptRequest>,
) -> Json<ApiResponse<WarehouseReceipt>> {
    match engine.delivery.issue_receipt(
        &req.warehouse_id,
        &req.commodity,
        req.quantity_tonnes,
        &req.grade,
        &req.owner_account,
    ) {
        Ok(receipt) => Json(ApiResponse::ok(receipt)),
        Err(e) => Json(ApiResponse::err(e)),
    }
}

async fn commodity_grades(
    State(engine): State<AppState>,
    Path(commodity): Path<String>,
) -> Json<ApiResponse<Vec<delivery::GradeSpec>>> {
    Json(ApiResponse::ok(
        engine.delivery.get_grades(&commodity.to_uppercase()),
    ))
}

async fn warehouse_stocks(
    State(engine): State<AppState>,
) -> Json<ApiResponse<HashMap<String, f64>>> {
    Json(ApiResponse::ok(engine.delivery.total_stocks()))
}

// ─── Audit ───────────────────────────────────────────────────────────────────

#[derive(serde::Deserialize)]
struct AuditQuery {
    from_seq: Option<u64>,
    to_seq: Option<u64>,
}

async fn audit_entries(
    State(engine): State<AppState>,
    Query(params): Query<AuditQuery>,
) -> Json<ApiResponse<Vec<AuditEntry>>> {
    let from = params.from_seq.unwrap_or(1);
    let to = params.to_seq.unwrap_or(engine.audit.current_sequence());
    Json(ApiResponse::ok(engine.audit.get_range(from, to)))
}

async fn audit_integrity(
    State(engine): State<AppState>,
) -> Json<ApiResponse<serde_json::Value>> {
    let valid = engine.audit.verify_integrity();
    Json(ApiResponse::ok(serde_json::json!({
        "integrity_valid": valid,
        "total_entries": engine.audit.entry_count(),
        "current_sequence": engine.audit.current_sequence(),
    })))
}

// ─── FIX ─────────────────────────────────────────────────────────────────────

async fn fix_sessions(
    State(engine): State<AppState>,
) -> Json<ApiResponse<serde_json::Value>> {
    Json(ApiResponse::ok(serde_json::json!({
        "total_sessions": engine.fix_gateway.session_count(),
        "logged_in": engine.fix_gateway.logged_in_count(),
    })))
}

#[derive(serde::Deserialize)]
struct FixMessageRequest {
    raw_message: String,
}

async fn fix_message(
    State(engine): State<AppState>,
    Json(req): Json<FixMessageRequest>,
) -> Json<ApiResponse<serde_json::Value>> {
    match engine.fix_gateway.process_message(&req.raw_message) {
        Ok((response, order)) => {
            if let Some(order) = order {
                let _ = engine.submit_order(order);
            }
            Json(ApiResponse::ok(serde_json::json!({
                "response": response,
            })))
        }
        Err(e) => Json(ApiResponse::err(e)),
    }
}

// ─── Market Makers ──────────────────────────────────────────────────────────

async fn list_market_makers(
    State(engine): State<AppState>,
) -> Json<ApiResponse<Vec<market_maker::MarketMaker>>> {
    Json(ApiResponse::ok(engine.market_makers.list_makers()))
}

async fn get_market_maker(
    State(engine): State<AppState>,
    Path(id): Path<String>,
) -> Json<ApiResponse<market_maker::MarketMaker>> {
    match engine.market_makers.get_maker(&id) {
        Some(mm) => Json(ApiResponse::ok(mm)),
        None => Json(ApiResponse::err(format!("Market maker {} not found", id))),
    }
}

async fn market_maker_performance(
    State(engine): State<AppState>,
    Path(id): Path<String>,
) -> Json<ApiResponse<serde_json::Value>> {
    match engine.market_makers.evaluate_performance(&id) {
        Some(perf) => Json(ApiResponse::ok(perf)),
        None => Json(ApiResponse::err(format!("Market maker {} not found", id))),
    }
}

async fn market_maker_quotes(
    State(engine): State<AppState>,
    Path(symbol): Path<String>,
) -> Json<ApiResponse<Vec<market_maker::TwoSidedQuote>>> {
    Json(ApiResponse::ok(engine.market_makers.quotes_for_symbol(&symbol)))
}

#[derive(serde::Deserialize)]
struct SubmitQuoteRequest {
    market_maker_id: String,
    symbol: String,
    bid_price: f64,
    bid_quantity: f64,
    ask_price: f64,
    ask_quantity: f64,
}

async fn submit_quote(
    State(engine): State<AppState>,
    Json(req): Json<SubmitQuoteRequest>,
) -> Json<ApiResponse<market_maker::TwoSidedQuote>> {
    let quote = market_maker::TwoSidedQuote {
        id: uuid::Uuid::new_v4(),
        market_maker_id: req.market_maker_id,
        symbol: req.symbol,
        bid_price: to_price(req.bid_price),
        bid_quantity: (req.bid_quantity * 1_000_000.0) as Qty,
        ask_price: to_price(req.ask_price),
        ask_quantity: (req.ask_quantity * 1_000_000.0) as Qty,
        bid_levels: vec![],
        ask_levels: vec![],
        submitted_at: chrono::Utc::now(),
        valid_until: None,
    };
    match engine.market_makers.submit_quote(quote) {
        Ok(q) => Json(ApiResponse::ok(q)),
        Err(e) => Json(ApiResponse::err(e)),
    }
}

// ─── Indices ────────────────────────────────────────────────────────────────

async fn list_indices(
    State(engine): State<AppState>,
) -> Json<ApiResponse<Vec<indices::IndexDefinition>>> {
    Json(ApiResponse::ok(engine.indices.list_indices()))
}

async fn index_values(
    State(engine): State<AppState>,
) -> Json<ApiResponse<Vec<indices::IndexValue>>> {
    Json(ApiResponse::ok(engine.indices.all_values()))
}

async fn get_index(
    State(engine): State<AppState>,
    Path(id): Path<String>,
) -> Json<ApiResponse<indices::IndexDefinition>> {
    match engine.indices.get_index(&id) {
        Some(idx) => Json(ApiResponse::ok(idx)),
        None => Json(ApiResponse::err(format!("Index {} not found", id))),
    }
}

async fn get_index_value(
    State(engine): State<AppState>,
    Path(id): Path<String>,
) -> Json<ApiResponse<indices::IndexValue>> {
    match engine.indices.get_value(&id) {
        Some(val) => Json(ApiResponse::ok(val)),
        None => Json(ApiResponse::err(format!("Index {} not found", id))),
    }
}

// ─── Corporate Actions ──────────────────────────────────────────────────────

async fn list_corporate_actions(
    State(engine): State<AppState>,
) -> Json<ApiResponse<Vec<corporate_actions::CorporateAction>>> {
    Json(ApiResponse::ok(engine.corporate_actions.all_actions()))
}

async fn pending_corporate_actions(
    State(engine): State<AppState>,
) -> Json<ApiResponse<Vec<corporate_actions::CorporateAction>>> {
    Json(ApiResponse::ok(engine.corporate_actions.pending_actions()))
}

async fn corporate_actions_for_symbol(
    State(engine): State<AppState>,
    Path(symbol): Path<String>,
) -> Json<ApiResponse<Vec<corporate_actions::CorporateAction>>> {
    Json(ApiResponse::ok(engine.corporate_actions.actions_for_symbol(&symbol)))
}

async fn process_corporate_action(
    State(engine): State<AppState>,
    Path(id): Path<String>,
) -> Json<ApiResponse<corporate_actions::CorporateAction>> {
    let uuid = match uuid::Uuid::parse_str(&id) {
        Ok(u) => u,
        Err(_) => return Json(ApiResponse::err("Invalid action ID")),
    };
    match engine.corporate_actions.process_action(uuid) {
        Ok(action) => Json(ApiResponse::ok(action)),
        Err(e) => Json(ApiResponse::err(e)),
    }
}

// ─── Brokers ────────────────────────────────────────────────────────────────

async fn list_brokers(
    State(engine): State<AppState>,
) -> Json<ApiResponse<Vec<broker::Broker>>> {
    Json(ApiResponse::ok(engine.brokers.list_brokers()))
}

async fn get_broker(
    State(engine): State<AppState>,
    Path(id): Path<String>,
) -> Json<ApiResponse<broker::Broker>> {
    match engine.brokers.get_broker(&id) {
        Some(b) => Json(ApiResponse::ok(b)),
        None => Json(ApiResponse::err(format!("Broker {} not found", id))),
    }
}

async fn connected_brokers(
    State(engine): State<AppState>,
) -> Json<ApiResponse<Vec<broker::Broker>>> {
    Json(ApiResponse::ok(engine.brokers.connected_brokers()))
}

#[derive(serde::Deserialize)]
struct RouteOrderRequest {
    broker_id: String,
    client_account: String,
    symbol: String,
    side: String,
    quantity: f64,
}

async fn route_order(
    State(engine): State<AppState>,
    Json(req): Json<RouteOrderRequest>,
) -> Json<ApiResponse<broker::OrderRoute>> {
    match engine.brokers.route_order(
        &req.broker_id,
        &req.client_account,
        &req.symbol,
        &req.side,
        (req.quantity * 1_000_000.0) as i64,
    ) {
        Ok(route) => Json(ApiResponse::ok(route)),
        Err(e) => Json(ApiResponse::err(e)),
    }
}

// ─── Circuit Breakers (NYSE-equivalent) ─────────────────────────────────────

async fn circuit_breaker_bands(
    State(engine): State<AppState>,
) -> Json<ApiResponse<Vec<circuit_breaker::LuldBand>>> {
    Json(ApiResponse::ok(engine.circuit_breaker.all_bands()))
}

async fn circuit_breaker_band(
    State(engine): State<AppState>,
    Path(symbol): Path<String>,
) -> Json<ApiResponse<circuit_breaker::LuldBand>> {
    match engine.circuit_breaker.get_band(&symbol) {
        Some(band) => Json(ApiResponse::ok(band)),
        None => Json(ApiResponse::err(format!("No LULD band for {}", symbol))),
    }
}

async fn market_wide_status(
    State(engine): State<AppState>,
) -> Json<ApiResponse<serde_json::Value>> {
    Json(ApiResponse::ok(engine.circuit_breaker.market_wide_status()))
}

async fn volatility_interruptions(
    State(engine): State<AppState>,
) -> Json<ApiResponse<Vec<circuit_breaker::VolatilityInterruption>>> {
    Json(ApiResponse::ok(engine.circuit_breaker.recent_interruptions()))
}

// ─── Auctions (NYSE-equivalent) ─────────────────────────────────────────────

async fn active_auctions(
    State(engine): State<AppState>,
) -> Json<ApiResponse<Vec<serde_json::Value>>> {
    Json(ApiResponse::ok(engine.auction.active_auctions()))
}

async fn auction_history(
    State(engine): State<AppState>,
) -> Json<ApiResponse<Vec<auction::AuctionResult>>> {
    Json(ApiResponse::ok(engine.auction.auction_history()))
}

async fn auction_indicative(
    State(engine): State<AppState>,
    Path(symbol): Path<String>,
) -> Json<ApiResponse<auction::IndicativeData>> {
    match engine.auction.indicative_data(&symbol) {
        Some(data) => Json(ApiResponse::ok(data)),
        None => Json(ApiResponse::err(format!("No active auction for {}", symbol))),
    }
}

#[derive(serde::Deserialize)]
struct StartAuctionRequest {
    phase: String,
}

async fn start_auction(
    State(engine): State<AppState>,
    Path(symbol): Path<String>,
    Json(req): Json<StartAuctionRequest>,
) -> Json<ApiResponse<serde_json::Value>> {
    let phase = match req.phase.to_uppercase().as_str() {
        "PRE_OPEN" | "PREOPEN" => auction::AuctionPhase::PreOpen,
        "OPENING" | "OPENING_AUCTION" => auction::AuctionPhase::OpeningAuction,
        "PRE_CLOSE" | "PRECLOSE" => auction::AuctionPhase::PreClose,
        "CLOSING" | "CLOSING_AUCTION" => auction::AuctionPhase::ClosingAuction,
        "REOPENING" => auction::AuctionPhase::ReopeningAuction,
        _ => return Json(ApiResponse::err(format!("Unknown auction phase: {}", req.phase))),
    };
    engine.auction.start_auction(&symbol, phase);
    Json(ApiResponse::ok(serde_json::json!({
        "symbol": symbol,
        "phase": phase,
        "status": "started",
    })))
}

async fn run_auction(
    State(engine): State<AppState>,
    Path(symbol): Path<String>,
) -> Json<ApiResponse<auction::AuctionResult>> {
    match engine.auction.run_auction(&symbol) {
        Some(result) => Json(ApiResponse::ok(result)),
        None => Json(ApiResponse::err(format!("No auction to run for {}", symbol))),
    }
}

// ─── Market Data Infrastructure (NYSE-equivalent) ───────────────────────────

#[derive(serde::Deserialize)]
struct TapeQuery {
    count: Option<usize>,
}

async fn consolidated_tape(
    State(engine): State<AppState>,
    Query(params): Query<TapeQuery>,
) -> Json<ApiResponse<Vec<market_data::TapeEntry>>> {
    let count = params.count.unwrap_or(100);
    Json(ApiResponse::ok(engine.market_data.tape.recent(count)))
}

async fn symbol_tape(
    State(engine): State<AppState>,
    Path(symbol): Path<String>,
    Query(params): Query<TapeQuery>,
) -> Json<ApiResponse<Vec<market_data::TapeEntry>>> {
    let count = params.count.unwrap_or(50);
    Json(ApiResponse::ok(engine.market_data.tape.for_symbol(&symbol, count)))
}

async fn nbbo_quote(
    State(engine): State<AppState>,
    Path(symbol): Path<String>,
) -> Json<ApiResponse<market_data::NbboQuote>> {
    match engine.market_data.ticker.get_nbbo(&symbol) {
        Some(nbbo) => Json(ApiResponse::ok(nbbo)),
        None => Json(ApiResponse::err(format!("No NBBO for {}", symbol))),
    }
}

async fn market_snapshot(
    State(engine): State<AppState>,
    Path(symbol): Path<String>,
) -> Json<ApiResponse<market_data::MarketSnapshot>> {
    match engine.market_data.snapshot(&symbol) {
        Some(snap) => Json(ApiResponse::ok(snap)),
        None => Json(ApiResponse::err(format!("No data for {}", symbol))),
    }
}

async fn all_stats(
    State(engine): State<AppState>,
) -> Json<ApiResponse<serde_json::Value>> {
    Json(ApiResponse::ok(engine.market_data.summary()))
}

// ─── Investor Protection Fund (NYSE SIPC-equivalent) ────────────────────────

async fn ipf_status(
    State(engine): State<AppState>,
) -> Json<ApiResponse<serde_json::Value>> {
    Json(ApiResponse::ok(engine.investor_protection.fund_status()))
}

async fn ipf_claims(
    State(engine): State<AppState>,
) -> Json<ApiResponse<Vec<investor_protection::ProtectionClaim>>> {
    Json(ApiResponse::ok(engine.investor_protection.all_claims()))
}

#[derive(serde::Deserialize)]
struct SubmitClaimRequest {
    account_id: String,
    claimant_name: String,
    amount: f64,
    reason: String,
}

async fn ipf_submit_claim(
    State(engine): State<AppState>,
    Json(req): Json<SubmitClaimRequest>,
) -> Json<ApiResponse<investor_protection::ProtectionClaim>> {
    let claim = engine.investor_protection.submit_claim(
        &req.account_id,
        &req.claimant_name,
        to_price(req.amount),
        &req.reason,
    );
    Json(ApiResponse::ok(claim))
}

// ─── Fee Engine & Revenue Management ─────────────────────────────────────────

async fn fee_status(
    State(engine): State<AppState>,
) -> Json<ApiResponse<serde_json::Value>> {
    Json(ApiResponse::ok(engine.fees.status()))
}

async fn fee_schedules(
    State(engine): State<AppState>,
) -> Json<ApiResponse<Vec<fees::FeeSchedule>>> {
    Json(ApiResponse::ok(engine.fees.all_schedules()))
}

async fn fee_schedule_by_key(
    State(engine): State<AppState>,
    Path(key): Path<String>,
) -> Json<ApiResponse<fees::FeeSchedule>> {
    match engine.fees.get_schedule(&key.to_uppercase()) {
        Some(schedule) => Json(ApiResponse::ok(schedule)),
        None => Json(ApiResponse::err(format!("Fee schedule '{}' not found", key))),
    }
}

async fn fee_api_tiers(
    State(engine): State<AppState>,
) -> Json<ApiResponse<serde_json::Value>> {
    let tiers: Vec<serde_json::Value> = engine
        .fees
        .api_tiers()
        .iter()
        .map(|t| {
            serde_json::json!({
                "name": t.name,
                "requests_per_second": t.requests_per_second,
                "monthly_fee": from_price(t.monthly_fee),
                "features": t.features,
            })
        })
        .collect();
    Json(ApiResponse::ok(serde_json::json!(tiers)))
}

#[derive(serde::Deserialize)]
struct RecentChargesQuery {
    count: Option<usize>,
}

async fn fee_recent_charges(
    State(engine): State<AppState>,
    Query(params): Query<RecentChargesQuery>,
) -> Json<ApiResponse<Vec<fees::FeeCharge>>> {
    let count = params.count.unwrap_or(50);
    Json(ApiResponse::ok(engine.fees.recent_charges(count)))
}

async fn fee_account_charges(
    State(engine): State<AppState>,
    Path(account_id): Path<String>,
) -> Json<ApiResponse<Vec<fees::FeeCharge>>> {
    Json(ApiResponse::ok(engine.fees.account_charges(&account_id)))
}

#[derive(serde::Deserialize)]
struct CalculateTradeFeesRequest {
    trade_value: f64,
    taker_account: String,
    maker_account: String,
    symbol: String,
    side: Side,
}

async fn fee_calculate_trade(
    State(engine): State<AppState>,
    Json(req): Json<CalculateTradeFeesRequest>,
) -> Json<ApiResponse<serde_json::Value>> {
    let trade_value = to_price(req.trade_value);
    let (taker, maker, clearing) = engine.fees.calculate_trade_fees(
        trade_value,
        &req.taker_account,
        &req.maker_account,
        &req.symbol,
        req.side,
    );
    Json(ApiResponse::ok(serde_json::json!({
        "taker_fee": {
            "id": taker.id,
            "amount": from_price(taker.amount),
            "description": taker.description,
        },
        "maker_rebate": {
            "id": maker.id,
            "amount": from_price(maker.amount),
            "description": maker.description,
        },
        "clearing_fee": {
            "id": clearing.id,
            "amount": from_price(clearing.amount),
            "description": clearing.description,
        },
        "net_exchange_revenue": from_price(taker.amount + maker.amount + clearing.amount),
    })))
}

async fn fee_subscriptions(
    State(engine): State<AppState>,
) -> Json<ApiResponse<serde_json::Value>> {
    let subs: Vec<serde_json::Value> = engine
        .fees
        .active_subscriptions()
        .iter()
        .map(|s| {
            serde_json::json!({
                "id": s.id,
                "account_id": s.account_id,
                "service_name": s.service_name,
                "fee_type": s.fee_type,
                "amount_per_cycle": from_price(s.amount_per_cycle),
                "billing_cycle": s.billing_cycle,
                "status": s.status,
                "started_at": s.started_at,
                "next_billing": s.next_billing,
                "expires_at": s.expires_at,
            })
        })
        .collect();
    Json(ApiResponse::ok(serde_json::json!(subs)))
}

#[derive(serde::Deserialize)]
struct CreateSubscriptionRequest {
    account_id: String,
    service_name: String,
    fee_type: fees::FeeType,
    amount: f64,
    billing_cycle: fees::BillingCycle,
}

async fn fee_create_subscription(
    State(engine): State<AppState>,
    Json(req): Json<CreateSubscriptionRequest>,
) -> Json<ApiResponse<fees::Subscription>> {
    let sub = engine.fees.create_subscription(
        &req.account_id,
        &req.service_name,
        req.fee_type,
        to_price(req.amount),
        req.billing_cycle,
    );
    Json(ApiResponse::ok(sub))
}

async fn fee_memberships(
    State(engine): State<AppState>,
) -> Json<ApiResponse<serde_json::Value>> {
    let mems: Vec<serde_json::Value> = engine
        .fees
        .active_memberships()
        .iter()
        .map(|m| {
            serde_json::json!({
                "id": m.id,
                "account_id": m.account_id,
                "membership_type": m.membership_type,
                "tier": m.tier,
                "annual_fee": from_price(m.annual_fee),
                "status": m.status,
                "joined_at": m.joined_at,
                "valid_until": m.valid_until,
            })
        })
        .collect();
    Json(ApiResponse::ok(serde_json::json!(mems)))
}

#[derive(serde::Deserialize)]
struct RegisterMembershipRequest {
    account_id: String,
    membership_type: fees::FeeType,
    tier: String,
    annual_fee: f64,
}

async fn fee_register_membership(
    State(engine): State<AppState>,
    Json(req): Json<RegisterMembershipRequest>,
) -> Json<ApiResponse<fees::Membership>> {
    let mem = engine.fees.register_membership(
        &req.account_id,
        req.membership_type,
        &req.tier,
        to_price(req.annual_fee),
    );
    Json(ApiResponse::ok(mem))
}

async fn fee_revenue_summary(
    State(engine): State<AppState>,
) -> Json<ApiResponse<serde_json::Value>> {
    Json(ApiResponse::ok(engine.fees.revenue_summary()))
}

async fn fee_invoices(
    State(engine): State<AppState>,
) -> Json<ApiResponse<Vec<fees::Invoice>>> {
    Json(ApiResponse::ok(engine.fees.all_invoices()))
}

#[derive(serde::Deserialize)]
struct GenerateInvoiceRequest {
    account_id: String,
    period: String,
}

async fn fee_generate_invoice(
    State(engine): State<AppState>,
    Json(req): Json<GenerateInvoiceRequest>,
) -> Json<ApiResponse<fees::Invoice>> {
    let invoice = engine.fees.generate_invoice(&req.account_id, &req.period);
    Json(ApiResponse::ok(invoice))
}

#[derive(serde::Deserialize)]
struct ChargingListingRequest {
    account_id: String,
    instrument_symbol: String,
    fee_type: fees::FeeType,
}

async fn fee_charge_listing(
    State(engine): State<AppState>,
    Json(req): Json<ChargingListingRequest>,
) -> Json<ApiResponse<fees::FeeCharge>> {
    let charge = engine.fees.charge_listing_fee(
        &req.account_id,
        &req.instrument_symbol,
        req.fee_type,
    );
    Json(ApiResponse::ok(charge))
}

#[derive(serde::Deserialize)]
struct ChargeTokenizationRequest {
    account_id: String,
    fee_type: fees::FeeType,
    asset_description: String,
}

async fn fee_charge_tokenization(
    State(engine): State<AppState>,
    Json(req): Json<ChargeTokenizationRequest>,
) -> Json<ApiResponse<fees::FeeCharge>> {
    let charge = engine.fees.charge_tokenization_fee(
        &req.account_id,
        req.fee_type,
        &req.asset_description,
    );
    Json(ApiResponse::ok(charge))
}
