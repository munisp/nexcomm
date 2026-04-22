/**
 * FarmerDashboard — Farmer's home screen
 * Shows profile status, KYC badge, farm count, active listings,
 * cooperative membership card, and quick-action navigation.
 * Includes Edit Profile dialog with KYC-reset document re-upload.
 */
import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Sprout,
  ShieldCheck,
  ShieldAlert,
  Clock,
  Wheat,
  MapPin,
  Plus,
  ChevronRight,
  TrendingUp,
  User,
  LogOut,
  BarChart3,
  Users,
  Building2,
  ArrowRight,
  Pencil,
  AlertTriangle,
  Upload,
  X,
  FileText,
  Bell,
} from "lucide-react";
import { toast } from "sonner";
import PushNotificationSettings from "@/pages/PushNotificationSettings";
import { PageSkeleton } from "@/components/PageSkeleton";

const KYC_COLORS: Record<string, string> = {
  PENDING: "bg-slate-700 text-slate-300",
  SUBMITTED: "bg-amber-900/60 text-amber-300 border-amber-700",
  UNDER_REVIEW: "bg-amber-900/60 text-amber-300 border-amber-700",
  APPROVED: "bg-green-900/60 text-green-300 border-green-700",
  REJECTED: "bg-red-900/60 text-red-300 border-red-700",
};

const KYC_ICONS: Record<string, typeof ShieldCheck> = {
  PENDING: Clock,
  SUBMITTED: Clock,
  UNDER_REVIEW: Clock,
  APPROVED: ShieldCheck,
  REJECTED: ShieldAlert,
};

const KYC_MESSAGES: Record<string, string> = {
  PENDING: "Not submitted yet",
  SUBMITTED: "Under review — 1-2 business days",
  UNDER_REVIEW: "Under review — 1-2 business days",
  APPROVED: "Your identity is verified",
  REJECTED: "Rejected — please resubmit",
};

