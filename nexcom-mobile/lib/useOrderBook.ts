/**
 * useOrderBook.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * React Native hook for live order book data via WebSocket.
 * Connects to the NEXCOM Exchange /ws/orderbook endpoint and subscribes to
 * a given symbol. On connection failure the book is EMPTY with status
 * 'disconnected'/'error' — callers render an OFFLINE state with retry (no
 * silent demo data).
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
  source: 'live' | 'simulated';
  status: 'connecting' | 'connected' | 'disconnected' | 'error';
  lastUpdated: number;
}

export interface UseOrderBookResult extends OrderBookState {
  /** Reconnect after a failure — wire to a retry button in the UI. */
  retry: () => void;
}

// ─── Empty book (initial / offline state) ─────────────────────────────────────

function emptyBook(): OrderBookState {
  return {
    bids: [],
    asks: [],
    spread: 0,
    spreadPct: 0,
    price: 0,
    bid: 0,
    ask: 0,
    changePct: 0,
    volume: 0,
    source: 'live',
    status: 'connecting',
    lastUpdated: 0,
  };
}

// ─── Derive WebSocket URL from config ─────────────────────────────────────────

function getWsUrl(): string {
  // Convert http(s) → ws(s)
  return CONFIG.BASE_URL.replace(/^http/, 'ws') + '/ws/orderbook';
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useOrderBook(symbol: string): UseOrderBookResult {
  const [state, setState] = useState<OrderBookState>(() => emptyBook());
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

  const retry = useCallback(() => {
    if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
    if (wsRef.current) {
      wsRef.current.onclose = null;
      try { wsRef.current.close(); } catch { /* already closed */ }
      wsRef.current = null;
    }
    connect();
  }, [connect]);

  return { ...state, retry };
}
