//! Options pricing and trading engine.
//! Implements Black-76 model for options on futures, with Greeks calculation.
#![allow(dead_code)]

use crate::types::*;
use chrono::Utc;
use dashmap::DashMap;
use std::f64::consts::{E, PI};
use tracing::info;

/// Standard normal cumulative distribution function (approximation).
fn norm_cdf(x: f64) -> f64 {
    let a1 = 0.254829592;
    let a2 = -0.284496736;
    let a3 = 1.421413741;
    let a4 = -1.453152027;
    let a5 = 1.061405429;
    let p = 0.3275911;

    let sign = if x < 0.0 { -1.0 } else { 1.0 };
    let x_abs = x.abs() / (2.0_f64).sqrt();
    let t = 1.0 / (1.0 + p * x_abs);
    let y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * E.powf(-x_abs * x_abs);

    0.5 * (1.0 + sign * y)
}

/// Standard normal probability density function.
fn norm_pdf(x: f64) -> f64 {
    (-(x * x) / 2.0).exp() / (2.0 * PI).sqrt()
}

/// Black-76 model for pricing options on futures.
pub struct Black76;

impl Black76 {
    /// Calculate option price using Black-76 model.
    /// F = futures price, K = strike price, T = time to expiry (years),
    /// r = risk-free rate, sigma = implied volatility.
    pub fn price(
        option_type: OptionType,
        f: f64,
        k: f64,
        t: f64,
        r: f64,
        sigma: f64,
    ) -> f64 {
        if t <= 0.0 {
            // At expiry: intrinsic value
            return match option_type {
                OptionType::Call => (f - k).max(0.0),
                OptionType::Put => (k - f).max(0.0),
            };
        }

        let d1 = ((f / k).ln() + 0.5 * sigma * sigma * t) / (sigma * t.sqrt());
        let d2 = d1 - sigma * t.sqrt();
        let discount = (-r * t).exp();

        match option_type {
            OptionType::Call => discount * (f * norm_cdf(d1) - k * norm_cdf(d2)),
            OptionType::Put => discount * (k * norm_cdf(-d2) - f * norm_cdf(-d1)),
        }
    }

    /// Calculate all Greeks.
    pub fn greeks(
        option_type: OptionType,
        f: f64,
        k: f64,
        t: f64,
        r: f64,
        sigma: f64,
    ) -> Greeks {
        if t <= 0.0 {
            return Greeks {
                delta: match option_type {
                    OptionType::Call => if f > k { 1.0 } else { 0.0 },
                    OptionType::Put => if f < k { -1.0 } else { 0.0 },
                },
                gamma: 0.0,
                theta: 0.0,
                vega: 0.0,
                rho: 0.0,
                implied_vol: 0.0,
            };
        }

        let d1 = ((f / k).ln() + 0.5 * sigma * sigma * t) / (sigma * t.sqrt());
        let d2 = d1 - sigma * t.sqrt();
        let discount = (-r * t).exp();

        let delta = match option_type {
            OptionType::Call => discount * norm_cdf(d1),
            OptionType::Put => -discount * norm_cdf(-d1),
        };

        let gamma = discount * norm_pdf(d1) / (f * sigma * t.sqrt());

        let theta = {
            let term1 = -(f * sigma * norm_pdf(d1)) / (2.0 * t.sqrt());
            match option_type {
                OptionType::Call => {
                    discount * (term1 - r * f * norm_cdf(d1) + r * k * norm_cdf(d2)) / 365.0
                }
                OptionType::Put => {
                    discount * (term1 + r * f * norm_cdf(-d1) - r * k * norm_cdf(-d2)) / 365.0
                }
            }
        };

        let vega = f * discount * norm_pdf(d1) * t.sqrt() / 100.0;

        let rho = match option_type {
            OptionType::Call => -t * discount * (f * norm_cdf(d1) - k * norm_cdf(d2)) / 100.0,
            OptionType::Put => -t * discount * (k * norm_cdf(-d2) - f * norm_cdf(-d1)) / 100.0,
        };

        Greeks {
            delta,
            gamma,
            theta,
            vega,
            rho,
            implied_vol: sigma,
        }
    }

