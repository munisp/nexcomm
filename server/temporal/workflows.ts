/**
 * NEXCOM Exchange — Temporal Workflow Definitions (P2-B)
 *
 * These workflow definitions describe the durable, fault-tolerant business
 * processes that run on the Temporal cluster. They are registered with the
 * gateway-service worker and invoked via the /temporal/start HTTP proxy.
 *
 * Workflows defined here:
 *  1. MarginCallWorkflow  — escalating notifications → auto-liquidation
 *  2. KycReviewWorkflow   — SLA-gated KYC review with escalation
 *  3. SettlementWorkflow  — T+2 settlement lifecycle with retry/rollback
 *  4. LoanDisbursementWorkflow — multi-step loan approval → disbursement
 */

// ─────────────────────────────────────────────────────────────────────────────
// Shared types
// ─────────────────────────────────────────────────────────────────────────────

export interface WorkflowInput<T = Record<string, unknown>> {
  workflowId: string;
  userId: number;
  payload: T;
}

export interface WorkflowResult {
  status: "COMPLETED" | "FAILED" | "CANCELLED" | "TIMED_OUT";
  output?: Record<string, unknown>;
  error?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. MarginCallWorkflow
// ─────────────────────────────────────────────────────────────────────────────

export interface MarginCallInput {
  userId: number;
  accountId: number;
  utilisationPct: number;
  deadlineMinutes: number;
  reason?: string;
}

/**
 * MarginCallWorkflow
 *
 * Steps:
 *  T+0min  → Send initial margin call notification (email + in-app)
 *  T+15min → Re-check margin; if still breached, escalate to SMS
 *  T+30min → Re-check margin; if still breached, escalate to USSD + email
 *  T+deadline → If margin still breached, trigger auto-liquidation of
 *               smallest positions until utilisationPct < 80%
 *
 * Activities: sendMarginCallNotification, checkMarginUtilisation,
 *             liquidatePositions, recordLiquidationAudit
 */
export const MARGIN_CALL_WORKFLOW = {
  name: "MarginCallWorkflow",
  taskQueue: "nexcom-margin",
  activities: [
    "sendMarginCallNotification",
    "checkMarginUtilisation",
    "liquidatePositions",
    "recordLiquidationAudit",
  ],
  timeoutSeconds: 3600, // 1 hour max
  retryPolicy: {
    maximumAttempts: 3,
    initialIntervalSeconds: 30,
    backoffCoefficient: 2,
  },
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// 2. KycReviewWorkflow
// ─────────────────────────────────────────────────────────────────────────────

export interface KycReviewInput {
  userId: number;
  profileType: "FARMER" | "BROKER" | "TRADER";
  profileId: number;
  submittedAt: string; // ISO timestamp
}

/**
 * KycReviewWorkflow
 *
 * Steps:
 *  T+0    → Assign to available compliance officer (round-robin)
 *  T+24h  → If still PENDING, send reminder to compliance team
 *  T+48h  → If still PENDING, escalate to compliance manager
 *  T+72h  → If still PENDING, auto-flag as OVERDUE in compliance dashboard
 *
 * Activities: assignKycReviewer, sendKycReminderNotification,
 *             escalateKycToManager, flagKycOverdue
 */
export const KYC_REVIEW_WORKFLOW = {
  name: "KycReviewWorkflow",
  taskQueue: "nexcom-kyc",
  activities: [
    "assignKycReviewer",
    "sendKycReminderNotification",
    "escalateKycToManager",
    "flagKycOverdue",
  ],
  timeoutSeconds: 259200, // 72 hours
  retryPolicy: {
    maximumAttempts: 2,
    initialIntervalSeconds: 60,
    backoffCoefficient: 1.5,
  },
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// 3. SettlementWorkflow
// ─────────────────────────────────────────────────────────────────────────────

export interface SettlementInput {
  settlementId: number;
  orderId: number;
  userId: number;
  counterpartyId: number;
  grossAmountNgn: string;
  settlementDate: string; // ISO timestamp (T+2)
}

/**
 * SettlementWorkflow
 *
 * Steps:
 *  T+0    → Validate settlement (check counterparty funds, positions)
 *  T+0    → Lock funds in escrow via TigerBeetle
 *  T+2d   → On settlement date: transfer funds, update positions
 *  T+2d   → Confirm with Mojaloop for NGN transfers
 *  T+2d   → Release escrow, update settlement status to SETTLED
 *  On fail → Rollback escrow, mark FAILED, notify both parties
 *
 * Activities: validateSettlement, lockFundsInEscrow,
 *             transferFunds, confirmWithMojaloop,
 *             releaseEscrow, rollbackEscrow, notifySettlementResult
 */
export const SETTLEMENT_WORKFLOW = {
  name: "SettlementWorkflow",
  taskQueue: "nexcom-settlement",
  activities: [
    "validateSettlement",
    "lockFundsInEscrow",
    "transferFunds",
    "confirmWithMojaloop",
    "releaseEscrow",
    "rollbackEscrow",
    "notifySettlementResult",
  ],
  timeoutSeconds: 259200, // 72 hours (T+2 + buffer)
  retryPolicy: {
    maximumAttempts: 5,
    initialIntervalSeconds: 60,
    backoffCoefficient: 2,
    maximumIntervalSeconds: 3600,
  },
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// 4. LoanDisbursementWorkflow
// ─────────────────────────────────────────────────────────────────────────────

export interface LoanDisbursementInput {
  loanId: number;
  userId: number;
  amountNgn: string;
  approvedBy: number;
}

/**
 * LoanDisbursementWorkflow
 *
 * Steps:
 *  T+0    → Validate loan approval and user account status
 *  T+0    → Reserve funds in lending pool via TigerBeetle
 *  T+0    → Initiate Mojaloop transfer to borrower's bank account
 *  T+5min → Poll Mojaloop for transfer confirmation
 *  T+5min → On success: mark loan DISBURSED, start repayment schedule
 *  On fail → Release reserved funds, mark loan FAILED, notify borrower
 *
 * Activities: validateLoanApproval, reserveLendingFunds,
 *             initiateMojaloopTransfer, pollTransferStatus,
 *             markLoanDisbursed, startRepaymentSchedule,
 *             releaseLendingFunds, notifyLoanResult
 */
export const LOAN_DISBURSEMENT_WORKFLOW = {
  name: "LoanDisbursementWorkflow",
  taskQueue: "nexcom-banking",
  activities: [
    "validateLoanApproval",
    "reserveLendingFunds",
    "initiateMojaloopTransfer",
    "pollTransferStatus",
    "markLoanDisbursed",
    "startRepaymentSchedule",
    "releaseLendingFunds",
    "notifyLoanResult",
  ],
  timeoutSeconds: 1800, // 30 minutes
  retryPolicy: {
    maximumAttempts: 3,
    initialIntervalSeconds: 30,
    backoffCoefficient: 2,
    maximumIntervalSeconds: 300,
  },
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// 5. CrossBorderFxWorkflow — Mojaloop ILP cross-border FX settlement
// ─────────────────────────────────────────────────────────────────────────────

export interface CrossBorderFxInput {
  transferId: string;
  senderUserId: number;
  receiverFsp: string;
  receiverAccount: string;
  amount: number;
  sendCurrency: string;       // e.g. "NGN"
  receiveCurrency: string;    // e.g. "USD"
  note?: string;
  idempotencyKey: string;
}

/**
 * CrossBorderFxWorkflow
 *
 * Six-phase saga for cross-border FX settlement via Mojaloop ILP:
 *   Phase 1 — Sanctions screening (OpenSanctions)
 *   Phase 2 — ILP Quote (GET /quotes from Mojaloop)
 *   Phase 3 — Reserve funds (TigerBeetle code-2 pending)
 *   Phase 4 — Execute Mojaloop transfer (POST /transfers COMMITTED)
 *   Phase 5 — Commit TigerBeetle transfer (code-12)
 *   Phase 6 — Emit Fluvio + Lakehouse events
 *
 * Compensation: abort Mojaloop + reverse TigerBeetle reservation on any failure.
 * Workflow ID pattern: "xborder-{transferId}"
 */
export const CROSS_BORDER_FX_WORKFLOW = {
  name: "CrossBorderFxWorkflow",
  taskQueue: "nexcom-cross-border",
  activities: [
    "sanctionsScreening",
    "getILPQuote",
    "reserveFunds",
    "executeMojaloopTransfer",
    "commitCrossBorderTransfer",
    "emitCrossBorderCompleted",
    "ingestCrossBorderToLakehouse",
    // Compensation activities
    "abortMojaloopTransfer",
    "reverseFundsReservation",
    "emitCrossBorderFailed",
    "emitReconciliationAlert",
  ],
  timeoutSeconds: 300, // 5 minutes
  retryPolicy: {
    maximumAttempts: 3,
    initialIntervalSeconds: 2,
    backoffCoefficient: 2,
    maximumIntervalSeconds: 60,
    nonRetryableErrors: ["TRANSFER_REJECTED", "ACCOUNT_FROZEN", "SANCTIONS_BLOCKED"],
  },
  /** Idempotency key for workflow deduplication */
  workflowIdFor: (input: CrossBorderFxInput) => `xborder-${input.transferId}`,
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// Registry — all workflows exported for gateway worker registration
// ─────────────────────────────────────────────────────────────────────────────

export const WORKFLOW_REGISTRY = {
  [MARGIN_CALL_WORKFLOW.name]: MARGIN_CALL_WORKFLOW,
  [KYC_REVIEW_WORKFLOW.name]: KYC_REVIEW_WORKFLOW,
  [SETTLEMENT_WORKFLOW.name]: SETTLEMENT_WORKFLOW,
  [LOAN_DISBURSEMENT_WORKFLOW.name]: LOAN_DISBURSEMENT_WORKFLOW,
  [CROSS_BORDER_FX_WORKFLOW.name]: CROSS_BORDER_FX_WORKFLOW,
} as const;

export type WorkflowName = keyof typeof WORKFLOW_REGISTRY;
