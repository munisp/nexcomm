/**
 * NEXCOM Exchange — Forecast Router (INNOV-A / Innovation 2)
 *
 * ML price forecasts backed by the ml-platform serving API
 * (POST {ML_PLATFORM_URL}/v1/predict/price, PriceRequest {symbol, horizon}).
 *
 * Honesty contract:
 *  - 800ms timeout: on timeout/error the procedures return status "UNAVAILABLE"
 *    instead of throwing or fabricating numbers.
 *  - No history is fabricated here: historical closes come from the existing
 *    commodities.priceHistory / livePrices sources; this router only projects
 *    forward from the model's expected_log_return / return_std.
 *  - smartAlertCheck() is an internal helper consumed by the priceAlerts
 *    polling job to attach forecast context to triggered alerts.
 */
import { z } from "zod";
import { publicProcedure, router } from "../_core/trpc";

const ML_PLATFORM_URL = (process.env.ML_PLATFORM_URL ?? "http://localhost:8015").replace(/\/$/, "");
const FORECAST_TIMEOUT_MS = 800;

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PriceForecast {
  symbol: string;
  horizonDays: number;
  /** Model-projected price at the horizon (null when model has no last close). */
  expectedPrice: number | null;
  /** Last authoritative close the model saw (null = cold start). */
  lastClose: number | null;
  /** 95% confidence interval [lo, hi] at the horizon. */
  ci95: [number, number] | null;
  /** Per-day expected log return. */
  expectedLogReturn: number;
  /** Per-day return standard deviation. */
  returnStd: number;
  modelVersion: string;
  variant?: string;
  bucket?: string;
}

export type ForecastResult =
  | { status: "OK"; forecast: PriceForecast }
  | { status: "UNAVAILABLE"; reason: string };

export interface SmartAlertContext {
  available: boolean;
  symbol: string;
  horizonDays: number;
  expectedPrice?: number;
  ci95?: [number, number];
  modelVersion?: string;
  /** Plain-language assessment of whether the target is inside the band. */
  assessment?: string;
}

// ─── ml-platform client ───────────────────────────────────────────────────────

interface MlPriceResponse {
  symbol: string;
  horizon_days: number;
  expected_log_return: number;
  return_std: number;
  last_close: number | null;
  expected_price: number | null;
  confidence_interval_95: [number, number] | null;
  model_version?: string;
  variant?: string;
  bucket?: string;
}

/**
 * Fetch a price forecast from ml-platform. Returns null on any failure
 * (timeout, non-2xx, cold model) — callers must surface UNAVAILABLE honestly.
 */
export async function fetchPriceForecast(
  symbol: string,
  horizonDays: number,
): Promise<PriceForecast | null> {
  try {
    const res = await fetch(`${ML_PLATFORM_URL}/v1/predict/price`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ symbol, horizon: horizonDays }),
      signal: AbortSignal.timeout(FORECAST_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as MlPriceResponse;
    if (typeof data.expected_log_return !== "number") return null;
    return {
      symbol: data.symbol ?? symbol,
      horizonDays: data.horizon_days ?? horizonDays,
      expectedPrice: data.expected_price,
      lastClose: data.last_close,
      ci95: Array.isArray(data.confidence_interval_95)
        ? [Number(data.confidence_interval_95[0]), Number(data.confidence_interval_95[1])]
        : null,
      expectedLogReturn: data.expected_log_return,
      returnStd: data.return_std,
      modelVersion: data.model_version ?? "unknown",
      variant: data.variant,
      bucket: data.bucket,
    };
  } catch {
    return null; // timeout / network / JSON error
  }
}

/**
 * Project the expected path and 95% band day-by-day from the model's per-day
 * log-return distribution:  mid_t = S0·e^(μt),  band_t = S0·e^(μt ± 1.96σ√t).
 * This is pure math on real model outputs — no fabricated history.
 */
export function projectBand(forecast: PriceForecast): Array<{
  day: number;
  expected: number;
  lo: number;
  hi: number;
}> {
  const { lastClose, expectedLogReturn: mu, returnStd: sigma, horizonDays } = forecast;
  if (lastClose == null || lastClose <= 0) return [];
  const points: Array<{ day: number; expected: number; lo: number; hi: number }> = [];
  for (let t = 0; t <= horizonDays; t++) {
    const spread = 1.96 * sigma * Math.sqrt(Math.max(t, 1));
    points.push({
      day: t,
      expected: lastClose * Math.exp(mu * t),
      lo: lastClose * Math.exp(mu * t - spread),
      hi: lastClose * Math.exp(mu * t + spread),
    });
  }
  return points;
}

