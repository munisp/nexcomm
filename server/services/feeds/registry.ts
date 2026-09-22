/**
 * registry.ts — feed registry, scheduler, circuit breaker, stale serving.
 *
 * Design (offline-first, Nigeria mandate):
 *  - Every successful fetch is persisted to market_feed_snapshots (durable),
 *    cached fresh with the adapter TTL, AND written to a "lastKnownGood" key
 *    that effectively never expires (1-year Redis TTL + in-process mirror).
 *  - getSnapshot() serves fresh cache first; on outage it serves
 *    last-known-good with { stale: true, servedAt } so the UI can badge it.
 *  - Per-feed setTimeout chain with ±20% jitter; on failure the interval
 *    backs off exponentially (base × 2^failures, capped at 15 min).
 *  - Circuit breaker: 5 consecutive failures open the circuit for 5 min,
 *    then a single half-open probe decides close vs re-open.
 *  - A scheduler tick never throws — errors are caught and recorded in health.
 */
import { z } from "zod";
import { desc, eq, and } from "drizzle-orm";
import { cacheGet, cacheSet } from "../../cache";
import { getDb } from "../../db";
import { marketFeedSnapshots } from "../../../drizzle/schema-feeds";
import type { FeedAdapter, FeedHealth, FeedSnapshot, CircuitState, SnapshotResult } from "./types";
import { openMeteoAdapter } from "./adapters/openMeteo";
import { afexPricesAdapter } from "./adapters/afexPrices";
import { nbsStatsAdapter } from "./adapters/nbsStats";
import { manualCsvAdapter } from "./adapters/manualCsv";

// ─── Snapshot validation (zod, before persist) ────────────────────────────────

const snapshotSchema = z.object({
  feed: z.string().min(1).max(64),
  symbol: z.string().max(64).optional(),
  region: z.string().max(128).optional(),
  payload: z.record(z.string(), z.unknown()),
  fetchedAt: z.date(),
  validUntil: z.date().optional(),
});

// ─── Adapter catalog (drop-in point for new feeds) ────────────────────────────

const ADAPTER_CATALOG: Record<string, FeedAdapter> = {
  openmeteo: openMeteoAdapter,
  afex: afexPricesAdapter,
  nbs: nbsStatsAdapter,
  manual_csv: manualCsvAdapter,
};

// ─── Tunables ─────────────────────────────────────────────────────────────────

const MAX_BACKOFF_SECONDS = 15 * 60;        // exponential backoff cap: 15 min
const BREAKER_THRESHOLD = 5;                // consecutive failures → open
const BREAKER_COOLDOWN_MS = 5 * 60 * 1000;  // open → half-open probe after 5 min
const LKG_TTL_SECONDS = 365 * 24 * 60 * 60; // last-known-good "never expires"
const JITTER = 0.2;                          // ±20%

// ─── Cache keys ───────────────────────────────────────────────────────────────

const keyOf = (s: Pick<FeedSnapshot, "symbol" | "region">) => s.symbol ?? s.region ?? "_";
const freshKey = (feed: string, key: string) => `feeds:fresh:${feed}:${key}`;
const lkgKey = (feed: string, key: string) => `feeds:lkg:${feed}:${key}`;

// ─── Per-feed runtime state ───────────────────────────────────────────────────

interface FeedState {
  adapter: FeedAdapter;
  timer: ReturnType<typeof setTimeout> | null;
  consecutiveFailures: number;
  circuit: CircuitState;
  circuitOpenedAt: number;
  lastSuccessAt?: Date;
  lastError?: string;
  /** In-process last-known-good mirror (survives Redis outage, not restarts). */
  lkgMemory: Map<string, FeedSnapshot>;
  /** Every cache key ever produced by this feed (for list endpoints). */
  knownKeys: Set<string>;
}

const states = new Map<string, FeedState>();
let started = false;

