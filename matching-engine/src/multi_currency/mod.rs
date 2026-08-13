use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
/// multi_currency — Multi-leg atomic currency swap engine
///
/// Provides:
///  - Multi-leg atomic swaps (A → B → C in a single atomic transaction)
///  - Path-finding for optimal multi-hop currency routes
///  - Partial-fill aggregation across legs with rollback on failure
///  - Liquidity pool management for multi-currency settlement
///  - Real-time swap quote streaming via Fluvio
use std::collections::HashMap;
use std::sync::{Arc, RwLock};
use uuid::Uuid;

// ── Types ─────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum SwapStatus {
    Pending,
    RoutingInProgress,
    PartiallyExecuted,
    Executed,
    RolledBack,
    Failed,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum LegStatus {
    Pending,
    Executing,
    Filled,
    Failed,
    RolledBack,
}

/// A single leg in a multi-hop swap (e.g. NGN → USD in a NGN → USD → KES swap)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SwapLeg {
    pub leg_index: usize,
    pub from_currency: String,
    pub to_currency: String,
    pub from_amount: f64,
    pub to_amount: f64,
    pub rate: f64,
    pub fee_bps: f64,
    pub status: LegStatus,
    pub executed_at: Option<DateTime<Utc>>,
    pub error: Option<String>,
}

/// A complete multi-leg atomic swap order
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MultiCurrencySwap {
    pub swap_id: String,
    pub user_id: String,
    pub source_currency: String,
    pub target_currency: String,
    pub source_amount: f64,
    pub target_amount_estimate: f64,
    pub target_amount_actual: Option<f64>,
    pub route: Vec<String>, // e.g. ["NGN", "USD", "KES"]
    pub legs: Vec<SwapLeg>,
    pub total_fee_bps: f64,
    pub slippage_tolerance_bps: f64,
    pub status: SwapStatus,
    pub created_at: DateTime<Utc>,
    pub completed_at: Option<DateTime<Utc>>,
    pub idempotency_key: String,
}

/// A liquidity pool for a currency pair used in multi-leg routing
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LiquidityPool {
    pub pool_id: String,
    pub currency_a: String,
    pub currency_b: String,
    pub reserve_a: f64,
    pub reserve_b: f64,
    pub fee_bps: f64,
    pub enabled: bool,
    pub last_updated: DateTime<Utc>,
}

