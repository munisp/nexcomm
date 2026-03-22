/**
 * NEXCOM Exchange — WebSocket Order Book Server
 * Broadcasts live price ticks and order book snapshots to subscribed clients.
 * Clients subscribe by sending: { type: "subscribe", symbols: ["GINGER-NG-SPOT", ...] }
 * Server broadcasts: { type: "tick", symbol, price, bid, ask, changePct, volume }
 *                    { type: "book", symbol, bids: [...], asks: [...], spread, spreadPct }
 *
 * Data sources (in priority order):
 *   1. Rust matching engine REST API (port 8080) — real price-time priority depth
 *   2. Simulated random-walk data — fallback when Rust engine is unavailable
 */
import { WebSocketServer, WebSocket } from "ws";
import type { Server } from "http";
import { getMarketDepth, checkMatchingEngineHealth } from "../matchingEngineClient";
import { subscribePositions, unsubscribePositions, broadcastPriceUpdate } from "./positionBroadcaster";

// Cache of whether the Rust engine is available (checked every 30s)
let _rustEngineAvailable = false;
setInterval(async () => {
  _rustEngineAvailable = await checkMatchingEngineHealth();
}, 30_000);
// Initial check
checkMatchingEngineHealth().then(ok => { _rustEngineAvailable = ok; }).catch(() => {});

// ─── Instrument registry ──────────────────────────────────────────────────────
// Seed prices for all NEXCOM instruments. These mirror the shared/commodities.ts
// base prices so the WS feed is consistent with the REST mock data.
const SEED_PRICES: Record<string, number> = {
  "GINGER-NG-SPOT": 1850, "MAIZE-NG-SPOT": 290, "SORGHUM-NG-SPOT": 185,
  "SOYBEANS-NG-SPOT": 520, "SESAME-NG-SPOT": 1100, "COWPEA-NG-SPOT": 650,
  "COCOA-SPOT": 3200, "COFFEE-SPOT": 185, "COTTON-SPOT": 82,
  "RUBBER-SPOT": 1.65, "PALM-OIL-SPOT": 920, "GROUNDNUT-SPOT": 1250,
  "WHEAT-FUTURES": 610, "CORN-FUTURES": 480, "SOYBEAN-FUTURES": 1380,
  "SUGAR-FUTURES": 22.5, "COFFEE-FUTURES": 195, "COTTON-FUTURES": 85,
  "CRUDE-OIL-WTI": 78.5, "CRUDE-OIL-BRENT": 82.3, "NATURAL-GAS": 2.85,
  "GOLD-SPOT": 2050, "SILVER-SPOT": 24.5, "PLATINUM-SPOT": 980,
  "COPPER-LME": 8750, "ALUMINUM-LME": 2250, "ZINC-LME": 2600,
  "EURUSD": 1.0850, "GBPUSD": 1.2650, "USDJPY": 149.50,
  "USDNGN": 1580, "USDGHS": 15.20, "USDKES": 129.50,
  "EURUSD-FX": 1.0850, "GBPEUR-FX": 1.1650, "USDZAR-FX": 18.75,
  "AAPL": 185.5, "MSFT": 415.2, "GOOGL": 175.8,
  "DANGOTE": 285, "GTCO": 42.5, "ZENITH": 38.2,
  "BTC-USD": 67500, "ETH-USD": 3850, "BNB-USD": 580,
  "NEXCOM-AGRI-IDX": 1250, "NEXCOM-METAL-IDX": 2100, "NEXCOM-ENERGY-IDX": 980,
};

interface PriceState {
  price: number;
  bid: number;
  ask: number;
  open: number;
  changePct: number;
  volume: number;
  tickSize: number;
}

interface OrderBookLevel {
  price: number;
  qty: number;
  total: number;
  depth: number;
}

interface OrderBookSnapshot {
  bids: OrderBookLevel[];
  asks: OrderBookLevel[];
  spread: number;
  spreadPct: number;
}

