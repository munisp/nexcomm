//! Fee Engine & Revenue Management Module
//!
//! Implements all 10 monetization approaches for the NEXCOM Exchange:
//! 1. Transaction Fees (maker-taker model with volume tiers)
//! 2. Listing Fees (instrument listing + annual maintenance)
//! 3. Market Data Fees (Level 1/2 subscriptions)
//! 4. Clearing & Settlement Fees (per-trade + margin interest)
//! 5. Technology & Connectivity Fees (co-location, API tiers, DMA)
//! 6. Membership & Access Fees (broker/dealer, market maker, trading seat)
//! 7. Digital Asset / Tokenization Fees (minting, fractional trading, IPFS)
//! 8. Investor Protection Fund Contributions (mandatory member contributions)
//! 9. Value-Added Services (surveillance-as-a-service, analytics, index licensing)
//! 10. Data Analytics & Insights (premium dashboards, AI forecasting, custom reports)

#![allow(dead_code)]

use chrono::{DateTime, Utc};
use dashmap::DashMap;
use parking_lot::RwLock;
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicU64, Ordering};
use uuid::Uuid;

use crate::types::{from_price, to_price, Price, Qty, Side, PRICE_SCALE};

// ─── Fee Schedule / Tier Definitions ─────────────────────────────────────────

/// Maker-taker fee model with volume-based tiers.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FeeTier {
    pub tier_name: String,
    /// Minimum 30-day volume (in lots) to qualify for this tier.
    pub min_monthly_volume: u64,
    /// Fee per contract for liquidity takers (in basis points).
    pub taker_fee_bps: f64,
    /// Fee per contract for liquidity makers (negative = rebate).
    pub maker_fee_bps: f64,
    /// Clearing fee per contract (basis points).
    pub clearing_fee_bps: f64,
}

/// Fee schedule for all instrument types.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FeeSchedule {
    pub id: String,
    pub name: String,
    pub description: String,
    pub tiers: Vec<FeeTier>,
    pub effective_from: DateTime<Utc>,
    pub effective_until: Option<DateTime<Utc>>,
}

impl FeeSchedule {
    /// Get the applicable tier for a given monthly volume.
    pub fn tier_for_volume(&self, monthly_volume: u64) -> &FeeTier {
        self.tiers
            .iter()
            .rev()
            .find(|t| monthly_volume >= t.min_monthly_volume)
            .unwrap_or(&self.tiers[0])
    }
}

// ─── Fee Types ───────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum FeeCategory {
    Transaction,
    Clearing,
    Listing,
    MarketData,
    Technology,
    Membership,
    Tokenization,
    InvestorProtection,
    ValueAddedService,
    Analytics,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum FeeType {
    // Transaction fees
    TakerFee,
    MakerRebate,
    // Clearing fees
    ClearingFee,
    SettlementFee,
    MarginInterest,
    NettingFee,
    // Listing fees
    InitialListingFee,
    AnnualMaintenanceFee,
    NewProductLaunchFee,
    // Market data fees
    Level1Subscription,
    Level2Subscription,
    ConsolidatedTapeLicense,
    HistoricalDataAccess,
    RealtimeApiFee,
    // Technology fees
    CoLocationFee,
    FixGatewayAccess,
    ApiRateLimitTier,
    DirectMarketAccess,
    // Membership fees
    BrokerDealerMembership,
    MarketMakerRegistration,
    TradingSeatLicense,
    KycProcessingFee,
    // Tokenization fees
    TokenMintingFee,
    FractionalTradingFee,
    IpfsStorageFee,
    SmartContractDeployFee,
    SecondaryMarketFee,
    // IPF contributions
    IpfContribution,
    IpfAssessment,
    // Value-added services
    SurveillanceAsAService,
    RiskAnalytics,
    CorporateActionsProcessing,
    IndexLicensing,
    // Analytics
    PremiumDashboard,
    AiForecastingApi,
    GeospatialTracking,
    CustomReporting,
}

// ─── Fee Charge Record ───────────────────────────────────────────────────────

/// A single fee charge or rebate applied to an account.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FeeCharge {
    pub id: Uuid,
    pub account_id: String,
    pub category: FeeCategory,
    pub fee_type: FeeType,
    pub amount: Price,
    pub currency: String,
    pub reference_id: Option<String>,
    pub description: String,
    pub timestamp: DateTime<Utc>,
    pub settled: bool,
}

// ─── Subscription / Membership ───────────────────────────────────────────────

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum SubscriptionStatus {
    Active,
    Suspended,
    Expired,
    Cancelled,
    PendingPayment,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum BillingCycle {
    Monthly,
    Quarterly,
    Annual,
}

/// A subscription to a service (market data, analytics, co-location, etc.)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Subscription {
    pub id: Uuid,
    pub account_id: String,
    pub service_name: String,
    pub fee_type: FeeType,
    pub amount_per_cycle: Price,
    pub billing_cycle: BillingCycle,
    pub status: SubscriptionStatus,
    pub started_at: DateTime<Utc>,
    pub next_billing: DateTime<Utc>,
    pub expires_at: Option<DateTime<Utc>>,
}

