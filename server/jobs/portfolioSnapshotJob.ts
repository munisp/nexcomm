/**
 * NEXCOM Portfolio Snapshot Job
 * ─────────────────────────────────────────────────────────────────────────────
 * Runs daily at midnight Africa/Lagos time (UTC+1).
 * For each user with open positions, calculates their portfolio value and
 * inserts a row into portfolio_snapshots.
 *
 * Portfolio value = Σ(position.quantity × live_price[symbol])
 * Falls back to avg_cost when no live price is available for a symbol.
 *
 * Also exports a backfill function used by the seed script to populate
 * 30 days of history for demo purposes.
 */
import { and, eq, gte, inArray } from "drizzle-orm";
import { getDb } from "../db";
import { portfolioSnapshots, positions, livePrices } from "../../drizzle/schema";

// ─── Core snapshot calculation ────────────────────────────────────────────────

/**
 * Calculate and persist a portfolio snapshot for a single user.
 * Uses live_prices table for current market values; falls back to avg_cost
 * when no live price exists for a symbol.
 */
export async function takeSnapshotForUser(
  userId: number,
  snapshotDate: Date = new Date()
): Promise<void> {
  const db = await getDb();
  if (!db) return;

  // Fetch all open positions for this user
  const userPositions = await db
    .select()
    .from(positions)
    .where(eq(positions.userId, userId));

  if (userPositions.length === 0) return;

  // Fetch live prices for all symbols in this portfolio
  const symbols = [...new Set(userPositions.map(p => p.symbol))];
  const priceRows = await db
    .select({ symbol: livePrices.symbol, price: livePrices.price })
    .from(livePrices)
    .where(inArray(livePrices.symbol, symbols));

  const priceMap: Record<string, number> = {};
  for (const row of priceRows) {
    priceMap[row.symbol] = Number(row.price);
  }

  // Calculate portfolio metrics using live prices
  let totalCost = 0;
  let totalValue = 0;
  let realizedPnl = 0;

  for (const pos of userPositions) {
    const qty = Number(pos.quantity);
    const avgCost = Number(pos.avgCost);
    const livePrice = priceMap[pos.symbol] ?? avgCost; // fallback to avg cost
    totalCost += qty * avgCost;
    totalValue += qty * livePrice;
    realizedPnl += Number(pos.realizedPnl ?? 0);
  }

  totalValue = Math.round(totalValue * 100) / 100;
  totalCost = Math.round(totalCost * 100) / 100;
  const unrealizedPnl = Math.round((totalValue - totalCost) * 100) / 100;

  // Normalise date to start of day (UTC)
  const dayStart = new Date(snapshotDate);
  dayStart.setUTCHours(0, 0, 0, 0);

  // Upsert: if a snapshot already exists for this user+date, update it
  const existing = await db
    .select({ id: portfolioSnapshots.id })
    .from(portfolioSnapshots)
    .where(
      and(
        eq(portfolioSnapshots.userId, userId),
        gte(portfolioSnapshots.snapshotDate, dayStart)
      )
    )
    .limit(1);

  if (existing.length > 0) {
    await db
      .update(portfolioSnapshots)
      .set({
        totalValue: String(totalValue),
        totalCost: String(totalCost),
        realizedPnl: String(realizedPnl),
        unrealizedPnl: String(unrealizedPnl),
      })
      .where(eq(portfolioSnapshots.id, existing[0].id));
  } else {
    await db.insert(portfolioSnapshots).values({
      userId,
      snapshotDate: dayStart,
      totalValue: String(totalValue),
      totalCost: String(totalCost),
      realizedPnl: String(realizedPnl),
      unrealizedPnl: String(unrealizedPnl),
      currency: "NGN",
    });
  }
}

/**
 * Run the daily snapshot job for all users with positions.
 * Called by the server cron scheduler at midnight.
 */
export async function runDailySnapshotJob(): Promise<void> {
  const db = await getDb();
  if (!db) {
    console.warn("[SnapshotJob] Database unavailable — skipping");
    return;
  }

  console.log("[SnapshotJob] Starting daily portfolio snapshot job...");

  // Get all distinct user IDs that have positions
  const usersWithPositions = await db
    .selectDistinct({ userId: positions.userId })
    .from(positions);

  let processed = 0;
  let errors = 0;

  for (const { userId } of usersWithPositions) {
    try {
      await takeSnapshotForUser(userId);
      processed++;
    } catch (err) {
      errors++;
      console.error(`[SnapshotJob] Failed for user ${userId}:`, err);
    }
  }

  console.log(
    `[SnapshotJob] Done — ${processed} snapshots saved, ${errors} errors`
  );
}