    /// Calculate implied volatility using Newton-Raphson method.
    pub fn implied_vol(
        option_type: OptionType,
        market_price: f64,
        f: f64,
        k: f64,
        t: f64,
        r: f64,
    ) -> f64 {
        let mut sigma = 0.3; // Initial guess
        let tolerance = 1e-6;
        let max_iterations = 100;

        for _ in 0..max_iterations {
            let price = Self::price(option_type, f, k, t, r, sigma);
            let diff = price - market_price;

            if diff.abs() < tolerance {
                return sigma;
            }

            // Vega for Newton step (not divided by 100)
            let d1 = ((f / k).ln() + 0.5 * sigma * sigma * t) / (sigma * t.sqrt());
            let discount = (-r * t).exp();
            let vega = f * discount * norm_pdf(d1) * t.sqrt();

            if vega.abs() < 1e-12 {
                break;
            }

            sigma -= diff / vega;
            sigma = sigma.max(0.001).min(5.0); // Clamp
        }

        sigma
    }
}

/// Manages options contracts and pricing.
pub struct OptionsManager {
    /// Active options contracts by symbol.
    contracts: DashMap<String, OptionsContract>,
    /// Cached Greeks by symbol.
    greeks_cache: DashMap<String, Greeks>,
    /// Risk-free rate.
    risk_free_rate: f64,
}

impl OptionsManager {
    pub fn new(risk_free_rate: f64) -> Self {
        Self {
            contracts: DashMap::new(),
            greeks_cache: DashMap::new(),
            risk_free_rate,
        }
    }

    /// List an options contract on a futures contract.
    pub fn list_option(
        &self,
        underlying_future: &str,
        option_type: OptionType,
        option_style: OptionStyle,
        strike_price: f64,
        expiry_date: chrono::DateTime<Utc>,
        contract_size: Qty,
    ) -> OptionsContract {
        let type_code = match option_type {
            OptionType::Call => "C",
            OptionType::Put => "P",
        };
        let symbol = format!(
            "{}-{}-{}",
            underlying_future,
            type_code,
            strike_price as i64
        );

        let contract = OptionsContract {
            symbol: symbol.clone(),
            underlying_future: underlying_future.to_string(),
            option_type,
            option_style,
            strike_price: to_price(strike_price),
            contract_size,
            tick_size: to_price(0.01),
            expiry_date,
            premium: 0,
            status: ContractStatus::Active,
        };

        info!("Listed option: {}", symbol);
        self.contracts.insert(symbol, contract.clone());
        contract
    }

    /// Generate a full option chain for a futures contract.
    pub fn generate_chain(
        &self,
        underlying_future: &str,
        current_price: f64,
        expiry_date: chrono::DateTime<Utc>,
        contract_size: Qty,
        num_strikes: usize,
        strike_interval: f64,
    ) -> Vec<OptionsContract> {
        let mut chain = Vec::new();
        let center = (current_price / strike_interval).round() * strike_interval;

        for i in 0..num_strikes {
            let offset = (i as f64 - num_strikes as f64 / 2.0) * strike_interval;
            let strike = center + offset;
            if strike <= 0.0 {
                continue;
            }

            for opt_type in [OptionType::Call, OptionType::Put] {
                let contract = self.list_option(
                    underlying_future,
                    opt_type,
                    OptionStyle::European,
                    strike,
                    expiry_date,
                    contract_size,
                );
                chain.push(contract);
            }
        }

        info!(
            "Generated option chain for {}: {} contracts",
            underlying_future,
            chain.len()
        );
        chain
    }

