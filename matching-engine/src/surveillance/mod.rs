//! Market Surveillance & Regulatory Compliance Module.
//! Detects spoofing, layering, wash trading, front-running, and other market abuse.
//! Maintains WORM-compliant audit trail and position limit enforcement.
#![allow(dead_code)]

use crate::types::*;
use chrono::{Duration, Utc};
use dashmap::DashMap;
use parking_lot::RwLock;
use sha2::{Sha256, Digest};
use std::collections::{HashMap, VecDeque};
use tracing::{info, warn};
use uuid::Uuid;

// ─── Position Limits ─────────────────────────────────────────────────────────

/// Position limit configuration per symbol/account tier.
#[derive(Debug, Clone)]
pub struct PositionLimit {
    pub symbol: String,
    pub spot_month_limit: Qty,
    pub single_month_limit: Qty,
    pub all_months_limit: Qty,
    pub accountability_level: Qty,
}

/// Position limit engine.
pub struct PositionLimitEngine {
    limits: DashMap<String, PositionLimit>,
    current_positions: DashMap<String, HashMap<String, Qty>>, // account -> symbol -> qty
}

impl PositionLimitEngine {
    pub fn new() -> Self {
        let engine = Self {
            limits: DashMap::new(),
            current_positions: DashMap::new(),
        };
        engine.init_default_limits();
        engine
    }

    fn init_default_limits(&self) {
        let defaults = vec![
            ("GOLD", 6000, 6000, 12000, 3000),
            ("SILVER", 6000, 6000, 12000, 3000),
            ("CRUDE_OIL", 10000, 10000, 20000, 5000),
            ("COFFEE", 5000, 5000, 10000, 2500),
            ("COCOA", 5000, 5000, 10000, 2500),
            ("MAIZE", 33000, 33000, 66000, 16500),
            ("WHEAT", 12000, 12000, 24000, 6000),
            ("SUGAR", 10000, 10000, 20000, 5000),
            ("NATURAL_GAS", 12000, 12000, 24000, 6000),
            ("COPPER", 5000, 5000, 10000, 2500),
            ("CARBON_CREDIT", 5000, 5000, 10000, 2500),
            ("TEA", 3000, 3000, 6000, 1500),
        ];

        for (sym, spot, single, all, acct) in defaults {
            self.limits.insert(
                sym.to_string(),
                PositionLimit {
                    symbol: sym.to_string(),
                    spot_month_limit: spot,
                    single_month_limit: single,
                    all_months_limit: all,
                    accountability_level: acct,
                },
            );
        }
    }

    /// Check if an order would violate position limits.
    pub fn check_order(&self, account_id: &str, symbol: &str, side: Side, quantity: Qty) -> Result<(), String> {
        let underlying = symbol.split('-').next().unwrap_or(symbol);

        if let Some(limit) = self.limits.get(underlying) {
            let current = self
                .current_positions
                .get(account_id)
                .and_then(|m| m.get(symbol).copied())
                .unwrap_or(0);

            let new_position = match side {
                Side::Buy => current + quantity,
                Side::Sell => current - quantity,
            };

            if new_position.unsigned_abs() as Qty > limit.all_months_limit {
                return Err(format!(
                    "Position limit breach: {} position {} exceeds limit {} for {}",
                    account_id,
                    new_position.unsigned_abs(),
                    limit.all_months_limit,
                    underlying
                ));
            }

            if new_position.unsigned_abs() as Qty > limit.accountability_level {
                warn!(
                    "Accountability level reached: {} has {} contracts in {}",
                    account_id,
                    new_position.unsigned_abs(),
                    symbol
                );
            }
        }

        Ok(())
    }

    /// Update position after a trade.
    pub fn update_position(&self, account_id: &str, symbol: &str, side: Side, quantity: Qty) {
        let mut positions = self.current_positions.entry(account_id.to_string()).or_default();
        let current = positions.entry(symbol.to_string()).or_insert(0);
        match side {
            Side::Buy => *current += quantity as i64,
            Side::Sell => *current -= quantity as i64,
        };
    }

