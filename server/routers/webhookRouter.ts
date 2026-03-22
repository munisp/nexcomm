import { TRPCError } from "@trpc/server";
import { createHmac } from "crypto";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { webhookConfigs, type SecurityEvent } from "../../drizzle/schema";
import { getDb } from "../db";
import { adminProcedure, router } from "../_core/trpc";

// ─── Webhook Dispatch ─────────────────────────────────────────────────────────

/**
 * Dispatch a security event to all active webhook endpoints that match the
 * event's severity filter. Called by the security router when a new event is
 * created or updated to HIGH/CRITICAL.
 */
export async function dispatchSecurityEventWebhooks(event: SecurityEvent): Promise<void> {
  const db = await getDb();
  if (!db) return;

  // Only dispatch for HIGH and CRITICAL events
  if (event.severity !== "HIGH" && event.severity !== "CRITICAL") return;

  const configs = await db
    .select()
    .from(webhookConfigs)
    .where(eq(webhookConfigs.isActive, true));

  const eligibleConfigs = configs.filter((cfg) => {
    if (cfg.eventFilter === "ALL") return true;
    if (cfg.eventFilter === "HIGH_AND_CRITICAL") return true;
    if (cfg.eventFilter === "CRITICAL_ONLY") return event.severity === "CRITICAL";
    return false;
  });

  const payload = JSON.stringify({
    event: "security_alert",
    timestamp: new Date().toISOString(),
    data: {
      id: event.id,
      eventType: event.eventType,
      severity: event.severity,
      status: event.status,
      title: event.title,
      description: event.description,
      ipAddress: event.ipAddress,
      userId: event.userId,
      createdAt: event.createdAt,
    },
  });

  await Promise.allSettled(
    eligibleConfigs.map(async (cfg) => {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        "X-NEXCOM-Event": "security_alert",
        "X-NEXCOM-Severity": event.severity,
      };

      // HMAC-SHA256 signature if secret is configured
      if (cfg.secret) {
        const sig = createHmac("sha256", cfg.secret).update(payload).digest("hex");
        headers["X-NEXCOM-Signature"] = `sha256=${sig}`;
      }

      let statusCode = 0;
      let failed = false;

      try {
        const res = await fetch(cfg.url, {
          method: "POST",
          headers,
          body: payload,
          signal: AbortSignal.timeout(10_000),
        });
        statusCode = res.status;
        failed = !res.ok;
      } catch {
        failed = true;
        statusCode = 0;
      }

      // Update last triggered status
      await db
        .update(webhookConfigs)
        .set({
          lastTriggeredAt: new Date(),
          lastStatusCode: statusCode,
          failureCount: failed ? cfg.failureCount + 1 : 0,
          updatedAt: new Date(),
        })
        .where(eq(webhookConfigs.id, cfg.id));
    })
  );
}

// ─── tRPC Router ─────────────────────────────────────────────────────────────

