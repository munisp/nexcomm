/// settlement_client.rs — Fund-flow middleware client for the NEXCOM matching engine.
///
/// Every trade fill in the matching engine MUST trigger:
///   1. TigerBeetle 2-phase settlement (debit buyer → credit seller)
///   2. Fee collection (0.1% of gross trade value → exchange-fee account)
///   3. Kafka event (nexcom.settlement.trade-settled) via ingestion engine
///   4. Fluvio real-time stream (nexcom.trades.live) for sub-ms market data
///   5. Temporal workflow trigger (TradeSettlementWorkflow) for T+2 DvP
///   6. Dapr pub/sub alert on settlement failure
///   7. Lakehouse Bronze ingest (bronze.trades) for analytics
///
/// All calls are fire-and-forget (tokio::spawn) — failures are logged as
/// warnings and NEVER propagate to the matching engine's hot path.
/// The matching engine's job is to match orders; settlement is a side-effect.
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::time::Duration;
use tracing::{debug, warn};

/// A completed trade fill requiring settlement.
#[derive(Debug, Clone, Serialize)]
pub struct TradeFill {
    pub trade_id: String,
    pub symbol: String,
    pub buyer_account_id: String,
    pub seller_account_id: String,
    pub quantity: f64,
    pub price: f64,
    pub gross_amount: f64,
    pub fee_amount: f64,
    pub currency: String,
    pub executed_at_us: i64,
    pub idempotency_key: String,
}

/// Balance check result from the gateway.
#[derive(Debug, Deserialize)]
struct BalanceResponse {
    balance: i64,
}

/// Settlement client — wraps all fund-flow middleware calls.
#[derive(Clone)]
pub struct SettlementClient {
    http: Client,
    gateway_url: String,
    ingestion_url: String,
    fluvio_url: String,
    temporal_url: String,
    dapr_url: String,
    enabled: bool,
}

impl SettlementClient {
    pub fn new() -> Self {
        let gateway_url =
            std::env::var("GATEWAY_URL").unwrap_or_else(|_| "http://gateway:8200".to_string());
        let ingestion_url = std::env::var("INGESTION_ENGINE_URL")
            .unwrap_or_else(|_| "http://ingestion-engine:8009".to_string());
        let fluvio_url = std::env::var("FLUVIO_HTTP_URL")
            .unwrap_or_else(|_| "http://fluvio-proxy:8090".to_string());
        let temporal_url = std::env::var("TEMPORAL_HTTP_URL")
            .unwrap_or_else(|_| "http://temporal-proxy:8091".to_string());
        let dapr_url =
            std::env::var("DAPR_HTTP_URL").unwrap_or_else(|_| "http://localhost:3500".to_string());
        let enabled = !gateway_url.is_empty();
        let http = Client::builder()
            .timeout(Duration::from_millis(3000))
            .build()
            .unwrap_or_default();
        if enabled {
            tracing::info!(
                "[SettlementClient] Initialized — gateway={} ingestion={} fluvio={}",
                gateway_url,
                ingestion_url,
                fluvio_url
            );
        } else {
            warn!("[SettlementClient] GATEWAY_URL not set — settlement disabled");
        }
        Self {
            http,
            gateway_url,
            ingestion_url,
            fluvio_url,
            temporal_url,
            dapr_url,
            enabled,
        }
    }

    /// Check buyer's settlement account balance (in cents).
    /// Failure is explicit so callers reject orders with an unverifiable balance.
    pub async fn get_balance(&self, account_id: &str) -> Result<i64, String> {
        if !self.enabled {
            return Err("settlement gateway is not configured".to_string());
        }
        let url = format!(
            "{}/api/v1/ledger/accounts/{}/balance",
            self.gateway_url, account_id
        );
        match self.http.get(&url).send().await {
            Ok(resp) if resp.status().is_success() => match resp.json::<BalanceResponse>().await {
                Ok(b) => Ok(b.balance),
                Err(e) => {
                    warn!(
                        "[SettlementClient] Balance parse error for {}: {}",
                        account_id, e
                    );
                    Err(format!("decode balance response: {}", e))
                }
            },
            Ok(resp) => {
                warn!(
                    "[SettlementClient] Balance check returned {}",
                    resp.status()
                );
                Err(format!("ledger balance returned HTTP {}", resp.status()))
            }
            Err(e) => {
                warn!(
                    "[SettlementClient] Balance check failed for {}: {}",
                    account_id, e
                );
                Err(format!("ledger balance request failed: {}", e))
            }
        }
    }

