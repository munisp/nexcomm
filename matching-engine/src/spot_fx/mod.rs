//! NEXCOM Exchange — Spot FX Engine
//!
//! Provides real-time spot foreign-exchange matching for African currency pairs
//! (NGN, KES, GHS, ZAR, UGX, TZS, XOF, XAF) plus major pairs (USD, EUR, GBP).
//!
//! Architecture:
//!   - One independent orderbook per currency pair (e.g. USD/NGN)
//!   - Cross-rate calculation via triangulation through USD
//!   - Spread management: configurable maker/taker spread per pair
//!   - FX trade execution: atomic debit/credit of both legs
//!   - REST API: /api/v1/fx/*
//!
//! All prices are stored as basis points (1 bp = 0.0001) to avoid floating-point
//! precision issues in financial calculations.

#![allow(dead_code)]

use chrono::Utc;
use parking_lot::RwLock;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashMap, VecDeque};
use uuid::Uuid;

// ─── Types ────────────────────────────────────────────────────────────────────

/// ISO 4217 currency code (3 chars)
pub type CurrencyCode = String;

/// FX pair identifier, e.g. "USD/NGN"
pub type FxPairId = String;

/// Price in basis points (1 bp = 0.0001 of the quote currency per base unit)
pub type FxPrice = u64;

/// Quantity in the base currency (micro-units, i.e. 1_000_000 = 1.0)
pub type FxQty = u64;

/// Side of an FX order
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum FxSide {
    Buy,
    Sell,
}

/// Status of an FX order
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum FxOrderStatus {
    Open,
    PartiallyFilled,
    Filled,
    Cancelled,
    Rejected,
}

/// An FX limit order
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FxOrder {
    pub id: String,
    pub pair_id: FxPairId,
    pub side: FxSide,
    pub price_bp: FxPrice,
    pub quantity: FxQty,
    pub filled_quantity: FxQty,
    pub status: FxOrderStatus,
    pub account_id: String,
    pub created_at: i64,
    pub updated_at: i64,
}

impl FxOrder {
    pub fn remaining(&self) -> FxQty {
        self.quantity.saturating_sub(self.filled_quantity)
    }
}

/// An executed FX trade (fill)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FxTrade {
    pub id: String,
    pub pair_id: FxPairId,
    pub buy_order_id: String,
    pub sell_order_id: String,
    pub price_bp: FxPrice,
    pub quantity: FxQty,
    /// Quote currency amount = quantity * price_bp / 10_000
    pub quote_amount: u64,
    pub executed_at: i64,
}

/// Configuration for a single FX pair
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FxPairConfig {
    pub pair_id: FxPairId,
    pub base_currency: CurrencyCode,
    pub quote_currency: CurrencyCode,
    /// Minimum spread in basis points
    pub min_spread_bp: u32,
    /// Tick size in basis points
    pub tick_size_bp: u32,
    /// Minimum order quantity (micro-units)
    pub min_qty: FxQty,
    /// Maximum order quantity (micro-units)
    pub max_qty: FxQty,
    /// Whether this pair is currently active
    pub active: bool,
    /// Reference rate in basis points (from external feed)
    pub reference_rate_bp: FxPrice,
    pub updated_at: i64,
}

/// Aggregated FX rate snapshot
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FxRate {
    pub pair_id: FxPairId,
    pub bid_bp: FxPrice,
    pub ask_bp: FxPrice,
    pub mid_bp: FxPrice,
    pub spread_bp: u32,
    pub reference_rate_bp: FxPrice,
    pub timestamp: i64,
}

/// FX market depth (top N levels)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FxDepth {
    pub pair_id: FxPairId,
    pub bids: Vec<(FxPrice, FxQty)>,
    pub asks: Vec<(FxPrice, FxQty)>,
    pub timestamp: i64,
}

// ─── Orderbook ────────────────────────────────────────────────────────────────

/// Single-pair FX orderbook (price-time priority)
#[derive(Debug)]
struct FxOrderBook {
    pair_id: FxPairId,
    /// Buy orders: price (descending) → FIFO queue
    bids: BTreeMap<std::cmp::Reverse<FxPrice>, VecDeque<FxOrder>>,
    /// Sell orders: price (ascending) → FIFO queue
    asks: BTreeMap<FxPrice, VecDeque<FxOrder>>,
    /// All orders by ID for O(1) lookup
    orders: HashMap<String, FxOrder>,
    /// Completed trades
    trades: Vec<FxTrade>,
}

