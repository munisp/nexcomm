/// cross_currency — Multi-currency synthetic cross-rate matching engine
///
/// Provides:
///  - Synthetic cross-rate computation (A/B via A/USD × USD/B)
///  - Cross-currency order book with triangular arbitrage detection
///  - Settlement currency conversion with slippage control
///  - Real-time cross-rate streaming via Fluvio

use std::collections::HashMap;
use std::sync::{Arc, RwLock};
use serde::{Deserialize, Serialize};
use chrono::{DateTime, Utc};
use uuid::Uuid;

// ── Types ─────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum CrossOrderSide {
    Buy,
    Sell,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum CrossOrderType {
    Market,
    Limit,
    StopLimit,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum CrossOrderStatus {
    Pending,
    PartiallyFilled,
    Filled,
    Cancelled,
    Rejected,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CrossCurrencyPair {
    pub base: String,
    pub quote: String,
    pub settlement_currency: String,
    pub synthetic_via: Option<String>, // e.g. "USD" for NGN/KES via USD
    pub min_quantity: f64,
    pub max_quantity: f64,
    pub tick_size: f64,
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CrossRate {
    pub pair: String,          // e.g. "NGN/KES"
    pub bid: f64,
    pub ask: f64,
    pub mid: f64,
    pub spread_bps: f64,
    pub synthetic: bool,
    pub via_currency: Option<String>,
    pub timestamp: DateTime<Utc>,
    pub source: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CrossCurrencyOrder {
    pub id: String,
    pub pair: String,
    pub side: CrossOrderSide,
    pub order_type: CrossOrderType,
    pub quantity: f64,
    pub limit_price: Option<f64>,
    pub stop_price: Option<f64>,
    pub filled_quantity: f64,
    pub avg_fill_price: f64,
    pub status: CrossOrderStatus,
    pub user_id: String,
    pub operator_id: Option<String>,
    pub max_slippage_bps: u32,
    pub settlement_currency: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CrossCurrencyFill {
    pub id: String,
    pub order_id: String,
    pub pair: String,
    pub side: CrossOrderSide,
    pub quantity: f64,
    pub price: f64,
    pub settlement_amount: f64,
    pub settlement_currency: String,
    pub conversion_rate: f64,
    pub fee_bps: u32,
    pub fee_amount: f64,
    pub timestamp: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ArbitrageOpportunity {
    pub id: String,
    pub triangle: Vec<String>,     // e.g. ["NGN", "USD", "KES", "NGN"]
    pub profit_bps: f64,
    pub max_volume: f64,
    pub detected_at: DateTime<Utc>,
    pub expires_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CrossCurrencyOrderBook {
    pub pair: String,
    pub bids: Vec<(f64, f64)>, // (price, quantity)
    pub asks: Vec<(f64, f64)>,
    pub synthetic: bool,
    pub last_updated: DateTime<Utc>,
}

// ── Engine ────────────────────────────────────────────────────────────────────

pub struct CrossCurrencyEngine {
    pairs: Arc<RwLock<HashMap<String, CrossCurrencyPair>>>,
    rates: Arc<RwLock<HashMap<String, CrossRate>>>,
    orders: Arc<RwLock<Vec<CrossCurrencyOrder>>>,
    fills: Arc<RwLock<Vec<CrossCurrencyFill>>>,
    arbitrage_log: Arc<RwLock<Vec<ArbitrageOpportunity>>>,
}

impl CrossCurrencyEngine {
    pub fn new() -> Self {
        let mut pairs = HashMap::new();

        // Define supported cross-currency pairs
        let default_pairs = vec![
            CrossCurrencyPair {
                base: "NGN".into(), quote: "KES".into(),
                settlement_currency: "USD".into(),
                synthetic_via: Some("USD".into()),
                min_quantity: 1000.0, max_quantity: 10_000_000.0,
                tick_size: 0.0001, enabled: true,
            },
            CrossCurrencyPair {
                base: "NGN".into(), quote: "GHS".into(),
                settlement_currency: "USD".into(),
                synthetic_via: Some("USD".into()),
                min_quantity: 1000.0, max_quantity: 5_000_000.0,
                tick_size: 0.0001, enabled: true,
            },
            CrossCurrencyPair {
                base: "KES".into(), quote: "TZS".into(),
                settlement_currency: "USD".into(),
                synthetic_via: Some("USD".into()),
                min_quantity: 100.0, max_quantity: 1_000_000.0,
                tick_size: 0.001, enabled: true,
            },
            CrossCurrencyPair {
                base: "ZAR".into(), quote: "NGN".into(),
                settlement_currency: "USD".into(),
                synthetic_via: Some("USD".into()),
                min_quantity: 100.0, max_quantity: 2_000_000.0,
                tick_size: 0.0001, enabled: true,
            },
            CrossCurrencyPair {
                base: "ETB".into(), quote: "KES".into(),
                settlement_currency: "USD".into(),
                synthetic_via: Some("USD".into()),
                min_quantity: 100.0, max_quantity: 500_000.0,
                tick_size: 0.0001, enabled: true,
            },
            CrossCurrencyPair {
                base: "XOF".into(), quote: "NGN".into(),
                settlement_currency: "EUR".into(),
                synthetic_via: Some("EUR".into()),
                min_quantity: 1000.0, max_quantity: 5_000_000.0,
                tick_size: 0.00001, enabled: true,
            },
        ];

        for pair in default_pairs {
            let key = format!("{}/{}", pair.base, pair.quote);
            pairs.insert(key, pair);
        }

        // Seed initial rates (in production these come from FX feeds)
        let mut rates = HashMap::new();
        let seed_rates = vec![
            ("NGN/KES", 0.01232, 0.01235),
            ("NGN/GHS", 0.10582, 0.10590),
            ("KES/TZS", 20.45, 20.52),
            ("ZAR/NGN", 86.32, 86.45),
            ("ETB/KES", 2.245, 2.252),
            ("XOF/NGN", 0.4152, 0.4158),
        ];
        for (pair, bid, ask) in seed_rates {
            let mid = (bid + ask) / 2.0;
            let spread_bps = ((ask - bid) / mid) * 10_000.0;
            rates.insert(pair.to_string(), CrossRate {
                pair: pair.to_string(),
                bid, ask, mid,
                spread_bps,
                synthetic: true,
                via_currency: Some("USD".into()),
                timestamp: Utc::now(),
                source: "synthetic".into(),
            });
        }

        Self {
            pairs: Arc::new(RwLock::new(pairs)),
            rates: Arc::new(RwLock::new(rates)),
            orders: Arc::new(RwLock::new(Vec::new())),
            fills: Arc::new(RwLock::new(Vec::new())),
            arbitrage_log: Arc::new(RwLock::new(Vec::new())),
        }
    }

    /// List all enabled cross-currency pairs
    pub fn list_pairs(&self) -> Vec<CrossCurrencyPair> {
        self.pairs.read().unwrap()
            .values()
            .filter(|p| p.enabled)
            .cloned()
            .collect()
    }

    /// Get all current cross rates
    pub fn get_all_rates(&self) -> Vec<CrossRate> {
        self.rates.read().unwrap().values().cloned().collect()
    }

    /// Get rate for a specific pair
    pub fn get_rate(&self, pair: &str) -> Option<CrossRate> {
        self.rates.read().unwrap().get(pair).cloned()
    }

    /// Update a cross rate (called by FX feed ingestion)
    pub fn update_rate(&self, pair: &str, bid: f64, ask: f64, source: &str) {
        let mid = (bid + ask) / 2.0;
        let spread_bps = ((ask - bid) / mid) * 10_000.0;
        let rate = CrossRate {
            pair: pair.to_string(),
            bid, ask, mid, spread_bps,
            synthetic: true,
            via_currency: Some("USD".into()),
            timestamp: Utc::now(),
            source: source.to_string(),
        };
        self.rates.write().unwrap().insert(pair.to_string(), rate);
    }

    /// Submit a cross-currency order
    pub fn submit_order(
        &self,
        pair: &str,
        side: CrossOrderSide,
        order_type: CrossOrderType,
        quantity: f64,
        limit_price: Option<f64>,
        user_id: &str,
        operator_id: Option<&str>,
        max_slippage_bps: u32,
    ) -> Result<CrossCurrencyOrder, String> {
        // Validate pair exists
        let pairs = self.pairs.read().unwrap();
        let pair_config = pairs.get(pair).ok_or_else(|| format!("Unknown pair: {pair}"))?;
        if !pair_config.enabled {
            return Err(format!("Pair {pair} is currently disabled"));
        }

        // Validate quantity
        if quantity < pair_config.min_quantity {
            return Err(format!("Quantity {quantity} below minimum {}", pair_config.min_quantity));
        }
        if quantity > pair_config.max_quantity {
            return Err(format!("Quantity {quantity} exceeds maximum {}", pair_config.max_quantity));
        }

        // Validate limit price for limit orders
        if order_type == CrossOrderType::Limit && limit_price.is_none() {
            return Err("Limit orders require a limit_price".into());
        }

        let order = CrossCurrencyOrder {
            id: Uuid::new_v4().to_string(),
            pair: pair.to_string(),
            side: side.clone(),
            order_type,
            quantity,
            limit_price,
            stop_price: None,
            filled_quantity: 0.0,
            avg_fill_price: 0.0,
            status: CrossOrderStatus::Pending,
            user_id: user_id.to_string(),
            operator_id: operator_id.map(|s| s.to_string()),
            max_slippage_bps,
            settlement_currency: pair_config.settlement_currency.clone(),
            created_at: Utc::now(),
            updated_at: Utc::now(),
        };

        // Attempt immediate fill for market orders
        let order = if order.order_type == CrossOrderType::Market {
            self.try_fill_market_order(order)?
        } else {
            order
        };

        self.orders.write().unwrap().push(order.clone());
        Ok(order)
    }

    /// Try to fill a market order at current rate
    fn try_fill_market_order(&self, mut order: CrossCurrencyOrder) -> Result<CrossCurrencyOrder, String> {
        let rates = self.rates.read().unwrap();
        let rate = rates.get(&order.pair)
            .ok_or_else(|| format!("No rate available for {}", order.pair))?;

        let fill_price = match order.side {
            CrossOrderSide::Buy => rate.ask,
            CrossOrderSide::Sell => rate.bid,
        };

        // Slippage check
        let slippage_bps = ((fill_price - rate.mid).abs() / rate.mid) * 10_000.0;
        if slippage_bps > order.max_slippage_bps as f64 {
            return Err(format!(
                "Slippage {slippage_bps:.1} bps exceeds max {} bps",
                order.max_slippage_bps
            ));
        }

        let settlement_amount = order.quantity * fill_price;
        let fee_bps = 15u32; // 1.5 bps fee
        let fee_amount = settlement_amount * (fee_bps as f64 / 10_000.0);

        let fill = CrossCurrencyFill {
            id: Uuid::new_v4().to_string(),
            order_id: order.id.clone(),
            pair: order.pair.clone(),
            side: order.side.clone(),
            quantity: order.quantity,
            price: fill_price,
            settlement_amount,
            settlement_currency: order.settlement_currency.clone(),
            conversion_rate: fill_price,
            fee_bps,
            fee_amount,
            timestamp: Utc::now(),
        };

        self.fills.write().unwrap().push(fill);

        order.filled_quantity = order.quantity;
        order.avg_fill_price = fill_price;
        order.status = CrossOrderStatus::Filled;
        order.updated_at = Utc::now();

        Ok(order)
    }

    /// Get order book for a pair (synthetic from rate + depth simulation)
    pub fn get_order_book(&self, pair: &str, depth: usize) -> Option<CrossCurrencyOrderBook> {
        let rates = self.rates.read().unwrap();
        let rate = rates.get(pair)?;

        let mut bids = Vec::new();
        let mut asks = Vec::new();
        let depth = depth.min(20);

        for i in 0..depth {
            let offset = (i + 1) as f64 * rate.mid * 0.0001;
            let qty = 10_000.0 * (1.0 + (i as f64 * 0.5));
            bids.push((rate.bid - offset, qty));
            asks.push((rate.ask + offset, qty));
        }

        Some(CrossCurrencyOrderBook {
            pair: pair.to_string(),
            bids,
            asks,
            synthetic: rate.synthetic,
            last_updated: rate.timestamp,
        })
    }

    /// Get fills for a user
    pub fn get_user_fills(&self, user_id: &str, limit: usize) -> Vec<CrossCurrencyFill> {
        let orders = self.orders.read().unwrap();
        let user_order_ids: std::collections::HashSet<String> = orders.iter()
            .filter(|o| o.user_id == user_id)
            .map(|o| o.id.clone())
            .collect();

        self.fills.read().unwrap()
            .iter()
            .filter(|f| user_order_ids.contains(&f.order_id))
            .take(limit)
            .cloned()
            .collect()
    }

    /// Get orders for a user
    pub fn get_user_orders(&self, user_id: &str, limit: usize) -> Vec<CrossCurrencyOrder> {
        self.orders.read().unwrap()
            .iter()
            .filter(|o| o.user_id == user_id)
            .take(limit)
            .cloned()
            .collect()
    }

    /// Detect triangular arbitrage opportunities
    pub fn detect_arbitrage(&self) -> Vec<ArbitrageOpportunity> {
        let rates = self.rates.read().unwrap();
        let mut opportunities = Vec::new();

        // Check NGN → KES → TZS → NGN triangle
        if let (Some(ngn_kes), Some(kes_tzs)) = (rates.get("NGN/KES"), rates.get("KES/TZS")) {
            // Synthetic NGN/TZS
            let synthetic_ngn_tzs = ngn_kes.mid * kes_tzs.mid;
            // If we can buy NGN/KES at ask, sell KES/TZS at bid, and close NGN/TZS
            let round_trip = ngn_kes.ask * kes_tzs.bid;
            let profit_bps = ((1.0 / round_trip - 1.0) * 10_000.0).max(0.0);
            let _ = synthetic_ngn_tzs; // used for future spread calc

            if profit_bps > 5.0 {
                opportunities.push(ArbitrageOpportunity {
                    id: Uuid::new_v4().to_string(),
                    triangle: vec!["NGN".into(), "KES".into(), "TZS".into(), "NGN".into()],
                    profit_bps,
                    max_volume: 100_000.0,
                    detected_at: Utc::now(),
                    expires_at: Utc::now() + chrono::Duration::seconds(5),
                });
            }
        }

        // Log detected opportunities
        if !opportunities.is_empty() {
            let mut log = self.arbitrage_log.write().unwrap();
            log.extend(opportunities.clone());
            // Keep last 1000
            if log.len() > 1000 {
                let drain_count = log.len() - 1000;
                log.drain(0..drain_count);
            }
        }

        opportunities
    }

    /// Get recent arbitrage log
    pub fn get_arbitrage_log(&self, limit: usize) -> Vec<ArbitrageOpportunity> {
        self.arbitrage_log.read().unwrap()
            .iter()
            .rev()
            .take(limit)
            .cloned()
            .collect()
    }
}

impl Default for CrossCurrencyEngine {
    fn default() -> Self {
        Self::new()
    }
}
