/**
 * Forced Liquidation Job
 * ─────────────────────────────────────────────────────────────────────────────
 * Runs every 5 minutes. For each margin account with utilisation >= 100%:
 *   1. Cancels all OPEN and PARTIALLY_FILLED orders for that user
 *   2. Marks all ACTIVE collateral items as LIQUIDATED
 *   3. Resets usedMargin and availableMargin
 *   4. Inserts a LIQUIDATED in-app notification with a summary
 *   5. Writes an audit log entry
 */

import { getDb } from "../db";
import {
  marginAccounts,
  collateralItems,
  collateralLedger,
  orders,
  notifications,
  auditLog,
} from "../../drizzle/schema";
import { eq, and, inArray, sql } from "drizzle-orm";

async function runLiquidationCheck() {
  const db = await getDb();
  if (!db) return;

  try {
    // Find all active margin accounts
    const allAccounts = await db
      .select()
      .from(marginAccounts)
      .where(eq(marginAccounts.status, "ACTIVE"));

    for (const account of allAccounts) {
      const totalCollateralValue = parseFloat(account.totalCollateralValue ?? "0");
      const usedMargin = parseFloat(account.usedMargin ?? "0");

      if (totalCollateralValue <= 0) continue;

      const utilisation = (usedMargin / totalCollateralValue) * 100;
      if (utilisation < 100) continue;

      // ── Step 1: Cancel all open orders ──────────────────────────────────
      const openOrders = await db
        .select({ id: orders.id, symbol: orders.symbol, side: orders.side, quantity: orders.quantity })
        .from(orders)
        .where(
          and(
            eq(orders.userId, account.userId),
            inArray(orders.status, ["OPEN", "PARTIALLY_FILLED"])
          )
        );

      if (openOrders.length > 0) {
        const orderIds = openOrders.map((o) => o.id);
        await db
          .update(orders)
          .set({ status: "CANCELLED", updatedAt: new Date() })
          .where(inArray(orders.id, orderIds));
      }

      // ── Step 2: Liquidate all ACTIVE collateral items ────────────────────
      const activeItems = await db
        .select({ id: collateralItems.id, eligibleValue: collateralItems.eligibleValue })
        .from(collateralItems)
        .where(
          and(
            eq(collateralItems.marginAccountId, account.id),
            eq(collateralItems.status, "ACTIVE")
          )
        );

      if (activeItems.length > 0) {
        const itemIds = activeItems.map((i) => i.id);
        await db
          .update(collateralItems)
          .set({ status: "LIQUIDATED", releasedAt: new Date() })
          .where(inArray(collateralItems.id, itemIds));

        // Log each liquidation in the collateral ledger
        for (const item of activeItems) {
          const val = item.eligibleValue ?? "0";
          await db.insert(collateralLedger).values({
            userId: account.userId,
            collateralItemId: item.id,
            action: "LIQUIDATE",
            amount: val,
            balanceBefore: val,
            balanceAfter: "0",
            description: "Forced liquidation — margin utilisation exceeded 100%",
            createdAt: new Date(),
          });
        }
      }

      // ── Step 3: Reset margin account balances ────────────────────────────
      await db
        .update(marginAccounts)
        .set({
          usedMargin: "0",
          availableMargin: "0",
          totalCollateralValue: "0",
          updatedAt: new Date(),
        })
        .where(eq(marginAccounts.id, account.id));

      // ── Step 4: Send LIQUIDATED notification ─────────────────────────────
      const cancelledCount = openOrders.length;
      const liquidatedCount = activeItems.length;
      const liquidatedValue = activeItems.reduce(
        (sum, i) => sum + parseFloat(i.eligibleValue ?? "0"),
        0
      );

      await db.insert(notifications).values({
        userId: account.userId,
        title: "⚠️ Forced Liquidation Executed",
        message: [
          `Your margin utilisation reached ${utilisation.toFixed(1)}%, triggering a forced liquidation.`,
          cancelledCount > 0
            ? `${cancelledCount} open order${cancelledCount !== 1 ? "s" : ""} cancelled.`
            : "No open orders were cancelled.",
          liquidatedCount > 0
            ? `${liquidatedCount} collateral item${liquidatedCount !== 1 ? "s" : ""} liquidated (₦${liquidatedValue.toLocaleString()} eligible value).`
            : "",
          "Please review your margin account and deposit additional collateral before placing new orders.",
        ]
          .filter(Boolean)
          .join(" "),
        type: "LIQUIDATED",
        metadata: {
          utilisationPct: utilisation,
          cancelledOrders: cancelledCount,
          liquidatedCollateral: liquidatedCount,
          liquidatedValue,
        },
      });

      // ── Step 5: Audit log entry ──────────────────────────────────────────
      await db.insert(auditLog).values({
        userId: account.userId,
        action: "FORCED_LIQUIDATION",
        resource: "margin_account",
        resourceId: String(account.id),
        details: {
          utilisationPct: utilisation,
          cancelledOrders: openOrders.map((o) => o.id),
          liquidatedCollateralItems: activeItems.map((i) => i.id),
        },
        createdAt: new Date(),
      });

      console.log(
        `[LiquidationJob] Liquidated userId=${account.userId}: ${cancelledCount} orders cancelled, ${liquidatedCount} collateral items liquidated`
      );
    }
  } catch (err) {
    console.error("[LiquidationJob] Error during liquidation check:", err);
  }
}

export function startLiquidationJob() {
  // Run immediately on startup, then every 5 minutes
  runLiquidationCheck();
  const INTERVAL_MS = 5 * 60 * 1000;
  setInterval(runLiquidationCheck, INTERVAL_MS);
  console.log("[LiquidationJob] Started — checking every 5 minutes");
}
