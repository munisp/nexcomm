import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, protectedProcedure, adminProcedure, router } from "./_core/trpc";
import { getDb } from "./db";
import { eq, desc, and } from "drizzle-orm";
import { z } from "zod";
import {
  farmerProfiles,
  traderProfiles,
  brokerProfiles,
  warehouseOperatorProfiles,
  marketMakerOnboardingProfiles,
  kycAuditLog,
} from "../drizzle/schema";

import { ordersRouter } from "./routers/orders";
import { healthRouter } from "./routers/health";
import { onboardingRouter } from "./routers/onboarding";
import { watchlistRouter } from "./routers/watchlist";
import { priceAlertsRouter } from "./routers/priceAlerts";
import { profileRouter } from "./routers/profile";
import { portfolioRouter } from "./routers/portfolio";
import { portfolioRouter as portfolioAnalyticsRouter } from "./routers/portfolioRouter";
import { notificationsRouter } from "./routers/notificationsRouter";
import { receiptsRouter } from "./routers/receipts";
import { depositsRouter } from "./routers/depositsRouter";
import { deliveryRouter } from "./routers/deliveryRouter";
import { analyticsRouter } from "./routers/analyticsRouter";
import { apiKeysRouter } from "./routers/apiKeysRouter";
import { settlementsRouter } from "./routers/settlementsRouter";
import { preferencesRouter } from "./routers/preferencesRouter";
import { commoditiesRouter } from "./routers/commodities";
import { warehouseInventoryRouter } from "./routers/warehouseInventory";
import { cooperativeRouter } from "./routers/cooperative";
import { marginRouter } from "./routers/marginRouter";
import { disputesRouter } from "./routers/disputesRouter";
import { securityRouter } from "./routers/securityRouter";
import { withdrawalVerificationRouter } from "./routers/withdrawalVerificationRouter";
import { webhookRouter } from "./routers/webhookRouter";
import { ipAllowlistRouter } from "./routers/ipAllowlistRouter";
import { totpRouter } from "./routers/totpRouter";
import { deviceSessionRouter } from "./routers/deviceSessionRouter";
import { velocityLimitRouter } from "./routers/velocityLimitRouter";
import { amlRouter } from "./routers/amlRouter";
import { settlementEngineRouter } from "./routers/settlementEngineRouter";
import { regulatoryReportingRouter } from "./routers/regulatoryReportingRouter";
import { marketMakerRouter } from "./routers/marketMakerRouter";
import { clearingHouseRouter } from "./routers/clearingHouseRouter";
import { investorRelationsRouter } from "./routers/investorRelationsRouter";
import { surveillanceRouter } from "./routers/surveillanceRouter";
import { derivativesRouter } from "./routers/derivativesRouter";
import { optionsRouter } from "./routers/optionsRouter";
import { farmerRouter } from "./routers/farmerRouter";
import { traderRouter } from "./routers/traderRouter";
import { brokerRouter } from "./routers/brokerRouter";
import { warehouseOpRouter } from "./routers/warehouseOpRouter";
import { marketMakerOnboardingRouter } from "./routers/marketMakerOnboardingRouter";
import { kycAnalysisRouter } from "./routers/kycAnalysisRouter";
import { livePricesRouter } from "./routers/livePricesRouter";
import { corporateActionsRouter } from "./routers/corporateActionsRouter";
import { participantPerformanceRouter } from "./routers/participantPerformanceRouter";
import { marketDataRouter } from "./routers/marketDataRouter";
import { riskManagementRouter } from "./routers/riskManagement";
import { tradingEngineRouter } from "./routers/tradingEngine";
import { kycServiceRouter } from "./routers/kycServiceRouter";
import { aiMlRouter } from "./routers/aiMlRouter";
import { blockchainRouter } from "./routers/blockchainRouter";
import { analyticsEngineRouter } from "./routers/analyticsEngineRouter";
import { lakehouseRouter } from "./routers/lakehouseRouter";
import { mojaloopRouter } from "./routers/mojaloopRouter";
import { mojaloopTiersRouter } from "./routers/mojaloopTiersRouter";
import { dfspKycRouter } from "./routers/dfspKycRouter";
import { userManagementRouter } from "./routers/userManagementRouter";
import { notificationServiceRouter } from "./routers/notificationServiceRouter";
import { webauthnRouter } from "./routers/webauthnRouter";
import { searchRouter } from "./routers/searchRouter";
import { engineHARouter } from "./routers/engineHARouter";
import { pushNotificationsRouter } from "./routers/pushNotificationsRouter";
import { warehouseRouter } from "./routers/warehouseRouter";
import { fixedIncomeRouter } from "./routers/fixedIncomeRouter";
import { workbenchRouter } from "./routers/workbenchRouter";
import { abcpRouter } from "./routers/abcpRouter";
import { inputFinancingRouter, fieldAgentRouter } from "./routers/inputFinancingRouter";
import { cropReportsRouter } from "./routers/cropReportsRouter";
import { bankingRouter } from "./routers/bankingRouter";
import { ussdRouter } from "./routers/ussd";
import { whatsappRouter } from "./routers/whatsapp";
import { telegramRouter } from "./routers/telegram";

