/**
 * NEXCOM Exchange — Business Rules Unit Tests
 *
 * Tests all domain-specific business rules in server/business-rules.ts.
 * All tests are pure (no DB, no network) — fast and deterministic.
 */

import { describe, it, expect } from "vitest";
import {
  validateOrder,
  calculateSettlementDate,
  validateReceiptTransition,
  isReceiptExpired,
  isReceiptEligibleForTrading,
  assessMarginCall,
  assessCircuitBreaker,
  assessAMLRisk,
  assessReKycRequired,
  assessCooperativeMembership,
  assessABCPIssuance,
  KYC_DAILY_LIMITS,
  MIN_LOT_SIZES,
  PRICE_BAND_PCT,
  INITIAL_MARGIN_RATE,
  MARGIN_THRESHOLDS,
  CIRCUIT_BREAKER_THRESHOLD_PCT,
  AML_THRESHOLDS,
} from "./business-rules";

// ─────────────────────────────────────────────────────────────────────────────
// 1. ORDER VALIDATION
// ─────────────────────────────────────────────────────────────────────────────

describe("validateOrder", () => {
  const baseInput = {
    symbol: "MAIZE-DEC25",
    side: "BUY" as const,
    orderType: "LIMIT" as const,
    quantity: 10,
    price: 100_000,
    lastTradedPrice: 100_000,
    availableMargin: 1_000_000,
    kycTier: 2 as const,
    dailyTradedValue: 0,
  };

  it("accepts a valid LIMIT order", () => {
    const result = validateOrder(baseInput);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("rejects quantity below minimum lot size", () => {
    const result = validateOrder({ ...baseInput, quantity: 5 }); // MAIZE min is 10
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes("Minimum lot size"))).toBe(true);
  });

  it("rejects quantity not a multiple of lot size", () => {
    const result = validateOrder({ ...baseInput, quantity: 15 }); // 15 is not multiple of 10
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes("multiple of the minimum lot size"))).toBe(true);
  });

  it("rejects price above upper price band", () => {
    const result = validateOrder({ ...baseInput, price: 110_000 }); // +10% above last traded
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes("upper price band"))).toBe(true);
  });

  it("rejects price below lower price band", () => {
    const result = validateOrder({ ...baseInput, price: 90_000 }); // -10% below last traded
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes("lower price band"))).toBe(true);
  });

  it("rejects order when margin is insufficient", () => {
    const result = validateOrder({ ...baseInput, availableMargin: 50_000 }); // 10 MT * 100k * 10% = 100k required
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes("Insufficient margin"))).toBe(true);
  });

  it("rejects when KYC Tier 1 daily limit is exceeded", () => {
    const result = validateOrder({
      ...baseInput,
      kycTier: 1,
      dailyTradedValue: 490_000,
      quantity: 10,
      price: 100_000, // 10 * 100k = 1M, total 1.49M > 500k limit
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes("Daily transaction limit exceeded"))).toBe(true);
  });

  it("warns when approaching KYC daily limit (>90%)", () => {
    const result = validateOrder({
      ...baseInput,
      kycTier: 1,
      dailyTradedValue: 450_000,
      quantity: 10,
      price: 4_000, // 10 * 4k = 40k, total 490k = 98% of 500k
      availableMargin: 1_000_000,
    });
    expect(result.warnings.some(w => w.includes("Approaching daily transaction limit"))).toBe(true);
  });

  it("warns on MARKET order slippage", () => {
    const result = validateOrder({ ...baseInput, orderType: "MARKET", price: undefined });
    expect(result.warnings.some(w => w.includes("slippage"))).toBe(true);
  });

  it("rejects LIMIT order without price", () => {
    const result = validateOrder({ ...baseInput, price: undefined });
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes("Limit price is required"))).toBe(true);
  });

  it("rejects STOP order without stop price", () => {
    const result = validateOrder({ ...baseInput, orderType: "STOP", stopPrice: undefined });
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes("Stop price is required"))).toBe(true);
  });

  it("calculates required margin correctly", () => {
    const result = validateOrder(baseInput);
    // 10 MT * 100,000 NGN/MT * 10% = 100,000 NGN
    expect(result.requiredMargin).toBe(100_000);
  });

  it("rejects zero quantity", () => {
    const result = validateOrder({ ...baseInput, quantity: 0 });
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes("greater than zero"))).toBe(true);
  });

  it("rejects quantity exceeding MAX_ORDER_SIZE_MT", () => {
    const result = validateOrder({ ...baseInput, quantity: 15_000 });
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes("Maximum single order size"))).toBe(true);
  });

  it("Tier 3 has no daily limit", () => {
    const result = validateOrder({
      ...baseInput,
      kycTier: 3,
      dailyTradedValue: 1_000_000_000, // 1 billion
      quantity: 10,
      price: 100_000,
    });
    // Should not fail on daily limit (may fail on margin or price band)
    expect(result.errors.some(e => e.includes("Daily transaction limit"))).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. SETTLEMENT DATE CALCULATION
// ─────────────────────────────────────────────────────────────────────────────

describe("calculateSettlementDate", () => {
  it("T+0 returns same day", () => {
    const tradeDate = new Date("2025-06-10T10:00:00Z"); // Tuesday
    const result = calculateSettlementDate(tradeDate, "T+0");
    expect(result.settlementDate.toDateString()).toBe(tradeDate.toDateString());
    expect(result.isT0).toBe(true);
  });

  it("T+1 skips weekends", () => {
    const tradeDate = new Date("2025-06-13T10:00:00Z"); // Friday
    const result = calculateSettlementDate(tradeDate, "T+1");
    // Next business day after Friday is Monday
    expect(result.settlementDate.getDay()).toBe(1); // Monday
  });

  it("T+2 adds two business days", () => {
    // Use a date with no holidays nearby: Monday June 2, 2025
    const tradeDate = new Date("2025-06-02T10:00:00Z"); // Monday
    const result = calculateSettlementDate(tradeDate, "T+2");
    // Monday + 2 business days = Wednesday
    expect(result.settlementDate.getDay()).toBe(3); // Wednesday
  });

  it("T+2 from Thursday skips weekend", () => {
    const tradeDate = new Date("2025-06-12T10:00:00Z"); // Thursday
    const result = calculateSettlementDate(tradeDate, "T+2");
    // Thursday + 2 business days = Monday (skips Sat/Sun)
    expect(result.settlementDate.getDay()).toBe(1); // Monday
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. WAREHOUSE RECEIPT LIFECYCLE
// ─────────────────────────────────────────────────────────────────────────────

describe("validateReceiptTransition", () => {
  it("allows PENDING_INSPECTION → ACTIVE", () => {
    const result = validateReceiptTransition("PENDING_INSPECTION", "ACTIVE");
    expect(result.allowed).toBe(true);
  });

  it("allows ACTIVE → PLEDGED", () => {
    const result = validateReceiptTransition("ACTIVE", "PLEDGED");
    expect(result.allowed).toBe(true);
  });

  it("allows PLEDGED → ACTIVE (unpledge)", () => {
    const result = validateReceiptTransition("PLEDGED", "ACTIVE");
    expect(result.allowed).toBe(true);
  });

  it("disallows REDEEMED → ACTIVE (terminal state)", () => {
    const result = validateReceiptTransition("REDEEMED", "ACTIVE");
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("Cannot transition");
  });

  it("disallows EXPIRED → PLEDGED", () => {
    const result = validateReceiptTransition("EXPIRED", "PLEDGED");
    expect(result.allowed).toBe(false);
  });

  it("disallows CANCELLED → ACTIVE", () => {
    const result = validateReceiptTransition("CANCELLED", "ACTIVE");
    expect(result.allowed).toBe(false);
  });
});

describe("isReceiptExpired", () => {
  it("returns true for past date", () => {
    expect(isReceiptExpired(new Date("2020-01-01"))).toBe(true);
  });

  it("returns false for future date", () => {
    expect(isReceiptExpired(new Date("2099-01-01"))).toBe(false);
  });
});

describe("isReceiptEligibleForTrading", () => {
  it("returns true for ACTIVE non-expired receipt", () => {
    expect(isReceiptEligibleForTrading("ACTIVE", new Date("2099-01-01"))).toBe(true);
  });

  it("returns false for PLEDGED receipt", () => {
    expect(isReceiptEligibleForTrading("PLEDGED", new Date("2099-01-01"))).toBe(false);
  });

  it("returns false for expired ACTIVE receipt", () => {
    expect(isReceiptEligibleForTrading("ACTIVE", new Date("2020-01-01"))).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. MARGIN CALL RULES
// ─────────────────────────────────────────────────────────────────────────────

describe("assessMarginCall", () => {
  it("returns SAFE when utilization is below 80%", () => {
    const result = assessMarginCall(100_000, 80_000, 1_000_000, 500_000);
    expect(result.level).toBe("SAFE");
    expect(result.utilizationPct).toBeLessThan(80);
  });

  it("returns WARNING at 80-95% utilization", () => {
    // Required margin = 500k * 10% = 50k, balance = 60k → 83% utilization
    const result = assessMarginCall(50_000, 40_000, 60_000, 500_000);
    expect(result.level).toBe("WARNING");
    expect(result.requiredAction).toContain("additional margin");
  });

  it("returns CRITICAL at 95-100% utilization", () => {
    // Required = 50k, balance = 52k → 96% utilization
    const result = assessMarginCall(50_000, 40_000, 52_000, 500_000);
    expect(result.level).toBe("CRITICAL");
    expect(result.requiredAction).toContain("2 hours");
  });

  it("returns LIQUIDATION at 100%+ utilization", () => {
    // Required = 50k, balance = 49k → 102% utilization
    const result = assessMarginCall(50_000, 40_000, 49_000, 500_000);
    expect(result.level).toBe("LIQUIDATION");
    expect(result.requiredAction).toContain("liquidation");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. CIRCUIT BREAKER
// ─────────────────────────────────────────────────────────────────────────────

describe("assessCircuitBreaker", () => {
  it("triggers at exactly 10% price move", () => {
    const result = assessCircuitBreaker(100_000, 110_000); // +10%
    expect(result.triggered).toBe(true);
    expect(result.haltDurationMinutes).toBe(15);
  });

  it("triggers on downward 10% move", () => {
    const result = assessCircuitBreaker(100_000, 90_000); // -10%
    expect(result.triggered).toBe(true);
  });

  it("does not trigger at 9% move", () => {
    const result = assessCircuitBreaker(100_000, 109_000); // +9%
    expect(result.triggered).toBe(false);
    expect(result.haltDurationMinutes).toBe(0);
  });

  it("reports correct price change percentage", () => {
    const result = assessCircuitBreaker(100_000, 115_000); // +15%
    expect(result.priceChangePct).toBeCloseTo(15, 1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. AML TRANSACTION MONITORING
// ─────────────────────────────────────────────────────────────────────────────

describe("assessAMLRisk", () => {
  it("returns LOW risk for normal transaction", () => {
    const result = assessAMLRisk(100_000, 200_000, 300_000, 2, false, "NG");
    expect(result.riskLevel).toBe("LOW");
    expect(result.requiresReview).toBe(false);
    expect(result.requiresSAR).toBe(false);
  });

  it("flags large transaction ≥ ₦5M", () => {
    const result = assessAMLRisk(5_000_000, 5_000_000, 5_000_000, 1, false, "NG");
    expect(result.flags.some(f => f.includes("Large transaction"))).toBe(true);
    expect(result.requiresReview).toBe(true);
  });

  it("flags potential structuring", () => {
    // 3-day total ≥ 4.5M but individual transaction < 5M
    const result = assessAMLRisk(1_500_000, 1_500_000, 4_600_000, 1, false, "NG");
    expect(result.flags.some(f => f.includes("structuring"))).toBe(true);
  });

  it("flags high transaction velocity", () => {
    const result = assessAMLRisk(100_000, 200_000, 300_000, 15, false, "NG"); // 15 tx/hour
    expect(result.flags.some(f => f.includes("velocity"))).toBe(true);
  });

  it("flags high-risk jurisdiction (FATF)", () => {
    const result = assessAMLRisk(100_000, 200_000, 300_000, 1, false, "IR"); // Iran
    expect(result.flags.some(f => f.includes("High-risk jurisdiction"))).toBe(true);
    expect(result.riskLevel).toBe("HIGH"); // 50 points alone = HIGH (need 70 for CRITICAL)
  });

  it("requires SAR for transaction ≥ ₦10M", () => {
    // 10M transaction: large transaction flag (+30) + SAR threshold met
    const result = assessAMLRisk(10_000_000, 10_000_000, 10_000_000, 1, false, "NG");
    expect(result.requiresSAR).toBe(true);
    expect(result.flags.some(f => f.includes("Large transaction"))).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. RE-KYC RULES
// ─────────────────────────────────────────────────────────────────────────────

describe("assessReKycRequired", () => {
  it("requires re-KYC after 12 months for standard risk", () => {
    const lastKyc = new Date();
    lastKyc.setMonth(lastKyc.getMonth() - 13); // 13 months ago
    const result = assessReKycRequired(lastKyc, 30, 1_000_000, false);
    expect(result.required).toBe(true);
    expect(result.urgency).toBe("ROUTINE");
  });

  it("requires re-KYC after 6 months for high-risk (score ≥ 70)", () => {
    const lastKyc = new Date();
    lastKyc.setMonth(lastKyc.getMonth() - 7); // 7 months ago
    const result = assessReKycRequired(lastKyc, 75, 1_000_000, false);
    expect(result.required).toBe(true);
    expect(result.urgency).toBe("ELEVATED");
  });

  it("requires immediate re-KYC for active dispute", () => {
    const lastKyc = new Date(); // Just verified
    const result = assessReKycRequired(lastKyc, 30, 1_000_000, true);
    expect(result.required).toBe(true);
    expect(result.urgency).toBe("IMMEDIATE");
  });

  it("does not require re-KYC for recently verified low-risk", () => {
    const lastKyc = new Date();
    lastKyc.setMonth(lastKyc.getMonth() - 3); // 3 months ago
    const result = assessReKycRequired(lastKyc, 30, 1_000_000, false);
    expect(result.required).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 8. COOPERATIVE MEMBERSHIP
// ─────────────────────────────────────────────────────────────────────────────

describe("assessCooperativeMembership", () => {
  it("approves eligible member", () => {
    const result = assessCooperativeMembership(true, 1, true, false, 0);
    expect(result.eligible).toBe(true);
    expect(result.reasons).toHaveLength(0);
  });

  it("rejects member without valid KYC", () => {
    const result = assessCooperativeMembership(false, 1, true, false, 0);
    expect(result.eligible).toBe(false);
    expect(result.reasons.some(r => r.includes("KYC"))).toBe(true);
  });

  it("rejects non-Nigerian resident", () => {
    const result = assessCooperativeMembership(true, 1, false, false, 0);
    expect(result.eligible).toBe(false);
    expect(result.reasons.some(r => r.includes("Nigerian residents"))).toBe(true);
  });

  it("rejects member with 3 existing memberships", () => {
    const result = assessCooperativeMembership(true, 1, true, false, 3);
    expect(result.eligible).toBe(false);
    expect(result.reasons.some(r => r.includes("Maximum of 3"))).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 9. ABCP ISSUANCE
// ─────────────────────────────────────────────────────────────────────────────

describe("assessABCPIssuance", () => {
  const futureExpiry = new Date();
  futureExpiry.setMonth(futureExpiry.getMonth() + 6); // 6 months from now

  it("approves eligible ABCP issuance", () => {
    const result = assessABCPIssuance(10_000_000, "ACTIVE", futureExpiry, 2, 75);
    expect(result.eligible).toBe(true);
    expect(result.maxIssuanceAmount).toBe(8_000_000); // 80% of 10M
  });

  it("rejects non-ACTIVE receipt", () => {
    const result = assessABCPIssuance(10_000_000, "PLEDGED", futureExpiry, 2, 75);
    expect(result.eligible).toBe(false);
    expect(result.reasons.some(r => r.includes("ACTIVE"))).toBe(true);
  });

  it("rejects expired receipt", () => {
    const pastExpiry = new Date("2020-01-01");
    const result = assessABCPIssuance(10_000_000, "ACTIVE", pastExpiry, 2, 75);
    expect(result.eligible).toBe(false);
    expect(result.reasons.some(r => r.includes("expired"))).toBe(true);
  });

  it("rejects KYC Tier 1 issuer", () => {
    const result = assessABCPIssuance(10_000_000, "ACTIVE", futureExpiry, 1, 75);
    expect(result.eligible).toBe(false);
    expect(result.reasons.some(r => r.includes("KYC Tier 2"))).toBe(true);
  });

  it("rejects low credit score", () => {
    const result = assessABCPIssuance(10_000_000, "ACTIVE", futureExpiry, 2, 50);
    expect(result.eligible).toBe(false);
    expect(result.reasons.some(r => r.includes("Credit score"))).toBe(true);
  });

  it("rejects receipt expiring in less than 30 days", () => {
    const nearExpiry = new Date();
    nearExpiry.setDate(nearExpiry.getDate() + 15); // 15 days from now
    const result = assessABCPIssuance(10_000_000, "ACTIVE", nearExpiry, 2, 75);
    expect(result.eligible).toBe(false);
    expect(result.reasons.some(r => r.includes("30 days"))).toBe(true);
  });

  it("returns 0 max issuance when not eligible", () => {
    const result = assessABCPIssuance(10_000_000, "PLEDGED", futureExpiry, 2, 75);
    expect(result.maxIssuanceAmount).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 10. CONSTANTS VALIDATION
// ─────────────────────────────────────────────────────────────────────────────

describe("Business Rule Constants", () => {
  it("KYC Tier 1 daily limit is ₦500K", () => {
    expect(KYC_DAILY_LIMITS[1]).toBe(500_000);
  });

  it("KYC Tier 2 daily limit is ₦5M", () => {
    expect(KYC_DAILY_LIMITS[2]).toBe(5_000_000);
  });

  it("KYC Tier 3 has no daily limit", () => {
    expect(KYC_DAILY_LIMITS[3]).toBe(Infinity);
  });

  it("MAIZE minimum lot size is 10 MT", () => {
    expect(MIN_LOT_SIZES["MAIZE"]).toBe(10);
  });

  it("COCOA minimum lot size is 1 MT", () => {
    expect(MIN_LOT_SIZES["COCOA"]).toBe(1);
  });

  it("Price band is 5%", () => {
    expect(PRICE_BAND_PCT).toBe(0.05);
  });

  it("Initial margin rate is 10%", () => {
    expect(INITIAL_MARGIN_RATE).toBe(0.10);
  });

  it("Margin warning threshold is 80%", () => {
    expect(MARGIN_THRESHOLDS.WARNING).toBe(0.80);
  });

  it("Circuit breaker threshold is 10%", () => {
    expect(CIRCUIT_BREAKER_THRESHOLD_PCT).toBe(0.10);
  });

  it("AML large transaction threshold is ₦5M", () => {
    expect(AML_THRESHOLDS.LARGE_CASH_TRANSACTION).toBe(5_000_000);
  });
});
