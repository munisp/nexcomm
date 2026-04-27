import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { profiles, users, auditLog, orders, kycQueue, notifications } from "../../drizzle/schema";
import { eq, desc } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { writeAuditLog } from "../audit";

export const profileRouter = router({
  // GET current user's profile
  get: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) return null;
    const result = await db.select().from(profiles).where(eq(profiles.userId, ctx.user.id)).limit(1);
    return result[0] ?? null;
  }),

  // GET profile by userId (admin only)
  getById: protectedProcedure
    .input(z.object({ userId: z.number() }))
    .query(async ({ ctx, input }) => {
      if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
      const db = await getDb();
      if (!db) return null;
      const result = await db.select().from(profiles).where(eq(profiles.userId, input.userId)).limit(1);
      return result[0] ?? null;
    }),

  // UPDATE current user's profile
  update: protectedProcedure
    .input(z.object({
      firstName: z.string().max(64).optional(),
      lastName: z.string().max(64).optional(),
      phone: z.string().max(20).optional(),
      nin: z.string().max(20).optional(),
      bvn: z.string().max(20).optional(),
      address: z.string().optional(),
      state: z.string().max(64).optional(),
      country: z.string().max(64).optional(),
      companyName: z.string().max(256).optional(),
      rcNumber: z.string().max(64).optional(),
      taxId: z.string().max(64).optional(),
      bankName: z.string().max(128).optional(),
      bankAccount: z.string().max(20).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });

      const existing = await db.select().from(profiles).where(eq(profiles.userId, ctx.user.id)).limit(1);
      const updateData = { ...input, updatedAt: new Date() };

      if (existing.length > 0) {
        await db.update(profiles).set(updateData).where(eq(profiles.userId, ctx.user.id));
      } else {
        await db.insert(profiles).values({ userId: ctx.user.id, ...input });
      }

      // Audit log
      await db.insert(auditLog).values({
        userId: ctx.user.id,
        action: "PROFILE_UPDATE",
        resource: "profiles",
        resourceId: String(ctx.user.id),
        details: { fields: Object.keys(input) },
      });

      const result = await db.select().from(profiles).where(eq(profiles.userId, ctx.user.id)).limit(1);
      return result[0];
    }),

  // UPDATE notification preferences (stored in user metadata)
  updateNotificationPrefs: protectedProcedure
    .input(z.object({
      emailTrades: z.boolean().optional(),
      emailAlerts: z.boolean().optional(),
      emailKyc: z.boolean().optional(),
      emailMarketing: z.boolean().optional(),
      pushTrades: z.boolean().optional(),
      pushAlerts: z.boolean().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });

      const existing = await db.select().from(profiles).where(eq(profiles.userId, ctx.user.id)).limit(1);
      const currentMeta = (existing[0]?.metadata as Record<string, unknown>) ?? {};
      const newMeta = { ...currentMeta, notificationPrefs: { ...(currentMeta.notificationPrefs as object ?? {}), ...input } };

      if (existing.length > 0) {
        await db.update(profiles).set({ metadata: newMeta, updatedAt: new Date() }).where(eq(profiles.userId, ctx.user.id));
      } else {
        await db.insert(profiles).values({ userId: ctx.user.id, metadata: newMeta });
      }
      return { success: true };
    }),

  // GET all users (admin only) with pagination
  listUsers: protectedProcedure
    .input(z.object({ page: z.number().min(1).default(1), limit: z.number().min(1).max(100).default(20) }))
    .query(async ({ ctx, input }) => {
      if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
      const db = await getDb();
      if (!db) return { users: [], total: 0 };
      const offset = (input.page - 1) * input.limit;
      const result = await db.select({
        id: users.id,
        name: users.name,
        email: users.email,
        role: users.role,
        createdAt: users.createdAt,
        lastSignedIn: users.lastSignedIn,
      }).from(users).limit(input.limit).offset(offset);
      const countResult = await db.select({ count: users.id }).from(users);
      return { users: result, total: countResult.length };
    }),

  // UPDATE user role (admin only)
  updateRole: protectedProcedure
    .input(z.object({ userId: z.number(), role: z.enum(["user", "admin", "farmer", "trader", "broker"]) }))
    .mutation(async ({ ctx, input }) => {
      if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
      await db.update(users).set({ role: input.role, updatedAt: new Date() }).where(eq(users.id, input.userId));
      await db.insert(auditLog).values({
        userId: ctx.user.id,
        action: "ROLE_UPDATE",
        resource: "users",
        resourceId: String(input.userId),
        details: { newRole: input.role },
      });
      return { success: true };
    }),

  // GET full user detail by ID (admin only)
  // Returns user record, profile, recent orders, KYC history, and recent notifications
  getUserDetail: protectedProcedure
    .input(z.object({ userId: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });

      const [userRow] = await db.select().from(users).where(eq(users.id, input.userId)).limit(1);
      if (!userRow) throw new TRPCError({ code: "NOT_FOUND", message: "User not found" });

      const [profileRow] = await db.select().from(profiles).where(eq(profiles.userId, input.userId)).limit(1);

      const recentOrders = await db
        .select()
        .from(orders)
        .where(eq(orders.userId, input.userId))
        .orderBy(desc(orders.createdAt))
        .limit(20);

      const kycHistory = await db
        .select()
        .from(kycQueue)
        .where(eq(kycQueue.userId, input.userId))
        .orderBy(desc(kycQueue.submittedAt))
        .limit(10);

      const recentNotifications = await db
        .select()
        .from(notifications)
        .where(eq(notifications.userId, input.userId))
        .orderBy(desc(notifications.createdAt))
        .limit(10);

      return {
        user: userRow,
        profile: profileRow ?? null,
        recentOrders,
        kycHistory,
        recentNotifications,
      };
    }),

  // SUSPEND user (sets role to 'user', logs reason)
  suspendUser: protectedProcedure
    .input(z.object({
      userId: z.number().int().positive(),
      reason: z.string().max(500).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
      if (input.userId === ctx.user.id) throw new TRPCError({ code: "BAD_REQUEST", message: "Cannot suspend yourself" });
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
      await db.update(users).set({ role: "user", updatedAt: new Date() }).where(eq(users.id, input.userId));
      await db.insert(auditLog).values({
        userId: ctx.user.id,
        action: "USER_SUSPENDED",
        resource: "users",
        resourceId: String(input.userId),
        details: { reason: input.reason ?? "Admin action" },
      });
      return { success: true };
    }),

  // PROMOTE user to admin
  promoteToAdmin: protectedProcedure
    .input(z.object({ userId: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
      await db.update(users).set({ role: "admin", updatedAt: new Date() }).where(eq(users.id, input.userId));
      await db.insert(auditLog).values({
        userId: ctx.user.id,
        action: "ROLE_UPDATE",
        resource: "users",
        resourceId: String(input.userId),
        details: { newRole: "admin", promotedBy: ctx.user.id },
      });
      return { success: true };
    }),
});