/// Membership record for brokers/dealers/market makers.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Membership {
    pub id: Uuid,
    pub account_id: String,
    pub membership_type: FeeType,
    pub tier: String,
    pub annual_fee: Price,
    pub status: SubscriptionStatus,
    pub joined_at: DateTime<Utc>,
    pub valid_until: DateTime<Utc>,
}

// ─── Revenue Tracking ────────────────────────────────────────────────────────

/// Aggregated revenue for a time period by category.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RevenueSummary {
    pub period: String,
    pub category: FeeCategory,
    pub total_charges: u64,
    pub total_amount: Price,
    pub total_rebates: Price,
    pub net_revenue: Price,
}

/// Invoice for billing a member/participant.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Invoice {
    pub id: Uuid,
    pub account_id: String,
    pub period: String,
    pub line_items: Vec<InvoiceLineItem>,
    pub subtotal: Price,
    pub tax: Price,
    pub total: Price,
    pub currency: String,
    pub status: InvoiceStatus,
    pub issued_at: DateTime<Utc>,
    pub due_at: DateTime<Utc>,
    pub paid_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InvoiceLineItem {
    pub description: String,
    pub fee_type: FeeType,
    pub quantity: u64,
    pub unit_price: Price,
    pub total: Price,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum InvoiceStatus {
    Draft,
    Issued,
    Paid,
    Overdue,
    Cancelled,
}

// ─── API Rate Limit Tier ─────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApiTier {
    pub name: String,
    pub requests_per_second: u32,
    pub monthly_fee: Price,
    pub features: Vec<String>,
}

// ─── Fee Engine ──────────────────────────────────────────────────────────────

/// The main fee engine that calculates and tracks all exchange fees.
pub struct FeeEngine {
    /// Fee schedules by instrument category.
    schedules: DashMap<String, FeeSchedule>,
    /// All fee charges.
    charges: RwLock<Vec<FeeCharge>>,
    /// Active subscriptions.
    subscriptions: DashMap<Uuid, Subscription>,
    /// Active memberships.
    memberships: DashMap<Uuid, Membership>,
    /// Monthly volume per account (for tier calculation).
    monthly_volumes: DashMap<String, u64>,
    /// Invoices.
    invoices: RwLock<Vec<Invoice>>,
    /// API rate limit tiers.
    api_tiers: Vec<ApiTier>,
    /// Revenue counters by category.
    revenue_counters: DashMap<String, AtomicU64>,
    /// Total revenue collected (atomic for thread safety).
    total_revenue: AtomicU64,
    /// Total rebates paid.
    total_rebates: AtomicU64,
}

impl FeeEngine {
    pub fn new() -> Self {
        let engine = Self {
            schedules: DashMap::new(),
            charges: RwLock::new(Vec::new()),
            subscriptions: DashMap::new(),
            memberships: DashMap::new(),
            monthly_volumes: DashMap::new(),
            invoices: RwLock::new(Vec::new()),
            api_tiers: Self::default_api_tiers(),
            revenue_counters: DashMap::new(),
            total_revenue: AtomicU64::new(0),
            total_rebates: AtomicU64::new(0),
        };
        engine.register_default_schedules();
        engine.register_default_memberships();
        engine.register_default_subscriptions();
        engine
    }

    // ── Default Fee Schedules ────────────────────────────────────────────

