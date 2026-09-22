/**
 * NEXCOM Mobile — typed tRPC client.
 * AppRouter lives in this monorepo at server/routers.ts.
 * The Authorization header is resolved asynchronously from the in-memory
 * token cache (lib/auth.ts) on every request, so 401-immune stale tokens
 * are never sent and SecureStore is not hit per request.
 *
 * Low-bandwidth hardening:
 *  - httpBatchLink with maxURLLength 2083 (safe for proxies on GET batches)
 *  - custom fetch with a 12s timeout so dead 2G connections fail fast and
 *    react-query retry/offline-queue logic can take over
 *  - every request records a latency/success sample that drives
 *    lib/connectionQuality.ts (adaptive polling + queue replay triggers)
 */
import { createTRPCReact } from '@trpc/react-query';
import { httpBatchLink } from '@trpc/client';
import superjson from 'superjson';
import type { AppRouter } from '../../server/routers';
import { getValidAccessToken } from './auth';
import { recordRequestSample } from './connectionQuality';

export const trpc = createTRPCReact<AppRouter>();

/** Fail dead connections fast; p95 budget on 3G is 1.5s, retries add slack. */
const REQUEST_TIMEOUT_MS = 12_000;

/** AbortSignal.timeout with a manual fallback for Hermes builds lacking it. */
function timeoutSignal(ms: number): AbortSignal | undefined {
  const ctor = AbortSignal as unknown as { timeout?: (t: number) => AbortSignal };
  if (typeof ctor.timeout === 'function') return ctor.timeout(ms);
  if (typeof AbortController === 'undefined') return undefined;
  const controller = new AbortController();
  setTimeout(() => controller.abort(), ms);
  return controller.signal;
}

const timedFetch: typeof fetch = async (input, init) => {
  const started = Date.now();
  try {
    const res = await fetch(input, { ...init, signal: timeoutSignal(REQUEST_TIMEOUT_MS) });
    // Only 5xx counts as link degradation; 4xx means the link is fine.
    recordRequestSample(Date.now() - started, res.status < 500);
    return res;
  } catch (err) {
    recordRequestSample(Date.now() - started, false);
    throw err;
  }
};

export function getTRPCClient(baseUrl: string) {
  return trpc.createClient({
    links: [
      httpBatchLink({
        url: `${baseUrl}/api/trpc`,
        transformer: superjson,
        maxURLLength: 2083,
        fetch: timedFetch,
        async headers() {
          const token = await getValidAccessToken();
          return {
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            'Content-Type': 'application/json',
          };
        },
      }),
    ],
  });
}
