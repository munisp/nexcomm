/**
 * manualCsv.ts — operator-fallback reference-price adapter.
 *
 * Many Nigerian reference prices (exchange-fixed indicative prices, commodity
 * board quotes, field-agent submissions) have no API. Exchange ops upload a
 * CSV to a mounted path and this adapter ingests it on each poll cycle.
 *
 *   FEEDS_MANUAL_CSV_PATH  absolute path to a CSV file (mounted volume).
 *                          Adapter disabled when unset; file-missing or empty
 *                          is a soft failure recorded in feed health.
 *
 * CSV columns (header row required):
 *   symbol,price[,unit][,currency][,asOf][,region]
 *   MAIZE-WHITE,420,kg,NGN,2026-05-01,Kano
 *
 * Normalized payload: { symbol, price, unit, currency, asOf, region?, source: "manual_csv" }
 */
import { readFile } from "node:fs/promises";
import Papa from "papaparse";
import { z } from "zod";
import type { FeedAdapter, FeedSnapshot } from "../types";

const rowSchema = z.object({
  symbol: z.string().min(1),
  price: z.coerce.number().positive(),
  unit: z.string().optional().default(""),
  currency: z.string().optional().default("NGN"),
  asOf: z.string().optional(),
  region: z.string().optional(),
});

export const manualCsvAdapter: FeedAdapter = {
  name: "manual_csv",
  kind: "reference_price",
  ttlSeconds: 12 * 60 * 60,     // operator uploads are fresh 12h
  intervalSeconds: 15 * 60,     // re-read the file every 15 min

  isEnabled: () => Boolean(process.env.FEEDS_MANUAL_CSV_PATH),

  async fetch(): Promise<FeedSnapshot[]> {
    const path = process.env.FEEDS_MANUAL_CSV_PATH;
    if (!path) return []; // graceful: unconfigured

    let text: string;
    try {
      text = await readFile(path, "utf8");
    } catch (err) {
      throw new Error(`manual CSV unreadable at ${path}: ${(err as Error).message}`);
    }

    const parsed = Papa.parse<Record<string, unknown>>(text, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (h) => h.trim(),
    });
    if (parsed.data.length === 0) {
      throw new Error(`manual CSV at ${path} has no data rows`);
    }

    const now = new Date();
    const snapshots: FeedSnapshot[] = [];
    for (const raw of parsed.data) {
      const row = rowSchema.safeParse(raw);
      if (!row.success) continue; // skip malformed rows, keep the good ones
      const r = row.data;
      const asOfDate = r.asOf ? new Date(r.asOf) : now;
      snapshots.push({
        feed: "manual_csv",
        symbol: r.symbol.trim().toUpperCase(),
        region: r.region || undefined,
        payload: {
          symbol: r.symbol.trim().toUpperCase(),
          price: r.price,
          unit: r.unit || null,
          currency: r.currency.toUpperCase(),
          asOf: Number.isNaN(asOfDate.getTime()) ? now.toISOString() : asOfDate.toISOString(),
          ...(r.region ? { region: r.region } : {}),
          source: "manual_csv",
        },
        fetchedAt: now,
        validUntil: new Date(now.getTime() + 12 * 60 * 60 * 1000),
      });
    }
    if (snapshots.length === 0) throw new Error(`manual CSV at ${path} contained no valid rows`);
    return snapshots;
  },
};
