/**
 * NEXCOM Exchange — Push Notification Settings
 *
 * Allows any authenticated user to:
 *  - Subscribe their current browser to push notifications
 *  - View and manage all subscribed devices
 *  - Toggle per-topic preferences (price alerts, trade fills, system alerts)
 *  - Send a test push notification
 *  - Unsubscribe individual devices
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Bell,
  BellOff,
  BellRing,
  Smartphone,
  Trash2,
  Send,
  CheckCircle2,
  AlertTriangle,
  Info,
} from "lucide-react";
import { toast } from "sonner";

// ── Helpers ───────────────────────────────────────────────────────────────────

async function subscribeToPush(vapidPublicKey: string): Promise<PushSubscription | null> {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
    toast.error("Push notifications are not supported in this browser.");
    return null;
  }

  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    toast.error("Notification permission denied.");
    return null;
  }

  const reg = await navigator.serviceWorker.ready;
  const existing = await reg.pushManager.getSubscription();
  if (existing) return existing;

  // Convert base64url VAPID key to Uint8Array
  const base64 = vapidPublicKey.replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const applicationServerKey = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) applicationServerKey[i] = raw.charCodeAt(i);

  return reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey });
}

function deviceLabel(userAgent: string | null | undefined): string {
  if (!userAgent) return "Unknown Device";
  if (userAgent.includes("iPhone") || userAgent.includes("iPad")) return "iOS Device";
  if (userAgent.includes("Android")) return "Android Device";
  if (userAgent.includes("Chrome")) return "Chrome Browser";
  if (userAgent.includes("Firefox")) return "Firefox Browser";
  if (userAgent.includes("Safari")) return "Safari Browser";
  return "Browser";
}

// ── Main Component ────────────────────────────────────────────────────────────

interface PushNotificationSettingsProps {
  /** When true, renders a compact collapsible card suitable for embedding in dashboards */
  compact?: boolean;
}

