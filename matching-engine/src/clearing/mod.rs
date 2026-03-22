//! Central Counterparty (CCP) Clearing Module.
//! Implements novation, multilateral netting, default waterfall,
//! margin methodology (SPAN-like portfolio margining), and mark-to-market.
#![allow(dead_code)]

use crate::types::*;
use chrono::Utc;
use dashmap::DashMap;
use parking_lot::RwLock;
use std::collections::HashMap;
use tracing::{error, info, warn};
use uuid::Uuid;

// ─── SPAN-like Risk Arrays ──────────────────────────────────────────────────

/// SPAN scanning range scenario.
#[derive(Debug, Clone)]
pub struct ScanScenario {
    pub price_move_pct: f64,
    pub vol_move_pct: f64,
    pub weight: f64,
}

/// SPAN-like margin calculator using risk arrays.
pub struct SpanCalculator {
    /// Scanning ranges per commodity group.
    scan_ranges: HashMap<String, Vec<ScanScenario>>,
    /// Inter-commodity spread credits.
    spread_credits: HashMap<(String, String), f64>,
    /// Intra-commodity spread charges.
    calendar_spread_charges: HashMap<String, f64>,
    /// Short option minimum per contract.
    short_option_minimum: HashMap<String, Price>,
}

impl SpanCalculator {
    pub fn new() -> Self {
        let mut calc = Self {
            scan_ranges: HashMap::new(),
            spread_credits: HashMap::new(),
            calendar_spread_charges: HashMap::new(),
            short_option_minimum: HashMap::new(),
        };
        calc.init_default_scenarios();
        calc
    }

    /// Initialize default SPAN scanning scenarios (16 standard scenarios).
    fn init_default_scenarios(&mut self) {
        let commodities = vec![
            "GOLD", "SILVER", "CRUDE_OIL", "COFFEE", "COCOA", "MAIZE",
            "WHEAT", "SUGAR", "NATURAL_GAS", "COPPER", "CARBON_CREDIT", "TEA",
        ];

        for commodity in &commodities {
            let scan_range = match *commodity {
                "GOLD" => 0.05,
                "CRUDE_OIL" | "NATURAL_GAS" => 0.10,
                "COFFEE" | "COCOA" => 0.08,
                _ => 0.07,
            };

            // 16 standard SPAN scenarios
            let scenarios = vec![
                ScanScenario { price_move_pct: 0.0, vol_move_pct: 0.01, weight: 1.0 },
                ScanScenario { price_move_pct: 0.0, vol_move_pct: -0.01, weight: 1.0 },
                ScanScenario { price_move_pct: scan_range / 3.0, vol_move_pct: 0.01, weight: 1.0 },
                ScanScenario { price_move_pct: scan_range / 3.0, vol_move_pct: -0.01, weight: 1.0 },
                ScanScenario { price_move_pct: -scan_range / 3.0, vol_move_pct: 0.01, weight: 1.0 },
                ScanScenario { price_move_pct: -scan_range / 3.0, vol_move_pct: -0.01, weight: 1.0 },
                ScanScenario { price_move_pct: 2.0 * scan_range / 3.0, vol_move_pct: 0.01, weight: 1.0 },
                ScanScenario { price_move_pct: 2.0 * scan_range / 3.0, vol_move_pct: -0.01, weight: 1.0 },
                ScanScenario { price_move_pct: -2.0 * scan_range / 3.0, vol_move_pct: 0.01, weight: 1.0 },
                ScanScenario { price_move_pct: -2.0 * scan_range / 3.0, vol_move_pct: -0.01, weight: 1.0 },
                ScanScenario { price_move_pct: scan_range, vol_move_pct: 0.01, weight: 1.0 },
                ScanScenario { price_move_pct: scan_range, vol_move_pct: -0.01, weight: 1.0 },
                ScanScenario { price_move_pct: -scan_range, vol_move_pct: 0.01, weight: 1.0 },
                ScanScenario { price_move_pct: -scan_range, vol_move_pct: -0.01, weight: 1.0 },
                // Extreme scenarios (3x range, 35% weight)
                ScanScenario { price_move_pct: 3.0 * scan_range, vol_move_pct: 0.0, weight: 0.35 },
                ScanScenario { price_move_pct: -3.0 * scan_range, vol_move_pct: 0.0, weight: 0.35 },
            ];

            self.scan_ranges.insert(commodity.to_string(), scenarios);
            self.short_option_minimum
                .insert(commodity.to_string(), to_price(50.0));
        }

        // Inter-commodity spread credits (correlated commodities)
        self.spread_credits
            .insert(("GOLD".to_string(), "SILVER".to_string()), 0.75);
        self.spread_credits
            .insert(("CRUDE_OIL".to_string(), "NATURAL_GAS".to_string()), 0.50);
        self.spread_credits
            .insert(("MAIZE".to_string(), "WHEAT".to_string()), 0.60);
        self.spread_credits
            .insert(("COFFEE".to_string(), "COCOA".to_string()), 0.30);

        // Calendar spread charges
        for commodity in &commodities {
            self.calendar_spread_charges
                .insert(commodity.to_string(), 0.20);
        }
    }

