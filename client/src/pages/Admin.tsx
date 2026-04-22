/**
 * NEXCOM Exchange — Admin Dashboard
 * KYC review queue, user management, and audit log — fully wired to tRPC backend
 */
import { useState, useMemo } from "react";
import { useLocation } from "wouter";
import {
  Shield, Users, CheckCircle2, XCircle, Clock, Search,
  TrendingUp, FileText, AlertTriangle, Eye,
  Ban, RefreshCw, BarChart3, Activity, Loader2
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { PageSkeleton } from "@/components/PageSkeleton";

const KYC_STATUS_CONFIG = {
  PENDING:      { label: "Pending",      className: "badge-pending",   icon: Clock },
  UNDER_REVIEW: { label: "Under Review", className: "badge-pending",   icon: Clock },
  APPROVED:     { label: "Approved",     className: "badge-settled",   icon: CheckCircle2 },
  REJECTED:     { label: "Rejected",     className: "badge-cancelled", icon: XCircle },
  NEEDS_INFO:   { label: "Needs Info",   className: "badge-active",    icon: AlertTriangle },
} as const;

type KycStatus = keyof typeof KYC_STATUS_CONFIG;

const SEVERITY_CONFIG = {
  INFO:     { className: "text-muted-foreground", bg: "" },
  WARNING:  { className: "text-yellow-400",        bg: "bg-yellow-500/5" },
  CRITICAL: { className: "text-negative",          bg: "bg-negative/5" },
} as const;

export default function Admin() {
  const { user } = useAuth();
  const [, navigate] = useLocation();
  const [kycSearch, setKycSearch] = useState("");
  const [userSearch, setUserSearch] = useState("");
  const [kycFilter, setKycFilter] = useState("ALL");
  const [selectedKycId, setSelectedKycId] = useState<number | null>(null);
  const [reviewNotes, setReviewNotes] = useState("");
  const [confirmBanUserId, setConfirmBanUserId] = useState<number | null>(null);
  const utils = trpc.useUtils();

  // Guard: only admins
  if (user && user.role !== "admin") {
    return (
      <div className="page-container flex items-center justify-center min-h-[60vh]">
        <div className="text-center space-y-3">
          <Shield className="w-12 h-12 text-muted-foreground mx-auto" />
          <h2 className="text-xl font-bold text-foreground">Access Restricted</h2>
          <p className="text-muted-foreground text-sm">You do not have permission to access the Admin Dashboard.</p>
        </div>
      </div>
    );
  }

  // Live tRPC data
  const { data: kycData, isLoading: kycLoading, refetch: refetchKyc } = trpc.onboarding.adminList.useQuery(
    { status: "ALL", limit: 100, offset: 0 },
    { enabled: user?.role === "admin" }
  );
  const { data: usersData, isLoading: usersLoading, refetch: refetchUsers } = trpc.profile.listUsers.useQuery(
    { page: 1, limit: 100 },
    { enabled: user?.role === "admin" }
  );
  const { data: auditData, isLoading: auditLoading, refetch: refetchAudit } = trpc.analytics.auditLog.useQuery(
    { page: 1, limit: 50 },
    { enabled: user?.role === "admin" }
  );
  const { data: analyticsData } = trpc.analytics.summary.useQuery(
    undefined,
    { enabled: user?.role === "admin" }
  );

  const reviewMutation = trpc.onboarding.adminReview.useMutation({
    onSuccess: (_, vars) => {
      toast.success(`KYC application ${vars.decision.toLowerCase()}`);
      setSelectedKycId(null);
      setReviewNotes("");
      refetchKyc();
    },
    onError: (e) => toast.error(e.message),
  });

  const updateRoleMutation = trpc.profile.updateRole.useMutation({
    onSuccess: () => { toast.success("User role updated"); refetchUsers(); },
    onError: (e) => toast.error(e.message),
  });

  const kycList = kycData ?? [];
  const usersList = usersData?.users ?? [];
  const auditList = auditData?.logs ?? [];

  const selectedKyc = kycList.find(k => k.id === selectedKycId) ?? null;

  const filteredKyc = useMemo(() => kycList.filter(k => {
    const matchSearch = !kycSearch ||
      (k.userName ?? "").toLowerCase().includes(kycSearch.toLowerCase()) ||
      (k.userEmail ?? "").toLowerCase().includes(kycSearch.toLowerCase());
    const matchFilter = kycFilter === "ALL" || k.status === kycFilter;
    return matchSearch && matchFilter;
  }), [kycList, kycSearch, kycFilter]);

  const filteredUsers = useMemo(() => usersList.filter(u =>
    !userSearch ||
    (u.name ?? "").toLowerCase().includes(userSearch.toLowerCase()) ||
    (u.email ?? "").toLowerCase().includes(userSearch.toLowerCase())
  ), [usersList, userSearch]);

  const pendingCount = kycList.filter(k => k.status === "PENDING" || k.status === "UNDER_REVIEW").length;

  const handleRefresh = () => {
    refetchKyc();
    refetchUsers();
    refetchAudit();
    toast.info("Data refreshed");
  };

  return (
    <div className="page-container space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2" style={{ fontFamily: "'DM Serif Display', serif" }}>
            <Shield className="w-6 h-6 text-primary" />
            Admin Dashboard
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">Exchange operations, compliance, and user management</p>
        </div>
        <Button variant="outline" size="sm" className="gap-2" onClick={handleRefresh}>
          <RefreshCw className="w-3.5 h-3.5" />Refresh
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "KYC Pending",  value: String(pendingCount),               color: "text-yellow-400", icon: Clock },
          { label: "Total Users",  value: String(usersData?.total ?? 0),       color: "text-positive",   icon: Users },
          { label: "Total Volume", value: analyticsData ? `$${(Number(analyticsData.totalVolume) / 1_000_000).toFixed(1)}M` : "—", color: "text-primary", icon: TrendingUp },
          { label: "Audit Alerts", value: String(auditList.filter(a => (a.details as Record<string, unknown>)?.severity === "CRITICAL").length), color: "text-negative", icon: AlertTriangle },
        ].map(({ label, value, color, icon: Icon }) => (
          <div key={label} className="stat-card">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-muted-foreground">{label}</span>
              <Icon className={"w-4 h-4 " + color} />
            </div>
            <div className={"text-2xl font-bold font-mono " + color}>{value}</div>
          </div>
        ))}
      </div>

      <Tabs defaultValue="kyc">
        <TabsList>
          <TabsTrigger value="kyc" className="gap-1.5">
            <FileText className="w-3.5 h-3.5" />KYC Queue
            {pendingCount > 0 && <Badge className="bg-yellow-500 text-black text-[10px] h-4 px-1">{pendingCount}</Badge>}
          </TabsTrigger>
          <TabsTrigger value="users" className="gap-1.5">
            <Users className="w-3.5 h-3.5" />Users
          </TabsTrigger>
          <TabsTrigger value="audit" className="gap-1.5">
            <Activity className="w-3.5 h-3.5" />Audit Log
          </TabsTrigger>
          <TabsTrigger value="stats" className="gap-1.5">
            <BarChart3 className="w-3.5 h-3.5" />Exchange Stats
          </TabsTrigger>
        </TabsList>

        {/* KYC Queue */}
        <TabsContent value="kyc" className="mt-4 space-y-3">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input placeholder="Search applicant..." value={kycSearch} onChange={e => setKycSearch(e.target.value)} className="pl-9" />
            </div>
            <Select value={kycFilter} onValueChange={setKycFilter}>
              <SelectTrigger className="w-full sm:w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All Status</SelectItem>
                <SelectItem value="PENDING">Pending</SelectItem>
                <SelectItem value="UNDER_REVIEW">Under Review</SelectItem>
                <SelectItem value="APPROVED">Approved</SelectItem>
                <SelectItem value="REJECTED">Rejected</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {kycLoading ? (
            <div className="flex items-center justify-center py-12 text-muted-foreground">
              <Loader2 className="w-5 h-5 animate-spin mr-2" />Loading KYC applications...
            </div>
          ) : (
            <div className="rounded-xl border border-border overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-secondary/50">
                    <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Applicant</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider hidden md:table-cell">Submitted</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Status</th>
                    <th className="text-right px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {filteredKyc.length === 0 && (
                    <tr><td colSpan={4} className="px-4 py-8 text-center text-muted-foreground text-sm">No KYC applications found.</td></tr>
                  )}
                  {filteredKyc.map(k => {
                    const cfg = KYC_STATUS_CONFIG[k.status as KycStatus] ?? KYC_STATUS_CONFIG.PENDING;
                    const StatusIcon = cfg.icon;
                    return (
                      <tr key={k.id} className="hover:bg-secondary/30 transition-colors">
                        <td className="px-4 py-3">
                          <div className="font-medium text-foreground">{k.userName ?? `User #${k.userId}`}</div>
                          <div className="text-xs text-muted-foreground">{k.userEmail ?? "—"}</div>
                        </td>
                        <td className="px-4 py-3 text-xs text-muted-foreground hidden md:table-cell">
                          {new Date(k.submittedAt).toLocaleDateString()}
                        </td>
                        <td className="px-4 py-3">
                          <Badge className={"text-[10px] " + cfg.className}>
                            <StatusIcon className="w-3 h-3 mr-1" />{cfg.label}
                          </Badge>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex items-center justify-end gap-1">
                            <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={() => setSelectedKycId(k.id)}>
                              <Eye className="w-3 h-3" />Review
                            </Button>
                            {(k.status === "PENDING" || k.status === "UNDER_REVIEW") && (
                              <>
                                <Button size="sm" className="h-7 text-xs gap-1 bg-positive hover:bg-positive/90 text-white"
                                  disabled={reviewMutation.isPending}
                                  onClick={() => reviewMutation.mutate({ applicationId: k.id, decision: "APPROVED" })}>
                                  <CheckCircle2 className="w-3 h-3" />
                                </Button>
                                <Button size="sm" className="h-7 text-xs gap-1 bg-negative hover:bg-negative/90 text-white"
                                  disabled={reviewMutation.isPending}
                                  onClick={() => reviewMutation.mutate({ applicationId: k.id, decision: "REJECTED" })}>
                                  <XCircle className="w-3 h-3" />
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
            </div>
          )}
        </TabsContent>

        {/* Users */}
        <TabsContent value="users" className="mt-4 space-y-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input placeholder="Search users..." value={userSearch} onChange={e => setUserSearch(e.target.value)} className="pl-9" />
          </div>

          {usersLoading ? (
            <div className="flex items-center justify-center py-12 text-muted-foreground">
              <Loader2 className="w-5 h-5 animate-spin mr-2" />Loading users...
            </div>
          ) : (
            <div className="rounded-xl border border-border overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-secondary/50">
                    <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">User</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider hidden sm:table-cell">Role</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider hidden md:table-cell">Joined</th>
                    <th className="text-right px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {filteredUsers.length === 0 && (
                    <tr><td colSpan={4} className="px-4 py-8 text-center text-muted-foreground text-sm">No users found.</td></tr>
                  )}
                  {filteredUsers.map(u => (
                    <tr key={u.id} className="hover:bg-secondary/30 transition-colors">
                      <td className="px-4 py-3">
                        <div className="font-medium text-foreground">{u.name ?? "—"}</div>
                        <div className="text-xs text-muted-foreground">{u.email ?? "—"}</div>
                      </td>
                      <td className="px-4 py-3 hidden sm:table-cell">
                        <Badge variant={u.role === "admin" ? "default" : "outline"} className="text-[10px]">
                          {u.role}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground hidden md:table-cell">
                        {u.createdAt ? new Date(u.createdAt).toLocaleDateString() : "—"}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => navigate(`/admin/users/${u.id}`)}>
                            <Eye className="w-3 h-3" />
                          </Button>
                          {u.role !== "admin" && (
                            <Button size="sm" className="h-7 text-xs bg-negative/20 text-negative hover:bg-negative/30 border border-negative/30"
                              disabled={updateRoleMutation.isPending}
                              title="Demote to basic user"
                              onClick={() => setConfirmBanUserId(u.id)}>
                              <Ban className="w-3 h-3" />
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </TabsContent>

        {/* Audit Log */}
        <TabsContent value="audit" className="mt-4 space-y-2">
          {auditLoading ? (
            <div className="flex items-center justify-center py-12 text-muted-foreground">
              <Loader2 className="w-5 h-5 animate-spin mr-2" />Loading audit log...
            </div>
          ) : auditList.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground text-sm rounded-xl border border-border">
              No audit log entries yet.
            </div>
          ) : (
            auditList.map(entry => {
              const details = entry.details as Record<string, unknown> | null;
              const severity = (details?.severity as string) ?? "INFO";
              const cfg = SEVERITY_CONFIG[severity as keyof typeof SEVERITY_CONFIG] ?? SEVERITY_CONFIG.INFO;
  if (kycLoading) return <PageSkeleton cards={4} tableRows={8} tableCols={5} />;
              return (
                <div key={entry.id} className={"flex items-start gap-3 p-3 rounded-xl border border-border " + cfg.bg}>
                  <div className={"w-2 h-2 rounded-full mt-1.5 flex-shrink-0 " + (
                    severity === "CRITICAL" ? "bg-negative" :
                    severity === "WARNING" ? "bg-yellow-400" : "bg-muted-foreground"
                  )} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <span className={"text-xs font-mono font-bold " + cfg.className}>{entry.action}</span>
                      <span className="text-[10px] text-muted-foreground">{new Date(entry.createdAt).toLocaleString()}</span>
                    </div>
                    <p className="text-xs text-foreground mt-0.5">
                      {typeof details === "object" && details !== null
                        ? JSON.stringify(details, null, 0).replace(/[{}"]/g, "").replace(/,/g, " · ")
                        : String(details ?? "")}
                    </p>
                    <div className="flex items-center gap-2 mt-1 text-[10px] text-muted-foreground">
                      <span>User ID: {entry.userId}</span>
                      <span>·</span>
                      <span>Resource: {entry.resource} #{entry.resourceId}</span>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </TabsContent>

        {/* Exchange Stats */}
        <TabsContent value="stats" className="mt-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {([
              { label: "Total Volume",      value: analyticsData ? `$${(Number(analyticsData.totalVolume) / 1_000_000).toFixed(1)}M` : "—" },
              { label: "Total Orders",      value: analyticsData ? String(analyticsData.totalOrders ?? 0) : "—" },
              { label: "Active Users",       value: String(usersData?.total ?? 0) },
              { label: "KYC Applications",   value: String(kycList.length) },
            ]).map(s => (
              <div key={s.label} className="stat-card">
                <div className="text-xs text-muted-foreground">{s.label}</div>
                <div className="text-2xl font-bold font-mono text-foreground mt-1">{s.value}</div>
              </div>
            ))}
          </div>
        </TabsContent>
      </Tabs>

      {/* KYC Detail Dialog */}
      <Dialog open={!!selectedKyc} onOpenChange={() => { setSelectedKycId(null); setReviewNotes(""); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>KYC Application #{selectedKyc?.id}</DialogTitle>
            <DialogDescription>{selectedKyc?.userName ?? `User #${selectedKyc?.userId}`}</DialogDescription>
          </DialogHeader>
          {selectedKyc && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                {[
                  ["Name",      selectedKyc.userName ?? "—"],
                  ["Email",     selectedKyc.userEmail ?? "—"],
                  ["Submitted", new Date(selectedKyc.submittedAt).toLocaleDateString()],
                  ["Status",    selectedKyc.status],
                ].map(([k, v]) => (
                  <div key={k} className="rounded-lg bg-secondary/50 p-3">
                    <div className="text-xs text-muted-foreground">{k}</div>
                    <div className="text-sm font-semibold mt-0.5 text-foreground">{v}</div>
                  </div>
                ))}
              </div>
              {Array.isArray(selectedKyc.documents) && selectedKyc.documents.length > 0 && (
                <div>
                  <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Submitted Documents</div>
                  <div className="flex flex-wrap gap-2">
                    {(selectedKyc.documents as string[]).map(doc => (
                      <Badge key={doc} variant="outline" className="gap-1">
                        <FileText className="w-3 h-3" />{doc}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
              {selectedKyc.reviewNotes && (
                <div className="rounded-lg bg-secondary/50 p-3">
                  <div className="text-xs text-muted-foreground mb-1">Review Notes</div>
                  <div className="text-sm text-foreground">{selectedKyc.reviewNotes}</div>
                </div>
              )}
              <div className="space-y-1.5">
                <label className="text-xs text-muted-foreground">Notes (optional)</label>
                <Input
                  placeholder="Add review notes..."
                  value={reviewNotes}
                  onChange={e => setReviewNotes(e.target.value)}
                />
              </div>
              {(selectedKyc.status === "PENDING" || selectedKyc.status === "UNDER_REVIEW") && (
                <div className="flex gap-2 pt-2">
                  <Button variant="outline" className="flex-1 gap-2 text-negative border-negative/30 hover:bg-negative/10"
                    disabled={reviewMutation.isPending}
                    onClick={() => reviewMutation.mutate({ applicationId: selectedKyc.id, decision: "REJECTED", notes: reviewNotes || undefined })}>
                    <XCircle className="w-4 h-4" />Reject
                  </Button>
                  <Button className="flex-1 gap-2 bg-positive hover:bg-positive/90 text-white"
                    disabled={reviewMutation.isPending}
                    onClick={() => reviewMutation.mutate({ applicationId: selectedKyc.id, decision: "APPROVED", notes: reviewNotes || undefined })}>
                    {reviewMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                    Approve
                  </Button>
                </div>
              )}
              {selectedKyc.status !== "PENDING" && selectedKyc.status !== "UNDER_REVIEW" && (
                <Badge className={"w-full justify-center py-2 " + (KYC_STATUS_CONFIG[selectedKyc.status as KycStatus]?.className ?? "badge-pending")}>
                  {KYC_STATUS_CONFIG[selectedKyc.status as KycStatus]?.label ?? selectedKyc.status}
                </Badge>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Confirm demote dialog */}
      <Dialog open={confirmBanUserId !== null} onOpenChange={open => { if (!open) setConfirmBanUserId(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Demote User</DialogTitle>
            <DialogDescription>This will reset the user's role to "user". They will lose any elevated permissions. Continue?</DialogDescription>
          </DialogHeader>
          <div className="flex gap-2 pt-2">
            <Button variant="outline" className="flex-1" onClick={() => setConfirmBanUserId(null)}>Cancel</Button>
            <Button className="flex-1 bg-negative hover:bg-negative/90 text-white"
              disabled={updateRoleMutation.isPending}
              onClick={() => {
                if (confirmBanUserId !== null) {
                  updateRoleMutation.mutate({ userId: confirmBanUserId, role: "user" });
                  setConfirmBanUserId(null);
                }
              }}>
              {updateRoleMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Demote to User"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
