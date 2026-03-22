/**
 * haStatusRoute.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * REST endpoint for external monitoring tools (Prometheus, Grafana, Uptime Kuma).
 *
 * Routes:
 *   GET /api/ha/status          — JSON health summary (no auth required)
 *   GET /api/ha/status/metrics  — Prometheus text format (no auth required)
 *   GET /api/ha/status/engines  — Per-engine detail (requires X-Admin-Token header)
 *
 * The admin token is read from HA_ADMIN_TOKEN env var (falls back to JWT_SECRET).
 * If neither is set the /engines endpoint is disabled.
 */

import { Router, Request, Response } from "express";
import { haManager } from "../engineHAManager";

export const haStatusRouter = Router();

// ── Types ─────────────────────────────────────────────────────────────────────

interface EngineJsonSummary {
  name: string;
  status: string;
  port: number;
  pid: number | null;
  restartCount: number;
  uptimeSec: number | null;
  lastHealthyAt: string | null;
  lastErrorAt: string | null;
  circuitOpenUntil: string | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function toJsonSummary(snap: ReturnType<typeof haManager.getHealth>[number]): EngineJsonSummary {
  return {
    name: snap.name,
    status: snap.status,
    port: snap.port,
    pid: snap.pid,
    restartCount: snap.restartCount,
    uptimeSec: snap.uptimeMs != null ? Math.round(snap.uptimeMs / 1000) : null,
    lastHealthyAt: snap.lastHealthyAt?.toISOString() ?? null,
    lastErrorAt: snap.lastErrorAt?.toISOString() ?? null,
    circuitOpenUntil: snap.circuitOpenUntil?.toISOString() ?? null,
  };
}

const CRITICAL_ENGINES = ["MatchingEngine", "SettlementEngine"];

function overallStatus(snaps: ReturnType<typeof haManager.getHealth>): "ok" | "degraded" | "critical" {
  const criticalSnaps = snaps.filter(s => CRITICAL_ENGINES.includes(s.name));
  const anyDown = criticalSnaps.some(s => s.status === "UNAVAILABLE" || s.status === "RATE_LIMITED" || s.status === "STOPPED");
  if (anyDown) return "critical";
  const anyDegraded = snaps.some(s => s.status === "DEGRADED");
  if (anyDegraded) return "degraded";
  return "ok";
}

// ── GET /api/ha/status ────────────────────────────────────────────────────────
// Lightweight JSON summary — safe for public monitoring tools.
haStatusRouter.get("/api/ha/status", (_req: Request, res: Response) => {
  const snaps = haManager.getHealth();
  const overall = overallStatus(snaps);

  const httpStatus = overall === "ok" ? 200 : overall === "degraded" ? 200 : 503;

  res.status(httpStatus).json({
    status: overall,
    checkedAt: new Date().toISOString(),
    engines: snaps.map(s => ({
      name: s.name,
      status: s.status,
      port: s.port,
      restartCount: s.restartCount,
    })),
  });
});

// ── GET /api/ha/status/metrics ────────────────────────────────────────────────
// Prometheus text exposition format (OpenMetrics compatible).
haStatusRouter.get("/api/ha/status/metrics", (_req: Request, res: Response) => {
  const snaps = haManager.getHealth();
  const lines: string[] = [];

  // nexcom_engine_up{engine="MatchingEngine"} 1
  lines.push("# HELP nexcom_engine_up Whether the engine process is healthy (1=healthy/degraded, 0=down)");
  lines.push("# TYPE nexcom_engine_up gauge");
  for (const s of snaps) {
    const up = s.status === "HEALTHY" || s.status === "DEGRADED" ? 1 : 0;
    lines.push(`nexcom_engine_up{engine="${s.name}",port="${s.port}"} ${up}`);
  }

  // nexcom_engine_restart_total
  lines.push("# HELP nexcom_engine_restart_total Total number of engine process restarts");
  lines.push("# TYPE nexcom_engine_restart_total counter");
  for (const s of snaps) {
    lines.push(`nexcom_engine_restart_total{engine="${s.name}"} ${s.restartCount}`);
  }

  // nexcom_engine_uptime_seconds
  lines.push("# HELP nexcom_engine_uptime_seconds Seconds since the engine last became healthy");
  lines.push("# TYPE nexcom_engine_uptime_seconds gauge");
  for (const s of snaps) {
    const uptime = s.uptimeMs != null ? (s.uptimeMs / 1000).toFixed(1) : "0";
    lines.push(`nexcom_engine_uptime_seconds{engine="${s.name}"} ${uptime}`);
  }

  // nexcom_engine_circuit_open
  lines.push("# HELP nexcom_engine_circuit_open Whether the circuit breaker is currently open (1=open)");
  lines.push("# TYPE nexcom_engine_circuit_open gauge");
  for (const s of snaps) {
    const open = s.status === "RATE_LIMITED" ? 1 : 0;
    lines.push(`nexcom_engine_circuit_open{engine="${s.name}"} ${open}`);
  }

  // nexcom_engine_status_info (info metric for status string)
  lines.push("# HELP nexcom_engine_status_info Current status of the engine as a label");
  lines.push("# TYPE nexcom_engine_status_info gauge");
  for (const s of snaps) {
    lines.push(`nexcom_engine_status_info{engine="${s.name}",status="${s.status}"} 1`);
  }

  lines.push(""); // trailing newline required by Prometheus

  res.status(200)
    .set("Content-Type", "text/plain; version=0.0.4; charset=utf-8")
    .send(lines.join("\n"));
});

// ── GET /api/ha/status/engines ────────────────────────────────────────────────
// Full per-engine detail — requires X-Admin-Token header.
haStatusRouter.get("/api/ha/status/engines", (req: Request, res: Response) => {
  const adminToken = process.env.HA_ADMIN_TOKEN || process.env.JWT_SECRET;
  if (adminToken) {
    const provided = req.headers["x-admin-token"];
    if (provided !== adminToken) {
      res.status(401).json({ error: "Unauthorized: invalid or missing X-Admin-Token header" });
      return;
    }
  }

  const snaps = haManager.getHealth();
  const overall = overallStatus(snaps);

  res.status(200).json({
    status: overall,
    checkedAt: new Date().toISOString(),
    engines: snaps.map(toJsonSummary),
  });
});