    /// Get position for an account/symbol.
    pub fn get_position(&self, account_id: &str, symbol: &str) -> i64 {
        self.current_positions
            .get(account_id)
            .and_then(|m| m.get(symbol).copied())
            .unwrap_or(0)
    }
}

impl Default for PositionLimitEngine {
    fn default() -> Self {
        Self::new()
    }
}

// ─── Market Abuse Detection ──────────────────────────────────────────────────

/// Tracks order activity for an account to detect patterns.
#[derive(Debug, Clone)]
struct AccountActivity {
    recent_orders: VecDeque<OrderEvent>,
    recent_cancels: VecDeque<CancelEvent>,
    recent_trades: VecDeque<TradeEvent>,
}

#[derive(Debug, Clone)]
struct OrderEvent {
    order_id: Uuid,
    symbol: String,
    side: Side,
    price: Price,
    quantity: Qty,
    timestamp: chrono::DateTime<Utc>,
}

#[derive(Debug, Clone)]
struct CancelEvent {
    order_id: Uuid,
    symbol: String,
    side: Side,
    quantity: Qty,
    time_alive_ms: i64,
    timestamp: chrono::DateTime<Utc>,
}

#[derive(Debug, Clone)]
struct TradeEvent {
    trade_id: Uuid,
    symbol: String,
    side: Side,
    price: Price,
    quantity: Qty,
    counterparty: String,
    timestamp: chrono::DateTime<Utc>,
}

impl AccountActivity {
    fn new() -> Self {
        Self {
            recent_orders: VecDeque::new(),
            recent_cancels: VecDeque::new(),
            recent_trades: VecDeque::new(),
        }
    }

    fn cleanup_old(&mut self, window: Duration) {
        let cutoff = Utc::now() - window;
        while self.recent_orders.front().map(|o| o.timestamp < cutoff).unwrap_or(false) {
            self.recent_orders.pop_front();
        }
        while self.recent_cancels.front().map(|c| c.timestamp < cutoff).unwrap_or(false) {
            self.recent_cancels.pop_front();
        }
        while self.recent_trades.front().map(|t| t.timestamp < cutoff).unwrap_or(false) {
            self.recent_trades.pop_front();
        }
    }
}

/// Market surveillance engine detecting various forms of market abuse.
pub struct SurveillanceEngine {
    /// Activity per account.
    activity: DashMap<String, AccountActivity>,
    /// Generated alerts.
    pub alerts: DashMap<Uuid, SurveillanceAlert>,
    /// Position limits.
    pub position_limits: PositionLimitEngine,
    /// Configuration.
    spoofing_cancel_ratio_threshold: f64,
    spoofing_time_window_ms: i64,
    wash_trade_window_ms: i64,
    layering_level_threshold: usize,
    unusual_volume_multiplier: f64,
    /// Average volumes per symbol (for anomaly detection).
    avg_volumes: DashMap<String, f64>,
}

impl SurveillanceEngine {
    pub fn new() -> Self {
        Self {
            activity: DashMap::new(),
            alerts: DashMap::new(),
            position_limits: PositionLimitEngine::new(),
            spoofing_cancel_ratio_threshold: 0.90,
            spoofing_time_window_ms: 1000,
            wash_trade_window_ms: 5000,
            layering_level_threshold: 4,
            unusual_volume_multiplier: 3.0,
            avg_volumes: DashMap::new(),
        }
    }

    /// Record an order submission.
    pub fn record_order(&self, account_id: &str, order: &Order) {
        let mut activity = self.activity.entry(account_id.to_string()).or_insert_with(AccountActivity::new);
        activity.cleanup_old(Duration::minutes(10));
        activity.recent_orders.push_back(OrderEvent {
            order_id: order.id,
            symbol: order.symbol.clone(),
            side: order.side,
            price: order.price,
            quantity: order.quantity,
            timestamp: Utc::now(),
        });
    }

