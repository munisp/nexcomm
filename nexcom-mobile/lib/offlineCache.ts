/**
 * NEXCOM Mobile — offline read cache for public market data.
 *
 * MMKV-backed TTL cache that mirrors the portal's service-worker read cache
 * semantics (client/public/sw.js): write-through on query success,
 * hydrate-on-launch with a stale marker, and FAIL-CLOSED on age — entries
 * older than 24h are deleted, never served (a farmer must never see
 * day-old prices presented as current).
 *
 * Only a small allowlist of public, non-account-scoped queries is cached:
 *   - livePrices.getAll          (dashboard ticker / markets list)
 *   - commodities.priceHistory   (market-detail chart data)
 *
 * Usage (wired once in app/_layout.tsx):
 *   hydrateOfflineCache(queryClient);   // before first screen paint
 *   initOfflineReadCache(queryClient);  // write-through subscription
 */
import { useSyncExternalStore } from 'react';
import type { QueryClient, QueryKey } from '@tanstack/react-query';
import { getKv } from './mmkv';

const KEY_PREFIX = 'rqcache.';
/** Fail-closed TTL: never serve market data older than 24h. */
export const OFFLINE_CACHE_TTL_MS = 24 * 60 * 60 * 1_000;

/** tRPC procedure paths ("router.procedure") eligible for offline caching. */
const CACHEABLE_PATHS: readonly string[] = [
  'livePrices.getAll',
  'commodities.priceHistory',
];

interface CacheEnvelope {
  cachedAt: number;
  /** Full react-query key (tRPC array form) so hydration restores exactly. */
  queryKey: QueryKey;
  data: unknown;
}

/** tRPC keys look like [["livePrices","getAll"], { input, type:"query" }]. */
function pathOf(queryKey: QueryKey): string | null {
  const head = (queryKey as unknown[])[0];
  return Array.isArray(head) ? head.join('.') : null;
}

function isCacheable(queryKey: QueryKey): boolean {
  const path = pathOf(queryKey);
  return path !== null && CACHEABLE_PATHS.includes(path);
}

// ─── "served from cache" metadata (for the dashboard stale chip) ────────────

/** queryKey JSON → cachedAt for entries hydrated from MMKV this session. */
const hydratedMeta = new Map<string, number>();
const metaListeners = new Set<() => void>();
let metaVersion = 0;

function notifyMeta(): void {
  metaVersion++;
  metaListeners.forEach((l) => l());
}

function metaId(queryKey: QueryKey): string {
  try {
    return JSON.stringify(queryKey);
  } catch {
    return String(pathOf(queryKey));
  }
}

/**
 * Metadata for a query: whether the currently displayed data was hydrated
 * from the offline cache (i.e. not yet refreshed from the network this
 * session), and when it was originally cached.
 */
export function useCachedQueryMeta(queryKey: QueryKey): {
  servedFromCache: boolean;
  cachedAt: number | null;
} {
  useSyncExternalStore(
    (l) => {
      metaListeners.add(l);
      return () => metaListeners.delete(l);
    },
    () => metaVersion,
    () => metaVersion,
  );
  const cachedAt = hydratedMeta.get(metaId(queryKey)) ?? null;
  return { servedFromCache: cachedAt !== null, cachedAt };
}

// ─── Write-through on query success ─────────────────────────────────────────

/**
 * Subscribe to the QueryClient cache and persist every successful fetch of
 * an allowlisted query to MMKV. Returns an unsubscribe function.
 */
export function initOfflineReadCache(queryClient: QueryClient): () => void {
  return queryClient.getQueryCache().subscribe((event) => {
    if (event.type !== 'updated' || event.query.state.status !== 'success') return;
    const key = event.query.queryKey;
    if (!isCacheable(key)) return;
    const envelope: CacheEnvelope = {
      cachedAt: Date.now(),
      queryKey: key,
      data: event.query.state.data,
    };
    try {
      getKv().set(KEY_PREFIX + metaId(key), JSON.stringify(envelope));
      // Fresh network data — no longer "served from cache".
      if (hydratedMeta.delete(metaId(key))) notifyMeta();
    } catch {
      // MMKV full/unavailable — caching is best-effort, never break queries.
    }
  });
}

// ─── Hydrate on launch ──────────────────────────────────────────────────────

/**
 * Restore cached entries into the QueryClient before the first screen
 * renders, so the dashboard ticker can paint immediately on 2G/offline
 * launches. Entries are restored with their ORIGINAL fetch timestamp, so
 * they are instantly stale (staleTime 30s) and react-query refetches as soon
 * as the network allows. Entries older than 24h are deleted (fail-closed).
 */
export function hydrateOfflineCache(queryClient: QueryClient): void {
  let kv;
  try {
    kv = getKv();
  } catch {
    return;
  }
  const now = Date.now();
  for (const storageKey of kv.getAllKeys()) {
    if (!storageKey.startsWith(KEY_PREFIX)) continue;
    try {
      const raw = kv.getString(storageKey);
      if (!raw) continue;
      const envelope = JSON.parse(raw) as CacheEnvelope;
      if (!envelope || typeof envelope.cachedAt !== 'number' || !envelope.queryKey) {
        kv.delete(storageKey);
        continue;
      }
      if (now - envelope.cachedAt > OFFLINE_CACHE_TTL_MS) {
        // Fail-closed: stale prices are worse than no prices.
        kv.delete(storageKey);
        continue;
      }
      if (queryClient.getQueryData(envelope.queryKey) !== undefined) continue;
      queryClient.setQueryData(envelope.queryKey, envelope.data, {
        updatedAt: envelope.cachedAt,
      });
      hydratedMeta.set(metaId(envelope.queryKey), envelope.cachedAt);
    } catch {
      // Corrupt entry — drop it.
      try {
        kv.delete(storageKey);
      } catch {
        /* ignore */
      }
    }
  }
  if (hydratedMeta.size > 0) notifyMeta();
}
