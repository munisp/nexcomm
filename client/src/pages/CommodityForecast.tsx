/**
 * NEXCOM — CommodityForecast page (INNOV-A / Innovation 2)
 *
 * Per-commodity ML forecast: instrument selector, horizon slider (1–30 days),
 * forecast band chart, plain-language summary, and attribution.
 * All numbers come from ml-platform via forecast.getForecast — nothing is
 * fabricated client-side; unavailable states render honestly.
 */
import { useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import ForecastBand from "@/components/ForecastBand";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import { CloudOff, Info, TrendingDown, TrendingUp } from "lucide-react";

function fmt(v: number): string {
  return v.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

export default function CommodityForecast() {
  const [symbol, setSymbol] = useState<string>("");
  const [horizon, setHorizon] = useState<number>(7);

  const commoditiesQuery = trpc.commodities.list.useQuery(undefined, { staleTime: 300_000 });
  const commodities = useMemo(() => commoditiesQuery.data ?? [], [commoditiesQuery.data]);

  // Default to the first commodity once the catalogue loads.
  const effectiveSymbol = symbol || commodities[0]?.symbol || "";

  const forecastQuery = trpc.forecast.getForecast.useQuery(
    { commodity: effectiveSymbol, horizonDays: horizon },
    { enabled: effectiveSymbol !== "", staleTime: 60_000, retry: 0 },
  );

  const selected = commodities.find((c) => c.symbol === effectiveSymbol);
  const f = forecastQuery.data?.status === "OK" ? forecastQuery.data.forecast : null;

  // Plain-language summary strictly from model outputs.
  const summary = useMemo(() => {
    if (!f || f.expectedPrice == null || !f.ci95 || f.lastClose == null) return null;
    const driftPct = ((f.expectedPrice - f.lastClose) / f.lastClose) * 100;
    const direction = driftPct > 0.5 ? "up" : driftPct < -0.5 ? "down" : "roughly flat";
    return {
      driftPct,
      direction,
      text:
        `${selected?.name ?? f.symbol} last closed at ${fmt(f.lastClose)}. ` +
        `Over the next ${horizon} day${horizon > 1 ? "s" : ""}, the model expects ${direction} movement ` +
        `(${driftPct >= 0 ? "+" : ""}${driftPct.toFixed(1)}%) to about ${fmt(f.expectedPrice)}, ` +
        `with 95% of simulated outcomes between ${fmt(f.ci95[0])} and ${fmt(f.ci95[1])}.`,
    };
  }, [f, horizon, selected]);

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold text-slate-800">Commodity Forecast</h1>
        <p className="text-sm text-slate-500">
          ML price projections from the NEXCOM ml-platform, grounded in live exchange closes.
        </p>
      </header>

      {/* Controls */}
      <Card className="border-slate-200">
        <CardContent className="flex flex-col gap-4 p-4 sm:flex-row sm:items-end">
          <div className="w-full sm:w-80">
            <label className="mb-1 block text-xs font-medium text-slate-500">Commodity</label>
            <Select value={effectiveSymbol} onValueChange={setSymbol}>
              <SelectTrigger><SelectValue placeholder="Select commodity" /></SelectTrigger>
              <SelectContent>
                {commodities.map((c) => (
                  <SelectItem key={c.symbol} value={c.symbol}>
                    {c.name} ({c.symbol})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="w-full sm:flex-1">
            <label className="mb-1 block text-xs font-medium text-slate-500">
              Horizon: {horizon} day{horizon > 1 ? "s" : ""}
            </label>
            <Slider
              min={1}
              max={30}
              step={1}
              value={[horizon]}
              onValueChange={([v]) => setHorizon(v)}
            />
          </div>
          {f && (
            <Badge variant="outline" className="border-slate-300 text-slate-600">
              MODEL {f.modelVersion}
            </Badge>
          )}
        </CardContent>
      </Card>

      {/* Chart */}
      <Card className="border-slate-200">
        <CardHeader className="pb-0">
          <CardTitle className="text-base text-slate-700">
            {selected?.name ?? "—"} — price &amp; {horizon}d projection
          </CardTitle>
        </CardHeader>
        <CardContent className="p-4">
          {effectiveSymbol ? (
            <ForecastBand symbol={effectiveSymbol} horizonDays={horizon} />
          ) : (
            <div className="flex h-40 items-center justify-center text-sm text-slate-500">
              <CloudOff className="mr-2 h-5 w-5" /> Loading commodity catalogue…
            </div>
          )}
        </CardContent>
      </Card>

      {/* Summary + stats */}
      {forecastQuery.data?.status === "UNAVAILABLE" && (
        <Card className="border-amber-200 bg-amber-50">
          <CardContent className="flex items-start gap-2 p-4 text-sm text-amber-800">
            <Info className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{forecastQuery.data.reason}</span>
          </CardContent>
        </Card>
      )}

      {summary && f && f.expectedPrice != null && f.ci95 && (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Card className="border-slate-200"><CardContent className="p-3">
              <p className="text-xs text-slate-500">Last close</p>
              <p className="text-lg font-semibold text-slate-800">{fmt(f.lastClose ?? 0)}</p>
            </CardContent></Card>
            <Card className="border-slate-200"><CardContent className="p-3">
              <p className="text-xs text-slate-500">Expected ({horizon}d)</p>
              <p className="flex items-center gap-1 text-lg font-semibold text-slate-800">
                {summary.driftPct >= 0
                  ? <TrendingUp className="h-4 w-4 text-teal-700" />
                  : <TrendingDown className="h-4 w-4 text-rose-700" />}
                {fmt(f.expectedPrice)}
              </p>
            </CardContent></Card>
            <Card className="border-slate-200"><CardContent className="p-3">
              <p className="text-xs text-slate-500">95% band low</p>
              <p className="text-lg font-semibold text-slate-800">{fmt(f.ci95[0])}</p>
            </CardContent></Card>
            <Card className="border-slate-200"><CardContent className="p-3">
              <p className="text-xs text-slate-500">95% band high</p>
              <p className="text-lg font-semibold text-slate-800">{fmt(f.ci95[1])}</p>
            </CardContent></Card>
          </div>

          <Card className="border-slate-200">
            <CardContent className="space-y-2 p-4">
              <p className="text-sm leading-relaxed text-slate-700">{summary.text}</p>
              <p className="text-xs italic text-slate-400">
                Model {f.modelVersion} · Statistical projection, not investment advice.
                Past performance does not guarantee future results.
              </p>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
