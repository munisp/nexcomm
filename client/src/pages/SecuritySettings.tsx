import { useState } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import DashboardLayout from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Webhook,
  Shield,
  Plus,
  Trash2,
  Play,
  ToggleLeft,
  ToggleRight,
  Settings,
  AlertTriangle,
  Fingerprint,
  Laptop,
  Smartphone,
  Key,
  CheckCircle2,
  XCircle,
  RefreshCw,
  Pencil,
  Mail,
  CalendarDays,
  ShieldCheck,
  ShieldOff,
  QrCode,
  ExternalLink,
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/_core/hooks/useAuth";
import { PageSkeleton } from "@/components/PageSkeleton";

// ─── Relative time helper ─────────────────────────────────────────────────────
function formatRelativeTime(date: Date): string {
  const now = Date.now();
  const diffMs = now - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHr  = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHr  / 24);
  const diffWk  = Math.floor(diffDay / 7);
  const diffMo  = Math.floor(diffDay / 30);
  const diffYr  = Math.floor(diffDay / 365);

  if (diffSec < 60)  return "just now";
  if (diffMin < 60)  return `${diffMin} minute${diffMin !== 1 ? "s" : ""} ago`;
  if (diffHr  < 24)  return `${diffHr} hour${diffHr !== 1 ? "s" : ""} ago`;
  if (diffDay < 7)   return `${diffDay} day${diffDay !== 1 ? "s" : ""} ago`;
  if (diffWk  < 5)   return `${diffWk} week${diffWk !== 1 ? "s" : ""} ago`;
  if (diffMo  < 12)  return `${diffMo} month${diffMo !== 1 ? "s" : ""} ago`;
  return `${diffYr} year${diffYr !== 1 ? "s" : ""} ago`;
}


