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
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { GitMerge, RefreshCw, ArrowUpCircle, CheckCircle } from "lucide-react";
import { PageSkeleton } from "@/components/PageSkeleton";

type FailStatus = "OPEN" | "UNDER_REVIEW" | "RESOLVED" | "ESCALATED" | "WRITTEN_OFF" | "ALL";

function failStatusBadge(status: string) {
  const colors: Record<string, string> = {
    OPEN: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
    UNDER_REVIEW: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
    ESCALATED: "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200",
    RESOLVED: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
    WRITTEN_OFF: "bg-gray-100 text-gray-700 dark:bg-secondary dark:text-muted-foreground",
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

export default function SettlementFails() {
  const { user } = useAuth();
  const utils = trpc.useUtils();

  const [statusFilter, setStatusFilter] = useState<FailStatus>("OPEN");
  const [offset, setOffset] = useState(0);
  const [selectedFail, setSelectedFail] = useState<number | null>(null);
  const [showEscalateDialog, setShowEscalateDialog] = useState(false);
  const [showResolveDialog, setShowResolveDialog] = useState(false);

  // Escalate form
  const [escalateTo, setEscalateTo] = useState("");
  const [escalateNotes, setEscalateNotes] = useState("");

  // Resolve form
  const [resolveNotes, setResolveNotes] = useState("");
  const [penaltyAmount, setPenaltyAmount] = useState("");

  const { data: failsData, isLoading } = trpc.settlementEngine.adminListFails.useQuery({
    status: statusFilter,
    limit: 20,
    offset,
  });

  const escalateMutation = trpc.settlementEngine.adminEscalateFail.useMutation({
    onSuccess: () => {
      toast.success("Fail escalated");
      utils.settlementEngine.adminListFails.invalidate();
      setShowEscalateDialog(false);
      setEscalateTo("");
      setEscalateNotes("");
    },
    onError: (e) => toast.error("Error escalating fail", { description: e.message }),
  });

  const resolveMutation = trpc.settlementEngine.adminResolveFail.useMutation({
    onSuccess: () => {
      toast.success("Fail resolved");
      utils.settlementEngine.adminListFails.invalidate();
      setShowResolveDialog(false);
      setResolveNotes("");
      setPenaltyAmount("");
    },
    onError: (e) => toast.error("Error resolving fail", { description: e.message }),
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

  const fails = failsData?.fails ?? [];
  const total = failsData?.total ?? 0;

  if (isLoading) return <PageSkeleton cards={4} tableRows={8} tableCols={4} />;
  return (
    <DashboardLayout>
      <div className="p-6 space-y-6 max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <GitMerge className="h-6 w-6 text-red-500" />
              Settlement Fails
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Review, escalate, and resolve failed settlement instructions
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => utils.settlementEngine.adminListFails.invalidate()}
          >
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh
          </Button>
        </div>

        {/* Filters */}
        <div className="flex gap-3">
          <Select
            value={statusFilter}
            onValueChange={(v) => {
              setStatusFilter(v as FailStatus);
              setOffset(0);
            }}
          >
            <SelectTrigger className="w-44">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All Statuses</SelectItem>
              <SelectItem value="OPEN">Open</SelectItem>
              <SelectItem value="UNDER_REVIEW">Under Review</SelectItem>
              <SelectItem value="ESCALATED">Escalated</SelectItem>
              <SelectItem value="RESOLVED">Resolved</SelectItem>
              <SelectItem value="WRITTEN_OFF">Written Off</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Fails Table */}
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>ID</TableHead>
                  <TableHead>Instruction</TableHead>
                  <TableHead>Cycle</TableHead>
                  <TableHead>Fail Type</TableHead>
                  <TableHead>Failed Party</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Penalty</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={9} className="text-center py-8 text-muted-foreground">
                      Loading fails...
                    </TableCell>
                  </TableRow>
                ) : !fails.length ? (
                  <TableRow>
                    <TableCell colSpan={9} className="text-center py-8 text-muted-foreground">
                      No settlement fails found.
                    </TableCell>
                  </TableRow>
                ) : (
                  fails.map((fail) => (
                    <TableRow key={fail.id}>
                      <TableCell className="font-mono text-xs">#{fail.id}</TableCell>
                      <TableCell className="font-mono text-xs">#{fail.instructionId}</TableCell>
                      <TableCell className="font-mono text-xs">#{fail.cycleId}</TableCell>
                      <TableCell className="text-xs">
                        {fail.failType.replace(/_/g, " ")}
                      </TableCell>
                      <TableCell className="text-sm">User {fail.failedPartyUserId}</TableCell>
                      <TableCell>{failStatusBadge(fail.status)}</TableCell>
                      <TableCell className="text-sm">
                        {fail.penaltyAmount && parseFloat(fail.penaltyAmount) > 0
                          ? `₦${parseFloat(fail.penaltyAmount).toLocaleString()}`
                          : "—"}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {new Date(fail.createdAt).toLocaleDateString()}
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          {(fail.status === "OPEN" || fail.status === "UNDER_REVIEW") && (
                            <>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => {
                                  setSelectedFail(fail.id);
                                  setShowEscalateDialog(true);
                                }}
                              >
                                <ArrowUpCircle className="h-3 w-3 mr-1" />
                                Escalate
                              </Button>
                              <Button
                                size="sm"
                                onClick={() => {
                                  setSelectedFail(fail.id);
                                  setShowResolveDialog(true);
                                }}
                              >
                                <CheckCircle className="h-3 w-3 mr-1" />
                                Resolve
                              </Button>
                            </>
                          )}
                          {fail.status === "ESCALATED" && (
                            <Button
                              size="sm"
                              onClick={() => {
                                setSelectedFail(fail.id);
                                setShowResolveDialog(true);
                              }}
                            >
                              <CheckCircle className="h-3 w-3 mr-1" />
                              Resolve
                            </Button>
                          )}
                        </div>
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

      {/* Escalate Dialog */}
      <Dialog open={showEscalateDialog} onOpenChange={setShowEscalateDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Escalate Settlement Fail #{selectedFail}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Escalate To</Label>
              <Input
                value={escalateTo}
                onChange={(e) => setEscalateTo(e.target.value)}
                placeholder="e.g., Head of Settlement, Compliance Officer"
              />
            </div>
            <div>
              <Label>Notes (optional)</Label>
              <Textarea
                value={escalateNotes}
                onChange={(e) => setEscalateNotes(e.target.value)}
                placeholder="Provide context for the escalation..."
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowEscalateDialog(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (!selectedFail || !escalateTo) return;
                escalateMutation.mutate({
                  failId: selectedFail,
                  escalatedTo: escalateTo,
                  notes: escalateNotes || undefined,
                });
              }}
              disabled={escalateMutation.isPending || !escalateTo}
            >
              {escalateMutation.isPending ? "Escalating..." : "Escalate"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Resolve Dialog */}
      <Dialog open={showResolveDialog} onOpenChange={setShowResolveDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Resolve Settlement Fail #{selectedFail}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Resolution Notes</Label>
              <Textarea
                value={resolveNotes}
                onChange={(e) => setResolveNotes(e.target.value)}
                placeholder="Describe how the fail was resolved..."
                rows={4}
              />
            </div>
            <div>
              <Label>Penalty Amount (NGN, optional)</Label>
              <Input
                type="number"
                value={penaltyAmount}
                onChange={(e) => setPenaltyAmount(e.target.value)}
                placeholder="e.g., 50000"
                min="0"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowResolveDialog(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (!selectedFail || !resolveNotes) return;
                resolveMutation.mutate({
                  failId: selectedFail,
                  resolutionNotes: resolveNotes,
                  penaltyAmount: penaltyAmount ? parseFloat(penaltyAmount) : undefined,
                });
              }}
              disabled={resolveMutation.isPending || !resolveNotes}
            >
              {resolveMutation.isPending ? "Resolving..." : "Mark Resolved"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