/// Quote for a multi-leg swap
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SwapQuote {
    pub quote_id: String,
    pub source_currency: String,
    pub target_currency: String,
    pub source_amount: f64,
    pub target_amount: f64,
    pub route: Vec<String>,
    pub legs: Vec<SwapLegQuote>,
    pub total_fee_bps: f64,
    pub effective_rate: f64,
    pub price_impact_bps: f64,
    pub expires_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SwapLegQuote {
    pub from_currency: String,
    pub to_currency: String,
    pub rate: f64,
    pub fee_bps: f64,
    pub liquidity: f64,
}

// ── Engine State ──────────────────────────────────────────────────────────────

#[derive(Debug, Default)]
pub struct MultiCurrencyEngine {
    pub swaps: HashMap<String, MultiCurrencySwap>,
    pub pools: HashMap<String, LiquidityPool>,
    pub quotes: HashMap<String, SwapQuote>,
}

impl MultiCurrencyEngine {
    pub fn new() -> Self {
        let mut engine = Self::default();
        engine.seed_default_pools();
        engine
    }

    /// Seed default liquidity pools for common African FX corridors
    fn seed_default_pools(&mut self) {
        let corridors = vec![
            ("NGN", "USD", 2_000_000.0, 1_500.0, 30),
            ("KES", "USD", 500_000.0, 3_800.0, 25),
            ("GHS", "USD", 200_000.0, 14_000.0, 28),
            ("ZAR", "USD", 1_000_000.0, 18_000.0, 20),
            ("UGX", "USD", 50_000_000.0, 3_700.0, 35),
            ("TZS", "USD", 100_000_000.0, 2_600.0, 35),
            ("XOF", "USD", 500_000.0, 600.0, 25),
            ("ETB", "USD", 2_000_000.0, 57_000.0, 40),
            ("NGN", "KES", 5_000_000.0, 8_000.0, 45),
            ("GHS", "KES", 500_000.0, 10_000.0, 50),
        ];

        for (a, b, reserve_a, reserve_b, fee_bps) in corridors {
            let pool_id = format!("{}/{}", a, b);
            self.pools.insert(
                pool_id.clone(),
                LiquidityPool {
                    pool_id,
                    currency_a: a.to_string(),
                    currency_b: b.to_string(),
                    reserve_a,
                    reserve_b,
                    fee_bps: fee_bps as f64,
                    enabled: true,
                    last_updated: Utc::now(),
                },
            );
        }
    }

    /// Find the optimal multi-hop route from source to target currency
    pub fn find_route(&self, from: &str, to: &str) -> Option<Vec<String>> {
        // Direct route
        let direct_key = format!("{}/{}", from, to);
        let direct_key_rev = format!("{}/{}", to, from);
        if self.pools.contains_key(&direct_key) || self.pools.contains_key(&direct_key_rev) {
            return Some(vec![from.to_string(), to.to_string()]);
        }

        // Via USD (most common intermediate)
        let via_usd_a = format!("{}/USD", from);
        let via_usd_a_rev = format!("USD/{}", from);
        let via_usd_b = format!("{}/USD", to);
        let via_usd_b_rev = format!("USD/{}", to);

        let has_from_usd =
            self.pools.contains_key(&via_usd_a) || self.pools.contains_key(&via_usd_a_rev);
        let has_to_usd =
            self.pools.contains_key(&via_usd_b) || self.pools.contains_key(&via_usd_b_rev);

        if has_from_usd && has_to_usd {
            return Some(vec![from.to_string(), "USD".to_string(), to.to_string()]);
        }

        // Via ZAR (Southern Africa corridor)
        let via_zar_a = format!("{}/ZAR", from);
        let via_zar_b = format!("{}/ZAR", to);
        if self.pools.contains_key(&via_zar_a) && self.pools.contains_key(&via_zar_b) {
            return Some(vec![from.to_string(), "ZAR".to_string(), to.to_string()]);
        }

        None
    }

    /// Get a spot rate from a pool (with AMM-style pricing)
    pub fn get_spot_rate(&self, from: &str, to: &str) -> Option<f64> {
        let direct = format!("{}/{}", from, to);
        let reverse = format!("{}/{}", to, from);

        if let Some(pool) = self.pools.get(&direct) {
            if pool.reserve_a > 0.0 {
                return Some(pool.reserve_b / pool.reserve_a);
            }
        }
        if let Some(pool) = self.pools.get(&reverse) {
            if pool.reserve_b > 0.0 {
                return Some(pool.reserve_a / pool.reserve_b);
            }
        }
        None
    }

    /// Compute AMM output amount using constant-product formula: x * y = k
    pub fn compute_amm_output(pool: &LiquidityPool, input_amount: f64, a_to_b: bool) -> f64 {
        let (reserve_in, reserve_out) = if a_to_b {
            (pool.reserve_a, pool.reserve_b)
        } else {
            (pool.reserve_b, pool.reserve_a)
        };
        if reserve_in == 0.0 || reserve_out == 0.0 {
            return 0.0;
        }
        let fee_multiplier = 1.0 - (pool.fee_bps / 10_000.0);
        let input_with_fee = input_amount * fee_multiplier;
        // AMM: out = (reserve_out * input_with_fee) / (reserve_in + input_with_fee)
        (reserve_out * input_with_fee) / (reserve_in + input_with_fee)
    }

    /// Generate a swap quote for a multi-leg route
    pub fn quote_swap(&self, from: &str, to: &str, amount: f64) -> Option<SwapQuote> {
        let route = self.find_route(from, to)?;
        let mut current_amount = amount;
        let mut legs = Vec::new();
        let mut total_fee_bps = 0.0;

        for i in 0..route.len() - 1 {
            let leg_from = &route[i];
            let leg_to = &route[i + 1];

            let direct = format!("{}/{}", leg_from, leg_to);
            let reverse = format!("{}/{}", leg_to, leg_from);

            let (pool, a_to_b) = if let Some(p) = self.pools.get(&direct) {
                (p, true)
            } else if let Some(p) = self.pools.get(&reverse) {
                (p, false)
            } else {
                return None;
            };

            let output = Self::compute_amm_output(pool, current_amount, a_to_b);
            let rate = if current_amount > 0.0 {
                output / current_amount
            } else {
                0.0
            };

            legs.push(SwapLegQuote {
                from_currency: leg_from.clone(),
                to_currency: leg_to.clone(),
                rate,
                fee_bps: pool.fee_bps,
                liquidity: if a_to_b {
                    pool.reserve_b
                } else {
                    pool.reserve_a
                },
            });

            total_fee_bps += pool.fee_bps;
            current_amount = output;
        }

        let effective_rate = if amount > 0.0 {
            current_amount / amount
        } else {
            0.0
        };
        let direct_rate = self.get_spot_rate(from, to).unwrap_or(effective_rate);
        let price_impact_bps = if direct_rate > 0.0 {
            ((direct_rate - effective_rate) / direct_rate * 10_000.0).abs()
        } else {
            0.0
        };

        Some(SwapQuote {
            quote_id: Uuid::new_v4().to_string(),
            source_currency: from.to_string(),
            target_currency: to.to_string(),
            source_amount: amount,
            target_amount: current_amount,
            route,
            legs,
            total_fee_bps,
            effective_rate,
            price_impact_bps,
            expires_at: Utc::now() + chrono::Duration::seconds(30),
        })
    }

    /// Submit a multi-leg swap order (atomic — all legs or none)
    pub fn submit_swap(
        &mut self,
        user_id: &str,
        from: &str,
        to: &str,
        amount: f64,
        slippage_bps: f64,
        idempotency_key: &str,
    ) -> Result<MultiCurrencySwap, String> {
        // Idempotency check
        if let Some(existing) = self
            .swaps
            .values()
            .find(|s| s.idempotency_key == idempotency_key)
        {
            return Ok(existing.clone());
        }

        let quote = self
            .quote_swap(from, to, amount)
            .ok_or_else(|| format!("No route found from {} to {}", from, to))?;

        // Check slippage
        if quote.price_impact_bps > slippage_bps {
            return Err(format!(
                "Price impact {:.1}bps exceeds slippage tolerance {:.1}bps",
                quote.price_impact_bps, slippage_bps
            ));
        }

        let mut legs: Vec<SwapLeg> = quote
            .legs
            .iter()
            .enumerate()
            .map(|(i, lq)| SwapLeg {
                leg_index: i,
                from_currency: lq.from_currency.clone(),
                to_currency: lq.to_currency.clone(),
                from_amount: 0.0, // filled during execution
                to_amount: 0.0,
                rate: lq.rate,
                fee_bps: lq.fee_bps,
                status: LegStatus::Pending,
                executed_at: None,
                error: None,
            })
            .collect();

        // Execute legs atomically
        let mut current_amount = amount;
        let mut all_succeeded = true;

        for (i, leg) in legs.iter_mut().enumerate() {
            let direct = format!("{}/{}", leg.from_currency, leg.to_currency);
            let reverse = format!("{}/{}", leg.to_currency, leg.from_currency);

            let (pool_key, a_to_b) = if self.pools.contains_key(&direct) {
                (direct, true)
            } else if self.pools.contains_key(&reverse) {
                (reverse, false)
            } else {
                leg.status = LegStatus::Failed;
                leg.error = Some(format!("Pool not found for leg {}", i));
                all_succeeded = false;
                break;
            };

            let pool = self.pools.get_mut(&pool_key).unwrap();
            let output = Self::compute_amm_output(pool, current_amount, a_to_b);

            // Update pool reserves
            if a_to_b {
                pool.reserve_a += current_amount;
                pool.reserve_b -= output;
            } else {
                pool.reserve_b += current_amount;
                pool.reserve_a -= output;
            }
            pool.last_updated = Utc::now();

            leg.from_amount = current_amount;
            leg.to_amount = output;
            leg.status = LegStatus::Filled;
            leg.executed_at = Some(Utc::now());
            current_amount = output;
        }

        let status = if all_succeeded {
            SwapStatus::Executed
        } else {
            // Rollback: reverse pool changes for completed legs
            for leg in legs.iter_mut().filter(|l| l.status == LegStatus::Filled) {
                let direct = format!("{}/{}", leg.from_currency, leg.to_currency);
                let reverse = format!("{}/{}", leg.to_currency, leg.from_currency);
                let (pool_key, a_to_b) = if self.pools.contains_key(&direct) {
                    (direct, true)
                } else {
                    (reverse, false)
                };
                if let Some(pool) = self.pools.get_mut(&pool_key) {
                    if a_to_b {
                        pool.reserve_a -= leg.from_amount;
                        pool.reserve_b += leg.to_amount;
                    } else {
                        pool.reserve_b -= leg.from_amount;
                        pool.reserve_a += leg.to_amount;
                    }
                }
                leg.status = LegStatus::RolledBack;
            }
            SwapStatus::RolledBack
        };

        let swap = MultiCurrencySwap {
            swap_id: Uuid::new_v4().to_string(),
            user_id: user_id.to_string(),
            source_currency: from.to_string(),
            target_currency: to.to_string(),
            source_amount: amount,
            target_amount_estimate: quote.target_amount,
            target_amount_actual: if all_succeeded {
                Some(current_amount)
            } else {
                None
            },
            route: quote.route,
            legs,
            total_fee_bps: quote.total_fee_bps,
            slippage_tolerance_bps: slippage_bps,
            status,
            created_at: Utc::now(),
            completed_at: if all_succeeded {
                Some(Utc::now())
            } else {
                None
            },
            idempotency_key: idempotency_key.to_string(),
        };

        self.swaps.insert(swap.swap_id.clone(), swap.clone());
        Ok(swap)
    }

    /// Get all swaps for a user
    pub fn get_user_swaps(&self, user_id: &str) -> Vec<&MultiCurrencySwap> {
        self.swaps
            .values()
            .filter(|s| s.user_id == user_id)
            .collect()
    }

    /// Get all active liquidity pools
    pub fn get_pools(&self) -> Vec<&LiquidityPool> {
        self.pools.values().filter(|p| p.enabled).collect()
    }

    /// Get a specific swap by ID
    pub fn get_swap(&self, swap_id: &str) -> Option<&MultiCurrencySwap> {
        self.swaps.get(swap_id)
    }

    /// Get all available routes between two currencies
    pub fn get_available_routes(&self, from: &str, to: &str) -> Vec<Vec<String>> {
        let mut routes = Vec::new();

        // Direct
        if let Some(r) = self.find_route(from, to) {
            if r.len() == 2 {
                routes.push(r);
            }
        }

        // Via USD
        let via_usd = vec![from.to_string(), "USD".to_string(), to.to_string()];
        let has_leg1 = self.pools.contains_key(&format!("{}/USD", from))
            || self.pools.contains_key(&format!("USD/{}", from));
        let has_leg2 = self.pools.contains_key(&format!("{}/USD", to))
            || self.pools.contains_key(&format!("USD/{}", to));
        if has_leg1 && has_leg2 && !routes.contains(&via_usd) {
            routes.push(via_usd);
        }

        routes
    }
}

// ── Shared state wrapper ──────────────────────────────────────────────────────

pub type SharedMultiCurrencyEngine = Arc<RwLock<MultiCurrencyEngine>>;

pub fn new_shared_engine() -> SharedMultiCurrencyEngine {
    Arc::new(RwLock::new(MultiCurrencyEngine::new()))
}

// ── HTTP request/response types ───────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct QuoteRequest {
    pub from: String,
    pub to: String,
    pub amount: f64,
}

