/**
 * NEXCOM Exchange — useOrderBook hook
 * Simulates a live order book with realistic bid/ask ladder updates.
 * In production, replace the interval with a WebSocket subscription.
 */
import { useState, useEffect, useRef, useCallback } from "react";

export interface OrderBookLevel {
  price: number;
  qty: number;
  total: number;
  depth: number;  // 0–100 percentage for depth bar
}

export interface OrderBook {
  bids: OrderBookLevel[];  // sorted descending (best bid first)
  asks: OrderBookLevel[];  // sorted ascending (best ask first)
  spread: number;
  spreadPct: number;
  midPrice: number;
  lastUpdate: number;
}

function buildOrderBook(midPrice: number, tickSize: number, levels = 14): OrderBook {
  const bids: OrderBookLevel[] = [];
  const asks: OrderBookLevel[] = [];
  let bidTotal = 0;
  let askTotal = 0;

  for (let i = 0; i < levels; i++) {
    // Bids: prices below mid, decreasing
    const bPrice = parseFloat(
      (midPrice - tickSize * (i + 1) * (1 + Math.random() * 0.3)).toFixed(4)
    );
    const bQty = Math.floor(Math.random() * 80 + 5);
    bidTotal += bQty;
    bids.push({ price: bPrice, qty: bQty, total: bidTotal, depth: 0 });

    // Asks: prices above mid, increasing
    const aPrice = parseFloat(
      (midPrice + tickSize * (i + 1) * (1 + Math.random() * 0.3)).toFixed(4)
    );
    const aQty = Math.floor(Math.random() * 80 + 5);
    askTotal += aQty;
    asks.push({ price: aPrice, qty: aQty, total: askTotal, depth: 0 });
  }

  // Normalise depth bars
  const maxBid = bids[bids.length - 1].total;
  const maxAsk = asks[asks.length - 1].total;
  bids.forEach(b => (b.depth = (b.total / maxBid) * 100));
  asks.forEach(a => (a.depth = (a.total / maxAsk) * 100));

  const bestBid = bids[0].price;
  const bestAsk = asks[0].price;
  const spread = parseFloat((bestAsk - bestBid).toFixed(4));
  const spreadPct = parseFloat(((spread / midPrice) * 100).toFixed(4));

  return {
    bids,
    asks: asks.reverse(), // show best ask at bottom (closest to mid)
    spread,
    spreadPct,
    midPrice,
    lastUpdate: Date.now(),
  };
}

interface UseOrderBookOptions {
  /** Mid price to build the book around */
  midPrice: number;
  /** Tick size for the instrument */
  tickSize?: number;
  /** Number of levels per side */
  levels?: number;
  /** Refresh interval in ms. Defaults to 1500. */
  interval?: number;
  /** Whether the book is active. Defaults to true. */
  active?: boolean;
}

export function useOrderBook(options: UseOrderBookOptions): {
  book: OrderBook;
  connected: boolean;
} {
  const { midPrice, tickSize = 1, levels = 14, interval = 1500, active = true } = options;

  const [book, setBook] = useState<OrderBook>(() =>
    buildOrderBook(midPrice, tickSize, levels)
  );
  const [connected, setConnected] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const midPriceRef = useRef(midPrice);

  // Track mid price changes without restarting the interval
  useEffect(() => {
    midPriceRef.current = midPrice;
  }, [midPrice]);

  const tick = useCallback(() => {
    setBook(buildOrderBook(midPriceRef.current, tickSize, levels));
  }, [tickSize, levels]);

  useEffect(() => {
    if (!active) {
      setConnected(false);
      if (timerRef.current) clearInterval(timerRef.current);
      return;
    }
    const connectTimeout = setTimeout(() => setConnected(true), 300);
    timerRef.current = setInterval(tick, interval);
    return () => {
      clearTimeout(connectTimeout);
      if (timerRef.current) clearInterval(timerRef.current);
      setConnected(false);
    };
  }, [active, interval, tick]);

  return { book, connected };
}
