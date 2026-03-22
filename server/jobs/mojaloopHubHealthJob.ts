/**
 * NEXCOM Exchange — Mojaloop Hub Health Polling Job
 *
 * Polls the Go mojaloop-adapter /health endpoint every 5 minutes.
 * If the hub transitions from ONLINE → OFFLINE (or vice versa), sends
 * an owner notification via the built-in notification API.
 *
 * State is kept in memory; on restart it re-establishes baseline on first poll.
 */

import { notifyOwner } from "../_core/notification";

const ADAPTER_URL =
  process.env.MOJALOOP_ADAPTER_URL ?? "http://localhost:4001";
const POLL_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const REQUEST_TIMEOUT_MS = 8_000;

interface HubHealthResponse {
  status: string; // "ok" | "degraded" | "error"
  mode: string; // "live" | "standalone"
  hub_reachable: boolean;
  latency_ms: number;
  uptime_seconds: number;
}

let lastHubReachable: boolean | null = null; // null = unknown (first poll)
let pollTimer: ReturnType<typeof setInterval> | null = null;

async function pollHubHealth(): Promise<void> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    let health: HubHealthResponse;
    try {
      const res = await fetch(`${ADAPTER_URL}/health`, {
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      health = (await res.json()) as HubHealthResponse;
    } catch {
      clearTimeout(timeout);
      // Adapter itself is unreachable — treat as hub offline
      health = {
        status: "error",
        mode: "standalone",
        hub_reachable: false,
        latency_ms: -1,
        uptime_seconds: 0,
      };
    }

    const currentlyReachable = health.hub_reachable;

    // First poll — establish baseline silently
    if (lastHubReachable === null) {
      lastHubReachable = currentlyReachable;
      if (!currentlyReachable) {
        // Notify on startup if hub is already down
        await notifyOwner({
          title: "⚠️ Mojaloop Hub Offline at Startup",
          content:
            `The Mojaloop Hub is unreachable at startup. ` +
            `Adapter mode: ${health.mode}. ` +
            `The platform is running in standalone fallback mode. ` +
            `Check the Central Ledger and ML API Adapter containers.`,
        }).catch(() => {});
      }
      return;
    }

    // Transition: ONLINE → OFFLINE
    if (lastHubReachable && !currentlyReachable) {
      lastHubReachable = false;
      await notifyOwner({
        title: "🔴 Mojaloop Hub Went Offline",
        content:
          `The Mojaloop Hub has become unreachable. ` +
          `Adapter URL: ${ADAPTER_URL}. ` +
          `Mode: ${health.mode}. ` +
          `All interop transfers will be queued in standalone mode until the hub recovers. ` +
          `Immediate action required: check Central Ledger (port 3001) and ML API Adapter (port 3000).`,
      }).catch(() => {});
    }

    // Transition: OFFLINE → ONLINE
    if (!lastHubReachable && currentlyReachable) {
      lastHubReachable = true;
      await notifyOwner({
        title: "✅ Mojaloop Hub Back Online",
        content:
          `The Mojaloop Hub is reachable again. ` +
          `Latency: ${health.latency_ms}ms. ` +
          `Mode: ${health.mode}. ` +
          `Queued standalone transfers may need to be replayed from the Reconciliation Report.`,
      }).catch(() => {});
    }
  } catch (err) {
    // Non-critical — log and continue
    console.error("[MojaloopHubHealthJob] Unexpected error:", err);
  }
}

/**
 * Start the Mojaloop Hub health polling job.
 * Returns a stop function that cancels the interval.
 */
export function startMojaloopHubHealthJob(): () => void {
  // Run immediately on startup, then every POLL_INTERVAL_MS
  pollHubHealth().catch(() => {});
  pollTimer = setInterval(() => {
    pollHubHealth().catch(() => {});
  }, POLL_INTERVAL_MS);

  console.log(
    `[MojaloopHubHealthJob] Started — polling ${ADAPTER_URL}/health every ${POLL_INTERVAL_MS / 1000}s`
  );

  return () => {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  };
}
