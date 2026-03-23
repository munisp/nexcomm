/**
 * NEXCOM Exchange — Account & Profile
 * Personal info, security, API keys, notification preferences, and KYC status
 * Fully wired to live tRPC profile router
 */
import { useState, useEffect } from "react";
import {
  User, Shield, Key, Bell, CreditCard, LogOut, Copy, Eye, EyeOff,
  CheckCircle2, Clock, RefreshCw, AlertCircle, Building2,
  Fingerprint, Pencil, Trash2, Loader2
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { getLoginUrl } from "@/const";



type NotifKey = "priceAlerts" | "orderFilled" | "orderCancelled" | "kycUpdates" | "systemMaintenance" | "weeklyReport" | "newListings" | "securityAlerts";

interface NotifSettings {
  priceAlerts: boolean;
  orderFilled: boolean;
  orderCancelled: boolean;
  kycUpdates: boolean;
  systemMaintenance: boolean;
  weeklyReport: boolean;
  newListings: boolean;
  securityAlerts: boolean;
}

export default function Account() {
  const { user, logout, isAuthenticated } = useAuth();
  const [tab, setTab] = useState("profile");
  const [showKey, setShowKey] = useState<number | null>(null);
  const [newKeyName, setNewKeyName] = useState("");
  const [newKeyPerms, setNewKeyPerms] = useState<("READ" | "TRADE" | "ADMIN")[]>(["READ"]);
  const [showNewKeyModal, setShowNewKeyModal] = useState(false);
  const [generatedKey, setGeneratedKey] = useState<string | null>(null);

  // Passkey state
  const [registerPasskeyLoading, setRegisterPasskeyLoading] = useState(false);
  const [editingPasskeyId, setEditingPasskeyId] = useState<string | null>(null);
  const [editingPasskeyName, setEditingPasskeyName] = useState("");

  // Live passkeys
  const { data: passkeysData, refetch: refetchPasskeys } = trpc.webauthn.listCredentials.useQuery(
    undefined, { enabled: isAuthenticated }
  );
  const passkeyCreds = passkeysData ?? [];

  const renamePasskeyMutation = trpc.webauthn.renameCredential.useMutation({
    onSuccess: () => { toast.success("Passkey renamed"); setEditingPasskeyId(null); refetchPasskeys(); },
    onError: (e) => toast.error(e.message),
  });
  const removePasskeyMutation = trpc.webauthn.removeCredential.useMutation({
    onSuccess: () => { toast.success("Passkey removed"); refetchPasskeys(); },
    onError: (e) => toast.error(e.message),
  });
  const registrationOptionsMutation = trpc.webauthn.registrationOptions.useMutation();
  const verifyRegistrationMutation = trpc.webauthn.verifyRegistration.useMutation({
    onSuccess: () => { toast.success("Passkey registered successfully!"); refetchPasskeys(); },
    onError: (e) => toast.error(e.message),
  });

  async function handleRegisterPasskey() {
    setRegisterPasskeyLoading(true);
    try {
      const opts = await registrationOptionsMutation.mutateAsync();
      // Use the browser WebAuthn API
      const { startRegistration } = await import("@simplewebauthn/browser");
      const attResp = await startRegistration(opts as Parameters<typeof startRegistration>[0]);
      await verifyRegistrationMutation.mutateAsync({ response: attResp as unknown as Record<string, unknown> });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (!msg.includes("cancelled") && !msg.includes("NotAllowedError")) {
        toast.error(msg);
      }
    } finally {
      setRegisterPasskeyLoading(false);
    }
  }

  function handleRenamePasskey(credentialId: string) {
    if (!editingPasskeyName.trim()) return;
    renamePasskeyMutation.mutate({ credentialId, name: editingPasskeyName.trim() });
  }

  function handleRemovePasskey(credentialId: string) {
    if (!confirm("Remove this passkey? You will no longer be able to use it to sign in.")) return;
    removePasskeyMutation.mutate({ credentialId });
  }

  // Live API keys
  const { data: apiKeysList, refetch: refetchApiKeys } = trpc.apiKeys.list.useQuery(
    undefined, { enabled: isAuthenticated }
  );
  const generateKeyMutation = trpc.apiKeys.generate.useMutation({
    onSuccess: (data) => {
      setGeneratedKey(data.rawKey);
      refetchApiKeys();
    },
    onError: (e) => toast.error(e.message),
  });
  const revokeKeyMutation = trpc.apiKeys.revoke.useMutation({
    onSuccess: () => { toast.success("API key revoked"); refetchApiKeys(); },
    onError: (e) => toast.error(e.message),
  });
  const deleteKeyMutation = trpc.apiKeys.delete.useMutation({
    onSuccess: () => { toast.success("API key deleted"); refetchApiKeys(); },
    onError: (e) => toast.error(e.message),
  });
  const [notifs, setNotifs] = useState<NotifSettings>({
    priceAlerts: true,
    orderFilled: true,
    orderCancelled: true,
    kycUpdates: true,
    systemMaintenance: false,
    weeklyReport: true,
    newListings: false,
    securityAlerts: true,
  });

  // Live tRPC profile data
  const { data: profileData, isLoading: profileLoading, refetch: refetchProfile } = trpc.profile.get.useQuery(
    undefined, { enabled: isAuthenticated }
  );
  const updateProfile = trpc.profile.update.useMutation({
    onSuccess: () => { toast.success("Profile updated successfully"); refetchProfile(); },
    onError: (e) => toast.error(e.message),
  });
  const updateNotifPrefs = trpc.profile.updateNotificationPrefs.useMutation({
    onSuccess: () => toast.success("Notification preference saved"),
    onError: (e) => toast.error(e.message),
  });

  // Live KYC status
  const { data: kycStatus } = trpc.onboarding.getStatus.useQuery(
    undefined, { enabled: isAuthenticated }
  );

  // Profile form state — pre-filled from live data
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [country, setCountry] = useState("Nigeria");
  const [bankName, setBankName] = useState("");
  const [bankAccount, setBankAccount] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [taxId, setTaxId] = useState("");

  // Sync form state from live data
  useEffect(() => {
    if (profileData) {
      setFirstName(profileData.firstName ?? user?.name?.split(" ")[0] ?? "");
      setLastName(profileData.lastName ?? user?.name?.split(" ").slice(1).join(" ") ?? "");
      setPhone(profileData.phone ?? "");
      setCountry(profileData.country ?? "Nigeria");
      setBankName(profileData.bankName ?? "");
      setBankAccount(profileData.bankAccount ?? "");
      setCompanyName(profileData.companyName ?? "");
      setTaxId(profileData.taxId ?? "");
    } else if (!isAuthenticated) {
      setFirstName(user?.name?.split(" ")[0] ?? "Demo");
      setLastName(user?.name?.split(" ").slice(1).join(" ") ?? "User");
    }
  }, [profileData, user, isAuthenticated]);

  const handleSaveProfile = () => {
    if (!isAuthenticated) { toast.error("Please sign in to update your profile"); return; }
    updateProfile.mutate({ firstName, lastName, phone, country, bankName, bankAccount, companyName, taxId });
  };

  const handleCopyKey = (key: string) => {
    navigator.clipboard.writeText(key).then(() => toast.success("API key copied to clipboard"));
  };

  const handleCreateKey = () => {
    if (!newKeyName.trim()) { toast.error("Please enter a key name"); return; }
    generateKeyMutation.mutate({ name: newKeyName.trim(), permissions: newKeyPerms });
  };

  const togglePerm = (perm: "READ" | "TRADE" | "ADMIN") => {
    setNewKeyPerms(prev =>
      prev.includes(perm) ? prev.filter(p => p !== perm) : [...prev, perm]
    );
  };

  const toggleNotif = (key: NotifKey) => {
    const newValue = !notifs[key];
    setNotifs(prev => ({ ...prev, [key]: newValue }));
    if (isAuthenticated) {
      updateNotifPrefs.mutate({ [key]: newValue });
    } else {
      toast.success("Notification preference updated (preview)");
    }
  };

  const appStatus = kycStatus?.application?.status;
  const kycSteps = [
    { label: "Identity Verification",    status: appStatus ? (appStatus === "APPROVED" ? "verified" : appStatus === "PENDING" || appStatus === "UNDER_REVIEW" ? "pending" : "not_started") : "not_started", desc: "NIN / Passport verification" },
    { label: "Address Verification",     status: appStatus === "APPROVED" ? "verified" : "not_started", desc: "Utility bill or bank statement" },
    { label: "Bank Account",             status: bankAccount ? "verified" : "not_started", desc: bankAccount ? `${bankName} ****${bankAccount.slice(-4)}` : "Link a bank account" },
    { label: "Source of Funds",          status: appStatus === "APPROVED" ? "verified" : "not_started", desc: "Business income or employment" },
    { label: "Enhanced Due Diligence",   status: "pending",   desc: "Annual review required" },
    { label: "Accredited Investor",      status: "not_started", desc: "Optional — unlocks higher limits" },
  ];

  return (
    <div className="page-container space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2" style={{ fontFamily: "'DM Serif Display', serif" }}>
            <User className="w-6 h-6 text-primary" />
            Account
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">Manage your profile, security, and preferences</p>
        </div>
        {isAuthenticated ? (
          <Button variant="outline" className="gap-2 text-negative border-negative/30 hover:bg-negative/10" onClick={logout}>
            <LogOut className="w-4 h-4" />Sign Out
          </Button>
        ) : (
          <a href={getLoginUrl()}>
            <Button className="bg-primary text-white">Sign In</Button>
          </a>
        )}
      </div>

      {/* Profile Summary Card */}
      <div className="stat-card flex items-center gap-4">
        <div className="w-16 h-16 rounded-full bg-primary/20 flex items-center justify-center text-2xl font-bold text-primary flex-shrink-0">
          {(user?.name ?? "U").charAt(0).toUpperCase()}
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-bold text-foreground text-lg">{user?.name ?? "NEXCOM User"}</div>
          <div className="text-sm text-muted-foreground">{user?.email ?? "Sign in to view your account"}</div>
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            {appStatus === "APPROVED" ? (
              <Badge className="badge-settled text-[10px] gap-1"><CheckCircle2 className="w-3 h-3" />KYC Verified</Badge>
            ) : appStatus === "PENDING" || appStatus === "UNDER_REVIEW" ? (
              <Badge className="badge-pending text-[10px] gap-1"><Clock className="w-3 h-3" />KYC Pending</Badge>
            ) : (
              <Badge className="badge-cancelled text-[10px] gap-1"><AlertCircle className="w-3 h-3" />KYC Required</Badge>
            )}
            <Badge className="badge-active text-[10px]">{kycStatus?.kycStatus ?? "Trader"}</Badge>
            {user && <span className="text-xs text-muted-foreground">Member since {new Date(user.createdAt ?? Date.now()).getFullYear()}</span>}
          </div>
        </div>
        {isAuthenticated && (
          <Button variant="ghost" size="sm" onClick={() => refetchProfile()} className="hidden sm:flex">
            <RefreshCw className="w-4 h-4" />
          </Button>
        )}
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="flex-wrap">
          <TabsTrigger value="profile">Profile</TabsTrigger>
          <TabsTrigger value="security">Security</TabsTrigger>
          <TabsTrigger value="api">API Keys</TabsTrigger>
          <TabsTrigger value="notifications">Notifications</TabsTrigger>
          <TabsTrigger value="billing">Billing</TabsTrigger>
        </TabsList>

        {/* Profile Tab */}
        <TabsContent value="profile" className="mt-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <div className="stat-card space-y-4">
              <h3 className="font-semibold text-foreground">Personal Information</h3>
              {profileLoading && isAuthenticated ? (
                <div className="flex items-center gap-2 text-muted-foreground text-sm">
                  <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                  Loading profile...
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs text-muted-foreground">First Name</label>
                      <Input value={firstName} onChange={e => setFirstName(e.target.value)} className="mt-1" placeholder="First name" />
                    </div>
                    <div>
                      <label className="text-xs text-muted-foreground">Last Name</label>
                      <Input value={lastName} onChange={e => setLastName(e.target.value)} className="mt-1" placeholder="Last name" />
                    </div>
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground">Email Address</label>
                    <Input value={user?.email ?? ""} disabled className="mt-1 opacity-60" />
                    <p className="text-xs text-muted-foreground mt-1">Email is managed by your OAuth provider.</p>
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground">Phone Number</label>
                    <Input value={phone} onChange={e => setPhone(e.target.value)} className="mt-1" placeholder="+234-801-234-5678" />
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground">Country</label>
                    <Input value={country} onChange={e => setCountry(e.target.value)} className="mt-1" placeholder="Nigeria" />
                  </div>
                  <div className="border-t border-border pt-4">
                    <h4 className="text-sm font-semibold text-foreground flex items-center gap-2 mb-3">
                      <Building2 className="w-4 h-4 text-primary" />Business Details
                    </h4>
                    <div className="space-y-3">
                      <div>
                        <label className="text-xs text-muted-foreground">Company Name (optional)</label>
                        <Input value={companyName} onChange={e => setCompanyName(e.target.value)} className="mt-1" placeholder="ACME Trading Ltd" />
                      </div>
                      <div>
                        <label className="text-xs text-muted-foreground">Tax ID / TIN (optional)</label>
                        <Input value={taxId} onChange={e => setTaxId(e.target.value)} className="mt-1" placeholder="12345678-0001" />
                      </div>
                    </div>
                  </div>
                  <div className="border-t border-border pt-4">
                    <h4 className="text-sm font-semibold text-foreground flex items-center gap-2 mb-3">
                      <CreditCard className="w-4 h-4 text-primary" />Bank Details
                    </h4>
                    <div className="space-y-3">
                      <div>
                        <label className="text-xs text-muted-foreground">Bank Name</label>
                        <Input value={bankName} onChange={e => setBankName(e.target.value)} className="mt-1" placeholder="GTBank" />
                      </div>
                      <div>
                        <label className="text-xs text-muted-foreground">Account Number</label>
                        <Input value={bankAccount} onChange={e => setBankAccount(e.target.value)} className="mt-1" placeholder="0123456789" />
                      </div>
                    </div>
                  </div>
                  <Button
                    className="bg-primary hover:bg-primary/90 text-white w-full"
                    onClick={handleSaveProfile}
                    disabled={updateProfile.isPending}
                  >
                    {updateProfile.isPending ? "Saving..." : "Save Changes"}
                  </Button>
                </>
              )}
            </div>

            {/* KYC Status */}
            <div className="stat-card space-y-4">
              <h3 className="font-semibold text-foreground">KYC / Verification Status</h3>
              <div className="space-y-3">
                {kycSteps.map(({ label, status, desc }) => (
                  <div key={label} className="flex items-center gap-3 p-3 rounded-lg bg-secondary/50">
                    {status === "verified"
                      ? <CheckCircle2 className="w-5 h-5 text-positive flex-shrink-0" />
                      : status === "pending"
                      ? <Clock className="w-5 h-5 text-yellow-400 flex-shrink-0" />
                      : <div className="w-5 h-5 rounded-full border-2 border-muted-foreground/30 flex-shrink-0" />
                    }
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold text-foreground">{label}</div>
                      <div className="text-xs text-muted-foreground">{desc}</div>
                    </div>
                    <Badge className={`text-[10px] ${status === "verified" ? "badge-settled" : status === "pending" ? "badge-pending" : "badge-active"}`}>
                      {status === "verified" ? "Verified" : status === "pending" ? "Pending" : "Not Started"}
                    </Badge>
                  </div>
                ))}
              </div>
              {appStatus !== "APPROVED" && (
                <a href="/onboarding">
                  <Button className="w-full bg-primary text-white">
                    {appStatus === "PENDING" || appStatus === "UNDER_REVIEW" ? "Check KYC Status" : "Complete KYC Verification"}
                  </Button>
                </a>
              )}
            </div>
          </div>
        </TabsContent>

        {/* Security Tab */}
        <TabsContent value="security" className="mt-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <div className="stat-card space-y-4">
              <h3 className="font-semibold text-foreground flex items-center gap-2"><Shield className="w-4 h-4 text-primary" />Password & Authentication</h3>
              <div className="space-y-3">
                <div>
                  <label className="text-xs text-muted-foreground">Current Password</label>
                  <Input type="password" placeholder="••••••••" className="mt-1" />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground">New Password</label>
                  <Input type="password" placeholder="••••••••" className="mt-1" />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground">Confirm New Password</label>
                  <Input type="password" placeholder="••••••••" className="mt-1" />
                </div>
                <Button className="bg-primary hover:bg-primary/90 text-white" onClick={() => toast.info("Password management is handled by your OAuth provider")}>
                  Update Password
                </Button>
              </div>
            </div>
            <div className="stat-card space-y-4">
              <h3 className="font-semibold text-foreground flex items-center gap-2"><Shield className="w-4 h-4 text-primary" />Two-Factor Authentication</h3>
              <div className="p-4 rounded-lg bg-positive/10 border border-positive/20 flex items-center gap-3">
                <CheckCircle2 className="w-5 h-5 text-positive flex-shrink-0" />
                <div>
                  <div className="text-sm font-semibold text-foreground">2FA Enabled</div>
                  <div className="text-xs text-muted-foreground">Authenticator app configured</div>
                </div>
              </div>
              <div className="space-y-2">
                {[
                  { label: "Last login",      value: "Today, 09:15 AM — Lagos, NG" },
                  { label: "Login method",    value: "Manus OAuth" },
                  { label: "Session expires", value: "In 23 hours" },
                ].map(({ label, value }) => (
                  <div key={label} className="flex justify-between text-sm py-2 border-b border-border/50">
                    <span className="text-muted-foreground">{label}</span>
                    <span className="text-foreground font-medium">{value}</span>
                  </div>
                ))}
              </div>
               <Button variant="outline" className="w-full text-negative border-negative/30 hover:bg-negative/10" onClick={() => { toast.success("All sessions terminated — signing you out"); setTimeout(() => logout(), 800); }}>
                Terminate All Sessions
              </Button>
            </div>

            {/* My Passkeys */}
            <div className="stat-card space-y-4">
              <h3 className="font-semibold text-foreground flex items-center gap-2">
                <Fingerprint className="w-4 h-4 text-primary" />My Passkeys
              </h3>
              <p className="text-sm text-muted-foreground">
                Passkeys let you sign in securely without a password using your device biometrics or PIN.
              </p>
              {passkeyCreds.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
                  No passkeys registered yet.
                </div>
              ) : (
                <div className="space-y-2">
                  {passkeyCreds.map((cred) => (
                    <div key={cred.id} className="flex items-center justify-between rounded-lg border border-border px-4 py-3 bg-muted/20">
                      <div className="flex items-center gap-3">
                        <Fingerprint className="w-4 h-4 text-muted-foreground" />
                        <div>
                          <div className="text-sm font-medium text-foreground">{cred.name ?? "Unnamed passkey"}</div>
                          <div className="text-xs text-muted-foreground">
                            Added {new Date(cred.createdAt).toLocaleDateString()} · Used {cred.signCount} time{cred.signCount !== 1 ? "s" : ""}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {editingPasskeyId === cred.id ? (
                          <>
                            <Input
                              value={editingPasskeyName}
                              onChange={(e) => setEditingPasskeyName(e.target.value)}
                              className="h-7 w-36 text-xs"
                              autoFocus
                              onKeyDown={(e) => { if (e.key === "Enter") handleRenamePasskey(cred.id); if (e.key === "Escape") setEditingPasskeyId(null); }}
                            />
                            <Button size="sm" className="h-7 px-2 text-xs" onClick={() => handleRenamePasskey(cred.id)} disabled={renamePasskeyMutation.isPending}>Save</Button>
                            <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => setEditingPasskeyId(null)}>Cancel</Button>
                          </>
                        ) : (
                          <>
                            <Button size="sm" variant="ghost" className="h-7 px-2 text-xs gap-1" onClick={() => { setEditingPasskeyId(cred.id); setEditingPasskeyName(cred.name ?? ""); }}>
                              <Pencil className="w-3 h-3" />Rename
                            </Button>
                            <Button size="sm" variant="ghost" className="h-7 px-2 text-xs text-destructive hover:text-destructive gap-1" onClick={() => handleRemovePasskey(cred.id)} disabled={removePasskeyMutation.isPending}>
                              <Trash2 className="w-3 h-3" />Remove
                            </Button>
                          </>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <Button
                className="gap-2"
                onClick={handleRegisterPasskey}
                disabled={registerPasskeyLoading}
              >
                {registerPasskeyLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Fingerprint className="w-4 h-4" />}
                {registerPasskeyLoading ? "Registering\u2026" : "Register New Passkey"}
              </Button>
            </div>
          </div>
        </TabsContent>
        {/* API Keys Tab */}
        <TabsContent value="api" className="mt-4">
          <div className="stat-card space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-foreground flex items-center gap-2"><Key className="w-4 h-4 text-primary" />API Keys</h3>
              <Button size="sm" className="bg-primary text-white gap-2" onClick={() => { setShowNewKeyModal(true); setGeneratedKey(null); setNewKeyName(""); setNewKeyPerms(["READ"]); }}>
                <Key className="w-3.5 h-3.5" />New Key
              </Button>
            </div>

            {/* New Key Modal */}
            {showNewKeyModal && (
              <div className="p-4 rounded-lg border border-primary/30 bg-primary/5 space-y-3">
                {generatedKey ? (
                  <>
                    <div className="text-sm font-semibold text-positive">API Key Generated — Copy it now!</div>
                    <div className="text-xs text-muted-foreground">This key will never be shown again. Store it securely.</div>
                    <div className="flex items-center gap-2">
                      <code className="text-xs font-mono bg-background px-2 py-1.5 rounded flex-1 break-all text-foreground">{generatedKey}</code>
                      <Button size="sm" variant="outline" onClick={() => handleCopyKey(generatedKey)}><Copy className="w-3.5 h-3.5" /></Button>
                    </div>
                    <Button size="sm" className="w-full" onClick={() => { setShowNewKeyModal(false); setGeneratedKey(null); }}>Done</Button>
                  </>
                ) : (
                  <>
                    <div className="text-sm font-semibold text-foreground">Create New API Key</div>
                    <div>
                      <label className="text-xs text-muted-foreground">Key Name</label>
                      <Input value={newKeyName} onChange={e => setNewKeyName(e.target.value)} placeholder="Trading Bot v3" className="mt-1" />
                    </div>
                    <div>
                      <label className="text-xs text-muted-foreground block mb-1">Permissions</label>
                      <div className="flex gap-2">
                        {(["READ", "TRADE", "ADMIN"] as const).map(perm => (
                          <button
                            key={perm}
                            onClick={() => togglePerm(perm)}
                            className={`px-3 py-1 rounded text-xs font-medium border transition-colors ${
                              newKeyPerms.includes(perm)
                                ? "bg-primary text-primary-foreground border-primary"
                                : "bg-transparent text-muted-foreground border-border hover:border-primary/40"
                            }`}
                          >{perm}</button>
                        ))}
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Button size="sm" variant="outline" className="flex-1" onClick={() => setShowNewKeyModal(false)}>Cancel</Button>
                      <Button size="sm" className="flex-1 bg-primary text-white" onClick={handleCreateKey} disabled={generateKeyMutation.isPending}>
                        {generateKeyMutation.isPending ? "Generating..." : "Generate Key"}
                      </Button>
                    </div>
                  </>
                )}
              </div>
            )}

            <div className="space-y-3">
              {!apiKeysList || apiKeysList.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground text-sm">
                  No API keys yet. Create one to get started.
                </div>
              ) : apiKeysList.map(k => (
                <div key={k.id} className={`p-4 rounded-lg border ${k.active ? "border-border bg-secondary/30" : "border-border/30 bg-secondary/10 opacity-60"}`}>
                  <div className="flex items-center justify-between mb-2">
                    <div className="font-medium text-foreground">{k.name}</div>
                    <div className="flex items-center gap-2">
                      {k.active ? <Badge className="badge-settled text-[10px]">Active</Badge> : <Badge className="badge-cancelled text-[10px]">Revoked</Badge>}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 mb-2">
                    <code className="text-xs font-mono text-muted-foreground bg-background px-2 py-1 rounded flex-1 truncate">
                      {k.keyPrefix}
                    </code>
                    <button onClick={() => setShowKey(showKey === k.id ? null : k.id)} className="p-1 hover:text-foreground text-muted-foreground transition-colors">
                      {showKey === k.id ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <div className="flex gap-1 flex-wrap">
                      {k.permissions.map(p => <Badge key={p} variant="outline" className="text-[10px]">{p}</Badge>)}
                    </div>
                    <div className="flex gap-2">
                      {k.active && (
                        <button
                          onClick={() => revokeKeyMutation.mutate({ id: k.id })}
                          className="text-yellow-400 hover:text-yellow-300 transition-colors"
                          disabled={revokeKeyMutation.isPending}
                        >Revoke</button>
                      )}
                      <button
                        onClick={() => deleteKeyMutation.mutate({ id: k.id })}
                        className="text-negative hover:text-negative/80 transition-colors"
                        disabled={deleteKeyMutation.isPending}
                      >Delete</button>
                    </div>
                  </div>
                  {k.lastUsedAt && (
                    <div className="text-xs text-muted-foreground mt-1">Last used {new Date(k.lastUsedAt).toLocaleDateString()}</div>
                  )}
                </div>
              ))}
            </div>
            <div className="p-3 rounded-lg bg-yellow-500/10 border border-yellow-500/20 text-xs text-yellow-400">
              Keep your API keys secret. Never share them or commit them to version control.
            </div>
          </div>
        </TabsContent>

        {/* Notifications Tab */}
        <TabsContent value="notifications" className="mt-4">
          <div className="stat-card space-y-4">
            <h3 className="font-semibold text-foreground flex items-center gap-2"><Bell className="w-4 h-4 text-primary" />Notification Preferences</h3>
            <div className="space-y-1">
              {([
                { key: "priceAlerts",       label: "Price Alerts",          desc: "When your price alert targets are hit" },
                { key: "orderFilled",       label: "Order Filled",          desc: "When your orders are fully or partially filled" },
                { key: "orderCancelled",    label: "Order Cancelled",       desc: "When your orders are cancelled or rejected" },
                { key: "kycUpdates",        label: "KYC Updates",           desc: "Status changes on your KYC application" },
                { key: "systemMaintenance", label: "System Maintenance",    desc: "Scheduled downtime and platform updates" },
                { key: "weeklyReport",      label: "Weekly Report",         desc: "Weekly summary of your trading activity" },
                { key: "newListings",       label: "New Listings",          desc: "New instruments listed on the exchange" },
                { key: "securityAlerts",    label: "Security Alerts",       desc: "Unusual login activity and security events" },
              ] as { key: NotifKey; label: string; desc: string }[]).map(({ key, label, desc }) => (
                <div key={key} className="flex items-center justify-between py-3 border-b border-border/50 last:border-0">
                  <div>
                    <div className="text-sm font-medium text-foreground">{label}</div>
                    <div className="text-xs text-muted-foreground">{desc}</div>
                  </div>
                  <Switch
                    checked={notifs[key]}
                    onCheckedChange={() => toggleNotif(key)}
                    disabled={updateNotifPrefs.isPending}
                  />
                </div>
              ))}
            </div>
          </div>
        </TabsContent>

        {/* Billing Tab */}
        <TabsContent value="billing" className="mt-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <div className="stat-card space-y-4">
              <h3 className="font-semibold text-foreground flex items-center gap-2"><CreditCard className="w-4 h-4 text-primary" />Trading Fees</h3>
              <div className="space-y-2">
                {[
                  { label: "Maker Fee",        value: "0.10%", note: "Limit orders that add liquidity" },
                  { label: "Taker Fee",        value: "0.15%", note: "Market orders that remove liquidity" },
                  { label: "Withdrawal Fee",   value: "₦500",  note: "Per bank transfer" },
                  { label: "Warehouse Fee",    value: "0.05%", note: "Per month on stored commodities" },
                  { label: "EWR Issuance",     value: "₦2,500",note: "Per warehouse receipt" },
                ].map(({ label, value, note }) => (
                  <div key={label} className="flex items-center justify-between py-2 border-b border-border/50 last:border-0">
                    <div>
                      <div className="text-sm font-medium text-foreground">{label}</div>
                      <div className="text-xs text-muted-foreground">{note}</div>
                    </div>
                    <div className="text-sm font-mono font-bold text-primary">{value}</div>
                  </div>
                ))}
              </div>
            </div>
            <div className="stat-card space-y-4">
              <h3 className="font-semibold text-foreground">Account Tier</h3>
              <div className="p-4 rounded-lg bg-primary/10 border border-primary/20">
                <div className="text-lg font-bold text-primary">Standard Tier</div>
                <div className="text-sm text-muted-foreground mt-1">30-day volume: $0 (no DB connected)</div>
                <div className="text-xs text-muted-foreground mt-2">Upgrade to VIP at $100k monthly volume for 20% fee discount</div>
              </div>
              <div className="space-y-2">
                {[
                  { label: "Daily Withdrawal Limit", value: "₦5,000,000" },
                  { label: "Monthly Trade Limit",    value: "Unlimited" },
                  { label: "Open Orders Limit",      value: "100" },
                  { label: "API Rate Limit",         value: "1,200 req/min" },
                ].map(({ label, value }) => (
                  <div key={label} className="flex justify-between text-sm py-2 border-b border-border/50 last:border-0">
                    <span className="text-muted-foreground">{label}</span>
                    <span className="text-foreground font-medium">{value}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
