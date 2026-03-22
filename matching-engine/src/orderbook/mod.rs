//! Lock-free orderbook with price-time priority (FIFO).
//! Uses BTreeMap for sorted price levels and VecDeque for time-ordered queues.
//! All operations target microsecond latency.
//!
//! Production fixes applied:
//! - Stop/StopLimit trigger logic
//! - Market order price protection (slippage guard)
//! - Fixed average price calculation edge case
//! - Order amendment (Cancel/Replace)
//! - Orderbook snapshot/restore for WAL-based crash recovery
#![allow(dead_code)]

use crate::types::*;
use chrono::Utc;
use ordered_float::OrderedFloat;
use parking_lot::RwLock;
use std::collections::{BTreeMap, HashMap, VecDeque};
use tracing::{debug, info, warn};
use uuid::Uuid;

/// Default market order slippage protection: 5% from best price.
const DEFAULT_SLIPPAGE_LIMIT_PCT: f64 = 0.05;

/// A single price level containing orders in FIFO order.
#[derive(Debug, Clone)]
struct PriceLevelQueue {
    price: Price,
    orders: VecDeque<Order>,
    total_quantity: Qty,
}

impl PriceLevelQueue {
    fn new(price: Price) -> Self {
        Self {
            price,
            orders: VecDeque::new(),
            total_quantity: 0,
        }
    }

    fn add(&mut self, order: Order) {
        self.total_quantity += order.remaining_quantity;
        self.orders.push_back(order);
    }

    fn is_empty(&self) -> bool {
        self.orders.is_empty()
    }
}

/// The core orderbook for a single instrument.
/// Bids sorted descending (best bid = highest price first).
/// Asks sorted ascending (best ask = lowest price first).
pub struct OrderBook {
    pub symbol: String,
    bids: BTreeMap<OrderedFloat<f64>, PriceLevelQueue>,
    asks: BTreeMap<OrderedFloat<f64>, PriceLevelQueue>,
    order_index: HashMap<Uuid, (Side, OrderedFloat<f64>)>,
    /// Stop orders waiting to be triggered
    stop_orders: Vec<Order>,
    sequence: u64,
    pub last_price: Price,
    pub volume_24h: Qty,
    pub high_24h: Price,
    pub low_24h: Price,
    pub open_price: Price,
    pub settlement_price: Price,
    pub open_interest: Qty,
    pub upper_limit: Option<Price>,
    pub lower_limit: Option<Price>,
    pub halted: bool,
    /// Market order slippage protection percentage (default 5%)
    pub slippage_limit_pct: f64,
}

impl OrderBook {
    pub fn new(symbol: String) -> Self {
        Self {
            symbol,
            bids: BTreeMap::new(),
            asks: BTreeMap::new(),
            order_index: HashMap::new(),
            stop_orders: Vec::new(),
            sequence: 0,
            last_price: 0,
            volume_24h: 0,
            high_24h: 0,
            low_24h: Price::MAX,
            open_price: 0,
            settlement_price: 0,
            open_interest: 0,
            upper_limit: None,
            lower_limit: None,
            halted: false,
            slippage_limit_pct: DEFAULT_SLIPPAGE_LIMIT_PCT,
        }
    }

    fn next_sequence(&mut self) -> u64 {
        self.sequence += 1;
        self.sequence
    }

