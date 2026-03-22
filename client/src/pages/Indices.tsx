/**
 * NEXCOM Exchange — Market Indices
 * NEXCOM proprietary indices, global benchmarks, and sector indices
 */
import { useState, useEffect } from "react";
import { BarChart2, TrendingUp, TrendingDown, Activity } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";

interface IndexData {
  id: string;
  name: string;
  shortName: string;
  value: number;
  change: number;
  changePct: number;
  ytdPct: number;
  high52w: number;
  low52w: number;
  description: string;
  category: "NEXCOM" | "GLOBAL" | "SECTOR";
  currency: string;
  constituents?: string[];
}

const INDICES: IndexData[] = [
  { id: "NCI",   name: "NEXCOM Commodity Index",       shortName: "NCI",   value: 4218.50, change: 28.40,  changePct: 0.68,  ytdPct: 12.4,  high52w: 4380.20, low52w: 3210.80, description: "Broad-based index of all commodities traded on NEXCOM Exchange", category: "NEXCOM", currency: "USD", constituents: ["MAIZE","COCOA","GINGER","SOYBEAN","GROUNDNUT","CRUDE-OIL","GOLD","COPPER"] },
  { id: "NAI",   name: "NEXCOM Agri Index",             shortName: "NAI",   value: 2840.20, change: 18.60,  changePct: 0.66,  ytdPct: 9.8,   high52w: 2950.40, low52w: 2180.60, description: "Agricultural commodities — grains, oilseeds, spices, soft commodities", category: "NEXCOM", currency: "USD", constituents: ["MAIZE","WHEAT","SOYBEAN","COCOA","COFFEE","GINGER","GROUNDNUT"] },
  { id: "NEI",   name: "NEXCOM Energy Index",           shortName: "NEI",   value: 1580.40, change: -12.80, changePct: -0.80, ytdPct: 4.2,   high52w: 1720.80, low52w: 1280.20, description: "Energy commodities — crude oil, natural gas, coal, diesel", category: "NEXCOM", currency: "USD", constituents: ["CRUDE-OIL","NATURAL-GAS","COAL","DIESEL"] },
  { id: "NMI",   name: "NEXCOM Metals Index",           shortName: "NMI",   value: 3120.80, change: 42.60,  changePct: 1.38,  ytdPct: 18.2,  high52w: 3280.40, low52w: 2420.60, description: "Precious and industrial metals — gold, silver, copper, tin, iron ore", category: "NEXCOM", currency: "USD", constituents: ["GOLD","SILVER","COPPER","TIN","IRON-ORE"] },
  { id: "NLI",   name: "NEXCOM Livestock Index",        shortName: "NLI",   value: 980.20,  change: 4.80,   changePct: 0.49,  ytdPct: 3.1,   high52w: 1020.40, low52w: 820.80,  description: "Livestock and fisheries — cattle, goat, poultry, fish", category: "NEXCOM", currency: "USD", constituents: ["CATTLE","GOAT","POULTRY","TILAPIA"] },
  { id: "NGX",   name: "NGX All Share Index",           shortName: "NGX ASI",value: 108234.50,change: -228.40,changePct: -0.21, ytdPct: 28.4,  high52w: 112480.20,low52w: 72840.60,description: "Nigerian Stock Exchange All Share Index", category: "GLOBAL", currency: "NGN" },
  { id: "SP500", name: "S&P 500",                       shortName: "S&P 500",value: 5842.18, change: 24.40,  changePct: 0.42,  ytdPct: 6.8,   high52w: 6120.80, low52w: 4820.40, description: "Standard & Poor's 500 large-cap US equities", category: "GLOBAL", currency: "USD" },
  { id: "NDX",   name: "NASDAQ Composite",              shortName: "NASDAQ", value: 18421.31,change: 124.80, changePct: 0.68,  ytdPct: 8.2,   high52w: 19480.20,low52w: 14820.60,description: "Technology-heavy US stock market index", category: "GLOBAL", currency: "USD" },
  { id: "DJIA",  name: "Dow Jones Industrial Average",  shortName: "DJIA",  value: 43218.40, change: 132.80, changePct: 0.31,  ytdPct: 4.1,   high52w: 45120.80,low52w: 37480.20,description: "30 large US blue-chip companies", category: "GLOBAL", currency: "USD" },
  { id: "GSCI",  name: "S&P GSCI Commodity Index",      shortName: "GSCI",  value: 548.20,   change: 3.80,   changePct: 0.70,  ytdPct: 5.4,   high52w: 580.40,  low52w: 480.20,  description: "World production-weighted commodity index", category: "GLOBAL", currency: "USD" },
  { id: "BCOM",  name: "Bloomberg Commodity Index",     shortName: "BCOM",  value: 102.84,   change: 0.62,   changePct: 0.61,  ytdPct: 4.8,   high52w: 108.40,  low52w: 92.80,   description: "Diversified commodity index by Bloomberg", category: "GLOBAL", currency: "USD" },
  { id: "CRB",   name: "Thomson Reuters CRB Index",     shortName: "CRB",   value: 284.80,   change: 1.80,   changePct: 0.64,  ytdPct: 6.2,   high52w: 298.40,  low52w: 248.20,  description: "Commodity Research Bureau futures price index", category: "GLOBAL", currency: "USD" },
  { id: "FTSE",  name: "FTSE 100",                      shortName: "FTSE",  value: 8482.40,  change: -18.20, changePct: -0.21, ytdPct: 2.8,   high52w: 8820.40, low52w: 7480.20, description: "100 largest UK-listed companies", category: "GLOBAL", currency: "GBP" },
  { id: "NKEI",  name: "Nikkei 225",                    shortName: "Nikkei",value: 38420.80, change: 280.40, changePct: 0.73,  ytdPct: 7.4,   high52w: 41480.20,low52w: 31820.60,description: "225 largest Japanese companies", category: "GLOBAL", currency: "JPY" },
  { id: "NGRAIN",name: "NEXCOM Grains Sector Index",    shortName: "NGrains",value: 1820.40, change: 12.80,  changePct: 0.71,  ytdPct: 8.4,   high52w: 1920.80, low52w: 1480.20, description: "Grains and cereals sector — maize, wheat, rice, sorghum", category: "SECTOR", currency: "USD" },
  { id: "NOIL",  name: "NEXCOM Oilseeds Sector Index",  shortName: "NOilseeds",value: 2180.40,change: 24.80, changePct: 1.15,  ytdPct: 14.2,  high52w: 2280.40, low52w: 1720.60, description: "Oilseeds sector — soybean, groundnut, sesame, palm oil", category: "SECTOR", currency: "USD" },
  { id: "NSOFT", name: "NEXCOM Soft Commodities Index", shortName: "NSoft", value: 3480.20,  change: -28.40, changePct: -0.81, ytdPct: 22.4,  high52w: 3820.40, low52w: 2480.60, description: "Soft commodities — cocoa, coffee, cotton, sugar, tobacco", category: "SECTOR", currency: "USD" },
  { id: "NSPICE",name: "NEXCOM Spices Sector Index",    shortName: "NSpices",value: 2840.80, change: 48.40,  changePct: 1.73,  ytdPct: 28.4,  high52w: 2980.40, low52w: 1820.60, description: "Spices sector — ginger, pepper, chili, turmeric, cloves", category: "SECTOR", currency: "USD" },
];

