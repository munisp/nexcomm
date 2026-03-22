/**
 * NEXCOM Exchange — useWebSocketFeed hook
 * Connects to the server's WebSocket order book feed at /ws/orderbook.
 * Provides live price ticks and order book snapshots for subscribed symbols.
 *
 * Falls back gracefully to the usePriceFeed polling hook if the WS is unavailable.
 */
import { useState, useEffect, useRef, useCallback } from "react";
import type { OrderBook } from "./useOrderBook";

export interface WSTick {
  symbol: string;
  price: number;
  bid: number;
  ask: number;
  changePct: number;
  volume: number;
}

export interface WSFeedState {
  ticks: Record<string, WSTick>;
  books: Record<string, OrderBook>;
  connected: boolean;
  error: string | null;
}

const RECONNECT_DELAY_MS = 3000;
const MAX_RECONNECT_ATTEMPTS = 5;

function getWsUrl(): string {
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.host}/ws/orderbook`;
}

export function useWebSocketFeed(symbols: string[]): WSFeedState {
  const [ticks, setTicks]       = useState<Record<string, WSTick>>({});
  const [books, setBooks]       = useState<Record<string, OrderBook>>({});
  const [connected, setConnected] = useState(false);
  const [error, setError]       = useState<string | null>(null);

  const wsRef             = useRef<WebSocket | null>(null);
  const symbolsRef        = useRef<string[]>(symbols);
  const reconnectAttempts = useRef(0);
  const reconnectTimer    = useRef<ReturnType<typeof setTimeout> | null>(null);
  const unmounted         = useRef(false);

  // Keep symbols ref in sync without restarting the connection
  useEffect(() => {
    symbolsRef.current = symbols;
  }, [symbols]);

  const subscribe = useCallback((ws: WebSocket) => {
    if (ws.readyState === WebSocket.OPEN && symbolsRef.current.length > 0) {
      ws.send(JSON.stringify({ type: "subscribe", symbols: symbolsRef.current }));
    }
  }, []);

  const connect = useCallback(() => {
    if (unmounted.current) return;
    if (wsRef.current) {
      wsRef.current.onclose = null;
      wsRef.current.onerror = null;
      wsRef.current.close();
    }

    const ws = new WebSocket(getWsUrl());
    wsRef.current = ws;

    ws.onopen = () => {
      if (unmounted.current) { ws.close(); return; }
      reconnectAttempts.current = 0;
      setConnected(true);
      setError(null);
      subscribe(ws);
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data as string);
        if (msg.type === "tick") {
          setTicks(prev => ({ ...prev, [msg.symbol]: msg as WSTick }));
        } else if (msg.type === "book") {
          const { type: _t, symbol, ...bookData } = msg;
          setBooks(prev => ({
            ...prev,
            [symbol]: {
              ...bookData,
              midPrice: ((bookData.bids?.[0]?.price ?? 0) + (bookData.asks?.[bookData.asks.length - 1]?.price ?? 0)) / 2,
              lastUpdate: Date.now(),
            } as OrderBook,
          }));
        }
      } catch {
        // ignore malformed messages
      }
    };

    ws.onerror = () => {
      setError("WebSocket connection error");
    };

    ws.onclose = () => {
      if (unmounted.current) return;
      setConnected(false);
      if (reconnectAttempts.current < MAX_RECONNECT_ATTEMPTS) {
        reconnectAttempts.current += 1;
        reconnectTimer.current = setTimeout(connect, RECONNECT_DELAY_MS);
      } else {
        setError("WebSocket disconnected — using polling fallback");
      }
    };
  }, [subscribe]);

  useEffect(() => {
    unmounted.current = false;
    connect();
    return () => {
      unmounted.current = true;
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      if (wsRef.current) {
        wsRef.current.onclose = null;
        wsRef.current.close();
      }
    };
  }, [connect]);

  // Re-subscribe when symbols change while connected
  useEffect(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN && symbols.length > 0) {
      wsRef.current.send(JSON.stringify({ type: "subscribe", symbols }));
    }
  }, [symbols]);

  return { ticks, books, connected, error };
}
