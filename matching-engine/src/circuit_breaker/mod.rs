//! Circuit Breaker System — NYSE-equivalent LULD (Limit Up-Limit Down) and market-wide halts.
//! Implements:
//! - Per-symbol LULD bands (dynamic price bands based on reference price)
//! - Market-wide circuit breakers (Level 1/2/3 based on index decline)
//! - Trading halt/resume with auction re-open
//! - Volatility interruption mechanism
#![allow(dead_code)]

use crate::types::*;
use chrono::{DateTime, Duration, Utc};
use dashmap::DashMap;
use parking_lot::RwLock;
use serde::{Deserialize, Serialize};
use tracing::{info, warn};

// ─── LULD Band Configuration ────────────────────────────────────────────────

/// LULD price band for a single symbol.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LuldBand {
    pub symbol: String,
    pub reference_price: Price,
    pub upper_band: Price,
    pub lower_band: Price,
    pub band_pct: f64,
    pub tier: LuldTier,
    pub last_updated: DateTime<Utc>,
    pub state: LuldState,
}

/// LULD tier determines band width (like NYSE Tier 1 / Tier 2).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum LuldTier {
    /// Major commodities (gold, oil, etc.) — tighter bands.
    Tier1,
    /// Standard commodities — wider bands.
    Tier2,
    /// Low-liquidity / new listings — widest bands.
    Tier3,
}

/// Current LULD state for a symbol.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum LuldState {
    /// Normal trading.
    Normal,
    /// Price approaching band — straddle state (15 seconds).
    LimitState,
    /// Trading paused — LULD halt (5-minute pause).
    TradingPause,
    /// Re-opening auction in progress.
    ReopeningAuction,
}

// ─── Market-Wide Circuit Breaker ────────────────────────────────────────────

/// Market-wide circuit breaker levels (based on index decline from previous close).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum MarketWideLevel {
    /// No circuit breaker triggered.
    None,
    /// Level 1: 7% decline — 15-minute halt.
    Level1,
    /// Level 2: 13% decline — 15-minute halt.
    Level2,
    /// Level 3: 20% decline — trading halted for remainder of day.
    Level3,
}

/// Market-wide circuit breaker state.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MarketWideBreaker {
    pub level: MarketWideLevel,
    pub reference_index_value: f64,
    pub current_index_value: f64,
    pub decline_pct: f64,
    pub triggered_at: Option<DateTime<Utc>>,
    pub resume_at: Option<DateTime<Utc>>,
    pub level1_triggered_today: bool,
    pub level2_triggered_today: bool,
    pub level3_triggered_today: bool,
}

/// Volatility interruption event.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VolatilityInterruption {
    pub id: uuid::Uuid,
    pub symbol: String,
    pub trigger_price: Price,
    pub reference_price: Price,
    pub deviation_pct: f64,
    pub triggered_at: DateTime<Utc>,
    pub duration_seconds: u64,
    pub resolved: bool,
}

// ─── Circuit Breaker Engine ─────────────────────────────────────────────────

/// The circuit breaker engine managing all LULD bands and market-wide breakers.
pub struct CircuitBreakerEngine {
    bands: DashMap<String, LuldBand>,
    pub market_wide: RwLock<MarketWideBreaker>,
    interruptions: RwLock<Vec<VolatilityInterruption>>,
    tier_bands: [(LuldTier, f64); 3],
    #[allow(dead_code)]
    limit_state_duration_secs: u64,
    trading_pause_duration_secs: u64,
    #[allow(dead_code)]
    volatility_threshold_pct: f64,
}

