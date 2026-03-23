/*!
 * Kafka producer for USSD engine events.
 * Emits events to the NEXCOM event bus for downstream processing.
 *
 * Topics:
 *   nexcom.ussd.session.completed  — session analytics
 *   nexcom.ussd.order.placed       — order routing to matching engine
 */

use anyhow::Result;
use rdkafka::config::ClientConfig;
use rdkafka::producer::{FutureProducer, FutureRecord};
use serde_json::json;
use std::time::Duration;
use tracing::{error, warn};

use crate::session::UssdSessionState;

pub struct KafkaProducer {
    producer: Option<FutureProducer>,
}

impl KafkaProducer {
    pub fn new(brokers: &str) -> Self {
        let producer = ClientConfig::new()
            .set("bootstrap.servers", brokers)
            .set("message.timeout.ms", "5000")
            .set("queue.buffering.max.ms", "100")
            .create::<FutureProducer>()
            .map_err(|e| {
                warn!("Kafka producer init failed ({}). Running without Kafka.", e);
                e
            })
            .ok();

        Self { producer }
    }

    pub async fn emit_session_completed(&self, session: &UssdSessionState) -> Result<()> {
        let payload = json!({
            "session_id": session.session_id,
            "phone_number": session.phone_number,
            "user_id": session.user_id,
            "menu_path": session.menu_path,
            "interactions": session.interactions,
            "timestamp": chrono::Utc::now().to_rfc3339(),
        });
        self.emit("nexcom.ussd.session.completed", &payload.to_string()).await
    }

    pub async fn emit_order_placed(
        &self,
        user_id: i32,
        side: &str,
        symbol: &str,
        quantity: f64,
        order_id: i64,
    ) -> Result<()> {
        let payload = json!({
            "order_id": order_id,
            "user_id": user_id,
            "side": side,
            "symbol": symbol,
            "quantity": quantity,
            "source": "USSD",
            "timestamp": chrono::Utc::now().to_rfc3339(),
        });
        self.emit("nexcom.ussd.order.placed", &payload.to_string()).await
    }

    /// Generic publish method for ad-hoc topic/payload pairs
    pub async fn send(&self, topic: &str, payload: &str) -> Result<()> {
        self.emit(topic, payload).await
    }

    async fn emit(&self, topic: &str, payload: &str) -> Result<()> {
        let producer = match &self.producer {
            Some(p) => p,
            None => return Ok(()), // Kafka not available, skip silently
        };

        let record = FutureRecord::to(topic)
            .payload(payload)
            .key("ussd");

        match producer.send(record, Duration::from_secs(5)).await {
            Ok(_) => Ok(()),
            Err((e, _)) => {
                error!("Kafka emit to {} failed: {}", topic, e);
                Err(anyhow::anyhow!("Kafka emit failed: {}", e))
            }
        }
    }
}
