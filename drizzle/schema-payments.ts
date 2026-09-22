/**
 * NEXCOM Exchange — Payment Collection Rails Schema (PAY-RAILS)
 * ─────────────────────────────────────────────────────────────────────────────
 * Durable records for the pluggable payment framework (server/services/payments):
 *
 *   paymentTransactions   — one row per collection attempt (any rail)
 *   paymentWebhookEvents  — inbound webhook dedupe log (exactly-once processing)
 *
 * Kept in a separate schema file to avoid churn in schema.ts; register with
 * `export * from "./schema-payments";` at the end of drizzle/schema.ts.
 *
 * Migration: drizzle/0080_payment_transactions.sql
 *
 * CONVENTIONS
 *  - amountMinor is ALWAYS minor units (kobo/cents), bigint.
 *  - status/purpose are lower-case normalised enums (see services/payments/types).
 */
import {
  pgTable,
  pgEnum,
  uuid,
  integer,
  bigint,
  varchar,
  text,
  jsonb,
  timestamp,
  boolean,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { users } from "./schema";

// ─── Enums ────────────────────────────────────────────────────────────────────

export const paymentStatusEnum = pgEnum("payment_status", [
  "pending",
  "processing",
  "success",
  "failed",
  "abandoned",
  "refunded",
]);

export const paymentPurposeEnum = pgEnum("payment_purpose", [
  "deposit",
  "fee",
  "subscription",
]);

// ─── payment_transactions ─────────────────────────────────────────────────────

export const paymentTransactions = pgTable(
  "payment_transactions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Client-generated idempotency key — one row per logical collection. */
    idempotencyKey: varchar("idempotency_key", { length: 128 }).notNull().unique(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id),
    /** Rail machine name: paystack | flutterwave | monnify | interswitch | stripe | mock */
    provider: varchar("provider", { length: 32 }).notNull(),
    /** Provider-side transaction/session reference. */
    providerRef: varchar("provider_ref", { length: 191 }).notNull().unique(),
    /** Amount in minor units (kobo for NGN, cents for USD). */
    amountMinor: bigint("amount_minor", { mode: "number" }).notNull(),
    currency: varchar("currency", { length: 3 }).notNull().default("NGN"),
    /** card | bank_transfer | ussd | qr | mobile_money | bank_debit */
    channel: varchar("channel", { length: 32 }),
    status: paymentStatusEnum("status").notNull().default("pending"),
    purpose: paymentPurposeEnum("purpose").notNull().default("deposit"),
    /** Hosted checkout URL returned by the rail (card/hosted transfer). */
    authorizationUrl: text("authorization_url"),
    /** USSD code string to display, e.g. "*737*000*12345#". */
    ussdCode: varchar("ussd_code", { length: 64 }),
    /** Provider metadata / normalised extras (never secrets or full PANs). */
    metadata: jsonb("metadata"),
    paidAt: timestamp("paid_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    index("payment_transactions_user_idx").on(t.userId),
    index("payment_transactions_status_idx").on(t.status),
    index("payment_transactions_provider_ref_idx").on(t.provider, t.providerRef),
  ]
);

// ─── payment_webhook_events ───────────────────────────────────────────────────
// Inbound webhook idempotency: unique(provider, event_id) is the dedupe anchor.
// The webhook route inserts the row FIRST; a unique-violation means the event
// was already seen and we respond 200 without re-processing.

export const paymentWebhookEvents = pgTable(
  "payment_webhook_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    provider: varchar("provider", { length: 32 }).notNull(),
    /** Provider-unique event id (charge id, event id, txn ref hash, ...). */
    eventId: varchar("event_id", { length: 191 }).notNull(),
    payload: jsonb("payload"),
    processed: boolean("processed").notNull().default(false),
    processedAt: timestamp("processed_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("payment_webhook_events_provider_event_unique").on(t.provider, t.eventId),
    index("payment_webhook_events_provider_idx").on(t.provider),
  ]
);

// ─── Types ────────────────────────────────────────────────────────────────────

export type PaymentTransaction = typeof paymentTransactions.$inferSelect;
export type InsertPaymentTransaction = typeof paymentTransactions.$inferInsert;
export type PaymentWebhookEvent = typeof paymentWebhookEvents.$inferSelect;
export type InsertPaymentWebhookEvent = typeof paymentWebhookEvents.$inferInsert;
