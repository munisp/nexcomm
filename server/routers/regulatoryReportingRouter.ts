import { TRPCError } from "@trpc/server";
import { z } from "zod/v4";
import { adminProcedure, protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import {
  regulatoryReports,
  regulatoryReportSchedules,
  orders,
  settlementCycles,
  settlementInstructions,
  settlementPositions,
} from "../../drizzle/schema";
import { eq, desc, gte, lte, and, isNull } from "drizzle-orm";
import { notifyOwner } from "../_core/notification";
import { writeAuditLog } from "../audit";

// ─── Report type definitions ────────────────────────────────────────────────

const REPORT_TYPES = [
  "POSITION_REPORT",
  "TRADE_CONFIRMATION",
  "EOD_SUMMARY",
  "CAMA_FILING",
  "SEC_FILING",
  "CBN_FILING",
] as const;

const ASSET_CLASSES = ["COMMODITY", "EQUITY", "FX", "BOND"] as const;
const FREQUENCIES = ["DAILY", "WEEKLY", "MONTHLY", "QUARTERLY"] as const;
const FORMATS = ["CSV", "JSON"] as const;

// ─── Report content generators ───────────────────────────────────────────────

async function generatePositionReport(
  periodStart: Date,
  periodEnd: Date,
  assetClass: string | null,
  format: "CSV" | "JSON"
): Promise<{ content: string; rowCount: number }> {
  const db = await getDb();
  if (!db) return { content: "", rowCount: 0 };

  const conditions = [
    gte(settlementPositions.createdAt, periodStart),
    lte(settlementPositions.createdAt, periodEnd),
  ];
  if (assetClass) {
    // Filter via cycle join — simplified: just return all positions in period
  }

  const positions = await db
    .select()
    .from(settlementPositions)
    .where(and(...conditions))
    .orderBy(desc(settlementPositions.createdAt))
    .limit(10000);

  if (format === "JSON") {
    return { content: JSON.stringify(positions, null, 2), rowCount: positions.length };
  }

  // CSV
  const header = "cycle_id,user_id,instrument,gross_buy_qty,gross_sell_qty,net_qty,gross_buy_value,gross_sell_value,net_cash_obligation,currency,status,created_at";
  const rows = positions.map((p) =>
    [
      p.cycleId,
      p.userId,
      p.instrument,
      p.grossBuyQty,
      p.grossSellQty,
      p.netQty,
      p.grossBuyValue,
      p.grossSellValue,
      p.netCashObligation,
      p.currency,
      p.status,
      p.createdAt.toISOString(),
    ].join(",")
  );
  return { content: [header, ...rows].join("\n"), rowCount: positions.length };
}

async function generateTradeConfirmation(
  periodStart: Date,
  periodEnd: Date,
  assetClass: string | null,
  format: "CSV" | "JSON"
): Promise<{ content: string; rowCount: number }> {
  const db = await getDb();
  if (!db) return { content: "", rowCount: 0 };

  const conditions = [
    gte(settlementInstructions.createdAt, periodStart),
    lte(settlementInstructions.createdAt, periodEnd),
    eq(settlementInstructions.status, "SETTLED"),
  ];

  const instructions = await db
    .select()
    .from(settlementInstructions)
    .where(and(...conditions))
    .orderBy(desc(settlementInstructions.createdAt))
    .limit(10000);

  if (format === "JSON") {
    return { content: JSON.stringify(instructions, null, 2), rowCount: instructions.length };
  }

  const header = "instruction_id,cycle_id,buyer_user_id,seller_user_id,instrument,quantity,price,total_value,currency,status,confirmed_at,settled_at";
  const rows = instructions.map((i) =>
    [
      i.id,
      i.cycleId,
      i.buyerUserId,
      i.sellerUserId,
      i.instrument,
      i.quantity,
      i.price,
      i.totalValue,
      i.currency,
      i.status,
      i.confirmedAt?.toISOString() ?? "",
      i.settledAt?.toISOString() ?? "",
    ].join(",")
  );
  return { content: [header, ...rows].join("\n"), rowCount: instructions.length };
}

async function generateEodSummary(
  periodStart: Date,
  periodEnd: Date,
  assetClass: string | null,
  format: "CSV" | "JSON"
): Promise<{ content: string; rowCount: number }> {
  const db = await getDb();
  if (!db) return { content: "", rowCount: 0 };

  const conditions: ReturnType<typeof eq>[] = [
    gte(orders.createdAt, periodStart) as unknown as ReturnType<typeof eq>,
    lte(orders.createdAt, periodEnd) as unknown as ReturnType<typeof eq>,
  ];
  if (assetClass && ["COMMODITY", "EQUITY", "FOREX", "DIGITAL_ASSET", "INDEX"].includes(assetClass)) {
    conditions.push(eq(orders.assetClass, assetClass as "COMMODITY" | "EQUITY" | "FOREX" | "DIGITAL_ASSET" | "INDEX"));
  }

  const orderRows = await db
    .select()
    .from(orders)
    .where(and(...conditions))
    .orderBy(desc(orders.createdAt))
    .limit(10000);

  // Compute summary stats per symbol
  const symbolStats: Record<string, {
    symbol: string; assetClass: string; totalOrders: number;
    filledOrders: number; totalVolume: number; totalValue: number;
    openOrders: number; cancelledOrders: number;
  }> = {};

  for (const o of orderRows) {
    if (!symbolStats[o.symbol]) {
      symbolStats[o.symbol] = {
        symbol: o.symbol,
        assetClass: o.assetClass,
        totalOrders: 0,
        filledOrders: 0,
        totalVolume: 0,
        totalValue: 0,
        openOrders: 0,
        cancelledOrders: 0,
      };
    }
    const s = symbolStats[o.symbol];
    s.totalOrders++;
    if (o.status === "FILLED") {
      s.filledOrders++;
      s.totalVolume += parseFloat(o.filledQty ?? "0");
      s.totalValue += parseFloat(o.filledQty ?? "0") * parseFloat(o.price ?? "0");
    }
    if (o.status === "OPEN" || o.status === "PARTIALLY_FILLED") s.openOrders++;
    if (o.status === "CANCELLED") s.cancelledOrders++;
  }

  const summaryRows = Object.values(symbolStats);

  if (format === "JSON") {
    return { content: JSON.stringify(summaryRows, null, 2), rowCount: summaryRows.length };
  }

  const header = "symbol,asset_class,total_orders,filled_orders,open_orders,cancelled_orders,total_volume,total_value";
  const rows = summaryRows.map((s) =>
    [
      s.symbol,
      s.assetClass,
      s.totalOrders,
      s.filledOrders,
      s.openOrders,
      s.cancelledOrders,
      s.totalVolume.toFixed(6),
      s.totalValue.toFixed(2),
    ].join(",")
  );
  return { content: [header, ...rows].join("\n"), rowCount: summaryRows.length };
}

async function generateRegulatoryFiling(
  reportType: "CAMA_FILING" | "SEC_FILING" | "CBN_FILING",
  periodStart: Date,
  periodEnd: Date,
  assetClass: string | null,
  format: "CSV" | "JSON"
): Promise<{ content: string; rowCount: number }> {
  const db = await getDb();
  if (!db) return { content: "", rowCount: 0 };

  // Regulatory filings aggregate settlement cycles in the period
  const conditions = [
    gte(settlementCycles.cycleDate, periodStart),
    lte(settlementCycles.cycleDate, periodEnd),
  ];
  if (assetClass) {
    conditions.push(eq(settlementCycles.assetClass, assetClass));
  }

  const cycles = await db
    .select()
    .from(settlementCycles)
    .where(and(...conditions))
    .orderBy(desc(settlementCycles.cycleDate));

  const filingData = cycles.map((c) => ({
    filing_type: reportType,
    cycle_id: c.id,
    cycle_date: c.cycleDate.toISOString(),
    settlement_type: c.settlementType,
    asset_class: c.assetClass,
    status: c.status,
    total_trades: c.totalTrades,
    matched_trades: c.matchedTrades,
    failed_trades: c.failedTrades,
    gross_value: c.grossValue,
    net_value: c.netValue,
    currency: c.currency,
    period_start: periodStart.toISOString(),
    period_end: periodEnd.toISOString(),
    generated_at: new Date().toISOString(),
  }));

  if (format === "JSON") {
    return { content: JSON.stringify(filingData, null, 2), rowCount: filingData.length };
  }

  const header = "filing_type,cycle_id,cycle_date,settlement_type,asset_class,status,total_trades,matched_trades,failed_trades,gross_value,net_value,currency,period_start,period_end,generated_at";
  const rows = filingData.map((f) =>
    [
      f.filing_type,
      f.cycle_id,
      f.cycle_date,
      f.settlement_type,
      f.asset_class,
      f.status,
      f.total_trades,
      f.matched_trades,
      f.failed_trades,
      f.gross_value,
      f.net_value,
      f.currency,
      f.period_start,
      f.period_end,
      f.generated_at,
    ].join(",")
  );
  return { content: [header, ...rows].join("\n"), rowCount: filingData.length };
}

// ─── Main report generator dispatcher ────────────────────────────────────────

export async function generateReportContent(
  reportType: string,
  periodStart: Date,
  periodEnd: Date,
  assetClass: string | null,
  format: "CSV" | "JSON"
): Promise<{ content: string; rowCount: number }> {
  switch (reportType) {
    case "POSITION_REPORT":
      return generatePositionReport(periodStart, periodEnd, assetClass, format);
    case "TRADE_CONFIRMATION":
      return generateTradeConfirmation(periodStart, periodEnd, assetClass, format);
    case "EOD_SUMMARY":
      return generateEodSummary(periodStart, periodEnd, assetClass, format);
    case "CAMA_FILING":
    case "SEC_FILING":
    case "CBN_FILING":
      return generateRegulatoryFiling(
        reportType as "CAMA_FILING" | "SEC_FILING" | "CBN_FILING",
        periodStart,
        periodEnd,
        assetClass,
        format
      );
    default:
      return { content: "", rowCount: 0 };
  }
}

// ─── Compute next run time for a schedule ────────────────────────────────────

export function computeNextRunAt(
  frequency: string,
  dayOfWeek: number | null,
  dayOfMonth: number | null,
  timeUtc: string,
  from: Date = new Date()
): Date {
  const [hh, mm] = timeUtc.split(":").map(Number);
  const next = new Date(from);
  next.setUTCHours(hh, mm, 0, 0);

  if (frequency === "DAILY") {
    if (next <= from) next.setUTCDate(next.getUTCDate() + 1);
    return next;
  }

  if (frequency === "WEEKLY") {
    const targetDay = dayOfWeek ?? 1; // default Monday
    const daysUntil = (targetDay - next.getUTCDay() + 7) % 7 || 7;
    next.setUTCDate(next.getUTCDate() + daysUntil);
    return next;
  }

  if (frequency === "MONTHLY") {
    const targetDay = dayOfMonth ?? 1;
    next.setUTCDate(targetDay);
    if (next <= from) {
      next.setUTCMonth(next.getUTCMonth() + 1);
      next.setUTCDate(targetDay);
    }
    return next;
  }

  if (frequency === "QUARTERLY") {
    const targetDay = dayOfMonth ?? 1;
    next.setUTCDate(targetDay);
    if (next <= from) {
      next.setUTCMonth(next.getUTCMonth() + 3);
      next.setUTCDate(targetDay);
    }
    return next;
  }

  return next;
}

// ─── In-memory fallback stores ──────────────────────────────────────────────
type MemReport = {
  id: number; reportType: string; reportDate: Date; periodStart: Date; periodEnd: Date;
  assetClass: string | null; format: string; status: string; content: string | null;
  rowCount: number | null; fileSize: number | null; generatedBy: number | null;
  scheduleId: number | null; errorMessage: string | null; createdAt: Date; updatedAt: Date;
};
type MemSchedule = {
  id: number; reportType: string; assetClass: string | null; format: string;
  frequency: string; dayOfWeek: number | null; dayOfMonth: number | null;
  timeUtc: string; isActive: boolean; nextRunAt: Date | null; lastRunAt: Date | null;
  createdBy: number | null; createdAt: Date; updatedAt: Date;
};
const _memReports = new Map<number, MemReport>();
const _memSchedules = new Map<number, MemSchedule>();
let _repSeq = 1;
let _schSeq = 1;
// ─────────────────────────────────────────────────────────────────────────────

export const regulatoryReportingRouter = router({
  // ── Admin: generate a report ──────────────────────────────────────────────
  adminGenerateReport: adminProcedure
    .input(
      z.object({
        reportType: z.enum(REPORT_TYPES),
        periodStart: z.coerce.date(),
        periodEnd: z.coerce.date(),
        assetClass: z.enum(ASSET_CLASSES).optional(),
        format: z.enum(FORMATS).default("CSV"),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();

      if (!db) {
        const { content, rowCount } = await generateReportContent(
          input.reportType, input.periodStart, input.periodEnd,
          input.assetClass ?? null, input.format
        );
        const id = _repSeq++;
        const now = new Date();
        const report: MemReport = {
          id, reportType: input.reportType, reportDate: now,
          periodStart: input.periodStart, periodEnd: input.periodEnd,
          assetClass: input.assetClass ?? null, format: input.format,
          status: "READY", content, rowCount, fileSize: Buffer.byteLength(content, "utf8"),
          generatedBy: ctx.user.id, scheduleId: null, errorMessage: null,
          createdAt: now, updatedAt: now,
        };
        _memReports.set(id, report);
        return report;
      }

      // Create report record in PENDING state
      const [report] = await db
        .insert(regulatoryReports)
        .values({
          reportType: input.reportType,
          reportDate: new Date(),
          periodStart: input.periodStart,
          periodEnd: input.periodEnd,
          assetClass: input.assetClass ?? null,
          format: input.format,
          status: "GENERATING",
          generatedBy: ctx.user.id,
        })
        .returning();

      try {
        const { content, rowCount } = await generateReportContent(
          input.reportType,
          input.periodStart,
          input.periodEnd,
          input.assetClass ?? null,
          input.format
        );

        const [updated] = await db
          .update(regulatoryReports)
          .set({
            status: "READY",
            content,
            rowCount,
            fileSize: Buffer.byteLength(content, "utf8"),
            updatedAt: new Date(),
          })
          .where(eq(regulatoryReports.id, report.id))
          .returning();

        return updated;
      } catch (err) {
        await db
          .update(regulatoryReports)
          .set({
            status: "FAILED",
            errorMessage: err instanceof Error ? err.message : "Unknown error",
            updatedAt: new Date(),
          })
          .where(eq(regulatoryReports.id, report.id));
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Report generation failed" });
      }
    }),

  // ── Admin: list reports ───────────────────────────────────────────────────
  adminListReports: adminProcedure
    .input(
      z.object({
        reportType: z.enum(REPORT_TYPES).optional(),
        limit: z.number().int().min(1).max(200).default(50),
        offset: z.number().int().min(0).default(0),
      })
    )
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) {
        let results = Array.from(_memReports.values());
        if (input.reportType) results = results.filter(r => r.reportType === input.reportType);
        results.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
        return results.slice(input.offset, input.offset + input.limit);
      }

      const conditions = [];
      if (input.reportType) conditions.push(eq(regulatoryReports.reportType, input.reportType));

      return db
        .select({
          id: regulatoryReports.id,
          reportType: regulatoryReports.reportType,
          reportDate: regulatoryReports.reportDate,
          periodStart: regulatoryReports.periodStart,
          periodEnd: regulatoryReports.periodEnd,
          assetClass: regulatoryReports.assetClass,
          format: regulatoryReports.format,
          status: regulatoryReports.status,
          rowCount: regulatoryReports.rowCount,
          fileSize: regulatoryReports.fileSize,
          generatedBy: regulatoryReports.generatedBy,
          scheduleId: regulatoryReports.scheduleId,
          createdAt: regulatoryReports.createdAt,
        })
        .from(regulatoryReports)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(desc(regulatoryReports.createdAt))
        .limit(input.limit)
        .offset(input.offset);
    }),

  // ── Admin: download report content ───────────────────────────────────────
  adminDownloadReport: adminProcedure
    .input(z.object({ reportId: z.number().int() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) {
        const report = _memReports.get(input.reportId);
        if (!report) throw new TRPCError({ code: "NOT_FOUND", message: "Report not found" });
        if (report.status !== "READY") throw new TRPCError({ code: "BAD_REQUEST", message: "Report is not ready" });
        return { id: report.id, reportType: report.reportType, format: report.format,
          content: report.content ?? "", rowCount: report.rowCount, fileSize: report.fileSize,
          periodStart: report.periodStart, periodEnd: report.periodEnd };
      }

      const [report] = await db
        .select()
        .from(regulatoryReports)
        .where(eq(regulatoryReports.id, input.reportId))
        .limit(1);

      if (!report) throw new TRPCError({ code: "NOT_FOUND", message: "Report not found" });
      if (report.status !== "READY") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Report is not ready" });
      }

      return {
        id: report.id,
        reportType: report.reportType,
        format: report.format,
        content: report.content ?? "",
        rowCount: report.rowCount,
        fileSize: report.fileSize,
        periodStart: report.periodStart,
        periodEnd: report.periodEnd,
      };
    }),

  // ── Admin: delete a report ────────────────────────────────────────────────
  adminDeleteReport: adminProcedure
    .input(z.object({ reportId: z.number().int() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) { _memReports.delete(input.reportId); return { success: true }; }

      await db
        .delete(regulatoryReports)
        .where(eq(regulatoryReports.id, input.reportId));

      return { success: true };
    }),

  // ── Admin: get report stats ───────────────────────────────────────────────
  adminGetReportStats: adminProcedure.query(async () => {
    const db = await getDb();
    if (!db) {
      const all = Array.from(_memReports.values());
      return { total: all.length, ready: all.filter(r => r.status === "READY").length,
        failed: all.filter(r => r.status === "FAILED").length,
        generating: all.filter(r => r.status === "GENERATING").length };
    }

    const all = await db.select({ status: regulatoryReports.status }).from(regulatoryReports);
    return {
      total: all.length,
      ready: all.filter((r) => r.status === "READY").length,
      failed: all.filter((r) => r.status === "FAILED").length,
      generating: all.filter((r) => r.status === "GENERATING").length,
    };
  }),

  // ── Admin: create a schedule ──────────────────────────────────────────────
  adminCreateSchedule: adminProcedure
    .input(
      z.object({
        reportType: z.enum(REPORT_TYPES),
        assetClass: z.enum(ASSET_CLASSES).optional(),
        format: z.enum(FORMATS).default("CSV"),
        frequency: z.enum(FREQUENCIES),
        dayOfWeek: z.number().int().min(0).max(6).optional(),
        dayOfMonth: z.number().int().min(1).max(31).optional(),
        timeUtc: z.string().regex(/^\d{2}:\d{2}$/).default("15:00"),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();

      if (!db) {
        const id = _schSeq++;
        const now = new Date();
        const nextRunAt = computeNextRunAt(input.frequency, input.dayOfWeek ?? null, input.dayOfMonth ?? null, input.timeUtc);
        const schedule: MemSchedule = {
          id, reportType: input.reportType, assetClass: input.assetClass ?? null,
          format: input.format, frequency: input.frequency,
          dayOfWeek: input.dayOfWeek ?? null, dayOfMonth: input.dayOfMonth ?? null,
          timeUtc: input.timeUtc, isActive: true, nextRunAt, lastRunAt: null,
          createdBy: ctx.user.id, createdAt: now, updatedAt: now,
        };
        _memSchedules.set(id, schedule);
        return schedule;
      }

      const nextRunAt = computeNextRunAt(
        input.frequency,
        input.dayOfWeek ?? null,
        input.dayOfMonth ?? null,
        input.timeUtc
      );

      const [schedule] = await db
        .insert(regulatoryReportSchedules)
        .values({
          reportType: input.reportType,
          assetClass: input.assetClass ?? null,
          format: input.format,
          frequency: input.frequency,
          dayOfWeek: input.dayOfWeek ?? null,
          dayOfMonth: input.dayOfMonth ?? null,
          timeUtc: input.timeUtc,
          isActive: true,
          nextRunAt,
          createdBy: ctx.user.id,
        })
        .returning();

      return schedule;
    }),

  // ── Admin: list schedules ─────────────────────────────────────────────────
  adminListSchedules: adminProcedure.query(async () => {
    const db = await getDb();
    if (!db) {
      return Array.from(_memSchedules.values()).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    }

    return db
      .select()
      .from(regulatoryReportSchedules)
      .orderBy(desc(regulatoryReportSchedules.createdAt));
  }),

  // ── Admin: deactivate a schedule ─────────────────────────────────────────
  adminDeactivateSchedule: adminProcedure
    .input(z.object({ scheduleId: z.number().int() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) {
        const s = _memSchedules.get(input.scheduleId);
        if (!s) throw new TRPCError({ code: "NOT_FOUND" });
        s.isActive = false;
        return s;
      }

      const [updated] = await db
        .update(regulatoryReportSchedules)
        .set({ isActive: false, updatedAt: new Date() })
        .where(eq(regulatoryReportSchedules.id, input.scheduleId))
        .returning();

      if (!updated) throw new TRPCError({ code: "NOT_FOUND" });
      return updated;
    }),

  // ── Admin: run a schedule manually ───────────────────────────────────────
  adminRunSchedule: adminProcedure
    .input(z.object({ scheduleId: z.number().int() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();

      if (!db) {
        const schedule = _memSchedules.get(input.scheduleId);
        if (!schedule) throw new TRPCError({ code: "NOT_FOUND" });
        const now = new Date();
        const periodStart = new Date(now.getTime() - 24 * 60 * 60 * 1000);
        const { content, rowCount } = await generateReportContent(
          schedule.reportType, periodStart, now, schedule.assetClass ?? null, schedule.format as "CSV" | "JSON"
        );
        const id = _repSeq++;
        const report: MemReport = {
          id, reportType: schedule.reportType, reportDate: now, periodStart, periodEnd: now,
          assetClass: schedule.assetClass ?? null, format: schedule.format, status: "READY",
          content, rowCount, fileSize: Buffer.byteLength(content, "utf8"),
          generatedBy: ctx.user.id, scheduleId: schedule.id, errorMessage: null,
          createdAt: now, updatedAt: now,
        };
        _memReports.set(id, report);
        schedule.lastRunAt = now;
        schedule.nextRunAt = computeNextRunAt(schedule.frequency, schedule.dayOfWeek ?? null, schedule.dayOfMonth ?? null, schedule.timeUtc, now);
        return report;
      }

      const [schedule] = await db
        .select()
        .from(regulatoryReportSchedules)
        .where(eq(regulatoryReportSchedules.id, input.scheduleId))
        .limit(1);

      if (!schedule) throw new TRPCError({ code: "NOT_FOUND" });

      // Determine period: last 24h for DAILY, last 7d for WEEKLY, etc.
      const now = new Date();
      let periodStart: Date;
      switch (schedule.frequency) {
        case "WEEKLY":
          periodStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
          break;
        case "MONTHLY":
          periodStart = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
          break;
        case "QUARTERLY":
          periodStart = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
          break;
        default: // DAILY
          periodStart = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      }

      const { content, rowCount } = await generateReportContent(
        schedule.reportType,
        periodStart,
        now,
        schedule.assetClass ?? null,
        schedule.format as "CSV" | "JSON"
      );

      const [report] = await db
        .insert(regulatoryReports)
        .values({
          reportType: schedule.reportType,
          reportDate: now,
          periodStart,
          periodEnd: now,
          assetClass: schedule.assetClass ?? null,
          format: schedule.format,
          status: "READY",
          content,
          rowCount,
          fileSize: Buffer.byteLength(content, "utf8"),
          generatedBy: ctx.user.id,
          scheduleId: schedule.id,
        })
        .returning();

      // Update schedule last/next run
      const nextRunAt = computeNextRunAt(
        schedule.frequency,
        schedule.dayOfWeek ?? null,
        schedule.dayOfMonth ?? null,
        schedule.timeUtc,
        now
      );
      await db
        .update(regulatoryReportSchedules)
        .set({ lastRunAt: now, nextRunAt, updatedAt: now })
        .where(eq(regulatoryReportSchedules.id, schedule.id));

      await notifyOwner({
        title: `Regulatory Report Generated: ${schedule.reportType}`,
        content: `Scheduled ${schedule.frequency} ${schedule.reportType} report generated. ${rowCount} rows, format: ${schedule.format}.`,
      });

      return report;
    }),

  // ── User: list their own reports (for brokers/participants) ───────────────
  myReports: protectedProcedure
    .input(
      z.object({
        limit: z.number().int().min(1).max(100).default(20),
        offset: z.number().int().min(0).default(0),
      })
    )
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) {
        return Array.from(_memReports.values())
          .filter(r => r.generatedBy === ctx.user.id)
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
          .slice(input.offset, input.offset + input.limit);
      }

      return db
        .select({
          id: regulatoryReports.id,
          reportType: regulatoryReports.reportType,
          reportDate: regulatoryReports.reportDate,
          periodStart: regulatoryReports.periodStart,
          periodEnd: regulatoryReports.periodEnd,
          format: regulatoryReports.format,
          status: regulatoryReports.status,
          rowCount: regulatoryReports.rowCount,
          createdAt: regulatoryReports.createdAt,
        })
        .from(regulatoryReports)
        .where(eq(regulatoryReports.generatedBy, ctx.user.id))
        .orderBy(desc(regulatoryReports.createdAt))
        .limit(input.limit)
        .offset(input.offset);
    }),
});
