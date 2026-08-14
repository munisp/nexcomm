/**
 * NEXCOM Exchange — WebSocket Order Book Server
 *
 * This endpoint serves order-book snapshots only from the matching engine. It never
 * synthesizes prices, quantities, volumes, or historical changes. When the matching
 * engine is unavailable or has no authoritative depth for a symbol, subscribers
 * receive an explicit non-success message rather than plausible market data.
 */
import { WebSocketServer, WebSocket } from "ws";
import type { Server } from "http";
import { getMarketDepth, checkMatchingEngineHealth } from "../matchingEngineClient";
import { subscribePositions, unsubscribePositions } from "./positionBroadcaster";
import { subscribeLoanEvents, unsubscribeLoanEvents } from "./loanNotificationBroadcaster";

interface OrderBookLevel {
  price: number;
  qty: number;
  total: number;
  depth: number;
}

interface AuthoritativeOrderBook {
  bids: OrderBookLevel[];
  asks: OrderBookLevel[];
  spread: number;
  spreadPct: number;
}

interface FeedError {
  type: "error";
  code: string;
  symbol?: string;
  message: string;
  retryable: boolean;
}

const subscriptions = new Map<WebSocket, Set<string>>();
let pollInterval: ReturnType<typeof setInterval> | null = null;
let pollInFlight = false;

function send(ws: WebSocket, payload: object): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

function sendFeedError(ws: WebSocket, error: Omit<FeedError, "type">): void {
  send(ws, { type: "error", ...error });
}

function normalizeDepth(raw: Awaited<ReturnType<typeof getMarketDepth>>): AuthoritativeOrderBook | null {
  if (!raw || (raw.bids.length === 0 && raw.asks.length === 0)) {
    return null;
  }

  let bidTotal = 0;
  const bids = raw.bids.map((level) => {
    bidTotal += level.quantity;
    return { price: level.price, qty: level.quantity, total: bidTotal, depth: 0 };
  });

  let askTotal = 0;
  const asks = raw.asks.map((level) => {
    askTotal += level.quantity;
    return { price: level.price, qty: level.quantity, total: askTotal, depth: 0 };
  });

  const maxBid = bids.length > 0 ? bids[bids.length - 1].total : 0;
  const maxAsk = asks.length > 0 ? asks[asks.length - 1].total : 0;
  if (maxBid > 0) bids.forEach((level) => { level.depth = (level.total / maxBid) * 100; });
  if (maxAsk > 0) asks.forEach((level) => { level.depth = (level.total / maxAsk) * 100; });

  const topBid = bids[0]?.price;
  const topAsk = asks[0]?.price;
  const spread = topBid !== undefined && topAsk !== undefined ? topAsk - topBid : 0;
  const reference = topBid !== undefined && topAsk !== undefined ? (topBid + topAsk) / 2 : 0;

  return {
    bids,
    asks: asks.reverse(),
    spread,
    spreadPct: reference > 0 ? (spread / reference) * 100 : 0,
  };
}

function uniqueSubscribedSymbols(): Set<string> {
  const symbols = new Set<string>();
  for (const subscription of subscriptions.values()) {
    for (const symbol of subscription) symbols.add(symbol);
  }
  return symbols;
}

async function fetchAndBroadcastBook(symbol: string, target?: WebSocket): Promise<boolean> {
  const recipients = target
    ? [target]
    : Array.from(subscriptions.entries())
        .filter(([, symbols]) => symbols.has(symbol))
        .map(([ws]) => ws);

  try {
    const depth = normalizeDepth(await getMarketDepth(symbol));
    if (!depth) {
      for (const ws of recipients) {
        sendFeedError(ws, {
          code: "AUTHORITATIVE_MARKET_DATA_UNAVAILABLE",
          symbol,
          message: "The matching engine has no authoritative order-book depth for this symbol.",
          retryable: true,
        });
      }
      return false;
    }

    for (const ws of recipients) {
      send(ws, {
        type: "book",
        symbol,
        ...depth,
        source: "matching-engine",
      });
    }
    return true;
  } catch {
    for (const ws of recipients) {
      sendFeedError(ws, {
        code: "AUTHORITATIVE_MARKET_DATA_UNAVAILABLE",
        symbol,
        message: "The authoritative matching-engine market-data service is unavailable.",
        retryable: true,
      });
    }
    return false;
  }
}

