//! Broker/Dealer connectivity layer — manages broker registrations,
//! trading permissions, order routing, and connectivity status.

use chrono::{DateTime, Utc};
use parking_lot::RwLock;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use uuid::Uuid;

// ─── Broker Types ───────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Broker {
    pub id: String,
    pub name: String,
    pub license_number: String,
    pub clearing_member_id: String,
    pub broker_type: BrokerType,
    pub status: BrokerStatus,
    pub connectivity: ConnectivityInfo,
    pub permissions: BrokerPermissions,
    pub clients: Vec<BrokerClient>,
    pub registered_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum BrokerType {
    /// Full-service broker with direct market access
    FullService,
    /// Execution-only broker
    ExecutionOnly,
    /// Algorithmic/electronic trading firm
    AlgoTrader,
    /// Introducing broker (routes through clearing member)
    Introducing,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum BrokerStatus {
    Active,
    Suspended,
    PendingApproval,
    Revoked,
    Inactive,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConnectivityInfo {
    pub protocol: ConnectionProtocol,
    pub endpoint: String,
    pub connected: bool,
    pub last_heartbeat: Option<DateTime<Utc>>,
    pub latency_us: Option<u64>,
    pub messages_sent: u64,
    pub messages_received: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum ConnectionProtocol {
    Fix50,
    Fix44,
    RestApi,
    Websocket,
    Binary,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BrokerPermissions {
    pub can_trade_futures: bool,
    pub can_trade_options: bool,
    pub can_trade_spot: bool,
    pub can_use_algo: bool,
    pub max_order_size: i64,
    pub max_daily_volume: i64,
    pub allowed_symbols: Vec<String>, // empty = all symbols
    pub risk_limit: f64,
}

impl Default for BrokerPermissions {
    fn default() -> Self {
        Self {
            can_trade_futures: true,
            can_trade_options: true,
            can_trade_spot: true,
            can_use_algo: false,
            max_order_size: 1_000_000_000, // 1000 lots
            max_daily_volume: 10_000_000_000,
            allowed_symbols: vec![],
            risk_limit: 10_000_000.0,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BrokerClient {
    pub client_id: String,
    pub name: String,
    pub account_id: String,
    pub kyc_status: String,
}

// ─── Order Route ────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OrderRoute {
    pub id: Uuid,
    pub broker_id: String,
    pub client_account: String,
    pub symbol: String,
    pub side: String,
    pub quantity: i64,
    pub route_status: RouteStatus,
    pub received_at: DateTime<Utc>,
    pub routed_at: Option<DateTime<Utc>>,
    pub acknowledged_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum RouteStatus {
    Received,
    Validated,
    Routed,
    Acknowledged,
    Rejected,
}

// ─── Broker Manager ─────────────────────────────────────────────────────────

pub struct BrokerManager {
    brokers: RwLock<HashMap<String, Broker>>,
    routes: RwLock<Vec<OrderRoute>>,
}

impl BrokerManager {
    pub fn new() -> Self {
        let mgr = Self {
            brokers: RwLock::new(HashMap::new()),
            routes: RwLock::new(Vec::new()),
        };
        mgr.register_default_brokers();
        mgr
    }

    fn register_default_brokers(&self) {
        self.register_broker(Broker {
            id: "BRK-001".to_string(),
            name: "NEXCOM Securities Ltd".to_string(),
            license_number: "CMA-NGX-2026-001".to_string(),
            clearing_member_id: "CM-001".to_string(),
            broker_type: BrokerType::FullService,
            status: BrokerStatus::Active,
            connectivity: ConnectivityInfo {
                protocol: ConnectionProtocol::Fix50,
                endpoint: "fix://nexcom-securities:9876".to_string(),
                connected: true,
                last_heartbeat: Some(Utc::now()),
                latency_us: Some(120),
                messages_sent: 45_892,
                messages_received: 45_890,
            },
            permissions: BrokerPermissions {
                can_use_algo: true,
                ..Default::default()
            },
            clients: vec![
                BrokerClient { client_id: "CLI-001".into(), name: "Nairobi Grain Traders".into(), account_id: "ACC-001".into(), kyc_status: "VERIFIED".into() },
                BrokerClient { client_id: "CLI-002".into(), name: "East Africa Coffee Co".into(), account_id: "ACC-002".into(), kyc_status: "VERIFIED".into() },
                BrokerClient { client_id: "CLI-003".into(), name: "Lagos Commodity Fund".into(), account_id: "ACC-003".into(), kyc_status: "VERIFIED".into() },
            ],
            registered_at: Utc::now(),
        });

        self.register_broker(Broker {
            id: "BRK-002".to_string(),
            name: "Pan-African Capital Markets".to_string(),
            license_number: "CMA-NGX-2026-002".to_string(),
            clearing_member_id: "CM-002".to_string(),
            broker_type: BrokerType::FullService,
            status: BrokerStatus::Active,
            connectivity: ConnectivityInfo {
                protocol: ConnectionProtocol::Fix50,
                endpoint: "fix://pan-african-cm:9876".to_string(),
                connected: true,
                last_heartbeat: Some(Utc::now()),
                latency_us: Some(245),
                messages_sent: 23_456,
                messages_received: 23_455,
            },
            permissions: BrokerPermissions::default(),
            clients: vec![
                BrokerClient { client_id: "CLI-004".into(), name: "Accra Gold Dealers".into(), account_id: "ACC-004".into(), kyc_status: "VERIFIED".into() },
                BrokerClient { client_id: "CLI-005".into(), name: "Dar Commodities Ltd".into(), account_id: "ACC-005".into(), kyc_status: "VERIFIED".into() },
            ],
            registered_at: Utc::now(),
        });

        self.register_broker(Broker {
            id: "BRK-003".to_string(),
            name: "AlgoTrade Africa".to_string(),
            license_number: "CMA-NGX-2026-003".to_string(),
            clearing_member_id: "CM-001".to_string(),
            broker_type: BrokerType::AlgoTrader,
            status: BrokerStatus::Active,
            connectivity: ConnectivityInfo {
                protocol: ConnectionProtocol::Binary,
                endpoint: "tcp://algotrade-africa:9900".to_string(),
                connected: true,
                last_heartbeat: Some(Utc::now()),
                latency_us: Some(45),
                messages_sent: 1_234_567,
                messages_received: 1_234_560,
            },
            permissions: BrokerPermissions {
                can_use_algo: true,
                max_order_size: 5_000_000_000,
                ..Default::default()
            },
            clients: vec![
                BrokerClient { client_id: "CLI-006".into(), name: "AlgoTrade Prop Desk".into(), account_id: "ACC-006".into(), kyc_status: "VERIFIED".into() },
            ],
            registered_at: Utc::now(),
        });

        self.register_broker(Broker {
            id: "BRK-004".to_string(),
            name: "Mobile Money Trading".to_string(),
            license_number: "CMA-NGX-2026-004".to_string(),
            clearing_member_id: "CM-003".to_string(),
            broker_type: BrokerType::Introducing,
            status: BrokerStatus::Active,
            connectivity: ConnectivityInfo {
                protocol: ConnectionProtocol::RestApi,
                endpoint: "https://api.mmt.co.ke/v1".to_string(),
                connected: true,
                last_heartbeat: Some(Utc::now()),
                latency_us: Some(850),
                messages_sent: 8_765,
                messages_received: 8_764,
            },
            permissions: BrokerPermissions {
                can_trade_options: false,
                can_use_algo: false,
                max_order_size: 100_000_000,
                allowed_symbols: vec!["MAIZE".into(), "WHEAT".into(), "COFFEE".into()],
                risk_limit: 500_000.0,
                ..Default::default()
            },
            clients: vec![
                BrokerClient { client_id: "CLI-007".into(), name: "Smallholder Coop".into(), account_id: "ACC-007".into(), kyc_status: "VERIFIED".into() },
                BrokerClient { client_id: "CLI-008".into(), name: "Farmers Union Kenya".into(), account_id: "ACC-008".into(), kyc_status: "PENDING".into() },
            ],
            registered_at: Utc::now(),
        });

        self.register_broker(Broker {
            id: "BRK-005".to_string(),
            name: "Global Futures Corp".to_string(),
            license_number: "CMA-NGX-2026-005".to_string(),
            clearing_member_id: "CM-001".to_string(),
            broker_type: BrokerType::ExecutionOnly,
            status: BrokerStatus::PendingApproval,
            connectivity: ConnectivityInfo {
                protocol: ConnectionProtocol::Fix50,
                endpoint: "fix://global-futures:9876".to_string(),
                connected: false,
                last_heartbeat: None,
                latency_us: None,
                messages_sent: 0,
                messages_received: 0,
            },
            permissions: BrokerPermissions::default(),
            clients: vec![],
            registered_at: Utc::now(),
        });
    }

    pub fn register_broker(&self, broker: Broker) {
        self.brokers.write().insert(broker.id.clone(), broker);
    }

    pub fn get_broker(&self, id: &str) -> Option<Broker> {
        self.brokers.read().get(id).cloned()
    }

    pub fn list_brokers(&self) -> Vec<Broker> {
        self.brokers.read().values().cloned().collect()
    }

    pub fn active_brokers(&self) -> Vec<Broker> {
        self.brokers
            .read()
            .values()
            .filter(|b| b.status == BrokerStatus::Active)
            .cloned()
            .collect()
    }

    pub fn connected_brokers(&self) -> Vec<Broker> {
        self.brokers
            .read()
            .values()
            .filter(|b| b.status == BrokerStatus::Active && b.connectivity.connected)
            .cloned()
            .collect()
    }

    /// Validate and route an order from a broker.
    pub fn route_order(
        &self,
        broker_id: &str,
        client_account: &str,
        symbol: &str,
        side: &str,
        quantity: i64,
    ) -> Result<OrderRoute, String> {
        let brokers = self.brokers.read();
        let broker = brokers.get(broker_id).ok_or("Broker not found")?;

        if broker.status != BrokerStatus::Active {
            return Err("Broker is not active".to_string());
        }
        if !broker.connectivity.connected {
            return Err("Broker is not connected".to_string());
        }

        // Check permissions
        if !broker.permissions.allowed_symbols.is_empty()
            && !broker.permissions.allowed_symbols.contains(&symbol.to_string())
        {
            return Err(format!("Broker not authorized for symbol {}", symbol));
        }
        if quantity > broker.permissions.max_order_size {
            return Err("Order size exceeds broker limit".to_string());
        }

        // Verify client belongs to broker
        let client_valid = broker.clients.iter().any(|c| c.account_id == client_account);
        if !client_valid {
            return Err("Client account not registered with broker".to_string());
        }

        let route = OrderRoute {
            id: Uuid::new_v4(),
            broker_id: broker_id.to_string(),
            client_account: client_account.to_string(),
            symbol: symbol.to_string(),
            side: side.to_string(),
            quantity,
            route_status: RouteStatus::Validated,
            received_at: Utc::now(),
            routed_at: Some(Utc::now()),
            acknowledged_at: None,
        };

        drop(brokers);
        self.routes.write().push(route.clone());
        Ok(route)
    }

    pub fn recent_routes(&self, limit: usize) -> Vec<OrderRoute> {
        let routes = self.routes.read();
        routes.iter().rev().take(limit).cloned().collect()
    }

    pub fn broker_count(&self) -> usize {
        self.brokers.read().len()
    }

    pub fn connected_count(&self) -> usize {
        self.connected_brokers().len()
    }
}

// ─── Tests ──────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_broker_registration() {
        let mgr = BrokerManager::new();
        assert_eq!(mgr.broker_count(), 5);
        assert_eq!(mgr.connected_count(), 4); // BRK-005 is pending/not connected
    }

    #[test]
    fn test_route_order() {
        let mgr = BrokerManager::new();
        let route = mgr.route_order("BRK-001", "ACC-001", "GOLD", "BUY", 100);
        assert!(route.is_ok());
        let route = route.unwrap();
        assert_eq!(route.route_status, RouteStatus::Validated);
    }

    #[test]
    fn test_reject_unauthorized_symbol() {
        let mgr = BrokerManager::new();
        // BRK-004 (Mobile Money) can only trade MAIZE, WHEAT, COFFEE
        let route = mgr.route_order("BRK-004", "ACC-007", "GOLD", "BUY", 100);
        assert!(route.is_err());
    }

    #[test]
    fn test_reject_unknown_client() {
        let mgr = BrokerManager::new();
        let route = mgr.route_order("BRK-001", "ACC-999", "GOLD", "BUY", 100);
        assert!(route.is_err());
    }

    #[test]
    fn test_active_brokers() {
        let mgr = BrokerManager::new();
        let active = mgr.active_brokers();
        assert_eq!(active.len(), 4); // BRK-005 is PendingApproval
    }
}
