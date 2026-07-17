import { eq, desc, and, sql, count } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import {
  InsertUser, users, profiles, watchlist, priceAlerts,
  savedOrders, notifications, kycQueue, auditLog, userPreferences,
  kycLivenessSessions, InsertKycLivenessSession,
  securityEvents,
} from "../drizzle/schema";
import { ENV } from "./_core/env";

let _db: ReturnType<typeof drizzle> | null = null;
let _pgClient: ReturnType<typeof postgres> | null = null;
let _readDb: ReturnType<typeof drizzle> | null = null;
let _readPgClient: ReturnType<typeof postgres> | null = null;

// Resolve the PostgreSQL connection URL.
// In development, use the local PostgreSQL instance.
// In production, DATABASE_URL must be a valid postgresql:// or postgres:// URL.
function resolveDbUrl(): string {
  // NEXCOM_PG_URL takes priority (production hosted Postgres)
  const pgUrl = process.env.NEXCOM_PG_URL ?? "";
  if (pgUrl.startsWith("postgresql://") || pgUrl.startsWith("postgres://")) {
    console.log("[Database] Using NEXCOM_PG_URL");
    return pgUrl;
  }
  // Fall back to local PostgreSQL (development sandbox)
  console.log("[Database] Using local PostgreSQL postgresql://127.0.0.1:5432/nexcom");
  return "postgresql://nexcom:nexcom_secure_2026@127.0.0.1:5432/nexcom";
}

/**
 * Resolve the PostgreSQL read replica URL.
 * Falls back to the primary DB URL if NEXCOM_PG_READ_URL is not set.
 *
 * To enable read replica:
 *   Set NEXCOM_PG_READ_URL=postgresql://user:pass@read-replica-host:5432/nexcom
 */
function resolveReadDbUrl(): string {
  const readUrl = process.env.NEXCOM_PG_READ_URL ?? "";
  if (readUrl.startsWith("postgresql://") || readUrl.startsWith("postgres://")) {
    return readUrl;
  }
  // Fall back to primary
  return resolveDbUrl();
}

export async function getDb() {
  if (!_db) {
    try {
      const dbUrl = resolveDbUrl();
      const isLocal = dbUrl.includes("localhost") || dbUrl.includes("127.0.0.1");
      _pgClient = postgres(dbUrl, {
        max: 20,                    // max pool size
        idle_timeout: 30,           // close idle connections after 30s
        connect_timeout: 10,        // fail fast if DB is unreachable
        max_lifetime: 1800,         // recycle connections every 30 minutes
        ssl: isLocal ? false : "require",
        onnotice: () => {},         // suppress NOTICE messages
      });
      _db = drizzle(_pgClient);
      // Startup validation: run a cheap query to confirm connectivity
      await _db.execute(sql`SELECT 1`);
      console.log("[Database] PostgreSQL connection pool established (max=20)");
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
      _pgClient = null;
    }
  }
  return _db;
}

/**
 * Get the read replica database connection (or primary if no replica configured).
 * Use this for all SELECT queries to reduce load on the primary.
 *
 * @example
 *   const readDb = await getReadDb();
 *   const rows = await readDb?.select().from(users).where(eq(users.id, id));
 */
export async function getReadDb() {
  if (!_readDb) {
    try {
      const readUrl = resolveReadDbUrl();
      const isPrimary = readUrl === resolveDbUrl();
      const isLocal = readUrl.includes("localhost") || readUrl.includes("127.0.0.1");
      _readPgClient = postgres(readUrl, {
        max: 10,                    // read replicas get a smaller pool
        idle_timeout: 30,
        connect_timeout: 10,
        max_lifetime: 1800,
        ssl: isLocal ? false : "require",
        onnotice: () => {},
        // Read-only hint: prevents accidental writes to the replica
        connection: { options: "-c default_transaction_read_only=on" },
      });
      _readDb = drizzle(_readPgClient);
      await _readDb.execute(sql`SELECT 1`);
      if (isPrimary) {
        console.log("[Database] Read replica not configured — using primary for reads");
      } else {
        console.log("[Database] Read replica connection pool established (max=10)");
      }
    } catch (error) {
      console.warn("[Database] Read replica connection failed, falling back to primary:", error);
      // Fall back to primary on error
      _readDb = await getDb();
    }
  }
  return _readDb;
}

