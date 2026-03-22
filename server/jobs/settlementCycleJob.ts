/**
 * NEXCOM Exchange — Settlement Cycle Automation Job
 *
 * Runs daily at market close (15:00 UTC, i.e. 4PM WAT) to:
 *   1. Auto-create a T+1 settlement cycle for each active asset class
 *      (COMMODITY, EQUITY, FX, BOND) if one doesn't already exist.
 *   2. Run DVP matching for any OPEN cycles whose cycleDate has passed.
 *   3. Escalate any MATCHED cycles older than 24h that haven't been settled.
 *   4. Notify the owner with a summary of cycle activity and any unmatched/failed instructions.
 *
 * The job also runs a "stale cycle" check every hour to catch any cycles
 * that were created but never advanced past MATCHING status.
 */
import { getDb } from "../db";
import {
  settlementCycles,
  settlementInstructions,
  settlementFails,
  orders,
} from "../../drizzle/schema";
import { and, eq, lte, not, inArray, sql } from "drizzle-orm";
import { notifyOwner } from "../_core/notification";

const ASSET_CLASSES = ["COMMODITY", "EQUITY", "FOREX", "DIGITAL_ASSET"] as const;
type AssetClass = (typeof ASSET_CLASSES)[number];

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Returns the next business day (skipping weekends) as a UTC Date.
 */
function nextBusinessDay(from: Date = new Date()): Date {
  const d = new Date(from);
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + 1);
  // Skip Saturday (6) and Sunday (0)
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6) {
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return d;
}

/**
 * Returns the system owner user ID (first admin user, or 1 as fallback).
 * Used as createdBy for auto-generated cycles.
 */
async function getOwnerUserId(): Promise<number> {
  const db = await getDb();
  if (!db) return 1;
  try {
    const [admin] = await db.execute(
      sql`SELECT id FROM "user" WHERE role = 'admin' ORDER BY id LIMIT 1`
    ) as unknown as { id: number }[];
    return admin?.id ?? 1;
  } catch {
    return 1;
  }
}

// ─── Core job functions ───────────────────────────────────────────────────────

/**
 * Auto-create T+1 settlement cycles for each asset class for the next business day.
 * Skips any asset class that already has a cycle for that date.
 */
export async function createDailyCycles(): Promise<{
  created: number;
  skipped: number;
  errors: number;
  cycleDate: Date;
}> {
  const db = await getDb();
  if (!db) {
    console.warn("[SettlementCycleJob] DB unavailable — skipping createDailyCycles");
    return { created: 0, skipped: 0, errors: 0, cycleDate: new Date() };
  }

  const cycleDate = nextBusinessDay();
  const ownerUserId = await getOwnerUserId();
  let created = 0;
  let skipped = 0;
  let errors = 0;

  for (const assetClass of ASSET_CLASSES) {
    try {
      // Check if a cycle already exists for this date + type + asset class
      const existing = await db
        .select({ id: settlementCycles.id })
        .from(settlementCycles)
        .where(
          and(
            eq(settlementCycles.cycleDate, cycleDate),
            eq(settlementCycles.settlementType, "T+1"),
            eq(settlementCycles.assetClass, assetClass)
          )
        )
        .limit(1);

      if (existing.length > 0) {
        skipped++;
        continue;
      }

      await db.insert(settlementCycles).values({
        cycleDate,
        settlementType: "T+1",
        assetClass,
        currency: "NGN",
        status: "OPEN",
        createdBy: ownerUserId,
      });
      created++;
      console.log(`[SettlementCycleJob] Created T+1 cycle for ${assetClass} on ${cycleDate.toISOString().split("T")[0]}`);
    } catch (err) {
      console.error(`[SettlementCycleJob] Error creating cycle for ${assetClass}:`, err);
      errors++;
    }
  }

  return { created, skipped, errors, cycleDate };
}

/**
 * Run DVP matching for all OPEN cycles whose cycleDate is today or in the past.
 * Advances them to MATCHING status and computes net positions.
 */
