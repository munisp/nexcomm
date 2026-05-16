import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
  ChevronLeft,
  Home,
  Wallet,
  Settings,
  Building2,
  Pencil,
  Upload,
  Star,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Search,
  Filter,
  X,
} from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { useState, useRef, useMemo } from "react";
import PushNotificationSettings from "@/pages/PushNotificationSettings";
import { WatchlistTickerFilter } from "@/components/WatchlistTickerFilter";
import { PageSkeleton } from "@/components/PageSkeleton";

const KYC_BADGE: Record<string, { label: string; color: string; icon: React.ElementType }> = {
  PENDING: { label: "Pending", color: "bg-gray-700 text-gray-200", icon: Clock },
  UNDER_REVIEW: { label: "Under Review", color: "bg-yellow-700 text-yellow-200", icon: Clock },
  APPROVED: { label: "Approved", color: "bg-green-700 text-green-200", icon: CheckCircle2 },
  REJECTED: { label: "Rejected", color: "bg-red-700 text-red-200", icon: XCircle },
};

type SortBy = "createdAt" | "fillPrice" | "filledQty" | "grossValue";
type SortDir = "asc" | "desc";

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

  // ── Transaction filter/sort state ──────────────────────────────────────────
  const [txPage, setTxPage] = useState(1);
  const [txSymbol, setTxSymbol] = useState("");
  const [txAssetClass, setTxAssetClass] = useState("all");
  const [txSide, setTxSide] = useState<"all" | "BUY" | "SELL">("all");
  const [txSortBy, setTxSortBy] = useState<SortBy>("createdAt");
  const [txSortDir, setTxSortDir] = useState<SortDir>("desc");
  const [symbolInput, setSymbolInput] = useState("");

  const txQueryInput = useMemo(() => ({
    page: txPage,
    pageSize: 10,
    symbol: txSymbol || undefined,
    assetClass: txAssetClass === "all" ? undefined : txAssetClass,
    side: txSide === "all" ? undefined : txSide,
    sortBy: txSortBy,
    sortDir: txSortDir,
  }), [txPage, txSymbol, txAssetClass, txSide, txSortBy, txSortDir]);

  const txQuery = trpc.broker.getMyTradeHistory.useQuery(txQueryInput);

  function toggleSort(col: SortBy) {
    if (txSortBy === col) {
      setTxSortDir(d => d === "asc" ? "desc" : "asc");
    } else {
      setTxSortBy(col);
      setTxSortDir("desc");
    }
    setTxPage(1);
  }

  function SortIcon({ col }: { col: SortBy }) {
    if (txSortBy !== col) return <ArrowUpDown className="w-3 h-3 ml-1 opacity-40" />;
    return txSortDir === "asc"
      ? <ArrowUp className="w-3 h-3 ml-1 text-purple-300" />
      : <ArrowDown className="w-3 h-3 ml-1 text-purple-300" />;
  }

  function applySymbolFilter() {
    setTxSymbol(symbolInput.trim().toUpperCase());
    setTxPage(1);
  }

  function clearFilters() {
    setTxSymbol("");
    setSymbolInput("");
    setTxAssetClass("all");
    setTxSide("all");
    setTxSortBy("createdAt");
    setTxSortDir("desc");
    setTxPage(1);
  }

  const hasActiveFilters = txSymbol || txAssetClass !== "all" || txSide !== "all";

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

  type BrokerProfile = { id: number; userId: number; firmName: string; kycStatus: string; kycNotes?: string | null; rcNumber?: string | null; state?: string | null; commissionRate?: string | number | null; accountStatus?: string | null; yearsInOperation?: string | number | null; clientBookSize?: string | number | null; secLicenseNumber?: string | null; cbnLicenseNumber?: string | null; contactPhone?: string | null; contactEmail?: string | null };
  const typedProfile = profile as BrokerProfile;
  const kycInfo = KYC_BADGE[typedProfile.kycStatus] ?? KYC_BADGE.PENDING;
  const KycIcon = kycInfo.icon;

  if (isLoading) return <PageSkeleton cards={4} tableRows={6} tableCols={4} showChart />;
  return (
    <div className="min-h-screen bg-gradient-to-b from-purple-950 to-purple-900 text-white pb-24">
      {/* Header */}
      <div className="px-4 pt-10 pb-4">
        <div className="flex items-center justify-between mb-1">
          <h1 className="text-2xl font-bold">Broker Dashboard</h1>
          <Badge className={kycInfo.color + " flex items-center gap-1"}>
            <KycIcon className="w-3 h-3" />
            {kycInfo.label}
          </Badge>
        </div>
        <p className="text-purple-300 text-sm">{typedProfile.firmName}</p>
      </div>

      {/* Live Price Ticker */}
      <WatchlistTickerFilter />

      <div className="px-4 pt-3">
        <Tabs defaultValue="overview">
          <TabsList className="w-full bg-purple-900/60 border border-purple-700 mb-4">
            <TabsTrigger value="overview" className="flex-1 text-xs data-[state=active]:bg-purple-600 data-[state=active]:text-white text-purple-300">Overview</TabsTrigger>
            <TabsTrigger value="transactions" className="flex-1 text-xs data-[state=active]:bg-purple-600 data-[state=active]:text-white text-purple-300">Transactions</TabsTrigger>
          </TabsList>

          {/* ── OVERVIEW TAB ────────────────────────────────────────────────── */}
          <TabsContent value="overview" className="space-y-4">
            {/* KYC Status Alert */}
            {typedProfile.kycStatus !== "APPROVED" && (
              <Card className="bg-yellow-900/30 border-yellow-700">
                <CardContent className="p-4 flex items-start gap-3">
                  <AlertCircle className="w-5 h-5 text-yellow-400 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-yellow-200 text-sm font-medium">
                      {typedProfile.kycStatus === "PENDING" ? "KYC Not Submitted" : typedProfile.kycStatus === "UNDER_REVIEW" ? "KYC Under Review" : "KYC Rejected"}
                    </p>
                    <p className="text-yellow-400 text-xs mt-0.5">
                      {typedProfile.kycStatus === "PENDING"
                        ? "Submit your regulatory documents to activate your broker account."
                        : typedProfile.kycStatus === "UNDER_REVIEW"
                        ? "Your documents are being reviewed. Approval takes 2–5 business days."
                        : `Reason: ${typedProfile.kycNotes ?? "Please resubmit with correct documents."}`}
                    </p>
                    {typedProfile.kycStatus === "PENDING" && (
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
                    <p className="text-sm font-medium text-white">{typedProfile.rcNumber ?? "—"}</p>
                  </div>
                  <div>
                    <p className="text-xs text-purple-400">State</p>
                    <p className="text-sm font-medium text-white">{typedProfile.state ?? "—"}</p>
                  </div>
                  <div>
                    <p className="text-xs text-purple-400">Commission Rate</p>
                    <p className="text-sm font-medium text-white">
                      {typedProfile.commissionRate ? `${parseFloat(String(typedProfile.commissionRate ?? 0)).toFixed(2)}%` : "—"}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-purple-400">Account Status</p>
                    <p className={`text-sm font-medium ${typedProfile.accountStatus === "ACTIVE" ? "text-green-400" : "text-gray-400"}`}>
                      {typedProfile.accountStatus}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-purple-400">Years Operating</p>
                    <p className="text-sm font-medium text-white">{typedProfile.yearsInOperation ?? "—"}</p>
                  </div>
                  <div>
                    <p className="text-xs text-purple-400">Client Book Size</p>
                    <p className="text-sm font-medium text-white">{typedProfile.clientBookSize ?? "—"}</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Regulatory Info */}
            {(typedProfile.secLicenseNumber || typedProfile.cbnLicenseNumber) && (
              <Card className="bg-purple-800/30 border-purple-700">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm text-purple-300 font-medium">Regulatory Licenses</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {typedProfile.secLicenseNumber && (
                    <div className="flex items-center gap-2">
                      <Shield className="w-4 h-4 text-purple-400" />
                      <div>
                        <p className="text-xs text-purple-400">SEC License</p>
                        <p className="text-sm text-white">{typedProfile.secLicenseNumber}</p>
                      </div>
                    </div>
                  )}
                  {typedProfile.cbnLicenseNumber && (
                    <div className="flex items-center gap-2">
                      <Shield className="w-4 h-4 text-purple-400" />
                      <div>
                        <p className="text-xs text-purple-400">CBN License</p>
                        <p className="text-sm text-white">{typedProfile.cbnLicenseNumber}</p>
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
                  contactPhone: typedProfile.contactPhone ?? "",
                  contactEmail: typedProfile.contactEmail ?? "",
                  commissionRate: typedProfile.commissionRate ? String(typedProfile.commissionRate) : "",
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

            {/* Push Notification Settings */}
            <PushNotificationSettings compact />
          </TabsContent>

          {/* ── TRANSACTIONS TAB ─────────────────────────────────────────────── */}
          <TabsContent value="transactions" className="space-y-3">
            {/* Filter Controls */}
            <Card className="bg-purple-900/40 border-purple-700">
              <CardContent className="p-3 space-y-3">
                <div className="flex items-center gap-2">
                  <Filter className="w-4 h-4 text-purple-400 shrink-0" />
                  <span className="text-xs font-medium text-purple-300">Filter & Sort Transactions</span>
                  {hasActiveFilters && (
                    <button onClick={clearFilters} className="ml-auto flex items-center gap-1 text-xs text-purple-400 hover:text-white">
                      <X className="w-3 h-3" />
                      Clear
                    </button>
                  )}
                </div>

                {/* Symbol search */}
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-purple-400" />
                    <Input
                      placeholder="Search symbol (e.g. MAIZE)"
                      value={symbolInput}
                      onChange={e => setSymbolInput(e.target.value)}
                      onKeyDown={e => e.key === "Enter" && applySymbolFilter()}
                      className="pl-8 h-8 text-xs bg-purple-900/60 border-purple-700 text-white placeholder:text-purple-500"
                    />
                  </div>
                  <Button size="sm" onClick={applySymbolFilter} className="h-8 px-3 text-xs bg-purple-600 hover:bg-purple-500">
                    Search
                  </Button>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  {/* Side filter */}
                  <div>
                    <Label className="text-xs text-purple-400 mb-1 block">Side</Label>
                    <Select value={txSide} onValueChange={(v) => { setTxSide(v as "all" | "BUY" | "SELL"); setTxPage(1); }}>
                      <SelectTrigger className="h-8 text-xs bg-purple-900/60 border-purple-700 text-white">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="bg-purple-950 border-purple-700 text-white">
                        <SelectItem value="all">All Sides</SelectItem>
                        <SelectItem value="BUY">Buy</SelectItem>
                        <SelectItem value="SELL">Sell</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Asset class filter */}
                  <div>
                    <Label className="text-xs text-purple-400 mb-1 block">Asset Class</Label>
                    <Select value={txAssetClass} onValueChange={(v) => { setTxAssetClass(v); setTxPage(1); }}>
                      <SelectTrigger className="h-8 text-xs bg-purple-900/60 border-purple-700 text-white">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="bg-purple-950 border-purple-700 text-white">
                        <SelectItem value="all">All Classes</SelectItem>
                        <SelectItem value="COMMODITY">Commodity</SelectItem>
                        <SelectItem value="EQUITY">Equity</SelectItem>
                        <SelectItem value="FIXED_INCOME">Fixed Income</SelectItem>
                        <SelectItem value="DERIVATIVES">Derivatives</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Transactions Table */}
            <Card className="bg-purple-900/30 border-purple-700">
              <CardContent className="p-0">
                {txQuery.isLoading ? (
                  <div className="flex items-center justify-center py-10">
                    <div className="w-6 h-6 border-2 border-purple-400 border-t-transparent rounded-full animate-spin" />
                  </div>
                ) : !txQuery.data?.trades.length ? (
                  <div className="flex flex-col items-center justify-center py-10 text-center px-4">
                    <BarChart3 className="w-8 h-8 text-purple-600 mb-2" />
                    <p className="text-purple-400 text-sm">No transactions found</p>
                    {hasActiveFilters && (
                      <button onClick={clearFilters} className="text-purple-300 text-xs underline mt-1">Clear filters</button>
                    )}
                  </div>
                ) : (
                  <>
                    {/* Column headers with sort */}
                    <div className="grid grid-cols-4 gap-1 px-3 py-2 border-b border-purple-800 text-xs text-purple-400">
                      <button className="flex items-center text-left" onClick={() => toggleSort("createdAt")}>
                        Date <SortIcon col="createdAt" />
                      </button>
                      <span>Symbol</span>
                      <button className="flex items-center" onClick={() => toggleSort("fillPrice")}>
                        Price <SortIcon col="fillPrice" />
                      </button>
                      <button className="flex items-center" onClick={() => toggleSort("filledQty")}>
                        Qty <SortIcon col="filledQty" />
                      </button>
                    </div>

                    {/* Rows */}
                    {txQuery.data.trades.map((t: any) => {
                      const isBuyer = t.buyerUserId === (profile as any)?.userId;
                      return (
                        <div key={t.id} className="grid grid-cols-4 gap-1 px-3 py-2.5 border-b border-purple-900/60 last:border-0 hover:bg-purple-800/20 transition-colors">
                          <div>
                            <p className="text-xs text-white">{new Date(t.createdAt).toLocaleDateString()}</p>
                            <p className="text-xs text-purple-500">{new Date(t.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</p>
                          </div>
                          <div>
                            <p className="text-xs font-mono font-semibold text-white">{t.symbol}</p>
                            <Badge className={`text-xs px-1 py-0 h-4 ${isBuyer ? "bg-green-900/60 text-green-300" : "bg-red-900/60 text-red-300"}`}>
                              {isBuyer ? "BUY" : "SELL"}
                            </Badge>
                          </div>
                          <div>
                            <p className="text-xs text-white">₦{parseFloat(t.fillPrice).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                            <p className="text-xs text-purple-500">{t.assetClass}</p>
                          </div>
                          <div>
                            <p className="text-xs text-white">{parseFloat(t.filledQty).toLocaleString()}</p>
                            <p className="text-xs text-purple-500">₦{parseFloat(t.grossValue).toLocaleString(undefined, { maximumFractionDigits: 0 })}</p>
                          </div>
                        </div>
                      );
                    })}
                  </>
                )}
              </CardContent>
            </Card>

            {/* Pagination */}
            {txQuery.data && txQuery.data.total > 10 && (
              <div className="flex items-center justify-between px-1">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setTxPage(p => Math.max(1, p - 1))}
                  disabled={txPage === 1}
                  className="h-7 px-2 text-xs border-purple-700 text-purple-300 bg-transparent"
                >
                  <ChevronLeft className="w-3 h-3 mr-1" />
                  Prev
                </Button>
                <span className="text-xs text-purple-400">
                  Page {txPage} of {Math.ceil(txQuery.data.total / 10)} · {txQuery.data.total} trades
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setTxPage(p => p + 1)}
                  disabled={txPage >= Math.ceil(txQuery.data.total / 10)}
                  className="h-7 px-2 text-xs border-purple-700 text-purple-300 bg-transparent"
                >
                  Next
                  <ChevronRight className="w-3 h-3 ml-1" />
                </Button>
              </div>
            )}
          </TabsContent>
        </Tabs>
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
              <div className="space-y-4 py-2">
                <div className="bg-yellow-900/30 border border-yellow-700 rounded-lg p-3 mb-4">
                  <p className="text-yellow-300 text-sm font-medium">Re-upload License Documents</p>
                  <p className="text-yellow-400 text-xs mt-1">Your firm identity changed. Please re-submit your SEC certificate and other regulatory documents.</p>
                </div>
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
                  <input ref={secCertRef} type="file" accept="image/*,application/pdf" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) handleFileUpload("secCertificateUrl", f); }} />
                  <Button type="button" variant="outline" size="sm" onClick={() => secCertRef.current?.click()} disabled={uploading["secCertificateUrl"]} className="border-purple-700 text-purple-300 bg-transparent mt-1 w-full">
                    <Upload className="w-3.5 h-3.5 mr-1" />
                    {uploading["secCertificateUrl"] ? "Uploading..." : uploadedUrls["secCertificateUrl"] ? "✓ Uploaded — Replace" : "Upload SEC Certificate"}
                  </Button>
                </div>
                <div>
                  <Label className="text-purple-300 text-xs">CBN License Number</Label>
                  <Input value={docForm.cbnLicenseNumber} onChange={e => setDocForm(f => ({ ...f, cbnLicenseNumber: e.target.value }))} placeholder="CBN/LIC/2024/001" className="bg-purple-900 border-purple-700 text-white mt-1" />
                </div>
                <div>
                  <Label className="text-purple-300 text-xs">CBN Approval Letter</Label>
                  <input ref={cbnApprovalRef} type="file" accept="image/*,application/pdf" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) handleFileUpload("cbnApprovalUrl", f); }} />
                  <Button type="button" variant="outline" size="sm" onClick={() => cbnApprovalRef.current?.click()} disabled={uploading["cbnApprovalUrl"]} className="border-purple-700 text-purple-300 bg-transparent mt-1 w-full">
                    <Upload className="w-3.5 h-3.5 mr-1" />
                    {uploading["cbnApprovalUrl"] ? "Uploading..." : uploadedUrls["cbnApprovalUrl"] ? "✓ Uploaded — Replace" : "Upload CBN Approval"}
                  </Button>
                </div>
                <div>
                  <Label className="text-purple-300 text-xs">CAC Document</Label>
                  <input ref={cacDocRef} type="file" accept="image/*,application/pdf" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) handleFileUpload("cacDocUrl", f); }} />
                  <Button type="button" variant="outline" size="sm" onClick={() => cacDocRef.current?.click()} disabled={uploading["cacDocUrl"]} className="border-purple-700 text-purple-300 bg-transparent mt-1 w-full">
                    <Upload className="w-3.5 h-3.5 mr-1" />
                    {uploading["cacDocUrl"] ? "Uploading..." : uploadedUrls["cacDocUrl"] ? "✓ Uploaded — Replace" : "Upload CAC Document"}
                  </Button>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => { setEditOpen(false); setKycReset(false); }} className="border-purple-700 text-purple-300">Cancel</Button>
                <Button
                  onClick={() => submitKyc.mutate({
                    secLicenseNumber: docForm.secLicenseNumber,
                    regulatoryBody: docForm.regulatoryBody,
                    cbnLicenseNumber: docForm.cbnLicenseNumber || undefined,
                    secCertificateUrl: uploadedUrls["secCertificateUrl"] ?? "",
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
