/**
 * NEXCOM Exchange — Fluvio Streaming Client (P3-A)
 *
 * Fluvio is a high-performance, cloud-native streaming platform used for:
 *  - Real-time market data distribution (order book updates, price ticks)
 *  - Order lifecycle event streaming (PLACED → MATCHED → FILLED → SETTLED)
 *  - KYC status change events for downstream compliance systems
 *  - AML alert streaming to the OpenSearch indexer
 *  - Audit log streaming to the Lakehouse (Iceberg tables)
 *
 * Topics mirror the Kafka topics but use Fluvio's lower-latency SmartModules
 * for in-stream filtering and transformation before delivery.
 *
 * Falls back gracefully when Fluvio is unavailable (Kafka handles durability).
 */

const FLUVIO_BASE = process.env.FLUVIO_ENDPOINT ?? "http://localhost:9003";
const FLUVIO_API_KEY = process.env.FLUVIO_API_KEY ?? "";

// ─────────────────────────────────────────────────────────────────────────────
// Topic definitions — mirrors Kafka topics
// ─────────────────────────────────────────────────────────────────────────────

export const FLUVIO_TOPICS = {
  // Market data
  MARKET_PRICE_TICK: "nexcom.market.price-tick",
  ORDER_BOOK_UPDATE: "nexcom.market.order-book",
  TRADE_FILL: "nexcom.market.trade-fill",

  // Order lifecycle
  ORDER_PLACED: "nexcom.orders.placed",
  ORDER_MATCHED: "nexcom.orders.matched",
  ORDER_CANCELLED: "nexcom.orders.cancelled",
  ORDER_AMENDED: "nexcom.orders.amended",

  // KYC / compliance
  KYC_STATUS_CHANGED: "nexcom.kyc.status-changed",
  AML_ALERT_RAISED: "nexcom.aml.alert-raised",
  AML_ALERT_RESOLVED: "nexcom.aml.alert-resolved",

  // Settlement
  SETTLEMENT_INITIATED: "nexcom.settlement.initiated",
  SETTLEMENT_COMPLETED: "nexcom.settlement.completed",
  SETTLEMENT_FAILED: "nexcom.settlement.failed",

  // Banking
  LOAN_DISBURSED: "nexcom.banking.loan-disbursed",
  PAYMENT_RECEIVED: "nexcom.banking.payment-received",

  // Audit
  AUDIT_LOG: "nexcom.audit.log",
} as const;

export type FluvioTopic = (typeof FLUVIO_TOPICS)[keyof typeof FLUVIO_TOPICS];

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface FluvioRecord {
  key?: string;
  value: unknown;
  timestamp?: number;
}

export interface FluvioProduceResult {
  topic: string;
  partition: number;
  offset: number;
}

export interface FluvioTopicInfo {
  name: string;
  partitions: number;
  replicationFactor: number;
  retentionMs: number;
  createdAt: string;
}