impl FxOrderBook {
    fn new(pair_id: FxPairId) -> Self {
        Self {
            pair_id,
            bids: BTreeMap::new(),
            asks: BTreeMap::new(),
            orders: HashMap::new(),
            trades: Vec::new(),
        }
    }

    /// Submit a new limit order and attempt to match it
    fn submit(&mut self, mut order: FxOrder) -> Vec<FxTrade> {
        let mut new_trades = Vec::new();
        let now = Utc::now().timestamp_millis();

        match order.side {
            FxSide::Buy => {
                // Match against asks (ascending price)
                let mut to_remove: Vec<FxPrice> = Vec::new();
                'outer: for (ask_price, queue) in self.asks.iter_mut() {
                    if *ask_price > order.price_bp {
                        break;
                    }
                    while let Some(ask_order) = queue.front_mut() {
                        let fill_qty = order.remaining().min(ask_order.remaining());
                        if fill_qty == 0 {
                            break 'outer;
                        }
                        let trade = FxTrade {
                            id: Uuid::new_v4().to_string(),
                            pair_id: self.pair_id.clone(),
                            buy_order_id: order.id.clone(),
                            sell_order_id: ask_order.id.clone(),
                            price_bp: *ask_price,
                            quantity: fill_qty,
                            quote_amount: fill_qty * ask_price / 10_000,
                            executed_at: now,
                        };
                        order.filled_quantity += fill_qty;
                        ask_order.filled_quantity += fill_qty;
                        ask_order.updated_at = now;
                        if ask_order.remaining() == 0 {
                            ask_order.status = FxOrderStatus::Filled;
                            let id = ask_order.id.clone();
                            if let Some(o) = self.orders.get_mut(&id) {
                                o.status = FxOrderStatus::Filled;
                                o.filled_quantity = ask_order.filled_quantity;
                            }
                            queue.pop_front();
                        } else {
                            ask_order.status = FxOrderStatus::PartiallyFilled;
                            if let Some(o) = self.orders.get_mut(&ask_order.id) {
                                o.status = FxOrderStatus::PartiallyFilled;
                                o.filled_quantity = ask_order.filled_quantity;
                            }
                        }
                        new_trades.push(trade.clone());
                        self.trades.push(trade);
                        if order.remaining() == 0 {
                            break 'outer;
                        }
                    }
                    if queue.is_empty() {
                        to_remove.push(*ask_price);
                    }
                }
                for price in to_remove {
                    self.asks.remove(&price);
                }
                order.status = if order.remaining() == 0 {
                    FxOrderStatus::Filled
                } else if order.filled_quantity > 0 {
                    FxOrderStatus::PartiallyFilled
                } else {
                    FxOrderStatus::Open
                };
                order.updated_at = now;
                if order.status != FxOrderStatus::Filled {
                    self.bids
                        .entry(std::cmp::Reverse(order.price_bp))
                        .or_default()
                        .push_back(order.clone());
                }
                self.orders.insert(order.id.clone(), order);
            }
            FxSide::Sell => {
                // Match against bids (descending price)
                let mut to_remove: Vec<std::cmp::Reverse<FxPrice>> = Vec::new();
                'outer: for (bid_rev_price, queue) in self.bids.iter_mut() {
                    let bid_price = bid_rev_price.0;
                    if bid_price < order.price_bp {
                        break;
                    }
                    while let Some(bid_order) = queue.front_mut() {
                        let fill_qty = order.remaining().min(bid_order.remaining());
                        if fill_qty == 0 {
                            break 'outer;
                        }
                        let trade = FxTrade {
                            id: Uuid::new_v4().to_string(),
                            pair_id: self.pair_id.clone(),
                            buy_order_id: bid_order.id.clone(),
                            sell_order_id: order.id.clone(),
                            price_bp: bid_price,
                            quantity: fill_qty,
                            quote_amount: fill_qty * bid_price / 10_000,
                            executed_at: now,
                        };
                        order.filled_quantity += fill_qty;
                        bid_order.filled_quantity += fill_qty;
                        bid_order.updated_at = now;
                        if bid_order.remaining() == 0 {
                            bid_order.status = FxOrderStatus::Filled;
                            let id = bid_order.id.clone();
                            if let Some(o) = self.orders.get_mut(&id) {
                                o.status = FxOrderStatus::Filled;
                                o.filled_quantity = bid_order.filled_quantity;
                            }
                            queue.pop_front();
                        } else {
                            bid_order.status = FxOrderStatus::PartiallyFilled;
                            if let Some(o) = self.orders.get_mut(&bid_order.id) {
                                o.status = FxOrderStatus::PartiallyFilled;
                                o.filled_quantity = bid_order.filled_quantity;
                            }
                        }
                        new_trades.push(trade.clone());
                        self.trades.push(trade);
                        if order.remaining() == 0 {
                            break 'outer;
                        }
                    }
                    if queue.is_empty() {
                        to_remove.push(*bid_rev_price);
                    }
                }
                for price in to_remove {
                    self.bids.remove(&price);
                }
                order.status = if order.remaining() == 0 {
                    FxOrderStatus::Filled
                } else if order.filled_quantity > 0 {
                    FxOrderStatus::PartiallyFilled
                } else {
                    FxOrderStatus::Open
                };
                order.updated_at = now;
                if order.status != FxOrderStatus::Filled {
                    self.asks
                        .entry(order.price_bp)
                        .or_default()
                        .push_back(order.clone());
                }
                self.orders.insert(order.id.clone(), order);
            }
        }
        new_trades
    }

    /// Cancel an open order
    fn cancel(&mut self, order_id: &str) -> bool {
        if let Some(order) = self.orders.get_mut(order_id) {
            if order.status == FxOrderStatus::Open || order.status == FxOrderStatus::PartiallyFilled {
                order.status = FxOrderStatus::Cancelled;
                order.updated_at = Utc::now().timestamp_millis();
                return true;
            }
        }
        false
    }

    /// Best bid price (highest buy price)
    fn best_bid(&self) -> Option<FxPrice> {
        self.bids.keys().next().map(|r| r.0)
    }

    /// Best ask price (lowest sell price)
    fn best_ask(&self) -> Option<FxPrice> {
        self.asks.keys().next().copied()
    }

    /// Market depth snapshot (top N levels each side)
    fn depth(&self, levels: usize) -> FxDepth {
        let bids: Vec<(FxPrice, FxQty)> = self
            .bids
            .iter()
            .take(levels)
            .map(|(rev_price, queue)| {
                let total_qty: FxQty = queue.iter().map(|o| o.remaining()).sum();
                (rev_price.0, total_qty)
            })
            .collect();
        let asks: Vec<(FxPrice, FxQty)> = self
            .asks
            .iter()
            .take(levels)
            .map(|(price, queue)| {
                let total_qty: FxQty = queue.iter().map(|o| o.remaining()).sum();
                (*price, total_qty)
            })
            .collect();
        FxDepth {
            pair_id: self.pair_id.clone(),
            bids,
            asks,
            timestamp: Utc::now().timestamp_millis(),
        }
    }

    /// Recent trades (last N)
    fn recent_trades(&self, limit: usize) -> Vec<FxTrade> {
        let start = self.trades.len().saturating_sub(limit);
        self.trades[start..].to_vec()
    }
}

