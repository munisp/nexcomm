/**
 * NEXCOM Exchange — Loan Notification Broadcaster
 *
 * Pushes real-time loan lifecycle events to connected WebSocket clients.
 *
 * Supported events:
 *   LOAN_APPLIED       — farmer submits a new loan application
 *   LOAN_APPROVED      — credit officer approves the application
 *   LOAN_REJECTED      — credit officer rejects the application
 *   LOAN_DISBURSED     — funds transferred to farmer account
 *   LOAN_REPAYMENT_DUE — reminder 7 days before repayment due date
 *   LOAN_REPAID        — full repayment confirmed
 *   LOAN_OVERDUE       — repayment missed past due date
 *   INSURANCE_SUBMITTED — crop insurance application submitted
 *   INSURANCE_APPROVED  — crop insurance policy issued
 *   INSURANCE_CLAIM     — insurance claim filed
 *
 * Client subscription protocol:
 *   → { type: "subscribe_loans", userId: number }
 *   ← { type: "loan_event", event: LoanEvent }
 *
 * Usage (server-side):
 *   import { broadcastLoanEvent } from "./ws/loanNotificationBroadcaster";
 *   broadcastLoanEvent(userId, { event: "LOAN_APPROVED", loanId: 42, amount: 500000, currency: "NGN" });
 */

import { WebSocket } from "ws";

// ─── Types ────────────────────────────────────────────────────────────────────

export type LoanEventType =
  | "LOAN_APPLIED"
  | "LOAN_APPROVED"
  | "LOAN_REJECTED"
  | "LOAN_DISBURSED"
  | "LOAN_REPAYMENT_DUE"
  | "LOAN_REPAID"
  | "LOAN_OVERDUE"
  | "INSURANCE_SUBMITTED"
  | "INSURANCE_APPROVED"
  | "INSURANCE_CLAIM";

export interface LoanEvent {
  event: LoanEventType;
  loanId?: number;
  applicationRef?: string;
  amount?: number;
  currency?: string;
  dueDate?: string;
  message?: string;
  metadata?: Record<string, unknown>;
  timestamp: string;
}

// ─── Subscriber registry ──────────────────────────────────────────────────────

/** userId → Set of connected WebSocket clients subscribed to loan events */
const loanSubscribers = new Map<number, Set<WebSocket>>();

/**
 * Register a WebSocket client to receive loan events for a specific user.
 */
export function subscribeLoanEvents(ws: WebSocket, userId: number): void {
  if (!loanSubscribers.has(userId)) {
    loanSubscribers.set(userId, new Set());
  }
  loanSubscribers.get(userId)!.add(ws);
  // Send a welcome/sync message with subscription confirmation
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(
      JSON.stringify({
        type: "loan_subscribed",
        userId,
        timestamp: new Date().toISOString(),
      })
    );
  }
}

/**
 * Remove a WebSocket client from all loan event subscriptions.
 */
export function unsubscribeLoanEvents(ws: WebSocket): void {
  for (const [userId, clients] of Array.from(loanSubscribers.entries())) {
    clients.delete(ws);
    if (clients.size === 0) {
      loanSubscribers.delete(userId);
    }
  }
}

// ─── Broadcast ────────────────────────────────────────────────────────────────

/**
 * Broadcast a loan lifecycle event to all WebSocket clients subscribed for a user.
 * Also persists the event as a DB notification (fire-and-forget).
 */
export function broadcastLoanEvent(
  userId: number,
  event: Omit<LoanEvent, "timestamp">
): void {
  const payload: LoanEvent = {
    ...event,
    timestamp: new Date().toISOString(),
  };

  const msg = JSON.stringify({ type: "loan_event", event: payload });

  const clients = loanSubscribers.get(userId);
  if (clients && clients.size > 0) {
    for (const ws of Array.from(clients)) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(msg);
      }
    }
  }

  // Persist to notifications table asynchronously (best-effort)
  persistNotification(userId, payload).catch(() => {});
}

/**
 * Persist a loan event as a DB notification row so it appears in the
 * notification bell even when the user is offline.
 */