async function pollAuthoritativeBooks(): Promise<void> {
  if (pollInFlight || subscriptions.size === 0) return;
  pollInFlight = true;
  try {
    if (!(await checkMatchingEngineHealth())) {
      for (const [ws, symbols] of subscriptions) {
        for (const symbol of symbols) {
          sendFeedError(ws, {
            code: "AUTHORITATIVE_MARKET_DATA_UNAVAILABLE",
            symbol,
            message: "The authoritative matching-engine market-data service is unavailable.",
            retryable: true,
          });
        }
      }
      return;
    }

    await Promise.all(Array.from(uniqueSubscribedSymbols(), (symbol) => fetchAndBroadcastBook(symbol)));
  } finally {
    pollInFlight = false;
  }
}

function startPolling(): void {
  if (pollInterval) return;
  pollInterval = setInterval(() => {
    void pollAuthoritativeBooks();
  }, 1_000);
}

function stopPollingWhenUnused(): void {
  if (subscriptions.size === 0 && pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
  }
}

async function subscribeToAuthoritativeBook(ws: WebSocket, symbol: string): Promise<void> {
  if (!(await checkMatchingEngineHealth())) {
    sendFeedError(ws, {
      code: "AUTHORITATIVE_MARKET_DATA_UNAVAILABLE",
      symbol,
      message: "The authoritative matching-engine market-data service is unavailable.",
      retryable: true,
    });
    return;
  }

  const delivered = await fetchAndBroadcastBook(symbol, ws);
  if (delivered) {
    subscriptions.get(ws)?.add(symbol);
    startPolling();
  }
}

/**
 * Attaches the authoritative order-book endpoint. The endpoint remains usable for
 * real position and loan notifications, but market-data subscriptions are accepted
 * only after a matching-engine depth snapshot has been verified.
 */
export function attachOrderBookWS(httpServer: Server): WebSocketServer {
  const wss = new WebSocketServer({ server: httpServer, path: "/ws/orderbook" });

  wss.on("connection", (ws) => {
    subscriptions.set(ws, new Set());

    ws.on("message", (raw) => {
      void (async () => {
        let message: unknown;
        try {
          message = JSON.parse(raw.toString());
        } catch {
          sendFeedError(ws, {
            code: "INVALID_REQUEST",
            message: "WebSocket messages must be valid JSON.",
            retryable: false,
          });
          return;
        }

        if (!message || typeof message !== "object") {
          sendFeedError(ws, {
            code: "INVALID_REQUEST",
            message: "WebSocket message must be an object.",
            retryable: false,
          });
          return;
        }

        const msg = message as { type?: unknown; symbols?: unknown; userId?: unknown };
        if (msg.type === "subscribe" && Array.isArray(msg.symbols)) {
          for (const value of msg.symbols) {
            if (typeof value !== "string" || value.trim() === "") {
              sendFeedError(ws, {
                code: "INVALID_SYMBOL",
                message: "Each subscribed symbol must be a non-empty string.",
                retryable: false,
              });
              continue;
            }
            await subscribeToAuthoritativeBook(ws, value);
          }
        } else if (msg.type === "unsubscribe" && Array.isArray(msg.symbols)) {
          const symbols = subscriptions.get(ws);
          for (const value of msg.symbols) {
            if (typeof value === "string") symbols?.delete(value);
          }
          stopPollingWhenUnused();
        } else if (msg.type === "subscribe_positions" && typeof msg.userId === "number") {
          subscribePositions(ws, msg.userId);
          send(ws, { type: "positions_subscribed", userId: msg.userId });
        } else if (msg.type === "unsubscribe_positions") {
          unsubscribePositions(ws);
        } else if (msg.type === "subscribe_loans" && typeof msg.userId === "number") {
          subscribeLoanEvents(ws, msg.userId);
        } else if (msg.type === "unsubscribe_loans") {
          unsubscribeLoanEvents(ws);
        } else if (msg.type === "ping") {
          send(ws, { type: "pong" });
        } else {
          sendFeedError(ws, {
            code: "INVALID_REQUEST",
            message: "Unsupported WebSocket message type.",
            retryable: false,
          });
        }
      })().catch(() => {
        sendFeedError(ws, {
          code: "INTERNAL_ERROR",
          message: "Unable to process the WebSocket request.",
          retryable: true,
        });
      });
    });

    ws.on("close", () => {
      subscriptions.delete(ws);
      unsubscribePositions(ws);
      unsubscribeLoanEvents(ws);
      stopPollingWhenUnused();
    });

    send(ws, {
      type: "connected",
      message: "NEXCOM Authoritative Order Book Feed",
      marketDataSource: "matching-engine",
    });
  });

  console.log("[WS] Authoritative order book server attached at /ws/orderbook");
  return wss;
}