    /// Calculate SPAN margin for a portfolio of positions.
    pub fn calculate_margin(
        &self,
        positions: &[Position],
        current_prices: &HashMap<String, f64>,
    ) -> MarginRequirement {
        let account_id = positions
            .first()
            .map(|p| p.account_id.clone())
            .unwrap_or_default();

        let mut total_scan_risk = 0i64;
        let mut total_spread_charge = 0i64;
        let mut total_spread_credit = 0i64;

        // Group positions by underlying commodity
        let mut commodity_groups: HashMap<String, Vec<&Position>> = HashMap::new();
        for pos in positions {
            let underlying = pos
                .symbol
                .split('-')
                .next()
                .unwrap_or(&pos.symbol)
                .to_string();
            commodity_groups
                .entry(underlying)
                .or_default()
                .push(pos);
        }

        // Calculate scan risk per commodity group
        for (commodity, group_positions) in &commodity_groups {
            if let Some(scenarios) = self.scan_ranges.get(commodity) {
                let mut max_loss: i64 = 0;

                for scenario in scenarios {
                    let mut scenario_loss: i64 = 0;

                    for pos in group_positions {
                        let current_price = current_prices
                            .get(&pos.symbol)
                            .copied()
                            .unwrap_or(from_price(pos.average_price));
                        let new_price = current_price * (1.0 + scenario.price_move_pct);
                        let pnl = (new_price - current_price) * pos.quantity as f64;
                        let weighted_loss = match pos.side {
                            Side::Buy => -pnl,
                            Side::Sell => pnl,
                        };
                        scenario_loss += (weighted_loss * scenario.weight) as i64;
                    }

                    if scenario_loss > max_loss {
                        max_loss = scenario_loss;
                    }
                }

                total_scan_risk += max_loss;

                // Calendar spread charge
                if group_positions.len() > 1 {
                    if let Some(charge_pct) = self.calendar_spread_charges.get(commodity) {
                        total_spread_charge += (max_loss as f64 * charge_pct) as i64;
                    }
                }
            }
        }

        // Inter-commodity spread credits
        let commodity_list: Vec<&String> = commodity_groups.keys().collect();
        for i in 0..commodity_list.len() {
            for j in (i + 1)..commodity_list.len() {
                let pair = (commodity_list[i].clone(), commodity_list[j].clone());
                let pair_rev = (commodity_list[j].clone(), commodity_list[i].clone());
                if let Some(credit_pct) = self.spread_credits.get(&pair).or(self.spread_credits.get(&pair_rev)) {
                    total_spread_credit += (total_scan_risk as f64 * credit_pct * 0.1) as i64;
                }
            }
        }

        let initial_margin = (total_scan_risk + total_spread_charge - total_spread_credit).max(0);
        let maintenance_margin = (initial_margin as f64 * 0.80) as i64;

        // Variation margin (unrealized P&L)
        let variation_margin: i64 = positions.iter().map(|p| p.unrealized_pnl).sum();

        MarginRequirement {
            account_id,
            initial_margin,
            maintenance_margin,
            variation_margin,
            portfolio_offset: total_spread_credit,
            net_requirement: initial_margin - total_spread_credit + variation_margin,
            timestamp: Utc::now(),
        }
    }
}