    /// Create a TigerBeetle pending transfer to reserve funds for a BUY order.
    /// A reservation has no valid local substitute when the ledger is unavailable.
    pub async fn reserve_funds(
        &self,
        account_id: &str,
        amount_cents: i64,
        order_id: &str,
    ) -> Result<String, String> {
        if !self.enabled {
            return Err("settlement gateway is not configured".to_string());
        }
        if amount_cents <= 0 {
            return Err("reservation amount must be positive".to_string());
        }
        let url = format!("{}/api/v1/ledger/transfers/pending", self.gateway_url);
        let payload = serde_json::json!({
            "debit_account_id": format!("user-settlement-{}", account_id),
            "credit_account_id": "exchange-clearing",
            "amount": amount_cents,
            "code": 2,  // TransferMarginDeposit — pending hold
            "reference": format!("order-reserve-{}", order_id),
        });
        match self.http.post(&url).json(&payload).send().await {
            Ok(resp) if resp.status().is_success() => {
                match resp.json::<serde_json::Value>().await {
                    Ok(v) => v["id"]
                        .as_str()
                        .map(str::to_string)
                        .ok_or_else(|| "ledger reservation response omitted id".to_string()),
                    Err(e) => Err(format!("decode ledger reservation response: {}", e)),
                }
            }
            Ok(resp) => {
                warn!(
                    "[SettlementClient] reserve_funds returned {}",
                    resp.status()
                );
                Err(format!(
                    "ledger reservation returned HTTP {}",
                    resp.status()
                ))
            }
            Err(e) => {
                warn!("[SettlementClient] reserve_funds failed: {}", e);
                Err(format!("ledger reservation request failed: {}", e))
            }
        }
    }

    /// Void a pending TigerBeetle transfer (release reserved funds on cancel).
    pub async fn release_funds(&self, transfer_id: &str) -> Result<(), String> {
        if !self.enabled {
            return Err("settlement gateway is not configured".to_string());
        }
        if transfer_id.is_empty() {
            return Err("reservation transfer ID is required".to_string());
        }
        let url = format!(
            "{}/api/v1/ledger/transfers/{}/void",
            self.gateway_url, transfer_id
        );
        match self.http.post(&url).send().await {
            Ok(resp) if resp.status().is_success() => Ok(()),
            Ok(resp) => Err(format!("ledger release returned HTTP {}", resp.status())),
            Err(e) => {
                warn!(
                    "[SettlementClient] release_funds failed for {}: {}",
                    transfer_id, e
                );
                Err(format!("ledger release request failed: {}", e))
            }
        }
    }

    /// Process a trade fill — fire-and-forget across all middleware.
    /// This is the main entry point called after every trade execution.
    pub fn process_fill(&self, fill: TradeFill) {
        if !self.enabled {
            return;
        }
        let client = self.clone();
        tokio::spawn(async move {
            client.settle_tigerbeetle(&fill).await;
            client.emit_fluvio(&fill).await;
            client.trigger_temporal_settlement(&fill).await;
            client.ingest_lakehouse(&fill).await;
        });
    }

    /// Step 1: TigerBeetle settlement — debit buyer, credit seller, collect fee.
    async fn settle_tigerbeetle(&self, fill: &TradeFill) {
        let gross_cents = (fill.gross_amount * 100.0) as i64;
        let fee_cents = (fill.fee_amount * 100.0) as i64;

        // Debit buyer settlement account, credit seller settlement account
        let settle_url = format!("{}/api/v1/settlement/settle", self.gateway_url);
        let settle_payload = serde_json::json!({
            "buyer_user_id":  fill.buyer_account_id,
            "seller_user_id": fill.seller_account_id,
            "amount":         fill.gross_amount,
            "currency":       fill.currency,
            "trade_id":       fill.trade_id,
            "settlement_id":  format!("settle-{}", fill.trade_id),
        });
        match self
            .http
            .post(&settle_url)
            .json(&settle_payload)
            .send()
            .await
        {
            Ok(resp) if resp.status().is_success() => {
                debug!(
                    "[SettlementClient] TigerBeetle settled trade {} — {} cents",
                    fill.trade_id, gross_cents
                );
            }
            Ok(resp) => {
                warn!(
                    "[SettlementClient] TigerBeetle settlement failed for trade {}: HTTP {}",
                    fill.trade_id,
                    resp.status()
                );
                // Emit Dapr alert on settlement failure
                self.emit_dapr_alert(fill, "settlement_failed").await;
            }
            Err(e) => {
                warn!(
                    "[SettlementClient] TigerBeetle settlement error for trade {}: {}",
                    fill.trade_id, e
                );
                self.emit_dapr_alert(fill, "settlement_error").await;
            }
        }

        // Fee collection: debit seller, credit exchange-fee account
        if fee_cents > 0 {
            let fee_url = format!("{}/api/v1/ledger/transfers", self.gateway_url);
            let fee_payload = serde_json::json!({
                "debit_account_id":  format!("user-settlement-{}", fill.seller_account_id),
                "credit_account_id": "exchange-fee",
                "amount":            fee_cents,
                "code":              4,  // TransferFeeCollection
                "reference":         format!("fee-{}", fill.trade_id),
            });
            if let Err(e) = self.http.post(&fee_url).json(&fee_payload).send().await {
                warn!(
                    "[SettlementClient] Fee collection failed for trade {}: {}",
                    fill.trade_id, e
                );
            }
        }
    }

