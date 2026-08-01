/*!
 * NEXCOM Exchange — Credit Scoring Engine (Rust)
 * ================================================
 * High-performance credit scoring for agri-finance lending decisions.
 *
 * Scoring model: Weighted multi-factor scorecard (industry standard for
 * agricultural lending in emerging markets — CGAP/IFC methodology).
 *
 * Score bands:
 *   750-850: Excellent  → auto-approve, prime rate
 *   680-749: Good       → approve, standard rate
 *   620-679: Fair       → approve with conditions, +2% premium
 *   550-619: Poor       → manual review required
 *   300-549: Very Poor  → decline or require collateral ≥150% LTV
 *
 * Factors (total 1000 points):
 *   - Repayment history      (350 pts) — on-time payments, defaults, write-offs
 *   - Farm productivity      (200 pts) — yield history, crop diversity, acreage
 *   - Income stability       (150 pts) — seasonal income, off-farm income
 *   - Collateral quality     (150 pts) — warehouse receipts, land title, equipment
 *   - Debt-to-income ratio   (100 pts) — existing obligations vs income
 *   - Cooperative membership  (50 pts) — group lending track record
 *
 * REST API: POST /api/v1/score, GET /api/v1/score/:farmer_id, GET /health
 */

use actix_cors::Cors;
use actix_web::{get, middleware, post, web, App, HttpResponse, HttpServer, Responder};
use sqlx::PgPool;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::env;
use tracing::{error, info};
use uuid::Uuid;

// ─── Configuration ────────────────────────────────────────────────────────────

#[derive(Clone, Debug)]
struct Config {
    port: u16,
    db_url: String,
    redis_url: String,
    core_banking_url: String,
    min_score_auto_approve: i32,
    min_score_manual_review: i32,
    max_dti_ratio: f64,
    max_loan_to_income_ratio: f64,
}

impl Config {
    fn from_env() -> Self {
        Self {
            port: env::var("CREDIT_SCORING_PORT")
                .unwrap_or_else(|_| "8089".to_string())
                .parse()
                .unwrap_or(8089),
            db_url: env::var("DATABASE_URL")
                .unwrap_or_else(|_| "postgres://nexcom:nexcom@localhost:5432/nexcom".to_string()),
            redis_url: env::var("REDIS_URL")
                .unwrap_or_else(|_| "redis://localhost:6379".to_string()),
            core_banking_url: env::var("CORE_BANKING_URL")
                .unwrap_or_else(|_| "http://localhost:8083".to_string()),
            min_score_auto_approve: env::var("MIN_SCORE_AUTO_APPROVE")
                .unwrap_or_else(|_| "680".to_string())
                .parse()
                .unwrap_or(680),
            min_score_manual_review: env::var("MIN_SCORE_MANUAL_REVIEW")
                .unwrap_or_else(|_| "550".to_string())
                .parse()
                .unwrap_or(550),
            max_dti_ratio: env::var("MAX_DTI_RATIO")
                .unwrap_or_else(|_| "0.45".to_string())
                .parse()
                .unwrap_or(0.45),
            max_loan_to_income_ratio: env::var("MAX_LOAN_TO_INCOME_RATIO")
                .unwrap_or_else(|_| "3.0".to_string())
                .parse()
                .unwrap_or(3.0),
        }
    }
}

// ─── Request / Response Types ─────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
struct ScoreRequest {
    farmer_id: i64,
    loan_amount_ngn: f64,
    loan_purpose: String,
    loan_term_months: i32,
    // Repayment history
    total_loans_taken: Option<i32>,
    loans_repaid_on_time: Option<i32>,
    loans_defaulted: Option<i32>,
    loans_written_off: Option<i32>,
    days_past_due_avg: Option<f64>,
    // Farm productivity
    farm_size_hectares: Option<f64>,
    years_farming: Option<i32>,
    crop_types_count: Option<i32>,
    avg_yield_tons_per_ha: Option<f64>,
    has_irrigation: Option<bool>,
    has_storage: Option<bool>,
    // Income
    annual_farm_income_ngn: Option<f64>,
    annual_off_farm_income_ngn: Option<f64>,
    income_months_covered: Option<i32>,
    // Collateral
    warehouse_receipt_value_ngn: Option<f64>,
    land_title_value_ngn: Option<f64>,
    equipment_value_ngn: Option<f64>,
    // Debt
    existing_loan_balance_ngn: Option<f64>,
    monthly_debt_payments_ngn: Option<f64>,
    // Cooperative
    cooperative_member: Option<bool>,
    cooperative_years: Option<i32>,
    cooperative_savings_ngn: Option<f64>,
}

