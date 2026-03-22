//! Investor Protection Fund — NYSE SIPC-equivalent module.
//! Implements:
//! - Fund management (contributions, claims, disbursements)
//! - Coverage limits per account (similar to SIPC $500K)
//! - Claim processing workflow
//! - Fund status and reporting
#![allow(dead_code)]

use crate::types::*;
use chrono::{DateTime, Utc};
use parking_lot::RwLock;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use tracing::{info, warn};

/// Coverage limit per account (in fixed-point, 500K default).
const DEFAULT_COVERAGE_LIMIT: Price = 50_000_000_000_000; // 500,000.00 in fixed-point (500_000 * PRICE_SCALE)

/// Investor protection fund claim status.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum ClaimStatus {
    Submitted,
    UnderReview,
    Approved,
    Denied,
    Disbursed,
    Appealed,
}

/// A claim against the investor protection fund.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProtectionClaim {
    pub id: uuid::Uuid,
    pub account_id: String,
    pub claimant_name: String,
    pub claim_amount: Price,
    pub approved_amount: Price,
    pub reason: String,
    pub status: ClaimStatus,
    pub submitted_at: DateTime<Utc>,
    pub reviewed_at: Option<DateTime<Utc>>,
    pub disbursed_at: Option<DateTime<Utc>>,
    pub reviewer_notes: String,
}

/// Fund contribution record.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FundContribution {
    pub id: uuid::Uuid,
    pub member_id: String,
    pub amount: Price,
    pub contribution_type: ContributionType,
    pub recorded_at: DateTime<Utc>,
}

/// Types of fund contributions.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum ContributionType {
    /// Regular quarterly contribution.
    Quarterly,
    /// Special assessment.
    Assessment,
    /// Initial membership contribution.
    Initial,
    /// Interest/investment income.
    Investment,
}

/// The investor protection fund.
pub struct InvestorProtectionFund {
    total_fund: RwLock<Price>,
    coverage_limit: Price,
    claims: RwLock<Vec<ProtectionClaim>>,
    contributions: RwLock<Vec<FundContribution>>,
    member_contributions: RwLock<HashMap<String, Price>>,
    total_disbursed: RwLock<Price>,
}

impl InvestorProtectionFund {
    pub fn new() -> Self {
        let fund = Self {
            total_fund: RwLock::new(to_price(10_000_000.0)), // Initial 10M fund
            coverage_limit: DEFAULT_COVERAGE_LIMIT,
            claims: RwLock::new(Vec::new()),
            contributions: RwLock::new(Vec::new()),
            member_contributions: RwLock::new(HashMap::new()),
            total_disbursed: RwLock::new(0),
        };

        // Record initial fund seeding
        fund.record_contribution("NEXCOM-EXCHANGE", to_price(10_000_000.0), ContributionType::Initial);
        fund
    }

    /// Record a contribution to the fund.
    pub fn record_contribution(
        &self,
        member_id: &str,
        amount: Price,
        contribution_type: ContributionType,
    ) -> FundContribution {
        let contribution = FundContribution {
            id: uuid::Uuid::new_v4(),
            member_id: member_id.to_string(),
            amount,
            contribution_type,
            recorded_at: Utc::now(),
        };

        *self.total_fund.write() += amount;
        *self
            .member_contributions
            .write()
            .entry(member_id.to_string())
            .or_insert(0) += amount;
        self.contributions.write().push(contribution.clone());

        info!(
            "Fund contribution: {} from {} ({:?}), total fund: {}",
            from_price(amount),
            member_id,
            contribution_type,
            from_price(*self.total_fund.read())
        );

        contribution
    }

    /// Submit a claim against the fund.
    pub fn submit_claim(
        &self,
        account_id: &str,
        claimant_name: &str,
        amount: Price,
        reason: &str,
    ) -> ProtectionClaim {
        let capped_amount = amount.min(self.coverage_limit);

        let claim = ProtectionClaim {
            id: uuid::Uuid::new_v4(),
            account_id: account_id.to_string(),
            claimant_name: claimant_name.to_string(),
            claim_amount: capped_amount,
            approved_amount: 0,
            reason: reason.to_string(),
            status: ClaimStatus::Submitted,
            submitted_at: Utc::now(),
            reviewed_at: None,
            disbursed_at: None,
            reviewer_notes: String::new(),
        };

        info!(
            "Protection claim submitted: {} for {} (amount: {})",
            claim.id,
            account_id,
            from_price(capped_amount)
        );

        self.claims.write().push(claim.clone());
        claim
    }