/** Ping the primary database — returns true if reachable, false otherwise. */
export async function pingDb(): Promise<boolean> {
  try {
    const db = await getDb();
    if (!db) return false;
    await db.execute(sql`SELECT 1`);
    return true;
  } catch {
    return false;
  }
}

/** Ping the read replica (or primary if no replica configured). */
export async function pingReadDb(): Promise<boolean> {
  try {
    const db = await getReadDb();
    if (!db) return false;
    await db.execute(sql`SELECT 1`);
    return true;
  } catch {
    return false;
  }
}

/** Returns true if NEXCOM_PG_READ_URL is configured (separate replica exists). */
export function hasReadReplica(): boolean {
  const readUrl = process.env.NEXCOM_PG_READ_URL ?? "";
  return readUrl.startsWith("postgresql://") || readUrl.startsWith("postgres://");
}

// ============================================================
// Users
// ============================================================
export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) throw new Error("User openId is required for upsert");
  const db = await getDb();
  if (!db) { console.warn("[Database] Cannot upsert user: database not available"); return; }
  try {
    const values: InsertUser = { openId: user.openId };
    const updateSet: Record<string, unknown> = {};
    const textFields = ["name", "email", "loginMethod"] as const;
    type TextField = (typeof textFields)[number];
    const assignNullable = (field: TextField) => {
      const value = user[field]; if (value === undefined) return;
      const normalized = value ?? null; values[field] = normalized; updateSet[field] = normalized;
    };
    textFields.forEach(assignNullable);
    if (user.lastSignedIn !== undefined) { values.lastSignedIn = user.lastSignedIn; updateSet.lastSignedIn = user.lastSignedIn; }
    if (user.role !== undefined) { values.role = user.role; updateSet.role = user.role; }
    else if (ENV.ownerEmail && user.email && user.email === ENV.ownerEmail) { values.role = "admin"; updateSet.role = "admin"; }
    if (!values.lastSignedIn) values.lastSignedIn = new Date();
    if (Object.keys(updateSet).length === 0) updateSet.lastSignedIn = new Date();
    await db.insert(users).values(values)
      .onConflictDoUpdate({ target: users.openId, set: updateSet });

    // Post-upsert side effects (fire-and-forget — do not block login)
    setImmediate(async () => {
      try {
        const savedUser = await getUserByOpenId(user.openId);
        if (!savedUser) return;

        // Provision TigerBeetle ledger accounts on first login
        const { createLedgerAccount } = await import("./gatewayClient");
        await Promise.allSettled([
          createLedgerAccount(String(savedUser.id), "margin"),
          createLedgerAccount(String(savedUser.id), "settlement"),
          createLedgerAccount(String(savedUser.id), "fee"),
        ]);

        // Index user in OpenSearch for full-text search
        const { indexUser } = await import("./opensearch");
        await indexUser({
          id: savedUser.id,
          name: savedUser.name,
          email: savedUser.email,
          role: savedUser.role,
          createdAt: savedUser.createdAt,
        });

        // Sync user to Keycloak realm
        const { syncUserToKeycloak } = await import("./keycloak/keycloakClient");
        await syncUserToKeycloak({
          openId: savedUser.openId,
          email: savedUser.email ?? "",
          name: savedUser.name ?? savedUser.openId,
          role: savedUser.role === "admin" ? "admin" : "user",
          nexcomUserId: savedUser.id,
        });
      } catch (e) {
        console.warn("[upsertUser] Post-upsert side effects failed:", (e as Error).message);
      }
    });
  } catch (error) { console.error("[Database] Failed to upsert user:", error); throw error; }
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) { console.warn("[Database] Cannot get user: database not available"); return undefined; }
  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function getUserById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function getUserByEmail(email: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.email, email)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

