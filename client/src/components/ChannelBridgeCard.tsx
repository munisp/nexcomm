/**
 * NEXCOM Exchange — ChannelBridgeCard (INNOVATION 6)
 * ─────────────────────────────────────────────────────────────────────────────
 * Dashboard card for omnichannel session continuity (USSD ↔ web/PWA):
 *   • "Continue on your phone (USSD)" — generates a 6-digit code to enter
 *     during a *347*99# session.
 *   • "I have a code from USSD" — enter the code shown on the phone to pull the
 *     pending intent (e.g. draft order) into the web session.
 *   • Shows where the account is currently active (web devices, USSD sessions).
 *
 * Usage (any dashboard page):
 *   import { ChannelBridgeCard } from "@/components/ChannelBridgeCard";
 *   <ChannelBridgeCard />
 */
import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Smartphone, Globe, ArrowRightLeft, KeyRound, Clock, MonitorSmartphone } from "lucide-react";

const USSD_CODE = "*347*99#";

export function ChannelBridgeCard() {
  const [mode, setMode] = useState<"idle" | "showOtp" | "enterOtp">("idle");
  const [otp, setOtp] = useState("");
  const [generated, setGenerated] = useState<{ otp: string; expiresAt: Date } | null>(null);

  const utils = trpc.useUtils();
  const sessionsQuery = trpc.channelBridge.getMyChannelSessions.useQuery(undefined, {
    staleTime: 30_000,
  });

  const createMutation = trpc.channelBridge.createHandoffToken.useMutation({
    onSuccess: (data) => {
      setGenerated({ otp: data.otp, expiresAt: new Date(data.expiresAt) });
      setMode("showOtp");
      utils.channelBridge.getMyChannelSessions.invalidate();
    },
    onError: (err) => toast.error("Could not create handoff", { description: err.message }),
  });

  const completeMutation = trpc.channelBridge.completeHandoff.useMutation({
    onSuccess: (data) => {
      const summary =
        data.intent?.summary ??
        (data.intent?.type ? `Pending: ${data.intent.type.replace(/_/g, " ")}` : null);
      toast.success("Session continued", {
        description: summary ?? `Handoff from ${data.channelFrom} completed.`,
      });
      setMode("idle");
      setOtp("");
      utils.channelBridge.getMyChannelSessions.invalidate();
    },
    onError: (err) => toast.error("Handoff failed", { description: err.message }),
  });

  const sessions = sessionsQuery.data;
  const activeUssd = sessions?.ussd.filter((s) => s.status === "ACTIVE") ?? [];
  const webCount = sessions?.web.length ?? 0;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ArrowRightLeft className="w-4 h-4 text-primary" />
            <CardTitle className="text-base">Continue on Another Channel</CardTitle>
          </div>
          {(activeUssd.length > 0 || webCount > 0) && (
            <Badge variant="secondary" className="text-xs">
              <MonitorSmartphone className="w-3 h-3 mr-1" />
              {webCount} web · {activeUssd.length} USSD active
            </Badge>
          )}
        </div>
        <CardDescription>
          Move between the web portal and USSD ({USSD_CODE}) without losing your place.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {mode === "idle" && (
          <div className="grid gap-2 sm:grid-cols-2">
            <Button
              variant="outline"
              className="justify-start"
              disabled={createMutation.isPending}
              onClick={() =>
                createMutation.mutate({ channelFrom: "WEB", channelTo: "USSD" })
              }
            >
              <Smartphone className="w-4 h-4 mr-2" />
              Continue on your phone (USSD)
            </Button>
            <Button
              variant="outline"
              className="justify-start"
              onClick={() => setMode("enterOtp")}
            >
              <Globe className="w-4 h-4 mr-2" />
              I have a code from USSD
            </Button>
          </div>
        )}

        {mode === "showOtp" && generated && (
          <div className="rounded-md border bg-muted/40 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Your one-time code</span>
              <Badge variant="outline" className="text-xs">
                <Clock className="w-3 h-3 mr-1" />
                expires {new Date(generated.expiresAt).toLocaleTimeString("en-NG", { hour: "2-digit", minute: "2-digit" })}
              </Badge>
            </div>
            <p className="text-3xl font-mono font-bold tracking-[0.3em] text-center" aria-live="polite">
              {generated.otp}
            </p>
            <ol className="text-sm text-muted-foreground list-decimal list-inside space-y-1">
              <li>Dial <span className="font-mono">{USSD_CODE}</span> on your registered phone
                {sessions?.registeredPhone ? ` (…${sessions.registeredPhone.slice(-4)})` : ""}.</li>
              <li>Choose <span className="font-semibold">Continue web session</span> from the main menu.</li>
              <li>Enter this 6-digit code. Codes are single-use and expire in 10 minutes.</li>
            </ol>
            <Button variant="ghost" size="sm" onClick={() => { setMode("idle"); setGenerated(null); }}>
              Done
            </Button>
          </div>
        )}

        {mode === "enterOtp" && (
          <div className="rounded-md border p-4 space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="handoff-otp">6-digit code from your USSD session</Label>
              <div className="flex gap-2">
                <Input
                  id="handoff-otp"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  placeholder="000000"
                  className="font-mono tracking-[0.3em] text-center"
                  value={otp}
                  onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
                />
                <Button
                  disabled={otp.length !== 6 || completeMutation.isPending}
                  onClick={() => completeMutation.mutate({ otp })}
                >
                  <KeyRound className="w-4 h-4 mr-2" />
                  Continue
                </Button>
              </div>
            </div>
            <Button variant="ghost" size="sm" onClick={() => { setMode("idle"); setOtp(""); }}>
              Cancel
            </Button>
          </div>
        )}

        {sessions && (sessions.web.length > 0 || sessions.ussd.length > 0) && (
          <>
            <Separator />
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Where you're active</p>
              <ul className="text-sm space-y-1">
                {sessions.web.slice(0, 3).map((d) => (
                  <li key={`web-${d.id}`} className="flex items-center gap-2 text-muted-foreground">
                    <Globe className="w-3.5 h-3.5" />
                    <span className="truncate">{d.userAgent?.slice(0, 60) ?? "Web session"}</span>
                    <span className="text-xs">· {new Date(d.lastSeenAt).toLocaleDateString("en-NG")}</span>
                  </li>
                ))}
                {sessions.ussd.slice(0, 2).map((s) => (
                  <li key={`ussd-${s.id}`} className="flex items-center gap-2 text-muted-foreground">
                    <Smartphone className="w-3.5 h-3.5" />
                    <span>USSD …{s.phoneNumber.slice(-4)}</span>
                    <Badge variant={s.status === "ACTIVE" ? "default" : "secondary"} className="text-[10px]">
                      {s.status}
                    </Badge>
                  </li>
                ))}
              </ul>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
