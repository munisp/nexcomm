/**
 * PBAC Admin Router
 * Exposes policy management and access decision endpoints via tRPC.
 * Admin-only: all procedures require admin role.
 */
import { z } from "zod";
import { router, protectedProcedure } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import { policyStore, evaluate, createPolicy } from "../pbac";
import type { PolicyCondition } from "../pbac";
import { writeAuditLog } from "../audit";

const adminProcedure = protectedProcedure.use(({ ctx, next }) => {
  if (ctx.user.role !== "admin" && ctx.user.role !== "owner") {
    throw new TRPCError({ code: "FORBIDDEN", message: "Admin access required" });
  }
  return next({ ctx });
});

const PolicyConditionSchema = z.object({
  attribute: z.string().trim().min(1),
  operator: z.enum(["eq", "neq", "in", "nin", "gt", "lt", "gte", "lte", "matches"]),
  value: z.unknown(),
});

const PolicyInputSchema = z.object({
  id: z.string().trim().min(1),
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(500).optional(),
  effect: z.enum(["allow", "deny"]),
  principals: z.array(z.string().trim().min(1)).min(1),
  resources: z.array(z.string().trim().min(1)).min(1),
  actions: z.array(z.string().trim().min(1)).min(1),
  conditions: z.array(PolicyConditionSchema).optional(),
  priority: z.number().int().min(0).max(1000).default(500),
});

export const pbacRouter = router({
  // ── List all policies ────────────────────────────────────────────────────
  listPolicies: adminProcedure
    .input(z.object({
      enabled: z.boolean().optional(),
      effect: z.enum(["allow", "deny"]).optional(),
    }).optional())
    .query(({ input }) => {
      let policies = policyStore.getAllPolicies();
      if (input?.enabled !== undefined) {
        policies = policies.filter(p => p.enabled === input.enabled);
      }
      if (input?.effect) {
        policies = policies.filter(p => p.effect === input.effect);
      }
      return { policies, total: policies.length };
    }),

  // ── Get single policy ────────────────────────────────────────────────────
  getPolicy: adminProcedure
    .input(z.object({ id: z.string().trim().min(1) }))
    .query(({ input }) => {
      const policy = policyStore.getPolicy(input.id);
      if (!policy) throw new TRPCError({ code: "NOT_FOUND", message: "Policy not found" });
      return policy;
    }),

  // ── Create policy ────────────────────────────────────────────────────────
  createPolicy: adminProcedure
    .input(PolicyInputSchema)
    .mutation(({ input }) => {
      const existing = policyStore.getPolicy(input.id);
      if (existing) {
        throw new TRPCError({ code: "CONFLICT", message: `Policy with ID '${input.id}' already exists` });
      }
      const policy = createPolicy(
        input.id,
        input.name,
        input.effect,
        input.principals,
        input.resources,
        input.actions,
        {
          conditions: input.conditions as PolicyCondition[] | undefined,
          priority: input.priority,
          description: input.description,
        }
      );
      return { success: true, policy };
    }),

  // ── Update policy ────────────────────────────────────────────────────────
  updatePolicy: adminProcedure
    .input(PolicyInputSchema.partial().extend({ id: z.string().trim().min(1) }))
    .mutation(({ input }) => {
      const { id, ...updates } = input;
      const updated = policyStore.updatePolicy(id, updates as Parameters<typeof policyStore.updatePolicy>[1]);
      if (!updated) throw new TRPCError({ code: "NOT_FOUND", message: "Policy not found" });
      return { success: true, policy: updated };
    }),

  // ── Enable/disable policy ────────────────────────────────────────────────
  togglePolicy: adminProcedure
    .input(z.object({
      id: z.string().trim().min(1),
      enabled: z.boolean(),
    }))
    .mutation(({ input }) => {
      const updated = policyStore.updatePolicy(input.id, { enabled: input.enabled });
      if (!updated) throw new TRPCError({ code: "NOT_FOUND", message: "Policy not found" });
      return { success: true, policy: updated };
    }),

  // ── Delete policy ────────────────────────────────────────────────────────
  deletePolicy: adminProcedure
    .input(z.object({ id: z.string().trim().min(1) }))
    .mutation(({ input }) => {
      // Protect built-in policies from deletion
      if (input.id.startsWith("policy-owner-") || input.id.startsWith("policy-deny-suspended")) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Cannot delete built-in system policies" });
      }
      const deleted = policyStore.removePolicy(input.id);
      if (!deleted) throw new TRPCError({ code: "NOT_FOUND", message: "Policy not found" });
      return { success: true };
    }),

  // ── Evaluate access request (dry-run) ────────────────────────────────────
  evaluateAccess: adminProcedure
    .input(z.object({
      principal: z.object({
        id: z.string().trim().min(1),
        role: z.string().trim().min(1),
        attributes: z.record(z.string(), z.unknown()).optional(),
      }),
      resource: z.object({
        type: z.string().trim().min(1),
        id: z.string().trim().optional(),
        attributes: z.record(z.string(), z.unknown()).optional(),
      }),
      action: z.string().trim().min(1),
      environment: z.record(z.string(), z.unknown()).optional(),
    }))
    .mutation(({ input }) => {
      const decision = evaluate(input);
      return decision;
    }),

  // ── Get PBAC audit log ────────────────────────────────────────────────────
  getAuditLog: adminProcedure
    .input(z.object({
      limit: z.number().int().min(1).max(1000).default(100),
    }).optional())
    .query(({ input }) => {
      const entries = policyStore.getAuditLog(input?.limit ?? 100);
      return { entries, total: entries.length };
    }),

  // ── Get PBAC statistics ───────────────────────────────────────────────────
  getStats: adminProcedure
    .query(() => {
      const all = policyStore.getAllPolicies();
      const enabled = all.filter(p => p.enabled);
      const allowPolicies = enabled.filter(p => p.effect === "allow");
      const denyPolicies = enabled.filter(p => p.effect === "deny");
      const auditLog = policyStore.getAuditLog(1000);
      const allowedCount = auditLog.filter(e => e.decision.allowed).length;
      const deniedCount = auditLog.filter(e => !e.decision.allowed).length;
      const defaultDenyCount = auditLog.filter(e => e.decision.effect === "default_deny").length;

      return {
        totalPolicies: all.length,
        enabledPolicies: enabled.length,
        disabledPolicies: all.length - enabled.length,
        allowPolicies: allowPolicies.length,
        denyPolicies: denyPolicies.length,
        recentDecisions: {
          total: auditLog.length,
          allowed: allowedCount,
          denied: deniedCount,
          defaultDenied: defaultDenyCount,
          allowRate: auditLog.length > 0 ? Math.round((allowedCount / auditLog.length) * 100) : 0,
        },
      };
    }),

  // ── Check own access (any authenticated user) ────────────────────────────
  checkMyAccess: protectedProcedure
    .input(z.object({
      resourceType: z.string().trim().min(1),
      action: z.string().trim().min(1),
      resourceId: z.string().trim().optional(),
    }))
    .query(({ ctx, input }) => {
      const decision = evaluate({
        principal: {
          id: String(ctx.user.id),
          role: ctx.user.role ?? "user",
        },
        resource: {
          type: input.resourceType,
          id: input.resourceId,
        },
        action: input.action,
      });
      return {
        allowed: decision.allowed,
        reason: decision.reason,
        matchedPolicy: decision.matchedPolicyName,
      };
    }),
});
