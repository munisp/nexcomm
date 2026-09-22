#!/usr/bin/env node
/**
 * smoke-feeds.mjs — DATA-FEEDS smoke check.
 *
 * Live-hits Open-Meteo (free, keyless) with a 10s timeout when the network is
 * available; otherwise prints SKIP. Configured-but-optional feeds (AFEX, NBS,
 * manual CSV) report SKIP when their env is absent, PASS/FAIL when configured.
 *
 * Usage:  node scripts/smoke-feeds.mjs
 * Exit:   0 when every enabled feed passes or skips; 1 on any FAIL.
 */

const TIMEOUT_MS = 10_000;
const results = [];

function report(feed, status, detail) {
  results.push({ feed, status, detail });
  console.log(`${status.padEnd(4)} ${feed.padEnd(12)} ${detail}`);
}

async function get(url, asText = false) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return asText ? await res.text() : await res.json();
  } finally {
    clearTimeout(timer);
  }
}

// ── Open-Meteo (always expected — free, keyless) ─────────────────────────────
async function checkOpenMeteo() {
  const url =
    "https://api.open-meteo.com/v1/forecast?latitude=12.00,7.73&longitude=8.52,8.54" +
    "&current=temperature_2m,relative_humidity_2m,precipitation,wind_speed_10m" +
    "&daily=temperature_2m_max,temperature_2m_min,precipitation_sum" +
    "&timezone=Africa%2FLagos&forecast_days=7&wind_speed_unit=kmh";
  try {
    const data = await get(url);
    const arr = Array.isArray(data) ? data : [data];
    const ok = arr.every((r) => r.current && Array.isArray(r.daily?.time) && r.daily.time.length === 7);
    if (!ok) throw new Error("unexpected response shape");
    report("openmeteo", "PASS", `${arr.length} location(s), current + 7-day forecast OK`);
  } catch (err) {
    const offline = err.name === "AbortError" || /fetch failed|ENOTFOUND|ECONN|ETIMEDOUT/i.test(String(err.cause ?? err.message));
    report("openmeteo", offline ? "SKIP" : "FAIL", offline ? `network unavailable (${err.message})` : err.message);
  }
}

// ── AFEX (optional — only when AFEX_FEED_URL is set) ─────────────────────────
async function checkAfex() {
  const url = process.env.AFEX_FEED_URL;
  if (!url) return report("afex", "SKIP", "AFEX_FEED_URL not set");
  try {
    const headers = process.env.AFEX_API_KEY ? { Authorization: `Bearer ${process.env.AFEX_API_KEY}` } : {};
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    const res = await fetch(url, { headers, signal: controller.signal }).finally(() => clearTimeout(timer));
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    await res.json();
    report("afex", "PASS", "endpoint reachable and returns JSON");
  } catch (err) {
    report("afex", "FAIL", err.message);
  }
}

// ── NBS (optional — only when NBS_FEED_URL is set) ───────────────────────────
async function checkNbs() {
  const url = process.env.NBS_FEED_URL;
  if (!url) return report("nbs", "SKIP", "NBS_FEED_URL not set");
  try {
    const isCsv = (process.env.NBS_FEED_FORMAT ?? "").toLowerCase() === "csv" || /\.csv(\?|$)/i.test(url);
    const body = isCsv ? await get(url, true) : await get(url);
    if (typeof body === "string" && body.trim().length === 0) throw new Error("empty CSV");
    report("nbs", "PASS", isCsv ? "CSV reachable and non-empty" : "JSON endpoint reachable");
  } catch (err) {
    report("nbs", "FAIL", err.message);
  }
}

// ── Manual CSV (optional — only when FEEDS_MANUAL_CSV_PATH is set) ───────────
async function checkManualCsv() {
  const path = process.env.FEEDS_MANUAL_CSV_PATH;
  if (!path) return report("manual_csv", "SKIP", "FEEDS_MANUAL_CSV_PATH not set");
  try {
    const { readFile } = await import("node:fs/promises");
    const text = await readFile(path, "utf8");
    const lines = text.trim().split(/\r?\n/).filter(Boolean);
    if (lines.length < 2) throw new Error("no data rows");
    report("manual_csv", "PASS", `${lines.length - 1} data row(s)`);
  } catch (err) {
    report("manual_csv", "FAIL", err.message);
  }
}

await checkOpenMeteo();
await checkAfex();
await checkNbs();
await checkManualCsv();

const failed = results.filter((r) => r.status === "FAIL");
console.log(failed.length === 0
  ? "\nSMOKE OK — all enabled feeds passed (or skipped)."
  : `\nSMOKE FAILED — ${failed.length} feed(s) failing.`);
process.exit(failed.length === 0 ? 0 : 1);