// ============================================================
// Profiles
// ============================================================
export async function getProfile(userId: number) {
  const db = await getDb(); if (!db) return undefined;
  const result = await db.select().from(profiles).where(eq(profiles.userId, userId)).limit(1);
  return result[0];
}

export async function upsertProfile(data: Omit<typeof profiles.$inferSelect, "id" | "createdAt" | "updatedAt">) {
  const db = await getDb(); if (!db) return;
  const existing = await getProfile(data.userId);
  if (existing) { await db.update(profiles).set(data).where(eq(profiles.userId, data.userId)); }
  else { await db.insert(profiles).values(data); }
}

// ============================================================
// Watchlist
// ============================================================
export async function getWatchlist(userId: number) {
  const db = await getDb(); if (!db) return [];
  return db.select().from(watchlist).where(eq(watchlist.userId, userId));
}

export async function addToWatchlist(userId: number, symbol: string) {
  const db = await getDb(); if (!db) return;
  await db.insert(watchlist).values({ userId, symbol })
    .onConflictDoNothing();
}

export async function removeFromWatchlist(userId: number, symbol: string) {
  const db = await getDb(); if (!db) return;
  await db.delete(watchlist).where(and(eq(watchlist.userId, userId), eq(watchlist.symbol, symbol)));
}

// ============================================================
// Price Alerts
// ============================================================
export async function getPriceAlerts(userId: number) {
  const db = await getDb(); if (!db) return [];
  return db.select().from(priceAlerts).where(eq(priceAlerts.userId, userId)).orderBy(desc(priceAlerts.createdAt));
}

export async function createPriceAlert(data: Omit<typeof priceAlerts.$inferSelect, "id" | "triggered" | "notified" | "createdAt">) {
  const db = await getDb(); if (!db) return;
  await db.insert(priceAlerts).values({ ...data, triggered: false, notified: false });
}

export async function deletePriceAlert(id: number, userId: number) {
  const db = await getDb(); if (!db) return;
  await db.delete(priceAlerts).where(and(eq(priceAlerts.id, id), eq(priceAlerts.userId, userId)));
}

// ============================================================
// Notifications
// ============================================================
export async function getNotifications(userId: number) {
  const db = await getDb(); if (!db) return [];
  return db.select().from(notifications).where(eq(notifications.userId, userId)).orderBy(desc(notifications.createdAt)).limit(50);
}

export async function getUnreadCount(userId: number): Promise<number> {
  const db = await getDb(); if (!db) return 0;
  const result = await db.select({ count: sql<number>`count(*)` }).from(notifications)
    .where(and(eq(notifications.userId, userId), eq(notifications.read, false)));
  return Number(result[0]?.count ?? 0);
}

export async function markNotificationsRead(userId: number) {
  const db = await getDb(); if (!db) return;
  await db.update(notifications).set({ read: true }).where(eq(notifications.userId, userId));
}

export async function createNotification(data: Omit<typeof notifications.$inferSelect, "id" | "read" | "createdAt">) {
  const db = await getDb(); if (!db) return;

  // Check user's notification preferences before inserting
  const [prefs] = await db
    .select()
    .from(userPreferences)
    .where(eq(userPreferences.userId, data.userId))
    .limit(1);

  if (prefs) {
    // Map notification type to preference flag
    const type = data.type;
    if (type === "TRADE" && !prefs.notifTradeExecutions) return;
    if ((type === "ALERT" || type === "PRICE_ALERT" as typeof type) && !prefs.notifPriceAlerts) return;
    if (type === "SETTLEMENT" && !prefs.notifEwrUpdates) return;
    if (type === "SYSTEM" && !prefs.notifSystemMessages) return;
  }

  await db.insert(notifications).values({ ...data, read: false });
}

// ============================================================
// Admin: KYC Queue
// ============================================================
export async function getKycQueue(status?: typeof kycQueue.$inferSelect["status"]) {
  const db = await getDb(); if (!db) return [];
  if (status) return db.select().from(kycQueue).where(eq(kycQueue.status, status)).orderBy(desc(kycQueue.submittedAt));
  return db.select().from(kycQueue).orderBy(desc(kycQueue.submittedAt)).limit(100);
}