// ─── SpotFxEngine ─────────────────────────────────────────────────────────────

/// Thread-safe spot FX engine managing all currency pair orderbooks
pub struct SpotFxEngine {
    /// Pair ID → orderbook
    books: RwLock<HashMap<FxPairId, FxOrderBook>>,
    /// Pair ID → config
    configs: RwLock<HashMap<FxPairId, FxPairConfig>>,
}

impl SpotFxEngine {
    /// Create a new engine pre-loaded with standard African + major pairs
    pub fn new() -> Self {
        let engine = Self {
            books: RwLock::new(HashMap::new()),
            configs: RwLock::new(HashMap::new()),
        };
        engine.seed_default_pairs();
        engine
    }

    fn seed_default_pairs(&self) {
        let now = Utc::now().timestamp_millis();
        let default_pairs: Vec<FxPairConfig> = vec![
            // Major USD pairs
            FxPairConfig {
                pair_id: "USD/NGN".into(), base_currency: "USD".into(), quote_currency: "NGN".into(),
                min_spread_bp: 50, tick_size_bp: 1, min_qty: 1_000_000, max_qty: 1_000_000_000_000,
                active: true, reference_rate_bp: 16_000_000, updated_at: now,
            },
            FxPairConfig {
                pair_id: "USD/KES".into(), base_currency: "USD".into(), quote_currency: "KES".into(),
                min_spread_bp: 30, tick_size_bp: 1, min_qty: 1_000_000, max_qty: 500_000_000_000,
                active: true, reference_rate_bp: 1_290_000, updated_at: now,
            },
            FxPairConfig {
                pair_id: "USD/GHS".into(), base_currency: "USD".into(), quote_currency: "GHS".into(),
                min_spread_bp: 40, tick_size_bp: 1, min_qty: 1_000_000, max_qty: 200_000_000_000,
                active: true, reference_rate_bp: 150_000, updated_at: now,
            },
            FxPairConfig {
                pair_id: "USD/ZAR".into(), base_currency: "USD".into(), quote_currency: "ZAR".into(),
                min_spread_bp: 20, tick_size_bp: 1, min_qty: 1_000_000, max_qty: 1_000_000_000_000,
                active: true, reference_rate_bp: 185_000, updated_at: now,
            },
            FxPairConfig {
                pair_id: "USD/UGX".into(), base_currency: "USD".into(), quote_currency: "UGX".into(),
                min_spread_bp: 60, tick_size_bp: 10, min_qty: 1_000_000, max_qty: 100_000_000_000,
                active: true, reference_rate_bp: 37_000_000, updated_at: now,
            },
            FxPairConfig {
                pair_id: "USD/TZS".into(), base_currency: "USD".into(), quote_currency: "TZS".into(),
                min_spread_bp: 60, tick_size_bp: 10, min_qty: 1_000_000, max_qty: 100_000_000_000,
                active: true, reference_rate_bp: 25_000_000, updated_at: now,
            },
            FxPairConfig {
                pair_id: "EUR/USD".into(), base_currency: "EUR".into(), quote_currency: "USD".into(),
                min_spread_bp: 5, tick_size_bp: 1, min_qty: 1_000_000, max_qty: 10_000_000_000_000,
                active: true, reference_rate_bp: 10_850, updated_at: now,
            },
            FxPairConfig {
                pair_id: "GBP/USD".into(), base_currency: "GBP".into(), quote_currency: "USD".into(),
                min_spread_bp: 5, tick_size_bp: 1, min_qty: 1_000_000, max_qty: 10_000_000_000_000,
                active: true, reference_rate_bp: 12_700, updated_at: now,
            },
            // Cross-African pairs
            FxPairConfig {
                pair_id: "NGN/KES".into(), base_currency: "NGN".into(), quote_currency: "KES".into(),
                min_spread_bp: 100, tick_size_bp: 1, min_qty: 1_000_000_000, max_qty: 1_000_000_000_000_000,
                active: true, reference_rate_bp: 81, updated_at: now,
            },
            FxPairConfig {
                pair_id: "NGN/GHS".into(), base_currency: "NGN".into(), quote_currency: "GHS".into(),
                min_spread_bp: 100, tick_size_bp: 1, min_qty: 1_000_000_000, max_qty: 1_000_000_000_000_000,
                active: true, reference_rate_bp: 9, updated_at: now,
            },
        ];

        let mut books = self.books.write();
        let mut configs = self.configs.write();
        for cfg in default_pairs {
            books.insert(cfg.pair_id.clone(), FxOrderBook::new(cfg.pair_id.clone()));
            configs.insert(cfg.pair_id.clone(), cfg);
        }
    }

