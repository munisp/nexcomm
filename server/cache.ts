/**
 * cache.ts — Redis-backed cache layer for NEXCOM Exchange
 *
 * Provides:
 *  - get/set/del with TTL
 *  - getOrSet (cache-aside pattern)
 *  - cacheWrap (SWR + single-flight stampede protection + LRU fallback)
 *  - invalidatePattern (glob-style key invalidation)
 *  - Graceful fallback to in-memory LRU when Redis is unavailable
 *  - Prometheus-style hit/miss counters (logged every 60s)
 *
 * Hot paths cached:
 *  - livePrices.getAll          → 5s TTL  (price feed)
 *  - commodities.list           → 30s TTL
 *  - indices.list               → 30s TTL
 *  - portfolio.summary:{userId} → 10s TTL
 *  - orderBook:{symbol}         → 2s TTL  (order book depth)
 *  - user:{userId}              → 60s TTL (profile)
 *  - marketData.history:{sym}   → 60s TTL
 */

import Redis from "ioredis";

export class CacheUnavailableError extends Error {
  constructor(message = "Redis is unavailable for a required durable operation") {
    super(message);
    this.name = "CacheUnavailableError";
  }
}

// ─── Config ───────────────────────────────────────────────────────────────────

const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";

// ─── Client ───────────────────────────────────────────────────────────────────

let _client: Redis | null = null;
let _available = false;
/**
 * Fast-fail window: after a Redis failure we skip Redis for REPROBE_MS and
 * serve from the in-memory LRU instead. The ioredis reconnect loop keeps
 * running in the background and flips `_available` back on "connect".
 */
let _downUntil = 0;
const REPROBE_MS = 5_000;

/** Lazy-initialise the Redis client. Returns null if Redis is unavailable. */
function getClient(): Redis | null {
  if (_client) {
    if (_available) return _client;
    // Honour the re-probe cooldown; once expired, allow one attempt through so
    // recovery is detected quickly even if the "connect" event was missed.
    if (Date.now() < _downUntil) return null;
    if (_client.status === "ready") {
      _available = true; // recovered — resume normal Redis serving
      return _client;
    }
    return null;
  }

  try {
    _client = new Redis(REDIS_URL, {
      maxRetriesPerRequest: 1,
      connectTimeout: 2_000,
      lazyConnect: true,
      enableOfflineQueue: false,
    });

    _client.on("connect", () => {
      _available = true;
      console.log("[Cache] Redis connected:", REDIS_URL.replace(/:[^@]+@/, ":***@"));
    });

    _client.on("error", (err: Error) => {
      if (_available) {
        console.warn("[Cache] Redis error — falling back to in-memory LRU:", err.message);
      }
      _available = false;
      _downUntil = Date.now() + REPROBE_MS;
    });

    _client.on("close", () => {
      _available = false;
    });

    _client.connect().catch(() => {
      _available = false;
    });
  } catch {
    _available = false;
  }

  return _available ? _client : null;
}

// ─── Stats ────────────────────────────────────────────────────────────────────

const stats = { hits: 0, misses: 0, errors: 0, staleHits: 0, fallbackHits: 0 };

/** Marks Redis as failed: flips availability off and starts the re-probe window. */
function markRedisDown(): void {
  _available = false;
  _downUntil = Date.now() + REPROBE_MS;
  stats.errors++;
}

// ─── In-memory LRU fallback (TTL-aware, max 500 entries) ─────────────────────
// Automatically used when Redis is down so hot reads keep working degraded.
// cacheSet writes through to the LRU so the fallback is always warm.

const LRU_MAX_ENTRIES = 500;

interface LruEntry {
  raw: string;      // JSON-serialised payload (same bytes Redis would hold)
  expiresAt: number;
}

const _lru = new Map<string, LruEntry>();

function lruGet(key: string): string | null {
  const entry = _lru.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    _lru.delete(key);
    return null;
  }
  // Refresh recency (Map preserves insertion order)
  _lru.delete(key);
  _lru.set(key, entry);
  return entry.raw;
}

function lruSet(key: string, raw: string, ttlSeconds: number): void {
  _lru.delete(key);
  _lru.set(key, { raw, expiresAt: Date.now() + ttlSeconds * 1_000 });
  // Evict least-recently-used entries beyond the cap
  while (_lru.size > LRU_MAX_ENTRIES) {
    const oldest = _lru.keys().next().value;
    if (oldest === undefined) break;
    _lru.delete(oldest);
  }
}

function lruDel(key: string): void {
  _lru.delete(key);
}