#[derive(Debug, Serialize)]
struct ScoreFactors {
    repayment_history: FactorScore,
    farm_productivity: FactorScore,
    income_stability: FactorScore,
    collateral_quality: FactorScore,
    debt_to_income: FactorScore,
    cooperative_membership: FactorScore,
}

#[derive(Debug, Serialize)]
struct FactorScore {
    score: i32,
    max_score: i32,
    pct: f64,
    notes: Vec<String>,
}

#[derive(Debug, Serialize)]
struct ScoreResponse {
    request_id: String,
    farmer_id: i64,
    score: i32,
    score_band: String,
    decision: String,
    interest_rate_premium_bps: i32,
    max_loan_amount_ngn: f64,
    recommended_loan_term_months: i32,
    factors: ScoreFactors,
    risk_flags: Vec<String>,
    scored_at: DateTime<Utc>,
    valid_until: DateTime<Utc>,
    bureau_ref: String,
}

#[derive(Debug, Serialize)]
struct HealthResponse {
    status: String,
    service: String,
    version: String,
    timestamp: DateTime<Utc>,
}

#[derive(Debug, Serialize)]
struct ErrorResponse {
    error: String,
    code: String,
}

// ─── Scoring Engine ───────────────────────────────────────────────────────────

struct ScoringEngine {
    config: Config,
    db: Option<PgPool>,
}

impl ScoringEngine {
    fn new(config: Config) -> Self {
        Self { config, db: None }
    }
    fn with_db(config: Config, db: PgPool) -> Self {
        Self { config, db: Some(db) }
    }

    /// Score repayment history (max 350 points)
    fn score_repayment_history(&self, req: &ScoreRequest) -> FactorScore {
        let mut score = 175i32; // Start at midpoint for no history
        let max_score = 350;
        let mut notes = Vec::new();

        let total = req.total_loans_taken.unwrap_or(0);
        if total == 0 {
            notes.push("No prior loan history — neutral score applied".to_string());
            return FactorScore {
                score,
                max_score,
                pct: score as f64 / max_score as f64 * 100.0,
                notes,
            };
        }

        // On-time repayment rate
        let on_time = req.loans_repaid_on_time.unwrap_or(0);
        let on_time_rate = if total > 0 { on_time as f64 / total as f64 } else { 0.5 };
        score = (on_time_rate * 200.0) as i32;

        // Defaults penalty
        let defaults = req.loans_defaulted.unwrap_or(0);
        if defaults > 0 {
            let penalty = (defaults * 40).min(120);
            score -= penalty;
            notes.push(format!("{} default(s) — -{} pts", defaults, penalty));
        }

        // Write-offs — severe penalty
        let write_offs = req.loans_written_off.unwrap_or(0);
        if write_offs > 0 {
            let penalty = (write_offs * 80).min(200);
            score -= penalty;
            notes.push(format!("{} write-off(s) — -{} pts", write_offs, penalty));
        }

        // Days past due
        let dpd = req.days_past_due_avg.unwrap_or(0.0);
        if dpd > 0.0 {
            let penalty = if dpd < 30.0 { 20 } else if dpd < 60.0 { 50 } else if dpd < 90.0 { 80 } else { 120 };
            score -= penalty;
            notes.push(format!("Avg {:.0} days past due — -{} pts", dpd, penalty));
        }

        // Bonus for excellent history
        if on_time_rate >= 0.95 && defaults == 0 && write_offs == 0 {
            score += 50;
            notes.push("Excellent repayment record +50 pts".to_string());
        }

        score = score.clamp(0, max_score);
        FactorScore {
            score,
            max_score,
            pct: score as f64 / max_score as f64 * 100.0,
            notes,
        }
    }