    /// List all configured FX pairs
    pub fn list_pairs(&self) -> Vec<FxPairConfig> {
        self.configs.read().values().cloned().collect()
    }

    /// Get config for a specific pair
    pub fn get_pair(&self, pair_id: &str) -> Option<FxPairConfig> {
        self.configs.read().get(pair_id).cloned()
    }

    /// Get current FX rate for a pair
    pub fn get_rate(&self, pair_id: &str) -> Option<FxRate> {
        let books = self.books.read();
        let configs = self.configs.read();
        let book = books.get(pair_id)?;
        let cfg = configs.get(pair_id)?;
        let bid_bp = book.best_bid().unwrap_or(cfg.reference_rate_bp.saturating_sub(cfg.min_spread_bp as u64 / 2));
        let ask_bp = book.best_ask().unwrap_or(cfg.reference_rate_bp + cfg.min_spread_bp as u64 / 2);
        let mid_bp = (bid_bp + ask_bp) / 2;
        let spread_bp = (ask_bp.saturating_sub(bid_bp)) as u32;
        Some(FxRate {
            pair_id: pair_id.to_string(),
            bid_bp,
            ask_bp,
            mid_bp,
            spread_bp,
            reference_rate_bp: cfg.reference_rate_bp,
            timestamp: Utc::now().timestamp_millis(),
        })
    }

