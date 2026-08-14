/**
 * NEXCOM Exchange — Ledger Router
 * ================================
 * Exposes the double-entry accounting ledger via tRPC.
 * Implements the 1B payments/day architecture patterns:
 *   - SKIP LOCKED job queue for async settlement
 *   - Double-entry journal entries with advisory locks
 *   - ULID primary keys for sortable, idempotent IDs
 *   - Batch operations for high-throughput scenarios
 *   - Idempotency keys on every mutating operation
 *
 * References:
 *   https://backend.how/posts/1b-payments-per-day/
 *   https://github.com/pratikgajjar/1b-payments
 */

import { z } from "zod";
import { sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure, adminProcedure } from "../_core/trpc";
import { getDb, getReadDb } from "../db";
import { writeAuditLog } from "../audit";
import {
  ulid,
  postJournalEntry,
  enqueueJob,
  dequeueJob,
  completeJob,
  pgNotify,
} from "../pg-optimizations";

// ─── Helpers ──────────────────────────────────────────────────────────────────
function mapAccountRow(r: Record<string, unknown>) {
  const balance      = parseFloat((r.balance as string) ?? "0");
  const pendingDebit = parseFloat((r.pending_debit as string) ?? "0");
  const reserved     = pendingDebit;
  return {
    id:               r.id as string,
    userId:           r.user_id as number,
    accountType:      ((r.account_type as string) ?? "").toLowerCase(),
    currency:         r.currency as string,
    balance:          (r.balance as string) ?? "0",
    availableBalance: (balance - pendingDebit).toFixed(2),
    reservedBalance:  reserved.toFixed(2),
    status:           (r.status as string) ?? "active",
    createdAt:        r.created_at as Date,
    updatedAt:        r.updated_at as Date,
  };
}