    /// Score farm productivity (max 200 points)
    fn score_farm_productivity(&self, req: &ScoreRequest) -> FactorScore {
        let mut score = 0i32;
        let max_score = 200;
        let mut notes = Vec::new();

        // Farm size (0-50 pts)
        let hectares = req.farm_size_hectares.unwrap_or(0.0);
        let size_score = if hectares >= 50.0 { 50 }
            else if hectares >= 20.0 { 40 }
            else if hectares >= 5.0 { 30 }
            else if hectares >= 1.0 { 20 }
            else { 10 };
        score += size_score;
        notes.push(format!("{:.1} ha farm — {} pts", hectares, size_score));

        // Years farming (0-40 pts)
        let years = req.years_farming.unwrap_or(0);
        let exp_score = if years >= 15 { 40 } else if years >= 10 { 35 } else if years >= 5 { 25 } else if years >= 2 { 15 } else { 5 };
        score += exp_score;
        notes.push(format!("{} years experience — {} pts", years, exp_score));

        // Crop diversity (0-40 pts)
        let crops = req.crop_types_count.unwrap_or(1);
        let crop_score = if crops >= 4 { 40 } else if crops >= 3 { 30 } else if crops >= 2 { 20 } else { 10 };
        score += crop_score;

        // Yield performance (0-40 pts)
        let yield_score = match req.avg_yield_tons_per_ha {
            Some(y) if y >= 3.0 => 40,
            Some(y) if y >= 2.0 => 30,
            Some(y) if y >= 1.0 => 20,
            Some(_) => 10,
            None => 15,
        };
        score += yield_score;

        // Infrastructure bonuses (0-30 pts)
        if req.has_irrigation.unwrap_or(false) {
            score += 15;
            notes.push("Irrigation system +15 pts".to_string());
        }
        if req.has_storage.unwrap_or(false) {
            score += 15;
            notes.push("On-farm storage +15 pts".to_string());
        }

        score = score.clamp(0, max_score);
        FactorScore {
            score,
            max_score,
            pct: score as f64 / max_score as f64 * 100.0,
            notes,
        }
    }

    /// Score income stability (max 150 points)
    fn score_income_stability(&self, req: &ScoreRequest) -> FactorScore {
        let mut score = 0i32;
        let max_score = 150;
        let mut notes = Vec::new();

        let farm_income = req.annual_farm_income_ngn.unwrap_or(0.0);
        let off_farm = req.annual_off_farm_income_ngn.unwrap_or(0.0);
        let total_income = farm_income + off_farm;

        if total_income <= 0.0 {
            notes.push("No income data provided".to_string());
            return FactorScore { score: 50, max_score, pct: 33.3, notes };
        }

        // Absolute income level (0-60 pts)
        let income_score = if total_income >= 5_000_000.0 { 60 }
            else if total_income >= 2_000_000.0 { 50 }
            else if total_income >= 1_000_000.0 { 40 }
            else if total_income >= 500_000.0 { 30 }
            else if total_income >= 200_000.0 { 20 }
            else { 10 };
        score += income_score;
        notes.push(format!("Annual income ₦{:.0} — {} pts", total_income, income_score));

        // Income diversification (0-40 pts)
        if off_farm > 0.0 {
            let off_farm_pct = off_farm / total_income;
            let div_score = if off_farm_pct >= 0.3 { 40 } else if off_farm_pct >= 0.2 { 30 } else { 20 };
            score += div_score;
            notes.push(format!("Off-farm income {:.0}% — {} pts", off_farm_pct * 100.0, div_score));
        }

        // Income coverage months (0-50 pts)
        let months = req.income_months_covered.unwrap_or(6);
        let months_score = if months >= 12 { 50 } else if months >= 9 { 40 } else if months >= 6 { 30 } else { 15 };
        score += months_score;

        score = score.clamp(0, max_score);
        FactorScore {
            score,
            max_score,
            pct: score as f64 / max_score as f64 * 100.0,
            notes,
        }
    }

