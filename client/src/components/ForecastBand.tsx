/**
 * NEXCOM — ForecastBand (INNOV-A / Innovation 2)
 *
 * Historical closes (real data from commodities.priceHistory — may honestly be
 * empty when no durable OHLCV source is configured) + ML forecast path with a
 * shaded 95% confidence band from forecast.getBand (ml-platform model outputs).
 *
 * States are honest: cold/unavailable panels instead of fabricated charts.
 * Colors are low-saturation slate/teal per the design tokens.
 *
 * PERF-CLIENT: component is wrapped in React.memo (parents like
 * CommodityForecast re-render on every ticker tick) and all static chart
 * config (margins, tick styles, formatters) is hoisted to module scope so
 * recharts props stay referentially stable across renders.
 */
import { memo, useMemo, type ReactNode } from "react";
import { trpc } from "@/lib/trpc";
import { useConnectionQuality } from "@/lib/connectionQuality";
import { tunedStaleTime } from "@/lib/queryTuning";
import { Badge } from "@/components/ui/badge";
import { Loader2, CloudOff, TrendingUp } from "lucide-react";
import {
  ComposedChart,
  Line,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  ReferenceDot,
  CartesianGrid,
} from "recharts";
import type { Formatter, ValueType, NameType } from "recharts/types/component/DefaultTooltipContent";

interface ForecastBandProps {
  symbol: string;
  horizonDays: number;
  height?: number;
}

interface ChartRow {
  label: string;
  close?: number;
  expected?: number;
  lo?: number;
  band?: number; // hi - lo, stacked on lo for the shaded band
}

const COLORS = {
  history: "#475569", // slate-600
  forecast: "#0f766e", // teal-700
  band: "#0f766e", // teal-700 at low opacity
  grid: "#e2e8f0", // slate-200
};

// PERF-CLIENT: static recharts config hoisted out of the render path —
// inline object/function literals made every recharts prop a new reference on
// every render, defeating memoisation inside recharts' own SVG layer.
const CHART_MARGIN = { top: 8, right: 12, bottom: 4, left: 4 } as const;
const AXIS_TICK = { fontSize: 11, fill: "#64748b" } as const;
const TOOLTIP_LABEL_STYLE = { fontSize: 12 } as const;
const yTickFormatter = (v: number) =>
  v.toLocaleString(undefined, { maximumFractionDigits: 0 });
const tooltipFormatter: Formatter<ValueType, NameType> = (value, name) => {
  // The "band" series is the invisible stacked base of the confidence interval —
  // hide it from the tooltip entirely (recharts accepts [null, null] at runtime).
  if (name === "band" || value == null || typeof value !== "number") {
    return [null, null] as unknown as [ReactNode, NameType];
  }
  return [value.toLocaleString(undefined, { maximumFractionDigits: 2 }), name];
};

