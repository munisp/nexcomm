/**
 * NEXCOM Exchange — Home / Landing Page
 * Entry point for authenticated users: quick-access tiles, live market snapshot, and onboarding CTA
 */
import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { trpc } from "@/lib/trpc";
import { getLoginUrl } from "@/const";
import { Link } from "wouter";
import {
  TrendingUp, Wheat, Warehouse, BarChart3, ArrowRight,
  ShieldCheck, Zap, Globe, Users, ChevronRight, Loader2,
  Package, FileText, Bell, Settings
} from "lucide-react";

const QUICK_LINKS = [
  { icon: TrendingUp,  label: "Trade",       href: "/trade",         color: "text-primary",    bg: "bg-primary/10" },
  { icon: BarChart3,   label: "Markets",      href: "/markets",       color: "text-blue-400",   bg: "bg-blue-400/10" },
  { icon: Wheat,       label: "My Portfolio", href: "/portfolio",     color: "text-yellow-400", bg: "bg-yellow-400/10" },
  { icon: Package,     label: "Orders",       href: "/orders",        color: "text-purple-400", bg: "bg-purple-400/10" },
  { icon: Warehouse,   label: "Warehouses",   href: "/warehouses",    color: "text-orange-400", bg: "bg-orange-400/10" },
  { icon: FileText,    label: "Deposits",     href: "/deposits",      color: "text-teal-400",   bg: "bg-teal-400/10" },
  { icon: Bell,        label: "Alerts",       href: "/alerts",        color: "text-red-400",    bg: "bg-red-400/10" },
  { icon: Settings,    label: "Settings",     href: "/settings",      color: "text-gray-400",   bg: "bg-gray-400/10" },
];

const FEATURES = [
  { icon: Zap,         title: "Instant Settlement",   desc: "T+0 settlement via Mojaloop rails — funds clear in seconds, not days." },
  { icon: ShieldCheck, title: "Certified Warehouses", desc: "Grade A certified storage across 6 African countries with real-time inventory." },
  { icon: Globe,       title: "60+ Commodities",      desc: "Trade ginger, cocoa, maize, sesame, and more on a single unified platform." },
  { icon: Users,       title: "Multi-Stakeholder",    desc: "Farmers, traders, brokers, and warehouse operators on one exchange." },
];

