//! Auction Mechanism — NYSE-equivalent opening/closing auctions.
//! Implements:
//! - Opening auction (price discovery at market open)
//! - Closing auction (settlement price determination)
//! - Re-opening auction (after circuit breaker halt)
//! - Indicative price calculation during auction period
//! - Auction order collection and matching
#![allow(dead_code)]

use crate::types::*;
use chrono::{DateTime, Utc};
use parking_lot::RwLock;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use tracing::{info, warn};

/// Auction phase.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum AuctionPhase {
    /// No auction running — continuous trading.
    Continuous,
    /// Pre-open: collecting orders, no matching.
    PreOpen,
    /// Opening auction: calculating equilibrium price.
    OpeningAuction,
    /// Continuous trading session.
    Trading,
    /// Pre-close: collecting orders for closing auction.
    PreClose,
    /// Closing auction: determining settlement/closing price.
    ClosingAuction,
    /// Post-close: market closed.
    Closed,
    /// Re-opening auction after halt.
    ReopeningAuction,
}

/// A single auction order (can be limit or market-on-close/open).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuctionOrder {
    pub id: uuid::Uuid,
    pub symbol: String,
    pub side: Side,
    pub price: Price,
    pub quantity: Qty,
    pub account_id: String,
    pub order_type: AuctionOrderType,
    pub submitted_at: DateTime<Utc>,
}

/// Auction-specific order types.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum AuctionOrderType {
    /// Limit order participates in auction at specified price.
    Limit,
    /// Market-on-Open: executes at opening auction price.
    MarketOnOpen,
    /// Market-on-Close: executes at closing auction price.
    MarketOnClose,
    /// Limit-on-Open: limit order valid only during opening auction.
    LimitOnOpen,
    /// Limit-on-Close: limit order valid only during closing auction.
    LimitOnClose,
}

/// Result of an auction.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuctionResult {
    pub symbol: String,
    pub auction_type: AuctionPhase,
    pub equilibrium_price: Price,
    pub matched_volume: Qty,
    pub imbalance_volume: i64,
    pub imbalance_side: Option<Side>,
    pub participating_orders: usize,
    pub trades: Vec<AuctionTrade>,
    pub completed_at: DateTime<Utc>,
}

/// A trade resulting from an auction.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuctionTrade {
    pub id: uuid::Uuid,
    pub symbol: String,
    pub price: Price,
    pub quantity: Qty,
    pub buyer_account: String,
    pub seller_account: String,
    pub timestamp: DateTime<Utc>,
}

/// Indicative auction data (published during auction period).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IndicativeData {
    pub symbol: String,
    pub indicative_price: Price,
    pub indicative_volume: Qty,
    pub imbalance_volume: i64,
    pub imbalance_side: Option<Side>,
    pub buy_orders: usize,
    pub sell_orders: usize,
    pub timestamp: DateTime<Utc>,
}

/// Per-symbol auction state.
struct SymbolAuction {
    phase: AuctionPhase,
    buy_orders: Vec<AuctionOrder>,
    sell_orders: Vec<AuctionOrder>,
    last_result: Option<AuctionResult>,
}

/// The auction engine managing all symbol auctions.
pub struct AuctionEngine {
    auctions: RwLock<HashMap<String, SymbolAuction>>,
    results_history: RwLock<Vec<AuctionResult>>,
}

impl AuctionEngine {
    pub fn new() -> Self {
        Self {
            auctions: RwLock::new(HashMap::new()),
            results_history: RwLock::new(Vec::new()),
        }
    }

    /// Start an auction phase for a symbol.
    pub fn start_auction(&self, symbol: &str, phase: AuctionPhase) {
        let mut auctions = self.auctions.write();
        let auction = auctions.entry(symbol.to_string()).or_insert(SymbolAuction {
            phase: AuctionPhase::Continuous,
            buy_orders: Vec::new(),
            sell_orders: Vec::new(),
            last_result: None,
        });
        auction.phase = phase;
        auction.buy_orders.clear();
        auction.sell_orders.clear();
        info!("Auction started for {}: {:?}", symbol, phase);
    }

    /// Submit an order to the current auction.
    pub fn submit_auction_order(&self, order: AuctionOrder) -> Result<(), String> {
        let mut auctions = self.auctions.write();
        let auction = auctions
            .get_mut(&order.symbol)
            .ok_or_else(|| format!("No active auction for {}", order.symbol))?;

        match auction.phase {
            AuctionPhase::PreOpen
            | AuctionPhase::OpeningAuction
            | AuctionPhase::PreClose
            | AuctionPhase::ClosingAuction
            | AuctionPhase::ReopeningAuction => {}
            _ => return Err(format!("No auction accepting orders for {}", order.symbol)),
        }

        match order.side {
            Side::Buy => auction.buy_orders.push(order),
            Side::Sell => auction.sell_orders.push(order),
        }
        Ok(())
    }