    /// Score collateral quality (max 150 points)
    fn score_collateral(&self, req: &ScoreRequest, loan_amount: f64) -> FactorScore {
        let mut score = 0i32;
        let max_score = 150;
        let mut notes = Vec::new();

        let whr = req.warehouse_receipt_value_ngn.unwrap_or(0.0);
        let land = req.land_title_value_ngn.unwrap_or(0.0);
        let equip = req.equipment_value_ngn.unwrap_or(0.0);
        let total_collateral = whr + land + equip;

        if total_collateral <= 0.0 {
            notes.push("No collateral provided".to_string());
            return FactorScore { score: 0, max_score, pct: 0.0, notes };
        }

        // Coverage ratio
        let coverage = if loan_amount > 0.0 { total_collateral / loan_amount } else { 0.0 };
        let coverage_score = if coverage >= 2.0 { 80 }
            else if coverage >= 1.5 { 65 }
            else if coverage >= 1.2 { 50 }
            else if coverage >= 1.0 { 35 }
            else { 15 };
        score += coverage_score;
        notes.push(format!("Collateral coverage {:.1}x — {} pts", coverage, coverage_score));

        // Warehouse receipt bonus (most liquid collateral)
        if whr > 0.0 {
            score += 40;
            notes.push(format!("Warehouse receipt ₦{:.0} +40 pts", whr));
        }

        // Land title bonus
        if land > 0.0 {
            score += 30;
            notes.push(format!("Land title ₦{:.0} +30 pts", land));
        }

        score = score.clamp(0, max_score);
        FactorScore {
            score,
            max_score,
            pct: score as f64 / max_score as f64 * 100.0,
            notes,
        }
    }

    /// Score debt-to-income ratio (max 100 points)
    fn score_dti(&self, req: &ScoreRequest) -> FactorScore {
        let max_score = 100;
        let mut notes = Vec::new();

        let farm_income = req.annual_farm_income_ngn.unwrap_or(0.0);
        let off_farm = req.annual_off_farm_income_ngn.unwrap_or(0.0);
        let monthly_income = (farm_income + off_farm) / 12.0;
        let monthly_debt = req.monthly_debt_payments_ngn.unwrap_or(0.0);

        if monthly_income <= 0.0 {
            notes.push("Cannot calculate DTI — no income data".to_string());
            return FactorScore { score: 50, max_score, pct: 50.0, notes };
        }

        let dti = monthly_debt / monthly_income;
        let score = if dti <= 0.10 { 100 }
            else if dti <= 0.20 { 85 }
            else if dti <= 0.30 { 70 }
            else if dti <= 0.40 { 50 }
            else if dti <= 0.50 { 30 }
            else { 10 };

        notes.push(format!("DTI ratio {:.1}% — {} pts", dti * 100.0, score));
        FactorScore {
            score,
            max_score,
            pct: score as f64 / max_score as f64 * 100.0,
            notes,
        }
    }

    /// Score cooperative membership (max 50 points)
    fn score_cooperative(&self, req: &ScoreRequest) -> FactorScore {
        let max_score = 50;
        let mut notes = Vec::new();

        if !req.cooperative_member.unwrap_or(false) {
            notes.push("Not a cooperative member".to_string());
            return FactorScore { score: 0, max_score, pct: 0.0, notes };
        }

        let years = req.cooperative_years.unwrap_or(0);
        let savings = req.cooperative_savings_ngn.unwrap_or(0.0);

        let year_score = if years >= 5 { 25 } else if years >= 3 { 20 } else if years >= 1 { 15 } else { 5 };
        let savings_score = if savings >= 500_000.0 { 25 } else if savings >= 200_000.0 { 20 } else if savings >= 100_000.0 { 15 } else { 5 };

        let score = (year_score + savings_score).min(max_score);
        notes.push(format!("{} years in cooperative, ₦{:.0} savings — {} pts", years, savings, score));

        FactorScore {
            score,
            max_score,
            pct: score as f64 / max_score as f64 * 100.0,
            notes,
        }
    }