function LiveMarketTicker() {
  const { data: liveData } = trpc.livePrices.getAll.useQuery(undefined, { refetchInterval: 3000 });
  const rows = (liveData?.prices ?? []).slice(0, 5);
  if (rows.length === 0) return null;
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-foreground">Live Prices</h3>
        <Link href="/markets">
          <span className="text-xs text-primary flex items-center gap-1 hover:underline cursor-pointer">
            View all <ChevronRight className="w-3 h-3" />
          </span>
        </Link>
      </div>
      <div className="space-y-2">
        {rows.map((row) => {
          const change = parseFloat(String(row.change ?? 0));
          const positive = change >= 0;
          return (
            <div key={row.symbol} className="flex items-center justify-between">
              <div>
                <span className="text-xs font-mono font-semibold text-foreground">{row.symbol}</span>
                <span className="text-[10px] text-muted-foreground ml-2">{(row.name ?? "").split(" ").slice(0, 2).join(" ")}</span>
              </div>
              <div className="text-right">
                <div className="text-xs font-mono font-bold text-foreground">
                  {Number(row.price ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </div>
                <div className={`text-[10px] font-mono ${positive ? "text-positive" : "text-negative"}`}>
                  {positive ? "+" : ""}{change.toFixed(2)}%
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function AuthenticatedHome({ name }: { name: string }) {
  return (
    <div className="page-container space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground" style={{ fontFamily: "'DM Serif Display', serif" }}>
          Welcome back, {name.split(" ")[0]}
        </h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Africa's premier commodity exchange — trade, deposit, and settle in real time.
        </p>
      </div>

      <div>
        <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Quick Access</h2>
        <div className="grid grid-cols-4 sm:grid-cols-8 gap-3">
          {QUICK_LINKS.map(link => (
            <Link key={link.href} href={link.href}>
              <div className="flex flex-col items-center gap-2 p-3 rounded-xl border border-border bg-card hover:border-primary/30 hover:bg-card/80 transition-all cursor-pointer group">
                <div className={`w-10 h-10 rounded-xl ${link.bg} flex items-center justify-center group-hover:scale-110 transition-transform`}>
                  <link.icon className={`w-5 h-5 ${link.color}`} />
                </div>
                <span className="text-[10px] text-muted-foreground text-center leading-tight">{link.label}</span>
              </div>
            </Link>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <LiveMarketTicker />
        <div className="rounded-xl border border-primary/20 bg-gradient-to-br from-primary/10 to-primary/5 p-5 flex flex-col justify-between">
          <div>
            <Badge className="mb-3 text-[10px] bg-primary/20 text-primary border-primary/30">
              <Zap className="w-3 h-3 mr-1" />Live Trading
            </Badge>
            <h3 className="text-lg font-bold text-foreground" style={{ fontFamily: "'DM Serif Display', serif" }}>
              Start Trading Commodities
            </h3>
            <p className="text-xs text-muted-foreground mt-1">
              Access 60+ commodities with real-time price feeds, limit and market orders, and T+0 settlement.
            </p>
          </div>
          <div className="flex gap-2 mt-4">
            <Link href="/trade">
              <Button size="sm" className="gap-2">
                <TrendingUp className="w-4 h-4" />Open Terminal
              </Button>
            </Link>
            <Link href="/markets">
              <Button size="sm" variant="outline" className="gap-2">
                <BarChart3 className="w-4 h-4" />View Markets
              </Button>
            </Link>
          </div>
        </div>
      </div>

      <div>
        <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Platform Features</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {FEATURES.map(f => (
            <div key={f.title} className="rounded-xl border border-border bg-card p-4">
              <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center mb-3">
                <f.icon className="w-4 h-4 text-primary" />
              </div>
              <h4 className="text-sm font-semibold text-foreground">{f.title}</h4>
              <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{f.desc}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-xl border border-border bg-card p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h3 className="text-sm font-semibold text-foreground">New to NEXCOM?</h3>
          <p className="text-xs text-muted-foreground mt-0.5">Register as a farmer, trader, broker, or warehouse operator to access the full platform.</p>
        </div>
        <Link href="/join">
          <Button size="sm" variant="outline" className="gap-2 whitespace-nowrap">
            Get Started <ArrowRight className="w-4 h-4" />
          </Button>
        </Link>
      </div>
    </div>
  );
}

function UnauthenticatedHome() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4 py-16 text-center bg-background">
      <div className="max-w-xl">
        <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-6">
          <Wheat className="w-8 h-8 text-primary" />
        </div>
        <h1 className="text-4xl font-bold text-foreground mb-3" style={{ fontFamily: "'DM Serif Display', serif" }}>
          NEXCOM Exchange
        </h1>
        <p className="text-muted-foreground text-lg mb-2">Africa's Premier Commodity Exchange</p>
        <p className="text-sm text-muted-foreground mb-8">
          Trade ginger, cocoa, maize, and 60+ commodities with real-time price feeds, certified warehouse receipts, and instant T+0 settlement.
        </p>
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <Button size="lg" className="gap-2" onClick={() => { window.location.href = getLoginUrl(); }}>
            <TrendingUp className="w-5 h-5" />Sign In to Trade
          </Button>
          <Link href="/join">
            <Button size="lg" variant="outline" className="gap-2">
              <Users className="w-5 h-5" />Register as Stakeholder
            </Button>
          </Link>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-12">
          {FEATURES.map(f => (
            <div key={f.title} className="text-center">
              <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center mx-auto mb-2">
                <f.icon className="w-5 h-5 text-primary" />
              </div>
              <div className="text-xs font-semibold text-foreground">{f.title}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function Home() {
  const { user, loading, isAuthenticated } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!isAuthenticated || !user) {
    return <UnauthenticatedHome />;
  }

  return <AuthenticatedHome name={user.name || user.openId || "Trader"} />;
}
