import { z } from "zod";
import { createHash } from "crypto";
import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import {
  users,
  profiles,
  farmerProfiles,
  traderProfiles,
  orders,
  watchlist,
  priceAlerts,
  notifications,
  warehouseReceipts,
  settlements,
  settlementDisputes,
  auditLog,
  privacyRequests,
} from "../../drizzle/schema";
import { writeAuditLog } from "../audit";

/**
 * GDPR-style data rights: export and erasure.
 *
 * - exportMyData returns every row keyed to the caller across the key
 *   user-data tables as JSON.
 * - requestErasure anonymizes PII with a hash tombstone (name, phone, BVN,
 *   NIN, email, bank details, KYC document references) while preserving
 *   financial ledger integrity — orders, settlements, ledger entries and the
 *   audit log are NEVER rewritten (regulatory record-keeping obligations).
 *
 * Retention policy: docs/DATA_RETENTION.md.
 */
export const privacyRouter = router({
  // ── Right of access: export the caller's personal data as JSON ────────────
  exportMyData: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "Database unavailable" });

    const userId = ctx.user.id;
    const [
      userRow,
      profile,
      farmerProfile,
      traderProfile,
      userOrders,
      userWatchlist,
      userPriceAlerts,
      userNotifications,
      userReceipts,
      userSettlements,
      userDisputes,
      userAuditTrail,
    ] = await Promise.all([
      db.select().from(users).where(eq(users.id, userId)),
      db.select().from(profiles).where(eq(profiles.userId, userId)),
      db.select().from(farmerProfiles).where(eq(farmerProfiles.userId, userId)),
      db.select().from(traderProfiles).where(eq(traderProfiles.userId, userId)),
      db.select().from(orders).where(eq(orders.userId, userId)),
      db.select().from(watchlist).where(eq(watchlist.userId, userId)),
      db.select().from(priceAlerts).where(eq(priceAlerts.userId, userId)),
      db.select().from(notifications).where(eq(notifications.userId, userId)),
      db.select().from(warehouseReceipts).where(eq(warehouseReceipts.userId, userId)),
      db.select().from(settlements).where(eq(settlements.userId, userId)),
      db.select().from(settlementDisputes).where(eq(settlementDisputes.raisedBy, userId)),
      db.select().from(auditLog).where(eq(auditLog.userId, userId)),
    ]);

    await db.insert(privacyRequests).values({
      userId,
      requestType: "EXPORT",
      status: "COMPLETED",
      completedAt: new Date(),
    });

    return {
      exportedAt: new Date().toISOString(),
      userId,
      data: {
        user: userRow[0] ?? null,
        profile: profile[0] ?? null,
        farmerProfile: farmerProfile[0] ?? null,
        traderProfile: traderProfile[0] ?? null,
        orders: userOrders,
        watchlist: userWatchlist,
        priceAlerts: userPriceAlerts,
        notifications: userNotifications,
        warehouseReceipts: userReceipts,
        settlements: userSettlements,
        settlementDisputes: userDisputes,
        auditTrail: userAuditTrail,
      },
    };
  }),

  // ── Right to erasure: hash-tombstone PII, preserve financial records ──────
  requestErasure: protectedProcedure
    .input(z.object({ confirmation: z.literal("ERASE MY DATA") }))
    .mutation(async ({ ctx, input }) => {
      void input; // confirmation phrase enforced by the input schema
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "Database unavailable" });

      const userId = ctx.user.id;
      // Deterministic pseudonym: proves linkage for auditors without exposing PII.
      const tombstone = createHash("sha256")
        .update(`nexcom-erasure:${userId}`)
        .digest("hex")
        .slice(0, 24);

      await db.transaction(async (tx) => {
        // users: break login identity while keeping the row (FK integrity).
        await tx
          .update(users)
          .set({
            name: `Erased User ${tombstone.slice(0, 8)}`,
            email: `erased-${tombstone}@erased.invalid`,
            loginMethod: "ERASED",
            updatedAt: new Date(),
          })
          .where(eq(users.id, userId));

        // profiles: strip personal + banking PII.
        await tx
          .update(profiles)
          .set({
            firstName: null,
            lastName: null,
            phone: null,
            nin: tombstone.slice(0, 20),
            bvn: tombstone.slice(0, 20),
            address: null,
            bankName: null,
            bankAccount: null,
            companyName: null,
            taxId: null,
            rcNumber: null,
            metadata: null,
            updatedAt: new Date(),
          })
          .where(eq(profiles.userId, userId));

        // farmer_profiles: strip identity + settlement PII (NOT NULL columns
        // receive the tombstone marker; nullable columns are nulled).
        await tx
          .update(farmerProfiles)
          .set({
            fullName: "ERASED",
            phone: `erased-${tombstone.slice(0, 12)}`,
            nin: null,
            bvn: null,
            bankName: null,
            bankAccountNumber: null,
            bankAccountName: null,
            mobileMoneyProvider: null,
            mobileMoneyNumber: null,
            kycNotes: null,
            updatedAt: new Date(),
          })
          .where(eq(farmerProfiles.userId, userId));

        // trader_profiles: strip identity + document references.
        await tx
          .update(traderProfiles)
          .set({
            fullName: "ERASED",
            phone: `erased-${tombstone.slice(0, 12)}`,
            email: null,
            address: null,
            nin: null,
            bvn: null,
            bankName: null,
            accountNumber: null,
            idDocumentUrl: null,
            proofOfAddressUrl: null,
            bankStatementUrl: null,
            kycNotes: null,
            updatedAt: new Date(),
          })
          .where(eq(traderProfiles.userId, userId));

        // Financial ledger integrity: orders, settlements, receipts, auditLog
        // and ledger entries are intentionally NOT modified.

        await tx.insert(privacyRequests).values({
          userId,
          requestType: "ERASURE",
          status: "COMPLETED",
          tombstone,
          completedAt: new Date(),
        });
      });

      await writeAuditLog({
        userId,
        action: "PRIVACY_ERASURE",
        resource: "users",
        resourceId: String(userId),
        details: { tombstone },
      });

      return {
        success: true,
        tombstone,
        note: "Personal data anonymized. Financial records are retained per regulatory retention policy (docs/DATA_RETENTION.md).",
      };
    }),

  // ── My privacy request history ─────────────────────────────────────────────
  myRequests: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "Database unavailable" });
    return db.select().from(privacyRequests).where(eq(privacyRequests.userId, ctx.user.id));
  }),
});
