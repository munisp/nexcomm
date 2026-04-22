/**
 * NEXCOM Exchange — Deposits Page
 * Register and track commodity deposits at certified warehouses — fully wired to tRPC backend
 */
import { useState } from "react";
import {
  Package, Plus, CheckCircle2, Clock, AlertCircle,
  MapPin, Scale, Search, ChevronRight, Loader2, X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { WAREHOUSES, COMMODITIES, GRADE_SPECS, CATEGORY_ICONS } from "../../../shared/commodities";
import { PageSkeleton } from "@/components/PageSkeleton";

const STATUS_CONFIG = {
  PENDING:  { label: "Pending",  icon: Clock,        className: "badge-pending" },
  RECEIVED: { label: "Received", icon: Package,      className: "badge-pending" },
  GRADED:   { label: "Graded",   icon: Scale,        className: "badge-pending" },
  STORED:   { label: "Stored",   icon: CheckCircle2, className: "badge-active" },
  REJECTED: { label: "Rejected", icon: AlertCircle,  className: "badge-cancelled" },
} as const;

type DepositStatus = keyof typeof STATUS_CONFIG;

const STEPS = ["Pending", "Received", "Graded", "Stored"];

function DepositProgress({ status }: { status: DepositStatus }) {
  const stepIndex = { PENDING: 0, RECEIVED: 1, GRADED: 2, STORED: 3, REJECTED: -1 }[status];
  if (stepIndex < 0) return null;
  return (
    <div className="flex items-center gap-1 mt-2">
      {STEPS.map((step, i) => (
        <div key={step} className="flex items-center gap-1">
          <div className={"w-2 h-2 rounded-full flex-shrink-0 " + (i <= stepIndex ? "bg-primary" : "bg-border")} />
          <span className={"text-[10px] " + (i <= stepIndex ? "text-primary" : "text-muted-foreground/50")}>{step}</span>
          {i < STEPS.length - 1 && <div className={"h-px w-4 flex-shrink-0 " + (i < stepIndex ? "bg-primary" : "bg-border")} />}
        </div>
      ))}    </div>
  );
}

export default function Deposits() {
  const [query, setQuery] = useState("");
  // Support deep-link from Warehouses page: /deposits?warehouseId=XXX
  const [showForm, setShowForm] = useState(() => {
    try { return !!new URLSearchParams(window.location.search).get("warehouseId"); } catch { return false; }
  });
  const [form, setForm] = useState(() => {
    try {
      const wid = new URLSearchParams(window.location.search).get("warehouseId") ?? "";
      return { commodity: "", warehouse: wid, grade: "", quantity: "", unit: "MT", notes: "" };
    } catch { return { commodity: "", warehouse: "", grade: "", quantity: "", unit: "MT", notes: "" }; }
  });
  const utils = trpc.useUtils();

  const { data, isLoading } = trpc.deposits.list.useQuery({ limit: 100 });
  const deposits = data?.deposits ?? [];
  const [detailDep, setDetailDep] = useState<typeof deposits[0] | null>(null);

  const createMutation = trpc.deposits.create.useMutation({
    onSuccess: () => {
      toast.success("Deposit registered", { description: "Warehouse will confirm intake within 24 hours." });
      setShowForm(false);
      setForm({ commodity: "", warehouse: "", grade: "", quantity: "", unit: "MT", notes: "" });
      utils.deposits.list.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const cancelMutation = trpc.deposits.cancel.useMutation({
    onSuccess: () => { toast.success("Deposit cancelled"); utils.deposits.list.invalidate(); },
    onError: (e) => toast.error(e.message),
  });

  const filtered = deposits.filter(d =>
    !query || String(d.id).includes(query) || d.commodity.toLowerCase().includes(query.toLowerCase())
  );

  const availableGrades = form.commodity ? GRADE_SPECS.filter(g => g.commodity === form.commodity) : [];
  const availableWarehouses = form.commodity ? WAREHOUSES.filter(w => w.commodities.includes(form.commodity)) : WAREHOUSES;

  const handleSubmit = () => {
    if (!form.commodity || !form.warehouse || !form.quantity) {
      toast.error("Please fill in all required fields");
      return;
    }
    const wh = WAREHOUSES.find(w => w.id === form.warehouse);
    createMutation.mutate({
      commodity: form.commodity,
      grade: form.grade || undefined,
      quantity: form.quantity,
      unit: form.unit,
      warehouseId: form.warehouse,
      warehouseName: wh?.name,
      notes: form.notes || undefined,
    });
  };

  return (
    <div className="page-container space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground" style={{ fontFamily: "'DM Serif Display', serif" }}>Deposits</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Register and track commodity deposits at certified warehouses</p>
        </div>
        <Button size="sm" className="gap-2" onClick={() => setShowForm(true)}>
          <Plus className="w-4 h-4" />New Deposit
        </Button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "Total",       value: String(deposits.length), color: "text-foreground" },
          { label: "Stored",      value: String(deposits.filter(d => d.status === "STORED").length), color: "text-positive" },
          { label: "In Progress", value: String(deposits.filter(d => ["PENDING","RECEIVED","GRADED"].includes(d.status)).length), color: "text-yellow-400" },
          { label: "Rejected",    value: String(deposits.filter(d => d.status === "REJECTED").length), color: "text-negative" },
        ].map(s => (
          <div key={s.label} className="stat-card text-center">
            <div className={"text-2xl font-bold font-mono " + s.color}>{s.value}</div>
            <div className="text-xs text-muted-foreground mt-1">{s.label}</div>
          </div>
        ))}
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input placeholder="Search by ID or commodity..." value={query} onChange={e => setQuery(e.target.value)} className="pl-9" />
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground">
          <Loader2 className="w-6 h-6 animate-spin mr-2" />Loading deposits...
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.length === 0 && (
            <div className="py-12 text-center text-muted-foreground text-sm rounded-xl border border-border">
              {deposits.length === 0 ? "No deposits yet. Click New Deposit to get started." : "No deposits match your search."}
            </div>
          )}
          {filtered.map(dep => {
            const commodity = COMMODITIES.find(c => c.symbol === dep.commodity);
            const warehouse = WAREHOUSES.find(w => w.id === dep.warehouseId);
            const statusCfg = STATUS_CONFIG[dep.status as DepositStatus] ?? STATUS_CONFIG.PENDING;
            const StatusIcon = statusCfg.icon;
            const catIcon = commodity ? CATEGORY_ICONS[commodity.category as keyof typeof CATEGORY_ICONS] : "\u{1F4E6}";
            return (
              <div key={dep.id} className="rounded-xl border border-border bg-card p-4 hover:border-primary/30 transition-colors">
                <div className="flex flex-col sm:flex-row sm:items-start gap-4">
                  <div className="flex items-start gap-3 flex-1 min-w-0">
                    <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0 text-xl">{catIcon}</div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-bold text-foreground font-mono text-sm">DEP-{String(dep.id).padStart(4, "0")}</span>
                        <Badge className={"text-[10px] " + statusCfg.className}>
                          <StatusIcon className="w-3 h-3 mr-1" />{statusCfg.label}
                        </Badge>
                      </div>
                      <div className="text-sm font-semibold text-foreground mt-1">{commodity?.name || dep.commodity}</div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        {dep.grade && `Grade: ${dep.grade} · `}{dep.quantity} {dep.unit}
                        {warehouse ? ` · ${warehouse.name}` : dep.warehouseName ? ` · ${dep.warehouseName}` : ""}
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1">
                        <MapPin className="w-3 h-3" />
                        {warehouse ? `${warehouse.city}, ${warehouse.state}` : "—"}
                        <span className="ml-2">Registered: {new Date(dep.createdAt).toLocaleDateString()}</span>
                      </div>
                      <DepositProgress status={dep.status as DepositStatus} />
                    </div>
                  </div>
                  <div className="flex gap-2 flex-wrap justify-end items-start">
                    {dep.status === "PENDING" && (
                      <Button variant="outline" size="sm" className="h-7 text-xs gap-1 text-negative hover:text-negative"
                        disabled={cancelMutation.isPending} onClick={() => cancelMutation.mutate({ id: dep.id })}>
                        <X className="w-3 h-3" />Cancel
                      </Button>
                    )}
                    <Button variant="ghost" size="sm" className="h-7 text-xs gap-1" onClick={() => setDetailDep(dep)}>
                      <ChevronRight className="w-3 h-3" />Details
                    </Button>
                  </div>
                </div>
                {dep.notes && <div className="mt-3 text-xs text-muted-foreground bg-secondary/50 rounded-lg px-3 py-2">{dep.notes}</div>}
              </div>
            );
          })}
        </div>
      )}

      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Register New Deposit</DialogTitle>
            <DialogDescription>Submit a commodity deposit request to a certified warehouse.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Commodity *</Label>
              <Select value={form.commodity} onValueChange={v => setForm(f => ({ ...f, commodity: v, grade: "", warehouse: "" }))}>
                <SelectTrigger><SelectValue placeholder="Select commodity" /></SelectTrigger>
                <SelectContent className="max-h-64">
                  {COMMODITIES.map(c => (
                    <SelectItem key={c.symbol} value={c.symbol}>
                      {CATEGORY_ICONS[c.category as keyof typeof CATEGORY_ICONS]} {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Quantity *</Label>
                <Input type="number" min="0" step="0.01" placeholder="e.g. 50" value={form.quantity}
                  onChange={e => setForm(f => ({ ...f, quantity: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label>Unit</Label>
                <Select value={form.unit} onValueChange={v => setForm(f => ({ ...f, unit: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {["MT", "KG", "Bags", "Tonnes", "Litres", "Barrels"].map(u => <SelectItem key={u} value={u}>{u}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            {availableGrades.length > 0 && (
              <div className="space-y-1.5">
                <Label>Grade</Label>
                <Select value={form.grade} onValueChange={v => setForm(f => ({ ...f, grade: v }))}>
                  <SelectTrigger><SelectValue placeholder="Select grade (optional)" /></SelectTrigger>
                  <SelectContent>
                    {availableGrades.map(g => <SelectItem key={g.code} value={g.code}>{g.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="space-y-1.5">
              <Label>Warehouse *</Label>
              <Select value={form.warehouse} onValueChange={v => setForm(f => ({ ...f, warehouse: v }))}>
                <SelectTrigger><SelectValue placeholder="Select warehouse" /></SelectTrigger>
                <SelectContent className="max-h-64">
                  {availableWarehouses.map(w => (
                    <SelectItem key={w.id} value={w.id}>
                      <span className="font-medium">{w.name}</span>
                      <span className="ml-2 text-muted-foreground text-xs">{w.city}, {w.state}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Notes</Label>
              <Input placeholder="Additional notes (optional)" value={form.notes}
                onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
            </div>
            <div className="flex gap-3 pt-2">
              <Button variant="outline" className="flex-1" onClick={() => setShowForm(false)}>Cancel</Button>
              <Button className="flex-1" disabled={createMutation.isPending} onClick={handleSubmit}>
                {createMutation.isPending && <Loader2 className="w-4 h-4 animate-spin mr-2" />}Submit Deposit
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Deposit Detail Dialog */}
      <Dialog open={!!detailDep} onOpenChange={() => setDetailDep(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Deposit Details</DialogTitle>
            <DialogDescription>
              {detailDep ? `DEP-${String(detailDep.id).padStart(4, "0")} · ${detailDep.status}` : ""}
            </DialogDescription>
          </DialogHeader>
          {detailDep && (() => {
            const commodity = COMMODITIES.find(c => c.symbol === detailDep.commodity);
            const warehouse = WAREHOUSES.find(w => w.id === detailDep.warehouseId);
            const statusCfg = STATUS_CONFIG[detailDep.status as DepositStatus] ?? STATUS_CONFIG.PENDING;
            const StatusIcon = statusCfg.icon;
  if (isLoading) return <PageSkeleton cards={4} tableRows={8} tableCols={4} />;
            return (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-2">
                  {[
                    ["Commodity",  commodity?.name || detailDep.commodity],
                    ["Grade",      detailDep.grade || "—"],
                    ["Quantity",   `${detailDep.quantity} ${detailDep.unit}`],
                    ["Status",     statusCfg.label],
                    ["Warehouse",  warehouse?.name || detailDep.warehouseName || "—"],
                    ["Location",   warehouse ? `${warehouse.city}, ${warehouse.state}` : "—"],
                    ["Registered", new Date(detailDep.createdAt).toLocaleDateString()],
                  ].map(([k, v]) => (
                    <div key={k} className="rounded-lg bg-secondary/50 p-2.5">
                      <div className="text-[10px] text-muted-foreground uppercase tracking-wider">{k}</div>
                      <div className="text-sm font-semibold text-foreground mt-0.5">{v}</div>
                    </div>
                  ))}
                </div>
                {detailDep.notes && (
                  <div className="rounded-lg bg-secondary/50 p-3">
                    <div className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">Notes</div>
                    <div className="text-sm text-foreground">{detailDep.notes}</div>
                  </div>
                )}
                <DepositProgress status={detailDep.status as DepositStatus} />
                <div className="flex gap-2 pt-1">
                  {detailDep.status === "PENDING" && (
                    <Button variant="destructive" size="sm" className="flex-1" disabled={cancelMutation.isPending}
                      onClick={() => { cancelMutation.mutate({ id: detailDep.id }); setDetailDep(null); }}>
                      Cancel Deposit
                    </Button>
                  )}
                  <Button variant="outline" size="sm" className="flex-1" onClick={() => setDetailDep(null)}>Close</Button>
                </div>
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>
    </div>
  );
}
