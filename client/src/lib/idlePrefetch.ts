/**
 * NEXCOM — Idle route prefetch (PERF-CLIENT)
 * ─────────────────────────────────────────────────────────────────────────────
 * Route-to-route navigation target is <200ms cached. The pages below are the
 * most-likely-next destinations from the dashboard (they are the mobile
 * bottom-nav + primary sidebar entries); their lazy chunks are downloaded
 * during browser IDLE time after first paint, so by the time the user taps,
 * the module is already in the browser's HTTP/module cache and React.lazy
 * resolves without a network round-trip.
 *
 * The import specifiers resolve to the SAME modules as the lazy() calls in
 * App.tsx (App.tsx uses "./pages/X" from src/, we use "@/pages/X" — both
 * resolve to client/src/pages/X.tsx), so Vite emits ONE shared chunk per
 * page: the prefetch warms the exact artifact the router will request.
 * App.tsx:
 *   const Markets   = lazy(() => import("./pages/Markets"));
 *   const Trade     = lazy(() => import("./pages/Trade"));
 *   const Orders    = lazy(() => import("./pages/Orders"));
 *   const Portfolio = lazy(() => import("./pages/Portfolio"));
 *
 * Scheduling: requestIdleCallback (Chromium) with a 4s timeout so prefetching
 * never starves; Safari/older WebViews fall back to a fixed 2s post-load
 * setTimeout. All failures are swallowed — prefetch is an optimisation, never
 * a hard dependency.
 */

const ROUTE_CHUNKS: ReadonlyArray<() => Promise<unknown>> = [
  () => import("@/pages/Markets"),
  () => import("@/pages/Trade"),
  () => import("@/pages/Orders"),
  () => import("@/pages/Portfolio"),
];

interface IdleCapableWindow {
  requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
}

function prefetchAll(): void {
  const w = window as IdleCapableWindow;
  if (typeof w.requestIdleCallback === "function") {
    const ric = w.requestIdleCallback.bind(window);
    // Load sequentially, one chunk per idle slice, so prefetch traffic never
    // contends with critical rendering or the user's own interactions.
    let index = 0;
    const step = () => {
      const load = ROUTE_CHUNKS[index++];
      if (!load) return;
      load()
        .catch(() => undefined)
        .finally(() => {
          if (index < ROUTE_CHUNKS.length) ric(step, { timeout: 4000 });
        });
    };
    ric(step, { timeout: 4000 });
  } else {
    // Fallback: fixed 2s after load, then warm everything.
    setTimeout(() => {
      for (const load of ROUTE_CHUNKS) load().catch(() => undefined);
    }, 2000);
  }
}

/** Schedule idle prefetching once the window has finished loading. */
export function scheduleIdlePrefetch(): void {
  if (typeof window === "undefined") return;
  if (document.readyState === "complete") {
    prefetchAll();
  } else {
    window.addEventListener("load", prefetchAll, { once: true });
  }
}
