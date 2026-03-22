/**
 * NEXCOM Rust Matching Engine — REST Client
 * ─────────────────────────────────────────────────────────────────────────────
 * Provides a typed HTTP client for the production Rust matching engine binary
 * (nexcom-matching-engine, compiled from Rust/Axum, port 8080 by default).
 *
 * The Rust engine exposes a REST API at /api/v1/* with JSON payloads.
 * This module wraps every endpoint used by the tRPC procedures so the rest of
 * the server code never needs to know about HTTP details.
 *
 * Environment variables:
 *   MATCHING_ENGINE_URL  — base URL of the Rust engine (default: http://localhost:8080)
 *   SETTLEMENT_ENGINE_URL — base URL of the Rust settlement engine (default: http://localhost:8005)
 */

const ME_BASE = process.env.MATCHING_ENGINE_URL ?? "http://localhost:8080";
const SE_BASE = process.env.SETTLEMENT_ENGINE_URL ?? "http://localhost:8005";

// ─── Generic fetch helper ─────────────────────────────────────────────────────

async function meGet<T>(path: string): Promise<T> {
  const res = await fetch(`${ME_BASE}${path}`, {
    headers: { "Accept": "application/json" },
  });
  const json = await res.json() as { success: boolean; data: T; error: string | null };
  if (!json.success) throw new Error(json.error ?? "Matching engine error");
  return json.data as T;
}

async function mePost<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${ME_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Accept": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json() as { success: boolean; data: T; error: string | null };
  if (!json.success) throw new Error(json.error ?? "Matching engine error");
  return json.data as T;
}

async function meDelete<T>(path: string): Promise<T> {
  const res = await fetch(`${ME_BASE}${path}`, {
    method: "DELETE",
    headers: { "Accept": "application/json" },
  });
  const json = await res.json() as { success: boolean; data: T; error: string | null };
  if (!json.success) throw new Error(json.error ?? "Matching engine error");
  return json.data as T;
}

async function mePut<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${ME_BASE}${path}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", "Accept": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json() as { success: boolean; data: T; error: string | null };
  if (!json.success) throw new Error(json.error ?? "Matching engine error");
  return json.data as T;
}

async function sePost<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${SE_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Accept": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json() as T;
  return json;
}