/** Delete LRU entries matching a glob-style pattern (only `*` wildcards). */
function lruDelPattern(pattern: string): number {
  const regex = new RegExp("^" + pattern.split("*").map(escapeRegExp).join(".*") + "$");
  let deleted = 0;
  for (const key of _lru.keys()) {
    if (regex.test(key)) {
      _lru.delete(key);
      deleted++;
    }
  }
  return deleted;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

setInterval(() => {
  const total = stats.hits + stats.misses;
  if (total > 0) {
    const hitRate = ((stats.hits / total) * 100).toFixed(1);
    console.log(`[Cache] Stats — hits: ${stats.hits}, misses: ${stats.misses}, stale: ${stats.staleHits}, fallback-hits: ${stats.fallbackHits}, errors: ${stats.errors}, hit-rate: ${hitRate}%, redisUp: ${_available}, lruSize: ${_lru.size}`);
  }
}, 60_000).unref();

// ─── Core API ─────────────────────────────────────────────────────────────────

/**
 * SWR envelope written by cacheWrap. cacheGet transparently unwraps envelopes
 * so callers that use the plain cache-aside API never see the wrapper shape.
 */
interface SwrEnvelope {
  __swr: 1;
  v: unknown;
  /** Epoch ms until which the value is fresh. */
  freshUntil: number;
  /** Epoch ms until which the value may still be served stale. */
  staleUntil: number;
}

function isSwrEnvelope(x: unknown): x is SwrEnvelope {
  return (
    typeof x === "object" && x !== null &&
    (x as SwrEnvelope).__swr === 1 &&
    typeof (x as SwrEnvelope).freshUntil === "number"
  );
}

/**
 * Get a cached value. Returns null on miss or Redis unavailable.
 * Falls back to the in-memory LRU when Redis is down.
 * SWR envelopes are unwrapped; stale envelope payloads count as a miss here.
 */
export async function cacheGet<T>(key: string): Promise<T | null> {
  const client = getClient();
  if (client) {
    try {
      const raw = await client.get(key);
      if (raw !== null) {
        const parsed: unknown = JSON.parse(raw);
        if (isSwrEnvelope(parsed)) {
          if (parsed.freshUntil > Date.now()) {
            stats.hits++;
            return parsed.v as T;
          }
          stats.misses++;
          return null;
        }
        stats.hits++;
        return parsed as T;
      }
    } catch {
      markRedisDown();
    }
  }
  // Redis down (or errored) — serve from the LRU fallback
  const raw = lruGet(key);
  if (raw === null) {
    stats.misses++;
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (isSwrEnvelope(parsed)) {
      if (parsed.freshUntil > Date.now()) {
        stats.hits++;
        stats.fallbackHits++;
        return parsed.v as T;
      }
      stats.misses++;
      return null;
    }
    stats.hits++;
    stats.fallbackHits++;
    return parsed as T;
  } catch {
    stats.misses++;
    return null;
  }
}

/**
 * Set a cached value with a TTL in seconds. Silently fails if Redis unavailable.
 * Always writes through to the in-memory LRU so the Redis-down fallback stays warm.
 */
export async function cacheSet<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
  const raw = JSON.stringify(value);
  lruSet(key, raw, ttlSeconds);
  const client = getClient();
  if (!client) return;
  try {
    await client.setex(key, ttlSeconds, raw);
  } catch {
    markRedisDown();
  }
}

/**
 * Waits briefly for the shared Redis connection and throws if it is not usable.
 * Financial and authorization operations use this path; cache degradation is never
 * an acceptable reason to execute a retryable critical effect without idempotency.
 */
async function getRequiredClient(): Promise<Redis> {
  const existing = getClient();
  if (existing) return existing;
  const client = _client;
  if (!client) throw new CacheUnavailableError();

  if (client.status === "wait") {
    try {
      await client.connect();
    } catch {
      throw new CacheUnavailableError();
    }
  } else if (client.status === "connecting") {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new CacheUnavailableError()), 2_000);
      client.once("connect", () => {
        clearTimeout(timer);
        resolve();
      });
      client.once("error", () => {
        clearTimeout(timer);
        reject(new CacheUnavailableError());
      });
    }).catch((error) => {
      throw error instanceof CacheUnavailableError ? error : new CacheUnavailableError();
    });
  }

  if (!_available || client.status !== "ready") throw new CacheUnavailableError();
  return client;
}

/** Atomically stores a value only when the key is absent. Throws on Redis failure. */
export async function cacheSetIfAbsentStrict<T>(key: string, value: T, ttlSeconds: number): Promise<boolean> {
  const client = await getRequiredClient();
  try {
    const result = await client.set(key, JSON.stringify(value), "EX", ttlSeconds, "NX");
    return result === "OK";
  } catch (error) {
    stats.errors++;
    throw new CacheUnavailableError(error instanceof Error ? error.message : undefined);
  }
}

