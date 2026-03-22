import { useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Monitor, Smartphone, Globe, Clock, ShieldAlert, Trash2, RefreshCw } from "lucide-react";

function DeviceIcon({ userAgent }: { userAgent: string }) {
  const ua = userAgent.toLowerCase();
  if (ua.includes("mobile") || ua.includes("android") || ua.includes("iphone")) {
    return <Smartphone className="w-5 h-5" />;
  }
  return <Monitor className="w-5 h-5" />;
}

function formatRelativeTime(date: Date | string | null) {
  if (!date) return "—";
  const d = new Date(date);
  const diff = Date.now() - d.getTime();
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  return `${days}d ago`;
}

export default function DeviceSessions() {
  const [fingerprint] = useState(() => {
    // Generate a stable fingerprint for this browser session
    const nav = navigator;
    return btoa(`${nav.userAgent}|${nav.language}|${screen.width}x${screen.height}|${Intl.DateTimeFormat().resolvedOptions().timeZone}`).slice(0, 64);
  });

  const { data: sessions, refetch, isLoading } = trpc.deviceSession.listMySessions.useQuery();

  const recordMutation = trpc.deviceSession.recordSession.useMutation({
    onSuccess: (data) => {
       if (data.isNewDevice) {
        toast.warning("New device detected! If this wasn't you, please secure your account.");
      } else {
        toast.success("Device session recorded.");
      }
      refetch();
    },
    onError: (err) => toast.error(err.message),
  });

  const removeMutation = trpc.deviceSession.revokeDevice.useMutation({
    onSuccess: () => {
      toast.success("Device removed.");
      refetch();
    },
    onError: (err) => toast.error(err.message),
  });

  const handleRecordCurrentDevice = () => {
    recordMutation.mutate({
      userAgent: navigator.userAgent,
      screenResolution: `${screen.width}x${screen.height}`,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      language: navigator.language,
    });
  };

  return (
    <DashboardLayout>
      <div className="max-w-3xl mx-auto space-y-6 p-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Monitor className="w-7 h-7 text-primary" />
            <div>
              <h1 className="text-2xl font-bold">Device Sessions</h1>
              <p className="text-muted-foreground text-sm">Manage trusted devices and monitor login activity</p>
            </div>
          </div>
          <Button onClick={handleRecordCurrentDevice} disabled={recordMutation.isPending} variant="outline">
            <RefreshCw className="w-4 h-4 mr-2" />
            Register This Device
          </Button>
        </div>

        {/* Current device info */}
        <Card className="border-primary/30 bg-primary/5">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Globe className="w-4 h-4" /> Current Browser
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground space-y-1">
            <p><span className="font-medium text-foreground">User Agent:</span> {navigator.userAgent.slice(0, 80)}...</p>
            <p><span className="font-medium text-foreground">Screen:</span> {screen.width}×{screen.height}</p>
            <p><span className="font-medium text-foreground">Timezone:</span> {Intl.DateTimeFormat().resolvedOptions().timeZone}</p>
            <p><span className="font-medium text-foreground">Language:</span> {navigator.language}</p>
          </CardContent>
        </Card>

        {/* Sessions list */}
        <Card>
          <CardHeader>
            <CardTitle>Registered Devices</CardTitle>
            <CardDescription>
              Devices that have been used to access your account. Unrecognised devices are flagged automatically.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="text-center py-8 text-muted-foreground">Loading sessions...</div>
            ) : !sessions || sessions.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <Monitor className="w-10 h-10 mx-auto mb-3 opacity-30" />
                <p>No device sessions recorded yet.</p>
                <p className="text-xs mt-1">Click "Register This Device" to add your current browser.</p>
              </div>
            ) : (
              <div className="space-y-3">
                  {sessions.map((session) => (<div
                    key={session.id}
                    className={`flex items-start gap-3 p-3 rounded-lg border ${
                      session.isKnown ? "border-border" : "border-amber-500/50 bg-amber-500/5"
                    }`}
                  >
                    <div className={`mt-0.5 ${session.isKnown ? "text-muted-foreground" : "text-amber-500"}`}>
                      <DeviceIcon userAgent={session.userAgent ?? ""} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium truncate">
                          {session.userAgent?.split(" ").slice(-2).join(" ") ?? "Unknown device"}
                        </span>
                        <Badge variant={session.isKnown ? "secondary" : "destructive"} className="text-xs">
                          {session.isKnown ? "Known" : "Unrecognised"}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-4 mt-1 text-xs text-muted-foreground flex-wrap">
                        {session.screenResolution && (
                          <span className="flex items-center gap-1">
                            <Monitor className="w-3 h-3" /> {session.screenResolution}
                          </span>
                        )}
                        {session.timezone && (
                          <span className="flex items-center gap-1">
                            <Globe className="w-3 h-3" /> {session.timezone}
                          </span>
                        )}
                        <span className="flex items-center gap-1">
                          <Clock className="w-3 h-3" /> Last seen {formatRelativeTime(session.lastSeenAt)}
                        </span>
                        <span className="flex items-center gap-1">
                          <Clock className="w-3 h-3" /> First seen {formatRelativeTime(session.firstSeenAt)}
                        </span>
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-muted-foreground hover:text-destructive"
                      onClick={() => removeMutation.mutate({ sessionId: session.id })}
                      disabled={removeMutation.isPending}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Security tip */}
        <Card className="bg-muted/30">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <ShieldAlert className="w-4 h-4" /> Security Tip
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            <p>If you see an unrecognised device, your account may have been accessed without your knowledge. Change your password immediately and enable Two-Factor Authentication.</p>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
