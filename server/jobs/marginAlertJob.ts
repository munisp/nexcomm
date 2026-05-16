/**
 * NEXCOM Exchange — Margin Call Alert Job
 *
 * Runs every 5 minutes.
 * Checks all ACTIVE margin accounts for high utilisation.
 *
 * Per-user thresholds (from user_preferences):
 *   marginWarningPct  (default 80%)  → WARNING notification (once per 24h per user)
 *   marginCriticalPct (default 95%)  → CRITICAL notification (once per 1h per user)
 *
 * Falls back to global constants if the user has no preference row.
 *
 * Deduplication: tracks last-notified timestamp in the margin_accounts table
 * using the `lastMarginCallAt` column.
 */
import { getDb } from "../db";
import { marginAccounts, notifications, userPreferences } from "../../drizzle/schema";
import { and, eq, inArray } from "drizzle-orm";
import { emitRiskAlert } from "../kafka/kafkaProducer";

const JOB_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

/** Global fallback thresholds (used when no user preference row exists) */
const DEFAULT_WARNING_PCT  = 80;
const DEFAULT_CRITICAL_PCT = 95;

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

  if (accounts.length === 0) return 0;

  // Bulk-fetch per-user preferences for all affected users
  const userIds = [...new Set(accounts.map(a => a.userId).filter(Boolean))] as number[];
  const prefsRows = userIds.length > 0
    ? await db
        .select({
          userId:           userPreferences.userId,
          marginWarningPct: userPreferences.marginWarningPct,
          marginCriticalPct: userPreferences.marginCriticalPct,
        })
        .from(userPreferences)
        .where(inArray(userPreferences.userId, userIds))
    : [];

  // Build a lookup map: userId → { warningPct, criticalPct }
  const prefsMap = new Map<number, { warningPct: number; criticalPct: number }>();
  for (const row of prefsRows) {
    prefsMap.set(row.userId, {
      warningPct:  row.marginWarningPct  ?? DEFAULT_WARNING_PCT,
      criticalPct: row.marginCriticalPct ?? DEFAULT_CRITICAL_PCT,
    });
  }

  let alertsFired = 0;

  for (const acct of accounts) {
    try {
      const totalCollateral = parseFloat(acct.totalCollateralValue ?? "0");
      const usedMargin      = parseFloat(acct.usedMargin ?? "0");

      if (totalCollateral <= 0) continue;

      const utilisationPct = Math.min(100, (usedMargin / totalCollateral) * 100);

      // Resolve per-user thresholds (or global defaults)
      const userThresholds = acct.userId ? prefsMap.get(acct.userId) : undefined;
      const warningPct  = userThresholds?.warningPct  ?? DEFAULT_WARNING_PCT;
      const criticalPct = userThresholds?.criticalPct ?? DEFAULT_CRITICAL_PCT;

      if (utilisationPct < warningPct) continue;

      const isCritical = utilisationPct >= criticalPct;
      const cooldownMs = isCritical ? CRITICAL_COOLDOWN_MS : WARNING_COOLDOWN_MS;

      // Check last notification time
      const lastNotified = acct.lastMarginCallAt ? new Date(acct.lastMarginCallAt).getTime() : 0;
      const timeSinceLast = now.getTime() - lastNotified;

      if (timeSinceLast < cooldownMs) continue; // still in cooldown

      const level   = isCritical ? "CRITICAL" : "WARNING";
      const pctStr  = utilisationPct.toFixed(1);
      const thresholdStr = isCritical ? criticalPct : warningPct;
      const title   = isCritical
        ? `⚠️ Critical Margin Alert — ${pctStr}% Utilisation`
        : `Margin Warning — ${pctStr}% Utilisation`;
      const message = isCritical
        ? `Your margin utilisation has reached ${pctStr}% (your critical threshold: ${criticalPct}%). Immediate action required: add collateral or reduce open positions to avoid forced liquidation.`
        : `Your margin utilisation is at ${pctStr}% (your warning threshold: ${warningPct}%). Consider adding collateral or reducing positions to maintain a healthy margin buffer.`;

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
        message: `Margin utilisation ${utilisationPct.toFixed(1)}% exceeds user threshold of ${thresholdStr}%`,
      }).catch(e => console.warn("[Kafka] emitRiskAlert failed:", (e as Error).message));

      alertsFired++;
      console.log(
        `[MarginAlertJob] ${level} alert fired for userId=${acct.userId} ` +
        `(${pctStr}% vs user threshold ${thresholdStr}%)`
      );
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
