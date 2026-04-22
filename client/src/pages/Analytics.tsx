/**
 * NEXCOM Exchange — Analytics
 * Exchange-wide KPIs, volume trends, top movers, and sector breakdown
 */
import { useState, useEffect, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { PageSkeleton } from "@/components/PageSkeleton";
import { BarChart2, TrendingUp, TrendingDown, Activity, Users, DollarSign, Globe, Zap, MapPin, RefreshCw } from "lucide-react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import OSMMap from "@/components/OSMMap";

interface FarmCluster {
  cluster_id: number;
  centroid_lat: number;
  centroid_lng: number;
  farm_count: number;
  total_area_ha: number;
  states: string[];
}

interface KPI {
  label: string;
  value: string;
  change: string;
  up: boolean;
  icon: React.ElementType;
}

interface VolumeBar {
  label: string;
  value: number;
  max: number;
  color: string;
}

interface TopMover {
  symbol: string;
  name: string;
  price: number;
  changePct: number;
  volume: number;
  category: string;
}

interface SectorData {
  sector: string;
  volume: number;
  trades: number;
  pct: number;
  change: number;
}

const KPIS: KPI[] = [
  { label: "Total Daily Volume",   value: "$284.2M",  change: "+12.4%",  up: true,  icon: DollarSign },
  { label: "Active Traders",       value: "4,820",    change: "+8.2%",   up: true,  icon: Users },
  { label: "Trades Executed",      value: "18,420",   change: "+15.8%",  up: true,  icon: Activity },
  { label: "Open Interest",        value: "$1.84B",   change: "+4.2%",   up: true,  icon: TrendingUp },
  { label: "New Registrations",    value: "142",      change: "+22.4%",  up: true,  icon: Globe },
  { label: "Avg Trade Size",       value: "$15,420",  change: "-2.1%",   up: false, icon: BarChart2 },
  { label: "Market Makers Active", value: "9",        change: "0%",      up: true,  icon: Zap },
  { label: "Compliance Alerts",    value: "7",        change: "+3",      up: false, icon: Activity },
];

const VOLUME_BARS_DAILY: VolumeBar[] = [
  { label: "Mon", value: 218, max: 300, color: "bg-primary" },
  { label: "Tue", value: 264, max: 300, color: "bg-primary" },
  { label: "Wed", value: 198, max: 300, color: "bg-primary" },
  { label: "Thu", value: 284, max: 300, color: "bg-primary" },
  { label: "Fri", value: 240, max: 300, color: "bg-primary" },
  { label: "Sat", value: 84,  max: 300, color: "bg-primary/50" },
  { label: "Sun", value: 48,  max: 300, color: "bg-primary/50" },
];

const VOLUME_BARS_MONTHLY: VolumeBar[] = [
  { label: "Jul", value: 1840, max: 3000, color: "bg-primary" },
  { label: "Aug", value: 2180, max: 3000, color: "bg-primary" },
  { label: "Sep", value: 1980, max: 3000, color: "bg-primary" },
  { label: "Oct", value: 2480, max: 3000, color: "bg-primary" },
  { label: "Nov", value: 2840, max: 3000, color: "bg-primary" },
  { label: "Dec", value: 2120, max: 3000, color: "bg-primary" },
  { label: "Jan", value: 2640, max: 3000, color: "bg-primary" },
  { label: "Feb", value: 2980, max: 3000, color: "bg-primary" },
  { label: "Mar", value: 1240, max: 3000, color: "bg-primary/60" },
];

const TOP_GAINERS: TopMover[] = [
  { symbol: "GINGER",    name: "Dried Ginger",      price: 2840,  changePct: 8.03,  volume: 4800000,  category: "Spices" },
  { symbol: "TSPICE",    name: "Tokenized Spices",  price: 1.82,  changePct: 6.42,  volume: 2400000,  category: "Digital" },
  { symbol: "COPPER",    name: "Copper",            price: 9840,  changePct: 4.18,  volume: 8200000,  category: "Metals" },
  { symbol: "SESAME",    name: "Sesame Seeds",      price: 1240,  changePct: 3.84,  volume: 2100000,  category: "Oilseeds" },
  { symbol: "NVDA",      name: "NVIDIA Corp.",      price: 882.5, changePct: 3.42,  volume: 42800000, category: "Equities" },
  { symbol: "GOLD",      name: "Gold",              price: 2842,  changePct: 2.84,  volume: 18400000, category: "Metals" },
  { symbol: "COCOA",     name: "Cocoa Beans",       price: 9840,  changePct: 2.14,  volume: 12400000, category: "Soft" },
];

const TOP_LOSERS: TopMover[] = [
  { symbol: "PALM-OIL",  name: "Palm Oil",          price: 1656,  changePct: -10.0, volume: 6800000,  category: "Oilseeds" },
  { symbol: "COTTON",    name: "Cotton",            price: 1480,  changePct: -4.82, volume: 3200000,  category: "Soft" },
  { symbol: "NATURAL-GAS",name: "Natural Gas",      price: 2.84,  changePct: -3.42, volume: 14200000, category: "Energy" },
  { symbol: "TSLA",      name: "Tesla Inc.",        price: 194.2, changePct: -2.84, volume: 89500000, category: "Equities" },
  { symbol: "WHEAT",     name: "Wheat",             price: 5.48,  changePct: -2.18, volume: 8400000,  category: "Grains" },
  { symbol: "RUBBER",    name: "Natural Rubber",    price: 2840,  changePct: -1.84, volume: 1800000,  category: "Soft" },
  { symbol: "SORGHUM",   name: "Sorghum",           price: 184,   changePct: -1.42, volume: 4200000,  category: "Grains" },
];

const SECTORS: SectorData[] = [
  { sector: "Grains & Cereals",    volume: 68400000,  trades: 4820, pct: 24.1, change: 8.4 },
  { sector: "Oilseeds",            volume: 48200000,  trades: 3240, pct: 17.0, change: 12.8 },
  { sector: "Energy",              volume: 52400000,  trades: 2180, pct: 18.4, change: -2.4 },
  { sector: "Metals",              volume: 38400000,  trades: 2840, pct: 13.5, change: 18.2 },
  { sector: "Soft Commodities",    volume: 28400000,  trades: 1840, pct: 10.0, change: 22.4 },
  { sector: "Equities (NGX/NYSE)", volume: 24200000,  trades: 1620, pct: 8.5,  change: 4.2 },
  { sector: "Forex",               volume: 14800000,  trades: 1280, pct: 5.2,  change: -1.8 },
  { sector: "Digital Assets",      volume: 8400000,   trades: 840,  pct: 3.0,  change: 28.4 },
  { sector: "Livestock",           volume: 1200000,   trades: 280,  pct: 0.4,  change: -4.2 },
];

const SECTOR_COLORS = [
  "bg-primary", "bg-blue-500", "bg-yellow-500", "bg-orange-500",
  "bg-purple-500", "bg-cyan-500", "bg-green-500", "bg-pink-500", "bg-red-500",
];

function BarChart({ data, height = 120 }: { data: VolumeBar[]; height?: number }) {
  const max = Math.max(...data.map(d => d.value));
  return (
    <div className="flex items-end gap-2" style={{ height }}>
      {data.map((bar, i) => (
        <div key={i} className="flex-1 flex flex-col items-center gap-1">
          <div className="w-full flex flex-col justify-end" style={{ height: height - 20 }}>
            <div
              className={`w-full rounded-t-sm transition-all ${bar.color}`}
              style={{ height: `${(bar.value / max) * 100}%` }}
            />
          </div>
          <span className="text-[10px] text-muted-foreground">{bar.label}</span>
        </div>
      ))}
    </div>
  );
}

export default function Analytics() {
  const [period, setPeriod] = useState("daily");
  const [tab, setTab] = useState("overview");
  const [tick, setTick] = useState(0);

  // Real data from analytics router
  const { data: summary, isLoading: summaryLoading, error: summaryError } = trpc.analytics.summary.useQuery();
  const { data: topSymbols, isLoading: symbolsLoading } = trpc.analytics.topSymbols.useQuery({ limit: 10 });
  const { data: volumeByAsset, isLoading: volumeLoading } = trpc.analytics.volumeByAssetClass.useQuery();
  const isLoading = summaryLoading || symbolsLoading || volumeLoading;

  // Build live KPIs from real data, falling back to static values when DB unavailable
  const liveKpis = useMemo<KPI[]>(() => [
    { label: "Total Orders",          value: summary ? summary.totalOrders.toLocaleString() : "—",     change: "+", up: true,  icon: Activity },
    { label: "Active Users",          value: summary ? summary.totalUsers.toLocaleString() : "—",      change: "+", up: true,  icon: Users },
    { label: "Filled Trades",         value: summary ? summary.filledOrders.toLocaleString() : "—",    change: "+", up: true,  icon: TrendingUp },
    { label: "Total Volume (filled)", value: summary ? `$${(Number(summary.totalVolume)/1e6).toFixed(1)}M` : "—", change: "+", up: true, icon: DollarSign },
    { label: "Warehouse Receipts",    value: summary ? summary.totalReceipts.toLocaleString() : "—",   change: "+", up: true,  icon: Globe },
    { label: "Pending KYC",           value: summary ? summary.pendingKyc.toLocaleString() : "—",      change: "+", up: false, icon: BarChart2 },
    { label: "Market Makers Active",  value: "9",   change: "0%",  up: true,  icon: Zap },
    { label: "Compliance Alerts",     value: "7",   change: "+3",  up: false, icon: Activity },
  ], [summary]);

  // Build volume by asset class bars from real data
  const assetVolumeBars = useMemo<VolumeBar[]>(() => {
    if (!volumeByAsset || volumeByAsset.length === 0) return VOLUME_BARS_DAILY;
    const maxVal = Math.max(...volumeByAsset.map(v => Number(v.totalVolume)));
    return volumeByAsset.map(v => ({
      label: v.assetClass?.replace("_", " ") ?? "",
      value: Number(v.totalVolume),
      max: maxVal || 1,
      color: "bg-primary",
    }));
  }, [volumeByAsset]);

  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 5000);
    return () => clearInterval(id);
  }, []);

  if (isLoading) return <PageSkeleton cards={4} tableRows={8} tableCols={4} showChart />;

  return (
    <div className="page-container space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2" style={{ fontFamily: "'DM Serif Display', serif" }}>
            <BarChart2 className="w-6 h-6 text-primary" />
            Analytics
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">Exchange-wide KPIs, volume trends, and market intelligence</p>
        </div>
        <Select value={period} onValueChange={setPeriod}>
          <SelectTrigger className="w-32 h-9"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="daily">Today</SelectItem>
            <SelectItem value="weekly">This Week</SelectItem>
            <SelectItem value="monthly">This Month</SelectItem>
            <SelectItem value="ytd">YTD</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* KPI Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {liveKpis.map(kpi => (
          <div key={kpi.label} className="stat-card">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-muted-foreground">{kpi.label}</span>
              <kpi.icon className="w-4 h-4 text-primary" />
            </div>
            <div className="text-xl font-bold font-mono text-foreground">{kpi.value}</div>
            <div className={`text-xs font-mono mt-1 ${kpi.up ? "text-positive" : "text-negative"}`}>{kpi.change} vs yesterday</div>
          </div>
        ))}
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="movers">Top Movers</TabsTrigger>
          <TabsTrigger value="sectors">Sector Breakdown</TabsTrigger>
          <TabsTrigger value="farmclusters">Farm Clusters</TabsTrigger>
        </TabsList>

        {/* Overview */}
        <div className={tab === "overview" ? "block mt-4" : "hidden"}>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            {/* Volume Chart */}
            <div className="stat-card">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-semibold text-foreground">Trading Volume</h3>
                <span className="text-xs text-muted-foreground">{period === "daily" ? "This Week" : "Last 9 Months"}</span>
              </div>
              <BarChart data={period === "daily" ? assetVolumeBars : VOLUME_BARS_MONTHLY} height={140} />
              <div className="mt-3 flex justify-between text-xs text-muted-foreground">
                <span>Total: <span className="text-foreground font-semibold">$284.2M</span></span>
                <span>Avg: <span className="text-foreground font-semibold">$40.6M/day</span></span>
                <span>Peak: <span className="text-foreground font-semibold">$284.2M</span></span>
              </div>
            </div>

            {/* Sector Pie (simplified) */}
            <div className="stat-card">
              <h3 className="font-semibold text-foreground mb-4">Volume by Sector</h3>
              <div className="space-y-2">
                {SECTORS.slice(0, 6).map((s, i) => (
                  <div key={s.sector} className="flex items-center gap-3">
                    <div className={`w-3 h-3 rounded-sm flex-shrink-0 ${SECTOR_COLORS[i]}`} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between mb-0.5">
                        <span className="text-xs text-foreground truncate">{s.sector}</span>
                        <span className="text-xs font-mono text-muted-foreground ml-2">{s.pct}%</span>
                      </div>
                      <div className="w-full h-1.5 bg-secondary rounded-full overflow-hidden">
                        <div className={`h-full rounded-full ${SECTOR_COLORS[i]}`} style={{ width: `${s.pct}%` }} />
                      </div>
                    </div>
                    <span className={`text-xs font-mono flex-shrink-0 ${s.change >= 0 ? "text-positive" : "text-negative"}`}>
                      {s.change >= 0 ? "+" : ""}{s.change}%
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Live Stats */}
            <div className="stat-card">
              <h3 className="font-semibold text-foreground mb-4">Live Exchange Stats</h3>
              <div className="grid grid-cols-2 gap-3">
                {[
                  { label: "Orders/min",    value: `${(42 + tick % 8).toString()}` },
                  { label: "Trades/min",    value: `${(18 + tick % 5).toString()}` },
                  { label: "Active Sessions",value: `${(284 + tick % 12).toString()}` },
                  { label: "Pending Orders",value: `${(1840 + tick % 20).toString()}` },
                  { label: "Bid-Ask Spread",value: "0.24%" },
                  { label: "Market Depth",  value: "$48.2M" },
                ].map(({ label, value }) => (
                  <div key={label} className="bg-secondary/50 rounded-lg p-3">
                    <div className="text-xs text-muted-foreground">{label}</div>
                    <div className="font-mono text-lg font-bold text-foreground mt-0.5">{value}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Geographic Distribution */}
            <div className="stat-card">
              <h3 className="font-semibold text-foreground mb-4">Trader Geography</h3>
              <div className="space-y-3">
                {[
                  { country: "Nigeria",    pct: 68.4, traders: 3294 },
                  { country: "Ghana",      pct: 12.8, traders: 617 },
                  { country: "Senegal",    pct: 5.2,  traders: 251 },
                  { country: "Kenya",      pct: 4.8,  traders: 231 },
                  { country: "South Africa",pct: 3.4, traders: 164 },
                  { country: "Others",     pct: 5.4,  traders: 263 },
                ].map(({ country, pct, traders }) => (
                  <div key={country} className="flex items-center gap-3">
                    <span className="text-xs text-muted-foreground w-24 flex-shrink-0">{country}</span>
                    <div className="flex-1 h-2 bg-secondary rounded-full overflow-hidden">
                      <div className="h-full bg-primary rounded-full" style={{ width: `${pct}%` }} />
                    </div>
                    <span className="text-xs font-mono text-foreground w-12 text-right">{pct}%</span>
                    <span className="text-xs text-muted-foreground w-12 text-right">{traders.toLocaleString()}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Top Movers */}
        <div className={tab === "movers" ? "block mt-4" : "hidden"}>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            {/* Gainers */}
            <div className="rounded-xl border border-border overflow-hidden">
              <div className="px-4 py-3 border-b border-border bg-positive/5 flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-positive" />
                <h3 className="font-semibold text-positive text-sm">Top Gainers</h3>
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-secondary/50">
                    {["Symbol","Name","Price","Change","Volume"].map(h => (
                      <th key={h} className="text-left px-3 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {(topSymbols && topSymbols.length > 0 ? topSymbols.map(m => ({
                      symbol: m.symbol,
                      name: m.symbol,
                      price: 0,
                      changePct: 0,
                      volume: Number(m.totalVolume),
                      category: "",
                    })) : TOP_GAINERS).map(m => (
                    <tr key={m.symbol} className="hover:bg-secondary/30 transition-colors">
                      <td className="px-3 py-2.5 font-bold text-foreground">{m.symbol}</td>
                      <td className="px-3 py-2.5 text-xs text-muted-foreground">{m.name}</td>
                      <td className="px-3 py-2.5 font-mono text-sm">{m.price.toLocaleString()}</td>
                      <td className="px-3 py-2.5 font-mono text-sm text-positive">+{m.changePct.toFixed(2)}%</td>
                      <td className="px-3 py-2.5 text-xs text-muted-foreground">${(m.volume / 1e6).toFixed(1)}M</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Losers */}
            <div className="rounded-xl border border-border overflow-hidden">
              <div className="px-4 py-3 border-b border-border bg-negative/5 flex items-center gap-2">
                <TrendingDown className="w-4 h-4 text-negative" />
                <h3 className="font-semibold text-negative text-sm">Top Losers</h3>
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-secondary/50">
                    {["Symbol","Name","Price","Change","Volume"].map(h => (
                      <th key={h} className="text-left px-3 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {TOP_LOSERS.map(m => (
                    <tr key={m.symbol} className="hover:bg-secondary/30 transition-colors">
                      <td className="px-3 py-2.5 font-bold text-foreground">{m.symbol}</td>
                      <td className="px-3 py-2.5 text-xs text-muted-foreground">{m.name}</td>
                      <td className="px-3 py-2.5 font-mono text-sm">{m.price.toLocaleString()}</td>
                      <td className="px-3 py-2.5 font-mono text-sm text-negative">{m.changePct.toFixed(2)}%</td>
                      <td className="px-3 py-2.5 text-xs text-muted-foreground">${(m.volume / 1e6).toFixed(1)}M</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Sector Breakdown */}
        <div className={tab === "sectors" ? "block mt-4" : "hidden"}>
          <div className="rounded-xl border border-border overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-secondary/50">
                  {["Sector","Volume","Trades","Market Share","Change","Volume Bar"].map(h => (
                    <th key={h} className="text-left px-3 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {SECTORS.map((s, i) => (
                  <tr key={s.sector} className="hover:bg-secondary/30 transition-colors">
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-2">
                        <div className={`w-3 h-3 rounded-sm ${SECTOR_COLORS[i]}`} />
                        <span className="font-semibold text-foreground text-sm">{s.sector}</span>
                      </div>
                    </td>
                    <td className="px-3 py-3 font-mono text-sm text-foreground">${(s.volume / 1e6).toFixed(1)}M</td>
                    <td className="px-3 py-3 font-mono text-sm text-muted-foreground">{s.trades.toLocaleString()}</td>
                    <td className="px-3 py-3 font-mono text-sm text-foreground">{s.pct}%</td>
                    <td className={`px-3 py-3 font-mono text-sm ${s.change >= 0 ? "text-positive" : "text-negative"}`}>
                      {s.change >= 0 ? "+" : ""}{s.change}%
                    </td>
                    <td className="px-3 py-3 w-40">
                      <div className="w-full h-2 bg-secondary rounded-full overflow-hidden">
                        <div className={`h-full rounded-full ${SECTOR_COLORS[i]}`} style={{ width: `${s.pct * 4}%` }} />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        {/* Farm Clusters Heatmap */}
        <FarmClustersTab active={tab === "farmclusters"} />

      </Tabs>
    </div>
  );
}

function FarmClustersTab({ active }: { active: boolean }) {
  const [clusters, setClusters] = useState<FarmCluster[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedCluster, setSelectedCluster] = useState<FarmCluster | null>(null);

  useEffect(() => {
    if (!active) return;
    setLoading(true);
    setError(null);
    fetch("/api/spatial/clusters", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ num_clusters: 8 }),
    })
      .then(r => r.json())
      .then(data => {
        if (data.error) throw new Error(data.error);
        setClusters(data.clusters ?? []);
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [active]);

  if (!active) return null;

  return (
    <div className="mt-4 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-foreground flex items-center gap-2">
          <MapPin className="w-4 h-4 text-green-400" />
          Farm Supply Concentration Clusters
        </h3>
        <span className="text-xs text-muted-foreground">Powered by Apache Sedona · PostGIS</span>
      </div>

      {loading && (
        <div className="flex items-center gap-2 text-muted-foreground text-sm py-8 justify-center">
          <RefreshCw className="w-4 h-4 animate-spin" />
          Running spatial cluster analysis...
        </div>
      )}

      {error && (
        <div className="bg-red-950/30 border border-red-800/40 rounded-lg p-4 text-red-300 text-sm">
          Spatial analytics unavailable: {error}. Start the Sedona service with <code className="font-mono text-xs bg-red-900/40 px-1 rounded">pnpm sedona:start</code>.
        </div>
      )}

      {!loading && !error && clusters.length === 0 && (
        <div className="text-muted-foreground text-sm py-8 text-center">
          No farm location data available yet. Farmers must register farms with GPS coordinates.
        </div>
      )}

      {!loading && clusters.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Cluster list */}
          <div className="lg:col-span-1 space-y-2">
            <p className="text-xs text-muted-foreground uppercase tracking-wide font-semibold mb-2">{clusters.length} Clusters Detected</p>
            {clusters.map((c) => (
              <button
                key={c.cluster_id}
                onClick={() => setSelectedCluster(c)}
                className={`w-full text-left p-3 rounded-lg border transition-colors ${
                  selectedCluster?.cluster_id === c.cluster_id
                    ? "bg-green-900/40 border-green-700 text-green-200"
                    : "bg-card border-border hover:bg-accent text-foreground"
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">Cluster {c.cluster_id + 1}</span>
                  <span className="text-xs px-2 py-0.5 rounded-full bg-green-900/40 text-green-300 border border-green-800">
                    {c.farm_count} farm{c.farm_count !== 1 ? 's' : ''}
                  </span>
                </div>
                <div className="text-xs text-muted-foreground mt-1">
                  {c.total_area_ha.toFixed(1)} ha total · {c.states.slice(0, 2).join(", ")}{c.states.length > 2 ? ` +${c.states.length - 2}` : ""}
                </div>
                <div className="text-xs font-mono text-muted-foreground mt-0.5">
                  {c.centroid_lat.toFixed(4)}, {c.centroid_lng.toFixed(4)}
                </div>
              </button>
            ))}
          </div>

          {/* Map showing selected cluster or first cluster */}
          <div className="lg:col-span-2">
            {(selectedCluster ?? clusters[0]) && (
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">
                  Cluster {(selectedCluster ?? clusters[0]).cluster_id + 1} centroid — {(selectedCluster ?? clusters[0]).farm_count} farms,{" "}
                  {(selectedCluster ?? clusters[0]).total_area_ha.toFixed(1)} ha,{" "}
                  {(selectedCluster ?? clusters[0]).states.join(", ")}
                </p>
                <OSMMap
                  initialPin={{
                    lat: (selectedCluster ?? clusters[0]).centroid_lat,
                    lng: (selectedCluster ?? clusters[0]).centroid_lng,
                  }}
                  readonly={true}
                  height="380px"
                />
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
