/**
 * NEXCOM Exchange — OrderBookDepthChart
 *
 * Renders a bid/ask market depth chart using lightweight-charts.
 * Two area series are drawn: green for cumulative bid depth (left of mid)
 * and red for cumulative ask depth (right of mid), giving traders an
 * immediate visual read of liquidity at each price level.
 *
 * Props:
 *   book     — OrderBook from useOrderBook hook
 *   height   — chart height in px (default 140)
 */
import { useEffect, useRef } from "react";
import {
  createChart,
  ColorType,
  LineStyle,
  AreaSeries,
  CrosshairMode,
} from "lightweight-charts";
import type { IChartApi, ISeriesApi, AreaData, Time } from "lightweight-charts";
import type { OrderBook } from "@/hooks/useOrderBook";

interface Props {
  book: OrderBook;
  height?: number;
}

export default function OrderBookDepthChart({ book, height = 140 }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const bidSeriesRef = useRef<ISeriesApi<"Area"> | null>(null);
  const askSeriesRef = useRef<ISeriesApi<"Area"> | null>(null);

  // Build chart once on mount
  useEffect(() => {
    if (!containerRef.current) return;

    const chart = createChart(containerRef.current, {
      width: containerRef.current.clientWidth,
      height,
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: "rgba(156,163,175,0.7)",
        fontFamily: "'Inter', sans-serif",
        fontSize: 9,
      },
      grid: {
        vertLines: { visible: false },
        horzLines: { color: "rgba(255,255,255,0.03)" },
      },
      rightPriceScale: {
        borderVisible: false,
        scaleMargins: { top: 0.05, bottom: 0.05 },
        visible: false,
      },
      leftPriceScale: {
        borderVisible: false,
        visible: false,
      },
      timeScale: {
        borderVisible: false,
        visible: true,
        tickMarkFormatter: (val: number) => val.toFixed(4),
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: "rgba(99,102,241,0.4)", labelBackgroundColor: "#4f46e5" },
        horzLine: { visible: false },
      },
      handleScroll: false,
      handleScale: false,
    });

    // Bid area series (green)
    const bidSeries = chart.addSeries(AreaSeries, {
      lineColor: "rgba(34,197,94,0.9)",
      topColor: "rgba(34,197,94,0.25)",
      bottomColor: "rgba(34,197,94,0.02)",
      lineWidth: 1,
      lineStyle: LineStyle.Solid,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
    });

    // Ask area series (red)
    const askSeries = chart.addSeries(AreaSeries, {
      lineColor: "rgba(239,68,68,0.9)",
      topColor: "rgba(239,68,68,0.25)",
      bottomColor: "rgba(239,68,68,0.02)",
      lineWidth: 1,
      lineStyle: LineStyle.Solid,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
    });

    chartRef.current = chart;
    bidSeriesRef.current = bidSeries;
    askSeriesRef.current = askSeries;

    const ro = new ResizeObserver(() => {
      if (containerRef.current) chart.resize(containerRef.current.clientWidth, height);
    });
    ro.observe(containerRef.current);

    return () => {
      ro.disconnect();
      chart.remove();
      chartRef.current = null;
      bidSeriesRef.current = null;
      askSeriesRef.current = null;
    };
  }, [height]);

  // Update data whenever the order book ticks
  useEffect(() => {
    if (!bidSeriesRef.current || !askSeriesRef.current || !chartRef.current) return;

    // Bids: sorted ascending by price for the chart (lowest price → smallest cumulative qty)
    const sortedBids = [...book.bids].sort((a, b) => a.price - b.price);
    // Asks: sorted ascending by price (lowest ask first)
    const sortedAsks = [...book.asks].sort((a, b) => a.price - b.price);

    // Use price as the "time" axis (lightweight-charts expects monotonically increasing time)
    const bidData: AreaData[] = sortedBids.map(level => ({
      time: level.price as unknown as Time,
      value: level.total,
    }));

    const askData: AreaData[] = sortedAsks.map(level => ({
      time: level.price as unknown as Time,
      value: level.total,
    }));

    if (bidData.length > 0) bidSeriesRef.current.setData(bidData);
    if (askData.length > 0) askSeriesRef.current.setData(askData);
    chartRef.current.timeScale().fitContent();
  }, [book]);

  return (
    <div className="rounded-lg bg-card/40 border border-border/50 overflow-hidden">
      <div className="flex items-center justify-between px-3 pt-2 pb-1">
        <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">
          Depth Chart
        </span>
        <div className="flex items-center gap-3 text-[10px]">
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-positive inline-block" />
            Bids
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-negative inline-block" />
            Asks
          </span>
        </div>
      </div>
      <div ref={containerRef} style={{ height }} />
    </div>
  );
}
