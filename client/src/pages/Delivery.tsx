/**
 * NEXCOM Exchange — Delivery Page
 * Schedule and track physical commodity deliveries — fully wired to tRPC backend
 */
import { useState } from "react";
import {
  Truck, MapPin, Calendar, Package, CheckCircle2,
  Clock, AlertCircle, Plus, Loader2, X, ChevronRight,
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
import { WAREHOUSES, COMMODITIES, CATEGORY_ICONS } from "../../../shared/commodities";

const STATUS_CONFIG = {
  PENDING:    { label: "Pending",    icon: Clock,        className: "badge-pending" },
  SCHEDULED:  { label: "Scheduled",  icon: Calendar,     className: "badge-pending" },
  IN_TRANSIT: { label: "In Transit", icon: Truck,        className: "badge-pending" },
  DELIVERED:  { label: "Delivered",  icon: CheckCircle2, className: "badge-settled" },
  CANCELLED:  { label: "Cancelled",  icon: AlertCircle,  className: "badge-cancelled" },
} as const;

type DeliveryStatus = keyof typeof STATUS_CONFIG;

const DELIVERY_STEPS = ["Pending", "Scheduled", "In Transit", "Delivered"];

function DeliveryProgress({ status }: { status: DeliveryStatus }) {
  const stepIndex = { PENDING: 0, SCHEDULED: 1, IN_TRANSIT: 2, DELIVERED: 3, CANCELLED: -1 }[status];
  if (stepIndex < 0) return null;
  return (
    <div className="flex items-center gap-1 mt-2">
      {DELIVERY_STEPS.map((step, i) => (
        <div key={step} className="flex items-center gap-1">
          <div className={"w-2 h-2 rounded-full flex-shrink-0 " + (i <= stepIndex ? "bg-primary" : "bg-border")} />
          <span className={"text-[10px] " + (i <= stepIndex ? "text-primary" : "text-muted-foreground/50")}>{step}</span>
          {i < DELIVERY_STEPS.length - 1 && <div className={"h-px w-4 flex-shrink-0 " + (i < stepIndex ? "bg-primary" : "bg-border")} />}
        </div>
      ))}    </div>
  );
}

export default function Delivery() {
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    commodity: "", quantity: "", unit: "MT",
    deliveryAddress: "", scheduledDate: "", notes: "",
  });
  const utils = trpc.useUtils();

  const { data, isLoading } = trpc.delivery.list.useQuery({ limit: 100 });
  const deliveries = data?.deliveries ?? [];
  const [detailDlv, setDetailDlv] = useState<typeof deliveries[0] | null>(null);

  const createMutation = trpc.delivery.create.useMutation({
    onSuccess: () => {
      toast.success("Delivery scheduled", {
        description: "Warehouse will confirm within 24 hours.",
      });
      setShowForm(false);
      setForm({ commodity: "", quantity: "", unit: "MT", deliveryAddress: "", scheduledDate: "", notes: "" });
      utils.delivery.list.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const cancelMutation = trpc.delivery.cancel.useMutation({
    onSuccess: () => {
      toast.success("Delivery cancelled");
      utils.delivery.list.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const handleSubmit = () => {
    if (!form.commodity || !form.deliveryAddress || !form.quantity) {
      toast.error("Please fill in all required fields");
      return;
    }
    createMutation.mutate({
      commodity: form.commodity,
      quantity: form.quantity,
      unit: form.unit,
      deliveryAddress: form.deliveryAddress,
      scheduledDate: form.scheduledDate ? new Date(form.scheduledDate) : undefined,
      notes: form.notes || undefined,
    });
  };

  return (
    <div className="page-container space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground" style={{ fontFamily: "'DM Serif Display', serif" }}>
            Delivery
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Schedule and track physical commodity deliveries
          </p>
        </div>
        <Button size="sm" className="gap-2" onClick={() => setShowForm(true)}>
          <Plus className="w-4 h-4" />Schedule Delivery
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "Total",      value: String(deliveries.length), color: "text-foreground" },
          { label: "In Transit", value: String(deliveries.filter(d => d.status === "IN_TRANSIT").length), color: "text-yellow-400" },
          { label: "Delivered",  value: String(deliveries.filter(d => d.status === "DELIVERED").length), color: "text-positive" },
          { label: "Pending",    value: String(deliveries.filter(d => d.status === "PENDING").length), color: "text-primary" },
        ].map(s => (
          <div key={s.label} className="stat-card text-center">
            <div className={"text-2xl font-bold font-mono " + s.color}>{s.value}</div>
            <div className="text-xs text-muted-foreground mt-1">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Delivery List */}
      {isLoading ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground">
          <Loader2 className="w-6 h-6 animate-spin mr-2" />Loading deliveries...
        </div>
      ) : (
        <div className="space-y-3">
          {deliveries.length === 0 && (
            <div className="py-12 text-center text-muted-foreground text-sm rounded-xl border border-border">
              No deliveries scheduled yet. Click "Schedule Delivery" to arrange physical delivery of your commodities.
            </div>
          )}
          {deliveries.map(dlv => {
            const commodity = COMMODITIES.find(c => c.symbol === dlv.commodity);
            const statusCfg = STATUS_CONFIG[dlv.status as DeliveryStatus] ?? STATUS_CONFIG.PENDING;
            const StatusIcon = statusCfg.icon;
            const catIcon = commodity ? CATEGORY_ICONS[commodity.category as keyof typeof CATEGORY_ICONS] : "🚚";
            return (
              <div key={dlv.id} className="rounded-xl border border-border bg-card p-4 hover:border-primary/30 transition-colors">
                <div className="flex flex-col sm:flex-row sm:items-start gap-4">
                  <div className="flex items-start gap-3 flex-1 min-w-0">
                    <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0 text-xl">
                      {catIcon}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-bold text-foreground font-mono text-sm">DLV-{String(dlv.id).padStart(4, "0")}</span>
                        <Badge className={"text-[10px] " + statusCfg.className}>
                          <StatusIcon className="w-3 h-3 mr-1" />{statusCfg.label}
                        </Badge>
                      </div>
                      <div className="text-sm font-semibold text-foreground mt-1">
                        {commodity?.name || dlv.commodity}
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        {dlv.quantity} {dlv.unit}
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1">
                        <MapPin className="w-3 h-3" />{dlv.deliveryAddress}
                      </div>
                      {dlv.scheduledDate && (
                        <div className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1">
                          <Calendar className="w-3 h-3" />
                          Scheduled: {new Date(dlv.scheduledDate).toLocaleDateString()}
                        </div>
                      )}
                      <DeliveryProgress status={dlv.status as DeliveryStatus} />
                    </div>
                  </div>
                  <div className="flex gap-2 flex-wrap justify-end items-start">
                    {dlv.status === "PENDING" && (
                      <Button
                        variant="outline" size="sm" className="h-7 text-xs gap-1 text-negative hover:text-negative"
                        disabled={cancelMutation.isPending}
                        onClick={() => cancelMutation.mutate({ id: dlv.id })}>
                        <X className="w-3 h-3" />Cancel
                      </Button>
                    )}
                    <Button variant="ghost" size="sm" className="h-7 text-xs gap-1" onClick={() => setDetailDlv(dlv)}>
                      <ChevronRight className="w-3 h-3" />Details
                    </Button>
                  </div>
                </div>
                {dlv.notes && (
                  <div className="mt-3 text-xs text-muted-foreground bg-secondary/50 rounded-lg px-3 py-2">
                    {dlv.notes}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Schedule Delivery Dialog */}
      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Schedule Delivery</DialogTitle>
            <DialogDescription>Arrange physical delivery of your commodities from a certified warehouse.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Commodity *</Label>
              <Select value={form.commodity} onValueChange={v => setForm(f => ({ ...f, commodity: v }))}>
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
                <Input
                  type="number" min="0" step="0.01"
                  placeholder="e.g. 50"
                  value={form.quantity}
                  onChange={e => setForm(f => ({ ...f, quantity: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Unit</Label>
                <Select value={form.unit} onValueChange={v => setForm(f => ({ ...f, unit: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {["MT", "KG", "Bags", "Tonnes", "Litres", "Barrels"].map(u => (
                      <SelectItem key={u} value={u}>{u}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Delivery Address *</Label>
              <Input
                placeholder="e.g. Lagos Port, Apapa, Lagos"
                value={form.deliveryAddress}
                onChange={e => setForm(f => ({ ...f, deliveryAddress: e.target.value }))}
              />
            </div>

            <div className="space-y-1.5">
              <Label>Scheduled Date</Label>
              <Input
                type="date"
                value={form.scheduledDate}
                onChange={e => setForm(f => ({ ...f, scheduledDate: e.target.value }))}
                min={new Date().toISOString().split("T")[0]}
              />
            </div>

            <div className="space-y-1.5">
              <Label>Notes</Label>
              <Input
                placeholder="Additional delivery instructions (optional)"
                value={form.notes}
                onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
              />
            </div>

            <div className="flex gap-3 pt-2">
              <Button variant="outline" className="flex-1" onClick={() => setShowForm(false)}>
                Cancel
              </Button>
              <Button
                className="flex-1"
                disabled={createMutation.isPending}
                onClick={handleSubmit}>
                {createMutation.isPending && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
                Schedule Delivery
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delivery Detail Dialog */}
      <Dialog open={!!detailDlv} onOpenChange={() => setDetailDlv(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Delivery Details</DialogTitle>
            <DialogDescription>
              {detailDlv ? `DLV-${String(detailDlv.id).padStart(4, "0")} · ${detailDlv.status}` : ""}
            </DialogDescription>
          </DialogHeader>
          {detailDlv && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                {([
                  ["Commodity",   detailDlv.commodity],
                  ["Quantity",    `${detailDlv.quantity} ${detailDlv.unit}`],
                  ["Status",      detailDlv.status],
                  ["Delivery To", detailDlv.deliveryAddress || "—"],
                  ["Requested",   new Date(detailDlv.createdAt).toLocaleDateString()],
                ] as [string, string][]).map(([k, v]) => (
                  <div key={k} className="rounded-lg bg-secondary/50 p-2.5">
                    <div className="text-[10px] text-muted-foreground uppercase tracking-wider">{k}</div>
                    <div className="text-sm font-semibold text-foreground mt-0.5">{v}</div>
                  </div>
                ))}
              </div>
              {detailDlv.notes && (
                <div className="rounded-lg bg-secondary/50 p-3">
                  <div className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">Notes</div>
                  <div className="text-sm text-foreground">{detailDlv.notes}</div>
                </div>
              )}
              <div className="flex gap-2 pt-1">
                {detailDlv.status === "PENDING" && (
                  <Button variant="destructive" size="sm" className="flex-1" disabled={cancelMutation.isPending}
                    onClick={() => { cancelMutation.mutate({ id: detailDlv.id }); setDetailDlv(null); }}>
                    Cancel Delivery
                  </Button>
                )}
                <Button variant="outline" size="sm" className="flex-1" onClick={() => setDetailDlv(null)}>Close</Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
