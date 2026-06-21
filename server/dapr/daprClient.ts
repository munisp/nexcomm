/**
 * NEXCOM Exchange — Dapr Sidecar Client
 * ─────────────────────────────────────────────────────────────────────────────
 * Dapr provides a portable, event-driven runtime for building distributed
 * applications. This client wraps the Dapr HTTP API (sidecar on port 3500)
 * for three building blocks:
 *
 *   1. Pub/Sub  — publish fund-flow events to Dapr topics (backed by Kafka/Redis)
 *   2. State    — store/retrieve idempotency keys and workflow state
 *   3. Bindings — invoke external services (TigerBeetle, Mojaloop, Stripe) via bindings
 *
 * Falls back gracefully when the Dapr sidecar is unavailable.
 * All fund-flow mutations call daprPublish() AFTER the primary DB write so
 * the Dapr event is best-effort — Kafka handles the authoritative event log.
 *
 * Dapr component definitions live in:
 *   infra/dapr/components/pubsub.yaml       (Kafka-backed pub/sub)
 *   infra/dapr/components/statestore.yaml   (Redis-backed state)
 *   infra/dapr/components/bindings/         (TigerBeetle, Mojaloop, Stripe)
 */

const DAPR_HTTP_PORT = parseInt(process.env.DAPR_HTTP_PORT ?? "3500", 10);
const DAPR_BASE = `http://localhost:${DAPR_HTTP_PORT}`;
const DAPR_TIMEOUT_MS = 3000;

// ─── Pub/Sub topics (mirrors Kafka topics) ───────────────────────────────────

export const DAPR_PUBSUB_NAME = "nexcom-pubsub"; // component name in pubsub.yaml

export const DAPR_TOPICS = {
  DEPOSIT_INITIATED:      "nexcom.deposit.initiated",
  DEPOSIT_COMPLETED:      "nexcom.deposit.completed",
  DEPOSIT_FAILED:         "nexcom.deposit.failed",
  WITHDRAWAL_INITIATED:   "nexcom.withdrawal.initiated",
  WITHDRAWAL_COMPLETED:   "nexcom.withdrawal.completed",
  WITHDRAWAL_FAILED:      "nexcom.withdrawal.failed",
  ORDER_PLACED:           "nexcom.order.placed",
  ORDER_FILLED:           "nexcom.order.filled",
  ORDER_CANCELLED:        "nexcom.order.cancelled",
  TRADE_SETTLED:          "nexcom.trade.settled",
  MARGIN_DEPOSITED:       "nexcom.margin.deposited",
  MARGIN_RELEASED:        "nexcom.margin.released",
  MARGIN_CALL:            "nexcom.margin.call",
  MARGIN_LIQUIDATED:      "nexcom.margin.liquidated",
  LOAN_DISBURSED:         "nexcom.loan.disbursed",
  LOAN_REPAID:            "nexcom.loan.repaid",
  DIVIDEND_PAID:          "nexcom.dividend.paid",
  COUPON_PAID:            "nexcom.coupon.paid",
  CROSS_BORDER_INITIATED: "nexcom.crossborder.initiated",
  CROSS_BORDER_COMMITTED: "nexcom.crossborder.committed",
  AML_FREEZE:             "nexcom.aml.freeze",
  AML_UNFREEZE:           "nexcom.aml.unfreeze",
  REFUND_ISSUED:          "nexcom.refund.issued",
  STRIPE_TOPUP:           "nexcom.stripe.topup",
  SYSTEM_REBALANCE:       "nexcom.system.rebalance",
} as const;

export type DaprTopic = (typeof DAPR_TOPICS)[keyof typeof DAPR_TOPICS];

// ─── State store ─────────────────────────────────────────────────────────────

export const DAPR_STATE_STORE = "nexcom-statestore"; // component name in statestore.yaml

// ─── Health check ─────────────────────────────────────────────────────────────

