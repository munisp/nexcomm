//! FIX Protocol Gateway (FIXT 1.1 / FIX 5.0 SP2).
//! Implements FIX session layer (logon, heartbeat, sequence numbers)
//! and application layer (NewOrderSingle, ExecutionReport, MarketData).
//! Upgraded from FIX 4.4 to FIX 5.0 SP2 with FIXT 1.1 transport.
#![allow(dead_code)]

use crate::types::*;
use chrono::Utc;
use std::collections::HashMap;
use tracing::{info, warn};

/// FIX message delimiter.
const SOH: char = '\x01';

/// FIXT 1.1 transport protocol version (for FIX 5.0 SP2).
const FIXT_VERSION: &str = "FIXT.1.1";
/// FIX 5.0 SP2 application version.
const FIX_APP_VERSION: &str = "FIX.5.0SP2";

/// A parsed FIX message as tag-value pairs.
#[derive(Debug, Clone)]
pub struct FixMessage {
    pub msg_type: String,
    pub fields: HashMap<u32, String>,
    raw: String,
}

impl FixMessage {
    /// Parse a raw FIX message string.
    pub fn parse(raw: &str) -> Result<Self, String> {
        let mut fields = HashMap::new();
        let mut msg_type = String::new();

        for pair in raw.split(SOH) {
            if pair.is_empty() {
                continue;
            }
            let parts: Vec<&str> = pair.splitn(2, '=').collect();
            if parts.len() != 2 {
                continue;
            }
            let tag: u32 = parts[0]
                .parse()
                .map_err(|_| format!("Invalid tag: {}", parts[0]))?;
            let value = parts[1].to_string();

            if tag == 35 {
                msg_type = value.clone();
            }
            fields.insert(tag, value);
        }

        if msg_type.is_empty() {
            return Err("Missing MsgType (35)".to_string());
        }

        Ok(Self {
            msg_type,
            fields,
            raw: raw.to_string(),
        })
    }

    /// Build a FIX message from fields.
    pub fn build(msg_type: &str, sender: &str, target: &str, seq_num: u64, fields: &[(u32, String)]) -> String {
        let mut body = String::new();
        body.push_str(&format!("35={}{}", msg_type, SOH));
        body.push_str(&format!("49={}{}", sender, SOH));
        body.push_str(&format!("56={}{}", target, SOH));
        body.push_str(&format!("34={}{}", seq_num, SOH));
        body.push_str(&format!(
            "52={}{}",
            Utc::now().format("%Y%m%d-%H:%M:%S%.3f"),
            SOH
        ));

        for (tag, value) in fields {
            body.push_str(&format!("{}={}{}", tag, value, SOH));
        }

        let body_len = body.len();
        let mut msg = format!("8={}{}", FIXT_VERSION, SOH);
        msg.push_str(&format!("9={}{}", body_len, SOH));
        msg.push_str(&body);

        // Checksum
        let checksum: u32 = msg.bytes().map(|b| b as u32).sum::<u32>() % 256;
        msg.push_str(&format!("10={:03}{}", checksum, SOH));

        msg
    }

    /// Get a field value by tag.
    pub fn get(&self, tag: u32) -> Option<&str> {
        self.fields.get(&tag).map(|s| s.as_str())
    }

    /// Get a field as i64.
    pub fn get_i64(&self, tag: u32) -> Option<i64> {
        self.fields.get(&tag).and_then(|s| s.parse().ok())
    }

    /// Get a field as f64.
    pub fn get_f64(&self, tag: u32) -> Option<f64> {
        self.fields.get(&tag).and_then(|s| s.parse().ok())
    }
}

/// FIX session state.
#[derive(Debug, Clone)]
pub struct FixSession {
    pub sender_comp_id: String,
    pub target_comp_id: String,
    pub outgoing_seq: u64,
    pub incoming_seq: u64,
    pub logged_in: bool,
    pub heartbeat_interval: u32,
    pub last_sent: chrono::DateTime<Utc>,
    pub last_received: chrono::DateTime<Utc>,
}

impl FixSession {
    pub fn new(sender: String, target: String) -> Self {
        let now = Utc::now();
        Self {
            sender_comp_id: sender,
            target_comp_id: target,
            outgoing_seq: 0,
            incoming_seq: 0,
            logged_in: false,
            heartbeat_interval: 30,
            last_sent: now,
            last_received: now,
        }
    }

    /// Get next outgoing sequence number.
    pub fn next_seq(&mut self) -> u64 {
        self.outgoing_seq += 1;
        self.outgoing_seq
    }

