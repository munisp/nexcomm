import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { deliveryOrders, warehouseReceipts, auditLog } from "../../drizzle/schema";
import { eq, and, desc } from "drizzle-orm";
import { TRPCError } from "@trpc/server";

export const deliveryRouter = router({
  // LIST delivery orders for current user
  list: protectedProcedure
    .input(z.object({
      page: z.number().min(1).default(1),
      limit: z.number().min(1).max(100).default(20),
      status: z.enum(["PENDING", "SCHEDULED", "IN_TRANSIT", "DELIVERED", "CANCELLED"]).optional(),
    }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) return { deliveries: [], total: 0 };
      const offset = (input.page - 1) * input.limit;

      const items = await db.select().from(deliveryOrders)
        .where(
          input.status
            ? and(eq(deliveryOrders.userId, ctx.user.id), eq(deliveryOrders.status, input.status))
            : eq(deliveryOrders.userId, ctx.user.id)
        )
        .orderBy(desc(deliveryOrders.createdAt))
        .limit(input.limit).offset(offset);

      return { deliveries: items, total: items.length };
    }),

  // LIST all deliveries (admin)
  listAll: protectedProcedure
    .input(z.object({ page: z.number().min(1).default(1), limit: z.number().min(1).max(100).default(20) }))
    .query(async ({ ctx, input }) => {
      if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
      const db = await getDb();
      if (!db) return { deliveries: [], total: 0 };
      const offset = (input.page - 1) * input.limit;
      const items = await db.select().from(deliveryOrders)
        .orderBy(desc(deliveryOrders.createdAt))
        .limit(input.limit).offset(offset);
      return { deliveries: items, total: items.length };
    }),

  // GET single delivery order
  get: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) return null;
      const result = await db.select().from(deliveryOrders)
        .where(eq(deliveryOrders.id, input.id)).limit(1);
      const del = result[0];
      if (!del) return null;
      if (del.userId !== ctx.user.id && ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
      return del;
    }),

  // CREATE delivery order
  create: protectedProcedure
    .input(z.object({
      receiptId: z.number().optional(),
      commodity: z.string().max(64),
      quantity: z.string(),
      unit: z.string().max(16),
      deliveryAddress: z.string(),
      scheduledDate: z.date().optional(),
      notes: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });

      // If receiptId provided, verify ownership
      if (input.receiptId) {
        const receipt = await db.select().from(warehouseReceipts)
          .where(and(eq(warehouseReceipts.id, input.receiptId), eq(warehouseReceipts.userId, ctx.user.id))).limit(1);
        if (!receipt[0]) throw new TRPCError({ code: "NOT_FOUND", message: "Warehouse receipt not found" });
      }

      const [delivery] = await db.insert(deliveryOrders).values({
        userId: ctx.user.id,
        receiptId: input.receiptId ?? null,
        commodity: input.commodity,
        quantity: input.quantity,
        unit: input.unit,
        deliveryAddress: input.deliveryAddress,
        scheduledDate: input.scheduledDate ?? null,
        notes: input.notes ?? null,
        status: "PENDING",
      }).returning();

      await db.insert(auditLog).values({
        userId: ctx.user.id,
        action: "DELIVERY_CREATE",
        resource: "delivery_orders",
        resourceId: String(delivery.id),
        details: { commodity: input.commodity, quantity: input.quantity, deliveryAddress: input.deliveryAddress },
      });

      return delivery;
    }),

  // UPDATE delivery status (admin / logistics)
  updateStatus: protectedProcedure
    .input(z.object({
      id: z.number(),
      status: z.enum(["PENDING", "SCHEDULED", "IN_TRANSIT", "DELIVERED", "CANCELLED"]),
      notes: z.string().optional(),
      scheduledDate: z.date().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });

      const updateData: Record<string, unknown> = { status: input.status, updatedAt: new Date() };
      if (input.notes) updateData.notes = input.notes;
      if (input.scheduledDate) updateData.scheduledDate = input.scheduledDate;

      await db.update(deliveryOrders).set(updateData).where(eq(deliveryOrders.id, input.id));

      await db.insert(auditLog).values({
        userId: ctx.user.id,
        action: "DELIVERY_STATUS_UPDATE",
        resource: "delivery_orders",
        resourceId: String(input.id),
        details: { newStatus: input.status },
      });

      return { success: true };
    }),

  // CANCEL delivery (user can cancel PENDING)
  cancel: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });

      const result = await db.select().from(deliveryOrders)
        .where(and(eq(deliveryOrders.id, input.id), eq(deliveryOrders.userId, ctx.user.id))).limit(1);
      if (!result[0]) throw new TRPCError({ code: "NOT_FOUND" });
      if (result[0].status !== "PENDING") throw new TRPCError({ code: "BAD_REQUEST", message: "Only PENDING deliveries can be cancelled" });

      await db.update(deliveryOrders)
        .set({ status: "CANCELLED", notes: "Cancelled by user", updatedAt: new Date() })
        .where(eq(deliveryOrders.id, input.id));

      return { success: true };
    }),
});
