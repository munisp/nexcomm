/**
 * NEXCOM Exchange — Journey Orchestrator tRPC Router
 *
 * Exposes all 20 reusable Temporal-orchestrated user/stakeholder journeys
 * to the frontend via tRPC. Each procedure:
 *   1. Validates typed input with Zod
 *   2. Calls the journey-orchestrator HTTP API (port 8015)
 *   3. Returns the workflow ID and status URL for polling
 *
 * Journeys are reusable — they can be triggered from any frontend page,
 * scheduled via cron, or called by other services.
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import {
  router,
  protectedProcedure,
  adminProcedure,
} from "../_core/trpc";

const JOURNEY_API_URL =
  process.env.JOURNEY_ORCHESTRATOR_URL ?? "http://journey-orchestrator:8015";

// ─── Generic journey trigger helper ──────────────────────────────────────────

async function triggerJourney(
  journeyName: string,
  input: Record<string, unknown>,
  workflowId?: string
): Promise<{ workflow_id: string; run_id: string; status: string; status_url: string }> {
  const body = workflowId ? { ...input, workflow_id: workflowId } : input;
  const res = await fetch(`${JOURNEY_API_URL}/journeys/${journeyName}/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: `Journey ${journeyName} failed to start: ${text}`,
    });
  }
  return res.json();
}

async function getJourneyStatus(workflowId: string) {
  const res = await fetch(`${JOURNEY_API_URL}/journeys/${workflowId}/status`);
  if (!res.ok) {
    throw new TRPCError({ code: "NOT_FOUND", message: `Workflow ${workflowId} not found` });
  }
  return res.json();
}

async function signalJourney(workflowId: string, signalName: string, payload: unknown) {
  const res = await fetch(`${JOURNEY_API_URL}/journeys/${workflowId}/signal`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ signal_name: signalName, payload }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `Signal failed: ${text}` });
  }
  return res.json();
}

// ─── Journey Router ───────────────────────────────────────────────────────────

export const journeyRouter = router({

  // ── List all available journeys ──────────────────────────────────────────
  list: protectedProcedure.query(async () => {
    const res = await fetch(`${JOURNEY_API_URL}/journeys`);
    if (!res.ok) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Journey API unavailable" });
    return res.json();
  }),

  // ── Get journey status ───────────────────────────────────────────────────
  getStatus: protectedProcedure
    .input(z.object({ workflowId: z.string().min(1) }))
    .query(async ({ input }) => getJourneyStatus(input.workflowId)),

  // ── Send signal to running journey ───────────────────────────────────────
  signal: protectedProcedure
    .input(z.object({
      workflowId: z.string().min(1),
      signalName: z.string().min(1),
      payload: z.unknown().optional(),
    }))
    .mutation(async ({ input }) =>
      signalJourney(input.workflowId, input.signalName, input.payload)
    ),

  // ── Cancel a running journey ─────────────────────────────────────────────
  cancel: adminProcedure
    .input(z.object({ workflowId: z.string().min(1) }))
    .mutation(async ({ input }) => {
      const res = await fetch(`${JOURNEY_API_URL}/journeys/${input.workflowId}/cancel`, { method: "POST" });
      if (!res.ok) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Cancel failed" });
      return res.json();
    }),

  // ─────────────────────────────────────────────────────────────────────────
  // JOURNEY 1: Farmer Onboarding
  // ─────────────────────────────────────────────────────────────────────────
  startFarmerOnboarding: protectedProcedure
    .input(z.object({
      userId: z.string().min(1),
      email: z.string().email(),
      phoneNumber: z.string().min(10),
      firstName: z.string().min(1),
      lastName: z.string().min(1),
      bvn: z.string().length(11),
      farmLocation: z.string().min(1),
      farmSizeHa: z.number().positive(),
      cooperativeId: z.string().optional(),
    }))
    .mutation(async ({ input }) =>
      triggerJourney("FarmerOnboarding", {
        user_id: input.userId, email: input.email,
        phone_number: input.phoneNumber, first_name: input.firstName,
        last_name: input.lastName, bvn: input.bvn,
        farm_location: input.farmLocation, farm_size_ha: input.farmSizeHa,
        cooperative_id: input.cooperativeId,
      }, `farmer-onboard-${input.userId}`)
    ),

  // ─────────────────────────────────────────────────────────────────────────
  // JOURNEY 2: KYC/AML Review
  // ─────────────────────────────────────────────────────────────────────────
  startKYCAMLReview: protectedProcedure
    .input(z.object({
      caseId: z.string().min(1),
      userId: z.string().min(1),
      reviewerId: z.string().min(1),
      triggerType: z.enum(["ONBOARDING", "DEPOSIT", "TRADE", "TRANSFER"]),
      amount: z.number().nonnegative(),
      currency: z.string().default("NGN"),
      evidence: z.record(z.string(), z.unknown()).optional(),
    }))
    .mutation(async ({ input }) =>
      triggerJourney("KYCAMLReview", {
        case_id: input.caseId, user_id: input.userId,
        reviewer_id: input.reviewerId, trigger_type: input.triggerType,
        amount: input.amount, currency: input.currency,
        evidence: input.evidence ?? {},
      }, `kyc-review-${input.caseId}`)
    ),

  // ─────────────────────────────────────────────────────────────────────────
  // JOURNEY 3: Warehouse Receipt
  // ─────────────────────────────────────────────────────────────────────────
  startWarehouseReceipt: protectedProcedure
    .input(z.object({
      farmerId: z.string().min(1),
      warehouseId: z.string().min(1),
      commoditySymbol: z.enum(["MAIZE", "SORGHUM", "SOYBEANS", "COCOA", "WHEAT", "RICE", "SESAME"]),
      quantityTonnes: z.number().positive(),
      grade: z.enum(["A", "B", "C"]),
      tokenizeOnChain: z.boolean().default(false),
      chain: z.enum(["hyperledger", "polygon"]).default("hyperledger"),
    }))
    .mutation(async ({ input }) =>
      triggerJourney("WarehouseReceipt", {
        farmer_id: input.farmerId, warehouse_id: input.warehouseId,
        commodity_symbol: input.commoditySymbol, quantity_tonnes: input.quantityTonnes,
        grade: input.grade, tokenize_on_chain: input.tokenizeOnChain, chain: input.chain,
      })
    ),

  // ─────────────────────────────────────────────────────────────────────────
  // JOURNEY 4: Commodity Listing
  // ─────────────────────────────────────────────────────────────────────────
  startCommodityListing: protectedProcedure
    .input(z.object({
      sellerId: z.string().min(1),
      receiptId: z.string().min(1),
      commoditySymbol: z.string().min(1),
      quantityTonnes: z.number().positive(),
      askPriceNgn: z.number().positive(),
      listingType: z.enum(["SPOT", "FORWARD"]).default("SPOT"),
      deliveryDate: z.string().optional(),
    }))
    .mutation(async ({ input }) =>
      triggerJourney("CommodityListing", {
        seller_id: input.sellerId, receipt_id: input.receiptId,
        commodity_symbol: input.commoditySymbol, quantity_tonnes: input.quantityTonnes,
        ask_price_ngn: input.askPriceNgn, listing_type: input.listingType,
        delivery_date: input.deliveryDate,
      })
    ),

  // ─────────────────────────────────────────────────────────────────────────
  // JOURNEY 5: Spot Trade
  // ─────────────────────────────────────────────────────────────────────────
  startSpotTrade: protectedProcedure
    .input(z.object({
      buyerId: z.string().min(1),
      symbol: z.string().min(1),
      quantityKg: z.number().positive(),
      maxPriceNgn: z.number().nonnegative().default(0),
      orderType: z.enum(["MARKET", "LIMIT"]).default("MARKET"),
      timeInForce: z.enum(["DAY", "IOC", "FOK", "GTC"]).default("DAY"),
      idempotencyKey: z.string().min(1),
    }))
    .mutation(async ({ input }) =>
      triggerJourney("SpotTrade", {
        buyer_id: input.buyerId, symbol: input.symbol,
        quantity_kg: input.quantityKg, max_price_ngn: input.maxPriceNgn,
        order_type: input.orderType, time_in_force: input.timeInForce,
        idempotency_key: input.idempotencyKey,
      }, `spot-trade-${input.idempotencyKey}`)
    ),

  // ─────────────────────────────────────────────────────────────────────────
  // JOURNEY 6: Trade Settlement
  // ─────────────────────────────────────────────────────────────────────────
  startTradeSettlement: adminProcedure
    .input(z.object({
      settlementId: z.string().min(1),
      tradeId: z.string().min(1),
      buyerId: z.string().min(1),
      sellerId: z.string().min(1),
      symbol: z.string().min(1),
      quantityKg: z.number().positive(),
      priceNgn: z.number().positive(),
      grossAmount: z.number().positive(),
      currency: z.string().default("NGN"),
      settlementType: z.enum(["T0_BLOCKCHAIN", "T2_TRADITIONAL"]).default("T2_TRADITIONAL"),
    }))
    .mutation(async ({ input }) =>
      triggerJourney("TradeSettlement", {
        settlement_id: input.settlementId, trade_id: input.tradeId,
        buyer_id: input.buyerId, seller_id: input.sellerId,
        symbol: input.symbol, quantity_kg: input.quantityKg,
        price_ngn: input.priceNgn, gross_amount: input.grossAmount,
        currency: input.currency, settlement_type: input.settlementType,
      }, `settlement-${input.settlementId}`)
    ),

  // ─────────────────────────────────────────────────────────────────────────
  // JOURNEY 7: Futures Trading
  // ─────────────────────────────────────────────────────────────────────────
  startFuturesTrading: protectedProcedure
    .input(z.object({
      traderId: z.string().min(1),
      contractSymbol: z.string().min(1),
      side: z.enum(["BUY", "SELL"]),
      contracts: z.number().int().positive(),
      orderType: z.enum(["MARKET", "LIMIT"]).default("LIMIT"),
      limitPrice: z.number().positive().optional(),
      idempotencyKey: z.string().min(1),
    }))
    .mutation(async ({ input }) =>
      triggerJourney("FuturesTrading", {
        trader_id: input.traderId, contract_symbol: input.contractSymbol,
        side: input.side, contracts: input.contracts,
        order_type: input.orderType, limit_price: input.limitPrice,
        idempotency_key: input.idempotencyKey,
      }, `futures-${input.idempotencyKey}`)
    ),

  // ─────────────────────────────────────────────────────────────────────────
  // JOURNEY 8: Margin Call
  // ─────────────────────────────────────────────────────────────────────────
  startMarginCall: adminProcedure
    .input(z.object({
      accountId: z.string().min(1),
      symbol: z.string().min(1),
      currentMargin: z.number().nonnegative(),
      requiredMargin: z.number().positive(),
      maintenanceMargin: z.number().positive(),
      deadlineMinutes: z.number().int().positive().default(60),
    }))
    .mutation(async ({ input }) => {
      const deadline = new Date(Date.now() + input.deadlineMinutes * 60 * 1000).toISOString();
      return triggerJourney("MarginCall", {
        account_id: input.accountId, symbol: input.symbol,
        current_margin: input.currentMargin, required_margin: input.requiredMargin,
        maintenance_margin: input.maintenanceMargin, deadline,
      }, `margin-call-${input.accountId}-${input.symbol}`);
    }),

  // ─────────────────────────────────────────────────────────────────────────
  // JOURNEY 9: Cross-Border FX
  // ─────────────────────────────────────────────────────────────────────────
  startCrossBorderFX: protectedProcedure
    .input(z.object({
      transferId: z.string().min(1),
      senderUserId: z.string().min(1),
      receiverFsp: z.string().min(1),
      receiverAccount: z.string().min(1),
      amountNgn: z.number().positive(),
      receiveCurrency: z.enum(["USD", "GHS", "KES", "ZAR", "EUR", "GBP"]),
      note: z.string().optional(),
      idempotencyKey: z.string().min(1),
    }))
    .mutation(async ({ input }) =>
      triggerJourney("CrossBorderFX", {
        transfer_id: input.transferId, sender_user_id: input.senderUserId,
        receiver_fsp: input.receiverFsp, receiver_account: input.receiverAccount,
        amount_ngn: input.amountNgn, receive_currency: input.receiveCurrency,
        note: input.note, idempotency_key: input.idempotencyKey,
      }, `xborder-${input.transferId}`)
    ),

  // ─────────────────────────────────────────────────────────────────────────
  // JOURNEY 10: Deposit / Withdrawal
  // ─────────────────────────────────────────────────────────────────────────
  startDepositWithdrawal: protectedProcedure
    .input(z.object({
      userId: z.string().min(1),
      direction: z.enum(["DEPOSIT", "WITHDRAWAL"]),
      amountNgn: z.number().positive(),
      channel: z.enum(["stripe", "mojaloop", "bank_transfer"]),
      reference: z.string().min(1),
      bankAccountNo: z.string().optional(),
      idempotencyKey: z.string().min(1),
    }))
    .mutation(async ({ input }) =>
      triggerJourney("DepositWithdrawal", {
        user_id: input.userId, direction: input.direction,
        amount_ngn: input.amountNgn, channel: input.channel,
        reference: input.reference, bank_account_no: input.bankAccountNo,
        idempotency_key: input.idempotencyKey,
      }, `${input.direction.toLowerCase()}-${input.idempotencyKey}`)
    ),

  // ─────────────────────────────────────────────────────────────────────────
  // JOURNEY 11: USSD Mobile Trade
  // ─────────────────────────────────────────────────────────────────────────
  startUSSDMobileTrade: protectedProcedure
    .input(z.object({
      sessionId: z.string().min(1),
      phoneNumber: z.string().min(10),
      userId: z.string().min(1),
      symbol: z.string().min(1),
      side: z.enum(["BUY", "SELL"]),
      quantityKg: z.number().positive(),
      pin: z.string().min(4),
    }))
    .mutation(async ({ input }) =>
      triggerJourney("USSDMobileTrade", {
        session_id: input.sessionId, phone_number: input.phoneNumber,
        user_id: input.userId, symbol: input.symbol,
        side: input.side, quantity_kg: input.quantityKg, pin: input.pin,
      }, `ussd-trade-${input.sessionId}`)
    ),

  // ─────────────────────────────────────────────────────────────────────────
  // JOURNEY 12: Loan Application (Credit Scoring + Approval)
  // ─────────────────────────────────────────────────────────────────────────
  startLoanApplication: protectedProcedure
    .input(z.object({
      farmerId: z.string().min(1),
      loanAmountNgn: z.number().positive(),
      loanPurpose: z.enum(["INPUT_FINANCING", "EQUIPMENT", "WR_FINANCING"]),
      loanTermMonths: z.number().int().min(1).max(60),
      collateralType: z.enum(["WAREHOUSE_RECEIPT", "LAND_TITLE"]),
      collateralRefId: z.string().min(1),
      collateralValueNgn: z.number().positive(),
      farmSizeHa: z.number().positive(),
      annualIncomeNgn: z.number().positive(),
    }))
    .mutation(async ({ input }) =>
      triggerJourney("LoanApplication", {
        farmer_id: input.farmerId, loan_amount_ngn: input.loanAmountNgn,
        loan_purpose: input.loanPurpose, loan_term_months: input.loanTermMonths,
        collateral_type: input.collateralType, collateral_ref_id: input.collateralRefId,
        collateral_value_ngn: input.collateralValueNgn, farm_size_ha: input.farmSizeHa,
        annual_income_ngn: input.annualIncomeNgn,
      }, `loan-apply-${input.farmerId}-${Date.now()}`)
    ),

  // ─────────────────────────────────────────────────────────────────────────
  // JOURNEY 13: Loan Disbursement
  // ─────────────────────────────────────────────────────────────────────────
  startLoanDisbursement: adminProcedure
    .input(z.object({
      loanId: z.number().int().positive(),
      farmerId: z.string().min(1),
      amountNgn: z.number().positive(),
      bankAccount: z.string().min(10),
      bankCode: z.string().min(3),
      approvedBy: z.string().min(1),
    }))
    .mutation(async ({ input }) =>
      triggerJourney("LoanDisbursement", {
        loan_id: input.loanId, farmer_id: input.farmerId,
        amount_ngn: input.amountNgn, bank_account: input.bankAccount,
        bank_code: input.bankCode, approved_by: input.approvedBy,
      }, `loan-disburse-${input.loanId}`)
    ),

  // ─────────────────────────────────────────────────────────────────────────
  // JOURNEY 14: Corporate Action
  // ─────────────────────────────────────────────────────────────────────────
  startCorporateAction: adminProcedure
    .input(z.object({
      actionId: z.string().min(1),
      symbol: z.string().min(1),
      actionType: z.enum(["DIVIDEND", "STOCK_SPLIT", "RIGHTS_ISSUE"]),
      recordDate: z.string().min(1),
      payDate: z.string().min(1),
      ratio: z.number().positive(),
      initiatedBy: z.string().min(1),
    }))
    .mutation(async ({ input }) =>
      triggerJourney("CorporateAction", {
        action_id: input.actionId, symbol: input.symbol,
        action_type: input.actionType, record_date: input.recordDate,
        pay_date: input.payDate, ratio: input.ratio, initiated_by: input.initiatedBy,
      }, `corp-action-${input.actionId}`)
    ),

  // ─────────────────────────────────────────────────────────────────────────
  // JOURNEY 15: Market Surveillance
  // ─────────────────────────────────────────────────────────────────────────
  startMarketSurveillance: protectedProcedure
    .input(z.object({
      alertId: z.string().min(1),
      alertType: z.enum(["SPOOFING", "WASH_TRADING", "FRONT_RUNNING", "LAYERING", "PRICE_MANIPULATION"]),
      userId: z.string().min(1),
      symbol: z.string().min(1),
      severity: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]),
      evidence: z.record(z.string(), z.unknown()).default({}),
      reviewerId: z.string().min(1),
    }))
    .mutation(async ({ input }) =>
      triggerJourney("MarketSurveillance", {
        alert_id: input.alertId, alert_type: input.alertType,
        user_id: input.userId, symbol: input.symbol,
        severity: input.severity, evidence: input.evidence, reviewer_id: input.reviewerId,
      }, `surveillance-${input.alertId}`)
    ),

  // ─────────────────────────────────────────────────────────────────────────
  // JOURNEY 16: Compliance Audit
  // ─────────────────────────────────────────────────────────────────────────
  startComplianceAudit: protectedProcedure
    .input(z.object({
      auditId: z.string().min(1),
      auditType: z.enum(["DAILY_POSITION", "STR", "CTR", "TRADE_SURVEILLANCE"]),
      periodStart: z.string().min(1),
      periodEnd: z.string().min(1),
      requestedBy: z.string().min(1),
    }))
    .mutation(async ({ input }) =>
      triggerJourney("ComplianceAudit", {
        audit_id: input.auditId, audit_type: input.auditType,
        period_start: input.periodStart, period_end: input.periodEnd,
        requested_by: input.requestedBy,
      }, `audit-${input.auditId}`)
    ),

  // ─────────────────────────────────────────────────────────────────────────
  // JOURNEY 17: Broker Onboarding
  // ─────────────────────────────────────────────────────────────────────────
  startBrokerOnboarding: adminProcedure
    .input(z.object({
      brokerId: z.string().min(1),
      name: z.string().min(1),
      licenseNo: z.string().min(1),
      regulatorRef: z.string().min(1),
      contactEmail: z.string().email(),
      contactPhone: z.string().min(10),
      approvedBy: z.string().min(1),
    }))
    .mutation(async ({ input }) =>
      triggerJourney("BrokerOnboarding", {
        broker_id: input.brokerId, name: input.name,
        license_no: input.licenseNo, regulator_ref: input.regulatorRef,
        contact_email: input.contactEmail, contact_phone: input.contactPhone,
        approved_by: input.approvedBy,
      }, `broker-onboard-${input.brokerId}`)
    ),

  // ─────────────────────────────────────────────────────────────────────────
  // JOURNEY 18: Market Maker Quote
  // ─────────────────────────────────────────────────────────────────────────
  startMarketMakerQuote: protectedProcedure
    .input(z.object({
      marketMakerId: z.string().min(1),
      symbol: z.string().min(1),
      bidPrice: z.number().positive(),
      askPrice: z.number().positive(),
      bidSizeKg: z.number().positive(),
      askSizeKg: z.number().positive(),
      validForMs: z.number().int().positive().default(30000),
    }))
    .mutation(async ({ input }) =>
      triggerJourney("MarketMakerQuote", {
        market_maker_id: input.marketMakerId, symbol: input.symbol,
        bid_price: input.bidPrice, ask_price: input.askPrice,
        bid_size_kg: input.bidSizeKg, ask_size_kg: input.askSizeKg,
        valid_for_ms: input.validForMs,
      })
    ),

  // ─────────────────────────────────────────────────────────────────────────
  // JOURNEY 19: Regulator Reporting
  // ─────────────────────────────────────────────────────────────────────────
  startRegulatorReporting: adminProcedure
    .input(z.object({
      reportId: z.string().min(1),
      reportType: z.enum(["DAILY_TRADE_REPORT", "WEEKLY_POSITION", "MONTHLY_STR", "ANNUAL_AUDIT"]),
      regulator: z.enum(["SEC", "CBN", "FMDQ", "NGX"]),
      periodStart: z.string().min(1),
      periodEnd: z.string().min(1),
      submittedBy: z.string().min(1),
    }))
    .mutation(async ({ input }) =>
      triggerJourney("RegulatorReporting", {
        report_id: input.reportId, report_type: input.reportType,
        regulator: input.regulator, period_start: input.periodStart,
        period_end: input.periodEnd, submitted_by: input.submittedBy,
      }, `reg-report-${input.reportId}`)
    ),

  // ─────────────────────────────────────────────────────────────────────────
  // JOURNEY 20: Platform Health Check
  // ─────────────────────────────────────────────────────────────────────────
  startPlatformHealthCheck: protectedProcedure
    .input(z.object({
      checkId: z.string().optional(),
      services: z.array(z.string()).optional(),
      alertOnFail: z.boolean().default(true),
      alertUserId: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) =>
      triggerJourney("PlatformHealthCheck", {
        check_id: input.checkId ?? `health-${Date.now()}`,
        services: input.services ?? [],
        alert_on_fail: input.alertOnFail,
        alert_user_id: input.alertUserId ?? String(ctx.user.id),
      })
    ),

  // ── Margin call top-up signal ─────────────────────────────────────────────
  signalMarginTopUp: protectedProcedure
    .input(z.object({
      workflowId: z.string().min(1),
      topUpAmountNgn: z.number().positive(),
    }))
    .mutation(async ({ input }) =>
      signalJourney(input.workflowId, "margin_top_up", input.topUpAmountNgn)
    ),
});
