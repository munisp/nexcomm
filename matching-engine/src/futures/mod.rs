//! Futures contract lifecycle management.
//! Handles listing, trading, expiry, settlement, rollover, and delivery months.
#![allow(dead_code)]

use crate::types::*;
use chrono::{Datelike, Duration, NaiveDate, Utc};
use dashmap::DashMap;
use tracing::info;

/// Month codes per CME convention.
pub fn month_code(month: u32) -> char {
    match month {
        1 => 'F',
        2 => 'G',
        3 => 'H',
        4 => 'J',
        5 => 'K',
        6 => 'M',
        7 => 'N',
        8 => 'Q',
        9 => 'U',
        10 => 'V',
        11 => 'X',
        12 => 'Z',
        _ => '?',
    }
}

/// Contract specification template.
#[derive(Debug, Clone)]
pub struct ContractSpec {
    pub underlying: String,
    pub contract_size: Qty,
    pub tick_size: Price,
    pub tick_value: Price,
    pub initial_margin_pct: f64,
    pub maintenance_margin_pct: f64,
    pub daily_limit_pct: f64,
    pub settlement_type: SettlementType,
    pub delivery_months: Vec<u32>,
    pub trading_hours: String,
}

/// Manages the lifecycle of all futures contracts.
pub struct FuturesManager {
    /// Contract specs by underlying.
    specs: DashMap<String, ContractSpec>,
    /// Active contracts by symbol.
    contracts: DashMap<String, FuturesContract>,
    /// Settlement prices by symbol.
    settlement_prices: DashMap<String, Vec<SettlementRecord>>,
}

#[derive(Debug, Clone)]
pub struct SettlementRecord {
    pub symbol: String,
    pub price: Price,
    pub date: chrono::NaiveDate,
    pub volume: Qty,
    pub open_interest: Qty,
}

impl FuturesManager {
    pub fn new() -> Self {
        let mgr = Self {
            specs: DashMap::new(),
            contracts: DashMap::new(),
            settlement_prices: DashMap::new(),
        };
        mgr.register_default_specs();
        mgr
    }