async function seGet<T>(path: string): Promise<T> {
  const res = await fetch(`${SE_BASE}${path}`, {
    headers: { "Accept": "application/json" },
  });
  const json = await res.json() as T;
  return json;
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface RustOrderResult {
  order: {
    id: string;
    status: string;
    filled_quantity: number;
    remaining_quantity: number;
    average_price: number;
  };
  trades: RustTrade[];
}

export interface RustTrade {
  id: string;
  price: number;
  quantity: number;
  buyer: string;
  seller: string;
  timestamp: string;
}

export interface RustMarketDepth {
  symbol: string;
  bids: Array<{ price: number; quantity: number; order_count: number }>;
  asks: Array<{ price: number; quantity: number; order_count: number }>;
  last_price: number;
  last_quantity: number;
  volume_24h: number;
  high_24h: number;
  low_24h: number;
  open_price: number;
  settlement_price: number;
  open_interest: number;
  timestamp: string;
}

export interface RustSurveillanceAlert {
  id: string;
  alert_type: string;
  severity: string;
  symbol: string;
  account_id: string;
  description: string;
  timestamp: string;
  resolved: boolean;
}

export interface RustFuturesContract {
  symbol: string;
  underlying: string;
  contract_type: string;
  contract_size: number;
  tick_size: number;
  initial_margin: number;
  maintenance_margin: number;
  expiry_date: string;
  first_notice_date: string;
}

export interface RustClearingPosition {
  account_id: string;
  symbol: string;
  net_position: number;
  long_position: number;
  short_position: number;
  average_cost: number;
  unrealized_pnl: number;
  realized_pnl: number;
}

export interface RustClearingMargin {
  account_id: string;
  initial_margin_required: number;
  maintenance_margin_required: number;
  margin_balance: number;
  available_margin: number;
  margin_call: boolean;
}

export interface RustIndex {
  id: string;
  name: string;
  description: string;
  components: Array<{ symbol: string; weight: number }>;
}

export interface RustIndexValue {
  index_id: string;
  value: number;
  change: number;
  change_pct: number;
  timestamp: string;
}

export interface RustCorporateAction {
  id: string;
  action_type: string;
  symbol: string;
  description: string;
  ex_date: string;
  record_date: string;
  payment_date: string;
  status: string;
}

export interface RustBroker {
  id: string;
  name: string;
  license_number: string;
  contact_email: string;
  contact_phone: string;
  status: string;
  specializations: string[];
}

export interface RustWarehouse {
  id: string;
  name: string;
  location: string;
  commodity: string;
  capacity: number;
  available_capacity: number;
  grade_standards: string[];
  status: string;
}

export interface RustWarehouseReceipt {
  id: string;
  account_id: string;
  commodity: string;
  quantity: number;
  grade: string;
  warehouse_id: string;
  issue_date: string;
  expiry_date: string;
  status: string;
}

export interface RustFeeCalculation {
  trade_value: number;
  transaction_fee: number;
  clearing_fee: number;
  exchange_fee: number;
  total_fee: number;
  fee_breakdown: Record<string, number>;
}

export interface RustSettlementResponse {
  settlement_id: string;
  status: string;
  trade_id: string;
  buyer_id: string;
  seller_id: string;
  amount: string;
  currency: string;
  settlement_date: string;
}

export interface RustLedgerBalance {
  account_id: string;
  available: string;
  pending: string;
  total: string;
  currency: string;
}

// ─── Health check ─────────────────────────────────────────────────────────────

export async function checkMatchingEngineHealth(): Promise<boolean> {
  try {
    const res = await fetch(`${ME_BASE}/health`, { signal: AbortSignal.timeout(2000) });
    return res.ok;
  } catch {
    return false;
  }
}

export async function checkSettlementEngineHealth(): Promise<boolean> {
  try {
    const res = await fetch(`${SE_BASE}/healthz`, { signal: AbortSignal.timeout(2000) });
    return res.ok;
  } catch {
    return false;
  }
}

// ─── Orders ───────────────────────────────────────────────────────────────────

export interface SubmitOrderParams {
  client_order_id: string;
  account_id: string;
  symbol: string;
  side: "BUY" | "SELL";
  order_type: "LIMIT" | "MARKET" | "STOP" | "STOPLIMIT" | "IOC" | "FOK" | "GTC" | "GTD";
  time_in_force?: "GTC" | "IOC" | "FOK" | "DAY" | "GTD";
  price?: number;
  stop_price?: number;
  quantity: number;
}

export async function submitOrder(params: SubmitOrderParams): Promise<RustOrderResult> {
  return mePost<RustOrderResult>("/api/v1/orders", {
    client_order_id: params.client_order_id,
    account_id: params.account_id,
    symbol: params.symbol,
    side: params.side,
    order_type: params.order_type,
    time_in_force: params.time_in_force ?? "GTC",
    price: params.price,
    stop_price: params.stop_price,
    quantity: params.quantity,
  });
}

export async function cancelOrder(symbol: string, orderId: string): Promise<{ order_id: string; status: string }> {
  return meDelete<{ order_id: string; status: string }>(`/api/v1/orders/${encodeURIComponent(symbol)}/${encodeURIComponent(orderId)}`);
}

export async function amendOrder(
  symbol: string,
  orderId: string,
  params: { new_price?: number; new_quantity?: number }
): Promise<{ order_id: string; status: string }> {
  return mePut<{ order_id: string; status: string }>(
    `/api/v1/orders/${encodeURIComponent(symbol)}/${encodeURIComponent(orderId)}/amend`,
    params
  );
}

// ─── Market Data ──────────────────────────────────────────────────────────────

export async function getMarketDepth(symbol: string): Promise<RustMarketDepth> {
  return meGet<RustMarketDepth>(`/api/v1/depth/${encodeURIComponent(symbol)}`);
}

export async function listSymbols(): Promise<string[]> {
  return meGet<string[]>("/api/v1/symbols");
}

export async function getExchangeStatus(): Promise<Record<string, unknown>> {
  return meGet<Record<string, unknown>>("/api/v1/status");
}

// ─── Futures ──────────────────────────────────────────────────────────────────

export async function listFuturesContracts(): Promise<RustFuturesContract[]> {
  return meGet<RustFuturesContract[]>("/api/v1/futures/contracts");
}

export async function getFuturesContract(symbol: string): Promise<RustFuturesContract> {
  return meGet<RustFuturesContract>(`/api/v1/futures/contracts/${encodeURIComponent(symbol)}`);
}

export async function listFuturesSpecs(): Promise<unknown[]> {
  return meGet<unknown[]>("/api/v1/futures/specs");
}

// ─── Options ──────────────────────────────────────────────────────────────────

export async function listOptionsContracts(): Promise<unknown[]> {
  return meGet<unknown[]>("/api/v1/options/contracts");
}

export async function getOptionChain(underlying: string): Promise<unknown[]> {
  return meGet<unknown[]>(`/api/v1/options/chain/${encodeURIComponent(underlying)}`);
}

export async function priceOption(params: {
  underlying_price: number;
  strike: number;
  time_to_expiry: number;
  risk_free_rate: number;
  volatility: number;
  option_type: "CALL" | "PUT";
}): Promise<unknown> {
  const qs = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)]));
  return meGet<unknown>(`/api/v1/options/price?${qs}`);
}

