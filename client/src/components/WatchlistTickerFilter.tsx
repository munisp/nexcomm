/**
 * NEXCOM Exchange — Watchlist Ticker Filter
 * Wraps LivePriceTicker with a user-controlled symbol watchlist.
 *
 * Features:
 * - Loads the user's watchlist from tRPC (trpc.watchlist.list)
 * - Falls back to all DEFAULT_SYMBOLS when watchlist is empty
 * - Provides a popover panel to add/remove symbols from the watchlist
 * - Persists changes immediately via trpc.watchlist.add / trpc.watchlist.remove
 * - Shows a badge count of pinned symbols
 */
import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { LivePriceTicker, type TickerSymbol } from "@/components/LivePriceTicker";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Star, StarOff, Settings2, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

// Full universe of NEXCOM instruments available for watchlisting
const ALL_SYMBOLS: TickerSymbol[] = [
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

interface WatchlistTickerFilterProps {
  className?: string;
}

export function WatchlistTickerFilter({ className }: WatchlistTickerFilterProps) {
  const utils = trpc.useUtils();
  const [open, setOpen] = useState(false);

  const { data: watchlistSymbols = [], isLoading } = trpc.watchlist.list.useQuery(undefined, {
    staleTime: 30_000,
  });

  const addMutation = trpc.watchlist.add.useMutation({
    onSuccess: (data, vars) => {
      if (data.added) {
        utils.watchlist.list.invalidate();
        toast.success(`${vars.symbol} added to watchlist`);
      }
    },
    onError: (e) => toast.error(`Failed to add: ${e.message}`),
  });

  const removeMutation = trpc.watchlist.remove.useMutation({
    onSuccess: (_data, vars) => {
      utils.watchlist.list.invalidate();
      toast.success(`${vars.symbol} removed from watchlist`);
    },
    onError: (e) => toast.error(`Failed to remove: ${e.message}`),
  });

  const toggle = (symbol: string) => {
    if (watchlistSymbols.includes(symbol)) {
      removeMutation.mutate({ symbol });
    } else {
      addMutation.mutate({ symbol });
    }
  };

  // Build the filtered symbol list for the ticker
  const tickerSymbols = useMemo<TickerSymbol[]>(() => {
    if (isLoading || watchlistSymbols.length === 0) {
      // Show all when watchlist is empty or loading
      return ALL_SYMBOLS;
    }
    // Filter to only watchlisted symbols, preserving label metadata
    const symbolSet = new Set(watchlistSymbols);
    return ALL_SYMBOLS.filter((s) => symbolSet.has(s.symbol));
  }, [watchlistSymbols, isLoading]);

  const pinnedCount = watchlistSymbols.length;

  return (
    <div className={cn("relative", className)}>
      {/* Ticker strip */}
      <LivePriceTicker symbols={tickerSymbols} />

      {/* Watchlist filter button — overlaid on the right side of the ticker */}
      <div className="absolute right-0 top-0 h-full flex items-center pr-1 z-20">
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-blue-300 hover:text-white hover:bg-blue-800/60 gap-1"
            >
              <Settings2 className="w-3 h-3" />
              {pinnedCount > 0 && (
                <Badge
                  variant="secondary"
                  className="h-4 px-1 text-xs bg-blue-600 text-white border-0"
                >
                  {pinnedCount}
                </Badge>
              )}
            </Button>
          </PopoverTrigger>
          <PopoverContent
            align="end"
            className="w-72 p-3 bg-blue-950 border-blue-700 text-white shadow-xl"
          >
            <div className="flex items-center justify-between mb-3">
              <div>
                <p className="text-sm font-semibold text-white">Watchlist Filter</p>
                <p className="text-xs text-blue-400 mt-0.5">
                  {pinnedCount === 0
                    ? "Showing all instruments"
                    : `Showing ${pinnedCount} pinned instrument${pinnedCount !== 1 ? "s" : ""}`}
                </p>
              </div>
              {pinnedCount > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-xs text-blue-400 hover:text-white h-7 px-2"
                  onClick={() => {
                    watchlistSymbols.forEach((sym) =>
                      removeMutation.mutate({ symbol: sym })
                    );
                  }}
                >
                  Clear all
                </Button>
              )}
            </div>

            <div className="grid grid-cols-2 gap-1 max-h-64 overflow-y-auto pr-1">
              {ALL_SYMBOLS.map((sym) => {
                const isPinned = watchlistSymbols.includes(sym.symbol);
                const isBusy =
                  (addMutation.isPending && addMutation.variables?.symbol === sym.symbol) ||
                  (removeMutation.isPending && removeMutation.variables?.symbol === sym.symbol);
                return (
                  <button
                    key={sym.symbol}
                    onClick={() => toggle(sym.symbol)}
                    disabled={isBusy}
                    className={cn(
                      "flex items-center gap-1.5 px-2 py-1.5 rounded text-xs font-medium transition-colors text-left",
                      isPinned
                        ? "bg-blue-600/40 text-blue-200 border border-blue-500/50"
                        : "bg-blue-900/30 text-blue-400 border border-transparent hover:border-blue-700 hover:text-blue-200",
                      isBusy && "opacity-50 cursor-not-allowed"
                    )}
                  >
                    {isPinned ? (
                      <Star className="w-3 h-3 text-yellow-400 flex-shrink-0" />
                    ) : (
                      <StarOff className="w-3 h-3 flex-shrink-0" />
                    )}
                    <span className="truncate">{sym.label}</span>
                    {isPinned && <Check className="w-3 h-3 text-blue-400 ml-auto flex-shrink-0" />}
                  </button>
                );
              })}
            </div>

            <p className="text-xs text-blue-500 mt-3 text-center">
              {pinnedCount === 0
                ? "Pin instruments to filter the ticker"
                : "Unpin all to show full market ticker"}
            </p>
          </PopoverContent>
        </Popover>
      </div>
    </div>
  );
}

export default WatchlistTickerFilter;