    fn register_default_schedules(&self) {
        // Commodity Futures fee schedule
        self.schedules.insert(
            "COMMODITY_FUTURES".to_string(),
            FeeSchedule {
                id: "FS-001".to_string(),
                name: "Commodity Futures".to_string(),
                description: "Fee schedule for commodity futures contracts".to_string(),
                tiers: vec![
                    FeeTier {
                        tier_name: "Retail".to_string(),
                        min_monthly_volume: 0,
                        taker_fee_bps: 3.5,
                        maker_fee_bps: -1.5,
                        clearing_fee_bps: 1.0,
                    },
                    FeeTier {
                        tier_name: "Active Trader".to_string(),
                        min_monthly_volume: 1_000,
                        taker_fee_bps: 2.5,
                        maker_fee_bps: -2.0,
                        clearing_fee_bps: 0.8,
                    },
                    FeeTier {
                        tier_name: "Professional".to_string(),
                        min_monthly_volume: 10_000,
                        taker_fee_bps: 1.8,
                        maker_fee_bps: -2.5,
                        clearing_fee_bps: 0.6,
                    },
                    FeeTier {
                        tier_name: "Institutional".to_string(),
                        min_monthly_volume: 100_000,
                        taker_fee_bps: 1.2,
                        maker_fee_bps: -3.0,
                        clearing_fee_bps: 0.4,
                    },
                    FeeTier {
                        tier_name: "Market Maker".to_string(),
                        min_monthly_volume: 500_000,
                        taker_fee_bps: 0.8,
                        maker_fee_bps: -3.5,
                        clearing_fee_bps: 0.2,
                    },
                ],
                effective_from: Utc::now(),
                effective_until: None,
            },
        );

        // Options fee schedule
        self.schedules.insert(
            "OPTIONS".to_string(),
            FeeSchedule {
                id: "FS-002".to_string(),
                name: "Commodity Options".to_string(),
                description: "Fee schedule for commodity options contracts".to_string(),
                tiers: vec![
                    FeeTier {
                        tier_name: "Retail".to_string(),
                        min_monthly_volume: 0,
                        taker_fee_bps: 5.0,
                        maker_fee_bps: -1.0,
                        clearing_fee_bps: 1.5,
                    },
                    FeeTier {
                        tier_name: "Professional".to_string(),
                        min_monthly_volume: 5_000,
                        taker_fee_bps: 3.0,
                        maker_fee_bps: -2.0,
                        clearing_fee_bps: 1.0,
                    },
                    FeeTier {
                        tier_name: "Market Maker".to_string(),
                        min_monthly_volume: 50_000,
                        taker_fee_bps: 1.5,
                        maker_fee_bps: -3.0,
                        clearing_fee_bps: 0.5,
                    },
                ],
                effective_from: Utc::now(),
                effective_until: None,
            },
        );

        // Digital Assets fee schedule
        self.schedules.insert(
            "DIGITAL_ASSETS".to_string(),
            FeeSchedule {
                id: "FS-003".to_string(),
                name: "Digital Assets & Tokenized Commodities".to_string(),
                description: "Fee schedule for tokenized commodity trading".to_string(),
                tiers: vec![
                    FeeTier {
                        tier_name: "Standard".to_string(),
                        min_monthly_volume: 0,
                        taker_fee_bps: 10.0,
                        maker_fee_bps: 5.0,
                        clearing_fee_bps: 2.0,
                    },
                    FeeTier {
                        tier_name: "Premium".to_string(),
                        min_monthly_volume: 1_000,
                        taker_fee_bps: 7.0,
                        maker_fee_bps: 3.0,
                        clearing_fee_bps: 1.5,
                    },
                    FeeTier {
                        tier_name: "VIP".to_string(),
                        min_monthly_volume: 10_000,
                        taker_fee_bps: 5.0,
                        maker_fee_bps: 1.0,
                        clearing_fee_bps: 1.0,
                    },
                ],
                effective_from: Utc::now(),
                effective_until: None,
            },
        );
    }

    fn register_default_memberships(&self) {
        // Default broker membership
        let broker_mem = Membership {
            id: Uuid::new_v4(),
            account_id: "NEXCOM-BROKER-001".to_string(),
            membership_type: FeeType::BrokerDealerMembership,
            tier: "Full Service".to_string(),
            annual_fee: to_price(50_000.0),
            status: SubscriptionStatus::Active,
            joined_at: Utc::now(),
            valid_until: Utc::now() + chrono::Duration::days(365),
        };
        self.memberships.insert(broker_mem.id, broker_mem);

        // Default market maker membership
        let mm_mem = Membership {
            id: Uuid::new_v4(),
            account_id: "NEXCOM-MM-001".to_string(),
            membership_type: FeeType::MarketMakerRegistration,
            tier: "Primary".to_string(),
            annual_fee: to_price(100_000.0),
            status: SubscriptionStatus::Active,
            joined_at: Utc::now(),
            valid_until: Utc::now() + chrono::Duration::days(365),
        };
        self.memberships.insert(mm_mem.id, mm_mem);

        // Trading seat license
        let seat = Membership {
            id: Uuid::new_v4(),
            account_id: "NEXCOM-SEAT-001".to_string(),
            membership_type: FeeType::TradingSeatLicense,
            tier: "Standard".to_string(),
            annual_fee: to_price(25_000.0),
            status: SubscriptionStatus::Active,
            joined_at: Utc::now(),
            valid_until: Utc::now() + chrono::Duration::days(365),
        };
        self.memberships.insert(seat.id, seat);
    }

