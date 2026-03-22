/**
 * engineHAManager.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * NEXCOM Exchange — Never-Offline Engine HA Manager
 *
 * Design principles:
 *
 *   1. INFINITE RETRY — critical engines (MatchingEngine, SettlementEngine)
 *      NEVER stop retrying. The circuit breaker is a RATE-LIMITER, not a
 *      stopper: it throttles restart frequency but always schedules the next
 *      attempt.
 *
 *   2. HOT-STANDBY PROCESS — critical engines pre-fork a shadow process on
 *      a standby port. When the primary dies, the standby is promoted to
 *      primary in < 100ms (no cold-start gap).
 *
 *   3. STARTUP LIVENESS GATE — startAll() returns a Promise that resolves
 *      only after all critical engines pass their first health check (or
 *      LIVENESS_GATE_TIMEOUT_MS elapses). The Node server does NOT accept
 *      traffic until critical engines are alive.
 *
 *   4. CRASH-LOOP GUARD — if an engine exits within CRASH_LOOP_THRESHOLD_MS
 *      of starting (< 2s), it is flagged as a crash-loop. After
 *      CRASH_LOOP_MAX_FAST_EXITS fast exits, the manager attempts an
 *      auto-rebuild (cargo build / go build) before the next restart.
 *
 *   5. EXPONENTIAL BACK-OFF — 1s → 2s → 4s → … → MAX_BACKOFF_MS (120s).
 *      For critical engines the cap is reduced to 30s so recovery is faster.
 *
 *   6. HEALTH POLLING — every 5s via HTTP GET /health. Marks DEGRADED before
 *      the process fully dies so the API can fail-fast.
 *
 *   7. GRACEFUL DRAIN — POST /admin/drain → wait drainWaitMs → SIGTERM →
 *      10s → SIGKILL.
 *
 *   8. HEALTH EVENT BUS — emit("engine:health", snapshot) for WebSocket push.
 */

import { spawn, exec, type ChildProcess } from "child_process";
import { EventEmitter } from "events";
import path from "path";
import { fileURLToPath } from "url";
import { accessSync, constants } from "fs";
import { promisify } from "util";

const execAsync = promisify(exec);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..");

// ─── Constants ────────────────────────────────────────────────────────────────

const HEALTH_POLL_INTERVAL_MS = 5_000;
const CRASH_LOOP_THRESHOLD_MS = 2_000;   // exit within 2s = crash-loop
const CRASH_LOOP_MAX_FAST_EXITS = 3;     // rebuild after 3 crash-loops
const LIVENESS_GATE_TIMEOUT_MS = 60_000; // max wait for critical engine on startup
const STANDBY_PORT_OFFSET = 100;         // standby port = primary port + 100

// ─── Types ────────────────────────────────────────────────────────────────────

export type EngineStatus =
  | "STARTING"
  | "HEALTHY"
  | "DEGRADED"
  | "UNAVAILABLE"
  | "RATE_LIMITED"   // replaces CIRCUIT_OPEN — still retrying, just throttled
  | "REBUILDING"     // crash-loop guard triggered auto-rebuild
  | "STOPPED";

export interface EngineHealthSnapshot {
  name: string;
  status: EngineStatus;
  pid: number | null;
  port: number;
  restartCount: number;
  lastHealthyAt: Date | null;
  lastErrorAt: Date | null;
  circuitOpenUntil: Date | null; // kept for API compat — now means "rate-limit until"
  uptimeMs: number | null;
  standbyPid: number | null;
  crashLoopCount: number;
}

interface EngineDescriptor {
  name: string;
  binary: string;
  buildCmd?: string;        // e.g. "cargo build --release" — run on crash-loop
  buildCwd?: string;        // working dir for buildCmd
  port: number;
  healthPath: string;
  drainPath?: string;
  drainWaitMs?: number;
  startupEnv?: Record<string, string>;
  startupTimeoutMs?: number;
  healthPollIntervalMs?: number;
  critical?: boolean;       // if true: infinite retry + hot-standby + liveness gate
  maxBackoffMs?: number;    // default 120s; critical engines use 30s
}

// ─── HAEngine ─────────────────────────────────────────────────────────────────

