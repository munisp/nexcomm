//! Physical Delivery Infrastructure.
//! Warehouse management, electronic warehouse receipts, delivery logistics,
//! and commodity grading/certification.
#![allow(dead_code)]

use crate::types::*;
use chrono::Utc;
use dashmap::DashMap;
use std::collections::HashMap;
use tracing::info;
use uuid::Uuid;

/// Delivery notice for physical settlement.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct DeliveryNotice {
    pub id: Uuid,
    pub contract_symbol: String,
    pub account_id: String,
    pub side: DeliverySide,
    pub quantity_lots: i64,
    pub warehouse_id: String,
    pub grade: String,
    pub delivery_date: chrono::NaiveDate,
    pub status: DeliveryStatus,
    pub receipt_id: Option<Uuid>,
    pub created_at: chrono::DateTime<Utc>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum DeliverySide {
    Deliver, // Short position holder delivers
    Receive, // Long position holder receives
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum DeliveryStatus {
    Pending,
    Matched,
    InTransit,
    Inspecting,
    Delivered,
    Settled,
    Failed,
}

/// Commodity grade specification.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct GradeSpec {
    pub commodity: String,
    pub grade: String,
    pub description: String,
    pub premium_discount: f64, // vs par delivery grade
    pub min_purity: Option<f64>,
    pub moisture_max: Option<f64>,
    pub origin_countries: Vec<String>,
}

/// Manages physical delivery infrastructure.
pub struct DeliveryManager {
    /// Registered warehouses.
    warehouses: DashMap<String, Warehouse>,
    /// Warehouse receipts.
    receipts: DashMap<Uuid, WarehouseReceipt>,
    /// Delivery notices.
    notices: DashMap<Uuid, DeliveryNotice>,
    /// Grade specifications.
    grades: DashMap<String, Vec<GradeSpec>>,
    /// Warehouse stocks by commodity.
    stocks: DashMap<String, HashMap<String, f64>>, // warehouse_id -> commodity -> tonnes
}

impl DeliveryManager {
    pub fn new() -> Self {
        let mgr = Self {
            warehouses: DashMap::new(),
            receipts: DashMap::new(),
            notices: DashMap::new(),
            grades: DashMap::new(),
            stocks: DashMap::new(),
        };
        mgr.register_default_warehouses();
        mgr.register_default_grades();
        mgr
    }

    /// Register default warehouse locations across Africa and key global hubs.
    fn register_default_warehouses(&self) {
        let warehouses = vec![
            Warehouse {
                id: "WH-NBI-001".to_string(),
                name: "Nairobi Commodity Warehouse".to_string(),
                location: "Nairobi".to_string(),
                country: "Kenya".to_string(),
                latitude: -1.2921,
                longitude: 36.8219,
                commodities: vec!["TEA".into(), "COFFEE".into(), "MAIZE".into()],
                capacity_tonnes: 50000.0,
                current_stock_tonnes: 12000.0,
                certified: true,
            },
            Warehouse {
                id: "WH-MBS-001".to_string(),
                name: "Mombasa Port Warehouse".to_string(),
                location: "Mombasa".to_string(),
                country: "Kenya".to_string(),
                latitude: -4.0435,
                longitude: 39.6682,
                commodities: vec!["COFFEE".into(), "TEA".into(), "SUGAR".into()],
                capacity_tonnes: 80000.0,
                current_stock_tonnes: 25000.0,
                certified: true,
            },
            Warehouse {
                id: "WH-DAR-001".to_string(),
                name: "Dar es Salaam Port Warehouse".to_string(),
                location: "Dar es Salaam".to_string(),
                country: "Tanzania".to_string(),
                latitude: -6.7924,
                longitude: 39.2083,
                commodities: vec!["COFFEE".into(), "COCOA".into(), "SUGAR".into()],
                capacity_tonnes: 60000.0,
                current_stock_tonnes: 15000.0,
                certified: true,
            },
            Warehouse {
                id: "WH-LGS-001".to_string(),
                name: "Lagos Commodity Hub".to_string(),
                location: "Lagos".to_string(),
                country: "Nigeria".to_string(),
                latitude: 6.5244,
                longitude: 3.3792,
                commodities: vec!["COCOA".into(), "CRUDE_OIL".into(), "NATURAL_GAS".into()],
                capacity_tonnes: 100000.0,
                current_stock_tonnes: 35000.0,
                certified: true,
            },
            Warehouse {
                id: "WH-ACC-001".to_string(),
                name: "Accra Cocoa Warehouse".to_string(),
                location: "Accra".to_string(),
                country: "Ghana".to_string(),
                latitude: 5.6037,
                longitude: -0.1870,
                commodities: vec!["COCOA".into(), "GOLD".into()],
                capacity_tonnes: 45000.0,
                current_stock_tonnes: 20000.0,
                certified: true,
            },
            Warehouse {
                id: "WH-ADD-001".to_string(),
                name: "Addis Ababa Coffee Warehouse".to_string(),
                location: "Addis Ababa".to_string(),
                country: "Ethiopia".to_string(),
                latitude: 9.0192,
                longitude: 38.7525,
                commodities: vec!["COFFEE".into()],
                capacity_tonnes: 30000.0,
                current_stock_tonnes: 10000.0,
                certified: true,
            },
            Warehouse {
                id: "WH-JHB-001".to_string(),
                name: "Johannesburg Metals Vault".to_string(),
                location: "Johannesburg".to_string(),
                country: "South Africa".to_string(),
                latitude: -26.2041,
                longitude: 28.0473,
                commodities: vec!["GOLD".into(), "SILVER".into(), "COPPER".into()],
                capacity_tonnes: 25000.0,
                current_stock_tonnes: 5000.0,
                certified: true,
            },
            Warehouse {
                id: "WH-LDN-001".to_string(),
                name: "London Metal Exchange Warehouse".to_string(),
                location: "London".to_string(),
                country: "United Kingdom".to_string(),
                latitude: 51.5074,
                longitude: -0.1278,
                commodities: vec!["GOLD".into(), "SILVER".into(), "COPPER".into()],
                capacity_tonnes: 100000.0,
                current_stock_tonnes: 45000.0,
                certified: true,
            },
            Warehouse {
                id: "WH-DXB-001".to_string(),
                name: "Dubai Multi Commodities Centre".to_string(),
                location: "Dubai".to_string(),
                country: "UAE".to_string(),
                latitude: 25.2048,
                longitude: 55.2708,
                commodities: vec!["GOLD".into(), "SILVER".into(), "CRUDE_OIL".into()],
                capacity_tonnes: 50000.0,
                current_stock_tonnes: 15000.0,
                certified: true,
            },
        ];

        for wh in warehouses {
            self.warehouses.insert(wh.id.clone(), wh);
        }
    }

