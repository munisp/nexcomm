/**
 * NEXCOM Exchange — API Keys Router
 * Generate, list, and revoke API keys for programmatic access
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { eq, and } from "drizzle-orm";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { apiKeys } from "../../drizzle/schema";
import { randomBytes, createHash } from "crypto";
import { writeAuditLog } from "../audit";

function hashKey(rawKey: string): string {
  return createHash("sha256").update(rawKey).digest("hex");
}

function generateRawKey(): { raw: string; prefix: string } {
  const bytes = randomBytes(32).toString("hex");
  const prefix = "ncx_live_" + bytes.slice(0, 8);
  const raw = "ncx_live_" + bytes;
  return { raw, prefix };
}

export const apiKeysRouter = router({
  /**
   * List all API keys for the current user (without exposing the full key)
   */
  list: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) return [];
    const keys = await db
      .select({
        id: apiKeys.id,
        name: apiKeys.name,
        keyPrefix: apiKeys.keyPrefix,
        permissions: apiKeys.permissions,
        active: apiKeys.active,
        lastUsedAt: apiKeys.lastUsedAt,
        createdAt: apiKeys.createdAt,
        expiresAt: apiKeys.expiresAt,
      })
      .from(apiKeys)
      .where(eq(apiKeys.userId, ctx.user.id));
    return keys;
  }),

  /**
   * Generate a new API key — returns the raw key ONCE (not stored)
   */
  generate: protectedProcedure
    .input(z.object({
      name: z.string().min(1).max(128),
      permissions: z.array(z.enum(["READ", "TRADE", "ADMIN"])).min(1),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available." });

      const { raw, prefix } = generateRawKey();
      const hash = hashKey(raw);

      const [created] = await db.insert(apiKeys).values({
        userId: ctx.user.id,
        name: input.name,
        keyHash: hash,
        keyPrefix: prefix + "...",
        permissions: input.permissions,
        active: true,
      }).returning({ id: apiKeys.id });

      // Return the raw key ONCE — it will never be shown again
      return { id: created.id, rawKey: raw, prefix: prefix + "..." };
    }),

  /**
   * Revoke (deactivate) an API key
   */
  revoke: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available." });

      const [key] = await db.select().from(apiKeys)
        .where(and(eq(apiKeys.id, input.id), eq(apiKeys.userId, ctx.user.id)))
        .limit(1);

      if (!key) throw new TRPCError({ code: "NOT_FOUND", message: "API key not found." });

      await db.update(apiKeys)
        .set({ active: false })
        .where(eq(apiKeys.id, input.id));

      return { success: true };
    }),

  /**
   * Delete an API key permanently
   */
  delete: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available." });

      await db.delete(apiKeys)
        .where(and(eq(apiKeys.id, input.id), eq(apiKeys.userId, ctx.user.id)));

      return { success: true };
    }),
});
