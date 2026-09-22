/**
 * types.ts — Pluggable external data-feed framework (DATA-FEEDS)
 *
 * Provider-pattern contracts. A new feed is a drop-in: implement FeedAdapter,
 * register it in registry.ts ADAPTER_CATALOG, and enable it via FEEDS_ENABLED.
 *
 * Kinds:
 *  - "weather"         — agro-meteorological data (Open-Meteo etc.)
 *  - "reference_price" — external reference prices (AFEX, operator CSV, boards)
 *  - "statistics"      — official statistics (NBS food CPI etc.)
 *  - "custom"          — anything else
 */

export type FeedKind = "weather" | "reference_price" | "statistics" | "custom";

/** One normalized observation produced by an adapter fetch cycle. */
export interface FeedSnapshot {
  /** Adapter/feed name, e.g. "openmeteo", "afex", "nbs", "manual_csv". */
  feed: string;
  /** Optional series key — commodity symbol, location key, stat series id. */
  symbol?: string;
  /** Optional region/state label, e.g. "Kano". */
  region?: string;
  /** Normalized, JSON-serializable payload (validated with zod pre-persist). */
  payload: Record<string, unknown>;
  /** When the upstream was fetched. */
  fetchedAt: Date;
  /** Optional freshness horizon; past this the snapshot is treated as stale. */
  validUntil?: Date;
}

export interface FeedAdapter {
  /** Unique feed name (matches FeedSnapshot.feed). */
  readonly name: string;
  readonly kind: FeedKind;
  /** Cache TTL for fresh snapshots (seconds). */
  readonly ttlSeconds: number;
  /** Base poll interval (seconds) before backoff/jitter is applied. */
  readonly intervalSeconds: number;
  /** False when required config is absent — feed is skipped, not an error. */
  isEnabled(): boolean;
  /** Fetch and normalize the current snapshot set. Must not throw — return [] on failure. */
  fetch(): Promise<FeedSnapshot[]>;
}

export type CircuitState = "closed" | "open" | "half-open";

export interface FeedHealth {
  name: string;
  kind: FeedKind;
  enabled: boolean;
  circuit: CircuitState;
  lastSuccessAt?: string;
  lastError?: string;
  consecutiveFailures: number;
  /** Age of the last-known-good snapshot in seconds, undefined when none. */
  lastKnownGoodAgeSeconds?: number;
  /** Effective interval currently in force (backoff applied), seconds. */
  currentIntervalSeconds: number;
}

/** Wrapper returned by getSnapshot — marks stale (last-known-good) serves. */
export interface SnapshotResult<T = Record<string, unknown>> {
  feed: string;
  symbol?: string;
  region?: string;
  payload: T;
  fetchedAt: string;
  validUntil?: string;
  /** True when served from last-known-good because fresh data is unavailable. */
  stale: boolean;
  /** Server time when this response was assembled. */
  servedAt: string;
  /** Where the data came from: live cache, last-known-good cache, or DB. */
  source: "cache" | "lastKnownGood" | "db" | "none";
}
