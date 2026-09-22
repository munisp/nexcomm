/**
 * feedsRouter.ts — public market-information feeds (DATA-FEEDS).
 *
 * Weather and external reference prices are non-sensitive public market
 * information → publicProcedure (and on the SWR read-cache allowlist).
 * Operational feed health is privileged → adminProcedure.
 *
 * All reads go through the registry's fresh → last-known-good → DB chain,
 * so responses stay available (stale-marked) during upstream outages.
 */
import { z } from "zod";
import { desc, and, eq, gte, inArray } from "drizzle-orm";
import { publicProcedure, adminProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { marketFeedSnapshots } from "../../drizzle/schema-feeds";
import {
  getSnapshot,
  getAllSnapshots,
  getFeedHealth,
} from "../services/feeds/registry";
import { weatherLocations } from "../services/feeds/adapters/openMeteo";
import type { SnapshotResult } from "../services/feeds/types";

/** Feed names that publish reference prices, newest-wins merge order. */
const REFERENCE_PRICE_FEEDS = ["afex", "manual_csv"] as const;

interface MergedReferencePrice {
  symbol: string;
  price: number;
  unit: string | null;
  priceNgnPerKg?: number;
  priceNgnPerMT?: number;
  currency: string;
  asOf: string;
  source: string;
  region?: string;
  stale: boolean;
  fetchedAt: string;
}

function toMerged(snap: SnapshotResult): MergedReferencePrice | null {
  const p = snap.payload as Record<string, unknown>;
  if (typeof p.price !== "number" || typeof p.symbol !== "string") return null;
  return {
    symbol: p.symbol,
    price: p.price,
    unit: (p.unit as string | null) ?? null,
    priceNgnPerKg: typeof p.priceNgnPerKg === "number" ? p.priceNgnPerKg : undefined,
    priceNgnPerMT: typeof p.priceNgnPerMT === "number" ? p.priceNgnPerMT : undefined,
    currency: (p.currency as string) ?? "NGN",
    asOf: (p.asOf as string) ?? snap.fetchedAt,
    source: (p.source as string) ?? snap.feed,
    region: snap.region,
    stale: snap.stale,
    fetchedAt: snap.fetchedAt,
  };
}

export const feedsRouter = router({
  /** Agro-weather snapshot(s). With locationKey → one zone; without → all zones. */
  getWeather: publicProcedure
    .input(z.object({ locationKey: z.string().max(64).optional() }).optional())
    .query(async ({ input }) => {
      if (input?.locationKey) {
        const snap = await getSnapshot("openmeteo", input.locationKey);
        return { snapshots: snap ? [snap] : [] };
      }
      return { snapshots: await getAllSnapshots("openmeteo") };
    }),

  /** Configured weather locations (for pickers/maps even before first fetch). */
  listWeatherLocations: publicProcedure.query(() => ({
    locations: weatherLocations(),
  })),

  /**
   * Merged external reference prices across all configured price feeds.
   * Newest fetchedAt wins per symbol; source/asOf/stale always included.
   */
  getReferencePrices: publicProcedure
    .input(z.object({ symbol: z.string().max(64).optional() }).optional())
    .query(async ({ input }) => {
      const wanted = input?.symbol?.toUpperCase();
      const bySymbol = new Map<string, MergedReferencePrice>();

      for (const feed of REFERENCE_PRICE_FEEDS) {
        const snaps = wanted
          ? [await getSnapshot(feed, wanted)].filter((s): s is SnapshotResult => s !== null)
          : await getAllSnapshots(feed);
        for (const snap of snaps) {
          const merged = toMerged(snap);
          if (!merged) continue;
          const existing = bySymbol.get(merged.symbol);
          if (!existing || existing.fetchedAt < merged.fetchedAt) {
            bySymbol.set(merged.symbol, merged);
          }
        }
      }
      const prices = [...bySymbol.values()].sort((a, b) => a.symbol.localeCompare(b.symbol));
      return { prices, servedAt: new Date().toISOString() };
    }),

  /** Official statistics series (NBS food CPI etc.). */
  getStatistics: publicProcedure
    .input(z.object({ series: z.string().max(64).optional() }).optional())
    .query(async ({ input }) => {
      if (input?.series) {
        const snap = await getSnapshot("nbs", input.series.toUpperCase());
        return { snapshots: snap ? [snap] : [] };
      }
      return { snapshots: await getAllSnapshots("nbs") };
    }),

  /** Time series for charting, straight from the durable snapshot store. */
  referencePricesHistory: publicProcedure
    .input(z.object({
      symbol: z.string().min(1).max(64),
      days: z.number().int().min(1).max(365).default(30),
    }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return { symbol: input.symbol.toUpperCase(), points: [] };
      const since = new Date(Date.now() - input.days * 24 * 60 * 60 * 1000);
      const rows = await db
        .select({
          feed: marketFeedSnapshots.feed,
          payload: marketFeedSnapshots.payload,
          fetchedAt: marketFeedSnapshots.fetchedAt,
        })
        .from(marketFeedSnapshots)
        .where(and(
          inArray(marketFeedSnapshots.feed, [...REFERENCE_PRICE_FEEDS]),
          eq(marketFeedSnapshots.symbol, input.symbol.toUpperCase()),
          gte(marketFeedSnapshots.fetchedAt, since),
        ))
        .orderBy(desc(marketFeedSnapshots.fetchedAt))
        .limit(1000);
      const points = rows
        .map((r) => {
          const p = r.payload as Record<string, unknown>;
          return typeof p.price === "number"
            ? {
                fetchedAt: r.fetchedAt.toISOString(),
                price: p.price,
                priceNgnPerKg: typeof p.priceNgnPerKg === "number" ? p.priceNgnPerKg : undefined,
                currency: (p.currency as string) ?? "NGN",
                source: (p.source as string) ?? r.feed,
              }
            : null;
        })
        .filter((p): p is NonNullable<typeof p> => p !== null)
        .reverse();
      return { symbol: input.symbol.toUpperCase(), points };
    }),

  /** Operational feed health — admin/ops only. */
  getFeedHealth: adminProcedure.query(() => ({
    feeds: getFeedHealth(),
    servedAt: new Date().toISOString(),
  })),
});
