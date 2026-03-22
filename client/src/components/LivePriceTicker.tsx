/**
 * NEXCOM Exchange — Live Price Ticker
 * Connects to the WebSocket order book server at /ws/orderbook and displays
 * a horizontally scrolling ticker strip with real-time price updates.
 *
 * Features:
 * - Auto-reconnect with exponential backoff (max 30s)
 * - Colour-coded price change direction (green up, red down)
 * - Pause on hover to allow reading
 * - Configurable symbol list (defaults to key NEXCOM instruments)
 * - Connection status indicator
 */
import { useEffect, useRef, useState, useCallback } from "react";
import { cn } from "@/lib/utils";
import { Wifi, WifiOff, Pause, Play } from "lucide-react";

export interface TickerSymbol {
  symbol: string;
  label: string;
}

interface PriceTick {
  symbol: string;
  price: number;
  bid: number;
  ask: number;
  changePct: number;
  volume: number;
}

interface LivePriceTickerProps {
  symbols?: TickerSymbol[];
  className?: string;
  /** Speed in pixels per second (default: 60) */
  speed?: number;
}

const DEFAULT_SYMBOLS: TickerSymbol[] = [
  { symbol: "GINGER-NG-SPOT", label: "Ginger" },
  { symbol: "MAIZE-NG-SPOT", label: "Maize" },
  { symbol: "SORGHUM-NG-SPOT", label: "Sorghum" },
  { symbol: "SOYBEANS-NG-SPOT", label: "Soybeans" },
  { symbol: "SESAME-NG-SPOT", label: "Sesame" },
  { symbol: "COWPEA-NG-SPOT", label: "Cowpea" },
  { symbol: "COCOA-SPOT", label: "Cocoa" },
  { symbol: "COFFEE-SPOT", label: "Coffee" },
  { symbol: "COTTON-SPOT", label: "Cotton" },
  { symbol: "GOLD-SPOT", label: "Gold" },
  { symbol: "SILVER-SPOT", label: "Silver" },
  { symbol: "CRUDE-OIL-WTI", label: "WTI" },
  { symbol: "CRUDE-OIL-BRENT", label: "Brent" },
  { symbol: "WHEAT-FUTURES", label: "Wheat" },
  { symbol: "CORN-FUTURES", label: "Corn" },
  { symbol: "BTC-USD", label: "BTC" },
  { symbol: "ETH-USD", label: "ETH" },
  { symbol: "EURUSD", label: "EUR/USD" },
  { symbol: "USDNGN", label: "USD/NGN" },
  { symbol: "NEXCOM-AGRI-IDX", label: "NEXCOM Agri" },
];

function formatPrice(price: number): string {
  if (price >= 10000) return price.toLocaleString("en-US", { maximumFractionDigits: 0 });
  if (price >= 100) return price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (price >= 1) return price.toLocaleString("en-US", { minimumFractionDigits: 3, maximumFractionDigits: 4 });
  return price.toLocaleString("en-US", { minimumFractionDigits: 4, maximumFractionDigits: 5 });
}

