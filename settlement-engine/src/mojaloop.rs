// Mojaloop Integration
// Provides interoperable settlement through the Mojaloop hub.
// Implements the FSPIOP API for cross-DFSP transfers.
// Attempts real HTTP connection to Mojaloop hub; falls back to local tracking.

use serde::{Deserialize, Serialize};
use chrono::{DateTime, Utc};
use std::collections::HashMap;
use std::sync::Mutex;
use std::time::Duration;

/// Mojaloop transfer request
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MojaloopTransfer {
    pub transfer_id: String,
    pub payer_fsp: String,
    pub payee_fsp: String,
    pub amount: MojaloopAmount,
    pub ilp_packet: String,
    pub condition: String,
    pub expiration: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MojaloopAmount {
    pub currency: String,
    pub amount: String,
}

/// Mojaloop quote request for determining transfer terms
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QuoteRequest {
    pub quote_id: String,
    pub transaction_id: String,
    pub payer: MojaloopParty,
    pub payee: MojaloopParty,
    pub amount_type: String,
    pub amount: MojaloopAmount,
    pub transaction_type: TransactionType,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MojaloopParty {
    pub party_id_info: PartyIdInfo,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PartyIdInfo {
    pub party_id_type: String,
    pub party_identifier: String,
    pub fsp_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TransactionType {
    pub scenario: String,
    pub initiator: String,
    pub initiator_type: String,
}

/// Mojaloop settlement status
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum SettlementStatus {
    Pending,
    Reserved,
    Committed,
    Aborted,
}

/// Mojaloop client for FSPIOP API interactions.
/// Attempts real HTTP connection to Mojaloop hub on init.
/// Falls back to local transfer tracking when hub is unavailable.
pub struct MojaloopClient {
    hub_url: String,
    http_client: reqwest::Client,
    dfsp_id: String,
    connected: bool,
    fallback_mode: bool,
    // In-memory fallback state
    transfers: Mutex<HashMap<String, MojaloopTransfer>>,
    quotes: Mutex<HashMap<String, QuoteRequest>>,
    participants: Mutex<HashMap<String, String>>,
}

impl MojaloopClient {
    pub fn new(hub_url: &str) -> Self {
        let dfsp_id = std::env::var("MOJALOOP_DFSP_ID")
            .unwrap_or_else(|_| "nexcom-exchange".to_string());

        let http_client = reqwest::Client::builder()
            .timeout(Duration::from_secs(5))
            .build()
            .unwrap_or_default();

        // Attempt to verify Mojaloop hub health
        let (connected, fallback_mode) = {
            // Try a quick TCP check to the hub URL
            let host = hub_url.trim_start_matches("http://").trim_start_matches("https://");
            let addr = if host.contains(':') {
                host.to_string()
            } else {
                format!("{}:80", host)
            };
            match std::net::TcpStream::connect_timeout(
                &addr.parse().unwrap_or_else(|_| "127.0.0.1:4001".parse().unwrap()),
                Duration::from_secs(3),
            ) {
                Ok(_) => {
                    tracing::info!(hub_url = hub_url, "Connected to Mojaloop hub");
                    (true, false)
                }
                Err(e) => {
                    tracing::warn!(
                        hub_url = hub_url,
                        error = %e,
                        "Mojaloop hub unavailable, using local transfer tracking"
                    );
                    (false, true)
                }
            }
        };

        Self {
            hub_url: hub_url.to_string(),
            http_client,
            dfsp_id,
            connected,
            fallback_mode,
            transfers: Mutex::new(HashMap::new()),
            quotes: Mutex::new(HashMap::new()),
            participants: Mutex::new(HashMap::new()),
        }
    }

    /// Check if connected to real Mojaloop hub
    pub fn is_connected(&self) -> bool {
        self.connected
    }

    /// Check if operating in fallback mode
    pub fn is_fallback(&self) -> bool {
        self.fallback_mode
    }

    /// Initiate a Mojaloop transfer via the hub (FSPIOP API)
    pub async fn initiate_transfer(
        &self,
        transfer: &MojaloopTransfer,
    ) -> Result<String, Box<dyn std::error::Error>> {
        if self.connected && !self.fallback_mode {
            // Real Mojaloop: POST /transfers with FSPIOP headers
            let url = format!("{}/transfers", self.hub_url);
            match self.http_client.post(&url)
                .header("Content-Type", "application/vnd.interoperability.transfers+json;version=1.1")
                .header("Accept", "application/vnd.interoperability.transfers+json;version=1.1")
                .header("FSPIOP-Source", &self.dfsp_id)
                .header("FSPIOP-Destination", &transfer.payee_fsp)
                .header("Date", Utc::now().format("%a, %d %b %Y %H:%M:%S GMT").to_string())
                .json(transfer)
                .send()
                .await
            {
                Ok(resp) if resp.status().is_success() || resp.status().as_u16() == 202 => {
                    tracing::info!(
                        transfer_id = %transfer.transfer_id,
                        "[REAL] Mojaloop transfer accepted"
                    );
                }
                Ok(resp) => {
                    tracing::warn!(
                        status = %resp.status(),
                        "[REAL] Mojaloop transfer non-success response"
                    );
                }
                Err(e) => {
                    tracing::warn!(error = %e, "[REAL] Mojaloop transfer request failed");
                }
            }
        } else {
            tracing::info!(
                transfer_id = %transfer.transfer_id,
                payer_fsp = %transfer.payer_fsp,
                payee_fsp = %transfer.payee_fsp,
                amount = %transfer.amount.amount,
                "[FALLBACK] Tracking Mojaloop transfer locally"
            );
        }

        // Always track locally
        if let Ok(mut transfers) = self.transfers.lock() {
            transfers.insert(transfer.transfer_id.clone(), transfer.clone());
        }

        Ok(transfer.transfer_id.clone())
    }

    /// Request a quote for a transfer (FSPIOP API)
    pub async fn request_quote(
        &self,
        quote: &QuoteRequest,
    ) -> Result<String, Box<dyn std::error::Error>> {
        if self.connected && !self.fallback_mode {
            let url = format!("{}/quotes", self.hub_url);
            match self.http_client.post(&url)
                .header("Content-Type", "application/vnd.interoperability.quotes+json;version=1.1")
                .header("Accept", "application/vnd.interoperability.quotes+json;version=1.1")
                .header("FSPIOP-Source", &self.dfsp_id)
                .header("Date", Utc::now().format("%a, %d %b %Y %H:%M:%S GMT").to_string())
                .json(quote)
                .send()
                .await
            {
                Ok(resp) if resp.status().is_success() || resp.status().as_u16() == 202 => {
                    tracing::info!(quote_id = %quote.quote_id, "[REAL] Mojaloop quote accepted");
                }
                Ok(resp) => {
                    tracing::warn!(status = %resp.status(), "[REAL] Mojaloop quote non-success");
                }
                Err(e) => {
                    tracing::warn!(error = %e, "[REAL] Mojaloop quote request failed");
                }
            }
        } else {
            tracing::info!(quote_id = %quote.quote_id, "[FALLBACK] Tracking quote locally");
        }

        if let Ok(mut quotes) = self.quotes.lock() {
            quotes.insert(quote.quote_id.clone(), quote.clone());
        }

        Ok(quote.quote_id.clone())
    }

    /// Look up a participant by ID in the Account Lookup Service
    pub async fn lookup_participant(
        &self,
        id_type: &str,
        id_value: &str,
    ) -> Result<String, Box<dyn std::error::Error>> {
        if self.connected && !self.fallback_mode {
            let url = format!("{}/participants/{}/{}", self.hub_url, id_type, id_value);
            match self.http_client.get(&url)
                .header("Accept", "application/vnd.interoperability.participants+json;version=1.1")
                .header("FSPIOP-Source", &self.dfsp_id)
                .header("Date", Utc::now().format("%a, %d %b %Y %H:%M:%S GMT").to_string())
                .send()
                .await
            {
                Ok(resp) if resp.status().is_success() => {
                    let body = resp.text().await.unwrap_or_default();
                    tracing::info!(id_type = id_type, "[REAL] Mojaloop participant lookup success");
                    return Ok(body);
                }
                Ok(resp) => {
                    tracing::warn!(status = %resp.status(), "[REAL] Mojaloop ALS non-success");
                }
                Err(e) => {
                    tracing::warn!(error = %e, "[REAL] Mojaloop ALS lookup failed");
                }
            }
        } else {
            tracing::info!(id_type = id_type, id_value = id_value, "[FALLBACK] Local participant lookup");
        }

        // Fallback: check local cache
        let key = format!("{}:{}", id_type, id_value);
        if let Ok(participants) = self.participants.lock() {
            if let Some(fsp_id) = participants.get(&key) {
                return Ok(fsp_id.clone());
            }
        }

        Ok(String::new())
    }

    /// Register a participant in the local cache (for fallback mode)
    pub fn register_participant(&self, id_type: &str, id_value: &str, fsp_id: &str) {
        let key = format!("{}:{}", id_type, id_value);
        if let Ok(mut participants) = self.participants.lock() {
            participants.insert(key, fsp_id.to_string());
        }
    }
}
