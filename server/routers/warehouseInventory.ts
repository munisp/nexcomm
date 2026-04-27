/**
 * Warehouse Inventory Router
 * Provides farmer-facing views of their deposited produce grouped by warehouse and grade,
 * plus QR code payload generation for individual electronic warehouse receipts (EWRs).
 */
import { TRPCError } from "@trpc/server";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../db";
import { depositRequests, warehouseReceipts } from "../../drizzle/schema";
import { protectedProcedure, router } from "../_core/trpc";
import { writeAuditLog } from "../audit";

// ─── Certified warehouse reference data ──────────────────────────────────────
export const CERTIFIED_WAREHOUSES: Record<string, {
  name: string;
  location: string;
  state: string;
  capacity: string;
  operator: string;
  certBody: string;
}> = {
  "WH-KD-001": {
    name: "Kaduna Central Commodity Store",
    location: "Kawo, Kaduna",
    state: "Kaduna",
    capacity: "50,000 MT",
    operator: "NWR Logistics Ltd",
    certBody: "WACOT",
  },
  "WH-KN-001": {
    name: "Kano Ginger Processing Hub",
    location: "Challawa Industrial Estate, Kano",
    state: "Kano",
    capacity: "30,000 MT",
    operator: "Kano Commodity Stores Ltd",
    certBody: "WACOT",
  },
  "WH-ZM-001": {
    name: "Zamfara Agro-Storage Facility",
    location: "Gusau, Zamfara",
    state: "Zamfara",
    capacity: "20,000 MT",
    operator: "Zamfara Farmers Coop",
    certBody: "NEXCOM",
  },
  "WH-AB-001": {
    name: "Abia State Commodity Warehouse",
    location: "Aba, Abia",
    state: "Abia",
    capacity: "15,000 MT",
    operator: "South-East Agro Logistics",
    certBody: "NEXCOM",
  },
  "WH-OY-001": {
    name: "Oyo Agro-Commodity Hub",
    location: "Ibadan, Oyo",
    state: "Oyo",
    capacity: "25,000 MT",
    operator: "Oyo State Commodity Board",
    certBody: "WACOT",
  },
};

// ─── Grade display names ──────────────────────────────────────────────────────
const GRADE_LABELS: Record<string, string> = {
  "G1": "Grade 1 (Premium)",
  "G2": "Grade 2 (Standard)",
  "G3": "Grade 3 (Commercial)",
  "SPLIT-DRY-G1": "Split Dry — Grade 1",
  "SPLIT-DRY-G2": "Split Dry — Grade 2",
  "WHOLE-DRY-G1": "Whole Dry — Grade 1",
  "FRESH-G1": "Fresh Ginger — Grade 1",
  "UNGRADED": "Ungraded",
};

function gradeLabel(grade: string | null): string {
  if (!grade) return "Ungraded";
  return GRADE_LABELS[grade.toUpperCase()] ?? grade;
}