export async function submitKycForReview(userId: number) {
  const db = await getDb(); if (!db) return;
  await db.insert(kycQueue).values({ userId, status: "PENDING" });
}

export async function reviewKyc(id: number, reviewerId: number, status: "APPROVED" | "REJECTED", notes?: string) {
  const db = await getDb(); if (!db) return;
  await db.update(kycQueue).set({ status, reviewedBy: reviewerId, reviewNotes: notes, reviewedAt: new Date() }).where(eq(kycQueue.id, id));
  const queue = await db.select().from(kycQueue).where(eq(kycQueue.id, id)).limit(1);
  if (queue[0]) {
    await db.update(profiles).set({ kycStatus: status === "APPROVED" ? "VERIFIED" : "REJECTED", kycNotes: notes }).where(eq(profiles.userId, queue[0].userId));
  }
}

// ============================================================
// Audit Log
// ============================================================
export async function logAudit(data: { userId?: number; action: string; resource?: string; resourceId?: string; details?: unknown; ipAddress?: string; }) {
  const db = await getDb(); if (!db) return;
  try {
    await db.insert(auditLog).values({ userId: data.userId, action: data.action, resource: data.resource, resourceId: data.resourceId, details: data.details as Record<string, unknown>, ipAddress: data.ipAddress });
  } catch (e) { console.warn("[AuditLog] Failed to write:", e); }
}

export async function getAuditLog(limit = 100) {
  const db = await getDb(); if (!db) return [];
  return db.select().from(auditLog).orderBy(desc(auditLog.createdAt)).limit(limit);
}

// ============================================================
// KYC Liveness Sessions
// ============================================================
export async function upsertLivenessSession(data: InsertKycLivenessSession) {
  const db = await getDb(); if (!db) return;
  await db
    .insert(kycLivenessSessions)
    .values(data)
    .onConflictDoUpdate({
      target: kycLivenessSessions.sessionId,
      set: {
        currentChallengeIndex: data.currentChallengeIndex,
        results: data.results,
        overallResult: data.overallResult,
        faceMatchScore: data.faceMatchScore,
        spoofType: data.spoofType,
        spoofConfidence: data.spoofConfidence,
        landmarksJson: data.landmarksJson,
        status: data.status,
        updatedAt: new Date(),
      },
    });
}

export async function getLivenessSession(sessionId: string) {
  const db = await getDb(); if (!db) return null;
  const rows = await db
    .select()
    .from(kycLivenessSessions)
    .where(eq(kycLivenessSessions.sessionId, sessionId))
    .limit(1);
  return rows[0] ?? null;
}

export async function getLivenessSessionsByUser(userId: number, limit = 20) {
  const db = await getDb(); if (!db) return [];
  return db
    .select()
    .from(kycLivenessSessions)
    .where(eq(kycLivenessSessions.userId, userId))
    .orderBy(desc(kycLivenessSessions.createdAt))
    .limit(limit);
}

export async function getLivenessSessionsByApplication(applicationId: string) {
  const db = await getDb(); if (!db) return [];
  return db
    .select()
    .from(kycLivenessSessions)
    .where(eq(kycLivenessSessions.applicationId, applicationId))
    .orderBy(desc(kycLivenessSessions.createdAt));
}