    fn register_default_subscriptions(&self) {
        // Market data Level 1 subscription
        let l1_sub = Subscription {
            id: Uuid::new_v4(),
            account_id: "NEXCOM-DATA-001".to_string(),
            service_name: "Market Data Level 1 (Top of Book)".to_string(),
            fee_type: FeeType::Level1Subscription,
            amount_per_cycle: to_price(500.0),
            billing_cycle: BillingCycle::Monthly,
            status: SubscriptionStatus::Active,
            started_at: Utc::now(),
            next_billing: Utc::now() + chrono::Duration::days(30),
            expires_at: None,
        };
        self.subscriptions.insert(l1_sub.id, l1_sub);

        // Market data Level 2 subscription
        let l2_sub = Subscription {
            id: Uuid::new_v4(),
            account_id: "NEXCOM-DATA-002".to_string(),
            service_name: "Market Data Level 2 (Full Depth)".to_string(),
            fee_type: FeeType::Level2Subscription,
            amount_per_cycle: to_price(2_000.0),
            billing_cycle: BillingCycle::Monthly,
            status: SubscriptionStatus::Active,
            started_at: Utc::now(),
            next_billing: Utc::now() + chrono::Duration::days(30),
            expires_at: None,
        };
        self.subscriptions.insert(l2_sub.id, l2_sub);

        // Co-location subscription
        let colo_sub = Subscription {
            id: Uuid::new_v4(),
            account_id: "NEXCOM-COLO-001".to_string(),
            service_name: "Co-Location (Rack Space near Matching Engine)".to_string(),
            fee_type: FeeType::CoLocationFee,
            amount_per_cycle: to_price(10_000.0),
            billing_cycle: BillingCycle::Monthly,
            status: SubscriptionStatus::Active,
            started_at: Utc::now(),
            next_billing: Utc::now() + chrono::Duration::days(30),
            expires_at: None,
        };
        self.subscriptions.insert(colo_sub.id, colo_sub);

        // Premium analytics subscription
        let analytics_sub = Subscription {
            id: Uuid::new_v4(),
            account_id: "NEXCOM-ANALYTICS-001".to_string(),
            service_name: "Premium Analytics Dashboard".to_string(),
            fee_type: FeeType::PremiumDashboard,
            amount_per_cycle: to_price(5_000.0),
            billing_cycle: BillingCycle::Monthly,
            status: SubscriptionStatus::Active,
            started_at: Utc::now(),
            next_billing: Utc::now() + chrono::Duration::days(30),
            expires_at: None,
        };
        self.subscriptions.insert(analytics_sub.id, analytics_sub);

        // Surveillance-as-a-service subscription
        let surv_sub = Subscription {
            id: Uuid::new_v4(),
            account_id: "NEXCOM-SURV-001".to_string(),
            service_name: "Surveillance-as-a-Service".to_string(),
            fee_type: FeeType::SurveillanceAsAService,
            amount_per_cycle: to_price(15_000.0),
            billing_cycle: BillingCycle::Monthly,
            status: SubscriptionStatus::Active,
            started_at: Utc::now(),
            next_billing: Utc::now() + chrono::Duration::days(30),
            expires_at: None,
        };
        self.subscriptions.insert(surv_sub.id, surv_sub);

        // Index licensing
        let idx_sub = Subscription {
            id: Uuid::new_v4(),
            account_id: "NEXCOM-IDX-001".to_string(),
            service_name: "NXCI Index Licensing".to_string(),
            fee_type: FeeType::IndexLicensing,
            amount_per_cycle: to_price(25_000.0),
            billing_cycle: BillingCycle::Quarterly,
            status: SubscriptionStatus::Active,
            started_at: Utc::now(),
            next_billing: Utc::now() + chrono::Duration::days(90),
            expires_at: None,
        };
        self.subscriptions.insert(idx_sub.id, idx_sub);
    }

    fn default_api_tiers() -> Vec<ApiTier> {
        vec![
            ApiTier {
                name: "Free".to_string(),
                requests_per_second: 5,
                monthly_fee: 0,
                features: vec![
                    "Market data snapshots".to_string(),
                    "Basic order submission".to_string(),
                    "Account balance queries".to_string(),
                ],
            },
            ApiTier {
                name: "Basic".to_string(),
                requests_per_second: 50,
                monthly_fee: to_price(100.0),
                features: vec![
                    "All Free features".to_string(),
                    "WebSocket streaming".to_string(),
                    "Order history".to_string(),
                    "Position tracking".to_string(),
                ],
            },
            ApiTier {
                name: "Professional".to_string(),
                requests_per_second: 500,
                monthly_fee: to_price(1_000.0),
                features: vec![
                    "All Basic features".to_string(),
                    "Level 2 market data".to_string(),
                    "Algorithmic trading support".to_string(),
                    "Priority order routing".to_string(),
                    "FIX protocol access".to_string(),
                ],
            },
            ApiTier {
                name: "Enterprise".to_string(),
                requests_per_second: 5_000,
                monthly_fee: to_price(10_000.0),
                features: vec![
                    "All Professional features".to_string(),
                    "Co-location access".to_string(),
                    "Dedicated support".to_string(),
                    "Custom integrations".to_string(),
                    "SLA guarantees".to_string(),
                    "Direct market access".to_string(),
                ],
            },
        ]
    }

    // ── Transaction Fee Calculation ──────────────────────────────────────

