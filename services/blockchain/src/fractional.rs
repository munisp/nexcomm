// Fractional Ownership & Trading for NEXCOM Exchange
// Enables splitting commodity tokens into fractions for retail investors.
// Includes an orderbook for trading fractional shares.

use serde::{Deserialize, Serialize};
use chrono::{DateTime, Utc};
use std::collections::{BTreeMap, HashMap, VecDeque};

/// A fractionalized commodity token
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FractionalAsset {
    pub asset_id: String,
    pub token_id: String,
    pub commodity_symbol: String,
    pub name: String,
    pub total_fractions: u64,
    pub fraction_price: f64,
    pub total_value: f64,
    pub available_fractions: u64,
    pub holders: Vec<FractionHolder>,
    pub metadata_cid: String,        // IPFS CID for metadata
    pub warehouse_receipt_cid: String, // IPFS CID for warehouse receipt
    pub chain: String,
    pub contract_address: String,
    pub status: AssetStatus,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FractionHolder {
    pub holder_id: String,
    pub address: String,
    pub fractions_owned: u64,
    pub acquisition_price: f64,
    pub acquired_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum AssetStatus {
    Pending,
    Active,
    Suspended,
    Redeemed,
}

/// Order for trading fractional shares
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FractionalOrder {
    pub order_id: String,
    pub asset_id: String,
    pub trader_id: String,
    pub side: OrderSide,
    pub quantity: u64,      // number of fractions
    pub price: f64,         // price per fraction
    pub filled_qty: u64,
    pub status: FractionalOrderStatus,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum OrderSide {
    Buy,
    Sell,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum FractionalOrderStatus {
    Open,
    PartiallyFilled,
    Filled,
    Cancelled,
}

/// Trade execution result
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FractionalTrade {
    pub trade_id: String,
    pub asset_id: String,
    pub buyer_id: String,
    pub seller_id: String,
    pub quantity: u64,
    pub price: f64,
    pub total_value: f64,
    pub tx_hash: Option<String>,
    pub executed_at: DateTime<Utc>,
}

/// Fractional orderbook for a single asset
pub struct FractionalOrderBook {
    pub asset_id: String,
    bids: BTreeMap<OrderedFloat, VecDeque<FractionalOrder>>,  // descending price
    asks: BTreeMap<OrderedFloat, VecDeque<FractionalOrder>>,  // ascending price
}

/// Wrapper for f64 to implement Ord (price-level keying)
#[derive(Debug, Clone, Copy, PartialEq)]
struct OrderedFloat(f64);

impl Eq for OrderedFloat {}

impl PartialOrd for OrderedFloat {
    fn partial_cmp(&self, other: &Self) -> Option<std::cmp::Ordering> {
        Some(self.cmp(other))
    }
}

impl Ord for OrderedFloat {
    fn cmp(&self, other: &Self) -> std::cmp::Ordering {
        self.0.partial_cmp(&other.0).unwrap_or(std::cmp::Ordering::Equal)
    }
}

impl FractionalOrderBook {
    pub fn new(asset_id: &str) -> Self {
        Self {
            asset_id: asset_id.to_string(),
            bids: BTreeMap::new(),
            asks: BTreeMap::new(),
        }
    }

    /// Submit an order and attempt to match
    pub fn submit_order(&mut self, mut order: FractionalOrder) -> Vec<FractionalTrade> {
        let mut trades = Vec::new();

        match order.side {
            OrderSide::Buy => {
                // Match against asks (lowest first)
                let ask_prices: Vec<OrderedFloat> = self.asks.keys().copied().collect();
                for ask_price in ask_prices {
                    if order.filled_qty >= order.quantity { break; }
                    if ask_price.0 > order.price { break; } // no match at this price

                    if let Some(queue) = self.asks.get_mut(&ask_price) {
                        while !queue.is_empty() && order.filled_qty < order.quantity {
                            let sell_order = queue.front_mut().unwrap();
                            let remaining_buy = order.quantity - order.filled_qty;
                            let remaining_sell = sell_order.quantity - sell_order.filled_qty;
                            let fill_qty = remaining_buy.min(remaining_sell);

                            let trade = FractionalTrade {
                                trade_id: uuid::Uuid::new_v4().to_string(),
                                asset_id: order.asset_id.clone(),
                                buyer_id: order.trader_id.clone(),
                                seller_id: sell_order.trader_id.clone(),
                                quantity: fill_qty,
                                price: ask_price.0,
                                total_value: fill_qty as f64 * ask_price.0,
                                tx_hash: None,
                                executed_at: Utc::now(),
                            };

                            order.filled_qty += fill_qty;
                            sell_order.filled_qty += fill_qty;

                            if sell_order.filled_qty >= sell_order.quantity {
                                sell_order.status = FractionalOrderStatus::Filled;
                                queue.pop_front();
                            } else {
                                sell_order.status = FractionalOrderStatus::PartiallyFilled;
                            }

                            trades.push(trade);
                        }
                    }

                    // Clean up empty price levels
                    if self.asks.get(&ask_price).map(|q| q.is_empty()).unwrap_or(false) {
                        self.asks.remove(&ask_price);
                    }
                }

                // If not fully filled, rest on the book
                if order.filled_qty < order.quantity {
                    order.status = if order.filled_qty > 0 {
                        FractionalOrderStatus::PartiallyFilled
                    } else {
                        FractionalOrderStatus::Open
                    };
                    self.bids.entry(OrderedFloat(order.price))
                        .or_insert_with(VecDeque::new)
                        .push_back(order);
                } else {
                    order.status = FractionalOrderStatus::Filled;
                }
            }
            OrderSide::Sell => {
                // Match against bids (highest first)
                let bid_prices: Vec<OrderedFloat> = self.bids.keys().rev().copied().collect();
                for bid_price in bid_prices {
                    if order.filled_qty >= order.quantity { break; }
                    if bid_price.0 < order.price { break; }

                    if let Some(queue) = self.bids.get_mut(&bid_price) {
                        while !queue.is_empty() && order.filled_qty < order.quantity {
                            let buy_order = queue.front_mut().unwrap();
                            let remaining_sell = order.quantity - order.filled_qty;
                            let remaining_buy = buy_order.quantity - buy_order.filled_qty;
                            let fill_qty = remaining_sell.min(remaining_buy);

                            let trade = FractionalTrade {
                                trade_id: uuid::Uuid::new_v4().to_string(),
                                asset_id: order.asset_id.clone(),
                                buyer_id: buy_order.trader_id.clone(),
                                seller_id: order.trader_id.clone(),
                                quantity: fill_qty,
                                price: bid_price.0,
                                total_value: fill_qty as f64 * bid_price.0,
                                tx_hash: None,
                                executed_at: Utc::now(),
                            };

                            order.filled_qty += fill_qty;
                            buy_order.filled_qty += fill_qty;

                            if buy_order.filled_qty >= buy_order.quantity {
                                buy_order.status = FractionalOrderStatus::Filled;
                                queue.pop_front();
                            } else {
                                buy_order.status = FractionalOrderStatus::PartiallyFilled;
                            }

                            trades.push(trade);
                        }
                    }

                    if self.bids.get(&bid_price).map(|q| q.is_empty()).unwrap_or(false) {
                        self.bids.remove(&bid_price);
                    }
                }

                if order.filled_qty < order.quantity {
                    order.status = if order.filled_qty > 0 {
                        FractionalOrderStatus::PartiallyFilled
                    } else {
                        FractionalOrderStatus::Open
                    };
                    self.asks.entry(OrderedFloat(order.price))
                        .or_insert_with(VecDeque::new)
                        .push_back(order);
                } else {
                    order.status = FractionalOrderStatus::Filled;
                }
            }
        }

        trades
    }

    /// Get current best bid/ask and depth
    pub fn snapshot(&self) -> OrderBookSnapshot {
        let bids: Vec<PriceLevel> = self.bids.iter().rev().take(10).map(|(p, q)| {
            let total_qty: u64 = q.iter().map(|o| o.quantity - o.filled_qty).sum();
            PriceLevel { price: p.0, quantity: total_qty, orders: q.len() }
        }).collect();

        let asks: Vec<PriceLevel> = self.asks.iter().take(10).map(|(p, q)| {
            let total_qty: u64 = q.iter().map(|o| o.quantity - o.filled_qty).sum();
            PriceLevel { price: p.0, quantity: total_qty, orders: q.len() }
        }).collect();

        let spread = match (bids.first(), asks.first()) {
            (Some(b), Some(a)) => a.price - b.price,
            _ => 0.0,
        };

        OrderBookSnapshot { asset_id: self.asset_id.clone(), bids, asks, spread }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OrderBookSnapshot {
    pub asset_id: String,
    pub bids: Vec<PriceLevel>,
    pub asks: Vec<PriceLevel>,
    pub spread: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PriceLevel {
    pub price: f64,
    pub quantity: u64,
    pub orders: usize,
}

/// The fractional exchange: manages all assets and orderbooks
pub struct FractionalExchange {
    pub assets: HashMap<String, FractionalAsset>,
    pub orderbooks: HashMap<String, FractionalOrderBook>,
    pub trades: Vec<FractionalTrade>,
}

impl FractionalExchange {
    pub fn new() -> Self {
        let mut exchange = Self {
            assets: HashMap::new(),
            orderbooks: HashMap::new(),
            trades: Vec::new(),
        };
        exchange.seed_demo_assets();
        exchange
    }

    /// Register a new fractional asset
    pub fn register_asset(&mut self, asset: FractionalAsset) {
        let id = asset.asset_id.clone();
        self.orderbooks.insert(id.clone(), FractionalOrderBook::new(&id));
        self.assets.insert(id, asset);
    }

    /// Submit a fractional order
    pub fn submit_order(&mut self, order: FractionalOrder) -> Vec<FractionalTrade> {
        let asset_id = order.asset_id.clone();
        if let Some(book) = self.orderbooks.get_mut(&asset_id) {
            let new_trades = book.submit_order(order);
            self.trades.extend(new_trades.clone());
            new_trades
        } else {
            Vec::new()
        }
    }

    /// Get orderbook snapshot
    pub fn orderbook(&self, asset_id: &str) -> Option<OrderBookSnapshot> {
        self.orderbooks.get(asset_id).map(|b| b.snapshot())
    }

    /// Seed demo fractional assets
    fn seed_demo_assets(&mut self) {
        let demo_assets = vec![
            FractionalAsset {
                asset_id: "FA-GOLD-001".to_string(),
                token_id: "TKN-GOLD-001".to_string(),
                commodity_symbol: "GOLD".to_string(),
                name: "Gold Bar 1kg - LBMA Certified".to_string(),
                total_fractions: 10000,
                fraction_price: 7.85,
                total_value: 78500.0,
                available_fractions: 6500,
                holders: vec![
                    FractionHolder {
                        holder_id: "USR-001".to_string(),
                        address: "0x1234...abcd".to_string(),
                        fractions_owned: 2000,
                        acquisition_price: 7.50,
                        acquired_at: Utc::now(),
                    },
                    FractionHolder {
                        holder_id: "USR-002".to_string(),
                        address: "0x5678...efgh".to_string(),
                        fractions_owned: 1500,
                        acquisition_price: 7.60,
                        acquired_at: Utc::now(),
                    },
                ],
                metadata_cid: "QmGoldBar001MetadataHash".to_string(),
                warehouse_receipt_cid: "QmGoldBar001ReceiptHash".to_string(),
                chain: "polygon".to_string(),
                contract_address: "0xNEXCOM_GOLD_TOKEN".to_string(),
                status: AssetStatus::Active,
                created_at: Utc::now(),
            },
            FractionalAsset {
                asset_id: "FA-COFFEE-001".to_string(),
                token_id: "TKN-COFFEE-001".to_string(),
                commodity_symbol: "COFFEE".to_string(),
                name: "Arabica Coffee 10MT - Kenya AA Grade".to_string(),
                total_fractions: 5000,
                fraction_price: 9.04,
                total_value: 45200.0,
                available_fractions: 3200,
                holders: vec![
                    FractionHolder {
                        holder_id: "USR-003".to_string(),
                        address: "0x9abc...ijkl".to_string(),
                        fractions_owned: 1000,
                        acquisition_price: 8.90,
                        acquired_at: Utc::now(),
                    },
                    FractionHolder {
                        holder_id: "USR-001".to_string(),
                        address: "0x1234...abcd".to_string(),
                        fractions_owned: 800,
                        acquisition_price: 9.00,
                        acquired_at: Utc::now(),
                    },
                ],
                metadata_cid: "QmCoffee001MetadataHash".to_string(),
                warehouse_receipt_cid: "QmCoffee001ReceiptHash".to_string(),
                chain: "polygon".to_string(),
                contract_address: "0xNEXCOM_COFFEE_TOKEN".to_string(),
                status: AssetStatus::Active,
                created_at: Utc::now(),
            },
            FractionalAsset {
                asset_id: "FA-MAIZE-001".to_string(),
                token_id: "TKN-MAIZE-001".to_string(),
                commodity_symbol: "MAIZE".to_string(),
                name: "White Maize 50MT - Grade 1".to_string(),
                total_fractions: 20000,
                fraction_price: 0.71,
                total_value: 14200.0,
                available_fractions: 15000,
                holders: vec![
                    FractionHolder {
                        holder_id: "USR-004".to_string(),
                        address: "0xdef0...mnop".to_string(),
                        fractions_owned: 5000,
                        acquisition_price: 0.68,
                        acquired_at: Utc::now(),
                    },
                ],
                metadata_cid: "QmMaize001MetadataHash".to_string(),
                warehouse_receipt_cid: "QmMaize001ReceiptHash".to_string(),
                chain: "polygon".to_string(),
                contract_address: "0xNEXCOM_MAIZE_TOKEN".to_string(),
                status: AssetStatus::Active,
                created_at: Utc::now(),
            },
            FractionalAsset {
                asset_id: "FA-CRUDE-001".to_string(),
                token_id: "TKN-CRUDE-001".to_string(),
                commodity_symbol: "CRUDE_OIL".to_string(),
                name: "Brent Crude 1000bbl - Bonny Light".to_string(),
                total_fractions: 50000,
                fraction_price: 1.57,
                total_value: 78500.0,
                available_fractions: 42000,
                holders: vec![
                    FractionHolder {
                        holder_id: "USR-002".to_string(),
                        address: "0x5678...efgh".to_string(),
                        fractions_owned: 5000,
                        acquisition_price: 1.52,
                        acquired_at: Utc::now(),
                    },
                    FractionHolder {
                        holder_id: "USR-005".to_string(),
                        address: "0xghij...qrst".to_string(),
                        fractions_owned: 3000,
                        acquisition_price: 1.55,
                        acquired_at: Utc::now(),
                    },
                ],
                metadata_cid: "QmCrude001MetadataHash".to_string(),
                warehouse_receipt_cid: "QmCrude001ReceiptHash".to_string(),
                chain: "ethereum".to_string(),
                contract_address: "0xNEXCOM_CRUDE_TOKEN".to_string(),
                status: AssetStatus::Active,
                created_at: Utc::now(),
            },
            FractionalAsset {
                asset_id: "FA-CARBON-001".to_string(),
                token_id: "TKN-CARBON-001".to_string(),
                commodity_symbol: "CARBON".to_string(),
                name: "EU ETS Carbon Credits 100t - Vintage 2026".to_string(),
                total_fractions: 10000,
                fraction_price: 0.65,
                total_value: 6500.0,
                available_fractions: 8500,
                holders: vec![
                    FractionHolder {
                        holder_id: "USR-001".to_string(),
                        address: "0x1234...abcd".to_string(),
                        fractions_owned: 1500,
                        acquisition_price: 0.62,
                        acquired_at: Utc::now(),
                    },
                ],
                metadata_cid: "QmCarbon001MetadataHash".to_string(),
                warehouse_receipt_cid: "QmCarbon001ReceiptHash".to_string(),
                chain: "polygon".to_string(),
                contract_address: "0xNEXCOM_CARBON_TOKEN".to_string(),
                status: AssetStatus::Active,
                created_at: Utc::now(),
            },
        ];

        for asset in demo_assets {
            self.register_asset(asset);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_fractional_exchange_seeded() {
        let exchange = FractionalExchange::new();
        assert_eq!(exchange.assets.len(), 5);
        assert!(exchange.assets.contains_key("FA-GOLD-001"));
        assert!(exchange.assets.contains_key("FA-COFFEE-001"));
    }

    #[test]
    fn test_submit_and_match_orders() {
        let mut exchange = FractionalExchange::new();

        // Sell order
        let sell = FractionalOrder {
            order_id: "sell-1".to_string(),
            asset_id: "FA-GOLD-001".to_string(),
            trader_id: "USR-001".to_string(),
            side: OrderSide::Sell,
            quantity: 100,
            price: 7.80,
            filled_qty: 0,
            status: FractionalOrderStatus::Open,
            created_at: Utc::now(),
        };
        let trades = exchange.submit_order(sell);
        assert_eq!(trades.len(), 0); // No matching buy

        // Buy order that matches
        let buy = FractionalOrder {
            order_id: "buy-1".to_string(),
            asset_id: "FA-GOLD-001".to_string(),
            trader_id: "USR-002".to_string(),
            side: OrderSide::Buy,
            quantity: 50,
            price: 7.85,
            filled_qty: 0,
            status: FractionalOrderStatus::Open,
            created_at: Utc::now(),
        };
        let trades = exchange.submit_order(buy);
        assert_eq!(trades.len(), 1);
        assert_eq!(trades[0].quantity, 50);
        assert_eq!(trades[0].price, 7.80); // Filled at ask price
    }

    #[test]
    fn test_orderbook_snapshot() {
        let mut exchange = FractionalExchange::new();

        // Add some orders
        exchange.submit_order(FractionalOrder {
            order_id: "s1".to_string(),
            asset_id: "FA-GOLD-001".to_string(),
            trader_id: "USR-A".to_string(),
            side: OrderSide::Sell,
            quantity: 100,
            price: 7.90,
            filled_qty: 0,
            status: FractionalOrderStatus::Open,
            created_at: Utc::now(),
        });
        exchange.submit_order(FractionalOrder {
            order_id: "b1".to_string(),
            asset_id: "FA-GOLD-001".to_string(),
            trader_id: "USR-B".to_string(),
            side: OrderSide::Buy,
            quantity: 200,
            price: 7.80,
            filled_qty: 0,
            status: FractionalOrderStatus::Open,
            created_at: Utc::now(),
        });

        let snap = exchange.orderbook("FA-GOLD-001").unwrap();
        assert_eq!(snap.bids.len(), 1);
        assert_eq!(snap.asks.len(), 1);
        assert!((snap.spread - 0.10).abs() < 0.001);
    }
}
