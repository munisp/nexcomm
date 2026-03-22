//! Market Data Infrastructure — Consolidated Tape, Ticker Plant, Distribution.
//! NYSE-equivalent market data dissemination system.
//! Implements:
//! - Consolidated tape (CTA/CQS equivalent)
//! - Ticker plant (real-time price/volume feed)
//! - Market data snapshots and incremental updates
//! - Level 1 (NBBO) and Level 2 (full depth) feeds
//! - Trade and quote (TAQ) data
#![allow(dead_code)]

use crate::types::*;
use chrono::{DateTime, Utc};
use parking_lot::RwLock;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, VecDeque};
use tracing::info;

/// A consolidated tape entry (trade report).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TapeEntry {
    pub sequence: u64,
    pub symbol: String,
    pub price: Price,
    pub quantity: Qty,
    pub side: Side,
    pub condition: TradeCondition,
    pub timestamp: DateTime<Utc>,
    pub exchange: String,
}

/// Trade condition flags (SIP protocol equivalent).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum TradeCondition {
    Regular,
    OpeningTrade,
    ClosingTrade,
    AuctionTrade,
    CrossTrade,
    OddLot,
    BlockTrade,
    LateReport,
}

/// NBBO (National Best Bid/Offer) — Level 1 quote.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NbboQuote {
    pub symbol: String,
    pub bid_price: Price,
    pub bid_size: Qty,
    pub ask_price: Price,
    pub ask_size: Qty,
    pub last_price: Price,
    pub last_size: Qty,
    pub volume: Qty,
    pub high: Price,
    pub low: Price,
    pub open: Price,
    pub close: Price,
    pub vwap: Price,
    pub timestamp: DateTime<Utc>,
}

/// Level 2 market data (full order book depth).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Level2Data {
    pub symbol: String,
    pub bids: Vec<DepthLevel>,
    pub asks: Vec<DepthLevel>,
    pub timestamp: DateTime<Utc>,
}

/// A single depth level in Level 2 data.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DepthLevel {
    pub price: f64,
    pub quantity: Qty,
    pub order_count: u32,
    pub market_maker_id: Option<String>,
}

/// Market data snapshot for a symbol.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MarketSnapshot {
    pub symbol: String,
    pub nbbo: NbboQuote,
    pub depth: Level2Data,
    pub recent_trades: Vec<TapeEntry>,
    pub daily_stats: DailyStats,
    pub generated_at: DateTime<Utc>,
}

/// Daily trading statistics.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DailyStats {
    pub symbol: String,
    pub open: Price,
    pub high: Price,
    pub low: Price,
    pub close: Price,
    pub volume: Qty,
    pub trade_count: u64,
    pub vwap: Price,
    pub turnover: f64,
    pub change_pct: f64,
}

/// Market data distribution channel type.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum FeedType {
    Level1,
    Level2,
    Tape,
    Stats,
}

/// Feed subscriber.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FeedSubscription {
    pub id: uuid::Uuid,
    pub client_id: String,
    pub symbols: Vec<String>,
    pub feed_type: FeedType,
    pub subscribed_at: DateTime<Utc>,
}

// ─── Consolidated Tape ──────────────────────────────────────────────────────

/// The consolidated tape — sequential record of all trades.
pub struct ConsolidatedTape {
    entries: RwLock<VecDeque<TapeEntry>>,
    sequence: RwLock<u64>,
    max_entries: usize,
}

impl ConsolidatedTape {
    pub fn new(max_entries: usize) -> Self {
        Self {
            entries: RwLock::new(VecDeque::new()),
            sequence: RwLock::new(0),
            max_entries,
        }
    }

    /// Record a trade on the tape.
    pub fn record_trade(
        &self,
        symbol: &str,
        price: Price,
        quantity: Qty,
        side: Side,
        condition: TradeCondition,
    ) -> TapeEntry {
        let mut seq = self.sequence.write();
        *seq += 1;
        let entry = TapeEntry {
            sequence: *seq,
            symbol: symbol.to_string(),
            price,
            quantity,
            side,
            condition,
            timestamp: Utc::now(),
            exchange: "NEXCOM".to_string(),
        };

        let mut entries = self.entries.write();
        entries.push_back(entry.clone());
        if entries.len() > self.max_entries {
            entries.pop_front();
        }

        entry
    }

    /// Get recent tape entries.
    pub fn recent(&self, count: usize) -> Vec<TapeEntry> {
        self.entries
            .read()
            .iter()
            .rev()
            .take(count)
            .cloned()
            .collect()
    }

    /// Get tape entries for a specific symbol.
    pub fn for_symbol(&self, symbol: &str, count: usize) -> Vec<TapeEntry> {
        self.entries
            .read()
            .iter()
            .rev()
            .filter(|e| e.symbol == symbol)
            .take(count)
            .cloned()
            .collect()
    }

