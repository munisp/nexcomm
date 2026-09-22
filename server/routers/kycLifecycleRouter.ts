/**
 * NEXCOM Exchange — KYC Lifecycle Router (FIX-KYB)
 * ─────────────────────────────────────────────────────────────────────────────
 * Completes the KYC lifecycle around the per-stakeholder KYC flows:
 *
 *  • KYC tier model (server/business-rules.ts):
 *      Tier 1 — ₦500K/day  (individual, basic NIN verification)
 *      Tier 2 — ₦5M/day    (individual, enhanced verification: ID + PoA + bank stmt)
 *      Tier 3 — no limit   (corporate, full CAC verification via approved KYB)
 *
 *  • requestTierUpgrade / adminReviewTierUpgrade — tier upgrade workflow with
 *    per-tier document requirements and audit trail.
 *  • adminDowngradeTier / adminEnforceReKycDowngrades — downgrade on re-KYC
 *    failure, hooking the re_kyc_flags raised by server/jobs/reKycScheduler.ts.
 *  • getUserTier(userId) — exported gating helper for other routers
 *    (e.g. orders/tradingEngine can import it to enforce KYC_DAILY_LIMITS).
 *
 * Tables: kyc_tier_upgrade_requests, user_kyc_tiers (drizzle/schema-kyb.ts,
 * migration 0070_kyb_workflows.sql).
 */
