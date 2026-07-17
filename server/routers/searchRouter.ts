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
import { users, orders, warehouseReceipts, depositRequests, cropListings, aiSearchHistory } from "../../drizzle/schema";
import { ilike, or, desc, sql, and, gte, lte, eq } from "drizzle-orm";
import { invokeLLM } from "../_core/llm";

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

    const hits = ((response.body?.hits?.hits ?? []) as unknown) as Array<{
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
      await writeAuditLog({ userId: ctx.user.id, action: "search.update", details: { indexName: input.indexName, docId: input.docId } });
      return { success: true };
    }),
  delete: protectedProcedure
    .input(z.object({ indexName: z.string(), docId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await writeAuditLog({ userId: ctx.user.id, action: "search.delete", details: { indexName: input.indexName, docId: input.docId } });
      return { success: true };
    }),

  // AI-powered natural language search
  aiSearch: protectedProcedure
    .input(z.object({ query: z.string().min(1).max(500) }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) return { results: [] as SearchResultItem[], parsedIntent: {} };

      // Parse natural language query into structured filters using LLM
      type ParsedIntent = {
        symbol?: string;
        assetClass?: string;
        side?: string;
        minPrice?: number;
        maxPrice?: number;
        fromDate?: string;
        toDate?: string;
        entityType?: "order" | "listing" | "user" | "all";
        cropType?: string;
        status?: string;
      };

      let parsedIntent: ParsedIntent = { entityType: "all" };

      try {
        const llmResponse = await invokeLLM({
          messages: [
            {
              role: "system",
              content: `You are a financial exchange search assistant for NEXCOM, a Nigerian agricultural commodity exchange. Extract structured search filters from the user's natural language query. Return ONLY valid JSON with these optional fields: symbol (string, e.g. "MAIZE/NGN"), assetClass (one of COMMODITY/FOREX/EQUITY/DIGITAL_ASSET/INDEX), side (BUY or SELL), minPrice (number), maxPrice (number), fromDate (ISO date YYYY-MM-DD), toDate (ISO date YYYY-MM-DD), entityType (order/listing/user/all), cropType (e.g. maize/soybean/cassava), status (e.g. OPEN/FILLED/ACTIVE). Omit fields that cannot be determined. Default entityType to "all".`,
            },
            { role: "user", content: input.query },
          ],
          response_format: {
            type: "json_schema",
            json_schema: {
              name: "search_filters",
              strict: true,
              schema: {
                type: "object",
                properties: {
                  symbol: { type: "string" },
                  assetClass: { type: "string" },
                  side: { type: "string" },
                  minPrice: { type: "number" },
                  maxPrice: { type: "number" },
                  fromDate: { type: "string" },
                  toDate: { type: "string" },
                  entityType: { type: "string" },
                  cropType: { type: "string" },
                  status: { type: "string" },
                },
                required: [],
                additionalProperties: false,
              },
            },
          },
        });
        const content = llmResponse?.choices?.[0]?.message?.content;
        if (content) {
          parsedIntent = JSON.parse(typeof content === "string" ? content : JSON.stringify(content)) as ParsedIntent;
        }
      } catch {
        // LLM unavailable — fall back to keyword search only
      }

      const results: SearchResultItem[] = [];
      const entityType = parsedIntent.entityType ?? "all";

      // Search orders
      if (entityType === "all" || entityType === "order") {
        const conditions: ReturnType<typeof eq>[] = [eq(orders.userId, ctx.user.id) as any];
        if (parsedIntent.symbol) conditions.push(ilike(orders.symbol, `%${parsedIntent.symbol}%`) as any);
        if (parsedIntent.assetClass) conditions.push(eq(orders.assetClass, parsedIntent.assetClass as any) as any);
        if (parsedIntent.side) conditions.push(eq(orders.side, parsedIntent.side as any) as any);
        if (parsedIntent.status) conditions.push(eq(orders.status, parsedIntent.status as any) as any);
        if (parsedIntent.minPrice) conditions.push(gte(orders.price, String(parsedIntent.minPrice)) as any);
        if (parsedIntent.maxPrice) conditions.push(lte(orders.price, String(parsedIntent.maxPrice)) as any);
        if (parsedIntent.fromDate) conditions.push(gte(orders.createdAt, new Date(parsedIntent.fromDate)) as any);
        if (parsedIntent.toDate) conditions.push(lte(orders.createdAt, new Date(parsedIntent.toDate)) as any);

        // If only user filter, add keyword search on symbol
        if (conditions.length === 1) {
          conditions.push(ilike(orders.symbol, `%${input.query}%`) as any);
        }

        const orderRows = await db
          .select()
          .from(orders)
          .where(and(...conditions))
          .orderBy(desc(orders.createdAt))
          .limit(10);

        for (const row of orderRows) {
          results.push({
            id: String(row.id),
            type: "order",
            title: `${row.side} ${row.quantity} ${row.symbol}`,
            subtitle: `${row.orderType} @ ${row.price ?? "market"} — ${row.status}`,
            badge: row.status,
            href: `/orders`,
            score: 2,
          });
        }
      }

      // Search crop listings
      if (entityType === "all" || entityType === "listing") {
        const listingConditions: ReturnType<typeof eq>[] = [];
        if (parsedIntent.cropType) {
          listingConditions.push(ilike(cropListings.cropType, `%${parsedIntent.cropType}%`) as any);
        } else {
          listingConditions.push(
            or(
              ilike(cropListings.cropType, `%${input.query}%`),
              ilike(cropListings.variety, `%${input.query}%`)
            ) as any
          );
        }
        if (parsedIntent.minPrice) listingConditions.push(gte(cropListings.askingPricePerKg, String(parsedIntent.minPrice)) as any);
        if (parsedIntent.maxPrice) listingConditions.push(lte(cropListings.askingPricePerKg, String(parsedIntent.maxPrice)) as any);
        if (parsedIntent.status) listingConditions.push(eq(cropListings.status, parsedIntent.status as any) as any);

        const listingRows = await db
          .select()
          .from(cropListings)
          .where(and(...listingConditions))
          .orderBy(desc(cropListings.createdAt))
          .limit(10);

        for (const row of listingRows) {
          results.push({
            id: String(row.id),
            type: "instrument",
            title: `${row.cropType}${row.variety ? ` (${row.variety})` : ""} — ${row.quantityKg} kg`,
            subtitle: `₦${row.askingPricePerKg}/kg — ${row.status}`,
            badge: row.status,
            href: `/marketplace`,
            score: 1,
          });
        }
      }

      // Search users (admin only)
      if ((entityType === "all" || entityType === "user") && ctx.user.role === "admin") {
        const userRows = await db
          .select({ id: users.id, email: users.email, name: users.name, role: users.role })
          .from(users)
          .where(
            or(
              ilike(users.email, `%${input.query}%`),
              ilike(users.name, `%${input.query}%`)
            )
          )
          .limit(5);

        for (const row of userRows) {
          results.push({
            id: String(row.id),
            type: "user",
            title: row.name ?? row.email ?? "Unknown",
            subtitle: row.email ?? "",
            badge: row.role ?? "user",
            href: `/admin/users/${row.id}`,
            score: 3,
          });
        }
      }

      results.sort((a, b) => b.score - a.score);

      // ── Persist search history (keep last 20 per user) ────────────────────
      try {
        await db.insert(aiSearchHistory).values({
          userId: ctx.user.id,
          query: input.query,
          parsedIntent: parsedIntent as any,
          resultCount: results.length,
        });
        // Prune to last 20 entries for this user
        const oldest = await db
          .select({ id: aiSearchHistory.id })
          .from(aiSearchHistory)
          .where(eq(aiSearchHistory.userId, ctx.user.id))
          .orderBy(desc(aiSearchHistory.createdAt))
          .offset(20)
          .limit(1000);
        if (oldest.length > 0) {
          const idsToDelete = oldest.map((r) => r.id);
          for (const id of idsToDelete) {
            await db.delete(aiSearchHistory).where(eq(aiSearchHistory.id, id));
          }
        }
      } catch (e) {
        console.warn("[Search] Failed to persist search history:", (e as Error).message);
      }

      return { results, parsedIntent };
    }),

  // ── Get recent AI search history for the current user ──────────────────────
  searchHistory: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) return [];
    const rows = await db
      .select()
      .from(aiSearchHistory)
      .where(eq(aiSearchHistory.userId, ctx.user.id))
      .orderBy(desc(aiSearchHistory.createdAt))
      .limit(10);
    return rows;
  }),
});
