//! Core domain types for the NEXCOM matching engine.
//! All monetary values use i64 fixed-point (8 decimal places) to avoid floating-point issues.
#![allow(dead_code)]

use chrono::{DateTime, Utc};
use ordered_float::OrderedFloat;
use serde::{Deserialize, Serialize};
use std::fmt;
use uuid::Uuid;

/// Fixed-point price with 8 decimal places. 1 USD = 100_000_000.
pub type Price = i64;
/// Quantity in base units (e.g., 1 lot = 1_000_000 for 6 decimal precision).
pub type Qty = i64;

pub const PRICE_SCALE: i64 = 100_000_000;

/// Convert f64 to fixed-point price.
pub fn to_price(f: f64) -> Price {
    (f * PRICE_SCALE as f64) as Price
}

/// Convert fixed-point price to f64.
pub fn from_price(p: Price) -> f64 {
    p as f64 / PRICE_SCALE as f64
}

// ─── Order Side ──────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum Side {
    Buy,
    Sell,
}

impl fmt::Display for Side {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Side::Buy => write!(f, "BUY"),
            Side::Sell => write!(f, "SELL"),
        }
    }
}

// ─── Order Type ──────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum OrderType {
    Market,
    Limit,
    Stop,
    StopLimit,
    #[serde(rename = "IOC")]
    ImmediateOrCancel,
    #[serde(rename = "FOK")]
    FillOrKill,
    #[serde(rename = "GTC")]
    GoodTilCancel,
    #[serde(rename = "GTD")]
    GoodTilDate,
    // ─── NYSE-equivalent order types ─────────────────────────
    /// Pegged order: price follows best bid/ask dynamically.
    Pegged,
    /// Iceberg order: only display_quantity visible, rest hidden.
    Iceberg,
    /// Reserve order: similar to iceberg with reserve quantity.
    Reserve,
    /// Trailing stop: stop price trails market by offset.
    TrailingStop,
    /// D-Quote: designated market maker quote.
    #[serde(rename = "DQUOTE")]
    DQuote,
    /// Market-on-Open: executes at opening auction price.
    #[serde(rename = "MOO")]
    MarketOnOpen,
    /// Market-on-Close: executes at closing auction price.
    #[serde(rename = "MOC")]
    MarketOnClose,
    /// Limit-on-Open: limit order valid only during opening auction.
    #[serde(rename = "LOO")]
    LimitOnOpen,
    /// Limit-on-Close: limit order valid only during closing auction.
    #[serde(rename = "LOC")]
    LimitOnClose,
    /// Auction-only order: participates only in auctions.
    Auction,
    /// Midpoint peg: pegged to midpoint of NBBO.
    MidpointPeg,
}

// ─── Order Status ────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum OrderStatus {
    New,
    PartiallyFilled,
    Filled,
    Cancelled,
    Rejected,
    Expired,
    PendingNew,
    PendingCancel,
}

// ─── Time in Force ───────────────────────────────────────────────────────────

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum TimeInForce {
    Day,
    #[serde(rename = "GTC")]
    GoodTilCancel,
    #[serde(rename = "IOC")]
    ImmediateOrCancel,
    #[serde(rename = "FOK")]
    FillOrKill,
    #[serde(rename = "GTD")]
    GoodTilDate,
    #[serde(rename = "GTX")]
    GoodTilCrossing,
}

// ─── Contract Type ───────────────────────────────────────────────────────────

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum ContractType {
    Spot,
    Future,
    Option,
    Spread,
}

// ─── Option Type ─────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum OptionType {
    Call,
    Put,
}

// ─── Option Style ────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum OptionStyle {
    American,
    European,
}

// ─── Order ───────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Order {
    pub id: Uuid,
    pub client_order_id: String,
    pub account_id: String,
    pub symbol: String,
    pub side: Side,
    pub order_type: OrderType,
    pub time_in_force: TimeInForce,
    pub price: Price,
    pub stop_price: Price,
    pub quantity: Qty,
    pub filled_quantity: Qty,
    pub remaining_quantity: Qty,
    pub average_price: Price,
    pub status: OrderStatus,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub expire_at: Option<DateTime<Utc>>,
    /// Nanosecond-precision timestamp for sequencing.
    pub sequence: u64,
}

impl Order {
    pub fn new(
        client_order_id: String,
        account_id: String,
        symbol: String,
        side: Side,
        order_type: OrderType,
        time_in_force: TimeInForce,
        price: Price,
        stop_price: Price,
        quantity: Qty,
    ) -> Self {
        let now = Utc::now();
        Self {
            id: Uuid::new_v4(),
            client_order_id,
            account_id,
            symbol,
            side,
            order_type,
            time_in_force,
            price,
            stop_price,
            quantity,
            filled_quantity: 0,
            remaining_quantity: quantity,
            average_price: 0,
            status: OrderStatus::New,
            created_at: now,
            updated_at: now,
            expire_at: None,
            sequence: now.timestamp_nanos_opt().unwrap_or(0) as u64,
        }
    }

    pub fn is_buy(&self) -> bool {
        self.side == Side::Buy
    }

