import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Activity,
  Clock,
  CheckCircle2,
  AlertCircle,
  XCircle,
  ChevronRight,
  Home,
  BarChart3,
  Settings,
  TrendingUp,
  Shield,
  Wallet,
  Pencil,
  Upload,
} from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { useState } from "react";
import { PageSkeleton } from "@/components/PageSkeleton";

const KYC_BADGE: Record<string, { label: string; color: string; icon: React.ElementType }> = {
  PENDING: { label: "Pending", color: "bg-gray-700 text-gray-200", icon: Clock },
  UNDER_REVIEW: { label: "Under Review", color: "bg-yellow-700 text-yellow-200", icon: Clock },
  APPROVED: { label: "Approved", color: "bg-green-700 text-green-200", icon: CheckCircle2 },
  REJECTED: { label: "Rejected", color: "bg-red-700 text-red-200", icon: XCircle },
};

type MMProfile = {
  id: number; userId: number; firmName: string; tradingDesk?: string | null;
  contactPhone?: string | null; contactEmail?: string | null;
  yearsOfOperation?: number | null; regulatoryRegistrations?: string | null;
  instrumentObligations?: string[] | null; minQuoteSizeLots?: number | null;
  maxSpreadBps?: number | null; capitalCommitmentNgn?: string | null;
  performanceBondNgn?: string | null; kycStatus: string; kycNotes?: string | null;
  accountStatus: string; firmRegistrationUrl?: string | null;
  tradingLicenseUrl?: string | null; capitalAdequacyUrl?: string | null;
  createdAt?: Date | string; updatedAt?: Date | string;
};

