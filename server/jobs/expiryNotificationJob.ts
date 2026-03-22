/**
 * Expiry Notification Job
 * Runs daily at 09:00 WAT (08:00 UTC).
 * Identifies futures contracts and options contracts expiring within 3 days
 * and sends the owner a notification with a summary of expiring contracts
 * and the count of open positions that will be affected.
 */
import { getDb } from "../db";
import { futuresContracts, futuresPositions, optionsContracts, optionsPositions } from "../../drizzle/schema";
import { and, eq, gte, lte, sql } from "drizzle-orm";
import { notifyOwner } from "../_core/notification";

const WAT_OFFSET_MS = 1 * 60 * 60 * 1000; // WAT = UTC+1

function nextRunMs(): number {
  const now = new Date();
  const todayRun = new Date(now);
  todayRun.setUTCHours(8, 0, 0, 0); // 08:00 UTC = 09:00 WAT
  if (now >= todayRun) todayRun.setUTCDate(todayRun.getUTCDate() + 1);
  return todayRun.getTime() - now.getTime();
}

async function runExpiryNotifications() {
  console.log("[ExpiryJob] Checking for contracts expiring within 3 days…");
  try {
    const db = await getDb();
    const now = new Date();
    const threeDaysLater = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);

    // Futures contracts expiring soon
    if (!db) return;

    const expiringFutures = await db
      .select({
        id: futuresContracts.id,
        symbol: futuresContracts.symbol,
        expiryDate: futuresContracts.expiryDate,
        openPositions: sql<number>`(
          SELECT COUNT(*) FROM futures_positions fp
          WHERE fp.contract_id = ${futuresContracts.id} AND fp.status = 'OPEN'
        )`.mapWith(Number),
      })
      .from(futuresContracts)
      .where(
        and(
          eq(futuresContracts.status, "ACTIVE"),
          sql`${futuresContracts.expiryDate} >= ${now.toISOString()}`,
          sql`${futuresContracts.expiryDate} <= ${threeDaysLater.toISOString()}`,
        )
      );

    // Options contracts expiring soon
    const expiringOptions = await db
      .select({
        id: optionsContracts.id,
        symbol: optionsContracts.symbol,
        optionType: optionsContracts.optionType,
        strikePrice: optionsContracts.strikePrice,
        expiryDate: optionsContracts.expiryDate,
        openPositions: sql<number>`(
          SELECT COUNT(*) FROM options_positions op
          WHERE op.contract_id = ${optionsContracts.id} AND op.status = 'OPEN'
        )`.mapWith(Number),
      })
      .from(optionsContracts)
      .where(
        and(
          eq(optionsContracts.status, "ACTIVE"),
          gte(optionsContracts.expiryDate, now),
          lte(optionsContracts.expiryDate, threeDaysLater),
        )
      );

    const totalExpiring = expiringFutures.length + expiringOptions.length;
    if (totalExpiring === 0) {
      console.log("[ExpiryJob] No contracts expiring within 3 days.");
      return;
    }

    const futuresLines = expiringFutures.map(f =>
      `  • ${f.symbol} — expires ${new Date(f.expiryDate).toLocaleDateString("en-NG")} — ${f.openPositions} open position(s)`
    ).join("\n");

    const optionsLines = expiringOptions.map(o =>
      `  • ${o.symbol} (${o.optionType}, strike ₦${parseFloat(o.strikePrice).toLocaleString()}) — expires ${new Date(o.expiryDate).toLocaleDateString("en-NG")} — ${o.openPositions} open position(s)`
    ).join("\n");

    const content = [
      `${totalExpiring} contract(s) are expiring within the next 3 days.`,
      "",
      expiringFutures.length > 0 ? `Futures (${expiringFutures.length}):\n${futuresLines}` : null,
      expiringOptions.length > 0 ? `Options (${expiringOptions.length}):\n${optionsLines}` : null,
      "",
      "Action required: Review open positions and ensure settlement prices are set before expiry.",
    ].filter(Boolean).join("\n");

    await notifyOwner({
      title: `⚠️ ${totalExpiring} Contract(s) Expiring Soon`,
      content,
    });

    console.log(`[ExpiryJob] Notified owner of ${totalExpiring} expiring contract(s).`);
  } catch (err) {
    console.error("[ExpiryJob] Error:", err);
  }
}

export function startExpiryNotificationJob() {
  const msUntilFirst = nextRunMs();
  const hUntil = Math.round(msUntilFirst / 60000);
  console.log(`[ExpiryJob] Scheduled — first run in ${hUntil} minutes (daily at 09:00 WAT)`);

  setTimeout(function tick() {
    runExpiryNotifications();
    setTimeout(tick, 24 * 60 * 60 * 1000); // repeat every 24h
  }, msUntilFirst);
}
