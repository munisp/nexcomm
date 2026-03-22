import { randomUUID } from 'crypto';
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { adminProcedure, protectedProcedure, router } from "../_core/trpc";
import { requireAmlEscalate } from "../_core/permify";
import { getDb } from "../db";
import {
  amlRules,
  amlFlags,
  sarReports,
  complianceExports,
  users,
  profiles,
  velocityLedger,
} from "../../drizzle/schema";
import { eq, and, gte, lte, desc, count, sum, sql, inArray } from "drizzle-orm";
import { notifyOwner } from "../_core/notification";
import { storagePut } from "../storage";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function generateReportNumber(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `SAR-${y}${m}${d}-${randomUUID().replace(/-/g, "").substring(0,6).toUpperCase()}`;
}

/** Run AML detection rules against a transaction and return triggered flags */
export async function runAmlDetection(params: {
  userId: number;
  transactionType: string;
  transactionRef: string;
  amount: number;
  currency: string;
}): Promise<void> {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
  const { userId, transactionType, transactionRef, amount, currency } = params;

  // Fetch active rules
  const rules = await db
    .select()
    .from(amlRules)
    .where(and(eq(amlRules.isActive, true), eq(amlRules.currency, currency)));

  const now = new Date();

  for (const rule of rules) {
    let triggered = false;
    let flagReason = "";

    switch (rule.ruleType) {
      case "LARGE_TRANSACTION": {
        const threshold = parseFloat(rule.thresholdAmount ?? "0");
        if (amount >= threshold) {
          triggered = true;
          flagReason = `Transaction amount ${currency} ${amount.toLocaleString()} exceeds large transaction threshold of ${currency} ${threshold.toLocaleString()}`;
        }
        break;
      }
      case "RAPID_MOVEMENT": {
        // Multiple transactions within window
        const windowStart = new Date(now.getTime() - (rule.windowHours ?? 24) * 3600 * 1000);
        const [countResult] = await db
          .select({ cnt: count() })
          .from(velocityLedger)
          .where(
            and(
              eq(velocityLedger.userId, userId),
              eq(velocityLedger.currency, currency),
              gte(velocityLedger.recordedAt, windowStart)
            )
          );
        const txCount = Number(countResult?.cnt ?? 0);
        if (rule.thresholdCount && txCount >= rule.thresholdCount) {
          triggered = true;
          flagReason = `User made ${txCount} transactions within ${rule.windowHours}h window, exceeding rapid movement threshold of ${rule.thresholdCount}`;
        }
        break;
      }
      case "STRUCTURING": {
        // Multiple transactions just below a round threshold (structuring/smurfing)
        const threshold = parseFloat(rule.thresholdAmount ?? "0");
        const structuringMin = threshold * 0.85;
        const windowStart = new Date(now.getTime() - (rule.windowHours ?? 24) * 3600 * 1000);
        const [structResult] = await db
          .select({ cnt: count(), total: sum(velocityLedger.amount) })
          .from(velocityLedger)
          .where(
            and(
              eq(velocityLedger.userId, userId),
              eq(velocityLedger.currency, currency),
              gte(velocityLedger.recordedAt, windowStart),
              gte(velocityLedger.amount, String(structuringMin)),
              lte(velocityLedger.amount, String(threshold))
            )
          );
        const cnt = Number(structResult?.cnt ?? 0);
        if (cnt >= 3) {
          triggered = true;
          flagReason = `Possible structuring: ${cnt} transactions between ${currency} ${structuringMin.toLocaleString()} and ${currency} ${threshold.toLocaleString()} within ${rule.windowHours}h`;
        }
        break;
      }
      case "UNUSUAL_PATTERN": {
        // Amount significantly above user's rolling average
        const windowStart = new Date(now.getTime() - 30 * 24 * 3600 * 1000);
        const [avgResult] = await db
          .select({ avg: sql<string>`AVG(${velocityLedger.amount})` })
          .from(velocityLedger)
          .where(
            and(
              eq(velocityLedger.userId, userId),
              eq(velocityLedger.currency, currency),
              gte(velocityLedger.recordedAt, windowStart)
            )
          );
        const avg = parseFloat(avgResult?.avg ?? "0");
        if (avg > 0 && amount > avg * 5) {
          triggered = true;
          flagReason = `Transaction amount ${currency} ${amount.toLocaleString()} is ${(amount / avg).toFixed(1)}x the user's 30-day average of ${currency} ${avg.toLocaleString()}`;
        }
        break;
      }
    }

    if (triggered) {
      // Check if an identical flag already exists for this transaction ref
      const existing = await db
        .select({ id: amlFlags.id })
        .from(amlFlags)
        .where(
          and(
            eq(amlFlags.userId, userId),
            eq(amlFlags.transactionRef, transactionRef),
            eq(amlFlags.ruleId, rule.id)
          )
        )
        .limit(1);

      if (existing.length === 0) {
        await db.insert(amlFlags).values({
          userId,
          ruleId: rule.id,
          transactionRef,
          transactionType,
          amount: String(amount),
          currency,
          flagReason,
          severity: rule.severity,
          status: "PENDING",
        });

        // Notify owner for HIGH/CRITICAL
        if (rule.severity === "HIGH" || rule.severity === "CRITICAL") {
          await notifyOwner({
            title: `AML Alert: ${rule.severity} — ${rule.name}`,
            content: `User ID ${userId} triggered rule "${rule.name}". ${flagReason}. Transaction ref: ${transactionRef}`,
          });
        }
      }
    }
  }
}

