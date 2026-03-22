/**
 * NEXCOM Exchange - k6 Load Test Suite
 *
 * Tests gateway API endpoints under load.
 * Run: k6 run tests/load/k6-gateway.js
 *
 * Scenarios:
 *   - smoke: 1 VU, 30s (sanity check)
 *   - load: ramp to 50 VUs over 5m
 *   - stress: ramp to 200 VUs over 10m
 */

import http from "k6/http";
import { check, sleep, group } from "k6";
import { Rate, Trend, Counter } from "k6/metrics";

// Custom metrics
const errorRate = new Rate("errors");
const orderLatency = new Trend("order_latency", true);
const marketDataLatency = new Trend("market_data_latency", true);
const requestCount = new Counter("total_requests");

// Configuration
const BASE_URL = __ENV.BASE_URL || "http://localhost:8080";
const API = `${BASE_URL}/api/v1`;
const AUTH_TOKEN = __ENV.AUTH_TOKEN || "demo-token";

const headers = {
  "Content-Type": "application/json",
  Authorization: `Bearer ${AUTH_TOKEN}`,
};

// Scenarios
export const options = {
  scenarios: {
    smoke: {
      executor: "constant-vus",
      vus: 1,
      duration: "30s",
      tags: { scenario: "smoke" },
    },
    load: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "1m", target: 10 },
        { duration: "3m", target: 50 },
        { duration: "1m", target: 0 },
      ],
      startTime: "35s",
      tags: { scenario: "load" },
    },
    stress: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "2m", target: 50 },
        { duration: "3m", target: 200 },
        { duration: "2m", target: 200 },
        { duration: "3m", target: 0 },
      ],
      startTime: "6m",
      tags: { scenario: "stress" },
    },
  },
  thresholds: {
    http_req_duration: ["p(95)<500", "p(99)<1000"],
    errors: ["rate<0.05"],
    order_latency: ["p(95)<300"],
    market_data_latency: ["p(95)<200"],
  },
};

// ─── Test Functions ──────────────────────────────────────────────────────────