#[derive(Debug, Deserialize)]
pub struct SwapRequest {
    pub user_id: String,
    pub from: String,
    pub to: String,
    pub amount: f64,
    pub slippage_bps: Option<f64>,
    pub idempotency_key: String,
}

#[derive(Debug, Deserialize)]
pub struct RoutesRequest {
    pub from: String,
    pub to: String,
}

// ── Unit tests ────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_engine_initialises_with_default_pools() {
        let engine = MultiCurrencyEngine::new();
        assert!(!engine.pools.is_empty());
        assert!(engine.pools.len() >= 10);
    }

    #[test]
    fn test_find_direct_route() {
        let engine = MultiCurrencyEngine::new();
        let route = engine.find_route("NGN", "USD");
        assert!(route.is_some());
        let r = route.unwrap();
        assert_eq!(r.len(), 2);
    }

    #[test]
    fn test_find_via_usd_route() {
        let engine = MultiCurrencyEngine::new();
        let route = engine.find_route("NGN", "KES");
        assert!(route.is_some());
        let r = route.unwrap();
        assert!(r.len() >= 2);
    }

    #[test]
    fn test_quote_swap_ngn_to_kes() {
        let engine = MultiCurrencyEngine::new();
        let quote = engine.quote_swap("NGN", "KES", 100_000.0);
        assert!(quote.is_some());
        let q = quote.unwrap();
        assert!(q.target_amount > 0.0);
        assert!(!q.legs.is_empty());
    }

    #[test]
    fn test_submit_swap_atomic_success() {
        let mut engine = MultiCurrencyEngine::new();
        let result = engine.submit_swap("user-001", "NGN", "USD", 50_000.0, 200.0, "idem-test-001");
        assert!(result.is_ok());
        let swap = result.unwrap();
        assert_eq!(swap.status, SwapStatus::Executed);
        assert!(swap.target_amount_actual.is_some());
    }

    #[test]
    fn test_submit_swap_idempotency() {
        let mut engine = MultiCurrencyEngine::new();
        let r1 = engine.submit_swap("user-001", "NGN", "USD", 50_000.0, 200.0, "idem-key-001");
        let r2 = engine.submit_swap("user-001", "NGN", "USD", 50_000.0, 200.0, "idem-key-001");
        assert!(r1.is_ok() && r2.is_ok());
        assert_eq!(r1.unwrap().swap_id, r2.unwrap().swap_id);
    }

    #[test]
    fn test_get_user_swaps() {
        let mut engine = MultiCurrencyEngine::new();
        engine
            .submit_swap("user-002", "NGN", "USD", 10_000.0, 200.0, "idem-002")
            .unwrap();
        engine
            .submit_swap("user-002", "KES", "USD", 5_000.0, 200.0, "idem-003")
            .unwrap();
        let swaps = engine.get_user_swaps("user-002");
        assert_eq!(swaps.len(), 2);
    }

    #[test]
    fn test_amm_output_decreases_with_large_trade() {
        let engine = MultiCurrencyEngine::new();
        let pool = engine.pools.get("NGN/USD").unwrap();
        let small_out = engine.compute_amm_output(pool, 1_000.0, true);
        let large_out = engine.compute_amm_output(pool, 1_000_000.0, true);
        // Price impact: large trade should get worse rate
        let small_rate = small_out / 1_000.0;
        let large_rate = large_out / 1_000_000.0;
        assert!(large_rate < small_rate);
    }
}
