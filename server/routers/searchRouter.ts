/**
 * searchRouter — global cross-entity search backed by OpenSearch.
 *
 * Falls back to direct PostgreSQL ILIKE queries when OpenSearch is unavailable
 * (development / first-boot), so the UI always works.
 */
import { z } from "zod";
import { writeAuditLog } from "../audit";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { users, orders, warehouseReceipts, depositRequests } from "../../drizzle/schema";
import { ilike, or, desc, sql } from "drizzle-orm";

// ── OpenSearch client (optional — gracefully degrades) ────────────────────────
let opensearchClient: import("@opensearch-project/opensearch").Client | null = null;

async function getOpenSearchClient() {
  if (opensearchClient) return opensearchClient;
  const url = process.env.OPENSEARCH_URL ?? "http://localhost:9200";
  try {
    const { Client } = await import("@opensearch-project/opensearch");
    const client = new Client({
      node: url,
      ssl: { rejectUnauthorized: false },
    });
    // Quick ping to confirm availability
    await client.ping();
    opensearchClient = client;
    return client;
  } catch {
    return null;
  }
}

// ── Entity type definitions ───────────────────────────────────────────────────
export type SearchResultItem = {
  id: string;
  type: "user" | "order" | "warehouse_receipt" | "deposit" | "instrument";
  title: string;
  subtitle: string;
  /** HTML snippet with <em> tags around matched terms (OpenSearch only) */
  titleHighlight?: string;
  subtitleHighlight?: string;
  badge?: string;
  href: string;
  score: number;
};

// ── OpenSearch multi-index search ─────────────────────────────────────────────
async function searchOpenSearch(
  query: string,
  types: string[],
  limit: number
): Promise<SearchResultItem[]> {
  const client = await getOpenSearchClient();
  if (!client) return [];

  const indices = types.flatMap((t) => {
    const map: Record<string, string> = {
      user: "nexcom-users",
      order: "nexcom-orders",
      warehouse_receipt: "nexcom-warehouse-receipts",
      deposit: "nexcom-deposits",
      instrument: "nexcom-instruments",
    };
    return map[t] ? [map[t]] : [];
  });

  if (indices.length === 0) return [];

  try {
    const response = await client.search({
      index: indices.join(","),
      body: {
        size: limit,
        query: {
          multi_match: {
            query,
            fields: [
              "full_name^3",
              "email^2",
              "order_id^3",
              "instrument_symbol^3",
              "receipt_id^2",
              "commodity_name^2",
              "description",
              "status",
            ],
            type: "best_fields",
            fuzziness: "AUTO",
          },
        },
        highlight: {
          fields: {
            full_name: {},
            email: {},
            order_id: {},
            instrument_symbol: {},
          },
        },
      },
    });

    const hits = (response.body?.hits?.hits ?? []) as Array<{
      _index: string;
      _id: string;
      _score: number;
      _source: Record<string, unknown>;
      highlight?: Record<string, string[]>;
    }>;

    return hits.map((hit) => {
      const src = hit._source;
      const index = hit._index;
      const hl = hit.highlight ?? {};

      /** Pick the first highlight snippet for a field, or fall back to the raw value */
      const h = (field: string, fallback: string): string | undefined =>
        hl[field]?.[0] ?? (fallback ? undefined : undefined);

      if (index === "nexcom-users") {
        const rawTitle = (src.full_name as string) ?? (src.email as string) ?? "Unknown User";
        const rawSub   = (src.email as string) ?? "";
        return {
          id: hit._id,
          type: "user" as const,
          title: rawTitle,
          titleHighlight: h("full_name", rawTitle),
          subtitle: rawSub,
          subtitleHighlight: h("email", rawSub),
          badge: (src.kyc_status as string) ?? "PENDING",
          href: `/admin/users`,
          score: hit._score,
        };
      }
      if (index === "nexcom-orders") {
        const rawTitle = `${src.side as string} ${src.quantity as string} ${src.instrument_symbol as string}`;
        const rawSub   = `${src.status as string} · ₦${Number(src.price ?? 0).toLocaleString()}`;
        return {
          id: hit._id,
          type: "order" as const,
          title: rawTitle,
          titleHighlight: h("order_id", rawTitle) ?? h("instrument_symbol", rawTitle),
          subtitle: rawSub,
          badge: (src.order_type as string) ?? "LIMIT",
          href: `/orders`,
          score: hit._score,
        };
      }
      if (index === "nexcom-warehouse-receipts") {
        const rawTitle = (src.receipt_id as string) ?? hit._id;
        const rawSub   = `${src.commodity_name as string} · ${src.quantity as string} ${src.unit as string}`;
        return {
          id: hit._id,
          type: "warehouse_receipt" as const,
          title: rawTitle,
          titleHighlight: h("receipt_id", rawTitle),
          subtitle: rawSub,
          badge: (src.status as string) ?? "ACTIVE",
          href: `/warehouse-receipts`,
          score: hit._score,
        };
      }
      if (index === "nexcom-deposits") {
        const rawTitle = `Deposit ₦${Number(src.amount ?? 0).toLocaleString()}`;
        const rawSub   = (src.description as string) ?? "";
        return {
          id: hit._id,
          type: "deposit" as const,
          title: rawTitle,
          subtitle: rawSub,
          badge: (src.status as string) ?? "PENDING",
          href: `/deposits`,
          score: hit._score,
        };
      }
      if (index === "nexcom-instruments") {
        const rawTitle = (src.symbol as string) ?? hit._id;
        const rawSub   = (src.name as string) ?? "";
        return {
          id: hit._id,
          type: "instrument" as const,
          title: rawTitle,
          titleHighlight: h("instrument_symbol", rawTitle),
          subtitle: rawSub,
          badge: (src.category as string) ?? "COMMODITY",
          href: `/markets?q=${encodeURIComponent((src.symbol as string) ?? "")}`,
          score: hit._score,
        };
      }
      return {
        id: hit._id,
        type: "order" as const,
        title: hit._id,
        subtitle: index,
        href: "/",
        score: hit._score,
      };
    });
  } catch {
    return [];
  }
}

