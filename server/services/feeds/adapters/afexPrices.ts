/**
 * afexPrices.ts — external reference-price adapter (AFEX and compatible APIs).
 *
 * Fully env-configurable so the same adapter can front AFEX's commercial API
 * or any commodity board endpoint that returns JSON:
 *
 *   AFEX_FEED_URL   JSON endpoint returning an array of price records
 *                   (or an object; set AFEX_ROOT_PATH to point at the array).
 *   AFEX_ROOT_PATH  JSONPath-lite to the record array (default "$").
 *   AFEX_FIELD_MAP  JSON object mapping normalized fields to JSONPath-lite:
 *                   {"symbol":"$.symbol","price":"$.price","date":"$.date",
 *                    "currency":"$.currency","unit":"$.unit"}
 *                   Paths are evaluated against each record.
 *   AFEX_API_KEY    Optional bearer token for licensed feeds.
 *
 * Graceful degrade: when AFEX_FEED_URL is unset the adapter is disabled
 * (registry skips it, health() shows enabled=false); when unreachable the
 * fetch throws once into the registry's backoff/circuit-breaker handling.
 *
 * Normalized payload: { symbol, price, unit, priceNgnPerKg?, priceNgnPerMT?,
 *                       currency, asOf, source }
 */
import { z } from "zod";
import type { FeedAdapter, FeedSnapshot } from "../types";
import { httpGetJson, resolvePath } from "../http";

interface FieldMap {
  symbol: string;
  price: string;
  date: string;
  currency?: string;
  unit?: string;
}

const fieldMapSchema = z.object({
  symbol: z.string().min(1),
  price: z.string().min(1),
  date: z.string().min(1),
  currency: z.string().optional(),
  unit: z.string().optional(),
});

function loadFieldMap(): FieldMap | null {
  const raw = process.env.AFEX_FIELD_MAP;
  if (!raw) return null;
  try {
    return fieldMapSchema.parse(JSON.parse(raw));
  } catch (err) {
    console.warn("[Feeds:afex] AFEX_FIELD_MAP invalid — adapter disabled:", (err as Error).message);
    return null;
  }
}

function toNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number(v.replace(/[,₦\s]/g, ""));
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function toIsoDate(v: unknown): string | null {
  if (typeof v !== "string" && typeof v !== "number") return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** Normalize NGN unit conversions when the unit is recognized. */
function deriveUnitPrices(price: number, currency: string, unit: string | undefined) {
  const u = (unit ?? "").toLowerCase().replace(/\s+/g, "");
  const isNgn = currency.toUpperCase() === "NGN";
  let priceNgnPerKg: number | undefined;
  let priceNgnPerMT: number | undefined;
  if (isNgn && (u === "kg" || u === "perkg")) priceNgnPerKg = price;
  else if (isNgn && (u === "mt" || u === "tonne" || u === "permt")) { priceNgnPerMT = price; priceNgnPerKg = price / 1000; }
  else if (isNgn && (u === "100kg" || u === "per100kg" || u === "bag")) { priceNgnPerKg = price / 100; priceNgnPerMT = price * 10; }
  else if (isNgn && (u === "50kg" || u === "per50kg")) { priceNgnPerKg = price / 50; priceNgnPerMT = price * 20; }
  return { priceNgnPerKg, priceNgnPerMT };
}

export const afexPricesAdapter: FeedAdapter = {
  name: "afex",
  kind: "reference_price",
  ttlSeconds: 60 * 60,          // reference prices fresh for 1h
  intervalSeconds: 60 * 60,     // poll hourly (+ jitter/backoff)

  isEnabled: () => Boolean(process.env.AFEX_FEED_URL) && loadFieldMap() !== null,

  async fetch(): Promise<FeedSnapshot[]> {
    const url = process.env.AFEX_FEED_URL;
    const fieldMap = loadFieldMap();
    if (!url || !fieldMap) return []; // graceful: unconfigured

    const headers: Record<string, string> = {};
    if (process.env.AFEX_API_KEY) headers.Authorization = `Bearer ${process.env.AFEX_API_KEY}`;

    const raw = await httpGetJson<unknown>(url, { headers });
    const root = resolvePath(raw, process.env.AFEX_ROOT_PATH ?? "$");
    const records = Array.isArray(root) ? root : root ? [root] : [];
    if (records.length === 0) throw new Error("AFEX endpoint returned no records");

    const now = new Date();
    const snapshots: FeedSnapshot[] = [];
    for (const rec of records) {
      const symbol = String(resolvePath(rec, fieldMap.symbol) ?? "").trim().toUpperCase();
      const price = toNumber(resolvePath(rec, fieldMap.price));
      const asOf = toIsoDate(resolvePath(rec, fieldMap.date));
      const currency = fieldMap.currency
        ? String(resolvePath(rec, fieldMap.currency) ?? "NGN").toUpperCase()
        : "NGN";
      const unit = fieldMap.unit ? String(resolvePath(rec, fieldMap.unit) ?? "") : undefined;
      if (!symbol || price === null || !asOf) continue; // skip malformed record

      snapshots.push({
        feed: "afex",
        symbol,
        payload: {
          symbol,
          price,
          unit: unit ?? null,
          ...deriveUnitPrices(price, currency, unit),
          currency,
          asOf,
          source: "afex",
        },
        fetchedAt: now,
        validUntil: new Date(now.getTime() + 60 * 60 * 1000),
      });
    }
    if (snapshots.length === 0) throw new Error("AFEX records failed field-map normalization");
    return snapshots;
  },
};
