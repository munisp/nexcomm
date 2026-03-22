//! Corporate Actions processing — dividends, stock splits, rights issues,
//! position adjustments, and contract modifications for commodity exchanges.

use crate::types::*;
use chrono::{DateTime, Utc};
use parking_lot::RwLock;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use uuid::Uuid;

// ─── Corporate Action Types ─────────────────────────────────────────────────

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum CorporateActionType {
    /// Cash dividend distribution to holders
    CashDividend,
    /// Stock/position split (e.g., 2:1 doubles quantity, halves price)
    Split,
    /// Reverse split (e.g., 1:2 halves quantity, doubles price)
    ReverseSplit,
    /// Rights issue — entitlement to buy new contracts at discount
    RightsIssue,
    /// Contract specification change (e.g., tick size, lot size)
    ContractModification,
    /// Symbol/ticker change
    SymbolChange,
    /// Delivery month rollover
    Rollover,
    /// Exchange-for-Physical conversion
    ExchangeForPhysical,
    /// Position transfer between accounts
    PositionTransfer,
    /// Margin rate adjustment
    MarginAdjustment,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum CorporateActionStatus {
    Announced,
    Pending,
    ExDate,
    Processing,
    Completed,
    Cancelled,
    Failed,
}

// ─── Corporate Action ───────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CorporateAction {
    pub id: Uuid,
    pub action_type: CorporateActionType,
    pub symbol: String,
    pub description: String,
    pub announcement_date: DateTime<Utc>,
    pub ex_date: Option<DateTime<Utc>>,
    pub record_date: Option<DateTime<Utc>>,
    pub effective_date: DateTime<Utc>,
    pub status: CorporateActionStatus,
    pub parameters: CorporateActionParams,
    pub affected_positions: Vec<PositionAdjustment>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum CorporateActionParams {
    CashDividend {
        amount_per_contract: f64,
        currency: String,
        total_payout: f64,
    },
    Split {
        ratio_from: u32,
        ratio_to: u32,
    },
    RightsIssue {
        subscription_price: f64,
        ratio: f64,
        expiry_date: String,
    },
    ContractModification {
        field: String,
        old_value: String,
        new_value: String,
    },
    SymbolChange {
        old_symbol: String,
        new_symbol: String,
    },
    Rollover {
        from_contract: String,
        to_contract: String,
        price_adjustment: f64,
    },
    MarginAdjustment {
        old_initial_margin_pct: f64,
        new_initial_margin_pct: f64,
        old_maintenance_margin_pct: f64,
        new_maintenance_margin_pct: f64,
    },
    PositionTransfer {
        from_account: String,
        to_account: String,
        quantity: i64,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PositionAdjustment {
    pub account_id: String,
    pub symbol: String,
    pub original_quantity: Qty,
    pub adjusted_quantity: Qty,
    pub original_price: f64,
    pub adjusted_price: f64,
    pub cash_adjustment: f64,
    pub timestamp: DateTime<Utc>,
}

// ─── Corporate Actions Manager ──────────────────────────────────────────────

pub struct CorporateActionsManager {
    actions: RwLock<Vec<CorporateAction>>,
    history: RwLock<Vec<CorporateAction>>,
}

impl CorporateActionsManager {
    pub fn new() -> Self {
        let mgr = Self {
            actions: RwLock::new(Vec::new()),
            history: RwLock::new(Vec::new()),
        };
        mgr.register_sample_actions();
        mgr
    }

    fn register_sample_actions(&self) {
        // Sample upcoming corporate actions
        self.announce_action(CorporateAction {
            id: Uuid::new_v4(),
            action_type: CorporateActionType::Rollover,
            symbol: "MAIZE-FUT-2026M03".to_string(),
            description: "March 2026 Maize futures rollover to June 2026".to_string(),
            announcement_date: Utc::now(),
            ex_date: None,
            record_date: None,
            effective_date: Utc::now(),
            status: CorporateActionStatus::Announced,
            parameters: CorporateActionParams::Rollover {
                from_contract: "MAIZE-FUT-2026M03".into(),
                to_contract: "MAIZE-FUT-2026M06".into(),
                price_adjustment: 0.0,
            },
            affected_positions: vec![],
            created_at: Utc::now(),
        });

        self.announce_action(CorporateAction {
            id: Uuid::new_v4(),
            action_type: CorporateActionType::MarginAdjustment,
            symbol: "CRUDE_OIL".to_string(),
            description: "Crude Oil initial margin increase due to elevated volatility".to_string(),
            announcement_date: Utc::now(),
            ex_date: None,
            record_date: None,
            effective_date: Utc::now(),
            status: CorporateActionStatus::Announced,
            parameters: CorporateActionParams::MarginAdjustment {
                old_initial_margin_pct: 8.0,
                new_initial_margin_pct: 10.0,
                old_maintenance_margin_pct: 6.0,
                new_maintenance_margin_pct: 7.5,
            },
            affected_positions: vec![],
            created_at: Utc::now(),
        });

        self.announce_action(CorporateAction {
            id: Uuid::new_v4(),
            action_type: CorporateActionType::CashDividend,
            symbol: "CARBON".to_string(),
            description: "Carbon credit retirement dividend — $0.50 per contract".to_string(),
            announcement_date: Utc::now(),
            ex_date: Some(Utc::now()),
            record_date: Some(Utc::now()),
            effective_date: Utc::now(),
            status: CorporateActionStatus::Announced,
            parameters: CorporateActionParams::CashDividend {
                amount_per_contract: 0.50,
                currency: "USD".into(),
                total_payout: 40000.0,
            },
            affected_positions: vec![],
            created_at: Utc::now(),
        });
    }

    pub fn announce_action(&self, action: CorporateAction) {
        self.actions.write().push(action);
    }

    /// Process a corporate action — apply position adjustments.
    pub fn process_action(&self, action_id: Uuid) -> Result<CorporateAction, String> {
        let mut actions = self.actions.write();
        let action = actions
            .iter_mut()
            .find(|a| a.id == action_id)
            .ok_or("Corporate action not found")?;

        if action.status != CorporateActionStatus::Announced
            && action.status != CorporateActionStatus::Pending
        {
            return Err(format!("Action is already {:?}", action.status));
        }

        action.status = CorporateActionStatus::Processing;

        // Generate position adjustments based on type
        match &action.parameters {
            CorporateActionParams::Split { ratio_from, ratio_to } => {
                let ratio = *ratio_to as f64 / *ratio_from as f64;
                action.affected_positions.push(PositionAdjustment {
                    account_id: "ALL".to_string(),
                    symbol: action.symbol.clone(),
                    original_quantity: 1_000_000,
                    adjusted_quantity: (1_000_000.0 * ratio) as Qty,
                    original_price: 100.0,
                    adjusted_price: 100.0 / ratio,
                    cash_adjustment: 0.0,
                    timestamp: Utc::now(),
                });
            }
            CorporateActionParams::CashDividend { amount_per_contract, .. } => {
                action.affected_positions.push(PositionAdjustment {
                    account_id: "ALL_HOLDERS".to_string(),
                    symbol: action.symbol.clone(),
                    original_quantity: 0,
                    adjusted_quantity: 0,
                    original_price: 0.0,
                    adjusted_price: 0.0,
                    cash_adjustment: *amount_per_contract,
                    timestamp: Utc::now(),
                });
            }
            _ => {}
        }

        action.status = CorporateActionStatus::Completed;
        let result = action.clone();

        // Move to history
        drop(actions);
        self.history.write().push(result.clone());

        Ok(result)
    }

    pub fn pending_actions(&self) -> Vec<CorporateAction> {
        self.actions
            .read()
            .iter()
            .filter(|a| {
                a.status == CorporateActionStatus::Announced
                    || a.status == CorporateActionStatus::Pending
            })
            .cloned()
            .collect()
    }

    pub fn all_actions(&self) -> Vec<CorporateAction> {
        self.actions.read().clone()
    }

    pub fn get_action(&self, id: Uuid) -> Option<CorporateAction> {
        self.actions.read().iter().find(|a| a.id == id).cloned()
    }

    pub fn actions_for_symbol(&self, symbol: &str) -> Vec<CorporateAction> {
        self.actions
            .read()
            .iter()
            .filter(|a| a.symbol == symbol)
            .cloned()
            .collect()
    }

    pub fn history(&self) -> Vec<CorporateAction> {
        self.history.read().clone()
    }

    pub fn action_count(&self) -> usize {
        self.actions.read().len()
    }
}

// ─── Tests ──────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_corporate_actions_init() {
        let mgr = CorporateActionsManager::new();
        assert!(mgr.action_count() >= 3);
    }

    #[test]
    fn test_pending_actions() {
        let mgr = CorporateActionsManager::new();
        let pending = mgr.pending_actions();
        assert!(!pending.is_empty());
    }

    #[test]
    fn test_process_action() {
        let mgr = CorporateActionsManager::new();
        let actions = mgr.all_actions();
        let action_id = actions[0].id;
        let result = mgr.process_action(action_id);
        assert!(result.is_ok());
        let processed = result.unwrap();
        assert_eq!(processed.status, CorporateActionStatus::Completed);
    }

    #[test]
    fn test_actions_for_symbol() {
        let mgr = CorporateActionsManager::new();
        let crude_actions = mgr.actions_for_symbol("CRUDE_OIL");
        assert!(!crude_actions.is_empty());
    }
}
