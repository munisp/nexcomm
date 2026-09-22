#!/usr/bin/env node
/**
 * bench-api.mjs — zero-dependency latency bench for the NEXCOM portal API.
 *
 * Hits a configurable endpoint list N times sequentially, then with C
 * concurrency, and reports p50/p95/p99/min/max per endpoint plus PASS/FAIL
 * against the latency budgets (reads p95 < 100ms local; cached reads are hit
 * twice so the second pass shows HIT latency vs the <15ms budget).
 *
 * Usage:
 *   node scripts/bench-api.mjs [BASE_URL=http://localhost:3000] [N=100] [C=10]
 *                              [PERF_TOKEN=...] [ENDPOINTS="/api/health/deep,/api/trpc/livePrices.getAll?batch=1&input=%7B%7D"]
 *
 * Exit code 0 when all budgets pass, 1 otherwise.
 */

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const i = a.indexOf("=");
    return i === -1 ? [a, true] : [a.slice(0, i), a.slice(i + 1)];
  }),
);

const BASE_URL = (args.BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const N = Math.max(2, parseInt(args.N ?? "100", 10));
const C = Math.max(1, parseInt(args.C ?? "10", 10));

// Budgets (ms) keyed by endpoint class.
const BUDGETS = { read: 100, cachedRead: 15, health: 100 };

const TRPC_PRICES = "/api/trpc/livePrices.getAll?batch=1&input=%7B%7D";
const TRPC_COMMODITIES = "/api/trpc/commodities.list?batch=1&input=%7B%7D";

const DEFAULT_ENDPOINTS = [
  { name: "health-deep", path: "/api/health/deep", budget: BUDGETS.health },
  { name: "livePrices.getAll (uncached pass)", path: TRPC_PRICES, budget: BUDGETS.read, warmup: true },
  { name: "livePrices.getAll (cached pass)", path: TRPC_PRICES, budget: BUDGETS.cachedRead, expectCacheHit: true },
  { name: "commodities.list (uncached pass)", path: TRPC_COMMODITIES, budget: BUDGETS.read, warmup: true },
  { name: "commodities.list (cached pass)", path: TRPC_COMMODITIES, budget: BUDGETS.cachedRead, expectCacheHit: true },
];

const endpoints = args.ENDPOINTS
  ? String(args.ENDPOINTS).split(",").map((p) => ({ name: p, path: p, budget: BUDGETS.read }))
  : DEFAULT_ENDPOINTS;

if (args.PERF_TOKEN) {
  DEFAULT_ENDPOINTS.push({
    name: "perf-snapshot",
    path: "/api/perf/snapshot",
    budget: BUDGETS.read,
    headers: { "X-Perf-Token": String(args.PERF_TOKEN) },
  });
}

function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)];
}

async function timedFetch(ep) {
  const start = process.hrtime.bigint();
  let status = 0;
  let cacheHeader = "-";
  try {
    const res = await fetch(`${BASE_URL}${ep.path}`, {
      headers: { Accept: "application/json", ...(ep.headers ?? {}) },
      signal: AbortSignal.timeout(15_000),
    });
    status = res.status;
    cacheHeader = res.headers.get("x-cache") ?? "-";
    await res.arrayBuffer(); // drain
  } catch {
    status = -1;
  }
  const ms = Number(process.hrtime.bigint() - start) / 1e6;
  return { ms, status, cacheHeader };
}

async function runSequential(ep, n) {
  const out = [];
  for (let i = 0; i < n; i++) out.push(await timedFetch(ep));
  return out;
}

async function runConcurrent(ep, n, c) {
  const out = [];
  let next = 0;
  const workers = Array.from({ length: c }, async () => {
    while (next < n) {
      next++;
      out.push(await timedFetch(ep));
    }
  });
  await Promise.all(workers);
  return out;
}

function summarize(results) {
  const times = results.map((r) => r.ms).sort((a, b) => a - b);
  const errors = results.filter((r) => r.status === -1 || r.status >= 500).length;
  const hits = results.filter((r) => r.cacheHeader === "HIT" || r.cacheHeader === "STALE").length;
  return {
    n: times.length,
    min: times[0] ?? 0,
    p50: percentile(times, 50),
    p95: percentile(times, 95),
    p99: percentile(times, 99),
    max: times[times.length - 1] ?? 0,
    errors,
    cacheHits: hits,
  };
}

const fmt = (x) => x.toFixed(1).padStart(8);
let failures = 0;

console.log(`\nbench-api.mjs — ${BASE_URL}  N=${N} C=${C}\n`);
console.log(
  "endpoint".padEnd(42),
  "mode".padEnd(6),
  "n".padStart(5),
  "min".padStart(9),
  "p50".padStart(9),
  "p95".padStart(9),
  "p99".padStart(9),
  "max".padStart(9),
  "err".padStart(5),
  "cache".padStart(7),
  "budget".padStart(8),
  "verdict",
);

for (const ep of endpoints) {
  // Warmup primes the cache so "uncached pass" measures the first fill and
  // "cached pass" measures steady-state HIT latency.
  if (ep.warmup) await timedFetch(ep);
  if (ep.expectCacheHit) await timedFetch(ep); // ensure entry exists & fresh

  const modes = [["seq", await runSequential(ep, N)]];
  modes.push(["conc", await runConcurrent(ep, N, C)]);

  for (const [mode, results] of modes) {
    const s = summarize(results);
    const pass = s.p95 < ep.budget && s.errors === 0;
    if (!pass) failures++;
    console.log(
      ep.name.padEnd(42),
      mode.padEnd(6),
      String(s.n).padStart(5),
      fmt(s.min),
      fmt(s.p50),
      fmt(s.p95),
      fmt(s.p99),
      fmt(s.max),
      String(s.errors).padStart(5),
      String(s.cacheHits).padStart(7),
      fmt(ep.budget),
      pass ? "PASS" : "FAIL",
    );
  }
}

console.log(failures === 0 ? "\nALL BUDGETS PASS\n" : `\n${failures} BUDGET CHECK(S) FAILED\n`);
process.exit(failures === 0 ? 0 : 1);
