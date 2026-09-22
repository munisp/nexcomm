/**
 * NEXCOM Exchange — Main Layout
 * Dark emerald design system: sidebar + header + live ticker
 * All 22 pages across 6 navigation groups
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useLocation } from "wouter";
import {
  LayoutDashboard, TrendingUp, ShoppingCart, FileText,
  Package, Warehouse, Briefcase, Truck,
  Menu, X, Bell, ChevronDown, LogOut, Settings, Sun, Moon,
  Shield, Activity, Zap, User,
  DollarSign, Cpu, BarChart2, Users, Eye,
  ClipboardList, BarChart, Star, Calendar, Globe, BellRing,
  Layers, Tractor, UserCheck, Sprout, BookOpen, Landmark, CreditCard, ShieldCheck
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { trpc } from "@/lib/trpc";
import { getLoginUrl } from "@/const";
import { PasskeyLoginButton } from "@/components/PasskeyLoginButton";
import { formatCompact } from "@/lib/format";
import { useOrderFillSSE } from "@/hooks/useOrderFillSSE";
import { useConnectionQuality } from "@/lib/connectionQuality";
import { tunedInterval, tunedStaleTime } from "@/lib/queryTuning";
import { useTheme } from "@/contexts/ThemeContext";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { PasskeyUpgradeBanner } from "@/components/PasskeyUpgradeBanner";
import { SyncStatusPill } from "@/components/SyncStatusPill";
import CopilotPanel from "@/components/CopilotPanel";
import { NAV_LABEL_KEYS } from "@/i18n/navLabels";

const NAV_GROUPS: { key: string; label: string; items: { href: string; icon: React.ElementType; label: string }[] }[] = [
  {
    key: "trading",
    label: "Overview",
    items: [
      { href: "/",         icon: LayoutDashboard, label: "Dashboard" },
      { href: "/markets",  icon: TrendingUp,      label: "All Markets" },
      { href: "/orders",   icon: ClipboardList,   label: "Orders" },
      { href: "/portfolio",icon: Briefcase,       label: "Portfolio" },
      { href: "/analytics",icon: BarChart2,       label: "Analytics" },
    ],
  },
  {
    key: "assets",
    label: "Trade by Asset Class",
    items: [
      { href: "/trade",          icon: ShoppingCart, label: "Commodities" },
      { href: "/forex",          icon: DollarSign,   label: "Forex / FX" },
      { href: "/equities",       icon: BarChart,     label: "Equities (NGX/NYSE)" },
      { href: "/digital-assets", icon: Cpu,          label: "Digital Assets" },
      { href: "/indices",        icon: BarChart2,    label: "Indices" },
    ],
  },
  {
    key: "warehouse",
    label: "Warehouse Ops",
    items: [
      { href: "/receipts",   icon: FileText,  label: "Warehouse Receipts" },
      { href: "/deposits",   icon: Package,     label: "Deposits" },
      { href: "/payments",   icon: CreditCard,  label: "Payments" },
      { href: "/warehouses", icon: Warehouse,   label: "Warehouses" },
      { href: "/delivery",   icon: Truck,     label: "Delivery" },
    ],
  },
  {
    key: "structure",
    label: "Market Structure",
    items: [
      { href: "/market-makers",     icon: Star,     label: "Market Makers" },
      { href: "/brokers",           icon: Users,    label: "Brokers" },
      { href: "/corporate-actions", icon: Calendar, label: "Corporate Actions" },
    ],
  },
  {
    key: "compliance",
    label: "Compliance",
    items: [
      { href: "/compliance",        icon: Shield,       label: "Compliance" },
      { href: "/surveillance",       icon: Eye,          label: "Surveillance" },
      { href: "/policy-management",  icon: ShieldCheck,  label: "Policy Management" },
    ],
  },
  {
    key: "capital-markets",
    label: "Capital Markets",
    items: [
      { href: "/fixed-income",    icon: Landmark, label: "Fixed Income" },
      { href: "/abcp-markets",    icon: Layers,   label: "ABCP Markets" },
      { href: "/ledger",          icon: BookOpen, label: "Ledger" },
    ],
  },
  {
    key: "agri-ecosystem",
    label: "Agri Ecosystem",
    items: [
      { href: "/workbench",       icon: BookOpen,  label: "WorkBench (SaaS)" },
      { href: "/input-financing", icon: Tractor,   label: "Input Financing" },
      { href: "/field-agents",    icon: UserCheck, label: "Field Agents" },
      { href: "/crop-reports",    icon: Sprout,    label: "Crop Reports" },
    ],
  },
  {
    key: "account",
    label: "Account",
    items: [
      { href: "/account",       icon: User,          label: "Account" },
      { href: "/notifications", icon: Bell,          label: "Notifications" },
      { href: "/alerts",        icon: BellRing,      label: "Price Alerts" },
      { href: "/onboarding",    icon: ClipboardList, label: "KYC / Onboarding" },
    ],
  },
];

const TICKER_SYMBOLS = [
  "GINGER-NG-SPOT","MAIZE-NG-SPOT","COCOA-SPOT","SOYBEAN-SPOT",
  "GROUNDNUT-SPOT","SESAME-SPOT","CRUDE-NG-SPOT","GOLD-SPOT",
  "COTTON-SPOT","COFFEE-SPOT","PEPPER-BLK-SPOT","CATTLE-SPOT",
];

interface LayoutProps { children: React.ReactNode; }

export default function Layout({ children }: LayoutProps) {
  const { t } = useTranslation("common");
  /** Translate a nav label; falls back to English source string. */
  const navT = (label: string) => {
    const key = NAV_LABEL_KEYS[label];
    return key ? t(`nav.${key}`, label) : label;
  };
  const [location] = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { theme, toggleTheme } = useTheme();
  // Real-time order-fill toasts via SSE (previously only inside DashboardLayout;
  // moved here so all pages — not just the 27 dashboard ones — get them).
  useOrderFillSSE();

  const { data: user } = trpc.auth.me.useQuery();
  const logoutMutation = trpc.auth.logout.useMutation({
    onSuccess: () => { window.location.href = "/"; },
  });

  // Real market data for the header ticker (priceFeedJob → live_prices table,
  // refreshed by Yahoo Finance every ~5 min). refetchInterval only polls while
  // the tab is visible by default; 30s cadence is far inside the 5-min update.
  // OFFLINE-RES: on slow 2G/3G the cadence stretches ×4 (30s→120s); polling is
  // disabled entirely when offline or when the user has Save-Data on — the
  // service-worker read cache (sw.js v4) serves cached prices instead and the
  // ticker badge already flips to OFFLINE.
  const { quality: connQuality } = useConnectionQuality();
  const pricesQuery = trpc.livePrices.getAll.useQuery(undefined, {
    refetchInterval: tunedInterval(30_000, connQuality),
    staleTime: tunedStaleTime(15_000, connQuality),
  });
  const unreadQuery = trpc.notifications.unreadCount.useQuery(undefined, {
    enabled: !!user,
    refetchInterval: tunedInterval(60_000, connQuality),
    staleTime: tunedStaleTime(30_000, connQuality),
  });
  const unreadCount = typeof unreadQuery.data === "number" ? unreadQuery.data : 0;

  const prices = pricesQuery.data?.prices ?? [];
  const tickerTicks = TICKER_SYMBOLS
    .map((s) => prices.find((p) => p.symbol === s))
    .filter((p): p is NonNullable<typeof p> => !!p);
  const lastUpdated = pricesQuery.data?.lastUpdated ? new Date(pricesQuery.data.lastUpdated) : null;
  const isStale = !lastUpdated || Date.now() - lastUpdated.getTime() > 10 * 60_000;
  const isLive = pricesQuery.isSuccess && tickerTicks.length > 0 && !isStale;

  const isActive = (href: string) => {
    if (href === "/") return location === "/";
    return location.startsWith(href);
  };

  const initials = user?.name
    ? user.name.split(" ").map((n: string) => n[0]).join("").toUpperCase().slice(0, 2)
    : "?";

  function NavLink({ href, icon: Icon, label }: { href: string; icon: React.ElementType; label: string }) {
    return (
      <Link
        href={href}
        className={"flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-all duration-150 mb-0.5 " + (
          isActive(href)
            ? "bg-primary text-primary-foreground font-medium shadow-sm"
            : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground"
        )}
        onClick={() => setSidebarOpen(false)}
      >
        <Icon className="w-4 h-4 flex-shrink-0" />
        <span className="truncate">{label}</span>
      </Link>
    );
  }

  function SidebarContent() {
    return (
      <div className="flex flex-col h-full">
        {/* Logo */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-sidebar-border flex-shrink-0">
          <div className="w-9 h-9 rounded-lg flex items-center justify-center bg-primary">
            <Activity className="w-5 h-5 text-primary-foreground" />
          </div>
          <div>
            <div className="text-white font-bold text-base leading-tight tracking-wide" style={{ fontFamily: "'DM Serif Display', serif" }}>
              NEXCOM
            </div>
            <div className="text-[11px] text-sidebar-foreground/60">Multi-Asset Exchange</div>
          </div>
          <div className="ml-auto">
            <span className="flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-primary/20 text-primary">
              <Zap className="w-2.5 h-2.5" />LIVE
            </span>
          </div>
        </div>

        {/* Nav groups */}
        <nav className="flex-1 px-3 py-3 overflow-y-auto scrollbar-thin space-y-3">
          {NAV_GROUPS.map(group => (
            <div key={group.key}>
              <p className="text-[10px] font-semibold uppercase tracking-widest text-sidebar-foreground/40 px-3 mb-1">{navT(group.label)}</p>
              {group.items.map(item => (
                <NavLink key={item.href} href={item.href} icon={item.icon} label={navT(item.label)} />
              ))}
            </div>
          ))}

          {/* Admin — only visible to admin role */}
          {user?.role === "admin" && (
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-widest text-sidebar-foreground/40 px-3 mb-1">Admin</p>
              <NavLink href="/admin" icon={Globe} label="Admin Dashboard" />
            </div>
          )}
        </nav>

        {/* User footer */}
        <div className="px-3 py-4 border-t border-sidebar-border flex-shrink-0">
          {user ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-sidebar-accent transition-colors">
                  <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white bg-primary flex-shrink-0">
                    {initials}
                  </div>
                  <div className="flex-1 min-w-0 text-left">
                    <div className="text-sm font-medium text-sidebar-foreground truncate">{user.name || "User"}</div>
                    <div className="text-xs text-sidebar-foreground/50 capitalize truncate">{user.role}</div>
                  </div>
                  <ChevronDown className="w-3.5 h-3.5 text-sidebar-foreground/40 flex-shrink-0" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent side="top" align="start" className="w-48">
                <DropdownMenuItem asChild>
                  <Link href="/account" className="flex items-center gap-2 cursor-pointer"><User className="w-4 h-4" />Account</Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link href="/onboarding" className="flex items-center gap-2 cursor-pointer"><Settings className="w-4 h-4" />KYC / Onboarding</Link>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="text-destructive focus:text-destructive cursor-pointer"
                  onClick={() => logoutMutation.mutate()}
                >
                  <LogOut className="w-4 h-4 mr-2" />Sign Out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <>
              <a
                href={getLoginUrl()}
                className="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
              >
                <User className="w-4 h-4" />Sign In
              </a>
              <div className="relative w-full flex items-center gap-2 mt-1">
                <div className="flex-1 h-px bg-border" />
                <span className="text-xs text-muted-foreground">or</span>
                <div className="flex-1 h-px bg-border" />
              </div>
              <PasskeyLoginButton className="w-full" />
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-background overflow-hidden">
      {/* Desktop sidebar */}
      <aside className="hidden lg:flex flex-col w-60 flex-shrink-0 bg-sidebar">
        <SidebarContent />
      </aside>

      {/* Mobile sidebar overlay */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Navigation menu"
          onKeyDown={(e) => { if (e.key === "Escape") setSidebarOpen(false); }}>
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setSidebarOpen(false)} />
          <aside className="absolute left-0 top-0 bottom-0 w-64 flex flex-col bg-sidebar shadow-2xl">
            <button
              className="absolute top-4 right-4 text-sidebar-foreground/60 hover:text-sidebar-foreground z-10"
              aria-label="Close navigation menu"
              onClick={() => setSidebarOpen(false)}
            >
              <X className="w-5 h-5" />
            </button>
            <SidebarContent />
          </aside>
        </div>
      )}

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Header */}
        <header className="flex items-center justify-between px-4 lg:px-5 py-2.5 bg-card border-b border-border flex-shrink-0">
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <Button variant="ghost" size="icon" className="lg:hidden h-8 w-8 flex-shrink-0" aria-label="Open navigation menu" onClick={() => setSidebarOpen(true)}>
              <Menu className="w-4 h-4" />
            </Button>
            {/* Market ticker — real data from live_prices (priceFeedJob).
                Badge reflects honesty of the feed: LIVE / DELAYED / OFFLINE. */}
            <div className="hidden md:flex items-center gap-2 overflow-hidden flex-1 min-w-0">
              <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider flex-shrink-0 flex items-center gap-1">
                <span className={`w-1.5 h-1.5 rounded-full inline-block ${isLive ? "bg-primary animate-pulse" : "bg-amber-500"}`} />
                {isLive ? "LIVE" : pricesQuery.isSuccess && tickerTicks.length > 0 ? "DELAYED" : "OFFLINE"}
              </span>
              <div className="overflow-hidden flex-1" aria-live="off">
                <div className="ticker-scroll flex gap-6 whitespace-nowrap">
                  {tickerTicks.length === 0 ? (
                    <span className="text-xs text-muted-foreground">
                      Market data unavailable — prices refresh when the feed reconnects.
                    </span>
                  ) : (
                    [...tickerTicks, ...tickerTicks].map((tick, i) => {
                      const price = Number(tick.price);
                      const changePct = Number(tick.changePct ?? 0);
                      return (
                        <span key={i} className="text-xs font-mono flex items-center gap-1.5">
                          <span className="text-muted-foreground">{tick.symbol.replace("-SPOT","").replace("-NG","")}</span>
                          <span className="font-semibold text-foreground">
                            {tick.currency === "USD" ? "$" : "₦"}{formatCompact(price)}
                          </span>
                          <span className={changePct >= 0 ? "text-positive" : "text-negative"}>
                            {changePct >= 0 ? "▲" : "▼"}{Math.abs(changePct).toFixed(2)}%
                          </span>
                        </span>
                      );
                    })
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Header right */}
          <div className="flex items-center gap-1.5 flex-shrink-0">
              <SyncStatusPill />
              <LanguageSwitcher />
              <Button variant="ghost" size="icon" className="h-8 w-8 relative" aria-label={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : "Notifications"} asChild>
                <Link href="/notifications">
                  <Bell className="w-4 h-4" />
                  {unreadCount > 0 && (
                    <span className="absolute -top-0.5 -right-0.5 min-w-4 h-4 px-0.5 rounded-full bg-primary text-[9px] font-bold text-primary-foreground flex items-center justify-center">
                      {unreadCount > 99 ? "99+" : unreadCount}
                    </span>
                  )}
                </Link>
              </Button>
            {user ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="sm" className="h-8 gap-2 px-2" aria-label="Account menu">
                    <div className="w-6 h-6 rounded-full bg-primary flex items-center justify-center text-[10px] font-bold text-primary-foreground">
                      {initials}
                    </div>
                    <span className="hidden sm:block text-sm font-medium max-w-24 truncate">{user.name || "User"}</span>
                    <ChevronDown className="w-3 h-3 text-muted-foreground" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-44">
                <DropdownMenuItem asChild>
                  <Link href="/account" className="flex items-center gap-2 cursor-pointer"><User className="w-4 h-4" />Account</Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link href="/analytics" className="flex items-center gap-2 cursor-pointer"><BarChart2 className="w-4 h-4" />Analytics</Link>
                </DropdownMenuItem>
                <DropdownMenuItem onClick={toggleTheme} className="cursor-pointer">
                  {theme === "dark" ? <Sun className="w-4 h-4 mr-2" /> : <Moon className="w-4 h-4 mr-2" />}
                  {theme === "dark" ? "Light Mode" : "Dark Mode"}
                </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    className="text-destructive focus:text-destructive cursor-pointer"
                    onClick={() => logoutMutation.mutate()}
                  >
                    <LogOut className="w-4 h-4 mr-2" />Sign Out
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : (
              <>
                <a href={getLoginUrl()} className="text-sm font-medium text-primary hover:underline px-2">Sign In</a>
                <PasskeyLoginButton className="text-sm h-8 px-3" />
              </>
            )}
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto scrollbar-thin">
          {children}
        </main>

        {/* Upgrade banner + grounded AI copilot */}
        <PasskeyUpgradeBanner />
        <CopilotPanel />

        {/* Mobile bottom nav — 5 most important pages */}
        <nav className="lg:hidden flex items-center justify-around border-t border-border bg-card pb-safe flex-shrink-0 px-2 pt-1">
          {[
            { href: "/",        icon: LayoutDashboard, label: "Home" },
            { href: "/markets", icon: TrendingUp,      label: "Markets" },
            { href: "/trade",   icon: ShoppingCart,    label: "Trade" },
            { href: "/orders",  icon: ClipboardList,   label: "Orders" },
            { href: "/account", icon: User,            label: "Account" },
          ].map(({ href, icon: Icon, label }) => (
            <Link
              key={href}
              href={href}
              className={"flex flex-col items-center gap-0.5 px-3 py-2 rounded-lg transition-colors " + (isActive(href) ? "text-primary" : "text-muted-foreground")}
            >
              <Icon className="w-5 h-5" />
              <span className="text-[10px] font-medium">{label}</span>
            </Link>
          ))}
        </nav>
      </div>
    </div>
  );
}
