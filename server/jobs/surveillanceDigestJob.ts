/**
 * Surveillance Notification Digest Job
 *
 * Runs daily at 08:00 WAT (07:00 UTC) to send the owner a summary of:
 *  1. Circuit breaker events from the previous day (halts triggered, lifted, still active)
 *  2. New wash-trade flags from the previous day (pending review count)
 *  3. Any circuit breaker events still ACTIVE (not yet lifted)
 *
 * This keeps compliance officers informed without requiring them to log in daily.
 */
import { getDb } from "../db";
import { circuitBreakerEvents, washTradeFlags } from "../../drizzle/schema";
import { and, gte, lt, eq, sql } from "drizzle-orm";
import { notifyOwner } from "../_core/notification";

const JOB_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours
const DIGEST_HOUR_UTC = 7; // 08:00 WAT = 07:00 UTC

/**
 * Get the start and end of yesterday in UTC.
 */
function getYesterdayRange(): { start: Date; end: Date } {
  const now = new Date();
  const start = new Date(now);
  start.setUTCDate(start.getUTCDate() - 1);
  start.setUTCHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setUTCHours(23, 59, 59, 999);
  return { start, end };
}

/**
 * Build and send the daily surveillance digest notification.
 */
export async function runSurveillanceDigest(): Promise<void> {
  const db = await getDb();
  if (!db) {
    console.error("[SurveillanceDigest] Database unavailable — skipping digest.");
    return;
  }

  const { start, end } = getYesterdayRange();
  const dateLabel = start.toISOString().slice(0, 10);

  try {
    // ── Circuit Breaker Events (yesterday) ─────────────────────────────────
    const [cbStats] = await db
      .select({
        totalTriggered: sql<number>`COUNT(*)::int`,
        totalLifted: sql<number>`SUM(CASE WHEN status = 'LIFTED' THEN 1 ELSE 0 END)::int`,
        totalExpired: sql<number>`SUM(CASE WHEN status = 'EXPIRED' THEN 1 ELSE 0 END)::int`,
      })
      .from(circuitBreakerEvents)
      .where(
        and(
          gte(circuitBreakerEvents.haltedAt, start),
          lt(circuitBreakerEvents.haltedAt, end),
        )
      );

    // ── Still-Active Halts (not yet lifted) ────────────────────────────────
    const activeHalts = await db
      .select({
        instrument: circuitBreakerEvents.instrument,
        haltedAt: circuitBreakerEvents.haltedAt,
        haltUntil: circuitBreakerEvents.haltUntil,
        actualMovePct: circuitBreakerEvents.actualMovePct,
        notes: circuitBreakerEvents.notes,
      })
      .from(circuitBreakerEvents)
      .where(eq(circuitBreakerEvents.status, "ACTIVE"))
      .limit(20);

    // ── Wash Trade Flags (yesterday) ───────────────────────────────────────
    const [wtStats] = await db
      .select({
        totalFlagged: sql<number>`COUNT(*)::int`,
        pendingReview: sql<number>`SUM(CASE WHEN status = 'PENDING' THEN 1 ELSE 0 END)::int`,
        confirmed: sql<number>`SUM(CASE WHEN status = 'CONFIRMED' THEN 1 ELSE 0 END)::int`,
        dismissed: sql<number>`SUM(CASE WHEN status = 'DISMISSED' THEN 1 ELSE 0 END)::int`,
      })
      .from(washTradeFlags)
      .where(
        and(
          gte(washTradeFlags.detectedAt, start),
          lt(washTradeFlags.detectedAt, end),
        )
      );

    const cbTriggered = cbStats?.totalTriggered ?? 0;
    const cbLifted = cbStats?.totalLifted ?? 0;
    const wtFlagged = wtStats?.totalFlagged ?? 0;
    const wtPending = wtStats?.pendingReview ?? 0;

    // ── Skip digest if nothing happened ───────────────────────────────────
    if (cbTriggered === 0 && wtFlagged === 0 && activeHalts.length === 0) {
      console.log(`[SurveillanceDigest] ${dateLabel}: No surveillance events — digest skipped.`);
      return;
    }

    // ── Compose notification content ───────────────────────────────────────
    const lines: string[] = [
      `Daily Surveillance Digest — ${dateLabel}`,
      "",
      "═══ Circuit Breaker Summary ═══",
      `  Halts triggered yesterday : ${cbTriggered}`,
      `  Halts lifted              : ${cbLifted}`,
      `  Still active (open halts) : ${activeHalts.length}`,
    ];

    if (activeHalts.length > 0) {
      lines.push("", "Active Halts:");
      for (const halt of activeHalts) {
        const pct = halt.actualMovePct ? `${parseFloat(halt.actualMovePct).toFixed(2)}%` : "N/A";
        const until = halt.haltUntil ? new Date(halt.haltUntil).toUTCString() : "indefinite";
        lines.push(`  • ${halt.instrument}: ${pct} move — halted until ${until}${halt.notes ? ` (${halt.notes})` : ""}`);
      }
    }

    lines.push(
      "",
      "═══ Wash Trade Flags ═══",
      `  New flags yesterday  : ${wtFlagged}`,
      `  Pending review       : ${wtPending}`,
      `  Confirmed            : ${wtStats?.confirmed ?? 0}`,
      `  Dismissed            : ${wtStats?.dismissed ?? 0}`,
    );

    if (wtPending > 0) {
      lines.push("", `⚠ Action required: ${wtPending} wash-trade flag(s) are awaiting review in the Trade Surveillance dashboard.`);
    }

    const content = lines.join("\n");
    const title = `Surveillance Digest ${dateLabel}: ${cbTriggered} halt(s), ${wtFlagged} wash-trade flag(s)`;

    const sent = await notifyOwner({ title, content });
    if (sent) {
      console.log(`[SurveillanceDigest] ${dateLabel}: Digest sent successfully.`);
    } else {
      console.warn(`[SurveillanceDigest] ${dateLabel}: Notification service unavailable — digest not delivered.`);
    }
  } catch (err) {
    console.error("[SurveillanceDigest] Error generating digest:", err);
  }
}

/**
 * Start the daily surveillance digest scheduler.
 * Fires once at the next 08:00 WAT (07:00 UTC) and then every 24 hours.
 */
export function startSurveillanceDigestJob(): void {
  const now = new Date();
  const nextRun = new Date(now);
  nextRun.setUTCHours(DIGEST_HOUR_UTC, 0, 0, 0);
  if (nextRun <= now) {
    nextRun.setUTCDate(nextRun.getUTCDate() + 1);
  }

  const msUntilFirstRun = nextRun.getTime() - now.getTime();
  console.log(
    `[SurveillanceDigest] Scheduled — first run at ${nextRun.toUTCString()} (in ${Math.round(msUntilFirstRun / 60000)} min)`
  );

  setTimeout(() => {
    runSurveillanceDigest();
    setInterval(runSurveillanceDigest, JOB_INTERVAL_MS);
  }, msUntilFirstRun);
}