impl Default for SpanCalculator {
    fn default() -> Self {
        Self::new()
    }
}

// ─── Default Waterfall ──────────────────────────────────────────────────────

/// Default waterfall for managing clearing member defaults.
pub struct DefaultWaterfall {
    /// Exchange's own contribution ("skin in the game").
    pub exchange_contribution: Price,
    /// Assessment power multiplier on guarantee fund.
    pub assessment_multiplier: f64,
}

impl DefaultWaterfall {
    pub fn new(exchange_contribution: Price) -> Self {
        Self {
            exchange_contribution,
            assessment_multiplier: 2.0,
        }
    }

    /// Calculate how a loss is allocated through the waterfall.
    pub fn allocate_loss(
        &self,
        loss: Price,
        defaulter: &ClearingMember,
        non_defaulters: &[ClearingMember],
    ) -> Vec<(WaterfallLayer, Price)> {
        let mut remaining = loss;
        let mut allocations = Vec::new();

        // Layer 1: Defaulter's margin (assumed to be their credit limit as proxy)
        let layer1 = remaining.min(defaulter.credit_limit);
        remaining -= layer1;
        allocations.push((WaterfallLayer::DefaulterMargin, layer1));

        if remaining <= 0 {
            return allocations;
        }

        // Layer 2: Defaulter's guarantee fund contribution
        let layer2 = remaining.min(defaulter.guarantee_fund_contribution);
        remaining -= layer2;
        allocations.push((WaterfallLayer::DefaulterGuaranteeFund, layer2));

        if remaining <= 0 {
            return allocations;
        }

        // Layer 3: Exchange skin-in-the-game
        let layer3 = remaining.min(self.exchange_contribution);
        remaining -= layer3;
        allocations.push((WaterfallLayer::ExchangeSkinInTheGame, layer3));

        if remaining <= 0 {
            return allocations;
        }

        // Layer 4: Non-defaulter guarantee fund (pro-rata)
        let total_non_defaulter_gf: Price = non_defaulters
            .iter()
            .map(|m| m.guarantee_fund_contribution)
            .sum();
        let layer4 = remaining.min(total_non_defaulter_gf);
        remaining -= layer4;
        allocations.push((WaterfallLayer::NonDefaulterGuaranteeFund, layer4));

        if remaining <= 0 {
            return allocations;
        }

        // Layer 5: Assessment powers
        let assessment_cap =
            (total_non_defaulter_gf as f64 * self.assessment_multiplier) as Price;
        let layer5 = remaining.min(assessment_cap);
        allocations.push((WaterfallLayer::AssessmentPowers, layer5));

        allocations
    }
}

// ─── Netting Engine ─────────────────────────────────────────────────────────

/// Multilateral netting engine for settlement optimization.
pub struct NettingEngine;

impl NettingEngine {
    /// Perform multilateral netting on a set of trades.
    /// Returns net obligations per account: positive = owes, negative = owed.
    pub fn net_trades(trades: &[Trade]) -> HashMap<String, HashMap<String, i64>> {
        // account -> (symbol -> net_qty)
        let mut positions: HashMap<String, HashMap<String, i64>> = HashMap::new();

        for trade in trades {
            // Buyer gets +qty
            positions
                .entry(trade.buyer_account.clone())
                .or_default()
                .entry(trade.symbol.clone())
                .and_modify(|q| *q += trade.quantity)
                .or_insert(trade.quantity);

            // Seller gets -qty
            positions
                .entry(trade.seller_account.clone())
                .or_default()
                .entry(trade.symbol.clone())
                .and_modify(|q| *q -= trade.quantity)
                .or_insert(-trade.quantity);
        }

        positions
    }

    /// Calculate net cash obligations from trades.
    pub fn net_cash(trades: &[Trade]) -> HashMap<String, i64> {
        let mut cash: HashMap<String, i64> = HashMap::new();

        for trade in trades {
            let value = trade.price as i128 * trade.quantity as i128 / PRICE_SCALE as i128;
            let value = value as i64;

            // Buyer pays
            cash.entry(trade.buyer_account.clone())
                .and_modify(|c| *c -= value)
                .or_insert(-value);

            // Seller receives
            cash.entry(trade.seller_account.clone())
                .and_modify(|c| *c += value)
                .or_insert(value);
        }

        cash
    }
}

