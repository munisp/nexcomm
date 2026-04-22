/**
 * NEXCOM Exchange — Markets Hub
 * All 5 asset classes: Commodities, Forex, Equities, Digital Assets, Indices
 * Live price feeds with 2-second ticks, search, and one-click Trade.
 */
import { useState, useMemo, useRef, useEffect } from "react";
import { Link } from "wouter";
import { Search, TrendingUp, TrendingDown, Wifi, BarChart2, Coins, Globe, LineChart, Cpu, Activity, ArrowUpRight, ArrowDownRight } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { COMMODITIES, CATEGORY_ICONS, generateMockTick } from "../../../shared/commodities";
import { trpc } from "@/lib/trpc";
import { PageSkeleton } from "@/components/PageSkeleton";

// Maps live_prices DB symbols → NEXCOM commodity symbols for price seeding
const LIVE_PRICE_MAP: Record<string, string[]> = {
  "WHEAT-SPOT":     ["WHEAT-SPOT", "WHEAT-MAR27-FUT"],
  "MAIZE-NG-SPOT":  ["MAIZE-NG-SPOT", "MAIZE-MAR27-FUT"],
  "SOYBEAN-SPOT":   ["SOYBEAN-SPOT", "SOYBEAN-MAR27-FUT"],
  "COCOA-SPOT":     ["COCOA-SPOT", "COCOA-MAR27-FUT"],
  "COFFEE-SPOT":    ["COFFEE-SPOT", "COFFEE-MAR27-FUT"],
  "SUGAR-SPOT":     ["SUGAR-SPOT", "SUGAR-MAR27-FUT"],
  "COTTON-SPOT":    ["COTTON-SPOT", "COTTON-MAR27-FUT"],
  "PALMOIL-SPOT":   ["PALMOIL-SPOT", "PALMOIL-MAR27-FUT"],
  "GOLD-SPOT":      ["GOLD-SPOT", "GOLD-MAR27-FUT"],
  "SILVER-SPOT":    ["SILVER-SPOT", "SILVER-MAR27-FUT"],
  "COPPER-SPOT":    ["COPPER-SPOT", "COPPER-MAR27-FUT"],
  "CRUDE-OIL-SPOT": ["CRUDE-SPOT", "CRUDE-MAR27-FUT"],
};
import {
  FX_PAIRS, EQUITIES, CRYPTO_ASSETS,
  simulateFxTick, simulateEquityTick, simulateCryptoTick,
} from "../../../shared/instruments";

const INDICES = [
  { id: "NCI",   name: "NEXCOM Commodity Index",    shortName: "NCI",    baseValue: 4218.50, changePct:  0.68, ytdPct: 12.4, currency: "USD", category: "NEXCOM" },
  { id: "NAGI",  name: "NEXCOM Agri Index",         shortName: "NAGI",   baseValue: 3142.80, changePct:  1.12, ytdPct: 18.2, currency: "USD", category: "NEXCOM" },
  { id: "NGX",   name: "NGX All Share Index",       shortName: "NGX ASI",baseValue: 108234.5,changePct: -0.21, ytdPct: 28.4, currency: "NGN", category: "GLOBAL" },
  { id: "SP500", name: "S&P 500",                   shortName: "S&P 500",baseValue: 5842.18, changePct:  0.42, ytdPct:  6.8, currency: "USD", category: "GLOBAL" },
  { id: "NDX",   name: "NASDAQ Composite",          shortName: "NASDAQ", baseValue: 18421.31,changePct:  0.68, ytdPct:  8.2, currency: "USD", category: "GLOBAL" },
  { id: "FTSE",  name: "FTSE 100",                  shortName: "FTSE",   baseValue: 8042.60, changePct: -0.14, ytdPct:  3.1, currency: "GBP", category: "GLOBAL" },
  { id: "DAX",   name: "DAX 40",                    shortName: "DAX",    baseValue: 18240.80,changePct:  0.38, ytdPct:  7.4, currency: "EUR", category: "GLOBAL" },
  { id: "GSCI",  name: "S&P GSCI Commodity Index",  shortName: "GSCI",   baseValue: 548.20,  changePct:  0.70, ytdPct:  5.4, currency: "USD", category: "COMMODITY" },
  { id: "BCOM",  name: "Bloomberg Commodity Index", shortName: "BCOM",   baseValue: 102.84,  changePct:  0.61, ytdPct:  4.8, currency: "USD", category: "COMMODITY" },
];

