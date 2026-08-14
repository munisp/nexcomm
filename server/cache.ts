/**
 * cache.ts — Redis-backed cache layer for NEXCOM Exchange
 *
 * Provides:
 *  - get/set/del with TTL
 *  - getOrSet (cache-aside pattern)
 *  - invalidatePattern (glob-style key invalidation)
 *  - Graceful fallback to no-op when Redis is unavailable
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

/** Lazy-initialise the Redis client. Returns null if Redis is unavailable. */
function getClient(): Redis | null {
  if (_client) return _available ? _client : null;

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
        console.warn("[Cache] Redis error — falling back to no-op:", err.message);
      }
      _available = false;
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

const stats = { hits: 0, misses: 0, errors: 0 };

setInterval(() => {
  const total = stats.hits + stats.misses;
  if (total > 0) {
    const hitRate = ((stats.hits / total) * 100).toFixed(1);
    console.log(`[Cache] Stats — hits: ${stats.hits}, misses: ${stats.misses}, errors: ${stats.errors}, hit-rate: ${hitRate}%`);
  }
}, 60_000).unref();

// ─── Core API ─────────────────────────────────────────────────────────────────

/** Get a cached value. Returns null on miss or Redis unavailable. */
export async function cacheGet<T>(key: string): Promise<T | null> {
  const client = getClient();
  if (!client) return null;
  try {
    const raw = await client.get(key);
    if (raw === null) {
      stats.misses++;
      return null;
    }
    stats.hits++;
    return JSON.parse(raw) as T;
  } catch {
    stats.errors++;
    return null;
  }
}

/** Set a cached value with a TTL in seconds. Silently fails if Redis unavailable. */
export async function cacheSet<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
  const client = getClient();
  if (!client) return;
  try {
    await client.setex(key, ttlSeconds, JSON.stringify(value));
  } catch {
    stats.errors++;
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

/** Delete a specific cache key. */
export async function cacheDel(key: string): Promise<void> {
  const client = getClient();
  if (!client) return;
  try {
    await client.del(key);
  } catch {
    stats.errors++;
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
    stats.errors++;
  }
  return deleted;
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