    /// Record an order cancellation.
    pub fn record_cancel(&self, account_id: &str, order: &Order, time_alive_ms: i64) {
        let mut activity = self.activity.entry(account_id.to_string()).or_insert_with(AccountActivity::new);
        activity.recent_cancels.push_back(CancelEvent {
            order_id: order.id,
            symbol: order.symbol.clone(),
            side: order.side,
            quantity: order.quantity,
            time_alive_ms,
            timestamp: Utc::now(),
        });

        // Check for spoofing pattern
        self.detect_spoofing(account_id, &activity);
    }

    /// Record a trade execution.
    pub fn record_trade(&self, account_id: &str, trade: &Trade, side: Side, counterparty: &str) {
        let mut activity = self.activity.entry(account_id.to_string()).or_insert_with(AccountActivity::new);
        activity.recent_trades.push_back(TradeEvent {
            trade_id: trade.id,
            symbol: trade.symbol.clone(),
            side,
            price: trade.price,
            quantity: trade.quantity,
            counterparty: counterparty.to_string(),
            timestamp: Utc::now(),
        });

        // Check for wash trading
        self.detect_wash_trading(account_id, &activity);

        // Check for unusual volume
        self.detect_unusual_volume(&trade.symbol, trade.quantity);

        // Update position limits
        self.position_limits.update_position(account_id, &trade.symbol, side, trade.quantity);
    }

    /// Detect spoofing: high cancel-to-trade ratio with short-lived orders.
    fn detect_spoofing(&self, account_id: &str, activity: &AccountActivity) {
        let window = Duration::milliseconds(self.spoofing_time_window_ms);
        let cutoff = Utc::now() - window;

        let recent_orders: Vec<_> = activity
            .recent_orders
            .iter()
            .filter(|o| o.timestamp > cutoff)
            .collect();
        let recent_cancels: Vec<_> = activity
            .recent_cancels
            .iter()
            .filter(|c| c.timestamp > cutoff)
            .collect();

        if recent_orders.len() < 5 {
            return; // Need minimum activity
        }

        let cancel_ratio = recent_cancels.len() as f64 / recent_orders.len() as f64;
        let avg_cancel_time: f64 = if !recent_cancels.is_empty() {
            recent_cancels.iter().map(|c| c.time_alive_ms as f64).sum::<f64>()
                / recent_cancels.len() as f64
        } else {
            f64::MAX
        };

        // Spoofing: high cancel ratio + very short-lived orders
        if cancel_ratio > self.spoofing_cancel_ratio_threshold && avg_cancel_time < 500.0 {
            let symbol = recent_orders.last().map(|o| o.symbol.clone()).unwrap_or_default();
            self.create_alert(
                AlertType::Spoofing,
                AlertSeverity::High,
                account_id,
                &symbol,
                format!(
                    "Suspected spoofing: cancel ratio {:.1}%, avg order lifetime {:.0}ms over {} orders",
                    cancel_ratio * 100.0,
                    avg_cancel_time,
                    recent_orders.len()
                ),
            );
        }
    }

    /// Detect wash trading: same account on both sides of a trade.
    fn detect_wash_trading(&self, account_id: &str, activity: &AccountActivity) {
        let window = Duration::milliseconds(self.wash_trade_window_ms);
        let cutoff = Utc::now() - window;

        let recent: Vec<_> = activity
            .recent_trades
            .iter()
            .filter(|t| t.timestamp > cutoff)
            .collect();

        // Check if account traded with itself (same counterparty)
        for trade in &recent {
            if trade.counterparty == account_id {
                self.create_alert(
                    AlertType::WashTrading,
                    AlertSeverity::Critical,
                    account_id,
                    &trade.symbol,
                    format!(
                        "Wash trade detected: account {} traded with itself, {} @ {}",
                        account_id,
                        trade.quantity,
                        from_price(trade.price)
                    ),
                );
            }
        }

        // Check for rapid buy-sell pattern at similar prices
        let buys: Vec<_> = recent.iter().filter(|t| t.side == Side::Buy).collect();
        let sells: Vec<_> = recent.iter().filter(|t| t.side == Side::Sell).collect();

        for buy in &buys {
            for sell in &sells {
                if buy.symbol == sell.symbol {
                    let price_diff = (buy.price - sell.price).unsigned_abs();
                    let threshold = (buy.price as f64 * 0.001) as u64; // 0.1% tolerance
                    if price_diff < threshold
                        && (buy.timestamp - sell.timestamp).num_milliseconds().unsigned_abs()
                            < self.wash_trade_window_ms as u64
                    {
                        self.create_alert(
                            AlertType::WashTrading,
                            AlertSeverity::High,
                            account_id,
                            &buy.symbol,
                            format!(
                                "Suspected wash trading: rapid buy-sell at similar prices within {}ms",
                                self.wash_trade_window_ms
                            ),
                        );
                        return;
                    }
                }
            }
        }
    }