export function enabledFeedNames(): string[] {
  const raw = (process.env.FEEDS_ENABLED ?? "openmeteo").trim();
  if (!raw) return [];
  if (raw === "*") return Object.keys(ADAPTER_CATALOG);
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

function buildState(adapter: FeedAdapter): FeedState {
  return {
    adapter,
    timer: null,
    consecutiveFailures: 0,
    circuit: "closed",
    circuitOpenedAt: 0,
    lkgMemory: new Map(),
    knownKeys: new Set(),
  };
}

/** Active adapters: in catalog, in FEEDS_ENABLED, and configured (isEnabled). */
export function activeAdapters(): FeedAdapter[] {
  const out: FeedAdapter[] = [];
  for (const name of enabledFeedNames()) {
    const adapter = ADAPTER_CATALOG[name];
    if (!adapter) {
      console.warn(`[Feeds] FEEDS_ENABLED lists unknown feed "${name}" — ignoring`);
      continue;
    }
    if (!adapter.isEnabled()) {
      console.log(`[Feeds] Feed "${name}" not configured — skipping (graceful)`);
      continue;
    }
    out.push(adapter);
    if (!states.has(name)) states.set(name, buildState(adapter));
  }
  return out;
}

// ─── Persistence + caching ────────────────────────────────────────────────────

async function persistSnapshots(state: FeedState, snapshots: FeedSnapshot[]): Promise<void> {
  const db = await getDb().catch(() => null);
  for (const snap of snapshots) {
    const parsed = snapshotSchema.safeParse(snap);
    if (!parsed.success) {
      console.warn(`[Feeds] ${snap.feed} snapshot failed validation — skipped:`, parsed.error.issues[0]?.message);
      continue;
    }
    const key = keyOf(snap);
    state.knownKeys.add(key);
    state.lkgMemory.set(key, snap);

    if (db) {
      try {
        await db.insert(marketFeedSnapshots).values({
          feed: snap.feed,
          symbol: snap.symbol ?? null,
          region: snap.region ?? null,
          payload: snap.payload,
          fetchedAt: snap.fetchedAt,
          validUntil: snap.validUntil ?? null,
        });
      } catch (err) {
        console.warn(`[Feeds] ${snap.feed} DB persist failed (non-fatal):`, (err as Error).message);
      }
    }
    // Fresh cache (TTL) — fire and forget; last-known-good (effectively no expiry)
    await cacheSet(freshKey(snap.feed, key), snap, state.adapter.ttlSeconds).catch(() => {});
    await cacheSet(lkgKey(snap.feed, key), snap, LKG_TTL_SECONDS).catch(() => {});
  }
}

// ─── Scheduler: jitter + exponential backoff + circuit breaker ────────────────

function nextDelayMs(state: FeedState): number {
  const base = state.adapter.intervalSeconds;
  const backoff = Math.min(base * 2 ** state.consecutiveFailures, MAX_BACKOFF_SECONDS);
  const jittered = backoff * (1 + (Math.random() * 2 - 1) * JITTER);
  return Math.max(1_000, Math.round(jittered * 1000));
}

async function tick(state: FeedState): Promise<void> {
  const { adapter } = state;

  // Circuit open → wait for cooldown, then allow one half-open probe.
  if (state.circuit === "open") {
    if (Date.now() - state.circuitOpenedAt < BREAKER_COOLDOWN_MS) return;
    state.circuit = "half-open";
    console.log(`[Feeds] ${adapter.name}: circuit half-open — probing`);
  }

  try {
    const snapshots = await adapter.fetch();
    if (snapshots.length === 0) throw new Error("fetch returned no snapshots");
    await persistSnapshots(state, snapshots);

    state.consecutiveFailures = 0;
    state.lastSuccessAt = new Date();
    state.lastError = undefined;
    if (state.circuit !== "closed") {
      console.log(`[Feeds] ${adapter.name}: circuit closed — recovered`);
      state.circuit = "closed";
    }
    console.log(`[Feeds] ${adapter.name}: ${snapshots.length} snapshot(s) refreshed`);
  } catch (err) {
    // Never throw out of the tick — record health and move on.
    state.consecutiveFailures++;
    state.lastError = (err as Error).message;
    const halfOpenProbe = state.circuit === "half-open";
    if (halfOpenProbe || state.consecutiveFailures >= BREAKER_THRESHOLD) {
      if (!halfOpenProbe) {
        console.error(
          `[Feeds] ${adapter.name}: circuit OPEN after ${state.consecutiveFailures} failure(s) — last error: ${state.lastError}`
        );
      }
      state.circuit = "open";
      state.circuitOpenedAt = Date.now();
    } else {
      console.warn(`[Feeds] ${adapter.name}: fetch failed (${state.consecutiveFailures}/${BREAKER_THRESHOLD}): ${state.lastError}`);
    }
  }
}

function schedule(state: FeedState): void {
  const delay = nextDelayMs(state);
  state.timer = setTimeout(async () => {
    await tick(state).catch((err) => console.error(`[Feeds] ${state.adapter.name} tick error:`, err));
    if (started) schedule(state);
  }, delay);
  state.timer.unref?.(); // unref so tests / graceful shutdown never hang
}

// ─── Public lifecycle ─────────────────────────────────────────────────────────

export function startFeedRegistry(): void {
  if (started) return;
  started = true;
  const adapters = activeAdapters();
  if (adapters.length === 0) {
    console.log("[Feeds] No feeds enabled/configured — registry idle");
    return;
  }
  for (const adapter of adapters) {
    const state = states.get(adapter.name)!;
    // Immediate first tick (staggered by jitter), then recurring schedule.
    tick(state).catch((err) => console.error(`[Feeds] ${adapter.name} initial tick error:`, err));
    schedule(state);
    console.log(`[Feeds] ${adapter.name} started (kind=${adapter.kind}, interval=${adapter.intervalSeconds}s, ttl=${adapter.ttlSeconds}s)`);
  }
}

export function stopFeedRegistry(): void {
  started = false;
  for (const state of states.values()) {
    if (state.timer) {
      clearTimeout(state.timer);
      state.timer = null;
    }
  }
  console.log("[Feeds] Registry stopped");
}

// ─── Reads: fresh → last-known-good → DB ──────────────────────────────────────

function toResult(snap: FeedSnapshot, stale: boolean, source: SnapshotResult["source"]): SnapshotResult {
  return {
    feed: snap.feed,
    symbol: snap.symbol,
    region: snap.region,
    payload: snap.payload,
    fetchedAt: snap.fetchedAt.toISOString(),
    validUntil: snap.validUntil?.toISOString(),
    stale,
    servedAt: new Date().toISOString(),
    source,
  };
}

function isFresh(snap: FeedSnapshot, ttlSeconds: number): boolean {
  const now = Date.now();
  if (snap.validUntil) return snap.validUntil.getTime() > now;
  return now - snap.fetchedAt.getTime() <= ttlSeconds * 1000;
}

/**
 * getSnapshot(feed, symbol?) — fresh cache else last-known-good (stale-marked).
 * Key defaults to "_" for singleton feeds.
 */
export async function getSnapshot(feed: string, symbol?: string): Promise<SnapshotResult | null> {
  const key = symbol ?? "_";
  const adapter = ADAPTER_CATALOG[feed];
  const ttl = adapter?.ttlSeconds ?? 3600;
  const state = states.get(feed);

  // 1. Fresh cache
  const fresh = await cacheGet<FeedSnapshot>(freshKey(feed, key)).catch(() => null);
  if (fresh && isFresh({ ...fresh, fetchedAt: new Date(fresh.fetchedAt), validUntil: fresh.validUntil ? new Date(fresh.validUntil) : undefined }, ttl)) {
    return toResult(rehydrate(fresh), false, "cache");
  }

  // 2. Last-known-good (Redis, then in-process mirror)
  const lkg = await cacheGet<FeedSnapshot>(lkgKey(feed, key)).catch(() => null);
  if (lkg) return toResult(rehydrate(lkg), true, "lastKnownGood");
  const mem = state?.lkgMemory.get(key);
  if (mem) return toResult(mem, true, "lastKnownGood");

  // 3. Durable store — latest row (the DB is the ultimate last-known-good)
  const fromDb = await latestFromDb(feed, key);
  if (fromDb) {
    return toResult(fromDb, !isFresh(fromDb, ttl), "db");
  }
  return null;
}

function rehydrate(snap: FeedSnapshot): FeedSnapshot {
  return {
    ...snap,
    fetchedAt: snap.fetchedAt instanceof Date ? snap.fetchedAt : new Date(snap.fetchedAt),
    validUntil: snap.validUntil
      ? snap.validUntil instanceof Date
        ? snap.validUntil
        : new Date(snap.validUntil)
      : undefined,
  };
}

async function latestFromDb(feed: string, key: string): Promise<FeedSnapshot | null> {
  const db = await getDb().catch(() => null);
  if (!db) return null;
  try {
    const cond =
      key === "_"
        ? eq(marketFeedSnapshots.feed, feed)
        : and(eq(marketFeedSnapshots.feed, feed), eq(marketFeedSnapshots.symbol, key));
    const [row] = await db
      .select()
      .from(marketFeedSnapshots)
      .where(cond)
      .orderBy(desc(marketFeedSnapshots.fetchedAt))
      .limit(1);
    if (!row) return null;
    return {
      feed: row.feed,
      symbol: row.symbol ?? undefined,
      region: row.region ?? undefined,
      payload: row.payload as Record<string, unknown>,
      fetchedAt: row.fetchedAt,
      validUntil: row.validUntil ?? undefined,
    };
  } catch {
    return null;
  }
}

/**
 * All current snapshots for a feed, one per known key (symbol/region).
 * Union of runtime-known keys and distinct DB symbols; each resolved through
 * the fresh → LKG → DB chain so outage serving is consistent.
 */
export async function getAllSnapshots(feed: string): Promise<SnapshotResult[]> {
  const keys = new Set<string>(states.get(feed)?.knownKeys ?? []);
  const db = await getDb().catch(() => null);
  if (db) {
    try {
      const rows = await db
        .selectDistinct({ symbol: marketFeedSnapshots.symbol })
        .from(marketFeedSnapshots)
        .where(eq(marketFeedSnapshots.feed, feed));
      for (const r of rows) keys.add(r.symbol ?? "_");
    } catch { /* fall through to runtime-known keys */ }
  }
  const out: SnapshotResult[] = [];
  for (const key of keys) {
    const snap = await getSnapshot(feed, key === "_" ? undefined : key);
    if (snap) out.push(snap);
  }
  return out;
}

// ─── Health ───────────────────────────────────────────────────────────────────

export function getFeedHealth(): FeedHealth[] {
  const now = Date.now();
  return Object.values(ADAPTER_CATALOG).map((adapter) => {
    const state = states.get(adapter.name);
    let lastKnownGoodAgeSeconds: number | undefined;
    if (state) {
      for (const snap of state.lkgMemory.values()) {
        const age = Math.floor((now - snap.fetchedAt.getTime()) / 1000);
        lastKnownGoodAgeSeconds =
          lastKnownGoodAgeSeconds === undefined ? age : Math.min(lastKnownGoodAgeSeconds, age);
      }
    }
    return {
      name: adapter.name,
      kind: adapter.kind,
      enabled: enabledFeedNames().includes(adapter.name) && adapter.isEnabled(),
      circuit: state?.circuit ?? "closed",
      lastSuccessAt: state?.lastSuccessAt?.toISOString(),
      lastError: state?.lastError,
      consecutiveFailures: state?.consecutiveFailures ?? 0,
      lastKnownGoodAgeSeconds,
      currentIntervalSeconds: state
        ? Math.min(
            adapter.intervalSeconds * 2 ** state.consecutiveFailures,
            MAX_BACKOFF_SECONDS
          )
        : adapter.intervalSeconds,
    };
  });
}