// ─── State ────────────────────────────────────────────────────────────────────
const priceState = new Map<string, PriceState>();

function initState(symbol: string): PriceState {
  const base = SEED_PRICES[symbol] ?? 100;
  const tickSize = base > 1000 ? 0.5 : base > 100 ? 0.1 : base > 10 ? 0.01 : 0.0001;
  const spread = tickSize * 2;
  return {
    price: base,
    bid: base - spread,
    ask: base + spread,
    open: base,
    changePct: 0,
    volume: Math.floor(Math.random() * 5000 + 500),
    tickSize,
  };
}

function tickPrice(state: PriceState): PriceState {
  // Mean-reverting random walk
  const drift = (state.open - state.price) * 0.0005;
  const shock = (Math.random() - 0.5) * state.price * 0.0015;
  const newPrice = Math.max(state.price * 0.5, state.price + drift + shock);
  const spread = state.tickSize * (1.5 + Math.random());
  const changePct = ((newPrice - state.open) / state.open) * 100;
  return {
    ...state,
    price: parseFloat(newPrice.toFixed(4)),
    bid: parseFloat((newPrice - spread).toFixed(4)),
    ask: parseFloat((newPrice + spread).toFixed(4)),
    changePct: parseFloat(changePct.toFixed(3)),
    volume: state.volume + Math.floor(Math.random() * 20),
  };
}

function buildBook(state: PriceState, levels = 14): OrderBookSnapshot {
  const bids: OrderBookLevel[] = [];
  const asks: OrderBookLevel[] = [];
  let bidTotal = 0;
  let askTotal = 0;

  for (let i = 0; i < levels; i++) {
    const bPrice = parseFloat(
      (state.bid - state.tickSize * i * (1 + Math.random() * 0.3)).toFixed(4)
    );
    const bQty = Math.floor(Math.random() * 80 + 5);
    bidTotal += bQty;
    bids.push({ price: bPrice, qty: bQty, total: bidTotal, depth: 0 });

    const aPrice = parseFloat(
      (state.ask + state.tickSize * i * (1 + Math.random() * 0.3)).toFixed(4)
    );
    const aQty = Math.floor(Math.random() * 80 + 5);
    askTotal += aQty;
    asks.push({ price: aPrice, qty: aQty, total: askTotal, depth: 0 });
  }

  const maxBid = bids[bids.length - 1].total;
  const maxAsk = asks[asks.length - 1].total;
  bids.forEach(b => (b.depth = (b.total / maxBid) * 100));
  asks.forEach(a => (a.depth = (a.total / maxAsk) * 100));

  const spread = parseFloat((state.ask - state.bid).toFixed(4));
  const spreadPct = parseFloat(((spread / state.price) * 100).toFixed(4));

  return { bids, asks: asks.reverse(), spread, spreadPct };
}

// ─── Client subscriptions ─────────────────────────────────────────────────────
const subscriptions = new Map<WebSocket, Set<string>>();

function broadcast(symbol: string, payload: object) {
  const msg = JSON.stringify(payload);
  Array.from(subscriptions.entries()).forEach(([ws, syms]) => {
    if (syms.has(symbol) && ws.readyState === WebSocket.OPEN) {
      ws.send(msg);
    }
  });
}

// ─── Tick loop ────────────────────────────────────────────────────────────────
let tickInterval: ReturnType<typeof setInterval> | null = null;