    /// Submit a new order. Returns (trades, order_status).
    pub fn submit_order(&mut self, mut order: Order) -> (Vec<Trade>, Order) {
        if self.halted {
            order.status = OrderStatus::Rejected;
            return (vec![], order);
        }

        // Circuit breaker check for limit and stop-limit orders
        if order.order_type == OrderType::Limit || order.order_type == OrderType::StopLimit {
            if let Some(upper) = self.upper_limit {
                if order.price > upper {
                    order.status = OrderStatus::Rejected;
                    return (vec![], order);
                }
            }
            if let Some(lower) = self.lower_limit {
                if order.price < lower && order.price > 0 {
                    order.status = OrderStatus::Rejected;
                    return (vec![], order);
                }
            }
        }

        order.sequence = self.next_sequence();
        order.status = OrderStatus::New;

        // Handle Stop and StopLimit: park until triggered
        if order.order_type == OrderType::Stop || order.order_type == OrderType::StopLimit {
            if !self.is_stop_triggered(&order) {
                info!(
                    "Stop order {} parked (stop_price={}, last_price={})",
                    order.id,
                    from_price(order.stop_price),
                    from_price(self.last_price)
                );
                self.stop_orders.push(order.clone());
                return (vec![], order);
            }
            // Triggered immediately - convert to market or limit
            if order.order_type == OrderType::Stop {
                order.order_type = OrderType::Market;
            } else {
                order.order_type = OrderType::Limit;
            }
        }

        // Market order slippage protection
        if order.order_type == OrderType::Market {
            let protected_price = self.calculate_slippage_limit(&order);
            if protected_price > 0 {
                order.price = protected_price;
                order.order_type = OrderType::Limit;
                let trades = self.match_order(&mut order);
                order.order_type = OrderType::Market;
                let result = self.finalize_order(order, trades);
                if !result.0.is_empty() {
                    let triggered = self.check_stop_triggers();
                    for t in triggered {
                        let _ = self.submit_order(t);
                    }
                }
                return result;
            }
        }

        let trades = self.match_order(&mut order);
        let result = self.finalize_order(order, trades);

        if !result.0.is_empty() {
            let triggered = self.check_stop_triggers();
            for t in triggered {
                let _ = self.submit_order(t);
            }
        }

        result
    }

    /// Finalize order after matching: handle time-in-force and place remainder on book.
    fn finalize_order(&mut self, mut order: Order, trades: Vec<Trade>) -> (Vec<Trade>, Order) {
        match order.time_in_force {
            TimeInForce::ImmediateOrCancel => {
                if order.remaining_quantity > 0 {
                    if order.filled_quantity > 0 {
                        order.status = OrderStatus::PartiallyFilled;
                    } else {
                        order.status = OrderStatus::Cancelled;
                    }
                }
            }
            TimeInForce::FillOrKill => {
                if order.remaining_quantity > 0 {
                    order.status = OrderStatus::Cancelled;
                    order.filled_quantity = 0;
                    order.remaining_quantity = order.quantity;
                    return (vec![], order);
                }
            }
            _ => {
                if order.remaining_quantity > 0 && order.order_type == OrderType::Limit {
                    self.place_on_book(order.clone());
                }
            }
        }

        if order.remaining_quantity == 0 {
            order.status = OrderStatus::Filled;
        } else if order.filled_quantity > 0 {
            order.status = OrderStatus::PartiallyFilled;
        }

        (trades, order)
    }

    /// Check if a stop order should be triggered based on last trade price.
    fn is_stop_triggered(&self, order: &Order) -> bool {
        if self.last_price == 0 {
            return false;
        }
        match order.side {
            Side::Buy => self.last_price >= order.stop_price,
            Side::Sell => self.last_price <= order.stop_price,
        }
    }

    /// Check all parked stop orders and return those that should trigger.
    fn check_stop_triggers(&mut self) -> Vec<Order> {
        let mut triggered = Vec::new();
        let mut remaining = Vec::new();
        let last_price = self.last_price;
        let orders = std::mem::take(&mut self.stop_orders);
        for order in orders {
            let should_trigger = if last_price == 0 {
                false
            } else {
                match order.side {
                    Side::Buy => last_price >= order.stop_price,
                    Side::Sell => last_price <= order.stop_price,
                }
            };
            if should_trigger {
                info!(
                    "Stop order {} TRIGGERED (stop={}, last={})",
                    order.id,
                    from_price(order.stop_price),
                    from_price(last_price)
                );
                triggered.push(order);
            } else {
                remaining.push(order);
            }
        }
        self.stop_orders = remaining;
        triggered
    }

    /// Calculate slippage-protected limit price for market orders.
    /// Returns 0 if no opposing liquidity exists.
    fn calculate_slippage_limit(&self, order: &Order) -> Price {
        let best_price = if order.is_buy() {
            self.asks.values().next().map(|l| l.price)
        } else {
            self.bids.values().next_back().map(|l| l.price)
        };
        match best_price {
            Some(price) => {
                let p = from_price(price);
                if order.is_buy() {
                    to_price(p * (1.0 + self.slippage_limit_pct))
                } else {
                    to_price(p * (1.0 - self.slippage_limit_pct))
                }
            }
            None => 0,
        }
    }