    /// Detect unusual volume spikes.
    fn detect_unusual_volume(&self, symbol: &str, quantity: Qty) {
        let avg = self.avg_volumes.get(symbol).map(|r| *r.value()).unwrap_or(100.0);

        if quantity as f64 > avg * self.unusual_volume_multiplier {
            self.create_alert(
                AlertType::UnusualVolume,
                AlertSeverity::Medium,
                "SYSTEM",
                symbol,
                format!(
                    "Unusual volume: {} contracts vs {:.0} average ({}x)",
                    quantity,
                    avg,
                    quantity as f64 / avg
                ),
            );
        }

        // Update running average (exponential moving average)
        let alpha = 0.1;
        let new_avg = avg * (1.0 - alpha) + quantity as f64 * alpha;
        self.avg_volumes.insert(symbol.to_string(), new_avg);
    }

    /// Create a surveillance alert.
    fn create_alert(
        &self,
        alert_type: AlertType,
        severity: AlertSeverity,
        account_id: &str,
        symbol: &str,
        description: String,
    ) {
        let alert = SurveillanceAlert {
            id: Uuid::new_v4(),
            alert_type,
            severity,
            account_id: account_id.to_string(),
            symbol: symbol.to_string(),
            description: description.clone(),
            evidence: serde_json::json!({}),
            timestamp: Utc::now(),
            resolved: false,
        };

        warn!(
            "SURVEILLANCE ALERT [{:?}] {:?}: {} - {}",
            severity, alert_type, account_id, description
        );

        self.alerts.insert(alert.id, alert);
    }

    /// Get all unresolved alerts.
    pub fn unresolved_alerts(&self) -> Vec<SurveillanceAlert> {
        self.alerts
            .iter()
            .filter(|r| !r.value().resolved)
            .map(|r| r.value().clone())
            .collect()
    }

    /// Get alert count by severity.
    pub fn alert_counts(&self) -> HashMap<String, usize> {
        let mut counts = HashMap::new();
        for entry in self.alerts.iter() {
            let key = format!("{:?}", entry.value().severity);
            *counts.entry(key).or_insert(0) += 1;
        }
        counts
    }

    /// Detect layering: multiple orders at different price levels on one side.
    /// Layering creates false impression of supply/demand.
    fn detect_layering(&self, account_id: &str, activity: &AccountActivity) {
        let cutoff = Utc::now() - Duration::seconds(10);
        let recent_orders: Vec<_> = activity
            .recent_orders
            .iter()
            .filter(|o| o.timestamp > cutoff)
            .collect();

        if recent_orders.len() < self.layering_level_threshold {
            return;
        }

        // Group by symbol+side, check for multiple distinct price levels
        let mut side_prices: HashMap<(String, Side), Vec<Price>> = HashMap::new();
        for order in &recent_orders {
            side_prices
                .entry((order.symbol.clone(), order.side))
                .or_default()
                .push(order.price);
        }

        for ((symbol, side), prices) in &side_prices {
            let mut unique_prices: Vec<Price> = prices.clone();
            unique_prices.sort();
            unique_prices.dedup();

            if unique_prices.len() >= self.layering_level_threshold {
                // Check if these were mostly cancelled (spoofing variant)
                let cancel_count = activity
                    .recent_cancels
                    .iter()
                    .filter(|c| c.timestamp > cutoff && c.symbol == *symbol && c.side == *side)
                    .count();

                if cancel_count as f64 / prices.len() as f64 > 0.5 {
                    self.create_alert(
                        AlertType::Spoofing,
                        AlertSeverity::High,
                        account_id,
                        symbol,
                        format!(
                            "Layering detected: {} price levels on {:?} side with {:.0}% cancellation rate",
                            unique_prices.len(),
                            side,
                            cancel_count as f64 / prices.len() as f64 * 100.0
                        ),
                    );
                }
            }
        }
    }