    /// Price an option and update its Greeks.
    pub fn price_option(
        &self,
        symbol: &str,
        futures_price: f64,
        volatility: f64,
    ) -> Option<(f64, Greeks)> {
        let contract = self.contracts.get(symbol)?;
        let strike = from_price(contract.strike_price);
        let now = Utc::now();
        let t = (contract.expiry_date - now).num_seconds() as f64 / (365.25 * 24.0 * 3600.0);

        let price =
            Black76::price(contract.option_type, futures_price, strike, t, self.risk_free_rate, volatility);
        let greeks =
            Black76::greeks(contract.option_type, futures_price, strike, t, self.risk_free_rate, volatility);

        self.greeks_cache.insert(symbol.to_string(), greeks.clone());

        Some((price, greeks))
    }

    /// Get all active options for an underlying future.
    pub fn options_for_underlying(&self, underlying_future: &str) -> Vec<OptionsContract> {
        self.contracts
            .iter()
            .filter(|r| r.value().underlying_future == underlying_future)
            .map(|r| r.value().clone())
            .collect()
    }

    /// Get cached Greeks for an option.
    pub fn get_greeks(&self, symbol: &str) -> Option<Greeks> {
        self.greeks_cache.get(symbol).map(|r| r.value().clone())
    }

    /// Get all active options contracts.
    pub fn active_contracts(&self) -> Vec<OptionsContract> {
        self.contracts
            .iter()
            .filter(|r| r.value().status == ContractStatus::Active)
            .map(|r| r.value().clone())
            .collect()
    }
}

impl Default for OptionsManager {
    fn default() -> Self {
        Self::new(0.05)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_black76_call_price() {
        // F=100, K=100, T=1, r=5%, sigma=20% => ATM call
        let price = Black76::price(OptionType::Call, 100.0, 100.0, 1.0, 0.05, 0.20);
        assert!(price > 7.0 && price < 8.5, "ATM call price: {}", price);
    }

    #[test]
    fn test_black76_put_price() {
        let price = Black76::price(OptionType::Put, 100.0, 100.0, 1.0, 0.05, 0.20);
        assert!(price > 7.0 && price < 8.5, "ATM put price: {}", price);
    }

    #[test]
    fn test_put_call_parity() {
        let f = 100.0;
        let k = 100.0;
        let t = 1.0;
        let r = 0.05;
        let sigma = 0.25;

        let call = Black76::price(OptionType::Call, f, k, t, r, sigma);
        let put = Black76::price(OptionType::Put, f, k, t, r, sigma);
        let discount = (-r * t).exp();

        // Put-call parity: C - P = e^(-rT) * (F - K)
        let diff = (call - put) - discount * (f - k);
        assert!(diff.abs() < 0.01, "Put-call parity violation: {}", diff);
    }

    #[test]
    fn test_greeks_delta() {
        let greeks = Black76::greeks(OptionType::Call, 100.0, 100.0, 1.0, 0.05, 0.20);
        // ATM call delta should be around 0.5
        assert!(
            greeks.delta > 0.4 && greeks.delta < 0.6,
            "Delta: {}",
            greeks.delta
        );
    }

    #[test]
    fn test_implied_vol() {
        let target_vol = 0.25;
        let price = Black76::price(OptionType::Call, 100.0, 100.0, 1.0, 0.05, target_vol);
        let iv = Black76::implied_vol(OptionType::Call, price, 100.0, 100.0, 1.0, 0.05);
        assert!(
            (iv - target_vol).abs() < 0.001,
            "IV: {} vs target: {}",
            iv,
            target_vol
        );
    }

    #[test]
    fn test_deep_itm_call() {
        let price = Black76::price(OptionType::Call, 150.0, 100.0, 1.0, 0.05, 0.20);
        // Deep ITM call should be close to intrinsic value discounted
        let intrinsic = (150.0 - 100.0) * (-0.05_f64).exp();
        assert!(price >= intrinsic * 0.99, "Deep ITM: {} vs intrinsic: {}", price, intrinsic);
    }
}
