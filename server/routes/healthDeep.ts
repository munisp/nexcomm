/**
 * NEXCOM Exchange — Deep Health Check Route
 * GET /api/health        — quick liveness probe (always 200)
 * GET /api/health/deep   — full readiness probe (pings all 25 microservices)
 */

import type { Router } from "express";
import express from "express";
import { ENV } from "../_core/env";

const router: Router = express.Router();

// ── Quick liveness probe ──────────────────────────────────────────────────────
router.get("/", (_req, res) => {
  res.json({
    status: "ok",
    service: "nexcom-exchange",
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version ?? "1.0.0",
  });
});

// ── Deep readiness probe ──────────────────────────────────────────────────────
const SERVICES: Array<{ name: string; url: string; critical: boolean }> = [
  { name: "core-banking",       url: `${ENV.coreBankingUrl}/health`,         critical: true },
  { name: "channel-gateway",    url: `${ENV.channelGatewayUrl}/health`,      critical: false },
  { name: "bot-logic",          url: `${ENV.botLogicUrl}/health`,            critical: false },
  { name: "ussd-engine",        url: `${ENV.ussdEngineUrl}/health`,          critical: false },
  { name: "indices-service",    url: `${ENV.indicesServiceUrl}/health`,      critical: false },
  { name: "ai-ml",              url: `${ENV.aiMlServiceUrl}/health`,         critical: false },
  { name: "analytics-engine",   url: `${ENV.analyticsEngineUrl}/health`,     critical: false },
  { name: "kyc-service",        url: `${ENV.kycServiceUrl}/health`,          critical: true },
  { name: "trading-engine",     url: `${ENV.tradingEngineUrl}/health`,       critical: true },
  { name: "risk-management",    url: `${ENV.riskServiceUrl}/health`,         critical: true },
  { name: "mojaloop-adapter",   url: `${ENV.mojaloopAdapterUrl}/health`,     critical: false },
  { name: "user-management",    url: `${ENV.userManagementUrl}/health`,      critical: true },
  { name: "ingestion-engine",   url: `${ENV.ingestionEngineUrl}/health`,     critical: false },
  { name: "notification-svc",   url: `${ENV.notificationServiceUrl}/health`, critical: false },
  { name: "opensearch",         url: `${ENV.opensearchUrl}/_cluster/health`, critical: false },
  { name: "blockchain-service", url: `${ENV.blockchainServiceUrl}/health`,   critical: false },
  { name: "fraud-engine",       url: `${ENV.fraudEngineUrl}/health`,         critical: true },
  { name: "credit-scoring",     url: `${ENV.creditScoringUrl}/health`,       critical: false },
  { name: "gateway-service",    url: `${ENV.gatewayServiceUrl}/health`,      critical: false },
];

type ServiceHealth = {
  status: "ok" | "degraded" | "down";
  latencyMs: number;
  critical: boolean;
  error?: string;
};

async function checkService(name: string, url: string, critical: boolean): Promise<[string, ServiceHealth]> {
  const start = Date.now();
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);
    const latencyMs = Date.now() - start;
    const status = response.ok ? "ok" : "degraded";
    return [name, { status, latencyMs, critical, error: response.ok ? undefined : `HTTP ${response.status}` }];
  } catch (err: unknown) {
    return [name, {
      status: "down",
      latencyMs: Date.now() - start,
      critical,
      error: err instanceof Error ? (err.name === "AbortError" ? "timeout" : err.message) : "unknown",
    }];
  }
}

router.get("/deep", async (_req, res) => {
  const start = Date.now();

  const results = await Promise.allSettled(
    SERVICES.map(({ name, url, critical }) => checkService(name, url, critical))
  );

  const services: Record<string, ServiceHealth> = {};
  let criticalDown = 0;
  let totalDown = 0;

  for (const result of results) {
    if (result.status === "fulfilled") {
      const [name, health] = result.value;
      services[name] = health;
      if (health.status === "down") {
        totalDown++;
        if (health.critical) criticalDown++;
      }
    }
  }

  const overallStatus = criticalDown > 0 ? "degraded" : totalDown > 3 ? "degraded" : "ok";
  const totalMs = Date.now() - start;

  const summary = {
    status: overallStatus,
    timestamp: new Date().toISOString(),
    totalServices: SERVICES.length,
    servicesUp: SERVICES.length - totalDown,
    servicesDown: totalDown,
    criticalDown,
    checkDurationMs: totalMs,
    services,
  };

  res.status(overallStatus === "ok" ? 200 : 503).json(summary);
});

export { router as healthDeepRouter };
