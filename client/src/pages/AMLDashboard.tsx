import { useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { Flag, AlertTriangle, CheckCircle, Clock, Plus, RefreshCw, Download } from "lucide-react";
import { PageSkeleton } from "@/components/PageSkeleton";

type FlagStatus = "PENDING" | "UNDER_REVIEW" | "CLEARED" | "ESCALATED" | "SAR_FILED" | "ALL";
type Severity = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL" | "ALL";

function severityBadge(severity: string) {
  const colors: Record<string, string> = {
    LOW: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
    MEDIUM: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
    HIGH: "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200",
    CRITICAL: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
  };
  return (
    <span className={`px-2 py-0.5 rounded text-xs font-semibold ${colors[severity] ?? "bg-muted text-muted-foreground"}`}>
      {severity}
    </span>
  );
}

function statusBadge(status: string) {
  const colors: Record<string, string> = {
    PENDING: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
    UNDER_REVIEW: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
    CLEARED: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
    ESCALATED: "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200",
    SAR_FILED: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
  };
  return (
    <span className={`px-2 py-0.5 rounded text-xs font-semibold ${colors[status] ?? "bg-muted text-muted-foreground"}`}>
      {status.replace("_", " ")}
    </span>
  );
}

export default function AMLDashboard() {
  const { user } = useAuth();
  const utils = trpc.useUtils();

  const [flagStatus, setFlagStatus] = useState<FlagStatus>("PENDING");
  const [flagSeverity, setFlagSeverity] = useState<Severity>("ALL");
  const [flagOffset, setFlagOffset] = useState(0);
  const [selectedFlag, setSelectedFlag] = useState<number | null>(null);
  const [reviewStatus, setReviewStatus] = useState<"UNDER_REVIEW" | "CLEARED" | "ESCALATED" | "SAR_FILED">("UNDER_REVIEW");
  const [reviewNotes, setReviewNotes] = useState("");
  const [showReviewDialog, setShowReviewDialog] = useState(false);
  const [showRuleDialog, setShowRuleDialog] = useState(false);
  const [showExportDialog, setShowExportDialog] = useState(false);

  // New rule form
  const [ruleName, setRuleName] = useState("");
  const [ruleType, setRuleType] = useState("LARGE_TRANSACTION");
  const [ruleThreshold, setRuleThreshold] = useState("");
  const [ruleCount, setRuleCount] = useState("");
  const [ruleWindow, setRuleWindow] = useState("24");
  const [ruleSeverity, setRuleSeverity] = useState("MEDIUM");
  const [ruleDesc, setRuleDesc] = useState("");

  // Export form
  const [exportType, setExportType] = useState("AML_FLAGS");
  const [exportFormat, setExportFormat] = useState("CSV");

  const { data: flagsData, isLoading: flagsLoading } = trpc.aml.adminListFlags.useQuery({
    status: flagStatus,
    severity: flagSeverity,
    limit: 20,
    offset: flagOffset,
  });

  const { data: stats } = trpc.aml.adminGetFlagStats.useQuery();
  const { data: rules, isLoading: rulesLoading } = trpc.aml.adminListRules.useQuery();

  const reviewMutation = trpc.aml.adminReviewFlag.useMutation({
    onSuccess: () => {
      toast.success("Flag updated", { description: `Status changed to ${reviewStatus}` });
      utils.aml.adminListFlags.invalidate();
      utils.aml.adminGetFlagStats.invalidate();
      setShowReviewDialog(false);
      setReviewNotes("");
    },
    onError: (e) => toast.error("Error", { description: e.message }),
  });

  const createRuleMutation = trpc.aml.adminCreateRule.useMutation({
    onSuccess: () => {
      toast.success("Rule created", { description: `${ruleName} is now active` });
      utils.aml.adminListRules.invalidate();
      setShowRuleDialog(false);
      setRuleName(""); setRuleThreshold(""); setRuleCount(""); setRuleDesc("");
    },
    onError: (e) => toast.error("Error", { description: e.message }),
  });

  const toggleRuleMutation = trpc.aml.adminUpdateRule.useMutation({
    onSuccess: () => {
      utils.aml.adminListRules.invalidate();
      toast.success("Rule updated");
    },
    onError: (e) => toast.error("Error", { description: e.message }),
  });

  const exportMutation = trpc.aml.adminGenerateExport.useMutation({
    onSuccess: (data) => {
      toast.success("Export generated", { description: `${data?.recordCount ?? 0} records exported` });
      if (data?.fileUrl) window.open(data.fileUrl, "_blank");
      setShowExportDialog(false);
    },
    onError: (e) => toast.error("Export failed", { description: e.message }),
  });

  // Compute summary stats
  const pendingCount = stats?.filter((s) => s.status === "PENDING").reduce((a, b) => a + Number(b.cnt), 0) ?? 0;
  const criticalCount = stats?.filter((s) => s.severity === "CRITICAL").reduce((a, b) => a + Number(b.cnt), 0) ?? 0;
  const clearedCount = stats?.filter((s) => s.status === "CLEARED").reduce((a, b) => a + Number(b.cnt), 0) ?? 0;
  const sarCount = stats?.filter((s) => s.status === "SAR_FILED").reduce((a, b) => a + Number(b.cnt), 0) ?? 0;

  const isAdmin = (user as { role?: string })?.role === "admin";
  if (flagsLoading || rulesLoading) return <PageSkeleton cards={4} tableRows={8} tableCols={5} />;
  if (!isAdmin) {
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
      <div className="p-6 space-y-6 max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Flag className="h-6 w-6 text-red-500" />
              AML Compliance Dashboard
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Anti-Money Laundering monitoring, flag review, and suspicious activity reporting
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setShowExportDialog(true)}>
              <Download className="h-4 w-4 mr-2" />
              Export Report
            </Button>
            <Button size="sm" onClick={() => setShowRuleDialog(true)}>
              <Plus className="h-4 w-4 mr-2" />
              New Rule
            </Button>
          </div>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <Clock className="h-8 w-8 text-yellow-500" />
                <div>
                  <div className="text-2xl font-bold">{pendingCount}</div>
                  <div className="text-xs text-muted-foreground">Pending Review</div>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <AlertTriangle className="h-8 w-8 text-red-500" />
                <div>
                  <div className="text-2xl font-bold">{criticalCount}</div>
                  <div className="text-xs text-muted-foreground">Critical Flags</div>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <CheckCircle className="h-8 w-8 text-green-500" />
                <div>
                  <div className="text-2xl font-bold">{clearedCount}</div>
                  <div className="text-xs text-muted-foreground">Cleared</div>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <Flag className="h-8 w-8 text-orange-500" />
                <div>
                  <div className="text-2xl font-bold">{sarCount}</div>
                  <div className="text-xs text-muted-foreground">SARs Filed</div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Tabs */}
        <Tabs defaultValue="flags">
          <TabsList>
            <TabsTrigger value="flags">Flag Queue</TabsTrigger>
            <TabsTrigger value="rules">Detection Rules</TabsTrigger>
          </TabsList>

          {/* Flag Queue */}
          <TabsContent value="flags" className="space-y-4">
            <div className="flex gap-3 flex-wrap">
              <Select value={flagStatus} onValueChange={(v) => { setFlagStatus(v as FlagStatus); setFlagOffset(0); }}>
                <SelectTrigger className="w-44">
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All Statuses</SelectItem>
                  <SelectItem value="PENDING">Pending</SelectItem>
                  <SelectItem value="UNDER_REVIEW">Under Review</SelectItem>
                  <SelectItem value="CLEARED">Cleared</SelectItem>
                  <SelectItem value="ESCALATED">Escalated</SelectItem>
                  <SelectItem value="SAR_FILED">SAR Filed</SelectItem>
                </SelectContent>
              </Select>
              <Select value={flagSeverity} onValueChange={(v) => { setFlagSeverity(v as Severity); setFlagOffset(0); }}>
                <SelectTrigger className="w-40">
                  <SelectValue placeholder="Severity" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All Severities</SelectItem>
                  <SelectItem value="LOW">Low</SelectItem>
                  <SelectItem value="MEDIUM">Medium</SelectItem>
                  <SelectItem value="HIGH">High</SelectItem>
                  <SelectItem value="CRITICAL">Critical</SelectItem>
                </SelectContent>
              </Select>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => utils.aml.adminListFlags.invalidate()}
              >
                <RefreshCw className="h-4 w-4" />
              </Button>
            </div>

            <Card>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>ID</TableHead>
                      <TableHead>User</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Amount</TableHead>
                      <TableHead>Severity</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Reason</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead>Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {flagsLoading ? (
                      <TableRow>
                        <TableCell colSpan={9} className="text-center py-8 text-muted-foreground">
                          Loading flags...
                        </TableCell>
                      </TableRow>
                    ) : !flagsData?.flags?.length ? (
                      <TableRow>
                        <TableCell colSpan={9} className="text-center py-8 text-muted-foreground">
                          No flags found for the selected filters.
                        </TableCell>
                      </TableRow>
                    ) : (
                      flagsData.flags.map((flag) => (
                        <TableRow key={flag.id}>
                          <TableCell className="font-mono text-xs">#{flag.id}</TableCell>
                          <TableCell className="text-sm">User {flag.userId}</TableCell>
                          <TableCell className="text-xs">{flag.transactionType}</TableCell>
                          <TableCell className="text-sm font-medium">
                            {flag.amount ? `${flag.currency} ${parseFloat(flag.amount).toLocaleString()}` : "—"}
                          </TableCell>
                          <TableCell>{severityBadge(flag.severity)}</TableCell>
                          <TableCell>{statusBadge(flag.status)}</TableCell>
                          <TableCell className="max-w-xs">
                            <p className="text-xs text-muted-foreground truncate" title={flag.flagReason}>
                              {flag.flagReason}
                            </p>
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {new Date(flag.createdAt).toLocaleDateString()}
                          </TableCell>
                          <TableCell>
                            {flag.status !== "CLEARED" && flag.status !== "SAR_FILED" && (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => {
                                  setSelectedFlag(flag.id);
                                  setShowReviewDialog(true);
                                }}
                              >
                                Review
                              </Button>
                            )}
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            {/* Pagination */}
            {flagsData && flagsData.total > 20 && (
              <div className="flex items-center justify-between text-sm text-muted-foreground">
                <span>
                  Showing {flagOffset + 1}–{Math.min(flagOffset + 20, flagsData.total)} of {flagsData.total}
                </span>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={flagOffset === 0}
                    onClick={() => setFlagOffset(Math.max(0, flagOffset - 20))}
                  >
                    Previous
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={flagOffset + 20 >= flagsData.total}
                    onClick={() => setFlagOffset(flagOffset + 20)}
                  >
                    Next
                  </Button>
                </div>
              </div>
            )}
          </TabsContent>

          {/* Detection Rules */}
          <TabsContent value="rules" className="space-y-4">
            <Card>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Threshold</TableHead>
                      <TableHead>Window</TableHead>
                      <TableHead>Severity</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rulesLoading ? (
                      <TableRow>
                        <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                          Loading rules...
                        </TableCell>
                      </TableRow>
                    ) : !rules?.length ? (
                      <TableRow>
                        <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                          No rules configured. Create your first rule to start monitoring.
                        </TableCell>
                      </TableRow>
                    ) : (
                      rules.map((rule) => (
                        <TableRow key={rule.id}>
                          <TableCell className="font-medium">{rule.name}</TableCell>
                          <TableCell className="text-xs">{rule.ruleType.replace(/_/g, " ")}</TableCell>
                          <TableCell className="text-sm">
                            {rule.thresholdAmount
                              ? `${rule.currency} ${parseFloat(rule.thresholdAmount).toLocaleString()}`
                              : rule.thresholdCount
                              ? `${rule.thresholdCount} txns`
                              : "—"}
                          </TableCell>
                          <TableCell className="text-sm">{rule.windowHours}h</TableCell>
                          <TableCell>{severityBadge(rule.severity)}</TableCell>
                          <TableCell>
                            <Badge variant={rule.isActive ? "default" : "secondary"}>
                              {rule.isActive ? "Active" : "Inactive"}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() =>
                                toggleRuleMutation.mutate({ id: Number(rule.id), isActive: !rule.isActive })
                              }
                            >
                              {rule.isActive ? "Disable" : "Enable"}
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>

      {/* Review Flag Dialog */}
      <Dialog open={showReviewDialog} onOpenChange={setShowReviewDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Review Flag #{selectedFlag}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Update Status</Label>
              <Select value={reviewStatus} onValueChange={(v) => setReviewStatus(v as typeof reviewStatus)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="UNDER_REVIEW">Under Review</SelectItem>
                  <SelectItem value="CLEARED">Clear — No Suspicious Activity</SelectItem>
                  <SelectItem value="ESCALATED">Escalate to Compliance Officer</SelectItem>
                  <SelectItem value="SAR_FILED">SAR Filed</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Review Notes</Label>
              <Textarea
                value={reviewNotes}
                onChange={(e) => setReviewNotes(e.target.value)}
                placeholder="Add notes about your review decision..."
                rows={4}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowReviewDialog(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (!selectedFlag) return;
                reviewMutation.mutate({
                  flagId: selectedFlag,
                  status: reviewStatus,
                  reviewNotes: reviewNotes || undefined,
                });
              }}
              disabled={reviewMutation.isPending}
            >
              {reviewMutation.isPending ? "Saving..." : "Save Review"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create Rule Dialog */}
      <Dialog open={showRuleDialog} onOpenChange={setShowRuleDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Create AML Detection Rule</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Rule Name</Label>
              <Input
                value={ruleName}
                onChange={(e) => setRuleName(e.target.value)}
                placeholder="e.g., Large NGN Withdrawal"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Rule Type</Label>
                <Select value={ruleType} onValueChange={setRuleType}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="LARGE_TRANSACTION">Large Transaction</SelectItem>
                    <SelectItem value="RAPID_MOVEMENT">Rapid Movement</SelectItem>
                    <SelectItem value="STRUCTURING">Structuring</SelectItem>
                    <SelectItem value="UNUSUAL_PATTERN">Unusual Pattern</SelectItem>
                    <SelectItem value="SANCTIONS_MATCH">Sanctions Match</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Severity</Label>
                <Select value={ruleSeverity} onValueChange={setRuleSeverity}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="LOW">Low</SelectItem>
                    <SelectItem value="MEDIUM">Medium</SelectItem>
                    <SelectItem value="HIGH">High</SelectItem>
                    <SelectItem value="CRITICAL">Critical</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Threshold Amount (NGN)</Label>
                <Input
                  type="number"
                  value={ruleThreshold}
                  onChange={(e) => setRuleThreshold(e.target.value)}
                  placeholder="e.g., 5000000"
                />
              </div>
              <div>
                <Label>Transaction Count</Label>
                <Input
                  type="number"
                  value={ruleCount}
                  onChange={(e) => setRuleCount(e.target.value)}
                  placeholder="e.g., 5"
                />
              </div>
            </div>
            <div>
              <Label>Time Window (hours)</Label>
              <Input
                type="number"
                value={ruleWindow}
                onChange={(e) => setRuleWindow(e.target.value)}
                placeholder="24"
              />
            </div>
            <div>
              <Label>Description (optional)</Label>
              <Textarea
                value={ruleDesc}
                onChange={(e) => setRuleDesc(e.target.value)}
                placeholder="Describe the rule's purpose..."
                rows={2}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowRuleDialog(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (!ruleName) return;
                createRuleMutation.mutate({
                  name: ruleName,
                  ruleType: ruleType as "LARGE_TRANSACTION" | "RAPID_MOVEMENT" | "STRUCTURING" | "UNUSUAL_PATTERN" | "SANCTIONS_MATCH",
                  thresholdAmount: ruleThreshold ? parseFloat(ruleThreshold) : undefined,
                  thresholdCount: ruleCount ? parseInt(ruleCount) : undefined,
                  windowHours: parseInt(ruleWindow) || 24,
                  severity: ruleSeverity as "LOW" | "MEDIUM" | "HIGH" | "CRITICAL",
                  description: ruleDesc || undefined,
                });
              }}
              disabled={createRuleMutation.isPending || !ruleName}
            >
              {createRuleMutation.isPending ? "Creating..." : "Create Rule"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Export Dialog */}
      <Dialog open={showExportDialog} onOpenChange={setShowExportDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Generate Compliance Export</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Export Type</Label>
              <Select value={exportType} onValueChange={setExportType}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="AML_FLAGS">AML Flags Report</SelectItem>
                  <SelectItem value="SAR_SUMMARY">SAR Summary</SelectItem>
                  <SelectItem value="TRANSACTION_AUDIT">Transaction Audit</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Format</Label>
              <Select value={exportFormat} onValueChange={setExportFormat}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="CSV">CSV</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowExportDialog(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                exportMutation.mutate({
                  exportType: exportType as "AML_FLAGS" | "SAR_SUMMARY" | "TRANSACTION_AUDIT",
                  format: exportFormat as "CSV" | "PDF",
                });
              }}
              disabled={exportMutation.isPending}
            >
              {exportMutation.isPending ? "Generating..." : "Generate Export"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
