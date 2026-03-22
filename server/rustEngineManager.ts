/**
 * engineManager.ts (formerly rustEngineManager.ts)
 * ─────────────────────────────────────────────────────────────────────────────
 * Manages the lifecycle of all native service binaries:
 *
 *   1. Rust Matching Engine  — price-time priority order book, port 8080
 *   2. Go Gateway Service    — TigerBeetle ledger, Kafka, Redis, Temporal, port 8200
 *
 * Both binaries are spawned as child processes on server startup and
 * gracefully shut down when the Node.js process exits. If a binary is absent
 * (e.g. CI/CD without pre-built artifacts), the server continues without it —
 * all calls gracefully degrade to in-memory fallbacks.
 *
 * Binary locations (relative to project root):
 *   matching-engine/matching-engine
 *   gateway-service/gateway-service
 */

import { spawn, type ChildProcess } from "child_process";
import path from "path";
import { fileURLToPath } from "url";
import { checkMatchingEngineHealth } from "./matchingEngineClient";
import { getGatewayHealth } from "./gatewayClient";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..");

const ME_BINARY = path.join(PROJECT_ROOT, "matching-engine", "matching-engine");
const GW_BINARY = path.join(PROJECT_ROOT, "gateway-service", "gateway-service");
const SE_BINARY = path.join(PROJECT_ROOT, "settlement-engine-binary");
const TE_BINARY = path.join(PROJECT_ROOT, "services", "trading-engine", "trading-engine");
const RM_BINARY = path.join(PROJECT_ROOT, "services", "risk-management", "risk-management");

const ME_PORT = parseInt(process.env.MATCHING_ENGINE_PORT ?? "8080");
const GW_PORT = parseInt(process.env.GATEWAY_PORT ?? "8200");
const SE_PORT = parseInt(process.env.SETTLEMENT_ENGINE_PORT ?? "8005");
const TE_PORT = parseInt(process.env.TRADING_ENGINE_PORT ?? "8001");
const RM_PORT = parseInt(process.env.RISK_MANAGEMENT_PORT ?? "8004");

