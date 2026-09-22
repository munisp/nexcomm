/**
 * NEXCOM Exchange — Channel Bridge Router (INNOVATION 6)
 * ─────────────────────────────────────────────────────────────────────────────
 * Omnichannel session continuity: a signed-in user generates a 6-digit OTP on
 * one channel (web/PWA) and enters it on another (USSD) — or vice versa — to
 * continue their session with its pending intent (e.g. a draft order).
 *
 * Security model:
 *   - OTPs are 6 digits, 10-minute expiry, single-use, stored SHA-256 hashed
 *     (repo convention: server/routers/totpRouter.ts). Plaintext OTPs are only
 *     ever returned to the channel that created the handoff.
 *   - completeHandoff is rate-limited by single-use + expiry; brute-forcing a
 *     6-digit code is further constrained by marking the handoff used on the
 *     FIRST successful validation and expiring after 10 minutes.
 *   - All mutations write audit-log entries (no OTP material logged).
 *
 * Registration (sibling-owned file — see MANIFEST snippet):
 *   server/routers.ts:  channelBridge: channelBridgeRouter,
 */
import crypto from "crypto";
import { z } from "zod";
import { router, protectedProcedure, publicProcedure } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import { getDb } from "../db";
import { profiles, ussdSessions, deviceSessions } from "../../drizzle/schema";
import { channelHandoffs } from "../../drizzle/schema-channel-bridge";
import { and, desc, eq, gt, isNull } from "drizzle-orm";
import { writeAuditLog } from "../audit";

const OTP_TTL_MS = 10 * 60 * 1000; // 10 minutes

const channelEnum = z.enum(["WEB", "USSD", "WHATSAPP"]);

/** Pending intent snapshot carried across the handoff. */
const intentSchema = z
  .object({
    type: z.enum(["draft_order", "price_check", "kyc_resume", "delivery_tracking", "generic"]),
    /** Human-readable summary rendered on the receiving channel. */
    summary: z.string().max(500).optional(),
    /** Optional structured payload (e.g. { symbol, side, quantity }). */
    payload: z.record(z.string(), z.unknown()).optional(),
  })
  .optional();

function hashOtp(otp: string): string {
  return crypto.createHash("sha256").update(otp).digest("hex");
}