// ─── Clearing ─────────────────────────────────────────────────────────────────

export async function getClearingMargins(accountId: string): Promise<RustClearingMargin> {
  return meGet<RustClearingMargin>(`/api/v1/clearing/margins/${encodeURIComponent(accountId)}`);
}

export async function getClearingPositions(accountId: string): Promise<RustClearingPosition[]> {
  return meGet<RustClearingPosition[]>(`/api/v1/clearing/positions/${encodeURIComponent(accountId)}`);
}

export async function getGuaranteeFund(): Promise<unknown> {
  return meGet<unknown>("/api/v1/clearing/guarantee-fund");
}

// ─── Surveillance ─────────────────────────────────────────────────────────────

export async function getSurveillanceAlerts(): Promise<RustSurveillanceAlert[]> {
  return meGet<RustSurveillanceAlert[]>("/api/v1/surveillance/alerts");
}

export async function checkPositionLimit(accountId: string, symbol: string): Promise<unknown> {
  return meGet<unknown>(`/api/v1/surveillance/position-limits/${encodeURIComponent(accountId)}/${encodeURIComponent(symbol)}`);
}

export async function getDailySurveillanceReport(): Promise<unknown> {
  return meGet<unknown>("/api/v1/surveillance/reports/daily");
}

// ─── Delivery / Warehouses ────────────────────────────────────────────────────

export async function listWarehouses(): Promise<RustWarehouse[]> {
  return meGet<RustWarehouse[]>("/api/v1/delivery/warehouses");
}

export async function getWarehousesForCommodity(commodity: string): Promise<RustWarehouse[]> {
  return meGet<RustWarehouse[]>(`/api/v1/delivery/warehouses/${encodeURIComponent(commodity)}`);
}

export async function getAccountReceipts(accountId: string): Promise<RustWarehouseReceipt[]> {
  return meGet<RustWarehouseReceipt[]>(`/api/v1/delivery/receipts/${encodeURIComponent(accountId)}`);
}

export async function issueWarehouseReceipt(params: {
  account_id: string;
  commodity: string;
  quantity: number;
  grade: string;
  warehouse_id: string;
}): Promise<RustWarehouseReceipt> {
  return mePost<RustWarehouseReceipt>("/api/v1/delivery/receipts", params);
}

export async function listWarehouseStocks(): Promise<unknown[]> {
  return meGet<unknown[]>("/api/v1/delivery/stocks");
}

export async function getCommodityGrades(commodity: string): Promise<unknown[]> {
  return meGet<unknown[]>(`/api/v1/delivery/grades/${encodeURIComponent(commodity)}`);
}

// ─── Audit ────────────────────────────────────────────────────────────────────

export async function getAuditEntries(params?: { limit?: number; offset?: number }): Promise<unknown[]> {
  const qs = params ? `?${new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)]))}` : "";
  return meGet<unknown[]>(`/api/v1/audit/entries${qs}`);
}

export async function checkAuditIntegrity(): Promise<unknown> {
  return meGet<unknown>("/api/v1/audit/integrity");
}

// ─── Market Makers ────────────────────────────────────────────────────────────

export async function listMarketMakers(): Promise<unknown[]> {
  return meGet<unknown[]>("/api/v1/market-makers");
}

export async function getMarketMaker(id: string): Promise<unknown> {
  return meGet<unknown>(`/api/v1/market-makers/${encodeURIComponent(id)}`);
}

export async function getMarketMakerPerformance(id: string): Promise<unknown> {
  return meGet<unknown>(`/api/v1/market-makers/${encodeURIComponent(id)}/performance`);
}

export async function submitMarketMakerQuote(params: {
  market_maker_id: string;
  symbol: string;
  bid_price: number;
  ask_price: number;
  bid_size: number;
  ask_size: number;
}): Promise<unknown> {
  return mePost<unknown>("/api/v1/market-makers/quotes", params);
}

// ─── Indices ──────────────────────────────────────────────────────────────────

export async function listIndices(): Promise<RustIndex[]> {
  return meGet<RustIndex[]>("/api/v1/indices");
}

export async function getIndexValues(): Promise<RustIndexValue[]> {
  return meGet<RustIndexValue[]>("/api/v1/indices/values");
}

export async function getIndex(id: string): Promise<RustIndex> {
  return meGet<RustIndex>(`/api/v1/indices/${encodeURIComponent(id)}`);
}

