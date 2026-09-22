/**
 * NEXCOM Exchange — Receipt Verification Schema (INNOV-D)
 * ─────────────────────────────────────────────────────────────────────────────
 * Public QR/code verification for warehouse-receipt digital twins.
 *
 * NOTE: This file is intentionally separate from drizzle/schema.ts
 * to avoid merge conflicts with parallel work. To activate, add the following
 * line to drizzle/schema.ts:
 *
 *     export * from "./schema-transparency";
 *
 * Migration: drizzle/0078_receipt_verifications.sql
 */
import {
  pgTable,
  serial,
  integer,
  varchar,
  timestamp,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { users, warehouseReceipts } from "./schema";

// ============================================================
// Receipt Verifications (single-use-ish public verification codes)
// ============================================================

export const receiptVerifications = pgTable(
  "receipt_verifications",
  {
    id: serial("id").primaryKey(),
    receiptId: integer("receipt_id")
      .notNull()
      .references(() => warehouseReceipts.id, { onDelete: "cascade" }),
    // Public capability code embedded in the QR / verify URL.
    code: varchar("code", { length: 96 }).notNull(),
    createdBy: integer("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    expiresAt: timestamp("expires_at"),
    viewCount: integer("view_count").default(0).notNull(),
  },
  (t) => ({
    codeUq: uniqueIndex("receipt_verifications_code_uq").on(t.code),
    receiptIdx: index("receipt_verifications_receipt_idx").on(t.receiptId),
  }),
);
export type ReceiptVerification = typeof receiptVerifications.$inferSelect;
export type InsertReceiptVerification = typeof receiptVerifications.$inferInsert;
