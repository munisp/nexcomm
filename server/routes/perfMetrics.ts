/**
 * perfMetrics.ts — GET /api/perf/snapshot
 *
 * Operational latency/health snapshot used to verify the performance budgets:
 *   - per-route p50/p95/p99 over a rolling 60s window (from perfMiddleware)
 *   - cache statistics (hit rate, Redis availability, LRU fallback size)
 *   - DB pool configuration/health
 *   - process memory usage and event-loop lag (perf_hooks.monitorEventLoopDelay)
 *
 * Protection: when PERF_METRICS_TOKEN is set, requests must present it in the
 * X-Perf-Token header. When unset (dev only), access is restricted to
 * loopback clients. No admin session middleware is used so the endpoint stays
 * cheap and does not touch the database on every scrape.
 */

import { Router, type Request, type Response } from "express";
import { monitorEventLoopDelay, type IntervalHistogram } from "node:perf_hooks";
import { getPerfSnapshot } from "../_core/perfMiddleware";
import { cacheStats } from "../cache";
import { getDbPoolStats } from "../db";
import { getBreakerStats } from "../_core/httpClient";

export const perfMetricsRouter = Router();

// ─── Event-loop lag histogram (enabled once at module load) ──────────────────

const elu: IntervalHistogram = monitorEventLoopDelay({ resolution: 20 });
elu.enable();

function eventLoopSnapshot() {
  const toMs = (ns: number) => Math.round((ns / 1e6) * 100) / 100;
  const snap = {
    minMs: toMs(elu.min),
    meanMs: toMs(elu.mean),
    p50Ms: toMs(elu.percentile(50)),
    p95Ms: toMs(elu.percentile(95)),
    p99Ms: toMs(elu.percentile(99)),
    maxMs: toMs(elu.max),
  };
  elu.reset();
  return snap;
}

// ─── Access control ───────────────────────────────────────────────────────────

function isLoopback(req: Request): boolean {
  const ip = req.ip ?? req.socket.remoteAddress ?? "";
  return ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1";
}

function authorize(req: Request, res: Response): boolean {
  const token = process.env.PERF_METRICS_TOKEN ?? "";
  if (token) {
    const presented = req.headers["x-perf-token"];
    if (presented === token) return true;
    res.status(401).json({ error: "X-Perf-Token header required" });
    return false;
  }
  // Dev fallback: loopback only.
  if (isLoopback(req)) return true;
  res.status(403).json({ error: "PERF_METRICS_TOKEN not configured — loopback only" });
  return false;
}

// ─── Routes ───────────────────────────────────────────────────────────────────

perfMetricsRouter.get("/api/perf/snapshot", (req: Request, res: Response) => {
  if (!authorize(req, res)) return;
  const mem = process.memoryUsage();
  res.json({
    generatedAt: new Date().toISOString(),
    budgets: {
      readP95Ms: 100,
      cachedReadP95Ms: 15,
      writeP95Ms: 300,
      slowRequestMs: parseInt(process.env.PERF_SLOW_REQUEST_MS ?? "500", 10),
    },
    perf: getPerfSnapshot(),
    cache: cacheStats(),
    db: getDbPoolStats(),
    circuitBreakers: getBreakerStats(),
    process: {
      pid: process.pid,
      uptimeSec: Math.round(process.uptime()),
      memory: {
        rssMb: Math.round((mem.rss / 1024 / 1024) * 10) / 10,
        heapUsedMb: Math.round((mem.heapUsed / 1024 / 1024) * 10) / 10,
        heapTotalMb: Math.round((mem.heapTotal / 1024 / 1024) * 10) / 10,
        externalMb: Math.round((mem.external / 1024 / 1024) * 10) / 10,
      },
      eventLoopLag: eventLoopSnapshot(),
    },
  });
});