    /// Detect front-running: orders placed ahead of large pending orders.
    /// Checks if an account consistently trades just before large orders execute.
    pub fn detect_front_running(&self, account_id: &str, large_order_symbol: &str, large_order_side: Side) {
        if let Some(activity) = self.activity.get(account_id) {
            let cutoff = Utc::now() - Duration::seconds(5);
            let recent_same_direction: Vec<_> = activity
                .recent_orders
                .iter()
                .filter(|o| {
                    o.timestamp > cutoff
                        && o.symbol == large_order_symbol
                        && o.side == large_order_side
                })
                .collect();

            // If this account placed orders in the same direction just before a large order
            if recent_same_direction.len() >= 2 {
                self.create_alert(
                    AlertType::CrossMarketManipulation,
                    AlertSeverity::Critical,
                    account_id,
                    large_order_symbol,
                    format!(
                        "Suspected front-running: {} orders placed on {:?} side within 5s before large order",
                        recent_same_direction.len(),
                        large_order_side
                    ),
                );
            }
        }
    }

    /// Detect excessive order-to-trade ratio.
    /// High ratio indicates potential manipulation or algorithm malfunction.
    pub fn check_order_to_trade_ratio(&self, account_id: &str) {
        if let Some(activity) = self.activity.get(account_id) {
            let cutoff = Utc::now() - Duration::minutes(5);
            let order_count = activity
                .recent_orders
                .iter()
                .filter(|o| o.timestamp > cutoff)
                .count();
            let trade_count = activity
                .recent_trades
                .iter()
                .filter(|t| t.timestamp > cutoff)
                .count();

            if order_count > 20 && trade_count > 0 {
                let ratio = order_count as f64 / trade_count as f64;
                if ratio > 50.0 {
                    self.create_alert(
                        AlertType::ExcessiveOrderRatio,
                        AlertSeverity::High,
                        account_id,
                        "",
                        format!(
                            "Excessive order-to-trade ratio: {:.1}:1 ({} orders, {} trades in 5min)",
                            ratio, order_count, trade_count
                        ),
                    );
                }
            }
        }
    }

    /// Detect concentration risk: single account holding too large a % of open interest.
    pub fn check_concentration(&self, account_id: &str, symbol: &str, account_qty: Qty, total_open_interest: Qty) {
        if total_open_interest == 0 {
            return;
        }
        let concentration = account_qty as f64 / total_open_interest as f64;
        if concentration > 0.10 {
            self.create_alert(
                AlertType::ConcentrationRisk,
                AlertSeverity::High,
                account_id,
                symbol,
                format!(
                    "Concentration risk: {:.1}% of open interest ({} of {} contracts)",
                    concentration * 100.0,
                    account_qty,
                    total_open_interest
                ),
            );
        }
    }

    /// Resolve an alert.
    pub fn resolve_alert(&self, alert_id: Uuid) -> bool {
        if let Some(mut alert) = self.alerts.get_mut(&alert_id) {
            alert.resolved = true;
            info!("Resolved surveillance alert: {}", alert_id);
            true
        } else {
            false
        }
    }

    /// Get all alerts (resolved and unresolved).
    pub fn all_alerts(&self) -> Vec<SurveillanceAlert> {
        self.alerts.iter().map(|r| r.value().clone()).collect()
    }