// ─── Router ──────────────────────────────────────────────────────────────────

export const amlRouter = router({
  // ── Admin: Rule management ─────────────────────────────────────────────────
  adminListRules: adminProcedure.query(async () => {
    const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
    return db.select().from(amlRules).orderBy(desc(amlRules.createdAt));
  }),

  adminCreateRule: adminProcedure
    .input(
      z.object({
        name: z.string().min(3).max(128),
        ruleType: z.enum([
          "LARGE_TRANSACTION",
          "RAPID_MOVEMENT",
          "STRUCTURING",
          "UNUSUAL_PATTERN",
          "SANCTIONS_MATCH",
        ]),
        thresholdAmount: z.number().positive().optional(),
        thresholdCount: z.number().int().positive().optional(),
        windowHours: z.number().int().min(1).max(720).default(24),
        currency: z.string().max(8).default("NGN"),
        severity: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]).default("MEDIUM"),
        description: z.string().max(512).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const [rule] = await db
        .insert(amlRules)
        .values({
          name: input.name,
          ruleType: input.ruleType,
          thresholdAmount: input.thresholdAmount ? String(input.thresholdAmount) : null,
          thresholdCount: input.thresholdCount ?? null,
          windowHours: input.windowHours,
          currency: input.currency,
          severity: input.severity,
          description: input.description ?? null,
          createdBy: ctx.user.id,
        })
        .returning();
      return rule;
    }),

  adminUpdateRule: adminProcedure
    .input(
      z.object({
        id: z.number(),
        name: z.string().min(3).max(128).optional(),
        thresholdAmount: z.number().positive().optional(),
        thresholdCount: z.number().int().positive().optional(),
        windowHours: z.number().int().min(1).max(720).optional(),
        severity: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]).optional(),
        isActive: z.boolean().optional(),
        description: z.string().max(512).optional(),
      })
    )
    .mutation(async ({ input }) => {
      const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const updates: Record<string, unknown> = { updatedAt: new Date() };
      if (input.name !== undefined) updates.name = input.name;
      if (input.thresholdAmount !== undefined)
        updates.thresholdAmount = String(input.thresholdAmount);
      if (input.thresholdCount !== undefined) updates.thresholdCount = input.thresholdCount;
      if (input.windowHours !== undefined) updates.windowHours = input.windowHours;
      if (input.severity !== undefined) updates.severity = input.severity;
      if (input.isActive !== undefined) updates.isActive = input.isActive;
      if (input.description !== undefined) updates.description = input.description;

      const [updated] = await db
        .update(amlRules)
        .set(updates)
        .where(eq(amlRules.id, input.id))
        .returning();
      if (!updated) throw new TRPCError({ code: "NOT_FOUND", message: "Rule not found" });
      return updated;
    }),

  adminDeleteRule: adminProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      await db.delete(amlRules).where(eq(amlRules.id, input.id));
      return { success: true };
    }),

  // ── Admin: Flag management ─────────────────────────────────────────────────
  adminListFlags: adminProcedure
    .input(
      z.object({
        status: z.enum(["PENDING", "UNDER_REVIEW", "CLEARED", "ESCALATED", "SAR_FILED", "ALL"]).default("ALL"),
        severity: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL", "ALL"]).default("ALL"),
        limit: z.number().int().min(1).max(200).default(50),
        offset: z.number().int().min(0).default(0),
      })
    )
    .query(async ({ input }) => {
      const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const conditions = [];
      if (input.status !== "ALL") conditions.push(eq(amlFlags.status, input.status));
      if (input.severity !== "ALL") conditions.push(eq(amlFlags.severity, input.severity));

      const [flags, [{ total }]] = await Promise.all([
        db
          .select()
          .from(amlFlags)
          .where(conditions.length > 0 ? and(...conditions) : undefined)
          .orderBy(desc(amlFlags.createdAt))
          .limit(input.limit)
          .offset(input.offset),
        db.select({ total: count() }).from(amlFlags).where(conditions.length > 0 ? and(...conditions) : undefined),
      ]);

      return { flags, total: Number(total) };
    }),

  adminReviewFlag: adminProcedure
    .use(requireAmlEscalate)
    .input(
      z.object({
        flagId: z.number(),
        status: z.enum(["UNDER_REVIEW", "CLEARED", "ESCALATED", "SAR_FILED"]),
        reviewNotes: z.string().max(2000).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const [updated] = await db
        .update(amlFlags)
        .set({
          status: input.status,
          reviewedBy: ctx.user!.id,
          reviewedAt: new Date(),
          reviewNotes: input.reviewNotes ?? null,
          updatedAt: new Date(),
        })
        .where(eq(amlFlags.id, input.flagId))
        .returning();
      if (!updated) throw new TRPCError({ code: "NOT_FOUND", message: "Flag not found" });
      return updated;
    }),

  adminGetFlagStats: adminProcedure.query(async () => {
    const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
    const stats = await db
      .select({
        status: amlFlags.status,
        severity: amlFlags.severity,
        cnt: count(),
      })
      .from(amlFlags)
      .groupBy(amlFlags.status, amlFlags.severity);
    return stats;
  }),

  // ── SAR Filing ─────────────────────────────────────────────────────────────
  adminCreateSAR: adminProcedure
    .input(
      z.object({
        flagId: z.number().optional(),
        userId: z.number(),
        subjectName: z.string().max(256).optional(),
        subjectId: z.string().max(128).optional(),
        activityType: z.string().max(128),
        activityDescription: z.string().min(10).max(10000),
        totalAmount: z.number().positive().optional(),
        currency: z.string().max(8).default("NGN"),
        activityStartDate: z.date().optional(),
        activityEndDate: z.date().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const reportNumber = generateReportNumber();

      const [sar] = await db
        .insert(sarReports)
        .values({
          flagId: input.flagId ?? null,
          userId: input.userId,
          reportNumber,
          subjectName: input.subjectName ?? null,
          subjectId: input.subjectId ?? null,
          activityType: input.activityType,
          activityDescription: input.activityDescription,
          totalAmount: input.totalAmount ? String(input.totalAmount) : null,
          currency: input.currency,
          activityStartDate: input.activityStartDate ?? null,
          activityEndDate: input.activityEndDate ?? null,
          filedBy: ctx.user.id,
          status: "DRAFT",
        })
        .returning();

      // If linked to a flag, update its status
      if (input.flagId) {
        await db
          .update(amlFlags)
          .set({ status: "SAR_FILED", updatedAt: new Date() })
          .where(eq(amlFlags.id, input.flagId));
      }

      await notifyOwner({
        title: `SAR Filed: ${reportNumber}`,
        content: `A Suspicious Activity Report has been filed for user ID ${input.userId}. Activity: ${input.activityType}. Report: ${reportNumber}`,
      });

      return sar;
    }),

  adminListSARs: adminProcedure
    .input(
      z.object({
        status: z.enum(["DRAFT", "SUBMITTED", "ACKNOWLEDGED", "CLOSED", "ALL"]).default("ALL"),
        limit: z.number().int().min(1).max(100).default(50),
        offset: z.number().int().min(0).default(0),
      })
    )
    .query(async ({ input }) => {
      const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const condition = input.status !== "ALL" ? eq(sarReports.status, input.status) : undefined;
      const [sars, [{ total }]] = await Promise.all([
        db
          .select()
          .from(sarReports)
          .where(condition)
          .orderBy(desc(sarReports.filedAt))
          .limit(input.limit)
          .offset(input.offset),
        db.select({ total: count() }).from(sarReports).where(condition),
      ]);
      return { sars, total: Number(total) };
    }),

  adminUpdateSARStatus: adminProcedure
    .input(
      z.object({
        sarId: z.number(),
        status: z.enum(["SUBMITTED", "ACKNOWLEDGED", "CLOSED"]),
        regulatoryRef: z.string().max(128).optional(),
      })
    )
    .mutation(async ({ input }) => {
      const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const updates: Record<string, unknown> = {
        status: input.status,
        updatedAt: new Date(),
      };
      if (input.regulatoryRef) updates.regulatoryRef = input.regulatoryRef;
      if (input.status === "SUBMITTED") updates.exportedAt = new Date();

      const [updated] = await db
        .update(sarReports)
        .set(updates)
        .where(eq(sarReports.id, input.sarId))
        .returning();
      if (!updated) throw new TRPCError({ code: "NOT_FOUND", message: "SAR not found" });
      return updated;
    }),

  // ── Compliance Report Export ───────────────────────────────────────────────
  adminGenerateExport: adminProcedure
    .input(
      z.object({
        exportType: z.enum(["AML_FLAGS", "SAR_SUMMARY", "TRANSACTION_AUDIT"]),
        format: z.enum(["CSV", "PDF"]),
        dateFrom: z.date().optional(),
        dateTo: z.date().optional(),
        statusFilter: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      // Create export record (PENDING)
      const [exportRecord] = await db
        .insert(complianceExports)
        .values({
          exportType: input.exportType,
          format: input.format,
          dateFrom: input.dateFrom ?? null,
          dateTo: input.dateTo ?? null,
          filters: input.statusFilter ? JSON.stringify({ status: input.statusFilter }) : null,
          generatedBy: ctx.user.id,
          status: "PENDING",
        })
        .returning();

      // Generate CSV content
      let csvContent = "";
      let recordCount = 0;

      if (input.exportType === "AML_FLAGS") {
        const conditions = [];
        if (input.dateFrom) conditions.push(gte(amlFlags.createdAt, input.dateFrom));
        if (input.dateTo) conditions.push(lte(amlFlags.createdAt, input.dateTo));
        if (input.statusFilter && input.statusFilter !== "ALL")
          conditions.push(eq(amlFlags.status, input.statusFilter));

        const flags = await db
          .select()
          .from(amlFlags)
          .where(conditions.length > 0 ? and(...conditions) : undefined)
          .orderBy(desc(amlFlags.createdAt));

        recordCount = flags.length;
        csvContent = [
          "ID,User ID,Transaction Ref,Transaction Type,Amount,Currency,Severity,Status,Flag Reason,Created At",
          ...flags.map(
            (f) =>
              `${f.id},${f.userId},"${f.transactionRef ?? ""}","${f.transactionType}",${f.amount ?? ""},${f.currency},"${f.severity}","${f.status}","${(f.flagReason ?? "").replace(/"/g, '""')}","${f.createdAt.toISOString()}"`
          ),
        ].join("\n");
      } else if (input.exportType === "SAR_SUMMARY") {
        const conditions = [];
        if (input.dateFrom) conditions.push(gte(sarReports.filedAt, input.dateFrom));
        if (input.dateTo) conditions.push(lte(sarReports.filedAt, input.dateTo));

        const sars = await db
          .select()
          .from(sarReports)
          .where(conditions.length > 0 ? and(...conditions) : undefined)
          .orderBy(desc(sarReports.filedAt));

        recordCount = sars.length;
        csvContent = [
          "Report Number,User ID,Activity Type,Total Amount,Currency,Status,Filed At,Regulatory Ref",
          ...sars.map(
            (s) =>
              `"${s.reportNumber}",${s.userId},"${s.activityType}",${s.totalAmount ?? ""},${s.currency},"${s.status}","${s.filedAt.toISOString()}","${s.regulatoryRef ?? ""}"`
          ),
        ].join("\n");
      } else {
        // TRANSACTION_AUDIT
        const conditions = [];
        if (input.dateFrom) conditions.push(gte(velocityLedger.recordedAt, input.dateFrom));
        if (input.dateTo) conditions.push(lte(velocityLedger.recordedAt, input.dateTo));

        const ledger = await db
          .select()
          .from(velocityLedger)
          .where(conditions.length > 0 ? and(...conditions) : undefined)
          .orderBy(desc(velocityLedger.recordedAt))
          .limit(10000);

        recordCount = ledger.length;
        csvContent = [
          "ID,User ID,Amount,Currency,Reference,Recorded At",
          ...ledger.map(
            (l: typeof ledger[0]) =>
              `${l.id},${l.userId},${l.amount},${l.currency},"${l.reference ?? ''}","${l.recordedAt.toISOString()}"`
          ),
        ].join("\n");
      }

      // Upload to S3
      const fileKey = `compliance-exports/${exportRecord.id}-${input.exportType.toLowerCase()}-${Date.now()}.csv`;
      const { url: fileUrl } = await storagePut(fileKey, Buffer.from(csvContent, "utf-8"), "text/csv");

      // Update export record
      const [updated] = await db
        .update(complianceExports)
        .set({ status: "COMPLETE", fileUrl, fileKey, recordCount })
        .where(eq(complianceExports.id, exportRecord.id))
        .returning();

      return updated;
    }),

  adminListExports: adminProcedure.query(async () => {
    const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
    return db
      .select()
      .from(complianceExports)
      .orderBy(desc(complianceExports.generatedAt))
      .limit(100);
  }),

  // ── Admin: Aggregated live dashboard stats ─────────────────────────────────
  getDashboardStats: adminProcedure.query(async () => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
    const [flagRows, sarRows, ruleRows] = await Promise.all([
      db.select({ status: amlFlags.status, severity: amlFlags.severity, cnt: count() })
        .from(amlFlags)
        .groupBy(amlFlags.status, amlFlags.severity),
      db.select({ status: sarReports.status, cnt: count() })
        .from(sarReports)
        .groupBy(sarReports.status),
      db.select({ cnt: count() }).from(amlRules).where(eq(amlRules.isActive, true)),
    ]);
    const total = flagRows.reduce((s, r) => s + Number(r.cnt), 0);
    const open = flagRows.filter(r => r.status === "PENDING").reduce((s, r) => s + Number(r.cnt), 0);
    const reviewed = flagRows.filter(r => r.status === "UNDER_REVIEW").reduce((s, r) => s + Number(r.cnt), 0);
    const escalated = flagRows.filter(r => r.status === "ESCALATED").reduce((s, r) => s + Number(r.cnt), 0);
    const sarFiled = flagRows.filter(r => r.status === "SAR_FILED").reduce((s, r) => s + Number(r.cnt), 0);
    const cleared = flagRows.filter(r => r.status === "CLEARED").reduce((s, r) => s + Number(r.cnt), 0);
    const critical = flagRows.filter(r => r.severity === "CRITICAL").reduce((s, r) => s + Number(r.cnt), 0);
    const high = flagRows.filter(r => r.severity === "HIGH").reduce((s, r) => s + Number(r.cnt), 0);
    const sarTotal = sarRows.reduce((s, r) => s + Number(r.cnt), 0);
    const sarPending = sarRows.filter(r => r.status === "DRAFT" || r.status === "PENDING").reduce((s, r) => s + Number(r.cnt), 0);
    const activeRules = Number(ruleRows[0]?.cnt ?? 0);
    return { total, open, reviewed, escalated, sarFiled, cleared, critical, high, sarTotal, sarPending, activeRules };
  }),

  // ── Protected: User's own flags ────────────────────────────────────────────
  myFlags: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
    return db
      .select()
      .from(amlFlags)
      .where(eq(amlFlags.userId, ctx.user.id))
      .orderBy(desc(amlFlags.createdAt))
      .limit(50);
  }),
});
