/**
 * OrderBookDepth (INNOV-C) — real order-book ladder for a symbol.
 *
 * Data: trpc.marketStream.orderBookDepth (real order_book_levels / open-order
 * aggregation — NO simulated data). Polls every 5s (staleTime 2s).
 * Renders an honest empty state when the symbol has no book.
 * Low-saturation tokens, dark-mode aware.
 */
import { useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { useConnectionQuality } from "@/lib/connectionQuality";
import { tunedInterval, tunedStaleTime } from "@/lib/queryTuning";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface Props {
  symbol: string;
  levels?: number;
  className?: string;
}

function fmt(n: number | null | undefined, dp = 2): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toLocaleString(undefined, { minimumFractionDigits: dp, maximumFractionDigits: dp });
}

export function OrderBookDepth({ symbol, levels = 15, className }: Props) {
  // OFFLINE-RES: 5s polling stretches to 20s on slow links, pauses when
  // offline / Save-Data. refetchOnWindowFocus preserved for fast connections.
  const { quality: connQuality } = useConnectionQuality();
  const { data, isLoading, isError, dataUpdatedAt } = trpc.marketStream.orderBookDepth.useQuery(
    { symbol, levels },
    {
      refetchInterval: tunedInterval(5000, connQuality),
      staleTime: tunedStaleTime(2000, connQuality),
      refetchOnWindowFocus: true,
    }
  );

  const maxCum = useMemo(() => {
    if (!data) return 1;
    return Math.max(
      1,
      data.bids[data.bids.length - 1]?.cumulative ?? 0,
      data.asks[data.asks.length - 1]?.cumulative ?? 0
    );
  }, [data]);

  const asks = useMemo(() => (data ? [...data.asks].reverse() : []), [data]); // best ask at bottom
  const bids = data?.bids ?? [];
  const empty = !isLoading && !isError && data != null && bids.length === 0 && asks.length === 0;

  return (
    <Card className={cn("border-border/60", className)}>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Order Book — {symbol}
          </CardTitle>
          {dataUpdatedAt > 0 && (
            <span className="text-[10px] text-muted-foreground/70">
              {new Date(dataUpdatedAt).toLocaleTimeString()} ·{" "}
              {data?.source === "matching_engine"
                ? "matching engine"
                : data?.source === "open_orders"
                  ? "open orders"
                  : "offline"}
            </span>
          )}
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        {isError && (
          <p className="py-8 text-center text-sm text-muted-foreground">
            Market data unavailable — retrying…
          </p>
        )}
        {empty && (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No open orders for {symbol} yet. The book fills in as traders post bids and asks.
          </p>
        )}
        {data && !empty && (
          <div className="font-mono text-xs">
            <div className="grid grid-cols-3 gap-2 border-b border-border/50 pb-1 text-[10px] uppercase tracking-wide text-muted-foreground/70">
              <span>Price</span>
              <span className="text-right">Quantity</span>
              <span className="text-right">Total</span>
            </div>

            {/* Asks (best at bottom) */}
            <div className="flex flex-col py-1">
              {asks.map((l) => (
                <div key={`a${l.price}`} className="relative grid grid-cols-3 gap-2 py-[3px]">
                  <div
                    className="absolute inset-y-0 right-0 rounded-sm bg-rose-500/10"
                    style={{ width: `${(100 * l.cumulative) / maxCum}%` }}
                  />
                  <span className="relative text-rose-600/90 dark:text-rose-400/80">{fmt(l.price)}</span>
                  <span className="relative text-right">{fmt(l.quantity, 4)}</span>
                  <span className="relative text-right text-muted-foreground">{fmt(l.cumulative, 4)}</span>
                </div>
              ))}
            </div>

            {/* Spread line */}
            <div className="flex items-center justify-between border-y border-border/50 py-1.5 text-[11px]">
              <span className="text-muted-foreground">Spread</span>
              <span className="font-semibold tabular-nums">
                {data.spread != null ? fmt(data.spread) : "—"}
                {data.midPrice != null && (
                  <span className="ml-2 font-normal text-muted-foreground">mid {fmt(data.midPrice)}</span>
                )}
              </span>
            </div>

            {/* Bids */}
            <div className="flex flex-col py-1">
              {bids.map((l) => (
                <div key={`b${l.price}`} className="relative grid grid-cols-3 gap-2 py-[3px]">
                  <div
                    className="absolute inset-y-0 right-0 rounded-sm bg-emerald-500/10"
                    style={{ width: `${(100 * l.cumulative) / maxCum}%` }}
                  />
                  <span className="relative text-emerald-600/90 dark:text-emerald-400/80">{fmt(l.price)}</span>
                  <span className="relative text-right">{fmt(l.quantity, 4)}</span>
                  <span className="relative text-right text-muted-foreground">{fmt(l.cumulative, 4)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
        {isLoading && (
          <p className="py-8 text-center text-sm text-muted-foreground">Loading order book…</p>
        )}
      </CardContent>
    </Card>
  );
}

export default OrderBookDepth;
