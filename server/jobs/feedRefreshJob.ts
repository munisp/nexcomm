/**
 * feedRefreshJob.ts — starts the pluggable external data-feed schedulers.
 *
 * Thin lifecycle wrapper around server/services/feeds/registry.ts, following
 * the established jobs pattern (start/stop pair, idempotent start, unref'd
 * timers inside the registry so tests and graceful shutdown never hang).
 *
 * Enabled feeds come from FEEDS_ENABLED (comma list, default "openmeteo").
 * A scheduler tick never throws — failures are caught in the registry and
 * recorded in feed health with exponential backoff + circuit breaking.
 */
import { startFeedRegistry, stopFeedRegistry } from "../services/feeds/registry";

let _running = false;

export function startFeedRefreshJob(): void {
  if (_running) return; // already running
  _running = true;

  console.log("[FeedRefresh] Starting external data-feed registry (FEEDS_ENABLED=%s)",
    process.env.FEEDS_ENABLED ?? "openmeteo");
  startFeedRegistry();
}

export function stopFeedRefreshJob(): void {
  if (!_running) return;
  _running = false;
  stopFeedRegistry();
}