    /// Calculate indicative auction data.
    pub fn indicative_data(&self, symbol: &str) -> Option<IndicativeData> {
        let auctions = self.auctions.read();
        let auction = auctions.get(symbol)?;

        let (price, volume, imbalance, imbalance_side) =
            Self::calculate_equilibrium(&auction.buy_orders, &auction.sell_orders);

        Some(IndicativeData {
            symbol: symbol.to_string(),
            indicative_price: price,
            indicative_volume: volume,
            imbalance_volume: imbalance,
            imbalance_side,
            buy_orders: auction.buy_orders.len(),
            sell_orders: auction.sell_orders.len(),
            timestamp: Utc::now(),
        })
    }

    /// Run the auction: calculate equilibrium price, match orders, produce trades.
    pub fn run_auction(&self, symbol: &str) -> Option<AuctionResult> {
        let mut auctions = self.auctions.write();
        let auction = auctions.get_mut(symbol)?;

        let phase = auction.phase;
        let (eq_price, matched_vol, imbalance, imbalance_side) =
            Self::calculate_equilibrium(&auction.buy_orders, &auction.sell_orders);

        if eq_price == 0 {
            warn!("Auction for {} produced no equilibrium price", symbol);
            auction.phase = AuctionPhase::Continuous;
            return None;
        }

        // Match orders at equilibrium price
        let mut trades = Vec::new();
        let mut buy_orders: Vec<_> = auction
            .buy_orders
            .iter()
            .filter(|o| {
                o.order_type == AuctionOrderType::MarketOnOpen
                    || o.order_type == AuctionOrderType::MarketOnClose
                    || o.price >= eq_price
            })
            .cloned()
            .collect();
        let mut sell_orders: Vec<_> = auction
            .sell_orders
            .iter()
            .filter(|o| {
                o.order_type == AuctionOrderType::MarketOnOpen
                    || o.order_type == AuctionOrderType::MarketOnClose
                    || o.price <= eq_price
            })
            .cloned()
            .collect();

        // Sort: buys descending by price, sells ascending
        buy_orders.sort_by(|a, b| b.price.cmp(&a.price));
        sell_orders.sort_by(|a, b| a.price.cmp(&b.price));

        let mut buy_idx = 0;
        let mut sell_idx = 0;
        let mut buy_remaining: Vec<Qty> = buy_orders.iter().map(|o| o.quantity).collect();
        let mut sell_remaining: Vec<Qty> = sell_orders.iter().map(|o| o.quantity).collect();

        while buy_idx < buy_orders.len() && sell_idx < sell_orders.len() {
            if buy_remaining[buy_idx] == 0 {
                buy_idx += 1;
                continue;
            }
            if sell_remaining[sell_idx] == 0 {
                sell_idx += 1;
                continue;
            }

            let fill_qty = buy_remaining[buy_idx].min(sell_remaining[sell_idx]);
            buy_remaining[buy_idx] -= fill_qty;
            sell_remaining[sell_idx] -= fill_qty;

            trades.push(AuctionTrade {
                id: uuid::Uuid::new_v4(),
                symbol: symbol.to_string(),
                price: eq_price,
                quantity: fill_qty,
                buyer_account: buy_orders[buy_idx].account_id.clone(),
                seller_account: sell_orders[sell_idx].account_id.clone(),
                timestamp: Utc::now(),
            });
        }

        let total_participating = auction.buy_orders.len() + auction.sell_orders.len();

        let result = AuctionResult {
            symbol: symbol.to_string(),
            auction_type: phase,
            equilibrium_price: eq_price,
            matched_volume: matched_vol,
            imbalance_volume: imbalance,
            imbalance_side,
            participating_orders: total_participating,
            trades,
            completed_at: Utc::now(),
        };

        auction.last_result = Some(result.clone());
        auction.phase = AuctionPhase::Continuous;

        info!(
            "Auction completed for {}: price={}, vol={}, trades={}",
            symbol,
            from_price(eq_price),
            matched_vol,
            result.trades.len()
        );

        drop(auctions);
        self.results_history.write().push(result.clone());
        Some(result)
    }

    /// Calculate equilibrium price that maximizes volume.
    fn calculate_equilibrium(
        buy_orders: &[AuctionOrder],
        sell_orders: &[AuctionOrder],
    ) -> (Price, Qty, i64, Option<Side>) {
        if buy_orders.is_empty() || sell_orders.is_empty() {
            return (0, 0, 0, None);
        }

        // Collect all unique price levels
        let mut prices: Vec<Price> = Vec::new();
        for o in buy_orders.iter().chain(sell_orders.iter()) {
            if o.price > 0 && !prices.contains(&o.price) {
                prices.push(o.price);
            }
        }
        prices.sort();

        let mut best_price: Price = 0;
        let mut best_volume: Qty = 0;
        let mut best_imbalance: i64 = 0;

        for &candidate_price in &prices {
            let buy_vol: Qty = buy_orders
                .iter()
                .filter(|o| {
                    o.order_type == AuctionOrderType::MarketOnOpen
                        || o.order_type == AuctionOrderType::MarketOnClose
                        || o.price >= candidate_price
                })
                .map(|o| o.quantity)
                .sum();

            let sell_vol: Qty = sell_orders
                .iter()
                .filter(|o| {
                    o.order_type == AuctionOrderType::MarketOnOpen
                        || o.order_type == AuctionOrderType::MarketOnClose
                        || o.price <= candidate_price
                })
                .map(|o| o.quantity)
                .sum();

            let matched = buy_vol.min(sell_vol);
            if matched > best_volume {
                best_volume = matched;
                best_price = candidate_price;
                best_imbalance = buy_vol as i64 - sell_vol as i64;
            }
        }

        let imbalance_side = if best_imbalance > 0 {
            Some(Side::Buy)
        } else if best_imbalance < 0 {
            Some(Side::Sell)
        } else {
            None
        };

        (best_price, best_volume, best_imbalance, imbalance_side)
    }

