/**
 * Settlement Dispute Resolution Router
 * ──────────────────────────────────────
 * Procedures:
 *   disputes.raise           — raise a dispute on a SETTLED settlement
 *   disputes.myList          — list the caller's disputes
 *   disputes.getDetail       — get a dispute with its audit trail
 *   disputes.withdraw        — withdraw an OPEN dispute
 *   disputes.adminList       — admin: list all disputes with optional status filter
 *   disputes.adminAssign     — admin: assign a dispute to a reviewer
 *   disputes.adminSetStatus  — admin: move dispute to UNDER_REVIEW
 *   disputes.adminResolve    — admin: resolve a dispute (SETTLED or FAILED)
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, adminProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import {
  settlementDisputes,
  disputeAuditLog,
  settlements,
  notifications,
  disputeEvidence,
} from "../../drizzle/schema";
import { eq, and, desc, sql } from "drizzle-orm";
import { writeAuditLog } from "../audit";

// ─── helper ──────────────────────────────────────────────────────────────────

async function appendAuditEntry(
  db: Awaited<ReturnType<typeof getDb>>,
  disputeId: number,
  performedBy: number,
  action: string,
  fromStatus: string | null,
  toStatus: string | null,
  notes?: string,
) {
  if (!db) return;
  await db.insert(disputeAuditLog).values({
    disputeId,
    performedBy,
    action,
    fromStatus: fromStatus as typeof disputeAuditLog.$inferInsert["fromStatus"],
    toStatus: toStatus as typeof disputeAuditLog.$inferInsert["toStatus"],
    notes: notes ?? null,
  });
}

// ─── router ──────────────────────────────────────────────────────────────────

export const disputesRouter = router({
  /** Raise a dispute on a settlement */
  raise: protectedProcedure
    .input(z.object({
      settlementId: z.number().int().positive(),
      reason: z.string().min(10).max(2000),
      evidence: z.string().max(4000).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
            if (!db) throw new TRPCError({ code: "NOT_FOUND", message: "Not found" });

      // Verify the settlement belongs to the caller
      const [settlement] = await db
        .select()
        .from(settlements)
        .where(and(eq(settlements.id, input.settlementId), eq(settlements.userId, ctx.user.id)))
        .limit(1);

      if (!settlement) throw new TRPCError({ code: "NOT_FOUND", message: "Settlement not found" });

      if (!["SETTLED", "FAILED"].includes(settlement.status)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Cannot raise a dispute on a ${settlement.status} settlement. Only SETTLED or FAILED settlements can be disputed.`,
        });
      }

      // Check for existing open dispute
      const [existing] = await db
        .select()
        .from(settlementDisputes)
        .where(
          and(
            eq(settlementDisputes.settlementId, input.settlementId),
            eq(settlementDisputes.raisedBy, ctx.user.id),
          ),
        )
        .limit(1);

      if (existing && !["RESOLVED_SETTLED", "RESOLVED_FAILED", "WITHDRAWN"].includes(existing.status)) {
        throw new TRPCError({ code: "CONFLICT", message: "An active dispute already exists for this settlement" });
      }

      // Compute SLA deadline: raised date + 2 business days
      function addBusinessDays(date: Date, days: number): Date {
        const result = new Date(date);
        let added = 0;
        while (added < days) {
          result.setDate(result.getDate() + 1);
          const dow = result.getDay();
          if (dow !== 0 && dow !== 6) added++; // skip Sat/Sun
        }
        return result;
      }
      const slaDeadline = addBusinessDays(new Date(), 2);

      // Create the dispute
      const [dispute] = await db
        .insert(settlementDisputes)
        .values({
          settlementId: input.settlementId,
          raisedBy: ctx.user.id,
          status: "OPEN",
          reason: input.reason,
          evidence: input.evidence ?? null,
          slaDeadline,
          slaBreached: false,
        })
        .returning();

      // Write audit entry
      await appendAuditEntry(db, dispute.id, ctx.user.id, "RAISED", null, "OPEN", input.reason.slice(0, 120));

      // Update settlement status to DISPUTED
      await db
        .update(settlements)
        .set({ status: "DISPUTED", updatedAt: new Date() })
        .where(eq(settlements.id, input.settlementId));

      // In-app notification to the user
      await db.insert(notifications).values({
        userId: ctx.user.id,
        title: "Dispute Raised",
        message: `Your dispute for settlement #${input.settlementId} has been submitted and is under review. Our team will respond within 2 business days.`,
        type: "SETTLEMENT",
      });

      return dispute;
    }),

  /** List the caller's disputes */
  myList: protectedProcedure
    .input(z.object({
      status: z.enum(["OPEN", "UNDER_REVIEW", "RESOLVED_SETTLED", "RESOLVED_FAILED", "WITHDRAWN", "ALL"]).default("ALL"),
      limit: z.number().int().min(1).max(100).default(20),
      offset: z.number().int().min(0).default(0),
    }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) return { disputes: [], total: 0 };

      const conditions = [eq(settlementDisputes.raisedBy, ctx.user.id)];
      if (input.status !== "ALL") {
        conditions.push(eq(settlementDisputes.status, input.status));
      }

      const rows = await db
        .select()
        .from(settlementDisputes)
        .where(and(...conditions))
        .orderBy(desc(settlementDisputes.createdAt))
        .limit(input.limit)
        .offset(input.offset);

      const [{ count }] = await db
        .select({ count: sql<number>`COUNT(*)` })
        .from(settlementDisputes)
        .where(and(...conditions));

      return { disputes: rows, total: Number(count) };
    }),

  /** Get a dispute with its full audit trail */
  getDetail: protectedProcedure
    .input(z.object({ disputeId: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
            if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });

      const [dispute] = await db
        .select()
        .from(settlementDisputes)
        .where(eq(settlementDisputes.id, input.disputeId))
        .limit(1);

      if (!dispute) throw new TRPCError({ code: "NOT_FOUND", message: "Dispute not found" });

      // Only the raiser or an admin can view the dispute
      if (dispute.raisedBy !== ctx.user.id && ctx.user.role !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Access denied" });
      }

      const auditEntries = await db
        .select()
        .from(disputeAuditLog)
        .where(eq(disputeAuditLog.disputeId, input.disputeId))
        .orderBy(disputeAuditLog.createdAt);

      return { dispute, auditEntries };
    }),

  /** Withdraw an OPEN dispute */
  withdraw: protectedProcedure
    .input(z.object({
      disputeId: z.number().int().positive(),
      notes: z.string().max(512).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
            if (!db) throw new TRPCError({ code: "NOT_FOUND", message: "Not found" });

      const [dispute] = await db
        .select()
        .from(settlementDisputes)
        .where(and(eq(settlementDisputes.id, input.disputeId), eq(settlementDisputes.raisedBy, ctx.user.id)))
        .limit(1);

      if (!dispute) throw new TRPCError({ code: "NOT_FOUND", message: "Dispute not found" });
      if (!["OPEN", "UNDER_REVIEW"].includes(dispute.status)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Only OPEN or UNDER_REVIEW disputes can be withdrawn" });
      }

      await db
        .update(settlementDisputes)
        .set({ status: "WITHDRAWN", resolution: "WITHDRAWN", updatedAt: new Date(), resolvedAt: new Date() })
        .where(eq(settlementDisputes.id, input.disputeId));

      await appendAuditEntry(db, input.disputeId, ctx.user.id, "WITHDRAWN", dispute.status, "WITHDRAWN", input.notes);

      // Revert settlement to SETTLED
      await db
        .update(settlements)
        .set({ status: "SETTLED", updatedAt: new Date() })
        .where(eq(settlements.id, dispute.settlementId));

      return { success: true };
    }),

  /** Admin: list all disputes */
  adminList: adminProcedure
    .input(z.object({
      status: z.enum(["OPEN", "UNDER_REVIEW", "RESOLVED_SETTLED", "RESOLVED_FAILED", "WITHDRAWN", "ALL"]).default("ALL"),
      limit: z.number().int().min(1).max(100).default(50),
      offset: z.number().int().min(0).default(0),
    }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return { disputes: [], total: 0 };

      const conditions = input.status !== "ALL"
        ? [eq(settlementDisputes.status, input.status)]
        : [];

      const rows = await db
        .select()
        .from(settlementDisputes)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(desc(settlementDisputes.createdAt))
        .limit(input.limit)
        .offset(input.offset);

      const [{ count }] = await db
        .select({ count: sql<number>`COUNT(*)` })
        .from(settlementDisputes)
        .where(conditions.length > 0 ? and(...conditions) : undefined);

      return { disputes: rows, total: Number(count) };
    }),

  /** Admin: assign a dispute to a reviewer */
  adminAssign: adminProcedure
    .input(z.object({
      disputeId: z.number().int().positive(),
      assigneeId: z.number().int().positive(),
      notes: z.string().max(512).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
            if (!db) throw new TRPCError({ code: "NOT_FOUND", message: "Not found" });

      const [dispute] = await db
        .select()
        .from(settlementDisputes)
        .where(eq(settlementDisputes.id, input.disputeId))
        .limit(1);

      if (!dispute) throw new TRPCError({ code: "NOT_FOUND", message: "Dispute not found" });

      await db
        .update(settlementDisputes)
        .set({ assignedTo: input.assigneeId, status: "UNDER_REVIEW", updatedAt: new Date() })
        .where(eq(settlementDisputes.id, input.disputeId));

      await appendAuditEntry(db, input.disputeId, ctx.user.id, "ASSIGNED", dispute.status, "UNDER_REVIEW", input.notes);

      // Notify the raiser
      await db.insert(notifications).values({
        userId: dispute.raisedBy,
        title: "Dispute Under Review",
        message: `Your dispute for settlement #${dispute.settlementId} is now under review by our team.`,
        type: "SETTLEMENT",
      });

      return { success: true };
    }),

  /** Add evidence to an OPEN or UNDER_REVIEW dispute */
  addEvidence: protectedProcedure
    .input(z.object({
      disputeId: z.number().int().positive(),
      fileKey: z.string().min(1).max(512),
      fileUrl: z.string().url(),
      fileName: z.string().min(1).max(256),
      mimeType: z.string().min(1).max(128),
      fileSize: z.number().int().positive(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
            if (!db) throw new TRPCError({ code: "NOT_FOUND", message: "Not found" });

      // Verify the dispute exists and belongs to the caller (or admin)
      const [dispute] = await db
        .select()
        .from(settlementDisputes)
        .where(eq(settlementDisputes.id, input.disputeId))
        .limit(1);

      if (!dispute) throw new TRPCError({ code: "NOT_FOUND", message: "Dispute not found" });

      if (dispute.raisedBy !== ctx.user.id && ctx.user.role !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Access denied" });
      }

      if (["RESOLVED_SETTLED", "RESOLVED_FAILED", "WITHDRAWN"].includes(dispute.status)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Cannot add evidence to a resolved or withdrawn dispute" });
      }

      const [evidence] = await db
        .insert(disputeEvidence)
        .values({
          disputeId: input.disputeId,
          uploadedBy: ctx.user.id,
          fileKey: input.fileKey,
          fileUrl: input.fileUrl,
          fileName: input.fileName,
          mimeType: input.mimeType,
          fileSize: input.fileSize,
        })
        .returning();

      await appendAuditEntry(
        db, input.disputeId, ctx.user.id, "EVIDENCE_ADDED", dispute.status, dispute.status,
        `Evidence file attached: ${input.fileName}`,
      );

      return evidence;
    }),

  /** List evidence files for a dispute */
  listEvidence: protectedProcedure
    .input(z.object({ disputeId: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) return [];

      // Verify access
      const [dispute] = await db
        .select()
        .from(settlementDisputes)
        .where(eq(settlementDisputes.id, input.disputeId))
        .limit(1);

      if (!dispute) throw new TRPCError({ code: "NOT_FOUND", message: "Dispute not found" });

      if (dispute.raisedBy !== ctx.user.id && ctx.user.role !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Access denied" });
      }

      return db
        .select()
        .from(disputeEvidence)
        .where(eq(disputeEvidence.disputeId, input.disputeId))
        .orderBy(disputeEvidence.createdAt);
    }),

  /** Admin: resolve a dispute */
  adminResolve: adminProcedure
    .input(z.object({
      disputeId: z.number().int().positive(),
      resolution: z.enum(["SETTLED", "FAILED"]),
      resolutionNotes: z.string().min(10).max(2000),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
            if (!db) throw new TRPCError({ code: "NOT_FOUND", message: "Not found" });

      const [dispute] = await db
        .select()
        .from(settlementDisputes)
        .where(eq(settlementDisputes.id, input.disputeId))
        .limit(1);

      if (!dispute) throw new TRPCError({ code: "NOT_FOUND", message: "Dispute not found" });

      if (["RESOLVED_SETTLED", "RESOLVED_FAILED", "WITHDRAWN"].includes(dispute.status)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Dispute is already resolved" });
      }

      const newStatus = input.resolution === "SETTLED" ? "RESOLVED_SETTLED" : "RESOLVED_FAILED";

      await db
        .update(settlementDisputes)
        .set({
          status: newStatus,
          resolution: input.resolution,
          resolutionNotes: input.resolutionNotes,
          resolvedBy: ctx.user.id,
          updatedAt: new Date(),
          resolvedAt: new Date(),
        })
        .where(eq(settlementDisputes.id, input.disputeId));

      await appendAuditEntry(
        db, input.disputeId, ctx.user.id, "RESOLVED",
        dispute.status, newStatus, input.resolutionNotes.slice(0, 120),
      );

      // Update the settlement status to match the resolution
      await db
        .update(settlements)
        .set({ status: input.resolution, updatedAt: new Date() })
        .where(eq(settlements.id, dispute.settlementId));

      // Notify the raiser of the outcome
      const outcomeText = input.resolution === "SETTLED"
        ? "has been resolved in your favour — the settlement will proceed as SETTLED"
        : "has been reviewed and the original FAILED status has been upheld";

      await db.insert(notifications).values({
        userId: dispute.raisedBy,
        title: `Dispute ${input.resolution === "SETTLED" ? "Resolved ✓" : "Closed"}`,
        message: `Your dispute for settlement #${dispute.settlementId} ${outcomeText}. Notes: ${input.resolutionNotes.slice(0, 200)}`,
        type: "SETTLEMENT",
      });

      return { success: true, newStatus };
    }),

  /** Admin: list overdue disputes (past SLA deadline and not yet resolved) */
  adminListOverdue: adminProcedure
    .query(async () => {
      const db = await getDb();
      if (!db) return [];

      const now = new Date();
      const rows = await db
        .select()
        .from(settlementDisputes)
        .where(
          and(
            sql`${settlementDisputes.slaDeadline} IS NOT NULL`,
            sql`${settlementDisputes.slaDeadline} < ${now.toISOString()}`,
            sql`${settlementDisputes.status} NOT IN ('RESOLVED_SETTLED', 'RESOLVED_FAILED', 'WITHDRAWN')`,
          )
        )
        .orderBy(settlementDisputes.slaDeadline);

      return rows;
    }),

  /** Admin: mark SLA-breached disputes and send alerts */
  adminCheckSlaBreach: adminProcedure
    .mutation(async ({ ctx }) => {
      const db = await getDb();
            if (!db) throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "Database unavailable" });

      const now = new Date();
      // Find unresolved disputes past SLA deadline that haven't been flagged yet
      const overdue = await db
        .select()
        .from(settlementDisputes)
        .where(
          and(
            sql`${settlementDisputes.slaDeadline} IS NOT NULL`,
            sql`${settlementDisputes.slaDeadline} < ${now.toISOString()}`,
            eq(settlementDisputes.slaBreached, false),
            sql`${settlementDisputes.status} NOT IN ('RESOLVED_SETTLED', 'RESOLVED_FAILED', 'WITHDRAWN')`,
          )
        );

      let breachedCount = 0;
      for (const dispute of overdue) {
        // Mark as breached
        await db
          .update(settlementDisputes)
          .set({ slaBreached: true, updatedAt: new Date() })
          .where(eq(settlementDisputes.id, dispute.id));

        // Notify the raiser
        await db.insert(notifications).values({
          userId: dispute.raisedBy,
          title: "Dispute SLA Breached",
          message: `Your dispute for settlement #${dispute.settlementId} has exceeded the 2-business-day resolution target. Our team is prioritising your case.`,
          type: "SETTLEMENT",
        });

        // Audit log
        await appendAuditEntry(
          db, dispute.id, ctx.user.id, "SLA_BREACHED",
          dispute.status, dispute.status,
          `SLA deadline was ${dispute.slaDeadline?.toISOString()}`,
        );

        breachedCount++;
      }

      return { breachedCount };
    }),


  updateDispute: protectedProcedure
    .input(z.object({ disputeId: z.number().int(), description: z.string().optional(), evidence: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "Database unavailable" });
      const { disputeId, ...updates } = input;
      const [dispute] = await db.update(settlementDisputes)
        .set({ ...updates, updatedAt: new Date() })
        .where(and(eq(settlementDisputes.id, disputeId), eq(settlementDisputes.raisedBy, ctx.user.id)))
        .returning();
      if (!dispute) throw new TRPCError({ code: "NOT_FOUND", message: "Dispute not found or not yours" });
      return dispute;
    }),

  adminDeleteDispute: protectedProcedure
    .input(z.object({ disputeId: z.number().int(), reason: z.string() }))
    .mutation(async ({ ctx, input }) => {
      if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "Database unavailable" });
      const [dispute] = await db.delete(settlementDisputes).where(eq(settlementDisputes.id, input.disputeId)).returning();
      if (!dispute) throw new TRPCError({ code: "NOT_FOUND", message: "Dispute not found" });
      return { success: true };
    }),





});
