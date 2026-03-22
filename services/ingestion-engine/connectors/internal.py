"""
Internal Exchange Connectors — 12 feeds from the NEXCOM matching engine,
clearing house, surveillance, FIX gateway, and HA/DR subsystems.

These are the highest-priority feeds as they represent the exchange's own
trade lifecycle data. They flow through Kafka and Fluvio for low-latency
delivery to the Lakehouse bronze layer.

Feed Map:
  ┌─────────────────────────────────────────────────────────┐
  │                  MATCHING ENGINE (Rust)                   │
  │  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌──────────────┐  │
  │  │ Orders  │ │ Trades  │ │Orderbook│ │Circuit Breaks│  │
  │  │  Events │ │         │ │Snapshots│ │              │  │
  │  └────┬────┘ └────┬────┘ └────┬────┘ └──────┬───────┘  │
  │       │           │           │              │          │
  │  ┌────▼───────────▼───────────▼──────────────▼───────┐  │
  │  │              Kafka / Fluvio                        │  │
  │  └───────────────────────┬───────────────────────────┘  │
  └──────────────────────────┼──────────────────────────────┘
                             │
  ┌──────────────────────────▼──────────────────────────────┐
  │                    CCP CLEARING                          │
  │  Positions │ Margins │ Settlements │ Guarantee Fund      │
  └──────────────────────────┬──────────────────────────────┘
                             │
  ┌──────────────────────────▼──────────────────────────────┐
  │                    SURVEILLANCE                          │
  │  Alerts │ Position Limits │ Audit Trail │ Reports        │
  └──────────────────────────┬──────────────────────────────┘
                             │
  ┌──────────────────────────▼──────────────────────────────┐
  │                    FIX GATEWAY                           │
  │  Session Events │ Execution Reports │ Market Data Reqs   │
  └──────────────────────────┬──────────────────────────────┘
                             │
  ┌──────────────────────────▼──────────────────────────────┐
  │                    HA / DR                               │
  │  Replication Events │ Failover Signals │ Health Checks   │
  └─────────────────────────────────────────────────────────┘
"""

from connectors.registry import (
    ConnectorRegistry,
    FeedConnector,
    FeedCategory,
    FeedProtocol,
    FeedStatus,
    FeedMetrics,
)


