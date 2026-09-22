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
import "./index.css";

// Global React Query defaults (UX-FIX): the zero-config default (staleTime 0,
// infinite retries, refetch on every window focus) caused refetch storms on
// 135 pages. 30s stale / 5min gc / 1 retry; pages with tighter freshness needs
// (trading views) override per-query.
//
// OFFLINE-RES retry policy (rural 2G/3G):
//   - fast connection → 1 retry (unchanged behaviour)
//   - slow/offline    → 3 attempts with exponential backoff + jitter (cap 30s);
//     transient drops on flaky links otherwise surface as hard errors
//   - mutations       → never retried here (idempotency is handled by the
//     offline order queue + clientOrderId dedupe, not blind retry)
const MAX_RETRY_DELAY_MS = 30_000;
function retryDelayMs(attemptIndex: number): number {
  const exp = Math.min(1_000 * 2 ** attemptIndex, MAX_RETRY_DELAY_MS);
  // Full jitter: uniform in [exp/2, exp] — avoids thundering herd when a
  // rural tower comes back and every queued query retries simultaneously.
  return exp / 2 + Math.random() * (exp / 2);
}
function shouldRetryQuery(failureCount: number): boolean {
  return getConnectionClass() === "fast" ? failureCount < 1 : failureCount < 3;
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      retry: shouldRetryQuery,
      retryDelay: retryDelayMs,
      refetchOnWindowFocus: false,
    },
    mutations: {
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
