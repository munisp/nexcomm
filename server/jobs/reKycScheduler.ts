/**
 * Re-KYC Scheduler
 *
 * Runs every 24 hours and flags stakeholders whose KYC was approved more than
 * 12 months ago. Flags are stored in the `re_kyc_flags` table and in-app
 * notifications are sent to affected users.
 *
 * High-volume criteria: traders/brokers/market-makers with ≥5 orders in the
 * last 30 days, or farmers/warehouse-ops with ≥2 active crop listings.
 */
import { and, count, desc, eq, gte, isNull, lt, ne } from "drizzle-orm";
import { getDb } from "../db";
import {
  brokerProfiles,
  cropListings,
  farmerProfiles,
  marketMakerOnboardingProfiles,
  notifications,
  orders,
  reKycFlags,
  traderProfiles,
  warehouseOperatorProfiles,
} from "../../drizzle/schema";

const TWELVE_MONTHS_MS = 365 * 24 * 60 * 60 * 1000;
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

async function runReKycCheck() {
  const db = await getDb();
  if (!db) return;

  const now = new Date();
  const twelveMonthsAgo = new Date(now.getTime() - TWELVE_MONTHS_MS);
  const thirtyDaysAgo = new Date(now.getTime() - THIRTY_DAYS_MS);

  let flagsCreated = 0;

  // ── Farmers ──────────────────────────────────────────────────────────────────
  try {
    const farmers = await db
      .select()
      .from(farmerProfiles)
      .where(
        and(
          eq(farmerProfiles.kycStatus, "APPROVED"),
          lt(farmerProfiles.kycReviewedAt, twelveMonthsAgo),
        ),
      );

    for (const farmer of farmers) {
      // High-volume: ≥2 active listings
      const [{ value: activeListings }] = await db
        .select({ value: count() })
        .from(cropListings)
        .where(
          and(
            eq(cropListings.userId, farmer.userId),
            eq(cropListings.status, "ACTIVE"),
          ),
        );

      if (Number(activeListings) < 2) continue;

      // Check if already flagged and unresolved
      const [existing] = await db
        .select({ id: reKycFlags.id })
        .from(reKycFlags)
        .where(
          and(
            eq(reKycFlags.userId, farmer.userId),
            eq(reKycFlags.stakeholderType, "FARMER"),
            isNull(reKycFlags.resolvedAt),
          ),
        )
        .limit(1);

      if (existing) continue;

      await db.insert(reKycFlags).values({
        userId: farmer.userId,
        stakeholderType: "FARMER",
        profileId: farmer.id,
        reason: "KYC_OLDER_THAN_12_MONTHS",
        kycApprovedAt: farmer.kycReviewedAt,
        notifiedAt: now,
      });

      await db.insert(notifications).values({
        userId: farmer.userId,
        title: "Re-KYC Required",
        message:
          "Your KYC verification is more than 12 months old. Please re-submit your documents to continue using the platform.",
        type: "KYC",
      });

      flagsCreated++;
    }
  } catch (_) {
    // Table may not exist in test environment
  }

  // ── Traders ───────────────────────────────────────────────────────────────────
  try {
    const traders = await db
      .select()
      .from(traderProfiles)
      .where(
        and(
          eq(traderProfiles.kycStatus, "APPROVED"),
          lt(traderProfiles.updatedAt, twelveMonthsAgo),
        ),
      );

    for (const trader of traders) {
      const [{ value: recentOrders }] = await db
        .select({ value: count() })
        .from(orders)
        .where(
          and(
            eq(orders.userId, trader.userId),
            gte(orders.createdAt, thirtyDaysAgo),
          ),
        );

      if (Number(recentOrders) < 5) continue;

      const [existing] = await db
        .select({ id: reKycFlags.id })
        .from(reKycFlags)
        .where(
          and(
            eq(reKycFlags.userId, trader.userId),
            eq(reKycFlags.stakeholderType, "TRADER"),
            isNull(reKycFlags.resolvedAt),
          ),
        )
        .limit(1);

      if (existing) continue;

      await db.insert(reKycFlags).values({
        userId: trader.userId,
        stakeholderType: "TRADER",
        profileId: trader.id,
        reason: "KYC_OLDER_THAN_12_MONTHS",
        kycApprovedAt: trader.updatedAt,
        notifiedAt: now,
      });

      await db.insert(notifications).values({
        userId: trader.userId,
        title: "Re-KYC Required",
        message:
          "Your KYC verification is more than 12 months old. Please re-submit your documents to continue trading.",
        type: "KYC",
      });

      flagsCreated++;
    }
  } catch (_) {}

  // ── Brokers ───────────────────────────────────────────────────────────────────
  try {
    const brokers = await db
      .select()
      .from(brokerProfiles)
      .where(
        and(
          eq(brokerProfiles.kycStatus, "APPROVED"),
          lt(brokerProfiles.updatedAt, twelveMonthsAgo),
        ),
      );

    for (const broker of brokers) {
      const [{ value: recentOrders }] = await db
        .select({ value: count() })
        .from(orders)
        .where(
          and(
            eq(orders.userId, broker.userId),
            gte(orders.createdAt, thirtyDaysAgo),
          ),
        );

      if (Number(recentOrders) < 5) continue;

      const [existing] = await db
        .select({ id: reKycFlags.id })
        .from(reKycFlags)
        .where(
          and(
            eq(reKycFlags.userId, broker.userId),
            eq(reKycFlags.stakeholderType, "BROKER"),
            isNull(reKycFlags.resolvedAt),
          ),
        )
        .limit(1);

      if (existing) continue;

      await db.insert(reKycFlags).values({
        userId: broker.userId,
        stakeholderType: "BROKER",
        profileId: broker.id,
        reason: "KYC_OLDER_THAN_12_MONTHS",
        kycApprovedAt: broker.updatedAt,
        notifiedAt: now,
      });

      await db.insert(notifications).values({
        userId: broker.userId,
        title: "Re-KYC Required",
        message:
          "Your broker KYC is more than 12 months old. Please re-submit your license documents.",
        type: "KYC",
      });

      flagsCreated++;
    }
  } catch (_) {}

  // ── Warehouse Operators ───────────────────────────────────────────────────────
  try {
    const warehouseOps = await db
      .select()
      .from(warehouseOperatorProfiles)
      .where(
        and(
          eq(warehouseOperatorProfiles.kycStatus, "APPROVED"),
          lt(warehouseOperatorProfiles.updatedAt, twelveMonthsAgo),
        ),
      );

    for (const op of warehouseOps) {
      const [{ value: activeListings }] = await db
        .select({ value: count() })
        .from(cropListings)
        .where(
          and(
            eq(cropListings.userId, op.userId),
            eq(cropListings.status, "ACTIVE"),
          ),
        );

      if (Number(activeListings) < 2) continue;

      const [existing] = await db
        .select({ id: reKycFlags.id })
        .from(reKycFlags)
        .where(
          and(
            eq(reKycFlags.userId, op.userId),
            eq(reKycFlags.stakeholderType, "WAREHOUSE_OPERATOR"),
            isNull(reKycFlags.resolvedAt),
          ),
        )
        .limit(1);

      if (existing) continue;

      await db.insert(reKycFlags).values({
        userId: op.userId,
        stakeholderType: "WAREHOUSE_OPERATOR",
        profileId: op.id,
        reason: "KYC_OLDER_THAN_12_MONTHS",
        kycApprovedAt: op.updatedAt,
        notifiedAt: now,
      });

      await db.insert(notifications).values({
        userId: op.userId,
        title: "Re-KYC Required",
        message:
          "Your warehouse operator KYC is more than 12 months old. Please re-submit your NWR certificate.",
        type: "KYC",
      });

      flagsCreated++;
    }
  } catch (_) {}

  // ── Market Makers ─────────────────────────────────────────────────────────────
  try {
    const marketMakers = await db
      .select()
      .from(marketMakerOnboardingProfiles)
      .where(
        and(
          eq(marketMakerOnboardingProfiles.kycStatus, "APPROVED"),
          lt(marketMakerOnboardingProfiles.updatedAt, twelveMonthsAgo),
        ),
      );

    for (const mm of marketMakers) {
      const [{ value: recentOrders }] = await db
        .select({ value: count() })
        .from(orders)
        .where(
          and(
            eq(orders.userId, mm.userId),
            gte(orders.createdAt, thirtyDaysAgo),
          ),
        );

      if (Number(recentOrders) < 5) continue;

      const [existing] = await db
        .select({ id: reKycFlags.id })
        .from(reKycFlags)
        .where(
          and(
            eq(reKycFlags.userId, mm.userId),
            eq(reKycFlags.stakeholderType, "MARKET_MAKER"),
            isNull(reKycFlags.resolvedAt),
          ),
        )
        .limit(1);

      if (existing) continue;

      await db.insert(reKycFlags).values({
        userId: mm.userId,
        stakeholderType: "MARKET_MAKER",
        profileId: mm.id,
        reason: "KYC_OLDER_THAN_12_MONTHS",
        kycApprovedAt: mm.updatedAt,
        notifiedAt: now,
      });

      await db.insert(notifications).values({
        userId: mm.userId,
        title: "Re-KYC Required",
        message:
          "Your market maker KYC is more than 12 months old. Please re-submit your firm registration documents.",
        type: "KYC",
      });

      flagsCreated++;
    }
  } catch (_) {}

  if (flagsCreated > 0) {
    console.log(`[ReKycScheduler] Created ${flagsCreated} re-KYC flags`);
  }
}

// ── Scheduler bootstrap ───────────────────────────────────────────────────────
const INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours

export function startReKycScheduler() {
  // Run immediately on startup, then every 24h
  runReKycCheck().catch(err =>
    console.error("[ReKycScheduler] Initial run error:", err),
  );
  setInterval(() => {
    runReKycCheck().catch(err =>
      console.error("[ReKycScheduler] Interval run error:", err),
    );
  }, INTERVAL_MS);
  console.log("[ReKycScheduler] Started — checks every 24 hours");
}