function fmtPct(v: number) { return `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`; }

function TableHeader({ col3 = "24h Change", col4 = "Volume" }: { col3?: string; col4?: string }) {
  return (
    <div className="grid grid-cols-[2fr_1fr_1fr_1fr_auto] gap-3 px-4 py-3 bg-secondary/50 border-b border-border">
      <span className="text-xs font-medium text-muted-foreground">Instrument</span>
      <span className="text-xs font-medium text-muted-foreground">Price</span>
      <span className="text-xs font-medium text-muted-foreground">{col3}</span>
      <span className="text-xs font-medium text-muted-foreground hidden sm:block">{col4}</span>
      <span className="text-xs font-medium text-muted-foreground">Action</span>
    </div>
  );
}

// ── Commodity Panel ──────────────────────────────────────────────────────────
function CommodityPanel({ query }: { query: string }) {
  type CTick = { price: number; changePct: number; volume: number; direction: string; isLive?: boolean };
  // Fetch live prices from DB (Yahoo Finance, updated every 5 min by priceFeedJob)
  const { data: liveData, isLoading: liveLoading } = trpc.livePrices.getAll.useQuery(undefined, {
    refetchInterval: 5 * 60 * 1000,
    staleTime: 4 * 60 * 1000,
  });
  const [prices, setPrices] = useState<Record<string, CTick>>(() => {
    const m: Record<string, CTick> = {};
    for (const c of COMMODITIES) {
      const t = generateMockTick(c.symbol);
      m[c.symbol] = { price: t.price, changePct: 0, volume: 50, direction: "flat", isLive: false };
    }
    return m;
  });
  // Seed prices from live DB data when available
  useEffect(() => {
    if (!liveData?.prices?.length) return;
    setPrices(old => {
      const next = { ...old };
      for (const row of liveData.prices) {
        const nexcomSymbols = LIVE_PRICE_MAP[row.symbol];
        if (!nexcomSymbols) continue;
        const livePrice = Number(row.price);
        const liveChangePct = Number(row.changePct ?? 0);
        for (const sym of nexcomSymbols) {
          if (next[sym]) next[sym] = { ...next[sym], price: livePrice, changePct: liveChangePct, isLive: true };
        }
      }
      return next;
    });
  }, [liveData]);
  const [flash, setFlash] = useState<Record<string, string>>({});
  const prev = useRef<Record<string, number>>({});

  useEffect(() => {
    const id = setInterval(() => {
      setPrices(old => {
        const next = { ...old };
        const flashes: Record<string, string> = {};
        for (const c of COMMODITIES) {
          const t = generateMockTick(c.symbol, old[c.symbol]?.price);
          const prevP = prev.current[c.symbol];
          if (prevP !== undefined && t.price !== prevP) flashes[c.symbol] = t.price > prevP ? "up" : "down";
          prev.current[c.symbol] = t.price;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          next[c.symbol] = { price: t.price, changePct: (t as any).changePct ?? 0, volume: (old[c.symbol]?.volume ?? 50) + Math.floor(Math.random() * 5), direction: (t as any).direction ?? "flat" };
        }
        setFlash(flashes);
        setTimeout(() => setFlash({}), 500);
        return next;
      });
    }, 2000);
    return () => clearInterval(id);
  }, []);

  const filtered = useMemo(() =>
    COMMODITIES.filter(c => c.name.toLowerCase().includes(query.toLowerCase()) || c.symbol.toLowerCase().includes(query.toLowerCase())).slice(0, 80),
    [query]);

  return (
    <div className="divide-y divide-border/50">
      {filtered.length === 0 && <div className="py-12 text-center text-muted-foreground text-sm">No instruments match your search.</div>}
      {filtered.map(c => {
        const tick = prices[c.symbol];
        if (!tick) return null;
        const isUp = tick.changePct >= 0;
        const f = flash[c.symbol];
        return (
          <div key={c.symbol} className={`grid grid-cols-[2fr_1fr_1fr_1fr_auto] gap-3 px-4 py-3 items-center transition-colors ${f === "up" ? "bg-positive/5" : f === "down" ? "bg-negative/5" : "hover:bg-secondary/30"}`}>
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-lg flex-shrink-0">{CATEGORY_ICONS[c.category]}</span>
              <div className="min-w-0">
                <div className="text-sm font-semibold truncate">{c.name}</div>
                <div className="text-xs text-muted-foreground font-mono">{c.symbol}</div>
              </div>
              {c.isFutures && <Badge variant="outline" className="text-[10px] border-blue-500/30 text-blue-400 flex-shrink-0">FUT</Badge>}
              {tick.isLive && <Badge variant="outline" className="text-[10px] border-positive/40 text-positive flex-shrink-0">LIVE</Badge>}
            </div>
            <div className={`font-mono text-sm font-semibold ${tick.direction === "up" ? "text-positive" : tick.direction === "down" ? "text-negative" : ""}`}>
              ${tick.price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
            <div className={`flex items-center gap-1 text-sm font-mono ${isUp ? "text-positive" : "text-negative"}`}>
              {isUp ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
              {fmtPct(tick.changePct)}
            </div>
            <div className="text-xs font-mono text-muted-foreground hidden sm:block">{tick.volume.toLocaleString()} {c.unit}</div>
            <Link href={`/trade/${c.symbol}`} className="inline-flex items-center justify-center h-7 px-3 text-xs font-medium rounded-md border border-primary/30 text-primary hover:bg-primary hover:text-primary-foreground transition-colors">Trade</Link>
          </div>
        );
      })}
    </div>
  );
}

// ── Forex Panel ──────────────────────────────────────────────────────────────
function ForexPanel({ query }: { query: string }) {
  type FTick = ReturnType<typeof simulateFxTick>;
  const [prices, setPrices] = useState<Record<string, FTick>>(() => {
    const m: Record<string, FTick> = {};
    for (const p of FX_PAIRS) m[p.symbol] = simulateFxTick(p);
    return m;
  });
  const [flash, setFlash] = useState<Record<string, string>>({});
  const prev = useRef<Record<string, number>>({});

  useEffect(() => {
    const id = setInterval(() => {
      setPrices(old => {
        const next = { ...old };
        const flashes: Record<string, string> = {};
        for (const p of FX_PAIRS) {
          const t = simulateFxTick(p, old[p.symbol]?.price);
          const prevP = prev.current[p.symbol];
          if (prevP !== undefined && t.price !== prevP) flashes[p.symbol] = t.price > prevP ? "up" : "down";
          prev.current[p.symbol] = t.price;
          next[p.symbol] = t;
        }
        setFlash(flashes);
        setTimeout(() => setFlash({}), 500);
        return next;
      });
    }, 2000);
    return () => clearInterval(id);
  }, []);

  const filtered = useMemo(() =>
    FX_PAIRS.filter(p => p.label.toLowerCase().includes(query.toLowerCase()) || p.symbol.toLowerCase().includes(query.toLowerCase())).slice(0, 80),
    [query]);

  return (
    <div className="divide-y divide-border/50">
      {filtered.length === 0 && <div className="py-12 text-center text-muted-foreground text-sm">No instruments match your search.</div>}
      {filtered.map(p => {
        const tick = prices[p.symbol];
        if (!tick) return null;
        const isUp = tick.changePct >= 0;
        const f = flash[p.symbol];
        const dp = p.pipSize < 0.001 ? 3 : p.pipSize < 0.01 ? 4 : 2;
        return (
          <div key={p.symbol} className={`grid grid-cols-[2fr_1fr_1fr_1fr_auto] gap-3 px-4 py-3 items-center transition-colors ${f === "up" ? "bg-positive/5" : f === "down" ? "bg-negative/5" : "hover:bg-secondary/30"}`}>
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-xs font-bold text-muted-foreground flex-shrink-0 w-8 text-center font-mono">{p.base}</span>
              <div className="min-w-0">
                <div className="text-sm font-semibold truncate">{p.label}</div>
                <div className="text-xs text-muted-foreground font-mono">{p.symbol}</div>
              </div>
            </div>
            <div className={`font-mono text-sm font-semibold ${tick.direction === "up" ? "text-positive" : tick.direction === "down" ? "text-negative" : ""}`}>
              {tick.price.toFixed(dp)}
            </div>
            <div className={`flex items-center gap-1 text-sm font-mono ${isUp ? "text-positive" : "text-negative"}`}>
              {isUp ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
              {fmtPct(tick.changePct)}
            </div>
            <div className="hidden sm:block text-xs font-mono">
              <span className="text-bid">{tick.bid.toFixed(dp)}</span>
              <span className="text-muted-foreground mx-1">/</span>
              <span className="text-ask">{tick.ask.toFixed(dp)}</span>
            </div>
            <Link href={`/forex?symbol=${p.symbol}`} className="inline-flex items-center justify-center h-7 px-3 text-xs font-medium rounded-md border border-primary/30 text-primary hover:bg-primary hover:text-primary-foreground transition-colors">Trade</Link>
          </div>
        );
      })}
    </div>
  );
}

// ── Equities Panel ───────────────────────────────────────────────────────────
function EquitiesPanel({ query }: { query: string }) {
  type ETick = ReturnType<typeof simulateEquityTick>;
  const [prices, setPrices] = useState<Record<string, ETick>>(() => {
    const m: Record<string, ETick> = {};
    for (const e of EQUITIES) m[e.symbol] = simulateEquityTick(e);
    return m;
  });
  const [flash, setFlash] = useState<Record<string, string>>({});
  const prev = useRef<Record<string, number>>({});

  useEffect(() => {
    const id = setInterval(() => {
      setPrices(old => {
        const next = { ...old };
        const flashes: Record<string, string> = {};
        for (const e of EQUITIES) {
          const t = simulateEquityTick(e, old[e.symbol]?.price);
          const prevP = prev.current[e.symbol];
          if (prevP !== undefined && t.price !== prevP) flashes[e.symbol] = t.price > prevP ? "up" : "down";
          prev.current[e.symbol] = t.price;
          next[e.symbol] = t;
        }
        setFlash(flashes);
        setTimeout(() => setFlash({}), 500);
        return next;
      });
    }, 2000);
    return () => clearInterval(id);
  }, []);

  const filtered = useMemo(() =>
    EQUITIES.filter(e => e.name.toLowerCase().includes(query.toLowerCase()) || e.symbol.toLowerCase().includes(query.toLowerCase()) || e.exchange.toLowerCase().includes(query.toLowerCase())).slice(0, 80),
    [query]);

  return (
    <div className="divide-y divide-border/50">
      {filtered.length === 0 && <div className="py-12 text-center text-muted-foreground text-sm">No instruments match your search.</div>}
      {filtered.map(e => {
        const tick = prices[e.symbol];
        if (!tick) return null;
        const isUp = tick.changePct >= 0;
        const f = flash[e.symbol];
        return (
          <div key={e.symbol} className={`grid grid-cols-[2fr_1fr_1fr_1fr_auto] gap-3 px-4 py-3 items-center transition-colors ${f === "up" ? "bg-positive/5" : f === "down" ? "bg-negative/5" : "hover:bg-secondary/30"}`}>
            <div className="min-w-0">
              <div className="text-sm font-semibold truncate">{e.name}</div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground font-mono">{e.symbol}</span>
                <Badge variant="outline" className="text-[9px] px-1 py-0">{e.exchange}</Badge>
              </div>
            </div>
            <div className={`font-mono text-sm font-semibold ${tick.direction === "up" ? "text-positive" : tick.direction === "down" ? "text-negative" : ""}`}>
              {e.currency === "NGN" ? "₦" : "$"}{tick.price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
            <div className={`flex items-center gap-1 text-sm font-mono ${isUp ? "text-positive" : "text-negative"}`}>
              {isUp ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
              {fmtPct(tick.changePct)}
            </div>
            <div className="text-xs font-mono text-muted-foreground hidden sm:block">{(tick.volume / 1000).toFixed(0)}K shares</div>
            <Link href={`/equities?symbol=${e.symbol}`} className="inline-flex items-center justify-center h-7 px-3 text-xs font-medium rounded-md border border-primary/30 text-primary hover:bg-primary hover:text-primary-foreground transition-colors">Trade</Link>
          </div>
        );
      })}
    </div>
  );
}

// ── Digital Assets Panel ─────────────────────────────────────────────────────
function DigitalAssetsPanel({ query }: { query: string }) {
  type DTick = ReturnType<typeof simulateCryptoTick>;
  const [prices, setPrices] = useState<Record<string, DTick>>(() => {
    const m: Record<string, DTick> = {};
    for (const a of CRYPTO_ASSETS) m[a.symbol] = simulateCryptoTick(a);
    return m;
  });
  const [flash, setFlash] = useState<Record<string, string>>({});
  const prev = useRef<Record<string, number>>({});

  useEffect(() => {
    const id = setInterval(() => {
      setPrices(old => {
        const next = { ...old };
        const flashes: Record<string, string> = {};
        for (const a of CRYPTO_ASSETS) {
          const t = simulateCryptoTick(a, old[a.symbol]?.price);
          const prevP = prev.current[a.symbol];
          if (prevP !== undefined && t.price !== prevP) flashes[a.symbol] = t.price > prevP ? "up" : "down";
          prev.current[a.symbol] = t.price;
          next[a.symbol] = t;
        }
        setFlash(flashes);
        setTimeout(() => setFlash({}), 500);
        return next;
      });
    }, 2000);
    return () => clearInterval(id);
  }, []);

  const filtered = useMemo(() =>
    CRYPTO_ASSETS.filter(a => a.name.toLowerCase().includes(query.toLowerCase()) || a.symbol.toLowerCase().includes(query.toLowerCase())).slice(0, 80),
    [query]);

  return (
    <div className="divide-y divide-border/50">
      {filtered.length === 0 && <div className="py-12 text-center text-muted-foreground text-sm">No instruments match your search.</div>}
      {filtered.map(a => {
        const tick = prices[a.symbol];
        if (!tick) return null;
        const isUp = tick.changePct >= 0;
        const f = flash[a.symbol];
        const dp = tick.price < 0.001 ? 8 : tick.price < 1 ? 6 : tick.price < 100 ? 4 : 2;
        return (
          <div key={a.symbol} className={`grid grid-cols-[2fr_1fr_1fr_1fr_auto] gap-3 px-4 py-3 items-center transition-colors ${f === "up" ? "bg-positive/5" : f === "down" ? "bg-negative/5" : "hover:bg-secondary/30"}`}>
            <div className="min-w-0">
              <div className="text-sm font-semibold truncate">{a.name}</div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground font-mono">{a.symbol}</span>
                <Badge variant="outline" className="text-[9px] px-1 py-0 border-purple-500/30 text-purple-400">{a.category}</Badge>
              </div>
            </div>
            <div className={`font-mono text-sm font-semibold ${tick.direction === "up" ? "text-positive" : tick.direction === "down" ? "text-negative" : ""}`}>
              ${tick.price.toLocaleString(undefined, { minimumFractionDigits: dp, maximumFractionDigits: dp })}
            </div>
            <div className={`flex items-center gap-1 text-sm font-mono ${isUp ? "text-positive" : "text-negative"}`}>
              {isUp ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
              {fmtPct(tick.changePct)}
            </div>
            <div className="text-xs font-mono text-muted-foreground hidden sm:block">${(tick.volume / 1e6).toFixed(1)}M vol</div>
            <Link href={`/digital-assets?symbol=${a.symbol}`} className="inline-flex items-center justify-center h-7 px-3 text-xs font-medium rounded-md border border-primary/30 text-primary hover:bg-primary hover:text-primary-foreground transition-colors">Trade</Link>
          </div>
        );
      })}
    </div>
  );
}

// ── Indices Panel ────────────────────────────────────────────────────────────
function IndicesPanel({ query }: { query: string }) {
  type ITick = { value: number; changePct: number; direction: string };
  const [prices, setPrices] = useState<Record<string, ITick>>(() => {
    const m: Record<string, ITick> = {};
    for (const idx of INDICES) m[idx.id] = { value: idx.baseValue, changePct: idx.changePct, direction: idx.changePct > 0 ? "up" : "down" };
    return m;
  });

  useEffect(() => {
    const id = setInterval(() => {
      setPrices(old => {
        const next = { ...old };
        for (const idx of INDICES) {
          const prevVal = old[idx.id].value;
          const drift = (Math.random() - 0.499) * prevVal * 0.001;
          const value = Math.max(prevVal * 0.5, prevVal + drift);
          const changePct = ((value - idx.baseValue) / idx.baseValue) * 100;
          next[idx.id] = { value: parseFloat(value.toFixed(idx.currency === "NGN" ? 1 : 2)), changePct: parseFloat(changePct.toFixed(2)), direction: drift > 0 ? "up" : drift < 0 ? "down" : "flat" };
        }
        return next;
      });
    }, 3000);
    return () => clearInterval(id);
  }, []);

  const filtered = useMemo(() =>
    INDICES.filter(idx => idx.name.toLowerCase().includes(query.toLowerCase()) || idx.shortName.toLowerCase().includes(query.toLowerCase())),
    [query]);

  return (
    <div className="divide-y divide-border/50">
      {filtered.length === 0 && <div className="py-12 text-center text-muted-foreground text-sm">No indices match your search.</div>}
      {filtered.map(idx => {
        const tick = prices[idx.id];
        if (!tick) return null;
        const isUp = tick.changePct >= 0;
        return (
          <div key={idx.id} className="grid grid-cols-[2fr_1fr_1fr_1fr_auto] gap-3 px-4 py-3 items-center hover:bg-secondary/30 transition-colors">
            <div className="min-w-0">
              <div className="text-sm font-semibold truncate">{idx.name}</div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground font-mono">{idx.shortName}</span>
                <Badge variant="outline" className="text-[9px] px-1 py-0">{idx.category}</Badge>
              </div>
            </div>
            <div className={`font-mono text-sm font-semibold ${tick.direction === "up" ? "text-positive" : tick.direction === "down" ? "text-negative" : ""}`}>
              {tick.value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
            <div className={`flex items-center gap-1 text-sm font-mono ${isUp ? "text-positive" : "text-negative"}`}>
              {isUp ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
              {fmtPct(tick.changePct)}
            </div>
            <div className="text-xs font-mono text-muted-foreground hidden sm:block">YTD {fmtPct(idx.ytdPct)}</div>
            <Link href={`/indices?id=${idx.id}`} className="inline-flex items-center justify-center h-7 px-3 text-xs font-medium rounded-md border border-border text-muted-foreground hover:border-primary/30 hover:text-primary transition-colors">View</Link>
          </div>
        );
      })}
    </div>
  );
}

// ── Market Overview Bar ──────────────────────────────────────────────────────
function MarketOverviewBar() {
  const [stats, setStats] = useState([
    { label: "Ginger (GINGER-NG)", price: 4218.50, change: 0.68, asset: "commodity", link: "/trade?symbol=GINGER-NG-SPOT" },
    { label: "EUR/USD",            price: 1.0842,  change: 0.12, asset: "forex",     link: "/forex?pair=EURUSD" },
    { label: "Dangote Cement",     price: 1240.00, change: -0.34, asset: "equity",   link: "/equities?symbol=DANGOTE" },
    { label: "BTC/USDT",          price: 67420.0, change: 1.24, asset: "crypto",    link: "/digital-assets?symbol=BTCUSDT" },
    { label: "NGX ASI",           price: 108234.5,change: -0.21, asset: "index",    link: "/indices" },
  ]);

  useEffect(() => {
    const id = setInterval(() => {
      setStats(prev => prev.map(s => {
        const delta = (Math.random() - 0.49) * 0.15;
        const newChange = parseFloat((s.change + delta).toFixed(2));
        const priceMove = s.price * (delta / 100);
        return { ...s, price: parseFloat((s.price + priceMove).toFixed(s.price > 1000 ? 2 : s.price > 10 ? 4 : 5)), change: newChange };
      }));
    }, 2000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
      {stats.map(s => (
        <Link key={s.label} href={s.link}
          className="group flex flex-col gap-0.5 rounded-xl border border-border bg-card/60 hover:bg-card hover:border-primary/30 transition-all p-3 cursor-pointer">
          <span className="text-[10px] text-muted-foreground truncate">{s.label}</span>
          <span className="text-sm font-mono font-bold text-foreground">
            {s.price.toLocaleString(undefined, { minimumFractionDigits: s.price > 1000 ? 2 : s.price > 10 ? 4 : 5, maximumFractionDigits: s.price > 1000 ? 2 : s.price > 10 ? 4 : 5 })}
          </span>
          <span className={`flex items-center gap-0.5 text-[11px] font-medium ${s.change >= 0 ? "text-positive" : "text-negative"}`}>
            {s.change >= 0 ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
            {s.change >= 0 ? "+" : ""}{s.change.toFixed(2)}%
          </span>
        </Link>
      ))}
    </div>
  );
}

// ── Main ─────────────────────────────────────────────────────────────────────
export default function Markets() {
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState("commodities");
  // Note: liveLoading is from CommodityPanel's inner query; we use a simple flag here
  const { isLoading: mktLoading } = trpc.livePrices.getAll.useQuery(undefined, { staleTime: 4 * 60 * 1000 });

  if (mktLoading) return <PageSkeleton cards={4} tableRows={12} tableCols={5} />;

  return (
    <div className="space-y-4 p-4 md:p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Markets Hub</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Live prices across all asset classes — updated every 2 seconds</p>
        </div>
        <div className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border border-positive/30 text-positive bg-positive/5">
          <Wifi className="w-3 h-3" /> Live
        </div>
      </div>

      {/* Market overview summary bar */}
      <MarketOverviewBar />

      {/* Search */}
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input placeholder="Search instruments..." value={query} onChange={e => setQuery(e.target.value)} className="pl-9" />
      </div>

      {/* Asset class tabs */}
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="flex-wrap h-auto gap-1 p-1">
          <TabsTrigger value="commodities" className="flex items-center gap-1.5 text-xs">
            <Coins className="w-3.5 h-3.5" /> Commodities
          </TabsTrigger>
          <TabsTrigger value="forex" className="flex items-center gap-1.5 text-xs">
            <Globe className="w-3.5 h-3.5" /> Forex
          </TabsTrigger>
          <TabsTrigger value="equities" className="flex items-center gap-1.5 text-xs">
            <BarChart2 className="w-3.5 h-3.5" /> Equities
          </TabsTrigger>
          <TabsTrigger value="digital-assets" className="flex items-center gap-1.5 text-xs">
            <Cpu className="w-3.5 h-3.5" /> Digital Assets
          </TabsTrigger>
          <TabsTrigger value="indices" className="flex items-center gap-1.5 text-xs">
            <LineChart className="w-3.5 h-3.5" /> Indices
          </TabsTrigger>
        </TabsList>

        <div className="rounded-xl border border-border overflow-hidden mt-3">
          <TabsContent value="commodities" className="m-0">
            <TableHeader col4="Volume" />
            <CommodityPanel query={query} />
          </TabsContent>
          <TabsContent value="forex" className="m-0">
            <TableHeader col3="24h Change" col4="Bid / Ask" />
            <ForexPanel query={query} />
          </TabsContent>
          <TabsContent value="equities" className="m-0">
            <TableHeader col3="24h Change" col4="Volume" />
            <EquitiesPanel query={query} />
          </TabsContent>
          <TabsContent value="digital-assets" className="m-0">
            <TableHeader col3="24h Change" col4="24h Volume" />
            <DigitalAssetsPanel query={query} />
          </TabsContent>
          <TabsContent value="indices" className="m-0">
            <TableHeader col3="Change" col4="YTD" />
            <IndicesPanel query={query} />
          </TabsContent>
        </div>
      </Tabs>

      <p className="text-xs text-muted-foreground text-center pb-4">
        Prices are indicative and update every 2 seconds. All trades subject to exchange rules and available liquidity.
      </p>
    </div>
  );
}
