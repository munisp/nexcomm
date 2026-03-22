/**
 * NEXCOM Go Gateway Client
 * Proxies calls to the Go gateway service (port 8200) which wraps:
 *   - TigerBeetle double-entry ledger (trade settlement, margin, fees)
 *   - Kafka event streaming (fallback: in-memory)
 *   - Redis cache (fallback: in-memory)
 *   - Temporal workflow engine (fallback: in-memory)
 *   - Keycloak identity (fallback: JWT-only)
 *   - Permify authorization (fallback: allow-all)
 *
 * All calls gracefully degrade if the gateway is unavailable.
 */

const GATEWAY_BASE = process.env.GATEWAY_URL ?? "http://localhost:8200";
const GATEWAY_TIMEOUT_MS = 5000;

async function gatewayFetch<T>(
  path: string,
  options: RequestInit = {}
): Promise<T | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), GATEWAY_TIMEOUT_MS);
    const res = await fetch(`${GATEWAY_BASE}${path}`, {
      ...options,
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        ...(options.headers ?? {}),
      },
    });
    clearTimeout(timer);
    if (!res.ok) {
      console.warn(`[Gateway] ${options.method ?? "GET"} ${path} → ${res.status}`);
      return null;
    }
    const json = (await res.json()) as { success: boolean; data: T };
    return json.data ?? null;
  } catch (err: unknown) {
    if ((err as Error)?.name === "AbortError") {
      console.warn(`[Gateway] Timeout on ${path}`);
    } else {
      console.warn(`[Gateway] Unavailable (${path}):`, (err as Error)?.message);
    }
    return null;
  }
}

// ─── Health ──────────────────────────────────────────────────────────────────

export interface GatewayHealth {
  status: string;
  version: string;
  uptime: string;
  middleware: {
    kafka: boolean;
    redis: boolean;
    temporal: boolean;
    tigerbeetle: boolean;
    dapr: boolean;
    fluvio: boolean;
  };
}

export async function getGatewayHealth(): Promise<GatewayHealth | null> {
  return gatewayFetch<GatewayHealth>("/api/v1/health");
}

// ─── TigerBeetle Ledger ───────────────────────────────────────────────────────

export interface LedgerAccount {
  id: string;
  userId: string;
  type: "margin" | "settlement" | "fee";
  currency: string;
  balance: number;
  pending: number;
}

export interface LedgerTransfer {
  id: string;
  debitAccountId: string;
  creditAccountId: string;
  amount: number;
  code: number;
  timestamp: number;
  status: "committed" | "pending" | "voided";
}

/** Create a TigerBeetle account for a new user (margin + settlement + fee) */
export async function createLedgerAccount(
  userId: string,
  accountType: "margin" | "settlement" | "fee",
  currency = "USD"
): Promise<LedgerAccount | null> {
  return gatewayFetch<LedgerAccount>("/api/v1/ledger/accounts", {
    method: "POST",
    body: JSON.stringify({ userId, accountType, currency }),
  });
}

/** Get all ledger accounts for a user */
export async function getUserLedgerAccounts(
  userId: string
): Promise<LedgerAccount[]> {
  const result = await gatewayFetch<LedgerAccount[]>(
    `/api/v1/ledger/accounts/${userId}`
  );
  return result ?? [];
}

/** Get account balance */
export async function getLedgerBalance(
  accountId: string
): Promise<number> {
  const result = await gatewayFetch<{ balance: number }>(
    `/api/v1/ledger/accounts/${accountId}/balance`
  );
  return result?.balance ?? 0;
}

/** Create a committed double-entry transfer (trade settlement) */
export async function createLedgerTransfer(params: {
  debitAccountId: string;
  creditAccountId: string;
  amount: number;
  /** 1=trade_settlement 2=margin_deposit 3=margin_release 4=fee 5=withdrawal 6=deposit */
  code: 1 | 2 | 3 | 4 | 5 | 6;
}): Promise<LedgerTransfer | null> {
  return gatewayFetch<LedgerTransfer>("/api/v1/ledger/transfers", {
    method: "POST",
    body: JSON.stringify(params),
  });
}