    /// Register default commodity grade specifications.
    fn register_default_grades(&self) {
        let grade_specs = vec![
            // Gold grades
            vec![
                GradeSpec {
                    commodity: "GOLD".to_string(),
                    grade: "LGD".to_string(),
                    description: "London Good Delivery (400oz bars, 995+ fineness)".to_string(),
                    premium_discount: 0.0,
                    min_purity: Some(0.995),
                    moisture_max: None,
                    origin_countries: vec![],
                },
                GradeSpec {
                    commodity: "GOLD".to_string(),
                    grade: "KILOBAR".to_string(),
                    description: "1kg bars, 999.9 fineness".to_string(),
                    premium_discount: 0.5,
                    min_purity: Some(0.9999),
                    moisture_max: None,
                    origin_countries: vec![],
                },
            ],
            // Coffee grades
            vec![
                GradeSpec {
                    commodity: "COFFEE".to_string(),
                    grade: "AA".to_string(),
                    description: "Kenya AA - Screen 17/18, bold beans".to_string(),
                    premium_discount: 15.0,
                    min_purity: None,
                    moisture_max: Some(12.0),
                    origin_countries: vec!["Kenya".into()],
                },
                GradeSpec {
                    commodity: "COFFEE".to_string(),
                    grade: "AB".to_string(),
                    description: "Kenya AB - Screen 15/16".to_string(),
                    premium_discount: 5.0,
                    min_purity: None,
                    moisture_max: Some(12.0),
                    origin_countries: vec!["Kenya".into()],
                },
                GradeSpec {
                    commodity: "COFFEE".to_string(),
                    grade: "SIDAMO".to_string(),
                    description: "Ethiopia Sidamo Grade 2".to_string(),
                    premium_discount: 10.0,
                    min_purity: None,
                    moisture_max: Some(11.5),
                    origin_countries: vec!["Ethiopia".into()],
                },
            ],
            // Cocoa grades
            vec![
                GradeSpec {
                    commodity: "COCOA".to_string(),
                    grade: "GRADE1".to_string(),
                    description: "Ghana Grade 1 - max 3% defective".to_string(),
                    premium_discount: 0.0,
                    min_purity: None,
                    moisture_max: Some(7.5),
                    origin_countries: vec!["Ghana".into()],
                },
                GradeSpec {
                    commodity: "COCOA".to_string(),
                    grade: "GRADE2".to_string(),
                    description: "Nigeria Grade 2 - max 5% defective".to_string(),
                    premium_discount: -5.0,
                    min_purity: None,
                    moisture_max: Some(8.0),
                    origin_countries: vec!["Nigeria".into(), "Cameroon".into()],
                },
            ],
            // Maize grades
            vec![
                GradeSpec {
                    commodity: "MAIZE".to_string(),
                    grade: "WM1".to_string(),
                    description: "White Maize Grade 1 - max 12.5% moisture".to_string(),
                    premium_discount: 0.0,
                    min_purity: None,
                    moisture_max: Some(12.5),
                    origin_countries: vec!["Kenya".into(), "Tanzania".into(), "South Africa".into()],
                },
                GradeSpec {
                    commodity: "MAIZE".to_string(),
                    grade: "YM2".to_string(),
                    description: "Yellow Maize Grade 2".to_string(),
                    premium_discount: -2.0,
                    min_purity: None,
                    moisture_max: Some(14.0),
                    origin_countries: vec!["Kenya".into(), "Uganda".into()],
                },
            ],
        ];

        for specs in grade_specs {
            if let Some(first) = specs.first() {
                self.grades.insert(first.commodity.clone(), specs);
            }
        }
    }

