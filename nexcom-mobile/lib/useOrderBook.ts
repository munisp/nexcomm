/**
 * useOrderBook.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * React Native hook for live order book data via WebSocket.
 * Connects to the NEXCOM Exchange /ws/orderbook endpoint and subscribes to
 * a given symbol. Falls back to static demo data if the connection fails.
 *
 * Usage:
 *   const { bids, asks, spread, spreadPct, price, changePct, status } = useOrderBook('MAIZE');
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { CONFIG } from '../constants/config';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface OrderBookLevel {
  price: number;
  qty: number;
  total: number;
  depth: number; // 0–100 percentage bar width
}

export interface TickData {
  price: number;
  bid: number;
  ask: number;
  changePct: number;
  volume: number;
}

export interface OrderBookState {
  bids: OrderBookLevel[];
  asks: OrderBookLevel[];
  spread: number;
  spreadPct: number;
  price: number;
  bid: number;
  ask: number;
  changePct: number;
  volume: number;
  source: 'live' | 'simulated' | 'demo';
  status: 'connecting' | 'connected' | 'disconnected' | 'error';
  lastUpdated: number;
}

// ─── Demo fallback data ───────────────────────────────────────────────────────

const DEMO_PRICES: Record<string, number> = {
  MAIZE: 285000, SOYBEAN: 520000, COCOA: 4850000, GINGER: 1250000,
  SESAME: 890000, SORGHUM: 195000, MILLET: 210000, CASSAVA: 85000,
  PALM_OIL: 1650000, GROUNDNUT: 420000, WHEAT: 380000, RICE: 650000,
};

function buildDemoBook(symbol: string): OrderBookState {
  const basePrice = DEMO_PRICES[symbol] ?? 100000;
  const spread = basePrice * 0.0004;
  const bid = basePrice - spread / 2;
  const ask = basePrice + spread / 2;

  const bids: OrderBookLevel[] = Array.from({ length: 8 }, (_, i) => {
    const price = bid - i * (basePrice * 0.001);
    const qty = Math.floor(20 + Math.random() * 180);
    const total = price * qty;
    return { price, qty, total, depth: 0 };
  });
  const asks: OrderBookLevel[] = Array.from({ length: 8 }, (_, i) => {
    const price = ask + i * (basePrice * 0.001);
    const qty = Math.floor(20 + Math.random() * 180);
    const total = price * qty;
    return { price, qty, total, depth: 0 };
  });

  // Compute depth bars
  const maxBid = bids.reduce((m, b) => Math.max(m, b.qty), 1);
  const maxAsk = asks.reduce((m, a) => Math.max(m, a.qty), 1);
  bids.forEach(b => (b.depth = (b.qty / maxBid) * 100));
  asks.forEach(a => (a.depth = (a.qty / maxAsk) * 100));

  return {
    bids,
    asks,
    spread: parseFloat(spread.toFixed(2)),
    spreadPct: parseFloat(((spread / basePrice) * 100).toFixed(4)),
    price: basePrice,
    bid,
    ask,
    changePct: (Math.random() - 0.5) * 4,
    volume: Math.floor(500 + Math.random() * 2000),
    source: 'demo',
    status: 'disconnected',
    lastUpdated: Date.now(),
  };
}

// ─── Derive WebSocket URL from config ─────────────────────────────────────────

function getWsUrl(): string {
  const base = __DEV__ ? CONFIG.DEV_URL : CONFIG.BASE_URL;
  // Convert http(s) → ws(s)
  return base.replace(/^http/, 'ws') + '/ws/orderbook';
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useOrderBook(symbol: string): OrderBookState {
  const [state, setState] = useState<OrderBookState>(() => buildDemoBook(symbol));
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  const connect = useCallback(() => {
    if (!mountedRef.current) return;

    setState(prev => ({ ...prev, status: 'connecting' }));

    try {
      const ws = new WebSocket(getWsUrl());
      wsRef.current = ws;

      ws.onopen = () => {
        if (!mountedRef.current) { ws.close(); return; }
        setState(prev => ({ ...prev, status: 'connected' }));
        ws.send(JSON.stringify({ type: 'subscribe', symbols: [symbol] }));
      };

      ws.onmessage = (event) => {
        if (!mountedRef.current) return;
        try {
          const msg = JSON.parse(event.data as string);

          if (msg.type === 'tick' && msg.symbol === symbol) {
            setState(prev => ({
              ...prev,
              price: msg.price,
              bid: msg.bid,
              ask: msg.ask,
              changePct: msg.changePct,
              volume: msg.volume,
              lastUpdated: Date.now(),
            }));
          } else if (msg.type === 'book' && msg.symbol === symbol) {
            setState(prev => ({
              ...prev,
              bids: msg.bids ?? prev.bids,
              asks: msg.asks ?? prev.asks,
              spread: msg.spread ?? prev.spread,
              spreadPct: msg.spreadPct ?? prev.spreadPct,
              source: msg.source === 'rust' ? 'live' : 'simulated',
              lastUpdated: Date.now(),
            }));
          }
        } catch {
          // ignore malformed frames
        }
      };

      ws.onerror = () => {
        if (!mountedRef.current) return;
        setState(prev => ({ ...prev, status: 'error' }));
      };

      ws.onclose = () => {
        if (!mountedRef.current) return;
        setState(prev => ({ ...prev, status: 'disconnected' }));
        // Auto-reconnect after 3 seconds
        reconnectTimer.current = setTimeout(() => {
          if (mountedRef.current) connect();
        }, 3000);
      };
    } catch {
      setState(prev => ({ ...prev, status: 'error' }));
    }
  }, [symbol]);

  useEffect(() => {
    mountedRef.current = true;
    connect();

    return () => {
      mountedRef.current = false;
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      if (wsRef.current) {
        wsRef.current.onclose = null; // prevent reconnect on intentional close
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [connect]);

  return state;
}
