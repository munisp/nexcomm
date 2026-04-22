/**
 * GingerPriceHistory — 90-day GINGER-NG-SPOT price chart with volume bars,
 * grade specifications, and certified warehouse locations.
 *
 * Accessible from the Farmer Journey walkthrough page so farmers can
 * understand seasonal price patterns before placing their first sell order.
 */
import { useState, useEffect, useRef, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ArrowLeft,
  TrendingUp,
  TrendingDown,
  Minus,
  Warehouse,
  Award,
  Info,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import {
import { PageSkeleton } from "@/components/PageSkeleton";
  createChart,
  createSeriesMarkers,
  CandlestickSeries,
  HistogramSeries,
  LineSeries,
  ColorType,
  CrosshairMode,
  type IChartApi,
  type ISeriesApi,
  type CandlestickData,
  type HistogramData,
  type LineData,
  type Time,
  type SeriesMarker,
} from "lightweight-charts";

// ── Colour palette ────────────────────────────────────────────────────────────
const EMERALD = "#10b981";
const RED     = "#ef4444";
const AMBER   = "#f59e0b";
const SLATE   = "#94a3b8";

// Grade line colours (G1 split, G2 split, G1 whole, fresh)
const GRADE_COLORS = ["#10b981", "#f59e0b", "#60a5fa", "#f472b6"];

// ── Period selector ───────────────────────────────────────────────────────────
const PERIODS = [
  { label: "30D",  days: 30  },
  { label: "60D",  days: 60  },
  { label: "90D",  days: 90  },
  { label: "180D", days: 180 },
] as const;

// ── Price change helpers ──────────────────────────────────────────────────────
function pctChange(first: number, last: number) {
  return ((last - first) / first) * 100;
}

// ── Main component ────────────────────────────────────────────────────────────
export default function GingerPriceHistory() {
  const [, setLocation] = useLocation();
  const [symbol, setSymbol] = useState<"GINGER-NG-SPOT" | "GINGER-WHOLE-SPOT">("GINGER-NG-SPOT");
  const [days, setDays]     = useState<number>(90);
  const [showGrades, setShowGrades]       = useState(true);
  const [showWarehouses, setShowWarehouses] = useState(true);

  const [chartMode, setChartMode] = useState<"candle" | "grade">("candle");

  const chartContainerRef  = useRef<HTMLDivElement>(null);
  const gradeChartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef           = useRef<IChartApi | null>(null);
  const candleRef          = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volRef             = useRef<ISeriesApi<"Histogram"> | null>(null);
  const gradeChartRef      = useRef<IChartApi | null>(null);
  const gradeSeriesRefs    = useRef<ISeriesApi<"Line">[]>([]);

  // ── Data ──────────────────────────────────────────────────────────────────
  const { data: histData, isLoading } = trpc.commodities.priceHistory.useQuery(
    { symbol, days },
    { staleTime: 60_000 }
  );
  const { data: gingerInfo } = trpc.commodities.gingerInfo.useQuery(undefined, {
    staleTime: 300_000,
  });
  const { data: gradeData } = trpc.commodities.gradeSpread.useQuery(
    { symbol, days },
    { staleTime: 60_000 }
  );

  const bars = histData?.bars ?? [];
  const instrument = histData?.instrument;

  // ── Derived stats ─────────────────────────────────────────────────────────
  const stats = useMemo(() => {
    if (bars.length < 2) return null;
    const first = bars[0];
    const last  = bars[bars.length - 1];
    const highs = bars.map(b => b.high);
    const lows  = bars.map(b => b.low);
    const vols  = bars.map(b => b.volume);
    return {
      open:    first.open,
      close:   last.close,
      high:    Math.max(...highs),
      low:     Math.min(...lows),
      change:  last.close - first.open,
      changePct: pctChange(first.open, last.close),
      avgVol:  Math.round(vols.reduce((a, b) => a + b, 0) / vols.length),
      totalVol: vols.reduce((a, b) => a + b, 0),
    };
  }, [bars]);

  // ── Grade spread chart ───────────────────────────────────────────────────
  useEffect(() => {
    if (!gradeChartContainerRef.current || chartMode !== "grade") return;

    const chart = createChart(gradeChartContainerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: "#0f172a" },
        textColor:  SLATE,
      },
      grid: {
        vertLines: { color: "rgba(148,163,184,0.06)" },
        horzLines: { color: "rgba(148,163,184,0.06)" },
      },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: "rgba(148,163,184,0.15)" },
      timeScale: {
        borderColor:    "rgba(148,163,184,0.15)",
        timeVisible:    true,
        secondsVisible: false,
      },
      width:  gradeChartContainerRef.current.clientWidth,
      height: 340,
    });

    gradeChartRef.current    = chart;
    gradeSeriesRefs.current  = [];

    const ro = new ResizeObserver(entries => {
      const w = entries[0]?.contentRect.width;
      if (w) chart.applyOptions({ width: w });
    });
    ro.observe(gradeChartContainerRef.current);

    return () => {
      ro.disconnect();
      chart.remove();
      gradeChartRef.current   = null;
      gradeSeriesRefs.current = [];
    };
  }, [chartMode]);

  // ── Feed grade data into grade chart ─────────────────────────────────────
  useEffect(() => {
    if (!gradeChartRef.current || !gradeData?.grades?.length || chartMode !== "grade") return;

    // Remove old series
    gradeSeriesRefs.current.forEach(s => {
      try { gradeChartRef.current?.removeSeries(s); } catch { /* ignore */ }
    });
    gradeSeriesRefs.current = [];

    gradeData.grades.forEach((grade, idx) => {
      if (!gradeChartRef.current) return;
      const series = gradeChartRef.current.addSeries(LineSeries, {
        color:     GRADE_COLORS[idx % GRADE_COLORS.length],
        lineWidth: 2,
        title:     grade.name.replace("Nigeria ", ""),
      });
      const lineData: LineData[] = grade.bars.map(b => ({
        time:  (b.time / 1000) as Time,
        value: b.close,
      }));
      series.setData(lineData);
      gradeSeriesRefs.current.push(series);
    });

    gradeChartRef.current.timeScale().fitContent();
  }, [gradeData, chartMode]);

  // ── Candle chart init ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!chartContainerRef.current) return;

    const chart = createChart(chartContainerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: "#0f172a" },
        textColor:  SLATE,
      },
      grid: {
        vertLines:  { color: "rgba(148,163,184,0.06)" },
        horzLines:  { color: "rgba(148,163,184,0.06)" },
      },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: "rgba(148,163,184,0.15)" },
      timeScale: {
        borderColor:      "rgba(148,163,184,0.15)",
        timeVisible:      true,
        secondsVisible:   false,
      },
      width:  chartContainerRef.current.clientWidth,
      height: 340,
    });

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor:        EMERALD,
      downColor:      RED,
      borderUpColor:  EMERALD,
      borderDownColor: RED,
      wickUpColor:    EMERALD,
      wickDownColor:  RED,
    });

    const volSeries = chart.addSeries(HistogramSeries, {
      color:       "rgba(16,185,129,0.25)",
      priceFormat: { type: "volume" },
      priceScaleId: "volume",
    });
    chart.priceScale("volume").applyOptions({
      scaleMargins: { top: 0.85, bottom: 0 },
    });

    chartRef.current  = chart;
    candleRef.current = candleSeries;
    volRef.current    = volSeries;

    const ro = new ResizeObserver(entries => {
      const w = entries[0]?.contentRect.width;
      if (w) chart.applyOptions({ width: w });
    });
    ro.observe(chartContainerRef.current);

    return () => {
      ro.disconnect();
      chart.remove();
      chartRef.current  = null;
      candleRef.current = null;
      volRef.current    = null;
    };
  }, []);

  // ── Feed data into chart ──────────────────────────────────────────────────
  useEffect(() => {
    if (!candleRef.current || !volRef.current || bars.length === 0) return;

    const candles: CandlestickData[] = bars.map(b => ({
      time:  (b.time / 1000) as Time,
      open:  b.open,
      high:  b.high,
      low:   b.low,
      close: b.close,
    }));
    const volumes: HistogramData[] = bars.map(b => ({
      time:  (b.time / 1000) as Time,
      value: b.volume,
      color: b.close >= b.open
        ? "rgba(16,185,129,0.35)"
        : "rgba(239,68,68,0.35)",
    }));

    candleRef.current.setData(candles);
    volRef.current.setData(volumes);

    // ── Harvest season markers ──────────────────────────────────────────────
    // Nigerian ginger harvest: October–December (main season)
    // Post-harvest price trough: January–March
    // Price peak (supply tightens): May–July
    const markers: SeriesMarker<Time>[] = [];
    const seenMonths = new Set<string>();
    for (const b of bars) {
      const d = new Date(b.time);
      const month = d.getMonth(); // 0-indexed
      const yearMonth = `${d.getFullYear()}-${month}`;
      if (seenMonths.has(yearMonth)) continue;
      seenMonths.add(yearMonth);
      const t = (b.time / 1000) as Time;
      if (month === 9) { // October — harvest starts
        markers.push({ time: t, position: "aboveBar", color: "#f59e0b", shape: "arrowDown", text: "Harvest Begins" });
      } else if (month === 11) { // December — peak harvest
        markers.push({ time: t, position: "aboveBar", color: "#ef4444", shape: "arrowDown", text: "Peak Harvest" });
      } else if (month === 5) { // June — price peak
        markers.push({ time: t, position: "belowBar", color: "#10b981", shape: "arrowUp", text: "Price Peak" });
      }
    }
    if (markers.length > 0) {
      createSeriesMarkers(candleRef.current, markers);
    }

    chartRef.current?.timeScale().fitContent();
  }, [bars]);

  // ── Trend colour helper ───────────────────────────────────────────────────
  const trendColor = stats
    ? stats.changePct > 0 ? EMERALD : stats.changePct < 0 ? RED : SLATE
    : SLATE;

  const TrendIcon = stats
    ? stats.changePct > 0 ? TrendingUp : stats.changePct < 0 ? TrendingDown : Minus
    : Minus;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      {/* ── Top bar ─────────────────────────────────────────────────────── */}
      <div className="sticky top-0 z-30 bg-slate-950/95 backdrop-blur border-b border-slate-800">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-14 flex items-center gap-3">
          <button
            onClick={() => setLocation("/farmer-journey")}
            className="p-1.5 rounded-lg hover:bg-slate-800 transition-colors"
            aria-label="Back to Farmer Journey"
          >
            <ArrowLeft className="w-4 h-4 text-slate-400" />
          </button>
          <div className="flex items-center gap-2">
            <span className="text-lg font-bold text-emerald-400" style={{ fontFamily: "'DM Serif Display', serif" }}>
              NEXCOM
            </span>
            <span className="text-slate-500">/</span>
            <span className="text-sm font-medium text-slate-300">Ginger Price History</span>
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 space-y-6">

        {/* ── Header ──────────────────────────────────────────────────────── */}
        <div className="flex flex-col sm:flex-row sm:items-start gap-4">
          <div className="flex-1">
            {/* Symbol selector */}
            <div className="flex gap-2 mb-3">
              {(["GINGER-NG-SPOT", "GINGER-WHOLE-SPOT"] as const).map(s => (
                <button
                  key={s}
                  onClick={() => setSymbol(s)}
                  className={`px-3 py-1 rounded-full text-xs font-medium transition-all ${
                    symbol === s
                      ? "bg-emerald-500 text-white"
                      : "bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-white"
                  }`}
                >
                  {s === "GINGER-NG-SPOT" ? "Split Dry (GINGER-NG-SPOT)" : "Whole Dry (GINGER-WHOLE-SPOT)"}
                </button>
              ))}
            </div>

            <h1 className="text-2xl sm:text-3xl font-bold text-white">
              {instrument?.name ?? symbol}
            </h1>
            <p className="text-slate-400 text-sm mt-1">
              {instrument?.description} · Priced in {instrument?.currency ?? "USD"} per {instrument?.unit ?? "MT"}
            </p>
          </div>

          {/* Current price + change */}
          {stats && (
            <div className="flex flex-col items-end gap-1">
              <div className="text-3xl font-bold text-white tabular-nums">
                ${stats.close.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </div>
              <div className="flex items-center gap-1.5" style={{ color: trendColor }}>
                <TrendIcon className="w-4 h-4" />
                <span className="text-sm font-medium tabular-nums">
                  {stats.changePct >= 0 ? "+" : ""}{stats.changePct.toFixed(2)}%
                  ({stats.change >= 0 ? "+" : ""}${stats.change.toFixed(2)})
                </span>
              </div>
              <span className="text-xs text-slate-500">{days}-day performance</span>
            </div>
          )}
        </div>

        {/* ── Period selector ──────────────────────────────────────────────── */}
        <div className="flex gap-2">
          {PERIODS.map(p => (
            <button
              key={p.days}
              onClick={() => setDays(p.days)}
              className={`px-3 py-1 rounded text-xs font-medium transition-all ${
                days === p.days
                  ? "bg-emerald-600 text-white"
                  : "bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-white"
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>

        {/* ── Stats row ────────────────────────────────────────────────────── */}
        {stats && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: "Period High",   value: `$${stats.high.toLocaleString()}`,   color: EMERALD },
              { label: "Period Low",    value: `$${stats.low.toLocaleString()}`,    color: RED     },
              { label: "Avg Daily Vol", value: `${stats.avgVol.toLocaleString()} MT`, color: AMBER },
              { label: "Total Volume",  value: `${stats.totalVol.toLocaleString()} MT`, color: SLATE },
            ].map(s => (
              <div key={s.label} className="bg-slate-900 rounded-xl p-3 border border-slate-800">
                <div className="text-xs text-slate-500 mb-1">{s.label}</div>
                <div className="text-base font-bold tabular-nums" style={{ color: s.color }}>
                  {s.value}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ── Chart ────────────────────────────────────────────────────────── */}
        <div className="bg-slate-900 rounded-2xl border border-slate-800 overflow-hidden">
          <div className="px-4 pt-4 pb-2 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="text-sm font-medium text-slate-300">
                {chartMode === "candle" ? `Daily OHLCV — ${symbol}` : "Grade Price Spread"}
              </span>
              {/* Chart mode toggle */}
              <div className="flex rounded-lg overflow-hidden border border-slate-700 text-xs">
                <button
                  onClick={() => setChartMode("candle")}
                  className={`px-3 py-1 transition-colors ${
                    chartMode === "candle"
                      ? "bg-emerald-600 text-white"
                      : "bg-slate-800 text-slate-400 hover:bg-slate-700"
                  }`}
                >
                  OHLCV
                </button>
                <button
                  onClick={() => setChartMode("grade")}
                  className={`px-3 py-1 transition-colors ${
                    chartMode === "grade"
                      ? "bg-emerald-600 text-white"
                      : "bg-slate-800 text-slate-400 hover:bg-slate-700"
                  }`}
                >
                  Grade Spread
                </button>
              </div>
            </div>
            {isLoading && (
              <span className="text-xs text-slate-500 animate-pulse">Loading…</span>
            )}
          </div>

          {/* Candlestick chart */}
          <div ref={chartContainerRef} className={`w-full ${chartMode === "candle" ? "" : "hidden"}`} />
          {chartMode === "candle" && (
            <div className="px-4 pb-3 flex items-center gap-4 text-xs text-slate-600">
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-emerald-500 inline-block" /> Up day</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-red-500 inline-block" /> Down day</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-emerald-500/30 inline-block" /> Volume</span>
            </div>
          )}

          {/* Grade spread multi-line chart */}
          <div ref={gradeChartContainerRef} className={`w-full ${chartMode === "grade" ? "" : "hidden"}`} />
          {chartMode === "grade" && gradeData?.grades && (
            <div className="px-4 pb-3 flex flex-wrap items-center gap-4 text-xs text-slate-500">
              {gradeData.grades.map((g, idx) => (
                <span key={g.code} className="flex items-center gap-1.5">
                  <span
                    className="w-4 h-0.5 inline-block rounded"
                    style={{ backgroundColor: GRADE_COLORS[idx % GRADE_COLORS.length] }}
                  />
                  <span className="text-slate-400">{g.name.replace("Nigeria ", "")}</span>
                  <span className={g.premiumPct >= 0 ? "text-emerald-400" : "text-red-400"}>
                    ({g.premiumPct >= 0 ? "+" : ""}{g.premiumPct}%)
                  </span>
                </span>
              ))}
            </div>
          )}
        </div>

        {/* ── Seasonal insight ─────────────────────────────────────────────── */}
        <div className="bg-amber-950/30 border border-amber-800/40 rounded-xl p-4 flex gap-3">
          <Info className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
          <div className="text-sm text-amber-200/80">
            <strong className="text-amber-300">Seasonal pattern:</strong> Nigerian ginger (Kaduna/Bauchi origin)
            typically peaks in price between <strong>May–July</strong> as post-harvest supply tightens and
            export demand from India and China rises. Prices tend to soften in <strong>October–December</strong>
            when the new harvest arrives. Farmers who store Grade 1 split-dry ginger in certified warehouses
            and sell via NEXCOM during the peak window historically achieve 12–18% higher realisation
            than farmgate sales.
          </div>
        </div>

        {/* ── Grade specifications ─────────────────────────────────────────── */}
        <div className="bg-slate-900 rounded-2xl border border-slate-800">
          <button
            className="w-full flex items-center justify-between px-5 py-4 text-left"
            onClick={() => setShowGrades(v => !v)}
          >
            <div className="flex items-center gap-2">
              <Award className="w-4 h-4 text-emerald-400" />
              <span className="font-semibold text-slate-200">Grade Specifications</span>
            </div>
            {showGrades ? <ChevronUp className="w-4 h-4 text-slate-500" /> : <ChevronDown className="w-4 h-4 text-slate-500" />}
          </button>
          {showGrades && (
            <div className="px-5 pb-5">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-800 text-slate-500 text-xs uppercase tracking-wide">
                      <th className="text-left py-2 pr-4">Grade Code</th>
                      <th className="text-left py-2 pr-4">Name</th>
                      <th className="text-left py-2 pr-4">Description</th>
                      <th className="text-right py-2">Premium / Discount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(gingerInfo?.grades ?? []).map(g => (
                      <tr key={g.code} className="border-b border-slate-800/50 hover:bg-slate-800/30 transition-colors">
                        <td className="py-2.5 pr-4 font-mono text-emerald-400 text-xs">{g.code}</td>
                        <td className="py-2.5 pr-4 text-slate-300 font-medium">{g.name}</td>
                        <td className="py-2.5 pr-4 text-slate-500 text-xs max-w-xs">{g.description}</td>
                        <td className="py-2.5 text-right">
                          <Badge
                            variant="outline"
                            className={`text-xs ${
                              g.premiumPct > 0  ? "border-emerald-700 text-emerald-400" :
                              g.premiumPct < 0  ? "border-red-800 text-red-400" :
                                                  "border-slate-700 text-slate-400"
                            }`}
                          >
                            {g.premiumPct === 0 ? "Base" : `${g.premiumPct > 0 ? "+" : ""}${g.premiumPct}%`}
                          </Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        {/* ── Certified warehouses ─────────────────────────────────────────── */}
        <div className="bg-slate-900 rounded-2xl border border-slate-800">
          <button
            className="w-full flex items-center justify-between px-5 py-4 text-left"
            onClick={() => setShowWarehouses(v => !v)}
          >
            <div className="flex items-center gap-2">
              <Warehouse className="w-4 h-4 text-emerald-400" />
              <span className="font-semibold text-slate-200">Certified Ginger Warehouses</span>
            </div>
            {showWarehouses ? <ChevronUp className="w-4 h-4 text-slate-500" /> : <ChevronDown className="w-4 h-4 text-slate-500" />}
          </button>
          {showWarehouses && (
            <div className="px-5 pb-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {(gingerInfo?.warehouses ?? []).map(w => {
                const pctUsed = Math.round(((w.capacity - w.available) / w.capacity) * 100);
  if (isLoading) return <PageSkeleton cards={2} tableRows={10} tableCols={5} />;
                return (
                  <div key={w.id} className="bg-slate-800/60 rounded-xl p-4 border border-slate-700/50">
                    <div className="flex items-start justify-between mb-2">
                      <div>
                        <div className="font-medium text-slate-200 text-sm">{w.name}</div>
                        <div className="text-xs text-slate-500">{w.city}, {w.state}</div>
                      </div>
                      {w.certified && (
                        <Badge className="bg-emerald-900/60 text-emerald-400 border-emerald-800 text-xs">
                          Certified
                        </Badge>
                      )}
                    </div>
                    <div className="text-xs text-slate-500 mb-2">Manager: {w.manager}</div>
                    {/* Capacity bar */}
                    <div className="space-y-1">
                      <div className="flex justify-between text-xs text-slate-500">
                        <span>Capacity used</span>
                        <span>{pctUsed}%</span>
                      </div>
                      <div className="h-1.5 bg-slate-700 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full ${pctUsed > 80 ? "bg-red-500" : pctUsed > 60 ? "bg-amber-500" : "bg-emerald-500"}`}
                          style={{ width: `${pctUsed}%` }}
                        />
                      </div>
                      <div className="text-xs text-slate-600">
                        {w.available.toLocaleString()} MT available of {w.capacity.toLocaleString()} MT
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* ── CTA ──────────────────────────────────────────────────────────── */}
        <div className="bg-gradient-to-r from-emerald-950/60 to-slate-900/60 rounded-2xl border border-emerald-800/40 p-6 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div>
            <h3 className="font-bold text-white text-lg">Ready to sell your ginger?</h3>
            <p className="text-slate-400 text-sm mt-1">
              Deposit at a certified warehouse, receive an EWR, and place your sell order in under 5 minutes.
            </p>
          </div>
          <div className="flex gap-3 shrink-0">
            <Button
              variant="outline"
              className="border-emerald-700 text-emerald-400 hover:bg-emerald-900/40"
              onClick={() => setLocation("/farmer-journey")}
            >
              View Guide
            </Button>
            <Button
              className="bg-emerald-600 hover:bg-emerald-500 text-white"
              onClick={() => setLocation("/trade?symbol=GINGER-NG-SPOT")}
            >
              Trade Now
            </Button>
          </div>
        </div>

      </div>
    </div>
  );
}
