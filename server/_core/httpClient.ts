/**
 * httpClient.ts — shared outbound HTTP client for service-to-service calls.
 *
 * Why: bare fetch()/axios-per-call opens a fresh TCP (and TLS) connection per
 * request, adding 5–50ms per hop. This module provides:
 *  - a shared axios instance with HTTP/HTTPS keep-alive agents
 *    (maxSockets 50, keepAliveMsecs 30s) and an 8s default timeout
 *  - 1 automatic retry with 200ms backoff on ECONNRESET / ETIMEDOUT / 5xx
 *    (idempotent methods only unless `retryOnPost: true` is passed)
 *  - wrapWithBreaker(name, fn, opts): in-memory circuit breaker with a
 *    failure threshold and reset window, plus breaker stats for the
 *    /api/perf/snapshot endpoint
 *
 * Zero new dependencies (axios is already in package.json).
 */

import axios, {
  AxiosError,
  type AxiosInstance,
  type AxiosRequestConfig,
  type AxiosResponse,
  type InternalAxiosRequestConfig,
} from "axios";
import http from "node:http";
import https from "node:https";

// ─── Shared axios instance ────────────────────────────────────────────────────

const DEFAULT_TIMEOUT_MS = parseInt(process.env.OUTBOUND_HTTP_TIMEOUT_MS ?? "8000", 10);
const RETRY_DELAY_MS = 200;

export const httpAgent = new http.Agent({
  keepAlive: true,
  keepAliveMsecs: 30_000,
  maxSockets: 50,
});

export const httpsAgent = new https.Agent({
  keepAlive: true,
  keepAliveMsecs: 30_000,
  maxSockets: 50,
});

export const httpClient: AxiosInstance = axios.create({
  timeout: DEFAULT_TIMEOUT_MS,
  httpAgent,
  httpsAgent,
  // Callers decide; throwing on 4xx/5xx lets the retry interceptor see them.
  validateStatus: () => true,
});

// ─── Retry interceptor (1 retry, 200ms backoff) ───────────────────────────────

const IDEMPOTENT_METHODS = new Set(["get", "head", "options", "put", "delete"]);
const RETRIABLE_CODES = new Set(["ECONNRESET", "ETIMEDOUT", "ECONNABORTED", "EPIPE", "EAI_AGAIN"]);

interface RetryableConfig extends InternalAxiosRequestConfig {
  __retried?: boolean;
  __retryOnPost?: boolean;
}

function isRetriable(error: AxiosError): boolean {
  if (error.code && RETRIABLE_CODES.has(error.code)) return true;
  const status = error.response?.status;
  return status !== undefined && status >= 500;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    t.unref();
  });
}

httpClient.interceptors.response.use(
  (response: AxiosResponse) => {
    if (response.status >= 500) {
      // Route 5xx through the error path so retry logic applies uniformly.
      const err = new AxiosError(
        `Request failed with status code ${response.status}`,
        String(response.status),
        response.config,
        response.request,
        response,
      );
      return Promise.reject(err);
    }
    return response;
  },
  async (error: AxiosError) => {
    const config = error.config as RetryableConfig | undefined;
    if (!config) return Promise.reject(error);
    const method = (config.method ?? "get").toLowerCase();
    const mayRetry =
      !config.__retried &&
      isRetriable(error) &&
      (IDEMPOTENT_METHODS.has(method) || config.__retryOnPost === true);
    if (!mayRetry) return Promise.reject(error);
    config.__retried = true;
    await sleep(RETRY_DELAY_MS);
    return httpClient.request(config);
  },
);

/**
 * Request helper mirroring axios.request with the shared defaults.
 * Pass `retryOnPost: true` in config to allow retrying a POST (only when the
 * target operation is idempotent, e.g. guarded by an idempotency key).
 */
export function httpRequest<T = unknown>(
  config: AxiosRequestConfig & { retryOnPost?: boolean },
): Promise<AxiosResponse<T>> {
  const { retryOnPost, ...rest } = config;
  const cfg = rest as RetryableConfig;
  if (retryOnPost) cfg.__retryOnPost = true;
  return httpClient.request<T>(cfg);
}

// ─── Circuit breaker ──────────────────────────────────────────────────────────