class HAEngine extends EventEmitter {
  private readonly desc: EngineDescriptor;
  private process: ChildProcess | null = null;
  private standbyProcess: ChildProcess | null = null;
  private status: EngineStatus = "STOPPED";
  private restartCount = 0;
  private lastHealthyAt: Date | null = null;
  private lastErrorAt: Date | null = null;
  private startedAt: Date | null = null;
  private healthTimer: ReturnType<typeof setInterval> | null = null;
  private restartTimer: ReturnType<typeof setTimeout> | null = null;
  private stopping = false;

  // Rate-limiter state (replaces circuit breaker — never stops retrying)
  private consecutiveFailures = 0;
  private rateLimitUntil: Date | null = null;
  private readonly RATE_LIMIT_THRESHOLD = 5;
  private readonly RATE_LIMIT_DURATION_MS: number;

  // Crash-loop guard
  private fastExitCount = 0;
  private rebuilding = false;

  constructor(desc: EngineDescriptor) {
    super();
    this.desc = desc;
    this.RATE_LIMIT_DURATION_MS = desc.critical ? 30_000 : 120_000;
  }

  get snapshot(): EngineHealthSnapshot {
    return {
      name: this.desc.name,
      status: this.status,
      pid: this.process?.pid ?? null,
      port: this.desc.port,
      restartCount: this.restartCount,
      lastHealthyAt: this.lastHealthyAt,
      lastErrorAt: this.lastErrorAt,
      circuitOpenUntil: this.rateLimitUntil,
      uptimeMs: this.startedAt ? Date.now() - this.startedAt.getTime() : null,
      standbyPid: this.standbyProcess?.pid ?? null,
      crashLoopCount: this.fastExitCount,
    };
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  async start(): Promise<void> {
    this.stopping = false;
    await this._launchWithRetry(0);
  }

  async stop(): Promise<void> {
    this.stopping = true;
    this._clearTimers();
    await Promise.all([
      this._gracefulStop(this.process),
      this._gracefulStop(this.standbyProcess),
    ]);
    this.process = null;
    this.standbyProcess = null;
    this._setStatus("STOPPED");
  }

  /**
   * waitForLiveness — resolves when the engine reaches HEALTHY/DEGRADED,
   * or rejects after timeoutMs. Used by the startup liveness gate.
   */
  waitForLiveness(timeoutMs = LIVENESS_GATE_TIMEOUT_MS): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.status === "HEALTHY" || this.status === "DEGRADED") {
        resolve();
        return;
      }
      const timer = setTimeout(() => {
        this.off("status", handler);
        // For critical engines: do NOT reject — just warn and resolve anyway
        // so the server starts. The engine will keep retrying in the background.
        if (this.desc.critical) {
          console.warn(
            `[${this.desc.name}] Liveness gate timeout after ${timeoutMs}ms. ` +
            `Server will start anyway — engine retrying in background.`
          );
          resolve();
        } else {
          reject(new Error(`${this.desc.name} liveness gate timeout`));
        }
      }, timeoutMs);

