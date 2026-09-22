/**
 * Market feed snapshots (DATA-FEEDS) — durable store for the pluggable
 * external data-feed framework (server/services/feeds). Every successful
 * adapter fetch (weather, reference prices, official statistics, custom)
 * appends a row here; the table doubles as the last-known-good store when
 * Redis is cold, aligning with the platform's offline-first mandate.
 *
 * Kept in a separate schema file to avoid churn in schema.ts; register with
 * `export * from "./schema-feeds";` at the end of drizzle/schema.ts.
 */
import { pgTable, uuid, varchar, jsonb, timestamp, index } from "drizzle-orm/pg-core";

export const marketFeedSnapshots = pgTable(
  "market_feed_snapshots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Adapter/feed name, e.g. "openmeteo", "afex", "nbs", "manual_csv".
    feed: varchar("feed", { length: 64 }).notNull(),
    // Series key — commodity symbol, weather location key, stat series id.
    symbol: varchar("symbol", { length: 64 }),
    // Region/state label, e.g. "Kano", "Nigeria".
    region: varchar("region", { length: 128 }),
    // Normalized adapter payload (zod-validated pre-persist).
    payload: jsonb("payload").notNull(),
    fetchedAt: timestamp("fetched_at").defaultNow().notNull(),
    // Freshness horizon; past this consumers must mark the snapshot stale.
    validUntil: timestamp("valid_until"),
  },
  (t) => [
    index("market_feed_snapshots_feed_idx").on(t.feed),
    index("market_feed_snapshots_feed_symbol_fetched_idx").on(t.feed, t.symbol, t.fetchedAt),
  ]
);

export type MarketFeedSnapshot = typeof marketFeedSnapshots.$inferSelect;
export type InsertMarketFeedSnapshot = typeof marketFeedSnapshots.$inferInsert;
