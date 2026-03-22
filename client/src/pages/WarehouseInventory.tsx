/**
 * Warehouse Inventory Page
 * Shows the authenticated farmer's deposited produce grouped by certified warehouse and grade.
 * Each warehouse receipt can be expanded to show a QR code for verification.
 */
import { useState, useEffect, useRef } from "react";
import QRCode from "qrcode";
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
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Warehouse,
  Package,
  QrCode,
  ChevronDown,
  ChevronRight,
  TrendingUp,
  AlertCircle,
  CheckCircle2,
  Clock,
  Lock,
  Unlock,
} from "lucide-react";
import { toast } from "sonner";

// ─── Status badge helper ──────────────────────────────────────────────────────
function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
    ACTIVE:    { label: "Active",    variant: "default" },
    PLEDGED:   { label: "Pledged",   variant: "secondary" },
    REDEEMED:  { label: "Redeemed",  variant: "outline" },
    CANCELLED: { label: "Cancelled", variant: "destructive" },
  };
  const { label, variant } = map[status] ?? { label: status, variant: "outline" };
  return <Badge variant={variant}>{label}</Badge>;
}

// ─── QR Code canvas component ─────────────────────────────────────────────────
function QrCanvas({ payload }: { payload: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!canvasRef.current) return;
    QRCode.toCanvas(canvasRef.current, payload, {
      width: 240,
      margin: 2,
      color: { dark: "#0f172a", light: "#ffffff" },
    }).catch(console.error);
  }, [payload]);

  return (
    <canvas
      ref={canvasRef}
      className="mx-auto rounded-lg border border-border shadow-sm"
    />
  );
}

