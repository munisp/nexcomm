/**
 * Offline sync ledger (INNOV-C) — durable dedupe for operations queued by the
 * PWA while offline (client/src/lib/offlineOrderQueue.ts) and replayed via
 * offlineSync.submitQueued.
 *
 * Kept in a separate schema file to avoid churn in schema.ts; register with
 * `export * from "./schema-offline-sync";` at the end of drizzle/schema.ts.
 */
import { pgTable, serial, integer, text, jsonb, timestamp, uniqueIndex, index } from "drizzle-orm/pg-core";
import { users } from "./schema";

export const offlineOperations = pgTable(
  "offline_operations",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id").notNull().references(() => users.id),
    // Client-generated UUID — the dedupe anchor. One row per queued operation.
    idempotencyKey: text("idempotency_key").notNull(),
    // Operation type, e.g. "order.create". Unknown types fail closed.
    operationType: text("operation_type").notNull(),
    payload: jsonb("payload").notNull(),
    // queued → processing → done | failed | duplicate
    status: text("status").notNull().default("queued"),
    // Server-side result of replay (e.g. { orderId }) or { error }.
    result: jsonb("result"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    processedAt: timestamp("processed_at"),
  },
  (t) => [
    uniqueIndex("offline_operations_idempotency_key_unique").on(t.idempotencyKey),
    index("offline_operations_user_idx").on(t.userId),
    index("offline_operations_status_idx").on(t.status),
  ]
);

export type OfflineOperation = typeof offlineOperations.$inferSelect;
export type InsertOfflineOperation = typeof offlineOperations.$inferInsert;