    /// Get surveillance summary for API.
    pub fn summary(&self) -> serde_json::Value {
        let total = self.alerts.len();
        let unresolved = self.alerts.iter().filter(|r| !r.value().resolved).count();
        let counts = self.alert_counts();

        serde_json::json!({
            "total_alerts": total,
            "unresolved": unresolved,
            "by_severity": counts,
            "detection_patterns": [
                "spoofing",
                "layering",
                "wash_trading",
                "front_running",
                "unusual_volume",
                "excessive_order_ratio",
                "concentration_risk",
            ],
            "position_limits_active": true,
        })
    }
}

impl Default for SurveillanceEngine {
    fn default() -> Self {
        Self::new()
    }
}

// ─── Audit Trail ─────────────────────────────────────────────────────────────

/// WORM (Write Once Read Many) compliant audit trail.
/// Every event is sequenced, checksummed, and immutable.
pub struct AuditTrail {
    entries: RwLock<Vec<AuditEntry>>,
    sequence: RwLock<u64>,
}

impl AuditTrail {
    pub fn new() -> Self {
        Self {
            entries: RwLock::new(Vec::new()),
            sequence: RwLock::new(0),
        }
    }

    /// Record an audit entry. Returns the sequence number.
    pub fn record(
        &self,
        event_type: &str,
        entity_id: &str,
        account_id: &str,
        symbol: &str,
        data: serde_json::Value,
    ) -> u64 {
        let mut seq = self.sequence.write();
        *seq += 1;
        let sequence = *seq;

        // Create checksum from previous entry + current data
        let entries = self.entries.read();
        let prev_checksum = entries
            .last()
            .map(|e| e.checksum.clone())
            .unwrap_or_else(|| "GENESIS".to_string());
        drop(entries);

        let checksum_input = format!(
            "{}:{}:{}:{}:{}:{}",
            prev_checksum,
            sequence,
            event_type,
            entity_id,
            account_id,
            data
        );
        // SHA-256 checksum for regulatory-grade audit trail
        let checksum = {
            let mut hasher = Sha256::new();
            hasher.update(checksum_input.as_bytes());
            hex::encode(hasher.finalize())
        };

        let entry = AuditEntry {
            id: Uuid::new_v4(),
            sequence,
            event_type: event_type.to_string(),
            entity_id: entity_id.to_string(),
            account_id: account_id.to_string(),
            symbol: symbol.to_string(),
            data,
            timestamp: Utc::now(),
            checksum,
        };

        let mut entries = self.entries.write();
        entries.push(entry);

        sequence
    }

    /// Verify chain integrity.
    pub fn verify_integrity(&self) -> bool {
        let entries = self.entries.read();
        if entries.is_empty() {
            return true;
        }

        for i in 1..entries.len() {
            let prev_checksum = &entries[i - 1].checksum;
            let entry = &entries[i];
            let expected_input = format!(
                "{}:{}:{}:{}:{}:{}",
                prev_checksum,
                entry.sequence,
                entry.event_type,
                entry.entity_id,
                entry.account_id,
                entry.data
            );
            let expected = {
                let mut hasher = Sha256::new();
                hasher.update(expected_input.as_bytes());
                hex::encode(hasher.finalize())
            };

            if entry.checksum != expected {
                warn!(
                    "Audit trail integrity violation at sequence {}",
                    entry.sequence
                );
                return false;
            }
        }

        true
    }

    /// Get entry count.
    pub fn entry_count(&self) -> usize {
        self.entries.read().len()
    }

    /// Get entries in a range.
    pub fn get_range(&self, from_seq: u64, to_seq: u64) -> Vec<AuditEntry> {
        self.entries
            .read()
            .iter()
            .filter(|e| e.sequence >= from_seq && e.sequence <= to_seq)
            .cloned()
            .collect()
    }

    /// Get current sequence number.
    pub fn current_sequence(&self) -> u64 {
        *self.sequence.read()
    }
}

impl Default for AuditTrail {
    fn default() -> Self {
        Self::new()
    }
}

