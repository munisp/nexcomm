/**
 * useExchangeToasts — centralised toast notification helpers for NEXCOM Exchange.
 *
 * Provides typed wrappers around sonner's toast() API so every page uses
 * consistent messages and styling for common exchange events.
 */
import { toast } from "sonner";

// ── Order events ──────────────────────────────────────────────────────────────
export function toastOrderPlaced(symbol: string, side: "BUY" | "SELL", qty: number) {
  toast.success(`${side} order placed`, {
    description: `${qty} × ${symbol} submitted to the matching engine`,
    duration: 4000,
  });
}

export function toastOrderFilled(symbol: string, side: "BUY" | "SELL", qty: number, price: number) {
  toast.success(`Order filled ✓`, {
    description: `${side} ${qty} × ${symbol} @ ₦${price.toLocaleString("en-NG")}`,
    duration: 5000,
  });
}

export function toastOrderCancelled(orderId: number | string) {
  toast.info(`Order #${orderId} cancelled`, { duration: 3000 });
}

export function toastOrderRejected(reason?: string) {
  toast.error("Order rejected", {
    description: reason ?? "The exchange rejected this order",
    duration: 6000,
  });
}

// ── Profile events ────────────────────────────────────────────────────────────
export function toastProfileSaved() {
  toast.success("Profile updated", { duration: 3000 });
}

export function toastProfileError(msg?: string) {
  toast.error("Profile update failed", {
    description: msg ?? "Please try again",
    duration: 5000,
  });
}

// ── Search events ─────────────────────────────────────────────────────────────
export function toastSearchError(msg?: string) {
  toast.error("Search unavailable", {
    description: msg ?? "Please try again shortly",
    duration: 4000,
  });
}

// ── Generic helpers ───────────────────────────────────────────────────────────
export function toastApiError(action: string, msg?: string) {
  toast.error(`${action} failed`, {
    description: msg ?? "An unexpected error occurred",
    duration: 5000,
  });
}

export function toastSuccess(message: string, description?: string) {
  toast.success(message, { description, duration: 3000 });
}

export function toastInfo(message: string, description?: string) {
  toast.info(message, { description, duration: 3000 });
}

export function toastWarning(message: string, description?: string) {
  toast.warning(message, { description, duration: 4000 });
}

// ── Hook (re-exports all helpers for convenience) ─────────────────────────────
export function useExchangeToasts() {
  return {
    orderPlaced:    toastOrderPlaced,
    orderFilled:    toastOrderFilled,
    orderCancelled: toastOrderCancelled,
    orderRejected:  toastOrderRejected,
    profileSaved:   toastProfileSaved,
    profileError:   toastProfileError,
    searchError:    toastSearchError,
    apiError:       toastApiError,
    success:        toastSuccess,
    info:           toastInfo,
    warning:        toastWarning,
  };
}