export async function getDaprHealth(): Promise<boolean> {
  try {
    const resp = await fetch(`${DAPR_BASE}/v1.0/healthz`, {
      signal: AbortSignal.timeout(DAPR_TIMEOUT_MS),
    });
    return resp.ok;
  } catch {
    return false;
  }
}

// ─── Pub/Sub: publish an event ────────────────────────────────────────────────

/**
 * Publish a fund-flow event to a Dapr pub/sub topic.
 * The Dapr sidecar routes the event to the configured broker (Kafka/Redis Streams).
 * Falls back silently — Kafka handles the authoritative event log.
 */
export async function daprPublish(
  topic: DaprTopic,
  data: unknown,
  metadata?: Record<string, string>
): Promise<boolean> {
  try {
    const resp = await fetch(
      `${DAPR_BASE}/v1.0/publish/${DAPR_PUBSUB_NAME}/${encodeURIComponent(topic)}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(metadata
            ? Object.fromEntries(
                Object.entries(metadata).map(([k, v]) => [`metadata.${k}`, v])
              )
            : {}),
        },
        body: JSON.stringify(data),
        signal: AbortSignal.timeout(DAPR_TIMEOUT_MS),
      }
    );
    return resp.ok || resp.status === 204;
  } catch {
    return false;
  }
}

// ─── State: idempotency key management ───────────────────────────────────────

/**
 * Save an idempotency key to prevent duplicate fund-flow mutations.
 * Returns false if the key already exists (duplicate request detected).
 */
export async function saveIdempotencyKey(
  key: string,
  value: unknown,
  ttlSeconds = 86400
): Promise<boolean> {
  try {
    const resp = await fetch(`${DAPR_BASE}/v1.0/state/${DAPR_STATE_STORE}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify([
        {
          key,
          value,
          options: { concurrency: "first-write", consistency: "strong" },
          metadata: { ttlInSeconds: String(ttlSeconds) },
        },
      ]),
      signal: AbortSignal.timeout(DAPR_TIMEOUT_MS),
    });
    return resp.ok;
  } catch {
    return false;
  }
}

/**
 * Retrieve a state value by key.
 */
export async function getStateValue<T>(key: string): Promise<T | null> {
  try {
    const resp = await fetch(
      `${DAPR_BASE}/v1.0/state/${DAPR_STATE_STORE}/${encodeURIComponent(key)}`,
      { signal: AbortSignal.timeout(DAPR_TIMEOUT_MS) }
    );
    if (resp.status === 204 || resp.status === 404) return null;
    if (!resp.ok) return null;
    return (await resp.json()) as T;
  } catch {
    return null;
  }
}

/**
 * Delete a state key (e.g., after successful processing).
 */
export async function deleteStateKey(key: string): Promise<boolean> {
  try {
    const resp = await fetch(
      `${DAPR_BASE}/v1.0/state/${DAPR_STATE_STORE}/${encodeURIComponent(key)}`,
      { method: "DELETE", signal: AbortSignal.timeout(DAPR_TIMEOUT_MS) }
    );
    return resp.ok;
  } catch {
    return false;
  }
}

// ─── Bindings: invoke external services ──────────────────────────────────────

/**
 * Invoke a Dapr output binding (TigerBeetle, Mojaloop, Stripe, etc.)
 * Binding definitions live in infra/dapr/components/bindings/.
 */
