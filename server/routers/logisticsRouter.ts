/**
 * NEXCOM Exchange — Smart Logistics Router (INNOVATION 9)
 * ─────────────────────────────────────────────────────────────────────────────
 * Physical-settlement tracking for delivery orders:
 *   getDeliveryTimeline — milestone history for a delivery. STRICTLY honest:
 *     explicit milestones come from the append-only `delivery_milestones`
 *     table (INNOV-E); when a stage has no recorded milestone, a derived entry
 *     is synthesized from the delivery's current status + timestamps and is
 *     flagged `derived: true` so the UI can render it as sparse/estimated.
 *   estimateWindow    — documented state-to-state heuristic (Nigerian
 *     geopolitical zones); ALWAYS labeled ESTIMATE, never a promise.
 *   reportMilestone   — warehouse operators (approved+active profile) or
 *     admins append a milestone; terminal milestones advance the delivery's
 *     status (PICKUP_SCHEDULED→SCHEDULED, IN_TRANSIT→IN_TRANSIT,
 *     DELIVERED→DELIVERED).
 *
 * Registration (sibling-owned file — see MANIFEST snippet):
 *   server/routers.ts:  logistics: logisticsRouter,
 */
import { z } from "zod";
import { router, protectedProcedure } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import { getDb } from "../db";
import { deliveryOrders, warehouseOperatorProfiles } from "../../drizzle/schema";
import { deliveryMilestones } from "../../drizzle/schema-channel-bridge";
import { and, asc, eq } from "drizzle-orm";
import { writeAuditLog } from "../audit";

const milestoneEnum = z.enum([
  "PICKUP_SCHEDULED",
  "IN_TRANSIT",
  "WAREHOUSE_ARRIVED",
  "QUALITY_CHECKED",
  "DELIVERED",
]);
type Milestone = z.infer<typeof milestoneEnum>;

/** Stage order used to derive implied milestones from the flat status field. */
const STATUS_IMPLIES: Record<string, Milestone[]> = {
  PENDING: [],
  SCHEDULED: ["PICKUP_SCHEDULED"],
  IN_TRANSIT: ["PICKUP_SCHEDULED", "IN_TRANSIT"],
  DELIVERED: ["PICKUP_SCHEDULED", "IN_TRANSIT", "DELIVERED"],
  CANCELLED: [],
};

/** Nigerian geopolitical zones — for the estimateWindow heuristic only. */
const ZONES: Record<string, string[]> = {
  NorthCentral: ["Benue", "Kogi", "Kwara", "Nasarawa", "Niger", "Plateau", "FCT", "Abuja"],
  NorthEast: ["Adamawa", "Bauchi", "Borno", "Gombe", "Taraba", "Yobe"],
  NorthWest: ["Jigawa", "Kaduna", "Kano", "Katsina", "Kebbi", "Sokoto", "Zamfara"],
  SouthEast: ["Abia", "Anambra", "Ebonyi", "Enugu", "Imo"],
  SouthSouth: ["Akwa Ibom", "Bayelsa", "Cross River", "Delta", "Edo", "Rivers"],
  SouthWest: ["Ekiti", "Lagos", "Ogun", "Ondo", "Osun", "Oyo"],
};

function zoneOf(state: string): string | null {
  const s = state.trim().toLowerCase();
  for (const [zone, states] of Object.entries(ZONES)) {
    if (states.some((st) => st.toLowerCase() === s)) return zone;
  }
  return null;
}

