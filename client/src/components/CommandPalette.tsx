/**
 * CommandPalette — global ⌘K / Ctrl+K search palette.
 *
 * Uses cmdk for the command-menu shell and trpc.search.global for live
 * cross-entity search (backed by OpenSearch with a PostgreSQL fallback).
 *
 * Usage: render <CommandPalette /> once in DashboardLayout (or App.tsx).
 * The palette opens on ⌘K / Ctrl+K and can also be triggered programmatically
 * via the exported `useCommandPalette()` hook.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import DOMPurify from "dompurify";
import { Clock, Trash2, X, Brain } from "lucide-react";
import { useLocation } from "wouter";
import { Command } from "cmdk";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import {
  Dialog,
  DialogContent,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AISearchBar } from "@/components/AISearchBar";
import {
  Search,
  User,
  ShoppingCart,
  Warehouse,
  ArrowDownCircle,
  BarChart2,
  Loader2,
  AlertCircle,
  Database,
} from "lucide-react";

// ── Context / hook ────────────────────────────────────────────────────────────
import { createContext, useContext } from "react";

type CommandPaletteContextValue = {
  open: boolean;
  setOpen: (v: boolean) => void;
};

const CommandPaletteContext = createContext<CommandPaletteContextValue>({
  open: false,
  setOpen: () => {},
});

export function useCommandPalette() {
  return useContext(CommandPaletteContext);
}

// ── Provider (wrap DashboardLayout or App root) ───────────────────────────────
export function CommandPaletteProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  return (
    <CommandPaletteContext.Provider value={{ open, setOpen }}>
      {children}
      <CommandPalette />
    </CommandPaletteContext.Provider>
  );
}

// ── Type icons ────────────────────────────────────────────────────────────────
const TYPE_ICON: Record<string, React.ReactNode> = {
  user: <User className="h-4 w-4 text-blue-400" />,
  order: <ShoppingCart className="h-4 w-4 text-emerald-400" />,
  warehouse_receipt: <Warehouse className="h-4 w-4 text-amber-400" />,
  deposit: <ArrowDownCircle className="h-4 w-4 text-purple-400" />,
  instrument: <BarChart2 className="h-4 w-4 text-cyan-400" />,
};

const TYPE_LABEL: Record<string, string> = {
  user: "User",
  order: "Order",
  warehouse_receipt: "Receipt",
  deposit: "Deposit",
  instrument: "Instrument",
};

const TYPE_BADGE_CLASS: Record<string, string> = {
  user: "bg-blue-500/20 text-blue-300 border-blue-500/30",
  order: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30",
  warehouse_receipt: "bg-amber-500/20 text-amber-300 border-amber-500/30",
  deposit: "bg-purple-500/20 text-purple-300 border-purple-500/30",
  instrument: "bg-cyan-500/20 text-cyan-300 border-cyan-500/30",
};

// ── Recently-visited localStorage hook ──────────────────────────────────────
const RECENT_KEY = "nexcom:cmd:recent";
const MAX_RECENT = 5;

type RecentItem = { label: string; href: string; ts: number };

function useRecentlyVisited() {
  const [recent, setRecent] = useState<RecentItem[]>(() => {
    try {
      return JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]") as RecentItem[];
    } catch {
      return [];
    }
  });

  const push = useCallback((label: string, href: string) => {
    setRecent((prev) => {
      const filtered = prev.filter((r) => r.href !== href);
      const next = [{ label, href, ts: Date.now() }, ...filtered].slice(0, MAX_RECENT);
      try { localStorage.setItem(RECENT_KEY, JSON.stringify(next)); } catch { /* quota */ }
      return next;
    });
  }, []);

  const remove = useCallback((href: string) => {
    setRecent((prev) => {
      const next = prev.filter((r) => r.href !== href);
      try { localStorage.setItem(RECENT_KEY, JSON.stringify(next)); } catch { /* quota */ }
      return next;
    });
  }, []);

  const clearAll = useCallback(() => {
    try { localStorage.removeItem(RECENT_KEY); } catch { /* quota */ }
    setRecent([]);
  }, []);

  return { recent, push, remove, clearAll };
}

// ── Quick-nav items (always shown when query is empty) ────────────────────────
const QUICK_NAV = [
  { label: "Dashboard", href: "/dashboard", icon: <BarChart2 className="h-4 w-4" /> },
  { label: "Orders", href: "/orders", icon: <ShoppingCart className="h-4 w-4" /> },
  { label: "Warehouse Receipts", href: "/warehouse-receipts", icon: <Warehouse className="h-4 w-4" /> },
  { label: "Deposits", href: "/deposits", icon: <ArrowDownCircle className="h-4 w-4" /> },
  { label: "Compliance Dashboard", href: "/compliance", icon: <AlertCircle className="h-4 w-4" /> },
];

