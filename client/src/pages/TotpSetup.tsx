import { useState, useEffect, useRef } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { ShieldCheck, ShieldOff, Smartphone, Copy, CheckCircle, AlertTriangle, KeyRound } from "lucide-react";
import QRCode from "qrcode";

export default function TotpSetup() {
  const [step, setStep] = useState<"status" | "setup" | "verify" | "backup">("status");
  const [qrDataUrl, setQrDataUrl] = useState<string>("");
  const [verifyCode, setVerifyCode] = useState("");
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [disableCode, setDisableCode] = useState("");
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const { data: totpStatus, refetch: refetchStatus } = trpc.totp.getStatus.useQuery();

  const setupMutation = trpc.totp.generateSecret.useMutation({
    onSuccess: async (data: { secret: string; otpauthUrl: string }) => {
      // Generate QR code from the otpauth URI
      try {
        const url = await QRCode.toDataURL(data.otpauthUrl, { width: 256, margin: 2 });
        setQrDataUrl(url);
      } catch {
        setQrDataUrl("");
      }
      setStep("verify");
    },
    onError: (err) => toast.error(err.message),
  });

  const verifyMutation = trpc.totp.confirmSetup.useMutation({
    onSuccess: (data: { success: boolean; backupCodes: string[] }) => {
      setBackupCodes(data.backupCodes);
      setStep("backup");
      refetchStatus();
      toast.success("Two-factor authentication enabled!");
    },
    onError: (err) => toast.error(err.message),
  });

  const disableMutation = trpc.totp.disable.useMutation({
    onSuccess: () => {
      setStep("status");
      refetchStatus();
      toast.success("Two-factor authentication disabled.");
    },
    onError: (err) => toast.error(err.message),
  });

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text).then(() => toast.success("Copied to clipboard"));
  };

  return (
    <DashboardLayout>
      <div className="max-w-2xl mx-auto space-y-6 p-6">
        <div className="flex items-center gap-3">
          <ShieldCheck className="w-7 h-7 text-primary" />
          <div>
            <h1 className="text-2xl font-bold">Two-Factor Authentication</h1>
            <p className="text-muted-foreground text-sm">Protect your account with TOTP (Google Authenticator / Authy)</p>
          </div>
        </div>

        {/* Status Card */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              {totpStatus?.isEnabled ? (
                <><ShieldCheck className="w-5 h-5 text-green-500" /> 2FA is Active</>
              ) : (
                <><ShieldOff className="w-5 h-5 text-muted-foreground" /> 2FA is Disabled</>
              )}
              <Badge variant={totpStatus?.isEnabled ? "default" : "secondary"} className="ml-auto">
                {totpStatus?.isEnabled ? "Enabled" : "Disabled"}
              </Badge>
            </CardTitle>
            <CardDescription>
              {totpStatus?.isEnabled
                ? "Your account is protected with time-based one-time passwords."
                : "Add an extra layer of security to your account."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {totpStatus?.isEnabled ? (
              <div className="space-y-4">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <CheckCircle className="w-4 h-4 text-green-500" />
                  Enabled on {totpStatus?.confirmedAt ? new Date(totpStatus.confirmedAt).toLocaleDateString() : "—"}
                </div>
                {step !== "status" ? null : (
                  <div className="space-y-3">
                    <p className="text-sm font-medium">Disable 2FA</p>
                    <p className="text-xs text-muted-foreground">Enter your current authenticator code to disable 2FA.</p>
                    <div className="flex gap-2">
                      <Input
                        placeholder="6-digit code"
                        value={disableCode}
                        onChange={(e) => setDisableCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                        maxLength={6}
                        className="w-40 font-mono text-center tracking-widest"
                      />
                      <Button
                        variant="destructive"
                        onClick={() => disableMutation.mutate({ code: disableCode } as { code: string })}
                        disabled={disableCode.length !== 6 || disableMutation.isPending}
                      >
                        <ShieldOff className="w-4 h-4 mr-2" />
                        Disable 2FA
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <Button onClick={() => setupMutation.mutate()} disabled={setupMutation.isPending}>
                <Smartphone className="w-4 h-4 mr-2" />
                {setupMutation.isPending ? "Generating..." : "Set Up 2FA"}
              </Button>
            )}
          </CardContent>
        </Card>

        {/* Setup Step: Show QR Code */}
        {step === "verify" && setupMutation.data && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Smartphone className="w-5 h-5" /> Scan QR Code
              </CardTitle>
              <CardDescription>
                Open Google Authenticator or Authy and scan the QR code below.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="flex flex-col items-center gap-4">
                {qrDataUrl ? (
                  <img src={qrDataUrl} alt="TOTP QR Code" className="w-56 h-56 border rounded-lg p-2 bg-white" />
                ) : (
                  <div className="w-56 h-56 border rounded-lg flex items-center justify-center text-muted-foreground text-sm">
                    Generating QR code...
                  </div>
                )}
                <div className="text-center">
                  <p className="text-xs text-muted-foreground mb-1">Or enter this key manually:</p>
                  <div className="flex items-center gap-2 bg-muted rounded px-3 py-2">
                    <code className="text-sm font-mono tracking-widest">{setupMutation.data.secret}</code>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6"
                      onClick={() => copyToClipboard(setupMutation.data!.secret)}
                    >
                      <Copy className="w-3 h-3" />
                    </Button>
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <p className="text-sm font-medium">Enter the 6-digit code from your app to confirm:</p>
                <div className="flex gap-2">
                  <Input
                    placeholder="000000"
                    value={verifyCode}
                    onChange={(e) => setVerifyCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                    maxLength={6}
                    className="w-40 font-mono text-center tracking-widest text-lg"
                    autoFocus
                  />
                  <Button
                    onClick={() => verifyMutation.mutate({ code: verifyCode } as { code: string })}
                    disabled={verifyCode.length !== 6 || verifyMutation.isPending}
                  >
                    <CheckCircle className="w-4 h-4 mr-2" />
                    {verifyMutation.isPending ? "Verifying..." : "Confirm & Enable"}
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Backup Codes */}
        {step === "backup" && backupCodes.length > 0 && (
          <Card className="border-amber-500/50">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-amber-600">
                <AlertTriangle className="w-5 h-5" /> Save Your Backup Codes
              </CardTitle>
              <CardDescription>
                Store these codes securely. Each can be used once if you lose access to your authenticator app.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-2">
                {backupCodes.map((code, i) => (
                  <div key={i} className="flex items-center justify-between bg-muted rounded px-3 py-2">
                    <code className="text-sm font-mono tracking-widest">{code}</code>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6"
                      onClick={() => copyToClipboard(code)}
                    >
                      <Copy className="w-3 h-3" />
                    </Button>
                  </div>
                ))}
              </div>
              <Button
                className="w-full"
                onClick={() => {
                  const text = backupCodes.join("\n");
                  copyToClipboard(text);
                }}
                variant="outline"
              >
                <Copy className="w-4 h-4 mr-2" /> Copy All Codes
              </Button>
              <Button className="w-full" onClick={() => setStep("status")}>
                <CheckCircle className="w-4 h-4 mr-2" /> I've Saved My Codes
              </Button>
            </CardContent>
          </Card>
        )}

        {/* How it works */}
        <Card className="bg-muted/30">
          <CardHeader>
            <CardTitle className="text-sm flex items-center gap-2">
              <KeyRound className="w-4 h-4" /> How TOTP 2FA Works
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground space-y-2">
            <p>After enabling 2FA, admin actions will require you to enter a 6-digit code from your authenticator app in addition to your regular login.</p>
            <p>The code changes every 30 seconds and is tied to your specific device, making it extremely difficult for attackers to gain access even if they have your password.</p>
            <p>This protects against deepfake social-engineering attacks where an attacker might impersonate you to gain access.</p>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