export default function MarketMakerOnboardingDashboard() {
  const [, navigate] = useLocation();
  const { data: profileRaw, isLoading, refetch } = trpc.marketMakerOnboarding.getMyMarketMakerProfile.useQuery();
  const profile = profileRaw as MMProfile | null | undefined;
  const [editOpen, setEditOpen] = useState(false);
  const [kycReset, setKycReset] = useState(false);
  const [editForm, setEditForm] = useState({ tradingDesk: "", maxSpreadBps: "", capitalCommitmentNgn: "" });
  const [docUploading, setDocUploading] = useState<Record<string, boolean>>({});
  const [docUrls, setDocUrls] = useState<Record<string, string>>({});
  const uploadDoc = trpc.marketMakerOnboarding.uploadKycDocument.useMutation({
    onSuccess: (data, vars) => {
      setDocUrls(prev => ({ ...prev, [vars.docId]: data.url }));
      toast.success("Document uploaded successfully");
    },
    onError: (e) => toast.error(e.message),
  });
  const handleDocFile = async (docId: "firmRegistrationUrl" | "tradingLicenseUrl" | "capitalAdequacyUrl", file: File) => {
    setDocUploading(prev => ({ ...prev, [docId]: true }));
    try {
      const base64Data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve((reader.result as string).split(",")[1]);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      await uploadDoc.mutateAsync({ docId, fileName: file.name, mimeType: file.type || "application/octet-stream", base64Data });
    } finally {
      setDocUploading(prev => ({ ...prev, [docId]: false }));
    }
  };
  const updateProfile = trpc.marketMakerOnboarding.updateMyMarketMakerProfile.useMutation({
    onSuccess: (data) => {
      if ((data as { kycResetDueToChange?: boolean }).kycResetDueToChange) {
        setKycReset(true);
        toast.warning("Profile updated — KYC reset to PENDING. Please re-upload your firm documents.");
      } else {
        toast.success("Profile updated successfully");
        setEditOpen(false);
        refetch();
      }
    },
    onError: (e) => toast.error(e.message),
  });
  const submitKyc = trpc.marketMakerOnboarding.submitMarketMakerKYC.useMutation({
    onSuccess: () => {
      toast.success("Firm documents submitted for review");
      setEditOpen(false);
      setKycReset(false);
      refetch();
    },
    onError: (e) => toast.error(e.message),
  });

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-cyan-950 to-cyan-900 flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-cyan-950 to-cyan-900 flex flex-col items-center justify-center px-6 text-center">
        <Activity className="w-12 h-12 text-cyan-400 mb-4" />
        <h2 className="text-xl font-bold text-white mb-2">No Market Maker Profile Found</h2>
        <p className="text-cyan-300 text-sm mb-6">Complete the market maker onboarding to access your dashboard.</p>
        <Button onClick={() => navigate("/market-maker-onboarding")} className="bg-cyan-500 hover:bg-cyan-400 text-white">
          Apply Now
        </Button>
      </div>
    );
  }

  const kycInfo = KYC_BADGE[profile.kycStatus] ?? KYC_BADGE.PENDING;
  const KycIcon = kycInfo.icon;

  const formatNgn = (val: string | null | undefined) =>
    val ? `₦${parseFloat(val).toLocaleString()}` : "—";

  if (isLoading) return <PageSkeleton cards={4} tableRows={6} tableCols={4} showChart />;
  return (
    <div className="min-h-screen bg-gradient-to-b from-cyan-950 to-cyan-900 text-white pb-24">
      {/* Header */}
      <div className="px-4 pt-10 pb-6">
        <div className="flex items-center justify-between mb-1">
          <h1 className="text-2xl font-bold">MM Onboarding</h1>
          <Badge className={kycInfo.color + " flex items-center gap-1"}>
            <KycIcon className="w-3 h-3" />
            {kycInfo.label}
          </Badge>
        </div>
        <p className="text-cyan-300 text-sm">{profile.firmName}{profile.tradingDesk ? ` · ${profile.tradingDesk}` : ""}</p>
      </div>

      <div className="px-4 space-y-4">
        {/* KYC Alert */}
        {profile.kycStatus !== "APPROVED" && (
          <Card className="bg-yellow-900/30 border-yellow-700">
            <CardContent className="p-4 flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-yellow-400 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-yellow-200 text-sm font-medium">
                  {profile.kycStatus === "PENDING"
                    ? "Application Not Submitted"
                    : profile.kycStatus === "UNDER_REVIEW"
                    ? "Application Under Review"
                    : "Application Rejected"}
                </p>
                <p className="text-yellow-400 text-xs mt-0.5">
                  {profile.kycStatus === "PENDING"
                    ? "Submit your documentation to complete the market maker application."
                    : profile.kycStatus === "UNDER_REVIEW"
                    ? "The Exchange Committee is reviewing your application. This takes 5–10 business days."
                    : `Reason: ${profile.kycNotes ?? "Please resubmit with correct documents."}`}
                </p>
                {profile.kycStatus === "PENDING" && (
                  <button
                    onClick={() => navigate("/market-maker-onboarding")}
                    className="text-yellow-300 text-xs underline mt-1"
                  >
                    Complete Application →
                  </button>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Obligations Summary */}
        <Card className="bg-cyan-800/30 border-cyan-700">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-cyan-300 font-medium">Quoting Obligations</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <p className="text-xs text-cyan-400">Min Quote Size</p>
                <p className="text-sm font-medium text-white">
                  {profile.minQuoteSizeLots
                    ? `${parseFloat(String(profile.minQuoteSizeLots ?? 0)).toLocaleString()} lots`
                    : "—"}
                </p>
              </div>
              <div>
                <p className="text-xs text-cyan-400">Max Spread</p>
                <p className="text-sm font-medium text-white">
                  {profile.maxSpreadBps ? `${parseFloat(String(profile.maxSpreadBps ?? 0))} bps` : "—"}
                </p>
              </div>
              <div>
                <p className="text-xs text-cyan-400">Capital Commitment</p>
                <p className="text-sm font-medium text-white">{formatNgn(profile.capitalCommitmentNgn)}</p>
              </div>
              <div>
                <p className="text-xs text-cyan-400">Performance Bond</p>
                <p className="text-sm font-medium text-white">{formatNgn(profile.performanceBondNgn)}</p>
              </div>
              <div>
                <p className="text-xs text-cyan-400">Years Operating</p>
                <p className="text-sm font-medium text-white">{profile.yearsOfOperation ?? "—"}</p>
              </div>
              <div>
                <p className="text-xs text-cyan-400">Account Status</p>
                <p
                  className={`text-sm font-medium ${
                    profile.accountStatus === "ACTIVE" ? "text-green-400" : "text-gray-400"
                  }`}
                >
                  {profile.accountStatus}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Instrument Obligations */}
        {profile.instrumentObligations && (profile.instrumentObligations as string[]).length > 0 && (
          <Card className="bg-cyan-800/30 border-cyan-700">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-cyan-300 font-medium">Instrument Obligations</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-2">
                {(profile.instrumentObligations as string[]).map((inst: string) => (
                  <Badge key={inst} className="bg-cyan-700 text-cyan-200 text-xs">
                    {inst}
                  </Badge>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Regulatory */}
        {profile.regulatoryRegistrations && (
          <Card className="bg-cyan-800/30 border-cyan-700">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-cyan-300 font-medium">Regulatory Registrations</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-2">
                <Shield className="w-4 h-4 text-cyan-400" />
                <p className="text-sm text-white">{profile.regulatoryRegistrations}</p>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Edit Profile Button */}
        <button
          onClick={() => {
            setEditForm({
              tradingDesk: profile.tradingDesk ?? "",
              maxSpreadBps: profile.maxSpreadBps ? String(profile.maxSpreadBps) : "",
              capitalCommitmentNgn: profile.capitalCommitmentNgn ? String(profile.capitalCommitmentNgn) : "",
            });
            setEditOpen(true);
          }}
          className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg bg-cyan-700/40 hover:bg-cyan-600/40 border border-cyan-600 text-sm text-cyan-200 transition-colors"
        >
          <Pencil className="w-4 h-4" />
          Edit Profile
        </button>

        {/* Quick Actions */}
        <Card className="bg-cyan-800/30 border-cyan-700">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-cyan-300 font-medium">Quick Actions</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {[
              { label: "Order Book", icon: BarChart3, path: "/order-book" },
              { label: "Portfolio Analytics", icon: Wallet, path: "/portfolio-analytics" },
              { label: "Market Performance", icon: TrendingUp, path: "/market" },
            ].map(({ label, icon: Icon, path }) => (
              <button
                key={label}
                onClick={() => navigate(path)}
                className="w-full flex items-center justify-between p-3 rounded-lg bg-cyan-800/40 hover:bg-cyan-700/40 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <Icon className="w-4 h-4 text-cyan-400" />
                  <span className="text-sm text-white">{label}</span>
                </div>
                <ChevronRight className="w-4 h-4 text-cyan-500" />
              </button>
            ))}
          </CardContent>
        </Card>
      </div>

      {/* Edit Profile Dialog */}
      <Dialog open={editOpen} onOpenChange={(open) => { setEditOpen(open); if (!open) setKycReset(false); }}>
        <DialogContent className="bg-cyan-950 border-cyan-700 text-white max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-white">Edit Market Maker Profile</DialogTitle>
          </DialogHeader>
          {!kycReset ? (
            <>
              <div className="space-y-4 py-2">
                <div>
                  <Label className="text-cyan-300 text-xs">Trading Desk</Label>
                  <Input value={editForm.tradingDesk} onChange={e => setEditForm(f => ({ ...f, tradingDesk: e.target.value }))} placeholder="e.g. Commodities Desk" className="bg-cyan-900 border-cyan-700 text-white mt-1" />
                </div>
                <div>
                  <Label className="text-cyan-300 text-xs">Max Spread (bps)</Label>
                  <Input value={editForm.maxSpreadBps} onChange={e => setEditForm(f => ({ ...f, maxSpreadBps: e.target.value }))} placeholder="50" className="bg-cyan-900 border-cyan-700 text-white mt-1" />
                </div>
                <div>
                  <Label className="text-cyan-300 text-xs">Capital Commitment (NGN)</Label>
                  <Input value={editForm.capitalCommitmentNgn} onChange={e => setEditForm(f => ({ ...f, capitalCommitmentNgn: e.target.value }))} placeholder="100000000" className="bg-cyan-900 border-cyan-700 text-white mt-1" />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setEditOpen(false)} className="border-cyan-700 text-cyan-300">Cancel</Button>
                <Button
                  onClick={() => updateProfile.mutate({
                    tradingDesk: editForm.tradingDesk || undefined,
                    maxSpreadBps: editForm.maxSpreadBps ? parseInt(editForm.maxSpreadBps) : undefined,
                    capitalCommitmentNgn: editForm.capitalCommitmentNgn ? parseInt(editForm.capitalCommitmentNgn) : undefined,
                  })}
                  disabled={updateProfile.isPending}
                  className="bg-cyan-500 hover:bg-cyan-400 text-white"
                >
                  {updateProfile.isPending ? "Saving..." : "Save Changes"}
                </Button>
              </DialogFooter>
            </>
          ) : (
            <>
              <div className="bg-yellow-900/30 border border-yellow-700 rounded-lg p-3 mb-4">
                <div className="flex items-start gap-2">
                  <Upload className="w-4 h-4 text-yellow-400 mt-0.5 flex-shrink-0" />
                  <div>
                    <p className="text-yellow-200 text-sm font-medium">KYC Reset — Re-upload Required</p>
                    <p className="text-yellow-400 text-xs mt-0.5">Your profile changes require a fresh KYC review. Please re-submit your firm registration documents.</p>
                  </div>
                </div>
              </div>
              <div className="space-y-4 py-2">
                {([
                  { id: "firmRegistrationUrl" as const, label: "Firm Registration", required: true },
                  { id: "tradingLicenseUrl" as const, label: "Trading License", required: true },
                  { id: "capitalAdequacyUrl" as const, label: "Capital Adequacy", required: false },
                ] as { id: "firmRegistrationUrl" | "tradingLicenseUrl" | "capitalAdequacyUrl"; label: string; required: boolean }[]).map(({ id, label, required }) => (
                  <div key={id}>
                    <Label className="text-cyan-300 text-xs">{label} {required && <span className="text-red-400">*</span>}</Label>
                    <div className="flex items-center gap-2 mt-1">
                      <label className="flex-1 flex items-center gap-2 px-3 py-2 bg-cyan-900 border border-cyan-700 rounded-md cursor-pointer hover:border-cyan-500 transition-colors">
                        <Upload className="w-4 h-4 text-cyan-400 flex-shrink-0" />
                        <span className="text-xs text-cyan-300 truncate">
                          {docUploading[id] ? "Uploading..." : docUrls[id] ? "✓ Uploaded" : "Choose file (PDF/JPG/PNG)"}
                        </span>
                        <input type="file" accept=".pdf,.jpg,.jpeg,.png" className="hidden" disabled={docUploading[id]}
                          onChange={e => { const f = e.target.files?.[0]; if (f) handleDocFile(id, f); }} />
                      </label>
                      {docUrls[id] && <a href={docUrls[id]} target="_blank" rel="noopener noreferrer" className="text-cyan-400 text-xs underline">View</a>}
                    </div>
                  </div>
                ))}
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => { setEditOpen(false); setKycReset(false); }} className="border-cyan-700 text-cyan-300">Cancel</Button>
                <Button
                  onClick={() => submitKyc.mutate({
                    firmRegistrationUrl: docUrls.firmRegistrationUrl || profile?.firmRegistrationUrl || "",
                    tradingLicenseUrl: docUrls.tradingLicenseUrl || profile?.tradingLicenseUrl || "",
                    capitalAdequacyUrl: docUrls.capitalAdequacyUrl || profile?.capitalAdequacyUrl || undefined,
                  })}
                  disabled={submitKyc.isPending || !(docUrls.firmRegistrationUrl || profile?.firmRegistrationUrl) || !(docUrls.tradingLicenseUrl || profile?.tradingLicenseUrl)}
                  className="bg-yellow-600 hover:bg-yellow-500 text-white"
                >
                  {submitKyc.isPending ? "Submitting..." : "Re-submit for Review"}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Bottom Nav */}
      <nav className="fixed bottom-0 left-0 right-0 bg-cyan-950 border-t border-cyan-800 flex">
        {[
          { icon: Home, label: "Home", path: "/" },
          { icon: BarChart3, label: "Markets", path: "/market" },
          { icon: Activity, label: "MM Desk", path: "/market-maker-onboarding-dashboard", active: true },
          { icon: Settings, label: "Settings", path: "/settings" },
        ].map(({ icon: Icon, label, path, active }) => (
          <button
            key={label}
            onClick={() => navigate(path)}
            className={`flex-1 flex flex-col items-center py-3 gap-0.5 text-xs transition-colors ${
              active ? "text-cyan-400" : "text-cyan-600 hover:text-cyan-400"
            }`}
          >
            <Icon className="w-5 h-5" />
            {label}
          </button>
        ))}
      </nav>
    </div>
  );
}
