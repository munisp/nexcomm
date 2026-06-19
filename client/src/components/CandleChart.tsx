/**
 * CandleChart — OHLCV candlestick chart with real-time WebSocket streaming
 * and a secondary volume-bar axis.
 *
 * Layout:
 *   - Top 70 %: price candle bodies (floating bar) + wick plugin
 *   - Bottom 30 %: volume bars on a secondary y-axis (yVol)
 *
 * Fetches historical candles from GET /api/v2/candles/:symbol?interval=1m&limit=60
 * then subscribes to the /ws/orderbook WebSocket to receive live "tick" messages.
 * Each tick updates the current (latest) candle's close, high, low, and volume.
 */

import { useEffect, useRef, useState, useCallback } from "react";
import {
  Chart,
  BarController,
  BarElement,
  LineController,
  LineElement,
  PointElement,
  CategoryScale,
  LinearScale,
  Tooltip,
  Legend,
  type ChartConfiguration,
  type TooltipItem,
  type ChartDataset,
} from "chart.js";

Chart.register(BarController, BarElement, LineController, LineElement, PointElement, CategoryScale, LinearScale, Tooltip, Legend);

/** Compute a simple moving average over an array of numbers. Returns null for periods without enough data. */
function sma(data: number[], period: number): (number | null)[] {
  return data.map((_, i) => {
    if (i < period - 1) return null;
    const slice = data.slice(i - period + 1, i + 1);
    return slice.reduce((a, b) => a + b, 0) / period;
  });
}