// ─── CCP Clearing House ─────────────────────────────────────────────────────

/// Central Counterparty clearing house.
pub struct ClearingHouse {
    /// Clearing members.
    members: DashMap<String, ClearingMember>,
    /// Positions per account.
    positions: DashMap<String, Vec<Position>>,
    /// SPAN margin calculator.
    pub span: SpanCalculator,
    /// Default waterfall.
    pub waterfall: DefaultWaterfall,
    /// Total guarantee fund.
    pub total_guarantee_fund: RwLock<Price>,
    /// Mark-to-market cycle counter.
    mtm_cycle: RwLock<u64>,
}

impl ClearingHouse {
    pub fn new(exchange_contribution: Price) -> Self {
        Self {
            members: DashMap::new(),
            positions: DashMap::new(),
            span: SpanCalculator::new(),
            waterfall: DefaultWaterfall::new(exchange_contribution),
            total_guarantee_fund: RwLock::new(0),
            mtm_cycle: RwLock::new(0),
        }
    }

    /// Register a clearing member.
    pub fn register_member(&self, member: ClearingMember) {
        let mut total = self.total_guarantee_fund.write();
        *total += member.guarantee_fund_contribution;
        info!(
            "Registered clearing member: {} (tier: {:?}, GF: {})",
            member.name,
            member.tier,
            from_price(member.guarantee_fund_contribution)
        );
        self.members.insert(member.id.clone(), member);
    }

    /// Novation: CCP becomes counterparty to both sides of a trade.
    pub fn novate_trade(&self, trade: &Trade) -> Result<(Trade, Trade), String> {
        // Verify both accounts belong to clearing members
        if !self.is_member_account(&trade.buyer_account) {
            return Err(format!(
                "Buyer account {} not associated with a clearing member",
                trade.buyer_account
            ));
        }
        if !self.is_member_account(&trade.seller_account) {
            return Err(format!(
                "Seller account {} not associated with a clearing member",
                trade.seller_account
            ));
        }

        let ccp_id = "CCP-NEXCOM";

        // Original trade becomes two:
        // 1. Buyer <-> CCP (buyer buys from CCP)
        let buy_leg = Trade {
            id: Uuid::new_v4(),
            symbol: trade.symbol.clone(),
            price: trade.price,
            quantity: trade.quantity,
            buyer_order_id: trade.buyer_order_id,
            seller_order_id: Uuid::new_v4(), // CCP's side
            buyer_account: trade.buyer_account.clone(),
            seller_account: ccp_id.to_string(),
            aggressor_side: trade.aggressor_side,
            timestamp: Utc::now(),
            sequence: trade.sequence,
        };

        // 2. CCP <-> Seller (CCP buys from seller)
        let sell_leg = Trade {
            id: Uuid::new_v4(),
            symbol: trade.symbol.clone(),
            price: trade.price,
            quantity: trade.quantity,
            buyer_order_id: Uuid::new_v4(), // CCP's side
            seller_order_id: trade.seller_order_id,
            buyer_account: ccp_id.to_string(),
            seller_account: trade.seller_account.clone(),
            aggressor_side: trade.aggressor_side,
            timestamp: Utc::now(),
            sequence: trade.sequence,
        };

        // Update positions
        self.update_position(&trade.buyer_account, &trade.symbol, Side::Buy, trade.quantity, trade.price);
        self.update_position(&trade.seller_account, &trade.symbol, Side::Sell, trade.quantity, trade.price);

        info!(
            "Novated trade {} -> buy_leg: {}, sell_leg: {}",
            trade.id, buy_leg.id, sell_leg.id
        );

        Ok((buy_leg, sell_leg))
    }