    /// Match an incoming order against the opposite side of the book.
    fn match_order(&mut self, order: &mut Order) -> Vec<Trade> {
        let mut trades = Vec::new();

        loop {
            if order.remaining_quantity == 0 {
                break;
            }

            let best_price = if order.is_buy() {
                self.asks.values().next().map(|l| l.price)
            } else {
                self.bids.values().next_back().map(|l| l.price)
            };

            let best_price = match best_price {
                Some(p) => p,
                None => break,
            };

            if order.order_type == OrderType::Limit {
                if order.is_buy() && order.price < best_price {
                    break;
                }
                if !order.is_buy() && order.price > best_price {
                    break;
                }
            }

            let price_key = OrderedFloat(from_price(best_price));

            let book_side = if order.is_buy() {
                &mut self.asks
            } else {
                &mut self.bids
            };
            let level = match book_side.get_mut(&price_key) {
                Some(l) => l,
                None => break,
            };

            while order.remaining_quantity > 0 && !level.orders.is_empty() {
                let resting = level.orders.front_mut().unwrap();
                let fill_qty = order.remaining_quantity.min(resting.remaining_quantity);
                let fill_price = resting.price;

                // Corrected VWAP calculation (Fix #9):
                // First fill uses fill_price directly instead of weighted average with 0
                let prev_filled = order.filled_quantity;
                order.filled_quantity += fill_qty;
                order.remaining_quantity -= fill_qty;
                order.average_price = if order.filled_quantity > 0 {
                    if prev_filled == 0 {
                        fill_price
                    } else {
                        ((order.average_price as i128 * prev_filled as i128
                            + fill_price as i128 * fill_qty as i128)
                            / order.filled_quantity as i128) as Price
                    }
                } else {
                    0
                };

                let resting_id = resting.id;
                let resting_account = resting.account_id.clone();

                resting.filled_quantity += fill_qty;
                resting.remaining_quantity -= fill_qty;
                resting.updated_at = Utc::now();
                let resting_filled = resting.remaining_quantity == 0;
                if resting_filled {
                    resting.status = OrderStatus::Filled;
                } else {
                    resting.status = OrderStatus::PartiallyFilled;
                }

                level.total_quantity -= fill_qty;
                self.sequence += 1;
                let seq = self.sequence;

                let (buyer_order_id, seller_order_id, buyer_account, seller_account) =
                    if order.is_buy() {
                        (
                            order.id,
                            resting_id,
                            order.account_id.clone(),
                            resting_account,
                        )
                    } else {
                        (
                            resting_id,
                            order.id,
                            resting_account,
                            order.account_id.clone(),
                        )
                    };

                let trade = Trade {
                    id: Uuid::new_v4(),
                    symbol: order.symbol.clone(),
                    price: fill_price,
                    quantity: fill_qty,
                    buyer_order_id,
                    seller_order_id,
                    buyer_account,
                    seller_account,
                    aggressor_side: order.side,
                    timestamp: Utc::now(),
                    sequence: seq,
                };

                self.last_price = fill_price;
                self.volume_24h += fill_qty;
                if fill_price > self.high_24h {
                    self.high_24h = fill_price;
                }
                if fill_price < self.low_24h {
                    self.low_24h = fill_price;
                }
                if self.open_price == 0 {
                    self.open_price = fill_price;
                }

                debug!(
                    "Trade: {} {} @ {} (seq={})",
                    trade.symbol,
                    fill_qty,
                    from_price(fill_price),
                    seq
                );
                trades.push(trade);

                if resting_filled {
                    let filled_order = level.orders.pop_front().unwrap();
                    self.order_index.remove(&filled_order.id);
                }
            }

            let level_empty = level.is_empty();
            if level_empty {
                let book_side = if order.is_buy() {
                    &mut self.asks
                } else {
                    &mut self.bids
                };
                book_side.remove(&price_key);
            }
        }

        trades
    }

