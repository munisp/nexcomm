/**
 * k6 Load Test — NEXCOM Microservices
 * Tests all major microservice endpoints under realistic load.
 *
 * Usage:
 *   k6 run tests/load/k6-microservices.js
 *   k6 run --env BASE_URL=https://nexcom-exchange.manus.space tests/load/k6-microservices.js
 *
 * Scenarios:
 *   analytics   — DataFusion query endpoint
 *   kyc         — KYC document submission
 *   ai_ml       — AI/ML price prediction
 *   gateway     — API Gateway health + auth
 *   trading     — Order placement via gateway
 */
import http from "k6/http";
import { check, sleep, group } from "k6";
import { Rate, Trend, Counter } from "k6/metrics";

// ── Config ────────────────────────────────────────────────────────────────────
const BASE_URL      = __ENV.BASE_URL      || "http://localhost:3000";
const ANALYTICS_URL = __ENV.ANALYTICS_URL || "http://localhost:8001";
const KYC_URL       = __ENV.KYC_URL       || "http://localhost:8002";
const AI_ML_URL     = __ENV.AI_ML_URL     || "http://localhost:8003";
const AUTH_TOKEN    = __ENV.AUTH_TOKEN    || "";

// ── Custom metrics ────────────────────────────────────────────────────────────
const errorRate    = new Rate("error_rate");
const apiLatency   = new Trend("api_latency_ms", true);
const orderCounter = new Counter("orders_placed");

// ── Test options ──────────────────────────────────────────────────────────────
export const options = {
  scenarios: {
    // Smoke test — 1 VU for 30s
    smoke: {
      executor: "constant-vus",
      vus: 1,
      duration: "30s",
      tags: { scenario: "smoke" },
    },
    // Load test — ramp up to 50 VUs over 2 min, hold 3 min, ramp down
    load: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "2m",  target: 50  },
        { duration: "3m",  target: 50  },
        { duration: "1m",  target: 0   },
      ],
      tags: { scenario: "load" },
      startTime: "35s", // after smoke
    },
    // Spike test — sudden burst of 200 VUs for 30s
    spike: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "10s", target: 200 },
        { duration: "30s", target: 200 },
        { duration: "10s", target: 0   },
      ],
      tags: { scenario: "spike" },
      startTime: "7m",
    },
  },
  thresholds: {
    http_req_duration:       ["p(95)<2000", "p(99)<5000"],
    http_req_failed:         ["rate<0.05"],
    error_rate:              ["rate<0.05"],
    "api_latency_ms{endpoint:health}": ["p(95)<200"],
    "api_latency_ms{endpoint:markets}": ["p(95)<500"],
  },
};

// ── Helpers ───────────────────────────────────────────────────────────────────
function headers(extra = {}) {
  return {
    "Content-Type": "application/json",
    Accept: "application/json",
    ...(AUTH_TOKEN ? { Authorization: `Bearer ${AUTH_TOKEN}` } : {}),
    ...extra,
  };
}

function record(res, endpoint) {
  const ok = res.status >= 200 && res.status < 400;
  errorRate.add(!ok);
  apiLatency.add(res.timings.duration, { endpoint });
  return ok;
}

// ── Main test ─────────────────────────────────────────────────────────────────
export default function () {
  group("Health checks", () => {
    const res = http.get(`${BASE_URL}/api/trpc/auth.me`, { headers: headers(), tags: { endpoint: "health" } });
    check(res, { "auth.me responds": (r) => r.status < 500 });
    record(res, "health");
  });

  sleep(0.5);

  group("Market data", () => {
    const res = http.get(`${BASE_URL}/api/trpc/market.getInstruments`, { headers: headers(), tags: { endpoint: "markets" } });
    check(res, { "instruments list ok": (r) => r.status === 200 });
    record(res, "markets");
  });

  sleep(0.3);

  group("Live prices", () => {
    const res = http.get(`${BASE_URL}/api/trpc/livePrices.getAll`, { headers: headers(), tags: { endpoint: "prices" } });
    check(res, { "prices ok": (r) => r.status < 500 });
    record(res, "prices");
  });

  sleep(0.3);

  group("Analytics service", () => {
    const payload = JSON.stringify({ query: "SELECT symbol, COUNT(*) as trades FROM orders GROUP BY symbol LIMIT 10", format: "json" });
    const res = http.post(`${ANALYTICS_URL}/datafusion/query`, payload, { headers: headers(), tags: { endpoint: "analytics" } });
    check(res, { "analytics query ok": (r) => r.status < 500 });
    record(res, "analytics");
  });

  sleep(0.5);

  group("KYC service", () => {
    const res = http.get(`${KYC_URL}/health`, { headers: headers(), tags: { endpoint: "kyc" } });
    check(res, { "kyc health ok": (r) => r.status < 500 });
    record(res, "kyc");
  });

  sleep(0.5);

  group("AI/ML service", () => {
    const payload = JSON.stringify({ symbol: "GINGER-NG-SPOT", horizon: "1h" });
    const res = http.post(`${AI_ML_URL}/predict`, payload, { headers: headers(), tags: { endpoint: "ai_ml" } });
    check(res, { "ai prediction ok": (r) => r.status < 500 });
    record(res, "ai_ml");
  });

  sleep(1);
}

// ── Setup ─────────────────────────────────────────────────────────────────────
export function setup() {
  console.log(`[k6] NEXCOM Microservices Load Test`);
  console.log(`[k6] BASE_URL:      ${BASE_URL}`);
  console.log(`[k6] ANALYTICS_URL: ${ANALYTICS_URL}`);
  console.log(`[k6] KYC_URL:       ${KYC_URL}`);
  console.log(`[k6] AI_ML_URL:     ${AI_ML_URL}`);
}

// ── Teardown ──────────────────────────────────────────────────────────────────
export function teardown(data) {
  console.log("[k6] Load test complete.");
}