// ── Highlight renderer ──────────────────────────────────────────────────────
/**
 * Renders an OpenSearch highlight snippet that may contain <em>...</em> tags.
 * The <em> tags are rendered as bold amber text to make matched terms pop.
 * Falls back to plain text when no highlight is present.
 */
function HighlightText({
  highlight,
  fallback,
  className = "",
}: {
  highlight?: string;
  fallback: string;
  className?: string;
}) {
  if (!highlight) {
    return <span className={className}>{fallback}</span>;
  }
  // Replace <em>...</em> with a styled span, then render as HTML.
  // First sanitize with DOMPurify allowing only <em> tags, then replace <em> with <mark>.
  const purified = DOMPurify.sanitize(highlight, { ALLOWED_TAGS: ["em"], ALLOWED_ATTR: [] });
  const safe = purified.replace(
    /<em>(.*?)<\/em>/g,
    '<mark class="bg-transparent text-amber-400 font-semibold not-italic">$1</mark>'
  );
  return (
    <span
      className={className}
      // biome-ignore lint/security/noDangerouslySetInnerHtml: controlled OpenSearch snippet
      dangerouslySetInnerHTML={{ __html: safe }}
    />
  );
}

// ── Main palette component ────────────────────────────────────────────────────
function CommandPalette() {
  const { open, setOpen } = useCommandPalette();
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [aiMode, setAiMode] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [, navigate] = useLocation();
  const { user } = useAuth();
  const { recent, push: pushRecent, remove: removeRecent, clearAll: clearAllRecent } = useRecentlyVisited();

  // Debounce input by 300 ms
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setDebouncedQuery(query), 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  // Reset query when palette closes
  useEffect(() => {
    if (!open) {
      setQuery("");
      setDebouncedQuery("");
    }
  }, [open]);

  const enabled = debouncedQuery.trim().length >= 1;

  const { data, isFetching, isError } = trpc.search.global.useQuery(
    { query: debouncedQuery.trim(), limit: 20 },
    {
      enabled,
      staleTime: 10_000,
      retry: false,
    }
  );

  const handleSelect = useCallback(
    (href: string, label?: string) => {
      if (label) pushRecent(label, href);
      setOpen(false);
      navigate(href);
    },
    [navigate, setOpen, pushRecent]
  );

  const results = data?.results ?? [];
  const source = data?.source;

  // Group results by type
  const grouped = results.reduce<Record<string, typeof results>>((acc, item) => {
    (acc[item.type] ??= []).push(item);
    return acc;
  }, {});

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent
        className="p-0 max-w-2xl overflow-hidden bg-background border-border"
        aria-label="Global search"
      >
        <Command
          className="bg-transparent"
          shouldFilter={false}
          loop
        >
          {/* Mode toggle + Search input */}
          <div className="flex items-center gap-2 px-3 py-2 border-b border-border">
            <Button
              variant={aiMode ? "default" : "ghost"}
              size="sm"
              className="h-7 gap-1.5 text-xs shrink-0"
              onClick={() => setAiMode((v) => !v)}
              title="Toggle AI natural language search"
            >
              <Brain className="h-3.5 w-3.5" />
              AI
            </Button>
            {!aiMode && (
              <>
                <Search className="h-4 w-4 text-muted-foreground shrink-0" />
                <Command.Input
                  value={query}
                  onValueChange={setQuery}
                  placeholder="Search users, orders, receipts, deposits…"
                  className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-none"
                  autoFocus
                />
                {isFetching && (
                  <Loader2 className="h-4 w-4 text-muted-foreground animate-spin shrink-0" />
                )}
              </>
            )}
            <kbd className="hidden sm:inline-flex h-5 items-center gap-1 rounded border border-border bg-secondary px-1.5 font-mono text-[10px] text-muted-foreground">
              ESC
            </kbd>
          </div>
          {/* AI Search mode */}
          {aiMode && (
            <div className="px-4 py-3 border-b border-border">
              <AISearchBar
                autoFocus
                onClose={() => setOpen(false)}
                placeholder="Natural language: 'my open maize orders', 'soybean under ₦500'…"
              />
            </div>
          )}

          <Command.List className="max-h-[420px] overflow-y-auto py-2">
            {/* Empty state */}
            <Command.Empty className="py-10 text-center text-sm text-muted-foreground">
              {isError
                ? "Search unavailable — please try again."
                : enabled
                ? "No results found."
                : null}
            </Command.Empty>

            {/* Recently visited (shown when no query and history exists) */}
            {!enabled && recent.length > 0 && (
              <Command.Group
                heading={
                  <span className="px-4 py-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-2 w-full">
                    <Clock className="h-3 w-3" />
                    <span className="flex-1">Recently Visited</span>
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); clearAllRecent(); }}
                      className="flex items-center gap-1 text-[10px] font-normal normal-case tracking-normal text-zinc-600 hover:text-muted-foreground transition-colors px-1 py-0.5 rounded hover:bg-secondary"
                      title="Clear all recently visited"
                    >
                      <Trash2 className="h-3 w-3" />
                      Clear all
                    </button>
                  </span>
                }
              >
                {recent.map((item) => (
                  <Command.Item
                    key={item.href}
                    value={`recent-${item.href}`}
                    onSelect={() => handleSelect(item.href, item.label)}
                    className="flex items-center gap-3 px-4 py-2.5 text-sm text-foreground cursor-pointer hover:bg-secondary data-[selected=true]:bg-secondary rounded-none group"
                  >
                    <Clock className="h-4 w-4 text-muted-foreground shrink-0" />
                    <span className="flex-1 truncate">{item.label}</span>
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); removeRecent(item.href); }}
                      className="opacity-0 group-hover:opacity-100 p-0.5 rounded text-muted-foreground hover:text-muted-foreground"
                      aria-label={`Remove ${item.label} from recent`}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </Command.Item>
                ))}
              </Command.Group>
            )}

            {/* Quick nav (shown when no query) */}
            {!enabled && (
              <Command.Group
                heading={
                  <span className="px-4 py-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                    Quick Navigation
                  </span>
                }
              >
                {QUICK_NAV.map((item) => (
                  <Command.Item
                    key={item.href}
                    value={item.label}
                    onSelect={() => handleSelect(item.href, item.label)}
                    className="flex items-center gap-3 px-4 py-2.5 text-sm text-foreground cursor-pointer hover:bg-secondary data-[selected=true]:bg-secondary rounded-none"
                  >
                    <span className="text-muted-foreground">{item.icon}</span>
                    {item.label}
                  </Command.Item>
                ))}
              </Command.Group>
            )}

            {/* Search results grouped by type */}
            {enabled &&
              Object.entries(grouped).map(([type, items]) => (
                <Command.Group
                  key={type}
                  heading={
                    <span className="px-4 py-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-2">
                      {TYPE_ICON[type]}
                      {TYPE_LABEL[type] ?? type}s
                    </span>
                  }
                >
                  {items.map((item) => (
                    <Command.Item
                      key={`${item.type}-${item.id}`}
                      value={`${item.type}-${item.id}-${item.title}`}
                      onSelect={() => handleSelect(item.href, item.title)}
                      className="flex items-center gap-3 px-4 py-2.5 cursor-pointer hover:bg-secondary data-[selected=true]:bg-secondary rounded-none"
                    >
                      <span className="shrink-0">{TYPE_ICON[item.type]}</span>
                      <div className="flex-1 min-w-0">
                        <HighlightText
                          highlight={item.titleHighlight}
                          fallback={item.title}
                          className="text-sm text-foreground truncate block"
                        />
                        {item.subtitle && (
                          <HighlightText
                            highlight={item.subtitleHighlight}
                            fallback={item.subtitle}
                            className="text-xs text-muted-foreground truncate block"
                          />
                        )}
                      </div>
                      {item.badge && (
                        <Badge
                          variant="outline"
                          className={`text-[10px] px-1.5 py-0 shrink-0 ${
                            TYPE_BADGE_CLASS[item.type] ?? ""
                          }`}
                        >
                          {item.badge}
                        </Badge>
                      )}
                    </Command.Item>
                  ))}
                </Command.Group>
              ))}

            {/* Source indicator */}
            {enabled && results.length > 0 && source && (
              <div className="px-4 py-2 flex items-center gap-1.5 text-[10px] text-zinc-600 border-t border-border mt-1">
                <Database className="h-3 w-3" />
                {source === "opensearch" ? "Powered by OpenSearch" : "Powered by PostgreSQL fallback"}
              </div>
            )}
          </Command.List>
        </Command>
      </DialogContent>
    </Dialog>
  );
}

export default CommandPalette;