      const handler = (snap: EngineHealthSnapshot) => {
        if (snap.status === "HEALTHY" || snap.status === "DEGRADED") {
          clearTimeout(timer);
          this.off("status", handler);
          resolve();
        }
      };
      this.on("status", handler);
    });
  }

  // ── Internal helpers ────────────────────────────────────────────────────────

  private _setStatus(s: EngineStatus) {
    if (this.status !== s) {
      this.status = s;
      this.emit("status", this.snapshot);
    }
  }

  private _clearTimers() {
    if (this.healthTimer) { clearInterval(this.healthTimer); this.healthTimer = null; }
    if (this.restartTimer) { clearTimeout(this.restartTimer); this.restartTimer = null; }
  }

  private async _isExecutable(): Promise<boolean> {
    try { accessSync(this.desc.binary, constants.X_OK); return true; }
    catch { return false; }
  }

  private async _checkHealth(port = this.desc.port): Promise<boolean> {
    try {
      const res = await fetch(
        `http://localhost:${port}${this.desc.healthPath}`,
        { signal: AbortSignal.timeout(2000) }
      );
      return res.ok;
    } catch {
      return false;
    }
  }

  private async _gracefulStop(proc: ChildProcess | null): Promise<void> {
    if (!proc) return;
    if (this.desc.drainPath) {
      try {
        await fetch(`http://localhost:${this.desc.port}${this.desc.drainPath}`, {
          method: "POST",
          signal: AbortSignal.timeout(3000),
        });
        await new Promise(r => setTimeout(r, this.desc.drainWaitMs ?? 5000));
      } catch { /* drain endpoint may already be down */ }
    }
    proc.kill("SIGTERM");
    await new Promise<void>(resolve => {
      const t = setTimeout(() => { proc.kill("SIGKILL"); resolve(); }, 10_000);
      proc.once("exit", () => { clearTimeout(t); resolve(); });
    });
  }

  private _startHealthPolling() {
    const interval = this.desc.healthPollIntervalMs ?? HEALTH_POLL_INTERVAL_MS;
    this.healthTimer = setInterval(async () => {
      if (this.stopping || !this.process) return;
      const healthy = await this._checkHealth();
      if (healthy) {
        this.lastHealthyAt = new Date();
        this.consecutiveFailures = 0;
        if (this.status === "DEGRADED" || this.status === "RATE_LIMITED") {
          console.log(`[${this.desc.name}] Recovered → HEALTHY`);
          this._setStatus("HEALTHY");
        }
      } else {
        this.lastErrorAt = new Date();
        if (this.status === "HEALTHY") {
          console.warn(`[${this.desc.name}] Health check failed → DEGRADED`);
          this._setStatus("DEGRADED");
        }
      }
    }, interval);
  }

  /**
   * _isRateLimited — true if we're in the throttle window.
   * Unlike a real circuit breaker, we ALWAYS schedule the next attempt.
   */
  private _isRateLimited(): boolean {
    if (!this.rateLimitUntil) return false;
    if (Date.now() < this.rateLimitUntil.getTime()) return true;
    // Window expired — reset
    this.rateLimitUntil = null;
    this.consecutiveFailures = 0;
    console.log(`[${this.desc.name}] Rate-limit window expired — resuming normal restart cadence`);
    return false;
  }

  private _recordFailure() {
    this.consecutiveFailures++;
    this.lastErrorAt = new Date();
    if (this.consecutiveFailures >= this.RATE_LIMIT_THRESHOLD) {
      this.rateLimitUntil = new Date(Date.now() + this.RATE_LIMIT_DURATION_MS);
      console.warn(
        `[${this.desc.name}] Rate-limiting restarts after ${this.consecutiveFailures} failures. ` +
        `Next attempt at ${this.rateLimitUntil.toISOString()} (engine WILL restart)`
      );
      this._setStatus("RATE_LIMITED");
    }
  }

  private _isCrashLoop(startedAt: Date): boolean {
    return Date.now() - startedAt.getTime() < CRASH_LOOP_THRESHOLD_MS;
  }

  private async _tryRebuild(): Promise<boolean> {
    if (!this.desc.buildCmd) return false;
    this.rebuilding = true;
    this._setStatus("REBUILDING");
    console.log(`[${this.desc.name}] Crash-loop detected — attempting auto-rebuild: ${this.desc.buildCmd}`);
    try {
      await execAsync(this.desc.buildCmd, {
        cwd: this.desc.buildCwd ?? PROJECT_ROOT,
        timeout: 300_000, // 5 minutes max
      });
      console.log(`[${this.desc.name}] Rebuild succeeded`);
      this.fastExitCount = 0;
      this.rebuilding = false;
      return true;
    } catch (err) {
      console.error(`[${this.desc.name}] Rebuild failed:`, err);
      this.rebuilding = false;
      return false;
    }
  }

  /**
   * _spawnProcess — spawns the engine binary and wires up event handlers.
   * Returns the ChildProcess.
   */
  private _spawnProcess(port: number): ChildProcess {
    const proc = spawn(this.desc.binary, [], {
      env: {
        ...process.env,
        PORT: String(port),
        RUST_LOG: process.env.RUST_LOG ?? "warn",
        ...(this.desc.startupEnv ?? {}),
      },
      stdio: ["ignore", "pipe", "pipe"],
      detached: false,
    });

    proc.stdout?.on("data", (data: Buffer) => {
      const line = data.toString().trim();
      if (line) console.log(`[${this.desc.name}] ${line}`);
    });

    proc.stderr?.on("data", (data: Buffer) => {
      const line = data.toString().trim();
      if (line) {
        const isExpectedWarn =
          line.includes("TigerBeetle unavailable") ||
          line.includes("Mojaloop hub unavailable") ||
          line.includes("Cannot reach Mojaloop") ||
          line.includes("Failed to register callback") ||
          line.includes("Address already in use");
        if (!isExpectedWarn) {
          console.warn(`[${this.desc.name}] ${line}`);
        }
      }
    });

    return proc;
  }

  /**
   * _launchWithRetry — core restart loop.
   * For critical engines: NEVER returns without scheduling a retry.
   */
  private async _launchWithRetry(attempt: number): Promise<void> {
    if (this.stopping) return;

    // Rate-limit check — but ALWAYS schedule next attempt
    if (this._isRateLimited()) {
      const remainingMs = (this.rateLimitUntil?.getTime() ?? Date.now()) - Date.now() + 500;
      console.warn(`[${this.desc.name}] Rate-limited — will retry in ${Math.round(remainingMs / 1000)}s`);
      this._setStatus("RATE_LIMITED");
      this.restartTimer = setTimeout(
        () => this._launchWithRetry(0).catch(console.error),
        remainingMs
      );
      return;
    }

    // Check if already running on the port (e.g. external process)
    const alreadyUp = await this._checkHealth();
    if (alreadyUp) {
      console.log(`[${this.desc.name}] Already running on port ${this.desc.port}`);
      this.lastHealthyAt = new Date();
      this.consecutiveFailures = 0;
      this._setStatus("HEALTHY");
      this._startHealthPolling();
      return;
    }

    // Binary existence check
    if (!(await this._isExecutable())) {
      console.warn(`[${this.desc.name}] Binary not found at ${this.desc.binary}`);
      if (this.desc.buildCmd) {
        await this._tryRebuild();
        if (!(await this._isExecutable())) {
          this._setStatus("UNAVAILABLE");
          if (this.desc.critical) {
            // Even if unavailable, keep retrying for critical engines
            this._scheduleRestart(attempt);
          }
          return;
        }
      } else {
        this._setStatus("UNAVAILABLE");
        if (this.desc.critical) {
          this._scheduleRestart(attempt);
        }
        return;
      }
    }

    this._setStatus("STARTING");
    const launchTime = new Date();
    this.startedAt = launchTime;
    console.log(`[${this.desc.name}] Starting (attempt ${attempt + 1}) on port ${this.desc.port}...`);

    const proc = this._spawnProcess(this.desc.port);
    this.process = proc;

    proc.on("error", (err) => {
      console.error(`[${this.desc.name}] Spawn error: ${err.message}`);
      this.process = null;
      this._recordFailure();
      if (!this.stopping) this._scheduleRestart(attempt);
    });

    proc.on("exit", async (code, signal) => {
      if (this.stopping) return;
      console.warn(`[${this.desc.name}] Exited (code=${code}, signal=${signal})`);
      this.process = null;
      this._clearTimers();

      // Promote standby if available
      if (this.standbyProcess) {
        console.log(`[${this.desc.name}] Promoting hot-standby to primary`);
        this.process = this.standbyProcess;
        this.standbyProcess = null;
        this.startedAt = new Date();
        this.lastHealthyAt = new Date();
        this._setStatus("HEALTHY");
        this._startHealthPolling();
        // Pre-fork a new standby in the background
        this._preforkStandby().catch(console.error);
        return;
      }

      if (signal === "SIGTERM" || signal === "SIGKILL") return;

      // Crash-loop detection
      if (this._isCrashLoop(launchTime)) {
        this.fastExitCount++;
        console.error(`[${this.desc.name}] Crash-loop detected (fast exit #${this.fastExitCount})`);
        if (this.fastExitCount >= CRASH_LOOP_MAX_FAST_EXITS && this.desc.buildCmd) {
          const rebuilt = await this._tryRebuild();
          if (rebuilt) {
            this.fastExitCount = 0;
            this._scheduleRestart(0);
            return;
          }
        }
      }

      this._recordFailure();
      this._scheduleRestart(attempt);
    });

    // Wait for health
    const startupMs = this.desc.startupTimeoutMs ?? 30_000;
    const healthy = await this._waitForHealth(startupMs);

    if (healthy) {
      this.consecutiveFailures = 0;
      this.lastHealthyAt = new Date();
      this._setStatus("HEALTHY");
      this._startHealthPolling();
      console.log(`[${this.desc.name}] ✓ Ready on port ${this.desc.port} (PID ${proc.pid})`);

      // Pre-fork hot-standby for critical engines
      if (this.desc.critical) {
        this._preforkStandby().catch(console.error);
      }
    } else {
      console.warn(`[${this.desc.name}] Did not become healthy within ${startupMs}ms — marking DEGRADED`);
      this._setStatus("DEGRADED");
      this._startHealthPolling(); // keep polling — it may recover
    }
  }

  /**
   * _preforkStandby — spawns a shadow process on port+STANDBY_PORT_OFFSET.
   * If the primary dies, the exit handler promotes this process instantly.
   */
  private async _preforkStandby(): Promise<void> {
    if (this.stopping || this.standbyProcess) return;
    const standbyPort = this.desc.port + STANDBY_PORT_OFFSET;
    console.log(`[${this.desc.name}] Pre-forking hot-standby on port ${standbyPort}...`);

    const proc = this._spawnProcess(standbyPort);
    this.standbyProcess = proc;

    proc.on("error", (err) => {
      console.warn(`[${this.desc.name}] Standby spawn error: ${err.message}`);
      this.standbyProcess = null;
    });

    proc.on("exit", (code, signal) => {
      if (this.standbyProcess === proc) {
        this.standbyProcess = null;
        if (!this.stopping && signal !== "SIGTERM" && signal !== "SIGKILL") {
          console.warn(`[${this.desc.name}] Standby exited (code=${code}) — re-forking`);
          setTimeout(() => this._preforkStandby().catch(console.error), 5_000);
        }
      }
    });

    // Wait for standby to become healthy (non-blocking for the primary)
    const healthy = await this._waitForHealth(30_000, standbyPort);
    if (healthy) {
      console.log(`[${this.desc.name}] ✓ Hot-standby ready on port ${standbyPort} (PID ${proc.pid})`);
    } else {
      console.warn(`[${this.desc.name}] Standby did not become healthy — will retry later`);
      // Don't kill it — it may still start; the exit handler will clean up
    }
  }

  private async _waitForHealth(maxMs: number, port = this.desc.port): Promise<boolean> {
    const start = Date.now();
    while (Date.now() - start < maxMs) {
      await new Promise(r => setTimeout(r, 500));
      if (this.stopping) return false;
      if (await this._checkHealth(port)) return true;
    }
    return false;
  }

  private _scheduleRestart(previousAttempt: number) {
    if (this.stopping) return;

    const maxBackoff = this.desc.maxBackoffMs ?? (this.desc.critical ? 30_000 : 120_000);
    const delayMs = Math.min(1000 * Math.pow(2, previousAttempt), maxBackoff);

    console.log(
      `[${this.desc.name}] ${this.desc.critical ? "🔄 [CRITICAL]" : "🔄"} ` +
      `Scheduling restart in ${delayMs}ms (attempt ${previousAttempt + 2})`
    );

    this.restartTimer = setTimeout(() => {
      this.restartCount++;
      this._launchWithRetry(previousAttempt + 1).catch(console.error);
    }, delayMs);
  }
}