    pub fn is_filled(&self) -> bool {
        self.remaining_quantity == 0
    }
}

// ─── Trade / Execution ───────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Trade {
    pub id: Uuid,
    pub symbol: String,
    pub price: Price,
    pub quantity: Qty,
    pub buyer_order_id: Uuid,
    pub seller_order_id: Uuid,
    pub buyer_account: String,
    pub seller_account: String,
    pub aggressor_side: Side,
    pub timestamp: DateTime<Utc>,
    pub sequence: u64,
}

// ─── Futures Contract ────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FuturesContract {
    pub symbol: String,
    pub underlying: String,
    pub contract_type: ContractType,
    pub contract_size: Qty,
    pub tick_size: Price,
    pub tick_value: Price,
    pub initial_margin: Price,
    pub maintenance_margin: Price,
    pub daily_price_limit: Price,
    pub expiry_date: DateTime<Utc>,
    pub first_notice_date: Option<DateTime<Utc>>,
    pub last_trading_date: DateTime<Utc>,
    pub settlement_type: SettlementType,
    pub delivery_months: Vec<u32>,
    pub trading_hours: String,
    pub status: ContractStatus,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum SettlementType {
    Physical,
    Cash,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum ContractStatus {
    Active,
    Suspended,
    Expired,
    Settled,
    PendingExpiry,
}

// ─── Options Contract ────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OptionsContract {
    pub symbol: String,
    pub underlying_future: String,
    pub option_type: OptionType,
    pub option_style: OptionStyle,
    pub strike_price: Price,
    pub contract_size: Qty,
    pub tick_size: Price,
    pub expiry_date: DateTime<Utc>,
    pub premium: Price,
    pub status: ContractStatus,
}

// ─── Greeks ──────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Greeks {
    pub delta: f64,
    pub gamma: f64,
    pub theta: f64,
    pub vega: f64,
    pub rho: f64,
    pub implied_vol: f64,
}

// ─── Spread ──────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum SpreadType {
    Calendar,
    InterCommodity,
    Butterfly,
    Condor,
    #[serde(rename = "TAS")]
    TradeAtSettlement,
    Crack,
    Crush,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SpreadDefinition {
    pub symbol: String,
    pub spread_type: SpreadType,
    pub legs: Vec<SpreadLeg>,
    pub tick_size: Price,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SpreadLeg {
    pub symbol: String,
    pub ratio: i32,
    pub side: Side,
}

// ─── Position ────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Position {
    pub account_id: String,
    pub symbol: String,
    pub side: Side,
    pub quantity: Qty,
    pub average_price: Price,
    pub unrealized_pnl: Price,
    pub realized_pnl: Price,
    pub initial_margin_required: Price,
    pub maintenance_margin_required: Price,
    pub liquidation_price: Price,
    pub updated_at: DateTime<Utc>,
}

// ─── Clearing Types ──────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClearingMember {
    pub id: String,
    pub name: String,
    pub tier: ClearingTier,
    pub guarantee_fund_contribution: Price,
    pub credit_limit: Price,
    pub status: MemberStatus,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum ClearingTier {
    General,
    Individual,
    #[serde(rename = "FCM")]
    FuturesCommissionMerchant,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum MemberStatus {
    Active,
    Suspended,
    Defaulted,
    Withdrawn,
}

/// Margin calculation result.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MarginRequirement {
    pub account_id: String,
    pub initial_margin: Price,
    pub maintenance_margin: Price,
    pub variation_margin: Price,
    pub portfolio_offset: Price,
    pub net_requirement: Price,
    pub timestamp: DateTime<Utc>,
}

/// Default waterfall layer.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum WaterfallLayer {
    DefaulterMargin,
    DefaulterGuaranteeFund,
    ExchangeSkinInTheGame,
    NonDefaulterGuaranteeFund,
    AssessmentPowers,
}

