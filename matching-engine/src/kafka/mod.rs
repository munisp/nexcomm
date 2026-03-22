//! Event publisher for the NEXCOM matching engine.
//!
//! Publishes all order lifecycle, trade execution, and order book events
//! to the ingestion engine via HTTP webhook (`/api/v1/kafka/ingest`).
//! In production with a real Kafka cluster, the ingestion engine forwards
//! these events to the appropriate Kafka topics. This design keeps the
//! matching engine free of a direct Kafka dependency while maintaining
//! the same event contract.
//!
//! Events are published asynchronously (fire-and-forget). Failures are
//! logged as warnings but never stall the matching engine's hot path.
//!
//! Topics (logical, mapped by the ingestion engine):
//!   nexcom.orders.created     — new order accepted by the engine
//!   nexcom.orders.filled      — order fully or partially filled
//!   nexcom.orders.cancelled   — order cancelled by user or system
//!   nexcom.orders.rejected    — order rejected (validation, risk, circuit breaker)
//!   nexcom.trades.executed    — trade match between two orders
//!   nexcom.orderbook.snapshot — periodic full order book snapshot (top 20 levels)
//!   nexcom.orderbook.update   — incremental order book change after each match

use serde::Serialize;
use tracing::{debug, warn};

/// Events published by the matching engine.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "event_type", rename_all = "snake_case")]
pub enum MatchingEvent {
    OrderCreated(OrderCreatedEvent),
    OrderFilled(OrderFilledEvent),
    OrderCancelled(OrderCancelledEvent),
    OrderRejected(OrderRejectedEvent),
    TradeExecuted(TradeExecutedEvent),
    OrderBookSnapshot(OrderBookSnapshotEvent),
    OrderBookUpdate(OrderBookUpdateEvent),
}

#[derive(Debug, Clone, Serialize)]
pub struct OrderCreatedEvent {
    pub order_id: String,
    pub account_id: String,
    pub symbol: String,
    pub side: String,
    pub order_type: String,
    pub quantity: f64,
    pub price: Option<f64>,
    pub stop_price: Option<f64>,
    pub time_in_force: String,
    pub timestamp_us: i64,
    pub node_id: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct OrderFilledEvent {
    pub order_id: String,
    pub account_id: String,
    pub symbol: String,
    pub side: String,
    pub filled_quantity: f64,
    pub remaining_quantity: f64,
    pub fill_price: f64,
    pub is_fully_filled: bool,
    pub trade_id: String,
    pub timestamp_us: i64,
    pub node_id: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct OrderCancelledEvent {
    pub order_id: String,
    pub account_id: String,
    pub symbol: String,
    pub reason: String,
    pub remaining_quantity: f64,
    pub timestamp_us: i64,
    pub node_id: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct OrderRejectedEvent {
    pub order_id: String,
    pub account_id: String,
    pub symbol: String,
    pub reason: String,
    pub timestamp_us: i64,
    pub node_id: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct TradeExecutedEvent {
    pub trade_id: String,
    pub symbol: String,
    pub buyer_order_id: String,
    pub seller_order_id: String,
    pub buyer_account_id: String,
    pub seller_account_id: String,
    pub quantity: f64,
    pub price: f64,
    pub aggressor_side: String,
    pub timestamp_us: i64,
    pub node_id: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct PriceLevel {
    pub price: f64,
    pub quantity: f64,
    pub order_count: u32,
}

#[derive(Debug, Clone, Serialize)]
pub struct OrderBookSnapshotEvent {
    pub symbol: String,
    pub bids: Vec<PriceLevel>,
    pub asks: Vec<PriceLevel>,
    pub last_trade_price: Option<f64>,
    pub sequence_number: u64,
    pub timestamp_us: i64,
    pub node_id: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct OrderBookUpdateEvent {
    pub symbol: String,
    pub side: String,
    pub price: f64,
    pub new_quantity: f64,
    pub delta_quantity: f64,
    pub sequence_number: u64,
    pub timestamp_us: i64,
    pub node_id: String,
}

/// Logical topic name for each event.
impl MatchingEvent {
    pub fn topic(&self) -> &'static str {
        match self {
            MatchingEvent::OrderCreated(_) => "nexcom.orders.created",
            MatchingEvent::OrderFilled(_) => "nexcom.orders.filled",
            MatchingEvent::OrderCancelled(_) => "nexcom.orders.cancelled",
            MatchingEvent::OrderRejected(_) => "nexcom.orders.rejected",
            MatchingEvent::TradeExecuted(_) => "nexcom.trades.executed",
            MatchingEvent::OrderBookSnapshot(_) => "nexcom.orderbook.snapshot",
            MatchingEvent::OrderBookUpdate(_) => "nexcom.orderbook.update",
        }
    }
}

/// HTTP webhook payload sent to the ingestion engine.
#[derive(Debug, Serialize)]
struct WebhookPayload {
    topic: String,
    event: serde_json::Value,
}

/// Async, fire-and-forget event publisher.
///
/// Sends events to the ingestion engine's `/api/v1/kafka/ingest` endpoint.
/// The ingestion engine buffers events in memory (stub mode) or forwards
/// them to Kafka when a broker is available.
///
/// All `publish` calls are non-blocking — failures are logged as warnings
/// and never propagate to the matching engine's hot path.
#[derive(Clone)]
pub struct KafkaPublisher {
    client: reqwest::Client,
    ingestion_url: String,
    node_id: String,
    enabled: bool,
}

impl KafkaPublisher {
    /// Create a new publisher.
    /// `ingestion_url` should be the base URL of the ingestion engine,
    /// e.g. `http://localhost:8009`. Pass an empty string to disable.
    pub fn new(ingestion_url: String, node_id: String) -> Self {
        let enabled = !ingestion_url.is_empty();
        if !enabled {
            warn!("[EventPublisher] Ingestion URL not set — events will not be published");
        } else {
            tracing::info!("[EventPublisher] Publishing events to {}", ingestion_url);
        }
        Self {
            client: reqwest::Client::builder()
                .timeout(std::time::Duration::from_millis(2000))
                .build()
                .unwrap_or_default(),
            ingestion_url,
            node_id,
            enabled,
        }
    }

    /// Publish a matching event asynchronously (fire-and-forget).
    pub fn publish(&self, event: MatchingEvent) {
        if !self.enabled {
            return;
        }

        let client = self.client.clone();
        let url = format!("{}/api/v1/kafka/ingest", self.ingestion_url);
        let topic = event.topic().to_string();

        let event_json = match serde_json::to_value(&event) {
            Ok(v) => v,
            Err(e) => {
                warn!("[EventPublisher] Serialization error for {}: {}", topic, e);
                return;
            }
        };

        let payload = WebhookPayload {
            topic: topic.clone(),
            event: event_json,
        };

        tokio::spawn(async move {
            match client.post(&url).json(&payload).send().await {
                Ok(resp) if resp.status().is_success() => {
                    debug!("[EventPublisher] Published {} → {}", topic, resp.status());
                }
                Ok(resp) => {
                    warn!("[EventPublisher] {} returned HTTP {}", topic, resp.status());
                }
                Err(e) => {
                    warn!("[EventPublisher] Failed to publish {}: {}", topic, e);
                }
            }
        });
    }

    pub fn is_enabled(&self) -> bool {
        self.enabled
    }
}

/// Microsecond-precision UTC timestamp.
pub fn now_us() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_micros() as i64
}
