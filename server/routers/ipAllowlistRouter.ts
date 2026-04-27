import { TRPCError } from "@trpc/server";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { ipAllowlist, securityEvents } from "../../drizzle/schema";
import { getDb } from "../db";
import { adminProcedure, router } from "../_core/trpc";
import { writeAuditLog } from "../audit";

// ─── CIDR Matching Utility ────────────────────────────────────────────────────

function ipToInt(ip: string): number {
  return ip.split(".").reduce((acc, octet) => (acc << 8) + parseInt(octet, 10), 0) >>> 0;
}

function isIpInCidr(ip: string, cidr: string): boolean {
  try {
    // Handle IPv6 loopback / non-IPv4
    if (!ip || ip.includes(":")) return false;
    const [network, prefixStr] = cidr.split("/");
    const prefix = parseInt(prefixStr ?? "32", 10);
    const mask = prefix === 0 ? 0 : (~0 << (32 - prefix)) >>> 0;
    return (ipToInt(ip) & mask) === (ipToInt(network) & mask);
  } catch {
    return false;
  }
}

/**
 * Check if an IP address is allowed for a given scope.
 * If no active entries exist for the scope, the allowlist is considered
 * "not configured" and access is permitted (open by default).
 * Returns { allowed, reason }.
 */
export async function checkIpAllowlist(
  ip: string,
  scope: "GLOBAL_ADMIN" | "BULK_OPERATIONS" | "LIQUIDATION_OVERRIDE" | "WITHDRAWAL_APPROVAL"
): Promise<{ allowed: boolean; reason: string }> {
  const db = await getDb();
  if (!db) return { allowed: true, reason: "DB unavailable — allowlist not enforced" };

  const entries = await db
    .select()
    .from(ipAllowlist)
    .where(and(eq(ipAllowlist.scope, scope), eq(ipAllowlist.isActive, true)));

  if (entries.length === 0) {
    return { allowed: true, reason: "No allowlist configured for this scope" };
  }

  const matched = entries.some((e) => isIpInCidr(ip, e.cidr));
  if (matched) {
    return { allowed: true, reason: "IP matched allowlist entry" };
  }

  return {
    allowed: false,
    reason: `IP ${ip} is not in the allowlist for scope ${scope}`,
  };
}

/**
 * tRPC middleware factory: enforces IP allowlist for a given scope.
 * Logs a SUSPICIOUS_IP security event when access is denied.
 */
export async function enforceIpAllowlist(
  ip: string,
  scope: "GLOBAL_ADMIN" | "BULK_OPERATIONS" | "LIQUIDATION_OVERRIDE" | "WITHDRAWAL_APPROVAL",
  userId: number
): Promise<void> {
  const { allowed, reason } = await checkIpAllowlist(ip, scope);
  if (allowed) return;

  // Log security event
  const db = await getDb();
  if (db) {
    await db.insert(securityEvents).values({
      userId,
      eventType: "SUSPICIOUS_IP",
      severity: "HIGH",
      status: "OPEN",
      title: `Blocked admin action from unlisted IP`,
      description: `Admin user ${userId} attempted a ${scope} action from IP ${ip}, which is not in the allowlist. ${reason}`,
      ipAddress: ip,
      metadata: { scope, ip },
    });
  }

  throw new TRPCError({
    code: "FORBIDDEN",
    message: `Access denied: your IP address (${ip}) is not authorised for this operation. This incident has been logged.`,
  });
}

// ─── tRPC Router ─────────────────────────────────────────────────────────────

export const ipAllowlistRouter = router({
  /** Admin: list all IP allowlist entries */
  adminList: adminProcedure
    .input(z.object({
      scope: z.enum(["GLOBAL_ADMIN", "BULK_OPERATIONS", "LIQUIDATION_OVERRIDE", "WITHDRAWAL_APPROVAL", "ALL"]).default("ALL"),
      includeInactive: z.boolean().default(false),
    }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return [];

      const conditions = [];
      if (!input.includeInactive) conditions.push(eq(ipAllowlist.isActive, true));
      if (input.scope !== "ALL") conditions.push(eq(ipAllowlist.scope, input.scope));

      const rows = await db
        .select()
        .from(ipAllowlist)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(desc(ipAllowlist.createdAt));

      return rows;
    }),

  /** Admin: add a new CIDR entry */
  adminCreate: adminProcedure
    .input(z.object({
      cidr: z.string().regex(
        /^(\d{1,3}\.){3}\d{1,3}(\/\d{1,2})?$/,
        "Must be a valid IPv4 CIDR (e.g. 192.168.1.0/24 or 10.0.0.1/32)"
      ),
      label: z.string().min(3).max(128),
      scope: z.enum(["GLOBAL_ADMIN", "BULK_OPERATIONS", "LIQUIDATION_OVERRIDE", "WITHDRAWAL_APPROVAL"]),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const [entry] = await db
        .insert(ipAllowlist)
        .values({
          cidr: input.cidr,
          label: input.label,
          scope: input.scope,
          isActive: true,
          createdBy: ctx.user.id,
        })
        .returning();

      return { success: true, id: entry.id };
    }),

  /** Admin: toggle an entry active/inactive */
  adminToggle: adminProcedure
    .input(z.object({
      id: z.number().int().positive(),
      isActive: z.boolean(),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const [existing] = await db
        .select()
        .from(ipAllowlist)
        .where(eq(ipAllowlist.id, input.id))
        .limit(1);

      if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "Entry not found" });

      await db
        .update(ipAllowlist)
        .set({ isActive: input.isActive, updatedAt: new Date() })
        .where(eq(ipAllowlist.id, input.id));

      return { success: true };
    }),

  /** Admin: delete an entry */
  adminDelete: adminProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const [existing] = await db
        .select()
        .from(ipAllowlist)
        .where(eq(ipAllowlist.id, input.id))
        .limit(1);

      if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "Entry not found" });

      await db.delete(ipAllowlist).where(eq(ipAllowlist.id, input.id));
      return { success: true };
    }),

  /** Admin: check if a specific IP is allowed for a scope */
  adminCheckIp: adminProcedure
    .input(z.object({
      ip: z.string().regex(/^(\d{1,3}\.){3}\d{1,3}$/, "Must be a valid IPv4 address"),
      scope: z.enum(["GLOBAL_ADMIN", "BULK_OPERATIONS", "LIQUIDATION_OVERRIDE", "WITHDRAWAL_APPROVAL"]),
    }))
    .query(async ({ input }) => {
      return checkIpAllowlist(input.ip, input.scope);
    }),
});
