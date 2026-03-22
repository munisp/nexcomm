import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  TrendingUp,
  User,
  BarChart3,
  Clock,
  CheckCircle2,
  AlertCircle,
  XCircle,
  ChevronRight,
  Home,
  Wallet,
  Settings,
  Pencil,
  Upload,
  FileText,
  Activity,
  DollarSign,
  ShieldOff,
  Star,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { useState, useRef } from "react";
import PushNotificationSettings from "@/pages/PushNotificationSettings";
import { WatchlistTickerFilter } from "@/components/WatchlistTickerFilter";

// ─── Margin Health Indicator ─────────────────────────────────────────────────
function MarginHealthIndicator({ onNavigate }: { onNavigate: (path: string) => void }) {
  const utils = trpc.useUtils();
  const { data: marginStatus } = trpc.margin.getAlertStatus.useQuery(undefined, {
    refetchInterval: 30_000,
  });
  const { data: marginSummary } = trpc.margin.getSummary.useQuery(undefined, {
    refetchInterval: 60_000,
  });
  const triggerMarginCall = trpc.margin.triggerMarginCall.useMutation({
    onSuccess: (data) => {
      toast.success(data.message);
      utils.margin.getAlertStatus.invalidate();
      utils.margin.getSummary.invalidate();
    },
    onError: (err) => toast.error(`Margin call failed: ${err.message}`),
  });

  if (!marginStatus) return null;
  const { level, utilisationPct } = marginStatus;
  if (level === "OK") return null;

  const config = {
    WARNING: {
      bg: "bg-yellow-900/40 border-yellow-600",
      iconColor: "text-yellow-400",
      title: "Margin Warning",
      titleColor: "text-yellow-200",
      desc: "Margin utilisation is approaching the call level. Consider adding collateral.",
      barColor: "bg-yellow-400",
    },
    CRITICAL: {
      bg: "bg-red-900/50 border-red-600",
      iconColor: "text-red-400",
      title: "Margin Call Active",
      titleColor: "text-red-200",
      desc: "Critical margin utilisation. Deposit collateral or reduce positions immediately.",
      barColor: "bg-red-500",
    },
    LIQUIDATED: {
      bg: "bg-red-950/70 border-red-800",
      iconColor: "text-red-300",
      title: "Account Liquidated",
      titleColor: "text-red-100",
      desc: "Your margin account has been liquidated. Contact support to reinstate.",
      barColor: "bg-red-700",
    },
  } as const;

  const cfg = config[level as keyof typeof config];
  if (!cfg) return null;

  return (
    <Card className={`border ${cfg.bg}`}>
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          <AlertCircle className={`w-5 h-5 ${cfg.iconColor} flex-shrink-0 mt-0.5`} />
          <div className="flex-1 min-w-0">
            <p className={`text-sm font-semibold ${cfg.titleColor}`}>{cfg.title}</p>
            <p className="text-xs text-gray-400 mt-0.5">{cfg.desc}</p>
            <div className="mt-2">
              <div className="flex justify-between text-xs text-gray-400 mb-1">
                <span>Margin Utilisation</span>
                <span>{utilisationPct.toFixed(1)}%</span>
              </div>
              <div className="w-full bg-gray-700 rounded-full h-2">
                <div
                  className={`h-2 rounded-full transition-all ${cfg.barColor}`}
                  style={{ width: `${Math.min(100, utilisationPct)}%` }}
                />
              </div>
            </div>
            {marginSummary && (
              <div className="grid grid-cols-2 gap-2 mt-3 text-xs">
                <div>
                  <p className="text-gray-400">Available Margin</p>
                  <p className="text-white font-medium">
                    {Number(marginSummary.availableMargin).toLocaleString("en-NG", { style: "currency", currency: "NGN", maximumFractionDigits: 0 })}
                  </p>
                </div>
                <div>
                  <p className="text-gray-400">Total Collateral</p>
                  <p className="text-white font-medium">
                    {Number(marginSummary.totalCollateral).toLocaleString("en-NG", { style: "currency", currency: "NGN", maximumFractionDigits: 0 })}
                  </p>
                </div>
              </div>
            )}
            {level !== "LIQUIDATED" && (
              <div className="flex gap-2 mt-3">
                <Button
                  size="sm"
                  variant="outline"
                  className="text-xs border-gray-600 text-gray-300 flex-1 bg-transparent"
                  onClick={() => triggerMarginCall.mutate({ reason: "Acknowledged from Trader Dashboard", deadlineMinutes: 60 })}
                  disabled={triggerMarginCall.isPending}
                >
                  {triggerMarginCall.isPending ? "Processing..." : "Acknowledge & Start Workflow"}
                </Button>
                <Button
                  size="sm"
                  className="text-xs bg-blue-600 hover:bg-blue-700 flex-1"
                  onClick={() => onNavigate("/margin")}
                >
                  Manage Collateral
                </Button>
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

const KYC_BADGE: Record<string, { label: string; color: string; icon: React.ElementType }> = {
  PENDING: { label: "Pending", color: "bg-gray-700 text-gray-200", icon: Clock },
  UNDER_REVIEW: { label: "Under Review", color: "bg-yellow-700 text-yellow-200", icon: Clock },
  APPROVED: { label: "Approved", color: "bg-green-700 text-green-200", icon: CheckCircle2 },
  REJECTED: { label: "Rejected", color: "bg-red-700 text-red-200", icon: XCircle },
};

type DocId = "idDocumentUrl" | "proofOfAddressUrl" | "bankStatementUrl";

const DOC_FIELDS: { id: DocId; label: string; required: boolean }[] = [
  { id: "idDocumentUrl", label: "Government ID (NIN Slip / Int'l Passport)", required: true },
  { id: "proofOfAddressUrl", label: "Proof of Address (Utility Bill)", required: true },
  { id: "bankStatementUrl", label: "Bank Statement (last 3 months)", required: true },
];

export default function TraderDashboard() {
  const [, navigate] = useLocation();
  const utils = trpc.useUtils();

  const { data: profile, isLoading } = trpc.trader.getMyTraderProfile.useQuery();
  const { data: dashboard } = trpc.trader.getTraderDashboard.useQuery(undefined, {
    enabled: !!profile,
  });

  const [editOpen, setEditOpen] = useState(false);
  const [kycReset, setKycReset] = useState(false);
  const [deactivateOpen, setDeactivateOpen] = useState(false);
  const [editForm, setEditForm] = useState({
    tradingExperience: "",
    riskProfile: "",
    capitalRange: "",
  });

  // File upload state per doc
  const [uploading, setUploading] = useState<Record<DocId, boolean>>({
    idDocumentUrl: false,
    proofOfAddressUrl: false,
    bankStatementUrl: false,
  });
  const [uploadedUrls, setUploadedUrls] = useState<Record<DocId, string>>({
    idDocumentUrl: "",
    proofOfAddressUrl: "",
    bankStatementUrl: "",
  });
  const fileRefs = {
    idDocumentUrl: useRef<HTMLInputElement>(null),
    proofOfAddressUrl: useRef<HTMLInputElement>(null),
    bankStatementUrl: useRef<HTMLInputElement>(null),
  };

  const uploadDoc = trpc.trader.uploadKycDocument.useMutation({
    onError: (e) => toast.error(`Upload failed: ${e.message}`),
  });

  const updateProfile = trpc.trader.updateMyTraderProfile.useMutation({
    onSuccess: (data) => {
      if (data.kycResetDueToChange) {
        setKycReset(true);
        setUploadedUrls({ idDocumentUrl: "", proofOfAddressUrl: "", bankStatementUrl: "" });
        toast.warning("Profile updated — KYC reset to PENDING. Please re-upload your documents.");
      } else {
        toast.success("Profile updated successfully");
        setEditOpen(false);
        utils.trader.getMyTraderProfile.invalidate();
      }
    },
    onError: (e) => toast.error(e.message),
  });

  const submitKyc = trpc.trader.submitTraderKYC.useMutation({
    onSuccess: () => {
      toast.success("Documents submitted for review");
      setEditOpen(false);
      setKycReset(false);
      utils.trader.getMyTraderProfile.invalidate();
      utils.trader.getTraderDashboard.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const deactivateAccount = trpc.trader.updateMyTraderProfile.useMutation({
    onSuccess: () => {
      toast.success("Account deactivated. Contact support to reactivate.");
      setDeactivateOpen(false);
      utils.trader.getMyTraderProfile.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const handleFileSelect = async (docId: DocId, file: File) => {
    if (file.size > 10 * 1024 * 1024) {
      toast.error("File must be under 10 MB");
      return;
    }
    setUploading((u) => ({ ...u, [docId]: true }));
    try {
      const base64Data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const result = reader.result as string;
          // Strip the data URL prefix (e.g. "data:application/pdf;base64,")
          resolve(result.split(",")[1]);
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      const result = await uploadDoc.mutateAsync({
        docId,
        fileName: file.name,
        mimeType: file.type,
        base64Data,
      });
      setUploadedUrls((u) => ({ ...u, [docId]: result.url }));
      toast.success(`${file.name} uploaded successfully`);
    } catch {
      // error already shown by onError
    } finally {
      setUploading((u) => ({ ...u, [docId]: false }));
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-blue-950 to-blue-900 flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-blue-950 to-blue-900 flex flex-col items-center justify-center px-6 text-center">
        <TrendingUp className="w-12 h-12 text-blue-400 mb-4" />
        <h2 className="text-xl font-bold text-white mb-2">No Trader Profile Found</h2>
        <p className="text-blue-300 text-sm mb-6">
          Complete the trader onboarding to access your dashboard.
        </p>
        <Button
          onClick={() => navigate("/trader-onboarding")}
          className="bg-blue-500 hover:bg-blue-400 text-white"
        >
          Start Onboarding
        </Button>
      </div>
    );
  }

  const kycInfo = KYC_BADGE[profile.kycStatus] ?? KYC_BADGE.PENDING;
  const KycIcon = kycInfo.icon;
  const allDocsUploaded = DOC_FIELDS.every((f) => !f.required || uploadedUrls[f.id]);

  return (
    <div className="min-h-screen bg-gradient-to-b from-blue-950 to-blue-900 text-white pb-24">
      {/* Header */}
      <div className="px-4 pt-10 pb-6">
        <div className="flex items-center justify-between mb-1">
          <h1 className="text-2xl font-bold">Trader Dashboard</h1>
          <Badge className={kycInfo.color + " flex items-center gap-1"}>
            <KycIcon className="w-3 h-3" />
            {kycInfo.label}
          </Badge>
        </div>
        <p className="text-blue-300 text-sm">{profile.fullName}</p>
      </div>

      <div className="px-4 space-y-4">
        {/* KYC Status Banner */}
        {profile.kycStatus !== "APPROVED" && (
          <Card className="bg-yellow-900/30 border-yellow-700">
            <CardContent className="p-4 flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-yellow-400 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-yellow-200 text-sm font-medium">
                  {profile.kycStatus === "PENDING"
                    ? "KYC Not Submitted"
                    : profile.kycStatus === "UNDER_REVIEW"
                    ? "KYC Under Review"
                    : "KYC Rejected"}
                </p>
                <p className="text-yellow-400 text-xs mt-0.5">
                  {profile.kycStatus === "PENDING"
                    ? "Submit your KYC documents to activate trading."
                    : profile.kycStatus === "UNDER_REVIEW"
                    ? "Your documents are being reviewed. Approval takes 1–3 business days."
                    : `Reason: ${profile.kycNotes ?? "Please resubmit with correct documents."}`}
                </p>
                {(profile.kycStatus === "PENDING" || profile.kycStatus === "REJECTED") && (
                  <button
                    onClick={() => { setKycReset(true); setEditOpen(true); }}
                    className="text-yellow-300 text-xs underline mt-1"
                  >
                    Upload Documents →
                  </button>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Live Price Ticker — real-time WebSocket feed from /ws/orderbook */}
        <WatchlistTickerFilter className="-mx-4 mb-3" />
        {/* Margin Health Indicator — only visible when WARNING/CRITICAL/LIQUIDATED */}
        <MarginHealthIndicator onNavigate={navigate} />

        {/* Dashboard Stats */}
        {dashboard && (
          <div className="grid grid-cols-3 gap-3">
            <Card className="bg-blue-800/30 border-blue-700">
              <CardContent className="p-3 text-center">
                <Activity className="w-5 h-5 text-blue-400 mx-auto mb-1" />
                <p className="text-lg font-bold text-white">{dashboard.activeOrders ?? 0}</p>
                <p className="text-xs text-blue-400">Active Orders</p>
              </CardContent>
            </Card>
            <Card className="bg-blue-800/30 border-blue-700">
              <CardContent className="p-3 text-center">
                <BarChart3 className="w-5 h-5 text-green-400 mx-auto mb-1" />
                <p className="text-lg font-bold text-white">
                  {Number(dashboard.totalVolume ?? 0).toLocaleString("en-NG", {
                    style: "currency",
                    currency: "NGN",
                    maximumFractionDigits: 0,
                  })}
                </p>
                <p className="text-xs text-blue-400">Total Volume</p>
              </CardContent>
            </Card>
            <Card className="bg-blue-800/30 border-blue-700">
              <CardContent className="p-3 text-center">
                <DollarSign className="w-5 h-5 text-yellow-400 mx-auto mb-1" />
                <p className="text-lg font-bold text-white">
                  {Number(dashboard.unrealisedPnl ?? 0).toLocaleString("en-NG", {
                    style: "currency",
                    currency: "NGN",
                    maximumFractionDigits: 0,
                  })}
                </p>
                <p className="text-xs text-blue-400">Unrealised P&L</p>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Profile Summary */}
        <Card className="bg-blue-800/30 border-blue-700">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-blue-300 font-medium">Profile Summary</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <p className="text-xs text-blue-400">Experience</p>
                <p className="text-sm font-medium text-white">{profile.tradingExperience}</p>
              </div>
              <div>
                <p className="text-xs text-blue-400">Risk Profile</p>
                <p className="text-sm font-medium text-white">{profile.riskProfile}</p>
              </div>
              <div>
                <p className="text-xs text-blue-400">Capital Range</p>
                <p className="text-sm font-medium text-white">{profile.capitalRange ?? "—"}</p>
              </div>
              <div>
                <p className="text-xs text-blue-400">Account Status</p>
                <p
                  className={`text-sm font-medium ${
                    profile.accountStatus === "ACTIVE" ? "text-green-400" : "text-gray-400"
                  }`}
                >
                  {profile.accountStatus}
                </p>
              </div>
            </div>
            {profile.preferredMarkets && profile.preferredMarkets.length > 0 && (
              <div>
                <p className="text-xs text-blue-400 mb-1">Preferred Markets</p>
                <div className="flex flex-wrap gap-1">
                  {profile.preferredMarkets.map((m: string) => (
                    <Badge key={m} className="bg-blue-700 text-blue-200 text-xs">
                      {m}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* KYC Documents */}
        {profile.kycStatus === "APPROVED" && (
          <Card className="bg-blue-800/30 border-blue-700">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-blue-300 font-medium">KYC Documents</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {DOC_FIELDS.map(({ id, label }) => (
                <div key={id} className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <FileText className="w-4 h-4 text-blue-400" />
                    <span className="text-xs text-blue-200">{label}</span>
                  </div>
                  {(profile as Record<string, unknown>)[id] ? (
                    <a
                      href={(profile as Record<string, unknown>)[id] as string}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-blue-400 underline"
                    >
                      View
                    </a>
                  ) : (
                    <span className="text-xs text-gray-500">Not uploaded</span>
                  )}
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        {/* Edit Profile Button */}
        <button
          onClick={() => {
            setEditForm({
              tradingExperience: profile.tradingExperience ?? "",
              riskProfile: profile.riskProfile ?? "",
              capitalRange: profile.capitalRange ?? "",
            });
            setKycReset(false);
            setUploadedUrls({ idDocumentUrl: "", proofOfAddressUrl: "", bankStatementUrl: "" });
            setEditOpen(true);
          }}
          className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg bg-blue-700/40 hover:bg-blue-600/40 border border-blue-600 text-sm text-blue-200 transition-colors"
        >
          <Pencil className="w-4 h-4" />
          Edit Profile
        </button>

        {/* Quick Actions */}
        <Card className="bg-blue-800/30 border-blue-700">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-blue-300 font-medium">Quick Actions</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {[
              { label: "Trade History", icon: Activity, path: "/trader/trade-history" },
              { label: "Open Orders", icon: Clock, path: "/trader/open-orders" },
              { label: "P\u0026L Summary", icon: DollarSign, path: "/trader/pnl" },
              { label: "View Order Book", icon: BarChart3, path: "/order-book" },
              { label: "My Portfolio", icon: Wallet, path: "/portfolio-analytics" },
              { label: "Market Prices", icon: TrendingUp, path: "/market" },
            ].map(({ label, icon: Icon, path }) => (
              <button
                key={label}
                onClick={() => navigate(path)}
                className="w-full flex items-center justify-between p-3 rounded-lg bg-blue-800/40 hover:bg-blue-700/40 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <Icon className="w-4 h-4 text-blue-400" />
                  <span className="text-sm text-white">{label}</span>
                </div>
                <ChevronRight className="w-4 h-4 text-blue-500" />
              </button>
            ))}
          </CardContent>
        </Card>

        {/* Bank Details */}
        {profile.bankName && (
          <Card className="bg-blue-800/30 border-blue-700">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-blue-300 font-medium">Bank Details</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="text-xs text-blue-400">Bank</p>
                  <p className="text-sm font-medium text-white">{profile.bankName}</p>
                </div>
                <div>
                  <p className="text-xs text-blue-400">Account</p>
                  <p className="text-sm font-medium text-white">
                    {profile.accountNumber
                      ? `****${profile.accountNumber.slice(-4)}`
                      : "—"}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Danger Zone */}
        <Card className="bg-red-950/30 border-red-800">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-red-400 font-medium">Danger Zone</CardTitle>
          </CardHeader>
          <CardContent>
            <button
              onClick={() => setDeactivateOpen(true)}
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg bg-red-900/40 hover:bg-red-800/40 border border-red-700 text-sm text-red-300 transition-colors"
            >
              <ShieldOff className="w-4 h-4" />
              Deactivate Account
            </button>
          </CardContent>
        </Card>
      </div>

      {/* Edit Profile / Upload Docs Dialog */}
      <Dialog
        open={editOpen}
        onOpenChange={(open) => {
          setEditOpen(open);
          if (!open) setKycReset(false);
        }}
      >
        <DialogContent className="bg-blue-950 border-blue-700 text-white max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-white">
              {kycReset ? "Re-upload KYC Documents" : "Edit Trader Profile"}
            </DialogTitle>
          </DialogHeader>

          {!kycReset ? (
            <>
              <div className="space-y-4 py-2">
                <div>
                  <Label className="text-blue-300 text-xs">Trading Experience</Label>
                  <Select
                    value={editForm.tradingExperience}
                    onValueChange={(v) => setEditForm((f) => ({ ...f, tradingExperience: v }))}
                  >
                    <SelectTrigger className="bg-blue-900 border-blue-700 text-white mt-1">
                      <SelectValue placeholder="Select experience" />
                    </SelectTrigger>
                    <SelectContent className="bg-blue-900 border-blue-700">
                      {["BEGINNER", "INTERMEDIATE", "EXPERIENCED", "PROFESSIONAL"].map((v) => (
                        <SelectItem key={v} value={v} className="text-white">
                          {v}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-blue-300 text-xs">Risk Profile</Label>
                  <Select
                    value={editForm.riskProfile}
                    onValueChange={(v) => setEditForm((f) => ({ ...f, riskProfile: v }))}
                  >
                    <SelectTrigger className="bg-blue-900 border-blue-700 text-white mt-1">
                      <SelectValue placeholder="Select risk profile" />
                    </SelectTrigger>
                    <SelectContent className="bg-blue-900 border-blue-700">
                      {["CONSERVATIVE", "MODERATE", "AGGRESSIVE"].map((v) => (
                        <SelectItem key={v} value={v} className="text-white">
                          {v}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-blue-300 text-xs">Capital Range (NGN)</Label>
                  <Input
                    value={editForm.capitalRange}
                    onChange={(e) =>
                      setEditForm((f) => ({ ...f, capitalRange: e.target.value }))
                    }
                    placeholder="e.g. 500,000 – 2,000,000"
                    className="bg-blue-900 border-blue-700 text-white mt-1"
                  />
                </div>
              </div>
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => setEditOpen(false)}
                  className="border-blue-700 text-blue-300"
                >
                  Cancel
                </Button>
                <Button
                  onClick={() =>
                    updateProfile.mutate({
                      tradingExperience:
                        (editForm.tradingExperience as
                          | "BEGINNER"
                          | "INTERMEDIATE"
                          | "EXPERIENCED"
                          | "PROFESSIONAL") || undefined,
                      riskProfile:
                        (editForm.riskProfile as
                          | "CONSERVATIVE"
                          | "MODERATE"
                          | "AGGRESSIVE") || undefined,
                      capitalRange: editForm.capitalRange || undefined,
                    })
                  }
                  disabled={updateProfile.isPending}
                  className="bg-blue-500 hover:bg-blue-400 text-white"
                >
                  {updateProfile.isPending ? "Saving..." : "Save Changes"}
                </Button>
              </DialogFooter>
            </>
          ) : (
            <>
              <div className="bg-yellow-900/30 border border-yellow-700 rounded-lg p-3 mb-2">
                <div className="flex items-start gap-2">
                  <Upload className="w-4 h-4 text-yellow-400 mt-0.5 flex-shrink-0" />
                  <div>
                    <p className="text-yellow-200 text-sm font-medium">
                      KYC Reset — Re-upload Required
                    </p>
                    <p className="text-yellow-400 text-xs mt-0.5">
                      Upload your documents below. Each file is uploaded directly to secure
                      storage — no URL needed.
                    </p>
                  </div>
                </div>
              </div>

              <div className="space-y-4 py-2">
                {DOC_FIELDS.map(({ id, label, required }) => (
                  <div key={id}>
                    <Label className="text-blue-300 text-xs">
                      {label}{" "}
                      {required && <span className="text-red-400">*</span>}
                    </Label>
                    {/* Hidden file input */}
                    <input
                      ref={fileRefs[id]}
                      type="file"
                      accept=".pdf,.jpg,.jpeg,.png"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) handleFileSelect(id, file);
                      }}
                    />
                    <div className="mt-1 flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => fileRefs[id].current?.click()}
                        disabled={uploading[id]}
                        className="flex items-center gap-2 px-3 py-2 rounded-lg bg-blue-800 hover:bg-blue-700 border border-blue-600 text-xs text-blue-200 transition-colors disabled:opacity-50"
                      >
                        {uploading[id] ? (
                          <>
                            <div className="w-3 h-3 border border-blue-400 border-t-transparent rounded-full animate-spin" />
                            Uploading…
                          </>
                        ) : (
                          <>
                            <Upload className="w-3 h-3" />
                            Choose File
                          </>
                        )}
                      </button>
                      {uploadedUrls[id] ? (
                        <span className="text-xs text-green-400 flex items-center gap-1">
                          <CheckCircle2 className="w-3 h-3" /> Uploaded
                        </span>
                      ) : (
                        <span className="text-xs text-gray-500">No file chosen</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => {
                    setEditOpen(false);
                    setKycReset(false);
                  }}
                  className="border-blue-700 text-blue-300"
                >
                  Cancel
                </Button>
                <Button
                  onClick={() =>
                    submitKyc.mutate({
                      idDocumentUrl: uploadedUrls.idDocumentUrl,
                      proofOfAddressUrl: uploadedUrls.proofOfAddressUrl,
                      bankStatementUrl: uploadedUrls.bankStatementUrl,
                    })
                  }
                  disabled={submitKyc.isPending || !allDocsUploaded}
                  className="bg-yellow-600 hover:bg-yellow-500 text-white"
                >
                  {submitKyc.isPending ? "Submitting..." : "Submit for Review"}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Deactivate Confirm Dialog */}
      <Dialog open={deactivateOpen} onOpenChange={setDeactivateOpen}>
        <DialogContent className="bg-blue-950 border-red-800 text-white">
          <DialogHeader>
            <DialogTitle className="text-red-400">Deactivate Account</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-blue-300 py-2">
            This will set your account status to INACTIVE. You will lose access to trading
            until you contact support to reactivate. Are you sure?
          </p>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDeactivateOpen(false)}
              className="border-blue-700 text-blue-300"
            >
              Cancel
            </Button>
            <Button
              onClick={() => deactivateAccount.mutate({ accountStatus: "INACTIVE" } as Parameters<typeof deactivateAccount.mutate>[0])}
              disabled={deactivateAccount.isPending}
              className="bg-red-700 hover:bg-red-600 text-white"
            >
              {deactivateAccount.isPending ? "Deactivating..." : "Confirm Deactivate"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Push Notification Settings */}
      <div className="px-4 pb-4">
        <PushNotificationSettings compact />
      </div>

      {/* Bottom Nav */}
      <nav className="fixed bottom-0 left-0 right-0 bg-blue-950 border-t border-blue-800 flex">
        {[
          { icon: Home, label: "Home", path: "/" },
          { icon: TrendingUp, label: "Markets", path: "/market" },
          { icon: Star, label: "Watchlist", path: "/watchlist" },
          { icon: User, label: "Profile", path: "/trader-dashboard", active: true },
          { icon: Settings, label: "Settings", path: "/settings" },
        ].map(({ icon: Icon, label, path, active }) => (
          <button
            key={label}
            onClick={() => navigate(path)}
            className={`flex-1 flex flex-col items-center py-3 gap-0.5 text-xs transition-colors ${
              active ? "text-blue-400" : "text-blue-600 hover:text-blue-400"
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
