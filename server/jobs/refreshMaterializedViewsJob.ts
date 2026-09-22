/**
 * NEXCOM Exchange — Materialized View Refresh Job (PERF-DB)
 *
 * Refreshes the dashboard/analytics materialized views created by migration
 * 0081_performance_indexes on a fixed cadence (default 60s, env
 * MV_REFRESH_SECONDS). Staleness budget: 60s — dashboard tickers and
 * portfolio cards may lag reality by at most one refresh interval.
 *
 * Behaviour:
 *  - REFRESH MATERIALIZED VIEW CONCURRENTLY (non-blocking reads) with a
 *    one-time-logged fallback to plain REFRESH if CONCURRENTLY fails
 *    (e.g. MV created but never initially refreshed, or unique index missing).
 *  - Skips silently when the database is unreachable (getDb() returns null).
 *  - Missing MVs (migration not applied yet) are logged once, not every tick.
 *  - Timer is unref'd so it never keeps the Node process alive.
 *
 * Wired up in server/_core/index.ts via startRefreshMaterializedViewsJob().
 */

import { sql } from "drizzle-orm";
import { getDb } from "../db";

const REFRESH_INTERVAL_MS =
  Math.max(10, Number(process.env.MV_REFRESH_SECONDS ?? 60)) * 1000;

const MATERIALIZED_VIEWS = [
  "mv_market_summary_24h",
  "mv_trader_portfolio_summary",
] as const;

let refreshTimer: ReturnType<typeof setInterval> | null = null;
let refreshing = false; // overlap guard: never run two refreshes at once
let loggedConcurrentFallback = false;
let loggedMissingView = false;

async function refreshOne(view: string): Promise<void> {
  const db = await getDb();
  if (!db) return; // DB unreachable — skip this tick silently

  try {
    await db.execute(
      sql.raw(`REFRESH MATERIALIZED VIEW CONCURRENTLY ${view}`)
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);

    // MV doesn't exist (migration not applied) — log once, stop retrying loudly.
    if (msg.includes("does not exist")) {
      if (!loggedMissingView) {
        loggedMissingView = true;
        console.warn(
          `[RefreshMaterializedViewsJob] ${view} missing — apply migration 0081_performance_indexes`
        );
      }
      return;
    }

    // CONCURRENTLY requires the MV to be populated and have a unique index;
    // fall back to a plain (locking) refresh once and log it once.
    if (!loggedConcurrentFallback) {
      loggedConcurrentFallback = true;
      console.warn(
        `[RefreshMaterializedViewsJob] CONCURRENT refresh failed for ${view} (${msg}); falling back to plain REFRESH`
      );
    }
    await db.execute(sql.raw(`REFRESH MATERIALIZED VIEW ${view}`));
  }
}

async function refreshAll(): Promise<void> {
  if (refreshing) return; // previous tick still running — skip
  refreshing = true;
  try {
    for (const view of MATERIALIZED_VIEWS) {
      await refreshOne(view);
    }
  } catch (err) {
    console.error("[RefreshMaterializedViewsJob] Unexpected error:", err);
  } finally {
    refreshing = false;
  }
}

/**
 * Start the materialized view refresh job.
 * Returns a stop function that cancels the interval.
 */
export function startRefreshMaterializedViewsJob(): () => void {
  // First refresh shortly after boot (let migrations/seed settle), then on cadence.
  const bootTimer = setTimeout(() => {
    refreshAll().catch(() => {});
  }, 10_000);
  bootTimer.unref?.();

  refreshTimer = setInterval(() => {
    refreshAll().catch(() => {});
  }, REFRESH_INTERVAL_MS);
  refreshTimer.unref?.();

  console.log(
    `[RefreshMaterializedViewsJob] Started — refreshing ${MATERIALIZED_VIEWS.join(", ")} every ${REFRESH_INTERVAL_MS / 1000}s`
  );

  return stopRefreshMaterializedViewsJob;
}

/** Stop the refresh job (exported for tests / graceful shutdown). */
export function stopRefreshMaterializedViewsJob(): void {
  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = null;
  }
}