    /// Calculate and record fees for a trade.
    /// Returns (taker_fee, maker_rebate, clearing_fee) as Price values.
    pub fn calculate_trade_fees(
        &self,
        trade_value: Price,
        taker_account: &str,
        maker_account: &str,
        symbol: &str,
        _side: Side,
    ) -> (FeeCharge, FeeCharge, FeeCharge) {
        // Determine schedule based on symbol prefix
        let schedule_key = if symbol.starts_with("TOK-") || symbol.starts_with("FRAC-") {
            "DIGITAL_ASSETS"
        } else if symbol.contains("-OPT-") {
            "OPTIONS"
        } else {
            "COMMODITY_FUTURES"
        };

        let schedule = self
            .schedules
            .get(schedule_key)
            .expect("Fee schedule not found");

        // Get taker's monthly volume for tier
        let taker_volume = self
            .monthly_volumes
            .get(taker_account)
            .map(|v| *v)
            .unwrap_or(0);
        let tier = schedule.tier_for_volume(taker_volume);

        let trade_val_f64 = from_price(trade_value);

        // Calculate fees
        let taker_fee_amount = to_price(trade_val_f64 * tier.taker_fee_bps / 10_000.0);
        let maker_rebate_amount = to_price(trade_val_f64 * tier.maker_fee_bps.abs() / 10_000.0);
        let clearing_fee_amount = to_price(trade_val_f64 * tier.clearing_fee_bps / 10_000.0);

        let ref_id = Uuid::new_v4().to_string();

        let taker_charge = FeeCharge {
            id: Uuid::new_v4(),
            account_id: taker_account.to_string(),
            category: FeeCategory::Transaction,
            fee_type: FeeType::TakerFee,
            amount: taker_fee_amount,
            currency: "NGN".to_string(),
            reference_id: Some(ref_id.clone()),
            description: format!(
                "Taker fee on {} @ {} bps ({})",
                symbol, tier.taker_fee_bps, tier.tier_name
            ),
            timestamp: Utc::now(),
            settled: false,
        };

        let maker_charge = FeeCharge {
            id: Uuid::new_v4(),
            account_id: maker_account.to_string(),
            category: FeeCategory::Transaction,
            fee_type: FeeType::MakerRebate,
            amount: -maker_rebate_amount, // negative = rebate
            currency: "NGN".to_string(),
            reference_id: Some(ref_id.clone()),
            description: format!(
                "Maker rebate on {} @ {} bps ({})",
                symbol,
                tier.maker_fee_bps.abs(),
                tier.tier_name
            ),
            timestamp: Utc::now(),
            settled: false,
        };

        let clearing_charge = FeeCharge {
            id: Uuid::new_v4(),
            account_id: taker_account.to_string(),
            category: FeeCategory::Clearing,
            fee_type: FeeType::ClearingFee,
            amount: clearing_fee_amount,
            currency: "NGN".to_string(),
            reference_id: Some(ref_id),
            description: format!(
                "Clearing fee on {} @ {} bps",
                symbol, tier.clearing_fee_bps
            ),
            timestamp: Utc::now(),
            settled: false,
        };

        // Record charges
        {
            let mut charges = self.charges.write();
            charges.push(taker_charge.clone());
            charges.push(maker_charge.clone());
            charges.push(clearing_charge.clone());
        }

        // Update revenue counters
        if taker_fee_amount > 0 {
            self.total_revenue
                .fetch_add(taker_fee_amount as u64, Ordering::Relaxed);
        }
        if maker_rebate_amount > 0 {
            self.total_rebates
                .fetch_add(maker_rebate_amount as u64, Ordering::Relaxed);
        }
        if clearing_fee_amount > 0 {
            self.total_revenue
                .fetch_add(clearing_fee_amount as u64, Ordering::Relaxed);
        }

        // Update volume tracking
        self.monthly_volumes
            .entry(taker_account.to_string())
            .and_modify(|v| *v += 1)
            .or_insert(1);
        self.monthly_volumes
            .entry(maker_account.to_string())
            .and_modify(|v| *v += 1)
            .or_insert(1);

        (taker_charge, maker_charge, clearing_charge)
    }

    // ── Listing Fees ─────────────────────────────────────────────────────

    /// Charge a listing fee for a new instrument.
    pub fn charge_listing_fee(
        &self,
        account_id: &str,
        instrument_symbol: &str,
        fee_type: FeeType,
    ) -> FeeCharge {
        let amount = match fee_type {
            FeeType::InitialListingFee => to_price(25_000.0),
            FeeType::AnnualMaintenanceFee => to_price(10_000.0),
            FeeType::NewProductLaunchFee => to_price(50_000.0),
            _ => to_price(5_000.0),
        };

        let charge = FeeCharge {
            id: Uuid::new_v4(),
            account_id: account_id.to_string(),
            category: FeeCategory::Listing,
            fee_type,
            amount,
            currency: "NGN".to_string(),
            reference_id: Some(instrument_symbol.to_string()),
            description: format!("Listing fee for {} ({:?})", instrument_symbol, fee_type),
            timestamp: Utc::now(),
            settled: false,
        };

        self.charges.write().push(charge.clone());
        self.total_revenue
            .fetch_add(amount as u64, Ordering::Relaxed);
        charge
    }

    // ── Tokenization Fees ────────────────────────────────────────────────

    /// Charge a tokenization-related fee.
    pub fn charge_tokenization_fee(
        &self,
        account_id: &str,
        fee_type: FeeType,
        asset_description: &str,
    ) -> FeeCharge {
        let amount = match fee_type {
            FeeType::TokenMintingFee => to_price(500.0),
            FeeType::FractionalTradingFee => to_price(50.0),
            FeeType::IpfsStorageFee => to_price(10.0),
            FeeType::SmartContractDeployFee => to_price(1_000.0),
            FeeType::SecondaryMarketFee => to_price(25.0),
            _ => to_price(100.0),
        };

        let charge = FeeCharge {
            id: Uuid::new_v4(),
            account_id: account_id.to_string(),
            category: FeeCategory::Tokenization,
            fee_type,
            amount,
            currency: "NGN".to_string(),
            reference_id: Some(asset_description.to_string()),
            description: format!("{:?} for {}", fee_type, asset_description),
            timestamp: Utc::now(),
            settled: false,
        };

        self.charges.write().push(charge.clone());
        self.total_revenue
            .fetch_add(amount as u64, Ordering::Relaxed);
        charge
    }

