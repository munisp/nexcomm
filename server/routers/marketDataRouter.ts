/**
 * marketDataRouter.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Proxies real-time market data from the Rust matching engine:
 *   - Order book depth (bids/asks) per symbol
 *   - Exchange status (circuit breakers, session state)
 *   - Futures contracts and specs
 *   - Options chain and Black-Scholes pricing
 *   - Surveillance alerts (admin)
 *   - Clearing positions and margins
 *   - Market maker quotes
 *   - Index values
 *   - Corporate actions
 *   - Trade fee calculator
 *
 * Falls back gracefully when the Rust engine is not running (dev/test).
 */
import { z } from "zod";
import { publicProcedure, protectedProcedure, router } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import {
import { writeAuditLog } from "../audit";
  getMarketDepth,
  listSymbols,
  getExchangeStatus,
  listFuturesContracts,
  getFuturesContract,
  listFuturesSpecs,
  listOptionsContracts,
  getOptionChain,
  priceOption,
  getClearingMargins,
  getClearingPositions,
  getGuaranteeFund,
  getSurveillanceAlerts,
  checkPositionLimit,
  getDailySurveillanceReport,
  listWarehouses,
  getWarehousesForCommodity,
  getAccountReceipts,
  issueWarehouseReceipt,
  listWarehouseStocks,
  getCommodityGrades,
  getAuditEntries,
  checkAuditIntegrity,
  listMarketMakers,
  getMarketMaker,
  getMarketMakerPerformance,
  submitMarketMakerQuote,
  listIndices,
  getIndexValues,
  getIndex,
  getIndexValue,
  listCorporateActions,
  getCorporateAction,
  listBrokers,
  getBroker,
  calculateTradeFees,
  getFixSessions,
  sendFixMessage,
  getCircuitBreakerStatus,
  startAuction,
  checkMatchingEngineHealth,
  initiateSettlement,
  getSettlement,
  getSettlementStatus,
  finalizeSettlement,
  getLedgerBalance,
  getLedgerAccounts,
  createLedgerAccount,
  createLedgerTransfer,
} from "../matchingEngineClient";

// ─── Health ───────────────────────────────────────────────────────────────────