// --- TOTP / Authenticator App Tab ---
function TotpTab() {
  const [, navigate] = useLocation();
  const { data: totpStatus, isLoading } = trpc.totp.getStatus.useQuery();
  const isEnabled = totpStatus?.isEnabled ?? false;
  const confirmedAt = totpStatus?.confirmedAt ? new Date(totpStatus.confirmedAt as unknown as string) : null;

  return (
    <div className="space-y-6">
      <Card className="bg-card border-border">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            {isEnabled ? (
              <ShieldCheck className="h-5 w-5 text-emerald-500" />
            ) : (
              <ShieldOff className="h-5 w-5 text-muted-foreground" />
            )}
            Authenticator App (TOTP)
          </CardTitle>
          <CardDescription>
            Use Google Authenticator, Authy, 1Password, or any TOTP-compatible app to generate
            time-based one-time codes as a second factor.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {isLoading ? (
            <div className="h-10 bg-muted animate-pulse rounded" />
          ) : (
            <>
              <div className="flex items-center justify-between p-4 rounded-lg bg-muted/40 border border-border">
                <div className="space-y-1">
                  <p className="text-sm font-medium">
                    Status:{" "}
                    <Badge
                      className={isEnabled ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/30" : ""}
                      variant={isEnabled ? "outline" : "secondary"}
                    >
                      {isEnabled ? (
                        <><CheckCircle2 className="h-3 w-3 mr-1 inline" /> Enabled</>
                      ) : (
                        <><XCircle className="h-3 w-3 mr-1 inline" /> Disabled</>
                      )}
                    </Badge>
                  </p>
                  {confirmedAt && (
                    <p className="text-xs text-muted-foreground">
                      Enabled {formatRelativeTime(confirmedAt)}
                    </p>
                  )}
                </div>
                <Button
                  onClick={() => navigate("/totp-setup")}
                  variant={isEnabled ? "outline" : "default"}
                >
                  <QrCode className="h-4 w-4 mr-2" />
                  {isEnabled ? "Manage TOTP" : "Set Up TOTP"}
                  <ExternalLink className="h-3 w-3 ml-2 opacity-60" />
                </Button>
              </div>

              {isEnabled ? (
                <Alert className="border-emerald-200 bg-emerald-50 dark:bg-emerald-950/20">
                  <ShieldCheck className="h-4 w-4 text-emerald-600" />
                  <AlertDescription className="text-sm text-emerald-800 dark:text-emerald-200">
                    Your account is protected with TOTP two-factor authentication. You will be
                    prompted for a 6-digit code on sensitive operations. Manage backup codes on
                    the TOTP setup page.
                  </AlertDescription>
                </Alert>
              ) : (
                <Alert className="border-amber-200 bg-amber-50 dark:bg-amber-950/20">
                  <AlertTriangle className="h-4 w-4 text-amber-600" />
                  <AlertDescription className="text-sm text-amber-800 dark:text-amber-200">
                    TOTP is not enabled. We strongly recommend enabling an authenticator app as a
                    second factor. It takes under 2 minutes and significantly reduces account
                    compromise risk.
                  </AlertDescription>
                </Alert>
              )}

              <div className="rounded-lg border border-border bg-muted/30 p-4 space-y-2">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">How it works</p>
                <ol className="text-xs text-muted-foreground space-y-1 list-decimal list-inside">
                  <li>Install an authenticator app (Google Authenticator, Authy, 1Password, Bitwarden)</li>
                  <li>Scan the QR code shown on the TOTP setup page</li>
                  <li>Enter the 6-digit code to confirm setup</li>
                  <li>Save your 8 backup codes in a secure location</li>
                  <li>Use a fresh code whenever prompted during login or sensitive actions</li>
                </ol>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ─── FIDO2 / Passkeys Tab ─────────────────────────────────────────────────────

function PasskeysTab() {
  const utils = trpc.useUtils();
  const [renameId, setRenameId] = useState<string | null>(null);
  const [renameName, setRenameName] = useState("");
  const [registering, setRegistering] = useState(false);
  const [verifying, setVerifying] = useState(false);

  const { data: mfaStatus, isLoading } = trpc.webauthn.getMfaStatus.useQuery();

  const registrationOptionsMut = trpc.webauthn.registrationOptions.useMutation();
  const verifyRegistrationMut = trpc.webauthn.verifyRegistration.useMutation({
    onSuccess: () => {
      utils.webauthn.getMfaStatus.invalidate();
      toast.success("Passkey registered successfully");
      setRegistering(false);
    },
    onError: (e) => toast.error(e.message),
  });
  const removeCredentialMut = trpc.webauthn.removeCredential.useMutation({
    onSuccess: () => {
      utils.webauthn.getMfaStatus.invalidate();
      toast.success("Passkey removed");
    },
    onError: (e) => toast.error(e.message),
  });
  const renameCredentialMut = trpc.webauthn.renameCredential.useMutation({
    onSuccess: () => {
      utils.webauthn.getMfaStatus.invalidate();
      toast.success("Passkey renamed");
      setRenameId(null);
    },
    onError: (e) => toast.error(e.message),
  });
  const setMfaRequiredMut = trpc.webauthn.setMfaRequired.useMutation({
    onSuccess: () => utils.webauthn.getMfaStatus.invalidate(),
    onError: (e) => toast.error(e.message),
  });
  const sendEmailOtpMut = trpc.webauthn.sendEmailOtp.useMutation({
    onSuccess: (d) => toast.success(`OTP sent to ${d.maskedEmail}`),
    onError: (e) => toast.error(e.message),
  });

  // ── WebAuthn registration ceremony ──────────────────────────────────────────
  async function handleRegisterPasskey() {
    if (!window.PublicKeyCredential) {
      toast.error("This browser does not support passkeys / WebAuthn");
      return;
    }
    setRegistering(true);
    try {
      const opts = await registrationOptionsMut.mutateAsync({});

      const toUint8 = (b64url: string) =>
        Uint8Array.from(
          atob(b64url.replace(/-/g, "+").replace(/_/g, "/")),
          (c) => c.charCodeAt(0)
        );

      const credential = (await navigator.credentials.create({
        publicKey: {
          rp: opts.rp as PublicKeyCredentialRpEntity,
          user: {
            id: toUint8(opts.user.id as unknown as string),
            name: opts.user.name as string,
            displayName: opts.user.displayName as string,
          },
          challenge: toUint8(opts.challenge as unknown as string),
          pubKeyCredParams: opts.pubKeyCredParams as PublicKeyCredentialParameters[],
          timeout: opts.timeout as number | undefined,
          attestation: (opts.attestation ?? "none") as AttestationConveyancePreference,
          authenticatorSelection: opts.authenticatorSelection as AuthenticatorSelectionCriteria | undefined,
          excludeCredentials: (
            (opts.excludeCredentials ?? []) as Array<{
              type: string;
              id: string;
              transports?: string[];
            }>
          ).map((ec) => ({
            type: ec.type as PublicKeyCredentialType,
            id: toUint8(ec.id),
            transports: ec.transports as AuthenticatorTransport[] | undefined,
          })),
        },
      })) as PublicKeyCredential | null;

      if (!credential) throw new Error("Registration cancelled");

      const response = credential.response as AuthenticatorAttestationResponse;

      const toB64url = (buf: ArrayBuffer) =>
        btoa(String.fromCharCode(...new Uint8Array(buf)))
          .replace(/\+/g, "-")
          .replace(/\//g, "_")
          .replace(/=/g, "");

      const pubKey = response.getPublicKey
        ? toB64url(response.getPublicKey()!)
        : toB64url(response.attestationObject);

      setVerifying(true);
      await verifyRegistrationMut.mutateAsync({
        credentialId: toB64url(credential.rawId),
        clientDataJSON: toB64url(response.clientDataJSON),
        attestationObject: toB64url(response.attestationObject),
        publicKey: pubKey,
        deviceName: detectDeviceName(),
        uvCapable: true,
        residentKey: true,
        transports: response.getTransports
          ? (response.getTransports() as AuthenticatorTransport[])
          : (["internal"] as AuthenticatorTransport[]),
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Registration failed";
      if (!msg.includes("cancelled") && !msg.includes("NotAllowedError")) {
        toast.error(msg);
      }
      setRegistering(false);
    } finally {
      setVerifying(false);
    }
  }

  function detectDeviceName(): string {
    const ua = navigator.userAgent;
    if (/iPhone/.test(ua)) return "iPhone";
    if (/iPad/.test(ua)) return "iPad";
    if (/Android/.test(ua)) return "Android Device";
    if (/Mac/.test(ua)) return "Mac";
    if (/Windows/.test(ua)) return "Windows PC";
    if (/Linux/.test(ua)) return "Linux Device";
    return "Passkey";
  }

  const credentials = mfaStatus?.credentials ?? [];
  const settings = mfaStatus?.settings;

  return (
    <div className="space-y-6">
      {/* MFA Enforcement Banner */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Fingerprint className="h-5 w-5 text-primary" />
              <div>
                <CardTitle className="text-base">Multi-Factor Authentication</CardTitle>
                <CardDescription>Require a second factor on every login</CardDescription>
              </div>
            </div>
            <div className="flex items-center gap-3">
              {settings?.mfaRequired ? (
                <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30">
                  <CheckCircle2 className="h-3 w-3 mr-1" /> Enforced
                </Badge>
              ) : (
                <Badge variant="outline" className="text-muted-foreground">
                  <XCircle className="h-3 w-3 mr-1" /> Optional
                </Badge>
              )}
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  setMfaRequiredMut.mutate({ required: !settings?.mfaRequired })
                }
                disabled={setMfaRequiredMut.isPending}
              >
                {settings?.mfaRequired ? (
                  <>
                    <ToggleRight className="h-4 w-4 mr-1 text-emerald-400" /> Disable MFA
                  </>
                ) : (
                  <>
                    <ToggleLeft className="h-4 w-4 mr-1" /> Enable MFA
                  </>
                )}
              </Button>
            </div>
          </div>
        </CardHeader>
      </Card>

      {/* FIDO2 info callout */}
      <Alert className="border-blue-200 bg-blue-50 dark:bg-blue-950/20">
        <Shield className="h-4 w-4 text-blue-600" />
        <AlertDescription className="text-sm text-blue-800 dark:text-blue-200">
          <strong>FIDO2 / WebAuthn passkeys</strong> are phishing-resistant by design — the
          cryptographic challenge is bound to this exact origin, so fake login pages cannot
          intercept your credentials. They replace passwords entirely and meet PSD2 Strong
          Customer Authentication (SCA) requirements.
        </AlertDescription>
      </Alert>

      {/* Registered Passkeys */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Key className="h-5 w-5 text-primary" /> Registered Passkeys
              </CardTitle>
              <CardDescription>
                Use your device biometrics (Face ID, Touch ID, Windows Hello) or a hardware
                security key (YubiKey, Titan) to authenticate without a password.
              </CardDescription>
            </div>
            <Button
              onClick={handleRegisterPasskey}
              disabled={registering || verifying}
              className="shrink-0"
            >
              {registering || verifying ? (
                <>
                  <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                  {verifying ? "Verifying…" : "Waiting for device…"}
                </>
              ) : (
                <>
                  <Plus className="h-4 w-4 mr-2" /> Add Passkey
                </>
              )}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-center py-8 text-muted-foreground">Loading passkeys…</div>
          ) : credentials.length === 0 ? (
            <div className="text-center py-10 border border-dashed rounded-lg">
              <Fingerprint className="h-10 w-10 mx-auto mb-3 text-muted-foreground/50" />
              <p className="text-sm font-medium">No passkeys registered</p>
              <p className="text-xs text-muted-foreground mt-1">
                Add a passkey to enable passwordless, phishing-resistant login.
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Device</TableHead>
                  <TableHead>Capabilities</TableHead>
                  <TableHead>Last Used</TableHead>
                  <TableHead>Registered</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {credentials.map((cred) => (
                  <TableRow key={cred.id}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        {/iPhone|iPad|Android/.test(cred.deviceName) ? (
                          <Smartphone className="h-4 w-4 text-muted-foreground" />
                        ) : (
                          <Laptop className="h-4 w-4 text-muted-foreground" />
                        )}
                        {renameId === cred.id ? (
                          <div className="flex items-center gap-2">
                            <Input
                              value={renameName}
                              onChange={(e) => setRenameName(e.target.value)}
                              className="h-7 w-36 text-xs"
                              autoFocus
                              onKeyDown={(e) => {
                                if (e.key === "Enter")
                                  renameCredentialMut.mutate({
                                    credentialId: cred.id,
                                    name: renameName,
                                  });
                                if (e.key === "Escape") setRenameId(null);
                              }}
                            />
                            <Button
                              size="sm"
                              className="h-7 px-2 text-xs"
                              onClick={() =>
                                renameCredentialMut.mutate({
                                  credentialId: cred.id,
                                  name: renameName,
                                })
                              }
                              disabled={renameCredentialMut.isPending}
                            >
                              Save
                            </Button>
                          </div>
                        ) : (
                          <span className="text-sm font-medium">{cred.deviceName}</span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1 flex-wrap">
                        {cred.uvCapable && (
                          <Badge variant="outline" className="text-xs px-1.5 py-0">
                            UV
                          </Badge>
                        )}
                        {cred.residentKey && (
                          <Badge variant="outline" className="text-xs px-1.5 py-0">
                            Discoverable
                          </Badge>
                        )}
                        {cred.aaguid && (
                          <Badge
                            variant="outline"
                            className="text-xs px-1.5 py-0 font-mono"
                          >
                            {cred.aaguid.slice(0, 8)}
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {cred.lastUsedAt ? (
                        <span
                          title={new Date(cred.lastUsedAt).toLocaleString(undefined, {
                            weekday: "long",
                            year: "numeric",
                            month: "long",
                            day: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                          className="cursor-default"
                        >
                          {formatRelativeTime(new Date(cred.lastUsedAt))}
                          <span className="block text-[11px] text-muted-foreground/50">
                            {new Date(cred.lastUsedAt).toLocaleDateString(undefined, {
                              year: "numeric",
                              month: "short",
                              day: "numeric",
                            })}
                          </span>
                        </span>
                      ) : (
                        <span className="italic text-muted-foreground/50">Never used</span>
                      )}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      <span
                        title={new Date(cred.createdAt).toLocaleString(undefined, {
                          weekday: "long",
                          year: "numeric",
                          month: "long",
                          day: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                        className="flex items-center gap-1 cursor-default"
                      >
                        <CalendarDays className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60" />
                        {new Date(cred.createdAt).toLocaleDateString(undefined, {
                          year: "numeric",
                          month: "short",
                          day: "numeric",
                        })}
                      </span>
                      <span className="text-[11px] text-muted-foreground/50 pl-5">
                        {formatRelativeTime(new Date(cred.createdAt))}
                      </span>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7"
                          title="Rename passkey"
                          onClick={() => {
                            setRenameId(cred.id);
                            setRenameName(cred.deviceName);
                          }}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7 text-destructive hover:text-destructive"
                          title="Remove passkey"
                          onClick={() => {
                            if (confirm(`Remove passkey "${cred.deviceName}"?`))
                              removeCredentialMut.mutate({ credentialId: cred.id });
                          }}
                          disabled={removeCredentialMut.isPending}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Email OTP fallback */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Mail className="h-5 w-5 text-primary" /> Email One-Time Password (Fallback)
          </CardTitle>
          <CardDescription>
            Receive a 6-digit OTP via email as a fallback second factor when no passkey is
            available.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between">
            <div>
              {settings?.emailOtpEnabled ? (
                <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30">
                  <CheckCircle2 className="h-3 w-3 mr-1" /> Enabled
                </Badge>
              ) : (
                <Badge variant="outline" className="text-muted-foreground">
                  Not enabled
                </Badge>
              )}
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => sendEmailOtpMut.mutate()}
              disabled={sendEmailOtpMut.isPending}
            >
              {sendEmailOtpMut.isPending ? (
                <>
                  <RefreshCw className="h-4 w-4 mr-2 animate-spin" /> Sending…
                </>
              ) : (
                "Send Test OTP"
              )}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Webhook Config Tab ───────────────────────────────────────────────────────

function WebhookConfigTab() {
  const utils = trpc.useUtils();
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({
    name: "",
    url: "",
    secret: "",
    eventFilter: "HIGH_AND_CRITICAL" as "ALL" | "HIGH_AND_CRITICAL" | "CRITICAL_ONLY",
  });

  const { data: webhooks = [], isLoading } = trpc.webhook.adminList.useQuery({
    includeInactive: true,
  });

  const createWebhook = trpc.webhook.adminCreate.useMutation({
    onSuccess: () => {
      toast.success("Webhook created");
      utils.webhook.adminList.invalidate();
      setShowCreate(false);
      setForm({ name: "", url: "", secret: "", eventFilter: "HIGH_AND_CRITICAL" });
    },
    onError: (err) => toast.error("Failed to create webhook", { description: err.message }),
  });

  const updateWebhook = trpc.webhook.adminUpdate.useMutation({
    onSuccess: () => {
      toast.success("Webhook updated");
      utils.webhook.adminList.invalidate();
    },
    onError: (err) => toast.error("Failed to update webhook", { description: err.message }),
  });

  const deleteWebhook = trpc.webhook.adminDelete.useMutation({
    onSuccess: () => {
      toast.success("Webhook deleted");
      utils.webhook.adminList.invalidate();
    },
    onError: (err) => toast.error("Failed to delete webhook", { description: err.message }),
  });

  const testWebhook = trpc.webhook.adminTest.useMutation({
    onSuccess: (data) => {
      if (data.success) {
        toast.success("Test delivered", { description: `HTTP ${data.statusCode}` });
      } else {
        toast.error("Test failed", {
          description: data.errorMessage ?? `HTTP ${data.statusCode}`,
        });
      }
    },
    onError: (err) => toast.error("Test failed", { description: err.message }),
  });

  const filterLabels: Record<string, string> = {
    ALL: "All Events",
    HIGH_AND_CRITICAL: "High & Critical",
    CRITICAL_ONLY: "Critical Only",
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">Outbound Webhooks</h3>
          <p className="text-sm text-muted-foreground">
            Receive real-time security alerts via HTTP POST to external systems (SIEM, Slack,
            PagerDuty).
          </p>
        </div>
        <Button onClick={() => setShowCreate(true)}>
          <Plus className="h-4 w-4 mr-2" /> Add Webhook
        </Button>
      </div>

      <Alert className="border-amber-200 bg-amber-50 dark:bg-amber-950/20">
        <AlertTriangle className="h-4 w-4 text-amber-600" />
        <AlertDescription className="text-sm text-amber-800 dark:text-amber-200">
          Payloads are signed with HMAC-SHA256 when a secret is configured. Verify the
          <code className="mx-1 font-mono text-xs bg-amber-100 dark:bg-amber-900 px-1 rounded">
            X-NEXCOM-Signature
          </code>
          header on your endpoint to prevent spoofing.
        </AlertDescription>
      </Alert>

      {isLoading ? (
        <div className="text-sm text-muted-foreground py-4">Loading webhooks…</div>
      ) : webhooks.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <Webhook className="h-8 w-8 mx-auto mb-2 opacity-40" />
          <p className="text-sm">No webhooks configured yet.</p>
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>URL</TableHead>
              <TableHead>Filter</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Last Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {webhooks.map((wh) => (
              <TableRow key={wh.id}>
                <TableCell className="font-medium">{wh.name}</TableCell>
                <TableCell className="max-w-[200px] truncate text-xs text-muted-foreground font-mono">
                  {wh.url}
                </TableCell>
                <TableCell>
                  <Badge variant="outline">
                    {filterLabels[wh.eventFilter] ?? wh.eventFilter}
                  </Badge>
                </TableCell>
                <TableCell>
                  <Badge variant={wh.isActive ? "default" : "secondary"}>
                    {wh.isActive ? "Active" : "Inactive"}
                  </Badge>
                </TableCell>
                <TableCell>
                  {wh.lastStatusCode ? (
                    <Badge
                      variant={
                        wh.lastStatusCode >= 200 && wh.lastStatusCode < 300
                          ? "default"
                          : "destructive"
                      }
                    >
                      HTTP {wh.lastStatusCode}
                    </Badge>
                  ) : (
                    <span className="text-xs text-muted-foreground">Never triggered</span>
                  )}
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex items-center justify-end gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => testWebhook.mutate({ id: Number(wh.id) })}
                      disabled={testWebhook.isPending || !wh.isActive}
                      title="Send test payload"
                    >
                      <Play className="h-3 w-3" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        updateWebhook.mutate({ id: Number(wh.id), isActive: !wh.isActive })
                      }
                      title={wh.isActive ? "Deactivate" : "Activate"}
                    >
                      {wh.isActive ? (
                        <ToggleRight className="h-4 w-4 text-green-500" />
                      ) : (
                        <ToggleLeft className="h-4 w-4" />
                      )}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-destructive hover:text-destructive"
                      onClick={() => {
                        if (confirm(`Delete webhook "${wh.name}"?`)) {
                          deleteWebhook.mutate({ id: Number(wh.id) });
                        }
                      }}
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {/* Create Dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Add Webhook Endpoint</DialogTitle>
            <DialogDescription>
              Configure an outbound webhook to receive HIGH and CRITICAL security alerts.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Name</Label>
              <Input
                placeholder="e.g. Slack Security Channel"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label>Endpoint URL</Label>
              <Input
                placeholder="https://hooks.example.com/..."
                value={form.url}
                onChange={(e) => setForm((f) => ({ ...f, url: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label>Signing Secret (optional)</Label>
              <Input
                type="password"
                placeholder="Used for HMAC-SHA256 signature"
                value={form.secret}
                onChange={(e) => setForm((f) => ({ ...f, secret: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label>Event Filter</Label>
              <Select
                value={form.eventFilter}
                onValueChange={(v) =>
                  setForm((f) => ({ ...f, eventFilter: v as typeof form.eventFilter }))
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All Events</SelectItem>
                  <SelectItem value="HIGH_AND_CRITICAL">High &amp; Critical Only</SelectItem>
                  <SelectItem value="CRITICAL_ONLY">Critical Only</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => createWebhook.mutate(form)}
              disabled={!form.name || !form.url || createWebhook.isPending}
            >
              {createWebhook.isPending ? "Creating…" : "Create Webhook"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── IP Allowlist Tab ─────────────────────────────────────────────────────────

function IpAllowlistTab() {
  const utils = trpc.useUtils();
  const [showCreate, setShowCreate] = useState(false);
  const [scopeFilter, setScopeFilter] = useState<
    "ALL" | "GLOBAL_ADMIN" | "BULK_OPERATIONS" | "LIQUIDATION_OVERRIDE" | "WITHDRAWAL_APPROVAL"
  >("ALL");
  const [form, setForm] = useState({
    cidr: "",
    label: "",
    scope: "GLOBAL_ADMIN" as
      | "GLOBAL_ADMIN"
      | "BULK_OPERATIONS"
      | "LIQUIDATION_OVERRIDE"
      | "WITHDRAWAL_APPROVAL",
  });

  const { data: entries = [], isLoading } = trpc.ipAllowlist.adminList.useQuery({
    scope: scopeFilter,
    includeInactive: true,
  });

  const createEntry = trpc.ipAllowlist.adminCreate.useMutation({
    onSuccess: () => {
      toast.success("IP allowlist entry added");
      utils.ipAllowlist.adminList.invalidate();
      setShowCreate(false);
      setForm({ cidr: "", label: "", scope: "GLOBAL_ADMIN" });
    },
    onError: (err) => toast.error("Failed to add entry", { description: err.message }),
  });

  const toggleEntry = trpc.ipAllowlist.adminToggle.useMutation({
    onSuccess: () => {
      toast.success("Entry updated");
      utils.ipAllowlist.adminList.invalidate();
    },
    onError: (err) => toast.error("Failed to update entry", { description: err.message }),
  });

  const deleteEntry = trpc.ipAllowlist.adminDelete.useMutation({
    onSuccess: () => {
      toast.success("Entry deleted");
      utils.ipAllowlist.adminList.invalidate();
    },
    onError: (err) => toast.error("Failed to delete entry", { description: err.message }),
  });

  const scopeLabels: Record<string, string> = {
    GLOBAL_ADMIN: "Global Admin",
    BULK_OPERATIONS: "Bulk Operations",
    LIQUIDATION_OVERRIDE: "Liquidation Override",
    WITHDRAWAL_APPROVAL: "Withdrawal Approval",
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">IP Allowlist</h3>
          <p className="text-sm text-muted-foreground">
            Restrict sensitive admin operations to trusted IP ranges. Blocked attempts are
            logged as security events.
          </p>
        </div>
        <Button onClick={() => setShowCreate(true)}>
          <Plus className="h-4 w-4 mr-2" /> Add Entry
        </Button>
      </div>

      <Alert className="border-blue-200 bg-blue-50 dark:bg-blue-950/20">
        <Shield className="h-4 w-4 text-blue-600" />
        <AlertDescription className="text-sm text-blue-800 dark:text-blue-200">
          If no entries are configured for a scope, that scope is unrestricted. Add at least
          one entry to begin enforcing IP restrictions for that operation type.
        </AlertDescription>
      </Alert>

      <div className="flex items-center gap-2">
        <Label className="text-sm">Filter by scope:</Label>
        <Select
          value={scopeFilter}
          onValueChange={(v) => setScopeFilter(v as typeof scopeFilter)}
        >
          <SelectTrigger className="w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All Scopes</SelectItem>
            <SelectItem value="GLOBAL_ADMIN">Global Admin</SelectItem>
            <SelectItem value="BULK_OPERATIONS">Bulk Operations</SelectItem>
            <SelectItem value="LIQUIDATION_OVERRIDE">Liquidation Override</SelectItem>
            <SelectItem value="WITHDRAWAL_APPROVAL">Withdrawal Approval</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="text-sm text-muted-foreground py-4">Loading entries…</div>
      ) : entries.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <Shield className="h-8 w-8 mx-auto mb-2 opacity-40" />
          <p className="text-sm">No IP allowlist entries configured.</p>
          <p className="text-xs mt-1">All scopes are currently unrestricted.</p>
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>CIDR</TableHead>
              <TableHead>Label</TableHead>
              <TableHead>Scope</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Added</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {entries.map((entry) => (
              <TableRow key={entry.id}>
                <TableCell className="font-mono text-sm">{entry.cidr}</TableCell>
                <TableCell>{entry.label}</TableCell>
                <TableCell>
                  <Badge variant="outline">
                    {scopeLabels[entry.scope] ?? entry.scope}
                  </Badge>
                </TableCell>
                <TableCell>
                  <Badge variant={entry.isActive ? "default" : "secondary"}>
                    {entry.isActive ? "Active" : "Inactive"}
                  </Badge>
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {new Date(entry.createdAt).toLocaleDateString()}
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex items-center justify-end gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        toggleEntry.mutate({
                          id: Number(entry.id),
                          isActive: !entry.isActive,
                        })
                      }
                      title={entry.isActive ? "Deactivate" : "Activate"}
                    >
                      {entry.isActive ? (
                        <ToggleRight className="h-4 w-4 text-green-500" />
                      ) : (
                        <ToggleLeft className="h-4 w-4" />
                      )}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-destructive hover:text-destructive"
                      onClick={() => {
                        if (confirm(`Remove ${entry.cidr} from allowlist?`)) {
                          deleteEntry.mutate({ id: Number(entry.id) });
                        }
                      }}
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {/* Create Dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Add IP Allowlist Entry</DialogTitle>
            <DialogDescription>
              Add a trusted IP address or CIDR range for a specific admin operation scope.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>CIDR Range</Label>
              <Input
                placeholder="e.g. 192.168.1.0/24 or 10.0.0.1/32"
                value={form.cidr}
                onChange={(e) => setForm((f) => ({ ...f, cidr: e.target.value }))}
                className="font-mono"
              />
              <p className="text-xs text-muted-foreground">
                Use /32 for a single IP address.
              </p>
            </div>
            <div className="space-y-2">
              <Label>Label</Label>
              <Input
                placeholder="e.g. Office Network, VPN Gateway"
                value={form.label}
                onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label>Scope</Label>
              <Select
                value={form.scope}
                onValueChange={(v) =>
                  setForm((f) => ({ ...f, scope: v as typeof form.scope }))
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="GLOBAL_ADMIN">Global Admin</SelectItem>
                  <SelectItem value="BULK_OPERATIONS">Bulk Operations</SelectItem>
                  <SelectItem value="LIQUIDATION_OVERRIDE">Liquidation Override</SelectItem>
                  <SelectItem value="WITHDRAWAL_APPROVAL">Withdrawal Approval</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => createEntry.mutate(form)}
              disabled={!form.cidr || !form.label || createEntry.isPending}
            >
              {createEntry.isPending ? "Adding…" : "Add Entry"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Withdrawal Threshold Tab ─────────────────────────────────────────────────

function WithdrawalThresholdTab() {
  const utils = trpc.useUtils();
  const { data: thresholdData } = trpc.withdrawalVerification.adminGetThreshold.useQuery();
  const [newThreshold, setNewThreshold] = useState("");

  const setThreshold = trpc.withdrawalVerification.adminSetThreshold.useMutation({
    onSuccess: (data) => {
      toast.success("Threshold updated", {
        description: `Withdrawals above ₦${data.threshold.toLocaleString()} will now require identity verification.`,
      });
      utils.withdrawalVerification.adminGetThreshold.invalidate();
      setNewThreshold("");
    },
    onError: (err) =>
      toast.error("Failed to update threshold", { description: err.message }),
  });

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-lg font-semibold">Withdrawal Verification Threshold</h3>
        <p className="text-sm text-muted-foreground">
          Users must complete a typed identity challenge before withdrawals above this amount
          are processed. This defends against deepfake and social-engineering attacks.
        </p>
      </div>

      <Alert className="border-amber-200 bg-amber-50 dark:bg-amber-950/20">
        <AlertTriangle className="h-4 w-4 text-amber-600" />
        <AlertDescription className="text-sm text-amber-800 dark:text-amber-200">
          <strong>Why this matters:</strong> Deepfake attacks (like those reported by the BBC
          against Arup and Bombay Stock Exchange) use AI-generated video/audio to impersonate
          executives and authorise large wire transfers. A typed challenge that requires the
          user to know their own name and today's date cannot be defeated by a deepfake video
          call.
        </AlertDescription>
      </Alert>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Current Threshold</CardTitle>
          <CardDescription>
            Withdrawals at or above this amount trigger a verification challenge.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="text-3xl font-bold text-primary">
            ₦{(thresholdData?.threshold ?? 500_000).toLocaleString()}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Update Threshold</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-end gap-3">
            <div className="flex-1 space-y-2">
              <Label>New Threshold (NGN)</Label>
              <Input
                type="number"
                placeholder="e.g. 1000000"
                value={newThreshold}
                onChange={(e) => setNewThreshold(e.target.value)}
                min={1000}
              />
            </div>
            <Button
              onClick={() =>
                setThreshold.mutate({ threshold: parseFloat(newThreshold) })
              }
              disabled={
                !newThreshold || isNaN(parseFloat(newThreshold)) || setThreshold.isPending
              }
            >
              {setThreshold.isPending ? "Saving…" : "Update"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function SecuritySettings() {
  const { user, loading } = useAuth();

  if (loading) return <PageSkeleton cards={4} tableRows={6} tableCols={3} />;
  if (!user || user.role !== "admin") {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center h-64">
          <p className="text-muted-foreground">Admin access required.</p>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <Settings className="h-6 w-6 text-primary" />
          <div>
            <h1 className="text-2xl font-bold">Security Settings</h1>
            <p className="text-sm text-muted-foreground">
              Authenticator app (TOTP), passkeys, MFA, webhooks, IP allowlists, and withdrawal verification.
            </p>
          </div>
        </div>

        <Tabs defaultValue="passkeys">
          <TabsList className="grid w-full grid-cols-5">
            <TabsTrigger value="totp">
              <QrCode className="h-4 w-4 mr-2" /> Authenticator
            </TabsTrigger>
            <TabsTrigger value="passkeys">
              <Fingerprint className="h-4 w-4 mr-2" /> Passkeys &amp; MFA
            </TabsTrigger>
            <TabsTrigger value="webhooks">
              <Webhook className="h-4 w-4 mr-2" /> Webhooks
            </TabsTrigger>
            <TabsTrigger value="ip-allowlist">
              <Shield className="h-4 w-4 mr-2" /> IP Allowlist
            </TabsTrigger>
            <TabsTrigger value="withdrawal">
              <AlertTriangle className="h-4 w-4 mr-2" /> Withdrawal Verification
            </TabsTrigger>
          </TabsList>

          <TabsContent value="totp" className="mt-6">
            <TotpTab />
          </TabsContent>
          <TabsContent value="passkeys" className="mt-6">
            <PasskeysTab />
          </TabsContent>

          <TabsContent value="webhooks" className="mt-6">
            <WebhookConfigTab />
          </TabsContent>

          <TabsContent value="ip-allowlist" className="mt-6">
            <IpAllowlistTab />
          </TabsContent>

          <TabsContent value="withdrawal" className="mt-6">
            <WithdrawalThresholdTab />
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
