/**
 * NEXCOM Exchange — Policy-Based Access Control (PBAC) Engine
 * ============================================================
 * Full PBAC implementation with:
 *
 *  1. Policy Store         — in-memory + DB-backed policy registry
 *  2. Resource-Action-Condition model — fine-grained permission control
 *  3. Policy Evaluation    — allow/deny with condition evaluation
 *  4. Attribute-Based      — user attributes, resource attributes, environment
 *  5. Policy Inheritance   — role-based policy sets with overrides
 *  6. Audit Logging        — every access decision is logged
 *  7. tRPC Integration     — `pbacProcedure` middleware for route protection
 *
 * Policy Structure:
 *   {
 *     id: string,
 *     effect: "allow" | "deny",
 *     principals: string[],    // user IDs, roles ("role:admin"), or "*"
 *     resources: string[],     // resource patterns ("order:*", "user:123")
 *     actions: string[],       // action patterns ("read", "write", "delete", "*")
 *     conditions?: PolicyCondition[]  // optional attribute conditions
 *   }
 *
 * Usage in tRPC procedures:
 *   export const orderRouter = router({
 *     cancel: pbacProcedure("order", "cancel")
 *       .input(z.object({ orderId: z.string() }))
 *       .mutation(async ({ ctx, input }) => { ... })
 *   })
 */

import { TRPCError } from "@trpc/server";
import { protectedProcedure } from "./_core/trpc";
import type { Context } from "./_core/context";
import { getDb } from "./db";
import { pbacPolicies } from "../drizzle/schema";
import { eq } from "drizzle-orm";

// ── Policy Types ──────────────────────────────────────────────────────────────

export type PolicyEffect = "allow" | "deny";

export interface PolicyCondition {
  attribute: string;        // e.g., "user.role", "resource.ownerId", "env.timeOfDay"
  operator: "eq" | "neq" | "in" | "nin" | "gt" | "lt" | "gte" | "lte" | "matches";
  value: unknown;
}