// ── PostgreSQL fallback search ────────────────────────────────────────────────
async function searchPostgres(
  query: string,
  types: string[],
  limit: number,
  userId: number,
  isAdmin: boolean
): Promise<SearchResultItem[]> {
  const db = await getDb();
  if (!db) return [];
  const results: SearchResultItem[] = [];
  const q = `%${query}%`;
  const perType = Math.max(3, Math.floor(limit / types.length));

  if (types.includes("user") && isAdmin) {
    const rows = await db
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        role: users.role,
      })
      .from(users)
      .where(or(ilike(users.name, q), ilike(users.email, q)))
      .orderBy(desc(users.createdAt))
      .limit(perType);

    for (const row of rows) {
      results.push({
        id: String(row.id),
        type: "user",
        title: row.name ?? row.email ?? "Unknown",
        subtitle: row.email ?? "",
        badge: row.role ?? "user",
        href: `/admin/users`,
        score: 1,
      });
    }
  }

  if (types.includes("order")) {
    const rows = await db
      .select({
        id: orders.id,
        side: orders.side,
        quantity: orders.quantity,
        price: orders.price,
        status: orders.status,
        symbol: orders.symbol,
        orderType: orders.orderType,
      })
      .from(orders)
      .where(
        or(
          ilike(orders.symbol, q),
          ilike(orders.status, q)
        )
      )
      .orderBy(desc(orders.createdAt))
      .limit(perType);

    for (const row of rows) {
      results.push({
        id: String(row.id),
        type: "order",
        title: `${row.side} ${row.quantity} ${row.symbol}`,
        subtitle: `${row.status} · ₦${Number(row.price ?? 0).toLocaleString()}`,
        badge: row.orderType ?? "LIMIT",
        href: `/orders`,
        score: 1,
      });
    }
  }

  if (types.includes("warehouse_receipt")) {
    const rows = await db
      .select({
        id: warehouseReceipts.id,
        receiptNumber: warehouseReceipts.receiptNumber,
        commodity: warehouseReceipts.commodity,
        quantity: warehouseReceipts.quantity,
        unit: warehouseReceipts.unit,
        status: warehouseReceipts.status,
      })
      .from(warehouseReceipts)
      .where(
        or(
          ilike(warehouseReceipts.receiptNumber, q),
          ilike(warehouseReceipts.commodity, q)
        )
      )
      .orderBy(desc(warehouseReceipts.createdAt))
      .limit(perType);

    for (const row of rows) {
      results.push({
        id: String(row.id),
        type: "warehouse_receipt",
        title: row.receiptNumber ?? `Receipt #${row.id}`,
        subtitle: `${row.commodity} · ${row.quantity} ${row.unit}`,
        badge: row.status ?? "ACTIVE",
        href: `/warehouse-receipts`,
        score: 1,
      });
    }
  }

  if (types.includes("deposit")) {
    const rows = await db
      .select({
        id: depositRequests.id,
        quantity: depositRequests.quantity,
        commodity: depositRequests.commodity,
        status: depositRequests.status,
        notes: depositRequests.notes,
      })
      .from(depositRequests)
      .where(
        or(
          ilike(depositRequests.status, q),
          ilike(depositRequests.commodity, q)
        )
      )
      .orderBy(desc(depositRequests.createdAt))
      .limit(perType);

    for (const row of rows) {
      results.push({
        id: String(row.id),
        type: "deposit",
        title: `Deposit: ${row.commodity} × ${row.quantity}`,
        subtitle: row.notes ?? "",
        badge: row.status ?? "PENDING",
        href: `/deposits`,
        score: 1,
      });
    }
  }

  return results.slice(0, limit);
}

// ── Router ────────────────────────────────────────────────────────────────────
export const searchRouter = router({
  global: protectedProcedure
    .input(
      z.object({
        query: z.string().min(1).max(200),
        types: z
          .array(
            z.enum(["user", "order", "warehouse_receipt", "deposit", "instrument"])
          )
          .default(["user", "order", "warehouse_receipt", "deposit", "instrument"]),
        limit: z.number().int().min(1).max(50).default(20),
      })
    )
    .query(async ({ input, ctx }) => {
      const { query, types, limit } = input;
      const isAdmin = ctx.user.role === "admin";

      // Non-admins cannot search users
      const allowedTypes = isAdmin ? types : types.filter((t) => t !== "user");

      // Try OpenSearch first
      const osResults = await searchOpenSearch(query, allowedTypes, limit);
      if (osResults.length > 0) {
        return { results: osResults, source: "opensearch" as const };
      }

      // Fall back to PostgreSQL
      const pgResults = await searchPostgres(
        query,
        allowedTypes,
        limit,
        ctx.user.id,
        isAdmin
      );
      return { results: pgResults, source: "postgres" as const };
    }),

  update: protectedProcedure
    .input(z.object({ indexName: z.string(), docId: z.string(), data: z.record(z.string(), z.unknown()) }))
    .mutation(async ({ ctx, input }) => {
      await writeAuditLog(ctx.user.id, "search.update", { indexName: input.indexName, docId: input.docId });
      return { success: true };
    }),
  delete: protectedProcedure
    .input(z.object({ indexName: z.string(), docId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await writeAuditLog(ctx.user.id, "search.delete", { indexName: input.indexName, docId: input.docId });
      return { success: true };
    }),
});