export default function () {
  group("Health Check", () => {
    const res = http.get(`${BASE_URL}/health`);
    requestCount.add(1);
    check(res, {
      "health status 200": (r) => r.status === 200,
      "health body contains healthy": (r) =>
        r.json("data.status") === "healthy",
    }) || errorRate.add(1);
  });

  group("Markets", () => {
    // List markets
    const marketsRes = http.get(`${API}/markets`, { headers });
    requestCount.add(1);
    marketDataLatency.add(marketsRes.timings.duration);
    check(marketsRes, {
      "markets status 200": (r) => r.status === 200,
      "markets has commodities": (r) => r.json("data.commodities") !== null,
    }) || errorRate.add(1);

    // Get ticker
    const tickerRes = http.get(`${API}/markets/GOLD/ticker`, { headers });
    requestCount.add(1);
    marketDataLatency.add(tickerRes.timings.duration);
    check(tickerRes, {
      "ticker status 200": (r) => r.status === 200,
    }) || errorRate.add(1);

    // Get orderbook
    const bookRes = http.get(`${API}/markets/GOLD/orderbook`, { headers });
    requestCount.add(1);
    marketDataLatency.add(bookRes.timings.duration);
    check(bookRes, {
      "orderbook status 200": (r) => r.status === 200,
    }) || errorRate.add(1);

    // Get candles
    const candlesRes = http.get(
      `${API}/markets/GOLD/candles?interval=1h`,
      { headers }
    );
    requestCount.add(1);
    check(candlesRes, {
      "candles status 200": (r) => r.status === 200,
    }) || errorRate.add(1);
  });

  group("Orders CRUD", () => {
    // Create order
    const orderPayload = JSON.stringify({
      symbol: "GOLD-FUT-2026M06",
      side: "BUY",
      type: "LIMIT",
      time_in_force: "DAY",
      price: 1950.0,
      quantity: 10,
    });

    const createRes = http.post(`${API}/orders`, orderPayload, { headers });
    requestCount.add(1);
    orderLatency.add(createRes.timings.duration);
    check(createRes, {
      "create order status 2xx": (r) =>
        r.status >= 200 && r.status < 300,
    }) || errorRate.add(1);

    // List orders
    const listRes = http.get(`${API}/orders`, { headers });
    requestCount.add(1);
    check(listRes, {
      "list orders status 200": (r) => r.status === 200,
    }) || errorRate.add(1);

    // Get single order
    if (createRes.status === 201 || createRes.status === 200) {
      const orderId = createRes.json("data.id") || "test-order-1";
      const getRes = http.get(`${API}/orders/${orderId}`, { headers });
      requestCount.add(1);
      check(getRes, {
        "get order status 200": (r) => r.status === 200,
      }) || errorRate.add(1);

      // Cancel order
      const cancelRes = http.del(`${API}/orders/${orderId}`, null, {
        headers,
      });
      requestCount.add(1);
      check(cancelRes, {
        "cancel order status 200": (r) => r.status === 200,
      }) || errorRate.add(1);
    }
  });

  group("Portfolio", () => {
    const portfolioRes = http.get(`${API}/portfolio`, { headers });
    requestCount.add(1);
    check(portfolioRes, {
      "portfolio status 200": (r) => r.status === 200,
    }) || errorRate.add(1);

    const positionsRes = http.get(`${API}/portfolio/positions`, { headers });
    requestCount.add(1);
    check(positionsRes, {
      "positions status 200": (r) => r.status === 200,
    }) || errorRate.add(1);
  });

  group("Alerts", () => {
    // Create alert
    const alertPayload = JSON.stringify({
      symbol: "COFFEE",
      condition: "above",
      target_price: 200.0,
    });

    const createRes = http.post(`${API}/alerts`, alertPayload, { headers });
    requestCount.add(1);
    check(createRes, {
      "create alert status 2xx": (r) =>
        r.status >= 200 && r.status < 300,
    }) || errorRate.add(1);

    // List alerts
    const listRes = http.get(`${API}/alerts`, { headers });
    requestCount.add(1);
    check(listRes, {
      "list alerts status 200": (r) => r.status === 200,
    }) || errorRate.add(1);
  });

  group("Analytics", () => {
    const dashRes = http.get(`${API}/analytics/dashboard`, { headers });
    requestCount.add(1);
    check(dashRes, {
      "analytics dashboard 200": (r) => r.status === 200,
    }) || errorRate.add(1);

    const pnlRes = http.get(`${API}/analytics/pnl`, { headers });
    requestCount.add(1);
    check(pnlRes, {
      "pnl report 200": (r) => r.status === 200,
    }) || errorRate.add(1);
  });

  group("Matching Engine Proxy", () => {
    const statusRes = http.get(`${API}/matching-engine/status`, { headers });
    requestCount.add(1);
    check(statusRes, {
      "ME status 200": (r) => r.status === 200,
    }) || errorRate.add(1);

    const symbolsRes = http.get(`${API}/matching-engine/symbols`, {
      headers,
    });
    requestCount.add(1);
    check(symbolsRes, {
      "ME symbols 200": (r) => r.status === 200,
    }) || errorRate.add(1);
  });

  group("Ingestion Proxy", () => {
    const feedsRes = http.get(`${API}/ingestion/feeds`, { headers });
    requestCount.add(1);
    check(feedsRes, {
      "ingestion feeds 200": (r) => r.status === 200,
    }) || errorRate.add(1);

    const lakehouseRes = http.get(`${API}/ingestion/lakehouse/status`, {
      headers,
    });
    requestCount.add(1);
    check(lakehouseRes, {
      "lakehouse status 200": (r) => r.status === 200,
    }) || errorRate.add(1);
  });

  group("Platform Health", () => {
    const healthRes = http.get(`${API}/platform/health`, { headers });
    requestCount.add(1);
    check(healthRes, {
      "platform health 200": (r) => r.status === 200,
    }) || errorRate.add(1);

    const mwRes = http.get(`${API}/middleware/status`, { headers });
    requestCount.add(1);
    check(mwRes, {
      "middleware status 200": (r) => r.status === 200,
    }) || errorRate.add(1);
  });

  group("Accounts CRUD", () => {
    const accountPayload = JSON.stringify({
      type: "trading",
      currency: "USD",
    });

    const createRes = http.post(`${API}/accounts`, accountPayload, {
      headers,
    });
    requestCount.add(1);
    check(createRes, {
      "create account status 2xx": (r) =>
        r.status >= 200 && r.status < 300,
    }) || errorRate.add(1);

    const listRes = http.get(`${API}/accounts`, { headers });
    requestCount.add(1);
    check(listRes, {
      "list accounts status 200": (r) => r.status === 200,
    }) || errorRate.add(1);
  });

  group("Audit Log", () => {
    const auditRes = http.get(`${API}/audit-log`, { headers });
    requestCount.add(1);
    check(auditRes, {
      "audit log status 200": (r) => r.status === 200,
    }) || errorRate.add(1);
  });

  sleep(1);
}