    /// Compute risk flags
    fn compute_risk_flags(&self, req: &ScoreRequest, score: i32) -> Vec<String> {
        let mut flags = Vec::new();

        if req.loans_defaulted.unwrap_or(0) > 0 {
            flags.push("PRIOR_DEFAULT".to_string());
        }
        if req.loans_written_off.unwrap_or(0) > 0 {
            flags.push("PRIOR_WRITE_OFF".to_string());
        }
        if req.days_past_due_avg.unwrap_or(0.0) > 90.0 {
            flags.push("SEVERE_DELINQUENCY".to_string());
        }

        let farm_income = req.annual_farm_income_ngn.unwrap_or(0.0);
        let off_farm = req.annual_off_farm_income_ngn.unwrap_or(0.0);
        let annual_income = farm_income + off_farm;
        if annual_income > 0.0 && req.loan_amount_ngn / annual_income > self.config.max_loan_to_income_ratio {
            flags.push("HIGH_LOAN_TO_INCOME".to_string());
        }

        let monthly_income = annual_income / 12.0;
        let monthly_debt = req.monthly_debt_payments_ngn.unwrap_or(0.0);
        if monthly_income > 0.0 && monthly_debt / monthly_income > self.config.max_dti_ratio {
            flags.push("HIGH_DTI".to_string());
        }

        if req.warehouse_receipt_value_ngn.unwrap_or(0.0) == 0.0
            && req.land_title_value_ngn.unwrap_or(0.0) == 0.0
            && req.equipment_value_ngn.unwrap_or(0.0) == 0.0 {
            flags.push("NO_COLLATERAL".to_string());
        }

        if score < 550 {
            flags.push("HIGH_RISK_SCORE".to_string());
        }

        flags
    }

    /// Main scoring function — returns a complete ScoreResponse
    fn score(&self, req: ScoreRequest) -> ScoreResponse {
        let repayment = self.score_repayment_history(&req);
        let productivity = self.score_farm_productivity(&req);
        let income = self.score_income_stability(&req);
        let collateral = self.score_collateral(&req, req.loan_amount_ngn);
        let dti = self.score_dti(&req);
        let cooperative = self.score_cooperative(&req);

        // Raw score out of 1000
        let raw = repayment.score + productivity.score + income.score
            + collateral.score + dti.score + cooperative.score;

        // Normalize to 300-850 range (FICO-style)
        let score = 300 + (raw as f64 / 1000.0 * 550.0) as i32;
        let score = score.clamp(300, 850);

        let (band, decision, premium_bps) = if score >= 750 {
            ("EXCELLENT", "AUTO_APPROVE", 0)
        } else if score >= 680 {
            ("GOOD", "AUTO_APPROVE", 100)
        } else if score >= 620 {
            ("FAIR", "APPROVE_WITH_CONDITIONS", 200)
        } else if score >= 550 {
            ("POOR", "MANUAL_REVIEW", 400)
        } else {
            ("VERY_POOR", "DECLINE", 0)
        };

        // Max loan amount based on income and score
        let farm_income = req.annual_farm_income_ngn.unwrap_or(0.0);
        let off_farm = req.annual_off_farm_income_ngn.unwrap_or(0.0);
        let annual_income = farm_income + off_farm;
        let income_multiplier = if score >= 750 { 3.0 } else if score >= 680 { 2.5 } else if score >= 620 { 2.0 } else { 1.5 };
        let max_loan = (annual_income * income_multiplier).min(50_000_000.0); // Cap at ₦50M

        let risk_flags = self.compute_risk_flags(&req, score);

        let now = Utc::now();
        ScoreResponse {
            request_id: Uuid::new_v4().to_string(),
            farmer_id: req.farmer_id,
            score,
            score_band: band.to_string(),
            decision: decision.to_string(),
            interest_rate_premium_bps: premium_bps,
            max_loan_amount_ngn: max_loan,
            recommended_loan_term_months: if score >= 680 { 24 } else if score >= 620 { 18 } else { 12 },
            factors: ScoreFactors {
                repayment_history: repayment,
                farm_productivity: productivity,
                income_stability: income,
                collateral_quality: collateral,
                debt_to_income: dti,
                cooperative_membership: cooperative,
            },
            risk_flags,
            scored_at: now,
            valid_until: now + chrono::Duration::days(90),
            bureau_ref: format!("NEXCOM-CS-{}-{}", req.farmer_id, now.format("%Y%m%d")),
        }
    }
}

