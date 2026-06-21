/**
 * opensearch.ts — Centralized OpenSearch indexing helpers for NEXCOM Exchange
 *
 * Provides:
 *  - indexDocument(index, id, doc)  — upsert a document into an OpenSearch index
 *  - deleteDocument(index, id)      — remove a document from an index
 *  - createNexcomIndices()          — bootstrap all NEXCOM indices on startup
 *
 * All operations gracefully degrade when OpenSearch is unavailable.
 */

import type { Client } from "@opensearch-project/opensearch";

// ─── Client ───────────────────────────────────────────────────────────────────

let _client: Client | null = null;
let _available = false;

async function getClient(): Promise<Client | null> {
  if (_client && _available) return _client;
  if (_client && !_available) return null;

  const url = process.env.OPENSEARCH_URL ?? "http://localhost:9200";
  try {
    const { Client } = await import("@opensearch-project/opensearch");
    const client = new Client({
      node: url,
      ssl: { rejectUnauthorized: false },
      requestTimeout: 3000,
    });
    await client.ping();
    _client = client;
    _available = true;
    console.log("[OpenSearch] Connected:", url);
    return client;
  } catch {
    _available = false;
    return null;
  }
}

// ─── Index Definitions ────────────────────────────────────────────────────────

const INDEX_MAPPINGS: Record<string, object> = {
  "nexcom-orders": {
    mappings: {
      properties: {
        order_id:          { type: "keyword" },
        user_id:           { type: "integer" },
        symbol:            { type: "keyword" },
        instrument_symbol: { type: "text", fields: { keyword: { type: "keyword" } } },
        side:              { type: "keyword" },
        order_type:        { type: "keyword" },
        status:            { type: "keyword" },
        quantity:          { type: "double" },
        price:             { type: "double" },
        created_at:        { type: "date" },
      },
    },
  },
  "nexcom-users": {
    mappings: {
      properties: {
        full_name:   { type: "text", fields: { keyword: { type: "keyword" } } },
        email:       { type: "text", fields: { keyword: { type: "keyword" } } },
        role:        { type: "keyword" },
        kyc_status:  { type: "keyword" },
        created_at:  { type: "date" },
      },
    },
  },
  "nexcom-warehouse-receipts": {
    mappings: {
      properties: {
        receipt_id:      { type: "keyword" },
        commodity_name:  { type: "text", fields: { keyword: { type: "keyword" } } },
        quantity:        { type: "double" },
        unit:            { type: "keyword" },
        status:          { type: "keyword" },
        warehouse_name:  { type: "text" },
        created_at:      { type: "date" },
      },
    },
  },
  "nexcom-deposits": {
    mappings: {
      properties: {
        amount:      { type: "double" },
        currency:    { type: "keyword" },
        status:      { type: "keyword" },
        description: { type: "text" },
        created_at:  { type: "date" },
      },
    },
  },
  "nexcom-instruments": {
    mappings: {
      properties: {
        symbol:   { type: "keyword" },
        name:     { type: "text", fields: { keyword: { type: "keyword" } } },
        category: { type: "keyword" },
        unit:     { type: "keyword" },
        currency: { type: "keyword" },
      },
    },
  },
};

// ─── Bootstrap ────────────────────────────────────────────────────────────────

/**
 * Create all NEXCOM OpenSearch indices if they don't exist.
 * Safe to call on every startup — uses `exists` check before creating.
 */
export async function createNexcomIndices(): Promise<void> {
  const client = await getClient();
  if (!client) {
    console.log("[OpenSearch] Unavailable — skipping index bootstrap");
    return;
  }

  for (const [indexName, settings] of Object.entries(INDEX_MAPPINGS)) {
    try {
      const { body: exists } = await client.indices.exists({ index: indexName });
      if (!exists) {
        await client.indices.create({ index: indexName, body: settings });
        console.log(`[OpenSearch] Created index: ${indexName}`);
      }
    } catch (err) {
      console.warn(`[OpenSearch] Failed to create index ${indexName}:`, (err as Error).message);
    }
  }
}

// ─── Document Operations ──────────────────────────────────────────────────────