async function persistNotification(userId: number, event: LoanEvent): Promise<void> {
  try {
    const { getDb } = await import("../db");
    const { notifications } = await import("../../drizzle/schema");
    const db = await getDb();
    if (!db) return;

    const titleMap: Record<LoanEventType, string> = {
      LOAN_APPLIED: "Loan Application Received",
      LOAN_APPROVED: "Loan Approved ✓",
      LOAN_REJECTED: "Loan Application Rejected",
      LOAN_DISBURSED: "Loan Funds Disbursed",
      LOAN_REPAYMENT_DUE: "Loan Repayment Due Soon",
      LOAN_REPAID: "Loan Fully Repaid ✓",
      LOAN_OVERDUE: "Loan Repayment Overdue",
      INSURANCE_SUBMITTED: "Insurance Application Submitted",
      INSURANCE_APPROVED: "Crop Insurance Policy Issued ✓",
      INSURANCE_CLAIM: "Insurance Claim Filed",
    };

    const messageMap: Record<LoanEventType, string> = {
      LOAN_APPLIED: `Your loan application has been received and is under review.`,
      LOAN_APPROVED: `Your loan of ${event.currency ?? "NGN"} ${(event.amount ?? 0).toLocaleString()} has been approved.`,
      LOAN_REJECTED: event.message ?? "Your loan application was not approved at this time.",
      LOAN_DISBURSED: `${(event.amount ?? 0).toLocaleString()} ${event.currency ?? "NGN"} has been disbursed to your account.`,
      LOAN_REPAYMENT_DUE: `Your loan repayment of ${(event.amount ?? 0).toLocaleString()} ${event.currency ?? "NGN"} is due on ${event.dueDate ?? "soon"}.`,
      LOAN_REPAID: `Your loan has been fully repaid. Thank you!`,
      LOAN_OVERDUE: `Your loan repayment is overdue. Please contact your relationship manager.`,
      INSURANCE_SUBMITTED: `Your crop insurance application (${event.applicationRef ?? ""}) has been submitted for review.`,
      INSURANCE_APPROVED: `Your crop insurance policy has been issued. Coverage is now active.`,
      INSURANCE_CLAIM: `Your insurance claim (${event.applicationRef ?? ""}) has been filed and is under review.`,
    };

    await db.insert(notifications).values({
      userId,
      type: "SYSTEM",
      title: titleMap[event.event] ?? event.event,
      message: event.message ?? messageMap[event.event] ?? event.event,
      metadata: {
        loanId: event.loanId,
        applicationRef: event.applicationRef,
        amount: event.amount,
        currency: event.currency,
        dueDate: event.dueDate,
        ...event.metadata,
      },
      read: false,
    });
  } catch {
    // Silently ignore persistence errors — WS delivery already happened
  }
}

// ─── Repayment reminder scheduler ────────────────────────────────────────────

/**
 * Scan all active loans and send LOAN_REPAYMENT_DUE reminders for loans
 * whose repayment date is within the next 7 days.
 * Called from the price feed job every 24 hours.
 */
export async function sendRepaymentReminders(): Promise<void> {
  try {
    const { getDb } = await import("../db");
    const { inputFinancingLoans, farmerProfiles, users } = await import("../../drizzle/schema");
    const { eq, and, lte, gte, sql } = await import("drizzle-orm");
    const db = await getDb();
    if (!db) return;

    const now = new Date();
    const in7Days = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    // Find loans with repayment due in the next 7 days that are not yet repaid
    const dueSoon = await db
      .select({
        loanId: inputFinancingLoans.id,
        farmerId: inputFinancingLoans.farmerId,
        disbursedValue: inputFinancingLoans.disbursedValueNgn,
        dueDate: inputFinancingLoans.repaymentDueDate,
        userId: farmerProfiles.userId,
      })
      .from(inputFinancingLoans)
      .leftJoin(farmerProfiles, eq(inputFinancingLoans.farmerId, farmerProfiles.id))
      .where(
        and(
          gte(inputFinancingLoans.repaymentDueDate, now),
          lte(inputFinancingLoans.repaymentDueDate, in7Days),
          sql`${inputFinancingLoans.status} IN ('DISBURSED', 'APPROVED')`
        )
      );

    for (const loan of dueSoon) {
      if (!loan.userId) continue;
      broadcastLoanEvent(loan.userId, {
        event: "LOAN_REPAYMENT_DUE",
        loanId: loan.loanId,
        amount: parseFloat(String(loan.disbursedValue ?? 0)),
        currency: "NGN",
        dueDate: loan.dueDate?.toISOString().split("T")[0],
        message: `Your loan repayment of ₦${parseFloat(String(loan.disbursedValue ?? 0)).toLocaleString()} is due on ${loan.dueDate?.toLocaleDateString("en-NG")}.`,
      });
    }
  } catch {
    // Silently ignore — reminders are best-effort
  }
}