    /// Get current phase for a symbol.
    pub fn get_phase(&self, symbol: &str) -> AuctionPhase {
        self.auctions
            .read()
            .get(symbol)
            .map(|a| a.phase)
            .unwrap_or(AuctionPhase::Continuous)
    }

    /// Get all active auctions.
    pub fn active_auctions(&self) -> Vec<serde_json::Value> {
        self.auctions
            .read()
            .iter()
            .filter(|(_, a)| a.phase != AuctionPhase::Continuous)
            .map(|(sym, a)| {
                serde_json::json!({
                    "symbol": sym,
                    "phase": a.phase,
                    "buy_orders": a.buy_orders.len(),
                    "sell_orders": a.sell_orders.len(),
                })
            })
            .collect()
    }

    /// Get auction history.
    pub fn auction_history(&self) -> Vec<AuctionResult> {
        self.results_history
            .read()
            .iter()
            .rev()
            .take(100)
            .cloned()
            .collect()
    }

    pub fn result_count(&self) -> usize {
        self.results_history.read().len()
    }
}

impl Default for AuctionEngine {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_auction_order(
        symbol: &str,
        side: Side,
        price: f64,
        qty: Qty,
        order_type: AuctionOrderType,
    ) -> AuctionOrder {
        AuctionOrder {
            id: uuid::Uuid::new_v4(),
            symbol: symbol.to_string(),
            side,
            price: to_price(price),
            quantity: qty,
            account_id: format!("ACC-{:?}-{}", side, price),
            order_type,
            submitted_at: Utc::now(),
        }
    }

    #[test]
    fn test_opening_auction() {
        let engine = AuctionEngine::new();
        engine.start_auction("GOLD", AuctionPhase::OpeningAuction);

        engine
            .submit_auction_order(make_auction_order(
                "GOLD",
                Side::Buy,
                2350.0,
                100,
                AuctionOrderType::Limit,
            ))
            .unwrap();
        engine
            .submit_auction_order(make_auction_order(
                "GOLD",
                Side::Buy,
                2340.0,
                50,
                AuctionOrderType::Limit,
            ))
            .unwrap();
        engine
            .submit_auction_order(make_auction_order(
                "GOLD",
                Side::Sell,
                2340.0,
                80,
                AuctionOrderType::Limit,
            ))
            .unwrap();
        engine
            .submit_auction_order(make_auction_order(
                "GOLD",
                Side::Sell,
                2350.0,
                120,
                AuctionOrderType::Limit,
            ))
            .unwrap();

        let result = engine.run_auction("GOLD").unwrap();
        assert!(result.equilibrium_price > 0);
        assert!(result.matched_volume > 0);
        assert!(!result.trades.is_empty());
    }

    #[test]
    fn test_indicative_data() {
        let engine = AuctionEngine::new();
        engine.start_auction("COFFEE", AuctionPhase::PreOpen);

        engine
            .submit_auction_order(make_auction_order(
                "COFFEE",
                Side::Buy,
                4500.0,
                100,
                AuctionOrderType::MarketOnOpen,
            ))
            .unwrap();
        engine
            .submit_auction_order(make_auction_order(
                "COFFEE",
                Side::Sell,
                4500.0,
                80,
                AuctionOrderType::Limit,
            ))
            .unwrap();

        let data = engine.indicative_data("COFFEE").unwrap();
        assert_eq!(data.buy_orders, 1);
        assert_eq!(data.sell_orders, 1);
    }

    #[test]
    fn test_no_auction_rejects_order() {
        let engine = AuctionEngine::new();
        let result = engine.submit_auction_order(make_auction_order(
            "GOLD",
            Side::Buy,
            2350.0,
            100,
            AuctionOrderType::Limit,
        ));
        assert!(result.is_err());
    }

    #[test]
    fn test_auction_phases() {
        let engine = AuctionEngine::new();
        assert_eq!(engine.get_phase("GOLD"), AuctionPhase::Continuous);
        engine.start_auction("GOLD", AuctionPhase::PreOpen);
        assert_eq!(engine.get_phase("GOLD"), AuctionPhase::PreOpen);
    }
}
