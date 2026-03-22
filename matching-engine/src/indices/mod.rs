//! Index Calculation Engine — real-time commodity indices similar to NGX ASI.
//! Computes composite and sector indices from live trade prices.

use crate::types::*;
use chrono::{DateTime, Utc};
use parking_lot::RwLock;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

// ─── Index Definition ───────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IndexDefinition {
    pub id: String,
    pub name: String,
    pub description: String,
    pub index_type: IndexType,
    pub base_value: f64,
    pub base_date: String,
    pub constituents: Vec<IndexConstituent>,
    pub methodology: IndexMethodology,
    pub status: IndexStatus,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum IndexType {
    Composite,
    Sector,
    SingleCommodity,
    Custom,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum IndexMethodology {
    /// Market-cap weighted (volume * price)
    MarketCapWeighted,
    /// Equal weight across all constituents
    EqualWeighted,
    /// Price weighted
    PriceWeighted,
    /// Free-float adjusted
    FreeFloatAdjusted,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum IndexStatus {
    Active,
    Suspended,
    Discontinued,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IndexConstituent {
    pub symbol: String,
    pub name: String,
    pub weight: f64,
    pub sector: String,
    pub last_price: f64,
    pub shares_outstanding: f64, // contract open interest for commodities
}

// ─── Index Value ────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IndexValue {
    pub index_id: String,
    pub value: f64,
    pub change: f64,
    pub change_pct: f64,
    pub high: f64,
    pub low: f64,
    pub open: f64,
    pub previous_close: f64,
    pub volume: f64,
    pub turnover: f64,
    pub timestamp: DateTime<Utc>,
}

// ─── Index Engine ───────────────────────────────────────────────────────────

pub struct IndexEngine {
    definitions: RwLock<HashMap<String, IndexDefinition>>,
    current_values: RwLock<HashMap<String, IndexValue>>,
    prices: RwLock<HashMap<String, f64>>, // symbol -> last price
}

impl IndexEngine {
    pub fn new() -> Self {
        let engine = Self {
            definitions: RwLock::new(HashMap::new()),
            current_values: RwLock::new(HashMap::new()),
            prices: RwLock::new(HashMap::new()),
        };
        engine.register_default_indices();
        engine
    }

    fn register_default_indices(&self) {
        // NEXCOM All-Commodities Index (like NGX ASI)
        self.register_index(IndexDefinition {
            id: "NXCI".to_string(),
            name: "NEXCOM All-Commodities Index".to_string(),
            description: "Composite index tracking all listed commodities on NEXCOM Exchange".to_string(),
            index_type: IndexType::Composite,
            base_value: 1000.0,
            base_date: "2026-01-01".to_string(),
            constituents: vec![
                IndexConstituent { symbol: "MAIZE".into(), name: "Maize (Corn)".into(), weight: 0.15, sector: "Agricultural".into(), last_price: 285.5, shares_outstanding: 50000.0 },
                IndexConstituent { symbol: "GOLD".into(), name: "Gold".into(), weight: 0.20, sector: "Metals".into(), last_price: 2345.6, shares_outstanding: 10000.0 },
                IndexConstituent { symbol: "COFFEE".into(), name: "Coffee Arabica".into(), weight: 0.12, sector: "Agricultural".into(), last_price: 4520.0, shares_outstanding: 30000.0 },
                IndexConstituent { symbol: "CRUDE_OIL".into(), name: "Crude Oil".into(), weight: 0.18, sector: "Energy".into(), last_price: 78.42, shares_outstanding: 100000.0 },
                IndexConstituent { symbol: "WHEAT".into(), name: "Wheat".into(), weight: 0.08, sector: "Agricultural".into(), last_price: 342.8, shares_outstanding: 40000.0 },
                IndexConstituent { symbol: "COCOA".into(), name: "Cocoa".into(), weight: 0.07, sector: "Agricultural".into(), last_price: 7850.0, shares_outstanding: 15000.0 },
                IndexConstituent { symbol: "SILVER".into(), name: "Silver".into(), weight: 0.06, sector: "Metals".into(), last_price: 27.85, shares_outstanding: 60000.0 },
                IndexConstituent { symbol: "CARBON".into(), name: "Carbon Credits".into(), weight: 0.05, sector: "Carbon".into(), last_price: 65.2, shares_outstanding: 80000.0 },
                IndexConstituent { symbol: "NAT_GAS".into(), name: "Natural Gas".into(), weight: 0.05, sector: "Energy".into(), last_price: 2.89, shares_outstanding: 200000.0 },
                IndexConstituent { symbol: "TEA".into(), name: "Tea".into(), weight: 0.04, sector: "Agricultural".into(), last_price: 3.45, shares_outstanding: 100000.0 },
            ],
            methodology: IndexMethodology::MarketCapWeighted,
            status: IndexStatus::Active,
            created_at: Utc::now(),
        });

        // Sector indices
        self.register_index(IndexDefinition {
            id: "NXCI-AGRI".to_string(),
            name: "NEXCOM Agricultural Index".to_string(),
            description: "Tracks agricultural commodity prices".to_string(),
            index_type: IndexType::Sector,
            base_value: 1000.0,
            base_date: "2026-01-01".to_string(),
            constituents: vec![
                IndexConstituent { symbol: "MAIZE".into(), name: "Maize".into(), weight: 0.30, sector: "Agricultural".into(), last_price: 285.5, shares_outstanding: 50000.0 },
                IndexConstituent { symbol: "COFFEE".into(), name: "Coffee".into(), weight: 0.25, sector: "Agricultural".into(), last_price: 4520.0, shares_outstanding: 30000.0 },
                IndexConstituent { symbol: "WHEAT".into(), name: "Wheat".into(), weight: 0.20, sector: "Agricultural".into(), last_price: 342.8, shares_outstanding: 40000.0 },
                IndexConstituent { symbol: "COCOA".into(), name: "Cocoa".into(), weight: 0.15, sector: "Agricultural".into(), last_price: 7850.0, shares_outstanding: 15000.0 },
                IndexConstituent { symbol: "TEA".into(), name: "Tea".into(), weight: 0.10, sector: "Agricultural".into(), last_price: 3.45, shares_outstanding: 100000.0 },
            ],
            methodology: IndexMethodology::MarketCapWeighted,
            status: IndexStatus::Active,
            created_at: Utc::now(),
        });

        self.register_index(IndexDefinition {
            id: "NXCI-METAL".to_string(),
            name: "NEXCOM Metals Index".to_string(),
            description: "Tracks precious and industrial metals".to_string(),
            index_type: IndexType::Sector,
            base_value: 1000.0,
            base_date: "2026-01-01".to_string(),
            constituents: vec![
                IndexConstituent { symbol: "GOLD".into(), name: "Gold".into(), weight: 0.60, sector: "Metals".into(), last_price: 2345.6, shares_outstanding: 10000.0 },
                IndexConstituent { symbol: "SILVER".into(), name: "Silver".into(), weight: 0.40, sector: "Metals".into(), last_price: 27.85, shares_outstanding: 60000.0 },
            ],
            methodology: IndexMethodology::MarketCapWeighted,
            status: IndexStatus::Active,
            created_at: Utc::now(),
        });

        self.register_index(IndexDefinition {
            id: "NXCI-ENERGY".to_string(),
            name: "NEXCOM Energy Index".to_string(),
            description: "Tracks energy commodities".to_string(),
            index_type: IndexType::Sector,
            base_value: 1000.0,
            base_date: "2026-01-01".to_string(),
            constituents: vec![
                IndexConstituent { symbol: "CRUDE_OIL".into(), name: "Crude Oil".into(), weight: 0.70, sector: "Energy".into(), last_price: 78.42, shares_outstanding: 100000.0 },
                IndexConstituent { symbol: "NAT_GAS".into(), name: "Natural Gas".into(), weight: 0.30, sector: "Energy".into(), last_price: 2.89, shares_outstanding: 200000.0 },
            ],
            methodology: IndexMethodology::MarketCapWeighted,
            status: IndexStatus::Active,
            created_at: Utc::now(),
        });

        self.register_index(IndexDefinition {
            id: "NXCI-CARBON".to_string(),
            name: "NEXCOM Carbon Index".to_string(),
            description: "Tracks carbon credit prices".to_string(),
            index_type: IndexType::SingleCommodity,
            base_value: 1000.0,
            base_date: "2026-01-01".to_string(),
            constituents: vec![
                IndexConstituent { symbol: "CARBON".into(), name: "Carbon Credits".into(), weight: 1.0, sector: "Carbon".into(), last_price: 65.2, shares_outstanding: 80000.0 },
            ],
            methodology: IndexMethodology::PriceWeighted,
            status: IndexStatus::Active,
            created_at: Utc::now(),
        });

        // Initialize prices and compute initial values
        let mut prices = self.prices.write();
        prices.insert("MAIZE".into(), 285.5);
        prices.insert("GOLD".into(), 2345.6);
        prices.insert("COFFEE".into(), 4520.0);
        prices.insert("CRUDE_OIL".into(), 78.42);
        prices.insert("WHEAT".into(), 342.8);
        prices.insert("COCOA".into(), 7850.0);
        prices.insert("SILVER".into(), 27.85);
        prices.insert("CARBON".into(), 65.2);
        prices.insert("NAT_GAS".into(), 2.89);
        prices.insert("TEA".into(), 3.45);
        drop(prices);

        self.recalculate_all();
    }

    pub fn register_index(&self, definition: IndexDefinition) {
        self.definitions.write().insert(definition.id.clone(), definition);
    }

    /// Update a commodity price and recalculate all affected indices.
    pub fn update_price(&self, symbol: &str, price: f64) {
        self.prices.write().insert(symbol.to_string(), price);
        self.recalculate_all();
    }

    /// Recalculate all index values from current prices.
    pub fn recalculate_all(&self) {
        let defs = self.definitions.read();
        let prices = self.prices.read();
        let mut values = self.current_values.write();

        for (id, def) in defs.iter() {
            if def.status != IndexStatus::Active {
                continue;
            }
            let value = self.calculate_index(def, &prices);
            let prev = values.get(id).map(|v| v.value).unwrap_or(def.base_value);
            let change = value - prev;
            let change_pct = if prev > 0.0 { (change / prev) * 100.0 } else { 0.0 };

            let existing = values.get(id);
            let open = existing.map(|v| v.open).unwrap_or(value);
            let high = existing.map(|v| v.high.max(value)).unwrap_or(value);
            let low = existing.map(|v| v.low.min(value)).unwrap_or(value);

            values.insert(id.clone(), IndexValue {
                index_id: id.clone(),
                value,
                change,
                change_pct,
                high,
                low,
                open,
                previous_close: prev,
                volume: 0.0,
                turnover: 0.0,
                timestamp: Utc::now(),
            });
        }
    }

    fn calculate_index(&self, def: &IndexDefinition, prices: &HashMap<String, f64>) -> f64 {
        match def.methodology {
            IndexMethodology::MarketCapWeighted => {
                let mut total_market_cap = 0.0;
                let mut base_market_cap = 0.0;
                for c in &def.constituents {
                    let current_price = prices.get(&c.symbol).copied().unwrap_or(c.last_price);
                    total_market_cap += current_price * c.shares_outstanding * c.weight;
                    base_market_cap += c.last_price * c.shares_outstanding * c.weight;
                }
                if base_market_cap > 0.0 {
                    def.base_value * (total_market_cap / base_market_cap)
                } else {
                    def.base_value
                }
            }
            IndexMethodology::EqualWeighted => {
                let n = def.constituents.len() as f64;
                if n == 0.0 { return def.base_value; }
                let mut sum_returns = 0.0;
                for c in &def.constituents {
                    let current_price = prices.get(&c.symbol).copied().unwrap_or(c.last_price);
                    if c.last_price > 0.0 {
                        sum_returns += current_price / c.last_price;
                    }
                }
                def.base_value * (sum_returns / n)
            }
            IndexMethodology::PriceWeighted => {
                let n = def.constituents.len() as f64;
                if n == 0.0 { return def.base_value; }
                let mut sum_prices = 0.0;
                let mut sum_base = 0.0;
                for c in &def.constituents {
                    sum_prices += prices.get(&c.symbol).copied().unwrap_or(c.last_price);
                    sum_base += c.last_price;
                }
                if sum_base > 0.0 { def.base_value * (sum_prices / sum_base) } else { def.base_value }
            }
            IndexMethodology::FreeFloatAdjusted => {
                // Same as market-cap weighted for commodities (no restricted shares)
                self.calculate_index(&IndexDefinition {
                    methodology: IndexMethodology::MarketCapWeighted,
                    ..def.clone()
                }, prices)
            }
        }
    }

    pub fn get_index(&self, id: &str) -> Option<IndexDefinition> {
        self.definitions.read().get(id).cloned()
    }

    pub fn get_value(&self, id: &str) -> Option<IndexValue> {
        self.current_values.read().get(id).cloned()
    }

    pub fn list_indices(&self) -> Vec<IndexDefinition> {
        self.definitions.read().values().cloned().collect()
    }

    pub fn all_values(&self) -> Vec<IndexValue> {
        self.current_values.read().values().cloned().collect()
    }

    pub fn index_count(&self) -> usize {
        self.definitions.read().len()
    }
}

// ─── Tests ──────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_index_engine_init() {
        let engine = IndexEngine::new();
        assert_eq!(engine.index_count(), 5); // NXCI + 4 sector indices
        let values = engine.all_values();
        assert_eq!(values.len(), 5);
    }

    #[test]
    fn test_composite_index_calculation() {
        let engine = IndexEngine::new();
        let value = engine.get_value("NXCI").unwrap();
        // Base value is 1000, and all prices match base, so value should be ~1000
        assert!((value.value - 1000.0).abs() < 1.0);
    }

    #[test]
    fn test_price_update_affects_index() {
        let engine = IndexEngine::new();
        let before = engine.get_value("NXCI").unwrap().value;
        engine.update_price("GOLD", 2500.0); // +6.6% on gold
        let after = engine.get_value("NXCI").unwrap().value;
        assert!(after > before); // Index should increase
    }

    #[test]
    fn test_sector_index() {
        let engine = IndexEngine::new();
        let agri = engine.get_value("NXCI-AGRI").unwrap();
        assert!((agri.value - 1000.0).abs() < 1.0);
    }
}