export interface BreakerOptions {
  /** Consecutive failures before the breaker opens. Default 5. */
  failureThreshold?: number;
  /** How long the breaker stays open before a trial request. Default 30000. */
  resetMs?: number;
  /** Metrics/observability hook — called on every state transition. */
  onEvent?: (name: string, event: "open" | "half_open" | "closed" | "rejected") => void;
}

type BreakerState = "closed" | "open" | "half_open";

interface BreakerEntry {
  state: BreakerState;
  consecutiveFailures: number;
  openedAt: number;
  failureThreshold: number;
  resetMs: number;
  totalRejected: number;
  totalFailures: number;
  totalCalls: number;
  onEvent?: BreakerOptions["onEvent"];
}

const _breakers = new Map<string, BreakerEntry>();

function getBreaker(name: string, opts: BreakerOptions): BreakerEntry {
  let b = _breakers.get(name);
  if (!b) {
    b = {
      state: "closed",
      consecutiveFailures: 0,
      openedAt: 0,
      failureThreshold: opts.failureThreshold ?? 5,
      resetMs: opts.resetMs ?? 30_000,
      totalRejected: 0,
      totalFailures: 0,
      totalCalls: 0,
      onEvent: opts.onEvent,
    };
    _breakers.set(name, b);
  }
  return b;
}

export class CircuitOpenError extends Error {
  constructor(name: string) {
    super(`Circuit breaker "${name}" is open`);
    this.name = "CircuitOpenError";
  }
}

/**
 * Wrap an async function with an in-memory circuit breaker.
 *
 *  - CLOSED: calls pass through; `failureThreshold` consecutive failures open it.
 *  - OPEN: calls fail fast with CircuitOpenError for `resetMs`.
 *  - After `resetMs`, one trial call (HALF_OPEN) decides: success closes the
 *    breaker, failure re-opens it for another `resetMs`.
 */
export function wrapWithBreaker<T, A extends unknown[]>(
  name: string,
  fn: (...args: A) => Promise<T>,
  opts: BreakerOptions = {},
): (...args: A) => Promise<T> {
  const breaker = getBreaker(name, opts);
  return async (...args: A): Promise<T> => {
    breaker.totalCalls++;
    const now = Date.now();

    if (breaker.state === "open") {
      if (now - breaker.openedAt >= breaker.resetMs) {
        breaker.state = "half_open";
        breaker.onEvent?.(name, "half_open");
      } else {
        breaker.totalRejected++;
        breaker.onEvent?.(name, "rejected");
        throw new CircuitOpenError(name);
      }
    }

    try {
      const result = await fn(...args);
      if (breaker.state !== "closed") {
        breaker.state = "closed";
        breaker.onEvent?.(name, "closed");
      }
      breaker.consecutiveFailures = 0;
      return result;
    } catch (err) {
      breaker.consecutiveFailures++;
      breaker.totalFailures++;
      if (
        breaker.state === "half_open" ||
        breaker.consecutiveFailures >= breaker.failureThreshold
      ) {
        // NOTE: TS narrows state to "closed"|"half_open" here (the "open" branch
        // above always throws or transitions), but a concurrent call may have
        // opened the breaker during the await — so check at runtime via cast.
        const alreadyOpen = (breaker.state as BreakerState) === "open";
        breaker.state = "open";
        breaker.openedAt = now;
        if (!alreadyOpen) {
          breaker.onEvent?.(name, "open");
          console.warn(
            `[CircuitBreaker] "${name}" opened after ${breaker.consecutiveFailures} consecutive failures`,
          );
        }
      }
      throw err;
    }
  };
}

export interface BreakerSnapshot {
  name: string;
  state: BreakerState;
  consecutiveFailures: number;
  totalCalls: number;
  totalFailures: number;
  totalRejected: number;
  openMsRemaining: number;
}

/** Breaker states for /api/perf/snapshot. */
export function getBreakerStats(): BreakerSnapshot[] {
  const now = Date.now();
  return [..._breakers.entries()].map(([name, b]) => ({
    name,
    state: b.state,
    consecutiveFailures: b.consecutiveFailures,
    totalCalls: b.totalCalls,
    totalFailures: b.totalFailures,
    totalRejected: b.totalRejected,
    openMsRemaining: b.state === "open" ? Math.max(0, b.resetMs - (now - b.openedAt)) : 0,
  }));
}