export function LivePriceTicker({
  symbols = DEFAULT_SYMBOLS,
  className,
  speed = 60,
}: LivePriceTickerProps) {
  const [prices, setPrices] = useState<Map<string, PriceTick>>(new Map());
  const [prevPrices, setPrevPrices] = useState<Map<string, number>>(new Map());
  const [connected, setConnected] = useState(false);
  const [paused, setPaused] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectDelayRef = useRef(1000);
  const tickerRef = useRef<HTMLDivElement>(null);
  const animationRef = useRef<number | null>(null);
  const offsetRef = useRef(0);

  // ── SSE connection to Fluvio price-updates stream (with WS fallback) ────────
  const sseRef = useRef<EventSource | null>(null);

  const connectSSE = useCallback(() => {
    if (sseRef.current) return;
    const url = `/api/v1/fluvio/stream/nexcom.price-updates?from_offset=latest`;
    const es = new EventSource(url);
    sseRef.current = es;

    es.addEventListener("message", (event) => {
      try {
        const envelope = JSON.parse(event.data as string) as {
          topic: string; key: string; value: string; ts: number;
        };
        const payload = JSON.parse(envelope.value) as {
          symbol?: string; price?: string | number; change?: string | number;
        };
        const sym = payload.symbol ?? envelope.key;
        const price = typeof payload.price === "string" ? parseFloat(payload.price) : (payload.price ?? 0);
        const changePct = typeof payload.change === "string" ? parseFloat(payload.change) : (payload.change ?? 0);
        if (!sym || isNaN(price)) return;
        setPrevPrices((prev) => {
          const next = new Map(prev);
          const existing = prices.get(sym);
          if (existing) next.set(sym, existing.price);
          return next;
        });
        setPrices((prev) => {
          const next = new Map(prev);
          next.set(sym, { symbol: sym, price, bid: price * 0.9995, ask: price * 1.0005, changePct, volume: 0 });
          return next;
        });
        setConnected(true);
        reconnectDelayRef.current = 1000;
      } catch {
        // ignore malformed messages
      }
    });

    es.addEventListener("heartbeat", () => {
      setConnected(true);
    });

    es.onerror = () => {
      setConnected(false);
      sseRef.current?.close();
      sseRef.current = null;
      // Fall back to WebSocket order book
      const delay = Math.min(reconnectDelayRef.current, 30000);
      reconnectDelayRef.current = delay * 2;
      reconnectTimerRef.current = setTimeout(() => {
        connectSSE();
      }, delay);
    };
  }, [symbols]); // eslint-disable-line react-hooks/exhaustive-deps

  // Also maintain WebSocket connection as secondary data source
  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const url = `${protocol}//${window.location.host}/ws/orderbook`;
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      ws.send(JSON.stringify({ type: "subscribe", symbols: symbols.map((s) => s.symbol) }));
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data as string);
        if (msg.type === "tick") {
          const tick = msg as PriceTick;
          setPrevPrices((prev) => {
            const next = new Map(prev);
            const existing = prices.get(tick.symbol);
            if (existing) next.set(tick.symbol, existing.price);
            return next;
          });
          setPrices((prev) => {
            const next = new Map(prev);
            next.set(tick.symbol, tick);
            return next;
          });
        }
      } catch { /* ignore */ }
    };

    ws.onclose = () => {
      wsRef.current = null;
      const delay = Math.min(reconnectDelayRef.current, 30000);
      reconnectTimerRef.current = setTimeout(connect, delay);
    };
    ws.onerror = () => ws.close();
  }, [symbols]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    connectSSE(); // Primary: Fluvio SSE
    connect();    // Secondary: WebSocket fallback
    return () => {
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      sseRef.current?.close();
      wsRef.current?.close();
    };
  }, [connectSSE, connect]);

  // ── Scrolling animation ───────────────────────────────────────────────────
  useEffect(() => {
    const el = tickerRef.current;
    if (!el) return;

    let lastTime: number | null = null;

    const step = (timestamp: number) => {
      if (!paused) {
        if (lastTime !== null) {
          const delta = timestamp - lastTime;
          offsetRef.current += (speed * delta) / 1000;
          const totalWidth = el.scrollWidth / 2; // duplicated content
          if (offsetRef.current >= totalWidth) {
            offsetRef.current -= totalWidth;
          }
          el.style.transform = `translateX(-${offsetRef.current}px)`;
        }
        lastTime = timestamp;
      } else {
        lastTime = null;
      }
      animationRef.current = requestAnimationFrame(step);
    };

    animationRef.current = requestAnimationFrame(step);
    return () => {
      if (animationRef.current !== null) cancelAnimationFrame(animationRef.current);
    };
  }, [paused, speed]);

  // ── Render ────────────────────────────────────────────────────────────────
  const items = symbols.map((sym) => {
    const tick = prices.get(sym.symbol);
    const prev = prevPrices.get(sym.symbol);
    const price = tick?.price ?? null;
    const changePct = tick?.changePct ?? 0;
    const direction = price !== null && prev !== undefined
      ? price > prev ? "up" : price < prev ? "down" : "neutral"
      : "neutral";

    return (
      <span
        key={sym.symbol}
        className="inline-flex items-center gap-1.5 px-4 whitespace-nowrap select-none"
      >
        <span className="text-blue-300 font-semibold text-xs tracking-wide">{sym.label}</span>
        {price !== null ? (
          <>
            <span
              className={cn(
                "font-mono text-sm font-bold transition-colors duration-300",
                direction === "up" && "text-emerald-400",
                direction === "down" && "text-red-400",
                direction === "neutral" && "text-white",
              )}
            >
              {formatPrice(price)}
            </span>
            <span
              className={cn(
                "text-xs font-medium",
                changePct > 0 ? "text-emerald-400" : changePct < 0 ? "text-red-400" : "text-slate-400",
              )}
            >
              {changePct > 0 ? "▲" : changePct < 0 ? "▼" : "—"}
              {Math.abs(changePct).toFixed(2)}%
            </span>
          </>
        ) : (
          <span className="text-slate-500 text-xs font-mono">—</span>
        )}
        <span className="text-blue-800 ml-2">|</span>
      </span>
    );
  });

  return (
    <div
      className={cn(
        "relative flex items-center bg-blue-950/80 border-y border-blue-800/60 overflow-hidden h-9",
        className,
      )}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      {/* Status indicator */}
      <div className="flex-shrink-0 flex items-center gap-1.5 px-2 border-r border-blue-800/60 h-full bg-blue-950 z-10">
        {connected ? (
          <Wifi className="w-3 h-3 text-emerald-400" />
        ) : (
          <WifiOff className="w-3 h-3 text-red-400 animate-pulse" />
        )}
        <span className="text-xs text-blue-400 font-medium">LIVE</span>
      </div>

      {/* Scrolling ticker */}
      <div className="flex-1 overflow-hidden relative">
        <div
          ref={tickerRef}
          className="inline-flex items-center will-change-transform"
          style={{ transform: "translateX(0px)" }}
        >
          {/* Duplicate items for seamless loop */}
          {items}
          {items}
        </div>
      </div>

      {/* Pause indicator */}
      {paused && (
        <div className="absolute right-2 flex items-center gap-1 text-xs text-blue-400 z-10">
          <Pause className="w-3 h-3" />
          <span>Paused</span>
        </div>
      )}
    </div>
  );
}

export default LivePriceTicker;