impl CircuitBreakerEngine {
    pub fn new() -> Self {
        let engine = Self {
            bands: DashMap::new(),
            market_wide: RwLock::new(MarketWideBreaker {
                level: MarketWideLevel::None,
                reference_index_value: 1000.0,
                current_index_value: 1000.0,
                decline_pct: 0.0,
                triggered_at: None,
                resume_at: None,
                level1_triggered_today: false,
                level2_triggered_today: false,
                level3_triggered_today: false,
            }),
            interruptions: RwLock::new(Vec::new()),
            tier_bands: [
                (LuldTier::Tier1, 0.05),
                (LuldTier::Tier2, 0.10),
                (LuldTier::Tier3, 0.20),
            ],
            limit_state_duration_secs: 15,
            trading_pause_duration_secs: 300,
            volatility_threshold_pct: 0.03,
        };
        engine.init_default_bands();
        engine
    }

    fn init_default_bands(&self) {
        let defaults = vec![
            ("GOLD", 2345.0, LuldTier::Tier1),
            ("SILVER", 28.45, LuldTier::Tier1),
            ("CRUDE_OIL", 78.42, LuldTier::Tier1),
            ("NATURAL_GAS", 2.84, LuldTier::Tier1),
            ("COFFEE", 4520.0, LuldTier::Tier2),
            ("COCOA", 3890.0, LuldTier::Tier2),
            ("MAIZE", 285.50, LuldTier::Tier2),
            ("WHEAT", 343.00, LuldTier::Tier2),
            ("SUGAR", 22.50, LuldTier::Tier2),
            ("SOYBEAN", 466.0, LuldTier::Tier2),
            ("COPPER", 8450.0, LuldTier::Tier2),
            ("CARBON", 65.20, LuldTier::Tier3),
            ("TEA", 3.20, LuldTier::Tier3),
        ];

        for (sym, ref_price, tier) in defaults {
            let band_pct = self.get_band_pct(tier);
            let ref_fp = to_price(ref_price);
            self.bands.insert(
                sym.to_string(),
                LuldBand {
                    symbol: sym.to_string(),
                    reference_price: ref_fp,
                    upper_band: to_price(ref_price * (1.0 + band_pct)),
                    lower_band: to_price(ref_price * (1.0 - band_pct)),
                    band_pct,
                    tier,
                    last_updated: Utc::now(),
                    state: LuldState::Normal,
                },
            );
        }
    }

    fn get_band_pct(&self, tier: LuldTier) -> f64 {
        self.tier_bands
            .iter()
            .find(|(t, _)| *t == tier)
            .map(|(_, pct)| *pct)
            .unwrap_or(0.10)
    }

    /// Check if a trade price would violate LULD bands.
    pub fn check_price(&self, symbol: &str, trade_price: Price) -> LuldState {
        let underlying = symbol.split('-').next().unwrap_or(symbol);

        if let Some(mut band) = self.bands.get_mut(underlying) {
            if trade_price > band.upper_band || trade_price < band.lower_band {
                match band.state {
                    LuldState::Normal => {
                        band.state = LuldState::LimitState;
                        warn!(
                            "LULD LIMIT STATE: {} price {} outside bands [{}, {}]",
                            symbol,
                            from_price(trade_price),
                            from_price(band.lower_band),
                            from_price(band.upper_band)
                        );
                        LuldState::LimitState
                    }
                    LuldState::LimitState => {
                        band.state = LuldState::TradingPause;
                        warn!("LULD TRADING PAUSE: {} price remained outside bands", symbol);
                        LuldState::TradingPause
                    }
                    other => other,
                }
            } else {
                if band.state == LuldState::LimitState {
                    band.state = LuldState::Normal;
                    info!("LULD NORMAL: {} price returned within bands", symbol);
                }
                band.state
            }
        } else {
            LuldState::Normal
        }
    }