class InternalExchangeConnectors:
    """Registers all 12 internal exchange data feed connectors."""

    @staticmethod
    def register(registry: ConnectorRegistry):
        feeds = [
            # ── Matching Engine ──────────────────────────────────────
            FeedConnector(
                feed_id="int-orders",
                name="Order Events",
                description=(
                    "All order lifecycle events from the Rust matching engine: "
                    "new orders, amendments, cancellations, fills, partial fills. "
                    "Includes client_order_id, account_id, symbol, side, type, "
                    "price (fixed-point i64), quantity, time_in_force, timestamps."
                ),
                category=FeedCategory.INTERNAL,
                protocol=FeedProtocol.KAFKA,
                source_endpoint="matching-engine:8080/api/v1/orders (WebSocket stream)",
                kafka_topic="nexcom.ingest.orders",
                lakehouse_target="bronze/exchange/orders",
                schema_name="order_event_v1",
                refresh_interval_sec=0,  # real-time
                status=FeedStatus.ACTIVE,
                priority=1,
                metrics=FeedMetrics(
                    messages_received=1_247_832,
                    messages_processed=1_247_830,
                    messages_failed=2,
                    bytes_received=524_000_000,
                    avg_latency_ms=0.012,
                    max_latency_ms=1.2,
                    throughput_msg_sec=14_400,
                    uptime_pct=99.999,
                ),
                tags=["critical", "real-time", "matching-engine"],
            ),
            FeedConnector(
                feed_id="int-trades",
                name="Trade Executions",
                description=(
                    "Matched trade events: trade_id, buyer_account, seller_account, "
                    "symbol, price, quantity, trade_time (nanosecond precision). "
                    "Generated when opposing orders cross in the FIFO orderbook. "
                    "Fed to clearing for novation and position management."
                ),
                category=FeedCategory.INTERNAL,
                protocol=FeedProtocol.KAFKA,
                source_endpoint="matching-engine:8080 (internal event bus)",
                kafka_topic="nexcom.ingest.trades",
                lakehouse_target="bronze/exchange/trades",
                schema_name="trade_event_v1",
                refresh_interval_sec=0,
                status=FeedStatus.ACTIVE,
                priority=1,
                metrics=FeedMetrics(
                    messages_received=623_916,
                    messages_processed=623_916,
                    messages_failed=0,
                    bytes_received=262_000_000,
                    avg_latency_ms=0.008,
                    max_latency_ms=0.9,
                    throughput_msg_sec=7_200,
                    uptime_pct=100.0,
                ),
                tags=["critical", "real-time", "matching-engine"],
            ),
            FeedConnector(
                feed_id="int-orderbook-snap",
                name="Orderbook Snapshots",
                description=(
                    "Periodic L2/L3 orderbook depth snapshots for all active symbols. "
                    "Includes top 20 bid/ask levels with price, quantity, order count. "
                    "Used for market data distribution, analytics, and reconstruction."
                ),
                category=FeedCategory.INTERNAL,
                protocol=FeedProtocol.FLUVIO,
                source_endpoint="matching-engine:8080/api/v1/depth/{symbol}",
                kafka_topic="nexcom.ingest.orderbook-snapshots",
                lakehouse_target="bronze/exchange/orderbook_snapshots",
                schema_name="orderbook_snapshot_v1",
                refresh_interval_sec=1,
                status=FeedStatus.ACTIVE,
                priority=1,
                metrics=FeedMetrics(
                    messages_received=8_640_000,
                    messages_processed=8_640_000,
                    bytes_received=3_456_000_000,
                    avg_latency_ms=0.15,
                    throughput_msg_sec=100,
                ),
                tags=["critical", "real-time", "market-data"],
            ),
            FeedConnector(
                feed_id="int-circuit-breakers",
                name="Circuit Breaker Events",
                description=(
                    "Price limit triggers, trading halts, and volatility interruptions. "
                    "Each event includes symbol, trigger_price, limit_type (upper/lower), "
                    "halt_duration, and pre/post-halt reference prices."
                ),
                category=FeedCategory.INTERNAL,
                protocol=FeedProtocol.KAFKA,
                source_endpoint="matching-engine:8080 (internal event bus)",
                kafka_topic="nexcom.ingest.circuit-breakers",
                lakehouse_target="bronze/exchange/circuit_breakers",
                schema_name="circuit_breaker_v1",
                refresh_interval_sec=0,
                status=FeedStatus.ACTIVE,
                priority=1,
                tags=["critical", "real-time", "risk"],
            ),
            # ── CCP Clearing ─────────────────────────────────────────
            FeedConnector(
                feed_id="int-clearing-positions",
                name="Clearing Positions",
                description=(
                    "Position updates after novation by the CCP clearing house. "
                    "Includes account_id, symbol, side (long/short), net quantity, "
                    "average_price, unrealized_pnl, margin requirements."
                ),
                category=FeedCategory.INTERNAL,
                protocol=FeedProtocol.KAFKA,
                source_endpoint="matching-engine:8080/api/v1/clearing/positions/{account}",
                kafka_topic="nexcom.ingest.clearing-positions",
                lakehouse_target="bronze/clearing/positions",
                schema_name="clearing_position_v1",
                refresh_interval_sec=0,
                status=FeedStatus.ACTIVE,
                priority=1,
                metrics=FeedMetrics(
                    messages_received=312_000,
                    messages_processed=312_000,
                    bytes_received=78_000_000,
                    avg_latency_ms=0.5,
                    throughput_msg_sec=3_600,
                ),
                tags=["critical", "real-time", "clearing"],
            ),
            FeedConnector(
                feed_id="int-margin-calls",
                name="Margin Calls & Settlements",
                description=(
                    "SPAN margin calculations, margin calls, variation margin settlements, "
                    "and guarantee fund contributions. Includes initial_margin, "
                    "maintenance_margin, scanning_risk from 16 SPAN scenarios."
                ),
                category=FeedCategory.INTERNAL,
                protocol=FeedProtocol.KAFKA,
                source_endpoint="matching-engine:8080/api/v1/clearing/margins/{account}",
                kafka_topic="nexcom.ingest.margin-settlements",
                lakehouse_target="bronze/clearing/margins",
                schema_name="margin_settlement_v1",
                refresh_interval_sec=0,
                status=FeedStatus.ACTIVE,
                priority=1,
                tags=["critical", "real-time", "clearing", "risk"],
            ),
            # ── Surveillance ─────────────────────────────────────────
            FeedConnector(
                feed_id="int-surveillance-alerts",
                name="Surveillance Alerts",
                description=(
                    "Market abuse detection alerts: spoofing, wash trading, layering, "
                    "position limit breaches, unusual volume patterns. Each alert has "
                    "severity, detection_model, evidence, and resolution_status."
                ),
                category=FeedCategory.INTERNAL,
                protocol=FeedProtocol.KAFKA,
                source_endpoint="matching-engine:8080/api/v1/surveillance/alerts",
                kafka_topic="nexcom.ingest.surveillance-alerts",
                lakehouse_target="bronze/surveillance/alerts",
                schema_name="surveillance_alert_v1",
                refresh_interval_sec=0,
                status=FeedStatus.ACTIVE,
                priority=1,
                tags=["critical", "real-time", "compliance"],
            ),
            FeedConnector(
                feed_id="int-audit-trail",
                name="WORM Audit Trail",
                description=(
                    "Immutable, checksummed audit trail entries (Write-Once-Read-Many). "
                    "Every order, trade, cancellation, and system event is recorded with "
                    "sequence number, SHA-256 chain checksum, and nanosecond timestamps. "
                    "Required by regulators (CFTC, FCA, CMA Kenya)."
                ),
                category=FeedCategory.INTERNAL,
                protocol=FeedProtocol.KAFKA,
                source_endpoint="matching-engine:8080/api/v1/audit/entries",
                kafka_topic="nexcom.ingest.audit-trail",
                lakehouse_target="bronze/surveillance/audit_trail",
                schema_name="audit_entry_v1",
                refresh_interval_sec=0,
                status=FeedStatus.ACTIVE,
                priority=1,
                tags=["critical", "real-time", "compliance", "worm"],
            ),
            # ── FIX Gateway ──────────────────────────────────────────
            FeedConnector(
                feed_id="int-fix-messages",
                name="FIX 4.4 Protocol Messages",
                description=(
                    "All FIX protocol messages: Logon (35=A), New Order Single (35=D), "
                    "Execution Reports (35=8), Order Cancel Requests (35=F), "
                    "Market Data Requests (35=V). Session management events included."
                ),
                category=FeedCategory.INTERNAL,
                protocol=FeedProtocol.FIX,
                source_endpoint="matching-engine:8080/api/v1/fix/message",
                kafka_topic="nexcom.ingest.fix-messages",
                lakehouse_target="bronze/exchange/fix_messages",
                schema_name="fix_message_v1",
                refresh_interval_sec=0,
                status=FeedStatus.ACTIVE,
                priority=2,
                tags=["institutional", "real-time", "fix-protocol"],
            ),
            # ── Physical Delivery ────────────────────────────────────
            FeedConnector(
                feed_id="int-delivery-events",
                name="Physical Delivery Events",
                description=(
                    "Warehouse receipt issuance, transfers, and cancellations. "
                    "Delivery intent notices, assignment, and completion events. "
                    "9 warehouses across Africa, London, Dubai with grade specs."
                ),
                category=FeedCategory.INTERNAL,
                protocol=FeedProtocol.KAFKA,
                source_endpoint="matching-engine:8080/api/v1/delivery/receipts",
                kafka_topic="nexcom.ingest.delivery-events",
                lakehouse_target="bronze/delivery/events",
                schema_name="delivery_event_v1",
                refresh_interval_sec=0,
                status=FeedStatus.ACTIVE,
                priority=2,
                tags=["physical-delivery", "warehouse"],
            ),
            # ── HA/DR ────────────────────────────────────────────────
            FeedConnector(
                feed_id="int-ha-replication",
                name="HA Replication Stream",
                description=(
                    "State replication events between primary and standby nodes. "
                    "Includes orderbook state, position snapshots, sequence numbers. "
                    "Active-passive failover with <15s RTO target."
                ),
                category=FeedCategory.INTERNAL,
                protocol=FeedProtocol.GRPC,
                source_endpoint="matching-engine:8080/api/v1/cluster",
                kafka_topic="nexcom.ingest.ha-replication",
                lakehouse_target="bronze/infrastructure/ha_events",
                schema_name="ha_replication_v1",
                refresh_interval_sec=1,
                status=FeedStatus.ACTIVE,
                priority=2,
                tags=["infrastructure", "ha-dr"],
            ),
            # ── TigerBeetle Ledger ───────────────────────────────────
            FeedConnector(
                feed_id="int-tigerbeetle-ledger",
                name="TigerBeetle Financial Ledger",
                description=(
                    "Double-entry accounting events from TigerBeetle: transfers, "
                    "account balances, pending/posted amounts. Powers settlement "
                    "and ensures financial integrity. Integrated via Mojaloop."
                ),
                category=FeedCategory.INTERNAL,
                protocol=FeedProtocol.DATABASE_CDC,
                source_endpoint="tigerbeetle:3001",
                kafka_topic="nexcom.ingest.ledger-events",
                lakehouse_target="bronze/clearing/ledger",
                schema_name="ledger_event_v1",
                refresh_interval_sec=0,
                status=FeedStatus.ACTIVE,
                priority=1,
                tags=["critical", "financial", "settlement"],
            ),
        ]

        for feed in feeds:
            registry.register(feed)