    /// Update a position after a trade.
    fn update_position(&self, account_id: &str, symbol: &str, side: Side, qty: Qty, price: Price) {
        let mut positions = self.positions.entry(account_id.to_string()).or_default();
        
        if let Some(pos) = positions.iter_mut().find(|p| p.symbol == symbol) {
            if pos.side == side {
                // Same direction: increase position
                let total_cost = pos.average_price as i128 * pos.quantity as i128
                    + price as i128 * qty as i128;
                pos.quantity += qty;
                pos.average_price = (total_cost / pos.quantity as i128) as Price;
            } else {
                // Opposite direction: reduce/flip position
                if qty >= pos.quantity {
                    let remaining = qty - pos.quantity;
                    if remaining > 0 {
                        pos.side = side;
                        pos.quantity = remaining;
                        pos.average_price = price;
                    } else {
                        pos.quantity = 0;
                    }
                } else {
                    pos.quantity -= qty;
                }
            }
            pos.updated_at = Utc::now();
        } else {
            positions.push(Position {
                account_id: account_id.to_string(),
                symbol: symbol.to_string(),
                side,
                quantity: qty,
                average_price: price,
                unrealized_pnl: 0,
                realized_pnl: 0,
                initial_margin_required: 0,
                maintenance_margin_required: 0,
                liquidation_price: 0,
                updated_at: Utc::now(),
            });
        }
    }

    /// Perform mark-to-market for all positions.
    pub fn mark_to_market(&self, current_prices: &HashMap<String, f64>) {
        let mut cycle = self.mtm_cycle.write();
        *cycle += 1;
        let cycle_num = *cycle;

        for mut entry in self.positions.iter_mut() {
            for pos in entry.value_mut().iter_mut() {
                if let Some(&current) = current_prices.get(&pos.symbol) {
                    let entry_price = from_price(pos.average_price);
                    let pnl = match pos.side {
                        Side::Buy => (current - entry_price) * pos.quantity as f64,
                        Side::Sell => (entry_price - current) * pos.quantity as f64,
                    };
                    pos.unrealized_pnl = to_price(pnl);
                }
            }
        }

        info!("Mark-to-market cycle {} completed", cycle_num);
    }

    /// Calculate margin requirements for all accounts.
    pub fn calculate_all_margins(
        &self,
        current_prices: &HashMap<String, f64>,
    ) -> Vec<MarginRequirement> {
        let mut requirements = Vec::new();

        for entry in self.positions.iter() {
            let positions = entry.value();
            if positions.is_empty() {
                continue;
            }
            let req = self.span.calculate_margin(positions, current_prices);
            requirements.push(req);
        }

        requirements
    }

    /// Check if an account belongs to a clearing member.
    fn is_member_account(&self, _account_id: &str) -> bool {
        // In production, this would look up account-to-member mapping.
        // For now, all accounts are considered valid.
        true
    }

    /// Get member count.
    pub fn member_count(&self) -> usize {
        self.members.len()
    }

    /// Get all positions for an account.
    pub fn get_positions(&self, account_id: &str) -> Vec<Position> {
        self.positions
            .get(account_id)
            .map(|r| r.value().clone())
            .unwrap_or_default()
    }

    /// Get total guarantee fund.
    pub fn guarantee_fund_total(&self) -> Price {
        *self.total_guarantee_fund.read()
    }

    /// Handle a member default.
    pub fn handle_default(&self, member_id: &str) -> Vec<(WaterfallLayer, Price)> {
        if let Some(mut member) = self.members.get_mut(member_id) {
            member.status = MemberStatus::Defaulted;
            warn!("Clearing member {} DEFAULTED", member.name);

            // Calculate loss (simplified: sum of negative unrealized P&L)
            let loss = to_price(1_000_000.0); // Placeholder for actual loss calculation

            let non_defaulters: Vec<ClearingMember> = self
                .members
                .iter()
                .filter(|r| r.key() != member_id && r.value().status == MemberStatus::Active)
                .map(|r| r.value().clone())
                .collect();

            let allocations = self.waterfall.allocate_loss(loss, &member, &non_defaulters);

            for (layer, amount) in &allocations {
                info!(
                    "Default waterfall {:?}: {}",
                    layer,
                    from_price(*amount)
                );
            }

            allocations
        } else {
            error!("Member {} not found", member_id);
            vec![]
        }
    }