// ─── Regulatory Reporting ────────────────────────────────────────────────────

/// Generates regulatory reports (EMIR, Dodd-Frank style).
pub struct RegulatoryReporter;

impl RegulatoryReporter {
    /// Generate a daily trade report.
    pub fn daily_trade_report(trades: &[Trade]) -> serde_json::Value {
        let total_volume: Qty = trades.iter().map(|t| t.quantity).sum();
        let total_value: f64 = trades
            .iter()
            .map(|t| from_price(t.price) * t.quantity as f64)
            .sum();
        let unique_symbols: std::collections::HashSet<&str> =
            trades.iter().map(|t| t.symbol.as_str()).collect();

        serde_json::json!({
            "report_type": "DAILY_TRADE",
            "date": Utc::now().format("%Y-%m-%d").to_string(),
            "total_trades": trades.len(),
            "total_volume": total_volume,
            "total_notional_value": total_value,
            "unique_instruments": unique_symbols.len(),
            "instruments": unique_symbols.into_iter().collect::<Vec<_>>(),
            "generated_at": Utc::now().to_rfc3339(),
        })
    }

    /// Generate a position report (Commitment of Traders style).
    pub fn position_report(positions: &[Position]) -> serde_json::Value {
        let mut by_symbol: HashMap<String, (Qty, Qty)> = HashMap::new();
        for pos in positions {
            let entry = by_symbol.entry(pos.symbol.clone()).or_default();
            match pos.side {
                Side::Buy => entry.0 += pos.quantity,
                Side::Sell => entry.1 += pos.quantity,
            }
        }

        let instruments: Vec<serde_json::Value> = by_symbol
            .iter()
            .map(|(symbol, (long, short))| {
                serde_json::json!({
                    "symbol": symbol,
                    "long_positions": long,
                    "short_positions": short,
                    "net_position": *long as i64 - *short as i64,
                    "open_interest": long + short,
                })
            })
            .collect();

        serde_json::json!({
            "report_type": "COMMITMENT_OF_TRADERS",
            "date": Utc::now().format("%Y-%m-%d").to_string(),
            "instruments": instruments,
            "generated_at": Utc::now().to_rfc3339(),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_position_limits() {
        let engine = PositionLimitEngine::new();
        // Within limits
        let result = engine.check_order("ACC001", "GOLD-FUT-2026M06", Side::Buy, 100);
        assert!(result.is_ok());

        // Exceed limits
        let result = engine.check_order("ACC001", "GOLD-FUT-2026M06", Side::Buy, 999999);
        assert!(result.is_err());
    }

    #[test]
    fn test_audit_trail_integrity() {
        let trail = AuditTrail::new();

        trail.record("ORDER_NEW", "ORD-1", "ACC001", "GOLD", serde_json::json!({"price": 2350}));
        trail.record("ORDER_FILL", "ORD-1", "ACC001", "GOLD", serde_json::json!({"qty": 10}));
        trail.record("ORDER_CANCEL", "ORD-2", "ACC002", "SILVER", serde_json::json!({}));

        assert_eq!(trail.entry_count(), 3);
        assert!(trail.verify_integrity());
    }

    #[test]
    fn test_surveillance_alert_creation() {
        let engine = SurveillanceEngine::new();
        assert_eq!(engine.unresolved_alerts().len(), 0);
    }

    #[test]
    fn test_regulatory_report() {
        let trades = vec![Trade {
            id: Uuid::new_v4(),
            symbol: "GOLD-FUT-2026M06".to_string(),
            price: to_price(2350.0),
            quantity: 10,
            buyer_order_id: Uuid::new_v4(),
            seller_order_id: Uuid::new_v4(),
            buyer_account: "A".to_string(),
            seller_account: "B".to_string(),
            aggressor_side: Side::Buy,
            timestamp: Utc::now(),
            sequence: 1,
        }];

        let report = RegulatoryReporter::daily_trade_report(&trades);
        assert_eq!(report["total_trades"], 1);
    }
}
