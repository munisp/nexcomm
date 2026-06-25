/**
 * permify.ts — Permify RBAC middleware for tRPC procedures.
 *
 * Integrates with the Permify authorization server to enforce fine-grained
 * resource-level access control beyond the simple role check in adminProcedure.
 *
 * Usage:
 *   import { withPermify } from "./_core/permify";
 *
 *   // Protect a specific resource action
 *   const myProcedure = protectedProcedure
 *     .use(withPermify("order", "read"))
 *     .query(...)
 *
 *   // Protect with dynamic resource ID from input
 *   const myProcedure = protectedProcedure
 *     .input(z.object({ orderId: z.number() }))
 *     .use(withPermify("order", "write", (input) => String(input.orderId)))
 *     .mutation(...)
 */

import { TRPCError } from "@trpc/server";
import { trpcMiddleware } from "./trpc";

// ── Configuration ─────────────────────────────────────────────────────────────
const PERMIFY_URL = process.env.PERMIFY_URL ?? "http://localhost:3476";
const PERMIFY_TENANT = process.env.PERMIFY_TENANT ?? "nexcom";
const PERMIFY_TIMEOUT_MS = 3_000;

// ── Types ─────────────────────────────────────────────────────────────────────

/** Permify resource types — must match permify.perm schema */
export type PermifyResource =
  | "exchange"
  | "order"
  | "trade"
  | "settlement"
  | "kyc_application"
  | "warehouse_receipt"
  | "aml_flag"
  | "user_account";

/** Permify actions — must match permify.perm schema */
export type PermifyAction =
  | "view"
  | "create"
  | "edit"
  | "delete"
  | "approve"
  | "reject"
  | "escalate"
  | "export"
  | "manage"
  | "admin";

interface PermifyCheckRequest {
  metadata: { schema_version: string; snap_token: string; depth: number };
  entity: { type: string; id: string };
  permission: string;
  subject: { type: string; id: string; relation?: string };
}

interface PermifyCheckResponse {
  can: "RESULT_ALLOWED" | "RESULT_DENIED" | "RESULT_UNKNOWN";
  metadata?: { check_count: number };
}

// ── Core check function ───────────────────────────────────────────────────────

/**
 * Calls the Permify check endpoint.
 * Returns true if allowed, false if denied or on any error (fail-open is
 * configurable via PERMIFY_FAIL_OPEN env var — defaults to false / fail-closed).
 */
async function checkPermission(
  subjectId: string,
  resource: PermifyResource,
  resourceId: string,
  action: PermifyAction
): Promise<boolean> {
  const failOpen = process.env.PERMIFY_FAIL_OPEN === "true";

  const body: PermifyCheckRequest = {
    metadata: {
      schema_version: "",
      snap_token: "",
      depth: 20,
    },
    entity: {
      type: resource,
      id: resourceId,
    },
    permission: action,
    subject: {
      type: "user",
      id: subjectId,
    },
  };

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PERMIFY_TIMEOUT_MS);

    const res = await fetch(
      `${PERMIFY_URL}/v1/tenants/${PERMIFY_TENANT}/permissions/check`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      }
    );
    clearTimeout(timer);

    if (!res.ok) {
      console.warn(
        `[Permify] HTTP ${res.status} for ${subjectId}:${resource}/${resourceId}:${action}`
      );
      return failOpen;
    }

    const data = (await res.json()) as PermifyCheckResponse;
    return data.can === "RESULT_ALLOWED";
  } catch (err) {
    // Network error or timeout — apply fail-open/closed policy
    console.warn(
      `[Permify] Check failed (${(err as Error).message}) — fail-${failOpen ? "open" : "closed"}`
    );
    return failOpen;
  }
}

// ── tRPC middleware factory ───────────────────────────────────────────────────

/**
 * Creates a tRPC middleware that enforces a Permify permission check.
 *
 * @param resource   The Permify resource type (e.g. "order", "aml_flag")
 * @param action     The action to check (e.g. "view", "edit", "admin")
 * @param getResourceId  Optional function to extract the resource ID from the
 *                       procedure input. Defaults to "*" (wildcard — checks
 *                       whether the user has the action on any instance).
 */
export function withPermify(
  resource: PermifyResource,
  action: PermifyAction,
  getResourceId?: (input: unknown) => string
) {
  return trpcMiddleware(async ({ ctx, input, next }) => {
    // Only enforce when a user is present (protectedProcedure already guards this)
    if (!ctx.user) {
      throw new TRPCError({ code: "UNAUTHORIZED" });
    }

    const subjectId = String(ctx.user.id);
    const resourceId = getResourceId ? getResourceId(input) : "*";

    const allowed = await checkPermission(subjectId, resource, resourceId, action);

    if (!allowed) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: `You do not have '${action}' permission on ${resource}/${resourceId}`,
      });
    }

    // Pass ctx with user narrowed to non-null so downstream procedure handlers
    // don't receive TS18047 "possibly null" errors.
    const narrowedCtx = { ...ctx, user: ctx.user };
    return next({ ctx: narrowedCtx });
  });
}

// ── Convenience wrappers ──────────────────────────────────────────────────────

/** Allow only users who can 'admin' the exchange resource (super-admin gate). */
export const requireExchangeAdmin = withPermify("exchange", "admin", () => "nexcom");

/** Allow only users who can 'manage' user accounts (user-management gate). */
export const requireUserManage = withPermify("user_account", "manage", () => "*");

/** Allow only users who can 'approve' KYC applications. */
export const requireKycApprove = withPermify("kyc_application", "approve", () => "*");

/** Allow only users who can 'escalate' AML flags. */
export const requireAmlEscalate = withPermify("aml_flag", "escalate", () => "*");

/** Allow only users who can 'approve' settlements. */
export const requireSettlementApprove = withPermify("settlement", "approve", () => "*");

// ── Fund-flow Permify guards ──────────────────────────────────────────────────
// These guards are used by fund-flow routers to enforce fine-grained RBAC.
// Permify is fail-open by default in dev (PERMIFY_FAIL_OPEN=true) and
// fail-closed in production (PERMIFY_FAIL_OPEN=false).

/** Allow only users who can 'create' orders (trading permission). */
export const requireOrderCreate = withPermify("order", "create", () => "*");

/** Allow only users who can 'view' their own orders. */
export const requireOrderView = withPermify("order", "view", () => "*");

/** Allow only users who can 'create' trades (trade execution permission). */
export const requireTradeCreate = withPermify("trade", "create", () => "*");

/** Allow only users who can 'view' warehouse receipts. */
export const requireReceiptView = withPermify("warehouse_receipt", "view", () => "*");

/** Allow only users who can 'create' warehouse receipts. */
export const requireReceiptCreate = withPermify("warehouse_receipt", "create", () => "*");

/** Allow only users who can 'approve' warehouse receipts (warehouse operators). */
export const requireReceiptApprove = withPermify("warehouse_receipt", "approve", () => "*");
