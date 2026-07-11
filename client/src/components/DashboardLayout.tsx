import { useAuth } from "@/_core/hooks/useAuth";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { CommandPaletteProvider, useCommandPalette } from "@/components/CommandPalette";
import { useOrderFillToast } from "@/hooks/useOrderFillToast";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import { getLoginUrl } from "@/const";
import { useIsMobile } from "@/hooks/useMobile";
import {
  Activity,
  AlertCircle,
  BarChart3,
  Bell,
  Briefcase,
  Building2,
  ChevronDown,
  CreditCard,
  FileText,
  Globe,
  LayoutDashboard,
  LineChart,
  LogOut,
  Network,
  Package,
  PanelLeft,
  Settings,
  Scale,
  Shield,
  ShieldAlert,
  ShoppingCart,
  Sliders,
  Truck,
  TrendingUp,
  User,
  Users,
  Warehouse,
  Wheat,
  Zap,
  KeyRound,
  Gauge,
  Smartphone,
  Flag,
  FileWarning,
  Layers,
  GitMerge,
  Banknote,
  ClipboardList,
  CalendarClock,
  Award,
  Star,
  TrendingDown,
  BookOpen,
  CandlestickChart,
  MapPin,
  UserCheck,
  Brain,
  Link2,
  UserPlus,
  FileCheck,
  Coins,
  Search,
  Code2,
  BookMarked,
  MessageSquare,
  Phone,
  Server,
  BadgeCheck,
} from "lucide-react";
import { CSSProperties, useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { DashboardLayoutSkeleton } from "./DashboardLayoutSkeleton";
import { useOrderFillSSE } from "@/hooks/useOrderFillSSE";
import { PasskeyUpgradeBanner } from "./PasskeyUpgradeBanner";
import { PasskeyLoginButton } from "./PasskeyLoginButton";
import { Button } from "./ui/button";
import { trpc } from "@/lib/trpc";

type MenuItem = {
  icon: React.ElementType;
  label: string;
  path: string;
  badge?: string;
  adminOnly?: boolean;
};

type MenuSection = {
  title: string;
  items: MenuItem[];
};

const menuSections: MenuSection[] = [
  {
    title: "Overview",
    items: [
      { icon: LayoutDashboard, label: "Dashboard",      path: "/" },
      { icon: BarChart3,       label: "Markets",        path: "/markets" },
      { icon: Wheat,             label: "Farmer Journey",  path: "/farmer-journey" },
      { icon: TrendingUp,      label: "Ginger Prices",    path: "/ginger-price-history" },
      { icon: Bell,            label: "Notifications",  path: "/notifications" },
      { icon: AlertCircle,     label: "Price Alerts",   path: "/alerts" },
    ],
  },
  {
    title: "Trading",
    items: [
      { icon: ShoppingCart,    label: "Trade",          path: "/trade" },
      { icon: FileText,        label: "Orders",         path: "/orders" },
      { icon: TrendingUp,      label: "Portfolio",      path: "/portfolio" },
    ],
  },
  {
    title: "Asset Classes",
    items: [
      { icon: Globe,           label: "Forex",          path: "/forex" },
      { icon: LineChart,       label: "Equities",       path: "/equities" },
      { icon: Zap,             label: "Digital Assets", path: "/digital-assets" },
      { icon: Activity,        label: "Indices",        path: "/indices" },
    ],
  },
  {
    title: "Commodity Ops",
    items: [
      { icon: Package,         label: "Deposits",           path: "/deposits" },
      { icon: FileText,        label: "Receipts (EWR)",     path: "/receipts" },
      { icon: Warehouse,       label: "Warehouses",         path: "/warehouses" },
      { icon: Truck,           label: "Delivery",           path: "/delivery" },
      { icon: BarChart3,       label: "My Inventory",       path: "/warehouse-inventory" },
    ],
  },
  {
    title: "Join the Exchange",
    items: [
      { icon: Users,             label: "Join the Exchange",    path: "/join" },
      { icon: Wheat,             label: "Farmer Portal",        path: "/farmer-onboarding" },
      { icon: TrendingUp,        label: "Trader Portal",        path: "/trader-onboarding" },
      { icon: Briefcase,         label: "Broker Portal",        path: "/broker-onboarding" },
      { icon: Warehouse,         label: "Warehouse Portal",     path: "/warehouse-onboarding" },
      { icon: Star,              label: "Market Maker Portal",  path: "/market-maker-onboarding" },
      { icon: Users,             label: "User Management",       path: "/admin/users",         adminOnly: true },
      { icon: Shield,            label: "Stakeholder Admin",    path: "/admin/stakeholders", adminOnly: true },
      { icon: UserCheck,           label: "Re-KYC Flags",          path: "/admin/re-kyc-flags",  adminOnly: true },
      { icon: FileCheck,           label: "KYC Document Review",    path: "/admin/kyc-review",    adminOnly: true },
      { icon: Award,               label: "Performance Metrics",   path: "/admin/performance-metrics", adminOnly: true },
      { icon: Activity,            label: "Price Feed Admin",       path: "/admin/price-feed",    adminOnly: true },
      { icon: Network,              label: "Platform Health",        path: "/admin/platform-health", adminOnly: true },
      { icon: Server,                label: "Microservices Health",   path: "/admin/microservices",   adminOnly: true },
      { icon: Activity,              label: "Middleware Health",       path: "/admin/middleware-health", adminOnly: true },
      { icon: MessageSquare,        label: "Warehouse Messages",     path: "/admin/warehouse-messages", adminOnly: true },
      { icon: Phone,                 label: "Channel Dashboard",      path: "/channel-dashboard",       adminOnly: true },
    ],
  },
  {
    title: "Market Structure",
    items: [
      { icon: Briefcase,       label: "Brokers",        path: "/brokers" },
      { icon: Building2,       label: "Market Makers",  path: "/market-makers" },
      { icon: CreditCard,      label: "Corp. Actions",  path: "/corporate-actions" },
    ],
  },
  {
    title: "Oversight",
    items: [
      { icon: Shield,          label: "Compliance",     path: "/compliance" },
      { icon: ClipboardList,   label: "Compliance Hub",  path: "/compliance-dashboard", adminOnly: true },
      { icon: Flag,            label: "AML Dashboard",   path: "/aml",           adminOnly: true },
      { icon: FileWarning,     label: "SAR Filing",      path: "/sar-filing",    adminOnly: true },
      { icon: Activity,        label: "Surveillance",   path: "/surveillance" },
      { icon: ShieldAlert,     label: "Trade Surveillance", path: "/trade-surveillance", adminOnly: true },
    ],
  },
  {
    title: "Derivatives & Risk",
    items: [
      { icon: CandlestickChart,  label: "Derivatives",         path: "/derivatives",            adminOnly: true },
      { icon: CandlestickChart,  label: "Futures Trading",     path: "/futures-trading" },
      { icon: CandlestickChart,  label: "Options Admin",        path: "/options-admin",          adminOnly: true },
      { icon: AlertCircle,       label: "Derivatives Risk",     path: "/derivatives-risk",       adminOnly: true },
      { icon: Shield,            label: "Margin Health",       path: "/margin-health" },
      { icon: Scale,             label: "Margin Account",       path: "/margin" },
      { icon: TrendingDown,      label: "Clearing House",       path: "/clearing-house",         adminOnly: true },
      { icon: ShieldAlert,       label: "Risk Management",      path: "/risk-management" },
    ],
  },
  {
    title: "Advanced Intelligence",
    items: [
      { icon: Brain,             label: "AI/ML Analytics",      path: "/ai-ml" },
      { icon: Link2,             label: "Blockchain",            path: "/blockchain" },
      { icon: Coins,             label: "Token Explorer",         path: "/blockchain/explorer" },
      { icon: Layers,            label: "Lakehouse",             path: "/lakehouse" },
      { icon: LineChart,         label: "Portfolio Analytics",   path: "/portfolio-analytics" },
      { icon: BarChart3,         label: "Analytics",             path: "/analytics" },
    ],
  },
  {
    title: "Stakeholder Portals",
    items: [
      { icon: Wheat,              label: "My Farm Dashboard",    path: "/farmer-dashboard" },
      { icon: MapPin,             label: "My Farms",             path: "/farmer-farms" },
      { icon: BarChart3,          label: "Crop Listings",        path: "/farmer-crops" },
      { icon: TrendingUp,         label: "Farmer Market Prices", path: "/farmer-market" },
      { icon: LineChart,          label: "Farmer Earnings",      path: "/farmer-earnings" },
      { icon: Users,              label: "Farmer Admin",         path: "/farmer-admin",          adminOnly: true },
      { icon: TrendingUp,         label: "Trader Dashboard",     path: "/trader-dashboard" },
      { icon: Building2,          label: "Broker Dashboard",     path: "/broker-dashboard" },
      { icon: Warehouse,          label: "Warehouse Dashboard",  path: "/warehouse-dashboard" },
      { icon: Star,               label: "MM Onboarding Dash",   path: "/market-maker-onboarding-dashboard" },
    ],
  },
  {
    title: "Settlement & Reporting",
    items: [
      { icon: Shield,          label: "Settlements",             path: "/settlements" },
      { icon: Layers,          label: "Settlement Engine",        path: "/settlement-engine", adminOnly: true },
      { icon: Network,         label: "Mojaloop Payments",        path: "/mojaloop",          adminOnly: true },
      { icon: UserPlus,        label: "DFSP Onboarding",          path: "/mojaloop/onboard",  adminOnly: true },
      { icon: FileCheck,       label: "Transfer Reconciliation",  path: "/mojaloop/reconciliation", adminOnly: true },
      { icon: Layers,          label: "DFSP Tier Management",      path: "/mojaloop/tiers",         adminOnly: true },
      { icon: ShieldAlert,     label: "DFSP KYC Review",           path: "/admin/dfsp-kyc",         adminOnly: true },
      { icon: GitMerge,        label: "Settlement Fails",         path: "/settlement-fails",  adminOnly: true },
      { icon: ClipboardList,   label: "Regulatory Reports",       path: "/regulatory-reports", adminOnly: true },
      { icon: CalendarClock,   label: "Report Schedules",         path: "/report-schedules",  adminOnly: true },
      { icon: Award,           label: "MM Obligations",           path: "/market-maker-dashboard", adminOnly: true },
      { icon: Star,            label: "MM Performance",           path: "/market-maker-performance" },
      { icon: BookOpen,        label: "IR Portal",                path: "/investor-relations" },
      { icon: BookOpen,        label: "IR Admin",                 path: "/ir-admin",              adminOnly: true },
    ],
  },
  {
    title: "Account & Security",
    items: [
      { icon: User,            label: "My Profile",     path: "/profile" },
      { icon: User,            label: "My Account",     path: "/account" },
      { icon: AlertCircle,     label: "Disputes",        path: "/disputes" },
      { icon: ShieldAlert,     label: "Security Log",    path: "/security",    adminOnly: true },
      { icon: Shield,          label: "Security Settings", path: "/security-settings", adminOnly: true },
      { icon: Network,         label: "Webhook Config",  path: "/webhook-config",  adminOnly: true },
      { icon: ShieldAlert,     label: "IP Allowlist",    path: "/ip-allowlist",    adminOnly: true },
      { icon: KeyRound,        label: "2FA Setup",         path: "/totp-setup" },
      { icon: Smartphone,      label: "Device Sessions",   path: "/device-sessions" },
      { icon: Gauge,           label: "Velocity Limits",   path: "/velocity-limits" },
      { icon: BadgeCheck,      label: "Credit Score",      path: "/credit-score" },
      { icon: Banknote,        label: "Cash Withdrawal",   path: "/cash-withdrawal" },
      { icon: Sliders,         label: "Settings",          path: "/settings" },
      { icon: Settings,        label: "Admin Panel",        path: "/admin", adminOnly: true },
      { icon: Users,           label: "Bulk KYC Admin",     path: "/admin/bulk-kyc", adminOnly: true },
      { icon: Users,           label: "Cooperative",        path: "/cooperative", adminOnly: true },
      { icon: Network,         label: "Architecture",       path: "/architecture", adminOnly: true },
    ],
  },
  {
    title: "Developer",
    items: [
      { icon: Code2,      label: "API Reference",        path: "/docs/api" },
      { icon: BookMarked, label: "Push Notifications",   path: "/settings/push-notifications" },
    ],
  },
];

const SIDEBAR_WIDTH_KEY = "sidebar-width";
const DEFAULT_WIDTH = 240;
const MIN_WIDTH = 200;
const MAX_WIDTH = 360;

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const saved = localStorage.getItem(SIDEBAR_WIDTH_KEY);
    return saved ? parseInt(saved, 10) : DEFAULT_WIDTH;
  });
  const { loading, user } = useAuth();
  useOrderFillSSE(); // Real-time order fill toast notifications via SSE

  useEffect(() => {
    localStorage.setItem(SIDEBAR_WIDTH_KEY, sidebarWidth.toString());
  }, [sidebarWidth]);

  if (loading) {
    return <DashboardLayoutSkeleton />;
  }

  if (!user) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <div className="flex flex-col items-center gap-8 p-8 max-w-md w-full">
          <div className="text-center space-y-3">
            <div className="text-3xl font-bold text-primary" style={{ fontFamily: "'DM Serif Display', serif" }}>
              NEXCOM
            </div>
            <h1 className="text-xl font-semibold tracking-tight">Sign in to continue</h1>
            <p className="text-sm text-muted-foreground max-w-sm">
              Access to the NEXCOM Exchange requires authentication.
            </p>
          </div>
          <Button
            onClick={() => { window.location.href = getLoginUrl(); }}
            size="lg"
            className="w-full bg-primary hover:bg-primary/90 text-white"
          >
            Sign in with Manus
          </Button>
          <div className="relative w-full flex items-center gap-3">
            <div className="flex-1 h-px bg-border" />
            <span className="text-xs text-muted-foreground">or</span>
            <div className="flex-1 h-px bg-border" />
          </div>
          <PasskeyLoginButton className="w-full" />
        </div>
      </div>
    );
  }

  return (
    <SidebarProvider
      style={{ "--sidebar-width": `${sidebarWidth}px` } as CSSProperties}
    >
      <DashboardLayoutContent setSidebarWidth={setSidebarWidth}>
        {children}
      </DashboardLayoutContent>
    </SidebarProvider>
  );
}

