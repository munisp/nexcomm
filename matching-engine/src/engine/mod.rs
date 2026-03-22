//! Core exchange engine that orchestrates all components:
//! orderbook, futures, options, clearing, FIX, surveillance, delivery, HA.

use crate::auction::AuctionEngine;
use crate::broker::BrokerManager;
use crate::circuit_breaker::CircuitBreakerEngine;
use crate::clearing::ClearingHouse;
use crate::corporate_actions::CorporateActionsManager;
use crate::delivery::DeliveryManager;
use crate::fees::FeeEngine;
use crate::fix::FixGateway;
use crate::futures::FuturesManager;
use crate::ha::ClusterManager;
use crate::indices::IndexEngine;
use crate::investor_protection::InvestorProtectionFund;
use crate::market_data::MarketDataEngine;
use crate::market_maker::MarketMakerManager;
use crate::options::OptionsManager;
use crate::orderbook::OrderBookManager;
use crate::surveillance::{AuditTrail, SurveillanceEngine};
use crate::types::*;
use std::sync::Arc;
use tracing::info;

/// The complete NEXCOM exchange engine.
pub struct ExchangeEngine {
    pub orderbooks: Arc<OrderBookManager>,
    pub futures: Arc<FuturesManager>,
    pub options: Arc<OptionsManager>,
    pub clearing: Arc<ClearingHouse>,
    pub fix_gateway: Arc<FixGateway>,
    pub surveillance: Arc<SurveillanceEngine>,
    pub delivery: Arc<DeliveryManager>,
    pub cluster: Arc<ClusterManager>,
    pub audit: Arc<AuditTrail>,
    pub market_makers: Arc<MarketMakerManager>,
    pub indices: Arc<IndexEngine>,
    pub corporate_actions: Arc<CorporateActionsManager>,
    pub brokers: Arc<BrokerManager>,
    // NYSE-equivalent modules
    pub circuit_breaker: Arc<CircuitBreakerEngine>,
    pub auction: Arc<AuctionEngine>,
    pub market_data: Arc<MarketDataEngine>,
    pub investor_protection: Arc<InvestorProtectionFund>,
    // Revenue & Fee Management
    pub fees: Arc<FeeEngine>,
}

impl ExchangeEngine {
    pub fn new(node_id: String, role: NodeRole) -> Self {
        info!("Initializing NEXCOM Exchange Engine (node={}, role={:?})", node_id, role);

        let engine = Self {
            orderbooks: Arc::new(OrderBookManager::new()),
            futures: Arc::new(FuturesManager::new()),
            options: Arc::new(OptionsManager::new(0.05)),
            clearing: Arc::new(ClearingHouse::default()),
            fix_gateway: Arc::new(FixGateway::new("NEXCOM".to_string())),
            surveillance: Arc::new(SurveillanceEngine::new()),
            delivery: Arc::new(DeliveryManager::new()),
            cluster: Arc::new(ClusterManager::new(node_id, role)),
            audit: Arc::new(AuditTrail::new()),
            market_makers: Arc::new(MarketMakerManager::new()),
            indices: Arc::new(IndexEngine::new()),
            corporate_actions: Arc::new(CorporateActionsManager::new()),
            brokers: Arc::new(BrokerManager::new()),
            circuit_breaker: Arc::new(CircuitBreakerEngine::new()),
            auction: Arc::new(AuctionEngine::new()),
            market_data: Arc::new(MarketDataEngine::new()),
            investor_protection: Arc::new(InvestorProtectionFund::new()),
            fees: Arc::new(FeeEngine::new()),
        };

        // Auto-list forward futures contracts
        let listed = engine.futures.auto_list_forward_months(12);
        info!("Auto-listed {} forward futures contracts", listed.len());

        // Register default clearing members
        engine.clearing.register_member(ClearingMember {
            id: "CM-001".to_string(),
            name: "NEXCOM General Clearing".to_string(),
            tier: ClearingTier::General,
            guarantee_fund_contribution: to_price(50_000_000.0),
            credit_limit: to_price(500_000_000.0),
            status: MemberStatus::Active,
        });
        engine.clearing.register_member(ClearingMember {
            id: "CM-002".to_string(),
            name: "Pan-African Commodities Ltd".to_string(),
            tier: ClearingTier::General,
            guarantee_fund_contribution: to_price(25_000_000.0),
            credit_limit: to_price(250_000_000.0),
            status: MemberStatus::Active,
        });
        engine.clearing.register_member(ClearingMember {
            id: "CM-003".to_string(),
            name: "East Africa Trading Corp".to_string(),
            tier: ClearingTier::Individual,
            guarantee_fund_contribution: to_price(10_000_000.0),
            credit_limit: to_price(100_000_000.0),
            status: MemberStatus::Active,
        });

        info!("Exchange engine initialized successfully");
        engine
    }

