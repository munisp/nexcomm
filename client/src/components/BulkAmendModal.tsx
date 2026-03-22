/**
 * NEXCOM Exchange — BulkAmendModal
 * ─────────────────────────────────────────────────────────────────────────────
 * Two-step dialog for bulk-amending multiple OPEN/PARTIALLY_FILLED orders at once.
 *
 * Step 1 — Entry: set a shared new quantity and/or price + optional reason.
 * Step 2 — Confirm: summary table of affected orders, fee/notional impact, then submit.
 *
 * The same quantity and/or price is applied to every selected order.
 * Individual orders that fail validation (e.g. qty ≤ filledQty) are reported
 * in the result toast without blocking the rest.
 */
import { useState, useMemo } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { AlertTriangle, ArrowRight, CheckCircle2, Layers } from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────
export interface BulkAmendOrder {
  id: number;
  symbol: string;
  side: "BUY" | "SELL";
  orderType: string;
  quantity: number;
  price: number | null;
  filledQty: number;
  status: "OPEN" | "PARTIALLY_FILLED";
}

interface Props {
  orders: BulkAmendOrder[];
  open: boolean;
  onClose: () => void;
  onAmended?: () => void;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmt(n: number, decimals = 2) {
  return n.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}
function fmtNGN(n: number) {
  return `₦${fmt(n)}`;
}

const TAKER_FEE_RATE = 0.0015; // 0.15%

// ── Component ─────────────────────────────────────────────────────────────────
export default function BulkAmendModal({ orders, open, onClose, onAmended }: Props) {
  const [step, setStep] = useState<"entry" | "confirm">("entry");
  const [newQty, setNewQty]     = useState("");
  const [newPrice, setNewPrice] = useState("");
  const [reason, setReason]     = useState("");

  // Reset when modal opens
  const resetForm = () => { setStep("entry"); setNewQty(""); setNewPrice(""); setReason(""); };

  const parsedQty   = parseFloat(newQty)   || 0;
  const parsedPrice = parseFloat(newPrice) || 0;

  const hasQty   = parsedQty   > 0;
  const hasPrice = parsedPrice > 0;
  const hasChange = hasQty || hasPrice;

  // Per-order validation: flag orders where new qty ≤ filledQty
  const perOrderValidation = useMemo(() => {
    if (!hasQty) return orders.map(() => null);
    return orders.map((o) =>
      parsedQty <= o.filledQty
        ? `Qty (${parsedQty}) ≤ filled (${o.filledQty})`
        : null
    );
  }, [orders, parsedQty, hasQty]);

  const invalidCount = perOrderValidation.filter(Boolean).length;
  const validCount   = orders.length - invalidCount;

  // Aggregate notional impact (only for valid orders)
  const totalNewNotional = useMemo(() => {
    const qty   = hasQty   ? parsedQty   : 0;
    const price = hasPrice ? parsedPrice : 0;
    if (!qty || !price) return 0;
    return orders
      .filter((_, i) => !perOrderValidation[i])
      .reduce((sum) => sum + qty * price, 0);
  }, [orders, parsedQty, parsedPrice, hasQty, hasPrice, perOrderValidation]);

  const totalNewFee = totalNewNotional * TAKER_FEE_RATE;

  const hasReason = reason.trim().length >= 3;
  const canProceed = hasChange && validCount > 0 && hasReason;

  // ── Mutation ────────────────────────────────────────────────────────────────
  const utils = trpc.useUtils();
  const amendManyMutation = trpc.orders.amendMany.useMutation({
    onSuccess: (res) => {
      if (res.amended > 0 && res.failed === 0) {
        toast.success(`${res.amended} order${res.amended !== 1 ? "s" : ""} amended successfully`);
      } else if (res.amended > 0) {
        toast.warning(`${res.amended} amended, ${res.failed} failed`);
      } else {
        toast.error(`All ${res.failed} amendments failed`);
      }
      utils.orders.list.invalidate();
      utils.orders.stats?.invalidate?.();
      onAmended?.();
      onClose();
      resetForm();
    },
    onError: (e) => toast.error(`Bulk amendment failed: ${e.message}`),
  });

  const handleSubmit = () => {
    if (!canProceed) return;
    const validIds = orders
      .filter((_, i) => !perOrderValidation[i])
      .map((o) => o.id);
    amendManyMutation.mutate({
      ids:      validIds,
      quantity: hasQty   ? parsedQty   : undefined,
      price:    hasPrice ? parsedPrice : undefined,
      reason:   reason.trim() || undefined,
    });
  };

  if (orders.length === 0) return null;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) { onClose(); resetForm(); } }}>
      <DialogContent className="max-w-lg bg-gray-950 border-gray-800 text-white">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-white">
            <Layers className="w-4 h-4 text-amber-400" />
            Bulk Amend {orders.length} Order{orders.length !== 1 ? "s" : ""}
          </DialogTitle>
          <DialogDescription className="text-gray-400">
            Apply the same quantity and/or price change to all selected orders.
          </DialogDescription>
        </DialogHeader>

        {/* Step indicator */}
        <div className="flex items-center gap-2 text-xs mb-4">
          <span className={step === "entry" ? "text-amber-400 font-semibold" : "text-gray-500"}>1. Edit</span>
          <ArrowRight className="w-3 h-3 text-gray-600" />
          <span className={step === "confirm" ? "text-amber-400 font-semibold" : "text-gray-500"}>2. Confirm</span>
        </div>

        {/* ── STEP 1: ENTRY ── */}
        {step === "entry" && (
          <div className="space-y-4">
            {/* Selected orders summary */}
            <div className="bg-gray-900/60 border border-gray-800 rounded-lg p-3 max-h-36 overflow-y-auto">
              <p className="text-xs text-gray-500 mb-2 uppercase tracking-wide font-semibold">Selected Orders</p>
              <div className="space-y-1">
                {orders.map((o, i) => (
                  <div key={o.id} className="flex items-center justify-between text-xs">
                    <span className="font-mono text-gray-300">#{o.id} {o.symbol}</span>
                    <div className="flex items-center gap-2">
                      <span className={o.side === "BUY" ? "text-emerald-400" : "text-red-400"}>{o.side}</span>
                      {perOrderValidation[i] && (
                        <span className="text-red-400 text-[10px]">⚠ {perOrderValidation[i]}</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {invalidCount > 0 && (
              <div className="flex items-start gap-2 p-3 bg-amber-900/20 border border-amber-700/40 rounded-lg text-xs text-amber-300">
                <AlertTriangle className="w-4 h-4 text-amber-400 mt-0.5 shrink-0" />
                <span>
                  {invalidCount} order{invalidCount !== 1 ? "s" : ""} will be skipped (new qty ≤ filled qty).
                  {validCount > 0 && ` ${validCount} will be amended.`}
                </span>
              </div>
            )}

            {/* New Quantity */}
            <div className="space-y-1.5">
              <Label className="text-gray-300 text-sm">
                New Quantity <span className="text-gray-500 font-normal">(optional — leave blank to keep current)</span>
              </Label>
              <Input
                type="number"
                min={0.0001}
                step="any"
                value={newQty}
                onChange={(e) => setNewQty(e.target.value)}
                className="bg-gray-900 border-gray-700 text-white"
                placeholder="e.g. 100"
              />
            </div>

            {/* New Price */}
            <div className="space-y-1.5">
              <Label className="text-gray-300 text-sm">
                New Limit Price (₦) <span className="text-gray-500 font-normal">(optional)</span>
              </Label>
              <Input
                type="number"
                min={0.0001}
                step="any"
                value={newPrice}
                onChange={(e) => setNewPrice(e.target.value)}
                className="bg-gray-900 border-gray-700 text-white"
                placeholder="e.g. 1850"
              />
            </div>

            {/* Reason — required for bulk amendments */}
            <div className="space-y-1.5">
              <Label className="text-gray-300 text-sm">
                Reason <span className="text-red-400">*</span>
                <span className="text-gray-500 font-normal ml-1">(required for audit trail)</span>
              </Label>
              <Input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                className={`bg-gray-900 border-gray-700 text-white ${
                  reason.length > 0 && !hasReason ? "border-red-500/60" : ""
                }`}
                placeholder="e.g. Adjusting for market volatility"
                maxLength={512}
              />
              {reason.length > 0 && !hasReason && (
                <p className="text-[11px] text-red-400">Reason must be at least 3 characters.</p>
              )}
              {!reason.length && (
                <p className="text-[11px] text-gray-500">A reason is required to proceed with bulk amendments.</p>
              )}
            </div>

            <div className="flex gap-3 pt-2">
              <Button
                variant="outline"
                className="flex-1 border-gray-700 text-gray-300 hover:bg-gray-800 bg-transparent"
                onClick={() => { onClose(); resetForm(); }}
              >
                Cancel
              </Button>
              <Button
                className="flex-1 bg-amber-600 hover:bg-amber-500 text-white"
                disabled={!canProceed}
                onClick={() => setStep("confirm")}
              >
                Review Changes →
              </Button>
            </div>
          </div>
        )}

        {/* ── STEP 2: CONFIRM ── */}
        {step === "confirm" && (
          <div className="space-y-4">
            {/* Summary */}
            <div className="bg-gray-900/60 border border-gray-800 rounded-lg overflow-hidden">
              <div className="px-3 py-2 bg-gray-800/50 text-xs font-semibold text-gray-400 uppercase tracking-wide">
                Amendment Summary
              </div>
              <div className="divide-y divide-gray-800">
                <div className="flex justify-between px-3 py-2 text-sm">
                  <span className="text-gray-400">Orders to amend</span>
                  <Badge className="bg-amber-600/20 text-amber-400 border-amber-600/30">{validCount}</Badge>
                </div>
                {invalidCount > 0 && (
                  <div className="flex justify-between px-3 py-2 text-sm">
                    <span className="text-gray-400">Orders skipped</span>
                    <Badge className="bg-red-600/20 text-red-400 border-red-600/30">{invalidCount}</Badge>
                  </div>
                )}
                {hasQty && (
                  <div className="flex justify-between px-3 py-2 text-sm">
                    <span className="text-gray-400">New quantity</span>
                    <span className="text-white font-mono">{parsedQty.toLocaleString()}</span>
                  </div>
                )}
                {hasPrice && (
                  <div className="flex justify-between px-3 py-2 text-sm">
                    <span className="text-gray-400">New limit price</span>
                    <span className="text-white font-mono">{fmtNGN(parsedPrice)}</span>
                  </div>
                )}
                {reason.trim() && (
                  <div className="flex justify-between px-3 py-2 text-sm">
                    <span className="text-gray-400">Reason</span>
                    <span className="text-gray-300 italic text-right max-w-[60%]">"{reason.trim()}"</span>
                  </div>
                )}
              </div>
            </div>

            {/* Aggregate cost impact (only when both qty and price are set) */}
            {hasQty && hasPrice && totalNewNotional > 0 && (
              <div className="bg-gray-900/60 border border-gray-800 rounded-lg overflow-hidden">
                <div className="px-3 py-2 bg-gray-800/50 text-xs font-semibold text-gray-400 uppercase tracking-wide">
                  Aggregate Cost Impact
                </div>
                <div className="divide-y divide-gray-800">
                  <div className="flex justify-between px-3 py-2 text-sm">
                    <span className="text-gray-400">Total new notional</span>
                    <span className="text-white font-mono">{fmtNGN(totalNewNotional)}</span>
                  </div>
                  <div className="flex justify-between px-3 py-2 text-sm">
                    <span className="text-gray-400">Est. total fee (0.15% taker)</span>
                    <span className="text-amber-400 font-mono">{fmtNGN(totalNewFee)}</span>
                  </div>
                </div>
              </div>
            )}

            <Separator className="bg-gray-800" />

            <div className="flex gap-3">
              <Button
                variant="outline"
                className="flex-1 border-gray-700 text-gray-300 hover:bg-gray-800 bg-transparent"
                onClick={() => setStep("entry")}
                disabled={amendManyMutation.isPending}
              >
                ← Back
              </Button>
              <Button
                className="flex-1 bg-amber-600 hover:bg-amber-500 text-white disabled:opacity-50"
                disabled={amendManyMutation.isPending || validCount === 0}
                onClick={handleSubmit}
              >
                {amendManyMutation.isPending ? (
                  <span className="flex items-center gap-2">
                    <span className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    Amending {validCount} order{validCount !== 1 ? "s" : ""}…
                  </span>
                ) : (
                  <span className="flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4" />
                    Confirm — Amend {validCount} Order{validCount !== 1 ? "s" : ""}
                  </span>
                )}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