export const ledgerRouter = router({
  // ─── Get Single Account (by type) ────────────────────────────────────────
  getAccount: protectedProcedure
    .input(
      z.object({
        accountType: z.enum([
          "TRADING", "SETTLEMENT", "MARGIN", "FEE", "ESCROW", "INSURANCE", "RESERVE",
        ]),
        currency: z.string().default("NGN"),
      })
    )
    .query(async ({ ctx, input }) => {
      const db = await getReadDb();
      if (!db) throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "Database unavailable" });

      const result = await db.execute(sql`
        SELECT id, user_id, account_type, currency, balance,
               pending_debit, pending_credit, status, version, created_at, updated_at
        FROM ledger_accounts
        WHERE user_id = ${ctx.user.id}
          AND account_type = ${input.accountType}
          AND currency = ${input.currency}
        LIMIT 1
      `);

      const rows = result as unknown[];
      if (rows.length === 0) {
        const accountId = ulid();
        await db.execute(sql`
          INSERT INTO ledger_accounts (id, user_id, account_type, currency, balance)
          VALUES (${accountId}, ${ctx.user.id}, ${input.accountType}, ${input.currency}, 0)
          ON CONFLICT (user_id, account_type, currency) DO NOTHING
        `);
        return {
          id: accountId,
          accountType: input.accountType.toLowerCase(),
          currency: input.currency,
          balance: "0",
          availableBalance: "0",
          reservedBalance: "0",
          status: "active",
        };
      }

      return mapAccountRow(rows[0] as Record<string, unknown>);
    }),

  // ─── List All Accounts for Current User ──────────────────────────────────
  listAccounts: protectedProcedure
    .input(
      z.object({
        currency: z.string().optional(),
        limit: z.number().min(1).max(200).default(50),
      })
    )
    .query(async ({ ctx, input }) => {
      const db = await getReadDb();
      if (!db) return { accounts: [] };

      const result = await db.execute(sql`
        SELECT id, user_id, account_type, currency,
               balance, pending_debit, pending_credit,
               status, version, created_at, updated_at
        FROM ledger_accounts
        WHERE user_id = ${ctx.user.id}
          ${input.currency ? sql`AND currency = ${input.currency}` : sql``}
        ORDER BY account_type, currency
        LIMIT ${input.limit}
      `);

      return {
        accounts: (result as unknown[]).map(row =>
          mapAccountRow(row as Record<string, unknown>)
        ),
      };
    }),

  // ─── Get Journal History (by accountId, cursor-based) ────────────────────
  getJournalHistory: protectedProcedure
    .input(
      z.object({
        accountId:   z.string().trim(),
        entryType:   z.enum(["debit", "credit"]).optional(),
        referenceType: z.string().optional(),
        limit:       z.number().min(1).max(200).default(20),
        cursor:      z.string().optional(),
        startDate:   z.date().optional(),
        endDate:     z.date().optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const db = await getReadDb();
      if (!db) return { entries: [], nextCursor: null };

      // Verify the account belongs to the requesting user
      const ownerCheck = await db.execute(sql`
        SELECT id FROM ledger_accounts
        WHERE id = ${input.accountId} AND user_id = ${ctx.user.id}
        LIMIT 1
      `);
      if ((ownerCheck as unknown[]).length === 0) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Account not found or access denied" });
      }

      const result = await db.execute(sql`
        SELECT
          le.id, le.journal_id, le.account_id, le.entry_type,
          le.amount, le.currency, le.balance,
          le.reference_type, le.reference_id, le.description,
          le.created_at
        FROM ledger_entries le
        WHERE le.account_id = ${input.accountId}
          ${input.entryType ? sql`AND le.entry_type = ${input.entryType}` : sql``}
          ${input.referenceType ? sql`AND le.reference_type = ${input.referenceType}` : sql``}
          ${input.startDate ? sql`AND le.created_at >= ${input.startDate.toISOString()}::timestamptz` : sql``}
          ${input.endDate ? sql`AND le.created_at <= ${input.endDate.toISOString()}::timestamptz` : sql``}
          ${input.cursor ? sql`AND le.id < ${input.cursor}` : sql``}
        ORDER BY le.id DESC
        LIMIT ${input.limit + 1}
      `);

      const rows = result as unknown[];
      const hasMore = rows.length > input.limit;
      const entries = rows.slice(0, input.limit).map((row) => {
        const r = row as Record<string, unknown>;
        return {
          id:            r.id as string,
          journalId:     r.journal_id as string,
          accountId:     r.account_id as string,
          entryType:     r.entry_type as "debit" | "credit",
          amount:        r.amount as string,
          currency:      r.currency as string,
          balance:       (r.balance as string) ?? "0",
          referenceType: r.reference_type as string | null,
          referenceId:   r.reference_id as string | null,
          description:   r.description as string | null,
          createdAt:     r.created_at as Date,
        };
      });

      return {
        entries,
        nextCursor: hasMore ? (entries[entries.length - 1]?.id ?? null) : null,
        hasMore,
      };
    }),

  // ─── Internal Transfer (by accountId) ────────────────────────────────────
  internalTransfer: protectedProcedure
    .input(
      z.object({
        fromAccountId:  z.string().trim(),
        toAccountId:    z.string().trim(),
        amount:         z.number().positive(),
        description:    z.string().max(255).optional(),
        idempotencyKey: z.string().max(128).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (input.fromAccountId === input.toAccountId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Source and destination accounts must be different",
        });
      }

      const db = await getDb();
      if (!db) throw new TRPCError({ code: "SERVICE_UNAVAILABLE" });

      // Verify both accounts belong to the requesting user
      const accounts = await db.execute(sql`
        SELECT id, account_type, currency, balance, pending_debit, status
        FROM ledger_accounts
        WHERE id IN (${input.fromAccountId}, ${input.toAccountId})
          AND user_id = ${ctx.user.id}
      `);

      const accountRows = accounts as unknown[];
      if (accountRows.length < 2) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "One or both accounts not found or not owned by you",
        });
      }

      const fromAccount = (accountRows as Record<string, unknown>[]).find(
        r => r.id === input.fromAccountId
      );
      const toAccount = (accountRows as Record<string, unknown>[]).find(
        r => r.id === input.toAccountId
      );

      if (!fromAccount || !toAccount) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Account not found" });
      }

      if (fromAccount.status !== "active") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Source account is not active" });
      }
      if (toAccount.status !== "active") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Destination account is not active" });
      }

      const fromBalance  = parseFloat(fromAccount.balance as string);
      const pendingDebit = parseFloat((fromAccount.pending_debit as string) ?? "0");
      const available    = fromBalance - pendingDebit;

      if (available < input.amount) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Insufficient available balance. Available: ${available.toFixed(2)} ${fromAccount.currency}`,
        });
      }

      const journalId = input.idempotencyKey ?? ulid();
      const amountStr = input.amount.toFixed(8);

      const { debitEntryId, creditEntryId } = await postJournalEntry({
        journalId,
        debitAccountId:  input.fromAccountId,
        creditAccountId: input.toAccountId,
        amount:          amountStr,
        currency:        fromAccount.currency as string,
        referenceType:   "TRANSFER",
        referenceId:     journalId,
        description:     input.description ?? "Internal transfer",
        metadata:        { userId: ctx.user.id, initiatedAt: new Date().toISOString() },
      });

      // LISTEN/NOTIFY for real-time balance updates
      await pgNotify("balance_update", {
        userId:          ctx.user.id,
        journalId,
        fromAccountId:   input.fromAccountId,
        toAccountId:     input.toAccountId,
        amount:          amountStr,
        currency:        fromAccount.currency,
      });

      return {
        success:       true,
        journalId,
        debitEntryId,
        creditEntryId,
        transferredAt: new Date(),
      };
    }),

  // ─── Admin: List All Accounts ─────────────────────────────────────────────
  adminListAccounts: adminProcedure
    .input(
      z.object({
        userId:      z.number().optional(),
        accountType: z.string().optional(),
        currency:    z.string().optional(),
        minBalance:  z.string().optional(),
        limit:       z.number().min(1).max(500).default(100),
        offset:      z.number().min(0).default(0),
      })
    )
    .query(async ({ input }) => {
      const db = await getReadDb();
      if (!db) return { accounts: [], total: 0 };

      const result = await db.execute(sql`
        SELECT
          la.id, la.user_id, la.account_type, la.currency,
          la.balance, la.pending_debit, la.pending_credit,
          la.status, la.version, la.created_at, la.updated_at,
          u.name AS user_name, u.email AS user_email
        FROM ledger_accounts la
        LEFT JOIN users u ON u.id = la.user_id
        WHERE 1=1
          ${input.userId ? sql`AND la.user_id = ${input.userId}` : sql``}
          ${input.accountType ? sql`AND la.account_type = ${input.accountType}` : sql``}
          ${input.currency ? sql`AND la.currency = ${input.currency}` : sql``}
          ${input.minBalance ? sql`AND la.balance >= ${input.minBalance}::numeric` : sql``}
        ORDER BY la.balance DESC
        LIMIT ${input.limit} OFFSET ${input.offset}
      `);

      const countResult = await db.execute(sql`
        SELECT COUNT(*) AS total FROM ledger_accounts
        WHERE 1=1
          ${input.userId ? sql`AND user_id = ${input.userId}` : sql``}
          ${input.accountType ? sql`AND account_type = ${input.accountType}` : sql``}
          ${input.currency ? sql`AND currency = ${input.currency}` : sql``}
      `);

      return {
        accounts: (result as unknown[]).map((row) => {
          const r = row as Record<string, unknown>;
          return {
            ...mapAccountRow(r),
            userName:  r.user_name as string | null,
            userEmail: r.user_email as string | null,
          };
        }),
        total: parseInt(
          ((countResult as unknown[])[0] as Record<string, unknown>).total as string
        ),
      };
    }),

  // ─── Admin: Enqueue Settlement Job ────────────────────────────────────────
  adminEnqueueSettlement: adminProcedure
    .input(
      z.object({
        tradeId:        z.string().trim(),
        priority:       z.number().min(0).max(10).default(5),
        idempotencyKey: z.string().min(8).max(128),
      })
    )
    .mutation(async ({ input }) => {
      const jobId = await enqueueJob(
        "settlement",
        { tradeId: input.tradeId, enqueuedAt: new Date().toISOString() },
        {
          priority:       input.priority,
          idempotencyKey: input.idempotencyKey,
          maxAttempts:    5,
        }
      );
      return { jobId, queued: true };
    }),

  // ─── Admin: Process Settlement Queue (batch) ──────────────────────────────
  adminProcessSettlementQueue: adminProcedure
    .input(
      z.object({
        batchSize: z.number().min(1).max(500).default(50),
        workerId:  z.string().default("admin-worker-1"),
      })
    )
    .mutation(async ({ input }) => {
      let processed = 0;
      let failed    = 0;

      for (let i = 0; i < input.batchSize; i++) {
        const job = await dequeueJob("settlement", `${input.workerId}-${i}`);
        if (!job) break; // Queue empty

        try {
          // Delegate to the Rust settlement engine via HTTP
          const SETTLEMENT_URL = process.env.SETTLEMENT_ENGINE_URL ?? "http://settlement-engine:8005";
          const payload = typeof job.payload === "string" ? JSON.parse(job.payload) : job.payload;
          const res = await fetch(`${SETTLEMENT_URL}/api/v1/settle`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              job_id:         job.id,
              trade_id:       payload?.tradeId ?? payload?.trade_id,
              buyer_id:       payload?.buyerId ?? payload?.buyer_id,
              seller_id:      payload?.sellerId ?? payload?.seller_id,
              symbol:         payload?.symbol,
              quantity_kg:    payload?.quantityKg ?? payload?.quantity_kg,
              price_ngn:      payload?.priceNgn ?? payload?.price_ngn,
              gross_amount:   payload?.grossAmount ?? payload?.gross_amount,
              currency:       payload?.currency ?? "NGN",
              idempotency_key: payload?.idempotencyKey ?? payload?.idempotency_key ?? job.id,
            }),
            signal: AbortSignal.timeout(10_000),
          });
          if (!res.ok) {
            const errText = await res.text();
            throw new Error(`Settlement engine returned ${res.status}: ${errText}`);
          }
          await completeJob(job.id, "completed");
          processed++;
        } catch (error) {
          await completeJob(
            job.id,
            "failed",
            error instanceof Error ? error.message : "Unknown error"
          );
          failed++;
        }
      }

      return { processed, failed, batchSize: input.batchSize };
    }),

  // ─── Admin: Ledger Summary (flat stats for dashboard) ────────────────────
  adminLedgerSummary: adminProcedure.query(async () => {
    const db = await getReadDb();
    if (!db) return null;

    // Account counts
    const accountStats = await db.execute(sql`
      SELECT
        COUNT(*) AS total_accounts,
        COUNT(*) FILTER (WHERE status = 'active')  AS active_accounts,
        COUNT(*) FILTER (WHERE status = 'frozen')  AS frozen_accounts,
        COUNT(*) FILTER (WHERE status = 'closed')  AS closed_accounts
      FROM ledger_accounts
    `);

    // Journal and entry counts
    const journalStats = await db.execute(sql`
      SELECT
        (SELECT COUNT(DISTINCT journal_id) FROM ledger_entries) AS total_journals,
        (SELECT COUNT(*) FROM ledger_entries)                   AS total_entries
    `);

    // Job queue stats
    const queueStats = await db.execute(sql`
      SELECT
        COUNT(*) FILTER (WHERE status = 'pending')    AS pending_jobs,
        COUNT(*) FILTER (WHERE status = 'processing') AS processing_jobs,
        COUNT(*) FILTER (WHERE status = 'failed')     AS failed_jobs,
        COUNT(*) FILTER (WHERE status = 'dead')       AS dead_jobs,
        COUNT(*) FILTER (WHERE status = 'completed')  AS completed_jobs
      FROM job_queue
      WHERE queue = 'settlement'
    `);

    // Balance by currency
    const balanceByCurrency = await db.execute(sql`
      SELECT
        currency,
        SUM(balance)::text AS total_balance,
        COUNT(*) AS account_count
      FROM ledger_accounts
      WHERE status = 'active'
      GROUP BY currency
      ORDER BY SUM(balance) DESC
    `);

    const as = (accountStats as unknown[])[0] as Record<string, unknown>;
    const js = (journalStats as unknown[])[0] as Record<string, unknown>;
    const qs = (queueStats as unknown[])[0] as Record<string, unknown>;

    return {
      totalAccounts:   parseInt((as?.total_accounts as string) ?? "0"),
      activeAccounts:  parseInt((as?.active_accounts as string) ?? "0"),
      frozenAccounts:  parseInt((as?.frozen_accounts as string) ?? "0"),
      closedAccounts:  parseInt((as?.closed_accounts as string) ?? "0"),
      totalJournals:   parseInt((js?.total_journals as string) ?? "0"),
      totalEntries:    parseInt((js?.total_entries as string) ?? "0"),
      pendingJobs:     parseInt((qs?.pending_jobs as string) ?? "0"),
      processingJobs:  parseInt((qs?.processing_jobs as string) ?? "0"),
      failedJobs:      parseInt((qs?.failed_jobs as string) ?? "0"),
      deadJobs:        parseInt((qs?.dead_jobs as string) ?? "0"),
      completedJobs:   parseInt((qs?.completed_jobs as string) ?? "0"),
      balanceByCurrency: (balanceByCurrency as unknown[]).map(row => {
        const r = row as Record<string, unknown>;
        return {
          currency:     r.currency as string,
          totalBalance: (r.total_balance as string) ?? "0",
          accountCount: parseInt(r.account_count as string),
        };
      }),
    };
  }),
});
