/**
 * Mark-to-Market Automation Job
 *
 * Runs daily at 16:00 WAT (15:00 UTC) to:
 *  1. Find all active futures contracts
 *  2. Use the last traded price from the order book as the settlement price
 *  3. Run adminMarkToMarket for each contract to update position P&L
 *  4. Send an owner notification with the daily P&L summary
 */
import { getDb } from "../db";
import {
  futuresContracts,
  futuresPositions,
  futuresSettlements,
  clearingAccounts,
  orders,
} from "../../drizzle/schema";
import { eq, and, desc, sql } from "drizzle-orm";
import { notifyOwner } from "../_core/notification";

const SETTLEMENT_HOUR_UTC = 15; // 16:00 WAT = 15:00 UTC
const JOB_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours

function getTodayDateString(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Get the last traded price for a given instrument symbol from the orders table.
 * Falls back to the contract's lastMarkPrice if no trades found today.
 */
async function getLastTradedPrice(
  db: Awaited<ReturnType<typeof getDb>>,
  symbol: string,
  fallbackPrice: string | null,
): Promise<number | null> {
  if (!db) return null;

  // Look for the most recently filled order for this symbol
  const [lastOrder] = await db
    .select({ price: orders.price })
    .from(orders)
    .where(and(eq(orders.symbol, symbol), eq(orders.status, "FILLED")))
    .orderBy(desc(orders.updatedAt))
    .limit(1);

  if (lastOrder?.price) return parseFloat(lastOrder.price);
  if (fallbackPrice) return parseFloat(fallbackPrice);
  return null;
}

/**
 * Run mark-to-market settlement for a single contract.
 * Returns a summary of positions settled and P&L.
 */
async function settleContract(
  db: Awaited<ReturnType<typeof getDb>>,
  contract: typeof futuresContracts.$inferSelect,
  settlementPrice: number,
): Promise<{ positionsSettled: number; totalLongPnl: number; totalShortPnl: number }> {
  if (!db) return { positionsSettled: 0, totalLongPnl: 0, totalShortPnl: 0 };

  const openPositions = await db
    .select()
    .from(futuresPositions)
    .where(
      and(
        eq(futuresPositions.contractId, contract.id),
        eq(futuresPositions.status, "OPEN"),
      ),
    );

  if (openPositions.length === 0) {
    return { positionsSettled: 0, totalLongPnl: 0, totalShortPnl: 0 };
  }

  const contractSize = parseFloat(contract.contractSize);
  let totalLongPnl = 0;
  let totalShortPnl = 0;

  for (const pos of openPositions) {
    const qty = parseFloat(pos.quantity);
    const entryPrice = parseFloat(pos.entryPrice);
    const prevMarkPrice = parseFloat(pos.currentMarkPrice ?? String(entryPrice));

    // Daily P&L = change in mark price since last settlement
    const dailyPriceDiff = pos.side === "LONG"
      ? settlementPrice - prevMarkPrice
      : prevMarkPrice - settlementPrice;
    const dailyPnl = dailyPriceDiff * qty * contractSize;

    // Total unrealized P&L from entry
    const totalPriceDiff = pos.side === "LONG"
      ? settlementPrice - entryPrice
      : entryPrice - settlementPrice;
    const unrealizedPnl = totalPriceDiff * qty * contractSize;

    if (pos.side === "LONG") totalLongPnl += dailyPnl;
    else totalShortPnl += dailyPnl;

    // Update position mark price and unrealized P&L
    await db
      .update(futuresPositions)
      .set({
        currentMarkPrice: String(settlementPrice),
        unrealizedPnl: String(unrealizedPnl),
        updatedAt: new Date(),
      })
      .where(eq(futuresPositions.id, pos.id));

    // Credit/debit clearing account with daily P&L
    const [clearingAccount] = await db
      .select()
      .from(clearingAccounts)
      .where(eq(clearingAccounts.userId, pos.userId))
      .limit(1);

    if (clearingAccount) {
      const newBalance = parseFloat(clearingAccount.cashBalance) + dailyPnl;
      await db
        .update(clearingAccounts)
        .set({ cashBalance: String(newBalance), updatedAt: new Date() })
        .where(eq(clearingAccounts.id, clearingAccount.id));
    }
  }

  // Record the daily settlement
  await db.insert(futuresSettlements).values({
    contractId: contract.id,
    settlementType: "DAILY_MTM",
    settlementPrice: String(settlementPrice),
    totalLongPnl: String(totalLongPnl),
    totalShortPnl: String(totalShortPnl),
    positionsSettled: openPositions.length,
  });

  // Update contract last mark price
  await db
    .update(futuresContracts)
    .set({ lastMarkPrice: String(settlementPrice), updatedAt: new Date() })
    .where(eq(futuresContracts.id, contract.id));

  return {
    positionsSettled: openPositions.length,
    totalLongPnl,
    totalShortPnl,
  };
}

/**
 * Main job function — runs mark-to-market for all active contracts.
 */
async function runMarkToMarket(): Promise<void> {
  const db = await getDb();
  if (!db) {
    console.error("[MtMJob] DB unavailable, skipping mark-to-market run");
    return;
  }

  const today = getTodayDateString();
  console.log(`[MtMJob] Starting daily mark-to-market settlement for ${today}`);

  try {
    // Fetch all active contracts
    const activeContracts = await db
      .select()
      .from(futuresContracts)
      .where(eq(futuresContracts.status, "ACTIVE"));

    if (activeContracts.length === 0) {
      console.log("[MtMJob] No active contracts to settle.");
      return;
    }

    const results: Array<{
      symbol: string;
      settlementPrice: number;
      positionsSettled: number;
      totalLongPnl: number;
      totalShortPnl: number;
    }> = [];

    for (const contract of activeContracts) {
      const settlementPrice = await getLastTradedPrice(db, contract.symbol, contract.lastMarkPrice);
      if (!settlementPrice) {
        console.warn(`[MtMJob] No price found for ${contract.symbol}, skipping`);
        continue;
      }

      const summary = await settleContract(db, contract, settlementPrice);
      results.push({ symbol: contract.symbol, settlementPrice, ...summary });

      console.log(
        `[MtMJob] ${contract.symbol}: price=${settlementPrice}, ` +
        `positions=${summary.positionsSettled}, ` +
        `longPnl=${summary.totalLongPnl.toFixed(2)}, ` +
        `shortPnl=${summary.totalShortPnl.toFixed(2)}`,
      );
    }

    // Send owner notification with daily P&L summary
    if (results.length > 0) {
      const totalPositions = results.reduce((s, r) => s + r.positionsSettled, 0);
      const totalLongPnl = results.reduce((s, r) => s + r.totalLongPnl, 0);
      const totalShortPnl = results.reduce((s, r) => s + r.totalShortPnl, 0);
      const netPnl = totalLongPnl + totalShortPnl;

      const contractLines = results
        .map(
          (r) =>
            `• ${r.symbol}: price=${r.settlementPrice.toFixed(2)}, ` +
            `${r.positionsSettled} positions, ` +
            `long P&L=${r.totalLongPnl.toFixed(2)}, ` +
            `short P&L=${r.totalShortPnl.toFixed(2)}`,
        )
        .join("\n");

      await notifyOwner({
        title: `Daily Mark-to-Market Settlement — ${today}`,
        content:
          `Daily MtM settlement completed for ${results.length} contract(s).\n\n` +
          `Summary:\n` +
          `  Total positions settled: ${totalPositions}\n` +
          `  Net P&L (long side): ${totalLongPnl.toFixed(2)} NGN\n` +
          `  Net P&L (short side): ${totalShortPnl.toFixed(2)} NGN\n` +
          `  Combined net P&L: ${netPnl.toFixed(2)} NGN\n\n` +
          `Per-contract breakdown:\n${contractLines}`,
      });
    }

    console.log(`[MtMJob] Mark-to-market complete. ${results.length} contracts settled.`);
  } catch (err) {
    console.error("[MtMJob] Error during mark-to-market:", err);
  }
}

/**
 * Schedule the mark-to-market job to run daily at 16:00 WAT (15:00 UTC).
 * Uses a polling approach: checks every minute if it's time to run.
 */
export function startMarkToMarketJob(): void {
  let lastRunDate: string | null = null;

  function tick() {
    const now = new Date();
    const hourUTC = now.getUTCHours();
    const today = getTodayDateString();

    // Run at 15:00 UTC (16:00 WAT) if not already run today
    if (hourUTC === SETTLEMENT_HOUR_UTC && lastRunDate !== today) {
      lastRunDate = today;
      runMarkToMarket().catch((err) =>
        console.error("[MtMJob] Unhandled error:", err),
      );
    }
  }

  // Check every minute
  setInterval(tick, 60 * 1000);
  console.log("[MtMJob] Mark-to-market job scheduled (daily at 16:00 WAT)");
}