    /// Run stress test scenarios on the clearing house.
    /// Applies hypothetical price shocks and calculates potential losses.
    pub fn run_stress_test(&self, scenarios: &[StressScenario]) -> StressTestResult {
        let mut results = Vec::new();
        let mut max_loss: i64 = 0;

        for scenario in scenarios {
            let mut scenario_loss: i64 = 0;
            let mut member_losses: HashMap<String, i64> = HashMap::new();

            for entry in self.positions.iter() {
                let account_id = entry.key().clone();
                for pos in entry.value() {
                    let shock = scenario.price_shocks.get(&pos.symbol)
                        .or_else(|| scenario.price_shocks.get("*"))
                        .copied()
                        .unwrap_or(0.0);

                    let current = from_price(pos.average_price);
                    let shocked_price = current * (1.0 + shock);
                    let pnl = match pos.side {
                        Side::Buy => (shocked_price - current) * pos.quantity as f64,
                        Side::Sell => (current - shocked_price) * pos.quantity as f64,
                    };

                    if pnl < 0.0 {
                        scenario_loss += (-pnl) as i64;
                        *member_losses.entry(account_id.clone()).or_insert(0) += (-pnl) as i64;
                    }
                }
            }

            if scenario_loss > max_loss {
                max_loss = scenario_loss;
            }

            results.push(ScenarioResult {
                scenario_name: scenario.name.clone(),
                total_loss: to_price(scenario_loss as f64),
                member_losses,
                guarantee_fund_sufficient: to_price(scenario_loss as f64) <= *self.total_guarantee_fund.read(),
            });
        }

        let gf = *self.total_guarantee_fund.read();
        StressTestResult {
            timestamp: Utc::now(),
            scenarios_run: scenarios.len(),
            results,
            worst_case_loss: to_price(max_loss as f64),
            guarantee_fund_coverage: if max_loss > 0 {
                from_price(gf) / max_loss as f64
            } else {
                f64::INFINITY
            },
        }
    }

    /// Get clearing house status summary.
    pub fn status_summary(&self) -> serde_json::Value {
        let active_members = self.members.iter().filter(|r| r.value().status == MemberStatus::Active).count();
        let total_positions: usize = self.positions.iter().map(|r| r.value().len()).sum();

        serde_json::json!({
            "members": {
                "total": self.members.len(),
                "active": active_members,
            },
            "positions": {
                "total": total_positions,
                "accounts": self.positions.len(),
            },
            "guarantee_fund": from_price(*self.total_guarantee_fund.read()),
            "exchange_contribution": from_price(self.waterfall.exchange_contribution),
            "mtm_cycles": *self.mtm_cycle.read(),
        })
    }
}

/// A stress test scenario with hypothetical price shocks.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct StressScenario {
    pub name: String,
    /// Symbol -> price shock percentage (e.g., -0.20 = 20% drop).
    pub price_shocks: HashMap<String, f64>,
}

/// Result of a single stress scenario.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ScenarioResult {
    pub scenario_name: String,
    pub total_loss: Price,
    pub member_losses: HashMap<String, i64>,
    pub guarantee_fund_sufficient: bool,
}

/// Combined stress test results.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct StressTestResult {
    pub timestamp: chrono::DateTime<Utc>,
    pub scenarios_run: usize,
    pub results: Vec<ScenarioResult>,
    pub worst_case_loss: Price,
    pub guarantee_fund_coverage: f64,
}

