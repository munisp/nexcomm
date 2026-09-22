import "./i18n"; // i18n must be imported before React tree renders
import { trpc } from "@/lib/trpc";
import { UNAUTHED_ERR_MSG } from '@shared/const';
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpBatchLink, TRPCClientError } from "@trpc/client";
import { createRoot } from "react-dom/client";
import superjson from "superjson";
import App from "./App";
import { getLoginUrl } from "./const";
import { PreferencesProvider } from "./contexts/PreferencesContext";
import { registerServiceWorker } from "./lib/registerSW";
import { getConnectionClass } from "./lib/connectionQuality";
import { scheduleIdlePrefetch } from "./lib/idlePrefetch";
import "./index.css";

// Global React Query defaults (UX-FIX): the zero-config default (staleTime 0,
// infinite retries, refetch on every window focus) caused refetch storms on
// 135 pages. 30s stale / 10min gc (PERF-CLIENT: raised from 5min — wouter is
// a pure SPA with no SSR, so keeping route data warm for 10min makes
// route-to-route navigation render from cache instead of re-fetching);
// pages with tighter freshness needs (trading views) override per-query.
//
// OFFLINE-RES retry policy (rural 2G/3G):
//   - fast connection → up to 2 retries
//   - slow/offline    → 3 attempts with exponential backoff + jitter (cap 8s);
//     transient drops on flaky links otherwise surface as hard errors
//   - error-type gate (PERF-CLIENT): only network failures and 5xx are
//     retried. 4xx (validation/auth/not-found) can never succeed on retry —
//     retrying them just burned a round-trip on metered links. 408/429 stay
//     retryable (transient timeout / rate-limit).
//   - mutations       → never retried here (idempotency is handled by the
//     offline order queue + clientOrderId dedupe, not blind retry)
const MAX_RETRY_DELAY_MS = 8_000;
function retryDelayMs(attemptIndex: number): number {
  const exp = Math.min(1_000 * 2 ** attemptIndex, MAX_RETRY_DELAY_MS);
  // Full jitter: uniform in [exp/2, exp] — avoids thundering herd when a
  // rural tower comes back and every queued query retries simultaneously.
  return exp / 2 + Math.random() * (exp / 2);
}

function isRetryableError(error: unknown): boolean {
  if (error instanceof TRPCClientError) {
    // data.httpStatus is null/undefined for network-level failures (no
    // response received) — those are the canonical retryable case on 2G/3G.
    const status = (error.data as { httpStatus?: number | null } | undefined)?.httpStatus;
    if (status == null) return true;
    if (status === 408 || status === 429) return true;
    return status >= 500;
  }
  // Non-tRPC error (e.g. fetch TypeError on connection drop) — treat as network.
  return true;
}

function shouldRetryQuery(failureCount: number, error: unknown): boolean {
  if (!isRetryableError(error)) return false;
  return getConnectionClass() === "fast" ? failureCount < 2 : failureCount < 3;
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 10 * 60_000,
      retry: shouldRetryQuery,
      retryDelay: retryDelayMs,
      refetchOnWindowFocus: false,
      refetchOnReconnect: true,
      // PERF-CLIENT: render with cached data while offline and revalidate in
      // the background instead of pausing queries (which left pages blank on
      // flaky links despite the SW read-cache having data).
      networkMode: "offlineFirst",
    },
    mutations: {
      // PERF-CLIENT: no networkMode override here — mutations keep the
      // default "online" pausing semantics that OFFLINE-RES callers
      // (Trade.tsx / offlineOrderQueue.ts) were built against.
      retry: 0,
    },
  },
});

const redirectToLoginIfUnauthorized = (error: unknown) => {
  if (!(error instanceof TRPCClientError)) return;
  if (typeof window === "undefined") return;

  const isUnauthorized = error.message === UNAUTHED_ERR_MSG;

  if (!isUnauthorized) return;

  window.location.href = getLoginUrl();
};

queryClient.getQueryCache().subscribe(event => {
  if (event.type === "updated" && event.action.type === "error") {
    const error = event.query.state.error;
    redirectToLoginIfUnauthorized(error);
    console.error("[API Query Error]", error);
  }
});

queryClient.getMutationCache().subscribe(event => {
  if (event.type === "updated" && event.action.type === "error") {
    const error = event.mutation.state.error;
    redirectToLoginIfUnauthorized(error);
    console.error("[API Mutation Error]", error);
  }
});

// Bootstrap CSRF token on app start — fetches from /api/csrf-token and stores in memory
let _csrfToken: string | null = null;
async function bootstrapCsrf() {
  try {
    const res = await fetch("/api/csrf-token", { credentials: "include" });
    const data = await res.json() as { csrfToken?: string };
    if (data.csrfToken) _csrfToken = data.csrfToken;
  } catch {
    // Non-fatal: CSRF token will be absent; server will reject state-changing requests
    console.warn("[CSRF] Failed to bootstrap CSRF token");
  }
}
bootstrapCsrf();

// ─── Service Worker Registration (single registrar — see lib/registerSW.ts) ──
registerServiceWorker();

const trpcClient = trpc.createClient({
  links: [
    httpBatchLink({
      url: "/api/trpc",
      transformer: superjson,
      // PERF-CLIENT: explicit batch URL cap (matches tRPC default; stated so
      // it survives upgrades). Long batches split into multiple requests
      // instead of producing a URL a proxy/CDN would reject with 414.
      maxURLLength: 2083,
      fetch(input, init) {
        const headers = new Headers((init as RequestInit)?.headers);
        if (_csrfToken) headers.set("x-csrf-token", _csrfToken);
        // OFFLINE-RES: hard 20s timeout. On 2G a request with no timeout can
        // hang for minutes, pinning the batch and stalling every query in it.
        // Manual AbortController (not AbortSignal.timeout) for older Android
        // WebViews; forwards tRPC's own abort signal so query cancellation
        // still works.
        const controller = new AbortController();
        const upstreamSignal = (init as RequestInit | undefined)?.signal;
        const onUpstreamAbort = () => controller.abort();
        if (upstreamSignal) {
          if (upstreamSignal.aborted) controller.abort();
          else upstreamSignal.addEventListener("abort", onUpstreamAbort, { once: true });
        }
        const timeout = setTimeout(() => controller.abort(), 20_000);
        return globalThis.fetch(input, {
          ...(init ?? {}),
          credentials: "include",
          headers,
          signal: controller.signal,
        }).finally(() => {
          clearTimeout(timeout);
          if (upstreamSignal) upstreamSignal.removeEventListener("abort", onUpstreamAbort);
        });
      },
    }),
  ],
});

createRoot(document.getElementById("root")!).render(
  <trpc.Provider client={trpcClient} queryClient={queryClient}>
    <QueryClientProvider client={queryClient}>
      <PreferencesProvider>
        <App />
      </PreferencesProvider>
    </QueryClientProvider>
  </trpc.Provider>
);

// PERF-CLIENT: after first paint + window load, warm the most-likely-next
// lazy route chunks during browser idle time so route-to-route navigation is
// served from the module cache (<200ms). No-op until 'load'; see
// lib/idlePrefetch.ts.
scheduleIdlePrefetch();
