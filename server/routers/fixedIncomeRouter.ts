import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { createLedgerTransfer } from "../gatewayClient";
import { router, publicProcedure, protectedProcedure } from "../_core/trpc";
import { getDb } from "../db";
import {
  fixedIncomeInstruments,
  fixedIncomeTrades,
} from "../../drizzle/schema";
import { eq, desc, and, gte, lte } from "drizzle-orm";
import { writeAuditLog } from "../audit";
import { requireExchangeAdmin } from "../_core/permify";
import { triggerTemporalWorkflow } from "../temporal/temporalClient";
import { daprPublishTradeSettled } from "../dapr/daprClient";
import { publishFluvioEvent, FLUVIO_TOPICS } from "../fluvio/fluvioClient";
import { ingestTrade } from "../lakehouse";
import { cacheDel, CacheKeys } from "../cache";
import { withSpan, recordEvent, setSpanAttrs } from "../telemetry/otel";

export const fixedIncomeRouter = router({
  // List all instruments
  list: publicProcedure
    .input(z.object({
      type: z.string().optional(),
      status: z.string().optional(),
    }).optional())
    .query(async ({ input }) => {
      const db = await getDb();
      setSpanAttrs({ "fixed_income.operation": "purchase" });
      if (!db) return DEMO_INSTRUMENTS;
      try {
        const rows = await db.select().from(fixedIncomeInstruments)
          .orderBy(desc(fixedIncomeInstruments.createdAt))
          .limit(100);
        return rows.length > 0 ? rows : DEMO_INSTRUMENTS;
      } catch { return DEMO_INSTRUMENTS; }
    }),

  // Get single instrument
  get: publicProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return DEMO_INSTRUMENTS.find(i => i.id === input.id) ?? null;
      try {
        const rows = await db.select().from(fixedIncomeInstruments)
          .where(eq(fixedIncomeInstruments.id, input.id)).limit(1);
        return rows[0] ?? null;
      } catch { return null; }
    }),

  // Place a buy order (simplified)
  buy: protectedProcedure
    .input(z.object({
      instrumentId: z.number(),
      faceValueNgn: z.string().trim(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
            if (!db) return { success: true };
      try {
        const instr = await db.select().from(fixedIncomeInstruments)
          .where(eq(fixedIncomeInstruments.id, input.instrumentId)).limit(1);
        if (!instr[0]) throw new TRPCError({ code: "NOT_FOUND", message: "Instrument not found" });
        const [trade] = await db.insert(fixedIncomeTrades).values({
          instrumentId: input.instrumentId,
          buyerUserId: ctx.user.id,
          faceValueNgn: input.faceValueNgn,
          priceNgn: instr[0].lastPriceNgn ?? instr[0].faceValueNgn,
          yieldPct: instr[0].yieldPct,
        }).returning();
      // TigerBeetle: bond purchase settlement (code 1 = trade_settlement)
      void createLedgerTransfer({
        debitAccountId: `settlement-${ctx.user.id}`,
        creditAccountId: "nexcom-fixed-income-pool",
        amount: Math.round(Number(input.faceValueNgn ?? 0) * 100),
        code: 1,
      }).catch(() => null);

        // Middleware: Temporal + Dapr + Fluvio + Lakehouse + Redis
        void (async () => {
          try {
            await triggerTemporalWorkflow("TradeSettlementWorkflow", { tradeId: trade.id, userId: ctx.user.id, amount: Number(input.faceValueNgn), type: "fixed_income" }, `fixed-income-${trade.id}`);
            await daprPublishTradeSettled({ settlementId: String(trade.id), buyerUserId: ctx.user.id, sellerUserId: 0, symbol: instr[0].ticker, amount: Number(input.faceValueNgn), currency: "NGN" });
            await publishFluvioEvent(FLUVIO_TOPICS.SETTLEMENT_INITIATED, { type: "FIXED_INCOME_BUY", tradeId: trade.id, userId: ctx.user.id, symbol: instr[0].ticker, faceValue: input.faceValueNgn });
            void ingestTrade({ tradeId: String(trade.id), buyOrderId: trade.id, sellOrderId: 0, buyerUserId: ctx.user.id, sellerUserId: 0, symbol: instr[0].ticker, quantity: "1", price: input.faceValueNgn, totalValue: input.faceValueNgn, currency: "NGN" });
            cacheDel(CacheKeys.portfolioSummary(ctx.user.id)).catch(() => {});
          } catch { /* non-blocking */ }
        })();
        return { success: true, tradeId: trade.id };
      } catch (e: any) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: e instanceof Error ? e.message : String(e) });
      }
    }),

  // Get trade history for user
  myTrades: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) return [];
    try {
      return await db.select().from(fixedIncomeTrades)
        .where(eq(fixedIncomeTrades.buyerUserId, ctx.user.id))
        .orderBy(desc(fixedIncomeTrades.tradeDate))
        .limit(50);
    } catch { return []; }
  }),
});