// ─── QR Modal ────────────────────────────────────────────────────────────────
function QrModal({
  receiptId,
  open,
  onClose,
}: {
  receiptId: number | null;
  open: boolean;
  onClose: () => void;
}) {
  const { data, isLoading } = trpc.warehouseInventory.receiptQrData.useQuery(
    { receiptId: receiptId! },
    { enabled: open && receiptId !== null },
  );

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <QrCode className="h-5 w-5 text-emerald-500" />
            Electronic Warehouse Receipt
          </DialogTitle>
          <DialogDescription>
            Scan to verify this receipt on the NEXCOM exchange.
          </DialogDescription>
        </DialogHeader>

        {isLoading && (
          <div className="flex items-center justify-center py-10 text-muted-foreground text-sm">
            Generating QR code…
          </div>
        )}

        {data && (
          <div className="space-y-4">
            <QrCanvas payload={data.qrPayload} />

            <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-1 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Receipt No.</span>
                <span className="font-mono font-semibold">{data.receiptNumber}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Commodity</span>
                <span>{data.receipt.commodity}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Grade</span>
                <span>{data.receipt.gradeLabel}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Quantity</span>
                <span className="font-semibold">
                  {parseFloat(data.receipt.quantity).toLocaleString()} {data.receipt.unit}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Warehouse</span>
                <span className="text-right max-w-[180px]">{data.receipt.warehouseName}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Status</span>
                <StatusBadge status={data.receipt.status} />
              </div>
            </div>

            <p className="text-xs text-muted-foreground text-center">
              This QR encodes a signed NEXCOM EWR payload. Present to warehouse operators or brokers for verification.
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────
export default function WarehouseInventory() {
  const { isAuthenticated, loading } = useAuth();
  const [statusFilter, setStatusFilter] = useState<"ACTIVE" | "PLEDGED" | "REDEEMED" | "CANCELLED" | "ALL">("ACTIVE");
  const [openWarehouses, setOpenWarehouses] = useState<Set<string>>(new Set());
  const [qrReceiptId, setQrReceiptId] = useState<number | null>(null);
  const [qrOpen, setQrOpen] = useState(false);

  const utils = trpc.useUtils();

  const pledgeMutation = trpc.warehouseInventory.pledgeReceipt.useMutation({
    onSuccess: () => {
      toast.success("Receipt pledged as collateral");
      utils.warehouseInventory.myInventory.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const unpledgeMutation = trpc.warehouseInventory.unpledgeReceipt.useMutation({
    onSuccess: () => {
      toast.success("Receipt unpledged — now ACTIVE");
      utils.warehouseInventory.myInventory.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const { data, isLoading, refetch } = trpc.warehouseInventory.myInventory.useQuery(
    { status: statusFilter } as { status: "ACTIVE" | "PLEDGED" | "REDEEMED" | "CANCELLED" | "ALL" },
    { enabled: isAuthenticated, refetchInterval: 30_000 },
  );

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
        <Warehouse className="h-12 w-12 text-muted-foreground" />
        <h2 className="text-xl font-semibold">Sign in to view your inventory</h2>
        <p className="text-muted-foreground max-w-sm">
          Your warehouse receipts and deposited produce are only visible to authenticated farmers.
        </p>
        <Button asChild>
          <a href={getLoginUrl()}>Sign In</a>
        </Button>
      </div>
    );
  }

  const summary = data?.summary;
  const warehouses = data?.warehouses ?? [];

  function toggleWarehouse(id: string) {
    setOpenWarehouses(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function openQr(receiptId: number) {
    setQrReceiptId(receiptId);
    setQrOpen(true);
  }

  return (
    <div className="space-y-6 p-4 lg:p-6 max-w-5xl mx-auto">
      {/* ── Header ── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Warehouse className="h-6 w-6 text-emerald-500" />
            Warehouse Inventory
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Your deposited produce across certified NEXCOM warehouses
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select
            value={statusFilter}
            onValueChange={v => setStatusFilter(v as typeof statusFilter)}
          >
            <SelectTrigger className="w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ACTIVE">Active</SelectItem>
              <SelectItem value="PLEDGED">Pledged</SelectItem>
              <SelectItem value="REDEEMED">Redeemed</SelectItem>
              <SelectItem value="ALL">All Statuses</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            Refresh
          </Button>
        </div>
      </div>

      {/* ── Summary cards ── */}
      {summary && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Card className="bg-emerald-500/10 border-emerald-500/20">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-1">
                <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                <span className="text-xs text-muted-foreground">Active</span>
              </div>
              <p className="text-2xl font-bold">{summary.activeReceipts}</p>
              <p className="text-xs text-muted-foreground">receipts</p>
            </CardContent>
          </Card>
          <Card className="bg-amber-500/10 border-amber-500/20">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-1">
                <Lock className="h-4 w-4 text-amber-500" />
                <span className="text-xs text-muted-foreground">Pledged</span>
              </div>
              <p className="text-2xl font-bold">{summary.pledgedReceipts}</p>
              <p className="text-xs text-muted-foreground">as collateral</p>
            </CardContent>
          </Card>
          <Card className="bg-blue-500/10 border-blue-500/20">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-1">
                <Clock className="h-4 w-4 text-blue-500" />
                <span className="text-xs text-muted-foreground">Pending</span>
              </div>
              <p className="text-2xl font-bold">{summary.pendingDeposits}</p>
              <p className="text-xs text-muted-foreground">deposits</p>
            </CardContent>
          </Card>
          <Card className="bg-purple-500/10 border-purple-500/20">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-1">
                <TrendingUp className="h-4 w-4 text-purple-500" />
                <span className="text-xs text-muted-foreground">Est. Value</span>
              </div>
              <p className="text-2xl font-bold">
                ${summary.totalValueUsd.toLocaleString(undefined, { maximumFractionDigits: 0 })}
              </p>
              <p className="text-xs text-muted-foreground">USD</p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* ── Loading state ── */}
      {isLoading && (
        <div className="flex items-center justify-center py-16 text-muted-foreground">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-500 mr-3" />
          Loading inventory…
        </div>
      )}

      {/* ── Empty state ── */}
      {!isLoading && warehouses.length === 0 && (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-16 text-center gap-3">
            <Package className="h-12 w-12 text-muted-foreground/40" />
            <h3 className="font-semibold text-lg">No produce deposited yet</h3>
            <p className="text-muted-foreground text-sm max-w-sm">
              Once you deposit commodities at a certified NEXCOM warehouse, your electronic
              warehouse receipts will appear here.
            </p>
            <Button variant="outline" asChild>
              <a href="/deposits">Make a Deposit</a>
            </Button>
          </CardContent>
        </Card>
      )}

      {/* ── Warehouse groups ── */}
      {warehouses.map(warehouse => {
        const isOpen = openWarehouses.has(warehouse.warehouseId);
        return (
          <Card key={warehouse.warehouseId} className="overflow-hidden">
            <Collapsible open={isOpen} onOpenChange={() => toggleWarehouse(warehouse.warehouseId)}>
              <CollapsibleTrigger asChild>
                <CardHeader className="cursor-pointer hover:bg-muted/30 transition-colors select-none">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="h-10 w-10 rounded-lg bg-emerald-500/10 flex items-center justify-center">
                        <Warehouse className="h-5 w-5 text-emerald-500" />
                      </div>
                      <div>
                        <CardTitle className="text-base">{warehouse.warehouseName}</CardTitle>
                        {warehouse.warehouseInfo && (
                          <CardDescription className="text-xs">
                            {warehouse.warehouseInfo.location} · Cert: {warehouse.warehouseInfo.certBody}
                          </CardDescription>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <Badge variant="secondary">
                        {warehouse.totalReceipts} receipt{warehouse.totalReceipts !== 1 ? "s" : ""}
                      </Badge>
                      {isOpen
                        ? <ChevronDown className="h-4 w-4 text-muted-foreground" />
                        : <ChevronRight className="h-4 w-4 text-muted-foreground" />
                      }
                    </div>
                  </div>
                </CardHeader>
              </CollapsibleTrigger>

              <CollapsibleContent>
                <CardContent className="pt-0 space-y-4">
                  {/* Commodity summary table */}
                  {warehouse.commodityGroups.length > 0 && (
                    <div>
                      <h4 className="text-sm font-semibold mb-2 text-muted-foreground uppercase tracking-wide">
                        Commodity Summary
                      </h4>
                      <div className="rounded-lg border border-border overflow-hidden">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Commodity</TableHead>
                              <TableHead>Grade</TableHead>
                              <TableHead className="text-right">Quantity</TableHead>
                              <TableHead className="text-right">Receipts</TableHead>
                              <TableHead className="text-right">Est. Value</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {warehouse.commodityGroups.map(cg => (
                              <TableRow key={`${cg.commodity}-${cg.grade}`}>
                                <TableCell className="font-medium">{cg.commodity}</TableCell>
                                <TableCell>
                                  <Badge variant="outline" className="text-xs">{cg.gradeLabel}</Badge>
                                </TableCell>
                                <TableCell className="text-right font-mono">
                                  {parseFloat(String(cg.totalQuantity)).toLocaleString()} {cg.unit}
                                </TableCell>
                                <TableCell className="text-right">
                                  <span className="text-emerald-500 font-semibold">{cg.activeCount}</span>
                                  {cg.pledgedCount > 0 && (
                                    <span className="text-amber-500 ml-1">(+{cg.pledgedCount} pledged)</span>
                                  )}
                                </TableCell>
                                <TableCell className="text-right font-mono">
                                  ${cg.estimatedValueUsd.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    </div>
                  )}

                  {/* Individual receipts */}
                  <div>
                    <h4 className="text-sm font-semibold mb-2 text-muted-foreground uppercase tracking-wide">
                      Individual Receipts
                    </h4>
                    <div className="space-y-2">
                      {warehouse.receipts.map(r => (
                        <div
                          key={r.id}
                          className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 rounded-lg border border-border p-3 hover:bg-muted/20 transition-colors"
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            <div className="h-8 w-8 rounded bg-muted flex items-center justify-center flex-shrink-0">
                              <Package className="h-4 w-4 text-muted-foreground" />
                            </div>
                            <div className="min-w-0">
                              <p className="font-mono text-sm font-semibold truncate">{r.receiptNumber}</p>
                              <p className="text-xs text-muted-foreground">
                                {r.commodity} · {r.gradeLabel} ·{" "}
                                {parseFloat(r.quantity).toLocaleString()} {r.unit}
                              </p>
                            </div>
                          </div>
                          <div className="flex items-center gap-2 flex-shrink-0">
                            <StatusBadge status={r.status} />
                            <span className="text-xs text-muted-foreground hidden sm:inline">
                              {new Date(r.depositDate).toLocaleDateString()}
                            </span>
                            {(r.status === "ACTIVE" || r.status === "PLEDGED") && (
                              <Button
                                variant="outline"
                                size="sm"
                                className="h-7 text-xs gap-1"
                                onClick={() => openQr(r.id)}
                              >
                                <QrCode className="h-3 w-3" />
                                QR
                              </Button>
                            )}
                            {r.status === "ACTIVE" && (
                              <Button
                                variant="outline"
                                size="sm"
                                className="h-7 text-xs gap-1 border-amber-500/40 text-amber-400 hover:bg-amber-500/10"
                                onClick={() => pledgeMutation.mutate({ receiptId: r.id })}
                                disabled={pledgeMutation.isPending}
                              >
                                <Lock className="h-3 w-3" />
                                Pledge
                              </Button>
                            )}
                            {r.status === "PLEDGED" && (
                              <Button
                                variant="outline"
                                size="sm"
                                className="h-7 text-xs gap-1 border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/10"
                                onClick={() => unpledgeMutation.mutate({ receiptId: r.id })}
                                disabled={unpledgeMutation.isPending}
                              >
                                <Unlock className="h-3 w-3" />
                                Unpledge
                              </Button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Warehouse info footer */}
                  {warehouse.warehouseInfo && (
                    <div className="rounded-lg bg-muted/30 p-3 text-xs text-muted-foreground grid grid-cols-2 sm:grid-cols-4 gap-2">
                      <div>
                        <span className="font-semibold block">Operator</span>
                        {warehouse.warehouseInfo.operator}
                      </div>
                      <div>
                        <span className="font-semibold block">State</span>
                        {warehouse.warehouseInfo.state}
                      </div>
                      <div>
                        <span className="font-semibold block">Capacity</span>
                        {warehouse.warehouseInfo.capacity}
                      </div>
                      <div>
                        <span className="font-semibold block">Certification</span>
                        {warehouse.warehouseInfo.certBody}
                      </div>
                    </div>
                  )}
                </CardContent>
              </CollapsibleContent>
            </Collapsible>
          </Card>
        );
      })}

      {/* ── QR Modal ── */}
      <QrModal
        receiptId={qrReceiptId}
        open={qrOpen}
        onClose={() => { setQrOpen(false); setQrReceiptId(null); }}
      />
    </div>
  );
}