export default function FarmerDashboard() {
  const { user, logout } = useAuth();
  const [, navigate] = useLocation();
  const utils = trpc.useUtils();
  const profileQ = trpc.farmer.getMyFarmerProfile.useQuery();
  const farmsQ = trpc.farmer.getMyFarms.useQuery();
  const listingsQ = trpc.farmer.getMyCropListings.useQuery({ status: "ACTIVE" });
  const cooperativeQ = trpc.farmer.getMyCooperative.useQuery();
  // Resume Draft banner — show when farmer has an incomplete onboarding draft (step < 5)
  // Dismissal is persisted in localStorage keyed by the current draft step so the banner
  // reappears automatically if the user advances to a new step after dismissing.
  const draftQ = trpc.farmer.getDraft.useQuery(undefined, { staleTime: 60_000 });
  const draftStep = draftQ.data?.step ?? 2;
  const DRAFT_DISMISS_KEY = `nexcom:draft-banner-dismissed:step-${draftStep}`;
  const [draftBannerDismissed, setDraftBannerDismissed] = useState<boolean>(() => {
    try { return localStorage.getItem(DRAFT_DISMISS_KEY) === "1"; } catch { return false; }
  });
  // Re-evaluate dismissal whenever draftStep changes (user progressed to a new step)
  useEffect(() => {
    try {
      setDraftBannerDismissed(localStorage.getItem(DRAFT_DISMISS_KEY) === "1");
    } catch { /* ignore */ }
  }, [DRAFT_DISMISS_KEY]);
  function dismissDraftBanner() {
    try { localStorage.setItem(DRAFT_DISMISS_KEY, "1"); } catch { /* ignore */ }
    setDraftBannerDismissed(true);
  }
  const showDraftBanner =
    !draftBannerDismissed &&
    draftQ.data != null &&
    (draftQ.data.step ?? 0) > 1 &&
    (draftQ.data.step ?? 0) < 5;

  const profile = profileQ.data;
  const farms = farmsQ.data ?? [];
  const listings = listingsQ.data ?? [];
  const kycStatus = profile?.kycStatus ?? "PENDING";
  const KYCIcon = KYC_ICONS[kycStatus] ?? Clock;
  const cooperative = cooperativeQ.data?.cooperative ?? null;
  const membershipStatus = cooperativeQ.data?.membershipStatus ?? null;

  // ── Edit Profile dialog state ──────────────────────────────────────────────
  const [editOpen, setEditOpen] = useState(false);
  const [kycReset, setKycReset] = useState(false);
  const [editForm, setEditForm] = useState({
    fullName: "",
    phone: "",
    nin: "",
    bvn: "",
    state: "",
    lga: "",
  });
  const [docForm, setDocForm] = useState({
    ninDocumentUrl: "",
    bvnDocumentUrl: "",
  });

  function openEdit() {
    if (!profile) return;
    setEditForm({
      fullName: profile.fullName ?? "",
      phone: profile.phone ?? "",
      nin: profile.nin ?? "",
      bvn: profile.bvn ?? "",
      state: profile.state ?? "",
      lga: profile.lga ?? "",
    });
    setDocForm({ ninDocumentUrl: "", bvnDocumentUrl: "" });
    setKycReset(false);
    setEditOpen(true);
  }

  const updateMutation = trpc.farmer.updateMyFarmerProfile.useMutation({
    onSuccess: (result) => {
      utils.farmer.getMyFarmerProfile.invalidate();
      if (result.kycResetDueToChange) {
        setKycReset(true);
        toast.warning("KYC status reset — please re-upload your documents to restore verification.");
      } else {
        toast.success("Profile updated successfully.");
        setEditOpen(false);
      }
    },
    onError: (err) => toast.error(err.message),
  });

  const submitKycMutation = trpc.farmer.submitKYC.useMutation({
    onSuccess: () => {
      utils.farmer.getMyFarmerProfile.invalidate();
      toast.success("Documents submitted for review. We'll verify within 1-2 business days.");
      setEditOpen(false);
      setKycReset(false);
    },
    onError: (err) => toast.error(err.message),
  });

  function handleEditSave() {
    const patch: Record<string, string> = {};
    if (editForm.fullName !== (profile?.fullName ?? "")) patch.fullName = editForm.fullName;
    if (editForm.phone !== (profile?.phone ?? "")) patch.phone = editForm.phone;
    if (editForm.nin !== (profile?.nin ?? "")) patch.nin = editForm.nin;
    if (editForm.bvn !== (profile?.bvn ?? "")) patch.bvn = editForm.bvn;
    if (editForm.state !== (profile?.state ?? "")) patch.state = editForm.state;
    if (editForm.lga !== (profile?.lga ?? "")) patch.lga = editForm.lga;
    if (Object.keys(patch).length === 0) { setEditOpen(false); return; }
    updateMutation.mutate(patch);
  }

  function handleDocResubmit() {
    if (!docForm.ninDocumentUrl && !docForm.bvnDocumentUrl) {
      toast.error("Please provide at least one document URL.");
      return;
    }
    submitKycMutation.mutate({
      ninDocumentUrl: docForm.ninDocumentUrl || undefined,
      bvnDocumentUrl: docForm.bvnDocumentUrl || undefined,
    });
  }

  if (profileQ.isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-green-950 to-slate-950 flex items-center justify-center">
        <Sprout className="w-10 h-10 text-green-400 animate-pulse" />
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-green-950 to-slate-950 flex flex-col items-center justify-center p-6 text-center gap-4">
        <Sprout className="w-12 h-12 text-green-400" />
        <p className="text-white font-semibold">No farmer profile found</p>
        <Button onClick={() => navigate("/farmer-onboarding")} className="bg-green-600 hover:bg-green-700 text-white">
          Register Now
        </Button>
      </div>
    );
  }

  if (profileQ.isLoading) return <PageSkeleton cards={4} tableRows={6} tableCols={4} showChart />;
  return (
    <div className="min-h-screen bg-gradient-to-b from-green-950 to-slate-950 flex flex-col max-w-md mx-auto">
      {/* Header */}
      <div className="p-4 flex items-center justify-between border-b border-slate-800">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-green-500/20 flex items-center justify-center">
            <User className="w-5 h-5 text-green-400" />
          </div>
          <div>
            <p className="text-white font-semibold text-sm">{profile.fullName}</p>
            <p className="text-slate-400 text-xs">{profile.lga}, {profile.state}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={openEdit}
            className="text-slate-400 hover:text-green-400 transition-colors"
            title="Edit Profile"
          >
            <Pencil className="w-4 h-4" />
          </button>
          <button onClick={() => logout()} className="text-slate-400 hover:text-white">
            <LogOut className="w-5 h-5" />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4 pb-24">
        {/* Resume Draft Banner — shown when farmer has an incomplete onboarding draft */}
        {showDraftBanner && (
          <div className="flex items-start gap-3 rounded-lg border border-amber-700/50 bg-amber-900/20 p-3">
            <FileText className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-amber-300">You have an unfinished registration</p>
              <p className="text-xs text-amber-400/80 mt-0.5">
                You stopped at Step {draftStep - 1} of 4. Continue to complete your KYC and start selling.
              </p>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <Button
                size="sm"
                className="h-7 text-xs bg-amber-600 hover:bg-amber-700 text-white border-0"
                onClick={() => navigate(`/farmer-onboarding?step=${draftStep}`)}
              >
                Resume <ArrowRight className="h-3 w-3 ml-1" />
              </Button>
              <button
                onClick={dismissDraftBanner}
                className="text-amber-400/60 hover:text-amber-300 p-0.5"
                aria-label="Dismiss"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        )}
        {/* KYC Status Card */}
        <Card className={`border ${kycStatus === "APPROVED" ? "bg-green-950/40 border-green-800/40" : kycStatus === "REJECTED" ? "bg-red-950/40 border-red-800/40" : "bg-slate-800 border-slate-700"}`}>
          <CardContent className="p-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <KYCIcon className={`w-6 h-6 ${kycStatus === "APPROVED" ? "text-green-400" : kycStatus === "REJECTED" ? "text-red-400" : "text-amber-400"}`} />
              <div>
                <p className="text-white text-sm font-semibold">KYC Verification</p>
                <p className="text-slate-400 text-xs">{KYC_MESSAGES[kycStatus] ?? "Not submitted yet"}</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Badge className={KYC_COLORS[kycStatus]}>{kycStatus}</Badge>
              {kycStatus !== "APPROVED" && (
                <button onClick={() => navigate("/farmer-kyc")} className="text-green-400">
                  <ChevronRight className="w-4 h-4" />
                </button>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Stats Row */}
        <div className="grid grid-cols-3 gap-3">
          <Card className="bg-slate-800 border-slate-700">
            <CardContent className="p-3 text-center">
              <p className="text-2xl font-bold text-white">{farms.length}</p>
              <p className="text-slate-400 text-xs mt-0.5">Farms</p>
            </CardContent>
          </Card>
          <Card className="bg-slate-800 border-slate-700">
            <CardContent className="p-3 text-center">
              <p className="text-2xl font-bold text-white">{listings.length}</p>
              <p className="text-slate-400 text-xs mt-0.5">Active Listings</p>
            </CardContent>
          </Card>
          <Card className="bg-slate-800 border-slate-700">
            <CardContent className="p-3 text-center">
              <p className="text-2xl font-bold text-green-400">
                {listings.reduce((sum, l) => sum + parseFloat(l.quantityKg), 0).toLocaleString()}
              </p>
              <p className="text-slate-400 text-xs mt-0.5">Total kg</p>
            </CardContent>
          </Card>
        </div>

        {/* Cooperative Membership Card */}
        <Card className={`border ${cooperative ? "bg-blue-950/30 border-blue-800/40" : "bg-slate-800/60 border-slate-700 border-dashed"}`}>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${cooperative ? "bg-blue-700/40" : "bg-slate-700/60"}`}>
                  {cooperative ? (
                    <Building2 className="w-4 h-4 text-blue-400" />
                  ) : (
                    <Users className="w-4 h-4 text-slate-400" />
                  )}
                </div>
                <div>
                  <p className="text-white text-sm font-semibold">
                    {cooperative ? "Cooperative Member" : "No Cooperative"}
                  </p>
                  {cooperative ? (
                    <p className="text-slate-400 text-xs">
                      {cooperative.fileName} · {cooperative.totalMembers} members
                    </p>
                  ) : (
                    <p className="text-slate-500 text-xs">Join a cooperative for group benefits</p>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2">
                {cooperative && membershipStatus && (
                  <Badge className={`text-xs ${
                    membershipStatus === "APPROVED" ? "bg-green-900/60 text-green-300 border-green-700" :
                    membershipStatus === "UNDER_REVIEW" ? "bg-amber-900/60 text-amber-300 border-amber-700" :
                    "bg-slate-700 text-slate-300"
                  }`}>
                    {membershipStatus}
                  </Badge>
                )}
                <button
                  onClick={() => navigate("/cooperative")}
                  className="text-blue-400 hover:text-blue-300 transition-colors"
                >
                  <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Quick Actions */}
        <div className="grid grid-cols-2 gap-3">
          <Button
            onClick={() => navigate("/farmer-farms")}
            className="h-14 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-white flex flex-col gap-1"
            variant="outline"
          >
            <MapPin className="w-5 h-5 text-green-400" />
            <span className="text-xs">My Farms</span>
          </Button>
          <Button
            onClick={() => navigate("/farmer-crops")}
            className="h-14 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-white flex flex-col gap-1"
            variant="outline"
          >
            <Wheat className="w-5 h-5 text-amber-400" />
            <span className="text-xs">Crop Listings</span>
          </Button>
          <Button
            onClick={() => navigate("/farmer-market")}
            className="h-14 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-white flex flex-col gap-1"
            variant="outline"
          >
            <BarChart3 className="w-5 h-5 text-blue-400" />
            <span className="text-xs">Market Prices</span>
          </Button>
          <Button
            onClick={() => navigate("/portfolio-analytics")}
            className="h-14 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-white flex flex-col gap-1"
            variant="outline"
          >
            <TrendingUp className="w-5 h-5 text-purple-400" />
            <span className="text-xs">Portfolio</span>
          </Button>
          <Button
            onClick={() => navigate("/alerts")}
            className="h-14 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-white flex flex-col gap-1 col-span-2"
            variant="outline"
          >
            <Bell className="w-5 h-5 text-yellow-400" />
            <span className="text-xs">Price Alerts</span>
          </Button>
        </div>

        {/* Recent Listings */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <p className="text-white font-semibold text-sm">Active Listings</p>
            <button onClick={() => navigate("/farmer-crops")} className="text-green-400 text-xs flex items-center gap-1">
              View all <ChevronRight className="w-3 h-3" />
            </button>
          </div>
          {listings.length === 0 ? (
            <Card className="bg-slate-800/50 border-slate-700 border-dashed">
              <CardContent className="p-6 text-center">
                <Wheat className="w-8 h-8 text-slate-500 mx-auto mb-2" />
                <p className="text-slate-400 text-sm">No active listings yet</p>
                <Button
                  size="sm"
                  onClick={() => navigate("/farmer-crops")}
                  className="mt-3 bg-green-600 hover:bg-green-700 text-white"
                  disabled={kycStatus !== "APPROVED"}
                >
                  <Plus className="w-3.5 h-3.5 mr-1" />
                  Add Listing
                </Button>
                {kycStatus !== "APPROVED" && (
                  <p className="text-slate-500 text-xs mt-2">KYC approval required</p>
                )}
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-2">
              {listings.slice(0, 4).map((listing) => (
                <Card key={listing.id} className="bg-slate-800 border-slate-700">
                  <CardContent className="p-3 flex items-center justify-between">
                    <div>
                      <p className="text-white text-sm font-medium">{listing.cropType}</p>
                      <p className="text-slate-400 text-xs">
                        {parseFloat(listing.quantityKg).toLocaleString()} kg · ₦{parseFloat(listing.askingPricePerKg).toLocaleString()}/kg
                      </p>
                    </div>
                    <Badge className="bg-green-900/60 text-green-300 border-green-700 text-xs">
                      ACTIVE
                    </Badge>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>

        {/* Push Notification Settings */}
        <div className="mt-2">
          <PushNotificationSettings compact />
        </div>
      </div>

      {/* Bottom Nav */}
      <div className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-md bg-slate-900 border-t border-slate-800 flex">
        {[
          { icon: Sprout, label: "Home", path: "/farmer-dashboard" },
          { icon: MapPin, label: "Farms", path: "/farmer-farms" },
          { icon: Wheat, label: "Crops", path: "/farmer-crops" },
          { icon: BarChart3, label: "Prices", path: "/farmer-market" },
          { icon: User, label: "Profile", path: "/farmer-kyc" },
        ].map(({ icon: Icon, label, path }) => (
          <button
            key={label}
            onClick={() => navigate(path)}
            className={`flex-1 py-3 flex flex-col items-center gap-1 text-xs transition-colors ${
              path === "/farmer-dashboard" ? "text-green-400" : "text-slate-400 hover:text-white"
            }`}
          >
            <Icon className="w-5 h-5" />
            {label}
          </button>
        ))}
      </div>

      {/* ── Edit Profile Dialog ─────────────────────────────────────────────── */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit Farmer Profile</DialogTitle>
          </DialogHeader>

          {!kycReset ? (
            <div className="space-y-4 py-2">
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2 space-y-1.5">
                  <Label>Full Name</Label>
                  <Input
                    value={editForm.fullName}
                    onChange={e => setEditForm(f => ({ ...f, fullName: e.target.value }))}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Phone</Label>
                  <Input
                    value={editForm.phone}
                    onChange={e => setEditForm(f => ({ ...f, phone: e.target.value }))}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>State</Label>
                  <Input
                    value={editForm.state}
                    onChange={e => setEditForm(f => ({ ...f, state: e.target.value }))}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>LGA</Label>
                  <Input
                    value={editForm.lga}
                    onChange={e => setEditForm(f => ({ ...f, lga: e.target.value }))}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>NIN</Label>
                  <Input
                    value={editForm.nin}
                    onChange={e => setEditForm(f => ({ ...f, nin: e.target.value }))}
                  />
                </div>
                <div className="col-span-2 space-y-1.5">
                  <Label>BVN</Label>
                  <Input
                    value={editForm.bvn}
                    onChange={e => setEditForm(f => ({ ...f, bvn: e.target.value }))}
                  />
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                Changing your name, phone, NIN, or BVN will reset your KYC status and require re-verification.
              </p>
            </div>
          ) : (
            /* ── KYC Reset: Document Re-Upload Section ── */
            <div className="space-y-4 py-2">
              <div className="flex items-start gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3">
                <AlertTriangle className="h-5 w-5 text-amber-400 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-amber-300">KYC Verification Reset</p>
                  <p className="text-xs text-amber-400/80 mt-0.5">
                    Your profile changes triggered a KYC reset. Please re-upload your identity documents to restore verified status.
                  </p>
                </div>
              </div>

              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label className="flex items-center gap-1.5">
                    <Upload className="h-3.5 w-3.5" />
                    NIN Document URL
                  </Label>
                  <Input
                    placeholder="https://cdn.example.com/nin-slip.jpg"
                    value={docForm.ninDocumentUrl}
                    onChange={e => setDocForm(f => ({ ...f, ninDocumentUrl: e.target.value }))}
                  />
                  <p className="text-xs text-muted-foreground">Upload your NIN slip or National ID card</p>
                </div>

                <div className="space-y-1.5">
                  <Label className="flex items-center gap-1.5">
                    <Upload className="h-3.5 w-3.5" />
                    BVN Document URL
                  </Label>
                  <Input
                    placeholder="https://cdn.example.com/bvn-doc.jpg"
                    value={docForm.bvnDocumentUrl}
                    onChange={e => setDocForm(f => ({ ...f, bvnDocumentUrl: e.target.value }))}
                  />
                  <p className="text-xs text-muted-foreground">Upload your BVN confirmation document</p>
                </div>
              </div>
            </div>
          )}

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => { setEditOpen(false); setKycReset(false); }}>
              Cancel
            </Button>
            {!kycReset ? (
              <Button
                onClick={handleEditSave}
                disabled={updateMutation.isPending}
                className="bg-green-600 hover:bg-green-500"
              >
                {updateMutation.isPending ? "Saving…" : "Save Changes"}
              </Button>
            ) : (
              <Button
                onClick={handleDocResubmit}
                disabled={submitKycMutation.isPending}
                className="bg-amber-600 hover:bg-amber-500"
              >
                {submitKycMutation.isPending ? "Submitting…" : "Re-submit for Review"}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