// ─── Demo data ────────────────────────────────────────────────────────────────
const DEMO_INSTRUMENTS = [
  {
    id: 1, isin: "NG0006751693", ticker: "FGN-BOND-2027", name: "FGN Bond 2027",
    issuerName: "Federal Government of Nigeria", type: "TREASURY_BOND" as const,
    status: "ACTIVE" as const, faceValueNgn: "1000000", couponRatePct: "12.5000",
    yieldPct: "13.2500", maturityDate: new Date("2027-06-15"),
    issueDate: new Date("2022-06-15"), totalIssuanceNgn: "500000000000",
    outstandingNgn: "480000000000", creditRating: "B+", ratingAgency: "Fitch",
    lastPriceNgn: "985000", prospectusUrl: null, collateralDescription: null,
    createdAt: new Date(), updatedAt: new Date(),
  },
  {
    id: 2, isin: "NG0003751234", ticker: "NEXCOM-ABCP-001", name: "NEXCOM Agri ABCP Series 1",
    issuerName: "NEXCOM Capital Markets", type: "ABCP" as const,
    status: "ACTIVE" as const, faceValueNgn: "5000000", couponRatePct: "14.7500",
    yieldPct: "14.7500", maturityDate: new Date("2025-12-31"),
    issueDate: new Date("2025-06-01"), totalIssuanceNgn: "25000000000",
    outstandingNgn: "22000000000", creditRating: "A-", ratingAgency: "Agusto",
    lastPriceNgn: "4950000", prospectusUrl: null, collateralDescription: "Warehouse Receipts — Maize, Soybean, Sorghum",
    createdAt: new Date(), updatedAt: new Date(),
  },
  {
    id: 3, isin: "NG0009876543", ticker: "DANGCEM-BOND-2028", name: "Dangote Cement Bond 2028",
    issuerName: "Dangote Cement PLC", type: "CORPORATE_BOND" as const,
    status: "ACTIVE" as const, faceValueNgn: "1000000", couponRatePct: "15.0000",
    yieldPct: "15.8000", maturityDate: new Date("2028-03-31"),
    issueDate: new Date("2023-03-31"), totalIssuanceNgn: "100000000000",
    outstandingNgn: "95000000000", creditRating: "AA-", ratingAgency: "Agusto",
    lastPriceNgn: "960000", prospectusUrl: null, collateralDescription: null,
    createdAt: new Date(), updatedAt: new Date(),
  },
  {
    id: 4, isin: "NG0001234567", ticker: "NEXCOM-AGRI-BOND-2026", name: "NEXCOM Green Agri Bond 2026",
    issuerName: "NEXCOM Exchange", type: "AGRI_BOND" as const,
    status: "ACTIVE" as const, faceValueNgn: "500000", couponRatePct: "13.0000",
    yieldPct: "13.5000", maturityDate: new Date("2026-09-30"),
    issueDate: new Date("2024-09-30"), totalIssuanceNgn: "10000000000",
    outstandingNgn: "9500000000", creditRating: "BBB+", ratingAgency: "GCR",
    lastPriceNgn: "490000", prospectusUrl: null, collateralDescription: "Agri commodity warehouse receipts",
    createdAt: new Date(), updatedAt: new Date(),
  },
  {
    id: 5, isin: "NG0007654321", ticker: "CBN-TBILL-91D", name: "CBN Treasury Bill 91-Day",
    issuerName: "Central Bank of Nigeria", type: "TREASURY_BILL" as const,
    status: "ACTIVE" as const, faceValueNgn: "1000000", couponRatePct: null,
    yieldPct: "22.5000", maturityDate: new Date("2025-06-15"),
    issueDate: new Date("2025-03-15"), totalIssuanceNgn: "200000000000",
    outstandingNgn: "200000000000", creditRating: "AAA", ratingAgency: "CBN",
    lastPriceNgn: "945000", prospectusUrl: null, collateralDescription: null,
    createdAt: new Date(), updatedAt: new Date(),
  },
];