    /// Register default commodity contract specifications.
    fn register_default_specs(&self) {
        let specs = vec![
            ContractSpec {
                underlying: "GOLD".to_string(),
                contract_size: 100_000_000, // 100 troy oz
                tick_size: to_price(0.10),
                tick_value: to_price(10.0),
                initial_margin_pct: 0.05,
                maintenance_margin_pct: 0.04,
                daily_limit_pct: 0.07,
                settlement_type: SettlementType::Physical,
                delivery_months: vec![2, 4, 6, 8, 10, 12],
                trading_hours: "17:00-16:00 CT".to_string(),
            },
            ContractSpec {
                underlying: "SILVER".to_string(),
                contract_size: 5000_000_000, // 5000 troy oz
                tick_size: to_price(0.005),
                tick_value: to_price(25.0),
                initial_margin_pct: 0.06,
                maintenance_margin_pct: 0.05,
                daily_limit_pct: 0.07,
                settlement_type: SettlementType::Physical,
                delivery_months: vec![1, 3, 5, 7, 9, 12],
                trading_hours: "17:00-16:00 CT".to_string(),
            },
            ContractSpec {
                underlying: "CRUDE_OIL".to_string(),
                contract_size: 1000_000_000, // 1000 barrels
                tick_size: to_price(0.01),
                tick_value: to_price(10.0),
                initial_margin_pct: 0.07,
                maintenance_margin_pct: 0.06,
                daily_limit_pct: 0.10,
                settlement_type: SettlementType::Physical,
                delivery_months: vec![1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
                trading_hours: "17:00-16:00 CT".to_string(),
            },
            ContractSpec {
                underlying: "COFFEE".to_string(),
                contract_size: 37500_000_000, // 37,500 lbs
                tick_size: to_price(0.05),
                tick_value: to_price(18.75),
                initial_margin_pct: 0.08,
                maintenance_margin_pct: 0.06,
                daily_limit_pct: 0.08,
                settlement_type: SettlementType::Physical,
                delivery_months: vec![3, 5, 7, 9, 12],
                trading_hours: "03:30-13:00 ET".to_string(),
            },
            ContractSpec {
                underlying: "COCOA".to_string(),
                contract_size: 10_000_000, // 10 metric tons
                tick_size: to_price(1.0),
                tick_value: to_price(10.0),
                initial_margin_pct: 0.10,
                maintenance_margin_pct: 0.08,
                daily_limit_pct: 0.10,
                settlement_type: SettlementType::Physical,
                delivery_months: vec![3, 5, 7, 9, 12],
                trading_hours: "04:45-13:30 ET".to_string(),
            },
            ContractSpec {
                underlying: "MAIZE".to_string(),
                contract_size: 5000_000_000, // 5,000 bushels
                tick_size: to_price(0.25),
                tick_value: to_price(12.50),
                initial_margin_pct: 0.05,
                maintenance_margin_pct: 0.04,
                daily_limit_pct: 0.07,
                settlement_type: SettlementType::Physical,
                delivery_months: vec![3, 5, 7, 9, 12],
                trading_hours: "19:00-07:45, 08:30-13:20 CT".to_string(),
            },
            ContractSpec {
                underlying: "WHEAT".to_string(),
                contract_size: 5000_000_000,
                tick_size: to_price(0.25),
                tick_value: to_price(12.50),
                initial_margin_pct: 0.06,
                maintenance_margin_pct: 0.05,
                daily_limit_pct: 0.07,
                settlement_type: SettlementType::Physical,
                delivery_months: vec![3, 5, 7, 9, 12],
                trading_hours: "19:00-07:45, 08:30-13:20 CT".to_string(),
            },
            ContractSpec {
                underlying: "SUGAR".to_string(),
                contract_size: 112000_000_000, // 112,000 lbs
                tick_size: to_price(0.01),
                tick_value: to_price(11.20),
                initial_margin_pct: 0.06,
                maintenance_margin_pct: 0.05,
                daily_limit_pct: 0.08,
                settlement_type: SettlementType::Physical,
                delivery_months: vec![3, 5, 7, 10],
                trading_hours: "03:30-13:00 ET".to_string(),
            },
            ContractSpec {
                underlying: "NATURAL_GAS".to_string(),
                contract_size: 10000_000_000, // 10,000 mmBtu
                tick_size: to_price(0.001),
                tick_value: to_price(10.0),
                initial_margin_pct: 0.10,
                maintenance_margin_pct: 0.08,
                daily_limit_pct: 0.15,
                settlement_type: SettlementType::Physical,
                delivery_months: vec![1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
                trading_hours: "17:00-16:00 CT".to_string(),
            },
            ContractSpec {
                underlying: "COPPER".to_string(),
                contract_size: 25000_000_000, // 25,000 lbs
                tick_size: to_price(0.05),
                tick_value: to_price(12.50),
                initial_margin_pct: 0.06,
                maintenance_margin_pct: 0.05,
                daily_limit_pct: 0.08,
                settlement_type: SettlementType::Physical,
                delivery_months: vec![1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
                trading_hours: "17:00-16:00 CT".to_string(),
            },
            ContractSpec {
                underlying: "CARBON_CREDIT".to_string(),
                contract_size: 1000_000_000, // 1,000 tonnes CO2
                tick_size: to_price(0.01),
                tick_value: to_price(10.0),
                initial_margin_pct: 0.10,
                maintenance_margin_pct: 0.08,
                daily_limit_pct: 0.10,
                settlement_type: SettlementType::Cash,
                delivery_months: vec![3, 6, 9, 12],
                trading_hours: "17:00-16:00 CT".to_string(),
            },
            ContractSpec {
                underlying: "TEA".to_string(),
                contract_size: 5000_000_000, // 5,000 kg
                tick_size: to_price(0.05),
                tick_value: to_price(2.50),
                initial_margin_pct: 0.08,
                maintenance_margin_pct: 0.06,
                daily_limit_pct: 0.08,
                settlement_type: SettlementType::Physical,
                delivery_months: vec![1, 3, 5, 7, 9, 11],
                trading_hours: "08:00-16:00 EAT".to_string(),
            },
        ];

        for spec in specs {
            self.specs.insert(spec.underlying.clone(), spec);
        }
    }

    /// Generate futures symbol. E.g., GOLD-FUT-2026M06 → "GCM6" style internally
    /// but we use readable format for clarity.
    pub fn generate_symbol(underlying: &str, year: i32, month: u32) -> String {
        format!(
            "{}-FUT-{}{}{}",
            underlying,
            year,
            month_code(month),
            format!("{:02}", month)
        )
    }

    /// List a new futures contract for a given underlying, year, and month.
    pub fn list_contract(&self, underlying: &str, year: i32, month: u32) -> Option<FuturesContract> {
        let spec = self.specs.get(underlying)?;

        if !spec.delivery_months.contains(&month) {
            return None;
        }

        let symbol = Self::generate_symbol(underlying, year, month);

        // Calculate dates
        let expiry = NaiveDate::from_ymd_opt(year, month, 1)
            .and_then(|_d| {
                // Last business day of the month before delivery month
                let last_day = if month == 12 {
                    NaiveDate::from_ymd_opt(year + 1, 1, 1)
                } else {
                    NaiveDate::from_ymd_opt(year, month + 1, 1)
                };
                last_day.map(|ld| ld - Duration::days(1))
            })
            .unwrap_or_else(|| NaiveDate::from_ymd_opt(year, month, 28).unwrap());

        let first_notice = NaiveDate::from_ymd_opt(year, month, 1)
            .map(|d| d - Duration::days(2));

        let settlement_price_base = match underlying {
            "GOLD" => to_price(2350.0),
            "SILVER" => to_price(28.50),
            "CRUDE_OIL" => to_price(78.0),
            "COFFEE" => to_price(2.10),
            "COCOA" => to_price(8500.0),
            "MAIZE" => to_price(4.50),
            "WHEAT" => to_price(5.80),
            "SUGAR" => to_price(0.22),
            "NATURAL_GAS" => to_price(2.85),
            "COPPER" => to_price(4.20),
            "CARBON_CREDIT" => to_price(85.0),
            "TEA" => to_price(3.20),
            _ => to_price(100.0),
        };

        let contract = FuturesContract {
            symbol: symbol.clone(),
            underlying: underlying.to_string(),
            contract_type: ContractType::Future,
            contract_size: spec.contract_size,
            tick_size: spec.tick_size,
            tick_value: spec.tick_value,
            initial_margin: (from_price(settlement_price_base) * spec.initial_margin_pct
                * from_price(spec.contract_size)) as Price,
            maintenance_margin: (from_price(settlement_price_base) * spec.maintenance_margin_pct
                * from_price(spec.contract_size)) as Price,
            daily_price_limit: (from_price(settlement_price_base) * spec.daily_limit_pct) as Price,
            expiry_date: expiry
                .and_hms_opt(16, 0, 0)
                .unwrap()
                .and_utc(),
            first_notice_date: first_notice.map(|d| d.and_hms_opt(0, 0, 0).unwrap().and_utc()),
            last_trading_date: (expiry - Duration::days(1))
                .and_hms_opt(16, 0, 0)
                .unwrap()
                .and_utc(),
            settlement_type: spec.settlement_type,
            delivery_months: spec.delivery_months.clone(),
            trading_hours: spec.trading_hours.clone(),
            status: ContractStatus::Active,
            created_at: Utc::now(),
        };

        info!("Listed futures contract: {} (expiry: {})", symbol, expiry);
        self.contracts.insert(symbol, contract.clone());

        Some(contract)
    }

    /// Auto-list contracts for the next N months for all underlyings.
    pub fn auto_list_forward_months(&self, months_ahead: u32) -> Vec<FuturesContract> {
        let now = Utc::now();
        let mut listed = Vec::new();

        for spec_ref in self.specs.iter() {
            let spec = spec_ref.value();
            for month_offset in 0..=months_ahead {
                let target_date = now + Duration::days(month_offset as i64 * 30);
                let year = target_date.year();
                let month = target_date.month();

                if spec.delivery_months.contains(&month) {
                    let symbol = Self::generate_symbol(&spec.underlying, year, month);
                    if !self.contracts.contains_key(&symbol) {
                        if let Some(contract) = self.list_contract(&spec.underlying, year, month) {
                            listed.push(contract);
                        }
                    }
                }
            }
        }

        info!("Auto-listed {} forward contracts", listed.len());
        listed
    }

    /// Get a contract by symbol.
    pub fn get_contract(&self, symbol: &str) -> Option<FuturesContract> {
        self.contracts.get(symbol).map(|r| r.value().clone())
    }

    /// List all active contracts.
    pub fn active_contracts(&self) -> Vec<FuturesContract> {
        self.contracts
            .iter()
            .filter(|r| r.value().status == ContractStatus::Active)
            .map(|r| r.value().clone())
            .collect()
    }

    /// Expire contracts past their last trading date.
    pub fn process_expiries(&self) -> Vec<String> {
        let now = Utc::now();
        let mut expired = Vec::new();

        for mut entry in self.contracts.iter_mut() {
            let contract = entry.value_mut();
            if contract.status == ContractStatus::Active && now > contract.last_trading_date {
                contract.status = ContractStatus::PendingExpiry;
                info!("Contract {} moved to PendingExpiry", contract.symbol);
                expired.push(contract.symbol.clone());
            }
        }

        expired
    }

    /// Set daily settlement price for a contract.
    pub fn set_settlement_price(&self, symbol: &str, price: Price, volume: Qty, oi: Qty) {
        let record = SettlementRecord {
            symbol: symbol.to_string(),
            price,
            date: Utc::now().date_naive(),
            volume,
            open_interest: oi,
        };

        self.settlement_prices
            .entry(symbol.to_string())
            .or_default()
            .push(record);

        info!(
            "Settlement price for {}: {}",
            symbol,
            from_price(price)
        );
    }

    /// Get all registered contract specifications.
    pub fn get_specs(&self) -> Vec<(String, ContractSpec)> {
        self.specs
            .iter()
            .map(|r| (r.key().clone(), r.value().clone()))
            .collect()
    }

    /// Get contract count.
    pub fn contract_count(&self) -> usize {
        self.contracts.len()
    }
}

impl Default for FuturesManager {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_list_gold_future() {
        let mgr = FuturesManager::new();
        let contract = mgr.list_contract("GOLD", 2026, 6);
        assert!(contract.is_some());
        let c = contract.unwrap();
        assert_eq!(c.symbol, "GOLD-FUT-2026M06");
        assert_eq!(c.underlying, "GOLD");
        assert_eq!(c.settlement_type, SettlementType::Physical);
        assert_eq!(c.status, ContractStatus::Active);
    }

    #[test]
    fn test_invalid_delivery_month() {
        let mgr = FuturesManager::new();
        // Gold doesn't trade in January
        let contract = mgr.list_contract("GOLD", 2026, 1);
        assert!(contract.is_none());
    }

    #[test]
    fn test_auto_list_forward() {
        let mgr = FuturesManager::new();
        let listed = mgr.auto_list_forward_months(12);
        assert!(!listed.is_empty());
        info!("Auto-listed {} contracts", listed.len());
    }

    #[test]
    fn test_month_codes() {
        assert_eq!(month_code(1), 'F');
        assert_eq!(month_code(6), 'M');
        assert_eq!(month_code(12), 'Z');
    }
}