export interface Policy {
  id: string;
  name: string;
  description?: string;
  effect: PolicyEffect;
  principals: string[];     // user IDs, "role:admin", "role:user", "*"
  resources: string[];      // "order:*", "user:123", "*"
  actions: string[];        // "read", "write", "delete", "cancel", "*"
  conditions?: PolicyCondition[];
  priority: number;         // higher = evaluated first; deny policies should have high priority
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface AccessRequest {
  principal: {
    id: string;
    role: string;
    attributes?: Record<string, unknown>;
  };
  resource: {
    type: string;
    id?: string;
    attributes?: Record<string, unknown>;
  };
  action: string;
  environment?: {
    ipAddress?: string;
    timestamp?: Date;
    [key: string]: unknown;
  };
}

export interface AccessDecision {
  allowed: boolean;
  effect: PolicyEffect | "default_deny";
  matchedPolicyId?: string;
  matchedPolicyName?: string;
  reason: string;
  evaluatedPolicies: number;
  timestamp: Date;
}

export interface AuditEntry {
  id: string;
  timestamp: Date;
  request: AccessRequest;
  decision: AccessDecision;
}

// ── Built-in Default Policies ─────────────────────────────────────────────────

const DEFAULT_POLICIES: Policy[] = [
  // ── Owner: full access to everything
  {
    id: "policy-owner-full-access",
    name: "Owner Full Access",
    description: "Platform owner has unrestricted access to all resources and actions",
    effect: "allow",
    principals: ["role:owner"],
    resources: ["*"],
    actions: ["*"],
    priority: 1000,
    enabled: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  },

  // ── Admin: full access except owner-only operations
  {
    id: "policy-admin-full-access",
    name: "Admin Full Access",
    description: "Admins have full access to all resources except owner-only operations",
    effect: "allow",
    principals: ["role:admin"],
    resources: ["*"],
    actions: ["read", "write", "delete", "create", "update", "approve", "reject", "suspend", "activate"],
    priority: 900,
    enabled: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  },

  // ── User: read own profile
  {
    id: "policy-user-read-own-profile",
    name: "User Read Own Profile",
    description: "Users can read their own profile",
    effect: "allow",
    principals: ["role:user"],
    resources: ["profile:*"],
    actions: ["read"],
    conditions: [{ attribute: "resource.ownerId", operator: "eq", value: "{{principal.id}}" }],
    priority: 500,
    enabled: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  },

  // ── User: manage own orders
  {
    id: "policy-user-manage-own-orders",
    name: "User Manage Own Orders",
    description: "Users can create, read, and cancel their own orders",
    effect: "allow",
    principals: ["role:user"],
    resources: ["order:*"],
    actions: ["create", "read", "cancel"],
    conditions: [{ attribute: "resource.ownerId", operator: "eq", value: "{{principal.id}}" }],
    priority: 500,
    enabled: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  },

  // ── User: read market data (public)
  {
    id: "policy-user-read-market-data",
    name: "User Read Market Data",
    description: "All authenticated users can read market data",
    effect: "allow",
    principals: ["role:user", "role:admin"],
    resources: ["market:*", "price:*", "instrument:*"],
    actions: ["read"],
    priority: 400,
    enabled: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  },

  // ── User: manage own portfolio
  {
    id: "policy-user-manage-own-portfolio",
    name: "User Manage Own Portfolio",
    description: "Users can read and update their own portfolio",
    effect: "allow",
    principals: ["role:user"],
    resources: ["portfolio:*"],
    actions: ["read", "update"],
    conditions: [{ attribute: "resource.ownerId", operator: "eq", value: "{{principal.id}}" }],
    priority: 500,
    enabled: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  },

  // ── User: initiate own transactions
  {
    id: "policy-user-own-transactions",
    name: "User Own Transactions",
    description: "Users can create and read their own transactions",
    effect: "allow",
    principals: ["role:user"],
    resources: ["transaction:*"],
    actions: ["create", "read"],
    conditions: [{ attribute: "resource.ownerId", operator: "eq", value: "{{principal.id}}" }],
    priority: 500,
    enabled: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  },

  // ── DENY: Users cannot access admin resources
  {
    id: "policy-deny-user-admin-resources",
    name: "Deny User Admin Resources",
    description: "Regular users cannot access admin-only resources",
    effect: "deny",
    principals: ["role:user"],
    resources: ["admin:*", "kyc:*", "aml:*", "compliance:*", "audit:*"],
    actions: ["*"],
    priority: 800,
    enabled: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  },

  // ── DENY: Block suspended users
  {
    id: "policy-deny-suspended-users",
    name: "Deny Suspended Users",
    description: "Suspended users cannot perform any write operations",
    effect: "deny",
    principals: ["role:user"],
    resources: ["*"],
    actions: ["write", "create", "update", "delete", "cancel", "trade"],
    conditions: [{ attribute: "user.status", operator: "eq", value: "suspended" }],
    priority: 950,
    enabled: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  },

  // ── DENY: Block unverified users from trading
  {
    id: "policy-deny-unverified-trading",
    name: "Deny Unverified User Trading",
    description: "Users without KYC verification cannot trade",
    effect: "deny",
    principals: ["role:user"],
    resources: ["order:*", "trade:*"],
    actions: ["create", "trade"],
    conditions: [{ attribute: "user.kycStatus", operator: "neq", value: "approved" }],
    priority: 850,
    enabled: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  },

  // ── Farmer: warehouse and produce management
  {
    id: "policy-farmer-warehouse-access",
    name: "Farmer Warehouse Access",
    description: "Farmers can manage their own warehouse receipts and produce listings",
    effect: "allow",
    principals: ["role:farmer"],
    resources: ["warehouse:*", "produce:*", "receipt:*"],
    actions: ["create", "read", "update"],
    conditions: [{ attribute: "resource.ownerId", operator: "eq", value: "{{principal.id}}" }],
    priority: 500,
    enabled: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  },

  // ── Broker: extended trading access
  {
    id: "policy-broker-trading-access",
    name: "Broker Extended Trading Access",
    description: "Brokers can trade on behalf of clients and access extended market data",
    effect: "allow",
    principals: ["role:broker"],
    resources: ["order:*", "trade:*", "market:*", "client:*"],
    actions: ["create", "read", "update", "cancel", "trade"],
    priority: 600,
    enabled: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  },
];

// ── Policy Store ──────────────────────────────────────────────────────────────

class PolicyStore {
  private policies: Map<string, Policy> = new Map();
  private auditLog: AuditEntry[] = [];
  private maxAuditEntries = 10000;

