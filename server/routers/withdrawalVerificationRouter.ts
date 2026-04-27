import { TRPCError } from "@trpc/server";
import { and, desc, eq, gt } from "drizzle-orm";
import { z } from "zod";
import {
  platformSettings,
  withdrawalVerifications,
} from "../../drizzle/schema";
import { getDb } from "../db";
import { protectedProcedure, adminProcedure, router } from "../_core/trpc";
import { writeAuditLog } from "../audit";

// Default threshold: withdrawals above this amount require typed verification
const DEFAULT_THRESHOLD = 500_000; // ₦500,000

async function getWithdrawalThreshold(): Promise<number> {
  const db = await getDb();
  if (!db) return DEFAULT_THRESHOLD;
  const [row] = await db
    .select()
    .from(platformSettings)
    .where(eq(platformSettings.key, "withdrawal_challenge_threshold"))
    .limit(1);
  if (!row) return DEFAULT_THRESHOLD;
  const parsed = parseFloat(row.value);
  return isNaN(parsed) ? DEFAULT_THRESHOLD : parsed;
}

function buildChallenge(user: { name?: string | null }): {
  challengeText: string;
  expectedAnswer: string;
} {
  const today = new Date();
  const dateStr = today.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  }); // e.g. "04 March 2026"
  const displayName = user.name?.trim() || "my name";
  const challengeText = `To confirm this large withdrawal, type your full name followed by today's date in the format: "${displayName} ${dateStr}"`;
  const expectedAnswer = `${displayName} ${dateStr}`.toLowerCase().replace(/\s+/g, " ").trim();
  return { challengeText, expectedAnswer };
}

export const withdrawalVerificationRouter = router({
  /** Check if a withdrawal amount requires a challenge */
  checkRequired: protectedProcedure
    .input(z.object({ amount: z.number().positive() }))
    .query(async ({ input }) => {
      const threshold = await getWithdrawalThreshold();
      return {
        required: input.amount >= threshold,
        threshold,
      };
    }),

  /** Create a new verification challenge for a withdrawal */
  createChallenge: protectedProcedure
    .input(z.object({ amount: z.number().positive() }))
    .mutation(async ({ ctx, input }) => {
      const threshold = await getWithdrawalThreshold();
      if (input.amount < threshold) {
        return { required: false, challengeId: null, challengeText: null };
      }

      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const { challengeText, expectedAnswer } = buildChallenge(ctx.user);
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

      const [challenge] = await db
        .insert(withdrawalVerifications)
        .values({
          userId: ctx.user.id,
          amount: String(input.amount),
          challengeText,
          expectedAnswer,
          status: "PENDING",
          attemptCount: 0,
          expiresAt,
        })
        .returning();

      return {
        required: true,
        challengeId: challenge.id,
        challengeText: challenge.challengeText,
        expiresAt: challenge.expiresAt,
      };
    }),

  /** Submit an answer to a verification challenge */
  submitAnswer: protectedProcedure
    .input(z.object({
      challengeId: z.number().int().positive(),
      answer: z.string().min(1).max(512),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const [challenge] = await db
        .select()
        .from(withdrawalVerifications)
        .where(
          and(
            eq(withdrawalVerifications.id, input.challengeId),
            eq(withdrawalVerifications.userId, ctx.user.id),
          )
        )
        .limit(1);

      if (!challenge) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Verification challenge not found" });
      }

      if (challenge.status !== "PENDING") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Challenge is already ${challenge.status.toLowerCase()}`,
        });
      }

      if (new Date() > challenge.expiresAt) {
        await db
          .update(withdrawalVerifications)
          .set({ status: "EXPIRED" })
          .where(eq(withdrawalVerifications.id, challenge.id));
        throw new TRPCError({ code: "BAD_REQUEST", message: "Verification challenge has expired. Please start a new withdrawal." });
      }

      const maxAttempts = 3;
      const normalised = input.answer.toLowerCase().replace(/\s+/g, " ").trim();
      const isCorrect = normalised === challenge.expectedAnswer;

      const newAttemptCount = challenge.attemptCount + 1;

      if (isCorrect) {
        await db
          .update(withdrawalVerifications)
          .set({ status: "PASSED", verifiedAt: new Date(), attemptCount: newAttemptCount })
          .where(eq(withdrawalVerifications.id, challenge.id));
        return { passed: true, attemptsRemaining: 0 };
      }

      if (newAttemptCount >= maxAttempts) {
        await db
          .update(withdrawalVerifications)
          .set({ status: "FAILED", attemptCount: newAttemptCount })
          .where(eq(withdrawalVerifications.id, challenge.id));
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Verification failed after 3 attempts. Please contact support if you believe this is an error.",
        });
      }

      await db
        .update(withdrawalVerifications)
        .set({ attemptCount: newAttemptCount })
        .where(eq(withdrawalVerifications.id, challenge.id));

      return {
        passed: false,
        attemptsRemaining: maxAttempts - newAttemptCount,
        hint: `Incorrect. Make sure to type your full name exactly as it appears on your profile, followed by today's date.`,
      };
    }),

  /** Verify that a challenge has been passed (called before processing withdrawal) */
  verifyPassed: protectedProcedure
    .input(z.object({ challengeId: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) return { passed: false };

      const [challenge] = await db
        .select()
        .from(withdrawalVerifications)
        .where(
          and(
            eq(withdrawalVerifications.id, input.challengeId),
            eq(withdrawalVerifications.userId, ctx.user.id),
            eq(withdrawalVerifications.status, "PASSED"),
            gt(withdrawalVerifications.expiresAt, new Date()),
          )
        )
        .limit(1);

      return { passed: !!challenge };
    }),

  /** Admin: get the current withdrawal threshold */
  adminGetThreshold: adminProcedure
    .query(async () => {
      const threshold = await getWithdrawalThreshold();
      return { threshold };
    }),

  /** Admin: update the withdrawal challenge threshold */
  adminSetThreshold: adminProcedure
    .input(z.object({ threshold: z.number().positive().min(1000) }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      await db
        .insert(platformSettings)
        .values({
          key: "withdrawal_challenge_threshold",
          value: String(input.threshold),
          description: "Minimum withdrawal amount (NGN) that requires a typed verification challenge",
          updatedBy: ctx.user.id,
        })
        .onConflictDoUpdate({
          target: platformSettings.key,
          set: {
            value: String(input.threshold),
            updatedBy: ctx.user.id,
            updatedAt: new Date(),
          },
        });

      return { success: true, threshold: input.threshold };
    }),

  /** Admin: list recent verification attempts */
  adminListVerifications: adminProcedure
    .input(z.object({
      limit: z.number().int().min(1).max(100).default(50),
      offset: z.number().int().min(0).default(0),
      status: z.enum(["PENDING", "PASSED", "FAILED", "EXPIRED", "ALL"]).default("ALL"),
    }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return { verifications: [], total: 0 };

      const rows = await db
        .select()
        .from(withdrawalVerifications)
        .where(
          input.status !== "ALL"
            ? eq(withdrawalVerifications.status, input.status)
            : undefined
        )
        .orderBy(desc(withdrawalVerifications.createdAt))
        .limit(input.limit)
        .offset(input.offset);

      return { verifications: rows, total: rows.length };
    }),
});