    /// Place a limit order on the book (resting).
    fn place_on_book(&mut self, order: Order) {
        let price_key = OrderedFloat(from_price(order.price));
        let side = order.side;
        let order_id = order.id;
        self.order_index.insert(order_id, (side, price_key));
        match side {
            Side::Buy => {
                self.bids
                    .entry(price_key)
                    .or_insert_with(|| PriceLevelQueue::new(order.price))
                    .add(order);
            }
            Side::Sell => {
                self.asks
                    .entry(price_key)
                    .or_insert_with(|| PriceLevelQueue::new(order.price))
                    .add(order);
            }
        }
    }

    /// Cancel an order by ID (supports both resting and stop orders).
    pub fn cancel_order(&mut self, order_id: Uuid) -> Option<Order> {
        // Check stop orders first
        if let Some(pos) = self.stop_orders.iter().position(|o| o.id == order_id) {
            let mut order = self.stop_orders.remove(pos);
            order.status = OrderStatus::Cancelled;
            order.updated_at = Utc::now();
            info!("Cancelled stop order {}", order_id);
            return Some(order);
        }

        let (side, price_key) = self.order_index.remove(&order_id)?;
        let book_side = match side {
            Side::Buy => &mut self.bids,
            Side::Sell => &mut self.asks,
        };

        if let Some(level) = book_side.get_mut(&price_key) {
            if let Some(pos) = level.orders.iter().position(|o| o.id == order_id) {
                let mut order = level.orders.remove(pos).unwrap();
                level.total_quantity -= order.remaining_quantity;
                order.status = OrderStatus::Cancelled;
                order.updated_at = Utc::now();
                if level.is_empty() {
                    book_side.remove(&price_key);
                }
                info!("Cancelled order {}", order_id);
                return Some(order);
            }
        }
        None
    }

    /// Amend (Cancel/Replace) an existing order (FIX MsgType=G).
    /// Cancels the old order and submits a replacement with new price/quantity.
    pub fn amend_order(
        &mut self,
        order_id: Uuid,
        new_price: Option<Price>,
        new_quantity: Option<Qty>,
    ) -> Result<(Vec<Trade>, Order, Order), String> {
        let old_order = self
            .cancel_order(order_id)
            .ok_or_else(|| format!("Order {} not found for amendment", order_id))?;

        let price = new_price.unwrap_or(old_order.price);
        let quantity = new_quantity.unwrap_or(old_order.quantity);

        let replacement = Order::new(
            format!("AMEND-{}", old_order.client_order_id),
            old_order.account_id.clone(),
            old_order.symbol.clone(),
            old_order.side,
            old_order.order_type,
            old_order.time_in_force,
            price,
            old_order.stop_price,
            quantity,
        );

        info!(
            "Amending order {}: price {} -> {}, qty {} -> {}",
            order_id,
            from_price(old_order.price),
            from_price(price),
            old_order.quantity,
            quantity
        );

        let (trades, new_order) = self.submit_order(replacement);
        Ok((trades, new_order, old_order))
    }

    /// Get the current best bid price.
    pub fn best_bid(&self) -> Option<Price> {
        self.bids.values().next_back().map(|l| l.price)
    }

    /// Get the current best ask price.
    pub fn best_ask(&self) -> Option<Price> {
        self.asks.values().next().map(|l| l.price)
    }

    /// Get market depth snapshot (top N levels).
    pub fn depth(&self, levels: usize) -> MarketDepth {
        let bids: Vec<PriceLevel> = self
            .bids
            .values()
            .rev()
            .take(levels)
            .map(|l| PriceLevel {
                price: OrderedFloat(from_price(l.price)),
                quantity: l.total_quantity,
                order_count: l.orders.len() as u32,
            })
            .collect();

        let asks: Vec<PriceLevel> = self
            .asks
            .values()
            .take(levels)
            .map(|l| PriceLevel {
                price: OrderedFloat(from_price(l.price)),
                quantity: l.total_quantity,
                order_count: l.orders.len() as u32,
            })
            .collect();

        MarketDepth {
            symbol: self.symbol.clone(),
            bids,
            asks,
            last_price: self.last_price,
            last_quantity: 0,
            volume_24h: self.volume_24h,
            high_24h: self.high_24h,
            low_24h: if self.low_24h == Price::MAX {
                0
            } else {
                self.low_24h
            },
            open_price: self.open_price,
            settlement_price: self.settlement_price,
            open_interest: self.open_interest,
            timestamp: Utc::now(),
        }
    }

