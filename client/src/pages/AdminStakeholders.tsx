/**
 * NEXCOM Exchange — Admin Stakeholder Dashboard
 * Unified view of KYC queues for all 5 stakeholder types with tabbed navigation,
 * per-row review actions, and bulk approve/reject.
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Sprout,
  TrendingUp,
  Building2,
  Warehouse,
  BarChart3,
  CheckCircle2,
  XCircle,
  Clock,
  AlertCircle,
  RefreshCw,
  Users,
  ExternalLink,
  FileText,
  Eye,
  Download,
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/_core/hooks/useAuth";
import { useLocation } from "wouter";
import { PageSkeleton } from "@/components/PageSkeleton";

// ── Types ──────────────────────────────────────────────────────────────────────
type KycStatus = "PENDING" | "UNDER_REVIEW" | "APPROVED" | "REJECTED";
type TabKey = "farmer" | "trader" | "broker" | "warehouseOp" | "marketMaker";

interface TabConfig {
  key: TabKey;
  label: string;
  icon: React.ReactNode;
  color: string;
}

const TABS: TabConfig[] = [
  { key: "farmer", label: "Farmers", icon: <Sprout className="w-4 h-4" />, color: "text-green-400" },
  { key: "trader", label: "Traders", icon: <TrendingUp className="w-4 h-4" />, color: "text-blue-400" },
  { key: "broker", label: "Brokers", icon: <Building2 className="w-4 h-4" />, color: "text-purple-400" },
  { key: "warehouseOp", label: "Warehouse Ops", icon: <Warehouse className="w-4 h-4" />, color: "text-orange-400" },
  { key: "marketMaker", label: "Market Makers", icon: <BarChart3 className="w-4 h-4" />, color: "text-yellow-400" },
];

function KycBadge({ status }: { status: KycStatus }) {
  if (status === "APPROVED")
    return <Badge className="bg-green-500/20 text-green-400 border-green-500/30 gap-1 text-xs"><CheckCircle2 className="w-3 h-3" />Approved</Badge>;
  if (status === "UNDER_REVIEW")
    return <Badge className="bg-yellow-500/20 text-yellow-400 border-yellow-500/30 gap-1 text-xs"><Clock className="w-3 h-3" />Under Review</Badge>;
  if (status === "REJECTED")
    return <Badge className="bg-red-500/20 text-red-400 border-red-500/30 gap-1 text-xs"><XCircle className="w-3 h-3" />Rejected</Badge>;
  return <Badge className="bg-slate-500/20 text-slate-400 border-slate-500/30 gap-1 text-xs"><AlertCircle className="w-3 h-3" />Pending</Badge>;
}

// ── Document URL link helper ─────────────────────────────────────────────────
function DocLink({ label, url }: { label: string; url?: string | null }) {
  if (!url) return null;
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center gap-1.5 text-xs text-blue-400 hover:text-blue-300 hover:underline truncate"
    >
      <FileText className="h-3 w-3 flex-shrink-0" />
      <span className="truncate">{label}</span>
      <ExternalLink className="h-3 w-3 flex-shrink-0" />
    </a>
  );
}

// ── Profile Drill-Down Panel ──────────────────────────────────────────────────
interface DrillDownPanelProps {
  profile: any | null;
  open: boolean;
  onClose: () => void;
  onApprove: (id: number, notes: string) => void;
  onReject: (id: number, notes: string) => void;
  isActionLoading: boolean;
  nameField: string;
  stakeholderType: "FARMER" | "TRADER" | "BROKER" | "WAREHOUSE_OPERATOR" | "MARKET_MAKER";
}
function ProfileDrillDownPanel({
  profile, open, onClose, onApprove, onReject, isActionLoading, nameField, stakeholderType,
}: DrillDownPanelProps) {
  const [notes, setNotes] = useState("");

  const { data: auditLog, isLoading: auditLoading } = trpc.kycAudit.getLog.useQuery(
    { stakeholderType, profileId: profile?.id ?? 0, limit: 20 },
    { enabled: !!profile && open }
  );

  if (!profile) return null;
  const isReviewable = ["UNDER_REVIEW", "SUBMITTED"].includes(profile.kycStatus);

  // Collect all document URLs from the profile (handles all 5 stakeholder types)
  const docLinks: Array<{ label: string; url?: string | null }> = [
    // Farmer
    { label: "KYC Documents (JSON)", url: profile.kycDocuments ? `data:text/plain,${encodeURIComponent(profile.kycDocuments)}` : null },
    // Trader
    { label: "ID Document", url: profile.idDocumentUrl },
    { label: "Proof of Address", url: profile.proofOfAddressUrl },
    { label: "Bank Statement", url: profile.bankStatementUrl },
    // Broker
    { label: "SEC Certificate", url: profile.secCertificateUrl },
    { label: "CBN Approval", url: profile.cbnApprovalUrl },
    { label: "CAC Document", url: profile.cacDocUrl },
    // Warehouse Op
    { label: "NWR Certificate", url: profile.nwrCertDocUrl },
    { label: "Facility Inspection", url: profile.facilityInspectionUrl },
    { label: "Insurance Document", url: profile.insuranceDocUrl },
    // Market Maker
    { label: "Firm Registration", url: profile.firmRegistrationUrl },
    { label: "Trading License", url: profile.tradingLicenseUrl },
    { label: "Capital Adequacy", url: profile.capitalAdequacyUrl },
  ].filter(d => d.url);

  // Collect key profile fields for display
  const profileFields: Array<{ label: string; value?: string | number | null }> = [
    { label: "ID", value: `#${profile.id}` },
    { label: "Name / Firm", value: profile[nameField] },
    { label: "Phone", value: profile.phone ?? profile.contactPhone },
    { label: "Email", value: profile.email ?? profile.contactEmail },
    { label: "State", value: profile.state },
    { label: "LGA", value: profile.lga },
    { label: "NIN", value: profile.nin },
    { label: "BVN", value: profile.bvn },
    { label: "RC Number", value: profile.rcNumber },
    { label: "SEC License", value: profile.secLicenseNumber },
    { label: "CBN License", value: profile.cbnLicenseNumber },
    { label: "NWR Cert #", value: profile.nwrCertNumber },
    { label: "Facility", value: profile.facilityName },
    { label: "Facility Address", value: profile.facilityAddress },
    { label: "Trading Desk", value: profile.tradingDesk },
    { label: "Regulatory Regs", value: profile.regulatoryRegistrations },
    { label: "KYC Notes", value: profile.kycNotes },
    { label: "Reviewed At", value: profile.kycReviewedAt ? new Date(profile.kycReviewedAt).toLocaleString() : null },
    { label: "Created", value: new Date(profile.createdAt).toLocaleString() },
  ].filter(f => f.value != null && f.value !== "");

  return (
    <Sheet open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <SheetContent className="w-full sm:max-w-lg overflow-y-auto bg-slate-900 border-slate-700 text-white">
        <SheetHeader className="mb-4">
          <SheetTitle className="text-white flex items-center gap-2">
            <Eye className="h-4 w-4 text-slate-400" />
            Profile Detail — {profile[nameField] ?? `#${profile.id}`}
          </SheetTitle>
        </SheetHeader>

        {/* KYC Status */}
        <div className="mb-4">
          <KycBadge status={profile.kycStatus as KycStatus} />
        </div>

        {/* Profile Fields */}
        <div className="space-y-1 mb-6">
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Profile Information</p>
          <div className="grid grid-cols-2 gap-x-4 gap-y-2">
            {profileFields.map(f => (
              <div key={f.label}>
                <p className="text-xs text-slate-500">{f.label}</p>
                <p className="text-sm text-white break-words">{String(f.value)}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Submitted Documents */}
        {docLinks.length > 0 && (
          <div className="mb-6">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Submitted Documents</p>
            <div className="space-y-2 bg-slate-800/50 rounded-lg p-3 border border-slate-700/50">
              {docLinks.map(d => (
                <DocLink key={d.label} label={d.label} url={d.url} />
              ))}
            </div>
          </div>
        )}
        {docLinks.length === 0 && (
          <div className="mb-6 text-xs text-slate-500 italic">No document URLs found for this profile.</div>
        )}

        {/* Review History */}
        <div className="mb-6">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Review History</p>
            {auditLog && auditLog.length > 0 && (
              <Button
                size="sm"
                variant="ghost"
                className="h-6 text-xs px-2 text-slate-400 hover:text-white gap-1"
                onClick={() => {
                  const header = "Date,Reviewer,Decision,Notes";
                  const lines = auditLog.map(e => {
                    const date = e.createdAt ? new Date(e.createdAt).toISOString() : "";
                    const reviewer = `"${(e.reviewerName ?? "").replace(/"/g, '""')}"`;
                    const decision = e.decision ?? "";
                    const notes = `"${(e.notes ?? "").replace(/"/g, '""')}"`;
                    return `${date},${reviewer},${decision},${notes}`;
                  });
                  const csv = [header, ...lines].join("\n");
                  const blob = new Blob([csv], { type: "text/csv" });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = `kyc-audit-${stakeholderType.toLowerCase()}-${profile.id}-${Date.now()}.csv`;
                  a.click();
                  URL.revokeObjectURL(url);
                }}
              >
                <Download className="h-3 w-3" />
                Export CSV
              </Button>
            )}
          </div>
          {auditLoading ? (
            <div className="text-xs text-slate-500 italic">Loading history…</div>
          ) : !auditLog || auditLog.length === 0 ? (
            <div className="text-xs text-slate-500 italic">No review decisions recorded yet.</div>
          ) : (
            <div className="space-y-2">
              {auditLog.map(entry => (
                <div key={entry.id} className={`rounded-lg border p-3 text-xs ${
                  entry.decision === "APPROVED" ? "bg-green-900/20 border-green-700/40" :
                  entry.decision === "REJECTED" ? "bg-red-900/20 border-red-700/40" :
                  "bg-slate-800/40 border-slate-700/50"
                }`}>
                  <div className="flex items-center justify-between mb-1">
                    <span className={`font-semibold ${
                      entry.decision === "APPROVED" ? "text-green-400" :
                      entry.decision === "REJECTED" ? "text-red-400" :
                      "text-slate-300"
                    }`}>{entry.decision}</span>
                    <span className="text-slate-500">{new Date(entry.createdAt).toLocaleString()}</span>
                  </div>
                  <div className="text-slate-400">By: {entry.reviewerName ?? `User #${entry.reviewerId}`}</div>
                  {entry.notes && (
                    <div className="mt-1 text-slate-300 italic">"{entry.notes}"</div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Review Action */}
        {isReviewable && (
          <div className="space-y-3 border-t border-slate-700/50 pt-4">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Review Decision</p>
            <div className="space-y-1.5">
              <Label className="text-xs text-slate-400">Notes (optional — shown to applicant on rejection)</Label>
              <Textarea
                placeholder="Add review notes…"
                value={notes}
                onChange={e => setNotes(e.target.value)}
                rows={3}
                className="bg-slate-800 border-slate-600 text-white text-sm resize-none"
              />
            </div>
            <div className="flex gap-2">
              <Button
                className="flex-1 bg-green-600 hover:bg-green-500 text-white"
                disabled={isActionLoading}
                onClick={() => { onApprove(profile.id, notes); onClose(); }}
              >
                <CheckCircle2 className="h-4 w-4 mr-1.5" />
                Approve
              </Button>
              <Button
                variant="destructive"
                className="flex-1"
                disabled={isActionLoading}
                onClick={() => { onReject(profile.id, notes); onClose(); }}
              >
                <XCircle className="h-4 w-4 mr-1.5" />
                Reject
              </Button>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

// ── Stats Row ──────────────────────────────────────────────────────────────────
function StatsRow({ stats }: { stats: { total: number; underReview: number; approved: number; rejected: number; pending: number } | undefined }) {
  if (!stats) return null;
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
      {[
        { label: "Total", value: stats.total, color: "text-white" },
        { label: "Under Review", value: stats.underReview, color: "text-yellow-400" },
        { label: "Approved", value: stats.approved, color: "text-green-400" },
        { label: "Rejected", value: stats.rejected, color: "text-red-400" },
      ].map((s) => (
        <div key={s.label} className="bg-slate-800/60 rounded-xl p-4 border border-slate-700/50">
          <div className={`text-2xl font-bold ${s.color}`}>{s.value ?? 0}</div>
          <div className="text-xs text-slate-500 mt-1">{s.label}</div>
        </div>
      ))}
    </div>
  );
}

// ── Farmer Tab ─────────────────────────────────────────────────────────────────
function FarmerTab() {
  const [selected, setSelected] = useState<number[]>([]);
  const [filter, setFilter] = useState<KycStatus | "ALL">("UNDER_REVIEW");
  const utils = trpc.useUtils();

  const { data: stats } = trpc.farmer.adminGetKYCStats.useQuery();
  const { data: list, isLoading } = trpc.farmer.adminListFarmerProfiles.useQuery({
    kycStatus: filter === "ALL" ? undefined : filter,
    limit: 50,
  });
  const bulkMutation = trpc.farmer.adminBulkReviewKYC.useMutation({
    onSuccess: (res) => {
      toast.success(`Approved ${res.approved}, Rejected ${res.rejected}${res.failed ? `, Skipped ${res.failed}` : ""}`);
      setSelected([]);
      utils.farmer.adminListFarmerProfiles.invalidate();
      utils.farmer.adminGetKYCStats.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });
  const singleMutation = trpc.farmer.adminReviewKYC.useMutation({
    onSuccess: () => {
      utils.farmer.adminListFarmerProfiles.invalidate();
      utils.farmer.adminGetKYCStats.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const profiles = list?.profiles ?? [];
  const allIds = profiles.filter(p => ["UNDER_REVIEW", "SUBMITTED"].includes(p.kycStatus)).map(p => p.id);
  const allSelected = allIds.length > 0 && allIds.every(id => selected.includes(id));

  return (
    <div>
      <StatsRow stats={stats as any} />
      <ProfileTable
        profiles={profiles}
        isLoading={isLoading}
        selected={selected}
        setSelected={setSelected}
        allIds={allIds}
        allSelected={allSelected}
        filter={filter}
        setFilter={setFilter}
        onBulkApprove={() => bulkMutation.mutate({ farmerProfileIds: selected, decision: "APPROVED" })}
        onBulkReject={() => bulkMutation.mutate({ farmerProfileIds: selected, decision: "REJECTED" })}
        onApprove={(id) => singleMutation.mutate({ farmerProfileId: id, decision: "APPROVED" })}
        onReject={(id) => singleMutation.mutate({ farmerProfileId: id, decision: "REJECTED" })}
        isBulkLoading={bulkMutation.isPending}
        nameField="fullName"
        idField="id"
        stakeholderType="FARMER"
      />
    </div>
  );
}

// ── Trader Tab ─────────────────────────────────────────────────────────────────
function TraderTab() {
  const [selected, setSelected] = useState<number[]>([]);
  const [filter, setFilter] = useState<KycStatus | "ALL">("UNDER_REVIEW");
  const utils = trpc.useUtils();

  const { data: stats } = trpc.trader.adminGetTraderStats.useQuery();
  const { data: list, isLoading } = trpc.trader.adminListTraderProfiles.useQuery({
    kycStatus: filter === "ALL" ? undefined : filter,
    limit: 50,
  });
  const bulkMutation = trpc.trader.adminBulkReviewTraderKYC.useMutation({
    onSuccess: (res) => {
      toast.success(`Approved ${res.approved}, Rejected ${res.rejected}${res.failed ? `, Skipped ${res.failed}` : ""}`);
      setSelected([]);
      utils.trader.adminListTraderProfiles.invalidate();
      utils.trader.adminGetTraderStats.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });
  const singleMutation = trpc.trader.adminReviewTraderKYC.useMutation({
    onSuccess: () => {
      utils.trader.adminListTraderProfiles.invalidate();
      utils.trader.adminGetTraderStats.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const profiles = list?.profiles ?? [];
  const allIds = profiles.filter(p => ["UNDER_REVIEW", "SUBMITTED"].includes(p.kycStatus)).map(p => p.id);
  const allSelected = allIds.length > 0 && allIds.every(id => selected.includes(id));

  return (
    <div>
      <StatsRow stats={stats as any} />
      <ProfileTable
        profiles={profiles}
        isLoading={isLoading}
        selected={selected}
        setSelected={setSelected}
        allIds={allIds}
        allSelected={allSelected}
        filter={filter}
        setFilter={setFilter}
        onBulkApprove={() => bulkMutation.mutate({ traderIds: selected, decision: "APPROVED" })}
        onBulkReject={() => bulkMutation.mutate({ traderIds: selected, decision: "REJECTED" })}
        onApprove={(id) => singleMutation.mutate({ traderId: id, decision: "APPROVED" })}
        onReject={(id) => singleMutation.mutate({ traderId: id, decision: "REJECTED" })}
        isBulkLoading={bulkMutation.isPending}
        nameField="fullName"
        idField="id"
        stakeholderType="TRADER"
      />
    </div>
  );
}

// ── Broker Tab ─────────────────────────────────────────────────────────────────
function BrokerTab() {
  const [selected, setSelected] = useState<number[]>([]);
  const [filter, setFilter] = useState<KycStatus | "ALL">("UNDER_REVIEW");
  const utils = trpc.useUtils();

  const { data: stats } = trpc.broker.adminGetBrokerStats.useQuery();
  const { data: list, isLoading } = trpc.broker.adminListBrokerProfiles.useQuery({
    kycStatus: filter === "ALL" ? undefined : filter,
    limit: 50,
  });
  const bulkMutation = trpc.broker.adminBulkReviewBrokerKYC.useMutation({
    onSuccess: (res) => {
      toast.success(`Approved ${res.approved}, Rejected ${res.rejected}${res.failed ? `, Skipped ${res.failed}` : ""}`);
      setSelected([]);
      utils.broker.adminListBrokerProfiles.invalidate();
      utils.broker.adminGetBrokerStats.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });
  const singleMutation = trpc.broker.adminReviewBrokerKYC.useMutation({
    onSuccess: () => {
      utils.broker.adminListBrokerProfiles.invalidate();
      utils.broker.adminGetBrokerStats.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const profiles = list?.profiles ?? [];
  const allIds = profiles.filter(p => ["UNDER_REVIEW", "SUBMITTED"].includes(p.kycStatus)).map(p => p.id);
  const allSelected = allIds.length > 0 && allIds.every(id => selected.includes(id));

  return (
    <div>
      <StatsRow stats={stats as any} />
      <ProfileTable
        profiles={profiles}
        isLoading={isLoading}
        selected={selected}
        setSelected={setSelected}
        allIds={allIds}
        allSelected={allSelected}
        filter={filter}
        setFilter={setFilter}
        onBulkApprove={() => bulkMutation.mutate({ brokerIds: selected, decision: "APPROVED" })}
        onBulkReject={() => bulkMutation.mutate({ brokerIds: selected, decision: "REJECTED" })}
        onApprove={(id) => singleMutation.mutate({ brokerId: id, decision: "APPROVED" })}
        onReject={(id) => singleMutation.mutate({ brokerId: id, decision: "REJECTED" })}
        isBulkLoading={bulkMutation.isPending}
        nameField="firmName"
        idField="id"
        stakeholderType="BROKER"
      />
    </div>
  );
}

// ── Warehouse Op Tab ───────────────────────────────────────────────────────────
function WarehouseOpTab() {
  const [selected, setSelected] = useState<number[]>([]);
  const [filter, setFilter] = useState<KycStatus | "ALL">("UNDER_REVIEW");
  const utils = trpc.useUtils();

  const { data: stats } = trpc.warehouseOp.adminGetWarehouseOpStats.useQuery();
  const { data: list, isLoading } = trpc.warehouseOp.adminListWarehouseOpProfiles.useQuery({
    kycStatus: filter === "ALL" ? undefined : filter,
    limit: 50,
  });
  const bulkMutation = trpc.warehouseOp.adminBulkReviewWarehouseOpKYC.useMutation({
    onSuccess: (res) => {
      toast.success(`Approved ${res.approved}, Rejected ${res.rejected}${res.failed ? `, Skipped ${res.failed}` : ""}`);
      setSelected([]);
      utils.warehouseOp.adminListWarehouseOpProfiles.invalidate();
      utils.warehouseOp.adminGetWarehouseOpStats.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });
  const singleMutation = trpc.warehouseOp.adminReviewWarehouseOpKYC.useMutation({
    onSuccess: () => {
      utils.warehouseOp.adminListWarehouseOpProfiles.invalidate();
      utils.warehouseOp.adminGetWarehouseOpStats.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const profiles = list?.profiles ?? [];
  const allIds = profiles.filter(p => ["UNDER_REVIEW", "SUBMITTED"].includes(p.kycStatus)).map(p => p.id);
  const allSelected = allIds.length > 0 && allIds.every(id => selected.includes(id));

  return (
    <div>
      <StatsRow stats={stats as any} />
      <ProfileTable
        profiles={profiles}
        isLoading={isLoading}
        selected={selected}
        setSelected={setSelected}
        allIds={allIds}
        allSelected={allSelected}
        filter={filter}
        setFilter={setFilter}
        onBulkApprove={() => bulkMutation.mutate({ warehouseOpIds: selected, decision: "APPROVED" })}
        onBulkReject={() => bulkMutation.mutate({ warehouseOpIds: selected, decision: "REJECTED" })}
        onApprove={(id) => singleMutation.mutate({ warehouseOpId: id, decision: "APPROVED" })}
        onReject={(id) => singleMutation.mutate({ warehouseOpId: id, decision: "REJECTED" })}
        isBulkLoading={bulkMutation.isPending}
        nameField="facilityName"
        idField="id"
        stakeholderType="WAREHOUSE_OPERATOR"
      />
    </div>
  );
}

// ── Market Maker Tab ───────────────────────────────────────────────────────────
function MarketMakerTab() {
  const [selected, setSelected] = useState<number[]>([]);
  const [filter, setFilter] = useState<KycStatus | "ALL">("UNDER_REVIEW");
  const utils = trpc.useUtils();

  const { data: stats } = trpc.marketMakerOnboarding.adminGetMarketMakerStats.useQuery();
  const { data: list, isLoading } = trpc.marketMakerOnboarding.adminListMarketMakerProfiles.useQuery({
    kycStatus: filter === "ALL" ? undefined : filter,
    limit: 50,
  });
  const bulkMutation = trpc.marketMakerOnboarding.adminBulkReviewMarketMakerKYC.useMutation({
    onSuccess: (res) => {
      toast.success(`Approved ${res.approved}, Rejected ${res.rejected}${res.failed ? `, Skipped ${res.failed}` : ""}`);
      setSelected([]);
      utils.marketMakerOnboarding.adminListMarketMakerProfiles.invalidate();
      utils.marketMakerOnboarding.adminGetMarketMakerStats.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });
  const singleMutation = trpc.marketMakerOnboarding.adminReviewMarketMakerKYC.useMutation({
    onSuccess: () => {
      utils.marketMakerOnboarding.adminListMarketMakerProfiles.invalidate();
      utils.marketMakerOnboarding.adminGetMarketMakerStats.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const profiles = list?.profiles ?? [];
  const allIds = profiles.filter(p => ["UNDER_REVIEW", "SUBMITTED"].includes(p.kycStatus)).map(p => p.id);
  const allSelected = allIds.length > 0 && allIds.every(id => selected.includes(id));

  return (
    <div>
      <StatsRow stats={stats as any} />
      <ProfileTable
        profiles={profiles}
        isLoading={isLoading}
        selected={selected}
        setSelected={setSelected}
        allIds={allIds}
        allSelected={allSelected}
        filter={filter}
        setFilter={setFilter}
        onBulkApprove={() => bulkMutation.mutate({ marketMakerIds: selected, decision: "APPROVED" })}
        onBulkReject={() => bulkMutation.mutate({ marketMakerIds: selected, decision: "REJECTED" })}
        onApprove={(id) => singleMutation.mutate({ marketMakerId: id, decision: "APPROVED" })}
        onReject={(id) => singleMutation.mutate({ marketMakerId: id, decision: "REJECTED" })}
        isBulkLoading={bulkMutation.isPending}
        nameField="firmName"
        idField="id"
        stakeholderType="MARKET_MAKER"
      />
    </div>
  );
}

// ── Shared Profile Table ───────────────────────────────────────────────────────
interface ProfileTableProps {
  profiles: any[];
  isLoading: boolean;
  selected: number[];
  setSelected: (ids: number[]) => void;
  allIds: number[];
  allSelected: boolean;
  filter: KycStatus | "ALL";
  setFilter: (f: KycStatus | "ALL") => void;
  onBulkApprove: () => void;
  onBulkReject: () => void;
  onApprove: (id: number, notes?: string) => void;
  onReject: (id: number, notes?: string) => void;
  isBulkLoading: boolean;
  nameField: string;
  idField: string;
  stakeholderType: "FARMER" | "TRADER" | "BROKER" | "WAREHOUSE_OPERATOR" | "MARKET_MAKER";
}
function ProfileTable({
  profiles, isLoading, selected, setSelected, allIds, allSelected,
  filter, setFilter, onBulkApprove, onBulkReject, onApprove, onReject,
  isBulkLoading, nameField, stakeholderType,
}: ProfileTableProps) {
  const [drillProfile, setDrillProfile] = useState<any | null>(null);
  const FILTERS: Array<{ value: KycStatus | "ALL"; label: string }> = [
    { value: "ALL", label: "All" },
    { value: "UNDER_REVIEW", label: "Under Review" },
    { value: "PENDING", label: "Pending" },
    { value: "APPROVED", label: "Approved" },
    { value: "REJECTED", label: "Rejected" },
  ];

  function toggleSelect(id: number) {
    setSelected(selected.includes(id) ? selected.filter(s => s !== id) : [...selected, id]);
  }

  function toggleAll() {
    setSelected(allSelected ? [] : allIds);
  }

  return (
    <div>
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        {/* Filter pills */}
        <div className="flex gap-1.5 flex-wrap">
          {FILTERS.map(f => (
            <button
              key={f.value}
              onClick={() => setFilter(f.value)}
              className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                filter === f.value
                  ? "bg-slate-600 text-white"
                  : "bg-slate-800/60 text-slate-400 hover:bg-slate-700"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        {/* Bulk actions */}
        {selected.length > 0 && (
          <div className="flex items-center gap-2 ml-auto">
            <span className="text-xs text-slate-400">{selected.length} selected</span>
            <Button
              size="sm"
              className="bg-green-600 hover:bg-green-500 h-7 text-xs"
              onClick={onBulkApprove}
              disabled={isBulkLoading}
            >
              <CheckCircle2 className="w-3 h-3 mr-1" />
              Bulk Approve
            </Button>
            <Button
              size="sm"
              variant="destructive"
              className="h-7 text-xs"
              onClick={onBulkReject}
              disabled={isBulkLoading}
            >
              <XCircle className="w-3 h-3 mr-1" />
              Bulk Reject
            </Button>
          </div>
        )}
      </div>

      {/* Table */}
      <div className="bg-slate-800/40 rounded-xl border border-slate-700/50 overflow-hidden">
        {isLoading ? (
          <div className="p-8 text-center text-slate-500">
            <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2" />
            Loading profiles…
          </div>
        ) : profiles.length === 0 ? (
          <div className="p-8 text-center text-slate-500">
            <Users className="w-8 h-8 mx-auto mb-2 opacity-40" />
            No profiles found for this filter.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b border-slate-700/50">
              <tr className="text-slate-400 text-xs">
                <th className="p-3 text-left w-10">
                  <Checkbox
                    checked={allSelected}
                    onCheckedChange={toggleAll}
                    className="border-slate-600"
                  />
                </th>
                <th className="p-3 text-left">ID</th>
                <th className="p-3 text-left">Name / Firm</th>
                <th className="p-3 text-left">KYC Status</th>
                <th className="p-3 text-left">Created</th>
                <th className="p-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {profiles.map((profile: any) => {
                const isReviewable = ["UNDER_REVIEW", "SUBMITTED"].includes(profile.kycStatus);
                return (
                  <tr
                    key={profile.id}
                    className={`border-b border-slate-700/30 hover:bg-slate-700/20 transition-colors cursor-pointer ${
                      selected.includes(profile.id) ? "bg-slate-700/30" : ""
                    }`}
                    onClick={(e) => {
                      // Don't open panel when clicking checkbox or action buttons
                      if ((e.target as HTMLElement).closest('button, input[type="checkbox"], [role="checkbox"]')) return;
                      setDrillProfile(profile);
                    }}
                  >
                    <td className="p-3">
                      {isReviewable && (
                        <Checkbox
                          checked={selected.includes(profile.id)}
                          onCheckedChange={() => toggleSelect(profile.id)}
                          className="border-slate-600"
                        />
                      )}
                    </td>
                    <td className="p-3 text-slate-500 font-mono text-xs">#{profile.id}</td>
                    <td className="p-3 font-medium text-white">
                      {profile[nameField] ?? "—"}
                    </td>
                    <td className="p-3">
                      <KycBadge status={profile.kycStatus as KycStatus} />
                    </td>
                    <td className="p-3 text-slate-500 text-xs">
                      {profile.createdAt
                        ? new Date(profile.createdAt).toLocaleDateString()
                        : "—"}
                    </td>
                    <td className="p-3 text-right">
                      <div className="flex items-center gap-2 justify-end">
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-6 text-xs px-2 border-slate-600 text-slate-300 hover:bg-slate-700"
                          onClick={(e) => { e.stopPropagation(); setDrillProfile(profile); }}
                        >
                          <Eye className="h-3 w-3 mr-1" />
                          View
                        </Button>
                        {isReviewable && (
                          <>
                            <Button
                              size="sm"
                              className="bg-green-600 hover:bg-green-500 h-6 text-xs px-2"
                              onClick={(e) => { e.stopPropagation(); onApprove(profile.id); }}
                            >
                              Approve
                            </Button>
                            <Button
                              size="sm"
                              variant="destructive"
                              className="h-6 text-xs px-2"
                              onClick={(e) => { e.stopPropagation(); onReject(profile.id); }}
                            >
                              Reject
                            </Button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
      {/* Drill-Down Panel */}
      <ProfileDrillDownPanel
        profile={drillProfile}
        open={!!drillProfile}
        onClose={() => setDrillProfile(null)}
        onApprove={(id, notes) => { onApprove(id, notes); }}
        onReject={(id, notes) => { onReject(id, notes); }}
        isActionLoading={false}
        nameField={nameField}
        stakeholderType={stakeholderType}
      />
    </div>
  );
}
// ── Cross-Stakeholder Summary ──────────────────────────────────────────────────
function CrossStakeholderSummary() {
  const { data: farmerStats } = trpc.farmer.adminGetKYCStats.useQuery();
  const { data: traderStats } = trpc.trader.adminGetTraderStats.useQuery();
  const { data: brokerStats } = trpc.broker.adminGetBrokerStats.useQuery();
  const { data: warehouseStats } = trpc.warehouseOp.adminGetWarehouseOpStats.useQuery();
  const { data: mmStats } = trpc.marketMakerOnboarding.adminGetMarketMakerStats.useQuery();

  const allStats = [farmerStats, traderStats, brokerStats, warehouseStats, mmStats] as any[];
  const total = allStats.reduce((sum, s) => sum + (s?.total ?? 0), 0);
  const underReview = allStats.reduce((sum, s) => sum + (s?.underReview ?? 0), 0);
  const approved = allStats.reduce((sum, s) => sum + (s?.approved ?? 0), 0);
  const rejected = allStats.reduce((sum, s) => sum + (s?.rejected ?? 0), 0);
  const pending = allStats.reduce((sum, s) => sum + (s?.pending ?? 0), 0);

  const rows = [
    { label: "Total Registered", value: total, color: "text-white", bg: "bg-slate-700/40", border: "border-slate-600/50" },
    { label: "Pending", value: pending, color: "text-slate-300", bg: "bg-slate-800/40", border: "border-slate-700/50" },
    { label: "Under Review", value: underReview, color: "text-yellow-400", bg: "bg-yellow-900/20", border: "border-yellow-700/40" },
    { label: "Approved", value: approved, color: "text-green-400", bg: "bg-green-900/20", border: "border-green-700/40" },
    { label: "Rejected", value: rejected, color: "text-red-400", bg: "bg-red-900/20", border: "border-red-700/40" },
  ];

  const breakdown = [
    { label: "Farmers", icon: <Sprout className="w-3 h-3" />, color: "text-green-400", stats: farmerStats as any },
    { label: "Traders", icon: <TrendingUp className="w-3 h-3" />, color: "text-blue-400", stats: traderStats as any },
    { label: "Brokers", icon: <Building2 className="w-3 h-3" />, color: "text-purple-400", stats: brokerStats as any },
    { label: "Warehouse Ops", icon: <Warehouse className="w-3 h-3" />, color: "text-orange-400", stats: warehouseStats as any },
    { label: "Market Makers", icon: <BarChart3 className="w-3 h-3" />, color: "text-yellow-400", stats: mmStats as any },
  ];

  return (
    <div className="mb-8">
      <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Platform-wide Stakeholder Summary</h2>
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-4">
        {rows.map((r) => (
          <div key={r.label} className={`rounded-xl p-4 border ${r.bg} ${r.border}`}>
            <div className={`text-2xl font-bold ${r.color}`}>{r.value}</div>
            <div className="text-xs text-slate-500 mt-1">{r.label}</div>
          </div>
        ))}
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
        {breakdown.map((b) => (
          <div key={b.label} className="bg-slate-800/30 rounded-lg p-3 border border-slate-700/30">
            <div className={`flex items-center gap-1.5 mb-2 ${b.color}`}>
              {b.icon}
              <span className="text-xs font-medium">{b.label}</span>
            </div>
            <div className="grid grid-cols-2 gap-x-2 gap-y-1 text-xs">
              <span className="text-slate-500">Total</span>
              <span className="text-white font-medium text-right">{b.stats?.total ?? 0}</span>
              <span className="text-slate-500">Review</span>
              <span className="text-yellow-400 font-medium text-right">{b.stats?.underReview ?? 0}</span>
              <span className="text-slate-500">Approved</span>
              <span className="text-green-400 font-medium text-right">{b.stats?.approved ?? 0}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────────
const TAB_COMPONENTS: Record<TabKey, React.ComponentType> = {
  farmer: FarmerTab,
  trader: TraderTab,
  broker: BrokerTab,
  warehouseOp: WarehouseOpTab,
  marketMaker: MarketMakerTab,
};

export default function AdminStakeholders() {
  const [activeTab, setActiveTab] = useState<TabKey>("farmer");
  const { user } = useAuth();
  const [, navigate] = useLocation();

  if (user && user.role !== "admin") {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center text-slate-400">
        <div className="text-center">
          <XCircle className="w-12 h-12 mx-auto mb-4 text-red-400" />
          <p className="text-lg font-semibold text-white">Access Denied</p>
          <p className="text-sm mt-2">This page is restricted to administrators.</p>
          <Button className="mt-4" onClick={() => navigate("/dashboard")}>
            Go to Dashboard
          </Button>
        </div>
      </div>
    );
  }

  const ActiveTabComponent = TAB_COMPONENTS[activeTab];

  if (!user) return <PageSkeleton cards={4} tableRows={8} tableCols={5} />;
  return (
    <div className="min-h-screen bg-slate-950 text-white">
      {/* Header */}
      <div className="border-b border-slate-800 bg-slate-900/60 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-lg font-bold text-white">Stakeholder KYC Dashboard</h1>
            <p className="text-xs text-slate-500">Unified review queue for all participant types</p>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="border-slate-700 text-slate-300 hover:bg-slate-800"
            onClick={() => navigate("/admin")}
          >
            ← Admin Home
          </Button>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 py-6">
        {/* Tab Navigation */}
        <div className="flex gap-1 mb-6 bg-slate-800/40 rounded-xl p-1 overflow-x-auto">
          {TABS.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`
                flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium whitespace-nowrap transition-all
                ${activeTab === tab.key
                  ? "bg-slate-700 text-white shadow-sm"
                  : "text-slate-400 hover:text-slate-300 hover:bg-slate-700/40"
                }
              `}
            >
              <span className={activeTab === tab.key ? tab.color : ""}>{tab.icon}</span>
              {tab.label}
            </button>
          ))}
        </div>

        {/* Cross-Stakeholder Analytics Summary */}
        <CrossStakeholderSummary />

        {/* Active Tab Content */}
        <ActiveTabComponent />
      </div>
    </div>
  );
}