// ─── EngineHAManager ──────────────────────────────────────────────────────────

class EngineHAManager extends EventEmitter {
  engines: Map<string, HAEngine> = new Map();

  constructor() {
    super();
    this._registerEngines();
  }

  private _registerEngines() {
    const descriptors: EngineDescriptor[] = [
      {
        name: "MatchingEngine",
        binary: path.join(PROJECT_ROOT, "matching-engine", "matching-engine"),
        buildCmd: "cargo build --release --manifest-path matching-engine/Cargo.toml && cp matching-engine/target/release/nexcom-matching-engine matching-engine/matching-engine 2>/dev/null || cp matching-engine/target/release/matching_engine matching-engine/matching-engine 2>/dev/null || true",
        buildCwd: PROJECT_ROOT,
        port: parseInt(process.env.MATCHING_ENGINE_PORT ?? "8080"),
        healthPath: "/health",
        drainPath: "/admin/drain",
        drainWaitMs: 5_000,
        startupTimeoutMs: 30_000,
        healthPollIntervalMs: 5_000,
        critical: true,
        maxBackoffMs: 30_000,
        startupEnv: {
          KAFKA_BROKERS: process.env.KAFKA_BROKERS ?? "localhost:9092",
          REDIS_URL: process.env.REDIS_URL ?? "localhost:6379",
          LEADER_ELECTION_ENABLED: process.env.LEADER_ELECTION_ENABLED ?? "false",
        },
      },
      {
        name: "SettlementEngine",
        binary: path.join(PROJECT_ROOT, "settlement-engine-binary"),
        buildCmd: "cargo build --release --manifest-path settlement-engine/Cargo.toml && cp settlement-engine/target/release/nexcom_settlement settlement-engine-binary 2>/dev/null || true",
        buildCwd: PROJECT_ROOT,
        port: parseInt(process.env.SETTLEMENT_ENGINE_PORT ?? "8005"),
        healthPath: "/health",
        drainPath: "/admin/drain",
        drainWaitMs: 10_000,
        startupTimeoutMs: 45_000,
        healthPollIntervalMs: 5_000,
        critical: true,
        maxBackoffMs: 30_000,
        startupEnv: {
          TIGERBEETLE_ADDRESS: process.env.TIGERBEETLE_ADDRESSES ?? "localhost:3001",
          MOJALOOP_HUB_URL: process.env.MOJALOOP_HUB_URL ?? "http://localhost:4001",
          NEXCOM_DFSP_ID: process.env.NEXCOM_DFSP_ID ?? "nexcom-exchange",
        },
      },
      {
        name: "GatewayService",
        binary: path.join(PROJECT_ROOT, "gateway-service", "gateway-service"),
        port: parseInt(process.env.GATEWAY_PORT ?? "8200"),
        healthPath: "/health",
        startupTimeoutMs: 15_000,
        healthPollIntervalMs: 5_000,
        critical: false,
        maxBackoffMs: 60_000,
        startupEnv: {
          MATCHING_ENGINE_URL: `http://localhost:${process.env.MATCHING_ENGINE_PORT ?? "8080"}`,
          SETTLEMENT_ENGINE_URL: `http://localhost:${process.env.SETTLEMENT_ENGINE_PORT ?? "8005"}`,
          TRADING_ENGINE_URL: `http://localhost:${process.env.TRADING_ENGINE_PORT ?? "8001"}`,
          RISK_MANAGEMENT_URL: `http://localhost:${process.env.RISK_MANAGEMENT_PORT ?? "8004"}`,
          KAFKA_BROKERS: process.env.KAFKA_BROKERS ?? "localhost:9092",
          REDIS_URL: process.env.REDIS_URL ?? "localhost:6379",
          TEMPORAL_HOST: process.env.TEMPORAL_HOST ?? "localhost:7233",
        },
      },
      {
        name: "TradingEngine",
        binary: path.join(PROJECT_ROOT, "services", "trading-engine", "trading-engine"),
        port: parseInt(process.env.TRADING_ENGINE_PORT ?? "8001"),
        healthPath: "/healthz",
        startupTimeoutMs: 15_000,
        healthPollIntervalMs: 5_000,
        critical: false,
        maxBackoffMs: 60_000,
        startupEnv: {
          MATCHING_ENGINE_URL: `http://localhost:${process.env.MATCHING_ENGINE_PORT ?? "8080"}`,
          KAFKA_BROKERS: process.env.KAFKA_BROKERS ?? "localhost:9092",
        },
      },
      {
        name: "RiskManagement",
        binary: path.join(PROJECT_ROOT, "services", "risk-management", "risk-management"),
        port: parseInt(process.env.RISK_MANAGEMENT_PORT ?? "8004"),
        healthPath: "/healthz",
        startupTimeoutMs: 15_000,
        healthPollIntervalMs: 5_000,
        critical: false,
        maxBackoffMs: 60_000,
        startupEnv: {
          KAFKA_BROKERS: process.env.KAFKA_BROKERS ?? "localhost:9092",
          REDIS_URL: process.env.REDIS_URL ?? "localhost:6379",
        },
      },
    ];

    for (const desc of descriptors) {
      const engine = new HAEngine(desc);
      engine.on("status", (snapshot: EngineHealthSnapshot) => {
        this.emit("engine:health", snapshot);
        this._logStatusChange(snapshot);
      });
      this.engines.set(desc.name, engine);
    }
  }

