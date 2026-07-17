import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { profiles, users, auditLog, orders, kycQueue, notifications, positions, tradeFills, priceAlerts, watchlist } from "../../drizzle/schema";
import { eq, desc, and, gte, lte, count, sum, sql } from "drizzle-orm";
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
            if (!db) return { success: true };

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
            if (!db) return { success: true };

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
            if (!db) return { success: true };
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
            if (!db) return { success: true };
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

  // GET full dashboard summary for current user
  dashboard: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) return null;

    const [profile, user, orderStats, recentOrders, openPositions, recentFills, alertCount, watchlistCount] =
      await Promise.all([
        db.select().from(profiles).where(eq(profiles.userId, ctx.user.id)).limit(1),
        db.select().from(users).where(eq(users.id, ctx.user.id)).limit(1),
        // Order stats: total, open, filled, cancelled
        db
          .select({
            status: orders.status,
            cnt: count(),
          })
          .from(orders)
          .where(eq(orders.userId, ctx.user.id))
          .groupBy(orders.status),
        // Recent 5 orders
        db
          .select()
          .from(orders)
          .where(eq(orders.userId, ctx.user.id))
          .orderBy(desc(orders.createdAt))
          .limit(5),
        // Open positions
        db
          .select()
          .from(positions)
          .where(eq(positions.userId, ctx.user.id))
          .orderBy(desc(positions.updatedAt))
          .limit(10),
        // Recent fills (as buyer or seller)
        db
          .select()
          .from(tradeFills)
          .where(
            sql`${tradeFills.buyerUserId} = ${ctx.user.id} OR ${tradeFills.sellerUserId} = ${ctx.user.id}`
          )
          .orderBy(desc(tradeFills.createdAt))
          .limit(5),
        // Active price alerts count
        db.select({ cnt: count() }).from(priceAlerts).where(
          and(eq(priceAlerts.userId, ctx.user.id), eq(priceAlerts.triggered, false))
        ),
        // Watchlist count
        db.select({ cnt: count() }).from(watchlist).where(eq(watchlist.userId, ctx.user.id)),
      ]);

    const statsByStatus = Object.fromEntries(
      orderStats.map((s) => [s.status, Number(s.cnt)])
    );

    return {
      user: user[0] ?? null,
      profile: profile[0] ?? null,
      orderStats: {
        total: Object.values(statsByStatus).reduce((a, b) => a + b, 0),
        open: statsByStatus["OPEN"] ?? 0,
        partiallyFilled: statsByStatus["PARTIALLY_FILLED"] ?? 0,
        filled: statsByStatus["FILLED"] ?? 0,
        cancelled: statsByStatus["CANCELLED"] ?? 0,
        rejected: statsByStatus["REJECTED"] ?? 0,
      },
      recentOrders,
      openPositions,
      recentFills,
      activeAlerts: Number(alertCount[0]?.cnt ?? 0),
      watchlistCount: Number(watchlistCount[0]?.cnt ?? 0),
    };
  }),

  // GET paginated order history with filters
  orderHistory: protectedProcedure
    .input(
      z.object({
        page: z.number().int().min(1).default(1),
        pageSize: z.number().int().min(1).max(100).default(20),
        status: z.enum(["OPEN", "PARTIALLY_FILLED", "FILLED", "CANCELLED", "REJECTED", "EXPIRED"]).optional(),
        assetClass: z.enum(["COMMODITY", "FOREX", "EQUITY", "DIGITAL_ASSET", "INDEX"]).optional(),
        symbol: z.string().max(32).optional(),
        from: z.date().optional(),
        to: z.date().optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) return { items: [], total: 0, page: input.page, pageSize: input.pageSize };

      const conditions = [eq(orders.userId, ctx.user.id)];
      if (input.status) conditions.push(eq(orders.status, input.status));
      if (input.assetClass) conditions.push(eq(orders.assetClass, input.assetClass));
      if (input.symbol) conditions.push(eq(orders.symbol, input.symbol));
      if (input.from) conditions.push(gte(orders.createdAt, input.from));
      if (input.to) conditions.push(lte(orders.createdAt, input.to));

      const where = and(...conditions);
      const offset = (input.page - 1) * input.pageSize;

      const [items, totalResult] = await Promise.all([
        db
          .select()
          .from(orders)
          .where(where)
          .orderBy(desc(orders.createdAt))
          .limit(input.pageSize)
          .offset(offset),
        db.select({ cnt: count() }).from(orders).where(where),
      ]);

      return {
        items,
        total: Number(totalResult[0]?.cnt ?? 0),
        page: input.page,
        pageSize: input.pageSize,
      };
    }),


  // GET Keycloak roles for the current user
  getKeycloakRoles: protectedProcedure.query(async ({ ctx }) => {
    const { ENV } = await import("../_core/env");
    const keycloakUrl = ENV.keycloakUrl;
    const realm = ENV.keycloakRealm;
    const clientId = ENV.keycloakClientId;
    const clientSecret = ENV.keycloakClientSecret;
    if (!keycloakUrl || !realm || !clientId || !clientSecret) {
      return { roles: [], source: "unavailable" as const };
    }
    try {
      const tokenRes = await fetch(
        `${keycloakUrl}/realms/${realm}/protocol/openid-connect/token`,
        {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            grant_type: "client_credentials",
            client_id: clientId,
            client_secret: clientSecret,
          }),
        }
      );
      if (!tokenRes.ok) return { roles: [], source: "error" as const };
      const { access_token } = await tokenRes.json() as { access_token: string };
      const identifier = ctx.user.email ?? ctx.user.openId;
      const userRes = await fetch(
        `${keycloakUrl}/admin/realms/${realm}/users?briefRepresentation=true&exact=true&username=${encodeURIComponent(identifier)}`,
        { headers: { Authorization: `Bearer ${access_token}` } }
      );
      if (!userRes.ok) return { roles: [], source: "error" as const };
      const kcUsers = await userRes.json() as Array<{ id: string }>;
      if (!kcUsers.length) return { roles: [], source: "not_found" as const };
      const kcUserId = kcUsers[0].id;
      const rolesRes = await fetch(
        `${keycloakUrl}/admin/realms/${realm}/users/${kcUserId}/role-mappings/realm`,
        { headers: { Authorization: `Bearer ${access_token}` } }
      );
      if (!rolesRes.ok) return { roles: [], source: "error" as const };
      const roleMappings = await rolesRes.json() as Array<{ name: string; description?: string }>;
      return {
        roles: roleMappings
          .filter((r) => !r.name.startsWith("default-roles"))
          .map((r) => ({ name: r.name, description: r.description ?? "" })),
        source: "keycloak" as const,
      };
    } catch {
      return { roles: [], source: "error" as const };
    }
  }),

  // UPDATE avatar URL in profile metadata
  updateAvatar: protectedProcedure
    .input(z.object({ avatarUrl: z.string().url().max(2048) }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) return { success: true };
      const existing = await db.select({ id: profiles.id, metadata: profiles.metadata }).from(profiles).where(eq(profiles.userId, ctx.user.id)).limit(1);
      const currentMeta = (existing[0]?.metadata as Record<string, unknown>) ?? {};
      const newMeta = { ...currentMeta, avatarUrl: input.avatarUrl };
      if (existing.length > 0) {
        await db.update(profiles).set({ metadata: newMeta, updatedAt: new Date() }).where(eq(profiles.userId, ctx.user.id));
      } else {
        await db.insert(profiles).values({ userId: ctx.user.id, metadata: newMeta });
      }
      return { success: true, avatarUrl: input.avatarUrl };
    }),

  // PROMOTE user to admin
  promoteToAdmin: protectedProcedure
    .input(z.object({ userId: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
      const db = await getDb();
            if (!db) return { success: true };
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
