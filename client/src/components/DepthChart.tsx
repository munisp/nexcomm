/**
 * DepthChart (INNOV-C) — cumulative depth visualization (hand-rolled SVG, no
 * new deps). Bids extend left from mid, asks right; area fills use
 * low-saturation tokens. Shares the same marketStream.orderBookDepth query
 * cache as OrderBookDepth (same query key → one poller).
 */
import { useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface Props {
  symbol: string;
  levels?: number;
  height?: number;
  className?: string;
}

export function DepthChart({ symbol, levels = 25, height = 180, className }: Props) {
  const { data, isLoading } = trpc.marketStream.orderBookDepth.useQuery(
    { symbol, levels },
    { refetchInterval: 5000, staleTime: 2000 }
  );

  const model = useMemo(() => {
    if (!data || (data.bids.length === 0 && data.asks.length === 0)) return null;
    const W = 600;
    const H = height;
    const pad = 8;
    const bids = [...data.bids].sort((a, b) => a.price - b.price); // ascending, left→mid
    const asks = data.asks; // already ascending from mid
    const maxCum = Math.max(
      1,
      bids[bids.length - 1]?.cumulative ?? 0,
      asks[asks.length - 1]?.cumulative ?? 0
    );
    const minP = bids[0]?.price ?? asks[0]?.price ?? 0;
    const maxP = asks[asks.length - 1]?.price ?? bids[bids.length - 1]?.price ?? 1;
    const span = Math.max(maxP - minP, 1e-9);
    const x = (p: number) => pad + ((p - minP) / span) * (W - 2 * pad);
    const y = (c: number) => H - pad - (c / maxCum) * (H - 2 * pad);

    const area = (lvls: { price: number; cumulative: number }[]) => {
      if (lvls.length === 0) return "";
      let d = `M ${x(lvls[0].price)} ${H - pad}`;
      for (const l of lvls) d += ` L ${x(l.price)} ${y(l.cumulative)}`;
      d += ` L ${x(lvls[lvls.length - 1].price)} ${H - pad} Z`;
      return d;
    };
    return {
      W,
      H,
      bidPath: area(bids),
      askPath: area(asks),
      midX: data.midPrice != null ? x(data.midPrice) : null,
      minP,
      maxP,
    };
  }, [data, height]);

  return (
    <Card className={className}>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          Market Depth — {symbol}
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        {isLoading && <p className="py-8 text-center text-sm text-muted-foreground">Loading depth…</p>}
        {!isLoading && !model && (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No depth to chart for {symbol} yet.
          </p>
        )}
        {model && (
          <svg viewBox={`0 0 ${model.W} ${model.H}`} className="w-full" role="img" aria-label={`Depth chart for ${symbol}`}>
            <path d={model.bidPath} className="fill-emerald-500/15 stroke-emerald-600/60 dark:stroke-emerald-400/50" strokeWidth={1.5} />
            <path d={model.askPath} className="fill-rose-500/15 stroke-rose-600/60 dark:stroke-rose-400/50" strokeWidth={1.5} />
            {model.midX != null && (
              <line
                x1={model.midX}
                x2={model.midX}
                y1={6}
                y2={model.H - 6}
                className="stroke-muted-foreground/40"
                strokeDasharray="3 3"
                strokeWidth={1}
              />
            )}
            <text x={6} y={model.H - 2} className="fill-muted-foreground" fontSize={9}>
              {model.minP.toLocaleString(undefined, { maximumFractionDigits: 2 })}
            </text>
            <text x={model.W - 6} y={model.H - 2} textAnchor="end" className="fill-muted-foreground" fontSize={9}>
              {model.maxP.toLocaleString(undefined, { maximumFractionDigits: 2 })}
            </text>
          </svg>
        )}
      </CardContent>
    </Card>
  );
}

export default DepthChart;
