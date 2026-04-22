/**
 * NEXCOM Exchange — Warehouse Receipts (EWR) Page
 * Electronic Warehouse Receipts management — fully wired to tRPC backend
 */
import { useState } from "react";
import { useLocation } from "wouter";
import {
  FileText, Download, Eye, ArrowRightLeft, Plus,
  CheckCircle2, AlertCircle, Search, Filter, Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { WAREHOUSES, COMMODITIES, GRADE_SPECS } from "../../../shared/commodities";
import { PageSkeleton } from "@/components/PageSkeleton";

const STATUS_CONFIG = {
  ACTIVE:    { label: "Active",    icon: CheckCircle2, className: "badge-active" },
  PLEDGED:   { label: "Pledged",   icon: AlertCircle,  className: "badge-pending" },
  REDEEMED:  { label: "Redeemed",  icon: CheckCircle2, className: "badge-settled" },
  CANCELLED: { label: "Cancelled", icon: AlertCircle,  className: "badge-cancelled" },
} as const;

type ReceiptStatus = keyof typeof STATUS_CONFIG;

export default function WarehouseReceipts() {
  const [, navigate] = useLocation();
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"ALL" | ReceiptStatus>("ALL");
  const [selected, setSelected] = useState<number | null>(null);
  const utils = trpc.useUtils();

  const { data, isLoading } = trpc.receipts.list.useQuery({
    limit: 100,
    status: statusFilter !== "ALL" ? statusFilter : undefined,
  });
  const receipts = data?.receipts ?? [];

  const redeemMutation = trpc.receipts.redeem.useMutation({
    onSuccess: () => {
      toast.success("Redemption initiated");
      utils.receipts.list.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const pledgeMutation = trpc.receipts.pledge.useMutation({
    onSuccess: () => {
      toast.success("Receipt pledged as collateral");
      utils.receipts.list.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const filtered = receipts.filter(r =>
    !query ||
    r.receiptNumber.toLowerCase().includes(query.toLowerCase()) ||
    r.commodity.toLowerCase().includes(query.toLowerCase())
  );

  const totalValue = receipts
    .filter(r => r.status === "ACTIVE")
    .reduce((s, r) => s + (r.valueUsd ? parseFloat(r.valueUsd) : 0), 0);
  const activeCount = receipts.filter(r => r.status === "ACTIVE").length;

  const selectedReceipt = selected !== null ? receipts.find(r => r.id === selected) : null;

  return (
    <div className="page-container space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground" style={{ fontFamily: "'DM Serif Display', serif" }}>
            Warehouse Receipts
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Electronic Warehouse Receipts (EWRs) — {activeCount} active
            {totalValue > 0 && `, total value $${totalValue.toLocaleString()}`}
          </p>
        </div>
        <Button size="sm" className="gap-2" onClick={() => navigate("/deposits")}>
          <Plus className="w-4 h-4" />New Deposit
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "Active EWRs",  value: String(receipts.filter(r => r.status === "ACTIVE").length),    color: "text-primary" },
          { label: "Total Value",  value: totalValue > 0 ? `$${(totalValue/1000).toFixed(1)}k` : "$0",  color: "text-positive" },
          { label: "Pledged",      value: String(receipts.filter(r => r.status === "PLEDGED").length),   color: "text-yellow-400" },
          { label: "Redeemed",     value: String(receipts.filter(r => r.status === "REDEEMED").length),  color: "text-muted-foreground" },
        ].map(s => (
          <div key={s.label} className="stat-card text-center">
            <div className={"text-2xl font-bold font-mono " + s.color}>{s.value}</div>
            <div className="text-xs text-muted-foreground mt-1">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search by EWR number or commodity..."
            value={query}
            onChange={e => setQuery(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={statusFilter} onValueChange={v => setStatusFilter(v as "ALL" | ReceiptStatus)}>
          <SelectTrigger className="w-full sm:w-40">
            <Filter className="w-4 h-4 mr-2 text-muted-foreground" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All Status</SelectItem>
            <SelectItem value="ACTIVE">Active</SelectItem>
            <SelectItem value="PLEDGED">Pledged</SelectItem>
            <SelectItem value="REDEEMED">Redeemed</SelectItem>
            <SelectItem value="CANCELLED">Cancelled</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* EWR Cards */}
      {isLoading ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground">
          <Loader2 className="w-6 h-6 animate-spin mr-2" />Loading receipts…
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.length === 0 && (
            <div className="py-12 text-center text-muted-foreground text-sm rounded-xl border border-border">
              {receipts.length === 0
                ? "No warehouse receipts yet. Deposit a commodity to receive an EWR."
                : "No receipts match your search."}
            </div>
          )}
          {filtered.map(ewr => {
            const commodity = COMMODITIES.find(c => c.symbol === ewr.commodity);
            const warehouse = WAREHOUSES.find(w => w.id === ewr.warehouseId);
            const statusCfg = STATUS_CONFIG[ewr.status as ReceiptStatus] ?? STATUS_CONFIG.ACTIVE;
            const StatusIcon = statusCfg.icon;
            const value = ewr.valueUsd ? parseFloat(ewr.valueUsd) : 0;
            return (
              <div key={ewr.id} className="rounded-xl border border-border bg-card p-4 hover:border-primary/30 transition-colors">
                <div className="flex flex-col sm:flex-row sm:items-start gap-4">
                  <div className="flex items-start gap-3 flex-1 min-w-0">
                    <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                      <FileText className="w-5 h-5 text-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-bold text-foreground font-mono text-sm">{ewr.receiptNumber}</span>
                        <Badge className={"text-[10px] " + statusCfg.className}>
                          <StatusIcon className="w-3 h-3 mr-1" />{statusCfg.label}
                        </Badge>
                      </div>
                      <div className="text-sm font-semibold text-foreground mt-1">
                        {commodity?.name || ewr.commodity}
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        {ewr.grade && `Grade: ${ewr.grade} · `}
                        {ewr.quantity} {ewr.unit}
                        {warehouse ? ` · ${warehouse.name}` : ewr.warehouseName ? ` · ${ewr.warehouseName}` : ""}
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        Issued: {new Date(ewr.createdAt).toLocaleDateString()}
                        {ewr.expiryDate && ` · Expires: ${new Date(ewr.expiryDate).toLocaleDateString()}`}
                      </div>
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-2">
                    {value > 0 && (
                      <>
                        <div className="text-lg font-bold font-mono text-foreground">${value.toLocaleString()}</div>
                        <div className="text-xs text-muted-foreground">Est. value</div>
                      </>
                    )}
                    <div className="flex gap-2 flex-wrap justify-end">
                      <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={() => setSelected(ewr.id)}>
                        <Eye className="w-3 h-3" />View
                      </Button>
                      {ewr.status === "ACTIVE" && (
                        <>
                          <Button
                            variant="outline" size="sm" className="h-7 text-xs gap-1"
                            disabled={pledgeMutation.isPending}
                            onClick={() => pledgeMutation.mutate({ id: ewr.id })}>
                            <ArrowRightLeft className="w-3 h-3" />Pledge
                          </Button>
                          <Button
                            size="sm" className="h-7 text-xs gap-1"
                            disabled={redeemMutation.isPending}
                            onClick={() => redeemMutation.mutate({ id: ewr.id })}>
                            <Download className="w-3 h-3" />Redeem
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Detail Dialog */}
      <Dialog open={!!selectedReceipt} onOpenChange={() => setSelected(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="font-mono">{selectedReceipt?.receiptNumber}</DialogTitle>
            <DialogDescription>Electronic Warehouse Receipt Details</DialogDescription>
          </DialogHeader>
          {selectedReceipt && (() => {
            const commodity = COMMODITIES.find(c => c.symbol === selectedReceipt.commodity);
            const warehouse = WAREHOUSES.find(w => w.id === selectedReceipt.warehouseId);
            const grade = GRADE_SPECS.find(g => g.code === selectedReceipt.grade);
            const value = selectedReceipt.valueUsd ? parseFloat(selectedReceipt.valueUsd) : null;
  if (isLoading) return <PageSkeleton cards={4} tableRows={8} tableCols={4} />;
            return (
              <div className="space-y-3 text-sm">
                {[
                  ["Commodity",  commodity?.name || selectedReceipt.commodity],
                  ["Grade",      grade?.name || selectedReceipt.grade || "—"],
                  ["Quantity",   `${selectedReceipt.quantity} ${selectedReceipt.unit}`],
                  ["Warehouse",  warehouse?.name || selectedReceipt.warehouseName || "—"],
                  ["Location",   warehouse ? `${warehouse.city}, ${warehouse.state}, ${warehouse.country}` : "—"],
                  ["Issued",     new Date(selectedReceipt.createdAt).toLocaleDateString()],
                  ["Expires",    selectedReceipt.expiryDate ? new Date(selectedReceipt.expiryDate).toLocaleDateString() : "—"],
                  ["Status",     selectedReceipt.status],
                  ["Est. Value", value ? `$${value.toLocaleString()}` : "—"],
                  ["Notes",      selectedReceipt.notes || "—"],
                ].map(([k, v]) => (
                  <div key={k} className="flex justify-between py-1.5 border-b border-border/50 last:border-0">
                    <span className="text-muted-foreground">{k}</span>
                    <span className="font-medium text-foreground text-right">{v}</span>
                  </div>
                ))}
                {grade && (
                  <div className="mt-3 p-3 rounded-lg bg-secondary/50 text-xs text-muted-foreground">
                    <div className="font-semibold text-foreground mb-1">Grade Specification</div>
                    {grade.description}
                  </div>
                )}
                {selectedReceipt.status === "ACTIVE" && (
                  <div className="flex gap-2 pt-2">
                    <Button
                      variant="outline" className="flex-1"
                      disabled={pledgeMutation.isPending}
                      onClick={() => { pledgeMutation.mutate({ id: selectedReceipt.id }); setSelected(null); }}>
                      Pledge as Collateral
                    </Button>
                    <Button
                      className="flex-1"
                      disabled={redeemMutation.isPending}
                      onClick={() => { redeemMutation.mutate({ id: selectedReceipt.id }); setSelected(null); }}>
                      Redeem Receipt
                    </Button>
                  </div>
                )}
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>
    </div>
  );
}
