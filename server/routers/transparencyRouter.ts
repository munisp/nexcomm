/**
 * transparencyRouter.ts (INNOV-D — Innovation 10)
 * Market Transparency Portal — ALL procedures are public and return only
 * aggregated, anonymized platform data. No row-level or PII data is exposed.
 * Every metric is derived from real tables; where a metric cannot be derived
 * from existing columns the endpoint returns null honestly.
 */
import { publicProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import {
  orders,
  settlements,
  users,
  profiles,
  warehouses,
  fieldAgents,
  livePrices,
} from "../../drizzle/schema";
import { eq, gte, sql, and, inArray } from "drizzle-orm";

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

export const transparencyRouter = router({
  /**
   * 30-day market activity: trade count, gross traded value (filled qty × avg
   * fill price), distinct commodities (symbols) and distinct states of the
   * accounts that traded (via profiles.state).
   */
  marketStats: publicProcedure.query(async () => {
    const db = await getDb();
    if (!db) {
      return { windowDays: 30, tradeCount: 0, grossValueNgn: null, distinctCommodities: 0, distinctStates: null };
    }
    const since = new Date(Date.now() - THIRTY_DAYS_MS);

    const [filled] = await db
      .select({
        tradeCount: sql<number>`count(*)`,
        grossValue: sql<string | null>`sum(${orders.filledQty} * ${orders.avgFillPrice})`,
        distinctCommodities: sql<number>`count(distinct ${orders.symbol})`,
      })
      .from(orders)
      .where(
        and(
          gte(orders.createdAt, since),
          inArray(orders.status, ["FILLED", "PARTIALLY_FILLED"]),
        ),
      );

    // Distinct states of the accounts that traded in the window.
    const [states] = await db
      .select({ distinctStates: sql<number>`count(distinct ${profiles.state})` })
      .from(profiles)
      .where(
        and(
          sql`${profiles.state} is not null`,
          sql`${profiles.userId} in (select ${orders.userId} from ${orders} where ${orders.createdAt} >= ${since})`,
        ),
      );

    return {
      windowDays: 30,
      tradeCount: Number(filled?.tradeCount ?? 0),
      grossValueNgn: filled?.grossValue != null ? Number(filled.grossValue) : null,
      distinctCommodities: Number(filled?.distinctCommodities ?? 0),
      distinctStates: states ? Number(states.distinctStates) : null,
    };
  }),

  /**
   * Settlement outcomes over the trailing 30 days: settled vs failed counts,
   * plus median settlement latency (hours from settlement creation to
   * settlement_date) where derivable — null when no settled rows carry a
   * settlement_date.
   */
  settlementStats: publicProcedure.query(async () => {
    const db = await getDb();
    if (!db) {
      return { windowDays: 30, settledCount: 0, failedCount: 0, medianSettlementHours: null };
    }
    const since = new Date(Date.now() - THIRTY_DAYS_MS);

    const [counts] = await db
      .select({
        settledCount: sql<number>`count(*) filter (where ${settlements.status} = 'SETTLED')`,
        failedCount: sql<number>`count(*) filter (where ${settlements.status} = 'FAILED')`,
      })
      .from(settlements)
      .where(gte(settlements.createdAt, since));

    const latencyRows = await db
      .select({ createdAt: settlements.createdAt, settlementDate: settlements.settlementDate })
      .from(settlements)
      .where(
        and(
          gte(settlements.createdAt, since),
          eq(settlements.status, "SETTLED"),
          sql`${settlements.settlementDate} is not null`,
        ),
      );

    let medianSettlementHours: number | null = null;
    if (latencyRows.length > 0) {
      const hours = latencyRows
        .filter((r) => r.settlementDate)
        .map((r) => (r.settlementDate!.getTime() - r.createdAt.getTime()) / 3_600_000)
        .filter((h) => h >= 0)
        .sort((a, b) => a - b);
      if (hours.length > 0) {
        const mid = Math.floor(hours.length / 2);
        medianSettlementHours =
          hours.length % 2 === 0 ? (hours[mid - 1] + hours[mid]) / 2 : hours[mid];
      }
    }

    return {
      windowDays: 30,
      settledCount: Number(counts?.settledCount ?? 0),
      failedCount: Number(counts?.failedCount ?? 0),
      medianSettlementHours,
    };
  }),

  /**
   * Platform participation counts: accredited/active warehouses, active field
   * agents, and registered users grouped by role.
   */
  platformHealth: publicProcedure.query(async () => {
    const db = await getDb();
    if (!db) {
      return { activeWarehouses: null, accreditedWarehouses: null, activeAgents: null, usersByRole: [] };
    }

    const [wh] = await db
      .select({
        active: sql<number>`count(*) filter (where ${warehouses.isActive})`,
        accredited: sql<number>`count(*) filter (where ${warehouses.accreditationStatus} = 'ACCREDITED')`,
      })
      .from(warehouses);

    const [agents] = await db
      .select({ active: sql<number>`count(*)` })
      .from(fieldAgents)
      .where(eq(fieldAgents.status, "ACTIVE"));

    const usersByRole = await db
      .select({ role: users.role, count: sql<number>`count(*)` })
      .from(users)
      .groupBy(users.role);

    return {
      activeWarehouses: Number(wh?.active ?? 0),
      accreditedWarehouses: Number(wh?.accredited ?? 0),
      activeAgents: Number(agents?.active ?? 0),
      usersByRole: usersByRole.map((r) => ({ role: r.role, count: Number(r.count) })),
    };
  }),

  /**
   * Per-commodity price discovery from the live_prices feed table.
   * changePct is the feed-provided change versus previous close (labeled as
   * such client-side). Returns an empty array when no prices are available.
   */
  priceDiscovery: publicProcedure.query(async () => {
    const db = await getDb();
    if (!db) return { commodities: [] };
    const rows = await db
      .select({
        symbol: livePrices.symbol,
        name: livePrices.name,
        lastPrice: livePrices.price,
        previousClose: livePrices.previousClose,
        changePct: livePrices.changePct,
        currency: livePrices.currency,
        updatedAt: livePrices.updatedAt,
      })
      .from(livePrices)
      .where(eq(livePrices.assetClass, "COMMODITY"))
      .orderBy(livePrices.symbol);

    return {
      commodities: rows.map((r) => ({
        symbol: r.symbol,
        name: r.name,
        lastPrice: r.lastPrice != null ? Number(r.lastPrice) : null,
        previousClose: r.previousClose != null ? Number(r.previousClose) : null,
        changePct: r.changePct != null ? Number(r.changePct) : null,
        currency: r.currency,
        updatedAt: r.updatedAt,
      })),
    };
  }),
});