    /// Update reference price (typically at open or after auction).
    pub fn update_reference_price(&self, symbol: &str, new_ref_price: Price) {
        let underlying = symbol.split('-').next().unwrap_or(symbol);
        if let Some(mut band) = self.bands.get_mut(underlying) {
            let ref_f64 = from_price(new_ref_price);
            band.reference_price = new_ref_price;
            band.upper_band = to_price(ref_f64 * (1.0 + band.band_pct));
            band.lower_band = to_price(ref_f64 * (1.0 - band.band_pct));
            band.last_updated = Utc::now();
            band.state = LuldState::Normal;
            info!(
                "Updated LULD bands for {}: ref={:.2}, upper={:.2}, lower={:.2}",
                underlying,
                ref_f64,
                from_price(band.upper_band),
                from_price(band.lower_band)
            );
        }
    }

    /// Check market-wide circuit breaker based on index value.
    pub fn check_market_wide(&self, current_index_value: f64) -> MarketWideLevel {
        let mut state = self.market_wide.write();
        state.current_index_value = current_index_value;
        let decline =
            (state.reference_index_value - current_index_value) / state.reference_index_value;
        state.decline_pct = decline;

        if decline >= 0.20 && !state.level3_triggered_today {
            state.level = MarketWideLevel::Level3;
            state.level3_triggered_today = true;
            state.triggered_at = Some(Utc::now());
            state.resume_at = None;
            warn!(
                "MARKET-WIDE CIRCUIT BREAKER LEVEL 3: {:.1}% decline — HALTED FOR DAY",
                decline * 100.0
            );
            MarketWideLevel::Level3
        } else if decline >= 0.13 && !state.level2_triggered_today {
            state.level = MarketWideLevel::Level2;
            state.level2_triggered_today = true;
            state.triggered_at = Some(Utc::now());
            state.resume_at = Some(Utc::now() + Duration::minutes(15));
            warn!(
                "MARKET-WIDE CIRCUIT BREAKER LEVEL 2: {:.1}% decline — 15-min halt",
                decline * 100.0
            );
            MarketWideLevel::Level2
        } else if decline >= 0.07 && !state.level1_triggered_today {
            state.level = MarketWideLevel::Level1;
            state.level1_triggered_today = true;
            state.triggered_at = Some(Utc::now());
            state.resume_at = Some(Utc::now() + Duration::minutes(15));
            warn!(
                "MARKET-WIDE CIRCUIT BREAKER LEVEL 1: {:.1}% decline — 15-min halt",
                decline * 100.0
            );
            MarketWideLevel::Level1
        } else {
            if let Some(resume_at) = state.resume_at {
                if Utc::now() >= resume_at {
                    state.level = MarketWideLevel::None;
                    state.triggered_at = None;
                    state.resume_at = None;
                    info!("Market-wide circuit breaker lifted — trading resumed");
                }
            }
            state.level
        }
    }

    /// Record a volatility interruption.
    pub fn record_volatility_interruption(
        &self,
        symbol: &str,
        trigger_price: Price,
        reference_price: Price,
    ) -> VolatilityInterruption {
        let deviation = if reference_price > 0 {
            ((trigger_price - reference_price) as f64 / reference_price as f64).abs()
        } else {
            0.0
        };

        let interruption = VolatilityInterruption {
            id: uuid::Uuid::new_v4(),
            symbol: symbol.to_string(),
            trigger_price,
            reference_price,
            deviation_pct: deviation,
            triggered_at: Utc::now(),
            duration_seconds: self.trading_pause_duration_secs,
            resolved: false,
        };

        warn!(
            "VOLATILITY INTERRUPTION: {} — {:.2}% deviation, pause for {}s",
            symbol,
            deviation * 100.0,
            self.trading_pause_duration_secs
        );

        self.interruptions.write().push(interruption.clone());
        interruption
    }

    pub fn all_bands(&self) -> Vec<LuldBand> {
        self.bands.iter().map(|r| r.value().clone()).collect()
    }

    pub fn get_band(&self, symbol: &str) -> Option<LuldBand> {
        let underlying = symbol.split('-').next().unwrap_or(symbol);
        self.bands.get(underlying).map(|r| r.value().clone())
    }

