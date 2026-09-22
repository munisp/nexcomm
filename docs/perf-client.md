# PERF-CLIENT — Runtime Performance (nexcom portal)

Scope: **runtime** performance on Nigerian networks (bundle/first-paint work
landed separately: first-paint gzip ≈564KB, lazy routes). Offline behaviour
(OFFLINE-RES) is fully preserved.

## Web Vitals budgets

Measured on Lighthouse **Fast 3G + 4× CPU throttle (Moto G4 profile)**, pure
SPA (no SSR — verified: `createRoot` in `client/src/main.tsx`, wouter router):

| Metric | Budget | Notes |
|---|---|---|
| LCP  | < 2.5s | Fast-3G, Moto G4 |
| FCP  | < 1.8s | |
| TBT  | < 200ms | |
| CLS  | < 0.1 | |
| TTI  | < 3.5s | |
| Route-to-route nav | < 200ms (cached) | React Query cache + idle-prefetched chunks |

Budgets are enforced in CI via `scripts/lighthouse-budget.json`.

## What changed

### React Query / tRPC (`client/src/main.tsx`)
- `staleTime: 30s`, `gcTime: 10min` (was 5min — route data survives
  navigation, making back/forward nav render from cache).
- Retry: network/5xx only (4xx, except 408/429, fails immediately — no wasted
  round-trips on metered links); up to 2 retries on fast connections, 3 on
  slow (OFFLINE-RES connection-adaptive policy preserved); exponential
  backoff with full jitter, cap 8s.
- `refetchOnWindowFocus: false`, `refetchOnReconnect: true`,
  `networkMode: "offlineFirst"` (queries render cached data while offline
  instead of pausing blank; mutations keep default `online` semantics so the
  offline order queue flow is untouched).
- `httpBatchLink` (unchanged) + explicit `maxURLLength: 2083`.
- No per-query polling changes: hot queries (Layout ticker 30s, Markets 5min)
  already use `tunedInterval`/`tunedStaleTime` from OFFLINE-RES — not
  duplicated.

### Memoization (top render-cost components)
- `components/LivePriceTicker.tsx` — `React.memo` (named + default export);
  ticker item list wrapped in `useMemo([symbols, prices, prevPrices])`.
- `components/CopilotPanel.tsx` — `React.memo` (mounted permanently in
  Layout; previously re-rendered on every Layout render); `send` wrapped in
  `useCallback`.
- `components/ForecastBand.tsx` — `React.memo`; chart margin, axis tick
  style, tooltip label style, tick/tooltip formatters hoisted to module
  scope (stable recharts props).
- `components/OrderBookDepthChart.tsx` — `React.memo`.

### Long lists
- `hooks/useWindowedList.ts` (new, ~75 lines, no deps): scroll-based
  windowing, overscan 5, document-level capture scroll listener (the app
  scrolls inside `<main class="overflow-y-auto">`, not on window).
- `pages/Deposits.tsx` — windowed rendering (limit 100 heavy cards) +
  module-level `Map` lookups replacing per-row `COMMODITIES.find()` /
  `WAREHOUSES.find()`; row cards also carry
  `[content-visibility:auto] [contain-intrinsic-size:auto_118px]`.
- `pages/Notifications.tsx` — rows (up to 100) get
  `[content-visibility:auto] [contain-intrinsic-size:auto_92px]` so the
  browser skips layout/paint for off-screen rows.
- Orders/fills lists are already server-paginated at 50 rows — no change.

### Idle prefetch (`client/src/lib/idlePrefetch.ts`, new)
After `window.load`, `requestIdleCallback` (Safari fallback: 2s `setTimeout`)
dynamically imports the 4 most-likely-next route chunks — Markets, Trade,
Orders, Portfolio — using specifiers that resolve to the same modules as
`App.tsx`'s `lazy()` calls, so the router's own chunks are warmed. Called
once from `main.tsx` after the root render.