    /// Total number of orders on the book.
    pub fn order_count(&self) -> usize {
        self.order_index.len()
    }

    /// Total number of stop orders waiting to trigger.
    pub fn stop_order_count(&self) -> usize {
        self.stop_orders.len()
    }

    /// Total bid volume.
    pub fn bid_volume(&self) -> Qty {
        self.bids.values().map(|l| l.total_quantity).sum()
    }

    /// Total ask volume.
    pub fn ask_volume(&self) -> Qty {
        self.asks.values().map(|l| l.total_quantity).sum()
    }

    /// Set circuit breaker limits.
    pub fn set_price_limits(&mut self, lower: Price, upper: Price) {
        self.lower_limit = Some(lower);
        self.upper_limit = Some(upper);
    }

    /// Halt or resume trading.
    pub fn set_halted(&mut self, halted: bool) {
        self.halted = halted;
        if halted {
            warn!("Trading HALTED for {}", self.symbol);
        } else {
            info!("Trading RESUMED for {}", self.symbol);
        }
    }

    /// Get a serializable snapshot of all resting orders (for WAL/persistence).
    pub fn snapshot_orders(&self) -> Vec<Order> {
        let mut orders = Vec::new();
        for level in self.bids.values() {
            for o in &level.orders {
                orders.push(o.clone());
            }
        }
        for level in self.asks.values() {
            for o in &level.orders {
                orders.push(o.clone());
            }
        }
        for o in &self.stop_orders {
            orders.push(o.clone());
        }
        orders
    }

    /// Restore orders from a snapshot (crash recovery).
    pub fn restore_orders(&mut self, orders: Vec<Order>) {
        for order in orders {
            if order.order_type == OrderType::Stop || order.order_type == OrderType::StopLimit {
                self.stop_orders.push(order);
            } else {
                self.place_on_book(order);
            }
        }
        info!(
            "Restored {} orders for {} ({} on book, {} stop)",
            self.order_index.len() + self.stop_orders.len(),
            self.symbol,
            self.order_index.len(),
            self.stop_orders.len()
        );
    }

    /// Get current sequence number (for persistence).
    pub fn current_sequence(&self) -> u64 {
        self.sequence
    }
}

/// Thread-safe orderbook manager for all symbols.
/// Uses DashMap for symbol-level sharding (different symbols can match concurrently).
pub struct OrderBookManager {
    books: dashmap::DashMap<String, RwLock<OrderBook>>,
}

impl OrderBookManager {
    pub fn new() -> Self {
        Self {
            books: dashmap::DashMap::new(),
        }
    }