    /// Get all current FX rates
    pub fn get_all_rates(&self) -> Vec<FxRate> {
        let configs = self.configs.read();
        configs
            .keys()
            .filter_map(|pair_id| self.get_rate(pair_id))
            .collect()
    }

    /// Calculate cross-rate via triangulation through USD
    pub fn cross_rate(&self, base: &str, quote: &str) -> Option<FxRate> {
        // Direct pair?
        let direct_id = format!("{}/{}", base, quote);
        if let Some(rate) = self.get_rate(&direct_id) {
            return Some(rate);
        }
        // Try reverse
        let reverse_id = format!("{}/{}", quote, base);
        if let Some(rate) = self.get_rate(&reverse_id) {
            let bid_bp = if rate.ask_bp > 0 { 10_000_000_000 / rate.ask_bp } else { 0 };
            let ask_bp = if rate.bid_bp > 0 { 10_000_000_000 / rate.bid_bp } else { 0 };
            return Some(FxRate {
                pair_id: direct_id,
                bid_bp,
                ask_bp,
                mid_bp: (bid_bp + ask_bp) / 2,
                spread_bp: (ask_bp.saturating_sub(bid_bp)) as u32,
                reference_rate_bp: if rate.reference_rate_bp > 0 { 10_000_000_000 / rate.reference_rate_bp } else { 0 },
                timestamp: Utc::now().timestamp_millis(),
            });
        }
        // Triangulate via USD
        let base_usd = format!("{}/USD", base);
        let usd_quote = format!("USD/{}", quote);
        let base_usd_rate = self.get_rate(&base_usd)?;
        let usd_quote_rate = self.get_rate(&usd_quote)?;
        // base→USD→quote: mid = base_usd_mid * usd_quote_mid / 10_000
        let mid_bp = base_usd_rate.mid_bp * usd_quote_rate.mid_bp / 10_000;
        Some(FxRate {
            pair_id: direct_id,
            bid_bp: mid_bp.saturating_sub(50),
            ask_bp: mid_bp + 50,
            mid_bp,
            spread_bp: 100,
            reference_rate_bp: mid_bp,
            timestamp: Utc::now().timestamp_millis(),
        })
    }

    /// Submit an FX order
    pub fn submit_order(
        &self,
        pair_id: &str,
        side: FxSide,
        price_bp: FxPrice,
        quantity: FxQty,
        account_id: &str,
    ) -> Result<(FxOrder, Vec<FxTrade>), String> {
        let configs = self.configs.read();
        let cfg = configs.get(pair_id).ok_or_else(|| format!("Unknown pair: {}", pair_id))?;
        if !cfg.active {
            return Err(format!("Pair {} is not active", pair_id));
        }
        if quantity < cfg.min_qty {
            return Err(format!("Quantity {} below minimum {}", quantity, cfg.min_qty));
        }
        if quantity > cfg.max_qty {
            return Err(format!("Quantity {} above maximum {}", quantity, cfg.max_qty));
        }
        drop(configs);

        let now = Utc::now().timestamp_millis();
        let order = FxOrder {
            id: Uuid::new_v4().to_string(),
            pair_id: pair_id.to_string(),
            side,
            price_bp,
            quantity,
            filled_quantity: 0,
            status: FxOrderStatus::Open,
            account_id: account_id.to_string(),
            created_at: now,
            updated_at: now,
        };
        let order_clone = order.clone();
        let mut books = self.books.write();
        let book = books.get_mut(pair_id).ok_or_else(|| format!("No orderbook for {}", pair_id))?;
        let trades = book.submit(order);
        let filled_order = book.orders.get(&order_clone.id).cloned().unwrap_or(order_clone);
        Ok((filled_order, trades))
    }

