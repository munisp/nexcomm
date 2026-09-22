/**
 * perfMiddleware.ts — Express-level latency measurement for the NEXCOM API.
 *
 * Provides:
 *  - perfMiddleware: high-resolution timer per request
 *      · X-Response-Time header (ms, 1 decimal)
 *      · slow-request log for requests over SLOW_REQUEST_MS (default 500ms)
 *        (method + route template + ms + status — never bodies)
 *      · rolling in-process latency histogram per route-template with a 60s
 *        window (buckets: 5/10/25/50/100/250/500/1000/2500ms)
 *  - getPerfSnapshot(): point-in-time percentiles per route for the
 *    /api/perf/snapshot endpoint
 *  - measureDb(queryName, fn): tiny helper to time hot DB queries; slow
 *    queries (>250ms) are logged and all timings feed the perf snapshot
 *
 * Zero dependencies; all timers are unref'd. Overhead per request is a
 * hrtime pair plus one array push — negligible against a 100ms p95 budget.
 */

import type { NextFunction, Request, RequestHandler, Response } from "express";
import { performance } from "node:perf_hooks";

// ─── Config ───────────────────────────────────────────────────────────────────

const SLOW_REQUEST_MS = parseInt(process.env.PERF_SLOW_REQUEST_MS ?? "500", 10);
const SLOW_QUERY_MS = parseInt(process.env.PERF_SLOW_QUERY_MS ?? "250", 10);
const WINDOW_MS = 60_000;
/** Bucket upper bounds in ms (last bucket is +Inf). */
const BUCKET_BOUNDS_MS = [5, 10, 25, 50, 100, 250, 500, 1000, 2500] as const;
/** Safety cap on retained samples per route within the window. */
const MAX_SAMPLES_PER_ROUTE = 10_000;

// ─── Rolling window store ─────────────────────────────────────────────────────

interface Sample {
  t: number; // epoch ms
  ms: number;
}

interface RouteStats {
  samples: Sample[];
  totalCount: number; // lifetime count (monotonic)
  totalErrors: number; // lifetime count of 5xx responses
}

const _routes = new Map<string, RouteStats>();

// Periodic prune so idle routes don't hold samples forever (unref'd).
setInterval(() => {
  const cutoff = Date.now() - WINDOW_MS;
  for (const [route, s] of _routes) {
    let i = 0;
    while (i < s.samples.length && s.samples[i].t < cutoff) i++;
    if (i > 0) s.samples.splice(0, i);
    if (s.samples.length === 0 && s.totalCount > 0) {
      // Keep the map entry (lifetime counters) but free the array.
      s.samples = [];
    }
  }
}, 30_000).unref();

function recordSample(route: string, ms: number, isError: boolean): void {
  let s = _routes.get(route);
  if (!s) {
    s = { samples: [], totalCount: 0, totalErrors: 0 };
    _routes.set(route, s);
  }
  s.totalCount++;
  if (isError) s.totalErrors++;
  s.samples.push({ t: Date.now(), ms });
  if (s.samples.length > MAX_SAMPLES_PER_ROUTE) {
    s.samples.splice(0, s.samples.length - MAX_SAMPLES_PER_ROUTE);
  }
}

// ─── Route template resolution ────────────────────────────────────────────────

const ID_SEGMENT = /^(\d+|[0-9a-f]{8}-[0-9a-f-]{27,}|[a-zA-Z0-9_-]{24,})$/i;

/**
 * Best-effort route template. When Express has matched a route we use
 * baseUrl + route.path (e.g. /api/trpc/orders.create); otherwise we
 * normalise the raw path by replacing ID-looking segments with ":id" so
 * the histogram cardinality stays bounded.
 */
function resolveRouteTemplate(req: Request): string {
  const routePath = (req.route as { path?: string } | undefined)?.path;
  if (typeof routePath === "string") {
    const base = req.baseUrl ?? "";
    const joined = `${base}${routePath === "/" ? "" : routePath}`;
    return `${req.method} ${joined || "/"}`;
  }
  const raw = (req.originalUrl ?? req.url ?? "/").split("?")[0];
  const normalised = raw
    .split("/")
    .map((seg) => (seg && ID_SEGMENT.test(seg) ? ":id" : seg))
    .join("/");
  return `${req.method} ${normalised || "/"}`;
}

// ─── Express middleware ───────────────────────────────────────────────────────

export const perfMiddleware: RequestHandler = (
  req: Request,
  res: Response,
  next: NextFunction,
): void => {
  const startHr = process.hrtime.bigint();

  // X-Response-Time must be set before headers are flushed; hook writeHead so
  // the value is as late (and therefore as accurate) as possible.
  const origWriteHead = res.writeHead;
  let headerWritten = false;
  res.writeHead = function patchedWriteHead(
    this: Response,
    ...args: Parameters<Response["writeHead"]>
  ): Response {
    if (!headerWritten && !res.headersSent) {
      headerWritten = true;
      const ms = Number(process.hrtime.bigint() - startHr) / 1e6;
      res.setHeader("X-Response-Time", ms.toFixed(1));
    }
    return origWriteHead.apply(this, args);
  } as Response["writeHead"];

  res.on("finish", () => {
    const ms = Number(process.hrtime.bigint() - startHr) / 1e6;
    const route = resolveRouteTemplate(req);
    recordSample(route, ms, res.statusCode >= 500);
    if (ms > SLOW_REQUEST_MS) {
      // Never log bodies or query strings (may carry PII/secrets).
      console.warn(
        `[Perf] Slow request: ${route} → ${res.statusCode} in ${ms.toFixed(1)}ms (budget ${SLOW_REQUEST_MS}ms)`,
      );
    }
  });

  next();
};