// ─── HTTP Handlers ────────────────────────────────────────────────────────────

#[post("/api/v1/score")]
async fn score_farmer(
    engine: web::Data<ScoringEngine>,
    req: web::Json<ScoreRequest>,
) -> impl Responder {
    info!(farmer_id = req.farmer_id, loan_amount = req.loan_amount_ngn, "Scoring request received");
    let result = engine.score(req.into_inner());
    info!(
        farmer_id = result.farmer_id,
        score = result.score,
        decision = %result.decision,
        "Score computed"
    );
    // Persist score to credit_scores table
    if let Some(ref pool) = engine.db {
        let farmer_id_val = result.farmer_id as i32;
        let score_val = result.score;
        let band_val = result.score_band.clone();
        let max_loan_val = result.max_loan_amount_ngn;
        let rate_val = result.interest_rate_premium_bps as f64 / 100.0;
        let factors_json = serde_json::to_value(&result.factors).unwrap_or(serde_json::Value::Null);
        let _ = sqlx::query(
            r#"INSERT INTO credit_scores (user_id, farmer_id, model, score, band, max_loan_ngn, interest_rate_pct, factors, valid_until, created_at, updated_at)
               VALUES (0, $1, 'NEXCOM_AGRI_V1', $2, $3, $4, $5, $6, NOW() + INTERVAL '90 days', NOW(), NOW())"#
        )
        .bind(farmer_id_val)
        .bind(score_val)
        .bind(band_val)
        .bind(max_loan_val)
        .bind(rate_val)
        .bind(factors_json)
        .execute(pool)
        .await;
    }
    HttpResponse::Ok().json(result)
}

#[get("/api/v1/score/{farmer_id}")]
async fn get_score(
    engine: web::Data<ScoringEngine>,
    farmer_id: web::Path<i64>,
) -> impl Responder {
    let fid = farmer_id.into_inner();
    // Query the credit_scores table for the most recent score for this farmer
    if let Some(ref pool) = engine.db {
        let row = sqlx::query!(
            r#"SELECT score, band, max_loan_ngn::float8 as max_loan_ngn,
                      interest_rate_pct::float8 as interest_rate_pct,
                      factors, valid_until, created_at
               FROM credit_scores
               WHERE farmer_id = $1
               ORDER BY created_at DESC
               LIMIT 1"#,
            fid as i32
        )
        .fetch_optional(pool)
        .await;
        match row {
            Ok(Some(r)) => {
                return HttpResponse::Ok().json(serde_json::json!({
                    "farmer_id": fid,
                    "score": r.score,
                    "band": r.band,
                    "max_loan_ngn": r.max_loan_ngn.unwrap_or(0.0),
                    "interest_rate_pct": r.interest_rate_pct.unwrap_or(0.0),
                    "factors": r.factors,
                    "valid_until": r.valid_until,
                    "created_at": r.created_at,
                }));
            }
            Ok(None) => {}
            Err(e) => {
                tracing::warn!("DB query for credit score failed: {}", e);
            }
        }
    }
    HttpResponse::NotFound().json(ErrorResponse {
        error: "No cached score found. Submit a scoring request first.".to_string(),
        code: "SCORE_NOT_FOUND".to_string(),
    })
}