export async function matchOpenCycles(): Promise<{
  matched: number;
  errors: number;
  cycleIds: number[];
}> {
  const db = await getDb();
  if (!db) {
    console.warn("[SettlementCycleJob] DB unavailable — skipping matchOpenCycles");
    return { matched: 0, errors: 0, cycleIds: [] };
  }

  const now = new Date();
  const openCycles = await db
    .select()
    .from(settlementCycles)
    .where(
      and(
        eq(settlementCycles.status, "OPEN"),
        lte(settlementCycles.cycleDate, now)
      )
    );

  let matched = 0;
  let errors = 0;
  const cycleIds: number[] = [];

  for (const cycle of openCycles) {
    try {
      // Advance to MATCHING
      await db
        .update(settlementCycles)
        .set({ status: "MATCHING", updatedAt: new Date() })
        .where(eq(settlementCycles.id, cycle.id));

      // Pull in matched/partially-filled orders for this asset class
      // settlementCycles.assetClass is varchar (not enum), so compare as string
      const matchedOrders = await db
        .select()
        .from(orders)
        .where(
          and(
            sql`${orders.assetClass}::text = ${cycle.assetClass}`,
            inArray(orders.status, ["FILLED", "PARTIALLY_FILLED"])
          )
        );

      // Create settlement instructions for each matched order (buyer + seller pair)
      // settlementInstructions has buyerUserId + sellerUserId (no single userId)
      if (matchedOrders.length > 0) {
        // Insert instructions (ignore duplicates by orderId + cycleId)
        for (const o of matchedOrders) {
          try {
            const totalValue = String(
              parseFloat(o.filledQty) * parseFloat(o.avgFillPrice ?? o.price ?? "0")
            );
            await db.execute(
              sql`INSERT INTO settlement_instructions
                  (cycle_id, order_id, buyer_user_id, seller_user_id, instrument, quantity, price,
                   total_value, currency, instruction_type, status)
                  VALUES (${cycle.id}, ${o.id}, ${o.userId}, ${o.userId},
                          ${o.symbol}, ${o.filledQty},
                          ${o.avgFillPrice ?? o.price ?? "0"}, ${totalValue},
                          'NGN', 'DVP', 'PENDING')
                  ON CONFLICT DO NOTHING`
            );
          } catch {
            // Silently skip duplicate instruction inserts
          }
        }

        // Update cycle totals
        await db
          .update(settlementCycles)
          .set({
            totalTrades: matchedOrders.length,
            matchedTrades: matchedOrders.length,
            status: "MATCHED",
            matchedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(settlementCycles.id, cycle.id));
      } else {
        // No orders — mark as settled immediately (empty cycle)
        await db
          .update(settlementCycles)
          .set({
            totalTrades: 0,
            matchedTrades: 0,
            status: "SETTLED",
            settledAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(settlementCycles.id, cycle.id));
      }

      matched++;
      cycleIds.push(cycle.id);
    } catch (err) {
      console.error(`[SettlementCycleJob] Error matching cycle #${cycle.id}:`, err);
      errors++;
    }
  }

  return { matched, errors, cycleIds };
}

/**
 * Escalate MATCHED cycles that have been in MATCHED status for more than 24h
 * without being settled — creates a fail record for each unconfirmed instruction.
 */
export async function escalateStaleCycles(): Promise<{
  escalated: number;
  failsCreated: number;
}> {
  const db = await getDb();
  if (!db) return { escalated: 0, failsCreated: 0 };

  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000); // 24h ago
  const staleCycles = await db
    .select()
    .from(settlementCycles)
    .where(
      and(
        eq(settlementCycles.status, "MATCHED"),
        lte(settlementCycles.matchedAt, cutoff)
      )
    );

  let escalated = 0;
  let failsCreated = 0;

  for (const cycle of staleCycles) {
    try {
      // Find unconfirmed instructions in this cycle
      const unconfirmed = await db
        .select()
        .from(settlementInstructions)
        .where(
          and(
            eq(settlementInstructions.cycleId, cycle.id),
            not(inArray(settlementInstructions.status, ["SETTLED", "FAILED"]))
          )
        );

      for (const instr of unconfirmed) {
        try {
          await db.insert(settlementFails).values({
            instructionId: instr.id,
            cycleId: cycle.id,
            failType: "STALE_CYCLE",
            failedPartyUserId: instr.buyerUserId,
            penaltyAmount: "0",
            currency: "NGN",
            status: "OPEN",
            escalatedTo: "OPERATIONS_TEAM",
            escalatedAt: new Date(),
          });
          failsCreated++;
        } catch {
          // Ignore duplicate fail records
        }
      }

      // Mark cycle as FAILED
      await db
        .update(settlementCycles)
        .set({
          status: "FAILED",
          failedTrades: unconfirmed.length,
          updatedAt: new Date(),
        })
        .where(eq(settlementCycles.id, cycle.id));

      escalated++;
    } catch (err) {
      console.error(`[SettlementCycleJob] Error escalating cycle #${cycle.id}:`, err);
    }
  }

  return { escalated, failsCreated };
}

/**
 * Run the full market-close job:
 *   1. Create T+1 cycles for tomorrow
 *   2. Match any open cycles for today
 *   3. Escalate stale cycles
 *   4. Send owner notification with summary
 */
export async function runMarketCloseJob(): Promise<void> {
  console.log("[SettlementCycleJob] Running market-close job...");

  const [cycleResult, matchResult, escalateResult] = await Promise.all([
    createDailyCycles(),
    matchOpenCycles(),
    escalateStaleCycles(),
  ]);

  // Build owner notification
  const lines: string[] = [
    `Market Close Settlement Summary — ${new Date().toUTCString()}`,
    "",
    `T+1 Cycles Created: ${cycleResult.created} (skipped: ${cycleResult.skipped}, errors: ${cycleResult.errors})`,
    `Cycles Matched: ${matchResult.matched} (errors: ${matchResult.errors})`,
    `Stale Cycles Escalated: ${escalateResult.escalated} (fails created: ${escalateResult.failsCreated})`,
  ];

  if (matchResult.cycleIds.length > 0) {
    lines.push(`Matched Cycle IDs: ${matchResult.cycleIds.join(", ")}`);
  }

  if (escalateResult.escalated > 0) {
    lines.push("");
    lines.push(`⚠️ ACTION REQUIRED: ${escalateResult.escalated} stale cycle(s) were escalated to OPERATIONS_TEAM.`);
    lines.push(`${escalateResult.failsCreated} fail record(s) created. Review in Settlement Fails dashboard.`);
  }

  const hasIssues =
    cycleResult.errors > 0 ||
    matchResult.errors > 0 ||
    escalateResult.escalated > 0;

  await notifyOwner({
    title: hasIssues
      ? `⚠️ Settlement Market Close — Issues Detected`
      : `✅ Settlement Market Close — Completed`,
    content: lines.join("\n"),
  });

  console.log("[SettlementCycleJob] Market-close job complete:", {
    cycleResult,
    matchResult,
    escalateResult,
  });
}

/**
 * Hourly stale-cycle check — escalates any MATCHED cycles older than 24h.
 * Sends a notification only if escalations occurred.
 */
export async function runHourlyStaleCheck(): Promise<void> {
  const result = await escalateStaleCycles();
  if (result.escalated > 0) {
    console.log(`[SettlementCycleJob] Hourly stale check: escalated ${result.escalated} cycles, created ${result.failsCreated} fails`);
    await notifyOwner({
      title: `⚠️ Settlement Stale Cycles Detected`,
      content:
        `Hourly check found ${result.escalated} stale settlement cycle(s) that have been in MATCHED status for over 24 hours.\n` +
        `${result.failsCreated} fail record(s) created and escalated to OPERATIONS_TEAM.\n` +
        `Please review in the Settlement Fails dashboard.`,
    });
  }
}

// ─── Scheduler ───────────────────────────────────────────────────────────────

/**
 * Start the settlement cycle automation job.
 *
 * Schedule:
 *   - Market close job: daily at 15:00 UTC (4PM WAT / Nigerian market close)
 *   - Stale cycle check: every hour
 */
export function startSettlementCycleJob(): void {
  const HOUR_MS = 60 * 60 * 1000;

  // ── Market close job at 15:00 UTC daily ──────────────────────────────────
  function scheduleNextMarketClose(): void {
    const now = new Date();
    const next = new Date(now);
    next.setUTCHours(15, 0, 0, 0);
    if (next <= now) {
      // Already past 15:00 UTC today — schedule for tomorrow
      next.setUTCDate(next.getUTCDate() + 1);
    }
    const msUntilClose = next.getTime() - now.getTime();
    console.log(
      `[SettlementCycleJob] Next market-close job in ${Math.round(msUntilClose / 60000)} minutes (${next.toUTCString()})`
    );
    setTimeout(() => {
      runMarketCloseJob().catch(console.error);
      // Schedule the next one 24h later
      setInterval(() => runMarketCloseJob().catch(console.error), 24 * HOUR_MS);
    }, msUntilClose);
  }

  scheduleNextMarketClose();

  // ── Hourly stale cycle check ──────────────────────────────────────────────
  setInterval(() => runHourlyStaleCheck().catch(console.error), HOUR_MS);

  console.log("[SettlementCycleJob] Started — market close at 15:00 UTC daily, stale check every hour");
}
