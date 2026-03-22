//! Market Maker module — two-sided quote system for liquidity provision.
//! Market makers submit bid/ask quotes that are maintained in the orderbook.
//! Obligations: minimum quote size, max spread, minimum presence time.

use crate::types::*;
use chrono::{DateTime, Utc};
use parking_lot::RwLock;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use uuid::Uuid;

// ─── Market Maker Registration ──────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MarketMaker {
    pub id: String,
    pub name: String,
    pub clearing_member_id: String,
    pub status: MarketMakerStatus,
    pub assigned_symbols: Vec<String>,
    pub obligations: MarketMakerObligations,
    pub performance: MarketMakerPerformance,
    pub registered_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum MarketMakerStatus {
    Active,
    Suspended,
    Probation,
    Withdrawn,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MarketMakerObligations {
    /// Minimum bid quantity (lots)
    pub min_quote_size: Qty,
    /// Maximum bid-ask spread as basis points (e.g., 50 = 0.50%)
    pub max_spread_bps: u32,
    /// Minimum time-in-market percentage (e.g., 85 = 85% of trading session)
    pub min_presence_pct: u32,
    /// Maximum response time to requote after trade (milliseconds)
    pub max_response_time_ms: u64,
    /// Minimum number of price levels quoted on each side
    pub min_levels: u32,
}

impl Default for MarketMakerObligations {
    fn default() -> Self {
        Self {
            min_quote_size: 10_000_000, // 10 lots
            max_spread_bps: 50,         // 0.50%
            min_presence_pct: 85,
            max_response_time_ms: 500,
            min_levels: 3,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MarketMakerPerformance {
    pub total_quotes: u64,
    pub total_trades: u64,
    pub avg_spread_bps: f64,
    pub presence_pct: f64,
    pub avg_response_time_ms: f64,
    pub violations: u32,
    pub last_evaluated: DateTime<Utc>,
}

impl Default for MarketMakerPerformance {
    fn default() -> Self {
        Self {
            total_quotes: 0,
            total_trades: 0,
            avg_spread_bps: 0.0,
            presence_pct: 100.0,
            avg_response_time_ms: 0.0,
            violations: 0,
            last_evaluated: Utc::now(),
        }
    }
}

// ─── Two-Sided Quote ────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TwoSidedQuote {
    pub id: Uuid,
    pub market_maker_id: String,
    pub symbol: String,
    pub bid_price: Price,
    pub bid_quantity: Qty,
    pub ask_price: Price,
    pub ask_quantity: Qty,
    pub bid_levels: Vec<QuoteLevel>,
    pub ask_levels: Vec<QuoteLevel>,
    pub submitted_at: DateTime<Utc>,
    pub valid_until: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QuoteLevel {
    pub price: Price,
    pub quantity: Qty,
}

// ─── Market Maker Manager ───────────────────────────────────────────────────

pub struct MarketMakerManager {
    makers: RwLock<HashMap<String, MarketMaker>>,
    active_quotes: RwLock<HashMap<String, Vec<TwoSidedQuote>>>, // symbol -> quotes
}

impl MarketMakerManager {
    pub fn new() -> Self {
        let mgr = Self {
            makers: RwLock::new(HashMap::new()),
            active_quotes: RwLock::new(HashMap::new()),
        };
        // Register default market makers
        mgr.register_maker(MarketMaker {
            id: "MM-001".to_string(),
            name: "NEXCOM Primary Market Maker".to_string(),
            clearing_member_id: "CM-001".to_string(),
            status: MarketMakerStatus::Active,
            assigned_symbols: vec![
                "MAIZE".into(), "GOLD".into(), "COFFEE".into(), "CRUDE_OIL".into(),
                "WHEAT".into(), "COCOA".into(), "SILVER".into(), "CARBON".into(),
            ],
            obligations: MarketMakerObligations::default(),
            performance: MarketMakerPerformance::default(),
            registered_at: Utc::now(),
        });
        mgr.register_maker(MarketMaker {
            id: "MM-002".to_string(),
            name: "Pan-African Liquidity Provider".to_string(),
            clearing_member_id: "CM-002".to_string(),
            status: MarketMakerStatus::Active,
            assigned_symbols: vec![
                "MAIZE".into(), "COFFEE".into(), "COCOA".into(), "TEA".into(),
            ],
            obligations: MarketMakerObligations {
                min_quote_size: 5_000_000,
                max_spread_bps: 75,
                min_presence_pct: 80,
                ..Default::default()
            },
            performance: MarketMakerPerformance::default(),
            registered_at: Utc::now(),
        });
        mgr
    }

    pub fn register_maker(&self, maker: MarketMaker) {
        self.makers.write().insert(maker.id.clone(), maker);
    }

    pub fn get_maker(&self, id: &str) -> Option<MarketMaker> {
        self.makers.read().get(id).cloned()
    }

    pub fn list_makers(&self) -> Vec<MarketMaker> {
        self.makers.read().values().cloned().collect()
    }

    pub fn active_makers(&self) -> Vec<MarketMaker> {
        self.makers
            .read()
            .values()
            .filter(|m| m.status == MarketMakerStatus::Active)
            .cloned()
            .collect()
    }

    pub fn makers_for_symbol(&self, symbol: &str) -> Vec<MarketMaker> {
        self.makers
            .read()
            .values()
            .filter(|m| {
                m.status == MarketMakerStatus::Active
                    && m.assigned_symbols.iter().any(|s| s == symbol)
            })
            .cloned()
            .collect()
    }

    /// Submit a two-sided quote. Validates spread obligations.
    pub fn submit_quote(&self, quote: TwoSidedQuote) -> Result<TwoSidedQuote, String> {
        let makers = self.makers.read();
        let maker = makers
            .get(&quote.market_maker_id)
            .ok_or("Market maker not found")?;

        if maker.status != MarketMakerStatus::Active {
            return Err("Market maker is not active".to_string());
        }

        if !maker.assigned_symbols.contains(&quote.symbol) {
            return Err(format!(
                "Market maker {} is not assigned to {}",
                maker.id, quote.symbol
            ));
        }

        // Validate spread
        if quote.bid_price > 0 && quote.ask_price > 0 {
            let mid = (quote.bid_price + quote.ask_price) / 2;
            if mid > 0 {
                let spread_bps = ((quote.ask_price - quote.bid_price) as f64 / mid as f64) * 10_000.0;
                if spread_bps > maker.obligations.max_spread_bps as f64 {
                    return Err(format!(
                        "Spread {:.1}bps exceeds max {}bps",
                        spread_bps, maker.obligations.max_spread_bps
                    ));
                }
            }
        }

        // Validate quote size
        if quote.bid_quantity < maker.obligations.min_quote_size
            || quote.ask_quantity < maker.obligations.min_quote_size
        {
            return Err(format!(
                "Quote size below minimum {}",
                maker.obligations.min_quote_size
            ));
        }

        drop(makers);

        // Store quote
        let stored = quote.clone();
        self.active_quotes
            .write()
            .entry(quote.symbol.clone())
            .or_default()
            .push(quote);

        Ok(stored)
    }

    /// Get all active quotes for a symbol.
    pub fn quotes_for_symbol(&self, symbol: &str) -> Vec<TwoSidedQuote> {
        self.active_quotes
            .read()
            .get(symbol)
            .cloned()
            .unwrap_or_default()
    }

    /// Cancel all quotes for a market maker on a symbol.
    pub fn cancel_quotes(&self, market_maker_id: &str, symbol: &str) -> usize {
        let mut quotes = self.active_quotes.write();
        if let Some(symbol_quotes) = quotes.get_mut(symbol) {
            let before = symbol_quotes.len();
            symbol_quotes.retain(|q| q.market_maker_id != market_maker_id);
            before - symbol_quotes.len()
        } else {
            0
        }
    }

    /// Evaluate market maker performance against obligations.
    pub fn evaluate_performance(&self, market_maker_id: &str) -> Option<serde_json::Value> {
        let makers = self.makers.read();
        let maker = makers.get(market_maker_id)?;
        let perf = &maker.performance;

        let compliant = perf.presence_pct >= maker.obligations.min_presence_pct as f64
            && perf.avg_spread_bps <= maker.obligations.max_spread_bps as f64
            && perf.avg_response_time_ms <= maker.obligations.max_response_time_ms as f64;

        Some(serde_json::json!({
            "market_maker_id": market_maker_id,
            "name": maker.name,
            "status": maker.status,
            "compliant": compliant,
            "obligations": {
                "min_quote_size": maker.obligations.min_quote_size,
                "max_spread_bps": maker.obligations.max_spread_bps,
                "min_presence_pct": maker.obligations.min_presence_pct,
            },
            "performance": {
                "total_quotes": perf.total_quotes,
                "total_trades": perf.total_trades,
                "avg_spread_bps": perf.avg_spread_bps,
                "presence_pct": perf.presence_pct,
                "avg_response_time_ms": perf.avg_response_time_ms,
                "violations": perf.violations,
            },
        }))
    }

    pub fn maker_count(&self) -> usize {
        self.makers.read().len()
    }

    pub fn active_quote_count(&self) -> usize {
        self.active_quotes.read().values().map(|v| v.len()).sum()
    }
}

// ─── Tests ──────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_market_maker_registration() {
        let mgr = MarketMakerManager::new();
        assert!(mgr.maker_count() >= 2);
        let makers = mgr.active_makers();
        assert!(!makers.is_empty());
    }

    #[test]
    fn test_submit_valid_quote() {
        let mgr = MarketMakerManager::new();
        let quote = TwoSidedQuote {
            id: Uuid::new_v4(),
            market_maker_id: "MM-001".to_string(),
            symbol: "GOLD".to_string(),
            bid_price: to_price(2340.0),
            bid_quantity: 10_000_000,
            ask_price: to_price(2341.0),
            ask_quantity: 10_000_000,
            bid_levels: vec![],
            ask_levels: vec![],
            submitted_at: Utc::now(),
            valid_until: None,
        };
        let result = mgr.submit_quote(quote);
        assert!(result.is_ok());
    }

    #[test]
    fn test_reject_wide_spread() {
        let mgr = MarketMakerManager::new();
        let quote = TwoSidedQuote {
            id: Uuid::new_v4(),
            market_maker_id: "MM-001".to_string(),
            symbol: "GOLD".to_string(),
            bid_price: to_price(2300.0),
            bid_quantity: 10_000_000,
            ask_price: to_price(2400.0), // ~4.3% spread — way over 0.50%
            ask_quantity: 10_000_000,
            bid_levels: vec![],
            ask_levels: vec![],
            submitted_at: Utc::now(),
            valid_until: None,
        };
        let result = mgr.submit_quote(quote);
        assert!(result.is_err());
    }

    #[test]
    fn test_makers_for_symbol() {
        let mgr = MarketMakerManager::new();
        let maize_makers = mgr.makers_for_symbol("MAIZE");
        assert!(maize_makers.len() >= 2); // Both default MMs cover MAIZE
    }
}
