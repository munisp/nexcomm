/**
 * NEXCOM Exchange — PortfolioPnLChart
 *
 * Renders a 30-day portfolio equity curve using lightweight-charts.
 * Data comes from trpc.portfolio.history which returns daily snapshots
 * (or synthetic history when no real snapshots exist yet).
 */
import { useEffect, useRef } from "react";
import { createChart, ColorType, LineStyle, LineSeries } from "lightweight-charts";
import type { IChartApi, ISeriesApi, LineData, Time } from "lightweight-charts";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { TrendingUp, TrendingDown, Activity } from "lucide-react";

interface Props {
  /** Number of days to display (default 30) */
  days?: number;
  /** Height of the chart container in pixels (default 180) */
  height?: number;
}

export default function PortfolioPnLChart({ days = 30, height = 180 }: Props) {
  const { isAuthenticated } = useAuth();
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Line"> | null>(null);

  const { data: history = [], isLoading } = trpc.portfolio.history.useQuery(
    { days },
    { enabled: isAuthenticated, staleTime: 60_000 }
  );

  // Compute summary stats
  const first = history[0]?.totalValue ?? 0;
  const last = history[history.length - 1]?.totalValue ?? 0;
  const change = last - first;
  const changePct = first > 0 ? (change / first) * 100 : 0;
  const isPositive = change >= 0;

  // Build chart on mount
  useEffect(() => {
    if (!containerRef.current) return;

    const chart = createChart(containerRef.current, {
      width: containerRef.current.clientWidth,
      height,
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: "rgba(156,163,175,0.8)",
        fontFamily: "'Inter', sans-serif",
        fontSize: 10,
      },
      grid: {
        vertLines: { visible: false },
        horzLines: { color: "rgba(255,255,255,0.04)" },
      },
      rightPriceScale: {
        borderVisible: false,
        scaleMargins: { top: 0.1, bottom: 0.1 },
      },
      timeScale: {
        borderVisible: false,
      },
      crosshair: {
        vertLine: { color: "rgba(99,102,241,0.4)", labelBackgroundColor: "#4f46e5" },
        horzLine: { color: "rgba(99,102,241,0.4)", labelBackgroundColor: "#4f46e5" },
      },
      handleScroll: false,
      handleScale: false,
    });

    const series = chart.addSeries(LineSeries, {
      color: "#22c55e",
      lineWidth: 2,
      lineStyle: LineStyle.Solid,
      crosshairMarkerVisible: true,
      crosshairMarkerRadius: 4,
      priceLineVisible: false,
      lastValueVisible: false,
    });

    chartRef.current = chart;
    seriesRef.current = series;

    // Resize observer
    const ro = new ResizeObserver(() => {
      if (containerRef.current) chart.resize(containerRef.current.clientWidth, height);
    });
    ro.observe(containerRef.current);

    return () => {
      ro.disconnect();
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, [height]);

  // Update series color when sign changes
  useEffect(() => {
    if (!seriesRef.current) return;
    seriesRef.current.applyOptions({
      color: isPositive ? "#22c55e" : "#ef4444",
    });
  }, [isPositive]);

  // Update data when history loads
  useEffect(() => {
    if (!seriesRef.current || history.length === 0) return;
    const lineData: LineData[] = history.map(pt => ({
      time: (new Date(pt.date).getTime() / 1000) as Time,
      value: pt.totalValue,
    }));
    seriesRef.current.setData(lineData);
    chartRef.current?.timeScale().fitContent();
  }, [history]);

  if (!isAuthenticated) return null;

  return (
    <div className="rounded-xl border border-border bg-card/60 p-4 space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Activity className="w-4 h-4 text-primary" />
          <span className="text-sm font-semibold text-foreground">Portfolio P&amp;L</span>
          <span className="text-xs text-muted-foreground">{days}d</span>
        </div>
        {!isLoading && history.length > 0 && (
          <div className={`flex items-center gap-1 text-sm font-semibold ${isPositive ? "text-positive" : "text-negative"}`}>
            {isPositive ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
            {isPositive ? "+" : ""}{changePct.toFixed(2)}%
            <span className="text-xs font-normal text-muted-foreground ml-1">
              ({isPositive ? "+" : ""}{change.toLocaleString(undefined, { maximumFractionDigits: 0 })})
            </span>
          </div>
        )}
      </div>

      {/* Chart */}
      {isLoading ? (
        <div className="flex items-center justify-center" style={{ height }}>
          <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      ) : history.length === 0 ? (
        <div className="flex items-center justify-center text-muted-foreground text-sm" style={{ height }}>
          No portfolio history yet. Place your first trade to start tracking.
        </div>
      ) : (
        <div ref={containerRef} style={{ height }} />
      )}

      {/* Footer: current value */}
      {!isLoading && last > 0 && (
        <div className="flex items-center justify-between text-xs text-muted-foreground border-t border-border pt-2">
          <span>Current value</span>
          <span className="font-mono font-semibold text-foreground">
            ₦{last.toLocaleString(undefined, { maximumFractionDigits: 0 })}
          </span>
        </div>
      )}
    </div>
  );
}
