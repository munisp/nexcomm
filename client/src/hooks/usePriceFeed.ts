/**
 * NEXCOM Exchange — usePriceFeed hook
 * Simulates a live WebSocket price feed with realistic price movements.
 * In production, replace the interval with an actual WebSocket connection.
 */
import { useState, useEffect, useRef, useCallback } from "react";
import { COMMODITIES, generateMockTick, type Commodity } from "../../../shared/commodities";

export interface PriceTick {
  symbol: string;
  price: number;
  change: number;
  changePct: number;
  volume: number;
  timestamp: number;
  direction: "up" | "down" | "flat";
}

export type PriceFeedMap = Record<string, PriceTick>;

/**
 * Initialise the price map from the commodity catalogue.
 */
function initPrices(): PriceFeedMap {
  const map: PriceFeedMap = {};
  for (const c of COMMODITIES) {
    const tick = generateMockTick(c.symbol);
    const price = tick.price;
    map[c.symbol] = {
      symbol: c.symbol,
      price,
      change: 0,
      changePct: 0,
      volume: Math.floor(Math.random() * 500 + 50),
      timestamp: Date.now(),
      direction: "flat",
    };
  }
  return map;
}

/**
 * Simulate a single tick for a commodity.
 * Uses a mean-reverting random walk capped at ±3% per tick.
 */
function simulateTick(prev: PriceTick, basePrice: number): PriceTick {
  const volatility = 0.008; // 0.8% per tick
  const meanReversion = 0.02; // pull back toward base price
  const drift = (basePrice - prev.price) * meanReversion;
  const shock = (Math.random() - 0.5) * 2 * volatility * prev.price;
  const newPrice = Math.max(prev.price + drift + shock, prev.price * 0.97);
  const change = newPrice - prev.price;
  const changePct = (change / prev.price) * 100;
  return {
    symbol: prev.symbol,
    price: parseFloat(newPrice.toFixed(2)),
    change: parseFloat(change.toFixed(2)),
    changePct: parseFloat(changePct.toFixed(3)),
    volume: prev.volume + Math.floor(Math.random() * 20),
    timestamp: Date.now(),
    direction: change > 0.001 ? "up" : change < -0.001 ? "down" : "flat",
  };
}

interface UsePriceFeedOptions {
  /** Symbols to subscribe to. Defaults to all commodities. */
  symbols?: string[];
  /** Update interval in ms. Defaults to 2000. */
  interval?: number;
  /** Whether the feed is active. Defaults to true. */
  active?: boolean;
}

export function usePriceFeed(options: UsePriceFeedOptions = {}): {
  prices: PriceFeedMap;
  connected: boolean;
  lastUpdate: number;
  getPriceTick: (symbol: string) => PriceTick | undefined;
} {
  const { symbols, interval = 2000, active = true } = options;
  const [prices, setPrices] = useState<PriceFeedMap>(() => initPrices());
  const [connected, setConnected] = useState(false);
  const [lastUpdate, setLastUpdate] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const commodityMapRef = useRef<Map<string, Commodity>>(
    new Map(COMMODITIES.map((c) => [c.symbol, c]))
  );

  const tick = useCallback(() => {
    setPrices((prev) => {
      const next = { ...prev };
      const targets = symbols ?? Object.keys(prev);
      // Update a random subset of ~30% of instruments per tick for realism
      const batch = targets.filter(() => Math.random() < 0.3);
      for (const sym of batch) {
        const commodity = commodityMapRef.current.get(sym);
        if (!commodity || !prev[sym]) continue;
        next[sym] = simulateTick(prev[sym], commodity.basePrice);
      }
      return next;
    });
    setLastUpdate(Date.now());
  }, [symbols]);

  useEffect(() => {
    if (!active) {
      setConnected(false);
      if (timerRef.current) clearInterval(timerRef.current);
      return;
    }

    // Simulate connection delay
    const connectTimeout = setTimeout(() => setConnected(true), 400);
    timerRef.current = setInterval(tick, interval);

    return () => {
      clearTimeout(connectTimeout);
      if (timerRef.current) clearInterval(timerRef.current);
      setConnected(false);
    };
  }, [active, interval, tick]);

  const getPriceTick = useCallback(
    (symbol: string) => prices[symbol],
    [prices]
  );

  return { prices, connected, lastUpdate, getPriceTick };
}

/**
 * Convenience hook for a single symbol.
 */
export function useSymbolPrice(symbol: string) {
  const { prices, connected } = usePriceFeed({ symbols: [symbol] });
  return { tick: prices[symbol], connected };
}
