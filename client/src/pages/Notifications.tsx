/**
 * NEXCOM Exchange — Notifications
 * Real-time notification center with mark-as-read, delete, and preferences
 * Fully wired to live tRPC notifications router
 */
import { useState, useMemo, useEffect, useRef } from "react";
import {
  Bell, BellOff, Check, CheckCheck, Trash2,
  TrendingUp, AlertCircle, Package, ShieldCheck, Info, RefreshCw,
  FileText, Truck, ShoppingCart, Settings
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { getLoginUrl } from "@/const";
import { toast } from "sonner";
import { useLocation } from "wouter";

type NotifType = "TRADE" | "SETTLEMENT" | "KYC" | "ALERT" | "SYSTEM" | "MARGIN_CALL" | "LIQUIDATED" | "SECURITY_ALERT" | "PRICE_ALERT" | "WAREHOUSE" | "ANNOUNCEMENT" | "EWR" | "DEPOSIT" | "DELIVERY";

interface DisplayNotif {
  id: number;
  type: NotifType;
  title: string;
  message: string;
  read: boolean;
  createdAt: string;
  link?: string;
}

const MOCK_NOTIFS: DisplayNotif[] = [
  { id: 1, type: "TRADE",        title: "Order Filled",             message: "Your BUY order for 5 MT GINGER-NG-SPOT at ₦1,838.50/MT has been fully filled.",                    read: false, createdAt: "2026-03-03T09:15:00Z", link: "/orders" },
  { id: 2, type: "PRICE_ALERT",  title: "Price Alert Triggered",    message: "CRUDE-NG-SPOT has crossed above your target of $82.00. Current price: $82.45.",                     read: false, createdAt: "2026-03-03T08:45:00Z", link: "/alerts" },
  { id: 3, type: "KYC",          title: "KYC Application Received", message: "Your KYC application has been received and is under review. We will notify you within 2 business days.", read: true, createdAt: "2026-03-02T14:30:00Z", link: "/onboarding" },
  { id: 4, type: "EWR",          title: "Warehouse Receipt Issued", message: "EWR #WR-2026-0042 has been issued for 10 MT of COCOA stored at Apapa Warehouse.",                   read: true, createdAt: "2026-03-02T11:00:00Z", link: "/receipts" },
  { id: 5, type: "SYSTEM",       title: "Scheduled Maintenance",    message: "The platform will undergo scheduled maintenance on Sunday, March 8, 2026 from 02:00–04:00 UTC.",      read: true, createdAt: "2026-03-01T09:00:00Z" },
  { id: 6, type: "ANNOUNCEMENT", title: "New Listing: SESAME-NG-SPOT", message: "Sesame Seeds (SESAME-NG-SPOT) is now available for trading on the NEXCOM Exchange.",             read: true, createdAt: "2026-02-28T10:00:00Z", link: "/markets" },
  { id: 7, type: "DEPOSIT",      title: "Deposit Graded",           message: "Your deposit DEP-001 has been graded: NG-SPLIT-DRY-G1. EWR issuance in progress.",                  read: true, createdAt: "2026-02-27T10:00:00Z", link: "/deposits" },
  { id: 8, type: "DELIVERY",     title: "Delivery Confirmed",       message: "DLV-001 delivery of 50 MT Ginger to Lagos Port has been confirmed by warehouse.",                    read: true, createdAt: "2026-02-26T10:00:00Z", link: "/delivery" },
];

const TYPE_CONFIG: Record<string, { icon: React.ElementType; color: string; bg: string; label: string }> = {
  TRADE:          { icon: ShoppingCart, color: "text-positive",         bg: "bg-positive/10",         label: "Trade" },
  SETTLEMENT:     { icon: TrendingUp,   color: "text-emerald-400",      bg: "bg-emerald-500/10",      label: "Settlement" },
  PRICE_ALERT:    { icon: AlertCircle,  color: "text-yellow-400",       bg: "bg-yellow-500/10",       label: "Alert" },
  ALERT:          { icon: AlertCircle,  color: "text-yellow-400",       bg: "bg-yellow-500/10",       label: "Alert" },
  KYC:            { icon: ShieldCheck,  color: "text-blue-400",         bg: "bg-blue-500/10",         label: "KYC" },
  SYSTEM:         { icon: Info,         color: "text-muted-foreground", bg: "bg-secondary",           label: "System" },
  MARGIN_CALL:    { icon: AlertCircle,  color: "text-red-400",          bg: "bg-red-500/10",          label: "Margin Call" },
  LIQUIDATED:     { icon: AlertCircle,  color: "text-red-500",          bg: "bg-red-600/10",          label: "Liquidated" },
  SECURITY_ALERT: { icon: ShieldCheck,  color: "text-orange-400",       bg: "bg-orange-500/10",       label: "Security" },
  WAREHOUSE:      { icon: Package,      color: "text-orange-400",       bg: "bg-orange-500/10",       label: "Warehouse" },
  ANNOUNCEMENT:   { icon: Bell,         color: "text-primary",          bg: "bg-primary/10",          label: "News" },
  EWR:            { icon: FileText,     color: "text-yellow-400",       bg: "bg-yellow-500/10",       label: "EWR" },
  DEPOSIT:        { icon: Package,      color: "text-blue-400",         bg: "bg-blue-500/10",         label: "Deposit" },
  DELIVERY:       { icon: Truck,        color: "text-orange-400",       bg: "bg-orange-500/10",       label: "Delivery" },
};

const PREF_DEFAULTS = {
  tradeExecutions: true, priceAlerts: true, ewrUpdates: true,
  depositUpdates: true, deliveryUpdates: true, systemMessages: false,
  emailNotifications: true, smsNotifications: false, pushNotifications: true,
};

// Map from local pref key to tRPC field name
const PREF_KEY_MAP: Record<keyof typeof PREF_DEFAULTS, string> = {
  tradeExecutions:    "notifTradeExecutions",
  priceAlerts:        "notifPriceAlerts",
  ewrUpdates:         "notifEwrUpdates",
  depositUpdates:     "notifDepositUpdates",
  deliveryUpdates:    "notifDeliveryUpdates",
  systemMessages:     "notifSystemMessages",
  emailNotifications: "notifEmail",
  smsNotifications:   "notifSms",
  pushNotifications:  "notifPush",
};

export default function Notifications() {
  const { isAuthenticated } = useAuth();
  const [, setLocation] = useLocation();
  const NOTIF_TAB_KEY = "nexcom:notif:activeTab";
  const [activeTab, setActiveTab] = useState(() =>
    typeof window !== "undefined" ? (localStorage.getItem(NOTIF_TAB_KEY) ?? "all") : "all"
  );
  const handleTabChange = (tab: string) => {
    setActiveTab(tab);
    localStorage.setItem(NOTIF_TAB_KEY, tab);
  };
  const [prefs, setPrefs] = useState(PREF_DEFAULTS);

  // Load persisted notification preferences from DB
  const { data: savedPrefs } = trpc.preferences.getNotifPrefs.useQuery(undefined, { enabled: isAuthenticated });
  const updateNotifPrefs = trpc.preferences.updateNotifPrefs.useMutation();
  const utils = trpc.useUtils();

  // Sync DB prefs into local state once loaded
  useEffect(() => {
    if (!savedPrefs) return;
    setPrefs({
      tradeExecutions:    savedPrefs.notifTradeExecutions,
      priceAlerts:        savedPrefs.notifPriceAlerts,
      ewrUpdates:         savedPrefs.notifEwrUpdates,
      depositUpdates:     savedPrefs.notifDepositUpdates,
      deliveryUpdates:    savedPrefs.notifDeliveryUpdates,
      systemMessages:     savedPrefs.notifSystemMessages,
      emailNotifications: savedPrefs.notifEmail,
      smsNotifications:   savedPrefs.notifSms,
      pushNotifications:  savedPrefs.notifPush,
    });
  }, [savedPrefs]);

  // Live tRPC data
  const { data: listData, isLoading, refetch } = trpc.notifications.list.useQuery(
    { limit: 100, page: 1, unreadOnly: false },
    { enabled: isAuthenticated }
  );
  const liveNotifs = listData?.notifications;
  const markRead = trpc.notifications.markRead.useMutation({
    onSuccess: () => refetch(),
    onError: (e) => toast.error(e.message),
  });
  const markAllRead = trpc.notifications.markAllRead.useMutation({
    onSuccess: () => { toast.success("All notifications marked as read"); refetch(); },
    onError: (e) => toast.error(e.message),
  });
  const deleteNotif = trpc.notifications.delete.useMutation({
    onSuccess: () => refetch(),
    onError: (e) => toast.error(e.message),
  });
  const deleteAll = trpc.notifications.deleteAll.useMutation({
    onSuccess: () => { toast.success("All notifications cleared"); refetch(); },
    onError: (e) => toast.error(e.message),
  });

  // Auto-dismiss: silently mark all as read when the page mounts (optimistic, runs once per visit)
  const hasAutoMarked = useRef(false);
  useEffect(() => {
    if (!isAuthenticated || hasAutoMarked.current || !liveNotifs) return;
    const hasUnread = liveNotifs.some(n => !n.read);
    if (!hasUnread) return;
    hasAutoMarked.current = true;
    // Optimistic: update the sidebar badge immediately via cache invalidation
    markAllRead.mutate();
  }, [isAuthenticated, liveNotifs]); // eslint-disable-line react-hooks/exhaustive-deps

  // Use live data if authenticated, fall back to mock for preview
  const allNotifs: DisplayNotif[] = useMemo(() => {
    if (isAuthenticated && liveNotifs) {
      return liveNotifs.map(n => ({
        id: n.id,
        type: (n.type as NotifType) ?? "SYSTEM",
        title: n.title,
        message: n.message,
        read: n.read,
        createdAt: new Date(n.createdAt).toISOString(),
        link: (n.metadata as Record<string, string> | null)?.link ?? undefined,
      }));
    }
    return MOCK_NOTIFS;
  }, [isAuthenticated, liveNotifs]);

  const filtered = useMemo(() => {
    if (activeTab === "unread")     return allNotifs.filter(n => !n.read);
    if (activeTab === "trade")      return allNotifs.filter(n => n.type === "TRADE");
    if (activeTab === "alerts")     return allNotifs.filter(n => n.type === "PRICE_ALERT" || n.type === "ALERT");
    if (activeTab === "kyc")        return allNotifs.filter(n => n.type === "KYC");
    if (activeTab === "settlement") return allNotifs.filter(n => n.type === "SETTLEMENT");
    if (activeTab === "security")   return allNotifs.filter(n => n.type === "SECURITY_ALERT" || n.type === "MARGIN_CALL" || n.type === "LIQUIDATED");
    return allNotifs;
  }, [allNotifs, activeTab]);

  const unreadCount = allNotifs.filter(n => !n.read).length;

  const handleMarkRead = (id: number) => {
    if (isAuthenticated) markRead.mutate({ id });
  };
  const handleDelete = (id: number) => {
    if (isAuthenticated) deleteNotif.mutate({ id });
    else toast.success("Notification deleted (preview)");
  };
  const handleMarkAllRead = () => {
    if (isAuthenticated) markAllRead.mutate();
    else toast.success("All marked as read (preview)");
  };
  const handleClearAll = () => {
    if (isAuthenticated) deleteAll.mutate();
    else toast.success("All cleared (preview)");
  };
  const togglePref = (key: keyof typeof PREF_DEFAULTS) => {
    const newVal = !prefs[key];
    // Optimistic local update
    setPrefs(p => ({ ...p, [key]: newVal }));
    if (isAuthenticated) {
      const trpcKey = PREF_KEY_MAP[key];
      updateNotifPrefs.mutate(
        { [trpcKey]: newVal },
        {
          onSuccess: () => utils.preferences.getNotifPrefs.invalidate(),
          onError: () => {
            // Rollback on failure
            setPrefs(p => ({ ...p, [key]: !newVal }));
            toast.error("Failed to save preference");
          },
        }
      );
    }
    toast.success("Preference updated");
  };

  const formatTime = (iso: string) => {
    const d = new Date(iso);
    const diff = Date.now() - d.getTime();
    const mins = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);
    if (mins < 1) return "Just now";
    if (mins < 60) return `${mins}m ago`;
    if (hours < 24) return `${hours}h ago`;
    if (days < 7) return `${days}d ago`;
    return d.toLocaleDateString();
  };

  return (
    <div className="page-container space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2" style={{ fontFamily: "'DM Serif Display', serif" }}>
            <Bell className="w-6 h-6 text-primary" />
            Notifications
            {unreadCount > 0 && (
              <Badge className="bg-primary text-white text-xs px-2 py-0.5">{unreadCount}</Badge>
            )}
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">Trades, price alerts, KYC updates, and system announcements</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button variant="outline" size="sm" className="gap-2" onClick={() => refetch()}>
            <RefreshCw className="w-3.5 h-3.5" />Refresh
          </Button>
          {unreadCount > 0 && (
            <Button variant="outline" size="sm" className="gap-2" onClick={handleMarkAllRead} disabled={markAllRead.isPending}>
              <CheckCheck className="w-3.5 h-3.5" />Mark All Read
            </Button>
          )}
          {allNotifs.length > 0 && (
            <Button variant="outline" size="sm" className="gap-2 text-destructive border-destructive/30 hover:bg-destructive/10" onClick={handleClearAll} disabled={deleteAll.isPending}>
              <Trash2 className="w-3.5 h-3.5" />Clear All
            </Button>
          )}
        </div>
      </div>

      {/* Auth banner */}
      {!isAuthenticated && (
        <div className="flex items-center justify-between px-4 py-3 rounded-lg bg-primary/10 border border-primary/20 text-sm">
          <span className="text-muted-foreground">Showing preview data. <a href={getLoginUrl()} className="text-primary hover:underline">Sign in</a> to see your real notifications.</span>
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "Total",   value: allNotifs.length,                                       color: "text-foreground" },
          { label: "Unread",  value: unreadCount,                                             color: "text-primary" },
          { label: "Alerts",  value: allNotifs.filter(n => n.type === "PRICE_ALERT").length,  color: "text-yellow-400" },
          { label: "Trades",  value: allNotifs.filter(n => n.type === "TRADE").length,        color: "text-positive" },
        ].map(({ label, value, color }) => (
          <div key={label} className="stat-card text-center">
            <div className={"text-2xl font-bold font-mono " + color}>{value}</div>
            <div className="text-xs text-muted-foreground mt-1">{label}</div>
          </div>
        ))}
      </div>

      <Tabs value={activeTab} onValueChange={handleTabChange}>
        <TabsList className="flex-wrap h-auto gap-1">
          <TabsTrigger value="all">All ({allNotifs.length})</TabsTrigger>
          <TabsTrigger value="unread">Unread ({unreadCount})</TabsTrigger>
          <TabsTrigger value="trade">Trades</TabsTrigger>
          <TabsTrigger value="alerts">Alerts</TabsTrigger>
          <TabsTrigger value="kyc">KYC</TabsTrigger>
          <TabsTrigger value="settlement">Settlement</TabsTrigger>
          <TabsTrigger value="security">Security</TabsTrigger>
          <TabsTrigger value="settings"><Settings className="w-3.5 h-3.5 mr-1.5" />Preferences</TabsTrigger>
        </TabsList>

        {["all","unread","trade","alerts","kyc","settlement","security"].map(tab => (
          <TabsContent key={tab} value={tab} className="mt-4">
            {isLoading ? (
              <div className="flex items-center justify-center py-16">
                <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
              </div>
            ) : filtered.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 gap-3">
                <BellOff className="w-10 h-10 text-muted-foreground/30" />
                <p className="text-muted-foreground text-sm">
                  {activeTab === "unread" ? "No unread notifications" : "No notifications"}
                </p>
              </div>
            ) : (
              <div className="exchange-table divide-y divide-border/50">
                {filtered.map(n => {
                  const tc = TYPE_CONFIG[n.type] ?? TYPE_CONFIG.SYSTEM;
                  const Icon = tc.icon;
                  return (
                    <div
                      key={n.id}
                      className={"flex items-start gap-4 px-4 py-4 exchange-row transition-colors cursor-pointer " + (!n.read ? "bg-primary/5" : "")}
                      onClick={() => {
                        if (!n.read) handleMarkRead(n.id);
                        if (n.link) setLocation(n.link);
                      }}
                    >
                      <div className={"w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 " + tc.bg}>
                        <Icon className={"w-4 h-4 " + tc.color} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-semibold text-foreground">{n.title}</span>
                          <Badge variant="outline" className={"text-[10px] " + tc.color}>{tc.label}</Badge>
                          {!n.read && <div className="w-2 h-2 rounded-full bg-primary flex-shrink-0" />}
                        </div>
                        <p className="text-sm text-muted-foreground mt-0.5 leading-relaxed">{n.message}</p>
                        <div className="flex items-center gap-3 mt-2">
                          <span className="text-xs text-muted-foreground">{formatTime(n.createdAt)}</span>
                          {n.link && (
                            <a href={n.link} className="text-xs text-primary hover:underline" onClick={e => e.stopPropagation()}>View →</a>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-1 flex-shrink-0">
                        {!n.read && (
                          <button
                            onClick={e => { e.stopPropagation(); handleMarkRead(n.id); }}
                            className="p-1.5 rounded hover:bg-primary/10 text-muted-foreground hover:text-primary transition-colors"
                            title="Mark as read"
                          >
                            <Check className="w-4 h-4" />
                          </button>
                        )}
                        <button
                          onClick={e => { e.stopPropagation(); handleDelete(n.id); }}
                          className="p-1.5 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
                          title="Delete"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </TabsContent>
        ))}

        <TabsContent value="settings" className="mt-4">
          <div className="rounded-xl border border-border overflow-hidden divide-y divide-border">
            <div className="px-4 py-3 bg-secondary/50">
              <h3 className="text-sm font-semibold text-foreground">Notification Preferences</h3>
              <p className="text-xs text-muted-foreground mt-0.5">Choose which events trigger notifications</p>
            </div>
            {[
              { key: "tradeExecutions" as const,  label: "Trade Executions",  desc: "Order fills, partial fills, and cancellations" },
              { key: "priceAlerts" as const,      label: "Price Alerts",       desc: "Significant price movements on watched instruments" },
              { key: "ewrUpdates" as const,       label: "EWR Updates",        desc: "Warehouse receipt issuance, transfers, and redemptions" },
              { key: "depositUpdates" as const,   label: "Deposit Updates",    desc: "Grading results and deposit status changes" },
              { key: "deliveryUpdates" as const,  label: "Delivery Updates",   desc: "Delivery confirmations and tracking updates" },
              { key: "systemMessages" as const,   label: "System Messages",    desc: "Exchange hours, maintenance, and announcements" },
            ].map(({ key, label, desc }) => (
              <div key={key} className="flex items-center justify-between px-4 py-3">
                <div>
                  <div className="text-sm font-medium text-foreground">{label}</div>
                  <div className="text-xs text-muted-foreground">{desc}</div>
                </div>
                <Switch checked={prefs[key]} onCheckedChange={() => togglePref(key)} />
              </div>
            ))}
            <div className="px-4 py-3 bg-secondary/50">
              <h3 className="text-sm font-semibold text-foreground">Delivery Channels</h3>
            </div>
            {[
              { key: "pushNotifications" as const,  label: "Push Notifications", desc: "In-app and browser push notifications" },
              { key: "emailNotifications" as const, label: "Email",               desc: "Receive notifications via email" },
              { key: "smsNotifications" as const,   label: "SMS",                 desc: "Text message alerts for high-priority events" },
            ].map(({ key, label, desc }) => (
              <div key={key} className="flex items-center justify-between px-4 py-3">
                <div>
                  <div className="text-sm font-medium text-foreground">{label}</div>
                  <div className="text-xs text-muted-foreground">{desc}</div>
                </div>
                <Switch checked={prefs[key]} onCheckedChange={() => togglePref(key)} />
              </div>
            ))}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
