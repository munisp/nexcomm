use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::net::TcpStream;
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

/// Strict TigerBeetle adapter. It does not implement a local double-entry
/// ledger or fabricate balances when the real ledger is unavailable.
pub struct TigerBeetleClient {
    address: String,
    http_client: reqwest::Client,
    connected: bool,
}

impl TigerBeetleClient {
    pub fn new(address: &str) -> Self {
        let http_client = reqwest::Client::builder()
            .timeout(Duration::from_secs(5))
            .build()
            .unwrap_or_default();
        let connected = TcpStream::connect_timeout(
            &address
                .parse()
                .unwrap_or_else(|_| "127.0.0.1:3000".parse().unwrap()),
            Duration::from_secs(3),
        )
        .is_ok();
        if connected {
            tracing::info!(address = address, "TigerBeetle endpoint reachable");
        } else {
            tracing::error!(
                address = address,
                "TigerBeetle unavailable; settlement requests will fail"
            );
        }
        Self {
            address: address.to_string(),
            http_client,
            connected,
        }
    }

    pub fn is_connected(&self) -> bool {
        self.connected
    }
    pub fn is_fallback(&self) -> bool {
        false
    }

    fn require_connection(&self) -> Result<(), Box<dyn std::error::Error>> {
        if self.connected {
            Ok(())
        } else {
            Err("TigerBeetle is unavailable; no ledger fallback is permitted".into())
        }
    }

    /// This service expects a real TigerBeetle-compatible adapter at the
    /// configured address. A non-success response is a transaction failure.
    pub async fn create_account(
        &self,
        user_id: &str,
        currency: &str,
        account_type: AccountType,
    ) -> Result<LedgerAccount, Box<dyn std::error::Error>> {
        self.require_connection()?;
        let account = LedgerAccount {
            id: uuid::Uuid::new_v4().to_string(),
            user_id: user_id.to_string(),
            currency: currency.to_string(),
            account_type,
            debits_pending: 0,
            debits_posted: 0,
            credits_pending: 0,
            credits_posted: 0,
            created_at: Utc::now(),
        };
        let url = format!("http://{}/accounts", self.address);
        let response = self.http_client.post(&url).json(&serde_json::json!({"id": account.id, "user_data_128": user_id, "ledger": 1, "code": 1, "flags": 0})).send().await?;
        if !response.status().is_success() {
            return Err(format!(
                "TigerBeetle account creation returned HTTP {}",
                response.status()
            )
            .into());
        }
        Ok(account)
    }

    pub async fn create_transfer(
        &self,
        debit_account_id: &str,
        credit_account_id: &str,
        amount: u64,
        reference: &str,
    ) -> Result<LedgerTransfer, Box<dyn std::error::Error>> {
        self.require_connection()?;
        if amount == 0 {
            return Err("ledger transfer amount must be positive".into());
        }
        let transfer = LedgerTransfer {
            id: uuid::Uuid::new_v4().to_string(),
            debit_account_id: debit_account_id.to_string(),
            credit_account_id: credit_account_id.to_string(),
            amount,
            pending_id: None,
            user_data: reference.to_string(),
            code: 1,
            ledger: 1,
            flags: 0,
            timestamp: Utc::now(),
        };
        let url = format!("http://{}/transfers", self.address);
        let response = self.http_client.post(&url).json(&serde_json::json!({"id": transfer.id, "debit_account_id": debit_account_id, "credit_account_id": credit_account_id, "amount": amount, "user_data_128": reference, "code": 1, "ledger": 1, "flags": 0})).send().await?;
        if !response.status().is_success() {
            return Err(format!("TigerBeetle transfer returned HTTP {}", response.status()).into());
        }
        Ok(transfer)
    }

    /// The raw TigerBeetle protocol does not provide this HTTP JSON contract.
    /// Returning a fabricated zero balance is forbidden; deploy the native
    /// adapter before enabling balance reads in this service.
    pub async fn get_balance(
        &self,
        _account_id: &str,
    ) -> Result<Balance, Box<dyn std::error::Error>> {
        self.require_connection()?;
        Err("TigerBeetle balance lookup requires the native client adapter".into())
    }

    pub async fn get_user_accounts(
        &self,
        _user_id: &str,
    ) -> Result<Vec<LedgerAccount>, Box<dyn std::error::Error>> {
        self.require_connection()?;
        Err("TigerBeetle account discovery requires the durable account directory".into())
    }

    pub async fn get_transfers(&self) -> Result<Vec<LedgerTransfer>, Box<dyn std::error::Error>> {
        self.require_connection()?;
        Err("TigerBeetle reconciliation requires the native client adapter".into())
    }
}