export const logisticsRouter = router({
  // ─── Delivery timeline (owner or admin) ─────────────────────────────────────
  getDeliveryTimeline: protectedProcedure
    .input(z.object({ deliveryId: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });

      const [delivery] = await db
        .select()
        .from(deliveryOrders)
        .where(eq(deliveryOrders.id, input.deliveryId))
        .limit(1);
      if (!delivery) throw new TRPCError({ code: "NOT_FOUND", message: "Delivery not found" });
      if (delivery.userId !== ctx.user.id && ctx.user.role !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN" });
      }

      const recorded = await db
        .select()
        .from(deliveryMilestones)
        .where(eq(deliveryMilestones.deliveryId, input.deliveryId))
        .orderBy(asc(deliveryMilestones.occurredAt));

      const recordedStages = new Set<Milestone>(recorded.map((m) => m.milestone as Milestone));

      // Derived (sparse) entries for stages implied by the flat status field
      // that have no explicit milestone row. Timestamps are honest best-knowns:
      // PICKUP_SCHEDULED ← createdAt; later stages ← updatedAt.
      const derived: {
        milestone: Milestone;
        occurredAt: Date;
        derived: true;
        note: string | null;
        location: string | null;
      }[] = [];
      if (delivery.status !== "CANCELLED") {
        for (const stage of STATUS_IMPLIES[delivery.status] ?? []) {
          if (recordedStages.has(stage)) continue;
          derived.push({
            milestone: stage,
            occurredAt: stage === "PICKUP_SCHEDULED" ? delivery.createdAt : delivery.updatedAt,
            derived: true,
            note: null,
            location: null,
          });
        }
      }

      const timeline = [
        ...recorded.map((m) => ({
          milestone: m.milestone as Milestone,
          occurredAt: m.occurredAt,
          derived: false as const,
          note: m.note,
          location: m.location,
        })),
        ...derived,
      ].sort((a, b) => new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime());

      return {
        delivery: {
          id: delivery.id,
          commodity: delivery.commodity,
          quantity: delivery.quantity,
          unit: delivery.unit,
          deliveryAddress: delivery.deliveryAddress,
          status: delivery.status,
          scheduledDate: delivery.scheduledDate,
          createdAt: delivery.createdAt,
        },
        milestones: timeline,
        /** True when the timeline is mostly derived (no operator-reported history yet). */
        sparse: recorded.length === 0,
      };
    }),

  // ─── Delivery window estimate (heuristic, ALWAYS labeled ESTIMATE) ──────────
  // Heuristic (documented): same state 1–2 days; same geopolitical zone 2–4
  // days; cross-zone 3–7 days. Unknown states fall back to the widest tier.
  // This is NOT carrier data — it is a planning aid only.
  estimateWindow: protectedProcedure
    .input(z.object({ fromState: z.string().min(2).max(100), toState: z.string().min(2).max(100) }))
    .query(({ input }) => {
      const from = zoneOf(input.fromState);
      const to = zoneOf(input.toState);
      const sameState = input.fromState.trim().toLowerCase() === input.toState.trim().toLowerCase();

      let minDays: number, maxDays: number, tier: string;
      if (sameState) {
        [minDays, maxDays, tier] = [1, 2, "same_state"];
      } else if (from && to && from === to) {
        [minDays, maxDays, tier] = [2, 4, "same_zone"];
      } else {
        [minDays, maxDays, tier] = [3, 7, "cross_zone"];
      }

      return {
        estimate: true as const, // UI must label this ESTIMATE
        minDays,
        maxDays,
        tier,
        basis:
          "Heuristic: Nigerian state-to-state distance tiers (same state 1–2d, same geopolitical zone 2–4d, cross-zone 3–7d). Not carrier-confirmed.",
      };
    }),

  // ─── Report a milestone (warehouse operators + admins only) ─────────────────
  reportMilestone: protectedProcedure
    .input(
      z.object({
        deliveryId: z.number().int().positive(),
        milestone: milestoneEnum,
        note: z.string().max(1000).optional(),
        location: z.string().max(200).optional(),
        occurredAt: z.date().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });

      // Authorization: admin, or a warehouse operator with an APPROVED + ACTIVE profile.
      // (The role enum has no logistics value; warehouse operators are identified
      //  by their warehouse_operator_profiles row.)
      let authorized = ctx.user.role === "admin";
      if (!authorized) {
        const [profile] = await db
          .select({
            kycStatus: warehouseOperatorProfiles.kycStatus,
            accountStatus: warehouseOperatorProfiles.accountStatus,
          })
          .from(warehouseOperatorProfiles)
          .where(eq(warehouseOperatorProfiles.userId, ctx.user.id))
          .limit(1);
        authorized = !!profile && profile.kycStatus === "APPROVED" && profile.accountStatus === "ACTIVE";
      }
      if (!authorized) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Only admins and approved active warehouse operators can report milestones",
        });
      }

      const [delivery] = await db
        .select({ id: deliveryOrders.id, status: deliveryOrders.status })
        .from(deliveryOrders)
        .where(eq(deliveryOrders.id, input.deliveryId))
        .limit(1);
      if (!delivery) throw new TRPCError({ code: "NOT_FOUND", message: "Delivery not found" });
      if (delivery.status === "CANCELLED") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Cannot report milestones on a cancelled delivery" });
      }

      const occurredAt = input.occurredAt ?? new Date();
      const [row] = await db
        .insert(deliveryMilestones)
        .values({
          deliveryId: input.deliveryId,
          milestone: input.milestone,
          note: input.note ?? null,
          location: input.location ?? null,
          reportedBy: ctx.user.id,
          occurredAt,
        })
        .returning({ id: deliveryMilestones.id });

      // Terminal milestones advance the flat status field (kept in sync so the
      // existing delivery list/detail pages reflect progress).
      const advanceTo: Partial<Record<Milestone, "SCHEDULED" | "IN_TRANSIT" | "DELIVERED">> = {
        PICKUP_SCHEDULED: "SCHEDULED",
        IN_TRANSIT: "IN_TRANSIT",
        DELIVERED: "DELIVERED",
      };
      const nextStatus = advanceTo[input.milestone];
      if (nextStatus && delivery.status !== "DELIVERED") {
        await db
          .update(deliveryOrders)
          .set({ status: nextStatus, updatedAt: new Date() })
          .where(eq(deliveryOrders.id, input.deliveryId));
      }

      await writeAuditLog({
        userId: ctx.user.id,
        action: "logistics.reportMilestone",
        resource: "delivery_milestones",
        resourceId: String(row.id),
        details: { deliveryId: input.deliveryId, milestone: input.milestone, location: input.location },
      });

      return { id: row.id, deliveryId: input.deliveryId, milestone: input.milestone, occurredAt };
    }),
});