    /// Submit an order through the full pipeline:
    /// pre-trade checks -> matching -> clearing -> surveillance -> audit.
    pub fn submit_order(&self, order: Order) -> Result<(Vec<Trade>, Order), String> {
        // Check if accepting orders (HA)
        if !self.cluster.is_accepting_orders() {
            return Err("Node is not primary. Orders not accepted.".to_string());
        }

        // Pre-trade risk: position limits
        self.surveillance.position_limits.check_order(
            &order.account_id,
            &order.symbol,
            order.side,
            order.quantity,
        )?;

        // Record order in surveillance
        self.surveillance.record_order(&order.account_id, &order);

        // Audit trail
        self.audit.record(
            "ORDER_NEW",
            &order.id.to_string(),
            &order.account_id,
            &order.symbol,
            serde_json::json!({
                "side": order.side,
                "type": order.order_type,
                "price": from_price(order.price),
                "quantity": order.quantity,
            }),
        );

        // Match
        let (trades, result_order) = self.orderbooks.submit_order(order);

        // Post-trade processing
        for trade in &trades {
            // Novation through CCP
            if let Ok((_buy_leg, _sell_leg)) = self.clearing.novate_trade(trade) {
                // Replicate to standby
                self.cluster.replicate(
                    "TRADE",
                    serde_json::json!({
                        "trade_id": trade.id.to_string(),
                        "symbol": trade.symbol,
                        "price": from_price(trade.price),
                        "quantity": trade.quantity,
                    }),
                );
            }

            // Surveillance
            self.surveillance.record_trade(
                &trade.buyer_account,
                trade,
                Side::Buy,
                &trade.seller_account,
            );
            self.surveillance.record_trade(
                &trade.seller_account,
                trade,
                Side::Sell,
                &trade.buyer_account,
            );

            // Audit
            self.audit.record(
                "TRADE",
                &trade.id.to_string(),
                &trade.buyer_account,
                &trade.symbol,
                serde_json::json!({
                    "price": from_price(trade.price),
                    "quantity": trade.quantity,
                    "buyer": trade.buyer_account,
                    "seller": trade.seller_account,
                }),
            );
        }

        // Audit order result
        self.audit.record(
            &format!("ORDER_{:?}", result_order.status),
            &result_order.id.to_string(),
            &result_order.account_id,
            &result_order.symbol,
            serde_json::json!({
                "status": result_order.status,
                "filled": result_order.filled_quantity,
                "remaining": result_order.remaining_quantity,
            }),
        );

        Ok((trades, result_order))
    }

    /// Cancel an order.
    pub fn cancel_order(&self, symbol: &str, order_id: uuid::Uuid, account_id: &str) -> Result<Order, String> {
        if !self.cluster.is_accepting_orders() {
            return Err("Node is not primary. Orders not accepted.".to_string());
        }

        let order = self
            .orderbooks
            .cancel_order(symbol, order_id)
            .ok_or_else(|| format!("Order {} not found", order_id))?;

        self.audit.record(
            "ORDER_CANCEL",
            &order_id.to_string(),
            account_id,
            symbol,
            serde_json::json!({"status": "CANCELLED"}),
        );

        self.cluster.replicate(
            "ORDER_CANCEL",
            serde_json::json!({"order_id": order_id.to_string(), "symbol": symbol}),
        );

        Ok(order)
    }

    /// Amend (Cancel/Replace) an order.
    pub fn amend_order(
        &self,
        symbol: &str,
        order_id: uuid::Uuid,
        new_price: Option<Price>,
        new_quantity: Option<Qty>,
    ) -> Result<(Vec<Trade>, Order, Order), String> {
        if !self.cluster.is_accepting_orders() {
            return Err("Node is not primary. Orders not accepted.".to_string());
        }

        let (trades, new_order, old_order) =
            self.orderbooks.amend_order(symbol, order_id, new_price, new_quantity)?;

        self.audit.record(
            "ORDER_AMEND",
            &order_id.to_string(),
            &old_order.account_id,
            symbol,
            serde_json::json!({
                "old_price": from_price(old_order.price),
                "new_price": from_price(new_order.price),
                "old_quantity": old_order.quantity,
                "new_quantity": new_order.quantity,
            }),
        );

        self.cluster.replicate(
            "ORDER_AMEND",
            serde_json::json!({
                "order_id": order_id.to_string(),
                "symbol": symbol,
                "new_order_id": new_order.id.to_string(),
            }),
        );

        // Post-trade processing for any fills from the amendment
        for trade in &trades {
            if let Ok((_buy_leg, _sell_leg)) = self.clearing.novate_trade(trade) {
                self.cluster.replicate(
                    "TRADE",
                    serde_json::json!({
                        "trade_id": trade.id.to_string(),
                        "symbol": trade.symbol,
                        "price": from_price(trade.price),
                        "quantity": trade.quantity,
                    }),
                );
            }
        }

        Ok((trades, new_order, old_order))
    }

