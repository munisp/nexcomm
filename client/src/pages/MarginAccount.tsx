/**
 * Margin Account & Collateral Ledger Page
 * ─────────────────────────────────────────
 * Shows:
 *  • Summary cards: total collateral, used margin, available margin, utilisation %
 *  • Margin call alert banner when utilisation exceeds the call level
 *  • Active collateral items table with Release button
 *  • Collateral ledger history (paginated)
 *  • "Pledge Warehouse Receipt" button that opens a dialog to select a receipt
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { getLoginUrl } from "@/const";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import {
import { PageSkeleton } from "@/components/PageSkeleton";
  AlertTriangle,
  Shield,
  TrendingUp,
  Wallet,
  ChevronLeft,
  ChevronRight,
  Package,
  ArrowDownLeft,
} from "lucide-react";

// ─── helpers ─────────────────────────────────────────────────────────────────

function fmt(n: number | string | undefined | null) {
  if (n === undefined || n === null) return "—";
  return Number(n).toLocaleString("en-NG", { style: "currency", currency: "NGN", maximumFractionDigits: 2 });
}

function pct(n: number) {
  return `${n.toFixed(1)}%`;
}

// ─── component ───────────────────────────────────────────────────────────────

export default function MarginAccount() {
  const { user, loading: authLoading } = useAuth();


  const [ledgerPage, setLedgerPage] = useState(0);
  const [pledgeDialogOpen, setPledgeDialogOpen] = useState(false);
  const [releaseDialogOpen, setReleaseDialogOpen] = useState(false);
  const [selectedReceiptId, setSelectedReceiptId] = useState<number | null>(null);
  const [selectedCollateralId, setSelectedCollateralId] = useState<number | null>(null);
  const [pledgeNotes, setPledgeNotes] = useState("");
  const [releaseNotes, setReleaseNotes] = useState("");

  const utils = trpc.useUtils();

  // Queries
  const { data: summary, isLoading: summaryLoading } = trpc.margin.getSummary.useQuery(undefined, { enabled: !!user });
  const { data: alertStatus } = trpc.margin.getAlertStatus.useQuery(undefined, { enabled: !!user, refetchInterval: 30_000 });
  const { data: collateralData, isLoading: collateralLoading } = trpc.margin.getCollateral.useQuery(
    { status: "ACTIVE" },
    { enabled: !!user },
  );
  const { data: ledgerData, isLoading: ledgerLoading } = trpc.margin.getLedger.useQuery(
    { limit: 10, offset: ledgerPage * 10 },
    { enabled: !!user },
  );
  const { data: inventoryData } = trpc.warehouseInventory.myInventory.useQuery(
    { status: "ACTIVE" },
    { enabled: !!user },
  );

  // Mutations
  const pledgeMutation = trpc.margin.pledgeWarehouseReceipt.useMutation({
    onSuccess: (data) => {
      toast.success(`Receipt pledged — eligible value: ${fmt(data.eligibleValue)}`);
      setPledgeDialogOpen(false);
      setSelectedReceiptId(null);
      setPledgeNotes("");
      utils.margin.getSummary.invalidate();
      utils.margin.getCollateral.invalidate();
      utils.margin.getLedger.invalidate();
      utils.warehouseInventory.myInventory.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  const releaseMutation = trpc.margin.releaseCollateral.useMutation({
    onSuccess: () => {
      toast.success("Collateral released — receipt restored to ACTIVE.");
      setReleaseDialogOpen(false);
      setSelectedCollateralId(null);
      setReleaseNotes("");
      utils.margin.getSummary.invalidate();
      utils.margin.getCollateral.invalidate();
      utils.margin.getLedger.invalidate();
      utils.warehouseInventory.myInventory.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  if (authLoading) return <DashboardLayout><div className="p-8 text-muted-foreground">Loading…</div></DashboardLayout>;
  if (!user) {
    window.location.href = getLoginUrl();
    return null;
  }

  // Flatten all receipts from all warehouses, filtering to ACTIVE only
  type ReceiptItem = { id: number; receiptNumber: string; commodity: string; grade: string | null; gradeLabel: string; quantity: string; unit: string; status: string; valueUsd: string | null; depositDate: Date; expiryDate: Date | null; notes: string | null };
  type WarehouseItem = { warehouseId: string; warehouseName: string; receipts: ReceiptItem[] };
  const activeReceipts: Array<ReceiptItem & { warehouseName: string }> = (inventoryData && 'warehouses' in inventoryData
    ? (inventoryData.warehouses as WarehouseItem[]).flatMap(w => w.receipts.map(r => ({ ...r, warehouseName: w.warehouseName })))
    : []
  ).filter(r => r.status === "ACTIVE");
  const collateralItems = collateralData ?? [];
  const ledgerEntries = ledgerData?.entries ?? [];
  const ledgerTotal = ledgerData?.total ?? 0;
  const totalLedgerPages = Math.ceil(ledgerTotal / 10);

  if (summaryLoading) return <PageSkeleton cards={4} tableRows={8} tableCols={4} />;
  return (
    <DashboardLayout>
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Margin Account</h1>
            <p className="text-muted-foreground text-sm mt-1">Manage your collateral and margin utilisation</p>
          </div>
          <Button
            onClick={() => setPledgeDialogOpen(true)}
            disabled={activeReceipts.length === 0}
            className="gap-2"
          >
            <Package className="w-4 h-4" />
            Pledge Receipt
          </Button>
        </div>

        {/* Margin Alert Banner — driven by getAlertStatus for granular levels */}
        {alertStatus && alertStatus.level !== "OK" && (
          <div className={`flex items-center gap-3 p-4 rounded-lg border ${
            alertStatus.level === "LIQUIDATED"
              ? "bg-destructive/20 border-destructive text-destructive"
              : alertStatus.level === "CRITICAL"
              ? "bg-destructive/10 border-destructive/40 text-destructive"
              : "bg-yellow-500/10 border-yellow-500/40 text-yellow-700 dark:text-yellow-400"
          }`}>
            <AlertTriangle className="w-5 h-5 shrink-0" />
            <div className="flex-1">
              <p className="font-semibold">
                {alertStatus.level === "LIQUIDATED" && "Account Liquidated"}
                {alertStatus.level === "CRITICAL" && "Critical Margin Warning"}
                {alertStatus.level === "WARNING" && "Margin Call Warning"}
              </p>
              <p className="text-sm">
                {alertStatus.level === "LIQUIDATED" && "Your margin account has been closed due to insufficient collateral. Contact support to reinstate."}
                {alertStatus.level === "CRITICAL" && `Utilisation at ${pct(alertStatus.utilisationPct)} — forced liquidation is imminent. Add collateral immediately.`}
                {alertStatus.level === "WARNING" && `Utilisation at ${pct(alertStatus.utilisationPct)} — please add collateral or reduce positions to avoid a margin call.`}
              </p>
            </div>
          </div>
        )}

        {/* Summary Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-xs text-muted-foreground font-medium flex items-center gap-1.5">
                <Shield className="w-3.5 h-3.5" /> Total Collateral
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-xl font-bold">{summaryLoading ? "…" : fmt(summary?.totalCollateral)}</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-xs text-muted-foreground font-medium flex items-center gap-1.5">
                <TrendingUp className="w-3.5 h-3.5" /> Used Margin
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-xl font-bold">{summaryLoading ? "…" : fmt(summary?.usedMargin)}</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-xs text-muted-foreground font-medium flex items-center gap-1.5">
                <Wallet className="w-3.5 h-3.5" /> Available Margin
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-xl font-bold text-green-500">{summaryLoading ? "…" : fmt(summary?.availableMargin)}</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-xs text-muted-foreground font-medium">Utilisation</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <p className="text-xl font-bold">{summaryLoading ? "…" : pct(summary?.utilisationPct ?? 0)}</p>
              <Progress
                value={summary?.utilisationPct ?? 0}
                className="h-1.5"
              />
            </CardContent>
          </Card>
        </div>

        {/* Active Collateral */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Active Collateral Items</CardTitle>
          </CardHeader>
          <CardContent>
            {collateralLoading ? (
              <p className="text-muted-foreground text-sm py-4 text-center">Loading…</p>
            ) : collateralItems.length === 0 ? (
              <p className="text-muted-foreground text-sm py-8 text-center">No active collateral. Pledge a warehouse receipt to get started.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-muted-foreground">
                      <th className="text-left pb-2 font-medium">Description</th>
                      <th className="text-left pb-2 font-medium">Type</th>
                      <th className="text-right pb-2 font-medium">Face Value</th>
                      <th className="text-right pb-2 font-medium">Haircut</th>
                      <th className="text-right pb-2 font-medium">Eligible Value</th>
                      <th className="text-right pb-2 font-medium">Pledged</th>
                      <th className="pb-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {collateralItems.map((item) => (
                      <tr key={item.id} className="border-b last:border-0 hover:bg-muted/30">
                        <td className="py-2.5 pr-4 font-medium max-w-[200px] truncate">{item.description}</td>
                        <td className="py-2.5 pr-4">
                          <Badge variant="outline" className="text-xs">{item.collateralType.replace("_", " ")}</Badge>
                        </td>
                        <td className="py-2.5 pr-4 text-right">{fmt(item.faceValue)}</td>
                        <td className="py-2.5 pr-4 text-right text-muted-foreground">{item.haircut}%</td>
                        <td className="py-2.5 pr-4 text-right font-semibold text-green-500">{fmt(item.eligibleValue)}</td>
                        <td className="py-2.5 pr-4 text-right text-muted-foreground text-xs">
                          {new Date(item.pledgedAt).toLocaleDateString()}
                        </td>
                        <td className="py-2.5 text-right">
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-xs gap-1"
                            onClick={() => {
                              setSelectedCollateralId(item.id);
                              setReleaseDialogOpen(true);
                            }}
                          >
                            <ArrowDownLeft className="w-3 h-3" />
                            Release
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Collateral Ledger */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">Collateral Ledger History</CardTitle>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                disabled={ledgerPage === 0}
                onClick={() => setLedgerPage(p => p - 1)}
              >
                <ChevronLeft className="w-4 h-4" />
              </Button>
              <span className="text-xs text-muted-foreground">
                {ledgerTotal === 0 ? "0" : `${ledgerPage * 10 + 1}–${Math.min((ledgerPage + 1) * 10, ledgerTotal)}`} of {ledgerTotal}
              </span>
              <Button
                variant="ghost"
                size="sm"
                disabled={ledgerPage + 1 >= totalLedgerPages}
                onClick={() => setLedgerPage(p => p + 1)}
              >
                <ChevronRight className="w-4 h-4" />
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {ledgerLoading ? (
              <p className="text-muted-foreground text-sm py-4 text-center">Loading…</p>
            ) : ledgerEntries.length === 0 ? (
              <p className="text-muted-foreground text-sm py-8 text-center">No ledger entries yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-muted-foreground">
                      <th className="text-left pb-2 font-medium">Date</th>
                      <th className="text-left pb-2 font-medium">Action</th>
                      <th className="text-left pb-2 font-medium">Description</th>
                      <th className="text-right pb-2 font-medium">Amount</th>
                      <th className="text-right pb-2 font-medium">Balance After</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ledgerEntries.map((entry) => (
                      <tr key={entry.id} className="border-b last:border-0 hover:bg-muted/30">
                        <td className="py-2.5 pr-4 text-muted-foreground text-xs">
                          {new Date(entry.createdAt).toLocaleString()}
                        </td>
                        <td className="py-2.5 pr-4">
                          <Badge
                            variant={entry.action === "PLEDGE" ? "default" : entry.action === "RELEASE" ? "secondary" : "destructive"}
                            className="text-xs"
                          >
                            {entry.action}
                          </Badge>
                        </td>
                        <td className="py-2.5 pr-4 text-muted-foreground max-w-[240px] truncate">{entry.description}</td>
                        <td className={`py-2.5 pr-4 text-right font-medium ${entry.action === "PLEDGE" ? "text-green-500" : "text-red-400"}`}>
                          {entry.action === "PLEDGE" ? "+" : "-"}{fmt(entry.amount)}
                        </td>
                        <td className="py-2.5 text-right">{fmt(entry.balanceAfter)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Pledge Dialog */}
      <Dialog open={pledgeDialogOpen} onOpenChange={setPledgeDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Pledge Warehouse Receipt</DialogTitle>
            <DialogDescription>
              Select an ACTIVE warehouse receipt to pledge as collateral. A 20% haircut will be applied to calculate the eligible value.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Select Receipt</Label>
              <div className="space-y-2 max-h-48 overflow-y-auto">
                {activeReceipts.length === 0 ? (
                  <p className="text-muted-foreground text-sm">No ACTIVE receipts available.</p>
                ) : activeReceipts.map((r) => (
                  <div
                    key={r.id}
                    onClick={() => setSelectedReceiptId(r.id)}
                    className={`p-3 rounded-lg border cursor-pointer transition-colors ${selectedReceiptId === r.id ? "border-primary bg-primary/5" : "border-border hover:border-primary/50"}`}
                  >
                    <p className="font-medium text-sm">{r.receiptNumber}</p>
                    <p className="text-xs text-muted-foreground">{(r as { commodity: string; grade: string | null; quantity: string; unit: string }).commodity} {(r as { grade: string | null }).grade} — {Number((r as { quantity: string }).quantity).toLocaleString()} {(r as { unit: string }).unit}</p>
                    <p className="text-xs text-muted-foreground">{(r as { warehouseName: string | null }).warehouseName}</p>
                  </div>
                ))}
              </div>
            </div>
            <div className="space-y-2">
              <Label>Notes (optional)</Label>
              <Textarea
                value={pledgeNotes}
                onChange={e => setPledgeNotes(e.target.value)}
                placeholder="Add any notes about this pledge…"
                rows={2}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPledgeDialogOpen(false)}>Cancel</Button>
            <Button
              disabled={!selectedReceiptId || pledgeMutation.isPending}
              onClick={() => {
                if (selectedReceiptId) {
                  pledgeMutation.mutate({ receiptId: selectedReceiptId, notes: pledgeNotes || undefined });
                }
              }}
            >
              {pledgeMutation.isPending ? "Pledging…" : "Pledge Receipt"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Release Dialog */}
      <Dialog open={releaseDialogOpen} onOpenChange={setReleaseDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Release Collateral</DialogTitle>
            <DialogDescription>
              This will release the collateral item and restore the warehouse receipt to ACTIVE status. Ensure you have sufficient remaining margin before releasing.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Release Notes (optional)</Label>
              <Textarea
                value={releaseNotes}
                onChange={e => setReleaseNotes(e.target.value)}
                placeholder="Reason for releasing this collateral…"
                rows={2}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReleaseDialogOpen(false)}>Cancel</Button>
            <Button
              variant="destructive"
              disabled={!selectedCollateralId || releaseMutation.isPending}
              onClick={() => {
                if (selectedCollateralId) {
                  releaseMutation.mutate({ collateralItemId: selectedCollateralId, notes: releaseNotes || undefined });
                }
              }}
            >
              {releaseMutation.isPending ? "Releasing…" : "Release Collateral"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
