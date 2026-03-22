/**
 * Admin Re-KYC Flags Page
 * Shows stakeholders flagged for periodic re-verification (KYC older than 12 months).
 * Admins can send reminders or dismiss flags.
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { getLoginUrl } from "@/const";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  UserCheck,
  Bell,
  CheckCircle2,
  AlertCircle,
  Clock,
  RefreshCw,
  Users,
  Settings2,
  Save,
} from "lucide-react";
import { toast } from "sonner";
import { Link } from "wouter";

// ─── Stakeholder type badge ───────────────────────────────────────────────────
function StakeholderBadge({ type }: { type: string }) {
  const map: Record<string, { label: string; className: string }> = {
    FARMER:             { label: "Farmer",           className: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30" },
    TRADER:             { label: "Trader",           className: "bg-blue-500/20 text-blue-400 border-blue-500/30" },
    BROKER:             { label: "Broker",           className: "bg-purple-500/20 text-purple-400 border-purple-500/30" },
    WAREHOUSE_OPERATOR: { label: "Warehouse Op",     className: "bg-amber-500/20 text-amber-400 border-amber-500/30" },
    MARKET_MAKER:       { label: "Market Maker",     className: "bg-cyan-500/20 text-cyan-400 border-cyan-500/30" },
  };
  const { label, className } = map[type] ?? { label: type, className: "bg-muted/40 text-muted-foreground border-border" };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border ${className}`}>
      {label}
    </span>
  );
}

// ─── KYC Threshold Settings Panel ────────────────────────────────────────────
function KycThresholdPanel() {
  const utils = trpc.useUtils();
  const { data: thresholdData, isLoading } = trpc.kycAnalysis.getKycThreshold.useQuery();
  const [threshold, setThreshold] = useState<string>("");
  const [autoApprove, setAutoApprove] = useState(false);
  const [initialized, setInitialized] = useState(false);

  if (!isLoading && thresholdData && !initialized) {
    setThreshold(String(thresholdData.threshold));
    setAutoApprove(thresholdData.autoApproveAboveThreshold);
    setInitialized(true);
  }

  const setThresholdMutation = trpc.kycAnalysis.setKycThreshold.useMutation({
    onSuccess: (data) => {
      toast.success(`KYC threshold updated to ${(data.threshold * 100).toFixed(0)}%.`);
      utils.kycAnalysis.getKycThreshold.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  const handleSave = () => {
    const val = parseFloat(threshold);
    if (isNaN(val) || val < 0 || val > 1) {
      toast.error("Threshold must be a number between 0 and 1 (e.g. 0.7 for 70%).");
      return;
    }
    setThresholdMutation.mutate({ threshold: val, autoApproveAboveThreshold: autoApprove });
  };

  return (
    <Card className="border-border">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Settings2 className="h-4 w-4 text-primary" />
          KYC Confidence Threshold
        </CardTitle>
        <CardDescription className="text-xs">
          Documents scoring below this threshold are flagged for manual review. Range: 0–1 (e.g. 0.7 = 70%).
          Auto-approve will automatically pass submissions above the threshold (excluding CRITICAL risk).
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <p className="text-xs text-muted-foreground">Loading settings…</p>
        ) : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="kyc-threshold" className="text-xs font-medium">
                  Confidence Threshold (0–1)
                </Label>
                <div className="flex items-center gap-2">
                  <Input
                    id="kyc-threshold"
                    type="number"
                    min={0}
                    max={1}
                    step={0.05}
                    value={threshold}
                    onChange={e => setThreshold(e.target.value)}
                    className="h-8 text-sm w-28"
                  />
                  <span className="text-xs text-muted-foreground">
                    = {threshold ? (parseFloat(threshold) * 100).toFixed(0) : "—"}% minimum score
                  </span>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Auto-Approve Above Threshold</Label>
                <div className="flex items-center gap-2 pt-1">
                  <Switch
                    checked={autoApprove}
                    onCheckedChange={setAutoApprove}
                    id="auto-approve"
                  />
                  <Label htmlFor="auto-approve" className="text-xs text-muted-foreground cursor-pointer">
                    {autoApprove ? "Enabled — submissions ≥ threshold auto-approved" : "Disabled — all submissions require manual review"}
                  </Label>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Button
                size="sm"
                className="gap-1.5"
                onClick={handleSave}
                disabled={setThresholdMutation.isPending}
              >
                <Save className="h-3.5 w-3.5" />
                {setThresholdMutation.isPending ? "Saving…" : "Save Settings"}
              </Button>
              {thresholdData && (
                <p className="text-xs text-muted-foreground">
                  Current: <span className="font-medium">{(thresholdData.threshold * 100).toFixed(0)}%</span>
                  {" · "}
                  Auto-approve: <span className="font-medium">{thresholdData.autoApproveAboveThreshold ? "On" : "Off"}</span>
                </p>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────
export default function AdminReKycFlags() {
  const { isAuthenticated, loading, user } = useAuth();
  const [includeResolved, setIncludeResolved] = useState(false);
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 50;

  const utils = trpc.useUtils();

  const { data, isLoading, refetch } = trpc.kycAnalysis.listReKycFlags.useQuery(
    { includeResolved, page, pageSize: PAGE_SIZE },
    { enabled: isAuthenticated && user?.role === "admin" },
  );

  const dismissMutation = trpc.kycAnalysis.dismissReKycFlag.useMutation({
    onSuccess: () => {
      toast.success("Flag dismissed.");
      utils.kycAnalysis.listReKycFlags.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  const reminderMutation = trpc.kycAnalysis.sendReKycReminder.useMutation({
    onSuccess: (res) => {
      const extra = res.emailFallbackSent ? " Owner email alert sent." : "";
      toast.success(`Re-KYC reminder sent to stakeholder.${extra}`);
      utils.kycAnalysis.listReKycFlags.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh] text-muted-foreground">
        Loading…
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4 text-center px-4">
        <UserCheck className="h-12 w-12 text-muted-foreground" />
        <h2 className="text-xl font-semibold">Sign in to access Re-KYC Flags</h2>
        <Button asChild>
          <a href={getLoginUrl()}>Sign In</a>
        </Button>
      </div>
    );
  }

  if (user?.role !== "admin") {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4 text-center px-4">
        <AlertCircle className="h-12 w-12 text-amber-500" />
        <h2 className="text-xl font-semibold">Admin Access Required</h2>
        <p className="text-muted-foreground max-w-sm">
          The Re-KYC Flags page is only accessible to NEXCOM administrators.
        </p>
        <Button variant="outline" asChild>
          <Link href="/">Go to Dashboard</Link>
        </Button>
      </div>
    );
  }

  const flags = data?.flags ?? [];
  const total = data?.total ?? 0;

  // Summary stats
  const pendingCount = flags.filter(f => !f.resolvedAt).length;
  const notifiedCount = flags.filter(f => f.notifiedAt && !f.resolvedAt).length;
  const resolvedCount = flags.filter(f => f.resolvedAt).length;

  return (
    <div className="space-y-6 p-4 lg:p-6 max-w-6xl mx-auto">
      {/* ── Header ── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <UserCheck className="h-6 w-6 text-emerald-500" />
            Re-KYC Flags
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Stakeholders whose KYC was approved more than 12 months ago and require re-verification.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => refetch()}
          className="gap-1.5"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          Refresh
        </Button>
      </div>

      {/* ── KYC Threshold Settings ── */}
      <KycThresholdPanel />

      {/* ── Summary cards ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card className="bg-muted/30">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <Users className="h-4 w-4 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">Total Flags</span>
            </div>
            <p className="text-2xl font-bold">{total}</p>
          </CardContent>
        </Card>
        <Card className="bg-amber-500/10 border-amber-500/20">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <Clock className="h-4 w-4 text-amber-500" />
              <span className="text-xs text-muted-foreground">Pending Action</span>
            </div>
            <p className="text-2xl font-bold text-amber-500">{pendingCount}</p>
          </CardContent>
        </Card>
        <Card className="bg-blue-500/10 border-blue-500/20">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <Bell className="h-4 w-4 text-blue-500" />
              <span className="text-xs text-muted-foreground">Notified</span>
            </div>
            <p className="text-2xl font-bold text-blue-500">{notifiedCount}</p>
          </CardContent>
        </Card>
        <Card className="bg-emerald-500/10 border-emerald-500/20">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <CheckCircle2 className="h-4 w-4 text-emerald-500" />
              <span className="text-xs text-muted-foreground">Resolved</span>
            </div>
            <p className="text-2xl font-bold text-emerald-500">{resolvedCount}</p>
          </CardContent>
        </Card>
      </div>

      {/* ── Filters ── */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2">
          <Switch
            id="include-resolved"
            checked={includeResolved}
            onCheckedChange={v => { setIncludeResolved(v); setPage(1); }}
          />
          <Label htmlFor="include-resolved" className="text-sm cursor-pointer">
            Show resolved flags
          </Label>
        </div>
        {total > 0 && (
          <span className="text-sm text-muted-foreground ml-auto">
            {total} flag{total !== 1 ? "s" : ""} total
          </span>
        )}
      </div>

      {/* ── Table ── */}
      {isLoading && (
        <div className="flex items-center justify-center py-12 text-muted-foreground text-sm">
          <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-emerald-500 mr-2" />
          Loading flags…
        </div>
      )}

      {!isLoading && flags.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-center gap-3">
          <UserCheck className="h-12 w-12 text-muted-foreground/40" />
          <p className="text-muted-foreground font-medium">
            {includeResolved ? "No Re-KYC flags found." : "No active Re-KYC flags — all stakeholders are up to date."}
          </p>
          <p className="text-xs text-muted-foreground max-w-sm">
            The Re-KYC scheduler runs daily and flags stakeholders whose KYC was approved more than 12 months ago.
          </p>
        </div>
      )}

      {!isLoading && flags.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Flagged Stakeholders</CardTitle>
            <CardDescription>
              Send reminders to prompt re-verification, or dismiss flags that have been resolved outside the system.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <div className="rounded-b-lg overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>User ID</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Reason</TableHead>
                    <TableHead>KYC Approved</TableHead>
                    <TableHead>Notified</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {flags.map(flag => (
                    <TableRow key={flag.id} className={flag.resolvedAt ? "opacity-50" : ""}>
                      <TableCell className="font-mono text-xs">#{flag.userId}</TableCell>
                      <TableCell>
                        <StakeholderBadge type={flag.stakeholderType} />
                      </TableCell>
                      <TableCell className="max-w-[200px]">
                        <p className="text-xs text-muted-foreground truncate" title={flag.reason}>
                          {flag.reason}
                        </p>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {flag.kycApprovedAt
                          ? new Date(flag.kycApprovedAt).toLocaleDateString()
                          : "—"}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {flag.notifiedAt
                          ? new Date(flag.notifiedAt).toLocaleDateString()
                          : <span className="text-amber-500">Not sent</span>}
                      </TableCell>
                      <TableCell>
                        {flag.resolvedAt ? (
                          <Badge variant="outline" className="text-xs">
                            Resolved {new Date(flag.resolvedAt).toLocaleDateString()}
                          </Badge>
                        ) : (
                          <Badge variant="secondary" className="text-xs">Active</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        {!flag.resolvedAt && (
                          <div className="flex items-center justify-end gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              className="gap-1 text-xs h-7"
                              disabled={reminderMutation.isPending}
                              onClick={() => reminderMutation.mutate({ flagId: flag.id })}
                            >
                              <Bell className="h-3 w-3" />
                              Remind
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="gap-1 text-xs h-7 text-muted-foreground hover:text-foreground"
                              disabled={dismissMutation.isPending}
                              onClick={() => dismissMutation.mutate({ flagId: flag.id })}
                            >
                              <CheckCircle2 className="h-3 w-3" />
                              Dismiss
                            </Button>
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Pagination ── */}
      {total > PAGE_SIZE && (
        <div className="flex items-center justify-center gap-3">
          <Button
            variant="outline"
            size="sm"
            disabled={page <= 1}
            onClick={() => setPage(p => p - 1)}
          >
            Previous
          </Button>
          <span className="text-sm text-muted-foreground">
            Page {page} of {Math.ceil(total / PAGE_SIZE)}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= Math.ceil(total / PAGE_SIZE)}
            onClick={() => setPage(p => p + 1)}
          >
            Next
          </Button>
        </div>
      )}

      {/* ── Scheduler info ── */}
      <Card className="bg-muted/20 border-dashed">
        <CardContent className="p-4">
          <p className="text-xs text-muted-foreground">
            <span className="font-medium">Scheduler:</span> The Re-KYC scheduler runs every 24 hours and automatically flags stakeholders
            with KYC approved more than 12 months ago. High-volume traders/brokers/market-makers (≥5 orders in 30 days)
            and active farmers/warehouse operators (≥2 active listings) are prioritized.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
