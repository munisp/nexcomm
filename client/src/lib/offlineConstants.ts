/**
 * NEXCOM Exchange — Offline queue constants (single source of truth)
 * ─────────────────────────────────────────────────────────────────────────────
 * Both the React app (hooks/useOfflineQueue.ts) and the service worker
 * (public/sw.js) share this IndexedDB database. The SW is a plain JS file and
 * cannot import TS modules — it HARDCODES identical values and carries a
 * cross-reference comment. If you change these constants, update public/sw.js
 * in the same commit.
 */
export const OFFLINE_DB_NAME = "nexcom-offline-queue";
export const OFFLINE_DB_VERSION = 1;
export const OFFLINE_STORE_NAME = "operations";

/** tRPC endpoint per queued operation type — mirrored in public/sw.js. */
export const OFFLINE_TRPC_ENDPOINTS: Record<string, string> = {
  place_order: "/api/trpc/orders.create",
  cancel_order: "/api/trpc/orders.cancel",
  amend_order: "/api/trpc/orders.amend",
  kyc_submit: "/api/trpc/kycService.submitApplication",
  receipt_create: "/api/trpc/receipts.create",
  alert_create: "/api/trpc/priceAlerts.create",
  profile_update: "/api/trpc/profile.update",
};