export const webhookRouter = router({
  /** Admin: list all webhook configurations */
  adminList: adminProcedure
    .input(z.object({
      includeInactive: z.boolean().default(false),
    }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return [];

      const rows = await db
        .select()
        .from(webhookConfigs)
        .where(input.includeInactive ? undefined : eq(webhookConfigs.isActive, true))
        .orderBy(desc(webhookConfigs.createdAt));

      // Mask secrets in the response
      return rows.map((r) => ({
        ...r,
        secret: r.secret ? "••••••••" : null,
      }));
    }),

  /** Admin: create a new webhook endpoint */
  adminCreate: adminProcedure
    .input(z.object({
      name: z.string().min(3).max(128),
      url: z.string().url().max(2048),
      secret: z.string().max(256).optional(),
      eventFilter: z.enum(["ALL", "HIGH_AND_CRITICAL", "CRITICAL_ONLY"]).default("HIGH_AND_CRITICAL"),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const [webhook] = await db
        .insert(webhookConfigs)
        .values({
          name: input.name,
          url: input.url,
          secret: input.secret ?? null,
          eventFilter: input.eventFilter,
          isActive: true,
          failureCount: 0,
          createdBy: ctx.user.id,
        })
        .returning();

      return { success: true, id: webhook.id };
    }),

  /** Admin: update a webhook endpoint */
  adminUpdate: adminProcedure
    .input(z.object({
      id: z.number().int().positive(),
      name: z.string().min(3).max(128).optional(),
      url: z.string().url().max(2048).optional(),
      secret: z.string().max(256).nullable().optional(),
      eventFilter: z.enum(["ALL", "HIGH_AND_CRITICAL", "CRITICAL_ONLY"]).optional(),
      isActive: z.boolean().optional(),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const [existing] = await db
        .select()
        .from(webhookConfigs)
        .where(eq(webhookConfigs.id, input.id))
        .limit(1);

      if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "Webhook not found" });

      const updates: Partial<typeof webhookConfigs.$inferInsert> = { updatedAt: new Date() };
      if (input.name !== undefined) updates.name = input.name;
      if (input.url !== undefined) updates.url = input.url;
      if (input.secret !== undefined) updates.secret = input.secret;
      if (input.eventFilter !== undefined) updates.eventFilter = input.eventFilter;
      if (input.isActive !== undefined) updates.isActive = input.isActive;

      await db.update(webhookConfigs).set(updates).where(eq(webhookConfigs.id, input.id));
      return { success: true };
    }),

  /** Admin: delete a webhook endpoint */
  adminDelete: adminProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const [existing] = await db
        .select()
        .from(webhookConfigs)
        .where(eq(webhookConfigs.id, input.id))
        .limit(1);

      if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "Webhook not found" });

      await db.delete(webhookConfigs).where(eq(webhookConfigs.id, input.id));
      return { success: true };
    }),

  /** Admin: send a test payload to a webhook endpoint */
  adminTest: adminProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const [cfg] = await db
        .select()
        .from(webhookConfigs)
        .where(and(eq(webhookConfigs.id, input.id), eq(webhookConfigs.isActive, true)))
        .limit(1);

      if (!cfg) throw new TRPCError({ code: "NOT_FOUND", message: "Active webhook not found" });

      const testPayload = JSON.stringify({
        event: "security_alert",
        timestamp: new Date().toISOString(),
        test: true,
        data: {
          id: 0,
          eventType: "SUSPICIOUS_IP",
          severity: "HIGH",
          status: "OPEN",
          title: "Test Webhook — NEXCOM Security Alert",
          description: "This is a test delivery from the NEXCOM platform to verify your webhook endpoint is reachable.",
          ipAddress: "127.0.0.1",
          userId: null,
          createdAt: new Date().toISOString(),
        },
      });

      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        "X-NEXCOM-Event": "security_alert",
        "X-NEXCOM-Severity": "HIGH",
        "X-NEXCOM-Test": "true",
      };

      if (cfg.secret) {
        const sig = createHmac("sha256", cfg.secret).update(testPayload).digest("hex");
        headers["X-NEXCOM-Signature"] = `sha256=${sig}`;
      }

      let statusCode = 0;
      let success = false;
      let errorMessage: string | null = null;

      try {
        const res = await fetch(cfg.url, {
          method: "POST",
          headers,
          body: testPayload,
          signal: AbortSignal.timeout(10_000),
        });
        statusCode = res.status;
        success = res.ok;
        if (!res.ok) errorMessage = `HTTP ${res.status}: ${res.statusText}`;
      } catch (err) {
        errorMessage = err instanceof Error ? err.message : "Network error";
      }

      // Update last triggered status
      await db
        .update(webhookConfigs)
        .set({
          lastTriggeredAt: new Date(),
          lastStatusCode: statusCode,
          updatedAt: new Date(),
        })
        .where(eq(webhookConfigs.id, cfg.id));

      return { success, statusCode, errorMessage };
    }),
});
