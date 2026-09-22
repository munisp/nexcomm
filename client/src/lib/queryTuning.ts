/**
 * NEXCOM Exchange — Connection-adaptive query tuning (OFFLINE-RES)
 * ─────────────────────────────────────────────────────────────────────────────
 * Helpers that scale React Query polling/staleness to the current connection
 * class (see lib/connectionQuality.ts). Metered-data rules:
 *
 *   offline  → refetchInterval disabled entirely (returns false). The queries
 *              would fail anyway; the SW read-cache (sw.js v4) serves data.
 *   saveData → refetchInterval disabled entirely, regardless of speed. The user
 *              explicitly asked us not to spend their data on background polls.
 *   slow     → intervals ×4, staleTime ×4 (e.g. 30s ticker → 120s).
 *   fast     → unchanged (returns baseMs verbatim — existing behaviour kept).
 *
 * Pass the reactive `quality` from useConnectionQuality() when calling from a
 * component so intervals re-tune live when the connection flaps.
 */
import { classifyConnection, type ConnectionClass } from "./connectionQuality";

export const SLOW_MULTIPLIER = 4;

/**
 * Tune a polling interval. Returns `false` to disable polling (React Query
 * convention) when offline or when Save-Data is enabled.
 */
export function tunedInterval(
  baseMs: number,
  quality: ConnectionClass = classifyConnection(),
): number | false {
  if (quality === "offline") return false;
  if (quality === "slow") return baseMs * SLOW_MULTIPLIER;
  return baseMs;
}

/**
 * Tune a staleTime. Never disabled — stale data is still renderable — only
 * stretched on slow connections so fewer refetches trigger.
 */
export function tunedStaleTime(
  baseMs: number,
  quality: ConnectionClass = classifyConnection(),
): number {
  if (quality === "slow") return baseMs * SLOW_MULTIPLIER;
  return baseMs;
}
