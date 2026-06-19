/**
 * AISearchBar — natural language search powered by LLM + PostgreSQL
 * Accepts a free-text query, calls trpc.search.aiSearch, renders result cards
 * grouped by entity type (Orders, Listings, Users).
 * Shows persisted search history chips when the input is empty.
 */
import { useState, useRef } from "react";
import { trpc } from "@/lib/trpc";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Search, X, TrendingUp, ShoppingCart, User, Package, Clock } from "lucide-react";
import { useLocation } from "wouter";

// ── Entity type icon ──────────────────────────────────────────────────────────
function EntityIcon({ type }: { type: string }) {
  switch (type) {
    case "order":            return <ShoppingCart className="h-3.5 w-3.5" />;
    case "instrument":       return <TrendingUp className="h-3.5 w-3.5" />;
    case "user":             return <User className="h-3.5 w-3.5" />;
    case "warehouse_receipt":return <Package className="h-3.5 w-3.5" />;
    case "deposit":          return <Package className="h-3.5 w-3.5" />;
    default:                 return <Search className="h-3.5 w-3.5" />;
  }
}

function entityLabel(type: string) {
  switch (type) {
    case "order":            return "Order";
    case "instrument":       return "Listing";
    case "user":             return "User";
    case "warehouse_receipt":return "Receipt";
    case "deposit":          return "Deposit";
    default:                 return type;
  }
}

// ── Props ─────────────────────────────────────────────────────────────────────
type AISearchBarProps = {
  /** Called when user selects a result or presses Escape */
  onClose?: () => void;
  /** Auto-focus the input on mount */
  autoFocus?: boolean;
  placeholder?: string;
};

// ── Component ─────────────────────────────────────────────────────────────────
export function AISearchBar({
  onClose,
  autoFocus = false,
  placeholder = "Search orders, listings, users… (natural language)",
}: AISearchBarProps) {
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [, setLocation] = useLocation();

  // Debounce input → debouncedQuery
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value;
    setQuery(v);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setDebouncedQuery(v), 400);
  };

  const { data, isFetching } = trpc.search.aiSearch.useQuery(
    { query: debouncedQuery },
    { enabled: debouncedQuery.trim().length >= 2 }
  );

  // Fetch persisted search history (shown when input is empty)
  const { data: historyRows } = trpc.search.searchHistory.useQuery(undefined, {
    staleTime: 30_000,
  });

  const results = data?.results ?? [];
  const parsedIntent = data?.parsedIntent;

  // Group results by type
  const grouped = results.reduce<Record<string, typeof results>>((acc, r) => {
    const key = r.type;
    if (!acc[key]) acc[key] = [];
    acc[key].push(r);
    return acc;
  }, {});

  const handleSelect = (href: string) => {
    setLocation(href);
    onClose?.();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      onClose?.();
    }
  };

  const applyHistoryQuery = (q: string) => {
    setQuery(q);
    if (timerRef.current) clearTimeout(timerRef.current);
    setDebouncedQuery(q);
  };

  const showHistory =
    !isFetching &&
    debouncedQuery.trim().length < 2 &&
    query.trim().length === 0 &&
    (historyRows?.length ?? 0) > 0;

  return (
    <div className="flex flex-col gap-3 w-full">
      {/* Input */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
        <Input
          autoFocus={autoFocus}
          value={query}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          className="pl-9 pr-9 h-10 bg-background border-border"
        />
        {query && (
          <button
            onClick={() => { setQuery(""); setDebouncedQuery(""); }}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Parsed intent chips */}
      {parsedIntent && Object.keys(parsedIntent).length > 0 && (
        <div className="flex flex-wrap gap-1.5 px-1">
          {Object.entries(parsedIntent).map(([k, v]) =>
            v ? (
              <Badge key={k} variant="secondary" className="text-xs gap-1">
                <span className="text-muted-foreground">{k}:</span>
                <span>{String(v)}</span>
              </Badge>
            ) : null
          )}
        </div>
      )}

      {/* Loading skeletons */}
      {isFetching && (
        <div className="space-y-2 px-1">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-12 w-full rounded-lg" />
          ))}
        </div>
      )}

      {/* No results */}
      {!isFetching && debouncedQuery.trim().length >= 2 && results.length === 0 && (
        <div className="flex flex-col items-center justify-center py-8 text-muted-foreground gap-2">
          <Search className="h-6 w-6 opacity-40" />
          <p className="text-sm">No results for &ldquo;{debouncedQuery}&rdquo;</p>
        </div>
      )}

      {/* Results grouped by type */}
      {!isFetching && results.length > 0 && (
        <div className="space-y-3 max-h-96 overflow-y-auto pr-1">
          {Object.entries(grouped).map(([type, items]) => (
            <div key={type}>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide px-1 mb-1">
                {entityLabel(type)}s
              </p>
              <div className="space-y-1">
                {items.map((item) => (
                  <button
                    key={item.id}
                    onClick={() => handleSelect(item.href)}
                    className="w-full text-left flex items-start gap-3 rounded-lg px-3 py-2.5 hover:bg-accent transition-colors"
                  >
                    <div className="mt-0.5 rounded-md bg-primary/10 p-1.5 shrink-0">
                      <EntityIcon type={item.type} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span
                          className="text-sm font-medium truncate"
                          dangerouslySetInnerHTML={{
                            __html: item.titleHighlight ?? item.title,
                          }}
                        />
                        {item.badge && (
                          <Badge variant="outline" className="text-xs shrink-0">
                            {item.badge}
                          </Badge>
                        )}
                      </div>
                      <p
                        className="text-xs text-muted-foreground truncate mt-0.5"
                        dangerouslySetInnerHTML={{
                          __html: item.subtitleHighlight ?? item.subtitle,
                        }}
                      />
                    </div>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Recent search history chips */}
      {showHistory && (
        <div className="px-1">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2 flex items-center gap-1.5">
            <Clock className="h-3 w-3" />
            Recent searches
          </p>
          <div className="flex flex-wrap gap-1.5">
            {historyRows!.map((row) => (
              <button
                key={row.id}
                onClick={() => applyHistoryQuery(row.query)}
                className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/50 px-2.5 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
              >
                <Clock className="h-3 w-3 shrink-0" />
                <span className="max-w-[180px] truncate">{row.query}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Empty state — before typing, no history */}
      {!isFetching && debouncedQuery.trim().length < 2 && query.trim().length === 0 && !showHistory && (
        <div className="px-1 py-4 text-center text-xs text-muted-foreground">
          Try: &ldquo;my open maize orders&rdquo;, &ldquo;soybean listings under ₦500&rdquo;, &ldquo;BUY orders this week&rdquo;
        </div>
      )}
    </div>
  );
}