export default function PushNotificationSettings({ compact = false }: PushNotificationSettingsProps) {
  const [expanded, setExpanded] = useState(!compact);
  const utils = trpc.useUtils();
  const [subscribing, setSubscribing] = useState(false);

  const { data: vapidData } = trpc.pushNotifications.getVapidPublicKey.useQuery();
  const { data: devices = [], isLoading } = trpc.pushNotifications.getMyDevices.useQuery();

  const subscribeMutation = trpc.pushNotifications.subscribe.useMutation({
    onSuccess: () => {
      utils.pushNotifications.getMyDevices.invalidate();
      toast.success("This device is now subscribed to push notifications.");
    },
    onError: e => toast.error("Subscribe failed: " + e.message),
  });

  const unsubscribeMutation = trpc.pushNotifications.unsubscribe.useMutation({
    onSuccess: () => {
      utils.pushNotifications.getMyDevices.invalidate();
      toast.success("Device unsubscribed.");
    },
    onError: e => toast.error("Unsubscribe failed: " + e.message),
  });

  const updatePrefsMutation = trpc.pushNotifications.updatePrefs.useMutation({
    onSuccess: () => utils.pushNotifications.getMyDevices.invalidate(),
    onError: e => toast.error("Update failed: " + e.message),
  });

  const sendTestMutation = trpc.pushNotifications.sendTest.useMutation({
    onSuccess: r => toast.success(`Test notification sent to ${r.sent} device(s).`),
    onError: e => toast.error("Test failed: " + e.message),
  });

  async function handleSubscribe() {
    if (!vapidData?.publicKey) {
      toast.error("Push notifications are not configured on this server. Set VAPID_PUBLIC_KEY.");
      return;
    }
    setSubscribing(true);
    try {
      const sub = await subscribeToPush(vapidData.publicKey);
      if (!sub) return;
      const json = sub.toJSON();
      subscribeMutation.mutate({
        endpoint: json.endpoint!,
        p256dh: json.keys!.p256dh,
        auth: json.keys!.auth,
        userAgent: navigator.userAgent,
        deviceLabel: deviceLabel(navigator.userAgent),
      });
    } catch (err) {
      toast.error("Failed to subscribe: " + (err instanceof Error ? err.message : String(err)));
    } finally {
      setSubscribing(false);
    }
  }

  async function handleUnsubscribe(endpoint: string) {
    // Also unsubscribe from the browser's push manager
    const reg = await navigator.serviceWorker?.ready.catch(() => null);
    if (reg) {
      const sub = await reg.pushManager.getSubscription().catch(() => null);
      if (sub && sub.endpoint === endpoint) await sub.unsubscribe().catch(() => {});
    }
    unsubscribeMutation.mutate({ endpoint });
  }

  const isCurrentDeviceSubscribed = devices.some(d => {
    // We can't easily compare endpoints without getting the current subscription,
    // so we just show the count
    return true;
  });

  if (compact && !expanded) {
    return (
      <button
        onClick={() => setExpanded(true)}
        className="w-full flex items-center justify-between p-3 rounded-lg border border-border/40 bg-muted/20 hover:bg-muted/40 transition-colors text-left"
      >
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Bell className="w-4 h-4" />
          <span>Push Notifications</span>
          {devices.length > 0 && (
            <Badge className="bg-emerald-500/15 text-emerald-400 border-emerald-500/30 text-xs">
              {devices.length} device{devices.length !== 1 ? "s" : ""}
            </Badge>
          )}
        </div>
        <span className="text-xs text-muted-foreground">Configure →</span>
      </button>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header card */}
      <Card className="border-border/50">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Bell className="w-4 h-4" />
              Push Notifications
            </CardTitle>
            {devices.length > 0 ? (
              <Badge className="bg-emerald-500/15 text-emerald-400 border-emerald-500/30 gap-1">
                <CheckCircle2 className="w-3 h-3" />
                {devices.length} device{devices.length !== 1 ? "s" : ""} subscribed
              </Badge>
            ) : (
              <Badge className="bg-muted text-muted-foreground border-border gap-1">
                <BellOff className="w-3 h-3" />
                Not subscribed
              </Badge>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {!vapidData?.supported && (
            <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20 text-xs text-amber-400">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>
                VAPID keys are not configured. Set <code className="font-mono">VAPID_PUBLIC_KEY</code>,{" "}
                <code className="font-mono">VAPID_PRIVATE_KEY</code>, and{" "}
                <code className="font-mono">VAPID_SUBJECT</code> environment variables to enable real push notifications.
                Notifications will be simulated (logged only) until then.
              </span>
            </div>
          )}

          <div className="flex gap-2">
            <Button
              size="sm"
              onClick={handleSubscribe}
              disabled={subscribing || subscribeMutation.isPending}
              className="gap-2"
            >
              <BellRing className="w-4 h-4" />
              {subscribing ? "Subscribing..." : "Subscribe This Device"}
            </Button>
            {devices.length > 0 && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => sendTestMutation.mutate()}
                disabled={sendTestMutation.isPending}
                className="gap-2"
              >
                <Send className="w-4 h-4" />
                {sendTestMutation.isPending ? "Sending..." : "Send Test"}
              </Button>
            )}
          </div>

          <div className="flex items-start gap-2 text-xs text-muted-foreground">
            <Info className="w-3 h-3 shrink-0 mt-0.5" />
            <span>
              Push notifications are delivered even when the app is closed, as long as your browser is running.
              Each browser/device must be subscribed separately.
            </span>
          </div>
        </CardContent>
      </Card>

      {/* Device list */}
      {!isLoading && devices.length > 0 && (
        <Card className="border-border/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Smartphone className="w-4 h-4" />
              Subscribed Devices
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {devices.map(device => (
              <div key={device.id} className="border border-border/50 rounded-lg p-3 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-foreground">
                      {device.deviceLabel ?? deviceLabel(device.userAgent)}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Subscribed {new Date(device.createdAt).toLocaleDateString()}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleUnsubscribe(device.endpoint)}
                    disabled={unsubscribeMutation.isPending}
                    className="text-destructive hover:text-destructive"
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>

                {/* Per-topic toggles */}
                <div className="grid grid-cols-1 gap-2">
                  {[
                    { key: "enablePriceAlerts" as const, label: "Price Alerts", value: device.enablePriceAlerts },
                    { key: "enableTradeFills" as const, label: "Trade Fills", value: device.enableTradeFills },
                    { key: "enableSystemAlerts" as const, label: "System Alerts", value: device.enableSystemAlerts },
                  ].map(({ key, label, value }) => (
                    <div key={key} className="flex items-center justify-between">
                      <Label className="text-xs text-muted-foreground">{label}</Label>
                      <Switch
                        checked={value}
                        onCheckedChange={checked =>
                          updatePrefsMutation.mutate({ subscriptionId: device.id, [key]: checked })
                        }
                        disabled={updatePrefsMutation.isPending}
                      />
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
