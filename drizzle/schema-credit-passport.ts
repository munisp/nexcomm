/**
 * schema-credit-passport.ts — INNOVATION 4: CREDIT PASSPORT (drizzle table)
 * ─────────────────────────────────────────────────────────────────────────────
 * Delivered as a standalone file (not an in-place edit of drizzle/schema.ts)
 * to avoid concurrent-edit conflicts on that shared file. To activate, either:
 *   a) append this table definition to drizzle/schema.ts, or
 *   b) re-export it there:  export * from "./schema-credit-passport";
 * Paired migration: drizzle/0076_credit_passports.sql (journal snippet in
 * MANIFEST.md — drizzle/meta/_journal.json is intentionally not edited here).
 */
import {
  index,
  integer,
  pgTable,
  serial,
  timestamp,
  varchar,
} from "drizzle-orm/pg-core";
import { users } from "./schema";

export const creditPassports = pgTable(
  "credit_passports",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** CreditNet score at issuance, 300-900 (rounded to integer). */
    score: integer("score").notNull(),
    /** prime | good | fair | subprime | cold_start (ml-platform band). */
    band: varchar("band", { length: 16 }).notNull(),
    issuedAt: timestamp("issued_at").defaultNow().notNull(),
    /** Passport validity window: 180 days from issuance. */
    expiresAt: timestamp("expires_at").notNull(),
    /** sha256 hex, shareable public verification handle for lenders. */
    verificationCode: varchar("verification_code", { length: 64 }).notNull().unique(),
  },
  (t) => ({
    userIdx: index("credit_passports_user_idx").on(t.userId),
  })
);

export type CreditPassport = typeof creditPassports.$inferSelect;
export type InsertCreditPassport = typeof creditPassports.$inferInsert;