/** Stores a required durable coordination value. Throws on Redis failure. */
export async function cacheSetStrict<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
  const client = await getRequiredClient();
  try {
    await client.set(key, JSON.stringify(value), "EX", ttlSeconds);
  } catch (error) {
    stats.errors++;
    throw new CacheUnavailableError(error instanceof Error ? error.message : undefined);
  }
}

/**
 * Delete a cache key — or, when the key contains a `*` wildcard, all keys
 * matching the glob pattern (delegates to SCAN-based invalidatePattern).
 * Always purges the in-memory LRU fallback as well.
 */
export async function cacheDel(key: string): Promise<void> {
  if (key.includes("*")) {
    lruDelPattern(key);
    await invalidatePattern(key);
    return;
  }
  lruDel(key);
  const client = getClient();
  if (!client) return;
  try {
    await client.del(key);
  } catch {
    markRedisDown();
  }
}

/**
 * Cache-aside pattern: return cached value if present, otherwise call
 * `loader`, cache the result, and return it.
 *
 * @param key       Cache key
 * @param ttl       TTL in seconds
 * @param loader    Async function that fetches the fresh value
 */
export async function getOrSet<T>(
  key: string,
  ttl: number,
  loader: () => Promise<T>
): Promise<T> {
  const cached = await cacheGet<T>(key);
  if (cached !== null) return cached;

  const fresh = await loader();
  // Fire-and-forget — don't block the response on cache write
  cacheSet(key, fresh, ttl).catch(() => {});
  return fresh;
}

/**
 * Invalidate all keys matching a glob pattern.
 * Uses SCAN to avoid blocking Redis with KEYS.
 */
export async function invalidatePattern(pattern: string): Promise<number> {
  const client = getClient();
  if (!client) return 0;
  let deleted = 0;
  let cursor = "0";
  try {
    do {
      const [nextCursor, keys] = await client.scan(cursor, "MATCH", pattern, "COUNT", 100);
      cursor = nextCursor;
      if (keys.length > 0) {
        await client.del(...keys);
        deleted += keys.length;
      }
    } while (cursor !== "0");
  } catch {
    markRedisDown();
  }
  return deleted;
}

// ─── cacheWrap: SWR + single-flight + stampede protection ────────────────────

export type CacheStatus = "HIT" | "STALE" | "MISS";

export interface CacheWrapOptions {
  /**
   * Extra seconds beyond `ttlSeconds` during which a stale value may be served
   * while a background refresh runs (stale-while-revalidate). Default 0 (off).
   */
  staleTtl?: number;
  /**
   * Best-effort cross-process refresh lock via Redis SET NX. In-process
   * single-flight is always active regardless of this flag. Default false.
   */
  useRedisLock?: boolean;
  /** Called with the cache disposition of this request (for X-Cache headers). */
  onStatus?: (status: CacheStatus) => void;
}

/**
 * In-process single-flight map: concurrent requests for the same key share one
 * loader invocation, so a cache miss never stampedes the database.
 */
const _flights = new Map<string, Promise<unknown>>();