#[get("/api/v1/bands")]
async fn get_bands() -> impl Responder {
    HttpResponse::Ok().json(serde_json::json!({
        "bands": [
            { "band": "EXCELLENT", "min": 750, "max": 850, "decision": "AUTO_APPROVE", "premium_bps": 0, "description": "Prime borrower — auto-approve at best rate" },
            { "band": "GOOD", "min": 680, "max": 749, "decision": "AUTO_APPROVE", "premium_bps": 100, "description": "Strong borrower — auto-approve at standard rate" },
            { "band": "FAIR", "min": 620, "max": 679, "decision": "APPROVE_WITH_CONDITIONS", "premium_bps": 200, "description": "Acceptable — approve with conditions and collateral" },
            { "band": "POOR", "min": 550, "max": 619, "decision": "MANUAL_REVIEW", "premium_bps": 400, "description": "High risk — manual review required" },
            { "band": "VERY_POOR", "min": 300, "max": 549, "decision": "DECLINE", "premium_bps": 0, "description": "Decline or require 150%+ collateral" }
        ],
        "factors": [
            { "name": "repayment_history", "weight": "35%", "max_points": 350 },
            { "name": "farm_productivity", "weight": "20%", "max_points": 200 },
            { "name": "income_stability", "weight": "15%", "max_points": 150 },
            { "name": "collateral_quality", "weight": "15%", "max_points": 150 },
            { "name": "debt_to_income", "weight": "10%", "max_points": 100 },
            { "name": "cooperative_membership", "weight": "5%", "max_points": 50 }
        ]
    }))
}

#[get("/health")]
async fn health() -> impl Responder {
    HttpResponse::Ok().json(HealthResponse {
        status: "ok".to_string(),
        service: "credit-scoring".to_string(),
        version: "1.0.0".to_string(),
        timestamp: Utc::now(),
    })
}

