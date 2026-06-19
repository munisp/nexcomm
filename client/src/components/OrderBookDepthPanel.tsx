/**
 * NEXCOM Exchange — OrderBookDepthPanel
 * ─────────────────────────────────────────────────────────────────────────────
 * Real-time Level 2 order book depth panel fed by the existing WebSocket server
 * at /ws/orderbook. Subscribes to a single symbol and renders:
 *   - Bid/ask ladders with depth bars (up to 10 levels per side)
 *   - Spread and spread % indicator
 *   - Connection status badge
 *   - D3.js cumulative depth curve (bid/ask area chart) below the ladder
 *
 * The component reuses the same WebSocket path and message protocol as the
 * Trade page's useWebSocketFeed hook, but manages its own connection so it
 * can be mounted independently on the Watchlist page.
 */
import { useEffect, useRef, useState, useCallback } from "react";
import { Badge } from "@/components/ui/badge";
import { Wifi, WifiOff, RefreshCw } from "lucide-react";
import * as d3 from "d3";

// ── Types ─────────────────────────────────────────────────────────────────────
interface BookLevel {
  price: number;
  qty: number;
  total: number;
  depth: number; // 0–100 percentage for depth bar
}

interface BookSnapshot {
  bids: BookLevel[];
  asks: BookLevel[];
  spread: number;
  spreadPct: number;
  source?: "rust" | "simulated";
}

type ConnectionStatus = "connecting" | "connected" | "disconnected" | "error";

interface Props {
  symbol: string;
  /** Maximum levels to display per side (default 10) */
  maxLevels?: number;
  className?: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmtPrice(p: number): string {
  if (p >= 10000) return p.toLocaleString(undefined, { maximumFractionDigits: 0 });
  if (p >= 100)   return p.toLocaleString(undefined, { maximumFractionDigits: 2 });
  if (p >= 1)     return p.toLocaleString(undefined, { maximumFractionDigits: 4 });
  return p.toLocaleString(undefined, { maximumFractionDigits: 6 });
}

function fmtQty(q: number): string {
  if (q >= 1_000_000) return `${(q / 1_000_000).toFixed(2)}M`;
  if (q >= 1_000)     return `${(q / 1_000).toFixed(2)}K`;
  return q.toLocaleString(undefined, { maximumFractionDigits: 4 });
}

// ── D3 Depth Curve ────────────────────────────────────────────────────────────
interface DepthChartProps {
  bids: BookLevel[];
  asks: BookLevel[];
}

function DepthCurve({ bids, asks }: DepthChartProps) {
  const svgRef = useRef<SVGSVGElement | null>(null);

  useEffect(() => {
    if (!svgRef.current || bids.length === 0 || asks.length === 0) return;

    const svg = d3.select(svgRef.current);
    const { width, height } = svgRef.current.getBoundingClientRect();
    if (width === 0 || height === 0) return;

    const margin = { top: 6, right: 8, bottom: 18, left: 8 };
    const innerW = width - margin.left - margin.right;
    const innerH = height - margin.top - margin.bottom;

    // Build cumulative bid data (sorted descending by price → ascending for chart)
    // bids[0] is best bid (highest price), bids[n] is worst bid
    const bidData = [...bids]
      .sort((a, b) => b.price - a.price) // best → worst
      .reduce<{ price: number; cumQty: number }[]>((acc, lvl) => {
        const prev = acc.length > 0 ? acc[acc.length - 1].cumQty : 0;
        acc.push({ price: lvl.price, cumQty: prev + lvl.qty });
        return acc;
      }, []);

    // asks[0] is best ask (lowest price), asks[n] is worst ask
    const askData = [...asks]
      .sort((a, b) => a.price - b.price) // best → worst
      .reduce<{ price: number; cumQty: number }[]>((acc, lvl) => {
        const prev = acc.length > 0 ? acc[acc.length - 1].cumQty : 0;
        acc.push({ price: lvl.price, cumQty: prev + lvl.qty });
        return acc;
      }, []);

    const allPrices = [...bidData.map(d => d.price), ...askData.map(d => d.price)];
    const allQtys   = [...bidData.map(d => d.cumQty), ...askData.map(d => d.cumQty)];

    const xScale = d3.scaleLinear()
      .domain([d3.min(allPrices)! * 0.999, d3.max(allPrices)! * 1.001])
      .range([0, innerW]);

    const yScale = d3.scaleLinear()
      .domain([0, d3.max(allQtys)! * 1.05])
      .range([innerH, 0]);

    // Clear previous render
    svg.selectAll("*").remove();

    const g = svg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);

    // ── Bid area (green) ──
    const bidArea = d3.area<{ price: number; cumQty: number }>()
      .x(d => xScale(d.price))
      .y0(innerH)
      .y1(d => yScale(d.cumQty))
      .curve(d3.curveStepAfter);

    const bidLine = d3.line<{ price: number; cumQty: number }>()
      .x(d => xScale(d.price))
      .y(d => yScale(d.cumQty))
      .curve(d3.curveStepAfter);

    // Bid area fill
    g.append("path")
      .datum(bidData)
      .attr("fill", "rgba(16, 185, 129, 0.12)")
      .attr("d", bidArea);

    // Bid line
    g.append("path")
      .datum(bidData)
      .attr("fill", "none")
      .attr("stroke", "rgba(16, 185, 129, 0.7)")
      .attr("stroke-width", 1.5)
      .attr("d", bidLine);

    // ── Ask area (red) ──
    const askArea = d3.area<{ price: number; cumQty: number }>()
      .x(d => xScale(d.price))
      .y0(innerH)
      .y1(d => yScale(d.cumQty))
      .curve(d3.curveStepBefore);

    const askLine = d3.line<{ price: number; cumQty: number }>()
      .x(d => xScale(d.price))
      .y(d => yScale(d.cumQty))
      .curve(d3.curveStepBefore);

    // Ask area fill
    g.append("path")
      .datum(askData)
      .attr("fill", "rgba(239, 68, 68, 0.12)")
      .attr("d", askArea);

    // Ask line
    g.append("path")
      .datum(askData)
      .attr("fill", "none")
      .attr("stroke", "rgba(239, 68, 68, 0.7)")
      .attr("stroke-width", 1.5)
      .attr("d", askLine);

    // ── Mid-price vertical line ──
    const midPrice = (bidData[0]?.price + askData[0]?.price) / 2;
    if (!isNaN(midPrice)) {
      g.append("line")
        .attr("x1", xScale(midPrice))
        .attr("x2", xScale(midPrice))
        .attr("y1", 0)
        .attr("y2", innerH)
        .attr("stroke", "rgba(255,255,255,0.15)")
        .attr("stroke-dasharray", "3,3")
        .attr("stroke-width", 1);
    }

    // ── X-axis tick labels (3 ticks) ──
    const xAxis = d3.axisBottom(xScale)
      .ticks(3)
      .tickFormat(d => fmtPrice(d as number))
      .tickSize(3);

    g.append("g")
      .attr("transform", `translate(0,${innerH})`)
      .call(xAxis)
      .call(ax => {
        ax.select(".domain").remove();
        ax.selectAll(".tick line").attr("stroke", "rgba(255,255,255,0.1)");
        ax.selectAll(".tick text")
          .attr("fill", "rgba(156,163,175,0.8)")
          .attr("font-size", "9px");
      });

  }, [bids, asks]);