    /// Build a Logon message (MsgType=A) with FIX 5.0 SP2 fields.
    pub fn build_logon(&mut self) -> String {
        let seq = self.next_seq();
        FixMessage::build(
            "A",
            &self.sender_comp_id,
            &self.target_comp_id,
            seq,
            &[
                (98, "0".to_string()),  // EncryptMethod=None
                (108, self.heartbeat_interval.to_string()), // HeartBtInt
                (1137, FIX_APP_VERSION.to_string()), // DefaultApplVerID=FIX.5.0SP2
                (1407, "0".to_string()), // DefaultApplExtID
                (553, self.sender_comp_id.clone()), // Username (optional)
            ],
        )
    }

    /// Build a Heartbeat message (MsgType=0).
    pub fn build_heartbeat(&mut self, test_req_id: Option<&str>) -> String {
        let seq = self.next_seq();
        let mut fields = vec![];
        if let Some(id) = test_req_id {
            fields.push((112, id.to_string()));
        }
        FixMessage::build(
            "0",
            &self.sender_comp_id,
            &self.target_comp_id,
            seq,
            &fields,
        )
    }

    /// Build a Logout message (MsgType=5).
    pub fn build_logout(&mut self, text: Option<&str>) -> String {
        let seq = self.next_seq();
        let mut fields = vec![];
        if let Some(t) = text {
            fields.push((58, t.to_string()));
        }
        FixMessage::build(
            "5",
            &self.sender_comp_id,
            &self.target_comp_id,
            seq,
            &fields,
        )
    }

    /// Build an ExecutionReport (MsgType=8) for a new order acknowledgement.
    pub fn build_execution_report(&mut self, order: &Order, exec_type: &str) -> String {
        let seq = self.next_seq();
        let side_code = match order.side {
            Side::Buy => "1",
            Side::Sell => "2",
        };
        let ord_status = match order.status {
            OrderStatus::New => "0",
            OrderStatus::PartiallyFilled => "1",
            OrderStatus::Filled => "2",
            OrderStatus::Cancelled => "4",
            OrderStatus::Rejected => "8",
            OrderStatus::PendingNew => "A",
            OrderStatus::PendingCancel => "6",
            OrderStatus::Expired => "C",
        };

        let fields = vec![
            (37, order.id.to_string()),          // OrderID
            (11, order.client_order_id.clone()),  // ClOrdID
            (17, uuid::Uuid::new_v4().to_string()), // ExecID
            (150, exec_type.to_string()),         // ExecType
            (39, ord_status.to_string()),         // OrdStatus
            (55, order.symbol.clone()),           // Symbol
            (54, side_code.to_string()),          // Side
            (38, order.quantity.to_string()),     // OrderQty
            (44, from_price(order.price).to_string()), // Price
            (14, order.filled_quantity.to_string()), // CumQty
            (151, order.remaining_quantity.to_string()), // LeavesQty
            (6, from_price(order.average_price).to_string()), // AvgPx
            (60, Utc::now().format("%Y%m%d-%H:%M:%S%.3f").to_string()), // TransactTime
        ];

        FixMessage::build(
            "8",
            &self.sender_comp_id,
            &self.target_comp_id,
            seq,
            &fields,
        )
    }

    /// Build a MarketDataSnapshotFullRefresh (MsgType=W).
    pub fn build_market_data_snapshot(&mut self, depth: &MarketDepth) -> String {
        let seq = self.next_seq();
        let mut fields = vec![
            (55, depth.symbol.clone()),       // Symbol
            (268, (depth.bids.len() + depth.asks.len()).to_string()), // NoMDEntries
        ];

        // Bids
        for bid in &depth.bids {
            fields.push((269, "0".to_string())); // MDEntryType=Bid
            fields.push((270, bid.price.to_string())); // MDEntryPx
            fields.push((271, bid.quantity.to_string())); // MDEntrySize
        }

        // Asks
        for ask in &depth.asks {
            fields.push((269, "1".to_string())); // MDEntryType=Offer
            fields.push((270, ask.price.to_string())); // MDEntryPx
            fields.push((271, ask.quantity.to_string())); // MDEntrySize
        }

        FixMessage::build(
            "W",
            &self.sender_comp_id,
            &self.target_comp_id,
            seq,
            &fields,
        )
    }

    /// Process an incoming Logon message.
    pub fn handle_logon(&mut self, msg: &FixMessage) -> String {
        self.logged_in = true;
        self.incoming_seq = msg.get_i64(34).unwrap_or(1) as u64;
        if let Some(hb) = msg.get_i64(108) {
            self.heartbeat_interval = hb as u32;
        }
        self.last_received = Utc::now();

        info!(
            "FIX Logon: {} -> {} (HB={}s)",
            msg.get(49).unwrap_or("?"),
            msg.get(56).unwrap_or("?"),
            self.heartbeat_interval
        );

        // Respond with logon
        self.build_logon()
    }

