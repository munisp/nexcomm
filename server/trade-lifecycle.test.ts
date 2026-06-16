/**
 * NEXCOM Exchange — Trade Lifecycle Integration Tests (P3-B)
 *
 * End-to-end tests covering the complete trade lifecycle:
 *   1. Order placement validation (price bands, lot sizes, margin, KYC tier limits)
 *   2. Settlement date calculation (T+2, weekend skip, holiday skip)
 *   3. Margin call assessment (SAFE / WARNING / CRITICAL / LIQUIDATION)
 *   4. Circuit breaker triggers
 *   5. AML risk assessment on fills
 *   6. Warehouse receipt lifecycle (eligibility, transitions)
 *   7. KYC re-verification triggers
 *   8. Full lifecycle simulation
 *   9. Edge cases & boundary conditions
 *
 * All tests are pure (no DB, no network) — fast and deterministic.
 */

import { describe, it, expect } from "vitest";
import {
  validateOrder,
  calculateSettlementDate,
  assessMarginCall,
  assessCircuitBreaker,
  assessAMLRisk,
  assessReKycRequired,
  isReceiptEligibleForTrading,
  isReceiptExpired,
  validateReceiptTransition,
  INITIAL_MARGIN_RATE,
  MARGIN_THRESHOLDS,
  CIRCUIT_BREAKER_THRESHOLD_PCT,
  AML_THRESHOLDS,
  MIN_LOT_SIZES,
  PRICE_BAND_PCT,
  KYC_DAILY_LIMITS,
} from "./business-rules";

// ─────────────────────────────────────────────────────────────────────────────
// 1. ORDER PLACEMENT VALIDATION
// ─────────────────────────────────────────────────────────────────────────────

