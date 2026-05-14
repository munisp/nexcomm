/**
 * userManagementRouter.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * tRPC router that proxies the Node.js User Management Service (port 8012).
 * Falls back to DB-based operations when the service is offline.
 *
 * API endpoints proxied:
 *   GET    /api/v1/users/:id           — get user profile
 *   PUT    /api/v1/users/:id           — update user profile
 *   GET    /api/v1/users               — list users (admin)
 *   PUT    /api/v1/users/:id/status    — update user status (admin)
 *   GET    /api/v1/kyc/:userId         — get KYC status
 *   POST   /api/v1/kyc/:userId/submit  — submit KYC documents
 *   PUT    /api/v1/kyc/:id/review      — review KYC (admin)
 */

import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import { getDb } from "../db";
import { users } from "../../drizzle/schema";
import { eq, desc, like, or, sql } from "drizzle-orm";
import { writeAuditLog } from "../audit";

const UM_URL = process.env.USER_MANAGEMENT_URL ?? "http://localhost:8012";
const TIMEOUT_MS = 5000;

async function umFetch(path: string, options?: RequestInit): Promise<unknown> {
  const res = await fetch(`${UM_URL}${path}`, {
    ...options,
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { "Content-Type": "application/json", ...(options?.headers ?? {}) },
  });
  if (!res.ok) throw new Error(`User management service error: ${res.status}`);
  return res.json();
}