export interface FluvioHealthStatus {
  available: boolean;
  version?: string;
  topicCount?: number;
  error?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Health check
// ─────────────────────────────────────────────────────────────────────────────

export async function getFluvioHealth(): Promise<FluvioHealthStatus> {
  try {
    const resp = await fetch(`${FLUVIO_BASE}/api/v1/health`, {
      headers: FLUVIO_API_KEY ? { Authorization: `Bearer ${FLUVIO_API_KEY}` } : {},
      signal: AbortSignal.timeout(3000),
    });

    if (!resp.ok) return { available: false, error: `HTTP ${resp.status}` };

    const data = await resp.json() as { version?: string; topics?: number };
    return {
      available: true,
      version: data.version,
      topicCount: data.topics,
    };
  } catch (err) {
    return {
      available: false,
      error: err instanceof Error ? err.message : "Connection refused",
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Topic management
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Ensure all NEXCOM topics exist in Fluvio.
 * Called at server startup — idempotent.
 */
export async function ensureTopicsExist(): Promise<{
  created: string[];
  existing: string[];
  failed: string[];
}> {
  const created: string[] = [];
  const existing: string[] = [];
  const failed: string[] = [];

  const topicConfigs: Record<FluvioTopic, { partitions: number; retentionMs: number }> = {
    [FLUVIO_TOPICS.MARKET_PRICE_TICK]: { partitions: 8, retentionMs: 3_600_000 },       // 1h
    [FLUVIO_TOPICS.ORDER_BOOK_UPDATE]: { partitions: 8, retentionMs: 3_600_000 },
    [FLUVIO_TOPICS.TRADE_FILL]: { partitions: 4, retentionMs: 86_400_000 },              // 24h
    [FLUVIO_TOPICS.ORDER_PLACED]: { partitions: 4, retentionMs: 604_800_000 },           // 7d
    [FLUVIO_TOPICS.ORDER_MATCHED]: { partitions: 4, retentionMs: 604_800_000 },
    [FLUVIO_TOPICS.ORDER_CANCELLED]: { partitions: 4, retentionMs: 604_800_000 },
    [FLUVIO_TOPICS.ORDER_AMENDED]: { partitions: 4, retentionMs: 604_800_000 },
    [FLUVIO_TOPICS.KYC_STATUS_CHANGED]: { partitions: 2, retentionMs: 2_592_000_000 },  // 30d
    [FLUVIO_TOPICS.AML_ALERT_RAISED]: { partitions: 2, retentionMs: 2_592_000_000 },
    [FLUVIO_TOPICS.AML_ALERT_RESOLVED]: { partitions: 2, retentionMs: 2_592_000_000 },
    [FLUVIO_TOPICS.SETTLEMENT_INITIATED]: { partitions: 4, retentionMs: 604_800_000 },
    [FLUVIO_TOPICS.SETTLEMENT_COMPLETED]: { partitions: 4, retentionMs: 604_800_000 },
    [FLUVIO_TOPICS.SETTLEMENT_FAILED]: { partitions: 4, retentionMs: 604_800_000 },
    [FLUVIO_TOPICS.LOAN_DISBURSED]: { partitions: 2, retentionMs: 2_592_000_000 },
    [FLUVIO_TOPICS.PAYMENT_RECEIVED]: { partitions: 2, retentionMs: 2_592_000_000 },
    [FLUVIO_TOPICS.AUDIT_LOG]: { partitions: 4, retentionMs: 31_536_000_000 },          // 365d
  };

  for (const [topic, config] of Object.entries(topicConfigs)) {
    try {
      const checkResp = await fetch(`${FLUVIO_BASE}/api/v1/topics/${encodeURIComponent(topic)}`, {
        headers: FLUVIO_API_KEY ? { Authorization: `Bearer ${FLUVIO_API_KEY}` } : {},
        signal: AbortSignal.timeout(3000),
      });

      if (checkResp.ok) {
        existing.push(topic);
        continue;
      }

      if (checkResp.status === 404) {
        const createResp = await fetch(`${FLUVIO_BASE}/api/v1/topics`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(FLUVIO_API_KEY ? { Authorization: `Bearer ${FLUVIO_API_KEY}` } : {}),
          },
          body: JSON.stringify({
            name: topic,
            partitions: config.partitions,
            replicationFactor: 1,
            retentionMs: config.retentionMs,
          }),
          signal: AbortSignal.timeout(5000),
        });

        if (createResp.ok) {
          created.push(topic);
        } else {
          failed.push(topic);
        }
      }
    } catch {
      failed.push(topic);
    }
  }

  return { created, existing, failed };
}

// ─────────────────────────────────────────────────────────────────────────────
// Producer
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Produce a single record to a Fluvio topic.
 * Falls back silently if Fluvio is unavailable (Kafka handles durability).
 */
export async function produce(
  topic: FluvioTopic,
  record: FluvioRecord
): Promise<FluvioProduceResult | null> {
  try {
    const resp = await fetch(`${FLUVIO_BASE}/api/v1/topics/${encodeURIComponent(topic)}/produce`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(FLUVIO_API_KEY ? { Authorization: `Bearer ${FLUVIO_API_KEY}` } : {}),
      },
      body: JSON.stringify({
        key: record.key,
        value: JSON.stringify(record.value),
        timestamp: record.timestamp ?? Date.now(),
      }),
      signal: AbortSignal.timeout(3000),
    });

    if (!resp.ok) return null;
    return await resp.json() as FluvioProduceResult;
  } catch {
    // Fluvio unavailable — Kafka consumer will handle durability
    return null;
  }
}

