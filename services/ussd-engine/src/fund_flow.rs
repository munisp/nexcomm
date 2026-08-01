/// fund_flow.rs — Fund-flow integration client for the NEXCOM USSD engine.
///
/// Every financial operation initiated via USSD MUST go through this client:
///   - Order placement → matching engine (/api/v1/orders)
///   - Loan repayment  → gateway TigerBeetle (/api/v1/ledger/loan/repay)
///   - Balance check   → gateway ledger (/api/v1/ledger/accounts/:id/balance)
///   - Fluvio stream   → real-time event for compliance monitoring
///
/// All calls are fire-and-forget where appropriate. Failures are logged
/// but never surface to the USSD user as technical errors.
use anyhow::Result;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::time::Duration;
use tracing::{debug, warn};

#[derive(Debug, Serialize)]
pub struct UssdOrderRequest {
    pub client_order_id: String,
    pub account_id: String,
    pub symbol: String,
    pub side: String,
    pub order_type: String,
    pub time_in_force: String,
    pub quantity: f64,
    pub price: Option<f64>,
}

#[derive(Debug, Deserialize)]
pub struct UssdOrderResponse {
    pub success: bool,
    pub data: Option<serde_json::Value>,
    pub error: Option<String>,
}

#[derive(Debug, Deserialize)]
struct BalanceResponse {
    pub balance: i64,
}

/// Fund-flow client for the USSD engine.
pub struct FundFlowClient {
    http: Client,
    matching_engine_url: String,
    gateway_url: String,
    fluvio_url: String,
    enabled: bool,
}

impl FundFlowClient {
    pub fn new() -> Self {
        let matching_engine_url = std::env::var("MATCHING_ENGINE_URL")
            .unwrap_or_else(|_| "http://matching-engine:8080".to_string());
        let gateway_url = std::env::var("GATEWAY_URL")
            .unwrap_or_else(|_| "http://gateway:8200".to_string());
        let fluvio_url = std::env::var("FLUVIO_HTTP_URL")
            .unwrap_or_else(|_| "http://fluvio-proxy:8090".to_string());
        let enabled = !matching_engine_url.is_empty();
        let http = Client::builder()
            .timeout(Duration::from_millis(4000))
            .build()
            .unwrap_or_default();
        if enabled {
            tracing::info!(
                "[FundFlowClient] Initialized — engine={} gateway={}",
                matching_engine_url, gateway_url
            );
        }
        Self {
            http,
            matching_engine_url,
            gateway_url,
            fluvio_url,
            enabled,
        }
    }

    /// Submit a USSD market order to the matching engine.
    /// Returns the engine order ID on success, None on failure.
    pub async fn submit_order(
        &self,
        user_id: i32,
        symbol: &str,
        side: &str,
        quantity: f64,
        price: Option<f64>,
        db_order_id: i64,
    ) -> Option<String> {
        if !self.enabled {
            return None;
        }
        let url = format!("{}/api/v1/orders", self.matching_engine_url);
        let req = UssdOrderRequest {
            client_order_id: format!("USSD-{}-{}", user_id, db_order_id),
            account_id: format!("USER-{}", user_id),
            symbol: symbol.to_string(),
            side: side.to_uppercase(),
            order_type: if price.is_some() { "LIMIT".to_string() } else { "MARKET".to_string() },
            time_in_force: "DAY".to_string(),
            quantity,
            price,
        };
        match self.http.post(&url).json(&req).send().await {
            Ok(resp) if resp.status().is_success() => {
                match resp.json::<UssdOrderResponse>().await {
                    Ok(r) if r.success => {
                        let order_id = r.data
                            .as_ref()
                            .and_then(|d| d["order"]["id"].as_str())
                            .map(|s| s.to_string());
                        debug!("[FundFlowClient] Order submitted: {:?}", order_id);
                        // Emit Fluvio event for real-time tracking
                        self.emit_fluvio_order(user_id, symbol, side, quantity, db_order_id).await;
                        order_id
                    }
                    Ok(r) => {
                        warn!("[FundFlowClient] Order rejected: {:?}", r.error);
                        None
                    }
                    Err(e) => {
                        warn!("[FundFlowClient] Order response parse error: {}", e);
                        None
                    }
                }
            }
            Ok(resp) => {
                warn!("[FundFlowClient] Order submission returned HTTP {}", resp.status());
                None
            }
            Err(e) => {
                warn!("[FundFlowClient] Order submission failed: {}", e);
                None
            }
        }
    }