    pub fn total_entries(&self) -> u64 {
        *self.sequence.read()
    }
}

// ─── Ticker Plant ───────────────────────────────────────────────────────────

/// The ticker plant — real-time NBBO and statistics.
pub struct TickerPlant {
    quotes: RwLock<HashMap<String, NbboQuote>>,
    daily_stats: RwLock<HashMap<String, DailyStats>>,
    subscriptions: RwLock<Vec<FeedSubscription>>,
    vwap_data: RwLock<HashMap<String, (f64, Qty)>>,
}

impl TickerPlant {
    pub fn new() -> Self {
        Self {
            quotes: RwLock::new(HashMap::new()),
            daily_stats: RwLock::new(HashMap::new()),
            subscriptions: RwLock::new(Vec::new()),
            vwap_data: RwLock::new(HashMap::new()),
        }
    }

    /// Update NBBO quote from a trade.
    pub fn update_from_trade(
        &self,
        symbol: &str,
        price: Price,
        quantity: Qty,
        bid: Option<Price>,
        ask: Option<Price>,
    ) {
        let mut quotes = self.quotes.write();
        let quote = quotes.entry(symbol.to_string()).or_insert(NbboQuote {
            symbol: symbol.to_string(),
            bid_price: 0,
            bid_size: 0,
            ask_price: 0,
            ask_size: 0,
            last_price: 0,
            last_size: 0,
            volume: 0,
            high: 0,
            low: Price::MAX,
            open: 0,
            close: 0,
            vwap: 0,
            timestamp: Utc::now(),
        });

        quote.last_price = price;
        quote.last_size = quantity;
        quote.volume += quantity;
        if price > quote.high {
            quote.high = price;
        }
        if price < quote.low {
            quote.low = price;
        }
        if quote.open == 0 {
            quote.open = price;
        }
        quote.close = price;
        quote.timestamp = Utc::now();

        if let Some(b) = bid {
            quote.bid_price = b;
        }
        if let Some(a) = ask {
            quote.ask_price = a;
        }

        // Update VWAP
        let mut vwap_data = self.vwap_data.write();
        let entry = vwap_data
            .entry(symbol.to_string())
            .or_insert((0.0, 0));
        entry.0 += from_price(price) * quantity as f64;
        entry.1 += quantity;
        if entry.1 > 0 {
            quote.vwap = to_price(entry.0 / entry.1 as f64);
        }

        // Update daily stats
        let mut stats = self.daily_stats.write();
        let stat = stats.entry(symbol.to_string()).or_insert(DailyStats {
            symbol: symbol.to_string(),
            open: 0,
            high: 0,
            low: Price::MAX,
            close: 0,
            volume: 0,
            trade_count: 0,
            vwap: 0,
            turnover: 0.0,
            change_pct: 0.0,
        });
        if stat.open == 0 {
            stat.open = price;
        }
        stat.close = price;
        if price > stat.high {
            stat.high = price;
        }
        if price < stat.low {
            stat.low = price;
        }
        stat.volume += quantity;
        stat.trade_count += 1;
        stat.turnover += from_price(price) * quantity as f64;
        if stat.open > 0 {
            stat.change_pct = (from_price(price) - from_price(stat.open)) / from_price(stat.open);
        }
        stat.vwap = quote.vwap;
    }

    /// Get NBBO quote for a symbol.
    pub fn get_nbbo(&self, symbol: &str) -> Option<NbboQuote> {
        self.quotes.read().get(symbol).cloned()
    }

    /// Get all NBBO quotes.
    pub fn all_nbbo(&self) -> Vec<NbboQuote> {
        self.quotes.read().values().cloned().collect()
    }

    /// Get daily stats for a symbol.
    pub fn get_stats(&self, symbol: &str) -> Option<DailyStats> {
        self.daily_stats.read().get(symbol).cloned()
    }

    /// Get all daily stats.
    pub fn all_stats(&self) -> Vec<DailyStats> {
        self.daily_stats.read().values().cloned().collect()
    }

    /// Subscribe to a feed.
    pub fn subscribe(
        &self,
        client_id: &str,
        symbols: Vec<String>,
        feed_type: FeedType,
    ) -> FeedSubscription {
        let sub = FeedSubscription {
            id: uuid::Uuid::new_v4(),
            client_id: client_id.to_string(),
            symbols,
            feed_type,
            subscribed_at: Utc::now(),
        };
        self.subscriptions.write().push(sub.clone());
        info!("New {} feed subscription for {}", format!("{:?}", feed_type), client_id);
        sub
    }

    pub fn subscription_count(&self) -> usize {
        self.subscriptions.read().len()
    }