export const appRouter = router({
  // if you need to use socket.io, read and register route in server/_core/index.ts
  // all api should start with '/api/' so that the gateway can route correctly
  system: systemRouter,
  engineHA: engineHARouter,
  pushNotifications: pushNotificationsRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
  }),
  orders: ordersRouter,
  health: healthRouter,
  onboarding: onboardingRouter,
  watchlist: watchlistRouter,
  priceAlerts: priceAlertsRouter,
  profile: profileRouter,
  portfolio: portfolioRouter,
  notifications: notificationsRouter,
  receipts: receiptsRouter,
  deposits: depositsRouter,
  delivery: deliveryRouter,
  analytics: analyticsRouter,
  apiKeys: apiKeysRouter,
  settlements: settlementsRouter,
  preferences: preferencesRouter,
  commodities: commoditiesRouter,
  warehouseInventory: warehouseInventoryRouter,
  cooperative: cooperativeRouter,
  margin: marginRouter,
  disputes: disputesRouter,
  security: securityRouter,
  withdrawalVerification: withdrawalVerificationRouter,
  webhook: webhookRouter,
  ipAllowlist: ipAllowlistRouter,
  totp: totpRouter,
  deviceSession: deviceSessionRouter,
  velocityLimit: velocityLimitRouter,
  aml: amlRouter,
  settlementEngine: settlementEngineRouter,
  regulatoryReporting: regulatoryReportingRouter,
  marketMaker: marketMakerRouter,
  clearingHouse: clearingHouseRouter,
  investorRelations: investorRelationsRouter,
  surveillance: surveillanceRouter,
  derivatives: derivativesRouter,
  options: optionsRouter,
  portfolioAnalytics: portfolioAnalyticsRouter,
  farmer: farmerRouter,
  trader: traderRouter,
  broker: brokerRouter,
  warehouseOp: warehouseOpRouter,
  marketMakerOnboarding: marketMakerOnboardingRouter,
  kycAnalysis: kycAnalysisRouter,
  livePrices: livePricesRouter,
  corporateActions: corporateActionsRouter,
  participantPerformance: participantPerformanceRouter,
  marketData: marketDataRouter,
  riskManagement: riskManagementRouter,
  tradingEngine: tradingEngineRouter,
  kycService: kycServiceRouter,
  aiMl: aiMlRouter,
  blockchain: blockchainRouter,
  analyticsEngine: analyticsEngineRouter,
  lakehouse: lakehouseRouter,
  mojaloop: mojaloopRouter,
  mojaloopTiers: mojaloopTiersRouter,
  dfspKyc: dfspKycRouter,
  userManagement: userManagementRouter,
  notificationService: notificationServiceRouter,
  webauthn: webauthnRouter,
  search: searchRouter,
  warehouseMessages: warehouseRouter,
  fixedIncome: fixedIncomeRouter,
  workbench: workbenchRouter,
  abcp: abcpRouter,
  inputFinancing: inputFinancingRouter,
  fieldAgent: fieldAgentRouter,
  cropReports: cropReportsRouter,
  banking: bankingRouter,
  ussd: ussdRouter,
  whatsapp: whatsappRouter,
  telegram: telegramRouter,
  // ── KYC Audit Log ──────────────────────────────────────────────────────────
  kycAudit: router({
    getLog: adminProcedure
      .input(z.object({
        stakeholderType: z.enum(["FARMER", "TRADER", "BROKER", "WAREHOUSE_OPERATOR", "MARKET_MAKER"]),
        profileId: z.number().int().positive(),
        limit: z.number().int().min(1).max(50).default(20),
      }))
      .query(async ({ input }) => {
        const db = await getDb();
        if (!db) return [];
        const rows = await db
          .select()
          .from(kycAuditLog)
          .where(
            and(
              eq(kycAuditLog.stakeholderType, input.stakeholderType),
              eq(kycAuditLog.profileId, input.profileId),
            )
          )
          .orderBy(desc(kycAuditLog.createdAt))
          .limit(input.limit);
        return rows;
      }),
    // Export all audit log entries for a profile as CSV
    exportCsv: adminProcedure
      .input(z.object({
        stakeholderType: z.enum(["FARMER", "TRADER", "BROKER", "WAREHOUSE_OPERATOR", "MARKET_MAKER"]),
        profileId: z.number().int().positive(),
      }))
      .query(async ({ input }) => {
        const db = await getDb();
        if (!db) return { csv: "", filename: "kyc-audit-log.csv" };
        const rows = await db
          .select()
          .from(kycAuditLog)
          .where(
            and(
              eq(kycAuditLog.stakeholderType, input.stakeholderType),
              eq(kycAuditLog.profileId, input.profileId),
            )
          )
          .orderBy(desc(kycAuditLog.createdAt));
        const header = "Date,Reviewer,Decision,Notes";
        const lines = rows.map(r => {
          const date = r.createdAt ? new Date(r.createdAt).toISOString() : "";
          const reviewer = `"${(r.reviewerName ?? "").replace(/"/g, '""')}"`;
          const decision = r.decision ?? "";
          const notes = `"${(r.notes ?? "").replace(/"/g, '""')}"`;
          return `${date},${reviewer},${decision},${notes}`;
        });
        const csv = [header, ...lines].join("\n");
        const filename = `kyc-audit-${input.stakeholderType.toLowerCase()}-${input.profileId}-${Date.now()}.csv`;
        return { csv, filename };
      }),
  }),
  // ── Unified Onboarding Hub ─────────────────────────────────────────────────
  onboardingHub: router({
    getMyOnboardingStatus: protectedProcedure
      .query(async ({ ctx }) => {
        const db = await getDb();
        if (!db) return { farmer: null, trader: null, broker: null, warehouseOp: null, marketMaker: null };
        const uid = ctx.user.id;
        const [[farmer], [trader], [broker], [warehouseOp], [marketMaker]] = await Promise.all([
          db.select({ id: farmerProfiles.id, kycStatus: farmerProfiles.kycStatus, fullName: farmerProfiles.fullName }).from(farmerProfiles).where(eq(farmerProfiles.userId, uid)).limit(1),
          db.select({ id: traderProfiles.id, kycStatus: traderProfiles.kycStatus, fullName: traderProfiles.fullName }).from(traderProfiles).where(eq(traderProfiles.userId, uid)).limit(1),
          db.select({ id: brokerProfiles.id, kycStatus: brokerProfiles.kycStatus, firmName: brokerProfiles.firmName }).from(brokerProfiles).where(eq(brokerProfiles.userId, uid)).limit(1),
          db.select({ id: warehouseOperatorProfiles.id, kycStatus: warehouseOperatorProfiles.kycStatus, facilityName: warehouseOperatorProfiles.facilityName }).from(warehouseOperatorProfiles).where(eq(warehouseOperatorProfiles.userId, uid)).limit(1),
          db.select({ id: marketMakerOnboardingProfiles.id, kycStatus: marketMakerOnboardingProfiles.kycStatus, firmName: marketMakerOnboardingProfiles.firmName }).from(marketMakerOnboardingProfiles).where(eq(marketMakerOnboardingProfiles.userId, uid)).limit(1),
        ]);
        return {
          farmer: farmer ?? null,
          trader: trader ?? null,
          broker: broker ?? null,
          warehouseOp: warehouseOp ?? null,
          marketMaker: marketMaker ?? null,
        };
      }),
  }),
});

export type AppRouter = typeof appRouter;