/**
 * Produce a batch of records to a Fluvio topic.
 */
export async function produceBatch(
  topic: FluvioTopic,
  records: FluvioRecord[]
): Promise<{ sent: number; failed: number }> {
  let sent = 0;
  let failed = 0;

  for (const record of records) {
    const result = await produce(topic, record);
    if (result) sent++;
    else failed++;
  }

  return { sent, failed };
}

// ─────────────────────────────────────────────────────────────────────────────
// Domain-specific event publishers
// ─────────────────────────────────────────────────────────────────────────────

export async function publishTradeFill(fill: {
  fillId: number;
  symbol: string;
  assetClass: string;
  buyerUserId: number;
  sellerUserId: number;
  filledQty: string;
  fillPrice: string;
  grossValue: string;
  createdAt: Date;
}): Promise<void> {
  await produce(FLUVIO_TOPICS.TRADE_FILL, {
    key: `${fill.symbol}-${fill.fillId}`,
    value: { ...fill, createdAt: fill.createdAt.toISOString() },
  });
}

export async function publishKycStatusChange(event: {
  userId: number;
  profileType: "FARMER" | "BROKER" | "TRADER";
  profileId: number;
  previousStatus: string;
  newStatus: string;
  reviewedBy?: number;
  notes?: string;
}): Promise<void> {
  await produce(FLUVIO_TOPICS.KYC_STATUS_CHANGED, {
    key: `${event.profileType}-${event.profileId}`,
    value: { ...event, timestamp: new Date().toISOString() },
  });
}

export async function publishAmlAlert(alert: {
  alertId: number;
  userId: number;
  riskLevel: string;
  alertType: string;
  description: string;
  amount?: string;
}): Promise<void> {
  await produce(FLUVIO_TOPICS.AML_ALERT_RAISED, {
    key: `ALERT-${alert.alertId}`,
    value: { ...alert, timestamp: new Date().toISOString() },
  });
}

export async function publishOrderEvent(
  eventType: "PLACED" | "MATCHED" | "CANCELLED" | "AMENDED",
  order: {
    orderId: number;
    userId: number;
    symbol: string;
    side: string;
    qty: string;
    price: string;
    status: string;
  }
): Promise<void> {
  const topicMap = {
    PLACED: FLUVIO_TOPICS.ORDER_PLACED,
    MATCHED: FLUVIO_TOPICS.ORDER_MATCHED,
    CANCELLED: FLUVIO_TOPICS.ORDER_CANCELLED,
    AMENDED: FLUVIO_TOPICS.ORDER_AMENDED,
  } as const;

  await produce(topicMap[eventType], {
    key: `ORDER-${order.orderId}`,
    value: { ...order, eventType, timestamp: new Date().toISOString() },
  });
}

export async function publishAuditLog(entry: {
  userId?: number;
  action: string;
  resource: string;
  resourceId?: string | number;
  ipAddress?: string;
  userAgent?: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  await produce(FLUVIO_TOPICS.AUDIT_LOG, {
    key: entry.userId ? `USER-${entry.userId}` : "SYSTEM",
    value: { ...entry, timestamp: new Date().toISOString() },
  });
}