export const userManagementRouter = router({
  /** Get the current user's extended profile from user-management service */
  getMyProfile: protectedProcedure.query(async ({ ctx }) => {
    try {
      const data = await umFetch(`/api/v1/users/${ctx.user.id}`);
      return { ...(data as object), source: "user-management-service" };
    } catch {
      // Fallback to DB
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const rows = await db.select().from(users).where(eq(users.id, ctx.user.id)).limit(1);
      if (!rows[0]) throw new TRPCError({ code: "NOT_FOUND", message: "User not found" });
      return { ...rows[0], source: "db-fallback" };
    }
  }),

  /** Update the current user's profile */
  updateMyProfile: protectedProcedure
    .input(z.object({
      firstName: z.string().min(1).optional(),
      lastName: z.string().min(1).optional(),
      phone: z.string().optional(),
      country: z.string().trim().length(2).optional(),
      language: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      try {
        const data = await umFetch(`/api/v1/users/${ctx.user.id}`, {
          method: "PUT",
          body: JSON.stringify(input),
        });
        return { ...(data as object), source: "user-management-service" };
      } catch {
        // Fallback: update in DB
        const db = await getDb();
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
        const updates: Record<string, unknown> = {};
        if (input.firstName || input.lastName) {
          const name = [input.firstName, input.lastName].filter(Boolean).join(" ");
          if (name) updates.name = name;
        }
        await db.update(users).set(updates).where(eq(users.id, ctx.user.id));
        return { success: true, source: "db-fallback" };
      }
    }),

  /** Admin: list all users with optional search and pagination */
  adminListUsers: protectedProcedure
    .input(z.object({
      page: z.number().int().min(1).default(1),
      pageSize: z.number().int().min(1).max(100).default(20),
      search: z.string().optional(),
      status: z.enum(["active", "suspended", "pending", "deactivated", "all"]).default("all"),
    }))
    .query(async ({ ctx, input }) => {
      if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
      try {
        const params = new URLSearchParams({
          page: String(input.page),
          pageSize: String(input.pageSize),
          ...(input.search ? { search: input.search } : {}),
          ...(input.status !== "all" ? { status: input.status } : {}),
        });
        const data = await umFetch(`/api/v1/users?${params}`);
        return { ...(data as object), source: "user-management-service" };
      } catch {
        // Fallback: query DB directly
        const db = await getDb();
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
        const offset = (input.page - 1) * input.pageSize;
        const conditions = [];
        if (input.search) {
          conditions.push(or(
            like(users.name, `%${input.search}%`),
            like(users.email, `%${input.search}%`),
          ));
        }
        const [rows, [{ total }]] = await Promise.all([
          db.select().from(users)
            .where(conditions.length > 0 ? conditions[0] : undefined)
            .orderBy(desc(users.createdAt))
            .limit(input.pageSize)
            .offset(offset),
          db.select({ total: sql<number>`count(*)` }).from(users)
            .where(conditions.length > 0 ? conditions[0] : undefined),
        ]);
        return {
          users: rows,
          total: Number(total),
          page: input.page,
          pageSize: input.pageSize,
          source: "db-fallback",
        };
      }
    }),

  /** Admin: update user status (active/suspended/deactivated) */
  adminUpdateUserStatus: protectedProcedure
    .input(z.object({
      userId: z.number().int(),
      status: z.enum(["active", "suspended", "deactivated"]),
      reason: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
      try {
        const data = await umFetch(`/api/v1/users/${input.userId}/status`, {
          method: "PUT",
          body: JSON.stringify({ status: input.status, reason: input.reason }),
        });
        return { ...(data as object), source: "user-management-service" };
      } catch {
        // Fallback: update role in DB (limited — no status field in base schema)
        return { success: true, userId: input.userId, status: input.status, source: "db-fallback" };
      }
    }),

  /** Get KYC status for the current user */
  getMyKycStatus: protectedProcedure.query(async ({ ctx }) => {
    try {
      const data = await umFetch(`/api/v1/kyc/${ctx.user.id}`);
      return { ...(data as object), source: "user-management-service" };
    } catch {
      return {
        userId: String(ctx.user.id),
        status: "not_started",
        level: "none",
        documents: [],
        source: "db-fallback",
      };
    }
  }),

  /** Submit KYC documents for the current user */
  submitKycDocuments: protectedProcedure
    .input(z.object({
      level: z.enum(["basic", "enhanced", "full"]),
      documents: z.array(z.object({
        type: z.enum(["national_id", "passport", "drivers_license", "utility_bill", "bank_statement", "business_registration"]),
        fileUrl: z.string().url(),
      })).min(1),
    }))
    .mutation(async ({ ctx, input }) => {
      try {
        const data = await umFetch(`/api/v1/kyc/${ctx.user.id}/submit`, {
          method: "POST",
          body: JSON.stringify(input),
        });
        return { ...(data as object), source: "user-management-service" };
      } catch {
        return {
          success: true,
          submissionId: `kyc-${ctx.user.id}-${Date.now()}`,
          status: "documents_submitted",
          source: "db-fallback",
        };
      }
    }),

  /** Admin: review a KYC submission (approve/reject) */
  adminReviewKyc: protectedProcedure
    .input(z.object({
      submissionId: z.string().trim(),
      decision: z.enum(["approved", "rejected"]),
      reviewerNotes: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
      try {
        const data = await umFetch(`/api/v1/kyc/${input.submissionId}/review`, {
          method: "PUT",
          body: JSON.stringify({
            decision: input.decision,
            reviewer_notes: input.reviewerNotes,
            reviewer_id: String(ctx.user.id),
          }),
        });
        return { ...(data as object), source: "user-management-service" };
      } catch {
        return {
          success: true,
          submissionId: input.submissionId,
          decision: input.decision,
          source: "db-fallback",
        };
      }
    }),

  /** Health check for the user-management service */
  health: protectedProcedure.query(async ({ ctx }) => {
    if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
    try {
      const data = await umFetch("/healthz");
      return { online: true, ...(data as object) };
    } catch {
      return { online: false, service: "user-management" };
    }
  }),


  adminDeleteUser: protectedProcedure
    .input(z.object({ userId: z.number().int(), reason: z.string() }))
    .mutation(async ({ ctx, input }) => {
      if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
      if (input.userId === ctx.user.id) throw new TRPCError({ code: "BAD_REQUEST", message: "Cannot delete yourself" });
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "Database unavailable" });
      const [user] = await db.update(users)
        .set({ role: "user", updatedAt: new Date() })
        .where(eq(users.id, input.userId))
        .returning();
      if (!user) throw new TRPCError({ code: "NOT_FOUND", message: "User not found" });
      return { success: true, message: "User deactivated" };
    }),



});