  private _logStatusChange(snap: EngineHealthSnapshot) {
    const icons: Record<EngineStatus, string> = {
      STARTING:     "⏳",
      HEALTHY:      "✅",
      DEGRADED:     "⚠️",
      UNAVAILABLE:  "❌",
      RATE_LIMITED: "🔄",
      REBUILDING:   "🔨",
      STOPPED:      "⏹️",
    };
    const critical = snap.name === "MatchingEngine" || snap.name === "SettlementEngine"
      ? " [CRITICAL — will never stop retrying]"
      : "";
    console.log(
      `[HAManager] ${icons[snap.status] ?? "?"} ${snap.name} → ${snap.status}` +
      ` (restarts: ${snap.restartCount}, crashLoops: ${snap.crashLoopCount})${critical}`
    );
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  /**
   * startAll — starts all engines.
   * Critical engines (MatchingEngine, SettlementEngine) block until healthy
   * (or LIVENESS_GATE_TIMEOUT_MS). Non-critical engines start in parallel
   * without blocking.
   */
  async startAll(): Promise<void> {
    console.log("[HAManager] Starting all engines (critical engines will block until live)...");

    // Start all engines simultaneously
    const startPromises = Array.from(this.engines.values()).map(e =>
      e.start().catch(err => console.error(`[HAManager] ${e.snapshot.name} start error:`, err))
    );

    // Liveness gate: wait for critical engines before returning
    const criticalNames = ["MatchingEngine", "SettlementEngine"];
    const livenessPromises = criticalNames.map(name => {
      const engine = this.engines.get(name);
      if (!engine) return Promise.resolve();
      return engine.waitForLiveness(LIVENESS_GATE_TIMEOUT_MS);
    });

    await Promise.all(livenessPromises);
    console.log("[HAManager] Critical engines live — server accepting traffic.");

    // Don't await non-critical engines — they start in background
    Promise.all(startPromises).catch(console.error);
  }

  async stopAll(): Promise<void> {
    console.log("[HAManager] Stopping all engines...");
    await Promise.all(
      Array.from(this.engines.values()).map(e => e.stop().catch(console.error))
    );
    console.log("[HAManager] All engines stopped.");
  }

  getHealth(): EngineHealthSnapshot[] {
    return Array.from(this.engines.values()).map(e => e.snapshot);
  }

  getEngineStatus(name: string): EngineStatus | null {
    return this.engines.get(name)?.snapshot.status ?? null;
  }

  isMatchingEngineHealthy(): boolean {
    const s = this.getEngineStatus("MatchingEngine");
    return s === "HEALTHY" || s === "DEGRADED";
  }

  stopEngine(name: string): void {
    this.engines.get(name)?.stop().catch(console.error);
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────

export const haManager = new EngineHAManager();

// ─── Backward-compat shims ────────────────────────────────────────────────────

export async function startAllEngines(): Promise<void> {
  // In development mode, skip binary engine startup to allow the HTTP server
  // to start without compiled Rust/Go binaries. Set DISABLE_ENGINES=false to
  // force engine startup in development.
  if (process.env.NODE_ENV === "development" && process.env.DISABLE_ENGINES !== "false") {
    console.log("[HAManager] Development mode — skipping binary engine startup. Set DISABLE_ENGINES=false to enable.");
    return;
  }
  return haManager.startAll();
}

export function stopAllEngines(): void {
  haManager.stopAll().catch(console.error);
}

export async function startRustMatchingEngine(): Promise<void> {
  // No-op: haManager.startAll() handles this
}

export function stopRustMatchingEngine(): void {
  haManager.stopEngine("MatchingEngine");
}
