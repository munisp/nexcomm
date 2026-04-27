/**
 * Mojaloop DFSP tRPC Router
 * ─────────────────────────────────────────────────────────────────────────────
 * Exposes Mojaloop DFSP operations to the NEXCOM frontend via tRPC.
 * Communicates with the mojaloop-adapter service (FSPIOP API v1.1) and reads
 * directly from the PostgreSQL mojaloop_* tables for dashboard data.
 */

import { z } from "zod";
import { router, protectedProcedure, adminProcedure } from "../_core/trpc";
import { getDb } from "../db";
import {
  mojaloopTransfers,
  mojaloopQuotes,
  mojaloopDfsps,
  mojaloopParties,
  mojaloopCallbacks,
  mojaloopDeadLetter,
} from "../../drizzle/schema";
import { eq, desc, and, sql, gte, lte } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { writeAuditLog } from "../audit";

const MOJALOOP_ADAPTER_URL =
  process.env.MOJALOOP_ADAPTER_URL ?? "http://localhost:4001";

// ─── Helper: call the mojaloop-adapter ───────────────────────────────────────
async function adapterFetch<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const url = `${MOJALOOP_ADAPTER_URL}${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "FSPIOP-Source": "nexcom-exchange",
      ...(options.headers ?? {}),
    },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: `Mojaloop adapter error ${res.status}: ${body}`,
    });
  }
  return res.json() as Promise<T>;
}

// ─── Router ───────────────────────────────────────────────────────────────────
export const mojaloopRouter = router({
  // ── Health check ────────────────────────────────────────────────────────────
  health: protectedProcedure.query(async () => {
    try {
      const data = await adapterFetch<{
        status: string;
        dfspId: string;
        database: string;
        timestamp: string;
      }>("/health");
      return { online: data.status === "UP", ...data };
    } catch {
      return { online: false, status: "DOWN", dfspId: "nexcom-exchange", database: "unknown", timestamp: new Date().toISOString() };
    }
  }),

  // ── Stats dashboard ─────────────────────────────────────────────────────────
  stats: protectedProcedure.query(async () => {
    try {
      return await adapterFetch<{
        dfspId: string;
        activeDfsps: number;
        transfers: Record<string, { count: number; totalAmount: number }>;
        quotes: Record<string, number>;
        runtimeMetrics: Record<string, number>;
      }>("/stats");
    } catch {
      // Fallback: read directly from DB
      const db = await getDb();
      if (!db) return null;
      const transferStats = await db
        .select({
          status: mojaloopTransfers.status,
          count: sql<number>`COUNT(*)`,
          totalAmount: sql<number>`SUM(${mojaloopTransfers.amount})`,
        })
        .from(mojaloopTransfers)
        .groupBy(mojaloopTransfers.status);
      return {
        dfspId: "nexcom-exchange",
        activeDfsps: 0,
        transfers: transferStats.reduce(
          (acc, r) => {
            acc[r.status] = { count: r.count, totalAmount: r.totalAmount ?? 0 };
            return acc;
          },
          {} as Record<string, { count: number; totalAmount: number }>
        ),
        quotes: {},
        runtimeMetrics: {},
      };
    }
  }),

  // ── List transfers ───────────────────────────────────────────────────────────
  listTransfers: protectedProcedure
    .input(
      z.object({
        limit: z.number().int().min(1).max(100).default(20),
        offset: z.number().int().min(0).default(0),
        status: z
          .enum(["PENDING", "RESERVED", "COMMITTED", "ABORTED", "EXPIRED"])
          .optional(),
        currency: z.string().max(8).optional(),
        fromDate: z.string().optional(),
        toDate: z.string().optional(),
      })
    )
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return { transfers: [], total: 0 };

      const conditions = [];
      if (input.status) conditions.push(eq(mojaloopTransfers.status, input.status));
      if (input.currency) conditions.push(eq(mojaloopTransfers.currency, input.currency));
      if (input.fromDate) conditions.push(gte(mojaloopTransfers.createdAt, new Date(input.fromDate)));
      if (input.toDate) conditions.push(lte(mojaloopTransfers.createdAt, new Date(input.toDate)));

      const [transfers, countResult] = await Promise.all([
        db
          .select()
          .from(mojaloopTransfers)
          .where(conditions.length > 0 ? and(...conditions) : undefined)
          .orderBy(desc(mojaloopTransfers.createdAt))
          .limit(input.limit)
          .offset(input.offset),
        db
          .select({ count: sql<number>`COUNT(*)` })
          .from(mojaloopTransfers)
          .where(conditions.length > 0 ? and(...conditions) : undefined),
      ]);

      return { transfers, total: countResult[0]?.count ?? 0 };
    }),

  // ── Get single transfer ──────────────────────────────────────────────────────
  getTransfer: protectedProcedure
    .input(z.object({ transferId: z.string().trim() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      const rows = await db
        .select()
        .from(mojaloopTransfers)
        .where(eq(mojaloopTransfers.transferId, input.transferId))
        .limit(1);
      if (rows.length === 0) throw new TRPCError({ code: "NOT_FOUND", message: "Transfer not found" });
      return rows[0];
    }),

  // ── Initiate a transfer ──────────────────────────────────────────────────────
  initiateTransfer: protectedProcedure
    .input(
      z.object({
        payeeFspId: z.string().min(1),
        payeeIdentifier: z.string().min(1),
        payerIdentifier: z.string().min(1),
        amount: z.string().regex(/^\d+(\.\d{1,6})?$/),
        currency: z.string().trim().length(3),
        note: z.string().max(256).optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      // Step 1: Request a quote
      const quote = await adapterFetch<{
        quoteId: string;
        transactionId: string;
        transferAmount: { amount: string; currency: string };
        payeeFspFee: { amount: string; currency: string };
        ilpPacket: string;
        condition: string;
        expiration: string;
      }>("/quotes", {
        method: "POST",
        body: JSON.stringify({
          payerFsp: "nexcom-exchange",
          payeeFsp: input.payeeFspId,
          payer: { partyIdInfo: { partyIdType: "ACCOUNT_ID", partyIdentifier: input.payerIdentifier } },
          payee: { partyIdInfo: { partyIdType: "ACCOUNT_ID", partyIdentifier: input.payeeIdentifier } },
          amountType: "SEND",
          amount: { amount: input.amount, currency: input.currency },
          transactionType: { scenario: "TRANSFER", initiator: "PAYER", initiatorType: "CONSUMER" },
          note: input.note,
        }),
      });

      // Step 2: Initiate transfer using the quote
      const transfer = await adapterFetch<{
        transferId: string;
        transferState: string;
        completedTimestamp: string;
      }>("/transfers", {
        method: "POST",
        body: JSON.stringify({
          payerFsp: "nexcom-exchange",
          payeeFsp: input.payeeFspId,
          payer: { partyIdInfo: { partyIdType: "ACCOUNT_ID", partyIdentifier: input.payerIdentifier } },
          payee: { partyIdInfo: { partyIdType: "ACCOUNT_ID", partyIdentifier: input.payeeIdentifier } },
          amount: quote.transferAmount,
          ilpPacket: quote.ilpPacket,
          condition: quote.condition,
          expiration: quote.expiration,
          quoteId: quote.quoteId,
        }),
      });

      return {
        transferId: transfer.transferId,
        quoteId: quote.quoteId,
        transactionId: quote.transactionId,
        transferState: transfer.transferState,
        amount: input.amount,
        currency: input.currency,
        fee: quote.payeeFspFee,
        completedTimestamp: transfer.completedTimestamp,
      };
    }),

  // ── List quotes ──────────────────────────────────────────────────────────────
  listQuotes: protectedProcedure
    .input(
      z.object({
        limit: z.number().int().min(1).max(100).default(20),
        offset: z.number().int().min(0).default(0),
        status: z.enum(["PENDING", "ACCEPTED", "REJECTED", "EXPIRED"]).optional(),
      })
    )
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return { quotes: [], total: 0 };

      const conditions = [];
      if (input.status) conditions.push(eq(mojaloopQuotes.status, input.status));

      const [quotes, countResult] = await Promise.all([
        db
          .select()
          .from(mojaloopQuotes)
          .where(conditions.length > 0 ? and(...conditions) : undefined)
          .orderBy(desc(mojaloopQuotes.createdAt))
          .limit(input.limit)
          .offset(input.offset),
        db
          .select({ count: sql<number>`COUNT(*)` })
          .from(mojaloopQuotes)
          .where(conditions.length > 0 ? and(...conditions) : undefined),
      ]);

      return { quotes, total: countResult[0]?.count ?? 0 };
    }),

  // ── List DFSPs ───────────────────────────────────────────────────────────────
  listDfsps: protectedProcedure
    .input(
      z.object({
        activeOnly: z.boolean().default(true),
        currency: z.string().max(8).optional(),
      })
    )
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return [];

      const conditions = [];
      if (input.activeOnly) conditions.push(eq(mojaloopDfsps.isActive, true));

      const dfsps = await db
        .select()
        .from(mojaloopDfsps)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(mojaloopDfsps.name);

      if (input.currency) {
        return dfsps.filter((d) => {
          const currencies = (d.currencies as string[]) ?? [];
          return currencies.includes(input.currency!);
        });
      }
      return dfsps;
    }),

  // ── Register DFSP (admin) ────────────────────────────────────────────────────
  registerDfsp: adminProcedure
    .input(
      z.object({
        fspId: z.string().min(1).max(64),
        name: z.string().min(1).max(128),
        currency: z.string().trim().length(3),
        country: z.string().max(4).optional(),
        endpointUrl: z.string().url().optional(),
      })
    )
    .mutation(async ({ input }) => {
      await adapterFetch("/participants", {
        method: "POST",
        body: JSON.stringify({
          fspId: input.fspId,
          name: input.name,
          currency: input.currency,
        }),
      });
      return { success: true, fspId: input.fspId };
    }),

  // ── Lookup party ─────────────────────────────────────────────────────────────
  lookupParty: protectedProcedure
    .input(
      z.object({
        partyIdType: z.enum(["MSISDN", "EMAIL", "ACCOUNT_ID", "IBAN", "ALIAS"]),
        partyIdentifier: z.string().min(1),
      })
    )
    .query(async ({ input }) => {
      return adapterFetch<{
        party: {
          partyIdInfo: { partyIdType: string; partyIdentifier: string; fspId: string };
          name: string;
          personalInfo?: { complexName?: { firstName?: string; lastName?: string } };
        };
      }>(`/parties/${input.partyIdType}/${encodeURIComponent(input.partyIdentifier)}`);
    }),

  // ── List callbacks (admin) ───────────────────────────────────────────────────
  listCallbacks: adminProcedure
    .input(
      z.object({
        limit: z.number().int().min(1).max(100).default(20),
        offset: z.number().int().min(0).default(0),
        processed: z.boolean().optional(),
      })
    )
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return { callbacks: [], total: 0 };

      const conditions = [];
      if (input.processed !== undefined)
        conditions.push(eq(mojaloopCallbacks.processed, input.processed));

      const [callbacks, countResult] = await Promise.all([
        db
          .select()
          .from(mojaloopCallbacks)
          .where(conditions.length > 0 ? and(...conditions) : undefined)
          .orderBy(desc(mojaloopCallbacks.createdAt))
          .limit(input.limit)
          .offset(input.offset),
        db
          .select({ count: sql<number>`COUNT(*)` })
          .from(mojaloopCallbacks)
          .where(conditions.length > 0 ? and(...conditions) : undefined),
      ]);

      return { callbacks, total: countResult[0]?.count ?? 0 };
    }),

  // ── Transfer volume by currency ──────────────────────────────────────────────
  volumeByCurrency: protectedProcedure.query(async () => {
    const db = await getDb();
    if (!db) return [];
    return db
      .select({
        currency: mojaloopTransfers.currency,
        count: sql<number>`COUNT(*)`,
        totalAmount: sql<number>`SUM(${mojaloopTransfers.amount})`,
        committedCount: sql<number>`SUM(CASE WHEN ${mojaloopTransfers.status} = 'COMMITTED' THEN 1 ELSE 0 END)`,
        abortedCount: sql<number>`SUM(CASE WHEN ${mojaloopTransfers.status} = 'ABORTED' THEN 1 ELSE 0 END)`,
      })
      .from(mojaloopTransfers)
      .groupBy(mojaloopTransfers.currency)
      .orderBy(desc(sql`SUM(${mojaloopTransfers.amount})`));
  }),

  // ── Transfer volume by DFSP ──────────────────────────────────────────────────
  volumeByDfsp: protectedProcedure.query(async () => {
    const db = await getDb();
    if (!db) return [];
    return db
      .select({
        payeeFspId: mojaloopTransfers.payeeFspId,
        count: sql<number>`COUNT(*)`,
        totalAmount: sql<number>`SUM(${mojaloopTransfers.amount})`,
      })
      .from(mojaloopTransfers)
      .where(eq(mojaloopTransfers.status, "COMMITTED"))
      .groupBy(mojaloopTransfers.payeeFspId)
      .orderBy(desc(sql`SUM(${mojaloopTransfers.amount})`))
      .limit(10);
  }),

  // ── Hub status (enhanced health check with latency) ────────────────────────
  hubStatus: protectedProcedure.query(async () => {
    const start = Date.now();
    try {
      const data = await adapterFetch<{
        status: string;
        dfspId: string;
        database: string;
        timestamp: string;
        version?: string;
        uptime?: number;
      }>("/health");
      const latencyMs = Date.now() - start;
      return {
        online: data.status === "UP",
        status: data.status,
        dfspId: data.dfspId,
        database: data.database,
        timestamp: data.timestamp,
        version: data.version ?? "unknown",
        uptime: data.uptime ?? 0,
        latencyMs,
        mode: "live" as const,
      };
    } catch (err) {
      const latencyMs = Date.now() - start;
      return {
        online: false,
        status: "DOWN",
        dfspId: "nexcom-exchange",
        database: "unknown",
        timestamp: new Date().toISOString(),
        version: "unknown",
        uptime: 0,
        latencyMs,
        mode: "standalone" as const,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }),

  // ── Reconciliation report ─────────────────────────────────────────────────────
  // Joins mojaloop_transfers with settlements to find matched, unmatched, and
  // aborted transfers. Returns daily summary + currency breakdown.
  reconciliationReport: adminProcedure
    .input(
      z.object({
        fromDate: z.string().optional(),
        toDate: z.string().optional(),
        currency: z.string().max(8).optional(),
      })
    )
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const fromDate = input.fromDate ? new Date(input.fromDate) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const toDate = input.toDate ? new Date(input.toDate) : new Date();

      // 1. Summary counts and volumes from mojaloop_transfers
      const conditions = [
        gte(mojaloopTransfers.createdAt, fromDate),
        lte(mojaloopTransfers.createdAt, toDate),
      ];
      if (input.currency) conditions.push(eq(mojaloopTransfers.currency, input.currency));

      const [summary, byCurrency, byDay, unmatched] = await Promise.all([
        // Overall summary
        db
          .select({
            status: mojaloopTransfers.status,
            count: sql<number>`COUNT(*)`,
            totalAmount: sql<number>`COALESCE(SUM(${mojaloopTransfers.amount}::numeric), 0)`,
          })
          .from(mojaloopTransfers)
          .where(and(...conditions))
          .groupBy(mojaloopTransfers.status),

        // Volume by currency
        db
          .select({
            currency: mojaloopTransfers.currency,
            count: sql<number>`COUNT(*)`,
            committedAmount: sql<number>`COALESCE(SUM(CASE WHEN ${mojaloopTransfers.status} = 'COMMITTED' THEN ${mojaloopTransfers.amount}::numeric ELSE 0 END), 0)`,
            abortedCount: sql<number>`SUM(CASE WHEN ${mojaloopTransfers.status} = 'ABORTED' THEN 1 ELSE 0 END)`,
            pendingCount: sql<number>`SUM(CASE WHEN ${mojaloopTransfers.status} = 'PENDING' THEN 1 ELSE 0 END)`,
          })
          .from(mojaloopTransfers)
          .where(and(...conditions))
          .groupBy(mojaloopTransfers.currency)
          .orderBy(desc(sql`SUM(${mojaloopTransfers.amount}::numeric)`)),

        // Daily committed volume (last 30 days)
        db
          .select({
            date: sql<string>`DATE(${mojaloopTransfers.createdAt})`,
            committedCount: sql<number>`SUM(CASE WHEN ${mojaloopTransfers.status} = 'COMMITTED' THEN 1 ELSE 0 END)`,
            committedAmount: sql<number>`COALESCE(SUM(CASE WHEN ${mojaloopTransfers.status} = 'COMMITTED' THEN ${mojaloopTransfers.amount}::numeric ELSE 0 END), 0)`,
            abortedCount: sql<number>`SUM(CASE WHEN ${mojaloopTransfers.status} = 'ABORTED' THEN 1 ELSE 0 END)`,
          })
          .from(mojaloopTransfers)
          .where(and(...conditions))
          .groupBy(sql`DATE(${mojaloopTransfers.createdAt})`)
          .orderBy(sql`DATE(${mojaloopTransfers.createdAt})`),

        // Unmatched: COMMITTED Mojaloop transfers with no matching settlement record
        db
          .select({
            transferId: mojaloopTransfers.transferId,
            amount: mojaloopTransfers.amount,
            currency: mojaloopTransfers.currency,
            payerFspId: mojaloopTransfers.payerFspId,
            payeeFspId: mojaloopTransfers.payeeFspId,
            committedAt: mojaloopTransfers.committedAt,
            nexcomSettlementId: mojaloopTransfers.nexcomSettlementId,
          })
          .from(mojaloopTransfers)
          .where(
            and(
              eq(mojaloopTransfers.status, "COMMITTED"),
              sql`${mojaloopTransfers.nexcomSettlementId} IS NULL`,
              gte(mojaloopTransfers.createdAt, fromDate),
              lte(mojaloopTransfers.createdAt, toDate)
            )
          )
          .orderBy(desc(mojaloopTransfers.committedAt))
          .limit(100),
      ]);

      const summaryMap = summary.reduce(
        (acc, r) => { acc[r.status] = { count: r.count, totalAmount: Number(r.totalAmount) }; return acc; },
        {} as Record<string, { count: number; totalAmount: number }>
      );

      return {
        period: { from: fromDate.toISOString(), to: toDate.toISOString() },
        summary: {
          committed: summaryMap["COMMITTED"] ?? { count: 0, totalAmount: 0 },
          aborted: summaryMap["ABORTED"] ?? { count: 0, totalAmount: 0 },
          pending: summaryMap["PENDING"] ?? { count: 0, totalAmount: 0 },
          reserved: summaryMap["RESERVED"] ?? { count: 0, totalAmount: 0 },
          expired: summaryMap["EXPIRED"] ?? { count: 0, totalAmount: 0 },
        },
        byCurrency: byCurrency.map((r) => ({
          currency: r.currency,
          count: Number(r.count),
          committedAmount: Number(r.committedAmount),
          abortedCount: Number(r.abortedCount),
          pendingCount: Number(r.pendingCount),
        })),
        byDay: byDay.map((r) => ({
          date: r.date,
          committedCount: Number(r.committedCount),
          committedAmount: Number(r.committedAmount),
          abortedCount: Number(r.abortedCount),
        })),
        unmatchedTransfers: unmatched,
        unmatchedCount: unmatched.length,
      };
    }),

  // ── Dead-letter queue: list ────────────────────────────────────────────────────
  deadLetterList: adminProcedure
    .input(
      z.object({
        resolved: z.boolean().optional(),
        limit: z.number().int().min(1).max(100).default(50),
        offset: z.number().int().min(0).default(0),
      })
    )
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return { items: [], total: 0 };
      const conditions: ReturnType<typeof eq>[] = [];
      if (input.resolved !== undefined)
        conditions.push(eq(mojaloopDeadLetter.resolved, input.resolved));
      const [items, countResult] = await Promise.all([
        db
          .select()
          .from(mojaloopDeadLetter)
          .where(conditions.length ? and(...conditions) : undefined)
          .orderBy(desc(mojaloopDeadLetter.createdAt))
          .limit(input.limit)
          .offset(input.offset),
        db
          .select({ count: sql<number>`count(*)` })
          .from(mojaloopDeadLetter)
          .where(conditions.length ? and(...conditions) : undefined),
      ]);
      return { items, total: Number(countResult[0]?.count ?? 0) };
    }),

  // ── Dead-letter queue: retry ──────────────────────────────────────────────────
  deadLetterRetry: adminProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      const [entry] = await db
        .select()
        .from(mojaloopDeadLetter)
        .where(eq(mojaloopDeadLetter.id, input.id))
        .limit(1);
      if (!entry) throw new TRPCError({ code: "NOT_FOUND", message: "Dead-letter entry not found" });
      if (entry.resolved) throw new TRPCError({ code: "BAD_REQUEST", message: "Entry already resolved" });
      const portalUrl = process.env.PORTAL_URL ?? "http://localhost:3000";
      let success = false;
      let errorMsg = "";
      try {
        const payload = {
          transferId: entry.transferId,
          payerFspId: entry.payerFspId,
          payeeFspId: entry.payeeFspId,
          payerIdentifier: entry.payerIdentifier,
          payeeIdentifier: entry.payeeIdentifier,
          amount: entry.amount,
          currency: entry.currency,
          status: "COMMITTED",
          committedAt: new Date().toISOString(),
        };
        const res = await fetch(`${portalUrl}/api/internal/mojaloop/settlement-callback`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-internal-secret": process.env.INTERNAL_SECRET ?? process.env.JWT_SECRET ?? "",
          },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(10_000),
        });
        success = res.ok;
        if (!res.ok) errorMsg = await res.text();
      } catch (err: unknown) {
        errorMsg = err instanceof Error ? err.message : String(err);
      }
      if (success) {
        await db
          .update(mojaloopDeadLetter)
          .set({
            resolved: true,
            resolvedAt: new Date(),
            resolvedBy: ctx.user.name ?? ctx.user.openId,
            status: "RESOLVED",
            updatedAt: new Date(),
          })
          .where(eq(mojaloopDeadLetter.id, input.id));
        return { success: true, message: "Transfer re-submitted and resolved" };
      } else {
        await db
          .update(mojaloopDeadLetter)
          .set({
            retryCount: (entry.retryCount ?? 0) + 1,
            lastRetryAt: new Date(),
            errorMessage: errorMsg,
            updatedAt: new Date(),
          })
          .where(eq(mojaloopDeadLetter.id, input.id));
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `Retry failed: ${errorMsg}` });
      }
    }),

  // ── Dead-letter queue: manual resolve ─────────────────────────────────────────
  deadLetterResolve: adminProcedure
    .input(z.object({ id: z.number().int().positive(), notes: z.string().optional() }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      await db
        .update(mojaloopDeadLetter)
        .set({
          resolved: true,
          resolvedAt: new Date(),
          resolvedBy: ctx.user.name ?? ctx.user.openId,
          status: "MANUALLY_RESOLVED",
          errorMessage: input.notes ?? "Manually resolved by operator",
          updatedAt: new Date(),
        })
        .where(eq(mojaloopDeadLetter.id, input.id));
      return { success: true };
    }),

  // ── DFSP endpoint management: register FSPIOP callback endpoints ──────────
  registerDfspEndpoints: adminProcedure
    .input(
      z.object({
        fspId: z.string().min(1).max(64),
        endpoints: z.array(
          z.object({
            type: z.enum([
              "FSPIOP_CALLBACK_URL_TRANSFER_POST",
              "FSPIOP_CALLBACK_URL_TRANSFER_PUT",
              "FSPIOP_CALLBACK_URL_TRANSFER_ERROR",
              "FSPIOP_CALLBACK_URL_QUOTES_POST",
              "FSPIOP_CALLBACK_URL_QUOTES_PUT",
              "FSPIOP_CALLBACK_URL_QUOTES_ERROR",
              "FSPIOP_CALLBACK_URL_PARTIES_GET",
              "FSPIOP_CALLBACK_URL_PARTIES_PUT",
              "FSPIOP_CALLBACK_URL_PARTIES_PUT_ERROR",
            ]),
            value: z.string().url(),
          })
        ),
      })
    )
    .mutation(async ({ input }) => {
      const results: { type: string; success: boolean; error?: string }[] = [];
      for (const endpoint of input.endpoints) {
        try {
          await adapterFetch(`/participants/${encodeURIComponent(input.fspId)}/endpoints`, {
            method: "POST",
            body: JSON.stringify({ type: endpoint.type, value: endpoint.value }),
          });
          results.push({ type: endpoint.type, success: true });
        } catch (err: unknown) {
          results.push({
            type: endpoint.type,
            success: false,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
      const db = await getDb();
      if (db) {
        const transferPostEndpoint = input.endpoints.find(
          (e) => e.type === "FSPIOP_CALLBACK_URL_TRANSFER_POST"
        );
        if (transferPostEndpoint) {
          await db
            .update(mojaloopDfsps)
            .set({ callbackUrl: transferPostEndpoint.value, updatedAt: new Date() })
            .where(eq(mojaloopDfsps.fspId, input.fspId));
        }
      }
      const failed = results.filter((r) => !r.success);
      return {
        success: failed.length === 0,
        registered: results.filter((r) => r.success).length,
        failed: failed.length,
        results,
      };
    }),

  // ── Transfer volume chart: daily committed volume for last N days ─────────
  transferVolumeChart: protectedProcedure
    .input(
      z.object({
        days: z.number().int().min(7).max(90).default(30),
        currency: z.string().optional(),
      })
    )
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return [];
      const since = new Date();
      since.setDate(since.getDate() - input.days);
      const conditions = [
        eq(mojaloopTransfers.status, "COMMITTED"),
        gte(mojaloopTransfers.committedAt, since),
      ];
      if (input.currency)
        conditions.push(eq(mojaloopTransfers.currency, input.currency));
      const rows = await db
        .select({
          date: sql<string>`DATE(${mojaloopTransfers.committedAt})::text`,
          count: sql<number>`count(*)`,
          totalAmount: sql<number>`COALESCE(SUM(${mojaloopTransfers.amount}::numeric), 0)`,
          currency: mojaloopTransfers.currency,
        })
        .from(mojaloopTransfers)
        .where(and(...conditions))
        .groupBy(
          sql`DATE(${mojaloopTransfers.committedAt})`,
          mojaloopTransfers.currency
        )
        .orderBy(sql`DATE(${mojaloopTransfers.committedAt})`);
      return rows.map((r) => ({
        date: r.date,
        count: Number(r.count),
        totalAmount: Number(r.totalAmount),
        currency: r.currency,
      }));
    }),

  // ── Recent activity feed ─────────────────────────────────────────────────────
  recentActivity: protectedProcedure
    .input(z.object({ limit: z.number().int().min(1).max(50).default(10) }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return [];
      return db
        .select({
          transferId: mojaloopTransfers.transferId,
          status: mojaloopTransfers.status,
          amount: mojaloopTransfers.amount,
          currency: mojaloopTransfers.currency,
          payerFspId: mojaloopTransfers.payerFspId,
          payeeFspId: mojaloopTransfers.payeeFspId,
          createdAt: mojaloopTransfers.createdAt,
          committedAt: mojaloopTransfers.committedAt,
        })
        .from(mojaloopTransfers)
        .orderBy(desc(mojaloopTransfers.createdAt))
        .limit(input.limit);
    }),
});

export type MojaloopRouter = typeof mojaloopRouter;
