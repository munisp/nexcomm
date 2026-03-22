/**
 * Market Maker Quote Obligation Cron Job
 *
 * Runs daily at 17:00 WAT (16:00 UTC) to:
 *  1. Auto-generate performance reports for all active obligations
 *  2. Send owner notifications for any market maker with uptime below their threshold
 *  3. Auto-suspend market makers with consecutive days below minimum uptime
 */

import { getDb } from "../db";
import {
  marketMakerProfiles,
  marketMakerObligations,
  marketMakerQuoteSnapshots,
  marketMakerPerformanceReports,
} from "../../drizzle/schema";
import { eq, and } from "drizzle-orm";
import { notifyOwner } from "../_core/notification";

const JOB_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours
const MARKET_CLOSE_HOUR_UTC = 16; // 17:00 WAT = 16:00 UTC
const CONSECUTIVE_BREACH_DAYS_FOR_SUSPENSION = 3;

/**
 * Get today's date string in YYYY-MM-DD format (UTC)
 */
function getTodayDateString(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Get yesterday's date string in YYYY-MM-DD format (UTC)
 */
function getYesterdayDateString(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/**
 * Generate a performance report for a single market maker obligation on a given date.
 * Idempotent — skips if a report already exists for that date.
 */
async function generateReportForObligation(
  marketMakerId: number,
  obligationId: number,
  reportDate: string
): Promise<{ generated: boolean; uptimePct: number; totalBreaches: number; penaltyAmount: number }> {
  const db = await getDb();
  if (!db) return { generated: false, uptimePct: 0, totalBreaches: 0, penaltyAmount: 0 };

  // Check if report already exists
  const existing = await db
    .select({ id: marketMakerPerformanceReports.id })
    .from(marketMakerPerformanceReports)
    .where(
      and(
        eq(marketMakerPerformanceReports.marketMakerId, marketMakerId),
        eq(marketMakerPerformanceReports.obligationId, obligationId),
        eq(marketMakerPerformanceReports.reportDate, reportDate)
      )
    );
  if (existing.length > 0) return { generated: false, uptimePct: 0, totalBreaches: 0, penaltyAmount: 0 };

  const [obligation] = await db
    .select()
    .from(marketMakerObligations)
    .where(eq(marketMakerObligations.id, obligationId));
  if (!obligation) return { generated: false, uptimePct: 0, totalBreaches: 0, penaltyAmount: 0 };

  // Aggregate snapshots for the given date
  const snapshots = await db
    .select()
    .from(marketMakerQuoteSnapshots)
    .where(
      and(
        eq(marketMakerQuoteSnapshots.marketMakerId, marketMakerId),
        eq(marketMakerQuoteSnapshots.obligationId, obligationId),
        eq(marketMakerQuoteSnapshots.tradingSessionDate, reportDate)
      )
    );

  const total = snapshots.length;
  const compliant = snapshots.filter((s) => s.isCompliant).length;
  const spreadBreaches = snapshots.filter((s) => s.breachType === "SPREAD_TOO_WIDE").length;
  const sizeBreaches = snapshots.filter((s) => s.breachType === "SIZE_TOO_SMALL").length;
  const absenceBreaches = snapshots.filter((s) => s.breachType === "ABSENT").length;
  const totalBreaches = spreadBreaches + sizeBreaches + absenceBreaches;
  const uptimePct = total > 0 ? (compliant / total) * 100 : 0;

  const validSpreads = snapshots
    .filter((s) => s.spreadBps !== null)
    .map((s) => s.spreadBps as number);
  const avgSpreadBps =
    validSpreads.length > 0
      ? Math.round(validSpreads.reduce((a, b) => a + b, 0) / validSpreads.length)
      : 0;
  const maxSpreadBps = validSpreads.length > 0 ? Math.max(...validSpreads) : 0;
  const penaltyAmount = totalBreaches * parseFloat(obligation.penaltyPerBreachNgn);

  await db.insert(marketMakerPerformanceReports).values({
    marketMakerId,
    obligationId,
    instrument: obligation.instrument,
    reportDate,
    totalSnapshots: total,
    compliantSnapshots: compliant,
    uptimePct: String(uptimePct.toFixed(2)),
    avgSpreadBps,
    maxSpreadBps,
    spreadBreaches,
    sizeBreaches,
    absenceBreaches,
    totalBreaches,
    penaltyAmount: String(penaltyAmount.toFixed(2)),
    penaltyStatus: "PENDING",
  });

  return { generated: true, uptimePct, totalBreaches, penaltyAmount };
}

/**
 * Check if a market maker has breached their minimum uptime threshold for N consecutive days.
 * Returns the count of consecutive breach days ending on yesterday.
 */
async function countConsecutiveBreachDays(
  marketMakerId: number,
  obligationId: number,
  minUptimePct: number
): Promise<number> {
  const db = await getDb();
  if (!db) return 0;

  let consecutiveDays = 0;
  const checkDate = new Date();
  checkDate.setUTCDate(checkDate.getUTCDate() - 1); // start from yesterday

  for (let i = 0; i < CONSECUTIVE_BREACH_DAYS_FOR_SUSPENSION; i++) {
    const dateStr = checkDate.toISOString().slice(0, 10);
    const [report] = await db
      .select({ uptimePct: marketMakerPerformanceReports.uptimePct })
      .from(marketMakerPerformanceReports)
      .where(
        and(
          eq(marketMakerPerformanceReports.marketMakerId, marketMakerId),
          eq(marketMakerPerformanceReports.obligationId, obligationId),
          eq(marketMakerPerformanceReports.reportDate, dateStr)
        )
      );
    if (!report || parseFloat(report.uptimePct) >= minUptimePct) break;
    consecutiveDays++;
    checkDate.setUTCDate(checkDate.getUTCDate() - 1);
  }
  return consecutiveDays;
}

/**
 * Main daily job: generate performance reports for all active obligations.
 */
async function runDailyMarketMakerJob(): Promise<void> {
  const db = await getDb();
  if (!db) {
    console.error("[MarketMakerJob] DB unavailable, skipping run");
    return;
  }

  const reportDate = getYesterdayDateString();
  console.log(`[MarketMakerJob] Running daily performance report generation for ${reportDate}`);

  // Get all active market maker profiles
  const activeProfiles = await db
    .select()
    .from(marketMakerProfiles)
    .where(eq(marketMakerProfiles.status, "ACTIVE"));

  if (activeProfiles.length === 0) {
    console.log("[MarketMakerJob] No active market maker profiles, skipping");
    return;
  }

  let totalReportsGenerated = 0;
  let totalPenalties = 0;
  const lowUptimeMarketMakers: Array<{ firmName: string; instrument: string; uptimePct: number; minUptimePct: number }> = [];
  const suspendedMarketMakers: string[] = [];

  for (const profile of activeProfiles) {
    // Get all active obligations for this market maker
    const obligations = await db
      .select()
      .from(marketMakerObligations)
      .where(
        and(
          eq(marketMakerObligations.marketMakerId, profile.id),
          eq(marketMakerObligations.isActive, true)
        )
      );

    for (const obligation of obligations) {
      const result = await generateReportForObligation(profile.id, obligation.id, reportDate);

      if (result.generated) {
        totalReportsGenerated++;
        totalPenalties += result.penaltyAmount;

        const minUptimePct = parseFloat(obligation.minUptimePct);

        // Check if uptime is below threshold
        if (result.uptimePct < minUptimePct) {
          lowUptimeMarketMakers.push({
            firmName: profile.firmName,
            instrument: obligation.instrument,
            uptimePct: result.uptimePct,
            minUptimePct,
          });

          // Check for consecutive breach days → auto-suspend
          const consecutiveDays = await countConsecutiveBreachDays(
            profile.id,
            obligation.id,
            minUptimePct
          );

          if (consecutiveDays >= CONSECUTIVE_BREACH_DAYS_FOR_SUSPENSION) {
            await db
              .update(marketMakerProfiles)
              .set({
                status: "SUSPENDED",
                suspendedAt: new Date(),
                suspensionReason: `Auto-suspended: uptime below ${minUptimePct}% for ${consecutiveDays} consecutive trading days`,
                updatedAt: new Date(),
              })
              .where(eq(marketMakerProfiles.id, profile.id));

            suspendedMarketMakers.push(
              `${profile.firmName} (${consecutiveDays} consecutive breach days on ${obligation.instrument})`
            );
            console.log(
              `[MarketMakerJob] Auto-suspended market maker ${profile.firmName} (ID: ${profile.id}) after ${consecutiveDays} consecutive breach days`
            );
          }
        }
      }
    }
  }

  // Send consolidated owner notification
  if (totalReportsGenerated > 0 || lowUptimeMarketMakers.length > 0) {
    let content = `Daily Market Maker Performance Report — ${reportDate}\n\n`;
    content += `Reports Generated: ${totalReportsGenerated}\n`;
    content += `Total Penalties Accrued: ₦${totalPenalties.toLocaleString()}\n\n`;

    if (lowUptimeMarketMakers.length > 0) {
      content += `⚠️ Low Uptime Alerts (${lowUptimeMarketMakers.length}):\n`;
      for (const mm of lowUptimeMarketMakers) {
        content += `  • ${mm.firmName} — ${mm.instrument}: ${mm.uptimePct.toFixed(1)}% uptime (min: ${mm.minUptimePct}%)\n`;
      }
      content += "\n";
    }

    if (suspendedMarketMakers.length > 0) {
      content += `🚨 Auto-Suspended Market Makers (${suspendedMarketMakers.length}):\n`;
      for (const mm of suspendedMarketMakers) {
        content += `  • ${mm}\n`;
      }
    }

    await notifyOwner({
      title: `Market Maker Daily Report — ${totalReportsGenerated} reports, ₦${totalPenalties.toLocaleString()} penalties`,
      content,
    });
  }

  console.log(
    `[MarketMakerJob] Completed: ${totalReportsGenerated} reports generated, ` +
    `${lowUptimeMarketMakers.length} low-uptime alerts, ` +
    `${suspendedMarketMakers.length} auto-suspensions`
  );
}

/**
 * Schedule the daily job to run at market close (17:00 WAT = 16:00 UTC).
 * Uses a polling approach to fire at the correct hour.
 */
export function startMarketMakerJob(): void {
  console.log("[MarketMakerJob] Starting market maker daily performance job (fires at 16:00 UTC)");

  let lastRunDate: string | null = null;

  const checkAndRun = async () => {
    const now = new Date();
    const hourUTC = now.getUTCHours();
    const todayStr = getTodayDateString();

    // Fire once per day at or after 16:00 UTC
    if (hourUTC >= MARKET_CLOSE_HOUR_UTC && lastRunDate !== todayStr) {
      lastRunDate = todayStr;
      try {
        await runDailyMarketMakerJob();
      } catch (err) {
        console.error("[MarketMakerJob] Error during daily run:", err);
      }
    }
  };

  // Check every 30 minutes
  setInterval(checkAndRun, 30 * 60 * 1000);

  // Also run immediately if it's already past market close and hasn't run today
  checkAndRun().catch((err) => console.error("[MarketMakerJob] Initial check error:", err));
}

// Export for testing
export { runDailyMarketMakerJob, generateReportForObligation, getYesterdayDateString };