import { z } from "zod";
import { and, desc, eq, isNull, lt, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, adminProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { notifyOwner } from "../_core/notification";
import { writeAuditLog } from "../audit";
import { notifications, reKycFlags, users } from "../../drizzle/schema";
import {
  kycTierUpgradeRequests,
  kybApplications,
  userKycTiers,
} from "../../drizzle/schema-kyb";
import { KYC_DAILY_LIMITS } from "../business-rules";

// ─── Tier model ───────────────────────────────────────────────────────────────

export type KycTierName = "TIER_1" | "TIER_2" | "TIER_3";

const TIER_ORDER: Record<KycTierName, number> = { TIER_1: 1, TIER_2: 2, TIER_3: 3 };

/**
 * Documents required to upgrade INTO each tier.
 * Tier 1 is the baseline granted on any approved individual KYC — no upgrade
 * request is needed. Tier 3 requires an APPROVED KYB application (full CAC
 * verification); the listed documents are supplied through the KYB flow.
 */
export const TIER_UPGRADE_REQUIREMENTS: Record<KycTierName, { documents: string[]; requiresApprovedKyb: boolean }> = {
  TIER_1: { documents: [], requiresApprovedKyb: false },
  TIER_2: { documents: ["idDocument", "proofOfAddress", "bankStatement"], requiresApprovedKyb: false },
  TIER_3: { documents: [], requiresApprovedKyb: true },
};

/** Grace period after a re-KYC flag before the tier is force-downgraded. */
const REKYC_GRACE_DAYS = 30;

// ─── Exported gating helper ───────────────────────────────────────────────────

/**
 * Resolve a user's current KYC tier (1 | 2 | 3) for trade/order gating.
 * Returns 1 (most restrictive) when no tier row exists or the DB is
 * unavailable — fail-closed by default.
 */
export async function getUserTier(userId: number): Promise<1 | 2 | 3> {
  const db = await getDb();
  if (!db) return 1;
  try {
    const [row] = await db
      .select({ tier: userKycTiers.tier })
      .from(userKycTiers)
      .where(eq(userKycTiers.userId, userId))
      .limit(1);
    if (!row) return 1;
    return TIER_ORDER[row.tier] as 1 | 2 | 3;
  } catch {
    return 1;
  }
}

async function getTierRow(db: NonNullable<Awaited<ReturnType<typeof getDb>>>, userId: number) {
  const [row] = await db
    .select()
    .from(userKycTiers)
    .where(eq(userKycTiers.userId, userId))
    .limit(1);
  return row ?? null;
}

async function setUserTier(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  userId: number,
  tier: KycTierName,
  reason: string,
  updatedBy: number | null,
) {
  const now = new Date();
  await db.insert(userKycTiers)
    .values({ userId, tier, reason, updatedBy })
    .onConflictDoUpdate({
      target: userKycTiers.userId,
      set: { tier, reason, updatedBy, updatedAt: now },
    });
}

// ─── Router ───────────────────────────────────────────────────────────────────

export const kycLifecycleRouter = router({
  // ── getMyTier ───────────────────────────────────────────────────────────────
  getMyTier: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) return { tier: "TIER_1" as const, tierNumber: 1, dailyLimit: KYC_DAILY_LIMITS[1], pendingUpgrade: null };
    const row = await getTierRow(db, ctx.user.id);
    const tier: KycTierName = row?.tier ?? "TIER_1";
    const [pending] = await db
      .select()
      .from(kycTierUpgradeRequests)
      .where(and(
        eq(kycTierUpgradeRequests.userId, ctx.user.id),
        sql`${kycTierUpgradeRequests.status} IN ('PENDING','UNDER_REVIEW')`,
      ))
      .orderBy(desc(kycTierUpgradeRequests.createdAt))
      .limit(1);
    return {
      tier,
      tierNumber: TIER_ORDER[tier],
      dailyLimit: KYC_DAILY_LIMITS[TIER_ORDER[tier]],
      tierUpdatedAt: row?.updatedAt ?? null,
      pendingUpgrade: pending ?? null,
      requirements: TIER_UPGRADE_REQUIREMENTS,
    };
  }),

  // ── requestTierUpgrade ──────────────────────────────────────────────────────
  requestTierUpgrade: protectedProcedure
    .input(z.object({
      toTier: z.enum(["TIER_2", "TIER_3"]),
      /** slot → uploaded document URL (upload via kyb.uploadKybDocument or the KYC doc upload flows) */
      documents: z.record(z.string(), z.string().url()).default({}),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable — please try again" });

      const current = await getTierRow(db, ctx.user.id);
      const fromTier: KycTierName = current?.tier ?? "TIER_1";
      if (TIER_ORDER[input.toTier] <= TIER_ORDER[fromTier]) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Cannot request ${input.toTier}: current tier is already ${fromTier}.`,
        });
      }

      // Per-tier requirements
      const reqs = TIER_UPGRADE_REQUIREMENTS[input.toTier];
      const missingDocs = reqs.documents.filter((d) => !input.documents[d]);
      if (missingDocs.length > 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Missing required documents for ${input.toTier}: ${missingDocs.join(", ")}.`,
        });
      }

      let linkedKybId: number | null = null;
      if (reqs.requiresApprovedKyb) {
        const [kyb] = await db
          .select({ id: kybApplications.id, status: kybApplications.status })
          .from(kybApplications)
          .where(and(eq(kybApplications.userId, ctx.user.id), eq(kybApplications.status, "APPROVED")))
          .orderBy(desc(kybApplications.createdAt))
          .limit(1);
        if (!kyb) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message:
              "Tier 3 (corporate) requires an APPROVED KYB application with full CAC verification. " +
              "Complete KYB onboarding first (/kyb-onboarding).",
          });
        }
        linkedKybId = kyb.id;
      }

      // Upsert on (userId, toTier): a REJECTED request can be resubmitted;
      // an active (PENDING/UNDER_REVIEW) one conflicts.
      const [existing] = await db
        .select()
        .from(kycTierUpgradeRequests)
        .where(and(
          eq(kycTierUpgradeRequests.userId, ctx.user.id),
          eq(kycTierUpgradeRequests.toTier, input.toTier),
        ))
        .limit(1);
      if (existing && ["PENDING", "UNDER_REVIEW"].includes(existing.status)) {
        throw new TRPCError({ code: "CONFLICT", message: `A ${input.toTier} upgrade request is already ${existing.status}.` });
      }

      let requestId: number;
      if (existing) {
        const [updated] = await db.update(kycTierUpgradeRequests)
          .set({
            fromTier,
            documents: input.documents,
            kybApplicationId: linkedKybId,
            status: "PENDING",
            reviewedBy: null,
            reviewedAt: null,
            reviewNotes: null,
            updatedAt: new Date(),
          })
          .where(eq(kycTierUpgradeRequests.id, existing.id))
          .returning({ id: kycTierUpgradeRequests.id });
        requestId = updated.id;
      } else {
        const [inserted] = await db.insert(kycTierUpgradeRequests)
          .values({
            userId: ctx.user.id,
            fromTier,
            toTier: input.toTier,
            documents: input.documents,
            kybApplicationId: linkedKybId,
            status: "PENDING",
          })
          .returning({ id: kycTierUpgradeRequests.id });
        requestId = inserted.id;
      }

      writeAuditLog({
        userId: ctx.user.id,
        action: "KYC_TIER_UPGRADE_REQUESTED",
        resource: "kyc_tier_upgrade_requests",
        resourceId: String(requestId),
        details: { fromTier, toTier: input.toTier, kybApplicationId: linkedKybId },
      });
      notifyOwner({
        title: `[KYC] Tier upgrade requested — ${fromTier} → ${input.toTier}`,
        content: `User ${ctx.user.id} (${ctx.user.name ?? "unknown"}) requested a KYC tier upgrade to ${input.toTier}. Review in the admin KYC queue.`,
      }).catch((e) => console.warn("[kycLifecycleRouter] notifyOwner failed:", (e as Error).message));

      return { requestId, status: "PENDING" as const, fromTier, toTier: input.toTier };
    }),

  // ── adminListTierUpgrades ───────────────────────────────────────────────────
  adminListTierUpgrades: adminProcedure
    .input(z.object({
      status: z.enum(["PENDING", "UNDER_REVIEW", "APPROVED", "REJECTED"]).optional(),
      limit: z.number().int().min(1).max(100).default(50),
      offset: z.number().int().min(0).default(0),
    }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable — please try again" });
      const where = input.status ? eq(kycTierUpgradeRequests.status, input.status) : undefined;
      const [rows, countResult] = await Promise.all([
        db.select({
          id: kycTierUpgradeRequests.id,
          userId: kycTierUpgradeRequests.userId,
          fromTier: kycTierUpgradeRequests.fromTier,
          toTier: kycTierUpgradeRequests.toTier,
          documents: kycTierUpgradeRequests.documents,
          kybApplicationId: kycTierUpgradeRequests.kybApplicationId,
          status: kycTierUpgradeRequests.status,
          reviewNotes: kycTierUpgradeRequests.reviewNotes,
          createdAt: kycTierUpgradeRequests.createdAt,
          userName: users.name,
          userEmail: users.email,
        })
          .from(kycTierUpgradeRequests)
          .leftJoin(users, eq(kycTierUpgradeRequests.userId, users.id))
          .where(where)
          .orderBy(desc(kycTierUpgradeRequests.createdAt))
          .limit(input.limit)
          .offset(input.offset),
        db.select({ total: sql<number>`COUNT(*)::int` }).from(kycTierUpgradeRequests).where(where),
      ]);
      return { requests: rows, total: Number(countResult[0]?.total ?? 0) };
    }),

  // ── adminReviewTierUpgrade ──────────────────────────────────────────────────
  adminReviewTierUpgrade: adminProcedure
    .input(z.object({
      requestId: z.number().int().positive(),
      decision: z.enum(["APPROVED", "REJECTED"]),
      notes: z.string().max(4000).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable — please try again" });
      const [req] = await db
        .select()
        .from(kycTierUpgradeRequests)
        .where(eq(kycTierUpgradeRequests.id, input.requestId))
        .limit(1);
      if (!req) throw new TRPCError({ code: "NOT_FOUND", message: "Tier upgrade request not found" });
      if (!["PENDING", "UNDER_REVIEW"].includes(req.status)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: `Request is already ${req.status}.` });
      }
      if (input.decision === "REJECTED" && !input.notes) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Rejection notes are required." });
      }
      // Re-verify Tier 3 precondition at decision time (KYB may have been suspended)
      if (input.decision === "APPROVED" && req.toTier === "TIER_3") {
        const [kyb] = await db
          .select({ id: kybApplications.id })
          .from(kybApplications)
          .where(and(eq(kybApplications.userId, req.userId), eq(kybApplications.status, "APPROVED")))
          .limit(1);
        if (!kyb) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "Cannot approve Tier 3: the user no longer has an APPROVED KYB application.",
          });
        }
      }

      await db.transaction(async (tx) => {
        await tx.update(kycTierUpgradeRequests)
          .set({
            status: input.decision,
            reviewedBy: ctx.user.id,
            reviewedAt: new Date(),
            reviewNotes: input.notes ?? null,
            updatedAt: new Date(),
          })
          .where(eq(kycTierUpgradeRequests.id, req.id));
        if (input.decision === "APPROVED") {
          await tx.insert(userKycTiers)
            .values({
              userId: req.userId,
              tier: req.toTier,
              reason: `Tier upgrade request #${req.id} approved`,
              updatedBy: ctx.user.id,
            })
            .onConflictDoUpdate({
              target: userKycTiers.userId,
              set: {
                tier: req.toTier,
                reason: `Tier upgrade request #${req.id} approved`,
                updatedBy: ctx.user.id,
                updatedAt: new Date(),
              },
            });
        }
        await tx.insert(notifications).values({
          userId: req.userId,
          title: input.decision === "APPROVED" ? `KYC Tier Upgraded to ${req.toTier}` : "KYC Tier Upgrade Rejected",
          message:
            input.decision === "APPROVED"
              ? `Your KYC tier has been upgraded from ${req.fromTier} to ${req.toTier}. ` +
                (req.toTier === "TIER_3"
                  ? "Corporate trading limits now apply (no daily cap)."
                  : `Your new daily transaction limit is ₦${KYC_DAILY_LIMITS[TIER_ORDER[req.toTier]].toLocaleString()}.`)
              : `Your request to upgrade to ${req.toTier} was rejected. Reason: ${input.notes}.`,
          type: "KYC",
          metadata: { tierUpgradeRequestId: req.id, decision: input.decision, toTier: req.toTier },
        });
      });

      writeAuditLog({
        userId: ctx.user.id,
        action: `KYC_TIER_UPGRADE_${input.decision}`,
        resource: "kyc_tier_upgrade_requests",
        resourceId: String(req.id),
        details: { targetUserId: req.userId, fromTier: req.fromTier, toTier: req.toTier, notes: input.notes ?? null },
      });
      return { requestId: req.id, status: input.decision, toTier: req.toTier };
    }),

  // ── adminDowngradeTier (manual, e.g. re-KYC failure / compliance action) ────
  adminDowngradeTier: adminProcedure
    .input(z.object({
      userId: z.number().int().positive(),
      toTier: z.enum(["TIER_1", "TIER_2"]),
      reason: z.string().min(5).max(2000),
      reKycFlagId: z.number().int().positive().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable — please try again" });
      const current = await getTierRow(db, input.userId);
      const fromTier: KycTierName = current?.tier ?? "TIER_1";
      if (TIER_ORDER[input.toTier] >= TIER_ORDER[fromTier]) {
        throw new TRPCError({ code: "BAD_REQUEST", message: `User is already at ${fromTier}; nothing to downgrade.` });
      }
      await db.transaction(async (tx) => {
        await tx.insert(userKycTiers)
          .values({ userId: input.userId, tier: input.toTier, reason: input.reason, updatedBy: ctx.user.id })
          .onConflictDoUpdate({
            target: userKycTiers.userId,
            set: { tier: input.toTier, reason: input.reason, updatedBy: ctx.user.id, updatedAt: new Date() },
          });
        if (input.reKycFlagId) {
          await tx.update(reKycFlags)
            .set({ resolvedAt: new Date() })
            .where(and(eq(reKycFlags.id, input.reKycFlagId), eq(reKycFlags.userId, input.userId)));
        }
        await tx.insert(notifications).values({
          userId: input.userId,
          title: "KYC Tier Downgraded",
          message:
            `Your KYC tier has been changed from ${fromTier} to ${input.toTier}. Reason: ${input.reason}. ` +
            `Your daily transaction limit is now ₦${KYC_DAILY_LIMITS[TIER_ORDER[input.toTier]].toLocaleString()}. ` +
            `Please complete the requested re-verification to restore your previous tier.`,
          type: "KYC",
          metadata: { fromTier, toTier: input.toTier, reKycFlagId: input.reKycFlagId ?? null },
        });
      });
      writeAuditLog({
        userId: ctx.user.id,
        action: "KYC_TIER_DOWNGRADED",
        resource: "user_kyc_tiers",
        resourceId: String(input.userId),
        details: { fromTier, toTier: input.toTier, reason: input.reason, reKycFlagId: input.reKycFlagId ?? null },
      });
      return { userId: input.userId, fromTier, toTier: input.toTier };
    }),

  // ── adminEnforceReKycDowngrades ─────────────────────────────────────────────
  // Hooks the reKycScheduler pattern: unresolved re_kyc_flags older than the
  // grace period force a downgrade to TIER_1 until re-verification completes.
  adminEnforceReKycDowngrades: adminProcedure
    .input(z.object({ graceDays: z.number().int().min(1).max(180).default(REKYC_GRACE_DAYS) }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable — please try again" });
      const cutoff = new Date(Date.now() - input.graceDays * 24 * 60 * 60 * 1000);
      const staleFlags = await db
        .select()
        .from(reKycFlags)
        .where(and(isNull(reKycFlags.resolvedAt), lt(reKycFlags.createdAt, cutoff)))
        .limit(200);

      const results: { userId: number; flagId: number; action: string }[] = [];
      for (const flag of staleFlags) {
        const current = await getTierRow(db, flag.userId);
        const fromTier: KycTierName = current?.tier ?? "TIER_1";
        if (fromTier === "TIER_1") {
          results.push({ userId: flag.userId, flagId: flag.id, action: "ALREADY_TIER_1" });
          continue;
        }
        await db.transaction(async (tx) => {
          await tx.update(userKycTiers)
            .set({
              tier: "TIER_1",
              reason: `Re-KYC flag #${flag.id} unresolved after ${input.graceDays} days (${flag.reason})`,
              updatedBy: ctx.user.id,
              updatedAt: new Date(),
            })
            .where(eq(userKycTiers.userId, flag.userId));
          await tx.insert(notifications).values({
            userId: flag.userId,
            title: "KYC Tier Downgraded — Re-KYC Overdue",
            message:
              `Your re-verification is more than ${input.graceDays} days overdue, so your KYC tier has been ` +
              `reduced to Tier 1 (₦${KYC_DAILY_LIMITS[1].toLocaleString()}/day). Re-submit your documents to restore your tier.`,
            type: "KYC",
            metadata: { reKycFlagId: flag.id, fromTier, toTier: "TIER_1" },
          });
        });
        writeAuditLog({
          userId: ctx.user.id,
          action: "KYC_TIER_DOWNGRADED_REKYC",
          resource: "user_kyc_tiers",
          resourceId: String(flag.userId),
          details: { reKycFlagId: flag.id, fromTier, toTier: "TIER_1", reason: flag.reason },
        });
        results.push({ userId: flag.userId, flagId: flag.id, action: `DOWNGRADED_${fromTier}_TO_TIER_1` });
      }
      return { processed: staleFlags.length, downgraded: results.filter((r) => r.action.startsWith("DOWNGRADED")).length, results };
    }),
});