    /// Get exchange status summary.
    pub fn status(&self) -> serde_json::Value {
        let symbols = self.orderbooks.symbols();
        let active_contracts = self.futures.active_contracts();
        let alerts = self.surveillance.unresolved_alerts();
        let health = self.cluster.run_health_checks();

        serde_json::json!({
            "exchange": "NEXCOM",
            "version": env!("CARGO_PKG_VERSION"),
            "node": self.cluster.cluster_status(),
            "orderbooks": symbols.len(),
            "active_futures": active_contracts.len(),
            "active_options": self.options.active_contracts().len(),
            "clearing_members": self.clearing.member_count(),
            "guarantee_fund": from_price(self.clearing.guarantee_fund_total()),
            "warehouses": self.delivery.get_warehouses().len(),
            "fix_sessions": self.fix_gateway.session_count(),
            "fix_protocol": "FIXT.1.1 / FIX.5.0SP2",
            "surveillance_alerts": alerts.len(),
            "audit_entries": self.audit.entry_count(),
            "audit_integrity": self.audit.verify_integrity(),
            "market_makers": self.market_makers.maker_count(),
            "active_quotes": self.market_makers.active_quote_count(),
            "indices": self.indices.index_count(),
            "corporate_actions": self.corporate_actions.action_count(),
            "brokers": self.brokers.broker_count(),
            "connected_brokers": self.brokers.connected_count(),
            "health": health,
            // NYSE-equivalent modules
            "circuit_breaker": {
                "luld_bands": self.circuit_breaker.band_count(),
                "market_halted": self.circuit_breaker.is_market_halted(),
                "market_wide": self.circuit_breaker.market_wide_status(),
                "volatility_interruptions": self.circuit_breaker.interruption_count(),
            },
            "auction": {
                "active_auctions": self.auction.active_auctions().len(),
                "completed_auctions": self.auction.result_count(),
            },
            "market_data_infrastructure": self.market_data.summary(),
            "investor_protection": self.investor_protection.fund_status(),
            "fees": self.fees.status(),
        })
    }
}

impl Default for ExchangeEngine {
    fn default() -> Self {
        Self::new("nexcom-primary".to_string(), NodeRole::Primary)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_full_order_flow() {
        let engine = ExchangeEngine::default();

        // Place sell order
        let sell = Order::new(
            "SELL-001".to_string(),
            "SELLER-ACC".to_string(),
            "GOLD-FUT-2026M06".to_string(),
            Side::Sell,
            OrderType::Limit,
            TimeInForce::GoodTilCancel,
            to_price(2350.0),
            0,
            100,
        );
        let (trades, order) = engine.submit_order(sell).unwrap();
        assert!(trades.is_empty());
        assert_eq!(order.status, OrderStatus::New);

        // Place matching buy order
        let buy = Order::new(
            "BUY-001".to_string(),
            "BUYER-ACC".to_string(),
            "GOLD-FUT-2026M06".to_string(),
            Side::Buy,
            OrderType::Limit,
            TimeInForce::GoodTilCancel,
            to_price(2350.0),
            0,
            50,
        );
        let (trades, order) = engine.submit_order(buy).unwrap();
        assert_eq!(trades.len(), 1);
        assert_eq!(order.status, OrderStatus::Filled);
        assert_eq!(trades[0].quantity, 50);

        // Verify audit trail
        assert!(engine.audit.entry_count() > 0);
        assert!(engine.audit.verify_integrity());
    }

    #[test]
    fn test_standby_rejects_orders() {
        let engine = ExchangeEngine::new("standby-node".to_string(), NodeRole::Standby);

        let order = Order::new(
            "ORD-001".to_string(),
            "ACC001".to_string(),
            "GOLD-FUT-2026M06".to_string(),
            Side::Buy,
            OrderType::Limit,
            TimeInForce::GoodTilCancel,
            to_price(2350.0),
            0,
            10,
        );
        let result = engine.submit_order(order);
        assert!(result.is_err());
    }

    #[test]
    fn test_exchange_status() {
        let engine = ExchangeEngine::default();
        let status = engine.status();
        assert_eq!(status["exchange"], "NEXCOM");
        assert!(status["clearing_members"].as_u64().unwrap() >= 3);
        assert!(status["audit_integrity"].as_bool().unwrap());
    }
}
