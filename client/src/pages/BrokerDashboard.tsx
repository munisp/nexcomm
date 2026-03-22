import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Briefcase,
  Users,
  Shield,
  BarChart3,
  Clock,
  CheckCircle2,
  AlertCircle,
  XCircle,
  ChevronRight,
  Home,
  Wallet,
  Settings,
  Building2,
  Pencil,
  Upload,
  Star,
} from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { useState, useRef } from "react";
import PushNotificationSettings from "@/pages/PushNotificationSettings";
import { WatchlistTickerFilter } from "@/components/WatchlistTickerFilter";

const KYC_BADGE: Record<string, { label: string; color: string; icon: React.ElementType }> = {
  PENDING: { label: "Pending", color: "bg-gray-700 text-gray-200", icon: Clock },
  UNDER_REVIEW: { label: "Under Review", color: "bg-yellow-700 text-yellow-200", icon: Clock },
  APPROVED: { label: "Approved", color: "bg-green-700 text-green-200", icon: CheckCircle2 },
  REJECTED: { label: "Rejected", color: "bg-red-700 text-red-200", icon: XCircle },
};

export default function BrokerDashboard() {
  const [, navigate] = useLocation();
  const { data: profile, isLoading, refetch } = trpc.broker.getMyBrokerProfile.useQuery();
  const [editOpen, setEditOpen] = useState(false);
  const [kycReset, setKycReset] = useState(false);
  const [editForm, setEditForm] = useState({ contactPhone: "", contactEmail: "", commissionRate: "" });
  const [docForm, setDocForm] = useState({ secLicenseNumber: "", regulatoryBody: "", cbnLicenseNumber: "" });
  const [uploadedUrls, setUploadedUrls] = useState<Record<string, string>>({});
  const [uploading, setUploading] = useState<Record<string, boolean>>({});
  const secCertRef = useRef<HTMLInputElement>(null);
  const cbnApprovalRef = useRef<HTMLInputElement>(null);
  const cacDocRef = useRef<HTMLInputElement>(null);
  const uploadKycDoc = trpc.broker.uploadKycDocument.useMutation({
    onSuccess: (data, vars) => {
      setUploadedUrls(prev => ({ ...prev, [vars.docId]: data.url }));
      toast.success("Document uploaded successfully");
      setUploading(prev => ({ ...prev, [vars.docId]: false }));
    },
    onError: (e, vars) => {
      toast.error(e.message);
      setUploading(prev => ({ ...prev, [vars.docId]: false }));
    },
  });
  const handleFileUpload = async (docId: string, file: File) => {
    setUploading(prev => ({ ...prev, [docId]: true }));
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = (reader.result as string).split(",")[1];
      uploadKycDoc.mutate({ docId: docId as "secCertificateUrl" | "cbnApprovalUrl" | "cacDocUrl", fileName: file.name, mimeType: file.type, base64Data: base64 });
    };
    reader.readAsDataURL(file);
  };
  const updateProfile = trpc.broker.updateMyBrokerProfile.useMutation({
    onSuccess: (data) => {
      if ((data as { kycResetDueToChange?: boolean }).kycResetDueToChange) {
        setKycReset(true);
        toast.warning("Profile updated — KYC reset to PENDING. Please re-upload your license documents.");
      } else {
        toast.success("Profile updated successfully");
        setEditOpen(false);
        refetch();
      }
    },
    onError: (e) => toast.error(e.message),
  });
  const submitKyc = trpc.broker.submitBrokerKYC.useMutation({
    onSuccess: () => {
      toast.success("License documents submitted for review");
      setEditOpen(false);
      setKycReset(false);
      refetch();
    },
    onError: (e) => toast.error(e.message),
  });

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-purple-950 to-purple-900 flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-purple-400 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-purple-950 to-purple-900 flex flex-col items-center justify-center px-6 text-center">
        <Briefcase className="w-12 h-12 text-purple-400 mb-4" />
        <h2 className="text-xl font-bold text-white mb-2">No Broker Profile Found</h2>
        <p className="text-purple-300 text-sm mb-6">Complete the broker onboarding to access your dashboard.</p>
        <Button onClick={() => navigate("/broker-onboarding")} className="bg-purple-500 hover:bg-purple-400 text-white">
          Start Onboarding
        </Button>
      </div>
    );
  }

  const kycInfo = KYC_BADGE[profile.kycStatus] ?? KYC_BADGE.PENDING;
  const KycIcon = kycInfo.icon;

  return (
    <div className="min-h-screen bg-gradient-to-b from-purple-950 to-purple-900 text-white pb-24">
      {/* Header */}
      <div className="px-4 pt-10 pb-6">
        <div className="flex items-center justify-between mb-1">
          <h1 className="text-2xl font-bold">Broker Dashboard</h1>
          <Badge className={kycInfo.color + " flex items-center gap-1"}>
            <KycIcon className="w-3 h-3" />
            {kycInfo.label}
          </Badge>
        </div>
        <p className="text-purple-300 text-sm">{profile.firmName}</p>
      </div>

      {/* Live Price Ticker — real-time WebSocket feed */}
      <WatchlistTickerFilter />
      <div className="px-4 space-y-4">
        {/* KYC Status Alert */}
        {profile.kycStatus !== "APPROVED" && (
          <Card className="bg-yellow-900/30 border-yellow-700">
            <CardContent className="p-4 flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-yellow-400 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-yellow-200 text-sm font-medium">
                  {profile.kycStatus === "PENDING" ? "KYC Not Submitted" : profile.kycStatus === "UNDER_REVIEW" ? "KYC Under Review" : "KYC Rejected"}
                </p>
                <p className="text-yellow-400 text-xs mt-0.5">
                  {profile.kycStatus === "PENDING"
                    ? "Submit your regulatory documents to activate your broker account."
                    : profile.kycStatus === "UNDER_REVIEW"
                    ? "Your documents are being reviewed. Approval takes 2–5 business days."
                    : `Reason: ${profile.kycNotes ?? "Please resubmit with correct documents."}`}
                </p>
                {profile.kycStatus === "PENDING" && (
                  <button onClick={() => navigate("/broker-onboarding")} className="text-yellow-300 text-xs underline mt-1">
                    Complete KYC →
                  </button>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Firm Summary */}
        <Card className="bg-purple-800/30 border-purple-700">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-purple-300 font-medium">Firm Summary</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <p className="text-xs text-purple-400">RC Number</p>
                <p className="text-sm font-medium text-white">{profile.rcNumber ?? "—"}</p>
              </div>
              <div>
                <p className="text-xs text-purple-400">State</p>
                <p className="text-sm font-medium text-white">{profile.state ?? "—"}</p>
              </div>
              <div>
                <p className="text-xs text-purple-400">Commission Rate</p>
                <p className="text-sm font-medium text-white">
                  {profile.commissionRate ? `${parseFloat(profile.commissionRate).toFixed(2)}%` : "—"}
                </p>
              </div>
              <div>
                <p className="text-xs text-purple-400">Account Status</p>
                <p className={`text-sm font-medium ${profile.accountStatus === "ACTIVE" ? "text-green-400" : "text-gray-400"}`}>
                  {profile.accountStatus}
                </p>
              </div>
              <div>
                <p className="text-xs text-purple-400">Years Operating</p>
                <p className="text-sm font-medium text-white">{profile.yearsInOperation ?? "—"}</p>
              </div>
              <div>
                <p className="text-xs text-purple-400">Client Book Size</p>
                <p className="text-sm font-medium text-white">{profile.clientBookSize ?? "—"}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Regulatory Info */}
        {(profile.secLicenseNumber || profile.cbnLicenseNumber) && (
          <Card className="bg-purple-800/30 border-purple-700">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-purple-300 font-medium">Regulatory Licenses</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {profile.secLicenseNumber && (
                <div className="flex items-center gap-2">
                  <Shield className="w-4 h-4 text-purple-400" />
                  <div>
                    <p className="text-xs text-purple-400">SEC License</p>
                    <p className="text-sm text-white">{profile.secLicenseNumber}</p>
                  </div>
                </div>
              )}
              {profile.cbnLicenseNumber && (
                <div className="flex items-center gap-2">
                  <Shield className="w-4 h-4 text-purple-400" />
                  <div>
                    <p className="text-xs text-purple-400">CBN License</p>
                    <p className="text-sm text-white">{profile.cbnLicenseNumber}</p>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Edit Profile Button */}
        <button
          onClick={() => {
            setEditForm({
              contactPhone: profile.contactPhone ?? "",
              contactEmail: profile.contactEmail ?? "",
              commissionRate: profile.commissionRate ? String(profile.commissionRate) : "",
            });
            setEditOpen(true);
          }}
          className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg bg-purple-700/40 hover:bg-purple-600/40 border border-purple-600 text-sm text-purple-200 transition-colors"
        >
          <Pencil className="w-4 h-4" />
          Edit Profile
        </button>

        {/* Quick Actions */}
        <Card className="bg-purple-800/30 border-purple-700">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-purple-300 font-medium">Quick Actions</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {[
              { label: "Commission Dashboard", icon: Wallet, path: "/broker/commissions" },
              { label: "View Order Book", icon: BarChart3, path: "/order-book" },
              { label: "Portfolio Analytics", icon: Wallet, path: "/portfolio-analytics" },
              { label: "Market Overview", icon: Building2, path: "/market" },
            ].map(({ label, icon: Icon, path }) => (
              <button
                key={label}
                onClick={() => navigate(path)}
                className="w-full flex items-center justify-between p-3 rounded-lg bg-purple-800/40 hover:bg-purple-700/40 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <Icon className="w-4 h-4 text-purple-400" />
                  <span className="text-sm text-white">{label}</span>
                </div>
                <ChevronRight className="w-4 h-4 text-purple-500" />
              </button>
            ))}
          </CardContent>
        </Card>
      </div>

      {/* Edit Profile Dialog */}
      <Dialog open={editOpen} onOpenChange={(open) => { setEditOpen(open); if (!open) setKycReset(false); }}>
        <DialogContent className="bg-purple-950 border-purple-700 text-white max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-white">Edit Broker Profile</DialogTitle>
          </DialogHeader>
          {!kycReset ? (
            <>
              <div className="space-y-4 py-2">
                <div>
                  <Label className="text-purple-300 text-xs">Contact Phone</Label>
                  <Input value={editForm.contactPhone} onChange={e => setEditForm(f => ({ ...f, contactPhone: e.target.value }))} placeholder="+234 800 000 0000" className="bg-purple-900 border-purple-700 text-white mt-1" />
                </div>
                <div>
                  <Label className="text-purple-300 text-xs">Contact Email</Label>
                  <Input value={editForm.contactEmail} onChange={e => setEditForm(f => ({ ...f, contactEmail: e.target.value }))} placeholder="broker@firm.com" className="bg-purple-900 border-purple-700 text-white mt-1" />
                </div>
                <div>
                  <Label className="text-purple-300 text-xs">Commission Rate (%)</Label>
                  <Input value={editForm.commissionRate} onChange={e => setEditForm(f => ({ ...f, commissionRate: e.target.value }))} placeholder="0.25" className="bg-purple-900 border-purple-700 text-white mt-1" />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setEditOpen(false)} className="border-purple-700 text-purple-300">Cancel</Button>
                <Button
                  onClick={() => updateProfile.mutate({
                    contactPhone: editForm.contactPhone || undefined,
                    contactEmail: editForm.contactEmail || undefined,
                    commissionRate: editForm.commissionRate ? parseFloat(editForm.commissionRate) : undefined,
                  })}
                  disabled={updateProfile.isPending}
                  className="bg-purple-500 hover:bg-purple-400 text-white"
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
                    <p className="text-yellow-400 text-xs mt-0.5">Your profile changes require a fresh KYC review. Please re-submit your license documents.</p>
                  </div>
                </div>
              </div>
              <div className="space-y-4 py-2">
                <div>
                  <Label className="text-purple-300 text-xs">SEC License Number <span className="text-red-400">*</span></Label>
                  <Input value={docForm.secLicenseNumber} onChange={e => setDocForm(f => ({ ...f, secLicenseNumber: e.target.value }))} placeholder="SEC/REG/2024/001" className="bg-purple-900 border-purple-700 text-white mt-1" />
                </div>
                <div>
                  <Label className="text-purple-300 text-xs">Regulatory Body <span className="text-red-400">*</span></Label>
                  <Input value={docForm.regulatoryBody} onChange={e => setDocForm(f => ({ ...f, regulatoryBody: e.target.value }))} placeholder="SEC Nigeria" className="bg-purple-900 border-purple-700 text-white mt-1" />
                </div>
                <div>
                  <Label className="text-purple-300 text-xs">SEC Certificate <span className="text-red-400">*</span></Label>
                  <input ref={secCertRef} type="file" accept="application/pdf,image/*" className="hidden" onChange={e => e.target.files?.[0] && handleFileUpload("secCertificateUrl", e.target.files[0])} />
                  <div className="flex items-center gap-2 mt-1">
                    <Button type="button" variant="outline" size="sm" onClick={() => secCertRef.current?.click()} disabled={uploading["secCertificateUrl"]} className="border-purple-700 text-purple-300 bg-transparent">
                      {uploading["secCertificateUrl"] ? "Uploading..." : "Choose File"}
                    </Button>
                    {uploadedUrls["secCertificateUrl"] && <span className="text-green-400 text-xs flex items-center gap-1"><CheckCircle2 className="w-3 h-3" /> Uploaded</span>}
                  </div>
                </div>
                <div>
                  <Label className="text-purple-300 text-xs">CBN License Number (optional)</Label>
                  <Input value={docForm.cbnLicenseNumber} onChange={e => setDocForm(f => ({ ...f, cbnLicenseNumber: e.target.value }))} placeholder="CBN/LIC/2024/001" className="bg-purple-900 border-purple-700 text-white mt-1" />
                </div>
                <div>
                  <Label className="text-purple-300 text-xs">CBN Approval Document (optional)</Label>
                  <input ref={cbnApprovalRef} type="file" accept="application/pdf,image/*" className="hidden" onChange={e => e.target.files?.[0] && handleFileUpload("cbnApprovalUrl", e.target.files[0])} />
                  <div className="flex items-center gap-2 mt-1">
                    <Button type="button" variant="outline" size="sm" onClick={() => cbnApprovalRef.current?.click()} disabled={uploading["cbnApprovalUrl"]} className="border-purple-700 text-purple-300 bg-transparent">
                      {uploading["cbnApprovalUrl"] ? "Uploading..." : "Choose File"}
                    </Button>
                    {uploadedUrls["cbnApprovalUrl"] && <span className="text-green-400 text-xs flex items-center gap-1"><CheckCircle2 className="w-3 h-3" /> Uploaded</span>}
                  </div>
                </div>
                <div>
                  <Label className="text-purple-300 text-xs">CAC Document (optional)</Label>
                  <input ref={cacDocRef} type="file" accept="application/pdf,image/*" className="hidden" onChange={e => e.target.files?.[0] && handleFileUpload("cacDocUrl", e.target.files[0])} />
                  <div className="flex items-center gap-2 mt-1">
                    <Button type="button" variant="outline" size="sm" onClick={() => cacDocRef.current?.click()} disabled={uploading["cacDocUrl"]} className="border-purple-700 text-purple-300 bg-transparent">
                      {uploading["cacDocUrl"] ? "Uploading..." : "Choose File"}
                    </Button>
                    {uploadedUrls["cacDocUrl"] && <span className="text-green-400 text-xs flex items-center gap-1"><CheckCircle2 className="w-3 h-3" /> Uploaded</span>}
                  </div>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => { setEditOpen(false); setKycReset(false); }} className="border-purple-700 text-purple-300">Cancel</Button>
                <Button
                  onClick={() => submitKyc.mutate({
                    secLicenseNumber: docForm.secLicenseNumber,
                    regulatoryBody: docForm.regulatoryBody,
                    secCertificateUrl: uploadedUrls["secCertificateUrl"] ?? "",
                    cbnLicenseNumber: docForm.cbnLicenseNumber || undefined,
                    cbnApprovalUrl: uploadedUrls["cbnApprovalUrl"] || undefined,
                    cacDocUrl: uploadedUrls["cacDocUrl"] || undefined,
                  })}
                  disabled={submitKyc.isPending || !docForm.secLicenseNumber || !docForm.regulatoryBody || !uploadedUrls["secCertificateUrl"]}
                  className="bg-yellow-600 hover:bg-yellow-500 text-white"
                >
                  {submitKyc.isPending ? "Submitting..." : "Re-submit for Review"}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Push Notification Settings */}
      <div className="px-4 pb-4">
        <PushNotificationSettings compact />
      </div>

      {/* Bottom Nav */}
      <nav className="fixed bottom-0 left-0 right-0 bg-purple-950 border-t border-purple-800 flex">
        {[
          { icon: Home, label: "Home", path: "/" },
          { icon: BarChart3, label: "Markets", path: "/market" },
          { icon: Star, label: "Watchlist", path: "/watchlist" },
          { icon: Briefcase, label: "Broker", path: "/broker-dashboard", active: true },
          { icon: Settings, label: "Settings", path: "/settings" },
        ].map(({ icon: Icon, label, path, active }) => (
          <button
            key={label}
            onClick={() => navigate(path)}
            className={`flex-1 flex flex-col items-center py-3 gap-0.5 text-xs transition-colors ${
              active ? "text-purple-400" : "text-purple-600 hover:text-purple-400"
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