type DashboardLayoutContentProps = {
  children: React.ReactNode;
  setSidebarWidth: (width: number) => void;
};

// ── TopBar: sticky header shown on all screen sizes ──────────────────────────
function TopBar({
  isMobile,
  unreadCount,
  activeLabel,
}: {
  isMobile: boolean;
  unreadCount: number;
  activeLabel?: string;
}) {
  const { setOpen } = useCommandPalette();
  const [, setLocation] = useLocation();
  const { user } = useAuth();

  return (
    <div className="flex border-b border-border/50 h-14 items-center justify-between bg-background/95 px-3 backdrop-blur supports-[backdrop-filter]:backdrop-blur sticky top-0 z-40">
      {/* Left: mobile hamburger + page title */}
      <div className="flex items-center gap-2">
        {isMobile && <SidebarTrigger className="h-9 w-9 rounded-lg" />}
        {isMobile && (
          <span
            className="font-bold text-primary text-base"
            style={{ fontFamily: "'DM Serif Display', serif" }}
          >
            {activeLabel ?? "NEXCOM"}
          </span>
        )}
      </div>

      {/* Right: search + notifications + avatar */}
      <div className="flex items-center gap-1 ml-auto">
        {/* ⌘K Search trigger */}
        <button
          onClick={() => setOpen(true)}
          className="flex items-center gap-2 h-9 px-3 rounded-lg border border-border/60 bg-muted/40 hover:bg-accent text-muted-foreground text-sm transition-colors"
          aria-label="Open global search"
        >
          <Search className="h-3.5 w-3.5 shrink-0" />
          <span className="hidden sm:inline text-xs">Search</span>
          <kbd className="hidden sm:inline pointer-events-none select-none rounded border border-border/50 bg-background px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground">
            {navigator.platform?.toLowerCase().includes("mac") ? "⌘K" : "Ctrl K"}
          </kbd>
        </button>

        {/* Language switcher */}
        <LanguageSwitcher />

        {/* Notification bell */}
        {unreadCount > 0 && (
          <button
            onClick={() => setLocation("/notifications")}
            className="relative h-9 w-9 flex items-center justify-center rounded-lg hover:bg-accent transition-colors"
            aria-label={`${unreadCount} unread notifications`}
          >
            <Bell className="h-4 w-4 text-muted-foreground" />
            <span className="absolute top-1.5 right-1.5 h-2 w-2 rounded-full bg-primary" />
          </button>
        )}

        {/* Avatar */}
        <Avatar className="h-8 w-8 border cursor-pointer" onClick={() => setLocation("/account")}>
          <AvatarFallback className="text-xs font-semibold bg-primary/20 text-primary">
            {user?.name?.charAt(0).toUpperCase() ?? "U"}
          </AvatarFallback>
        </Avatar>
      </div>
    </div>
  );
}