    // ── Subscription Management ──────────────────────────────────────────

    /// Create a new subscription.
    pub fn create_subscription(
        &self,
        account_id: &str,
        service_name: &str,
        fee_type: FeeType,
        amount: Price,
        billing_cycle: BillingCycle,
    ) -> Subscription {
        let cycle_days = match billing_cycle {
            BillingCycle::Monthly => 30,
            BillingCycle::Quarterly => 90,
            BillingCycle::Annual => 365,
        };

        let sub = Subscription {
            id: Uuid::new_v4(),
            account_id: account_id.to_string(),
            service_name: service_name.to_string(),
            fee_type,
            amount_per_cycle: amount,
            billing_cycle,
            status: SubscriptionStatus::Active,
            started_at: Utc::now(),
            next_billing: Utc::now() + chrono::Duration::days(cycle_days),
            expires_at: None,
        };
        self.subscriptions.insert(sub.id, sub.clone());
        sub
    }

    /// List all active subscriptions.
    pub fn active_subscriptions(&self) -> Vec<Subscription> {
        self.subscriptions
            .iter()
            .filter(|s| s.status == SubscriptionStatus::Active)
            .map(|s| s.clone())
            .collect()
    }

    /// List subscriptions for an account.
    pub fn account_subscriptions(&self, account_id: &str) -> Vec<Subscription> {
        self.subscriptions
            .iter()
            .filter(|s| s.account_id == account_id)
            .map(|s| s.clone())
            .collect()
    }

    // ── Membership Management ────────────────────────────────────────────

    /// Register a new membership.
    pub fn register_membership(
        &self,
        account_id: &str,
        membership_type: FeeType,
        tier: &str,
        annual_fee: Price,
    ) -> Membership {
        let mem = Membership {
            id: Uuid::new_v4(),
            account_id: account_id.to_string(),
            membership_type,
            tier: tier.to_string(),
            annual_fee,
            status: SubscriptionStatus::Active,
            joined_at: Utc::now(),
            valid_until: Utc::now() + chrono::Duration::days(365),
        };
        self.memberships.insert(mem.id, mem.clone());

        // Charge membership fee
        let charge = FeeCharge {
            id: Uuid::new_v4(),
            account_id: account_id.to_string(),
            category: FeeCategory::Membership,
            fee_type: membership_type,
            amount: annual_fee,
            currency: "NGN".to_string(),
            reference_id: Some(mem.id.to_string()),
            description: format!("{:?} ({}) - Annual fee", membership_type, tier),
            timestamp: Utc::now(),
            settled: false,
        };
        self.charges.write().push(charge);
        self.total_revenue
            .fetch_add(annual_fee as u64, Ordering::Relaxed);

        mem
    }

    /// List all active memberships.
    pub fn active_memberships(&self) -> Vec<Membership> {
        self.memberships
            .iter()
            .filter(|m| m.status == SubscriptionStatus::Active)
            .map(|m| m.clone())
            .collect()
    }

    // ── Invoice Generation ───────────────────────────────────────────────

    /// Generate an invoice for an account covering a billing period.
    pub fn generate_invoice(&self, account_id: &str, period: &str) -> Invoice {
        let charges = self.charges.read();
        let account_charges: Vec<&FeeCharge> = charges
            .iter()
            .filter(|c| c.account_id == account_id && !c.settled)
            .collect();

        // Group by fee type
        let mut line_items: Vec<InvoiceLineItem> = Vec::new();
        let mut by_type: std::collections::HashMap<FeeType, (u64, Price)> =
            std::collections::HashMap::new();

        for charge in &account_charges {
            let entry = by_type.entry(charge.fee_type).or_insert((0, 0));
            entry.0 += 1;
            entry.1 += charge.amount;
        }

        for (fee_type, (count, total)) in &by_type {
            line_items.push(InvoiceLineItem {
                description: format!("{:?}", fee_type),
                fee_type: *fee_type,
                quantity: *count,
                unit_price: if *count > 0 {
                    total / *count as i64
                } else {
                    0
                },
                total: *total,
            });
        }

        let subtotal: Price = line_items.iter().map(|li| li.total).sum();
        let tax = to_price(from_price(subtotal) * 0.075); // 7.5% VAT (Nigeria)
        let total = subtotal + tax;

        let invoice = Invoice {
            id: Uuid::new_v4(),
            account_id: account_id.to_string(),
            period: period.to_string(),
            line_items,
            subtotal,
            tax,
            total,
            currency: "NGN".to_string(),
            status: InvoiceStatus::Issued,
            issued_at: Utc::now(),
            due_at: Utc::now() + chrono::Duration::days(30),
            paid_at: None,
        };
        self.invoices.write().push(invoice.clone());
        invoice
    }

    /// List all invoices.
    pub fn all_invoices(&self) -> Vec<Invoice> {
        self.invoices.read().clone()
    }

    /// List invoices for an account.
    pub fn account_invoices(&self, account_id: &str) -> Vec<Invoice> {
        self.invoices
            .read()
            .iter()
            .filter(|i| i.account_id == account_id)
            .cloned()
            .collect()
    }

