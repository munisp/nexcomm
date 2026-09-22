# Low-Connectivity Architecture (OFFLINE-RES)

How the NEXCOM PWA keeps working for farmers on metered data, intermittent
2G/3G, and low-end Android devices in rural Nigeria. Everything here is
fail-closed: when data cannot be obtained or trusted, the UI shows an honest
empty/OFFLINE state — never fabricated prices, balances, or fills.

---

## 1. Cache & resilience layers

```
┌────────────────────────────────────────────────────────────────────┐
│ React app                                                          │
│  ├─ React Query (staleTime 30s, gcTime 5min)                       │
│  │    retry: fast=1 / slow=3 attempts, exp backoff+jitter cap 30s  │
│  │    refetchIntervals tuned ×4 on slow, OFF on Save-Data/offline  │
│  ├─ Form drafts (localStorage, debounce 500ms, TTL 7d)             │
│  └─ Offline write queue (IndexedDB nexcom-offline-queue)           │
├────────────────────────────────────────────────────────────────────┤
│ Service Worker (public/sw.js, CACHE_VERSION=v4)                    │
│  ├─ nexcom-static-v4  precache: /, manifest, offline.html, icons   │
│  │    + runtime cache-first for /assets, /icons, .js/.css/.woff2   │
│  ├─ nexcom-read-v4    SWR cache for allowlisted public market GETs │
│  └─ Background Sync   drains the IndexedDB write queue             │
├────────────────────────────────────────────────────────────────────┤
│ Network                                                            │
│  └─ tRPC httpBatchLink, 20s hard timeout, CSRF header, credentials │
└────────────────────────────────────────────────────────────────────┘
```

### 1.1 Service worker read cache (the offline READ path)

`/api/*` was historically network-only, so losing connectivity meant zero
data. sw.js v4 adds **stale-while-revalidate** for a STRICT allowlist of
read-only, public (non-personalised) tRPC GET endpoints:

- `livePrices.getAll`
- `commodities.list`
- `commodities.priceHistory`
- `marketStream.tickerSnapshot`
- `transparency.marketStats`
- `transparency.priceDiscovery`
- `priceAlerts.currentPrice`

Behaviour:

1. **Online + cache hit** → serve cache immediately, revalidate in background.
   The stored response carries `X-SW-Cached-At` (ms epoch) so the client can
   reason about staleness.
2. **Offline (`navigator.onLine === false`) + cache ≤ 24h** → serve cache with
   `X-Served-Offline: 1`. Clients key their "OFFLINE — cached prices" badge on
   this header.
3. **Offline + no cache (or cache > 24h)** → the fetch rejects; React Query
   renders its normal error/empty state. Stale-beyond-24h prices are treated
   as absent — we never show a farmer a dangerously old price.
4. tRPC GET batches (`/api/trpc/a.b,c.d?batch=1`) are cached **only if every
   procedure in the batch is allowlisted** — one user-specific procedure
   disqualifies the whole request.

**Never cached:** every POST/mutation, and every authenticated or
user-specific router (`auth.*`, `orders.*`, `portfolio.*`, `kycService.*`,
`notifications.*`, `profile.*`, `receipts.*`, …). The allowlist *is* the
security boundary — add endpoints only after confirming they return identical
data for every user.

### 1.2 Offline write queue + idempotency

Writes made while offline (orders, cancellations, KYC submissions, receipts,
alerts, profile updates) are appended to IndexedDB
(`nexcom-offline-queue` / `operations`) by `hooks/useOfflineQueue.ts` +
`lib/offlineOrderQueue.ts`. Background Sync (`sync-orders` tag) drains the
queue in the SW against a per-type endpoint map
(`lib/offlineConstants.ts` — values hardcoded in sw.js, keep them in sync).
Order idempotency: the queued item's `idempotencyKey` is forwarded as
`clientOrderId`, which `orders.create` dedupes server-side, so a flushed
replay of an already-accepted order is a no-op. Items retry up to 5 times;
poisoned items are dropped. Open windows receive `OFFLINE_QUEUE_FLUSHED`
with the remaining depth (relayed by `lib/registerSW.ts`).

### 1.3 Form drafts

`hooks/useFormDraft.ts` autosaves multi-step form state to localStorage
(debounced 500ms, key `nexcom-draft:<form>:<userId>`, TTL 7 days,
quota-guarded try/catch). Restored on mount with a "Draft restored" toast;
cleared on successful submit. Wired into:

- `pages/KybOnboarding.tsx` — wizard step + business/reg/directors/owners
- `pages/FarmerKYC.tsx` — uploaded-document checklist (doc URLs, not bytes)
- `pages/Trade.tsx` — order ticket (side/type/price/qty), cleared on placement

### 1.4 USSD bridge

For farmers with no data connection at all, the USSD channel (`*384*4#`,
session state in Redis `ussd:*` keys, 300s TTL — see
`docs/DATA_RETENTION.md` and `docs/loan-core-banking-integration.md`)
provides balances, prices, and order placement over GSM signalling. The PWA
and USSD share the same tRPC/matching-engine backend, so state reconciles
when the device next connects.

---

## 2. Behaviour matrix per network state