function DashboardLayoutContent({
  children,
  setSidebarWidth,
}: DashboardLayoutContentProps) {
  const { user, logout } = useAuth();
  // Show Sonner toasts when order fills arrive
  useOrderFillToast();
  const [location, setLocation] = useLocation();
  const { state, toggleSidebar } = useSidebar();
  const isCollapsed = state === "collapsed";
  const [isResizing, setIsResizing] = useState(false);
  const sidebarRef = useRef<HTMLDivElement>(null);
  const isMobile = useIsMobile();

  // Unread notification count
  const { data: notifData } = trpc.notifications.list.useQuery(
    { limit: 1, page: 1, unreadOnly: true },
    { refetchInterval: 30_000 }
  );
  const unreadCount = notifData?.total ?? 0;

  // Price alert proximity badge — alerts within 2% of target
  const { data: nearTriggerData } = trpc.priceAlerts.nearTriggerCount.useQuery(
    { thresholdPct: 2 },
    { refetchInterval: 15_000, enabled: !!user }
  );
  const nearTriggerCount = nearTriggerData?.count ?? 0;
  // Passkey count badge — shows (N) next to Security Settings
  const { data: mfaStatusData } = trpc.webauthn.getMfaStatus.useQuery(undefined, {
    enabled: !!user,
    staleTime: 5 * 60 * 1000,
    refetchInterval: false,
  });
  const passkeyCount = mfaStatusData?.credentials?.length ?? 0;

  // Warehouse Messages unread (SENT) count for admin badge — polls every 60s
  const { data: warehouseMsgData } = trpc.warehouseMessages.adminUnreadCount.useQuery(
    undefined,
    { refetchInterval: 60_000, enabled: !!user && (user as { role?: string })?.role === "admin" }
  );
  const warehouseUnreadCount = warehouseMsgData?.count ?? 0;

  // Find active item across all sections
  const activeItem = menuSections
    .flatMap(s => s.items)
    .find(item => item.path === location || (item.path !== "/" && location.startsWith(item.path)));

  useEffect(() => {
    if (isCollapsed) setIsResizing(false);
  }, [isCollapsed]);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing) return;
      const sidebarLeft = sidebarRef.current?.getBoundingClientRect().left ?? 0;
      const newWidth = e.clientX - sidebarLeft;
      if (newWidth >= MIN_WIDTH && newWidth <= MAX_WIDTH) setSidebarWidth(newWidth);
    };
    const handleMouseUp = () => setIsResizing(false);
    if (isResizing) {
      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    }
    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, [isResizing, setSidebarWidth]);

  const isAdmin = (user as { role?: string })?.role === "admin";

  return (
    <CommandPaletteProvider>
    <>
      <div className="relative" ref={sidebarRef}>
        <Sidebar collapsible="icon" className="border-r border-border/50" disableTransition={isResizing}>
          {/* Header */}
          <SidebarHeader className="h-14 justify-center border-b border-border/50">
            <div className="flex items-center gap-2 px-2">
              <button
                onClick={toggleSidebar}
                className="h-8 w-8 flex items-center justify-center hover:bg-accent rounded-lg transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring shrink-0"
                aria-label="Toggle navigation"
              >
                <PanelLeft className="h-4 w-4 text-muted-foreground" />
              </button>
              {!isCollapsed && (
                <span
                  className="font-bold text-primary tracking-tight text-lg"
                  style={{ fontFamily: "'DM Serif Display', serif" }}
                >
                  NEXCOM
                </span>
              )}
            </div>
          </SidebarHeader>

          {/* Navigation */}
          <SidebarContent className="overflow-y-auto">
            {menuSections.map(section => {
              const visibleItems = section.items.filter(item => !item.adminOnly || isAdmin);
              if (visibleItems.length === 0) return null;
              return (
                <SidebarGroup key={section.title} className="py-1">
                  {!isCollapsed && (
                    <SidebarGroupLabel className="text-[10px] uppercase tracking-widest text-muted-foreground/60 px-3 py-1">
                      {section.title}
                    </SidebarGroupLabel>
                  )}
                  <SidebarMenu className="px-2">
                    {visibleItems.map(item => {
                      const isActive = item.path === "/"
                        ? location === "/"
                        : location === item.path || location.startsWith(item.path + "/");
                      const showBadge = item.path === "/notifications" && unreadCount > 0;
                      const showAlertBadge = item.path === "/alerts" && nearTriggerCount > 0;
                      const showPasskeyBadge = item.path === "/security-settings" && mfaStatusData !== undefined;
                      const showWarehouseBadge = item.path === "/admin/warehouse-messages" && warehouseUnreadCount > 0;
                      return (
                        <SidebarMenuItem key={item.path}>
                          <SidebarMenuButton
                            isActive={isActive}
                            onClick={() => setLocation(item.path)}
                            tooltip={item.label}
                            className="h-9 transition-all font-normal relative"
                          >
                            <item.icon className={`h-4 w-4 shrink-0 ${isActive ? "text-primary" : ""}`} />
                            <span className="flex-1 truncate">{item.label}</span>
                            {showBadge && (
                              <Badge className="ml-auto h-4 min-w-4 px-1 text-[10px] bg-primary text-primary-foreground">
                                {unreadCount > 99 ? "99+" : unreadCount}
                              </Badge>
                            )}
                            {showAlertBadge && (
                              <Badge className="ml-auto h-4 min-w-4 px-1 text-[10px] bg-amber-500 text-white">
                                {nearTriggerCount > 9 ? "9+" : nearTriggerCount}
                              </Badge>
                            )}
                            {showPasskeyBadge && (
                              <Badge
                                className={`ml-auto h-4 min-w-4 px-1 text-[10px] ${
                                  passkeyCount === 0
                                    ? "bg-destructive/80 text-destructive-foreground"
                                    : "bg-emerald-600 text-white"
                                }`}
                                title={passkeyCount === 0 ? "No passkeys enrolled" : `${passkeyCount} passkey${passkeyCount !== 1 ? "s" : ""} enrolled`}
                              >
                                {passkeyCount}
                              </Badge>
                            )}
                            {showWarehouseBadge && (
                              <Badge className="ml-auto h-4 min-w-4 px-1 text-[10px] bg-orange-500 text-white" title={`${warehouseUnreadCount} unread warehouse message${warehouseUnreadCount !== 1 ? "s" : ""}` }>
                                {warehouseUnreadCount > 99 ? "99+" : warehouseUnreadCount}
                              </Badge>
                            )}
                          </SidebarMenuButton>
                        </SidebarMenuItem>
                      );
                    })}
                  </SidebarMenu>
                </SidebarGroup>
              );
            })}
          </SidebarContent>

          {/* Footer — user profile */}
          <SidebarFooter className="p-3 border-t border-border/50">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="flex items-center gap-2 rounded-lg px-1 py-1.5 hover:bg-accent/50 transition-colors w-full text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  <Avatar className="h-8 w-8 border shrink-0">
                    <AvatarFallback className="text-xs font-semibold bg-primary/20 text-primary">
                      {user?.name?.charAt(0).toUpperCase() ?? "U"}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0 group-data-[collapsible=icon]:hidden">
                    <p className="text-xs font-semibold truncate leading-none text-foreground">
                      {user?.name || "User"}
                    </p>
                    <p className="text-[10px] text-muted-foreground truncate mt-1">
                      {user?.email || ""}
                    </p>
                  </div>
                  {/* Passkey shield badge */}
                  {!isCollapsed && (
                    <span
                      title={
                        passkeyCount === 0
                          ? "No passkeys enrolled — click to set up"
                          : `${passkeyCount} passkey${passkeyCount !== 1 ? "s" : ""} enrolled`
                      }
                      onClick={(e) => { e.stopPropagation(); setLocation("/security-settings"); }}
                      className={`flex items-center gap-0.5 shrink-0 rounded px-1 py-0.5 text-[10px] font-semibold cursor-pointer ${
                        passkeyCount === 0
                          ? "bg-destructive/20 text-destructive hover:bg-destructive/30"
                          : "bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30"
                      }`}
                    >
                      <Shield className="h-3 w-3" />
                      {passkeyCount}
                    </span>
                  )}
                  {!isCollapsed && <ChevronDown className="h-3 w-3 text-muted-foreground shrink-0" />}
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52">
                <DropdownMenuItem onClick={() => setLocation("/account")} className="cursor-pointer">
                  <User className="mr-2 h-4 w-4" />
                  <span>My Account</span>
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setLocation("/notifications")} className="cursor-pointer">
                  <Bell className="mr-2 h-4 w-4" />
                  <span>Notifications</span>
                  {unreadCount > 0 && (
                    <Badge className="ml-auto h-4 min-w-4 px-1 text-[10px] bg-primary text-primary-foreground">
                      {unreadCount}
                    </Badge>
                  )}
                </DropdownMenuItem>
                {isAdmin && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => setLocation("/admin")} className="cursor-pointer">
                      <Settings className="mr-2 h-4 w-4" />
                      <span>Admin Panel</span>
                    </DropdownMenuItem>
                  </>
                )}
                <DropdownMenuItem onClick={() => setLocation("/security-settings")} className="cursor-pointer">
                  <Shield className="mr-2 h-4 w-4" />
                  <span>Security Settings</span>
                  {passkeyCount === 0 && (
                    <Badge className="ml-auto h-4 min-w-4 px-1 text-[10px] bg-destructive text-destructive-foreground">
                      0
                    </Badge>
                  )}
                  {passkeyCount > 0 && (
                    <Badge className="ml-auto h-4 min-w-4 px-1 text-[10px] bg-emerald-600 text-white">
                      {passkeyCount}
                    </Badge>
                  )}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={logout}
                  className="cursor-pointer text-destructive focus:text-destructive"
                >
                  <LogOut className="mr-2 h-4 w-4" />
                  <span>Sign out</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarFooter>
        </Sidebar>

        {/* Resize handle */}
        <div
          className={`absolute top-0 right-0 w-1 h-full cursor-col-resize hover:bg-primary/30 transition-colors ${isCollapsed ? "hidden" : ""}`}
          onMouseDown={() => { if (!isCollapsed) setIsResizing(true); }}
          style={{ zIndex: 50 }}
        />
      </div>

      <SidebarInset>
        {/* Top bar — shown on both mobile and desktop */}
        <TopBar isMobile={isMobile} unreadCount={unreadCount} activeLabel={activeItem?.label} />
        {/* Passkey upgrade prompt — shown once per 30 days to users without passkeys */}
        <PasskeyUpgradeBanner />
        <main className="flex-1 p-4 min-h-0">{children}</main>
      </SidebarInset>
    </>
    </CommandPaletteProvider>
  );
}