    pub fn market_wide_status(&self) -> serde_json::Value {
        let state = self.market_wide.read();
        serde_json::json!({
            "level": state.level,
            "reference_index": state.reference_index_value,
            "current_index": state.current_index_value,
            "decline_pct": state.decline_pct,
            "triggered_at": state.triggered_at,
            "resume_at": state.resume_at,
            "level1_triggered_today": state.level1_triggered_today,
            "level2_triggered_today": state.level2_triggered_today,
            "level3_triggered_today": state.level3_triggered_today,
        })
    }

    pub fn recent_interruptions(&self) -> Vec<VolatilityInterruption> {
        self.interruptions
            .read()
            .iter()
            .rev()
            .take(50)
            .cloned()
            .collect()
    }

    pub fn interruption_count(&self) -> usize {
        self.interruptions.read().len()
    }

    pub fn reset_daily(&self) {
        let mut state = self.market_wide.write();
        state.level = MarketWideLevel::None;
        state.level1_triggered_today = false;
        state.level2_triggered_today = false;
        state.level3_triggered_today = false;
        state.triggered_at = None;
        state.resume_at = None;
        info!("Circuit breakers reset for new trading day");
    }

    pub fn set_reference_index(&self, value: f64) {
        let mut state = self.market_wide.write();
        state.reference_index_value = value;
        state.current_index_value = value;
        info!("Market-wide circuit breaker reference set to {:.2}", value);
    }

    pub fn is_market_halted(&self) -> bool {
        let state = self.market_wide.read();
        matches!(
            state.level,
            MarketWideLevel::Level1 | MarketWideLevel::Level2 | MarketWideLevel::Level3
        )
    }

    pub fn band_count(&self) -> usize {
        self.bands.len()
    }
}

impl Default for CircuitBreakerEngine {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_luld_bands_init() {
        let engine = CircuitBreakerEngine::new();
        let bands = engine.all_bands();
        assert!(bands.len() >= 10);
        let gold = engine.get_band("GOLD").unwrap();
        assert_eq!(gold.tier, LuldTier::Tier1);
        assert!(gold.upper_band > gold.reference_price);
        assert!(gold.lower_band < gold.reference_price);
    }

    #[test]
    fn test_luld_price_check() {
        let engine = CircuitBreakerEngine::new();
        let band = engine.get_band("GOLD").unwrap();
        let state = engine.check_price("GOLD", band.reference_price);
        assert_eq!(state, LuldState::Normal);
        let state = engine.check_price("GOLD", band.upper_band + to_price(100.0));
        assert_eq!(state, LuldState::LimitState);
        let state = engine.check_price("GOLD", band.upper_band + to_price(200.0));
        assert_eq!(state, LuldState::TradingPause);
    }

    #[test]
    fn test_market_wide_level1() {
        let engine = CircuitBreakerEngine::new();
        engine.set_reference_index(1000.0);
        let level = engine.check_market_wide(930.0);
        assert_eq!(level, MarketWideLevel::Level1);
        assert!(engine.is_market_halted());
    }

    #[test]
    fn test_market_wide_level3() {
        let engine = CircuitBreakerEngine::new();
        engine.set_reference_index(1000.0);
        let level = engine.check_market_wide(800.0);
        assert_eq!(level, MarketWideLevel::Level3);
    }

    #[test]
    fn test_volatility_interruption() {
        let engine = CircuitBreakerEngine::new();
        let vi = engine.record_volatility_interruption("GOLD", to_price(2500.0), to_price(2345.0));
        assert!(!vi.resolved);
        assert!(vi.deviation_pct > 0.05);
        assert_eq!(engine.interruption_count(), 1);
    }

    #[test]
    fn test_daily_reset() {
        let engine = CircuitBreakerEngine::new();
        engine.set_reference_index(1000.0);
        engine.check_market_wide(930.0);
        assert!(engine.is_market_halted());
        engine.reset_daily();
        assert!(!engine.is_market_halted());
    }
}