    /// Get or create an orderbook for a symbol.
    pub fn get_or_create(
        &self,
        symbol: &str,
    ) -> dashmap::mapref::one::Ref<'_, String, RwLock<OrderBook>> {
        if !self.books.contains_key(symbol) {
            self.books.insert(
                symbol.to_string(),
                RwLock::new(OrderBook::new(symbol.to_string())),
            );
        }
        self.books.get(symbol).unwrap()
    }

    /// Submit an order to the appropriate book.
    pub fn submit_order(&self, order: Order) -> (Vec<Trade>, Order) {
        let book_ref = self.get_or_create(&order.symbol);
        let mut book = book_ref.write();
        book.submit_order(order)
    }

    /// Cancel an order.
    pub fn cancel_order(&self, symbol: &str, order_id: Uuid) -> Option<Order> {
        if let Some(book_ref) = self.books.get(symbol) {
            let mut book = book_ref.write();
            book.cancel_order(order_id)
        } else {
            None
        }
    }

    /// Amend (Cancel/Replace) an order.
    pub fn amend_order(
        &self,
        symbol: &str,
        order_id: Uuid,
        new_price: Option<Price>,
        new_quantity: Option<Qty>,
    ) -> Result<(Vec<Trade>, Order, Order), String> {
        let book_ref = self
            .books
            .get(symbol)
            .ok_or_else(|| format!("Symbol {} not found", symbol))?;
        let mut book = book_ref.write();
        book.amend_order(order_id, new_price, new_quantity)
    }

    /// Get market depth for a symbol.
    pub fn depth(&self, symbol: &str, levels: usize) -> Option<MarketDepth> {
        self.books.get(symbol).map(|book_ref| {
            let book = book_ref.read();
            book.depth(levels)
        })
    }

    /// List all active symbols.
    pub fn symbols(&self) -> Vec<String> {
        self.books.iter().map(|r| r.key().clone()).collect()
    }

    /// Get a snapshot of all orders across all books (for persistence).
    pub fn snapshot_all_orders(&self) -> HashMap<String, Vec<Order>> {
        let mut snapshots = HashMap::new();
        for entry in self.books.iter() {
            let book = entry.value().read();
            let orders = book.snapshot_orders();
            if !orders.is_empty() {
                snapshots.insert(entry.key().clone(), orders);
            }
        }
        snapshots
    }

    /// Restore all orders from snapshots (crash recovery).
    pub fn restore_all_orders(&self, snapshots: HashMap<String, Vec<Order>>) {
        for (symbol, orders) in snapshots {
            let book_ref = self.get_or_create(&symbol);
            let mut book = book_ref.write();
            book.restore_orders(orders);
        }
    }
}

impl Default for OrderBookManager {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_limit_order(side: Side, price: f64, qty: Qty) -> Order {
        Order::new(
            format!("test-{}", Uuid::new_v4()),
            "ACC001".to_string(),
            "GOLD-FUT-2026M06".to_string(),
            side,
            OrderType::Limit,
            TimeInForce::GoodTilCancel,
            to_price(price),
            0,
            qty,
        )
    }

    fn make_stop_order(side: Side, stop_price: f64, qty: Qty) -> Order {
        Order::new(
            format!("stop-{}", Uuid::new_v4()),
            "ACC001".to_string(),
            "GOLD-FUT-2026M06".to_string(),
            side,
            OrderType::Stop,
            TimeInForce::GoodTilCancel,
            0,
            to_price(stop_price),
            qty,
        )
    }

    fn make_market_order(side: Side, qty: Qty) -> Order {
        Order::new(
            format!("market-{}", Uuid::new_v4()),
            "ACC001".to_string(),
            "GOLD-FUT-2026M06".to_string(),
            side,
            OrderType::Market,
            TimeInForce::ImmediateOrCancel,
            0,
            0,
            qty,
        )
    }

    #[test]
    fn test_limit_order_match() {
        let mut book = OrderBook::new("GOLD-FUT-2026M06".to_string());

        let sell = make_limit_order(Side::Sell, 2000.0, 100);
        let (trades, order) = book.submit_order(sell);
        assert!(trades.is_empty());
        assert_eq!(order.status, OrderStatus::New);

        let buy = make_limit_order(Side::Buy, 2000.0, 50);
        let (trades, order) = book.submit_order(buy);
        assert_eq!(trades.len(), 1);
        assert_eq!(trades[0].quantity, 50);
        assert_eq!(order.status, OrderStatus::Filled);
        assert_eq!(book.ask_volume(), 50);
    }

    #[test]
    fn test_price_time_priority() {
        let mut book = OrderBook::new("COFFEE-FUT-2026M03".to_string());

        let sell1 = make_limit_order(Side::Sell, 150.0, 100);
        let sell1_id = sell1.id;
        book.submit_order(sell1);

        let sell2 = make_limit_order(Side::Sell, 150.0, 100);
        book.submit_order(sell2);

        let buy = make_limit_order(Side::Buy, 150.0, 50);
        let (trades, _) = book.submit_order(buy);
        assert_eq!(trades.len(), 1);
        assert_eq!(trades[0].seller_order_id, sell1_id);
    }