    pub fn symbol_count(&self) -> usize {
        self.quotes.read().len()
    }

    /// Reset daily stats (called at start of new trading day).
    pub fn reset_daily(&self) {
        self.daily_stats.write().clear();
        self.vwap_data.write().clear();
        info!("Ticker plant daily stats reset");
    }
}

impl Default for TickerPlant {
    fn default() -> Self {
        Self::new()
    }
}

// ─── Market Data Distributor ────────────────────────────────────────────────

/// The market data distributor combining tape and ticker plant.
pub struct MarketDataEngine {
    pub tape: ConsolidatedTape,
    pub ticker: TickerPlant,
}

impl MarketDataEngine {
    pub fn new() -> Self {
        Self {
            tape: ConsolidatedTape::new(100_000),
            ticker: TickerPlant::new(),
        }
    }

    /// Record a trade across all market data systems.
    pub fn record_trade(
        &self,
        symbol: &str,
        price: Price,
        quantity: Qty,
        side: Side,
        condition: TradeCondition,
        bid: Option<Price>,
        ask: Option<Price>,
    ) -> TapeEntry {
        let entry = self
            .tape
            .record_trade(symbol, price, quantity, side, condition);
        self.ticker
            .update_from_trade(symbol, price, quantity, bid, ask);
        entry
    }

    /// Get full market snapshot for a symbol.
    pub fn snapshot(&self, symbol: &str) -> Option<MarketSnapshot> {
        let nbbo = self.ticker.get_nbbo(symbol)?;
        let stats = self.ticker.get_stats(symbol).unwrap_or(DailyStats {
            symbol: symbol.to_string(),
            open: 0,
            high: 0,
            low: 0,
            close: 0,
            volume: 0,
            trade_count: 0,
            vwap: 0,
            turnover: 0.0,
            change_pct: 0.0,
        });

        Some(MarketSnapshot {
            symbol: symbol.to_string(),
            nbbo,
            depth: Level2Data {
                symbol: symbol.to_string(),
                bids: vec![],
                asks: vec![],
                timestamp: Utc::now(),
            },
            recent_trades: self.tape.for_symbol(symbol, 50),
            daily_stats: stats,
            generated_at: Utc::now(),
        })
    }

    /// Get summary statistics.
    pub fn summary(&self) -> serde_json::Value {
        serde_json::json!({
            "tape_entries": self.tape.total_entries(),
            "symbols_tracked": self.ticker.symbol_count(),
            "feed_subscriptions": self.ticker.subscription_count(),
            "quotes": self.ticker.all_nbbo().len(),
        })
    }
}

impl Default for MarketDataEngine {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_consolidated_tape() {
        let tape = ConsolidatedTape::new(1000);
        tape.record_trade("GOLD", to_price(2345.0), 100, Side::Buy, TradeCondition::Regular);
        tape.record_trade("GOLD", to_price(2346.0), 50, Side::Sell, TradeCondition::Regular);
        assert_eq!(tape.total_entries(), 2);
        let recent = tape.recent(10);
        assert_eq!(recent.len(), 2);
    }

    #[test]
    fn test_ticker_plant_nbbo() {
        let ticker = TickerPlant::new();
        ticker.update_from_trade("GOLD", to_price(2345.0), 100, Some(to_price(2344.0)), Some(to_price(2346.0)));
        let nbbo = ticker.get_nbbo("GOLD").unwrap();
        assert_eq!(nbbo.last_price, to_price(2345.0));
        assert_eq!(nbbo.volume, 100);
        assert_eq!(nbbo.bid_price, to_price(2344.0));
        assert_eq!(nbbo.ask_price, to_price(2346.0));
    }

    #[test]
    fn test_market_data_engine() {
        let engine = MarketDataEngine::new();
        engine.record_trade("COFFEE", to_price(4520.0), 200, Side::Buy, TradeCondition::OpeningTrade, None, None);
        engine.record_trade("COFFEE", to_price(4525.0), 100, Side::Sell, TradeCondition::Regular, None, None);
        let snapshot = engine.snapshot("COFFEE").unwrap();
        assert_eq!(snapshot.daily_stats.trade_count, 2);
        assert_eq!(snapshot.daily_stats.volume, 300);
    }

    #[test]
    fn test_vwap_calculation() {
        let ticker = TickerPlant::new();
        ticker.update_from_trade("GOLD", to_price(100.0), 100, None, None);
        ticker.update_from_trade("GOLD", to_price(200.0), 100, None, None);
        let nbbo = ticker.get_nbbo("GOLD").unwrap();
        // VWAP = (100*100 + 200*100) / 200 = 150
        assert_eq!(nbbo.vwap, to_price(150.0));
    }
}