    /// Cancel an FX order
    pub fn cancel_order(&self, pair_id: &str, order_id: &str) -> bool {
        let mut books = self.books.write();
        if let Some(book) = books.get_mut(pair_id) {
            return book.cancel(order_id);
        }
        false
    }

    /// Get market depth for a pair
    pub fn get_depth(&self, pair_id: &str, levels: usize) -> Option<FxDepth> {
        let books = self.books.read();
        books.get(pair_id).map(|b| b.depth(levels))
    }

    /// Get recent trades for a pair
    pub fn get_trades(&self, pair_id: &str, limit: usize) -> Vec<FxTrade> {
        let books = self.books.read();
        books.get(pair_id).map(|b| b.recent_trades(limit)).unwrap_or_default()
    }

    /// Update reference rate for a pair (from external feed)
    pub fn update_reference_rate(&self, pair_id: &str, rate_bp: FxPrice) {
        let mut configs = self.configs.write();
        if let Some(cfg) = configs.get_mut(pair_id) {
            cfg.reference_rate_bp = rate_bp;
            cfg.updated_at = Utc::now().timestamp_millis();
        }
    }

    /// Get all open orders for an account across all pairs
    pub fn get_account_orders(&self, account_id: &str) -> Vec<FxOrder> {
        let books = self.books.read();
        books
            .values()
            .flat_map(|book| {
                book.orders
                    .values()
                    .filter(|o| {
                        o.account_id == account_id
                            && (o.status == FxOrderStatus::Open
                                || o.status == FxOrderStatus::PartiallyFilled)
                    })
                    .cloned()
                    .collect::<Vec<_>>()
            })
            .collect()
    }

    /// Summary statistics for a pair
    pub fn pair_stats(&self, pair_id: &str) -> Option<FxPairStats> {
        let books = self.books.read();
        let book = books.get(pair_id)?;
        let total_orders: usize = book.orders.len();
        let open_orders: usize = book
            .orders
            .values()
            .filter(|o| o.status == FxOrderStatus::Open || o.status == FxOrderStatus::PartiallyFilled)
            .count();
        let total_trades = book.trades.len();
        let total_volume: FxQty = book.trades.iter().map(|t| t.quantity).sum();
        Some(FxPairStats {
            pair_id: pair_id.to_string(),
            total_orders,
            open_orders,
            total_trades,
            total_volume,
            last_price_bp: book.trades.last().map(|t| t.price_bp),
        })
    }
}

/// Summary statistics for an FX pair
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FxPairStats {
    pub pair_id: FxPairId,
    pub total_orders: usize,
    pub open_orders: usize,
    pub total_trades: usize,
    pub total_volume: FxQty,
    pub last_price_bp: Option<FxPrice>,
}

// ─── Request/Response DTOs ────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct SubmitFxOrderRequest {
    pub pair_id: FxPairId,
    pub side: FxSide,
    pub price_bp: FxPrice,
    pub quantity: FxQty,
    pub account_id: String,
}