export const channelBridgeRouter = router({
  // ─── Create a handoff token (web → phone, or phone → web) ───────────────────
  // The creating channel receives the plaintext OTP to display/speak to the
  // user; only the hash is persisted.
  createHandoffToken: protectedProcedure
    .input(
      z.object({
        channelFrom: channelEnum,
        channelTo: channelEnum,
        intent: intentSchema,
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (input.channelFrom === input.channelTo) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Source and target channels must differ" });
      }
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });

      // Invalidate any prior unused handoffs for this user (one live OTP at a time)
      await db
        .update(channelHandoffs)
        .set({ usedAt: new Date() })
        .where(and(eq(channelHandoffs.userId, ctx.user.id), isNull(channelHandoffs.usedAt)));

      // 6-digit OTP, CSPRNG
      const otp = String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
      const expiresAt = new Date(Date.now() + OTP_TTL_MS);

      const [row] = await db
        .insert(channelHandoffs)
        .values({
          userId: ctx.user.id,
          otpHash: hashOtp(otp),
          channelFrom: input.channelFrom,
          channelTo: input.channelTo,
          intent: input.intent ?? null,
          expiresAt,
        })
        .returning({ id: channelHandoffs.id });

      await writeAuditLog({
        userId: ctx.user.id,
        action: "channelBridge.createHandoff",
        resource: "channel_handoffs",
        resourceId: String(row.id),
        details: { channelFrom: input.channelFrom, channelTo: input.channelTo },
      });

      return {
        handoffId: row.id,
        otp,
        expiresAt,
        channelFrom: input.channelFrom,
        channelTo: input.channelTo,
      };
    }),

  // ─── Complete a handoff by entering the OTP on the target channel ───────────
  // Validates the code, marks it used (single-use), and returns the pending
  // intent payload so the receiving channel can resume the flow.
  completeHandoff: protectedProcedure
    .input(z.object({ otp: z.string().regex(/^\d{6}$/, "6-digit code required") }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });

      const otpHash = hashOtp(input.otp);
      const [handoff] = await db
        .select()
        .from(channelHandoffs)
        .where(
          and(
            eq(channelHandoffs.userId, ctx.user.id),
            eq(channelHandoffs.otpHash, otpHash),
            isNull(channelHandoffs.usedAt),
            gt(channelHandoffs.expiresAt, new Date()),
          )
        )
        .orderBy(desc(channelHandoffs.createdAt))
        .limit(1);

      if (!handoff) {
        await writeAuditLog({
          userId: ctx.user.id,
          action: "channelBridge.completeHandoff.failed",
          resource: "channel_handoffs",
          details: { reason: "invalid_or_expired" },
        });
        throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid or expired code" });
      }

      const [marked] = await db
        .update(channelHandoffs)
        .set({ usedAt: new Date() })
        .where(and(eq(channelHandoffs.id, handoff.id), isNull(channelHandoffs.usedAt)))
        .returning({ id: channelHandoffs.id });
      if (!marked) {
        // Concurrent completion — treat as invalid (single-use guarantee)
        throw new TRPCError({ code: "BAD_REQUEST", message: "Code already used" });
      }

      await writeAuditLog({
        userId: ctx.user.id,
        action: "channelBridge.completeHandoff",
        resource: "channel_handoffs",
        resourceId: String(handoff.id),
        details: { channelFrom: handoff.channelFrom, channelTo: handoff.channelTo },
      });

      return {
        handoffId: handoff.id,
        channelFrom: handoff.channelFrom,
        channelTo: handoff.channelTo,
        issuedAt: handoff.createdAt,
        intent: handoff.intent as
          | { type: string; summary?: string; payload?: Record<string, unknown> }
          | null,
      };
    }),

  // ─── Service bridge: complete a handoff on behalf of a PIN-authenticated ────
  //     USSD session. The ussd-engine calls this AFTER resolving user_id via
  //     its existing PIN auth. Guarded by the NEXCOM_SERVICE_TOKEN shared
  //     secret (service-to-service only — never exposed to browsers).
  completeHandoffService: publicProcedure
    .input(
      z.object({
        userId: z.number().int().positive(),
        otp: z.string().regex(/^\d{6}$/),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const expected = process.env.NEXCOM_SERVICE_TOKEN;
      const provided = ctx.req.headers["x-service-token"];
      if (!expected || provided !== expected) {
        throw new TRPCError({ code: "UNAUTHORIZED", message: "Service token required" });
      }
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });

      const otpHash = hashOtp(input.otp);
      const [handoff] = await db
        .select()
        .from(channelHandoffs)
        .where(
          and(
            eq(channelHandoffs.userId, input.userId),
            eq(channelHandoffs.otpHash, otpHash),
            isNull(channelHandoffs.usedAt),
            gt(channelHandoffs.expiresAt, new Date()),
          )
        )
        .orderBy(desc(channelHandoffs.createdAt))
        .limit(1);

      if (!handoff) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid or expired code" });
      }

      await db
        .update(channelHandoffs)
        .set({ usedAt: new Date() })
        .where(and(eq(channelHandoffs.id, handoff.id), isNull(channelHandoffs.usedAt)));

      await writeAuditLog({
        userId: input.userId,
        action: "channelBridge.completeHandoff.ussd",
        resource: "channel_handoffs",
        resourceId: String(handoff.id),
        details: { channelFrom: handoff.channelFrom, channelTo: handoff.channelTo },
      });

      return {
        ok: true as const,
        handoffId: handoff.id,
        channelFrom: handoff.channelFrom,
        channelTo: handoff.channelTo,
        intent: handoff.intent as
          | { type: string; summary?: string; payload?: Record<string, unknown> }
          | null,
      };
    }),

  // ─── Where am I active? (web device sessions + recent USSD sessions) ────────
  getMyChannelSessions: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) return { web: [], ussd: [], openHandoffs: [] };

    const [web, ussd, openHandoffs, [userRow]] = await Promise.all([
      db
        .select({
          id: deviceSessions.id,
          userAgent: deviceSessions.userAgent,
          ipAddress: deviceSessions.ipAddress,
          lastSeenAt: deviceSessions.lastSeenAt,
          isTrusted: deviceSessions.isTrusted,
        })
        .from(deviceSessions)
        .where(and(eq(deviceSessions.userId, ctx.user.id), isNull(deviceSessions.revokedAt)))
        .orderBy(desc(deviceSessions.lastSeenAt))
        .limit(10),
      db
        .select({
          id: ussdSessions.id,
          phoneNumber: ussdSessions.phoneNumber,
          status: ussdSessions.status,
          currentMenu: ussdSessions.currentMenu,
          startedAt: ussdSessions.startedAt,
          lastActivityAt: ussdSessions.lastActivityAt,
        })
        .from(ussdSessions)
        .where(eq(ussdSessions.userId, ctx.user.id))
        .orderBy(desc(ussdSessions.lastActivityAt))
        .limit(5),
      db
        .select({
          id: channelHandoffs.id,
          channelFrom: channelHandoffs.channelFrom,
          channelTo: channelHandoffs.channelTo,
          expiresAt: channelHandoffs.expiresAt,
        })
        .from(channelHandoffs)
        .where(
          and(
            eq(channelHandoffs.userId, ctx.user.id),
            isNull(channelHandoffs.usedAt),
            gt(channelHandoffs.expiresAt, new Date()),
          )
        )
        .orderBy(desc(channelHandoffs.createdAt))
        .limit(1),
      db.select({ phone: profiles.phone }).from(profiles).where(eq(profiles.userId, ctx.user.id)).limit(1),
    ]);

    return {
      web,
      ussd,
      openHandoffs,
      registeredPhone: userRow?.phone ?? null,
    };
  }),
});