describe("Trade Lifecycle — 1. Order Placement Validation", () => {
  // Actual signature: { symbol, side, orderType, quantity, price?, stopPrice?,
  //   lastTradedPrice, availableMargin, kycTier, dailyTradedValue }
  const validOrder = {
    symbol: "MAIZE-DEC25",
    side: "BUY" as const,
    orderType: "LIMIT" as const,
    quantity: 10,          // exactly the min lot for MAIZE
    price: 250_000,
    lastTradedPrice: 250_000,
    availableMargin: 5_000_000,
    kycTier: 2 as const,
    dailyTradedValue: 0,
  };

  it("accepts a valid limit buy order", () => {
    const result = validateOrder(validOrder);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("accepts a valid limit sell order", () => {
    const result = validateOrder({ ...validOrder, side: "SELL" });
    expect(result.valid).toBe(true);
  });

  it("accepts a market order without price", () => {
    const result = validateOrder({
      ...validOrder,
      orderType: "MARKET",
      price: undefined,
    });
    expect(result.valid).toBe(true);
  });

  it("rejects order with quantity below minimum lot size", () => {
    const result = validateOrder({ ...validOrder, quantity: 0.5 });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => /lot/i.test(e))).toBe(true);
  });

  it("rejects limit order with zero price", () => {
    const result = validateOrder({ ...validOrder, price: 0 });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => /price/i.test(e))).toBe(true);
  });

  it("rejects limit order with negative price", () => {
    const result = validateOrder({ ...validOrder, price: -100 });
    expect(result.valid).toBe(false);
  });

  it("rejects order with zero quantity", () => {
    const result = validateOrder({ ...validOrder, quantity: 0 });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => /quantity/i.test(e))).toBe(true);
  });

  it("rejects order exceeding daily KYC tier 1 trading limit", () => {
    const tier1Limit = KYC_DAILY_LIMITS[1]; // ₦500K
    // 10 MT × ₦250K = ₦2.5M, already over ₦500K limit
    const result = validateOrder({
      ...validOrder,
      kycTier: 1,
      dailyTradedValue: 0,
      quantity: 10,
      price: 250_000,
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => /daily|limit|tier/i.test(e))).toBe(true);
  });

  it("rejects order when available margin is insufficient", () => {
    // 10 MT × ₦250K = ₦2.5M contract, 10% margin = ₦250K needed
    const result = validateOrder({
      ...validOrder,
      availableMargin: 1_000, // Way too low
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => /margin/i.test(e))).toBe(true);
  });

  it("rejects price above the upper price band (+5%)", () => {
    const upperBand = 250_000 * (1 + PRICE_BAND_PCT);
    const result = validateOrder({
      ...validOrder,
      price: upperBand + 1_000,
      lastTradedPrice: 250_000,
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => /band|price/i.test(e))).toBe(true);
  });

  it("rejects price below the lower price band (-5%)", () => {
    const lowerBand = 250_000 * (1 - PRICE_BAND_PCT);
    const result = validateOrder({
      ...validOrder,
      price: lowerBand - 1_000,
      lastTradedPrice: 250_000,
    });
    expect(result.valid).toBe(false);
  });

  it("accepts price exactly at the upper band boundary", () => {
    const upperBand = 250_000 * (1 + PRICE_BAND_PCT);
    const result = validateOrder({
      ...validOrder,
      price: upperBand,
      lastTradedPrice: 250_000,
    });
    // At exactly the boundary it should be valid (not strictly greater)
    expect(result.errors.some((e) => /band/i.test(e))).toBe(false);
  });

  it("warns on market orders about slippage", () => {
    const result = validateOrder({
      ...validOrder,
      orderType: "MARKET",
      price: undefined,
    });
    expect(result.warnings.some((w) => /market|slippage/i.test(w))).toBe(true);
  });

  it("requires stop price for STOP orders", () => {
    const result = validateOrder({
      ...validOrder,
      orderType: "STOP",
      stopPrice: undefined,
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => /stop/i.test(e))).toBe(true);
  });

  it("rejects quantity exceeding maximum single order size", () => {
    const result = validateOrder({ ...validOrder, quantity: 100_000 });
    expect(result.valid).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. SETTLEMENT DATE CALCULATION (T+2)
// ─────────────────────────────────────────────────────────────────────────────

describe("Trade Lifecycle — 2. Settlement Date", () => {
  it("T+2: Monday trade settles on Wednesday", () => {
    // Monday 2026-06-15 → Wednesday 2026-06-17
    const tradeDate = new Date("2026-06-15T10:00:00Z");
    const result = calculateSettlementDate(tradeDate, "T+2");
    expect(result.settlementDate.getUTCDay()).toBe(3); // Wednesday
    expect(result.settlementDate.getUTCDate()).toBe(17);
    expect(result.cycle).toBe("T+2");
    expect(result.isT0).toBe(false);
  });

  it("T+2: Thursday trade settles on Monday (skips weekend)", () => {
    // Thursday 2026-06-18 → Monday 2026-06-22
    const tradeDate = new Date("2026-06-18T10:00:00Z");
    const result = calculateSettlementDate(tradeDate, "T+2");
    expect(result.settlementDate.getUTCDay()).toBe(1); // Monday
    expect(result.settlementDate.getUTCDate()).toBe(22);
  });

  it("T+2: Friday trade settles on Tuesday (skips weekend)", () => {
    // Friday 2026-06-19 → Tuesday 2026-06-23
    const tradeDate = new Date("2026-06-19T10:00:00Z");
    const result = calculateSettlementDate(tradeDate, "T+2");
    expect(result.settlementDate.getUTCDay()).toBe(2); // Tuesday
    expect(result.settlementDate.getUTCDate()).toBe(23);
  });

  it("T+0: settlement date equals trade date", () => {
    const tradeDate = new Date("2026-06-15T10:00:00Z");
    const result = calculateSettlementDate(tradeDate, "T+0");
    expect(result.isT0).toBe(true);
    expect(result.settlementDate.getUTCDate()).toBe(tradeDate.getUTCDate());
  });

  it("T+1: Monday trade settles on Tuesday", () => {
    const tradeDate = new Date("2026-06-15T10:00:00Z");
    const result = calculateSettlementDate(tradeDate, "T+1");
    expect(result.settlementDate.getUTCDay()).toBe(2); // Tuesday
    expect(result.settlementDate.getUTCDate()).toBe(16);
  });

  it("settlement date is always >= trade date", () => {
    const now = new Date();
    const result = calculateSettlementDate(now, "T+2");
    expect(result.settlementDate.getTime()).toBeGreaterThanOrEqual(now.getTime());
  });

  it("returns the trade date in the result", () => {
    const tradeDate = new Date("2026-06-15T10:00:00Z");
    const result = calculateSettlementDate(tradeDate, "T+2");
    expect(result.tradeDate.getTime()).toBe(tradeDate.getTime());
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. MARGIN CALL ASSESSMENT
// ─────────────────────────────────────────────────────────────────────────────

describe("Trade Lifecycle — 3. Margin Call Assessment", () => {
  // Signature: assessMarginCall(initialMargin, maintenanceMargin, currentBalance, openPositionValue)
  // utilization = max(maintenanceMargin, openPositionValue * INITIAL_MARGIN_RATE) / currentBalance

  it("returns SAFE when utilisation is below 80%", () => {
    // requiredMargin = max(0, 100_000 * 0.10) = 10_000; utilization = 10_000 / 1_000_000 = 1%
    const result = assessMarginCall(0, 0, 1_000_000, 100_000);
    expect(result.level).toBe("SAFE");
    expect(result.utilizationPct).toBeLessThan(MARGIN_THRESHOLDS.WARNING * 100);
  });

  it("returns WARNING at 80% utilisation", () => {
    // requiredMargin = 800_000 (via maintenanceMargin); utilization = 800_000 / 1_000_000 = 80%
    const result = assessMarginCall(0, 800_000, 1_000_000, 0);
    expect(result.level).toBe("WARNING");
  });

  it("returns CRITICAL at 95% utilisation", () => {
    const result = assessMarginCall(0, 950_000, 1_000_000, 0);
    expect(result.level).toBe("CRITICAL");
  });

  it("returns LIQUIDATION at 100% utilisation", () => {
    const result = assessMarginCall(0, 1_000_000, 1_000_000, 0);
    expect(result.level).toBe("LIQUIDATION");
  });

  it("returns LIQUIDATION when required margin exceeds balance", () => {
    const result = assessMarginCall(0, 2_000_000, 1_000_000, 0);
    expect(result.level).toBe("LIQUIDATION");
  });

  it("utilizationPct is a number between 0 and 100+", () => {
    const result = assessMarginCall(0, 500_000, 1_000_000, 0);
    expect(typeof result.utilizationPct).toBe("number");
    expect(result.utilizationPct).toBeGreaterThanOrEqual(0);
  });

  it("availableMargin is returned correctly", () => {
    const result = assessMarginCall(0, 200_000, 1_000_000, 0);
    expect(result.availableMargin).toBe(800_000);
  });

  it("LIQUIDATION level includes a requiredAction message", () => {
    const result = assessMarginCall(0, 1_000_000, 1_000_000, 0);
    expect(result.requiredAction).toBeTruthy();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. CIRCUIT BREAKER
// ─────────────────────────────────────────────────────────────────────────────

describe("Trade Lifecycle — 4. Circuit Breaker", () => {
  // Signature: assessCircuitBreaker(previousClose, currentPrice)

  it("does not trigger when price move is within 10%", () => {
    const result = assessCircuitBreaker(250_000, 274_999); // 9.99%
    expect(result.triggered).toBe(false);
    expect(result.haltDurationMinutes).toBe(0);
  });

  it("triggers when price drops exactly 10%", () => {
    const result = assessCircuitBreaker(250_000, 225_000); // exactly 10%
    expect(result.triggered).toBe(true);
    expect(result.haltDurationMinutes).toBeGreaterThan(0);
  });

  it("triggers when price rises beyond 10%", () => {
    const result = assessCircuitBreaker(250_000, 280_000); // 12%
    expect(result.triggered).toBe(true);
  });

  it("returns priceChangePct as a percentage value", () => {
    const result = assessCircuitBreaker(250_000, 275_000); // 10%
    expect(result.priceChangePct).toBeCloseTo(10, 1);
  });

  it("returns a reason string when triggered", () => {
    const result = assessCircuitBreaker(250_000, 200_000); // 20%
    expect(result.triggered).toBe(true);
    expect(typeof result.reason).toBe("string");
    expect(result.reason!.length).toBeGreaterThan(0);
  });

  it("reason is undefined when not triggered", () => {
    const result = assessCircuitBreaker(250_000, 260_000); // 4%
    expect(result.triggered).toBe(false);
    expect(result.reason).toBeUndefined();
  });

  it("handles identical prices (0% move)", () => {
    const result = assessCircuitBreaker(250_000, 250_000);
    expect(result.triggered).toBe(false);
    expect(result.priceChangePct).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. AML RISK ASSESSMENT
// ─────────────────────────────────────────────────────────────────────────────

describe("Trade Lifecycle — 5. AML Risk Assessment", () => {
  // Signature: assessAMLRisk(transactionAmount, dailyTotal, threeDayTotal, hourlyCount, isNewCounterparty, counterpartyJurisdiction)

  it("returns LOW risk for a normal domestic trade", () => {
    const result = assessAMLRisk(500_000, 1_000_000, 2_000_000, 2, false, "NG");
    expect(result.riskLevel).toBe("LOW");
    expect(result.flags).toHaveLength(0);
    expect(result.requiresReview).toBe(false);
  });

  it("flags LARGE_TRANSACTION when amount exceeds ₦5M", () => {
    const result = assessAMLRisk(
      AML_THRESHOLDS.LARGE_CASH_TRANSACTION + 1,
      AML_THRESHOLDS.LARGE_CASH_TRANSACTION + 1,
      AML_THRESHOLDS.LARGE_CASH_TRANSACTION + 1,
      1,
      false,
      "NG"
    );
    expect(result.flags.some((f) => /large/i.test(f))).toBe(true);
    expect(["MEDIUM", "HIGH", "CRITICAL"]).toContain(result.riskLevel);
  });

  it("flags potential structuring when 3-day total is near ₦4.5M with sub-threshold transactions", () => {
    const result = assessAMLRisk(
      4_000_000,                               // below ₦5M single threshold
      4_000_000,
      AML_THRESHOLDS.STRUCTURING_TOTAL + 1,    // ₦4.5M+ in 3 days
      1,
      false,
      "NG"
    );
    expect(result.flags.some((f) => /structur/i.test(f))).toBe(true);
  });

  it("flags high velocity when hourly count exceeds 10", () => {
    const result = assessAMLRisk(100_000, 1_000_000, 1_000_000, 11, false, "NG");
    expect(result.flags.some((f) => /velocity/i.test(f))).toBe(true);
  });

  it("flags new counterparty", () => {
    const result = assessAMLRisk(100_000, 100_000, 100_000, 1, true, "NG");
    expect(result.flags.some((f) => /new counterparty/i.test(f))).toBe(true);
  });

  it("flags high-risk jurisdiction (Iran)", () => {
    const result = assessAMLRisk(100_000, 100_000, 100_000, 1, false, "IR");
    expect(result.flags.some((f) => /jurisdiction/i.test(f))).toBe(true);
    expect(["HIGH", "CRITICAL"]).toContain(result.riskLevel);
  });

  it("escalates to CRITICAL when multiple flags are raised", () => {
    const result = assessAMLRisk(
      AML_THRESHOLDS.LARGE_CASH_TRANSACTION * 3,
      AML_THRESHOLDS.LARGE_CASH_TRANSACTION * 3,
      AML_THRESHOLDS.STRUCTURING_TOTAL * 5,
      15,
      true,
      "KP" // North Korea
    );
    expect(result.riskLevel).toBe("CRITICAL");
  });

  it("requiresSAR is true when amount exceeds ₦10M", () => {
    const result = assessAMLRisk(
      AML_THRESHOLDS.SAR_THRESHOLD + 1,
      AML_THRESHOLDS.SAR_THRESHOLD + 1,
      AML_THRESHOLDS.SAR_THRESHOLD + 1,
      1,
      false,
      "NG"
    );
    expect(result.requiresSAR).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. WAREHOUSE RECEIPT LIFECYCLE
// ─────────────────────────────────────────────────────────────────────────────

describe("Trade Lifecycle — 6. Warehouse Receipt Eligibility", () => {
  const futureDate = new Date(Date.now() + 30 * 86_400_000); // 30 days ahead
  const pastDate = new Date(Date.now() - 86_400_000);         // yesterday

  it("allows trading on an ACTIVE, non-expired receipt", () => {
    expect(isReceiptEligibleForTrading("ACTIVE", futureDate)).toBe(true);
  });

  it("blocks trading on an expired ACTIVE receipt", () => {
    expect(isReceiptEligibleForTrading("ACTIVE", pastDate)).toBe(false);
  });

  it("blocks trading on a PLEDGED receipt", () => {
    expect(isReceiptEligibleForTrading("PLEDGED", futureDate)).toBe(false);
  });

  it("blocks trading on a REDEEMED receipt", () => {
    expect(isReceiptEligibleForTrading("REDEEMED", futureDate)).toBe(false);
  });

  it("blocks trading on a CANCELLED receipt", () => {
    expect(isReceiptEligibleForTrading("CANCELLED", futureDate)).toBe(false);
  });

  it("blocks trading on a PENDING_INSPECTION receipt", () => {
    expect(isReceiptEligibleForTrading("PENDING_INSPECTION", futureDate)).toBe(false);
  });

  it("correctly identifies an expired receipt", () => {
    expect(isReceiptExpired(pastDate)).toBe(true);
    expect(isReceiptExpired(futureDate)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. RECEIPT STATUS TRANSITIONS
// ─────────────────────────────────────────────────────────────────────────────

describe("Trade Lifecycle — 7. Receipt Status Transitions", () => {
  it("allows PENDING_INSPECTION → ACTIVE", () => {
    expect(validateReceiptTransition("PENDING_INSPECTION", "ACTIVE").allowed).toBe(true);
  });

  it("allows ACTIVE → PLEDGED", () => {
    expect(validateReceiptTransition("ACTIVE", "PLEDGED").allowed).toBe(true);
  });

  it("allows PLEDGED → ACTIVE (lien released)", () => {
    expect(validateReceiptTransition("PLEDGED", "ACTIVE").allowed).toBe(true);
  });

  it("allows ACTIVE → UNDER_DELIVERY", () => {
    expect(validateReceiptTransition("ACTIVE", "UNDER_DELIVERY").allowed).toBe(true);
  });

  it("allows UNDER_DELIVERY → REDEEMED", () => {
    expect(validateReceiptTransition("UNDER_DELIVERY", "REDEEMED").allowed).toBe(true);
  });

  it("allows UNDER_DELIVERY → ACTIVE (delivery reversed)", () => {
    expect(validateReceiptTransition("UNDER_DELIVERY", "ACTIVE").allowed).toBe(true);
  });

  it("blocks REDEEMED → ACTIVE (terminal state)", () => {
    const result = validateReceiptTransition("REDEEMED", "ACTIVE");
    expect(result.allowed).toBe(false);
    expect(result.reason).toBeTruthy();
  });

  it("blocks CANCELLED → ACTIVE (terminal state)", () => {
    expect(validateReceiptTransition("CANCELLED", "ACTIVE").allowed).toBe(false);
  });

  it("blocks EXPIRED → ACTIVE (terminal state)", () => {
    expect(validateReceiptTransition("EXPIRED", "ACTIVE").allowed).toBe(false);
  });

  it("blocks REDEEMED → CANCELLED", () => {
    expect(validateReceiptTransition("REDEEMED", "CANCELLED").allowed).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 8. KYC RE-VERIFICATION TRIGGERS
// ─────────────────────────────────────────────────────────────────────────────

describe("Trade Lifecycle — 8. KYC Re-Verification Triggers", () => {
  // Signature: assessReKycRequired(lastKycDate, riskScore, monthlyTradedValue, hasActiveDispute)

  it("triggers re-KYC when last KYC is older than 12 months (standard risk)", () => {
    const lastKycDate = new Date(Date.now() - 400 * 86_400_000); // 400 days ago
    const result = assessReKycRequired(lastKycDate, 20, 0, false);
    expect(result.required).toBe(true);
    expect(result.urgency).toBe("ROUTINE");
  });

  it("triggers re-KYC when last KYC is older than 6 months for high-risk (score ≥ 70)", () => {
    const lastKycDate = new Date(Date.now() - 200 * 86_400_000); // ~6.7 months ago
    const result = assessReKycRequired(lastKycDate, 75, 0, false);
    expect(result.required).toBe(true);
    expect(result.urgency).toBe("ELEVATED");
  });

  it("does not trigger re-KYC for a recently approved standard-risk profile", () => {
    const lastKycDate = new Date(Date.now() - 30 * 86_400_000); // 30 days ago
    const result = assessReKycRequired(lastKycDate, 20, 0, false);
    expect(result.required).toBe(false);
  });

  it("triggers IMMEDIATE re-KYC when there is an active dispute", () => {
    const lastKycDate = new Date(Date.now() - 10 * 86_400_000);
    const result = assessReKycRequired(lastKycDate, 20, 0, true);
    expect(result.required).toBe(true);
    expect(result.urgency).toBe("IMMEDIATE");
  });

  it("triggers ELEVATED re-KYC for high-volume trader after 6 months", () => {
    const lastKycDate = new Date(Date.now() - 210 * 86_400_000); // ~7 months
    const result = assessReKycRequired(lastKycDate, 20, 150_000_000, false); // ₦150M/month
    expect(result.required).toBe(true);
    expect(result.urgency).toBe("ELEVATED");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 9. FULL TRADE LIFECYCLE SIMULATION
// ─────────────────────────────────────────────────────────────────────────────

describe("Trade Lifecycle — 9. Full Lifecycle Simulation", () => {
  it("completes a full buy-side lifecycle: validate → settle → margin check", () => {
    // Step 1: Validate order
    const order = {
      symbol: "MAIZE-DEC25",
      side: "BUY" as const,
      orderType: "LIMIT" as const,
      quantity: 20,
      price: 250_000,
      lastTradedPrice: 250_000,
      availableMargin: 10_000_000,
      kycTier: 2 as const,
      dailyTradedValue: 0,
    };
    const validation = validateOrder(order);
    expect(validation.valid).toBe(true);

    // Step 2: Calculate T+2 settlement
    const tradeDate = new Date("2026-06-15T10:00:00Z"); // Monday
    const settlement = calculateSettlementDate(tradeDate, "T+2");
    expect(settlement.settlementDate.getTime()).toBeGreaterThan(tradeDate.getTime());
    expect(settlement.cycle).toBe("T+2");

    // Step 3: Post-fill margin check
    const fillValue = order.quantity * order.price; // ₦5M
    const requiredMargin = fillValue * INITIAL_MARGIN_RATE; // ₦500K
    const marginResult = assessMarginCall(0, requiredMargin, order.availableMargin, fillValue);
    expect(["SAFE", "WARNING"]).toContain(marginResult.level);

    // Step 4: AML check on fill
    const amlResult = assessAMLRisk(fillValue, fillValue, fillValue, 1, false, "NG");
    expect(["LOW", "MEDIUM"]).toContain(amlResult.riskLevel);
  });

  it("blocks lifecycle at order validation when margin is insufficient", () => {
    const order = {
      symbol: "MAIZE-DEC25",
      side: "BUY" as const,
      orderType: "LIMIT" as const,
      quantity: 1000,
      price: 250_000,
      lastTradedPrice: 250_000,
      availableMargin: 1_000, // Far too low
      kycTier: 2 as const,
      dailyTradedValue: 0,
    };
    const validation = validateOrder(order);
    expect(validation.valid).toBe(false);
    expect(validation.errors.some((e) => /margin/i.test(e))).toBe(true);
  });

  it("blocks lifecycle when price is outside band", () => {
    const order = {
      symbol: "MAIZE-DEC25",
      side: "BUY" as const,
      orderType: "LIMIT" as const,
      quantity: 10,
      price: 300_000,          // 20% above last traded — outside ±5% band
      lastTradedPrice: 250_000,
      availableMargin: 10_000_000,
      kycTier: 2 as const,
      dailyTradedValue: 0,
    };
    const validation = validateOrder(order);
    expect(validation.valid).toBe(false);
    expect(validation.errors.some((e) => /band|price/i.test(e))).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 10. EDGE CASES & BOUNDARY CONDITIONS
// ─────────────────────────────────────────────────────────────────────────────

describe("Trade Lifecycle — 10. Edge Cases", () => {
  it("handles exact minimum lot size as valid", () => {
    const minLot = MIN_LOT_SIZES["MAIZE"] ?? 1;
    const result = validateOrder({
      symbol: "MAIZE-DEC25",
      side: "BUY" as const,
      orderType: "LIMIT" as const,
      quantity: minLot,
      price: 250_000,
      lastTradedPrice: 250_000,
      availableMargin: 50_000_000,
      kycTier: 3 as const,
      dailyTradedValue: 0,
    });
    expect(result.valid).toBe(true);
  });

  it("circuit breaker handles identical current and reference price (0% move)", () => {
    const result = assessCircuitBreaker(250_000, 250_000);
    expect(result.triggered).toBe(false);
    expect(result.priceChangePct).toBe(0);
  });

  it("margin call handles zero balance (division guard)", () => {
    // With zero balance, utilization should be treated as 100%
    const result = assessMarginCall(0, 0, 0, 0);
    // Should not throw — result should be defined
    expect(result).toBeDefined();
    expect(result.level).toBeDefined();
  });

  it("AML assessment handles zero trade value", () => {
    const result = assessAMLRisk(0, 0, 0, 0, false, "NG");
    expect(result.riskLevel).toBe("LOW");
    expect(result.flags).toHaveLength(0);
  });

  it("receipt expiry check handles exact current time boundary", () => {
    const justExpired = new Date(Date.now() - 1);
    const notYetExpired = new Date(Date.now() + 60_000);
    expect(isReceiptExpired(justExpired)).toBe(true);
    expect(isReceiptExpired(notYetExpired)).toBe(false);
  });

  it("validateOrder returns requiredMargin in result", () => {
    const result = validateOrder({
      symbol: "MAIZE-DEC25",
      side: "BUY" as const,
      orderType: "LIMIT" as const,
      quantity: 10,
      price: 250_000,
      lastTradedPrice: 250_000,
      availableMargin: 5_000_000,
      kycTier: 2 as const,
      dailyTradedValue: 0,
    });
    expect(typeof result.requiredMargin).toBe("number");
    expect(result.requiredMargin).toBeGreaterThan(0);
  });
});