#[derive(Debug, Serialize)]
pub struct SubmitFxOrderResponse {
    pub order: FxOrder,
    pub trades: Vec<FxTrade>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateReferenceRateRequest {
    pub pair_id: FxPairId,
    pub rate_bp: FxPrice,
}

// ─── Unit Tests ───────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    fn make_order(pair_id: &str, side: FxSide, price_bp: FxPrice, qty: FxQty) -> FxOrder {
        let now = Utc::now().timestamp_millis();
        FxOrder {
            id: Uuid::new_v4().to_string(),
            pair_id: pair_id.to_string(),
            side,
            price_bp,
            quantity: qty,
            filled_quantity: 0,
            status: FxOrderStatus::Open,
            account_id: "acc-test".to_string(),
            created_at: now,
            updated_at: now,
        }
    }

    #[test]
    fn test_engine_initialises_with_default_pairs() {
        let engine = SpotFxEngine::new();
        let pairs = engine.list_pairs();
        assert!(pairs.len() >= 10, "Expected at least 10 default pairs");
        let ids: Vec<&str> = pairs.iter().map(|p| p.pair_id.as_str()).collect();
        assert!(ids.contains(&"USD/NGN"));
        assert!(ids.contains(&"USD/KES"));
        assert!(ids.contains(&"EUR/USD"));
    }

    #[test]
    fn test_get_rate_returns_reference_rate_when_no_orders() {
        let engine = SpotFxEngine::new();
        let rate = engine.get_rate("USD/NGN").expect("rate should exist");
        assert!(rate.bid_bp > 0);
        assert!(rate.ask_bp >= rate.bid_bp);
    }

    #[test]
    fn test_submit_and_match_orders() {
        let engine = SpotFxEngine::new();
        // Submit a sell at 16_000_000 bp
        let (sell_order, sell_trades) = engine
            .submit_order("USD/NGN", FxSide::Sell, 16_000_000, 10_000_000, "seller")
            .unwrap();
        assert_eq!(sell_trades.len(), 0, "No buy orders yet");
        assert_eq!(sell_order.status, FxOrderStatus::Open);

        // Submit a matching buy at 16_000_000 bp
        let (buy_order, buy_trades) = engine
            .submit_order("USD/NGN", FxSide::Buy, 16_000_000, 10_000_000, "buyer")
            .unwrap();
        assert_eq!(buy_trades.len(), 1, "Should produce one trade");
        assert_eq!(buy_order.status, FxOrderStatus::Filled);
        assert_eq!(buy_trades[0].quantity, 10_000_000);
    }

    #[test]
    fn test_partial_fill() {
        let engine = SpotFxEngine::new();
        engine
            .submit_order("USD/NGN", FxSide::Sell, 16_000_000, 5_000_000, "seller")
            .unwrap();
        let (buy_order, trades) = engine
            .submit_order("USD/NGN", FxSide::Buy, 16_000_000, 10_000_000, "buyer")
            .unwrap();
        assert_eq!(trades.len(), 1);
        assert_eq!(buy_order.status, FxOrderStatus::PartiallyFilled);
        assert_eq!(buy_order.filled_quantity, 5_000_000);
    }

    #[test]
    fn test_cancel_order() {
        let engine = SpotFxEngine::new();
        let (order, _) = engine
            .submit_order("USD/NGN", FxSide::Sell, 16_100_000, 5_000_000, "seller")
            .unwrap();
        assert!(engine.cancel_order("USD/NGN", &order.id));
    }

    #[test]
    fn test_cross_rate_triangulation() {
        let engine = SpotFxEngine::new();
        // NGN/KES is a direct pair, should return a rate
        let rate = engine.get_rate("NGN/KES");
        assert!(rate.is_some());
        // GHS/KES is not a direct pair, should triangulate via USD
        let cross = engine.cross_rate("GHS", "KES");
        assert!(cross.is_some());
        let r = cross.unwrap();
        assert!(r.mid_bp > 0);
    }

    #[test]
    fn test_depth_snapshot() {
        let engine = SpotFxEngine::new();
        engine.submit_order("USD/NGN", FxSide::Sell, 16_100_000, 5_000_000, "s1").unwrap();
        engine.submit_order("USD/NGN", FxSide::Sell, 16_200_000, 3_000_000, "s2").unwrap();
        engine.submit_order("USD/NGN", FxSide::Buy, 15_900_000, 4_000_000, "b1").unwrap();
        let depth = engine.get_depth("USD/NGN", 5).unwrap();
        assert_eq!(depth.asks.len(), 2);
        assert_eq!(depth.bids.len(), 1);
    }

    #[test]
    fn test_update_reference_rate() {
        let engine = SpotFxEngine::new();
        engine.update_reference_rate("USD/NGN", 16_500_000);
        let cfg = engine.get_pair("USD/NGN").unwrap();
        assert_eq!(cfg.reference_rate_bp, 16_500_000);
    }
}
