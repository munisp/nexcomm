/**
 * tb_transfer_log writer — real audit trail for TigerBeetle settlement ledger
 * operations executed through the settlement engine / gateway ledger APIs.
 *
 * Best-effort: a logging failure never fails the underlying transfer (the
 * TigerBeetle cluster is the system of record), but failures are logged loudly.
 */
import { getDb } from "./db";
import { tbTransferLog } from "../drizzle/schema";

export interface TbTransferLogEntry {
  transferId: string;
  debitAccountId: string;
  creditAccountId: string;
  amount: number; // minor units
  currency?: string;
  userId?: number | null;
  referenceId?: string;
  referenceType?: string;
  code?: number; // TB transfer code; 0 when the caller path does not set one
  status?: string; // COMMITTED | PENDING | VOIDED
  pendingId?: string;
  correlationId?: string;
}

export async function logTbTransfer(entry: TbTransferLogEntry): Promise<void> {
  try {
    const db = await getDb();
    if (!db) return;
    await db
      .insert(tbTransferLog)
      .values({
        transferId: entry.transferId,
        debitAccountId: entry.debitAccountId,
        creditAccountId: entry.creditAccountId,
        amount: entry.amount,
        currency: entry.currency ?? "NGN",
        userId: entry.userId ?? null,
        referenceId: entry.referenceId ?? null,
        referenceType: entry.referenceType ?? null,
        code: entry.code ?? 0,
        status: entry.status ?? "COMMITTED",
        pendingId: entry.pendingId ?? null,
        correlationId: entry.correlationId ?? null,
      })
      .onConflictDoNothing();
  } catch (err) {
    console.error(
      `[tb_transfer_log] failed to log transfer ${entry.transferId}:`,
      err instanceof Error ? err.message : err,
    );
  }
}