impl Default for ClearingHouse {
    fn default() -> Self {
        // $200M exchange contribution (like CME)
        Self::new(to_price(200_000_000.0))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_span_margin() {
        let calc = SpanCalculator::new();
        let positions = vec![Position {
            account_id: "ACC001".to_string(),
            symbol: "GOLD-FUT-2026M06".to_string(),
            side: Side::Buy,
            quantity: 10,
            average_price: to_price(2350.0),
            unrealized_pnl: 0,
            realized_pnl: 0,
            initial_margin_required: 0,
            maintenance_margin_required: 0,
            liquidation_price: 0,
            updated_at: Utc::now(),
        }];

        let mut prices = HashMap::new();
        prices.insert("GOLD-FUT-2026M06".to_string(), 2350.0);

        let req = calc.calculate_margin(&positions, &prices);
        assert!(req.initial_margin > 0);
        assert!(req.maintenance_margin > 0);
        assert!(req.maintenance_margin < req.initial_margin);
    }

    #[test]
    fn test_netting() {
        let trades = vec![
            Trade {
                id: Uuid::new_v4(),
                symbol: "GOLD-FUT-2026M06".to_string(),
                price: to_price(2350.0),
                quantity: 100,
                buyer_order_id: Uuid::new_v4(),
                seller_order_id: Uuid::new_v4(),
                buyer_account: "A".to_string(),
                seller_account: "B".to_string(),
                aggressor_side: Side::Buy,
                timestamp: Utc::now(),
                sequence: 1,
            },
            Trade {
                id: Uuid::new_v4(),
                symbol: "GOLD-FUT-2026M06".to_string(),
                price: to_price(2355.0),
                quantity: 50,
                buyer_order_id: Uuid::new_v4(),
                seller_order_id: Uuid::new_v4(),
                buyer_account: "B".to_string(),
                seller_account: "A".to_string(),
                aggressor_side: Side::Buy,
                timestamp: Utc::now(),
                sequence: 2,
            },
        ];

        let net = NettingEngine::net_trades(&trades);
        // A: +100 -50 = +50 net long
        assert_eq!(*net["A"].get("GOLD-FUT-2026M06").unwrap(), 50);
        // B: -100 +50 = -50 net short
        assert_eq!(*net["B"].get("GOLD-FUT-2026M06").unwrap(), -50);
    }

    #[test]
    fn test_default_waterfall() {
        let waterfall = DefaultWaterfall::new(to_price(200_000_000.0));

        let defaulter = ClearingMember {
            id: "M001".to_string(),
            name: "DefaultCo".to_string(),
            tier: ClearingTier::General,
            guarantee_fund_contribution: to_price(10_000_000.0),
            credit_limit: to_price(50_000_000.0),
            status: MemberStatus::Defaulted,
        };

        let non_defaulters = vec![ClearingMember {
            id: "M002".to_string(),
            name: "GoodCo".to_string(),
            tier: ClearingTier::General,
            guarantee_fund_contribution: to_price(10_000_000.0),
            credit_limit: to_price(50_000_000.0),
            status: MemberStatus::Active,
        }];

        let loss = to_price(100_000_000.0);
        let allocations = waterfall.allocate_loss(loss, &defaulter, &non_defaulters);

        assert!(!allocations.is_empty());
        // Layer 1 should use defaulter's margin first
        assert_eq!(allocations[0].0, WaterfallLayer::DefaulterMargin);
    }

    #[test]
    fn test_novation() {
        let ch = ClearingHouse::default();
        ch.register_member(ClearingMember {
            id: "M001".to_string(),
            name: "BuyerFirm".to_string(),
            tier: ClearingTier::General,
            guarantee_fund_contribution: to_price(10_000_000.0),
            credit_limit: to_price(50_000_000.0),
            status: MemberStatus::Active,
        });
        ch.register_member(ClearingMember {
            id: "M002".to_string(),
            name: "SellerFirm".to_string(),
            tier: ClearingTier::General,
            guarantee_fund_contribution: to_price(10_000_000.0),
            credit_limit: to_price(50_000_000.0),
            status: MemberStatus::Active,
        });

        let trade = Trade {
            id: Uuid::new_v4(),
            symbol: "GOLD-FUT-2026M06".to_string(),
            price: to_price(2350.0),
            quantity: 10,
            buyer_order_id: Uuid::new_v4(),
            seller_order_id: Uuid::new_v4(),
            buyer_account: "ACC-BUY".to_string(),
            seller_account: "ACC-SELL".to_string(),
            aggressor_side: Side::Buy,
            timestamp: Utc::now(),
            sequence: 1,
        };

        let result = ch.novate_trade(&trade);
        assert!(result.is_ok());
        let (buy_leg, sell_leg) = result.unwrap();
        assert_eq!(buy_leg.seller_account, "CCP-NEXCOM");
        assert_eq!(sell_leg.buyer_account, "CCP-NEXCOM");
    }
}
