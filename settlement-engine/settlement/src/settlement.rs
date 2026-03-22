// Settlement Engine
// Orchestrates settlement across TigerBeetle (ledger) and Mojaloop (interop).
// Supports T+0 blockchain settlement and T+2 traditional settlement.

use crate::{
    CreateAccountRequest, CreateTransferRequest, InitiateSettlementRequest,
    SettlementResponse,
    ledger::{TigerBeetleClient, AccountType, LedgerAccount, LedgerTransfer, Balance},
    mojaloop::MojaloopClient,
};
use serde::{Deserialize, Serialize};
use chrono::{DateTime, Utc};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Settlement {
    pub id: String,
    pub trade_id: String,
    pub buyer_id: String,
    pub seller_id: String,
    pub symbol: String,
    pub quantity: String,
    pub price: String,
    pub total_value: String,
    pub settlement_type: SettlementType,
    pub status: Status,
    pub ledger_transfer_id: Option<String>,
    pub mojaloop_transfer_id: Option<String>,
    pub blockchain_tx_hash: Option<String>,
    pub created_at: DateTime<Utc>,
    pub settled_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum SettlementType {
    BlockchainT0,
    TraditionalT2,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum Status {
    Initiated,
    PendingLedger,
    PendingMojaloop,
    PendingBlockchain,
    Settled,
    Failed,
    Reversed,
}

pub struct SettlementEngine {
    tigerbeetle: TigerBeetleClient,
    mojaloop: MojaloopClient,
    settlements: HashMap<String, Settlement>,
}

impl SettlementEngine {
    pub fn new(tigerbeetle_address: &str, mojaloop_url: &str) -> Self {
        Self {
            tigerbeetle: TigerBeetleClient::new(tigerbeetle_address),
            mojaloop: MojaloopClient::new(mojaloop_url),
            settlements: HashMap::new(),
        }
    }

    /// Initiate a new settlement for a completed trade
    pub async fn initiate(
        &self,
        req: &InitiateSettlementRequest,
    ) -> Result<SettlementResponse, Box<dyn std::error::Error>> {
        let settlement_id = uuid::Uuid::new_v4().to_string();
        let settlement_type = match req.settlement_type.as_str() {
            "blockchain_t0" => SettlementType::BlockchainT0,
            _ => SettlementType::TraditionalT2,
        };

        tracing::info!(
            settlement_id = %settlement_id,
            trade_id = %req.trade_id,
            settlement_type = ?settlement_type,
            "Initiating settlement"
        );

        // Step 1: Create pending transfer in TigerBeetle (debit buyer, credit seller)
        let qty: f64 = req.quantity.parse().unwrap_or(0.0);
        let price: f64 = req.price.parse().unwrap_or(0.0);
        let total = qty * price;
        let amount = (total * 100.0) as u64; // Convert to cents

        let _transfer = self.tigerbeetle.create_transfer(
            &req.buyer_id,
            &req.seller_id,
            amount,
            &settlement_id,
        ).await?;

        Ok(SettlementResponse {
            settlement_id,
            status: "initiated".to_string(),
            message: "Settlement initiated successfully".to_string(),
        })
    }

    /// Get a settlement by ID
    pub async fn get_settlement(
        &self,
        settlement_id: &str,
    ) -> Result<&Settlement, Box<dyn std::error::Error>> {
        self.settlements
            .get(settlement_id)
            .ok_or_else(|| format!("Settlement {} not found", settlement_id).into())
    }

    /// Get settlement status
    pub async fn get_status(
        &self,
        settlement_id: &str,
    ) -> Result<serde_json::Value, Box<dyn std::error::Error>> {
        if let Some(settlement) = self.settlements.get(settlement_id) {
            Ok(serde_json::json!({
                "settlement_id": settlement.id,
                "status": settlement.status,
                "settlement_type": settlement.settlement_type,
            }))
        } else {
            Err(format!("Settlement {} not found", settlement_id).into())
        }
    }

    /// Get all accounts for a user
    pub async fn get_user_accounts(
        &self,
        user_id: &str,
    ) -> Result<Vec<LedgerAccount>, Box<dyn std::error::Error>> {
        self.tigerbeetle.get_user_accounts(user_id).await
    }

    /// Create a new ledger account
    pub async fn create_account(
        &self,
        req: &CreateAccountRequest,
    ) -> Result<LedgerAccount, Box<dyn std::error::Error>> {
        let account_type = match req.account_type.as_str() {
            "trading" => AccountType::Trading,
            "settlement" => AccountType::Settlement,
            "margin" => AccountType::Margin,
            "fee" => AccountType::Fee,
            "escrow" => AccountType::Escrow,
            _ => AccountType::Trading,
        };

        self.tigerbeetle
            .create_account(&req.user_id, &req.currency, account_type)
            .await
    }

    /// Create a ledger transfer
    pub async fn create_transfer(
        &self,
        req: &CreateTransferRequest,
    ) -> Result<LedgerTransfer, Box<dyn std::error::Error>> {
        let amount: u64 = req.amount.parse().unwrap_or(0);
        self.tigerbeetle
            .create_transfer(&req.debit_account_id, &req.credit_account_id, amount, &req.reference)
            .await
    }

    /// Get account balance
    pub async fn get_balance(
        &self,
        account_id: &str,
    ) -> Result<Balance, Box<dyn std::error::Error>> {
        self.tigerbeetle.get_balance(account_id).await
    }

    /// Initiate a Mojaloop transfer through the hub
    pub async fn initiate_mojaloop_transfer(
        &self,
        transfer: &crate::mojaloop::MojaloopTransfer,
    ) -> Result<String, Box<dyn std::error::Error>> {
        self.mojaloop.initiate_transfer(transfer).await
    }

    /// Request a quote from Mojaloop hub
    pub async fn request_mojaloop_quote(
        &self,
        quote: &crate::mojaloop::QuoteRequest,
    ) -> Result<String, Box<dyn std::error::Error>> {
        self.mojaloop.request_quote(quote).await
    }

    /// Lookup a participant in Mojaloop ALS
    pub async fn lookup_mojaloop_participant(
        &self,
        id_type: &str,
        id_value: &str,
    ) -> Result<String, Box<dyn std::error::Error>> {
        self.mojaloop.lookup_participant(id_type, id_value).await
    }

    /// Get Mojaloop connection status
    pub fn mojaloop_connection_status(&self) -> (bool, bool) {
        (self.mojaloop.is_connected(), self.mojaloop.is_fallback())
    }
}