// ─── Percentiles & snapshot ───────────────────────────────────────────────────

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)];
}

export interface RouteSnapshot {
  route: string;
  /** Requests observed in the rolling 60s window. */
  count: number;
  errors: number;
  p50: number;
  p95: number;
  p99: number;
  min: number;
  max: number;
  /** Cumulative counts per bucket (upper bounds in BUCKET_BOUNDS_MS, then +Inf). */
  buckets: number[];
}

export interface PerfSnapshot {
  windowMs: number;
  bucketBoundsMs: readonly number[];
  generatedAt: string;
  routes: RouteSnapshot[];
  dbQueries: DbQuerySnapshot[];
}

export function getPerfSnapshot(): PerfSnapshot {
  const cutoff = Date.now() - WINDOW_MS;
  const routes: RouteSnapshot[] = [];
  for (const [route, s] of _routes) {
    const windowed = s.samples.filter((x) => x.t >= cutoff).map((x) => x.ms);
    if (windowed.length === 0) continue;
    windowed.sort((a, b) => a - b);
    const buckets = new Array<number>(BUCKET_BOUNDS_MS.length + 1).fill(0);
    for (const ms of windowed) {
      let placed = false;
      for (let b = 0; b < BUCKET_BOUNDS_MS.length; b++) {
        if (ms <= BUCKET_BOUNDS_MS[b]) {
          buckets[b]++;
          placed = true;
          break;
        }
      }
      if (!placed) buckets[BUCKET_BOUNDS_MS.length]++;
    }
    routes.push({
      route,
      count: windowed.length,
      errors: s.totalErrors,
      p50: round1(percentile(windowed, 50)),
      p95: round1(percentile(windowed, 95)),
      p99: round1(percentile(windowed, 99)),
      min: round1(windowed[0]),
      max: round1(windowed[windowed.length - 1]),
      buckets,
    });
  }
  routes.sort((a, b) => b.count - a.count);
  return {
    windowMs: WINDOW_MS,
    bucketBoundsMs: BUCKET_BOUNDS_MS,
    generatedAt: new Date().toISOString(),
    routes,
    dbQueries: getDbQuerySnapshot(),
  };
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

// ─── measureDb — hot-query timing helper ──────────────────────────────────────

interface DbQueryStats {
  count: number;
  totalMs: number;
  maxMs: number;
  slowCount: number;
  /** Recent durations for windowed percentiles (ring buffer, last 256). */
  recent: number[];
  recentIdx: number;
}

const _dbQueries = new Map<string, DbQueryStats>();
const DB_RECENT_CAP = 256;

/**
 * Time a hot DB query. Slow executions (>PERF_SLOW_QUERY_MS, default 250ms)
 * are logged with the query name and duration — never the SQL or parameters.
 *
 * Usage:
 *   const rows = await measureDb("livePrices.getAll", () =>
 *     db.select().from(livePrices));
 */
export async function measureDb<T>(queryName: string, fn: () => Promise<T>): Promise<T> {
  const start = performance.now();
  try {
    return await fn();
  } finally {
    const ms = performance.now() - start;
    let s = _dbQueries.get(queryName);
    if (!s) {
      s = { count: 0, totalMs: 0, maxMs: 0, slowCount: 0, recent: [], recentIdx: 0 };
      _dbQueries.set(queryName, s);
    }
    s.count++;
    s.totalMs += ms;
    if (ms > s.maxMs) s.maxMs = ms;
    if (ms > SLOW_QUERY_MS) {
      s.slowCount++;
      console.warn(`[Perf] Slow query: ${queryName} took ${ms.toFixed(1)}ms (budget ${SLOW_QUERY_MS}ms)`);
    }
    if (s.recent.length < DB_RECENT_CAP) {
      s.recent.push(ms);
    } else {
      s.recent[s.recentIdx] = ms;
      s.recentIdx = (s.recentIdx + 1) % DB_RECENT_CAP;
    }
  }
}

export interface DbQuerySnapshot {
  query: string;
  count: number;
  avgMs: number;
  p95: number;
  maxMs: number;
  slowCount: number;
}

function getDbQuerySnapshot(): DbQuerySnapshot[] {
  const out: DbQuerySnapshot[] = [];
  for (const [query, s] of _dbQueries) {
    const sorted = [...s.recent].sort((a, b) => a - b);
    out.push({
      query,
      count: s.count,
      avgMs: round1(s.count > 0 ? s.totalMs / s.count : 0),
      p95: round1(percentile(sorted, 95)),
      maxMs: round1(s.maxMs),
      slowCount: s.slowCount,
    });
  }
  out.sort((a, b) => b.count - a.count);
  return out;
}
