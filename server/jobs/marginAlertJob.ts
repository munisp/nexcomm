/**
 * NEXCOM Exchange — Margin Call Alert Job
 *
 * Runs every 5 minutes.
 * Checks all ACTIVE margin accounts for high utilisation:
 *   ≥ 80%  → WARNING notification (once per day per user)
 *   ≥ 95%  → CRITICAL notification (once per hour per user)
 *
 * Deduplication: tracks last-notified timestamp in the margin_accounts table
 * using the `lastMarginCallAt` column.
 */
import { getDb } from "../db";
import { marginAccounts, notifications } from "../../drizzle/schema";
import { and, eq, sql } from "drizzle-orm";
import { emitRiskAlert } from "../kafka/kafkaProducer";

const JOB_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

/** Thresholds */
const WARNING_PCT  = 80;  // fire WARNING when utilisation ≥ 80%
const CRITICAL_PCT = 95;  // fire CRITICAL when utilisation ≥ 95%

/** Minimum gap between notifications of the same level */
const WARNING_COOLDOWN_MS  = 24 * 60 * 60 * 1000; // 24 hours
const CRITICAL_COOLDOWN_MS =      60 * 60 * 1000; //  1 hour

export async function runMarginAlertJob(): Promise<number> {
  const db = await getDb();
  if (!db) {
    console.warn("[MarginAlertJob] Database unavailable — skipping");
    return 0;
  }

  const now = new Date();

  // Fetch all ACTIVE margin accounts
  const accounts = await db
    .select()
    .from(marginAccounts)
    .where(eq(marginAccounts.status, "ACTIVE"));

  let alertsFired = 0;

  for (const acct of accounts) {
    try {
      const totalCollateral = parseFloat(acct.totalCollateralValue ?? "0");
      const usedMargin      = parseFloat(acct.usedMargin ?? "0");

      if (totalCollateral <= 0) continue;

      const utilisationPct = Math.min(100, (usedMargin / totalCollateral) * 100);

      if (utilisationPct < WARNING_PCT) continue;

      const isCritical = utilisationPct >= CRITICAL_PCT;
      const cooldownMs = isCritical ? CRITICAL_COOLDOWN_MS : WARNING_COOLDOWN_MS;

      // Check last notification time
      const lastNotified = acct.lastMarginCallAt ? new Date(acct.lastMarginCallAt).getTime() : 0;
      const timeSinceLast = now.getTime() - lastNotified;

      if (timeSinceLast < cooldownMs) continue; // still in cooldown

      const level   = isCritical ? "CRITICAL" : "WARNING";
      const pctStr  = utilisationPct.toFixed(1);
      const title   = isCritical
        ? `⚠️ Critical Margin Alert — ${pctStr}% Utilisation`
        : `Margin Warning — ${pctStr}% Utilisation`;
      const message = isCritical
        ? `Your margin utilisation has reached ${pctStr}%. Immediate action required: add collateral or reduce open positions to avoid forced liquidation.`
        : `Your margin utilisation is at ${pctStr}% (warning threshold: ${WARNING_PCT}%). Consider adding collateral or reducing positions to maintain a healthy margin buffer.`;

      // Insert notification
      await db.insert(notifications).values({
        userId: acct.userId,
        type:   "MARGIN_CALL",
        title,
        message,
        read:   false,
      });

            // Update lastMarginCallAt on the account
      await db
        .update(marginAccounts)
        .set({ lastMarginCallAt: now, updatedAt: now })
        .where(eq(marginAccounts.id, acct.id));
      // Emit Kafka risk alert for downstream consumers (risk-management service, AML)
      emitRiskAlert({
        alertType: "MARGIN_CALL",
        userId: acct.userId,
        severity: isCritical ? "CRITICAL" : "HIGH",
        message: `Margin utilisation ${utilisationPct.toFixed(1)}% exceeds ${isCritical ? CRITICAL_PCT : WARNING_PCT}% threshold`,
      }).catch(e => console.warn("[Kafka] emitRiskAlert failed:", (e as Error).message));
      alertsFired++;
      console.log(`[MarginAlertJob] ${level} alert fired for userId=${acct.userId} (${pctStr}%)`);
    } catch (err) {
      console.error(`[MarginAlertJob] Error processing accountId=${acct.id}:`, err);
    }
  }

  if (alertsFired > 0) {
    console.log(`[MarginAlertJob] Fired ${alertsFired} alert(s)`);
  }
  return alertsFired;
}

export function startMarginAlertJob(): void {
  runMarginAlertJob().catch(console.error);
  setInterval(() => runMarginAlertJob().catch(console.error), JOB_INTERVAL_MS);
  console.log(`[MarginAlertJob] Started — checking every ${JOB_INTERVAL_MS / 1000}s`);
}