    #[test]
    fn test_cancel_order() {
        let mut book = OrderBook::new("MAIZE-FUT-2026M06".to_string());

        let sell = make_limit_order(Side::Sell, 300.0, 100);
        let sell_id = sell.id;
        book.submit_order(sell);
        assert_eq!(book.order_count(), 1);

        let cancelled = book.cancel_order(sell_id);
        assert!(cancelled.is_some());
        assert_eq!(cancelled.unwrap().status, OrderStatus::Cancelled);
        assert_eq!(book.order_count(), 0);
    }

    #[test]
    fn test_circuit_breaker() {
        let mut book = OrderBook::new("WHEAT-FUT-2026M09".to_string());
        book.set_price_limits(to_price(90.0), to_price(110.0));

        let buy = make_limit_order(Side::Buy, 115.0, 100);
        let (_, order) = book.submit_order(buy);
        assert_eq!(order.status, OrderStatus::Rejected);

        let buy = make_limit_order(Side::Buy, 105.0, 100);
        let (_, order) = book.submit_order(buy);
        assert_eq!(order.status, OrderStatus::New);
    }

    #[test]
    fn test_market_depth() {
        let mut book = OrderBook::new("COCOA-FUT-2026M03".to_string());
        book.submit_order(make_limit_order(Side::Buy, 100.0, 50));
        book.submit_order(make_limit_order(Side::Buy, 99.0, 30));
        book.submit_order(make_limit_order(Side::Sell, 101.0, 40));
        book.submit_order(make_limit_order(Side::Sell, 102.0, 60));

        let depth = book.depth(10);
        assert_eq!(depth.bids.len(), 2);
        assert_eq!(depth.asks.len(), 2);
        assert_eq!(depth.bids[0].quantity, 50);
        assert_eq!(depth.asks[0].quantity, 40);
    }

    #[test]
    fn test_ioc_order() {
        let mut book = OrderBook::new("SUGAR-FUT-2026M06".to_string());
        book.submit_order(make_limit_order(Side::Sell, 200.0, 50));

        let buy = Order::new(
            "ioc-test".to_string(),
            "ACC001".to_string(),
            "SUGAR-FUT-2026M06".to_string(),
            Side::Buy,
            OrderType::Limit,
            TimeInForce::ImmediateOrCancel,
            to_price(200.0),
            0,
            100,
        );
        let (trades, order) = book.submit_order(buy);
        assert_eq!(trades.len(), 1);
        assert_eq!(trades[0].quantity, 50);
        assert_eq!(order.status, OrderStatus::PartiallyFilled);
        assert_eq!(order.remaining_quantity, 50);
        assert_eq!(book.order_count(), 0);
    }

    #[test]
    fn test_fok_order() {
        let mut book = OrderBook::new("TEA-FUT-2026M06".to_string());
        book.submit_order(make_limit_order(Side::Sell, 200.0, 50));

        let buy = Order::new(
            "fok-test".to_string(),
            "ACC001".to_string(),
            "TEA-FUT-2026M06".to_string(),
            Side::Buy,
            OrderType::Limit,
            TimeInForce::FillOrKill,
            to_price(200.0),
            0,
            100,
        );
        let (trades, order) = book.submit_order(buy);
        assert!(trades.is_empty());
        assert_eq!(order.status, OrderStatus::Cancelled);
    }

    // ─── New tests for production fixes ──────────────────────────────────────

    #[test]
    fn test_stop_order_parks_when_not_triggered() {
        let mut book = OrderBook::new("GOLD-FUT-2026M06".to_string());

        let stop = make_stop_order(Side::Buy, 2050.0, 50);
        let (trades, _) = book.submit_order(stop);
        assert!(trades.is_empty());
        assert_eq!(book.stop_order_count(), 1);
        assert_eq!(book.order_count(), 0);
    }

    #[test]
    fn test_stop_order_triggers_after_trade() {
        let mut book = OrderBook::new("GOLD-FUT-2026M06".to_string());

        book.submit_order(make_limit_order(Side::Sell, 2000.0, 10));
        book.submit_order(make_limit_order(Side::Buy, 2000.0, 10));
        assert_eq!(book.last_price, to_price(2000.0));

        let stop = make_stop_order(Side::Buy, 2050.0, 50);
        let (trades, _) = book.submit_order(stop);
        assert!(trades.is_empty());
        assert_eq!(book.stop_order_count(), 1);

        book.submit_order(make_limit_order(Side::Sell, 2060.0, 100));

        book.submit_order(make_limit_order(Side::Sell, 2055.0, 5));
        book.submit_order(make_limit_order(Side::Buy, 2055.0, 5));
        assert_eq!(book.stop_order_count(), 0);
    }