function Sparkline({ up }: { up: boolean }) {
  const points = Array.from({ length: 20 }, (_, i) => {
    const base = 50;
    const trend = up ? i * 1.5 : -i * 1.5;
    const noise = (Math.random() - 0.5) * 15;
    return Math.max(5, Math.min(95, base + trend + noise));
  });
  const path = points.map((y, x) => `${x === 0 ? "M" : "L"} ${(x / 19) * 100} ${y}`).join(" ");
  return (
    <svg viewBox="0 0 100 100" className="w-20 h-8" preserveAspectRatio="none">
      <path d={path} fill="none" stroke={up ? "#22c55e" : "#ef4444"} strokeWidth="2.5" />
    </svg>
  );
}

function IndexCard({ idx }: { idx: IndexData }) {
  const up = idx.changePct >= 0;
  return (
    <div className="stat-card hover:border-primary/30 transition-colors cursor-pointer">
      <div className="flex items-start justify-between mb-3">
        <div>
          <div className="font-semibold text-foreground text-sm">{idx.shortName}</div>
          <div className="text-xs text-muted-foreground mt-0.5 max-w-[160px] truncate">{idx.name}</div>
        </div>
        <Sparkline up={up} />
      </div>
      <div className="flex items-end justify-between">
        <div>
          <div className="font-mono text-xl font-bold text-foreground">{idx.value.toLocaleString()}</div>
          <div className={`text-sm font-mono mt-0.5 ${up ? "text-positive" : "text-negative"}`}>
            {up ? "▲" : "▼"} {Math.abs(idx.changePct).toFixed(2)}%
          </div>
        </div>
        <div className="text-right text-xs">
          <div className="text-muted-foreground">YTD</div>
          <div className={`font-mono font-semibold ${idx.ytdPct >= 0 ? "text-positive" : "text-negative"}`}>
            {idx.ytdPct >= 0 ? "+" : ""}{idx.ytdPct.toFixed(1)}%
          </div>
        </div>
      </div>
    </div>
  );
}

