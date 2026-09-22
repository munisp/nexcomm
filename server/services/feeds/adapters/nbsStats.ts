/**
 * nbsStats.ts — Nigerian official statistics adapter (NBS and compatible).
 *
 * National Bureau of Statistics publishes food CPI, inflation and selected
 * price-watch series as CSV/JSON downloads. This adapter ingests either:
 *
 *   NBS_FEED_URL     CSV or JSON endpoint/file URL.
 *   NBS_FEED_FORMAT  "csv" | "json" (default: auto-detect from URL/content).
 *   NBS_ROOT_PATH    (JSON only) JSONPath-lite to the record array, default "$".
 *   NBS_FIELD_MAP    JSON: {"series":"$.series","value":"$.value","date":"$.date",
 *                           "unit":"$.unit"} — for CSV these are column names
 *                           (use "$.columnName").
 *
 * Normalized payload: { series, value, unit, asOf, source: "nbs" }
 * Each series becomes a snapshot keyed by symbol=<SERIES uppercased>,
 * e.g. FOOD_CPI, HEADLINE_CPI.
 */
import { z } from "zod";
import Papa from "papaparse";
import type { FeedAdapter, FeedSnapshot } from "../types";
import { httpGetJson, httpGetText, resolvePath } from "../http";

const fieldMapSchema = z.object({
  series: z.string().min(1),
  value: z.string().min(1),
  date: z.string().min(1),
  unit: z.string().optional(),
});

type NbsFieldMap = z.infer<typeof fieldMapSchema>;

function loadFieldMap(): NbsFieldMap | null {
  const raw = process.env.NBS_FIELD_MAP;
  if (!raw) return null;
  try {
    return fieldMapSchema.parse(JSON.parse(raw));
  } catch (err) {
    console.warn("[Feeds:nbs] NBS_FIELD_MAP invalid — adapter disabled:", (err as Error).message);
    return null;
  }
}

function toNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number(v.replace(/[,₦%\s]/g, ""));
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function toIsoDate(v: unknown): string | null {
  if (typeof v !== "string" && typeof v !== "number") return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

async function loadRecords(url: string): Promise<unknown[]> {
  const format = (process.env.NBS_FEED_FORMAT ?? "").toLowerCase();
  const isCsv = format === "csv" || (!format && /\.csv(\?|$)/i.test(url));
  if (isCsv) {
    const text = await httpGetText(url);
    const parsed = Papa.parse<Record<string, unknown>>(text, {
      header: true,
      skipEmptyLines: true,
      dynamicTyping: true,
    });
    if (parsed.errors.length > 0 && parsed.data.length === 0) {
      throw new Error(`NBS CSV parse failed: ${parsed.errors[0].message}`);
    }
    return parsed.data;
  }
  const raw = await httpGetJson<unknown>(url);
  const root = resolvePath(raw, process.env.NBS_ROOT_PATH ?? "$");
  return Array.isArray(root) ? root : root ? [root] : [];
}

export const nbsStatsAdapter: FeedAdapter = {
  name: "nbs",
  kind: "statistics",
  ttlSeconds: 24 * 60 * 60,     // official stats are daily/monthly — fresh 24h
  intervalSeconds: 6 * 60 * 60, // poll every 6h (+ jitter/backoff)

  isEnabled: () => Boolean(process.env.NBS_FEED_URL) && loadFieldMap() !== null,

  async fetch(): Promise<FeedSnapshot[]> {
    const url = process.env.NBS_FEED_URL;
    const fieldMap = loadFieldMap();
    if (!url || !fieldMap) return []; // graceful: unconfigured

    const records = await loadRecords(url);
    if (records.length === 0) throw new Error("NBS feed returned no records");

    const now = new Date();
    const snapshots: FeedSnapshot[] = [];
    for (const rec of records) {
      const series = String(resolvePath(rec, fieldMap.series) ?? "").trim();
      const value = toNumber(resolvePath(rec, fieldMap.value));
      const asOf = toIsoDate(resolvePath(rec, fieldMap.date));
      const unit = fieldMap.unit ? String(resolvePath(rec, fieldMap.unit) ?? "") : null;
      if (!series || value === null || !asOf) continue;

      snapshots.push({
        feed: "nbs",
        symbol: series.toUpperCase().replace(/\s+/g, "_"),
        region: "Nigeria",
        payload: { series, value, unit, asOf, source: "nbs" },
        fetchedAt: now,
        validUntil: new Date(now.getTime() + 24 * 60 * 60 * 1000),
      });
    }
    if (snapshots.length === 0) throw new Error("NBS records failed field-map normalization");
    return snapshots;
  },
};