function ForecastBand({ symbol, horizonDays, height = 320 }: ForecastBandProps) {
  // OFFLINE-RES: staleTime stretches ×4 on slow links so symbol switches and
  // remounts don't re-trigger fetches a metered connection can't afford.
  const { quality: connQuality } = useConnectionQuality();
  const historyQuery = trpc.commodities.priceHistory.useQuery(
    { symbol, days: 90 },
    { staleTime: tunedStaleTime(60_000, connQuality), retry: 1 },
  );
  const bandQuery = trpc.forecast.getBand.useQuery(
    { commodity: symbol, horizonDays },
    { staleTime: tunedStaleTime(60_000, connQuality), retry: 0 },
  );

  const rows = useMemo<ChartRow[]>(() => {
    const out: ChartRow[] = [];
    const history = historyQuery.data;
    if (history && history.bars.length > 0) {
      for (const bar of history.bars) {
        out.push({
          label: new Date(bar.time).toLocaleDateString(undefined, { month: "short", day: "numeric" }),
          close: bar.close,
        });
      }
    }
    if (bandQuery.data?.status === "OK") {
      for (const p of bandQuery.data.band) {
        const label = p.day === 0 ? "now" : `+${p.day}d`;
        // Merge day-0 anchor onto the last history row when possible.
        if (p.day === 0 && out.length > 0) {
          out[out.length - 1].expected = p.expected;
          out[out.length - 1].lo = p.lo;
          out[out.length - 1].band = p.hi - p.lo;
        } else {
          out.push({ label, expected: p.expected, lo: p.lo, band: p.hi - p.lo });
        }
      }
    }
    return out;
  }, [historyQuery.data, bandQuery.data]);

  if (historyQuery.isLoading || bandQuery.isLoading) {
    return (
      <div className="flex items-center justify-center text-slate-500" style={{ height }}>
        <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading chart data…
      </div>
    );
  }

  const bandUnavailable = !bandQuery.data || bandQuery.data.status !== "OK";
  const historyEmpty = !historyQuery.data || historyQuery.data.bars.length === 0;
  const lastClose = historyQuery.data?.livePrice?.price ?? null;

  // Honest cold state: no forecast AND no history → nothing to draw.
  if (bandUnavailable && historyEmpty) {
    return (
      <div
        className="flex flex-col items-center justify-center gap-2 rounded-md border border-slate-200 bg-slate-50 text-slate-500"
        style={{ height }}
      >
        <CloudOff className="h-6 w-6" />
        <p className="text-sm font-medium">Forecast unavailable for {symbol}</p>
        <p className="max-w-md text-center text-xs">
          {bandQuery.data?.status === "UNAVAILABLE"
            ? bandQuery.data.reason
            : "No forecast or historical data is available yet."}
        </p>
      </div>
    );
  }

  return (
    <div className="w-full">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <Badge variant="outline" className="border-slate-300 text-slate-600">
          MODEL {bandQuery.data?.status === "OK" ? bandQuery.data.modelVersion : "—"}
        </Badge>
        {historyEmpty && lastClose != null && (
          <Badge variant="outline" className="border-amber-300 text-amber-700">
            History unavailable — anchored at last close ₦{lastClose.toLocaleString()}
          </Badge>
        )}
        {bandUnavailable && (
          <Badge variant="outline" className="border-amber-300 text-amber-700">
            Forecast unavailable — showing history only
          </Badge>
        )}
      </div>

      <ResponsiveContainer width="100%" height={height}>
        <ComposedChart data={rows} margin={CHART_MARGIN}>
          <CartesianGrid stroke={COLORS.grid} strokeDasharray="3 3" />
          <XAxis dataKey="label" tick={AXIS_TICK} tickLine={false} />
          <YAxis
            tick={AXIS_TICK}
            tickLine={false}
            axisLine={false}
            domain={["auto", "auto"]}
            tickFormatter={yTickFormatter}
          />
          <Tooltip
            formatter={tooltipFormatter}
            labelStyle={TOOLTIP_LABEL_STYLE}
          />
          {/* Invisible base of the stacked band */}
          <Area dataKey="lo" stackId="ci" stroke="none" fill="transparent" isAnimationActive={false} name="lo" />
          {/* Shaded 95% confidence band */}
          <Area
            dataKey="band"
            stackId="ci"
            stroke="none"
            fill={COLORS.band}
            fillOpacity={0.12}
            isAnimationActive={false}
            name="95% CI"
          />
          <Line
            type="monotone"
            dataKey="close"
            stroke={COLORS.history}
            strokeWidth={1.5}
            dot={false}
            name="close"
            isAnimationActive={false}
          />
          <Line
            type="monotone"
            dataKey="expected"
            stroke={COLORS.forecast}
            strokeWidth={1.5}
            strokeDasharray="6 3"
            dot={false}
            name="expected"
            isAnimationActive={false}
          />
          {lastClose != null && rows.length > 0 && (
            <ReferenceDot
              x={rows[Math.max(0, rows.findIndex((r) => r.expected !== undefined))]?.label}
              y={lastClose}
              r={3}
              fill={COLORS.forecast}
              stroke="none"
            />
          )}
        </ComposedChart>
      </ResponsiveContainer>

      <div className="mt-1 flex items-center gap-3 text-[11px] text-slate-500">
        <span className="inline-flex items-center gap-1">
          <span className="inline-block h-0.5 w-4" style={{ background: COLORS.history }} /> history
        </span>
        <span className="inline-flex items-center gap-1">
          <TrendingUp className="h-3 w-3" style={{ color: COLORS.forecast }} /> expected path
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="inline-block h-2 w-4 rounded-sm" style={{ background: COLORS.band, opacity: 0.2 }} /> 95% band
        </span>
      </div>
    </div>
  );
}

export default memo(ForecastBand);