export default function Indices() {
  const [tab, setTab] = useState("NEXCOM");
  const [indices, setIndices] = useState(INDICES);

  // Fetch live index values from the database and merge with static metadata
  const { data: liveIndices } = trpc.marketData.indices.useQuery(undefined, {
    refetchInterval: 10_000,
  });

  // Merge live data into state when it arrives
  useEffect(() => {
    if (!liveIndices || !Array.isArray(liveIndices) || liveIndices.length === 0) return;
    setIndices(prev => prev.map(idx => {
      const live = liveIndices.find((l) => (l as any).id === idx.id || (l as any).symbol === idx.id);
      if (!live) return idx;
      const l = live as any;
      return {
        ...idx,
        value: typeof l.value === 'number' ? l.value : idx.value,
        change: typeof l.change === 'number' ? l.change : idx.change,
        changePct: typeof l.changePct === 'number' ? l.changePct : idx.changePct,
      };
    }));
  }, [liveIndices]);

  // Fallback: simulate live ticks when no server data
  useEffect(() => {
    if (liveIndices && Array.isArray(liveIndices) && liveIndices.length > 0) return;
    const id = setInterval(() => {
      setIndices(prev => prev.map(idx => {
        const noise = (Math.random() - 0.5) * idx.value * 0.003;
        return { ...idx, value: idx.value + noise, change: noise, changePct: (noise / idx.value) * 100 };
      }));
    }, 4000);
    return () => clearInterval(id);
  }, [liveIndices]);

  const filtered = indices.filter(i => i.category === tab);
  const best = [...filtered].sort((a, b) => b.changePct - a.changePct)[0];
  const worst = [...filtered].sort((a, b) => a.changePct - b.changePct)[0];

  return (
    <div className="page-container space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2" style={{ fontFamily: "'DM Serif Display', serif" }}>
            <BarChart2 className="w-6 h-6 text-primary" />
            Market Indices
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">NEXCOM proprietary indices, global benchmarks, and sector indices</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-positive animate-pulse" />
          <span className="text-xs text-positive font-medium">Live</span>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <div className="stat-card">
          <div className="text-xs text-muted-foreground mb-1">Best Performer</div>
          <div className="font-semibold text-foreground">{best?.shortName ?? "—"}</div>
          <div className="font-mono text-positive text-sm">+{best?.changePct.toFixed(2) ?? 0}%</div>
        </div>
        <div className="stat-card">
          <div className="text-xs text-muted-foreground mb-1">Worst Performer</div>
          <div className="font-semibold text-foreground">{worst?.shortName ?? "—"}</div>
          <div className="font-mono text-negative text-sm">{worst?.changePct.toFixed(2) ?? 0}%</div>
        </div>
        <div className="stat-card col-span-2 sm:col-span-1">
          <div className="text-xs text-muted-foreground mb-1">Indices Tracked</div>
          <div className="text-2xl font-bold font-mono text-foreground">{indices.length}</div>
          <div className="text-xs text-muted-foreground">{indices.filter(i => i.changePct >= 0).length} advancing</div>
        </div>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="NEXCOM">NEXCOM Indices</TabsTrigger>
          <TabsTrigger value="GLOBAL">Global Indices</TabsTrigger>
          <TabsTrigger value="SECTOR">Sector Indices</TabsTrigger>
        </TabsList>

        {["NEXCOM","GLOBAL","SECTOR"].map(cat => (
          <TabsContent key={cat} value={cat} className="mt-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {indices.filter(i => i.category === cat).map(idx => (
                <IndexCard key={idx.id} idx={idx} />
              ))}
            </div>

            {/* Detail Table */}
            <div className="mt-5 rounded-xl border border-border overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[600px]">
                  <thead>
                    <tr className="border-b border-border bg-secondary/50">
                      {["Index","Value","Change","Change %","YTD %","52W High","52W Low","Currency"].map(h => (
                        <th key={h} className="text-left px-3 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {indices.filter(i => i.category === cat).map(idx => (
                      <tr key={idx.id} className="hover:bg-secondary/30 transition-colors">
                        <td className="px-3 py-2.5">
                          <div className="font-semibold text-foreground text-sm">{idx.shortName}</div>
                          <div className="text-xs text-muted-foreground">{idx.name}</div>
                        </td>
                        <td className="px-3 py-2.5 font-mono text-sm font-semibold text-foreground">{idx.value.toLocaleString()}</td>
                        <td className={`px-3 py-2.5 font-mono text-sm ${idx.changePct >= 0 ? "text-positive" : "text-negative"}`}>
                          {idx.changePct >= 0 ? "+" : ""}{idx.change.toFixed(2)}
                        </td>
                        <td className={`px-3 py-2.5 font-mono text-sm ${idx.changePct >= 0 ? "text-positive" : "text-negative"}`}>
                          {idx.changePct >= 0 ? "+" : ""}{idx.changePct.toFixed(2)}%
                        </td>
                        <td className={`px-3 py-2.5 font-mono text-sm ${idx.ytdPct >= 0 ? "text-positive" : "text-negative"}`}>
                          {idx.ytdPct >= 0 ? "+" : ""}{idx.ytdPct.toFixed(1)}%
                        </td>
                        <td className="px-3 py-2.5 font-mono text-xs text-muted-foreground">{idx.high52w.toLocaleString()}</td>
                        <td className="px-3 py-2.5 font-mono text-xs text-muted-foreground">{idx.low52w.toLocaleString()}</td>
                        <td className="px-3 py-2.5 text-xs text-muted-foreground">{idx.currency}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
