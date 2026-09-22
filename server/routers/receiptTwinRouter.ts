/**
 * receiptTwinRouter.ts (INNOV-D — Innovation 7)
 * Warehouse Receipt Digital Twin + QR/code verification.
 *
 * - getDigitalTwin:      owner/admin view of a receipt with its custody timeline
 *                        (derived from audit_log entries for the receipt plus the
 *                        immutable issuance event).
 * - generateVerification: owner/admin mints a public verification code.
 * - verifyByCode:         PUBLIC. Returns a redacted twin (no owner PII, no exact
 *                         location beyond state). Fails closed with an identical
 *                         error for unknown and expired codes (no oracle leakage).
 */
import { z } from "zod";
import { protectedProcedure, publicProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { auditLog, warehouseReceipts, warehouses } from "../../drizzle/schema";
import { receiptVerifications } from "../../drizzle/schema-transparency";
import { eq, and, asc, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { randomBytes } from "crypto";

const VERIFICATION_TTL_DAYS = 30;
const INVALID_CODE_MESSAGE = "Verification code is invalid or has expired.";

const codeSchema = z
  .string()
  .trim()
  .min(8)
  .max(96)
  .regex(/^[a-zA-Z0-9-]+$/, "Malformed verification code");

export const receiptTwinRouter = router({
  /**
   * Full digital twin for a receipt: the warehouse_receipts row plus a custody
   * timeline reconstructed from the audit log (custody/status events recorded
   * by receipts.ts mutations) and the immutable issuance event.
   * Owner-only, or admin.
   */
  getDigitalTwin: protectedProcedure
    .input(z.object({ receiptId: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "Database unavailable" });

      const [receipt] = await db
        .select()
        .from(warehouseReceipts)
        .where(eq(warehouseReceipts.id, input.receiptId))
        .limit(1);

      if (!receipt) throw new TRPCError({ code: "NOT_FOUND", message: "Receipt not found" });
      if (receipt.userId !== ctx.user.id && ctx.user.role !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN" });
      }

      const auditRows = await db
        .select({
          action: auditLog.action,
          details: auditLog.details,
          createdAt: auditLog.createdAt,
        })
        .from(auditLog)
        .where(
          and(
            eq(auditLog.resource, "warehouse_receipts"),
            eq(auditLog.resourceId, String(receipt.id)),
          )
        )
        .orderBy(asc(auditLog.createdAt));

      const timeline = [
        {
          at: receipt.depositDate,
          event: "ISSUED",
          details: `Deposited at ${receipt.warehouseName ?? "accredited warehouse"}` as string | null,
        },
        ...auditRows.map((r) => ({
          at: r.createdAt,
          event: r.action,
          details:
            r.details && typeof r.details === "object"
              ? JSON.stringify(r.details)
              : null,
        })),
        ...(receipt.status !== "ACTIVE"
          ? [{ at: receipt.updatedAt, event: `STATUS_${receipt.status}`, details: null as string | null }]
          : []),
      ];

      const [verification] = await db
        .select({ code: receiptVerifications.code, expiresAt: receiptVerifications.expiresAt })
        .from(receiptVerifications)
        .where(eq(receiptVerifications.receiptId, receipt.id))
        .orderBy(asc(receiptVerifications.id))
        .limit(1);

      return { receipt, timeline, verification: verification ?? null };
    }),

  /**
   * Mint a public verification code for a receipt (owner/admin).
   * Returns the code and the public verify path to embed in a QR code.
   */
  generateVerification: protectedProcedure
    .input(z.object({ receiptId: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "Database unavailable" });

      const [receipt] = await db
        .select()
        .from(warehouseReceipts)
        .where(eq(warehouseReceipts.id, input.receiptId))
        .limit(1);

      if (!receipt) throw new TRPCError({ code: "NOT_FOUND", message: "Receipt not found" });
      if (receipt.userId !== ctx.user.id && ctx.user.role !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN" });
      }

      const code = randomBytes(24).toString("hex");
      const expiresAt = new Date(Date.now() + VERIFICATION_TTL_DAYS * 24 * 60 * 60 * 1000);

      await db.insert(receiptVerifications).values({
        receiptId: receipt.id,
        code,
        createdBy: ctx.user.id,
        expiresAt,
      });

      await db.insert(auditLog).values({
        userId: ctx.user.id,
        action: "RECEIPT_VERIFICATION_MINT",
        resource: "warehouse_receipts",
        resourceId: String(receipt.id),
        details: { receiptNumber: receipt.receiptNumber },
      });

      return { code, verifyPath: `/verify-receipt/${code}`, expiresAt };
    }),

  /**
   * PUBLIC: verify a receipt by code. Returns a redacted twin — commodity,
   * grade, quantity, warehouse name, status, issue date, and (at most) the
   * warehouse's state. NEVER returns owner PII or exact GPS/address.
   * Fails closed: unknown and expired codes produce the identical error.
   */
  verifyByCode: publicProcedure
    .input(z.object({ code: codeSchema }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "Database unavailable" });

      const [row] = await db
        .select({
          verificationId: receiptVerifications.id,
          expiresAt: receiptVerifications.expiresAt,
          receiptNumber: warehouseReceipts.receiptNumber,
          commodity: warehouseReceipts.commodity,
          grade: warehouseReceipts.grade,
          quantity: warehouseReceipts.quantity,
          unit: warehouseReceipts.unit,
          warehouseName: warehouseReceipts.warehouseName,
          status: warehouseReceipts.status,
          depositDate: warehouseReceipts.depositDate,
          warehouseId: warehouseReceipts.warehouseId,
        })
        .from(receiptVerifications)
        .innerJoin(warehouseReceipts, eq(receiptVerifications.receiptId, warehouseReceipts.id))
        .where(eq(receiptVerifications.code, input.code))
        .limit(1);

      if (!row || (row.expiresAt && row.expiresAt.getTime() < Date.now())) {
        // Identical failure for unknown vs expired — no oracle leakage.
        throw new TRPCError({ code: "NOT_FOUND", message: INVALID_CODE_MESSAGE });
      }

      // Redacted location: state only, never address/GPS.
      let state: string | null = null;
      if (row.warehouseId) {
        const [wh] = await db
          .select({ state: warehouses.state })
          .from(warehouses)
          .where(eq(warehouses.code, row.warehouseId))
          .limit(1);
        state = wh?.state ?? null;
      }

      await db
        .update(receiptVerifications)
        .set({ viewCount: sql`${receiptVerifications.viewCount} + 1` })
        .where(eq(receiptVerifications.id, row.verificationId));

      return {
        receiptNumber: row.receiptNumber,
        commodity: row.commodity,
        grade: row.grade,
        quantity: row.quantity,
        unit: row.unit,
        warehouseName: row.warehouseName,
        state,
        status: row.status,
        issueDate: row.depositDate,
        verifiedAt: new Date(),
      };
    }),
});