let _meProcess: ChildProcess | null = null;
let _gwProcess: ChildProcess | null = null;
let _seProcess: ChildProcess | null = null;
let _teProcess: ChildProcess | null = null;
let _rmProcess: ChildProcess | null = null;

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function isBinaryExecutable(binaryPath: string): Promise<boolean> {
  try {
    const { accessSync, constants } = await import("fs");
    accessSync(binaryPath, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

async function waitForHealth(
  label: string,
  healthFn: () => Promise<unknown>,
  maxWaitMs = 10_000
): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    await new Promise(r => setTimeout(r, 500));
    try {
      const result = await healthFn();
      if (result) {
        console.log(`[${label}] Ready`);
        return true;
      }
    } catch {
      // keep waiting
    }
  }
  console.warn(`[${label}] Did not become healthy within ${maxWaitMs}ms. Continuing anyway.`);
  return false;
}

// ─── Rust Matching Engine ─────────────────────────────────────────────────────

export async function startRustMatchingEngine(): Promise<void> {
  // Check if already running externally
  const alreadyUp = await checkMatchingEngineHealth();
  if (alreadyUp) {
    console.log(`[MatchingEngine] Already running at port ${ME_PORT}`);
    return;
  }

  if (!(await isBinaryExecutable(ME_BINARY))) {
    console.warn(`[MatchingEngine] Binary not found at ${ME_BINARY}. Running without Rust engine.`);
    return;
  }

  console.log(`[MatchingEngine] Starting Rust engine on port ${ME_PORT}...`);

  _meProcess = spawn(ME_BINARY, [], {
    env: {
      ...process.env,
      PORT: String(ME_PORT),
      RUST_LOG: process.env.RUST_LOG ?? "warn",
    },
    stdio: ["ignore", "pipe", "pipe"],
    detached: false,
  });

  _meProcess.stdout?.on("data", (data: Buffer) => {
    const line = data.toString().trim();
    if (line) console.log(`[MatchingEngine] ${line}`);
  });

  _meProcess.stderr?.on("data", (data: Buffer) => {
    const line = data.toString().trim();
    if (line) console.warn(`[MatchingEngine] ${line}`);
  });

  _meProcess.on("exit", (code, signal) => {
    console.warn(`[MatchingEngine] Process exited (code=${code}, signal=${signal})`);
    _meProcess = null;
    if (code !== 0 && signal !== "SIGTERM") {
      setTimeout(() => startRustMatchingEngine().catch(console.error), 5000);
    }
  });

  _meProcess.on("error", (err) => {
    console.error(`[MatchingEngine] Failed to start: ${err.message}`);
    _meProcess = null;
  });

  await waitForHealth("MatchingEngine", checkMatchingEngineHealth);
}

export function stopRustMatchingEngine(): void {
  if (_meProcess) {
    _meProcess.kill("SIGTERM");
    _meProcess = null;
    console.log("[MatchingEngine] Stopped.");
  }
}

// ─── Rust Settlement Engine (TigerBeetle + Mojaloop) ────────────────────────

async function checkSettlementEngineHealth(): Promise<boolean> {
  try {
    const res = await fetch(`http://localhost:${SE_PORT}/health`, { signal: AbortSignal.timeout(2000) });
    return res.ok;
  } catch {
    return false;
  }
}

export async function startRustSettlementEngine(): Promise<void> {
  const alreadyUp = await checkSettlementEngineHealth();
  if (alreadyUp) {
    console.log(`[SettlementEngine] Already running at port ${SE_PORT}`);
    return;
  }

  if (!(await isBinaryExecutable(SE_BINARY))) {
    console.warn(`[SettlementEngine] Binary not found at ${SE_BINARY}. Running without Rust settlement engine.`);
    return;
  }

  console.log(`[SettlementEngine] Starting Rust settlement engine on port ${SE_PORT}...`);

  _seProcess = spawn(SE_BINARY, [], {
    env: {
      ...process.env,
      PORT: String(SE_PORT),
      RUST_LOG: process.env.RUST_LOG ?? "warn",
      // TigerBeetle: dedicated port to avoid collision with dev server
      TIGERBEETLE_ADDRESS: process.env.TIGERBEETLE_ADDRESSES ?? "localhost:3001",
      // Mojaloop hub — gracefully degrades if not present
      MOJALOOP_HUB_URL: process.env.MOJALOOP_HUB_URL ?? "http://localhost:4001",
      NEXCOM_DFSP_ID: process.env.NEXCOM_DFSP_ID ?? "nexcom-exchange",
    },
    stdio: ["ignore", "pipe", "pipe"],
    detached: false,
  });

  _seProcess.stdout?.on("data", (data: Buffer) => {
    const line = data.toString().trim();
    if (line) console.log(`[SettlementEngine] ${line}`);
  });

  _seProcess.stderr?.on("data", (data: Buffer) => {
    const line = data.toString().trim();
    // Filter expected warnings about Mojaloop being unavailable
    if (line && !line.includes("Mojaloop hub unavailable") && !line.includes("Cannot reach Mojaloop") && !line.includes("Failed to register callback")) {
      console.warn(`[SettlementEngine] ${line}`);
    }
  });

  _seProcess.on("exit", (code, signal) => {
    console.warn(`[SettlementEngine] Process exited (code=${code}, signal=${signal})`);
    _seProcess = null;
    if (code !== 0 && signal !== "SIGTERM") {
      setTimeout(() => startRustSettlementEngine().catch(console.error), 5000);
    }
  });

  _seProcess.on("error", (err) => {
    console.error(`[SettlementEngine] Failed to start: ${err.message}`);
    _seProcess = null;
  });

  await waitForHealth("SettlementEngine", checkSettlementEngineHealth);
}

export function stopRustSettlementEngine(): void {
  if (_seProcess) {
    _seProcess.kill("SIGTERM");
    _seProcess = null;
    console.log("[SettlementEngine] Stopped.");
  }
}

// ─── Go Gateway Service (TigerBeetle + Kafka + Redis + Temporal) ─────────────

export async function startGoGateway(): Promise<void> {
  // Check if already running externally
  const alreadyUp = await getGatewayHealth();
  if (alreadyUp) {
    console.log(`[Gateway] Already running at port ${GW_PORT}`);
    return;
  }

  if (!(await isBinaryExecutable(GW_BINARY))) {
    console.warn(`[Gateway] Binary not found at ${GW_BINARY}. Running without Go gateway.`);
    return;
  }

  console.log(`[Gateway] Starting Go gateway on port ${GW_PORT}...`);

  _gwProcess = spawn(GW_BINARY, [], {
    env: {
      ...process.env,
      PORT: String(GW_PORT),
      ENVIRONMENT: process.env.NODE_ENV ?? "development",
      // Point gateway to the Rust matching engine
      MATCHING_ENGINE_URL: `http://localhost:${ME_PORT}`,
      // TigerBeetle: use port 3001 to avoid conflict with portal dev server (3000)
      TIGERBEETLE_ADDRESSES: process.env.TIGERBEETLE_ADDRESSES ?? "localhost:3001",
      // Other middleware — fall back gracefully if not present
      KAFKA_BROKERS: process.env.KAFKA_BROKERS ?? "localhost:9092",
      REDIS_URL: process.env.REDIS_URL ?? "localhost:6379",
      TEMPORAL_HOST: process.env.TEMPORAL_HOST ?? "localhost:7233",
      POSTGRES_URL: process.env.DATABASE_URL ?? "postgres://nexcom:nexcom@localhost:5432/nexcom?sslmode=disable",
      CORS_ORIGINS: process.env.CORS_ORIGINS ?? "http://localhost:3000,http://localhost:5432",
    },
    stdio: ["ignore", "pipe", "pipe"],
    detached: false,
  });

  _gwProcess.stdout?.on("data", (data: Buffer) => {
    const line = data.toString().trim();
    if (line) console.log(`[Gateway] ${line}`);
  });

  _gwProcess.stderr?.on("data", (data: Buffer) => {
    const line = data.toString().trim();
    // Filter out expected "fallback mode" warnings — they are normal
    if (line && !line.includes("fallback mode")) {
      console.warn(`[Gateway] ${line}`);
    }
  });

  _gwProcess.on("exit", (code, signal) => {
    console.warn(`[Gateway] Process exited (code=${code}, signal=${signal})`);
    _gwProcess = null;
    if (code !== 0 && signal !== "SIGTERM") {
      setTimeout(() => startGoGateway().catch(console.error), 5000);
    }
  });

  _gwProcess.on("error", (err) => {
    console.error(`[Gateway] Failed to start: ${err.message}`);
    _gwProcess = null;
  });

  await waitForHealth("Gateway", getGatewayHealth);
}

export function stopGoGateway(): void {
  if (_gwProcess) {
    _gwProcess.kill("SIGTERM");
    _gwProcess = null;
    console.log("[Gateway] Stopped.");
  }
}

// ─── Go Trading Engine (FIX protocol + order routing) ───────────────────────

async function checkTradingEngineHealth(): Promise<boolean> {
  try {
    const res = await fetch(`http://localhost:${TE_PORT}/healthz`, { signal: AbortSignal.timeout(2000) });
    return res.ok;
  } catch {
    return false;
  }
}

export async function startTradingEngine(): Promise<void> {
  const alreadyUp = await checkTradingEngineHealth();
  if (alreadyUp) {
    console.log(`[TradingEngine] Already running at port ${TE_PORT}`);
    return;
  }

  if (!(await isBinaryExecutable(TE_BINARY))) {
    console.warn(`[TradingEngine] Binary not found at ${TE_BINARY}. Running without trading engine.`);
    return;
  }

  console.log(`[TradingEngine] Starting Go trading engine on port ${TE_PORT}...`);

  _teProcess = spawn(TE_BINARY, [], {
    env: {
      ...process.env,
      PORT: String(TE_PORT),
      MATCHING_ENGINE_URL: `http://localhost:${ME_PORT}`,
      KAFKA_BROKERS: process.env.KAFKA_BROKERS ?? "localhost:9092",
    },
    stdio: ["ignore", "pipe", "pipe"],
    detached: false,
  });

  _teProcess.stdout?.on("data", (data: Buffer) => {
    const line = data.toString().trim();
    if (line) console.log(`[TradingEngine] ${line}`);
  });

  _teProcess.stderr?.on("data", (data: Buffer) => {
    const line = data.toString().trim();
    if (line) console.warn(`[TradingEngine] ${line}`);
  });

  _teProcess.on("exit", (code, signal) => {
    console.warn(`[TradingEngine] Process exited (code=${code}, signal=${signal})`);
    _teProcess = null;
    if (code !== 0 && signal !== "SIGTERM") {
      setTimeout(() => startTradingEngine().catch(console.error), 5000);
    }
  });

  _teProcess.on("error", (err) => {
    console.error(`[TradingEngine] Failed to start: ${err.message}`);
    _teProcess = null;
  });

  await waitForHealth("TradingEngine", checkTradingEngineHealth);
}

export function stopTradingEngine(): void {
  if (_teProcess) {
    _teProcess.kill("SIGTERM");
    _teProcess = null;
    console.log("[TradingEngine] Stopped.");
  }
}

// ─── Go Risk Management Service ───────────────────────────────────────────────

async function checkRiskManagementHealth(): Promise<boolean> {
  try {
    const res = await fetch(`http://localhost:${RM_PORT}/healthz`, { signal: AbortSignal.timeout(2000) });
    return res.ok;
  } catch {
    return false;
  }
}

export async function startRiskManagement(): Promise<void> {
  const alreadyUp = await checkRiskManagementHealth();
  if (alreadyUp) {
    console.log(`[RiskManagement] Already running at port ${RM_PORT}`);
    return;
  }

  if (!(await isBinaryExecutable(RM_BINARY))) {
    console.warn(`[RiskManagement] Binary not found at ${RM_BINARY}. Running without risk management.`);
    return;
  }

  console.log(`[RiskManagement] Starting Go risk management on port ${RM_PORT}...`);

  _rmProcess = spawn(RM_BINARY, [], {
    env: {
      ...process.env,
      PORT: String(RM_PORT),
      KAFKA_BROKERS: process.env.KAFKA_BROKERS ?? "localhost:9092",
      REDIS_URL: process.env.REDIS_URL ?? "localhost:6379",
    },
    stdio: ["ignore", "pipe", "pipe"],
    detached: false,
  });

  _rmProcess.stdout?.on("data", (data: Buffer) => {
    const line = data.toString().trim();
    if (line) console.log(`[RiskManagement] ${line}`);
  });

  _rmProcess.stderr?.on("data", (data: Buffer) => {
    const line = data.toString().trim();
    if (line) console.warn(`[RiskManagement] ${line}`);
  });

  _rmProcess.on("exit", (code, signal) => {
    console.warn(`[RiskManagement] Process exited (code=${code}, signal=${signal})`);
    _rmProcess = null;
    if (code !== 0 && signal !== "SIGTERM") {
      setTimeout(() => startRiskManagement().catch(console.error), 5000);
    }
  });

  _rmProcess.on("error", (err) => {
    console.error(`[RiskManagement] Failed to start: ${err.message}`);
    _rmProcess = null;
  });

  await waitForHealth("RiskManagement", checkRiskManagementHealth);
}

export function stopRiskManagement(): void {
  if (_rmProcess) {
    _rmProcess.kill("SIGTERM");
    _rmProcess = null;
    console.log("[RiskManagement] Stopped.");
  }
}

// ─── Combined lifecycle ───────────────────────────────────────────────────────

export async function startAllEngines(): Promise<void> {
  // Start all three engines in parallel
  await Promise.all([
    startRustMatchingEngine().catch(err =>
      console.error("[MatchingEngine] Startup error:", err)
    ),
    startRustSettlementEngine().catch(err =>
      console.error("[SettlementEngine] Startup error:", err)
    ),
    startGoGateway().catch(err =>
      console.error("[Gateway] Startup error:", err)
    ),
    startTradingEngine().catch(err =>
      console.error("[TradingEngine] Startup error:", err)
    ),
    startRiskManagement().catch(err =>
      console.error("[RiskManagement] Startup error:", err)
    ),
  ]);
}

export function stopAllEngines(): void {
  stopRustMatchingEngine();
  stopRustSettlementEngine();
  stopGoGateway();
  stopTradingEngine();
  stopRiskManagement();
}