    // ── Revenue Reporting ────────────────────────────────────────────────

    /// Get comprehensive revenue summary.
    pub fn revenue_summary(&self) -> serde_json::Value {
        let charges = self.charges.read();
        let total_charges = charges.len();

        // Revenue by category
        let mut by_category: std::collections::HashMap<FeeCategory, (u64, Price, Price)> =
            std::collections::HashMap::new();

        for charge in charges.iter() {
            let entry = by_category
                .entry(charge.category)
                .or_insert((0, 0, 0));
            entry.0 += 1;
            if charge.amount >= 0 {
                entry.1 += charge.amount; // revenue
            } else {
                entry.2 += charge.amount.abs(); // rebates
            }
        }

        let category_breakdown: Vec<serde_json::Value> = by_category
            .iter()
            .map(|(cat, (count, revenue, rebates))| {
                serde_json::json!({
                    "category": cat,
                    "charge_count": count,
                    "gross_revenue": from_price(*revenue),
                    "rebates": from_price(*rebates),
                    "net_revenue": from_price(*revenue - *rebates),
                })
            })
            .collect();

        let total_rev = self.total_revenue.load(Ordering::Relaxed) as f64 / PRICE_SCALE as f64;
        let total_reb = self.total_rebates.load(Ordering::Relaxed) as f64 / PRICE_SCALE as f64;

        // Subscription revenue (monthly recurring)
        let mrr: f64 = self
            .subscriptions
            .iter()
            .filter(|s| s.status == SubscriptionStatus::Active)
            .map(|s| {
                let per_month = match s.billing_cycle {
                    BillingCycle::Monthly => from_price(s.amount_per_cycle),
                    BillingCycle::Quarterly => from_price(s.amount_per_cycle) / 3.0,
                    BillingCycle::Annual => from_price(s.amount_per_cycle) / 12.0,
                };
                per_month
            })
            .sum();

        // Membership revenue (annual)
        let arr: f64 = self
            .memberships
            .iter()
            .filter(|m| m.status == SubscriptionStatus::Active)
            .map(|m| from_price(m.annual_fee))
            .sum();

        serde_json::json!({
            "total_charges": total_charges,
            "total_revenue": total_rev,
            "total_rebates": total_reb,
            "net_revenue": total_rev - total_reb,
            "monthly_recurring_revenue": mrr,
            "annual_recurring_revenue": arr,
            "active_subscriptions": self.subscriptions.iter().filter(|s| s.status == SubscriptionStatus::Active).count(),
            "active_memberships": self.memberships.iter().filter(|m| m.status == SubscriptionStatus::Active).count(),
            "outstanding_invoices": self.invoices.read().iter().filter(|i| i.status == InvoiceStatus::Issued).count(),
            "revenue_by_category": category_breakdown,
            "currency": "NGN",
        })
    }

    /// Get fee schedule for a given instrument type.
    pub fn get_schedule(&self, schedule_key: &str) -> Option<FeeSchedule> {
        self.schedules.get(schedule_key).map(|s| s.clone())
    }

    /// List all fee schedules.
    pub fn all_schedules(&self) -> Vec<FeeSchedule> {
        self.schedules.iter().map(|s| s.clone()).collect()
    }

    /// Get API rate limit tiers.
    pub fn api_tiers(&self) -> &[ApiTier] {
        &self.api_tiers
    }

    /// Get all charges for an account.
    pub fn account_charges(&self, account_id: &str) -> Vec<FeeCharge> {
        self.charges
            .read()
            .iter()
            .filter(|c| c.account_id == account_id)
            .cloned()
            .collect()
    }

    /// Get recent charges (last N).
    pub fn recent_charges(&self, count: usize) -> Vec<FeeCharge> {
        let charges = self.charges.read();
        charges.iter().rev().take(count).cloned().collect()
    }

    /// Get comprehensive fee engine status.
    pub fn status(&self) -> serde_json::Value {
        let total_rev = self.total_revenue.load(Ordering::Relaxed) as f64 / PRICE_SCALE as f64;
        let total_reb = self.total_rebates.load(Ordering::Relaxed) as f64 / PRICE_SCALE as f64;

        serde_json::json!({
            "fee_schedules": self.schedules.len(),
            "active_subscriptions": self.subscriptions.iter().filter(|s| s.status == SubscriptionStatus::Active).count(),
            "active_memberships": self.memberships.iter().filter(|m| m.status == SubscriptionStatus::Active).count(),
            "total_charges": self.charges.read().len(),
            "total_revenue": total_rev,
            "total_rebates": total_reb,
            "net_revenue": total_rev - total_reb,
            "api_tiers": self.api_tiers.len(),
            "invoices_issued": self.invoices.read().len(),
        })
    }
}

impl Default for FeeEngine {
    fn default() -> Self {
        Self::new()
    }
}

