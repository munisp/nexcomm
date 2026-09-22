/**
 * NEXCOM Exchange — Channel Bridge & Logistics Schema
 * ─────────────────────────────────────────────────────────────────────────────
 * INNOV-E tables:
 *   1. channelHandoffs     — Omnichannel session continuity: single-use OTP
 *                            handoff tokens bridging USSD ↔ web/PWA sessions.
 *   2. deliveryMilestones  — Smart logistics timeline: append-only milestone
 *                            history for physical delivery orders.
 *
 * NOTE (INNOV-E): intentionally separate from drizzle/schema.ts to avoid merge
 * conflicts with parallel work. To activate, add to drizzle/schema.ts:
 *
 *     export * from "./schema-channel-bridge";
 *
 * Migration: drizzle/0079_channel_handoffs.sql
 */
import {
  pgTable,
  pgEnum,
  bigserial,
  integer,
  varchar,
  text,
  jsonb,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { users, deliveryOrders } from "./schema";

// ─── Enums ────────────────────────────────────────────────────────────────────
export const handoffChannelEnum = pgEnum("handoff_channel", ["WEB", "USSD", "WHATSAPP"]);

export const deliveryMilestoneEnum = pgEnum("delivery_milestone", [
  "PICKUP_SCHEDULED",
  "IN_TRANSIT",
  "WAREHOUSE_ARRIVED",
  "QUALITY_CHECKED",
  "DELIVERED",
]);

// ─── Channel handoff tokens (INNOVATION 6) ────────────────────────────────────
// A signed-in user on one channel (web or USSD) generates a 6-digit OTP,
// displays it, and enters it on the other channel within 10 minutes to
// continue the session (e.g. a draft order started over USSD).
export const channelHandoffs = pgTable(
  "channel_handoffs",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** sha256 hex of the 6-digit OTP — the plaintext OTP is never stored. */
    otpHash: varchar("otp_hash", { length: 64 }).notNull(),
    channelFrom: handoffChannelEnum("channel_from").notNull(),
    channelTo: handoffChannelEnum("channel_to").notNull(),
    /** Optional pending intent snapshot (e.g. { type: "draft_order", symbol, side, quantity }). */
    intent: jsonb("intent"),
    expiresAt: timestamp("expires_at").notNull(),
    usedAt: timestamp("used_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    index("channel_handoffs_user_idx").on(t.userId),
    index("channel_handoffs_expires_idx").on(t.expiresAt),
  ],
);
export type ChannelHandoff = typeof channelHandoffs.$inferSelect;
export type InsertChannelHandoff = typeof channelHandoffs.$inferInsert;

// ─── Delivery milestones (INNOVATION 9) ───────────────────────────────────────
// Append-only milestone history for delivery_orders. Written by warehouse
// operators / admins via logisticsRouter.reportMilestone; read by
// logisticsRouter.getDeliveryTimeline to build the vertical timeline.
export const deliveryMilestones = pgTable(
  "delivery_milestones",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    deliveryId: integer("delivery_id")
      .notNull()
      .references(() => deliveryOrders.id, { onDelete: "cascade" }),
    milestone: deliveryMilestoneEnum("milestone").notNull(),
    /** Operator note (e.g. "Grade A confirmed, 2% foreign matter"). */
    note: text("note"),
    /** Warehouse location / checkpoint, free text (e.g. "Kano Central Warehouse"). */
    location: varchar("location", { length: 200 }),
    reportedBy: integer("reported_by")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** When the milestone physically occurred (may differ from row creation). */
    occurredAt: timestamp("occurred_at").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [index("delivery_milestones_delivery_idx").on(t.deliveryId)],
);
export type DeliveryMilestone = typeof deliveryMilestones.$inferSelect;
export type InsertDeliveryMilestone = typeof deliveryMilestones.$inferInsert;