    /// Issue a warehouse receipt.
    pub fn issue_receipt(
        &self,
        warehouse_id: &str,
        commodity: &str,
        quantity_tonnes: f64,
        grade: &str,
        owner_account: &str,
    ) -> Result<WarehouseReceipt, String> {
        let warehouse = self
            .warehouses
            .get(warehouse_id)
            .ok_or_else(|| format!("Warehouse {} not found", warehouse_id))?;

        if !warehouse.commodities.contains(&commodity.to_string()) {
            return Err(format!(
                "Warehouse {} does not handle {}",
                warehouse_id, commodity
            ));
        }

        let available = warehouse.capacity_tonnes - warehouse.current_stock_tonnes;
        if quantity_tonnes > available {
            return Err(format!(
                "Insufficient capacity: need {} tonnes, available {} tonnes",
                quantity_tonnes, available
            ));
        }

        let receipt = WarehouseReceipt {
            id: Uuid::new_v4(),
            warehouse_id: warehouse_id.to_string(),
            commodity: commodity.to_string(),
            quantity_tonnes,
            grade: grade.to_string(),
            lot_number: format!("LOT-{}", Uuid::new_v4().to_string()[..8].to_uppercase()),
            owner_account: owner_account.to_string(),
            issued_at: Utc::now(),
            expires_at: None,
            status: ReceiptStatus::Active,
        };

        info!(
            "Issued warehouse receipt {} for {} tonnes {} at {}",
            receipt.id, quantity_tonnes, commodity, warehouse_id
        );

        self.receipts.insert(receipt.id, receipt.clone());

        // Update warehouse stock
        drop(warehouse);
        if let Some(mut wh) = self.warehouses.get_mut(warehouse_id) {
            wh.current_stock_tonnes += quantity_tonnes;
        }

        Ok(receipt)
    }

    /// Transfer ownership of a warehouse receipt.
    pub fn transfer_receipt(
        &self,
        receipt_id: Uuid,
        new_owner: &str,
    ) -> Result<WarehouseReceipt, String> {
        let mut receipt = self
            .receipts
            .get_mut(&receipt_id)
            .ok_or("Receipt not found")?;

        if receipt.status != ReceiptStatus::Active {
            return Err(format!("Receipt is not active: {:?}", receipt.status));
        }

        let old_owner = receipt.owner_account.clone();
        receipt.owner_account = new_owner.to_string();

        info!(
            "Transferred receipt {} from {} to {}",
            receipt_id, old_owner, new_owner
        );

        Ok(receipt.clone())
    }

    /// Submit a delivery notice for physical settlement.
    pub fn submit_delivery_notice(
        &self,
        contract_symbol: &str,
        account_id: &str,
        side: DeliverySide,
        quantity_lots: i64,
        warehouse_id: &str,
        grade: &str,
    ) -> Result<DeliveryNotice, String> {
        if !self.warehouses.contains_key(warehouse_id) {
            return Err(format!("Warehouse {} not found", warehouse_id));
        }

        let notice = DeliveryNotice {
            id: Uuid::new_v4(),
            contract_symbol: contract_symbol.to_string(),
            account_id: account_id.to_string(),
            side,
            quantity_lots,
            warehouse_id: warehouse_id.to_string(),
            grade: grade.to_string(),
            delivery_date: (Utc::now() + chrono::Duration::days(3)).date_naive(),
            status: DeliveryStatus::Pending,
            receipt_id: None,
            created_at: Utc::now(),
        };

        info!(
            "Delivery notice submitted: {} {} lots of {} at {}",
            if side == DeliverySide::Deliver {
                "DELIVER"
            } else {
                "RECEIVE"
            },
            quantity_lots,
            contract_symbol,
            warehouse_id
        );

        self.notices.insert(notice.id, notice.clone());
        Ok(notice)
    }