// ─── Tests ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    fn make_engine() -> ScoringEngine {
        ScoringEngine::new(Config::from_env())
    }

    fn excellent_farmer() -> ScoreRequest {
        ScoreRequest {
            farmer_id: 1,
            loan_amount_ngn: 1_000_000.0,
            loan_purpose: "Input financing".to_string(),
            loan_term_months: 12,
            total_loans_taken: Some(5),
            loans_repaid_on_time: Some(5),
            loans_defaulted: Some(0),
            loans_written_off: Some(0),
            days_past_due_avg: Some(0.0),
            farm_size_hectares: Some(25.0),
            years_farming: Some(12),
            crop_types_count: Some(4),
            avg_yield_tons_per_ha: Some(2.5),
            has_irrigation: Some(true),
            has_storage: Some(true),
            annual_farm_income_ngn: Some(3_000_000.0),
            annual_off_farm_income_ngn: Some(500_000.0),
            income_months_covered: Some(12),
            warehouse_receipt_value_ngn: Some(2_000_000.0),
            land_title_value_ngn: Some(5_000_000.0),
            equipment_value_ngn: Some(1_000_000.0),
            existing_loan_balance_ngn: Some(0.0),
            monthly_debt_payments_ngn: Some(0.0),
            cooperative_member: Some(true),
            cooperative_years: Some(7),
            cooperative_savings_ngn: Some(300_000.0),
        }
    }

    fn poor_farmer() -> ScoreRequest {
        ScoreRequest {
            farmer_id: 2,
            loan_amount_ngn: 5_000_000.0,
            loan_purpose: "Land expansion".to_string(),
            loan_term_months: 24,
            total_loans_taken: Some(3),
            loans_repaid_on_time: Some(1),
            loans_defaulted: Some(2),
            loans_written_off: Some(1),
            days_past_due_avg: Some(120.0),
            farm_size_hectares: Some(1.0),
            years_farming: Some(1),
            crop_types_count: Some(1),
            avg_yield_tons_per_ha: Some(0.5),
            has_irrigation: Some(false),
            has_storage: Some(false),
            annual_farm_income_ngn: Some(150_000.0),
            annual_off_farm_income_ngn: Some(0.0),
            income_months_covered: Some(3),
            warehouse_receipt_value_ngn: Some(0.0),
            land_title_value_ngn: Some(0.0),
            equipment_value_ngn: Some(0.0),
            existing_loan_balance_ngn: Some(500_000.0),
            monthly_debt_payments_ngn: Some(50_000.0),
            cooperative_member: Some(false),
            cooperative_years: None,
            cooperative_savings_ngn: None,
        }
    }

    #[test]
    fn test_excellent_farmer_scores_high() {
        let engine = make_engine();
        let result = engine.score(excellent_farmer());
        assert!(result.score >= 680, "Excellent farmer should score >= 680, got {}", result.score);
        assert_eq!(result.decision, "AUTO_APPROVE");
        assert!(result.risk_flags.is_empty(), "Excellent farmer should have no risk flags");
    }

    #[test]
    fn test_poor_farmer_scores_low() {
        let engine = make_engine();
        let result = engine.score(poor_farmer());
        assert!(result.score < 620, "Poor farmer should score < 620, got {}", result.score);
        assert!(result.risk_flags.contains(&"PRIOR_DEFAULT".to_string()));
        assert!(result.risk_flags.contains(&"PRIOR_WRITE_OFF".to_string()));
        assert!(result.risk_flags.contains(&"NO_COLLATERAL".to_string()));
    }

    #[test]
    fn test_score_range_is_valid() {
        let engine = make_engine();
        for _ in 0..10 {
            let result = engine.score(excellent_farmer());
            assert!(result.score >= 300 && result.score <= 850);
        }
    }

    #[test]
    fn test_no_history_gets_neutral_score() {
        let engine = make_engine();
        let mut req = excellent_farmer();
        req.total_loans_taken = Some(0);
        let result = engine.score(req);
        // Should still score reasonably due to other factors
        assert!(result.score >= 400);
    }

    #[test]
    fn test_repayment_history_max_350() {
        let engine = make_engine();
        let req = excellent_farmer();
        let factor = engine.score_repayment_history(&req);
        assert!(factor.score <= 350);
        assert!(factor.score >= 0);
    }

    #[test]
    fn test_collateral_coverage_ratio() {
        let engine = make_engine();
        let req = excellent_farmer();
        let factor = engine.score_collateral(&req, 1_000_000.0);
        // Total collateral = 8M, loan = 1M → 8x coverage → max score
        assert_eq!(factor.score, 150);
    }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

#[actix_web::main]
async fn main() -> std::io::Result<()> {
    // Load .env if present
    let _ = dotenvy::dotenv();

    // Initialize tracing
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::from_default_env()
                .add_directive("credit_scoring=info".parse().unwrap()),
        )
        .init();

    let config = Config::from_env();
    let port = config.port;
    info!("Starting NEXCOM Credit Scoring Engine on port {}", port);

    // Connect to PostgreSQL (non-fatal — scoring still works without DB persistence)
    let db_pool = sqlx::PgPool::connect(&config.db_url).await.ok();
    if db_pool.is_none() {
        tracing::warn!("PostgreSQL not available — score persistence disabled");
    }
    let engine = web::Data::new(if let Some(pool) = db_pool {
        ScoringEngine::with_db(config, pool)
    } else {
        ScoringEngine::new(config)
    });

    HttpServer::new(move || {
        let cors = Cors::default()
            .allow_any_origin()
            .allow_any_method()
            .allow_any_header()
            .max_age(3600);

        App::new()
            .wrap(cors)
            .wrap(middleware::Logger::default())
            .app_data(engine.clone())
            .service(health)
            .service(score_farmer)
            .service(get_score)
            .service(get_bands)
    })
    .bind(format!("0.0.0.0:{}", port))?
    .run()
    .await
}