| Concern | Fast (3g/4g) | Slow (2g/saveData) | Offline |
|---|---|---|---|
| Query retries | 1 attempt | 3 attempts, exp backoff + jitter, cap 30s | 3 attempts (paused by onlineManager) |
| tRPC timeout | 20s abort | 20s abort | 20s abort |
| Ticker poll (Layout) | 30s | 120s; **disabled** on Save-Data | disabled — SW read cache serves |
| MarketDepth / OrderBookDepth poll | 5s | 20s; disabled on Save-Data | disabled |
| ForecastBand staleTime | 60s | 240s | cached data only |
| Allowlisted market GETs | network (SWR refresh) | network (SWR refresh) | cache ≤ 24h + `X-Served-Offline` |
| All other `/api/*` | network-only | network-only | fails → honest error state |
| Writes (orders etc.) | direct POST | direct POST | IndexedDB queue → Background Sync |
| SSE (order fills) | live | live, backoff 1s→60s | paused, resumes on `online` |
| WS (order book/positions) | live, backoff ≤30s | live, backoff ≤30s | paused, resumes on `online` |
| Background tabs | full behaviour | full behaviour | SSE/WS **paused** (`document.hidden`) |
| Form drafts | autosave 500ms | autosave 500ms | autosave 500ms (localStorage) |
| Navigation | network-first, cached shell | network-first, cached shell | cached shell → `offline.html` fallback |

---

## 3. Connection classification

`lib/connectionQuality.ts` reads `navigator.connection`
(`effectiveType`/`saveData`/`downlink`) + `online`/`offline` events:

- **offline** — `navigator.onLine === false`
- **slow** — `effectiveType` ∈ {`slow-2g`,`2g`}, OR `saveData === true`, OR
  `downlink ≤ 0.5 Mbps`
- **fast** — everything else (also the default where the Network Information
  API is unsupported — behaviour is then identical to the pre-OFFLINE-RES app)

`lib/queryTuning.ts` exposes `tunedInterval(baseMs, quality)` (returns
`false` — React Query's "polling off" — when offline or Save-Data; `baseMs×4`
when slow) and `tunedStaleTime(baseMs, quality)` (`×4` when slow). `main.tsx`
uses the non-hook `getConnectionClass()` for the retry policy.

---

## 4. Ops guidance

### Cache invalidation on deploy

- Bumping `CACHE_VERSION` in `client/public/sw.js` (currently `v4`) changes
  both cache names (`nexcom-static-vX`, `nexcom-read-vX`); the activate
  handler deletes every cache not in the current list. **Bump it on every
  deploy that changes the app shell or the read-allowlist semantics.**
- `lib/registerSW.ts` polls `reg.update()` hourly and on tab refocus, posts
  `SKIP_WAITING` to waiting workers, and reloads the page exactly once on
  `controllerchange` — users never run a stale shell against a new API.
- The 24h read-cache cap is an upper bound, not a freshness guarantee:
  React Query's own staleness governs normal operation.

### Bundle budget

- `build.target: "es2018"` (low-end Android WebViews), minify esbuild,
  `reportCompressedSize: true`, `chunkSizeWarningLimit: 600` (KB).
- Manual vendor chunks: `vendor-react`, `vendor-query` (@tanstack),
  `vendor-trpc`, `vendor-recharts`, `vendor-charts` (d3/lightweight-charts),
  `vendor-ui` (radix/lucide), `vendor-date`, catch-all `vendor`. Matching
  order matters — `@tanstack`/`@trpc` paths contain "react" and must be
  matched first.
- `client/public/offline.html` is a self-contained (<3KB) branded fallback;
  keep it free of external assets so it works fully offline.

### Server

- Response compression (`compression` middleware, `server/_core/index.ts`):
  level 6, 1KB threshold, skips `Accept: text/event-stream` (SSE) — verified
  present; do not remove the SSE exclusion or fill-streams will buffer.
- Trust proxy is set to 1 hop (edge proxy) — required for rate limiting.

---

## 5. Testing guide (Chrome DevTools)

Use **DevTools → Network → Throttling** and **Application → Service Workers**.

| Scenario | Profile | What to verify |
|---|---|---|
| Slow 3G | Custom: 400ms RTT, 400kbps down/up | Ticker badge stays LIVE; polls stretch to 120s/20s (Network tab cadence); queries retry ≤3× with growing gaps; pages remain interactive |
| Offline | "Offline" checkbox | Ticker badge → OFFLINE; allowlisted market data still renders (check `X-Served-Offline: 1` on responses); order placement → "Order queued offline" toast + SyncStatusPill depth |
| Reconnect | Toggle Offline off | Background Sync drains the queue (`OFFLINE_QUEUE_FLUSHED`, badge clears); SSE/WS reconnect within ~1s; no duplicate orders (clientOrderId dedupe) |
| Save-Data | Emulate via `navigator.connection` override or Chrome flag | All `refetchInterval` polling stops; manual refresh still works |
| Drafts | Fill KYB wizard → kill tab → reopen | "Draft restored" toast, fields repopulated; submit → draft cleared (check `nexcom-draft:*` keys in Application → Local Storage) |
| Stale read cache | Load prices online, go offline > modify `X-SW-Cached-At` via DevTools | Cache older than 24h is NOT served; honest error state instead |
| Deploy rollover | Bump `CACHE_VERSION`, reload twice | Old caches deleted in Application → Cache Storage; page reloads once; no stale shell |
| Background tab | `document.hidden` via tab switch | SSE/WS disconnect; reconnect on return (WS/SSE panels in Network tab) |

Lighthouse PWA audit + a throttled CPU (4× slowdown) run on a low-end
Moto-class profile is the final gate before field rollout.