// ─── Tests ───────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_fee_engine_initialization() {
        let engine = FeeEngine::new();
        assert_eq!(engine.schedules.len(), 3);
        assert!(engine.active_memberships().len() >= 3);
        assert!(engine.active_subscriptions().len() >= 5);
        assert_eq!(engine.api_tiers().len(), 4);
    }

    #[test]
    fn test_trade_fee_calculation() {
        let engine = FeeEngine::new();
        let trade_value = to_price(100_000.0); // 100K trade

        let (taker, maker, clearing) = engine.calculate_trade_fees(
            trade_value,
            "TAKER-001",
            "MAKER-001",
            "GOLD-FUT-2026M06",
            Side::Buy,
        );

        // Retail tier: 3.5 bps taker, -1.5 bps maker rebate, 1.0 bps clearing
        assert!(taker.amount > 0, "Taker fee should be positive");
        assert!(maker.amount < 0, "Maker rebate should be negative");
        assert!(clearing.amount > 0, "Clearing fee should be positive");

        // 100K * 3.5 / 10000 = 35
        assert_eq!(from_price(taker.amount), 35.0);
        // 100K * 1.5 / 10000 = 15 (rebate, so negative)
        assert_eq!(from_price(maker.amount), -15.0);
        // 100K * 1.0 / 10000 = 10
        assert_eq!(from_price(clearing.amount), 10.0);
    }

    #[test]
    fn test_digital_asset_fees() {
        let engine = FeeEngine::new();
        let trade_value = to_price(10_000.0);

        let (taker, _maker, _clearing) = engine.calculate_trade_fees(
            trade_value,
            "TAKER-001",
            "MAKER-001",
            "TOK-GOLD-001",
            Side::Buy,
        );

        // Digital assets tier: 10 bps taker
        // 10K * 10 / 10000 = 10
        assert_eq!(from_price(taker.amount), 10.0);
    }

    #[test]
    fn test_listing_fee() {
        let engine = FeeEngine::new();
        let charge =
            engine.charge_listing_fee("ISSUER-001", "COCOA-FUT-2026M12", FeeType::InitialListingFee);

        assert_eq!(from_price(charge.amount), 25_000.0);
        assert_eq!(charge.category, FeeCategory::Listing);
    }

    #[test]
    fn test_tokenization_fee() {
        let engine = FeeEngine::new();
        let charge =
            engine.charge_tokenization_fee("USER-001", FeeType::TokenMintingFee, "Gold Token #42");

        assert_eq!(from_price(charge.amount), 500.0);
        assert_eq!(charge.category, FeeCategory::Tokenization);
    }

    #[test]
    fn test_subscription_management() {
        let engine = FeeEngine::new();
        let sub = engine.create_subscription(
            "FIRM-001",
            "Real-Time API Access",
            FeeType::RealtimeApiFee,
            to_price(2_500.0),
            BillingCycle::Monthly,
        );
        assert_eq!(sub.status, SubscriptionStatus::Active);

        let subs = engine.account_subscriptions("FIRM-001");
        assert_eq!(subs.len(), 1);
    }

    #[test]
    fn test_membership_registration() {
        let engine = FeeEngine::new();
        let mem = engine.register_membership(
            "BROKER-NEW",
            FeeType::BrokerDealerMembership,
            "Standard",
            to_price(30_000.0),
        );
        assert_eq!(mem.status, SubscriptionStatus::Active);
        assert_eq!(from_price(mem.annual_fee), 30_000.0);
    }

    #[test]
    fn test_invoice_generation() {
        let engine = FeeEngine::new();

        // Generate some charges first
        engine.charge_listing_fee("FIRM-001", "GOLD-FUT", FeeType::InitialListingFee);
        engine.charge_tokenization_fee("FIRM-001", FeeType::TokenMintingFee, "Test Token");

        let invoice = engine.generate_invoice("FIRM-001", "2026-03");
        assert!(!invoice.line_items.is_empty());
        assert!(invoice.total > invoice.subtotal); // includes tax
        assert_eq!(invoice.status, InvoiceStatus::Issued);
    }

    #[test]
    fn test_revenue_summary() {
        let engine = FeeEngine::new();

        // Generate a trade fee
        engine.calculate_trade_fees(
            to_price(50_000.0),
            "ACC-001",
            "ACC-002",
            "GOLD-FUT-2026M06",
            Side::Buy,
        );

        let summary = engine.revenue_summary();
        assert!(summary["total_charges"].as_u64().unwrap() > 0);
        assert!(summary["active_subscriptions"].as_u64().unwrap() > 0);
        assert!(summary["active_memberships"].as_u64().unwrap() > 0);
    }

    #[test]
    fn test_volume_tier_escalation() {
        let engine = FeeEngine::new();

        // Simulate high volume for account
        engine.monthly_volumes.insert("HFT-001".to_string(), 500_000);

        let trade_value = to_price(100_000.0);
        let (taker, maker, _) = engine.calculate_trade_fees(
            trade_value,
            "HFT-001",
            "MAKER-001",
            "GOLD-FUT-2026M06",
            Side::Buy,
        );

        // Market Maker tier: 0.8 bps taker, -3.5 bps maker rebate
        // 100K * 0.8 / 10000 = 8
        assert_eq!(from_price(taker.amount), 8.0);
        // Maker gets retail rebate since they have 0 volume
        assert!(maker.amount < 0);
    }
}