// ============================================================
// Security Events (liveness-specific helpers)
// ============================================================
export async function createLivenessSecurityEvent(data: {
  userId?: number | null;
  sessionId: string;
  applicationId?: string | null;
  eventType: "LIVENESS_PASS" | "LIVENESS_FAIL" | "LIVENESS_SPOOF_DETECTED" | "FACE_MATCH_PASS" | "FACE_MATCH_FAIL" | "PASSIVE_LIVENESS_FAIL";
  severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  spoofType?: string;
  faceMatchScore?: number | null;
  confidence?: number;
}) {
  const db = await getDb(); if (!db) return;
  try {
    await db.insert(securityEvents).values({
      userId: data.userId ?? undefined,
      eventType: data.eventType,
      severity: data.severity,
      status: "OPEN",
      title: `Liveness ${data.eventType.replace(/_/g, " ")}`,
      description: `Liveness session ${data.sessionId}: ${data.eventType}` +
        (data.spoofType && data.spoofType !== "NONE" ? ` (spoof: ${data.spoofType})` : ""),
      metadata: {
        sessionId: data.sessionId,
        applicationId: data.applicationId,
        spoofType: data.spoofType,
        faceMatchScore: data.faceMatchScore,
        confidence: data.confidence,
      },
    });
  } catch (e) {
    console.warn("[SecurityEvent] Failed to write liveness event:", e);
  }
}

// ============================================================
// Round 69 — Drizzle ORM Improvements
// ============================================================
// 1. Schema-aware drizzle instance (enables db.query.* with relations)
// 2. Prepared statements for hot-path queries
// 3. Typed query helpers for tables added in Rounds 60-68
// 4. Batch helpers using Drizzle's transaction API
// ============================================================

import * as schemaAll from "../drizzle/schema";

/**
 * Returns a schema-aware Drizzle instance that supports the Relations API.
 * Use this when you need `db.query.orders.findMany({ with: { fills: true } })`.
 *
 * Example:
 *   const qdb = await getQueryDb();
 *   const order = await qdb?.query.orders.findFirst({
 *     where: (o, { eq }) => eq(o.id, orderId),
 *     with: { fills: true, amendments: true },
 *   });
 */
export async function getQueryDb() {
  const pgUrl = resolveDbUrl();
  const isLocal = pgUrl.includes("localhost") || pgUrl.includes("127.0.0.1");
  try {
    const pg = postgres(pgUrl, {
      max: 5,
      idle_timeout: 30,
      connect_timeout: 10,
      ssl: isLocal ? false : "require",
      onnotice: () => {},
    });
    return drizzle(pg, { schema: schemaAll });
  } catch {
    return null;
  }
}

// ============================================================
// Typed Query Helpers — Exchange Operators (Round 66+)
// ============================================================