export const marketDataRouter = router({
  health: publicProcedure.query(async () => {
    const alive = await checkMatchingEngineHealth();
    return { alive, timestamp: new Date().toISOString() };
  }),

  // ─── Exchange Status ────────────────────────────────────────────────────────

  exchangeStatus: publicProcedure.query(async () => {
    try {
      return await getExchangeStatus();
    } catch {
      return { status: "unavailable", error: "Matching engine offline" };
    }
  }),

  // ─── Order Book Depth ───────────────────────────────────────────────────────

  depth: publicProcedure
    .input(z.object({ symbol: z.string().min(1).max(64) }))
    .query(async ({ input }) => {
      try {
        return await getMarketDepth(input.symbol);
      } catch (e) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: `No order book found for ${input.symbol}: ${(e as Error).message}`,
        });
      }
    }),

  symbols: publicProcedure.query(async () => {
    try {
      return await listSymbols();
    } catch {
      return [] as string[];
    }
  }),

  // ─── Futures ────────────────────────────────────────────────────────────────

  futuresContracts: publicProcedure.query(async () => {
    try {
      return await listFuturesContracts();
    } catch {
      return [];
    }
  }),

  futuresContract: publicProcedure
    .input(z.object({ symbol: z.string().trim() }))
    .query(async ({ input }) => {
      try {
        return await getFuturesContract(input.symbol);
      } catch (e) {
        throw new TRPCError({ code: "NOT_FOUND", message: (e as Error).message });
      }
    }),

  futuresSpecs: publicProcedure.query(async () => {
    try {
      return await listFuturesSpecs();
    } catch {
      return [];
    }
  }),

  // ─── Options ────────────────────────────────────────────────────────────────

  optionsContracts: publicProcedure.query(async () => {
    try {
      return await listOptionsContracts();
    } catch {
      return [];
    }
  }),

  optionChain: publicProcedure
    .input(z.object({ underlying: z.string().trim() }))
    .query(async ({ input }) => {
      try {
        return await getOptionChain(input.underlying);
      } catch {
        return [];
      }
    }),

  priceOption: publicProcedure
    .input(z.object({
      underlyingPrice: z.number().positive(),
      strike: z.number().positive(),
      timeToExpiry: z.number().positive(),
      riskFreeRate: z.number(),
      volatility: z.number().positive(),
      optionType: z.enum(["CALL", "PUT"]),
    }))
    .query(async ({ input }) => {
      try {
        return await priceOption({
          underlying_price: input.underlyingPrice,
          strike: input.strike,
          time_to_expiry: input.timeToExpiry,
          risk_free_rate: input.riskFreeRate,
          volatility: input.volatility,
          option_type: input.optionType,
        });
      } catch (e) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: (e as Error).message });
      }
    }),

  // ─── Clearing ───────────────────────────────────────────────────────────────

  clearingMargins: protectedProcedure
    .input(z.object({ accountId: z.string().optional() }))
    .query(async ({ ctx, input }) => {
      const accountId = input.accountId ?? `USER-${ctx.user.id}`;
      try {
        return await getClearingMargins(accountId);
      } catch {
        return null;
      }
    }),

  clearingPositions: protectedProcedure
    .input(z.object({ accountId: z.string().optional() }))
    .query(async ({ ctx, input }) => {
      const accountId = input.accountId ?? `USER-${ctx.user.id}`;
      try {
        return await getClearingPositions(accountId);
      } catch {
        return [];
      }
    }),

  guaranteeFund: protectedProcedure.query(async () => {
    try {
      return await getGuaranteeFund();
    } catch {
      return null;
    }
  }),

  // ─── Surveillance ───────────────────────────────────────────────────────────

  surveillanceAlerts: protectedProcedure.query(async ({ ctx }) => {
    if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
    try {
      return await getSurveillanceAlerts();
    } catch {
      return [];
    }
  }),

  positionLimit: protectedProcedure
    .input(z.object({ symbol: z.string().trim(), accountId: z.string().optional() }))
    .query(async ({ ctx, input }) => {
      const accountId = input.accountId ?? `USER-${ctx.user.id}`;
      try {
        return await checkPositionLimit(accountId, input.symbol);
      } catch {
        return null;
      }
    }),

  dailySurveillanceReport: protectedProcedure.query(async ({ ctx }) => {
    if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
    try {
      return await getDailySurveillanceReport();
    } catch {
      return null;
    }
  }),

  // ─── Warehouses ─────────────────────────────────────────────────────────────

  warehouses: publicProcedure.query(async () => {
    try {
      return await listWarehouses();
    } catch {
      return [];
    }
  }),

  warehousesByCommodity: publicProcedure
    .input(z.object({ commodity: z.string().trim() }))
    .query(async ({ input }) => {
      try {
        return await getWarehousesForCommodity(input.commodity);
      } catch {
        return [];
      }
    }),

  accountReceipts: protectedProcedure
    .input(z.object({ accountId: z.string().optional() }))
    .query(async ({ ctx, input }) => {
      const accountId = input.accountId ?? `USER-${ctx.user.id}`;
      try {
        return await getAccountReceipts(accountId);
      } catch {
        return [];
      }
    }),

  issueReceipt: protectedProcedure
    .input(z.object({
      commodity: z.string().trim(),
      quantity: z.number().positive(),
      grade: z.string().trim(),
      warehouseId: z.string().trim(),
      accountId: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const accountId = input.accountId ?? `USER-${ctx.user.id}`;
      try {
        return await issueWarehouseReceipt({
          account_id: accountId,
          commodity: input.commodity,
          quantity: input.quantity,
          grade: input.grade,
          warehouse_id: input.warehouseId,
        });
      } catch (e) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: (e as Error).message });
      }
    }),

  warehouseStocks: publicProcedure.query(async () => {
    try {
      return await listWarehouseStocks();
    } catch {
      return [];
    }
  }),

  commodityGrades: publicProcedure
    .input(z.object({ commodity: z.string().trim() }))
    .query(async ({ input }) => {
      try {
        return await getCommodityGrades(input.commodity);
      } catch {
        return [];
      }
    }),

  // ─── Audit ──────────────────────────────────────────────────────────────────

  auditEntries: protectedProcedure
    .input(z.object({ limit: z.number().default(50), offset: z.number().default(0) }))
    .query(async ({ ctx, input }) => {
      if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
      try {
        return await getAuditEntries({ limit: input.limit, offset: input.offset });
      } catch {
        return [];
      }
    }),

  auditIntegrity: protectedProcedure.query(async ({ ctx }) => {
    if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
    try {
      return await checkAuditIntegrity();
    } catch {
      return null;
    }
  }),

  // ─── Market Makers ──────────────────────────────────────────────────────────

  marketMakers: publicProcedure.query(async () => {
    try {
      return await listMarketMakers();
    } catch {
      return [];
    }
  }),

  marketMaker: publicProcedure
    .input(z.object({ id: z.string().trim() }))
    .query(async ({ input }) => {
      try {
        return await getMarketMaker(input.id);
      } catch (e) {
        throw new TRPCError({ code: "NOT_FOUND", message: (e as Error).message });
      }
    }),

  marketMakerPerformance: protectedProcedure
    .input(z.object({ id: z.string().trim() }))
    .query(async ({ input }) => {
      try {
        return await getMarketMakerPerformance(input.id);
      } catch {
        return null;
      }
    }),

  submitQuote: protectedProcedure
    .input(z.object({
      marketMakerId: z.string().trim(),
      symbol: z.string().trim(),
      bidPrice: z.number().positive(),
      askPrice: z.number().positive(),
      bidSize: z.number().positive(),
      askSize: z.number().positive(),
    }))
    .mutation(async ({ input }) => {
      try {
        return await submitMarketMakerQuote({
          market_maker_id: input.marketMakerId,
          symbol: input.symbol,
          bid_price: input.bidPrice,
          ask_price: input.askPrice,
          bid_size: input.bidSize,
          ask_size: input.askSize,
        });
      } catch (e) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: (e as Error).message });
      }
    }),

  // ─── Indices ────────────────────────────────────────────────────────────────

  indices: publicProcedure.query(async () => {
    try {
      return await listIndices();
    } catch {
      return [];
    }
  }),

  indexValues: publicProcedure.query(async () => {
    try {
      return await getIndexValues();
    } catch {
      return [];
    }
  }),

  index: publicProcedure
    .input(z.object({ id: z.string().trim() }))
    .query(async ({ input }) => {
      try {
        return await getIndex(input.id);
      } catch (e) {
        throw new TRPCError({ code: "NOT_FOUND", message: (e as Error).message });
      }
    }),

  indexValue: publicProcedure
    .input(z.object({ id: z.string().trim() }))
    .query(async ({ input }) => {
      try {
        return await getIndexValue(input.id);
      } catch {
        return null;
      }
    }),

  // ─── Corporate Actions ──────────────────────────────────────────────────────

  corporateActions: publicProcedure.query(async () => {
    try {
      return await listCorporateActions();
    } catch {
      return [];
    }
  }),

  corporateAction: publicProcedure
    .input(z.object({ id: z.string().trim() }))
    .query(async ({ input }) => {
      try {
        return await getCorporateAction(input.id);
      } catch (e) {
        throw new TRPCError({ code: "NOT_FOUND", message: (e as Error).message });
      }
    }),

  // ─── Brokers ────────────────────────────────────────────────────────────────

  brokers: publicProcedure.query(async () => {
    try {
      return await listBrokers();
    } catch {
      return [];
    }
  }),

  broker: publicProcedure
    .input(z.object({ id: z.string().trim() }))
    .query(async ({ input }) => {
      try {
        return await getBroker(input.id);
      } catch (e) {
        throw new TRPCError({ code: "NOT_FOUND", message: (e as Error).message });
      }
    }),

  // ─── Fees ───────────────────────────────────────────────────────────────────

  calculateFees: publicProcedure
    .input(z.object({
      tradeValue: z.number().positive(),
      assetClass: z.string().trim(),
      isMaker: z.boolean().default(true),
    }))
    .query(async ({ input }) => {
      try {
        return await calculateTradeFees({
          trade_value: input.tradeValue,
          asset_class: input.assetClass,
          is_maker: input.isMaker,
        });
      } catch {
        return null;
      }
    }),

  // ─── FIX Gateway ────────────────────────────────────────────────────────────

  fixSessions: protectedProcedure.query(async ({ ctx }) => {
    if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
    try {
      return await getFixSessions();
    } catch {
      return [];
    }
  }),

  sendFixMessage: protectedProcedure
    .input(z.object({
      sessionId: z.string().trim(),
      messageType: z.string().trim(),
      fields: z.record(z.string().trim(), z.string().trim()),
    }))
    .mutation(async ({ ctx, input }) => {
      if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
      try {
        return await sendFixMessage({
          session_id: input.sessionId,
          message_type: input.messageType,
          fields: input.fields as Record<string, string>,
        });
      } catch (e) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: (e as Error).message });
      }
    }),

  // ─── Circuit Breaker ────────────────────────────────────────────────────────

  circuitBreakerStatus: publicProcedure
    .input(z.object({ symbol: z.string().optional() }))
    .query(async ({ input }) => {
      try {
        return await getCircuitBreakerStatus(input.symbol);
      } catch {
        return null;
      }
    }),

  startAuction: protectedProcedure
    .input(z.object({
      symbol: z.string().trim(),
      auctionType: z.enum(["OPENING", "CLOSING", "INTRADAY"]),
      durationSecs: z.number().int().positive().default(300),
    }))
    .mutation(async ({ ctx, input }) => {
      if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
      try {
        return await startAuction({
          symbol: input.symbol,
          auction_type: input.auctionType,
          duration_secs: input.durationSecs,
        });
      } catch (e) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: (e as Error).message });
      }
    }),

  // ─── Settlement Engine (TigerBeetle) ────────────────────────────────────────

  initiateSettlement: protectedProcedure
    .input(z.object({
      tradeId: z.string().trim(),
      buyerId: z.string().trim(),
      sellerId: z.string().trim(),
      amount: z.string().trim(),
      currency: z.string().default("NGN"),
      assetType: z.string().trim(),
      quantity: z.string().trim(),
      price: z.string().trim(),
    }))
    .mutation(async ({ ctx, input }) => {
      if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
      try {
        return await initiateSettlement({
          trade_id: input.tradeId,
          buyer_id: input.buyerId,
          seller_id: input.sellerId,
          amount: input.amount,
          currency: input.currency,
          asset_type: input.assetType,
          quantity: input.quantity,
          price: input.price,
        });
      } catch (e) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: (e as Error).message });
      }
    }),

  settlementStatus: protectedProcedure
    .input(z.object({ id: z.string().trim() }))
    .query(async ({ input }) => {
      try {
        return await getSettlementStatus(input.id);
      } catch (e) {
        throw new TRPCError({ code: "NOT_FOUND", message: (e as Error).message });
      }
    }),

  finalizeSettlement: protectedProcedure
    .input(z.object({ settlementId: z.string().trim() }))
    .mutation(async ({ ctx, input }) => {
      if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
      try {
        return await finalizeSettlement({ settlement_id: input.settlementId });
      } catch (e) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: (e as Error).message });
      }
    }),

  // ─── Ledger ─────────────────────────────────────────────────────────────────

  ledgerBalance: protectedProcedure
    .input(z.object({ accountId: z.string().optional() }))
    .query(async ({ ctx, input }) => {
      const accountId = input.accountId ?? `USER-${ctx.user.id}`;
      try {
        return await getLedgerBalance(accountId);
      } catch {
        return null;
      }
    }),

  ledgerAccounts: protectedProcedure
    .input(z.object({ userId: z.string().optional() }))
    .query(async ({ ctx, input }) => {
      const userId = input.userId ?? String(ctx.user.id);
      try {
        return await getLedgerAccounts(userId);
      } catch {
        return [];
      }
    }),

  createLedgerAccount: protectedProcedure
    .input(z.object({
      currency: z.string().default("NGN"),
      accountType: z.enum(["Trading", "Settlement", "Margin", "Fee", "Escrow"]).default("Trading"),
      userId: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const userId = input.userId ?? String(ctx.user.id);
      try {
        return await createLedgerAccount({
          user_id: userId,
          currency: input.currency,
          account_type: input.accountType,
        });
      } catch (e) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: (e as Error).message });
      }
    }),

  createLedgerTransfer: protectedProcedure
    .input(z.object({
      debitAccountId: z.string().trim(),
      creditAccountId: z.string().trim(),
      amount: z.number().positive(),
      currency: z.string().default("NGN"),
      reference: z.string().trim(),
    }))
    .mutation(async ({ ctx: _ctx, input }) => {
      try {
        return await createLedgerTransfer({
          debit_account_id: input.debitAccountId,
          credit_account_id: input.creditAccountId,
          amount: input.amount,
          currency: input.currency,
          reference: input.reference,
        });
      } catch (e) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: (e as Error).message });
      }
    }),
});