function startTickLoop() {
  if (tickInterval) return;
  tickInterval = setInterval(() => {
    Array.from(priceState.entries()).forEach(async ([symbol, state]) => {
      const newState = tickPrice(state);
      priceState.set(symbol, newState);

      // Broadcast tick
      broadcast(symbol, {
        type: "tick",
        symbol,
        price: newState.price,
        bid: newState.bid,
        ask: newState.ask,
        changePct: newState.changePct,
        volume: newState.volume,
      });

      // Push real-time position/P&L updates to subscribed traders
      broadcastPriceUpdate(symbol, newState.price).catch(() => {});

      // Broadcast book every other tick (750ms)
      // Prefer real Rust engine depth; fall back to simulated data
      if (Math.random() > 0.5) {
        if (_rustEngineAvailable) {
          try {
            const rustDepth = await getMarketDepth(symbol);
            if (rustDepth && (rustDepth.bids.length > 0 || rustDepth.asks.length > 0)) {
              // Convert Rust depth format to WS book format
              let bidTotal = 0;
              const bids = rustDepth.bids.map(b => {
                bidTotal += b.quantity;
                return { price: b.price, qty: b.quantity, total: bidTotal, depth: 0 };
              });
              let askTotal = 0;
              const asks = rustDepth.asks.map(a => {
                askTotal += a.quantity;
                return { price: a.price, qty: a.quantity, total: askTotal, depth: 0 };
              });
              const maxBid = bids[bids.length - 1]?.total || 1;
              const maxAsk = asks[asks.length - 1]?.total || 1;
              bids.forEach(b => (b.depth = (b.total / maxBid) * 100));
              asks.forEach(a => (a.depth = (a.total / maxAsk) * 100));
              const topBid = bids[0]?.price ?? newState.bid;
              const topAsk = asks[0]?.price ?? newState.ask;
              const spread = parseFloat((topAsk - topBid).toFixed(4));
              const spreadPct = parseFloat(((spread / newState.price) * 100).toFixed(4));
              broadcast(symbol, {
                type: "book",
                symbol,
                bids,
                asks: asks.reverse(),
                spread,
                spreadPct,
                source: "rust",
              });
              return;
            }
          } catch {
            // Fall through to simulated data
          }
        }
        // Simulated fallback
        broadcast(symbol, {
          type: "book",
          symbol,
          ...buildBook(newState),
          source: "simulated",
        });
      }
    });
  }, 750);
}

// ─── Server setup ─────────────────────────────────────────────────────────────
export function attachOrderBookWS(httpServer: Server): WebSocketServer {
  const wss = new WebSocketServer({ server: httpServer, path: "/ws/orderbook" });

  wss.on("connection", (ws) => {
    subscriptions.set(ws, new Set());

    ws.on("message", (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.type === "subscribe" && Array.isArray(msg.symbols)) {
          const syms = subscriptions.get(ws)!;
          for (const sym of msg.symbols as string[]) {
            syms.add(sym);
            // Ensure price state exists
            if (!priceState.has(sym)) {
              priceState.set(sym, initState(sym));
            }
            // Send immediate snapshot
            const state = priceState.get(sym)!;
            ws.send(JSON.stringify({
              type: "tick",
              symbol: sym,
              price: state.price,
              bid: state.bid,
              ask: state.ask,
              changePct: state.changePct,
              volume: state.volume,
            }));
            ws.send(JSON.stringify({
              type: "book",
              symbol: sym,
              ...buildBook(state),
            }));
          }
          startTickLoop();
        } else if (msg.type === "unsubscribe" && Array.isArray(msg.symbols)) {
          const syms = subscriptions.get(ws)!;
          for (const sym of msg.symbols as string[]) {
            syms.delete(sym);
          }
        } else if (msg.type === "subscribe_positions" && typeof msg.userId === "number") {
          // Subscribe to real-time position/P&L updates for this user
          subscribePositions(ws, msg.userId);
          ws.send(JSON.stringify({ type: "positions_subscribed", userId: msg.userId }));
        } else if (msg.type === "unsubscribe_positions") {
          unsubscribePositions(ws);
        } else if (msg.type === "ping") {
          ws.send(JSON.stringify({ type: "pong" }));
        }
      } catch {
        // ignore malformed messages
      }
    });

    ws.on("close", () => {
      subscriptions.delete(ws);
      unsubscribePositions(ws); // Clean up position subscriptions too
    });

    // Send welcome
    ws.send(JSON.stringify({ type: "connected", message: "NEXCOM Order Book Feed v1.0" }));
  });

  console.log("[WS] Order book server attached at /ws/orderbook");
  return wss;
}
