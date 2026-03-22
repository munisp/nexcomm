// Commodity Tokenization
// Represents physical commodities as on-chain tokens (ERC-1155 style).
// Supports fractional ownership, warehouse receipt backing, and transfer restrictions.

use serde::{Deserialize, Serialize};
use chrono::{DateTime, Utc};

/// Tokenized commodity representation
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CommodityToken {
    pub token_id: String,
    pub commodity_symbol: String,
    pub quantity: String,
    pub unit: String,
    pub owner_id: String,
    pub contract_address: String,
    pub chain: String,
    pub warehouse_receipt_id: String,
    pub warehouse_location: Option<String>,
    pub quality_grade: Option<String>,
    pub expiry_date: Option<DateTime<Utc>>,
    pub is_fractionalized: bool,
    pub total_fractions: Option<u64>,
    pub metadata_uri: String,
    pub status: TokenStatus,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum TokenStatus {
    Minting,
    Active,
    InTransfer,
    InSettlement,
    Redeemed,
    Expired,
    Burned,
}

/// Token transfer event
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TokenTransfer {
    pub transfer_id: String,
    pub token_id: String,
    pub from_address: String,
    pub to_address: String,
    pub quantity: String,
    pub tx_hash: String,
    pub chain: String,
    pub status: String,
    pub timestamp: DateTime<Utc>,
}

/// Fractionalization request
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FractionalizationRequest {
    pub token_id: String,
    pub total_fractions: u64,
    pub min_fraction_size: String,
}
