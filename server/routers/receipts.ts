import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { warehouseReceipts, auditLog } from "../../drizzle/schema";
import { eq, and, desc } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { writeAuditLog } from "../audit";
import { ingestWarehouseReceipt, ingestReceiptPledge } from "../lakehouse";
import { FundFlow } from "../fundFlow";
import { publishFluvioEvent, FLUVIO_TOPICS } from "../fluvio/fluvioClient";
import { daprPublishReceiptPledge } from "../dapr/daprClient";
import { cacheDel, CacheKeys } from "../cache";
import { withSpan, recordEvent, setSpanAttrs } from "../telemetry/otel";

export const receiptsRouter = router({
  // LIST warehouse receipts for current user
  list: protectedProcedure
    .input(z.object({
      page: z.number().min(1).default(1),
      limit: z.number().min(1).max(100).default(20),
      status: z.enum(["ACTIVE", "PLEDGED", "REDEEMED", "CANCELLED"]).optional(),
    }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      setSpanAttrs({ "receipts.operation": "pledge" });
      if (!db) return { receipts: [], total: 0 };
      const offset = (input.page - 1) * input.limit;

      const items = await db.select().from(warehouseReceipts)
        .where(
          input.status
            ? and(eq(warehouseReceipts.userId, ctx.user.id), eq(warehouseReceipts.status, input.status))
            : eq(warehouseReceipts.userId, ctx.user.id)
        )
        .orderBy(desc(warehouseReceipts.createdAt))
        .limit(input.limit)
        .offset(offset);

      return { receipts: items, total: items.length };
    }),

  // LIST all receipts (admin)
  listAll: protectedProcedure
    .input(z.object({ page: z.number().min(1).default(1), limit: z.number().min(1).max(100).default(20) }))
    .query(async ({ ctx, input }) => {
      if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
      const db = await getDb();
      if (!db) return { receipts: [], total: 0 };
      const offset = (input.page - 1) * input.limit;
      const items = await db.select().from(warehouseReceipts)
        .orderBy(desc(warehouseReceipts.createdAt))
        .limit(input.limit).offset(offset);
      return { receipts: items, total: items.length };
    }),

  // GET single receipt
  get: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) return null;
      const result = await db.select().from(warehouseReceipts)
        .where(eq(warehouseReceipts.id, input.id)).limit(1);
      const receipt = result[0];
      if (!receipt) return null;
      if (receipt.userId !== ctx.user.id && ctx.user.role !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      return receipt;
    }),

  // CREATE warehouse receipt (admin or warehouse operator)
  create: protectedProcedure
    .input(z.object({
      commodity: z.string().max(64),
      grade: z.string().max(32).optional(),
      quantity: z.string().trim(),
      unit: z.string().max(16),
      warehouseId: z.string().max(64).optional(),
      warehouseName: z.string().max(256).optional(),
      expiryDate: z.date().optional(),
      valueUsd: z.string().optional(),
      notes: z.string().optional(),
      userId: z.number().optional(), // admin can create for another user
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
            if (!db) { const _id = Math.floor(Math.random() * 900_000) + 100_000; return { success: true, id: _id }; }

      const targetUserId = (ctx.user.role === "admin" && input.userId) ? input.userId : ctx.user.id;
      const { randomUUID } = await import('crypto');
      const receiptNumber = `EWR-${Date.now()}-${randomUUID().substring(0,7).toUpperCase()}`;

      const [receipt] = await db.insert(warehouseReceipts).values({
        userId: targetUserId,
        receiptNumber,
        commodity: input.commodity,
        grade: input.grade ?? null,
        quantity: input.quantity,
        unit: input.unit,
        warehouseId: input.warehouseId ?? null,
        warehouseName: input.warehouseName ?? null,
        expiryDate: input.expiryDate ?? null,
        valueUsd: input.valueUsd ?? null,
        notes: input.notes ?? null,
        status: "ACTIVE",
      }).returning();

      await db.insert(auditLog).values({
        userId: ctx.user.id,
        action: "RECEIPT_CREATE",
        resource: "warehouse_receipts",
        resourceId: String(receipt.id),
        details: { receiptNumber, commodity: input.commodity, quantity: input.quantity },
      });

      // Lakehouse: immutable Bronze-layer record of warehouse receipt issuance
      void ingestWarehouseReceipt({
        receiptId: String(receipt.id),
        userId: targetUserId,
        commodityId: input.commodity,
        quantity: input.quantity,
        unit: input.unit,
        warehouseId: input.warehouseId ?? "unknown",
        status: "issued",
        correlationId: receipt.receiptNumber,
      });
      // FundFlow: unified middleware orchestration for receipt issuance
      setImmediate(() => {
        FundFlow.receiptIssued({
          receiptId: String(receipt.id),
          userId: targetUserId,
          commodityId: input.commodity,
          quantity: input.quantity,
          unit: input.unit,
          warehouseId: input.warehouseId ?? "unknown",
        }).catch(() => {});
      });
      return receipt;
    }),

  // UPDATE receipt status (admin only)
  updateStatus: protectedProcedure
    .input(z.object({
      id: z.number(),
      status: z.enum(["ACTIVE", "PLEDGED", "REDEEMED", "CANCELLED"]),
      notes: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
      const db = await getDb();
            if (!db) return { success: true };

      await db.update(warehouseReceipts)
        .set({ status: input.status, notes: input.notes, updatedAt: new Date() })
        .where(eq(warehouseReceipts.id, input.id));

      await db.insert(auditLog).values({
        userId: ctx.user.id,
        action: "RECEIPT_STATUS_UPDATE",
        resource: "warehouse_receipts",
        resourceId: String(input.id),
        details: { newStatus: input.status },
      });

      return { success: true };
    }),

  // PLEDGE receipt (user action — marks as collateral)
  pledge: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
            if (!db) throw new TRPCError({ code: "NOT_FOUND", message: "Not found" });

      const result = await db.select().from(warehouseReceipts)
        .where(and(eq(warehouseReceipts.id, input.id), eq(warehouseReceipts.userId, ctx.user.id))).limit(1);
      if (!result[0]) throw new TRPCError({ code: "NOT_FOUND" });
      if (result[0].status !== "ACTIVE") throw new TRPCError({ code: "BAD_REQUEST", message: "Only ACTIVE receipts can be pledged" });

      const pledgeReceipt = result[0];
      await db.update(warehouseReceipts)
        .set({ status: "PLEDGED", updatedAt: new Date() })
        .where(eq(warehouseReceipts.id, input.id));
      // Middleware: Dapr + Fluvio + Lakehouse + Redis
      void (async () => {
        try {
          await daprPublishReceiptPledge({ receiptId: String(input.id), userId: ctx.user.id, commodityType: pledgeReceipt.commodity, quantityMt: pledgeReceipt.quantity, warehouseId: Number(pledgeReceipt.warehouseId ?? 0) });
          await publishFluvioEvent(FLUVIO_TOPICS.RECEIPT_PLEDGED, { receiptId: input.id, userId: ctx.user.id, commodityType: pledgeReceipt.commodity });
          void ingestReceiptPledge({ pledgeId: String(input.id), userId: ctx.user.id, receiptId: String(input.id), commodityType: pledgeReceipt.commodity, quantityMt: pledgeReceipt.quantity, warehouseId: Number(pledgeReceipt.warehouseId ?? 0), status: "pledged" });
          cacheDel(CacheKeys.portfolioSummary(ctx.user.id)).catch(() => {});
        } catch { /* non-blocking */ }
      })();
      return { success: true };
    }),

  // REDEEM receipt
  redeem: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
            if (!db) throw new TRPCError({ code: "NOT_FOUND", message: "Not found" });

      const result = await db.select().from(warehouseReceipts)
        .where(and(eq(warehouseReceipts.id, input.id), eq(warehouseReceipts.userId, ctx.user.id))).limit(1);
      if (!result[0]) throw new TRPCError({ code: "NOT_FOUND" });
      if (result[0].status === "REDEEMED") throw new TRPCError({ code: "BAD_REQUEST", message: "Receipt already redeemed" });

      await db.update(warehouseReceipts)
        .set({ status: "REDEEMED", updatedAt: new Date() })
        .where(eq(warehouseReceipts.id, input.id));

      // Lakehouse: immutable Bronze-layer record of receipt redemption
      void ingestWarehouseReceipt({
        receiptId: String(input.id),
        userId: ctx.user.id,
        commodityId: result[0].commodity,
        quantity: result[0].quantity,
        unit: result[0].unit,
        warehouseId: result[0].warehouseId ?? "unknown",
        status: "redeemed",
        correlationId: result[0].receiptNumber,
      });
      // FundFlow: unified middleware orchestration for receipt redemption
      setImmediate(() => {
        FundFlow.receiptRedeemed({
          receiptId: String(input.id),
          userId: ctx.user.id,
          commodityId: result[0].commodity,
          quantity: result[0].quantity,
          unit: result[0].unit,
          warehouseId: result[0].warehouseId ?? "unknown",
        }).catch(() => {});
      });
      return { success: true };
    }),


  adminDeleteReceipt: protectedProcedure
    .input(z.object({ receiptId: z.number().int(), reason: z.string() }))
    .mutation(async ({ ctx, input }) => {
      if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "Database unavailable" });
      const [receipt] = await db.update(warehouseReceipts)
        .set({ status: "CANCELLED", updatedAt: new Date() })
        .where(eq(warehouseReceipts.id, input.receiptId))
        .returning();
      if (!receipt) throw new TRPCError({ code: "NOT_FOUND", message: "Receipt not found" });
      // Lakehouse: immutable Bronze-layer record of receipt cancellation
      void ingestWarehouseReceipt({
        receiptId: String(receipt.id),
        userId: receipt.userId,
        commodityId: receipt.commodity,
        quantity: receipt.quantity,
        unit: receipt.unit,
        warehouseId: receipt.warehouseId ?? "unknown",
        status: "cancelled",
        correlationId: receipt.receiptNumber,
      });
      return { success: true };
    }),



});