/**
 * Backfill N days of portfolio snapshots for a user.
 * Used during seeding to populate the P&L equity curve chart.
 * Uses a deterministic hash-based drift so results are reproducible
 * (no Math.random() — same inputs always produce the same history).
 */
export async function backfillSnapshotsForUser(
  userId: number,
  days = 30
): Promise<void> {
  const db = await getDb();
  if (!db) return;

  const userPositions = await db
    .select()
    .from(positions)
    .where(eq(positions.userId, userId));

  if (userPositions.length === 0) return;

  const totalCost = userPositions.reduce(
    (sum, p) => sum + Number(p.quantity) * Number(p.avgCost),
    0
  );
  const realizedPnl = userPositions.reduce(
    (sum, p) => sum + Number(p.realizedPnl ?? 0),
    0
  );

  // Fetch current live prices for mark-to-market
  const symbols = [...new Set(userPositions.map(p => p.symbol))];
  const priceRows = await db
    .select({ symbol: livePrices.symbol, price: livePrices.price })
    .from(livePrices)
    .where(inArray(livePrices.symbol, symbols));
  const priceMap: Record<string, number> = {};
  for (const row of priceRows) {
    priceMap[row.symbol] = Number(row.price);
  }

  // Current portfolio value (mark-to-market)
  let currentValue = 0;
  for (const pos of userPositions) {
    const qty = Number(pos.quantity);
    const livePrice = priceMap[pos.symbol] ?? Number(pos.avgCost);
    currentValue += qty * livePrice;
  }

  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  // Generate deterministic daily values using a seeded hash drift
  // so the backfill is reproducible (no Math.random)
  for (let i = days; i >= 0; i--) {
    const snapshotDate = new Date(today);
    snapshotDate.setDate(today.getDate() - i);

    // Deterministic drift: use (userId * day_index) as a pseudo-random seed
    // Maps to a value in [-0.02, +0.02] per day
    const seed = (userId * 31337 + i * 7919) % 10000;
    const dailyDrift = (seed / 10000 - 0.47) * 0.04; // ±2%, biased slightly positive

    // Interpolate: day 0 = totalCost, day `days` = currentValue
    // with deterministic noise applied on top
    const progress = (days - i) / days;
    const interpolated = totalCost + (currentValue - totalCost) * progress;
    const totalValue = Math.round(interpolated * (1 + dailyDrift) * 100) / 100;
    const unrealizedPnl = Math.round((totalValue - totalCost) * 100) / 100;

    const dayStart = new Date(snapshotDate);
    dayStart.setUTCHours(0, 0, 0, 0);

    const existing = await db
      .select({ id: portfolioSnapshots.id })
      .from(portfolioSnapshots)
      .where(
        and(
          eq(portfolioSnapshots.userId, userId),
          gte(portfolioSnapshots.snapshotDate, dayStart)
        )
      )
      .limit(1);

    if (existing.length === 0) {
      await db.insert(portfolioSnapshots).values({
        userId,
        snapshotDate: dayStart,
        totalValue: String(totalValue),
        totalCost: String(totalCost),
        realizedPnl: String(realizedPnl),
        unrealizedPnl: String(unrealizedPnl),
        currency: "NGN",
      });
    }
  }
}

/**
 * Backfill snapshots for ALL users with positions.
 * Called once from the seed script or on first server start.
 */
export async function backfillAllSnapshots(days = 30): Promise<void> {
  const db = await getDb();
  if (!db) return;

  console.log(`[SnapshotJob] Backfilling ${days} days of snapshots...`);

  const usersWithPositions = await db
    .selectDistinct({ userId: positions.userId })
    .from(positions);

  for (const { userId } of usersWithPositions) {
    await backfillSnapshotsForUser(userId, days);
  }

  console.log(`[SnapshotJob] Backfill complete for ${usersWithPositions.length} users`);
}