/**
 * smartAlertCheck — internal helper for the priceAlerts polling job.
 * When a user's alert triggers, assess whether the model's projected band
 * already contains the target (i.e. the cross was "expected") or whether the
 * move overshot the model's expectation.
 */
export async function smartAlertCheck(
  symbol: string,
  targetPrice: number,
  condition: string,
  horizonDays = 7,
): Promise<SmartAlertContext> {
  const base: SmartAlertContext = { available: false, symbol, horizonDays };
  const f = await fetchPriceForecast(symbol, horizonDays);
  if (!f || f.expectedPrice == null || !f.ci95 || f.lastClose == null) return base;

  const [lo, hi] = f.ci95;
  const directionUp = condition === "ABOVE" || condition === "CROSS_ABOVE";
  let assessment: string;
  if (targetPrice >= lo && targetPrice <= hi) {
    assessment = `Within the model's ${horizonDays}d 95% band (${lo.toFixed(2)}–${hi.toFixed(2)}); the cross was inside the expected range.`;
  } else if (directionUp && targetPrice > hi) {
    assessment = `Target is ABOVE the model's ${horizonDays}d 95% band top (${hi.toFixed(2)}); the move overshot model expectations.`;
  } else if (!directionUp && targetPrice < lo) {
    assessment = `Target is BELOW the model's ${horizonDays}d 95% band floor (${lo.toFixed(2)}); the move overshot model expectations.`;
  } else {
    assessment = `Target sits outside the direction of the model's ${horizonDays}d drift (expected ${f.expectedPrice.toFixed(2)}).`;
  }

  return {
    available: true,
    symbol,
    horizonDays,
    expectedPrice: f.expectedPrice,
    ci95: f.ci95,
    modelVersion: f.modelVersion,
    assessment,
  };
}

// ─── Router ───────────────────────────────────────────────────────────────────

export const forecastRouter = router({
  /**
   * Get an ML price forecast for a commodity.
   * Returns status "UNAVAILABLE" (never fabricated numbers) when ml-platform
   * is unreachable, times out (>800ms), or has no model for the symbol.
   */
  getForecast: publicProcedure
    .input(
      z.object({
        commodity: z.string().min(1).max(32).trim(),
        horizonDays: z.number().int().min(1).max(30).default(7),
      }),
    )
    .query(async ({ input }): Promise<ForecastResult> => {
      const forecast = await fetchPriceForecast(input.commodity, input.horizonDays);
      if (!forecast) {
        return {
          status: "UNAVAILABLE",
          reason:
            "ML forecast service is unavailable or has no trained model for this symbol (800ms timeout exceeded or cold start).",
        };
      }
      if (forecast.lastClose == null || forecast.expectedPrice == null || !forecast.ci95) {
        return {
          status: "UNAVAILABLE",
          reason:
            "Model is cold for this symbol (no last close available) — forecast cannot be computed yet.",
        };
      }
      return { status: "OK", forecast };
    }),

  /**
   * Projected path + 95% band for charting (pure math over the real model
   * outputs; historical closes are supplied separately by commodities.priceHistory).
   */
  getBand: publicProcedure
    .input(
      z.object({
        commodity: z.string().min(1).max(32).trim(),
        horizonDays: z.number().int().min(1).max(30).default(7),
      }),
    )
    .query(async ({ input }) => {
      const forecast = await fetchPriceForecast(input.commodity, input.horizonDays);
      if (!forecast || forecast.lastClose == null) {
        return {
          status: "UNAVAILABLE" as const,
          reason: "Forecast unavailable (ml-platform timeout or cold model).",
          band: [] as Array<{ day: number; expected: number; lo: number; hi: number }>,
        };
      }
      return {
        status: "OK" as const,
        band: projectBand(forecast),
        modelVersion: forecast.modelVersion,
      };
    }),

  /**
   * Forecast context for a hypothetical/existing alert — used by the alerts UI
   * and by the polling job (via smartAlertCheck) when an alert triggers.
   */
  alertContext: publicProcedure
    .input(
      z.object({
        symbol: z.string().min(1).max(32).trim(),
        targetPrice: z.number().positive(),
        condition: z.enum(["ABOVE", "BELOW", "CROSS_ABOVE", "CROSS_BELOW"]),
        horizonDays: z.number().int().min(1).max(30).default(7),
      }),
    )
    .query(async ({ input }) => {
      return smartAlertCheck(input.symbol, input.targetPrice, input.condition, input.horizonDays);
    }),
});