    /// Match delivery and receive notices.
    pub fn match_delivery_notices(&self) -> Vec<(Uuid, Uuid)> {
        let mut matched = Vec::new();
        let deliverers: Vec<_> = self
            .notices
            .iter()
            .filter(|r| {
                r.value().side == DeliverySide::Deliver
                    && r.value().status == DeliveryStatus::Pending
            })
            .map(|r| (r.key().clone(), r.value().clone()))
            .collect();

        let receivers: Vec<_> = self
            .notices
            .iter()
            .filter(|r| {
                r.value().side == DeliverySide::Receive
                    && r.value().status == DeliveryStatus::Pending
            })
            .map(|r| (r.key().clone(), r.value().clone()))
            .collect();

        for (d_id, d_notice) in &deliverers {
            for (r_id, r_notice) in &receivers {
                if d_notice.contract_symbol == r_notice.contract_symbol
                    && d_notice.quantity_lots == r_notice.quantity_lots
                    && d_notice.warehouse_id == r_notice.warehouse_id
                {
                    // Match found
                    if let Some(mut dn) = self.notices.get_mut(d_id) {
                        dn.status = DeliveryStatus::Matched;
                    }
                    if let Some(mut rn) = self.notices.get_mut(r_id) {
                        rn.status = DeliveryStatus::Matched;
                    }
                    matched.push((*d_id, *r_id));
                    info!("Matched delivery notices: {} <-> {}", d_id, r_id);
                    break;
                }
            }
        }

        matched
    }

    /// Get all warehouses.
    pub fn get_warehouses(&self) -> Vec<Warehouse> {
        self.warehouses.iter().map(|r| r.value().clone()).collect()
    }

    /// Get warehouses for a specific commodity.
    pub fn get_warehouses_for_commodity(&self, commodity: &str) -> Vec<Warehouse> {
        self.warehouses
            .iter()
            .filter(|r| r.value().commodities.contains(&commodity.to_string()))
            .map(|r| r.value().clone())
            .collect()
    }

    /// Get all receipts for an account.
    pub fn get_receipts_for_account(&self, account_id: &str) -> Vec<WarehouseReceipt> {
        self.receipts
            .iter()
            .filter(|r| r.value().owner_account == account_id)
            .map(|r| r.value().clone())
            .collect()
    }

    /// Get grades for a commodity.
    pub fn get_grades(&self, commodity: &str) -> Vec<GradeSpec> {
        self.grades
            .get(commodity)
            .map(|r| r.value().clone())
            .unwrap_or_default()
    }

    /// Get total stocks across all warehouses.
    pub fn total_stocks(&self) -> HashMap<String, f64> {
        let mut totals: HashMap<String, f64> = HashMap::new();
        for wh in self.warehouses.iter() {
            for commodity in &wh.commodities {
                *totals.entry(commodity.clone()).or_default() += wh.current_stock_tonnes
                    / wh.commodities.len() as f64; // Approximate split
            }
        }
        totals
    }
}

impl Default for DeliveryManager {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_issue_receipt() {
        let mgr = DeliveryManager::new();
        let receipt = mgr.issue_receipt("WH-NBI-001", "COFFEE", 100.0, "AA", "ACC001");
        assert!(receipt.is_ok());
        let r = receipt.unwrap();
        assert_eq!(r.commodity, "COFFEE");
        assert_eq!(r.status, ReceiptStatus::Active);
    }

    #[test]
    fn test_invalid_warehouse() {
        let mgr = DeliveryManager::new();
        let receipt = mgr.issue_receipt("WH-FAKE", "GOLD", 10.0, "LGD", "ACC001");
        assert!(receipt.is_err());
    }

    #[test]
    fn test_transfer_receipt() {
        let mgr = DeliveryManager::new();
        let receipt = mgr
            .issue_receipt("WH-JHB-001", "GOLD", 5.0, "LGD", "ACC001")
            .unwrap();
        let transferred = mgr.transfer_receipt(receipt.id, "ACC002");
        assert!(transferred.is_ok());
        assert_eq!(transferred.unwrap().owner_account, "ACC002");
    }

    #[test]
    fn test_delivery_notice_matching() {
        let mgr = DeliveryManager::new();

        mgr.submit_delivery_notice(
            "GOLD-FUT-2026M06",
            "SELLER001",
            DeliverySide::Deliver,
            10,
            "WH-JHB-001",
            "LGD",
        )
        .unwrap();

        mgr.submit_delivery_notice(
            "GOLD-FUT-2026M06",
            "BUYER001",
            DeliverySide::Receive,
            10,
            "WH-JHB-001",
            "LGD",
        )
        .unwrap();

        let matched = mgr.match_delivery_notices();
        assert_eq!(matched.len(), 1);
    }

    #[test]
    fn test_warehouse_count() {
        let mgr = DeliveryManager::new();
        let warehouses = mgr.get_warehouses();
        assert!(warehouses.len() >= 9);
    }
}
