import { TRPCError } from "@trpc/server";
import { and, desc, eq, ne } from "drizzle-orm";
import { getDb } from "../db";
import { deviceSessions, notifications } from "../../drizzle/schema";
import { protectedProcedure, router } from "../_core/trpc";
import { z } from "zod";
import { writeAuditLog } from "../audit";

// ── In-memory fallback store ──────────────────────────────────────────────────
export const deviceSessionRouter = router({
  // Record/update a device session fingerprint on login
  recordSession: protectedProcedure
    .input(
      z.object({
        userAgent: z.string().max(512),
        screenResolution: z.string().max(20).optional(),
        timezone: z.string().max(64).optional(),
        language: z.string().max(16).optional(),
        ipAddress: z.string().max(64).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      // Build fingerprint
      const fingerprintParts2 = [
        input.userAgent,
        input.screenResolution ?? "",
        input.timezone ?? "",
        input.language ?? "",
      ].join("|");
      let hash2 = 0;
      for (let i = 0; i < fingerprintParts2.length; i++) {
        hash2 = ((hash2 << 5) - hash2 + fingerprintParts2.charCodeAt(i)) | 0;
      }
      const fingerprintKey = Math.abs(hash2).toString(16).padStart(8, "0");

      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable — please try again" });

      // Build a stable fingerprint from the device characteristics
      const fingerprintParts = [
        input.userAgent,
        input.screenResolution ?? "",
        input.timezone ?? "",
        input.language ?? "",
      ].join("|");

      // Simple hash for fingerprint (not crypto-secure, just for matching)
      let hash = 0;
      for (let i = 0; i < fingerprintParts.length; i++) {
        hash = ((hash << 5) - hash + fingerprintParts.charCodeAt(i)) | 0;
      }
      const fingerprint = Math.abs(hash).toString(16).padStart(8, "0");

      // Check if this device has been seen before for this user
      const existing = await db
        .select({ id: deviceSessions.id, lastSeenAt: deviceSessions.lastSeenAt })
        .from(deviceSessions)
        .where(
          and(
            eq(deviceSessions.userId, ctx.user.id),
            eq(deviceSessions.fingerprint, fingerprint)
          )
        );

      const isNewDevice = existing.length === 0;

      if (isNewDevice) {
        // Insert new device session
        await db.insert(deviceSessions).values({
          userId: ctx.user.id,
          fingerprint,
          userAgent: input.userAgent,
          screenResolution: input.screenResolution ?? null,
          timezone: input.timezone ?? null,
          ipAddress: input.ipAddress ?? null,
          isKnown: false,
          isTrusted: false,
          lastSeenAt: new Date(),
          firstSeenAt: new Date(),
        });

        // Fire new-device alert notification
        const deviceDesc = input.userAgent.substring(0, 80);
        const tzDesc = input.timezone ? ` (${input.timezone})` : "";
        await db.insert(notifications).values({
          userId: ctx.user.id,
          title: "New Device Sign-In Detected",
          message: `A new device signed in to your account: ${deviceDesc}${tzDesc}. If this was not you, please contact support immediately.`,
          type: "SECURITY_ALERT",
        });
      } else {
        // Update lastSeenAt and optionally ipAddress
        await db
          .update(deviceSessions)
          .set({
            lastSeenAt: new Date(),
            ipAddress: input.ipAddress ?? existing[0].lastSeenAt?.toString(),
          })
          .where(
            and(
              eq(deviceSessions.userId, ctx.user.id),
              eq(deviceSessions.fingerprint, fingerprint)
            )
          );
      }

      return { isNewDevice, fingerprint };
    }),

  // List all device sessions for the current user
  listMySessions: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable — please try again" });

    return db
      .select()
      .from(deviceSessions)
      .where(eq(deviceSessions.userId, ctx.user.id))
      .orderBy(desc(deviceSessions.lastSeenAt));
  }),

  // Trust a device session
  trustDevice: protectedProcedure
    .input(z.object({ sessionId: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable — please try again" });
      const [session] = await db
        .select({ userId: deviceSessions.userId })
        .from(deviceSessions)
        .where(eq(deviceSessions.id, input.sessionId));
      if (!session || session.userId !== ctx.user.id) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Session not found." });
      }
      await db
        .update(deviceSessions)
        .set({ isTrusted: true })
        .where(eq(deviceSessions.id, input.sessionId));
      return { success: true };
    }),

  // Revoke (delete) a device session
  revokeDevice: protectedProcedure
    .input(z.object({ sessionId: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable — please try again" });
      const [session] = await db
        .select({ userId: deviceSessions.userId })
        .from(deviceSessions)
        .where(eq(deviceSessions.id, input.sessionId));
      if (!session || session.userId !== ctx.user.id) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Session not found." });
      }
      await db
        .delete(deviceSessions)
        .where(eq(deviceSessions.id, input.sessionId));
      return { success: true };
    }),

  // Revoke all other sessions (keep only the current fingerprint)
  revokeAllOtherSessions: protectedProcedure
    .input(z.object({ currentFingerprint: z.string().trim() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable — please try again" });
      await db
        .delete(deviceSessions)
        .where(
          and(
            eq(deviceSessions.userId, ctx.user.id),
            ne(deviceSessions.fingerprint, input.currentFingerprint)
          )
        );
      return { success: true };
    }),

  // Admin: list all device sessions for a specific user
  adminListUserSessions: protectedProcedure
    .input(z.object({ userId: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      if (ctx.user.role !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable — please try again" });
      return db
        .select()
        .from(deviceSessions)
        .where(eq(deviceSessions.userId, input.userId))
        .orderBy(desc(deviceSessions.lastSeenAt));
    }),
});
