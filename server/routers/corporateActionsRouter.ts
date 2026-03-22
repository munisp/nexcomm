/**
 * corporateActionsRouter.ts
 * tRPC procedures for managing corporate actions:
 * DIVIDEND, STOCK_SPLIT, RIGHTS_ISSUE, BONUS_ISSUE, MERGER, DELISTING, IPO
 */
import { z } from "zod";
import { publicProcedure, protectedProcedure, adminProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { corporateActions, users } from "../../drizzle/schema";
import { eq, desc, and, or, ilike } from "drizzle-orm";
import { notifyOwner } from "../_core/notification";

const ACTION_TYPE_VALUES = ["DIVIDEND", "STOCK_SPLIT", "RIGHTS_ISSUE", "BONUS_ISSUE", "MERGER", "DELISTING", "IPO"] as const;
const STATUS_VALUES = ["DRAFT", "PENDING_APPROVAL", "APPROVED", "REJECTED", "CANCELLED", "COMPLETED"] as const;

const createCorporateActionInput = z.object({
  actionType: z.enum(ACTION_TYPE_VALUES),
  symbol: z.string().min(1).max(64),
  title: z.string().min(1).max(256),
  description: z.string().optional(),
  exDate: z.date().optional(),
  recordDate: z.date().optional(),
  paymentDate: z.date().optional(),
  announcementDate: z.date().optional(),
  dividendAmount: z.number().positive().optional(),
  dividendCurrency: z.string().max(8).optional(),
  splitRatioFrom: z.number().int().positive().optional(),
  splitRatioTo: z.number().int().positive().optional(),
  rightsPrice: z.number().positive().optional(),
  rightsRatio: z.string().max(32).optional(),
  ipoPrice: z.number().positive().optional(),
  ipoShares: z.number().int().positive().optional(),
});

export const corporateActionsRouter = router({
  /**
   * List all corporate actions (public — visible to all authenticated users).
   * Supports filtering by status, action type, and symbol search.
   */
  list: publicProcedure
    .input(z.object({
      status: z.enum(STATUS_VALUES).optional(),
      actionType: z.enum(ACTION_TYPE_VALUES).optional(),
      symbol: z.string().optional(),
      limit: z.number().int().min(1).max(100).default(50),
      offset: z.number().int().min(0).default(0),
    }))
    .query(async ({ input }) => {
      try {
        const db = await getDb();
        if (!db) return { actions: [], total: 0 };

        const conditions = [];
        if (input.status) conditions.push(eq(corporateActions.status, input.status));
        if (input.actionType) conditions.push(eq(corporateActions.actionType, input.actionType));
        if (input.symbol) conditions.push(ilike(corporateActions.symbol, `%${input.symbol}%`));

        const query = db
          .select({
            id: corporateActions.id,
            actionType: corporateActions.actionType,
            status: corporateActions.status,
            symbol: corporateActions.symbol,
            title: corporateActions.title,
            description: corporateActions.description,
            exDate: corporateActions.exDate,
            recordDate: corporateActions.recordDate,
            paymentDate: corporateActions.paymentDate,
            announcementDate: corporateActions.announcementDate,
            dividendAmount: corporateActions.dividendAmount,
            dividendCurrency: corporateActions.dividendCurrency,
            splitRatioFrom: corporateActions.splitRatioFrom,
            splitRatioTo: corporateActions.splitRatioTo,
            rightsPrice: corporateActions.rightsPrice,
            rightsRatio: corporateActions.rightsRatio,
            ipoPrice: corporateActions.ipoPrice,
            ipoShares: corporateActions.ipoShares,
            submittedAt: corporateActions.submittedAt,
            reviewedAt: corporateActions.reviewedAt,
            reviewNotes: corporateActions.reviewNotes,
            createdAt: corporateActions.createdAt,
            updatedAt: corporateActions.updatedAt,
          })
          .from(corporateActions)
          .orderBy(desc(corporateActions.submittedAt))
          .limit(input.limit)
          .offset(input.offset);

        const rows = conditions.length > 0
          ? await query.where(and(...conditions))
          : await query;

        return { actions: rows, total: rows.length };
      } catch {
        return { actions: [], total: 0 };
      }
    }),

  /**
   * Get a single corporate action by ID.
   */
  getById: publicProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ input }) => {
      try {
        const db = await getDb();
        if (!db) return null;
        const rows = await db.select().from(corporateActions).where(eq(corporateActions.id, input.id)).limit(1);
        return rows[0] ?? null;
      } catch {
        return null;
      }
    }),

  /**
   * Create a new corporate action (admin only).
   */
  create: adminProcedure
    .input(createCorporateActionInput)
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database unavailable");

      const rows = await db.insert(corporateActions).values({
        actionType: input.actionType,
        symbol: input.symbol,
        title: input.title,
        description: input.description ?? null,
        exDate: input.exDate ?? null,
        recordDate: input.recordDate ?? null,
        paymentDate: input.paymentDate ?? null,
        announcementDate: input.announcementDate ?? null,
        dividendAmount: input.dividendAmount?.toFixed(6) ?? null,
        dividendCurrency: input.dividendCurrency ?? null,
        splitRatioFrom: input.splitRatioFrom ?? null,
        splitRatioTo: input.splitRatioTo ?? null,
        rightsPrice: input.rightsPrice?.toFixed(6) ?? null,
        rightsRatio: input.rightsRatio ?? null,
        ipoPrice: input.ipoPrice?.toFixed(6) ?? null,
        ipoShares: input.ipoShares ?? null,
        status: "PENDING_APPROVAL",
        submittedBy: ctx.user.id,
        submittedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      }).returning({ id: corporateActions.id });

      return { id: rows[0].id };
    }),

  /**
   * Update a corporate action (admin only; only DRAFT or PENDING_APPROVAL can be edited).
   */
  update: adminProcedure
    .input(z.object({
      id: z.number().int().positive(),
      ...createCorporateActionInput.shape,
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database unavailable");

      await db.update(corporateActions)
        .set({
          actionType: input.actionType,
          symbol: input.symbol,
          title: input.title,
          description: input.description ?? null,
          exDate: input.exDate ?? null,
          recordDate: input.recordDate ?? null,
          paymentDate: input.paymentDate ?? null,
          announcementDate: input.announcementDate ?? null,
          dividendAmount: input.dividendAmount?.toFixed(6) ?? null,
          dividendCurrency: input.dividendCurrency ?? null,
          splitRatioFrom: input.splitRatioFrom ?? null,
          splitRatioTo: input.splitRatioTo ?? null,
          rightsPrice: input.rightsPrice?.toFixed(6) ?? null,
          rightsRatio: input.rightsRatio ?? null,
          ipoPrice: input.ipoPrice?.toFixed(6) ?? null,
          ipoShares: input.ipoShares ?? null,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(corporateActions.id, input.id),
            or(
              eq(corporateActions.status, "DRAFT"),
              eq(corporateActions.status, "PENDING_APPROVAL"),
            )
          )
        );

      return { success: true };
    }),

  /**
   * Approve a corporate action (admin only).
   */
  approve: adminProcedure
    .input(z.object({
      id: z.number().int().positive(),
      reviewNotes: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database unavailable");

      await db.update(corporateActions)
        .set({
          status: "APPROVED",
          reviewedBy: ctx.user.id,
          reviewNotes: input.reviewNotes ?? null,
          reviewedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(corporateActions.id, input.id),
            eq(corporateActions.status, "PENDING_APPROVAL"),
          )
        );

      // Non-blocking owner notification
      try {
        const rows = await db.select({ title: corporateActions.title, actionType: corporateActions.actionType, symbol: corporateActions.symbol }).from(corporateActions).where(eq(corporateActions.id, input.id)).limit(1);
        if (rows[0]) {
          await notifyOwner({
            title: `✅ Corporate Action Approved: ${rows[0].symbol}`,
            content: `**${rows[0].title}** (${rows[0].actionType}) has been approved.${input.reviewNotes ? `\n\nNotes: ${input.reviewNotes}` : ""}`,
          });
        }
      } catch { /* non-blocking */ }
      return { success: true };
    }),

  /**
   * Reject a corporate action (admin only).
   */
  reject: adminProcedure
    .input(z.object({
      id: z.number().int().positive(),
      reviewNotes: z.string().min(1, "Rejection reason is required"),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database unavailable");

      await db.update(corporateActions)
        .set({
          status: "REJECTED",
          reviewedBy: ctx.user.id,
          reviewNotes: input.reviewNotes,
          reviewedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(corporateActions.id, input.id),
            eq(corporateActions.status, "PENDING_APPROVAL"),
          )
        );

      // Non-blocking owner notification
      try {
        const rows = await db.select({ title: corporateActions.title, actionType: corporateActions.actionType, symbol: corporateActions.symbol }).from(corporateActions).where(eq(corporateActions.id, input.id)).limit(1);
        if (rows[0]) {
          await notifyOwner({
            title: `❌ Corporate Action Rejected: ${rows[0].symbol}`,
            content: `**${rows[0].title}** (${rows[0].actionType}) has been rejected.\n\nReason: ${input.reviewNotes}`,
          });
        }
      } catch { /* non-blocking */ }
      return { success: true };
    }),

  /**
   * Mark a corporate action as completed (admin only).
   */
  complete: adminProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database unavailable");

      await db.update(corporateActions)
        .set({ status: "COMPLETED", updatedAt: new Date() })
        .where(
          and(
            eq(corporateActions.id, input.id),
            eq(corporateActions.status, "APPROVED"),
          )
        );

      return { success: true };
    }),

  /**
   * Cancel a corporate action (admin only).
   */
  cancel: adminProcedure
    .input(z.object({
      id: z.number().int().positive(),
      reviewNotes: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database unavailable");

      await db.update(corporateActions)
        .set({
          status: "CANCELLED",
          reviewedBy: ctx.user.id,
          reviewNotes: input.reviewNotes ?? null,
          reviewedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(corporateActions.id, input.id));

      return { success: true };
    }),
});