interface Candle {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface CandleChartProps {
  symbol: string;
  interval?: string;
  limit?: number;
}

const INTERVALS = ["1m", "5m", "15m", "1h", "4h", "1d"];

type StreamStatus = "connecting" | "live" | "disconnected";

/** Read/write the preferred candle interval for a symbol from localStorage. */
function getStoredInterval(symbol: string, fallback: string): string {
  try {
    return localStorage.getItem(`nexcom:candle:interval:${symbol}`) ?? fallback;
  } catch {
    return fallback;
  }
}
function storeInterval(symbol: string, interval: string): void {
  try {
    localStorage.setItem(`nexcom:candle:interval:${symbol}`, interval);
  } catch { /* ignore quota errors */ }
}

export default function CandleChart({ symbol, interval: defaultInterval = "5m", limit = 60 }: CandleChartProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chartRef = useRef<Chart | null>(null);
  const [candles, setCandles] = useState<Candle[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Initialise from localStorage, falling back to the prop default
  const [interval, setIntervalVal] = useState<string>(() => getStoredInterval(symbol, defaultInterval));
  const [streamStatus, setStreamStatus] = useState<StreamStatus>("connecting");

  // WebSocket refs for streaming
  const wsRef = useRef<WebSocket | null>(null);
  const mountedRef = useRef(true);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Fetch historical candles ─────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    const url = `/api/v2/candles/${encodeURIComponent(symbol)}?interval=${interval}&limit=${limit}`;
    fetch(url, { credentials: "include" })
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        if (cancelled) return;
        const data: Candle[] = Array.isArray(json) ? json : (json.candles ?? []);
        setCandles(data);
      })
      .catch((err) => {
        if (!cancelled) setError(String(err?.message ?? "Failed to load candles"));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [symbol, interval, limit]);

  // ── WebSocket streaming — update latest candle on each tick ─────────────
  const connectWS = useCallback(() => {
    if (!mountedRef.current) return;
    if (wsRef.current) {
      wsRef.current.onclose = null;
      wsRef.current.onerror = null;
      wsRef.current.onmessage = null;
      wsRef.current.close();
      wsRef.current = null;
    }
    setStreamStatus("connecting");

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}/ws/orderbook`;
    try {
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        if (!mountedRef.current) return;
        setStreamStatus("live");
        ws.send(JSON.stringify({ type: "subscribe", symbols: [symbol] }));
      };

      ws.onmessage = (event) => {
        if (!mountedRef.current) return;
        try {
          const msg = JSON.parse(event.data as string);
          if (msg.type === "tick" && msg.symbol === symbol) {
            const price = Number(msg.price);
            if (!isFinite(price)) return;
            setCandles((prev) => {
              if (prev.length === 0) return prev;
              const last = { ...prev[prev.length - 1] };
              last.close = price;
              last.high = Math.max(last.high, price);
              last.low = Math.min(last.low, price);
              last.volume = last.volume + (Number(msg.volume) || 0);
              return [...prev.slice(0, -1), last];
            });
          }
        } catch {
          // ignore malformed messages
        }
      };

      ws.onclose = () => {
        if (!mountedRef.current) return;
        setStreamStatus("disconnected");
        reconnectTimerRef.current = setTimeout(connectWS, 3000);
      };

      ws.onerror = () => {
        ws.close();
      };
    } catch {
      setStreamStatus("disconnected");
      reconnectTimerRef.current = setTimeout(connectWS, 3000);
    }
  }, [symbol]);

  useEffect(() => {
    mountedRef.current = true;
    connectWS();
    return () => {
      mountedRef.current = false;
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      if (wsRef.current) {
        wsRef.current.onclose = null;
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [connectWS]);

  // ── Build / update Chart.js instance ────────────────────────────────────
  useEffect(() => {
    if (!canvasRef.current || loading || candles.length === 0) return;

    const labels = candles.map((c) => {
      const d = new Date(c.time);
      return isNaN(d.getTime()) ? c.time : d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    });

    const bodyColors = candles.map((c) =>
      c.close >= c.open ? "rgba(52,211,153,0.85)" : "rgba(248,113,113,0.85)"
    );
    const borderColors = candles.map((c) =>
      c.close >= c.open ? "rgba(52,211,153,1)" : "rgba(248,113,113,1)"
    );

    // Volume bar colours — slightly more transparent to distinguish from price bars
    const volColors = candles.map((c) =>
      c.close >= c.open ? "rgba(52,211,153,0.35)" : "rgba(248,113,113,0.35)"
    );
    const volBorderColors = candles.map((c) =>
      c.close >= c.open ? "rgba(52,211,153,0.6)" : "rgba(248,113,113,0.6)"
    );

    // Wick plugin — draws high/low lines on each price bar
    const wickPlugin = {
      id: "wickPlugin",
      afterDatasetsDraw(chart: Chart) {
        const { ctx, scales } = chart;
        const xScale = scales["x"];
        const yScale = scales["y"];
        if (!xScale || !yScale) return;
        ctx.save();
        candles.forEach((c, i) => {
          const xCenter = xScale.getPixelForValue(i);
          const yHigh = yScale.getPixelForValue(c.high);
          const yLow = yScale.getPixelForValue(c.low);
          ctx.beginPath();
          ctx.strokeStyle = c.close >= c.open ? "rgba(52,211,153,0.9)" : "rgba(248,113,113,0.9)";
          ctx.lineWidth = 1.5;
          ctx.moveTo(xCenter, yHigh);
          ctx.lineTo(xCenter, yLow);
          ctx.stroke();
        });
        ctx.restore();
      },
    };

    // Price candle dataset — floating bar [open, close] on primary y-axis
    const priceDataset: ChartDataset<"bar"> = {
      label: symbol,
      data: candles.map((c) => Math.abs(c.close - c.open)) as unknown as number[],
      backgroundColor: bodyColors,
      borderColor: borderColors,
      borderWidth: 1,
      borderRadius: 1,
      yAxisID: "y",
      // Stack price bars at the correct open position via base
      base: candles.map((c) => Math.min(c.open, c.close)) as unknown as number,
    };

    // Volume dataset — solid bar on secondary y-axis (yVol)
    const volumeDataset: ChartDataset<"bar"> = {
      label: "Volume",
      data: candles.map((c) => c.volume),
      backgroundColor: volColors,
      borderColor: volBorderColors,
      borderWidth: 1,
      borderRadius: 1,
      yAxisID: "yVol",
    };

    // Volume 20-period SMA line on the same yVol axis
    const volMa20 = sma(candles.map(c => c.volume), 20);
    const volMaDataset: ChartDataset<"line"> = {
      type: "line" as const,
      label: "Vol MA(20)",
      data: volMa20 as number[],
      borderColor: "rgba(251,191,36,0.85)",
      backgroundColor: "transparent",
      borderWidth: 1.5,
      pointRadius: 0,
      tension: 0.3,
      yAxisID: "yVol",
      spanGaps: false,
    };

    // Compute price range for y-axis padding
    const allPrices = candles.flatMap(c => [c.open, c.close, c.high, c.low]).filter(isFinite);
    const priceMin = allPrices.length ? Math.min(...allPrices) : 0;
    const priceMax = allPrices.length ? Math.max(...allPrices) : 1;
    const pricePad = (priceMax - priceMin) * 0.05;

    // Compute volume max for yVol — give volume bars the bottom 30 % of chart height
    const maxVol = Math.max(...candles.map(c => c.volume), 1);

    const config: ChartConfiguration<"bar"> = {
      type: "bar",
      data: {
        labels,
        datasets: [priceDataset, volumeDataset, volMaDataset as unknown as ChartDataset<"bar">],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        plugins: {
          tooltip: {
            mode: "index",
            intersect: false,
            callbacks: {
              title: (items: TooltipItem<"bar">[]) => {
                const i = items[0]?.dataIndex ?? 0;
                return labels[i] ?? "";
              },
              label: (item: TooltipItem<"bar">) => {
                if (item.datasetIndex === 1) {
                  const vol = candles[item.dataIndex]?.volume ?? 0;
                  return `Vol: ${vol.toLocaleString()}`;
                }
                if (item.datasetIndex === 2) {
                  const ma = volMa20[item.dataIndex];
                  return ma != null ? `Vol MA(20): ${ma.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : "";
                }
                const c = candles[item.dataIndex];
                if (!c) return "";
                return [
                  `O: ${c.open.toLocaleString()}`,
                  `H: ${c.high.toLocaleString()}`,
                  `L: ${c.low.toLocaleString()}`,
                  `C: ${c.close.toLocaleString()}`,
                ];
              },
            },
          },
          legend: {
            display: true,
            position: "top" as const,
            labels: {
              color: "#94a3b8",
              font: { size: 10 },
              boxWidth: 12,
              padding: 8,
              filter: (item) => item.datasetIndex !== 0, // hide price dataset from legend
            },
          },
        },
        scales: {
          x: {
            ticks: { color: "#94a3b8", font: { size: 10 }, maxTicksLimit: 10 },
            grid: { color: "rgba(148,163,184,0.06)" },
          },
          // Primary y-axis — price, occupies top 70 % of chart area
          y: {
            position: "right",
            ticks: { color: "#94a3b8", font: { size: 10 } },
            grid: { color: "rgba(148,163,184,0.08)" },
            min: priceMin - pricePad,
            max: priceMax + pricePad,
            // Push price axis up so volume bars appear in the bottom 30 %
            // by setting a large max on yVol that dwarfs the actual volume
            afterFit(scale) {
              scale.paddingBottom = 0;
            },
          },
          // Secondary y-axis — volume, hidden ticks, occupies bottom 30 %
          yVol: {
            position: "left",
            display: true,
            grid: { drawOnChartArea: false },
            ticks: {
              color: "#64748b",
              font: { size: 9 },
              maxTicksLimit: 3,
              callback: (v) => {
                const n = Number(v);
                if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
                if (n >= 1_000) return `${(n / 1_000).toFixed(0)}k`;
                return String(n);
              },
            },
            // Scale volume so bars fill only the bottom ~30 % of chart height:
            // set max to 3× the real max so bars only reach 1/3 of the axis range
            min: 0,
            max: maxVol * 3.5,
          },
        },
      },
      plugins: [wickPlugin as never],
    };

    if (chartRef.current) {
      chartRef.current.destroy();
    }
    chartRef.current = new Chart(canvasRef.current, config);

    return () => {
      chartRef.current?.destroy();
      chartRef.current = null;
    };
  }, [candles, loading, symbol]);

  // Stream status indicator colour
  const statusColor =
    streamStatus === "live" ? "bg-emerald-400" :
    streamStatus === "connecting" ? "bg-amber-400" :
    "bg-red-500";
  const statusLabel =
    streamStatus === "live" ? "Live" :
    streamStatus === "connecting" ? "Connecting…" :
    "Disconnected";

  return (
    <div className="bg-card/80 border border-border/50 rounded-lg p-3 space-y-2">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
            {symbol} — OHLCV
          </span>
          {/* Live stream indicator */}
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <span className={`inline-block w-1.5 h-1.5 rounded-full ${statusColor} ${streamStatus === "live" ? "animate-pulse" : ""}`} />
            {statusLabel}
          </span>
        </div>
        {/* Interval buttons */}
        <div className="flex gap-1">
          {INTERVALS.map((iv) => (
            <button
              key={iv}
              onClick={() => { setIntervalVal(iv); storeInterval(symbol, iv); }}
              className={`px-2 py-0.5 rounded text-xs font-mono transition-colors ${
                interval === iv
                  ? "bg-emerald-600 text-white"
                  : "bg-secondary text-muted-foreground hover:bg-muted"
              }`}
            >
              {iv}
            </button>
          ))}
        </div>
      </div>

      {/* Chart body — taller to accommodate volume bars */}
      <div style={{ height: 260 }}>
        {loading ? (
          <div className="h-full flex items-center justify-center text-xs text-muted-foreground animate-pulse">
            Loading candles…
          </div>
        ) : error ? (
          <div className="h-full flex items-center justify-center text-xs text-red-400">
            {error}
          </div>
        ) : candles.length === 0 ? (
          <div className="h-full flex items-center justify-center text-xs text-muted-foreground">
            No candle data available yet.
          </div>
        ) : (
          <canvas ref={canvasRef} />
        )}
      </div>

      {/* Volume legend hint */}
      {!loading && !error && candles.length > 0 && (
        <div className="flex items-center gap-3 text-xs text-muted-foreground pt-0.5 flex-wrap">
          <span className="flex items-center gap-1">
            <span className="inline-block w-2.5 h-2.5 rounded-sm bg-emerald-400/35 border border-emerald-400/60" />
            Bull vol
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block w-2.5 h-2.5 rounded-sm bg-red-400/35 border border-red-400/60" />
            Bear vol
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block w-6 h-0.5 bg-amber-400/85" />
            MA(20)
          </span>
          <span className="ml-auto text-gray-600">Vol axis (left) · Price axis (right)</span>
        </div>
      )}
    </div>
  );
}
