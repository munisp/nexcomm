/**
 * NEXCOM Exchange — Position Broadcaster
 * Emits real-time position and unrealized P&L updates to subscribed WebSocket clients.
 *
 * Architecture:
 *   - The price feed job calls `broadcastPriceUpdate(symbol, price)` whenever a price changes.
 *   - This module looks up all open positions for that symbol, recalculates unrealized P&L,
 *     and pushes a `position_update` message to any WS client subscribed to that userId.
 *   - Clients subscribe by sending: { type: "subscribe_positions", userId: <number> }
 *   - Server pushes: { type: "position_update", positions: [...], totalUnrealizedPnl, totalRealizedPnl }
 *   - Server also pushes: { type: "fill_event", fills: [...] } when new fills are detected.
 */
import { WebSocket } from "ws";
import { getDb } from "../db";
import { positions, tradeFills } from "../../drizzle/schema";
import { eq, and, gt, desc, or, sql } from "drizzle-orm";

// Map of userId (number) → Set of WebSocket clients subscribed to that user's positions
const positionSubscribers = new Map<number, Set<WebSocket>>();

// Track last-seen fill timestamps per user to detect new fills
const lastFillTimestamp = new Map<number, Date>();

/**
 * Register a WebSocket client to receive position updates for a specific user.
 */
export function subscribePositions(ws: WebSocket, userId: number): void {
  if (!positionSubscribers.has(userId)) {
    positionSubscribers.set(userId, new Set());
  }
  positionSubscribers.get(userId)!.add(ws);
}

/**
 * Unregister a WebSocket client from all position subscriptions.
 */
export function unsubscribePositions(ws: WebSocket): void {
  for (const [userId, clients] of Array.from(positionSubscribers.entries())) {
    clients.delete(ws);
    if (clients.size === 0) {
      positionSubscribers.delete(userId);
    }
  }
}

/**
 * Broadcast a position update to all subscribers for a given user.
 */
function sendToUser(userId: number, payload: object): void {
  const clients = positionSubscribers.get(userId);
  if (!clients || clients.size === 0) return;
  const msg = JSON.stringify(payload);
  for (const ws of Array.from(clients)) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(msg);
    }
  }
}

/**
 * Called by the price feed job whenever a commodity price updates.
 * Recalculates unrealized P&L for all open positions in that symbol
 * and pushes updates to subscribed clients.
 */
export async function broadcastPriceUpdate(symbol: string, newPrice: number): Promise<void> {
  if (positionSubscribers.size === 0) return; // No subscribers — skip DB query

  try {
    const db = await getDb();
    if (!db) return;
    // Find all open positions for this symbol where quantity > 0
    const openPositions = await db
      .select()
      .from(positions)
      .where(
        and(
          eq(positions.symbol, symbol),
          sql`CAST(${positions.quantity} AS DECIMAL(18,6)) > 0`
        )
      );

    // Group by userId
    const byUser = new Map<number, typeof openPositions>();
    for (const pos of openPositions) {
      const uid = pos.userId;
      if (!byUser.has(uid)) byUser.set(uid, []);
      byUser.get(uid)!.push(pos);
    }

    for (const [userId, userPositions] of Array.from(byUser.entries())) {
      if (!positionSubscribers.has(userId)) continue;

      let totalUnrealizedPnl = 0;
      let totalRealizedPnl = 0;

      const enriched = userPositions.map((pos: typeof openPositions[0]) => {
        const qty = parseFloat(pos.quantity as string) || 0;
        const avgCost = parseFloat(pos.avgCost as string) || 0;
        const realizedPnl = parseFloat(pos.realizedPnl as string) || 0;
        const unrealizedPnl = qty > 0 ? (newPrice - avgCost) * qty : 0;

        totalUnrealizedPnl += unrealizedPnl;
        totalRealizedPnl += realizedPnl;

        return {
          id: pos.id,
          symbol: pos.symbol,
          quantity: qty,
          averageCost: avgCost,
          currentPrice: newPrice,
          unrealizedPnl,
          realizedPnl,
          side: qty > 0 ? "LONG" : "SHORT",
          updatedAt: new Date().toISOString(),
        };
      });

      sendToUser(userId, {
        type: "position_update",
        symbol,
        positions: enriched,
        totalUnrealizedPnl,
        totalRealizedPnl,
        timestamp: new Date().toISOString(),
      });
    }
  } catch {
    // Non-critical — silently ignore DB errors in broadcast path
  }
}

/**
 * Called periodically (every 5s) to detect new fills and push fill_event messages.
 */
export async function pollAndBroadcastFills(): Promise<void> {
  if (positionSubscribers.size === 0) return;

  try {
    const db = await getDb();
    if (!db) return;
    for (const [userId] of Array.from(positionSubscribers.entries())) {
      const since = lastFillTimestamp.get(userId) ?? new Date(Date.now() - 60_000);

      const newFills = await db
        .select()
        .from(tradeFills)
        .where(
          and(
            gt(tradeFills.createdAt, since),
            or(
              eq(tradeFills.buyerUserId, userId),
              eq(tradeFills.sellerUserId, userId)
            )
          )
        )
        .orderBy(desc(tradeFills.createdAt))
        .limit(10);

      if (newFills.length > 0) {
        lastFillTimestamp.set(userId, newFills[0].createdAt ?? new Date());
        sendToUser(userId, {
          type: "fill_event",
          fills: newFills.map((f: typeof newFills[0]) => ({
            id: f.id,
            symbol: f.symbol,
            side: f.buyerUserId === userId ? "BUY" : "SELL",
            quantity: f.filledQty,
            price: f.fillPrice,
            grossValue: f.grossValue,
            fee: f.buyerUserId === userId ? f.buyerFee : f.sellerFee,
            createdAt: f.createdAt,
          })),
          timestamp: new Date().toISOString(),
        });
      }
    }
  } catch {
    // Non-critical
  }
}

// Poll for new fills every 5 seconds
setInterval(pollAndBroadcastFills, 5_000);
