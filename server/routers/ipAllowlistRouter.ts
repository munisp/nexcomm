import { TRPCError } from "@trpc/server";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { ipAllowlist, securityEvents } from "../../drizzle/schema";
import { getDb } from "../db";
import { adminProcedure, router } from "../_core/trpc";
import { writeAuditLog } from "../audit";

// ── In-memory fallback store ──────────────────────────────────────────────────
type MemEntry = {
  id: number;
  cidr: string;
  label: string;
  scope: "GLOBAL_ADMIN" | "BULK_OPERATIONS" | "LIQUIDATION_OVERRIDE" | "WITHDRAWAL_APPROVAL";
  isActive: boolean;
  createdBy: number;
  createdAt: Date;
  updatedAt: Date;
};
const _memEntries = new Map<number, MemEntry>();
let _memSeq = 1;

// ─── CIDR Matching Utility ────────────────────────────────────────────────────
function ipToInt(ip: string): number {
  return ip.split(".").reduce((acc, octet) => (acc << 8) + parseInt(octet, 10), 0) >>> 0;
}

function isIpInCidr(ip: string, cidr: string): boolean {
  try {
    if (!ip || ip.includes(":")) return false;
    const [network, prefixStr] = cidr.split("/");
    const prefix = parseInt(prefixStr ?? "32", 10);
    const mask = prefix === 0 ? 0 : (~0 << (32 - prefix)) >>> 0;
    return (ipToInt(ip) & mask) === (ipToInt(network) & mask);
  } catch {
    return false;
  }
}

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

export async function enforceIpAllowlist(
  ip: string,
  scope: "GLOBAL_ADMIN" | "BULK_OPERATIONS" | "LIQUIDATION_OVERRIDE" | "WITHDRAWAL_APPROVAL",
  userId: number
): Promise<void> {
  const { allowed, reason } = await checkIpAllowlist(ip, scope);
  if (allowed) return;

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
  adminList: adminProcedure
    .input(z.object({
      scope: z.enum(["GLOBAL_ADMIN", "BULK_OPERATIONS", "LIQUIDATION_OVERRIDE", "WITHDRAWAL_APPROVAL", "ALL"]).default("ALL"),
      includeInactive: z.boolean().default(false),
    }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) {
        return Array.from(_memEntries.values())
          .filter(e => (input.includeInactive || e.isActive) && (input.scope === "ALL" || e.scope === input.scope));
      }
      const conditions = [];
      if (!input.includeInactive) conditions.push(eq(ipAllowlist.isActive, true));
      if (input.scope !== "ALL") conditions.push(eq(ipAllowlist.scope, input.scope));
      return db
        .select()
        .from(ipAllowlist)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(desc(ipAllowlist.createdAt));
    }),

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
      if (!db) {
        const id = _memSeq++;
        const now = new Date();
        _memEntries.set(id, { id, cidr: input.cidr, label: input.label, scope: input.scope, isActive: true, createdBy: ctx.user.id, createdAt: now, updatedAt: now });
        return { success: true, id };
      }
      const [entry] = await db
        .insert(ipAllowlist)
        .values({ cidr: input.cidr, label: input.label, scope: input.scope, isActive: true, createdBy: ctx.user.id })
        .returning();
      return { success: true, id: entry.id };
    }),

  adminToggle: adminProcedure
    .input(z.object({ id: z.number().int().positive(), isActive: z.boolean() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) {
        const e = _memEntries.get(input.id);
        if (!e) throw new TRPCError({ code: "NOT_FOUND", message: "Entry not found" });
        e.isActive = input.isActive;
        e.updatedAt = new Date();
        return { success: true };
      }
      const [existing] = await db.select().from(ipAllowlist).where(eq(ipAllowlist.id, input.id)).limit(1);
      if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "Entry not found" });
      await db.update(ipAllowlist).set({ isActive: input.isActive, updatedAt: new Date() }).where(eq(ipAllowlist.id, input.id));
      return { success: true };
    }),

  adminDelete: adminProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) {
        if (!_memEntries.has(input.id)) throw new TRPCError({ code: "NOT_FOUND", message: "Entry not found" });
        _memEntries.delete(input.id);
        return { success: true };
      }
      const [existing] = await db.select().from(ipAllowlist).where(eq(ipAllowlist.id, input.id)).limit(1);
      if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "Entry not found" });
      await db.delete(ipAllowlist).where(eq(ipAllowlist.id, input.id));
      return { success: true };
    }),

  adminCheckIp: adminProcedure
    .input(z.object({
      ip: z.string().regex(/^(\d{1,3}\.){3}\d{1,3}$/, "Must be a valid IPv4 address"),
      scope: z.enum(["GLOBAL_ADMIN", "BULK_OPERATIONS", "LIQUIDATION_OVERRIDE", "WITHDRAWAL_APPROVAL"]),
    }))
    .query(async ({ input }) => {
      return checkIpAllowlist(input.ip, input.scope);
    }),
});