export async function daprInvokeBinding<T = unknown>(
  bindingName: string,
  operation: string,
  data: unknown,
  metadata?: Record<string, string>
): Promise<T | null> {
  try {
    const resp = await fetch(`${DAPR_BASE}/v1.0/bindings/${bindingName}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ operation, data, metadata }),
      signal: AbortSignal.timeout(DAPR_TIMEOUT_MS),
    });
    if (!resp.ok) return null;
    const text = await resp.text();
    return text ? (JSON.parse(text) as T) : null;
  } catch {
    return null;
  }
}

// ─── Service invocation: call another Dapr-enabled microservice ──────────────

/**
 * Invoke a method on another Dapr-enabled service (e.g., Go gateway, Python risk engine).
 */
export async function daprInvokeService<T = unknown>(
  appId: string,
  method: string,
  data?: unknown,
  httpMethod: "GET" | "POST" | "PUT" | "DELETE" = "POST"
): Promise<T | null> {
  try {
    const resp = await fetch(
      `${DAPR_BASE}/v1.0/invoke/${appId}/method/${method}`,
      {
        method: httpMethod,
        headers: data ? { "Content-Type": "application/json" } : {},
        body: data ? JSON.stringify(data) : undefined,
        signal: AbortSignal.timeout(DAPR_TIMEOUT_MS),
      }
    );
    if (!resp.ok) return null;
    return (await resp.json()) as T;
  } catch {
    return null;
  }
}

// ─── Domain-specific Dapr event publishers ───────────────────────────────────

export async function daprPublishDeposit(event: {
  depositId: string;
  userId: number;
  amount: number;
  currency: string;
  status: "initiated" | "completed" | "failed";
  ledgerTxId?: string;
}): Promise<void> {
  const topic =
    event.status === "completed"
      ? DAPR_TOPICS.DEPOSIT_COMPLETED
      : event.status === "failed"
      ? DAPR_TOPICS.DEPOSIT_FAILED
      : DAPR_TOPICS.DEPOSIT_INITIATED;
  await daprPublish(topic, { ...event, timestamp: new Date().toISOString() });
}

export async function daprPublishWithdrawal(event: {
  withdrawalId: string;
  userId: number;
  amount: number;
  currency: string;
  status: "initiated" | "completed" | "failed";
  ledgerTxId?: string;
}): Promise<void> {
  const topic =
    event.status === "completed"
      ? DAPR_TOPICS.WITHDRAWAL_COMPLETED
      : event.status === "failed"
      ? DAPR_TOPICS.WITHDRAWAL_FAILED
      : DAPR_TOPICS.WITHDRAWAL_INITIATED;
  await daprPublish(topic, { ...event, timestamp: new Date().toISOString() });
}

export async function daprPublishOrderFilled(event: {
  orderId: number;
  userId: number;
  symbol: string;
  side: string;
  filledQty: string;
  fillPrice: string;
  grossValue: string;
}): Promise<void> {
  await daprPublish(DAPR_TOPICS.ORDER_FILLED, {
    ...event,
    timestamp: new Date().toISOString(),
  });
}

export async function daprPublishTradeSettled(event: {
  settlementId: string;
  buyerUserId: number;
  sellerUserId: number;
  symbol: string;
  amount: number;
  currency: string;
  tigerBeetleTransferId?: string;
}): Promise<void> {
  await daprPublish(DAPR_TOPICS.TRADE_SETTLED, {
    ...event,
    timestamp: new Date().toISOString(),
  });
}

export async function daprPublishMarginCall(event: {
  userId: number;
  utilisationPct: number;
  marginBalance: number;
  requiredMargin: number;
  currency: string;
}): Promise<void> {
  await daprPublish(DAPR_TOPICS.MARGIN_CALL, {
    ...event,
    timestamp: new Date().toISOString(),
  });
}

export async function daprPublishLoanDisbursed(event: {
  loanId: string;
  userId: number;
  amount: number;
  currency: string;
  interestRate: number;
  dueDate: string;
}): Promise<void> {
  await daprPublish(DAPR_TOPICS.LOAN_DISBURSED, {
    ...event,
    timestamp: new Date().toISOString(),
  });
}

export async function daprPublishAmlFreeze(event: {
  userId: number;
  reason: string;
  alertId: string;
  frozen: boolean;
}): Promise<void> {
  const topic = event.frozen ? DAPR_TOPICS.AML_FREEZE : DAPR_TOPICS.AML_UNFREEZE;
  await daprPublish(topic, { ...event, timestamp: new Date().toISOString() });
}
