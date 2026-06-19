/**
 * NEXCOM Exchange — AmendOrderModal
 * ─────────────────────────────────────────────────────────────────────────────
 * Two-step order amendment dialog:
 *   Step 1 — Entry: edit quantity and/or limit price with live notional preview
 *   Step 2 — Confirm: show cost breakdown, fee impact, margin impact, then submit
 *
 * Mirrors the TradeModal confirmation flow for a consistent UX.
 */
import { useState, useEffect, useMemo } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import {
  AlertTriangle, ArrowRight, CheckCircle2, Edit3,
  TrendingUp, TrendingDown, Info,
} from "lucide-react";

// ── Fee constants (mirrors TradeModal) ──────────────────────────────────────
const MAKER_FEE_RATE = 0.001;  // 0.10%
const TAKER_FEE_RATE = 0.0015; // 0.15%
const MARGIN_RATE    = 0.10;   // 10% initial margin

// ── Types ─────────────────────────────────────────────────────────────────────
export interface AmendableOrder {
  id: number;
  symbol: string;
  side: "BUY" | "SELL";
  orderType: string;
  quantity: number;
  price: number | null;
  filledQty: number;
  assetClass: string;
  status: "OPEN" | "PARTIALLY_FILLED";
}

interface Props {
  order: AmendableOrder | null;
  open: boolean;
  onClose: () => void;
  onAmended?: () => void;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmt(n: number, decimals = 2) {
  return n.toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function fmtNGN(n: number) {
  return `₦${fmt(n)}`;
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function AmendOrderModal({ order, open, onClose, onAmended }: Props) {
  const [step, setStep] = useState<"entry" | "confirm">("entry");

  // Form state
  const [newQty, setNewQty] = useState("");
  const [newPrice, setNewPrice] = useState("");
  const [reason, setReason] = useState("");

  // Reset form when order changes or modal opens
  useEffect(() => {
    if (order && open) {
      setStep("entry");
      setNewQty(String(order.quantity));
      setNewPrice(order.price != null ? String(order.price) : "");
      setReason("");
    }
  }, [order, open]);

  // ── Margin summary ──────────────────────────────────────────────────────────
  const { data: marginData } = trpc.margin.getSummary.useQuery(undefined, {
    enabled: open && step === "confirm",
    staleTime: 10_000,
  });

  // ── Derived values ──────────────────────────────────────────────────────────
  const parsedQty   = parseFloat(newQty)   || 0;
  const parsedPrice = parseFloat(newPrice) || 0;

  const prevQty   = order?.quantity ?? 0;
  const prevPrice = order?.price ?? 0;

  const qtyChanged   = parsedQty   !== prevQty   && parsedQty   > 0;
  const priceChanged = parsedPrice !== prevPrice  && parsedPrice > 0;
  const hasChange    = qtyChanged || priceChanged;

  // Notional = qty × price (for limit orders)
  const execPrice  = parsedPrice > 0 ? parsedPrice : prevPrice;
  const notional   = parsedQty * execPrice;
  const prevNotional = prevQty * prevPrice;
  const notionalDelta = notional - prevNotional;

  // Fee estimate (use taker for market-like impact)
  const feeRate    = TAKER_FEE_RATE;
  const feeAmount  = notional * feeRate;
  const prevFeeAmount = prevNotional * feeRate;
  const feeDelta   = feeAmount - prevFeeAmount;

  // Margin impact
  const marginRequired = notional * MARGIN_RATE;
  const prevMarginRequired = prevNotional * MARGIN_RATE;
  const marginDelta = marginRequired - prevMarginRequired;

  const availableMargin = marginData?.availableMargin ?? 0;
  const marginInsufficient = order?.side === "BUY" && marginRequired > availableMargin;

  // Validation
  const filledQty = order?.filledQty ?? 0;
  const qtyError = parsedQty > 0 && parsedQty <= filledQty
    ? `Quantity must exceed already-filled amount (${filledQty.toLocaleString()})`
    : null;
  const priceError = parsedPrice < 0
    ? "Price must be positive"
    : null;
  const hasReason = reason.trim().length >= 3;
  const canProceed = hasChange && !qtyError && !priceError && parsedQty > 0 && hasReason;

  // ── Mutation ────────────────────────────────────────────────────────────────
  const utils = trpc.useUtils();
  const amendMutation = trpc.orders.amend.useMutation({
    onSuccess: () => {
      toast.success(`Order #${order?.id} amended successfully`);
      utils.orders.list.invalidate();
      utils.orders.stats.invalidate();
      onAmended?.();
      onClose();
    },
    onError: (e) => toast.error(`Amendment failed: ${e.message}`),
  });

  const handleSubmitAmend = () => {
    if (!order || !canProceed) return;
    amendMutation.mutate({
      orderId: order.id,
      quantity: qtyChanged   ? parsedQty   : undefined,
      price:    priceChanged ? parsedPrice : undefined,
      reason:   reason.trim() || undefined,
    });
  };

  if (!order) return null;

  const isLimitOrder = order.orderType === "LIMIT" || order.orderType === "STOP_LIMIT";

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-md bg-background border-border text-white">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-white">
            <Edit3 className="w-4 h-4 text-amber-400" />
            Amend Order #{order.id}
          </DialogTitle>
          <DialogDescription className="text-muted-foreground">
            <span className={order.side === "BUY" ? "text-emerald-400 font-semibold" : "text-red-400 font-semibold"}>
              {order.side}
            </span>
            {" "}{order.symbol} · {order.orderType} · {order.status}
          </DialogDescription>
        </DialogHeader>

        {/* ── Step indicator ── */}
        <div className="flex items-center gap-2 text-xs mb-4">
          <span className={step === "entry" ? "text-amber-400 font-semibold" : "text-muted-foreground"}>
            1. Edit
          </span>
          <ArrowRight className="w-3 h-3 text-gray-600" />
          <span className={step === "confirm" ? "text-amber-400 font-semibold" : "text-muted-foreground"}>
            2. Confirm
          </span>
        </div>

        {/* ─────────────────── STEP 1: ENTRY ─────────────────── */}
        {step === "entry" && (
          <div className="space-y-4">
            {/* Quantity */}
            <div className="space-y-1.5">
              <Label className="text-muted-foreground text-sm">
                Quantity
                {filledQty > 0 && (
                  <span className="ml-2 text-xs text-amber-400">
                    ({filledQty.toLocaleString()} already filled — min {(filledQty + 1).toLocaleString()})
                  </span>
                )}
              </Label>
              <Input
                type="number"
                min={filledQty + 0.0001}
                step="any"
                value={newQty}
                onChange={(e) => setNewQty(e.target.value)}
                className="bg-card border-border text-white"
                placeholder={String(order.quantity)}
              />
              {qtyError && (
                <p className="text-xs text-red-400 flex items-center gap-1">
                  <AlertTriangle className="w-3 h-3" /> {qtyError}
                </p>
              )}
            </div>

            {/* Price (limit orders only) */}
            {isLimitOrder && (
              <div className="space-y-1.5">
                <Label className="text-muted-foreground text-sm">Limit Price (₦)</Label>
                <Input
                  type="number"
                  min={0.0001}
                  step="any"
                  value={newPrice}
                  onChange={(e) => setNewPrice(e.target.value)}
                  className="bg-card border-border text-white"
                  placeholder={order.price != null ? String(order.price) : "Market"}
                />
                {priceError && (
                  <p className="text-xs text-red-400 flex items-center gap-1">
                    <AlertTriangle className="w-3 h-3" /> {priceError}
                  </p>
                )}
              </div>
            )}

            {/* Live notional preview */}
            {parsedQty > 0 && execPrice > 0 && (
              <div className="bg-card/60 border border-border rounded-lg p-3 text-sm">
                <div className="flex justify-between text-muted-foreground">
                  <span>Notional value</span>
                  <span className="text-white font-mono">{fmtNGN(notional)}</span>
                </div>
                {hasChange && (
                  <div className="flex justify-between text-muted-foreground mt-1">
                    <span>Change vs. current</span>
                    <span className={notionalDelta >= 0 ? "text-emerald-400 font-mono" : "text-red-400 font-mono"}>
                      {notionalDelta >= 0 ? "+" : ""}{fmtNGN(notionalDelta)}
                    </span>
                  </div>
                )}
              </div>
            )}

            {/* Reason — required for audit trail */}
            <div className="space-y-1.5">
              <Label className="text-muted-foreground text-sm">
                Reason <span className="text-red-400">*</span>
                <span className="text-muted-foreground font-normal ml-1">(required for audit trail)</span>
              </Label>
              <Input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                className={`bg-card border-border text-white ${
                  reason.length > 0 && !hasReason ? "border-red-500/60" : ""
                }`}
                placeholder="e.g. Adjusting for market conditions"
                maxLength={512}
              />
              {reason.length > 0 && !hasReason && (
                <p className="text-[11px] text-red-400">Reason must be at least 3 characters.</p>
              )}
              {!reason.length && (
                <p className="text-[11px] text-muted-foreground">A reason is required to proceed.</p>
              )}
            </div>

            {/* Changes summary */}
            {hasChange && (
              <div className="space-y-1 text-xs text-muted-foreground">
                {qtyChanged && (
                  <div className="flex items-center gap-1">
                    <Info className="w-3 h-3 text-amber-400" />
                    Qty: {prevQty.toLocaleString()} → {parsedQty.toLocaleString()}
                  </div>
                )}
                {priceChanged && (
                  <div className="flex items-center gap-1">
                    <Info className="w-3 h-3 text-amber-400" />
                    Price: {fmtNGN(prevPrice)} → {fmtNGN(parsedPrice)}
                  </div>
                )}
              </div>
            )}

            <div className="flex gap-3 pt-2">
              <Button
                variant="outline"
                className="flex-1 border-border text-muted-foreground hover:bg-secondary bg-transparent"
                onClick={onClose}
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

        {/* ─────────────────── STEP 2: CONFIRM ─────────────────── */}
        {step === "confirm" && (
          <div className="space-y-4">
            {/* Order summary */}
            <div className="bg-card/60 border border-border rounded-lg overflow-hidden">
              <div className="px-3 py-2 bg-secondary/50 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                Amendment Summary
              </div>
              <div className="divide-y divide-border">
                {[
                  ["Order ID",   `#${order.id}`],
                  ["Symbol",     order.symbol],
                  ["Side",       order.side],
                  ["Type",       order.orderType],
                  ...(qtyChanged   ? [["Quantity",    `${prevQty.toLocaleString()} → ${parsedQty.toLocaleString()}`]] : []),
                  ...(priceChanged ? [["Limit Price", `${fmtNGN(prevPrice)} → ${fmtNGN(parsedPrice)}`]]              : []),
                ].map(([label, value]) => (
                  <div key={label} className="flex justify-between px-3 py-2 text-sm">
                    <span className="text-muted-foreground">{label}</span>
                    <span className="text-white font-mono">{value}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Cost breakdown */}
            <div className="bg-card/60 border border-border rounded-lg overflow-hidden">
              <div className="px-3 py-2 bg-secondary/50 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                Cost Impact
              </div>
              <div className="divide-y divide-border">
                <div className="flex justify-between px-3 py-2 text-sm">
                  <span className="text-muted-foreground">New notional</span>
                  <span className="text-white font-mono">{fmtNGN(notional)}</span>
                </div>
                <div className="flex justify-between px-3 py-2 text-sm">
                  <span className="text-muted-foreground">
                    Est. fee ({(feeRate * 100).toFixed(2)}% taker)
                  </span>
                  <span className="text-amber-400 font-mono">{fmtNGN(feeAmount)}</span>
                </div>
                <div className="flex justify-between px-3 py-2 text-sm">
                  <span className="text-muted-foreground">Fee change vs. current</span>
                  <span className={feeDelta >= 0 ? "text-red-400 font-mono" : "text-emerald-400 font-mono"}>
                    {feeDelta >= 0 ? "+" : ""}{fmtNGN(feeDelta)}
                  </span>
                </div>
              </div>
            </div>

            {/* Margin impact */}
            <div className="bg-card/60 border border-border rounded-lg overflow-hidden">
              <div className="px-3 py-2 bg-secondary/50 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                Margin Impact
              </div>
              <div className="divide-y divide-border">
                <div className="flex justify-between px-3 py-2 text-sm">
                  <span className="text-muted-foreground">Available margin</span>
                  <span className="text-white font-mono">
                    {marginData ? fmtNGN(availableMargin) : "Loading…"}
                  </span>
                </div>
                <div className="flex justify-between px-3 py-2 text-sm">
                  <span className="text-muted-foreground">Margin required (10%)</span>
                  <span className="text-white font-mono">{fmtNGN(marginRequired)}</span>
                </div>
                <div className="flex justify-between px-3 py-2 text-sm">
                  <span className="text-muted-foreground">Margin change</span>
                  <span className={marginDelta >= 0 ? "text-amber-400 font-mono" : "text-emerald-400 font-mono"}>
                    {marginDelta >= 0 ? "+" : ""}{fmtNGN(marginDelta)}
                  </span>
                </div>
                {marginData && (
                  <div className="flex justify-between px-3 py-2 text-sm">
                    <span className="text-muted-foreground">Projected margin after</span>
                    <span className={marginInsufficient ? "text-red-400 font-mono" : "text-emerald-400 font-mono"}>
                      {fmtNGN(availableMargin - marginDelta)}
                    </span>
                  </div>
                )}
              </div>
            </div>

            {/* Insufficient margin warning */}
            {marginInsufficient && (
              <div className="flex items-start gap-2 p-3 bg-red-900/20 border border-red-700/40 rounded-lg text-xs text-red-300">
                <AlertTriangle className="w-4 h-4 text-red-400 mt-0.5 shrink-0" />
                <span>
                  Insufficient margin. This amendment requires {fmtNGN(marginRequired)} but only{" "}
                  {fmtNGN(availableMargin)} is available. Deposit funds or reduce the order size.
                </span>
              </div>
            )}

            <Separator className="bg-secondary" />

            <div className="flex gap-3">
              <Button
                variant="outline"
                className="flex-1 border-border text-muted-foreground hover:bg-secondary bg-transparent"
                onClick={() => setStep("entry")}
                disabled={amendMutation.isPending}
              >
                ← Back
              </Button>
              <Button
                className="flex-1 bg-amber-600 hover:bg-amber-500 text-white disabled:opacity-50"
                disabled={amendMutation.isPending || marginInsufficient}
                onClick={handleSubmitAmend}
              >
                {amendMutation.isPending ? (
                  <span className="flex items-center gap-2">
                    <span className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    Amending…
                  </span>
                ) : (
                  <span className="flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4" />
                    Confirm Amendment
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