  constructor() {
    // Load default policies into memory; DB policies are loaded async via loadFromDb()
    for (const policy of DEFAULT_POLICIES) {
      this.policies.set(policy.id, policy);
    }
  }

  /** Load persisted policies from the database, merging with defaults. */
  async loadFromDb(): Promise<void> {
    try {
      const db = await getDb();
      if (!db) return;
      const rows = await db.select().from(pbacPolicies);
      for (const row of rows) {
        const policy: Policy = {
          id: row.id,
          name: row.name,
          description: row.description ?? undefined,
          effect: row.effect as "allow" | "deny",
          principals: (row.principals as string[]) ?? [],
          resources: (row.resources as string[]) ?? [],
          actions: (row.actions as string[]) ?? [],
          conditions: (row.conditions as PolicyCondition[] | undefined) ?? undefined,
          priority: row.priority,
          enabled: row.enabled,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
        };
        this.policies.set(policy.id, policy);
      }
    } catch {
      // Non-fatal: in-memory defaults remain active
    }
  }

  /** Persist a policy to the database. */
  private async persistPolicy(policy: Policy): Promise<void> {
    try {
      const db = await getDb();
      if (!db) return;
      await db.insert(pbacPolicies).values({
        id: policy.id,
        name: policy.name,
        description: policy.description ?? null,
        effect: policy.effect,
        principals: policy.principals,
        resources: policy.resources,
        actions: policy.actions,
        conditions: policy.conditions ?? null,
        priority: policy.priority,
        enabled: policy.enabled,
        createdAt: policy.createdAt,
        updatedAt: policy.updatedAt,
      }).onConflictDoUpdate({
        target: pbacPolicies.id,
        set: {
          name: policy.name,
          description: policy.description ?? null,
          effect: policy.effect,
          principals: policy.principals,
          resources: policy.resources,
          actions: policy.actions,
          conditions: policy.conditions ?? null,
          priority: policy.priority,
          enabled: policy.enabled,
          updatedAt: new Date(),
        },
      });
    } catch {
      // Non-fatal: in-memory store is the source of truth
    }
  }

  addPolicy(policy: Policy): void {
    const p = { ...policy, updatedAt: new Date() };
    this.policies.set(policy.id, p);
    void this.persistPolicy(p);
  }

  removePolicy(id: string): boolean {
    const deleted = this.policies.delete(id);
    if (deleted) {
      void (async () => {
        try {
          const db = await getDb();
          if (db) await db.delete(pbacPolicies).where(eq(pbacPolicies.id, id));
        } catch { /* non-fatal */ }
      })();
    }
    return deleted;
  }

  updatePolicy(id: string, updates: Partial<Policy>): Policy | null {
    const existing = this.policies.get(id);
    if (!existing) return null;
    const updated = { ...existing, ...updates, id, updatedAt: new Date() };
    this.policies.set(id, updated);
    void this.persistPolicy(updated);
    return updated;
  }

  getPolicy(id: string): Policy | undefined {
    return this.policies.get(id);
  }

  getAllPolicies(): Policy[] {
    return Array.from(this.policies.values()).sort((a, b) => b.priority - a.priority);
  }

  getEnabledPolicies(): Policy[] {
    return this.getAllPolicies().filter(p => p.enabled);
  }

  addAuditEntry(entry: AuditEntry): void {
    this.auditLog.unshift(entry);
    if (this.auditLog.length > this.maxAuditEntries) {
      this.auditLog.length = this.maxAuditEntries;
    }
  }