    /// Step 2: Fluvio real-time stream — publish to nexcom.trades.live topic.
    async fn emit_fluvio(&self, fill: &TradeFill) {
        let url = format!("{}/api/v1/produce", self.fluvio_url);
        let payload = serde_json::json!({
            "topic": "nexcom.trades.live",
            "key":   fill.trade_id,
            "value": {
                "trade_id":    fill.trade_id,
                "symbol":      fill.symbol,
                "price":       fill.price,
                "quantity":    fill.quantity,
                "gross_amount": fill.gross_amount,
                "buyer":       fill.buyer_account_id,
                "seller":      fill.seller_account_id,
                "executed_at": fill.executed_at_us,
            }
        });
        if let Err(e) = self.http.post(&url).json(&payload).send().await {
            debug!(
                "[SettlementClient] Fluvio emit failed for trade {}: {}",
                fill.trade_id, e
            );
        }
    }

    /// Step 3: Trigger Temporal TradeSettlementWorkflow for T+2 DvP.
    async fn trigger_temporal_settlement(&self, fill: &TradeFill) {
        let url = format!("{}/api/v1/workflow/trigger", self.temporal_url);
        let payload = serde_json::json!({
            "workflow_type": "TradeSettlementWorkflow",
            "workflow_id":   format!("trade-settlement-{}", fill.trade_id),
            "input": {
                "trade_id":    fill.trade_id,
                "symbol":      fill.symbol,
                "buyer_id":    fill.buyer_account_id,
                "seller_id":   fill.seller_account_id,
                "quantity":    fill.quantity,
                "price":       fill.price,
                "gross_amount": fill.gross_amount,
                "currency":    fill.currency,
                "settlement_type": "T2",
            }
        });
        if let Err(e) = self.http.post(&url).json(&payload).send().await {
            debug!(
                "[SettlementClient] Temporal trigger failed for trade {}: {}",
                fill.trade_id, e
            );
        }
    }

    /// Step 4: Lakehouse Bronze ingest — immutable audit trail.
    async fn ingest_lakehouse(&self, fill: &TradeFill) {
        let url = format!("{}/api/v1/kafka/ingest", self.ingestion_url);
        let payload = serde_json::json!({
            "topic": "nexcom.trades.executed",
            "event": {
                "trade_id":    fill.trade_id,
                "symbol":      fill.symbol,
                "buyer":       fill.buyer_account_id,
                "seller":      fill.seller_account_id,
                "quantity":    fill.quantity,
                "price":       fill.price,
                "gross_amount": fill.gross_amount,
                "fee_amount":  fill.fee_amount,
                "currency":    fill.currency,
                "executed_at": fill.executed_at_us,
                "idempotency_key": fill.idempotency_key,
            }
        });
        if let Err(e) = self.http.post(&url).json(&payload).send().await {
            debug!(
                "[SettlementClient] Lakehouse ingest failed for trade {}: {}",
                fill.trade_id, e
            );
        }
    }

    /// Emit a Dapr pub/sub alert on settlement failure.
    async fn emit_dapr_alert(&self, fill: &TradeFill, alert_type: &str) {
        let url = format!(
            "{}/v1.0/publish/nexcom-pubsub/nexcom.settlement.alerts",
            self.dapr_url
        );
        let payload = serde_json::json!({
            "alert_type":  alert_type,
            "trade_id":    fill.trade_id,
            "symbol":      fill.symbol,
            "gross_amount": fill.gross_amount,
            "timestamp":   fill.executed_at_us,
        });
        if let Err(e) = self.http.post(&url).json(&payload).send().await {
            debug!("[SettlementClient] Dapr alert failed: {}", e);
        }
    }
}

impl Default for SettlementClient {
    fn default() -> Self {
        Self::new()
    }
}