### Service worker (`client/public/sw.js` → v5)
- `CACHE_VERSION` `v4` → `v5`: `nexcom-static-v5`, `nexcom-read-v5`, plus new
  `nexcom-assets-v5` and `nexcom-media-v5`. Old caches are deleted on
  activate (forces a clean refresh of every client).
- Install precache is now fault-tolerant (per-URL catch — a missing asset
  can never fail install).
- Runtime CacheFirst with hand-rolled TTL/caps (no workbox):
  - `/assets/*`, `*.js`, `*.css` → `nexcom-assets-v5`, 30d TTL (hashed =
    immutable).
  - fonts/images/icons → `nexcom-media-v5`, 7d TTL, 60 entries FIFO.
- **100% of v4 logic preserved**: SWR read-cache allowlist + 24h cap +
  offline marker headers; navigation network-first with `offline.html`
  fallback; push/notificationclick; `sync-orders` IDB queue drain with
  `clientOrderId` idempotency forwarding; message handler; fetch-handler
  priority order unchanged. `offlineConstants.ts` holds no cache-version
  constant (only IDB name/version/store + endpoint map), so it needed no
  edit — verified identical.

## How to measure

### Lighthouse CI
```bash
# from repo root
npx @lhci/cli autorun --collect.url=http://localhost:4173/ \
  --assert.assertions-file=scripts/lighthouse-budget.json
# one-off:
npx lighthouse http://localhost:4173/ --preset=desktop --throttling-method=simulate \
  --budget-path=scripts/lighthouse-budget.json --output=json --output-path=/tmp/lh.json
```
Budget file: `scripts/lighthouse-budget.json` — FCP 1800, LCP 2500, TBT 200,
CLS 0.1, TTI 3500.

### Chrome DevTools
- **Network**: Fast 3G preset; **Performance**: 4× CPU slowdown (Moto G4
  equivalent). Record page load; check LCP marker < 2.5s.
- **Route nav**: record a Performance trace while switching /markets →
  /orders → /portfolio after idle prefetch has run; the lazy chunk should
  come from cache and the route commit should land < 200ms.
- **Rendering**: enable "Scrolling Performance Issues" — Deposits and
  Notifications rows should show as repainted only when entering the
  viewport (content-visibility).

### web-vitals (optional field note)
`web-vitals` is not a dependency (no new deps allowed). To field-measure,
add it later or paste the CDN snippet in a staging build; wire
`onLCP/onFCP/onTBT/onCLS` to the existing analytics endpoint.

## SW cache inventory

| Cache | Contents | Strategy | TTL / cap |
|---|---|---|---|
| `nexcom-static-v5` | App shell precache (`/`, `manifest.json`, `offline.html`, icons) + navigations + misc GETs | Precache on install; navigation = network-first | No TTL (replaced on version bump) |
| `nexcom-read-v5` | Allowlisted public market-data tRPC GETs (7 procedures) | Stale-while-revalidate | 24h offline cap, fail-closed |
| `nexcom-assets-v5` | `/assets/*`, `*.js`, `*.css` (Vite hashed) | CacheFirst | 30d TTL |
| `nexcom-media-v5` | fonts, images, `/icons/*` | CacheFirst | 7d TTL, 60 entries FIFO |
| IDB `nexcom-offline-queue` | Queued offline mutations | `sync-orders` background sync drain | max 5 retries, poisoned items dropped |

## Rollback notes
- **SW**: redeploying with `CACHE_VERSION` back to `v4` (or bumping to `v6`)
  forces all clients to drop v5 caches on activate. `skipWaiting` +
  `clients.claim()` mean the rollback takes effect on next navigation; the
  `registerSW.ts` `SKIP_WAITING` message path is unchanged.
- **QueryClient**: revert `client/src/main.tsx` to the previous revision;
  defaults are self-contained (no other file depends on them).
- **Memoization/list changes**: all are file-local; revert per file. No
  schema, API, or dependency changes were made — rollback is safe at any
  granularity.
