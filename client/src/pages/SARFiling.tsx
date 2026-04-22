import { useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Card, CardContent } from "@/components/ui/card";
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
import { toast } from "sonner";
import { FileWarning, Plus, RefreshCw } from "lucide-react";
import { PageSkeleton } from "@/components/PageSkeleton";

type SARStatus = "DRAFT" | "SUBMITTED" | "ACKNOWLEDGED" | "CLOSED" | "ALL";

function sarStatusBadge(status: string) {
  const colors: Record<string, string> = {
    DRAFT: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
    SUBMITTED: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
    ACKNOWLEDGED: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
    CLOSED: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  };
  return (
    <span
      className={`px-2 py-0.5 rounded text-xs font-semibold ${
        colors[status] ?? "bg-muted text-muted-foreground"
      }`}
    >
      {status.replace("_", " ")}
    </span>
  );
}

export default function SARFiling() {
  const { user } = useAuth();
  const utils = trpc.useUtils();

  const [statusFilter, setStatusFilter] = useState<SARStatus>("ALL");
  const [offset, setOffset] = useState(0);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showUpdateDialog, setShowUpdateDialog] = useState(false);
  const [selectedSAR, setSelectedSAR] = useState<number | null>(null);

  // Create SAR form
  const [subjectUserId, setSubjectUserId] = useState("");
  const [subjectName, setSubjectName] = useState("");
  const [activityType, setActivityType] = useState("STRUCTURING");
  const [activityDesc, setActivityDesc] = useState("");
  const [activityStart, setActivityStart] = useState("");
  const [activityEnd, setActivityEnd] = useState("");
  const [totalAmount, setTotalAmount] = useState("");
  const [linkedFlagId, setLinkedFlagId] = useState("");

  // Update status form
  const [updateStatus, setUpdateStatus] = useState<"SUBMITTED" | "ACKNOWLEDGED" | "CLOSED">("SUBMITTED");
  const [regulatoryRef, setRegulatoryRef] = useState("");

  const { data: sarsData, isLoading } = trpc.aml.adminListSARs.useQuery({
    status: statusFilter,
    limit: 20,
    offset,
  });

  const createMutation = trpc.aml.adminCreateSAR.useMutation({
    onSuccess: (data) => {
      toast.success("SAR created", {
        description: `Report ${data.reportNumber} has been filed`,
      });
      utils.aml.adminListSARs.invalidate();
      setShowCreateDialog(false);
      setSubjectUserId("");
      setSubjectName("");
      setActivityDesc("");
      setActivityStart("");
      setActivityEnd("");
      setTotalAmount("");
      setLinkedFlagId("");
    },
    onError: (e) => toast.error("Error filing SAR", { description: e.message }),
  });

  const updateMutation = trpc.aml.adminUpdateSARStatus.useMutation({
    onSuccess: () => {
      toast.success("SAR status updated");
      utils.aml.adminListSARs.invalidate();
      setShowUpdateDialog(false);
      setRegulatoryRef("");
    },
    onError: (e) => toast.error("Error updating SAR", { description: e.message }),
  });

  const isAdmin = (user as { role?: string })?.role === "admin";
  if (!isAdmin) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center h-64">
          <p className="text-muted-foreground">Admin access required.</p>
        </div>
      </DashboardLayout>
    );
  }

  const sars = sarsData?.sars ?? [];
  const total = sarsData?.total ?? 0;

  if (isLoading) return <PageSkeleton cards={4} tableRows={8} tableCols={4} />;
  return (
    <DashboardLayout>
      <div className="p-6 space-y-6 max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <FileWarning className="h-6 w-6 text-orange-500" />
              SAR Filing
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Suspicious Activity Reports — submit, track, and manage regulatory filings
            </p>
          </div>
          <Button size="sm" onClick={() => setShowCreateDialog(true)}>
            <Plus className="h-4 w-4 mr-2" />
            File New SAR
          </Button>
        </div>

        {/* Filters */}
        <div className="flex gap-3 flex-wrap">
          <Select
            value={statusFilter}
            onValueChange={(v) => {
              setStatusFilter(v as SARStatus);
              setOffset(0);
            }}
          >
            <SelectTrigger className="w-44">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All Statuses</SelectItem>
              <SelectItem value="DRAFT">Draft</SelectItem>
              <SelectItem value="SUBMITTED">Submitted</SelectItem>
              <SelectItem value="ACKNOWLEDGED">Acknowledged</SelectItem>
              <SelectItem value="CLOSED">Closed</SelectItem>
            </SelectContent>
          </Select>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => utils.aml.adminListSARs.invalidate()}
          >
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>

        {/* SAR Table */}
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Report #</TableHead>
                  <TableHead>Subject</TableHead>
                  <TableHead>Activity Type</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Filed By</TableHead>
                  <TableHead>Activity Period</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell
                      colSpan={8}
                      className="text-center py-8 text-muted-foreground"
                    >
                      Loading SARs...
                    </TableCell>
                  </TableRow>
                ) : !sars.length ? (
                  <TableRow>
                    <TableCell
                      colSpan={8}
                      className="text-center py-8 text-muted-foreground"
                    >
                      No SARs found. File a new SAR when suspicious activity is
                      detected.
                    </TableCell>
                  </TableRow>
                ) : (
                  sars.map((sar) => (
                    <TableRow key={sar.id}>
                      <TableCell className="font-mono text-xs font-semibold">
                        {sar.reportNumber}
                      </TableCell>
                      <TableCell className="text-sm">
                        {sar.subjectName ?? `User ${sar.userId}`}
                      </TableCell>
                      <TableCell className="text-xs">
                        {sar.activityType.replace(/_/g, " ")}
                      </TableCell>
                      <TableCell>{sarStatusBadge(sar.status)}</TableCell>
                      <TableCell className="text-sm">User {sar.filedBy}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {sar.activityStartDate
                          ? `${new Date(sar.activityStartDate).toLocaleDateString()} – ${
                              sar.activityEndDate
                                ? new Date(sar.activityEndDate).toLocaleDateString()
                                : "ongoing"
                            }`
                          : "—"}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {new Date(sar.createdAt).toLocaleDateString()}
                      </TableCell>
                      <TableCell>
                        {sar.status !== "CLOSED" && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              setSelectedSAR(sar.id);
                              setShowUpdateDialog(true);
                            }}
                          >
                            Update
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
        {total > 20 && (
          <div className="flex items-center justify-between text-sm text-muted-foreground">
            <span>
              Showing {offset + 1}–{Math.min(offset + 20, total)} of {total}
            </span>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={offset === 0}
                onClick={() => setOffset(Math.max(0, offset - 20))}
              >
                Previous
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={offset + 20 >= total}
                onClick={() => setOffset(offset + 20)}
              >
                Next
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Create SAR Dialog */}
      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>File Suspicious Activity Report</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-1">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Subject User ID</Label>
                <Input
                  type="number"
                  value={subjectUserId}
                  onChange={(e) => setSubjectUserId(e.target.value)}
                  placeholder="User ID"
                />
              </div>
              <div>
                <Label>Subject Name (optional)</Label>
                <Input
                  value={subjectName}
                  onChange={(e) => setSubjectName(e.target.value)}
                  placeholder="Full name"
                />
              </div>
            </div>
            <div>
              <Label>Activity Type</Label>
              <Select value={activityType} onValueChange={setActivityType}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="STRUCTURING">Structuring</SelectItem>
                  <SelectItem value="LAYERING">Layering</SelectItem>
                  <SelectItem value="INTEGRATION">Integration</SelectItem>
                  <SelectItem value="SANCTIONS_EVASION">Sanctions Evasion</SelectItem>
                  <SelectItem value="FRAUD">Fraud</SelectItem>
                  <SelectItem value="UNUSUAL_PATTERN">Unusual Pattern</SelectItem>
                  <SelectItem value="OTHER">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Activity Description</Label>
              <Textarea
                value={activityDesc}
                onChange={(e) => setActivityDesc(e.target.value)}
                placeholder="Describe the suspicious activity in detail (minimum 10 characters)..."
                rows={5}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Activity Start Date</Label>
                <Input
                  type="date"
                  value={activityStart}
                  onChange={(e) => setActivityStart(e.target.value)}
                />
              </div>
              <div>
                <Label>Activity End Date</Label>
                <Input
                  type="date"
                  value={activityEnd}
                  onChange={(e) => setActivityEnd(e.target.value)}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Total Amount (NGN)</Label>
                <Input
                  type="number"
                  value={totalAmount}
                  onChange={(e) => setTotalAmount(e.target.value)}
                  placeholder="e.g., 5000000"
                />
              </div>
              <div>
                <Label>Linked AML Flag ID</Label>
                <Input
                  type="number"
                  value={linkedFlagId}
                  onChange={(e) => setLinkedFlagId(e.target.value)}
                  placeholder="Optional"
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreateDialog(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (!subjectUserId || activityDesc.length < 10) return;
                createMutation.mutate({
                  userId: parseInt(subjectUserId),
                  subjectName: subjectName || undefined,
                  activityType,
                  activityDescription: activityDesc,
                  activityStartDate: activityStart ? new Date(activityStart) : undefined,
                  activityEndDate: activityEnd ? new Date(activityEnd) : undefined,
                  totalAmount: totalAmount ? parseFloat(totalAmount) : undefined,
                  flagId: linkedFlagId ? parseInt(linkedFlagId) : undefined,
                });
              }}
              disabled={
                createMutation.isPending ||
                !subjectUserId ||
                activityDesc.length < 10
              }
            >
              {createMutation.isPending ? "Filing..." : "File SAR"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Update Status Dialog */}
      <Dialog open={showUpdateDialog} onOpenChange={setShowUpdateDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Update SAR Status</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>New Status</Label>
              <Select
                value={updateStatus}
                onValueChange={(v) => setUpdateStatus(v as typeof updateStatus)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="SUBMITTED">Submitted to Regulator</SelectItem>
                  <SelectItem value="ACKNOWLEDGED">Acknowledged by Regulator</SelectItem>
                  <SelectItem value="CLOSED">Closed</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Regulatory Reference (optional)</Label>
              <Input
                value={regulatoryRef}
                onChange={(e) => setRegulatoryRef(e.target.value)}
                placeholder="e.g., CBN-SAR-2026-001"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowUpdateDialog(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (!selectedSAR) return;
                updateMutation.mutate({
                  sarId: selectedSAR,
                  status: updateStatus,
                  regulatoryRef: regulatoryRef || undefined,
                });
              }}
              disabled={updateMutation.isPending}
            >
              {updateMutation.isPending ? "Updating..." : "Update SAR"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