/** Create a two-phase pending transfer (pre-trade margin hold) */
export async function createPendingLedgerTransfer(params: {
  debitAccountId: string;
  creditAccountId: string;
  amount: number;
  code: 1 | 2 | 3 | 4 | 5 | 6;
}): Promise<LedgerTransfer | null> {
  return gatewayFetch<LedgerTransfer>("/api/v1/ledger/transfers/pending", {
    method: "POST",
    body: JSON.stringify(params),
  });
}

/** Commit a pending two-phase transfer */
export async function commitLedgerTransfer(
  transferId: string
): Promise<boolean> {
  const result = await gatewayFetch<{ committed: boolean }>(
    `/api/v1/ledger/transfers/${transferId}/commit`,
    { method: "POST" }
  );
  return result?.committed ?? false;
}

/** Void a pending two-phase transfer (cancel margin hold) */
export async function voidLedgerTransfer(
  transferId: string
): Promise<boolean> {
  const result = await gatewayFetch<{ voided: boolean }>(
    `/api/v1/ledger/transfers/${transferId}/void`,
    { method: "POST" }
  );
  return result?.voided ?? false;
}

/** Get transfer history for an account */
export async function getAccountTransfers(
  accountId: string,
  limit = 50
): Promise<LedgerTransfer[]> {
  const result = await gatewayFetch<LedgerTransfer[]>(
    `/api/v1/ledger/accounts/${accountId}/transfers?limit=${limit}`
  );
  return result ?? [];
}

// ─── Settlement (via Gateway → TigerBeetle) ──────────────────────────────────

export interface SettlementResult {
  tradeId: string;
  buyerTransferId: string;
  sellerTransferId: string;
  feeTransferId: string;
  amount: number;
  fee: number;
  status: "settled" | "failed";
}

/**
 * Settle a matched trade via the Go gateway.
 * Creates three TigerBeetle transfers:
 *   1. buyer margin → exchange clearing (amount)
 *   2. exchange clearing → seller settlement (amount - fee)
 *   3. buyer margin → exchange fee account (fee)
 */
export async function settleTrade(params: {
  tradeId: string;
  buyerUserId: string;
  sellerUserId: string;
  symbol: string;
  quantity: number;
  price: number;
  feeRate?: number;
}): Promise<SettlementResult | null> {
  return gatewayFetch<SettlementResult>("/api/v1/settlement/settle", {
    method: "POST",
    body: JSON.stringify(params),
  });
}

/** Get settlement status for a trade */
export async function getSettlementStatus(
  tradeId: string
): Promise<SettlementResult | null> {
  return gatewayFetch<SettlementResult>(`/api/v1/settlement/${tradeId}`);
}

// ─── Markets (proxied from Rust matching engine via gateway) ─────────────────

export interface GatewayTicker {
  symbol: string;
  lastPrice: number;
  bid: number;
  ask: number;
  volume24h: number;
  change24h: number;
  high24h: number;
  low24h: number;
}

export async function getGatewayTicker(
  symbol: string
): Promise<GatewayTicker | null> {
  return gatewayFetch<GatewayTicker>(`/api/v1/markets/${symbol}/ticker`);
}

export interface GatewayOrderBook {
  symbol: string;
  bids: Array<{ price: number; quantity: number; total: number }>;
  asks: Array<{ price: number; quantity: number; total: number }>;
  timestamp: number;
}

export async function getGatewayOrderBook(
  symbol: string
): Promise<GatewayOrderBook | null> {
  return gatewayFetch<GatewayOrderBook>(`/api/v1/markets/${symbol}/orderbook`);
}

// ─── Middleware Status ────────────────────────────────────────────────────────

export interface MiddlewareStatus {
  kafka: { connected: boolean; brokers: string };
  redis: { connected: boolean; url: string };
  temporal: { connected: boolean; host: string };
  tigerbeetle: { connected: boolean; addresses: string };
  dapr: { connected: boolean; httpPort: number };
  fluvio: { connected: boolean; endpoint: string };
  keycloak: { url: string; realm: string };
  permify: { connected: boolean; endpoint: string };
  apisix: { adminUrl: string };
}

export async function getMiddlewareStatus(): Promise<MiddlewareStatus | null> {
  return gatewayFetch<MiddlewareStatus>("/api/v1/middleware/status");
}