export async function getIndexValue(id: string): Promise<RustIndexValue> {
  return meGet<RustIndexValue>(`/api/v1/indices/${encodeURIComponent(id)}/value`);
}

// ─── Corporate Actions ────────────────────────────────────────────────────────

export async function listCorporateActions(): Promise<RustCorporateAction[]> {
  return meGet<RustCorporateAction[]>("/api/v1/corporate-actions");
}

export async function getCorporateAction(id: string): Promise<RustCorporateAction> {
  return meGet<RustCorporateAction>(`/api/v1/corporate-actions/${encodeURIComponent(id)}`);
}

// ─── Brokers ──────────────────────────────────────────────────────────────────

export async function listBrokers(): Promise<RustBroker[]> {
  return meGet<RustBroker[]>("/api/v1/brokers");
}

export async function getBroker(id: string): Promise<RustBroker> {
  return meGet<RustBroker>(`/api/v1/brokers/${encodeURIComponent(id)}`);
}

// ─── Fees ─────────────────────────────────────────────────────────────────────

export async function calculateTradeFees(params: {
  trade_value: number;
  asset_class: string;
  is_maker: boolean;
}): Promise<RustFeeCalculation> {
  return mePost<RustFeeCalculation>("/api/v1/fees/calculate", params);
}

// ─── FIX Gateway ─────────────────────────────────────────────────────────────

export async function getFixSessions(): Promise<unknown[]> {
  return meGet<unknown[]>("/api/v1/fix/sessions");
}

export async function sendFixMessage(params: {
  session_id: string;
  message_type: string;
  fields: Record<string, string>;
}): Promise<unknown> {
  return mePost<unknown>("/api/v1/fix/message", params);
}

// ─── Circuit Breaker ──────────────────────────────────────────────────────────

export async function getCircuitBreakerStatus(symbol?: string): Promise<unknown> {
  const path = symbol
    ? `/api/v1/circuit-breaker/status/${encodeURIComponent(symbol)}`
    : "/api/v1/circuit-breaker/status";
  return meGet<unknown>(path);
}

// ─── Auction ──────────────────────────────────────────────────────────────────

export async function startAuction(params: {
  symbol: string;
  auction_type: "OPENING" | "CLOSING" | "INTRADAY";
  duration_secs: number;
}): Promise<unknown> {
  return mePost<unknown>("/api/v1/auction/start", params);
}

// ─── Settlement Engine (Rust/TigerBeetle) ────────────────────────────────────

export async function initiateSettlement(params: {
  trade_id: string;
  buyer_id: string;
  seller_id: string;
  amount: string;
  currency: string;
  asset_type: string;
  quantity: string;
  price: string;
}): Promise<RustSettlementResponse> {
  return sePost<RustSettlementResponse>("/api/v1/settlement/initiate", params);
}

export async function getSettlement(id: string): Promise<RustSettlementResponse> {
  return seGet<RustSettlementResponse>(`/api/v1/settlement/${encodeURIComponent(id)}`);
}

export async function getSettlementStatus(id: string): Promise<{ status: string }> {
  return seGet<{ status: string }>(`/api/v1/settlement/${encodeURIComponent(id)}/status`);
}

export async function finalizeSettlement(params: {
  settlement_id: string;
}): Promise<RustSettlementResponse> {
  return sePost<RustSettlementResponse>("/api/v1/settlement/finalize", params);
}

export async function confirmSettlement(params: {
  settlement_id: string;
  confirmation_code: string;
}): Promise<RustSettlementResponse> {
  return sePost<RustSettlementResponse>("/api/v1/settlement/confirm", params);
}

// ─── Ledger (TigerBeetle) ─────────────────────────────────────────────────────

export async function getLedgerBalance(accountId: string): Promise<RustLedgerBalance> {
  return seGet<RustLedgerBalance>(`/api/v1/ledger/balance/${encodeURIComponent(accountId)}`);
}

export async function getLedgerAccounts(userId: string): Promise<unknown[]> {
  return seGet<unknown[]>(`/api/v1/ledger/accounts/${encodeURIComponent(userId)}`);
}

export async function createLedgerAccount(params: {
  user_id: string;
  currency: string;
  account_type: "Trading" | "Settlement" | "Margin" | "Fee" | "Escrow";
}): Promise<unknown> {
  return sePost<unknown>("/api/v1/ledger/accounts", params);
}

export async function createLedgerTransfer(params: {
  debit_account_id: string;
  credit_account_id: string;
  amount: number;
  currency: string;
  reference: string;
}): Promise<unknown> {
  return sePost<unknown>("/api/v1/ledger/transfers", params);
}
