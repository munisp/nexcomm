/**
 * sseRouter — Server-Sent Events endpoint for real-time order fill notifications.
 *
 * GET /api/sse/order-fills
 *   - Requires a valid session cookie (same auth as tRPC).
 *   - Streams `order_fill` PostgreSQL NOTIFY events to the authenticated user.
 *   - Each event is a JSON payload: { orderId, symbol, side, filledQty, fillPrice, timestamp }
 *
 * The matching engine calls pgNotify("order_fill", { userId, ... }) after each fill.
 * This endpoint fans out only the events belonging to the connected user.
 */
import { Router, Request, Response } from "express";
import { pgListen } from "./pg-optimizations";
import { sdk } from "./_core/sdk";

export const sseRouter = Router();

sseRouter.get("/api/sse/order-fills", async (req: Request, res: Response) => {
  // ── Auth: require a valid session ──────────────────────────────────────────
  let userId: number;
  try {
    const user = await sdk.authenticateRequest(req);
    if (!user) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    userId = user.id;
  } catch {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  // ── SSE headers ────────────────────────────────────────────────────────────
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-store, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no"); // Disable nginx buffering
  res.flushHeaders();

  // ── Send initial keepalive ─────────────────────────────────────────────────
  res.write(": connected\n\n");

  // ── Subscribe to PostgreSQL NOTIFY channel ─────────────────────────────────
  const unsubscribe = pgListen("order_fill", (payload: string) => {
    try {
      const event = JSON.parse(payload) as {
        userId?: number;
        orderId?: number;
        symbol?: string;
        side?: string;
        filledQty?: number;
        fillPrice?: number;
        timestamp?: string;
      };
      // Only forward events belonging to this user
      if (event.userId !== userId) return;

      const data = JSON.stringify({
        orderId: event.orderId,
        symbol: event.symbol,
        side: event.side,
        filledQty: event.filledQty,
        fillPrice: event.fillPrice,
        timestamp: event.timestamp ?? new Date().toISOString(),
      });
      res.write(`event: order_fill\ndata: ${data}\n\n`);
    } catch {
      // Malformed payload — ignore
    }
  });

  // ── Keepalive heartbeat every 25 seconds ──────────────────────────────────
  const heartbeat = setInterval(() => {
    res.write(": heartbeat\n\n");
  }, 25_000);

  // ── Cleanup on client disconnect ──────────────────────────────────────────
  req.on("close", () => {
    clearInterval(heartbeat);
    unsubscribe();
  });
});
