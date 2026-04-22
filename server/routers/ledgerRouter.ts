/**
 * NEXCOM Exchange — Ledger Router
 * ================================
 * Exposes the double-entry accounting ledger via tRPC.
 * Implements the 1B payments/day architecture patterns:
 *   - SKIP LOCKED job queue for async settlement
 *   - Double-entry journal entries with advisory locks
 *   - ULID primary keys for sortable, idempotent IDs
 *   - Batch operations for high-throughput scenarios
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
import {
  ulid,
  postJournalEntry,
  enqueueJob,
  dequeueJob,
  completeJob,
  pgNotify,
} from "../pg-optimizations";

export const ledgerRouter = router({
  // ─── Get Account Balance ──────────────────────────────────────────────────
  getAccount: protectedProcedure
    .input(
      z.object({
        accountType: z.enum([
          "TRADING",
          "SETTLEMENT",
          "MARGIN",
          "FEE",
          "ESCROW",
          "INSURANCE",
          "RESERVE",
        ]),
        currency: z.string().default("NGN"),
      })
    )
    .query(async ({ ctx, input }) => {
      const db = await getReadDb();
      if (!db) throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "Database unavailable" });

      const result = await db.execute(sql`
        SELECT
          id, account_type, currency, balance,
          pending_debit, pending_credit, version,
          created_at, updated_at
        FROM ledger_accounts
        WHERE user_id = ${ctx.user.id}
          AND account_type = ${input.accountType}
          AND currency = ${input.currency}
        LIMIT 1
      `);

      const rows = result as unknown[];
      if (rows.length === 0) {
        // Auto-create account on first access
        const accountId = ulid();
        await db.execute(sql`
          INSERT INTO ledger_accounts (id, user_id, account_type, currency, balance)
          VALUES (${accountId}, ${ctx.user.id}, ${input.accountType}, ${input.currency}, 0)
          ON CONFLICT (user_id, account_type, currency) DO NOTHING
        `);
        return {
          id: accountId,
          accountType: input.accountType,
          currency: input.currency,
          balance: "0",
          pendingDebit: "0",
          pendingCredit: "0",
          availableBalance: "0",
        };
      }

      const row = rows[0] as Record<string, unknown>;
      const balance = parseFloat(row.balance as string);
      const pendingDebit = parseFloat(row.pending_debit as string);
      return {
        id: row.id as string,
        accountType: row.account_type as string,
        currency: row.currency as string,
        balance: row.balance as string,
        pendingDebit: row.pending_debit as string,
        pendingCredit: row.pending_credit as string,
        availableBalance: (balance - pendingDebit).toFixed(8),
        version: row.version as number,
        updatedAt: row.updated_at as Date,
      };
    }),

  // ─── Get All Accounts for Current User ───────────────────────────────────
  listAccounts: protectedProcedure
    .input(z.object({ currency: z.string().optional() }))
    .query(async ({ ctx, input }) => {
      const db = await getReadDb();
      if (!db) return [];

      const result = await db.execute(sql`
        SELECT
          id, account_type, currency,
          balance, pending_debit, pending_credit,
          version, updated_at
        FROM ledger_accounts
        WHERE user_id = ${ctx.user.id}
          ${input.currency ? sql`AND currency = ${input.currency}` : sql``}
        ORDER BY account_type, currency
      `);

      return (result as unknown[]).map((row) => {
        const r = row as Record<string, unknown>;
        const balance = parseFloat(r.balance as string);
        const pendingDebit = parseFloat(r.pending_debit as string);
        return {
          id: r.id as string,
          accountType: r.account_type as string,
          currency: r.currency as string,
          balance: r.balance as string,
          pendingDebit: r.pending_debit as string,
          pendingCredit: r.pending_credit as string,
          availableBalance: (balance - pendingDebit).toFixed(8),
          version: r.version as number,
          updatedAt: r.updated_at as Date,
        };
      });
    }),

  // ─── Get Journal History ──────────────────────────────────────────────────
  getJournalHistory: protectedProcedure
    .input(
      z.object({
        accountType: z
          .enum([
            "TRADING",
            "SETTLEMENT",
            "MARGIN",
            "FEE",
            "ESCROW",
            "INSURANCE",
            "RESERVE",
          ])
          .optional(),
        referenceType: z
          .enum(["TRADE", "SETTLEMENT", "FEE", "DEPOSIT", "WITHDRAWAL", "TRANSFER"])
          .optional(),
        limit: z.number().min(1).max(200).default(50),
        cursor: z.string().optional(), // ULID cursor for keyset pagination
        startDate: z.date().optional(),
        endDate: z.date().optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const db = await getReadDb();
      if (!db) return { entries: [], nextCursor: null };

      const result = await db.execute(sql`
        SELECT
          le.id, le.journal_id, le.entry_type, le.amount, le.currency,
          le.reference_type, le.reference_id, le.description, le.metadata,
          le.created_at, la.account_type
        FROM ledger_entries le
        JOIN ledger_accounts la ON la.id = le.account_id
        WHERE la.user_id = ${ctx.user.id}
          ${input.accountType ? sql`AND la.account_type = ${input.accountType}` : sql``}
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
          id: r.id as string,
          journalId: r.journal_id as string,
          entryType: r.entry_type as string,
          amount: r.amount as string,
          currency: r.currency as string,
          referenceType: r.reference_type as string,
          referenceId: r.reference_id as string,
          description: r.description as string | null,
          metadata: r.metadata as Record<string, unknown>,
          accountType: r.account_type as string,
          createdAt: r.created_at as Date,
        };
      });

      return {
        entries,
        nextCursor: hasMore ? entries[entries.length - 1]?.id ?? null : null,
        hasMore,
      };
    }),

  // ─── Internal Transfer ────────────────────────────────────────────────────
  // Transfer funds between two of the current user's accounts
  internalTransfer: protectedProcedure
    .input(
      z.object({
        fromAccountType: z.enum(["TRADING", "MARGIN", "SETTLEMENT"]),
        toAccountType: z.enum(["TRADING", "MARGIN", "SETTLEMENT"]),
        amount: z.string().regex(/^\d+(\.\d{1,8})?$/, "Invalid amount"),
        currency: z.string().default("NGN"),
        description: z.string().max(255).optional(),
        idempotencyKey: z.string().max(100).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (input.fromAccountType === input.toAccountType) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Cannot transfer to the same account type",
        });
      }

      const db = await getDb();
      if (!db) throw new TRPCError({ code: "SERVICE_UNAVAILABLE" });

      // Get account IDs
      const accounts = await db.execute(sql`
        SELECT id, account_type, balance
        FROM ledger_accounts
        WHERE user_id = ${ctx.user.id}
          AND account_type IN (${input.fromAccountType}, ${input.toAccountType})
          AND currency = ${input.currency}
      `);

      const accountRows = accounts as unknown[];
      const fromAccount = (accountRows as Record<string, unknown>[]).find(
        (r) => r.account_type === input.fromAccountType
      );
      const toAccount = (accountRows as Record<string, unknown>[]).find(
        (r) => r.account_type === input.toAccountType
      );

      if (!fromAccount) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: `${input.fromAccountType} account not found`,
        });
      }

      const fromBalance = parseFloat(fromAccount.balance as string);
      const transferAmount = parseFloat(input.amount);

      if (fromBalance < transferAmount) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Insufficient balance. Available: ${fromBalance.toFixed(8)} ${input.currency}`,
        });
      }

      // Auto-create destination account if needed
      let toAccountId = toAccount?.id as string | undefined;
      if (!toAccountId) {
        toAccountId = ulid();
        await db.execute(sql`
          INSERT INTO ledger_accounts (id, user_id, account_type, currency, balance)
          VALUES (${toAccountId}, ${ctx.user.id}, ${input.toAccountType}, ${input.currency}, 0)
          ON CONFLICT (user_id, account_type, currency) DO NOTHING
          RETURNING id
        `);
        // Re-fetch after upsert
        const created = await db.execute(sql`
          SELECT id FROM ledger_accounts
          WHERE user_id = ${ctx.user.id}
            AND account_type = ${input.toAccountType}
            AND currency = ${input.currency}
        `);
        toAccountId = ((created as unknown[])[0] as Record<string, unknown>).id as string;
      }

      const journalId = input.idempotencyKey ?? ulid();

      const { debitEntryId, creditEntryId } = await postJournalEntry({
        journalId,
        debitAccountId: fromAccount.id as string,
        creditAccountId: toAccountId,
        amount: input.amount,
        currency: input.currency,
        referenceType: "TRANSFER",
        referenceId: journalId,
        description:
          input.description ??
          `Internal transfer: ${input.fromAccountType} → ${input.toAccountType}`,
        metadata: { userId: ctx.user.id, initiatedAt: new Date().toISOString() },
      });

      // Notify via LISTEN/NOTIFY for real-time balance updates
      await pgNotify("balance_update", {
        userId: ctx.user.id,
        journalId,
        fromAccountType: input.fromAccountType,
        toAccountType: input.toAccountType,
        amount: input.amount,
        currency: input.currency,
      });

      return {
        success: true,
        journalId,
        debitEntryId,
        creditEntryId,
        transferredAt: new Date(),
      };
    }),

  // ─── Admin: View All Accounts ─────────────────────────────────────────────
  adminListAccounts: adminProcedure
    .input(
      z.object({
        userId: z.number().optional(),
        accountType: z.string().optional(),
        currency: z.string().optional(),
        minBalance: z.string().optional(),
        limit: z.number().min(1).max(500).default(100),
        offset: z.number().min(0).default(0),
      })
    )
    .query(async ({ input }) => {
      const db = await getReadDb();
      if (!db) return { accounts: [], total: 0 };

      const result = await db.execute(sql`
        SELECT
          la.id, la.user_id, la.account_type, la.currency,
          la.balance, la.pending_debit, la.pending_credit,
          la.version, la.updated_at,
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
            id: r.id as string,
            userId: r.user_id as number,
            userName: r.user_name as string | null,
            userEmail: r.user_email as string | null,
            accountType: r.account_type as string,
            currency: r.currency as string,
            balance: r.balance as string,
            pendingDebit: r.pending_debit as string,
            pendingCredit: r.pending_credit as string,
            version: r.version as number,
            updatedAt: r.updated_at as Date,
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
        tradeId: z.string(),
        priority: z.number().min(0).max(10).default(5),
        idempotencyKey: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const jobId = await enqueueJob(
        "settlement",
        { tradeId: input.tradeId, enqueuedAt: new Date().toISOString() },
        {
          priority: input.priority,
          idempotencyKey: input.idempotencyKey,
          maxAttempts: 5,
        }
      );
      return { jobId, queued: true };
    }),

  // ─── Admin: Dequeue and Process Settlement Job ────────────────────────────
  adminProcessSettlementQueue: adminProcedure
    .input(z.object({ workerId: z.string().default("admin-worker-1") }))
    .mutation(async ({ input }) => {
      const job = await dequeueJob("settlement", input.workerId);
      if (!job) return { processed: false, message: "No jobs in queue" };

      try {
        // In production, this would call the settlement engine
        // For now, simulate processing
        await new Promise((resolve) => setTimeout(resolve, 10));
        await completeJob(job.id, "completed");

        return {
          processed: true,
          jobId: job.id,
          payload: job.payload,
          attempts: job.attempts,
        };
      } catch (error) {
        await completeJob(
          job.id,
          job.attempts >= job.maxAttempts ? "dead" : "failed",
          error instanceof Error ? error.message : "Unknown error"
        );
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Settlement job failed: ${error instanceof Error ? error.message : "Unknown error"}`,
        });
      }
    }),

  // ─── Admin: Ledger Summary ────────────────────────────────────────────────
  adminLedgerSummary: adminProcedure.query(async () => {
    const db = await getReadDb();
    if (!db) return null;

    const result = await db.execute(sql`
      SELECT
        account_type,
        currency,
        COUNT(*) AS account_count,
        SUM(balance) AS total_balance,
        SUM(pending_debit) AS total_pending_debit,
        SUM(pending_credit) AS total_pending_credit,
        AVG(balance) AS avg_balance,
        MAX(balance) AS max_balance
      FROM ledger_accounts
      GROUP BY account_type, currency
      ORDER BY total_balance DESC
    `);

    const entryStats = await db.execute(sql`
      SELECT
        entry_type,
        reference_type,
        COUNT(*) AS entry_count,
        SUM(amount) AS total_amount,
        DATE_TRUNC('day', created_at) AS day
      FROM ledger_entries
      WHERE created_at >= NOW() - INTERVAL '30 days'
      GROUP BY entry_type, reference_type, DATE_TRUNC('day', created_at)
      ORDER BY day DESC, total_amount DESC
      LIMIT 100
    `);

    const queueStats = await db.execute(sql`
      SELECT
        queue,
        status,
        COUNT(*) AS job_count,
        AVG(attempts) AS avg_attempts
      FROM job_queue
      GROUP BY queue, status
      ORDER BY queue, status
    `);

    return {
      accountSummary: (result as unknown[]).map((row) => {
        const r = row as Record<string, unknown>;
        return {
          accountType: r.account_type as string,
          currency: r.currency as string,
          accountCount: parseInt(r.account_count as string),
          totalBalance: r.total_balance as string,
          totalPendingDebit: r.total_pending_debit as string,
          avgBalance: r.avg_balance as string,
          maxBalance: r.max_balance as string,
        };
      }),
      entryStats: (entryStats as unknown[]).map((row) => {
        const r = row as Record<string, unknown>;
        return {
          entryType: r.entry_type as string,
          referenceType: r.reference_type as string,
          entryCount: parseInt(r.entry_count as string),
          totalAmount: r.total_amount as string,
          day: r.day as Date,
        };
      }),
      queueStats: (queueStats as unknown[]).map((row) => {
        const r = row as Record<string, unknown>;
        return {
          queue: r.queue as string,
          status: r.status as string,
          jobCount: parseInt(r.job_count as string),
          avgAttempts: parseFloat(r.avg_attempts as string),
        };
      }),
    };
  }),
});
