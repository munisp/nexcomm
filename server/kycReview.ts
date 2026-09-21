/**
 * NEXCOM Exchange — shared KYC review side-effects
 * ─────────────────────────────────────────────────────────────────────────────
 * Used by every stakeholder `adminReview*KYC` procedure so that a single
 * approve/reject decision keeps all identity stores in sync:
 *
 *   1. `profiles.kycStatus`   → VERIFIED / REJECTED (generic onboarding store)
 *   2. `profiles.accountType` → correct account_type enum value
 *   3. `users.role`           → farmer / trader / broker (never downgrades admin)
 *   4. `notifications`        → in-app message to the applicant
 */

import { and, eq, ne } from "drizzle-orm";
import { getDb } from "./db";
import { notifications, profiles, users } from "../drizzle/schema";

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;

export interface KycDecisionSideEffects {
  /** The applicant's users.id */
  userId: number;
  decision: "APPROVED" | "REJECTED";
  reviewerId: number;
  reviewerName?: string | null;
  notes?: string | null;
  /** Human label used in the notification text, e.g. "Trader" */
  stakeholderLabel: string;
  /** users.role to grant on approval (roleEnum only has farmer/trader/broker) */
  approvedRole?: "farmer" | "trader" | "broker";
  /** account_type to stamp on the generic profile */
  accountType?: "FARMER" | "TRADER" | "PROCESSOR" | "BROKER" | "WAREHOUSE_OPERATOR" | "MARKET_MAKER" | "ADMIN";
  /** Extra metadata merged into the notification row */
  metadata?: Record<string, unknown>;
}

/**
 * Apply the cross-store side effects of a stakeholder KYC decision.
 * Call with an open transaction client (tx) when available so the profile
 * update, role change, and notification commit atomically with the decision.
 */
export async function applyKycDecisionSideEffects(
  db: Db,
  opts: KycDecisionSideEffects,
): Promise<void> {
  const now = new Date();
  const approved = opts.decision === "APPROVED";

  // ── 1+2. Generic profiles store (upsert — stakeholder-only users may not
  // have a profiles row yet) ────────────────────────────────────────────────
  const profileSet: Record<string, unknown> = {
    kycStatus: approved ? "VERIFIED" : "REJECTED",
    kycNotes: opts.notes ?? null,
    updatedAt: now,
  };
  if (opts.accountType) profileSet.accountType = opts.accountType;
  await db
    .insert(profiles)
    .values({
      userId: opts.userId,
      accountType: (opts.accountType ?? "TRADER") as never,
      kycStatus: approved ? "VERIFIED" : "REJECTED",
      kycNotes: opts.notes ?? null,
    })
    .onConflictDoUpdate({ target: profiles.userId, set: profileSet });

  // ── 3. users.role — grant the stakeholder role on approval. Never downgrade
  // an existing admin. ──────────────────────────────────────────────────────
  if (approved && opts.approvedRole) {
    await db
      .update(users)
      .set({ role: opts.approvedRole, updatedAt: now })
      .where(and(eq(users.id, opts.userId), ne(users.role, "admin")));
    // roleEnum only contains user/admin/farmer/trader/broker — a WO/MM/admin
    // applicant keeps their current role and is authorised via profiles.
  }

  // ── 4. In-app notification to the applicant ───────────────────────────────
  await db.insert(notifications).values({
    userId: opts.userId,
    title: approved ? "KYC Application Approved ✓" : "KYC Application Rejected",
    message: approved
      ? `Your ${opts.stakeholderLabel} KYC application has been approved. Your account is now active on NEXCOM.`
      : `Your ${opts.stakeholderLabel} KYC application has been rejected.${opts.notes ? ` Reason: ${opts.notes}` : " Please contact support for details."}`,
    type: "KYC",
    read: false,
    metadata: {
      decision: opts.decision,
      reviewedBy: opts.reviewerId,
      ...(opts.metadata ?? {}),
    },
  });
}
