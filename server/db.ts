import { eq, desc, and, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import {
  InsertUser, users, profiles, watchlist, priceAlerts,
  savedOrders, notifications, kycQueue, auditLog, userPreferences,
} from "../drizzle/schema";
import { ENV } from "./_core/env";

let _db: ReturnType<typeof drizzle> | null = null;

// Resolve the PostgreSQL connection URL.
// In development, use the local PostgreSQL instance.
// In production, DATABASE_URL must be a valid postgresql:// or postgres:// URL.
function resolveDbUrl(): string {
  if (process.env.NODE_ENV === "development") {
    console.log("[Database] Development mode: using local PostgreSQL postgresql://localhost:5432/nexcom");
    return "postgresql://nexcom:nexcom_secure_2026@localhost:5432/nexcom";
  }
  const url = process.env.DATABASE_URL ?? "";
  if (url.startsWith("postgresql://") || url.startsWith("postgres://")) {
    return url;
  }
  // DATABASE_URL must be a PostgreSQL URL (postgresql:// or postgres://)
  throw new Error(`[Database] Invalid DATABASE_URL: must start with postgresql:// or postgres://. Got: ${url.substring(0, 30)}...`);
}

export async function getDb() {
  if (!_db) {
    try {
      const dbUrl = resolveDbUrl();
      const isLocal = dbUrl.includes("localhost") || dbUrl.includes("127.0.0.1");
      const client = postgres(dbUrl, { max: 10, ssl: isLocal ? false : "require" });
      _db = drizzle(client);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
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
    else if (user.openId === ENV.ownerOpenId) { values.role = "admin"; updateSet.role = "admin"; }
    if (!values.lastSignedIn) values.lastSignedIn = new Date();
    if (Object.keys(updateSet).length === 0) updateSet.lastSignedIn = new Date();
    await db.insert(users).values(values)
      .onConflictDoUpdate({ target: users.openId, set: updateSet });
  } catch (error) { console.error("[Database] Failed to upsert user:", error); throw error; }
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) { console.warn("[Database] Cannot get user: database not available"); return undefined; }
  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
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