// ─── Router ───────────────────────────────────────────────────────────────────
export const warehouseInventoryRouter = router({
  /**
   * Returns the authenticated farmer's deposited produce grouped by warehouse,
   * then by commodity/grade, with aggregate quantities and receipt counts.
   */
  myInventory: protectedProcedure
    .input(z.object({
      status: z.enum(["ACTIVE", "PLEDGED", "REDEEMED", "CANCELLED", "ALL"]).default("ACTIVE"),
    }).optional())
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) return { warehouses: [] };

      const statusFilter = input?.status ?? "ACTIVE";

      // Fetch all receipts for this user
      const receipts = await db
        .select()
        .from(warehouseReceipts)
        .where(
          statusFilter === "ALL"
            ? eq(warehouseReceipts.userId, ctx.user.id)
            : and(
                eq(warehouseReceipts.userId, ctx.user.id),
                eq(warehouseReceipts.status, statusFilter as "ACTIVE" | "PLEDGED" | "REDEEMED" | "CANCELLED"),
              ),
        )
        .orderBy(desc(warehouseReceipts.depositDate));

      // Fetch pending/active deposit requests as well (not yet receipted)
      const deposits = await db
        .select()
        .from(depositRequests)
        .where(
          and(
            eq(depositRequests.userId, ctx.user.id),
            eq(depositRequests.status, "STORED"),
          ),
        )
        .orderBy(desc(depositRequests.createdAt));

      // Group receipts by warehouse
      const warehouseMap = new Map<string, {
        warehouseId: string;
        warehouseName: string;
        warehouseInfo: typeof CERTIFIED_WAREHOUSES[string] | null;
        receipts: typeof receipts;
        commodityGroups: Map<string, {
          commodity: string;
          grade: string | null;
          gradeLabel: string;
          totalQuantity: number;
          unit: string;
          receiptCount: number;
          activeCount: number;
          pledgedCount: number;
          latestDepositDate: Date;
          estimatedValueUsd: number;
        }>;
      }>();

      for (const r of receipts) {
        const wid = r.warehouseId ?? "UNKNOWN";
        const wname = r.warehouseName ?? "Unknown Warehouse";

        if (!warehouseMap.has(wid)) {
          warehouseMap.set(wid, {
            warehouseId: wid,
            warehouseName: wname,
            warehouseInfo: CERTIFIED_WAREHOUSES[wid] ?? null,
            receipts: [],
            commodityGroups: new Map(),
          });
        }

        const wEntry = warehouseMap.get(wid)!;
        wEntry.receipts.push(r);

        // Group by commodity + grade
        const groupKey = `${r.commodity}::${r.grade ?? "UNGRADED"}`;
        const qty = parseFloat(r.quantity ?? "0");
        const valueUsd = parseFloat(r.valueUsd ?? "0");

        if (!wEntry.commodityGroups.has(groupKey)) {
          wEntry.commodityGroups.set(groupKey, {
            commodity: r.commodity,
            grade: r.grade,
            gradeLabel: gradeLabel(r.grade),
            totalQuantity: 0,
            unit: r.unit,
            receiptCount: 0,
            activeCount: 0,
            pledgedCount: 0,
            latestDepositDate: r.depositDate,
            estimatedValueUsd: 0,
          });
        }

        const cg = wEntry.commodityGroups.get(groupKey)!;
        cg.totalQuantity += qty;
        cg.receiptCount += 1;
        cg.estimatedValueUsd += valueUsd;
        if (r.status === "ACTIVE") cg.activeCount += 1;
        if (r.status === "PLEDGED") cg.pledgedCount += 1;
        if (r.depositDate > cg.latestDepositDate) cg.latestDepositDate = r.depositDate;
      }

      // Build serialisable output
      const warehouses = Array.from(warehouseMap.values()).map(w => ({
        warehouseId: w.warehouseId,
        warehouseName: w.warehouseName,
        warehouseInfo: w.warehouseInfo,
        totalReceipts: w.receipts.length,
        commodityGroups: Array.from(w.commodityGroups.values()),
        receipts: w.receipts.map(r => ({
          id: r.id,
          receiptNumber: r.receiptNumber,
          commodity: r.commodity,
          grade: r.grade,
          gradeLabel: gradeLabel(r.grade),
          quantity: r.quantity,
          unit: r.unit,
          status: r.status,
          depositDate: r.depositDate,
          expiryDate: r.expiryDate,
          valueUsd: r.valueUsd,
          notes: r.notes,
        })),
      }));

      // Summary stats
      const totalActiveReceipts = receipts.filter(r => r.status === "ACTIVE").length;
      const totalPledgedReceipts = receipts.filter(r => r.status === "PLEDGED").length;
      const totalValueUsd = receipts.reduce((s, r) => s + parseFloat(r.valueUsd ?? "0"), 0);

      return {
        warehouses,
        summary: {
          totalReceipts: receipts.length,
          activeReceipts: totalActiveReceipts,
          pledgedReceipts: totalPledgedReceipts,
          totalValueUsd,
          pendingDeposits: deposits.length,
        },
      };
    }),

  /**
   * Pledge a warehouse receipt as collateral.
   * Only ACTIVE receipts can be pledged. PLEDGED receipts cannot be redeemed.
   */
  pledgeReceipt: protectedProcedure
    .input(z.object({
      receiptId: z.number().int().positive(),
      purpose: z.string().max(256).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      const [receipt] = await db
        .select()
        .from(warehouseReceipts)
        .where(eq(warehouseReceipts.id, input.receiptId))
        .limit(1);

      if (!receipt) throw new TRPCError({ code: "NOT_FOUND", message: "Receipt not found" });
      if (receipt.userId !== ctx.user.id) throw new TRPCError({ code: "FORBIDDEN" });
      if (receipt.status !== "ACTIVE") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Cannot pledge receipt with status ${receipt.status}. Only ACTIVE receipts can be pledged.`,
        });
      }

      const notes = input.purpose
        ? `Pledged as collateral: ${input.purpose}`
        : "Pledged as collateral";

      const [updated] = await db
        .update(warehouseReceipts)
        .set({
          status: "PLEDGED",
          notes: receipt.notes ? `${receipt.notes} | ${notes}` : notes,
          updatedAt: new Date(),
        })
        .where(eq(warehouseReceipts.id, input.receiptId))
        .returning();

      return updated;
    }),

  /**
   * Unpledge a warehouse receipt, returning it to ACTIVE status.
   * Only PLEDGED receipts can be unpledged.
   */
  unpledgeReceipt: protectedProcedure
    .input(z.object({ receiptId: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      const [receipt] = await db
        .select()
        .from(warehouseReceipts)
        .where(eq(warehouseReceipts.id, input.receiptId))
        .limit(1);

      if (!receipt) throw new TRPCError({ code: "NOT_FOUND", message: "Receipt not found" });
      if (receipt.userId !== ctx.user.id) throw new TRPCError({ code: "FORBIDDEN" });
      if (receipt.status !== "PLEDGED") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Cannot unpledge receipt with status ${receipt.status}. Only PLEDGED receipts can be unpledged.`,
        });
      }

      const [updated] = await db
        .update(warehouseReceipts)
        .set({
          status: "ACTIVE",
          notes: receipt.notes ? `${receipt.notes} | Unpledged at ${new Date().toISOString()}` : null,
          updatedAt: new Date(),
        })
        .where(eq(warehouseReceipts.id, input.receiptId))
        .returning();

      return updated;
    }),

  /**
   * Returns the QR code payload (JSON string) for a single warehouse receipt.
   * The QR encodes the receipt number, commodity, grade, quantity, warehouse, and issue date.
   * The frontend renders this string into an actual QR image using the qrcode library.
   */
  receiptQrData: protectedProcedure
    .input(z.object({ receiptId: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });

      const result = await db
        .select()
        .from(warehouseReceipts)
        .where(eq(warehouseReceipts.id, input.receiptId))
        .limit(1);

      const receipt = result[0];
      if (!receipt) throw new TRPCError({ code: "NOT_FOUND", message: "Receipt not found" });
      if (receipt.userId !== ctx.user.id && ctx.user.role !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN" });
      }

      const warehouseInfo = CERTIFIED_WAREHOUSES[receipt.warehouseId ?? ""] ?? null;

      const payload = {
        type: "NEXCOM_EWR",
        version: "1.0",
        receiptNumber: receipt.receiptNumber,
        commodity: receipt.commodity,
        grade: receipt.grade ?? "UNGRADED",
        gradeLabel: gradeLabel(receipt.grade),
        quantity: receipt.quantity,
        unit: receipt.unit,
        warehouseId: receipt.warehouseId,
        warehouseName: receipt.warehouseName ?? warehouseInfo?.name ?? "Unknown",
        warehouseLocation: warehouseInfo?.location ?? null,
        certificationBody: warehouseInfo?.certBody ?? "NEXCOM",
        depositDate: receipt.depositDate.toISOString(),
        expiryDate: receipt.expiryDate?.toISOString() ?? null,
        status: receipt.status,
        valueUsd: receipt.valueUsd,
        issuedBy: "NEXCOM Exchange",
        verifyUrl: `https://nexcom.ng/verify/${receipt.receiptNumber}`,
      };

      return {
        receiptNumber: receipt.receiptNumber,
        qrPayload: JSON.stringify(payload),
        receipt: {
          id: receipt.id,
          commodity: receipt.commodity,
          grade: receipt.grade,
          gradeLabel: gradeLabel(receipt.grade),
          quantity: receipt.quantity,
          unit: receipt.unit,
          status: receipt.status,
          depositDate: receipt.depositDate,
          warehouseName: receipt.warehouseName ?? warehouseInfo?.name ?? "Unknown",
          warehouseLocation: warehouseInfo?.location ?? null,
        },
      };
    }),
});