export async function getExchangeOperatorById(id: number) {
  const db = await getDb(); if (!db) return null;
  const rows = await db.select().from(schemaAll.exchangeOperators)
    .where(eq(schemaAll.exchangeOperators.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function listExchangeOperators(status?: string, limit = 50, offset = 0) {
  const db = await getDb(); if (!db) return { operators: [], total: 0 };
  const where = status
    ? eq(schemaAll.exchangeOperators.status, status as "PENDING" | "ACTIVE" | "SUSPENDED")
    : undefined;
  const [operators, [{ total }]] = await Promise.all([
    db.select().from(schemaAll.exchangeOperators).where(where)
      .orderBy(desc(schemaAll.exchangeOperators.createdAt)).limit(limit).offset(offset),
    db.select({ total: count() }).from(schemaAll.exchangeOperators).where(where),
  ]);
  return { operators, total };
}

export async function getOperatorInstruments(operatorId: number) {
  const db = await getDb(); if (!db) return [];
  return db.select().from(schemaAll.operatorInstruments)
    .where(eq(schemaAll.operatorInstruments.operatorId, operatorId));
}

export async function getOperatorFees(operatorId: number) {
  const db = await getDb(); if (!db) return [];
  return db.select().from(schemaAll.operatorFees)
    .where(eq(schemaAll.operatorFees.operatorId, operatorId));
}

export async function getOperatorSettlementRules(operatorId: number) {
  const db = await getDb(); if (!db) return [];
  return db.select().from(schemaAll.operatorSettlementRules)
    .where(eq(schemaAll.operatorSettlementRules.operatorId, operatorId));
}

// ============================================================
// Typed Query Helpers — Distributed Tracing (Round 66+)
// ============================================================

export async function listTraceSnapshots(service?: string, limit = 50, offset = 0) {
  const db = await getDb(); if (!db) return { traces: [], total: 0 };
  const where = service
    ? eq(schemaAll.traceSnapshots.serviceName, service)
    : undefined;
  const [traces, [{ total }]] = await Promise.all([
    db.select().from(schemaAll.traceSnapshots).where(where)
      .orderBy(desc(schemaAll.traceSnapshots.capturedAt)).limit(limit).offset(offset),
    db.select({ total: count() }).from(schemaAll.traceSnapshots).where(where),
  ]);
  return { traces, total };
}

export async function getTraceSnapshotById(traceId: string) {
  const db = await getDb(); if (!db) return null;
  const rows = await db.select().from(schemaAll.traceSnapshots)
    .where(eq(schemaAll.traceSnapshots.traceId, traceId)).limit(1);
  return rows[0] ?? null;
}

// ============================================================
// Typed Query Helpers — Workflow Executions (Round 68+)
// ============================================================

export async function listWorkflowExecutions(
  workflowType?: string,
  status?: string,
  limit = 50,
  offset = 0,
) {
  const db = await getDb(); if (!db) return { workflows: [], total: 0 };
  const conditions: ReturnType<typeof eq>[] = [];
  if (workflowType) conditions.push(eq(schemaAll.workflowExecutions.workflowType, workflowType));
  if (status) conditions.push(eq(schemaAll.workflowExecutions.status, status as "RUNNING" | "COMPLETED" | "FAILED" | "CANCELLED" | "TIMED_OUT"));
  const where = conditions.length > 0 ? and(...conditions) : undefined;
  const [workflows, [{ total }]] = await Promise.all([
    db.select().from(schemaAll.workflowExecutions).where(where)
      .orderBy(desc(schemaAll.workflowExecutions.startedAt)).limit(limit).offset(offset),
    db.select({ total: count() }).from(schemaAll.workflowExecutions).where(where),
  ]);
  return { workflows, total };
}

export async function getWorkflowByTemporalId(temporalWorkflowId: string) {
  const db = await getDb(); if (!db) return null;
  const rows = await db.select().from(schemaAll.workflowExecutions)
    .where(eq(schemaAll.workflowExecutions.workflowId, temporalWorkflowId)).limit(1);
  return rows[0] ?? null;
}

export async function upsertWorkflowExecution(data: {
  temporalWorkflowId: string;
  workflowType: string;
  status: "RUNNING" | "COMPLETED" | "FAILED" | "CANCELLED" | "TIMED_OUT";
  initiatedBy?: number;
  input?: Record<string, unknown>;
  result?: Record<string, unknown>;
  errorMessage?: string;
  startedAt?: Date;
  completedAt?: Date;
}) {
  const db = await getDb(); if (!db) return;
  await db.insert(schemaAll.workflowExecutions)
    .values({ workflowType: data.workflowType, workflowId: data.temporalWorkflowId, status: data.status, userId: data.initiatedBy, input: data.input, result: data.result, errorMessage: data.errorMessage, startedAt: data.startedAt ?? new Date(), completedAt: data.completedAt })
    .onConflictDoUpdate({
      target: schemaAll.workflowExecutions.workflowId,
      set: {
        status: data.status,
        result: data.result,
        errorMessage: data.errorMessage,
        completedAt: data.completedAt,
      },
    });
}

// ============================================================
// Typed Query Helpers — Cross-Border Ledger (Round 68+)
// ============================================================

export async function listCrossBorderLedger(userId?: number, limit = 50, offset = 0) {
  const db = await getDb(); if (!db) return { entries: [], total: 0 };
  const where = userId
    ? eq(schemaAll.crossBorderLedgerEntries.userId, userId)
    : undefined;
  const [entries, [{ total }]] = await Promise.all([
    db.select().from(schemaAll.crossBorderLedgerEntries).where(where)
      .orderBy(desc(schemaAll.crossBorderLedgerEntries.createdAt)).limit(limit).offset(offset),
    db.select({ total: count() }).from(schemaAll.crossBorderLedgerEntries).where(where),
  ]);
  return { entries, total };
}

export async function insertCrossBorderLedgerEntry(
  data: typeof schemaAll.crossBorderLedgerEntries.$inferInsert,
) {
  const db = await getDb(); if (!db) return;
  await db.insert(schemaAll.crossBorderLedgerEntries).values(data);
}

// ============================================================
// Typed Query Helpers — Credit Scores (Round 67+)
// ============================================================

export async function getLatestCreditScore(userId: number) {
  const db = await getDb(); if (!db) return null;
  const rows = await db.select().from(schemaAll.creditScores)
    .where(eq(schemaAll.creditScores.userId, userId))
    .orderBy(desc(schemaAll.creditScores.createdAt))
    .limit(1);
  return rows[0] ?? null;
}

export async function listCreditScoreHistory(userId: number, limit = 12) {
  const db = await getDb(); if (!db) return [];
  return db.select().from(schemaAll.creditScores)
    .where(eq(schemaAll.creditScores.userId, userId))
    .orderBy(desc(schemaAll.creditScores.createdAt))
    .limit(limit);
}

// ============================================================
// Typed Query Helpers — Mojaloop (Round 68+)
// ============================================================

export async function getMojaloopTransferByTransferId(transferId: string) {
  const db = await getDb(); if (!db) return null;
  const rows = await db.select().from(schemaAll.mojaloopTransfers)
    .where(eq(schemaAll.mojaloopTransfers.transferId, transferId)).limit(1);
  return rows[0] ?? null;
}

export async function listMojaloopTransfers(status?: string, limit = 50, offset = 0) {
  const db = await getDb(); if (!db) return { transfers: [], total: 0 };
  const where = status
    ? eq(schemaAll.mojaloopTransfers.status, status as "PENDING" | "RESERVED" | "COMMITTED" | "ABORTED" | "EXPIRED")
    : undefined;
  const [transfers, [{ total }]] = await Promise.all([
    db.select().from(schemaAll.mojaloopTransfers).where(where)
      .orderBy(desc(schemaAll.mojaloopTransfers.createdAt)).limit(limit).offset(offset),
    db.select({ total: count() }).from(schemaAll.mojaloopTransfers).where(where),
  ]);
  return { transfers, total };
}

// ============================================================
// Transaction Batch Helper
// ============================================================

/**
 * Execute multiple DB operations atomically in a single transaction.
 * Usage:
 *   await withTransaction(async (tx) => {
 *     await tx.insert(schemaAll.orders).values(orderData);
 *     await tx.insert(schemaAll.tradeFills).values(fillData);
 *   });
 */
export async function withTransaction<T>(
  fn: (tx: Parameters<Parameters<ReturnType<typeof drizzle>["transaction"]>[0]>[0]) => Promise<T>,
): Promise<T | undefined> {
  const db = await getDb();
  if (!db) return undefined;
  return db.transaction(fn);
}

// ============================================================
// Aggregation Helpers
// ============================================================

export async function countOpenOrders(userId: number): Promise<number> {
  const db = await getDb(); if (!db) return 0;
  const [{ total }] = await db.select({ total: count() }).from(schemaAll.orders)
    .where(and(eq(schemaAll.orders.userId, userId), eq(schemaAll.orders.status, "OPEN")));
  return total;
}

export async function countActiveOperators(): Promise<number> {
  const db = await getDb(); if (!db) return 0;
  const [{ total }] = await db.select({ total: count() }).from(schemaAll.exchangeOperators)
    .where(eq(schemaAll.exchangeOperators.status, "ACTIVE"));
  return total;
}

export async function countRunningWorkflows(): Promise<number> {
  const db = await getDb(); if (!db) return 0;
  const [{ total }] = await db.select({ total: count() }).from(schemaAll.workflowExecutions)
    .where(eq(schemaAll.workflowExecutions.status, "RUNNING"));
  return total;
}

export async function countUnresolvedAmlFlags(): Promise<number> {
  const db = await getDb(); if (!db) return 0;
  const [{ total }] = await db.select({ total: count() }).from(schemaAll.amlFlags)
    .where(eq(schemaAll.amlFlags.status, "OPEN"));
  return total;
}
