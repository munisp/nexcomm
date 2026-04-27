/**
 * NEXCOM Exchange — Audit Log Helper
 * ─────────────────────────────────────────────────────────────────────────────
 * Centralised helper for writing to the audit_log table.
 * Import and call `writeAuditLog()` from any tRPC procedure that mutates data.
 *
 * Usage:
 *   import { writeAuditLog } from "../audit";
 *   await writeAuditLog({
 *     userId: ctx.user.id,
 *     action: "order.create",
 *     resource: "orders",
 *     resourceId: String(order.id),
 *     details: { symbol, side, quantity, price },
 *     ipAddress: ctx.req.ip,
 *   });
 */

import { getDb } from "./db";
import { auditLog } from "../drizzle/schema";

export interface AuditEntry {
  userId?: number | null;
  action: string;
  resource?: string;
  resourceId?: string;
  details?: Record<string, unknown>;
  ipAddress?: string;
}

/**
 * Write a single audit log entry.
 * Never throws — audit failures are logged to stderr but do not abort the operation.
 */
export async function writeAuditLog(entry: AuditEntry): Promise<void> {
  try {
    const db = await getDb();
    if (!db) return; // Gracefully skip if DB unavailable (e.g., test environment)
    await db.insert(auditLog).values({
      userId: entry.userId ?? null,
      action: entry.action,
      resource: entry.resource ?? null,
      resourceId: entry.resourceId ?? null,
      details: entry.details ?? null,
      ipAddress: entry.ipAddress ?? null,
      createdAt: new Date(),
    });
  } catch (err) {
    // Audit log failures must never break the primary operation
    console.error("[AuditLog] Failed to write audit entry:", err);
  }
}

/**
 * Helper to extract IP address from an Express request object.
 * Handles X-Forwarded-For from reverse proxies.
 */
export function getClientIp(req: { headers: Record<string, string | string[] | undefined>; socket?: { remoteAddress?: string } }): string {
  const forwarded = req.headers["x-forwarded-for"];
  if (forwarded) {
    const first = Array.isArray(forwarded) ? forwarded[0] : forwarded.split(",")[0];
    return first.trim();
  }
  return req.socket?.remoteAddress ?? "unknown";
}