  getAuditLog(limit = 100): AuditEntry[] {
    return this.auditLog.slice(0, limit);
  }
}

export const policyStore = new PolicyStore();

// ── Pattern Matching ──────────────────────────────────────────────────────────

function matchesPattern(value: string, pattern: string): boolean {
  if (pattern === "*") return true;
  if (pattern === value) return true;
  // Support wildcard patterns like "order:*", "user:123:*"
  if (pattern.endsWith(":*")) {
    const prefix = pattern.slice(0, -1); // "order:"
    return value.startsWith(prefix);
  }
  if (pattern.includes("*")) {
    const regex = new RegExp("^" + pattern.replace(/\*/g, ".*") + "$");
    return regex.test(value);
  }
  return false;
}

function matchesPrincipal(request: AccessRequest, principal: string): boolean {
  if (principal === "*") return true;
  if (principal.startsWith("role:")) {
    const role = principal.slice(5);
    return request.principal.role === role;
  }
  return request.principal.id === principal;
}

function matchesResource(request: AccessRequest, resourcePattern: string): boolean {
  const resourceKey = request.resource.id
    ? `${request.resource.type}:${request.resource.id}`
    : request.resource.type;
  return matchesPattern(resourceKey, resourcePattern) || matchesPattern(request.resource.type, resourcePattern);
}

function matchesAction(action: string, actionPattern: string): boolean {
  return matchesPattern(action, actionPattern);
}

// ── Condition Evaluation ──────────────────────────────────────────────────────

function resolveAttribute(attribute: string, request: AccessRequest): unknown {
  const parts = attribute.split(".");
  let obj: Record<string, unknown> = {
    user: { ...request.principal, ...request.principal.attributes },
    resource: { ...request.resource, ...request.resource.attributes },
    env: request.environment ?? {},
    principal: request.principal,
  };
  for (const part of parts) {
    if (obj === null || obj === undefined) return undefined;
    obj = obj[part] as Record<string, unknown>;
  }
  return obj;
}

function resolveValue(value: unknown, request: AccessRequest): unknown {
  if (typeof value === "string" && value.startsWith("{{") && value.endsWith("}}")) {
    const attribute = value.slice(2, -2);
    return resolveAttribute(attribute, request);
  }
  return value;
}

function evaluateCondition(condition: PolicyCondition, request: AccessRequest): boolean {
  const attrValue = resolveAttribute(condition.attribute, request);
  const condValue = resolveValue(condition.value, request);

  switch (condition.operator) {
    case "eq": return attrValue === condValue;
    case "neq": return attrValue !== condValue;
    case "in": return Array.isArray(condValue) && condValue.includes(attrValue);
    case "nin": return Array.isArray(condValue) && !condValue.includes(attrValue);
    case "gt": return typeof attrValue === "number" && typeof condValue === "number" && attrValue > condValue;
    case "lt": return typeof attrValue === "number" && typeof condValue === "number" && attrValue < condValue;
    case "gte": return typeof attrValue === "number" && typeof condValue === "number" && attrValue >= condValue;
    case "lte": return typeof attrValue === "number" && typeof condValue === "number" && attrValue <= condValue;
    case "matches":
      return typeof attrValue === "string" && typeof condValue === "string" && new RegExp(condValue).test(attrValue);
    default: return false;
  }
}

function evaluateConditions(conditions: PolicyCondition[] | undefined, request: AccessRequest): boolean {
  if (!conditions || conditions.length === 0) return true;
  return conditions.every(c => evaluateCondition(c, request));
}

// ── Policy Evaluation Engine ──────────────────────────────────────────────────

export function evaluate(request: AccessRequest): AccessDecision {
  const policies = policyStore.getEnabledPolicies(); // sorted by priority desc
  let evaluatedCount = 0;

  for (const policy of policies) {
    evaluatedCount++;

    // Check if any principal matches
    const principalMatch = policy.principals.some(p => matchesPrincipal(request, p));
    if (!principalMatch) continue;

    // Check if any resource matches
    const resourceMatch = policy.resources.some(r => matchesResource(request, r));
    if (!resourceMatch) continue;

    // Check if any action matches
    const actionMatch = policy.actions.some(a => matchesAction(request.action, a));
    if (!actionMatch) continue;

    // Evaluate conditions
    const conditionsMatch = evaluateConditions(policy.conditions, request);
    if (!conditionsMatch) continue;

    // Policy matches — return decision
    const decision: AccessDecision = {
      allowed: policy.effect === "allow",
      effect: policy.effect,
      matchedPolicyId: policy.id,
      matchedPolicyName: policy.name,
      reason: `Policy "${policy.name}" ${policy.effect}s access`,
      evaluatedPolicies: evaluatedCount,
      timestamp: new Date(),
    };

    // Audit log
    const auditEntry: AuditEntry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      timestamp: new Date(),
      request,
      decision,
    };
    policyStore.addAuditEntry(auditEntry);

    return decision;
  }

