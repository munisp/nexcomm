/**
 * NEXCOM Exchange — Order Confirmation Modal
 * Shared across all 5 trading terminals (Commodities, Forex, Equities, Digital Assets, Indices)
 */
import { AlertTriangle, CheckCircle2, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export interface OrderConfirmDetails {
  symbol: string;
  assetClass: string;
  side: "BUY" | "SELL";
  orderType: "MARKET" | "LIMIT" | "STOP";
  quantity: number;
  price?: number;
  unit?: string;
  estimatedTotal?: number;
  estimatedFee?: number;
  settlementDate?: string;
  exchange?: string;
}

interface Props {
  open: boolean;
  details: OrderConfirmDetails | null;
  onConfirm: () => void;
  onCancel: () => void;
  isSubmitting?: boolean;
  submitted?: boolean;
  error?: string | null;
}

export function OrderConfirmModal({ open, details, onConfirm, onCancel, isSubmitting, submitted, error }: Props) {
  if (!open || !details) return null;

  const isBuy = details.side === "BUY";
  const fee = details.estimatedFee ?? (details.estimatedTotal ? details.estimatedTotal * 0.001 : 0);
  const total = details.estimatedTotal ?? (details.price ? details.quantity * details.price : 0);
  const totalWithFee = total + fee;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={!isSubmitting ? onCancel : undefined} />

      {/* Modal */}
      <div className="relative z-10 w-full max-w-md rounded-2xl border border-border bg-card shadow-2xl">
        {/* Header */}
        <div className={"flex items-center justify-between px-5 py-4 border-b border-border rounded-t-2xl " + (isBuy ? "bg-positive/5" : "bg-negative/5")}>
          <div className="flex items-center gap-3">
            <div className={"w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm " + (isBuy ? "bg-positive/20 text-positive" : "bg-negative/20 text-negative")}>
              {details.side}
            </div>
            <div>
              <div className="font-bold text-foreground">{details.symbol}</div>
              <div className="text-xs text-muted-foreground">{details.assetClass} · {details.exchange ?? "NEXCOM"}</div>
            </div>
          </div>
          {!isSubmitting && (
            <button onClick={onCancel} className="p-1.5 rounded-lg hover:bg-secondary transition-colors">
              <X className="w-4 h-4 text-muted-foreground" />
            </button>
          )}
        </div>

        {submitted ? (
          /* Success state */
          <div className="px-5 py-8 flex flex-col items-center gap-4">
            <div className="w-16 h-16 rounded-full bg-positive/15 flex items-center justify-center">
              <CheckCircle2 className="w-8 h-8 text-positive" />
            </div>
            <div className="text-center">
              <div className="text-lg font-bold text-foreground">Order Submitted</div>
              <div className="text-sm text-muted-foreground mt-1">
                Your {details.side} order for {details.quantity.toLocaleString()} {details.unit ?? "units"} of {details.symbol} has been placed successfully.
              </div>
            </div>
            <Button className="w-full" onClick={onCancel}>Close</Button>
          </div>
        ) : (
          /* Confirm state */
          <div className="px-5 py-4 space-y-4">
            {/* Order summary */}
            <div className="rounded-xl bg-secondary/50 border border-border divide-y divide-border/50">
              {[
                { label: "Order Type",    value: details.orderType },
                { label: "Quantity",      value: `${details.quantity.toLocaleString()} ${details.unit ?? "units"}` },
                ...(details.price ? [{ label: details.orderType === "MARKET" ? "Est. Price" : "Limit Price", value: details.price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 6 }) }] : []),
                { label: "Est. Value",    value: total > 0 ? total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "Market" },
                { label: "Exchange Fee",  value: fee > 0 ? `${fee.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} (0.1%)` : "0.00" },
                { label: "Total",         value: totalWithFee > 0 ? totalWithFee.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "Market", bold: true },
                ...(details.settlementDate ? [{ label: "Settlement", value: details.settlementDate }] : []),
              ].map(({ label, value, bold }) => (
                <div key={label} className="flex items-center justify-between px-3 py-2">
                  <span className="text-xs text-muted-foreground">{label}</span>
                  <span className={"text-xs font-mono " + (bold ? "font-bold text-foreground" : "text-foreground")}>{value}</span>
                </div>
              ))}
            </div>

            {/* Risk warning */}
            <div className="flex items-start gap-2 px-3 py-2.5 rounded-lg bg-yellow-500/10 border border-yellow-500/20">
              <AlertTriangle className="w-4 h-4 text-yellow-400 flex-shrink-0 mt-0.5" />
              <p className="text-xs text-muted-foreground leading-relaxed">
                Trading involves risk. This order will be executed at the best available price. Prices may change between confirmation and execution.
              </p>
            </div>

            {/* Error */}
            {error && (
              <div className="flex items-start gap-2 px-3 py-2.5 rounded-lg bg-destructive/10 border border-destructive/20">
                <AlertTriangle className="w-4 h-4 text-destructive flex-shrink-0 mt-0.5" />
                <p className="text-xs text-destructive">{error}</p>
              </div>
            )}

            {/* Actions */}
            <div className="flex gap-3 pt-1">
              <Button variant="outline" className="flex-1" onClick={onCancel} disabled={isSubmitting}>
                Cancel
              </Button>
              <Button
                className={"flex-1 gap-2 " + (isBuy ? "bg-positive hover:bg-positive/90 text-white" : "bg-negative hover:bg-negative/90 text-white")}
                onClick={onConfirm}
                disabled={isSubmitting}
              >
                {isSubmitting ? (
                  <><Loader2 className="w-4 h-4 animate-spin" />Placing Order...</>
                ) : (
                  `Confirm ${details.side}`
                )}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
