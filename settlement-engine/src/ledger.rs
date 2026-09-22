use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::time::Duration;

/// Account metadata returned only after the configured ledger adapter confirms
/// creation. Balances must be obtained from TigerBeetle, never process memory.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LedgerAccount {
    pub id: String,
    pub user_id: String,
    pub currency: String,
    pub account_type: AccountType,
    pub debits_pending: u64,
    pub debits_posted: u64,
    pub credits_pending: u64,
    pub credits_posted: u64,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum AccountType {
    Trading,
    Settlement,
    Margin,
    Fee,
    Escrow,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LedgerTransfer {
    pub id: String,
    pub debit_account_id: String,
    pub credit_account_id: String,
    pub amount: u64,
    pub pending_id: Option<String>,
    pub user_data: String,
    pub code: u16,
    pub ledger: u32,
    pub flags: u16,
    pub timestamp: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Balance {
    pub account_id: String,
    pub available: String,
    pub pending: String,
    pub total: String,
    pub currency: String,
}

// ─── Gateway ledger API response shapes ──────────────────────────────────────
// (gateway-service/internal/api/ledger_handlers.go +
//  gateway-service/internal/tigerbeetle/client.go)

#[derive(Debug, Deserialize)]
struct GatewayAccount {
    id: String,
    #[serde(rename = "userId")]
    user_id: String,
    #[serde(rename = "type")]
    account_type: String,
    currency: String,
    balance: i64,
    pending: i64,
}

#[derive(Debug, Deserialize)]
struct GatewayTransfer {
    id: String,
    #[serde(rename = "debitAccountId")]
    debit_account_id: String,
    #[serde(rename = "creditAccountId")]
    credit_account_id: String,
    amount: i64,
    code: u16,
    timestamp: i64,
    status: String,
}

#[derive(Debug, Deserialize)]
struct GatewayBalanceResponse {
    account_id: String,
    balance: i64,
    currency: String,
}

#[derive(Debug, Deserialize)]
struct GatewayAccountsResponse {
    accounts: Vec<GatewayAccount>,
}

/// Maps our account types onto the gateway ledger API's accepted set
/// (gateway-service/internal/tigerbeetle/client.go accountCode(): margin,
/// settlement, fee, clearing). Escrow settles through the clearing account
/// code. "Trading" has no ledger code upstream; the gateway rejects it and the
/// failure propagates — no local fallback is ever fabricated.
fn gateway_account_type(t: &AccountType) -> &'static str {
    match t {
        AccountType::Settlement => "settlement",
        AccountType::Margin => "margin",
        AccountType::Fee => "fee",
        AccountType::Escrow => "clearing",
        AccountType::Trading => "trading",
    }
}

fn account_type_from_str(s: &str) -> AccountType {
    match s {
        "settlement" => AccountType::Settlement,
        "margin" => AccountType::Margin,
        "fee" => AccountType::Fee,
        "clearing" => AccountType::Escrow,
        _ => AccountType::Trading,
    }
}

/// Ledger client for the settlement engine.
///
/// TigerBeetle speaks a binary protocol — it has NO HTTP/JSON interface, so the
/// previous implementation (POST /accounts, POST /transfers to the TB port)
/// could never succeed. All ledger operations are instead routed through the
/// gateway-service ledger API (`/api/v1/ledger/...`), which owns the official
/// TigerBeetle SDK client. Fail-closed semantics are preserved: when the
/// gateway is unreachable or returns an error, the operation fails.
pub struct TigerBeetleClient {
    /// Base URL of the gateway-service ledger API, e.g. http://gateway:8200
    gateway_url: String,
    http_client: reqwest::Client,
}

impl TigerBeetleClient {
    /// `gateway_url` is the gateway-service base URL. Historically this
    /// constructor received a TigerBeetle host:port; if a bare host:port is
    /// passed it is treated as the gateway address for backwards compatibility,
    /// but callers should pass GATEWAY_URL (see settlement.rs / main.rs).
    pub fn new(gateway_url: &str) -> Self {
        let http_client = reqwest::Client::builder()
            .timeout(Duration::from_secs(5))
            .build()
            .unwrap_or_default();
        let base = if gateway_url.starts_with("http://") || gateway_url.starts_with("https://") {
            gateway_url.trim_end_matches('/').to_string()
        } else {
            format!("http://{}", gateway_url.trim_end_matches('/'))
        };
        tracing::info!(gateway_url = %base, "Ledger client targeting gateway-service ledger API");
        Self {
            gateway_url: base,
            http_client,
        }
    }

    /// Live connectivity probe against the gateway (which in turn probes TB).
    pub async fn is_connected(&self) -> bool {
        self.http_client
            .get(format!("{}/health", self.gateway_url))
            .send()
            .await
            .map(|r| r.status().is_success())
            .unwrap_or(false)
    }

    pub fn is_fallback(&self) -> bool {
        false
    }

    /// Create a ledger account via POST /api/v1/ledger/accounts.
    pub async fn create_account(
        &self,
        user_id: &str,
        currency: &str,
        account_type: AccountType,
    ) -> Result<LedgerAccount, Box<dyn std::error::Error>> {
        let url = format!("{}/api/v1/ledger/accounts", self.gateway_url);
        let response = self
            .http_client
            .post(&url)
            .json(&serde_json::json!({
                "user_id": user_id,
                "account_type": gateway_account_type(&account_type),
                "currency": currency,
            }))
            .send()
            .await?;
        if !response.status().is_success() {
            return Err(format!("gateway ledger account creation returned HTTP {}", response.status()).into());
        }
        let acc: GatewayAccount = response.json().await?;
        Ok(LedgerAccount {
            id: acc.id,
            user_id: acc.user_id,
            currency: acc.currency,
            account_type: account_type_from_str(&acc.account_type),
            debits_pending: 0,
            debits_posted: acc.balance.max(0) as u64,
            credits_pending: 0,
            credits_posted: 0,
            created_at: Utc::now(),
        })
    }

    /// Create a posted transfer via POST /api/v1/ledger/transfers.
    pub async fn create_transfer(
        &self,
        debit_account_id: &str,
        credit_account_id: &str,
        amount: u64,
        reference: &str,
    ) -> Result<LedgerTransfer, Box<dyn std::error::Error>> {
        if amount == 0 {
            return Err("ledger transfer amount must be positive".into());
        }
        let url = format!("{}/api/v1/ledger/transfers", self.gateway_url);
        let response = self
            .http_client
            .post(&url)
            .json(&serde_json::json!({
                "debit_account_id": debit_account_id,
                "credit_account_id": credit_account_id,
                "amount": amount,
                "code": 1,
                "reference": reference,
            }))
            .send()
            .await?;
        if !response.status().is_success() {
            return Err(format!("gateway ledger transfer returned HTTP {}", response.status()).into());
        }
        let t: GatewayTransfer = response.json().await?;
        Ok(LedgerTransfer {
            id: t.id,
            debit_account_id: t.debit_account_id,
            credit_account_id: t.credit_account_id,
            amount: t.amount.max(0) as u64,
            pending_id: None,
            user_data: reference.to_string(),
            code: t.code,
            ledger: 1,
            flags: 0,
            timestamp: DateTime::from_timestamp_millis(t.timestamp).unwrap_or_else(Utc::now),
        })
    }

    /// Balance lookup via GET /api/v1/ledger/accounts/{account_id}/balance.
    /// (The gateway route uses the path param name `user_id` but treats it as
    /// the account id — see ledger_handlers.go ledgerGetBalance.)
    pub async fn get_balance(
        &self,
        account_id: &str,
    ) -> Result<Balance, Box<dyn std::error::Error>> {
        let url = format!("{}/api/v1/ledger/accounts/{}/balance", self.gateway_url, account_id);
        let response = self.http_client.get(&url).send().await?;
        if !response.status().is_success() {
            return Err(format!("gateway balance lookup returned HTTP {}", response.status()).into());
        }
        let b: GatewayBalanceResponse = response.json().await?;
        Ok(Balance {
            account_id: b.account_id,
            available: b.balance.to_string(),
            pending: "0".to_string(),
            total: b.balance.to_string(),
            currency: b.currency,
        })
    }

    /// Account discovery via GET /api/v1/ledger/accounts/{user_id}.
    pub async fn get_user_accounts(
        &self,
        user_id: &str,
    ) -> Result<Vec<LedgerAccount>, Box<dyn std::error::Error>> {
        let url = format!("{}/api/v1/ledger/accounts/{}", self.gateway_url, user_id);
        let response = self.http_client.get(&url).send().await?;
        if !response.status().is_success() {
            return Err(format!("gateway account lookup returned HTTP {}", response.status()).into());
        }
        let resp: GatewayAccountsResponse = response.json().await?;
        Ok(resp
            .accounts
            .into_iter()
            .map(|acc| LedgerAccount {
                id: acc.id,
                user_id: acc.user_id,
                currency: acc.currency,
                account_type: account_type_from_str(&acc.account_type),
                debits_pending: 0,
                debits_posted: acc.balance.max(0) as u64,
                credits_pending: 0,
                credits_posted: 0,
                created_at: Utc::now(),
            })
            .collect())
    }

    /// The gateway ledger API keys transfer history by user id; there is no
    /// global transfer listing. Use get_transfers_for(user_id) instead.
    pub async fn get_transfers(&self) -> Result<Vec<LedgerTransfer>, Box<dyn std::error::Error>> {
        Err("global transfer listing is not exposed by the gateway ledger API; use per-user history".into())
    }
}