    /// Parse a NewOrderSingle (MsgType=D) into an Order.
    pub fn parse_new_order(&self, msg: &FixMessage) -> Result<Order, String> {
        let client_order_id = msg
            .get(11)
            .ok_or("Missing ClOrdID (11)")?
            .to_string();
        let account_id = msg.get(1).unwrap_or("DEFAULT").to_string();
        let symbol = msg
            .get(55)
            .ok_or("Missing Symbol (55)")?
            .to_string();

        let side = match msg.get(54).ok_or("Missing Side (54)")? {
            "1" => Side::Buy,
            "2" => Side::Sell,
            s => return Err(format!("Unknown side: {}", s)),
        };

        let order_type = match msg.get(40).ok_or("Missing OrdType (40)")? {
            "1" => OrderType::Market,
            "2" => OrderType::Limit,
            "3" => OrderType::Stop,
            "4" => OrderType::StopLimit,
            t => return Err(format!("Unknown order type: {}", t)),
        };

        let tif = match msg.get(59).unwrap_or("0") {
            "0" => TimeInForce::Day,
            "1" => TimeInForce::GoodTilCancel,
            "3" => TimeInForce::ImmediateOrCancel,
            "4" => TimeInForce::FillOrKill,
            "6" => TimeInForce::GoodTilDate,
            _ => TimeInForce::Day,
        };

        let quantity = msg
            .get_f64(38)
            .ok_or("Missing OrderQty (38)")? as Qty;
        let price = msg.get_f64(44).map(to_price).unwrap_or(0);
        let stop_price = msg.get_f64(99).map(to_price).unwrap_or(0);

        Ok(Order::new(
            client_order_id,
            account_id,
            symbol,
            side,
            order_type,
            tif,
            price,
            stop_price,
            quantity,
        ))
    }

    /// Parse an OrderCancelRequest (MsgType=F).
    pub fn parse_cancel_request(&self, msg: &FixMessage) -> Result<(String, String), String> {
        let order_id = msg
            .get(41)
            .ok_or("Missing OrigClOrdID (41)")?
            .to_string();
        let account_id = msg.get(1).unwrap_or("DEFAULT").to_string();
        Ok((order_id, account_id))
    }
}

/// FIX gateway managing multiple sessions.
pub struct FixGateway {
    sessions: dashmap::DashMap<String, FixSession>,
    exchange_comp_id: String,
}

impl FixGateway {
    pub fn new(exchange_comp_id: String) -> Self {
        Self {
            sessions: dashmap::DashMap::new(),
            exchange_comp_id,
        }
    }