    /// Get user's settlement account balance in Naira (from TigerBeetle via gateway).
    /// Returns None if gateway is unavailable.
    pub async fn get_balance(&self, user_id: i32) -> Option<f64> {
        if !self.enabled {
            return None;
        }
        let url = format!(
            "{}/api/v1/ledger/accounts/USER-{}/balance",
            self.gateway_url, user_id
        );
        match self.http.get(&url).send().await {
            Ok(resp) if resp.status().is_success() => {
                match resp.json::<BalanceResponse>().await {
                    Ok(b) => Some(b.balance as f64 / 100.0), // cents → Naira
                    Err(_) => None,
                }
            }
            _ => None,
        }
    }

    /// Submit a loan repayment to TigerBeetle via the gateway.
    /// Returns the transfer ID on success.
    pub async fn repay_loan(
        &self,
        user_id: i32,
        loan_id: i64,
        amount_ngn: f64,
        reference: &str,
    ) -> Option<String> {
        if !self.enabled {
            return None;
        }
        let url = format!("{}/api/v1/ledger/loan/repay", self.gateway_url);
        let payload = serde_json::json!({
            "user_id":  format!("USER-{}", user_id),
            "loan_id":  format!("LOAN-{}", loan_id),
            "amount":   amount_ngn,
            "currency": "NGN",
            "principal": amount_ngn * 0.9,
            "interest":  amount_ngn * 0.1,
        });
        match self.http.post(&url).json(&payload).send().await {
            Ok(resp) if resp.status().is_success() => {
                match resp.json::<serde_json::Value>().await {
                    Ok(v) => {
                        let transfer_id = v["transfer_id"].as_str().map(|s| s.to_string());
                        debug!("[FundFlowClient] Loan repayment: {:?}", transfer_id);
                        // Emit Fluvio event
                        self.emit_fluvio_repayment(user_id, loan_id, amount_ngn, reference).await;
                        transfer_id
                    }
                    Err(_) => None,
                }
            }
            Ok(resp) => {
                warn!("[FundFlowClient] Loan repayment returned HTTP {}", resp.status());
                None
            }
            Err(e) => {
                warn!("[FundFlowClient] Loan repayment failed: {}", e);
                None
            }
        }
    }

    /// Emit a Fluvio real-time event for a USSD order.
    async fn emit_fluvio_order(
        &self,
        user_id: i32,
        symbol: &str,
        side: &str,
        quantity: f64,
        order_id: i64,
    ) {
        let url = format!("{}/api/v1/produce", self.fluvio_url);
        let payload = serde_json::json!({
            "topic": "nexcom.ussd.orders",
            "key":   format!("ussd-order-{}", order_id),
            "value": {
                "user_id":  user_id,
                "symbol":   symbol,
                "side":     side,
                "quantity": quantity,
                "order_id": order_id,
                "source":   "USSD",
                "timestamp": chrono::Utc::now().to_rfc3339(),
            }
        });
        if let Err(e) = self.http.post(&url).json(&payload).send().await {
            debug!("[FundFlowClient] Fluvio order emit failed: {}", e);
        }
    }

    /// Emit a Fluvio real-time event for a USSD loan repayment.
    async fn emit_fluvio_repayment(
        &self,
        user_id: i32,
        loan_id: i64,
        amount_ngn: f64,
        reference: &str,
    ) {
        let url = format!("{}/api/v1/produce", self.fluvio_url);
        let payload = serde_json::json!({
            "topic": "nexcom.ussd.repayments",
            "key":   format!("ussd-repay-{}", loan_id),
            "value": {
                "user_id":   user_id,
                "loan_id":   loan_id,
                "amount":    amount_ngn,
                "reference": reference,
                "source":    "USSD",
                "timestamp": chrono::Utc::now().to_rfc3339(),
            }
        });
        if let Err(e) = self.http.post(&url).json(&payload).send().await {
            debug!("[FundFlowClient] Fluvio repayment emit failed: {}", e);
        }
    }
}

impl Default for FundFlowClient {
    fn default() -> Self {
        Self::new()
    }
}
