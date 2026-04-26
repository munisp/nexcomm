/**
 * NEXCOM Exchange — Business Rules & Lifecycle Workflows
 *
 * This module centralises all domain-specific business rules for the platform.
 * Rules are pure functions (no side-effects) so they can be unit-tested in isolation.
 *
 * Domains covered:
 *  1. Order validation (price bands, lot sizes, margin requirements)
 *  2. KYC tier limits (daily transaction caps per tier)
 *  3. Settlement lifecycle (T+0, T+1, T+2 rules)
 *  4. Warehouse receipt lifecycle (deposit → active → pledged → redeemed → expired)
 *  5. Margin call rules (warning / critical / liquidation thresholds)
 *  6. Circuit breaker rules (price band limits, halt durations)
 *  7. Cooperative membership rules (eligibility, voting rights)
 *  8. ABCP (Asset-Backed Commercial Paper) issuance rules
 *  9. AML transaction monitoring thresholds
 * 10. Re-KYC trigger rules
 */

// ─────────────────────────────────────────────────────────────────────────────
// 1. ORDER VALIDATION RULES
// ─────────────────────────────────────────────────────────────────────────────

export interface OrderValidationInput {
  symbol: string;
  side: "BUY" | "SELL";
  orderType: "LIMIT" | "MARKET" | "STOP" | "STOP_LIMIT" | "ICEBERG" | "FILL_OR_KILL" | "IMMEDIATE_OR_CANCEL";
  quantity: number;         // in metric tons (MT)
  price?: number;           // NGN per MT (required for LIMIT orders)
  stopPrice?: number;       // NGN per MT (required for STOP orders)
  lastTradedPrice: number;  // NGN per MT (current market price)
  availableMargin: number;  // NGN
  kycTier: 1 | 2 | 3;
  dailyTradedValue: number; // NGN — total traded today
}

export interface OrderValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  requiredMargin?: number;
}

/** Daily transaction limits by KYC tier (NGN) */
export const KYC_DAILY_LIMITS: Record<number, number> = {
  1: 500_000,       // Tier 1: ₦500K/day (individual, basic NIN verification)
  2: 5_000_000,     // Tier 2: ₦5M/day (individual, enhanced verification)
  3: Infinity,      // Tier 3: No limit (corporate, full CAC verification)
};

/** Minimum lot sizes by commodity (MT) */
export const MIN_LOT_SIZES: Record<string, number> = {
  MAIZE: 10,
  SORGHUM: 10,
  SOYBEAN: 5,
  WHEAT: 5,
  COCOA: 1,
  COFFEE: 1,
  COTTON: 5,
  PALMOIL: 1,
  SESAME: 5,
  CASHEW: 1,
  GINGER: 1,
  DEFAULT: 1,
};

/** Maximum single order size (MT) */
export const MAX_ORDER_SIZE_MT = 10_000;

/** Initial margin rate (10% of contract value) */
export const INITIAL_MARGIN_RATE = 0.10;

/** Daily price band limit (±5%) */
export const PRICE_BAND_PCT = 0.05;