    /// Create or get a session for a client.
    pub fn get_or_create_session(&self, client_comp_id: &str) -> dashmap::mapref::one::RefMut<'_, String, FixSession> {
        if !self.sessions.contains_key(client_comp_id) {
            self.sessions.insert(
                client_comp_id.to_string(),
                FixSession::new(self.exchange_comp_id.clone(), client_comp_id.to_string()),
            );
        }
        self.sessions.get_mut(client_comp_id).unwrap()
    }

    /// Process an incoming FIX message.
    pub fn process_message(&self, raw: &str) -> Result<(String, Option<Order>), String> {
        let msg = FixMessage::parse(raw)?;
        let sender = msg.get(49).unwrap_or("UNKNOWN").to_string();

        let mut session = self.get_or_create_session(&sender);

        match msg.msg_type.as_str() {
            "A" => {
                // Logon
                let response = session.handle_logon(&msg);
                Ok((response, None))
            }
            "0" => {
                // Heartbeat
                session.last_received = Utc::now();
                Ok((String::new(), None))
            }
            "5" => {
                // Logout
                session.logged_in = false;
                let response = session.build_logout(Some("Goodbye"));
                info!("FIX Logout: {}", sender);
                Ok((response, None))
            }
            "D" => {
                // NewOrderSingle
                if !session.logged_in {
                    return Err("Not logged in".to_string());
                }
                let order = session.parse_new_order(&msg)?;
                let response = session.build_execution_report(&order, "0"); // ExecType=New
                Ok((response, Some(order)))
            }
            "F" => {
                // OrderCancelRequest
                if !session.logged_in {
                    return Err("Not logged in".to_string());
                }
                let (_order_id, _account_id) = session.parse_cancel_request(&msg)?;
                // Cancel would be processed by the engine
                Ok((String::new(), None))
            }
            "G" => {
                // OrderCancelReplaceRequest (Amend)
                if !session.logged_in {
                    return Err("Not logged in".to_string());
                }
                info!("FIX OrderCancelReplace from {}", sender);
                Ok((String::new(), None))
            }
            "AE" => {
                // TradeCaptureReport
                if !session.logged_in {
                    return Err("Not logged in".to_string());
                }
                info!("FIX TradeCaptureReport from {}", sender);
                Ok((String::new(), None))
            }
            "f" => {
                // SecurityStatusRequest
                if !session.logged_in {
                    return Err("Not logged in".to_string());
                }
                let symbol = msg.get(55).unwrap_or("*").to_string();
                let response = Self::build_security_status(&mut session, &symbol, "2"); // Trading
                Ok((response, None))
            }
            "i" => {
                // MassQuote
                if !session.logged_in {
                    return Err("Not logged in".to_string());
                }
                info!("FIX MassQuote from {}", sender);
                // Acknowledge the mass quote
                let seq = session.next_seq();
                let response = FixMessage::build(
                    "b", // MassQuoteAck
                    &session.sender_comp_id,
                    &session.target_comp_id,
                    seq,
                    &[(297, "0".to_string())], // QuoteStatus=Accepted
                );
                Ok((response, None))
            }
            "R" => {
                // QuoteRequest
                if !session.logged_in {
                    return Err("Not logged in".to_string());
                }
                info!("FIX QuoteRequest from {}", sender);
                Ok((String::new(), None))
            }
            "j" => {
                // BusinessMessageReject
                warn!("FIX BusinessMessageReject from {}: {}", sender, msg.get(58).unwrap_or("no reason"));
                Ok((String::new(), None))
            }
            _ => {
                warn!("Unsupported FIX message type: {}", msg.msg_type);
                Err(format!("Unsupported message type: {}", msg.msg_type))
            }
        }
    }

    /// Build a SecurityStatus message (MsgType=f).
    fn build_security_status(session: &mut FixSession, symbol: &str, trading_status: &str) -> String {
        let seq = session.next_seq();
        FixMessage::build(
            "f",
            &session.sender_comp_id,
            &session.target_comp_id,
            seq,
            &[
                (55, symbol.to_string()),           // Symbol
                (326, trading_status.to_string()),   // SecurityTradingStatus (2=Trading)
                (291, "1".to_string()),              // FinancialStatus=Active
                (292, "0".to_string()),              // CorporateAction=None
            ],
        )
    }

    /// Get active session count.
    pub fn session_count(&self) -> usize {
        self.sessions.len()
    }

    /// Get logged-in session count.
    pub fn logged_in_count(&self) -> usize {
        self.sessions
            .iter()
            .filter(|r| r.value().logged_in)
            .count()
    }
}

impl Default for FixGateway {
    fn default() -> Self {
        Self::new("NEXCOM".to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_fix_message_build_and_parse() {
        let msg = FixMessage::build(
            "D",
            "CLIENT1",
            "NEXCOM",
            1,
            &[
                (55, "GOLD-FUT-2026M06".to_string()),
                (54, "1".to_string()),
                (40, "2".to_string()),
                (38, "100".to_string()),
                (44, "2350.00".to_string()),
            ],
        );

        let parsed = FixMessage::parse(&msg).unwrap();
        assert_eq!(parsed.msg_type, "D");
        assert_eq!(parsed.get(55), Some("GOLD-FUT-2026M06"));
        assert_eq!(parsed.get(54), Some("1"));
    }

    #[test]
    fn test_fix_session_logon() {
        let gateway = FixGateway::default();

        let logon = FixMessage::build(
            "A",
            "CLIENT1",
            "NEXCOM",
            1,
            &[(98, "0".to_string()), (108, "30".to_string())],
        );

        let (response, order) = gateway.process_message(&logon).unwrap();
        assert!(!response.is_empty());
        assert!(order.is_none());
        assert_eq!(gateway.logged_in_count(), 1);
    }

    #[test]
    fn test_fix_new_order() {
        let gateway = FixGateway::default();

        // Logon first
        let logon = FixMessage::build(
            "A",
            "TRADER1",
            "NEXCOM",
            1,
            &[(98, "0".to_string()), (108, "30".to_string())],
        );
        gateway.process_message(&logon).unwrap();

        // Send NewOrderSingle
        let nos = FixMessage::build(
            "D",
            "TRADER1",
            "NEXCOM",
            2,
            &[
                (11, "ORD-001".to_string()),
                (55, "GOLD-FUT-2026M06".to_string()),
                (54, "1".to_string()),
                (40, "2".to_string()),
                (38, "10".to_string()),
                (44, "2350.0".to_string()),
                (59, "1".to_string()),
            ],
        );

        let (response, order) = gateway.process_message(&nos).unwrap();
        assert!(!response.is_empty());
        assert!(order.is_some());
        let order = order.unwrap();
        assert_eq!(order.client_order_id, "ORD-001");
        assert_eq!(order.symbol, "GOLD-FUT-2026M06");
        assert_eq!(order.side, Side::Buy);
    }
}