async function readEnvelope(key: string): Promise<SwrEnvelope | null> {
  const client = getClient();
  let raw: string | null = null;
  if (client) {
    try {
      raw = await client.get(key);
    } catch {
      markRedisDown();
      raw = lruGet(key);
    }
  } else {
    raw = lruGet(key);
  }
  if (raw === null) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return isSwrEnvelope(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

async function writeEnvelope(key: string, value: unknown, ttlSeconds: number, staleTtl: number): Promise<void> {
  const now = Date.now();
  const envelope: SwrEnvelope = {
    __swr: 1,
    v: value,
    freshUntil: now + ttlSeconds * 1_000,
    staleUntil: now + (ttlSeconds + staleTtl) * 1_000,
  };
  const raw = JSON.stringify(envelope);
  const physicalTtl = Math.max(1, Math.ceil(ttlSeconds + staleTtl));
  lruSet(key, raw, physicalTtl);
  const client = getClient();
  if (!client) return;
  try {
    await client.setex(key, physicalTtl, raw);
  } catch {
    markRedisDown();
  }
}

async function fetchAndStore<T>(
  key: string,
  ttlSeconds: number,
  staleTtl: number,
  fn: () => Promise<T>,
  useRedisLock: boolean,
): Promise<T> {
  const client = useRedisLock ? getClient() : null;
  const lockKey = `lock:${key}`;
  let lockHeld = false;
  if (client) {
    try {
      // Short-lived lock — expires on its own if the holder crashes mid-refresh.
      lockHeld = (await client.set(lockKey, "1", "PX", 10_000, "NX")) === "OK";
    } catch {
      markRedisDown();
    }
  }
  try {
    const value = await fn();
    await writeEnvelope(key, value, ttlSeconds, staleTtl);
    return value;
  } finally {
    if (lockHeld && client) {
      client.del(lockKey).catch(() => {});
    }
  }
}

function singleFlight<T>(key: string, loader: () => Promise<T>): Promise<T> {
  const existing = _flights.get(key);
  if (existing) return existing as Promise<T>;
  const p = loader().finally(() => {
    _flights.delete(key);
  });
  _flights.set(key, p);
  return p;
}

/**
 * cacheWrap — read-through cache with stale-while-revalidate and single-flight
 * stampede protection.
 *
 * Semantics:
 *  - Fresh value present           → HIT, returned immediately.
 *  - Value older than ttlSeconds but younger than ttlSeconds + staleTtl
 *                                  → STALE, returned immediately; exactly one
 *                                    background refresh is triggered.
 *  - No usable value               → MISS; concurrent callers share one loader
 *                                    invocation (in-process single-flight, plus
 *                                    an optional best-effort Redis lock).
 *
 * Works with Redis down: reads/writes fall through to the in-memory LRU.
 */
export async function cacheWrap<T>(
  key: string,
  ttlSeconds: number,
  fn: () => Promise<T>,
  opts: CacheWrapOptions = {},
): Promise<T> {
  const staleTtl = Math.max(0, opts.staleTtl ?? 0);
  const now = Date.now();

  const envelope = await readEnvelope(key);
  if (envelope) {
    if (envelope.freshUntil > now) {
      stats.hits++;
      opts.onStatus?.("HIT");
      return envelope.v as T;
    }
    if (envelope.staleUntil > now) {
      stats.staleHits++;
      opts.onStatus?.("STALE");
      // Fire-and-forget background refresh — single-flight dedupes concurrent
      // refreshes; failures are swallowed (we already served stale data).
      void singleFlight(key, () =>
        fetchAndStore(key, ttlSeconds, staleTtl, fn, opts.useRedisLock ?? false),
      ).catch(() => {});
      return envelope.v as T;
    }
  }

  stats.misses++;
  opts.onStatus?.("MISS");
  return singleFlight(key, () =>
    fetchAndStore(key, ttlSeconds, staleTtl, fn, opts.useRedisLock ?? false),
  );
}

// ─── Observability ────────────────────────────────────────────────────────────

/** Point-in-time cache statistics for the /api/perf/snapshot endpoint. */
export function cacheStats(): {
  hits: number;
  misses: number;
  staleHits: number;
  fallbackHits: number;
  errors: number;
  hitRate: number;
  redisUp: boolean;
  fallbackSize: number;
  inFlight: number;
} {
  const total = stats.hits + stats.misses;
  return {
    hits: stats.hits,
    misses: stats.misses,
    staleHits: stats.staleHits,
    fallbackHits: stats.fallbackHits,
    errors: stats.errors,
    hitRate: total > 0 ? stats.hits / total : 0,
    redisUp: _available,
    fallbackSize: _lru.size,
    inFlight: _flights.size,
  };
}

// ─── Named Cache Keys ─────────────────────────────────────────────────────────

export const CacheKeys = {
  livePrices: () => "live_prices:all",
  orderBook: (symbol: string) => `order_book:${symbol}`,
  commodities: () => "commodities:list",
  indices: () => "indices:list",
  portfolioSummary: (userId: number) => `portfolio:summary:${userId}`,
  userProfile: (userId: number) => `user:profile:${userId}`,
  marketHistory: (symbol: string, interval: string) => `market:history:${symbol}:${interval}`,
  warehouseList: () => "warehouse:list",
  farmerList: () => "farmers:list",
  cropReports: () => "crop_reports:list",
} as const;

// ─── Cache TTLs (seconds) ─────────────────────────────────────────────────────

export const TTL = {
  PRICE_FEED: 5,         // live prices — refresh every 5s
  ORDER_BOOK: 2,         // order book depth — refresh every 2s
  COMMODITIES: 30,       // commodity list
  INDICES: 30,           // index list
  PORTFOLIO: 10,         // portfolio summary per user
  USER_PROFILE: 60,      // user profile
  MARKET_HISTORY: 60,    // OHLCV history
  WAREHOUSE: 30,         // warehouse list
  FARMERS: 30,           // farmer list
  CROP_REPORTS: 30,      // crop report list
  LONG: 300,             // 5 minutes — for rarely-changing data
} as const;

/** Flush all NEXCOM cache keys (use with caution — admin only). */
export async function flushNexcomCache(): Promise<void> {
  await invalidatePattern("live_prices:*");
  await invalidatePattern("order_book:*");
  await invalidatePattern("commodities:*");
  await invalidatePattern("indices:*");
  await invalidatePattern("portfolio:*");
  await invalidatePattern("user:*");
  await invalidatePattern("market:*");
  await invalidatePattern("warehouse:*");
  await invalidatePattern("farmers:*");
  await invalidatePattern("crop_reports:*");
}