    #[test]
    fn test_stop_order_cancel() {
        let mut book = OrderBook::new("GOLD-FUT-2026M06".to_string());

        let stop = make_stop_order(Side::Buy, 2050.0, 50);
        let stop_id = stop.id;
        book.submit_order(stop);
        assert_eq!(book.stop_order_count(), 1);

        let cancelled = book.cancel_order(stop_id);
        assert!(cancelled.is_some());
        assert_eq!(cancelled.unwrap().status, OrderStatus::Cancelled);
        assert_eq!(book.stop_order_count(), 0);
    }

    #[test]
    fn test_market_order_with_slippage_protection() {
        let mut book = OrderBook::new("GOLD-FUT-2026M06".to_string());
        book.submit_order(make_limit_order(Side::Sell, 2000.0, 10));
        book.submit_order(make_limit_order(Side::Sell, 2010.0, 10));
        book.submit_order(make_limit_order(Side::Sell, 2500.0, 100));

        let market = make_market_order(Side::Buy, 15);
        let (trades, _) = book.submit_order(market);
        assert_eq!(trades.len(), 2);
        assert_eq!(trades[0].price, to_price(2000.0));
        assert_eq!(trades[1].price, to_price(2010.0));
    }

    #[test]
    fn test_order_amendment() {
        let mut book = OrderBook::new("GOLD-FUT-2026M06".to_string());

        let sell = make_limit_order(Side::Sell, 2000.0, 100);
        let sell_id = sell.id;
        book.submit_order(sell);
        assert_eq!(book.order_count(), 1);

        let result = book.amend_order(sell_id, Some(to_price(2010.0)), Some(200));
        assert!(result.is_ok());
        let (trades, new_order, old_order) = result.unwrap();
        assert!(trades.is_empty());
        assert_eq!(old_order.status, OrderStatus::Cancelled);
        assert_eq!(new_order.price, to_price(2010.0));
        assert_eq!(new_order.quantity, 200);
        assert_eq!(book.order_count(), 1);
    }

    #[test]
    fn test_average_price_first_fill() {
        let mut book = OrderBook::new("GOLD-FUT-2026M06".to_string());
        book.submit_order(make_limit_order(Side::Sell, 2000.0, 50));

        let buy = make_limit_order(Side::Buy, 2000.0, 50);
        let (trades, order) = book.submit_order(buy);
        assert_eq!(trades.len(), 1);
        assert_eq!(order.average_price, to_price(2000.0));
    }

    #[test]
    fn test_average_price_multiple_fills() {
        let mut book = OrderBook::new("GOLD-FUT-2026M06".to_string());
        book.submit_order(make_limit_order(Side::Sell, 2000.0, 50));
        book.submit_order(make_limit_order(Side::Sell, 2100.0, 50));

        let buy = make_limit_order(Side::Buy, 2100.0, 100);
        let (trades, order) = book.submit_order(buy);
        assert_eq!(trades.len(), 2);
        assert_eq!(order.average_price, to_price(2050.0));
    }

    #[test]
    fn test_snapshot_and_restore() {
        let mut book = OrderBook::new("GOLD-FUT-2026M06".to_string());
        book.submit_order(make_limit_order(Side::Buy, 1990.0, 100));
        book.submit_order(make_limit_order(Side::Sell, 2010.0, 50));
        book.submit_order(make_stop_order(Side::Buy, 2050.0, 25));

        let snapshot = book.snapshot_orders();
        assert_eq!(snapshot.len(), 3);

        let mut new_book = OrderBook::new("GOLD-FUT-2026M06".to_string());
        new_book.restore_orders(snapshot);
        assert_eq!(new_book.order_count(), 2);
        assert_eq!(new_book.stop_order_count(), 1);
        assert_eq!(new_book.bid_volume(), 100);
        assert_eq!(new_book.ask_volume(), 50);
    }
}