  return (
    <svg
      ref={svgRef}
      className="w-full"
      style={{ height: 88 }}
      aria-label="Cumulative order book depth curve"
    />
  );
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function OrderBookDepthPanel({ symbol, maxLevels = 10, className = "" }: Props) {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  const [book, setBook] = useState<BookSnapshot | null>(null);
  const [midPrice, setMidPrice] = useState<number | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>("connecting");
  const [reconnectCount, setReconnectCount] = useState(0);

  const connect = useCallback(() => {
    if (!mountedRef.current) return;

    // Clean up existing connection
    if (wsRef.current) {
      wsRef.current.onclose = null;
      wsRef.current.onerror = null;
      wsRef.current.onmessage = null;
      wsRef.current.close();
      wsRef.current = null;
    }

    setStatus("connecting");

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}/ws/orderbook`;

    try {
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        if (!mountedRef.current) return;
        setStatus("connected");
        setReconnectCount(0);
        ws.send(JSON.stringify({ type: "subscribe", symbols: [symbol] }));
      };

      ws.onmessage = (event) => {
        if (!mountedRef.current) return;
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === "tick" && msg.symbol === symbol) {
            setMidPrice(msg.price);
          } else if (msg.type === "book" && msg.symbol === symbol) {
            setBook({
              bids: (msg.bids as BookLevel[]).slice(0, maxLevels),
              asks: (msg.asks as BookLevel[]).slice(0, maxLevels),
              spread: msg.spread,
              spreadPct: msg.spreadPct,
              source: msg.source,
            });
          }
        } catch {
          // ignore malformed frames
        }
      };

      ws.onerror = () => {
        if (!mountedRef.current) return;
        setStatus("error");
      };

      ws.onclose = () => {
        if (!mountedRef.current) return;
        setStatus("disconnected");
        wsRef.current = null;
        // Exponential back-off reconnect (max 30s)
        const delay = Math.min(1000 * 2 ** reconnectCount, 30_000);
        reconnectTimerRef.current = setTimeout(() => {
          setReconnectCount(c => c + 1);
          connect();
        }, delay);
      };
    } catch {
      setStatus("error");
    }
  }, [symbol, maxLevels, reconnectCount]);

  // Connect on mount and when symbol changes
  useEffect(() => {
    mountedRef.current = true;
    connect();
    return () => {
      mountedRef.current = false;
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      if (wsRef.current) {
        wsRef.current.onclose = null;
        wsRef.current.close();
        wsRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol]);

  // ── Render ──────────────────────────────────────────────────────────────────
  const statusColor: Record<ConnectionStatus, string> = {
    connecting:   "bg-amber-500/20 text-amber-400 border-amber-500/30",
    connected:    "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
    disconnected: "bg-gray-500/20 text-muted-foreground border-gray-500/30",
    error:        "bg-red-500/20 text-red-400 border-red-500/30",
  };

  const statusLabel: Record<ConnectionStatus, string> = {
    connecting:   "Connecting…",
    connected:    "Live",
    disconnected: "Reconnecting…",
    error:        "Error",
  };

  return (
    <div className={`bg-background border border-border rounded-xl overflow-hidden ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 bg-card/60 border-b border-border">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
            Order Book
          </span>
          <span className="text-xs text-muted-foreground">{symbol}</span>
        </div>
        <div className="flex items-center gap-2">
          {book?.source === "simulated" && (
            <span className="text-[10px] text-gray-600">sim</span>
          )}
          <Badge
            variant="outline"
            className={`text-[10px] px-1.5 py-0.5 flex items-center gap-1 ${statusColor[status]}`}
          >
            {status === "connected" ? (
              <Wifi className="w-2.5 h-2.5" />
            ) : status === "connecting" || status === "disconnected" ? (
              <RefreshCw className="w-2.5 h-2.5 animate-spin" />
            ) : (
              <WifiOff className="w-2.5 h-2.5" />
            )}
            {statusLabel[status]}
          </Badge>
        </div>
      </div>

      {/* Column headers */}
      <div className="grid grid-cols-3 px-3 py-1.5 text-[10px] text-gray-600 uppercase tracking-wide border-b border-gray-900">
        <span>Price</span>
        <span className="text-center">Qty</span>
        <span className="text-right">Total</span>
      </div>

      {!book ? (
        <div className="flex items-center justify-center py-8 text-xs text-gray-600">
          {status === "connecting" ? "Connecting to order book…" : "Waiting for data…"}
        </div>
      ) : (
        <>
          {/* ── Ask side (sell orders, displayed top-to-bottom = worst to best) ── */}
          <div className="divide-y divide-gray-900/50">
            {[...book.asks].reverse().map((level, i) => (
              <div key={`ask-${i}`} className="relative grid grid-cols-3 px-3 py-1 text-xs">
                {/* Depth bar (right-aligned, red) */}
                <div
                  className="absolute inset-y-0 right-0 bg-red-500/8 pointer-events-none"
                  style={{ width: `${level.depth}%` }}
                />
                <span className="text-red-400 font-mono z-10">{fmtPrice(level.price)}</span>
                <span className="text-muted-foreground font-mono text-center z-10">{fmtQty(level.qty)}</span>
                <span className="text-muted-foreground font-mono text-right z-10">{fmtQty(level.total)}</span>
              </div>
            ))}
          </div>

          {/* ── Spread row ── */}
          <div className="flex items-center justify-between px-3 py-1.5 bg-card/40 border-y border-border">
            <span className="text-[10px] text-muted-foreground">Spread</span>
            <span className="text-[10px] font-mono text-muted-foreground">
              {fmtPrice(book.spread)} ({book.spreadPct.toFixed(3)}%)
            </span>
            {midPrice != null && (
              <span className="text-xs font-semibold font-mono text-white">
                {fmtPrice(midPrice)}
              </span>
            )}
          </div>

          {/* ── Bid side (buy orders, best bid at top) ── */}
          <div className="divide-y divide-gray-900/50">
            {book.bids.map((level, i) => (
              <div key={`bid-${i}`} className="relative grid grid-cols-3 px-3 py-1 text-xs">
                {/* Depth bar (right-aligned, green) */}
                <div
                  className="absolute inset-y-0 right-0 bg-emerald-500/8 pointer-events-none"
                  style={{ width: `${level.depth}%` }}
                />
                <span className="text-emerald-400 font-mono z-10">{fmtPrice(level.price)}</span>
                <span className="text-muted-foreground font-mono text-center z-10">{fmtQty(level.qty)}</span>
                <span className="text-muted-foreground font-mono text-right z-10">{fmtQty(level.total)}</span>
              </div>
            ))}
          </div>

          {/* ── D3 Cumulative Depth Curve ── */}
          <div className="border-t border-border px-1 pt-1 pb-0.5 bg-background">
            <div className="text-[9px] text-gray-600 uppercase tracking-wide px-2 mb-0.5">
              Depth
            </div>
            <DepthCurve bids={book.bids} asks={book.asks} />
          </div>
        </>
      )}
    </div>
  );
}