export function validateOrder(input: OrderValidationInput): OrderValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Extract base symbol (e.g., "MAIZE" from "MAIZE-DEC25")
  const baseSymbol = input.symbol.split("-")[0];
  const minLot = MIN_LOT_SIZES[baseSymbol] ?? MIN_LOT_SIZES.DEFAULT;

  // 1. Quantity validation
  if (input.quantity <= 0) {
    errors.push("Order quantity must be greater than zero.");
  }
  if (input.quantity < minLot) {
    errors.push(`Minimum lot size for ${baseSymbol} is ${minLot} MT. Received: ${input.quantity} MT.`);
  }
  if (input.quantity > MAX_ORDER_SIZE_MT) {
    errors.push(`Maximum single order size is ${MAX_ORDER_SIZE_MT.toLocaleString()} MT. Received: ${input.quantity} MT.`);
  }
  if (input.quantity % minLot !== 0) {
    errors.push(`Order quantity must be a multiple of the minimum lot size (${minLot} MT).`);
  }

  // 2. Price band validation (LIMIT orders only)
  if (input.orderType === "LIMIT" || input.orderType === "STOP_LIMIT") {
    if (!input.price || input.price <= 0) {
      errors.push("Limit price is required and must be positive.");
    } else {
      const upperBand = input.lastTradedPrice * (1 + PRICE_BAND_PCT);
      const lowerBand = input.lastTradedPrice * (1 - PRICE_BAND_PCT);
      if (input.price > upperBand) {
        errors.push(`Limit price ₦${input.price.toLocaleString()} exceeds upper price band of ₦${upperBand.toFixed(2)} (+5%).`);
      }
      if (input.price < lowerBand) {
        errors.push(`Limit price ₦${input.price.toLocaleString()} is below lower price band of ₦${lowerBand.toFixed(2)} (-5%).`);
      }
    }
  }

  // 3. Stop price validation
  if (input.orderType === "STOP" || input.orderType === "STOP_LIMIT") {
    if (!input.stopPrice || input.stopPrice <= 0) {
      errors.push("Stop price is required and must be positive.");
    }
  }

  // 4. Margin requirement
  const contractValue = (input.price ?? input.lastTradedPrice) * input.quantity;
  const requiredMargin = contractValue * INITIAL_MARGIN_RATE;
  if (input.availableMargin < requiredMargin) {
    errors.push(`Insufficient margin. Required: ₦${requiredMargin.toLocaleString()}. Available: ₦${input.availableMargin.toLocaleString()}.`);
  }

  // 5. KYC tier daily limit
  const dailyLimit = KYC_DAILY_LIMITS[input.kycTier];
  const newDailyTotal = input.dailyTradedValue + contractValue;
  if (newDailyTotal > dailyLimit) {
    errors.push(`Daily transaction limit exceeded for KYC Tier ${input.kycTier}. Limit: ₦${dailyLimit.toLocaleString()}. Would reach: ₦${newDailyTotal.toLocaleString()}.`);
  } else if (newDailyTotal > dailyLimit * 0.9) {
    warnings.push(`Approaching daily transaction limit (${((newDailyTotal / dailyLimit) * 100).toFixed(1)}% used).`);
  }

  // 6. Market order warning
  if (input.orderType === "MARKET") {
    warnings.push("Market orders execute at the best available price and may result in significant slippage.");
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    requiredMargin,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. SETTLEMENT LIFECYCLE RULES
// ─────────────────────────────────────────────────────────────────────────────

export type SettlementCycle = "T+0" | "T+1" | "T+2";

export interface SettlementSchedule {
  tradeDate: Date;
  settlementDate: Date;
  cycle: SettlementCycle;
  isT0: boolean;
}

/**
 * Calculate settlement date based on trade date and cycle.
 * Skips weekends (Saturday, Sunday) and Nigerian public holidays.
 * T+0 is only available for pre-approved market makers.
 */
export function calculateSettlementDate(tradeDate: Date, cycle: SettlementCycle): SettlementSchedule {
  const NIGERIAN_HOLIDAYS_2025 = [
    "2025-01-01", "2025-04-18", "2025-04-21", "2025-05-01",
    "2025-06-12", "2025-10-01", "2025-12-25", "2025-12-26",
  ];

  function isBusinessDay(date: Date): boolean {
    const dayOfWeek = date.getDay();
    if (dayOfWeek === 0 || dayOfWeek === 6) return false; // Weekend
    const dateStr = date.toISOString().split("T")[0];
    return !NIGERIAN_HOLIDAYS_2025.includes(dateStr);
  }

  function addBusinessDays(date: Date, days: number): Date {
    const result = new Date(date);
    let added = 0;
    while (added < days) {
      result.setDate(result.getDate() + 1);
      if (isBusinessDay(result)) added++;
    }
    return result;
  }

  const daysToAdd = cycle === "T+0" ? 0 : cycle === "T+1" ? 1 : 2;
  const settlementDate = daysToAdd === 0 ? new Date(tradeDate) : addBusinessDays(tradeDate, daysToAdd);

  return {
    tradeDate,
    settlementDate,
    cycle,
    isT0: cycle === "T+0",
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. WAREHOUSE RECEIPT LIFECYCLE
// ─────────────────────────────────────────────────────────────────────────────

export type WarehouseReceiptStatus =
  | "PENDING_INSPECTION"
  | "ACTIVE"
  | "PLEDGED"
  | "UNDER_DELIVERY"
  | "REDEEMED"
  | "EXPIRED"
  | "CANCELLED";

export interface WarehouseReceiptTransition {
  from: WarehouseReceiptStatus;
  to: WarehouseReceiptStatus;
  allowed: boolean;
  reason?: string;
}

/** Valid state transitions for warehouse receipts */
const RECEIPT_TRANSITIONS: Record<WarehouseReceiptStatus, WarehouseReceiptStatus[]> = {
  PENDING_INSPECTION: ["ACTIVE", "CANCELLED"],
  ACTIVE: ["PLEDGED", "UNDER_DELIVERY", "EXPIRED", "CANCELLED"],
  PLEDGED: ["ACTIVE", "UNDER_DELIVERY", "EXPIRED"],   // Can be unpledged or delivered
  UNDER_DELIVERY: ["REDEEMED", "ACTIVE"],              // Delivery completes or is reversed
  REDEEMED: [],                                         // Terminal state
  EXPIRED: [],                                          // Terminal state
  CANCELLED: [],                                        // Terminal state
};

export function validateReceiptTransition(
  from: WarehouseReceiptStatus,
  to: WarehouseReceiptStatus
): WarehouseReceiptTransition {
  const allowed = RECEIPT_TRANSITIONS[from]?.includes(to) ?? false;
  return {
    from,
    to,
    allowed,
    reason: allowed
      ? undefined
      : `Cannot transition warehouse receipt from ${from} to ${to}. Allowed transitions: ${RECEIPT_TRANSITIONS[from]?.join(", ") || "none"}.`,
  };
}

export function isReceiptExpired(expiryDate: Date): boolean {
  return new Date() > expiryDate;
}

export function isReceiptEligibleForTrading(status: WarehouseReceiptStatus, expiryDate: Date): boolean {
  return status === "ACTIVE" && !isReceiptExpired(expiryDate);
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. MARGIN CALL RULES
// ─────────────────────────────────────────────────────────────────────────────

export type MarginCallLevel = "SAFE" | "WARNING" | "CRITICAL" | "LIQUIDATION";

export interface MarginCallAssessment {
  level: MarginCallLevel;
  utilizationPct: number;
  availableMargin: number;
  requiredAction?: string;
}

/** Margin utilisation thresholds */
export const MARGIN_THRESHOLDS = {
  WARNING: 0.80,      // 80% — send warning notification
  CRITICAL: 0.95,     // 95% — send critical alert, restrict new orders
  LIQUIDATION: 1.00,  // 100% — force liquidation
};

export function assessMarginCall(
  initialMargin: number,
  maintenanceMargin: number,
  currentBalance: number,
  openPositionValue: number
): MarginCallAssessment {
  const requiredMargin = Math.max(maintenanceMargin, openPositionValue * INITIAL_MARGIN_RATE);
  const utilization = requiredMargin > 0 ? (requiredMargin / currentBalance) : 0;
  const availableMargin = currentBalance - requiredMargin;

  let level: MarginCallLevel = "SAFE";
  let requiredAction: string | undefined;

  if (utilization >= MARGIN_THRESHOLDS.LIQUIDATION) {
    level = "LIQUIDATION";
    requiredAction = "Immediate forced liquidation of open positions. All new orders blocked.";
  } else if (utilization >= MARGIN_THRESHOLDS.CRITICAL) {
    level = "CRITICAL";
    requiredAction = "Deposit additional margin within 2 hours or positions will be liquidated.";
  } else if (utilization >= MARGIN_THRESHOLDS.WARNING) {
    level = "WARNING";
    requiredAction = "Consider depositing additional margin to avoid a margin call.";
  }

  return { level, utilizationPct: utilization * 100, availableMargin, requiredAction };
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. CIRCUIT BREAKER RULES
// ─────────────────────────────────────────────────────────────────────────────

export interface CircuitBreakerAssessment {
  triggered: boolean;
  haltDurationMinutes: number;
  reason?: string;
  priceChangePct: number;
}

/** Circuit breaker triggers at 10% price move from previous close */
export const CIRCUIT_BREAKER_THRESHOLD_PCT = 0.10;
export const CIRCUIT_BREAKER_HALT_MINUTES = 15;

export function assessCircuitBreaker(
  previousClose: number,
  currentPrice: number
): CircuitBreakerAssessment {
  const priceChangePct = Math.abs((currentPrice - previousClose) / previousClose);
  const triggered = priceChangePct >= CIRCUIT_BREAKER_THRESHOLD_PCT;

  return {
    triggered,
    haltDurationMinutes: triggered ? CIRCUIT_BREAKER_HALT_MINUTES : 0,
    reason: triggered
      ? `Price moved ${(priceChangePct * 100).toFixed(2)}% from previous close of ₦${previousClose.toLocaleString()}. Circuit breaker triggered.`
      : undefined,
    priceChangePct: priceChangePct * 100,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. AML TRANSACTION MONITORING
// ─────────────────────────────────────────────────────────────────────────────

export interface AMLAssessment {
  riskLevel: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  flags: string[];
  requiresReview: boolean;
  requiresSAR: boolean;  // Suspicious Activity Report
}

/** AML thresholds (NGN) */
export const AML_THRESHOLDS = {
  LARGE_CASH_TRANSACTION: 5_000_000,    // ₦5M — requires enhanced due diligence
  STRUCTURING_WINDOW_DAYS: 3,           // 3-day window for structuring detection
  STRUCTURING_TOTAL: 4_500_000,         // ₦4.5M in 3 days — potential structuring
  VELOCITY_HOURLY: 10,                  // 10 transactions/hour — velocity check
  SAR_THRESHOLD: 10_000_000,            // ₦10M — automatic SAR filing
};

export function assessAMLRisk(
  transactionAmount: number,
  dailyTotal: number,
  threeeDayTotal: number,
  hourlyCount: number,
  isNewCounterparty: boolean,
  counterpartyJurisdiction: string
): AMLAssessment {
  const flags: string[] = [];
  let riskScore = 0;

  // Large transaction
  if (transactionAmount >= AML_THRESHOLDS.LARGE_CASH_TRANSACTION) {
    flags.push(`Large transaction: ₦${transactionAmount.toLocaleString()} exceeds ₦5M threshold.`);
    riskScore += 30;
  }

  // Structuring detection
  if (threeeDayTotal >= AML_THRESHOLDS.STRUCTURING_TOTAL && transactionAmount < AML_THRESHOLDS.LARGE_CASH_TRANSACTION) {
    flags.push(`Potential structuring: ₦${threeeDayTotal.toLocaleString()} in 3 days with sub-threshold transactions.`);
    riskScore += 40;
  }

  // Velocity check
  if (hourlyCount >= AML_THRESHOLDS.VELOCITY_HOURLY) {
    flags.push(`High transaction velocity: ${hourlyCount} transactions in the last hour.`);
    riskScore += 25;
  }

  // New counterparty
  if (isNewCounterparty) {
    flags.push("New counterparty — first transaction with this entity.");
    riskScore += 10;
  }

  // High-risk jurisdiction
  const HIGH_RISK_JURISDICTIONS = ["IR", "KP", "SY", "CU", "VE", "MM", "BY"];
  if (HIGH_RISK_JURISDICTIONS.includes(counterpartyJurisdiction)) {
    flags.push(`High-risk jurisdiction: ${counterpartyJurisdiction} (FATF grey/black list).`);
    riskScore += 50;
  }

  const riskLevel: AMLAssessment["riskLevel"] =
    riskScore >= 70 ? "CRITICAL" :
    riskScore >= 50 ? "HIGH" :
    riskScore >= 25 ? "MEDIUM" : "LOW";

  return {
    riskLevel,
    flags,
    requiresReview: riskScore >= 25,
    requiresSAR: transactionAmount >= AML_THRESHOLDS.SAR_THRESHOLD || riskScore >= 70,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 7. RE-KYC TRIGGER RULES
// ─────────────────────────────────────────────────────────────────────────────

export interface ReKycAssessment {
  required: boolean;
  reason?: string;
  urgency: "ROUTINE" | "ELEVATED" | "IMMEDIATE";
}

/** KYC validity period: 12 months for standard, 6 months for high-risk */
export const KYC_VALIDITY_MONTHS = { STANDARD: 12, HIGH_RISK: 6 };

export function assessReKycRequired(
  lastKycDate: Date,
  riskScore: number,
  monthlyTradedValue: number,
  hasActiveDispute: boolean
): ReKycAssessment {
  const now = new Date();
  const monthsSinceKyc = (now.getTime() - lastKycDate.getTime()) / (1000 * 60 * 60 * 24 * 30);
  const isHighRisk = riskScore >= 70;
  const validityMonths = isHighRisk ? KYC_VALIDITY_MONTHS.HIGH_RISK : KYC_VALIDITY_MONTHS.STANDARD;

  if (hasActiveDispute) {
    return { required: true, reason: "Active dispute requires immediate KYC review.", urgency: "IMMEDIATE" };
  }

  if (monthsSinceKyc >= validityMonths) {
    return {
      required: true,
      reason: `KYC expired: ${monthsSinceKyc.toFixed(0)} months since last verification (limit: ${validityMonths} months).`,
      urgency: isHighRisk ? "ELEVATED" : "ROUTINE",
    };
  }

  if (monthlyTradedValue > 100_000_000 && monthsSinceKyc > 6) {
    return {
      required: true,
      reason: `High-volume trader (₦${(monthlyTradedValue / 1_000_000).toFixed(1)}M/month) — enhanced due diligence required.`,
      urgency: "ELEVATED",
    };
  }

  return { required: false, urgency: "ROUTINE" };
}

// ─────────────────────────────────────────────────────────────────────────────
// 8. COOPERATIVE MEMBERSHIP RULES
// ─────────────────────────────────────────────────────────────────────────────

export interface CooperativeMembershipEligibility {
  eligible: boolean;
  reasons: string[];
}

export function assessCooperativeMembership(
  hasValidKyc: boolean,
  kycTier: 1 | 2 | 3,
  isNigerianResident: boolean,
  hasActiveWarehouseReceipt: boolean,
  existingMembershipCount: number
): CooperativeMembershipEligibility {
  const reasons: string[] = [];

  if (!hasValidKyc) reasons.push("Valid KYC verification required for cooperative membership.");
  if (kycTier < 1) reasons.push("Minimum KYC Tier 1 required.");
  if (!isNigerianResident) reasons.push("Cooperative membership is restricted to Nigerian residents.");
  if (existingMembershipCount >= 3) reasons.push("Maximum of 3 cooperative memberships per member.");

  return {
    eligible: reasons.length === 0,
    reasons,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 9. ABCP ISSUANCE RULES
// ─────────────────────────────────────────────────────────────────────────────

export interface ABCPIssuanceEligibility {
  eligible: boolean;
  maxIssuanceAmount: number;
  reasons: string[];
}

/** ABCP: Asset-Backed Commercial Paper backed by warehouse receipts */
export function assessABCPIssuance(
  warehouseReceiptValue: number,
  receiptStatus: WarehouseReceiptStatus,
  receiptExpiryDate: Date,
  issuerKycTier: 1 | 2 | 3,
  issuerCreditScore: number  // 0-100
): ABCPIssuanceEligibility {
  const reasons: string[] = [];

  if (receiptStatus !== "ACTIVE") {
    reasons.push(`Warehouse receipt must be ACTIVE for ABCP issuance. Current status: ${receiptStatus}.`);
  }
  if (isReceiptExpired(receiptExpiryDate)) {
    reasons.push("Warehouse receipt has expired and cannot be used as ABCP collateral.");
  }
  // ABCP maturity cannot exceed receipt expiry
  const daysToExpiry = (receiptExpiryDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24);
  if (daysToExpiry < 30) {
    reasons.push(`Warehouse receipt expires in ${daysToExpiry.toFixed(0)} days. Minimum 30 days required for ABCP issuance.`);
  }
  if (issuerKycTier < 2) {
    reasons.push("ABCP issuance requires minimum KYC Tier 2 (enhanced verification).");
  }
  if (issuerCreditScore < 60) {
    reasons.push(`Credit score ${issuerCreditScore}/100 is below the minimum threshold of 60 for ABCP issuance.`);
  }

  // Maximum issuance: 80% of warehouse receipt value (20% haircut)
  const HAIRCUT = 0.20;
  const maxIssuanceAmount = reasons.length === 0 ? warehouseReceiptValue * (1 - HAIRCUT) : 0;

  return {
    eligible: reasons.length === 0,
    maxIssuanceAmount,
    reasons,
  };
}