/**
 * Upsert a document into an OpenSearch index.
 * Uses index API (create or replace) for simplicity.
 * Silently fails if OpenSearch is unavailable.
 */
export async function indexDocument(
  indexName: string,
  docId: string,
  document: Record<string, unknown>
): Promise<void> {
  const client = await getClient();
  if (!client) return;

  try {
    await client.index({
      index: indexName,
      id: docId,
      body: document,
      refresh: "false", // async refresh for performance
    });
  } catch (err) {
    console.warn(`[OpenSearch] indexDocument failed (${indexName}/${docId}):`, (err as Error).message);
  }
}

/**
 * Delete a document from an OpenSearch index.
 * Silently fails if OpenSearch is unavailable or document not found.
 */
export async function deleteDocument(
  indexName: string,
  docId: string
): Promise<void> {
  const client = await getClient();
  if (!client) return;

  try {
    await client.delete({ index: indexName, id: docId });
  } catch {
    // Silently ignore 404 (document not found)
  }
}

// ─── Typed Index Helpers ──────────────────────────────────────────────────────

/** Index an order document */
export function indexOrder(order: {
  id: number;
  userId: number;
  symbol: string;
  side: string;
  orderType: string | null;
  status: string;
  quantity: string | null;
  price: string | null;
  createdAt: Date;
}): Promise<void> {
  return indexDocument("nexcom-orders", String(order.id), {
    order_id: String(order.id),
    user_id: order.userId,
    symbol: order.symbol,
    instrument_symbol: order.symbol,
    side: order.side,
    order_type: order.orderType ?? "LIMIT",
    status: order.status,
    quantity: parseFloat(order.quantity ?? "0"),
    price: parseFloat(order.price ?? "0"),
    created_at: order.createdAt.toISOString(),
  });
}

/** Index a user document */
export function indexUser(user: {
  id: number;
  name: string | null;
  email: string | null;
  role: string;
  createdAt: Date;
}): Promise<void> {
  return indexDocument("nexcom-users", String(user.id), {
    full_name: user.name ?? "",
    email: user.email ?? "",
    role: user.role,
    kyc_status: "PENDING",
    created_at: user.createdAt.toISOString(),
  });
}

/** Index a warehouse receipt document */
export function indexWarehouseReceipt(receipt: {
  id: number;
  receiptNumber: string | null;
  commodity: string | null;
  quantity: string | null;
  unit: string | null;
  status: string | null;
  createdAt: Date;
}): Promise<void> {
  return indexDocument("nexcom-warehouse-receipts", String(receipt.id), {
    receipt_id: receipt.receiptNumber ?? String(receipt.id),
    commodity_name: receipt.commodity ?? "",
    quantity: parseFloat(receipt.quantity ?? "0"),
    unit: receipt.unit ?? "",
    status: receipt.status ?? "ACTIVE",
    created_at: receipt.createdAt.toISOString(),
  });
}

/** Index a deposit document */
export function indexDeposit(deposit: {
  id: number;
  quantity: string | null;
  commodity: string | null;
  status: string | null;
  notes: string | null;
  createdAt: Date;
}): Promise<void> {
  return indexDocument("nexcom-deposits", String(deposit.id), {
    amount: parseFloat(deposit.quantity ?? "0"),
    currency: "NGN",
    status: deposit.status ?? "PENDING",
    description: deposit.notes ?? deposit.commodity ?? "",
    created_at: deposit.createdAt.toISOString(),
  });
}

/** Index a crop listing as an instrument */
export function indexCropListing(listing: {
  id: number;
  cropType: string;
  variety: string | null;
  status: string;
  askingPricePerKg: string | null;
}): Promise<void> {
  return indexDocument("nexcom-instruments", `listing-${listing.id}`, {
    symbol: listing.cropType.toUpperCase().replace(/\s+/g, "_"),
    name: `${listing.cropType}${listing.variety ? ` (${listing.variety})` : ""}`,
    category: "COMMODITY",
    unit: "kg",
    currency: "NGN",
    price: parseFloat(listing.askingPricePerKg ?? "0"),
    status: listing.status,
  });
}
