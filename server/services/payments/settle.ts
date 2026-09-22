/**
 * Payment settlement helper (PAY-RAILS) — exactly-once success settlement.
 *
 * Both the tRPC verify path (paymentsRouter.verifyPayment) and the async
 * webhook path (routes/paymentWebhooks.ts) funnel through settlePaymentSuccess:
 *
 *   1. Guarded status transition: UPDATE ... WHERE status IN ('pending','processing')
 *      RETURNING — the row is returned ONLY to the first caller; concurrent
 *      verify + webhook deliveries cannot both win, so the ledger credit below
 *      runs exactly once per payment.
 *   2. TigerBeetle double-entry credit (code=6 deposit) to the user's
 *      settlement account via the gateway — the platform's canonical ledger.
 *      Awaited with a 3s SLA on the interactive path; when the SLA is missed
 *      the credit keeps running in the background ("queued") and failures are
 *      logged for reconciliation (never silently dropped).
 *   3. Lakehouse Bronze-layer ingest (fire-and-forget, non-blocking by design).
 */
import { eq, and, inArray } from "drizzle-orm";
import { getDb } from "../../db";
import { paymentTransactions, type PaymentTransaction } from "../../../drizzle/schema-payments";
import { createLedgerTransfer, getUserLedgerAccounts } from "../../gatewayClient";
import { ingestDeposit } from "../../lakehouse";
import type { PaymentResult } from "./types";

const LEDGER_CREDIT_SLA_MS = 3_000;

/**
 * Attempt the pending/processing → success transition.
 * Returns the updated row when THIS call won the transition, else null.
 */
async function claimSuccessTransition(
  payment: PaymentTransaction,
  result?: PaymentResult
): Promise<PaymentTransaction | null> {
  const db = await getDb();
  if (!db) return null;
  const [updated] = await db
    .update(paymentTransactions)
    .set({
      status: "success",
      paidAt: result?.paidAt ?? new Date(),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(paymentTransactions.id, payment.id),
        inArray(paymentTransactions.status, ["pending", "processing"])
      )
    )
    .returning();
  return updated ?? null;
}

/** Post the TigerBeetle credit (minor units, code=6 deposit). */
async function creditUserLedger(payment: PaymentTransaction): Promise<string | null> {
  const accounts = await getUserLedgerAccounts(String(payment.userId));
  const settlementAccount = accounts.find((a) => a.type === "settlement");
  if (!settlementAccount) {
    console.warn(`[Payments] No settlement ledger account for user ${payment.userId} — credit skipped (reconcile manually)`);
    return null;
  }
  const transfer = await createLedgerTransfer({
    debitAccountId: "exchange-clearing",
    creditAccountId: settlementAccount.id,
    amount: payment.amountMinor, // minor units (kobo/cents)
    code: 6, // deposit
  });
  return transfer?.id ?? null;
}

export type SettleOutcome = "settled" | "settled-queued" | "already-settled" | "no-db";

/**
 * Settle a successful payment exactly once.
 *
 * @param payment  the payment_transactions row (pre-transition state is fine)
 * @param result   normalised provider verification result (optional context)
 * @param awaitLedger  when true, wait up to 3s for the ledger credit and report
 *                     "settled-queued" if the SLA is missed (credit continues in
 *                     the background); when false the credit is fire-and-forget.
 */
export async function settlePaymentSuccess(
  payment: PaymentTransaction,
  result?: PaymentResult,
  awaitLedger = false
): Promise<SettleOutcome> {
  // Short-circuit before hitting the DB when we know it's already terminal.
  if (payment.status === "success" || payment.status === "refunded") {
    return "already-settled";
  }

  const claimed = await claimSuccessTransition(payment, result);
  if (!claimed) {
    const db = await getDb();
    return db ? "already-settled" : "no-db";
  }

  const creditPromise = creditUserLedger(claimed)
    .then((ledgerTxId) => {
      console.log(
        `[Payments] Settled ${claimed.providerRef} — credited ${claimed.amountMinor} ${claimed.currency} minor units to user ${claimed.userId} (ledger tx ${ledgerTxId ?? "n/a"})`
      );
      return ledgerTxId;
    })
    .catch((e: unknown) => {
      // Never throw: the payment IS successful; a missed ledger credit must be
      // reconciled, not rolled back. Log loudly for the reconciliation job.
      console.error(
        `[Payments] LEDGER CREDIT FAILED for ${claimed.providerRef} (user ${claimed.userId}, ${claimed.amountMinor} ${claimed.currency}):`,
        (e as Error).message
      );
      return null;
    });

  let outcome: SettleOutcome = "settled";
  if (awaitLedger) {
    const finished = await Promise.race([
      creditPromise.then(() => true),
      new Promise<false>((resolve) => setTimeout(() => resolve(false), LEDGER_CREDIT_SLA_MS)),
    ]);
    if (!finished) outcome = "settled-queued"; // credit still running in background
  }

  // Lakehouse: immutable Bronze-layer record (non-blocking by design).
  void ingestDeposit({
    depositId: claimed.providerRef,
    userId: claimed.userId,
    amount: claimed.amountMinor / 100, // lakehouse stores major units
    currency: claimed.currency,
    status: "completed",
    correlationId: claimed.idempotencyKey,
  });

  return outcome;
}

/** Mark a payment failed/abandoned (no ledger effect). Idempotent by guard. */
export async function markPaymentTerminal(
  payment: PaymentTransaction,
  status: "failed" | "abandoned",
  reason?: string
): Promise<void> {
  if (payment.status === status) return;
  const db = await getDb();
  if (!db) return;
  await db
    .update(paymentTransactions)
    .set({
      status,
      metadata: {
        ...((payment.metadata as Record<string, unknown> | null) ?? {}),
        failureReason: reason ?? null,
      },
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(paymentTransactions.id, payment.id),
        inArray(paymentTransactions.status, ["pending", "processing"])
      )
    );

  void ingestDeposit({
    depositId: payment.providerRef,
    userId: payment.userId,
    amount: payment.amountMinor / 100,
    currency: payment.currency,
    status: "failed",
    correlationId: payment.idempotencyKey,
  });
}