// ─── Delivery Types ──────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Warehouse {
    pub id: String,
    pub name: String,
    pub location: String,
    pub country: String,
    pub latitude: f64,
    pub longitude: f64,
    pub commodities: Vec<String>,
    pub capacity_tonnes: f64,
    pub current_stock_tonnes: f64,
    pub certified: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WarehouseReceipt {
    pub id: Uuid,
    pub warehouse_id: String,
    pub commodity: String,
    pub quantity_tonnes: f64,
    pub grade: String,
    pub lot_number: String,
    pub owner_account: String,
    pub issued_at: DateTime<Utc>,
    pub expires_at: Option<DateTime<Utc>>,
    pub status: ReceiptStatus,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum ReceiptStatus {
    Active,
    Pledged,
    InTransit,
    Delivered,
    Cancelled,
    Expired,
}

// ─── Surveillance Types ──────────────────────────────────────────────────────

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum AlertType {
    Spoofing,
    Layering,
    WashTrading,
    FrontRunning,
    MarketManipulation,
    PositionLimitBreach,
    PriceManipulation,
    InsiderTrading,
    UnusualVolume,
    // ─── NYSE-equivalent alert types ─────────────────────────
    /// Circuit breaker triggered (LULD or market-wide).
    CircuitBreaker,
    /// Volatility interruption detected.
    VolatilityInterruption,
    /// Concentrated position risk.
    ConcentrationRisk,
    /// Excessive order-to-trade ratio.
    ExcessiveOrderRatio,
    /// Cross-market manipulation detected.
    CrossMarketManipulation,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum AlertSeverity {
    Low,
    Medium,
    High,
    Critical,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SurveillanceAlert {
    pub id: Uuid,
    pub alert_type: AlertType,
    pub severity: AlertSeverity,
    pub account_id: String,
    pub symbol: String,
    pub description: String,
    pub evidence: serde_json::Value,
    pub timestamp: DateTime<Utc>,
    pub resolved: bool,
}

// ─── Audit Trail ─────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuditEntry {
    pub id: Uuid,
    pub sequence: u64,
    pub event_type: String,
    pub entity_id: String,
    pub account_id: String,
    pub symbol: String,
    pub data: serde_json::Value,
    pub timestamp: DateTime<Utc>,
    pub checksum: String,
}

// ─── FIX Protocol Types ──────────────────────────────────────────────────────

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FixMsgType {
    Heartbeat,
    Logon,
    Logout,
    NewOrderSingle,
    OrderCancelRequest,
    OrderCancelReplaceRequest,
    ExecutionReport,
    OrderCancelReject,
    MarketDataRequest,
    MarketDataSnapshotFullRefresh,
    MarketDataIncrementalRefresh,
    SecurityList,
    SecurityListRequest,
    PositionReport,
    // ─── FIX 5.0 SP2 additions ──────────────────────────────
    TradeCaptureReport,
    TradeCaptureReportRequest,
    SecurityStatus,
    SecurityStatusRequest,
    TradingSessionStatus,
    TradingSessionStatusRequest,
    MassQuote,
    MassQuoteAck,
    QuoteRequest,
    Quote,
    BusinessMessageReject,
    CollateralReport,
    CollateralInquiry,
}

impl FixMsgType {
    pub fn tag_value(&self) -> &str {
        match self {
            Self::Heartbeat => "0",
            Self::Logon => "A",
            Self::Logout => "5",
            Self::NewOrderSingle => "D",
            Self::OrderCancelRequest => "F",
            Self::OrderCancelReplaceRequest => "G",
            Self::ExecutionReport => "8",
            Self::OrderCancelReject => "9",
            Self::MarketDataRequest => "V",
            Self::MarketDataSnapshotFullRefresh => "W",
            Self::MarketDataIncrementalRefresh => "X",
            Self::SecurityList => "y",
            Self::SecurityListRequest => "x",
            Self::PositionReport => "AP",
            Self::TradeCaptureReport => "AE",
            Self::TradeCaptureReportRequest => "AD",
            Self::SecurityStatus => "f",
            Self::SecurityStatusRequest => "e",
            Self::TradingSessionStatus => "h",
            Self::TradingSessionStatusRequest => "g",
            Self::MassQuote => "i",
            Self::MassQuoteAck => "b",
            Self::QuoteRequest => "R",
            Self::Quote => "S",
            Self::BusinessMessageReject => "j",
            Self::CollateralReport => "BA",
            Self::CollateralInquiry => "BB",
        }
    }
}

// ─── Market Data ─────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MarketDepth {
    pub symbol: String,
    pub bids: Vec<PriceLevel>,
    pub asks: Vec<PriceLevel>,
    pub last_price: Price,
    pub last_quantity: Qty,
    pub volume_24h: Qty,
    pub high_24h: Price,
    pub low_24h: Price,
    pub open_price: Price,
    pub settlement_price: Price,
    pub open_interest: Qty,
    pub timestamp: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PriceLevel {
    pub price: OrderedFloat<f64>,
    pub quantity: Qty,
    pub order_count: u32,
}

// ─── HA Types ────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum NodeRole {
    Primary,
    Standby,
    Candidate,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NodeState {
    pub node_id: String,
    pub role: NodeRole,
    pub last_sequence: u64,
    pub last_heartbeat: DateTime<Utc>,
    pub healthy: bool,
}

// ─── API Request/Response ────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize)]
pub struct NewOrderRequest {
    pub client_order_id: String,
    pub account_id: String,
    pub symbol: String,
    pub side: Side,
    pub order_type: OrderType,
    #[serde(default = "default_tif")]
    pub time_in_force: TimeInForce,
    pub price: Option<f64>,
    pub stop_price: Option<f64>,
    pub quantity: f64,
}

fn default_tif() -> TimeInForce {
    TimeInForce::Day
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CancelOrderRequest {
    pub order_id: String,
    pub account_id: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ApiResponse<T: Serialize> {
    pub success: bool,
    pub data: Option<T>,
    pub error: Option<String>,
    pub timestamp: DateTime<Utc>,
}

impl<T: Serialize> ApiResponse<T> {
    pub fn ok(data: T) -> Self {
        Self {
            success: true,
            data: Some(data),
            error: None,
            timestamp: Utc::now(),
        }
    }

    pub fn err(msg: impl Into<String>) -> Self {
        Self {
            success: false,
            data: None,
            error: Some(msg.into()),
            timestamp: Utc::now(),
        }
    }
}