  // Default deny — no policy matched
  const defaultDecision: AccessDecision = {
    allowed: false,
    effect: "default_deny",
    reason: "No matching policy found — default deny",
    evaluatedPolicies: evaluatedCount,
    timestamp: new Date(),
  };

  policyStore.addAuditEntry({
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    timestamp: new Date(),
    request,
    decision: defaultDecision,
  });

  return defaultDecision;
}

// ── tRPC Middleware ───────────────────────────────────────────────────────────

/**
 * Create a PBAC-protected tRPC procedure.
 *
 * Usage:
 *   export const orderRouter = router({
 *     cancel: pbacProcedure("order", "cancel")
 *       .input(z.object({ orderId: z.string() }))
 *       .mutation(async ({ ctx, input }) => { ... })
 *   })
 *
 * The resource ID can be injected dynamically by passing a resolver:
 *   pbacProcedure("order", "cancel", (ctx, input) => input.orderId)
 */
export function pbacProcedure(
  resourceType: string,
  action: string,
  resourceIdResolver?: (ctx: Context, input: unknown) => string | undefined,
  resourceAttributesResolver?: (ctx: Context, input: unknown) => Record<string, unknown> | undefined,
) {
  return protectedProcedure.use(async ({ ctx, next, input }) => {
    const user = ctx.user;
    const resourceId = resourceIdResolver ? resourceIdResolver(ctx, input) : undefined;
    const resourceAttributes = resourceAttributesResolver ? resourceAttributesResolver(ctx, input) : undefined;

    const request: AccessRequest = {
      principal: {
        id: String(user.id),
        role: user.role ?? "user",
        attributes: {
          kycStatus: (user as Record<string, unknown>).kycStatus ?? "unknown",
          status: (user as Record<string, unknown>).status ?? "active",
        },
      },
      resource: {
        type: resourceType,
        id: resourceId,
        attributes: resourceAttributes,
      },
      action,
      environment: {
        timestamp: new Date(),
      },
    };

    const decision = evaluate(request);

    if (!decision.allowed) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: `Access denied: ${decision.reason}`,
      });
    }

    return next({ ctx });
  });
}

// ── Policy Management Helpers ─────────────────────────────────────────────────

export function createPolicy(
  id: string,
  name: string,
  effect: PolicyEffect,
  principals: string[],
  resources: string[],
  actions: string[],
  options?: {
    conditions?: PolicyCondition[];
    priority?: number;
    description?: string;
  }
): Policy {
  const policy: Policy = {
    id,
    name,
    description: options?.description,
    effect,
    principals,
    resources,
    actions,
    conditions: options?.conditions,
    priority: options?.priority ?? 500,
    enabled: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  policyStore.addPolicy(policy);
  return policy;
}

export function checkAccess(
  userId: string,
  userRole: string,
  resourceType: string,
  action: string,
  options?: {
    resourceId?: string;
    userAttributes?: Record<string, unknown>;
    resourceAttributes?: Record<string, unknown>;
  }
): boolean {
  const request: AccessRequest = {
    principal: { id: userId, role: userRole, attributes: options?.userAttributes },
    resource: { type: resourceType, id: options?.resourceId, attributes: options?.resourceAttributes },
    action,
  };
  return evaluate(request).allowed;
}

// ── Export Summary ────────────────────────────────────────────────────────────

export const pbac = {
  evaluate,
  checkAccess,
  createPolicy,
  policyStore,
  pbacProcedure,
};

export default pbac;