    /// Review and approve/deny a claim.
    pub fn review_claim(
        &self,
        claim_id: uuid::Uuid,
        approved: bool,
        approved_amount: Option<Price>,
        notes: &str,
    ) -> Result<ProtectionClaim, String> {
        let mut claims = self.claims.write();
        let claim = claims
            .iter_mut()
            .find(|c| c.id == claim_id)
            .ok_or_else(|| format!("Claim {} not found", claim_id))?;

        if claim.status != ClaimStatus::Submitted && claim.status != ClaimStatus::UnderReview {
            return Err(format!("Claim {} is not reviewable (status: {:?})", claim_id, claim.status));
        }

        claim.reviewed_at = Some(Utc::now());
        claim.reviewer_notes = notes.to_string();

        if approved {
            let amount = approved_amount.unwrap_or(claim.claim_amount).min(claim.claim_amount);
            claim.approved_amount = amount;
            claim.status = ClaimStatus::Approved;
            info!("Claim {} approved for {}", claim_id, from_price(amount));
        } else {
            claim.status = ClaimStatus::Denied;
            warn!("Claim {} denied: {}", claim_id, notes);
        }

        Ok(claim.clone())
    }

    /// Disburse an approved claim.
    pub fn disburse_claim(&self, claim_id: uuid::Uuid) -> Result<ProtectionClaim, String> {
        let mut claims = self.claims.write();
        let claim = claims
            .iter_mut()
            .find(|c| c.id == claim_id)
            .ok_or_else(|| format!("Claim {} not found", claim_id))?;

        if claim.status != ClaimStatus::Approved {
            return Err(format!("Claim {} is not approved", claim_id));
        }

        let fund_balance = *self.total_fund.read();
        if claim.approved_amount > fund_balance {
            return Err(format!(
                "Insufficient fund balance ({}) for claim ({})",
                from_price(fund_balance),
                from_price(claim.approved_amount)
            ));
        }

        *self.total_fund.write() -= claim.approved_amount;
        *self.total_disbursed.write() += claim.approved_amount;
        claim.status = ClaimStatus::Disbursed;
        claim.disbursed_at = Some(Utc::now());

        info!(
            "Claim {} disbursed: {} to {}",
            claim_id,
            from_price(claim.approved_amount),
            claim.account_id
        );

        Ok(claim.clone())
    }

    /// Get fund status.
    pub fn fund_status(&self) -> serde_json::Value {
        let claims = self.claims.read();
        let pending = claims.iter().filter(|c| c.status == ClaimStatus::Submitted || c.status == ClaimStatus::UnderReview).count();
        let approved = claims.iter().filter(|c| c.status == ClaimStatus::Approved).count();
        let disbursed = claims.iter().filter(|c| c.status == ClaimStatus::Disbursed).count();

        serde_json::json!({
            "total_fund": from_price(*self.total_fund.read()),
            "coverage_limit_per_account": from_price(self.coverage_limit),
            "total_disbursed": from_price(*self.total_disbursed.read()),
            "total_contributions": self.contributions.read().len(),
            "contributing_members": self.member_contributions.read().len(),
            "claims": {
                "total": claims.len(),
                "pending": pending,
                "approved": approved,
                "disbursed": disbursed,
            },
        })
    }

    pub fn all_claims(&self) -> Vec<ProtectionClaim> {
        self.claims.read().clone()
    }

    pub fn claim_count(&self) -> usize {
        self.claims.read().len()
    }

    pub fn fund_balance(&self) -> Price {
        *self.total_fund.read()
    }
}

impl Default for InvestorProtectionFund {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_fund_creation() {
        let fund = InvestorProtectionFund::new();
        assert!(fund.fund_balance() > 0);
        assert_eq!(fund.claim_count(), 0);
    }

    #[test]
    fn test_contribution() {
        let fund = InvestorProtectionFund::new();
        let initial = fund.fund_balance();
        fund.record_contribution("CM-001", to_price(1_000_000.0), ContributionType::Quarterly);
        assert!(fund.fund_balance() > initial);
    }

    #[test]
    fn test_claim_lifecycle() {
        let fund = InvestorProtectionFund::new();

        // Submit claim
        let claim = fund.submit_claim("ACC-001", "John Doe", to_price(100_000.0), "Broker default");
        assert_eq!(claim.status, ClaimStatus::Submitted);

        // Approve claim
        let claim = fund.review_claim(claim.id, true, None, "Verified loss").unwrap();
        assert_eq!(claim.status, ClaimStatus::Approved);
        assert_eq!(claim.approved_amount, to_price(100_000.0));

        // Disburse
        let balance_before = fund.fund_balance();
        let claim = fund.disburse_claim(claim.id).unwrap();
        assert_eq!(claim.status, ClaimStatus::Disbursed);
        assert!(fund.fund_balance() < balance_before);
    }

    #[test]
    fn test_coverage_limit_cap() {
        let fund = InvestorProtectionFund::new();
        let claim = fund.submit_claim("ACC-001", "Jane", to_price(999_999_999.0), "Over limit");
        assert!(claim.claim_amount <= DEFAULT_COVERAGE_LIMIT);
    }

    #[test]
    fn test_deny_claim() {
        let fund = InvestorProtectionFund::new();
        let claim = fund.submit_claim("ACC-002", "Bob", to_price(50_000.0), "Suspicious");
        let claim = fund.review_claim(claim.id, false, None, "Fraudulent claim").unwrap();
        assert_eq!(claim.status, ClaimStatus::Denied);
    }
}
