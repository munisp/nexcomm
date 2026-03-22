"""
Reference Data Connectors — 4 feeds providing static and semi-static
reference data that underpins all exchange operations.

These feeds are updated infrequently (daily or on-change) but are critical
for correct pricing, margining, settlement, and contract lifecycle management.

Feed Map:
  ┌───────────────────────────────────────────────────────────────────┐
  │                   REFERENCE DATA SOURCES                          │
  │                                                                   │
  │  Contract Specs ── Tick/Lot/Margin params ── Per-symbol config   │
  │  Calendars ─────── Exchange/Settlement/Delivery ── Holiday dates │
  │  Margin Params ─── SPAN arrays, haircuts ──── Risk parameters    │
  │  Corporate Acts ── Symbol changes, splits ──── Lifecycle events  │
  └───────────────────────────────────────────────────────────────────┘
"""

from connectors.registry import (
    ConnectorRegistry,
    FeedConnector,
    FeedCategory,
    FeedProtocol,
    FeedStatus,
    FeedMetrics,
)


class ReferenceDataConnectors:
    """Registers all 4 reference data feed connectors."""

    @staticmethod
    def register(registry: ConnectorRegistry):
        feeds = [
            FeedConnector(
                feed_id="ref-contract-specs",
                name="Contract Specifications",
                description=(
                    "Master contract specification database for all 86+ active "
                    "futures contracts across 12 commodity classes. Includes: "
                    "tick_size, lot_size, contract_multiplier, margin_pct, "
                    "daily_price_limit, last_trading_day, delivery_start, "
                    "delivery_end, settlement_method (cash/physical), "
                    "product_group, cme_month_code. Updated when risk committee "
                    "approves parameter changes."
                ),
                category=FeedCategory.REFERENCE,
                protocol=FeedProtocol.DATABASE_CDC,
                source_endpoint="postgres://nexcom/contract_specs (CDC via Debezium)",
                kafka_topic="nexcom.ingest.reference.contract-specs",
                lakehouse_target="bronze/reference/contract_specs",
                schema_name="contract_spec_v1",
                refresh_interval_sec=0,  # CDC — event-driven
                status=FeedStatus.ACTIVE,
                priority=1,
                metrics=FeedMetrics(
                    messages_received=1200,
                    messages_processed=1200,
                    bytes_received=600_000,
                    avg_latency_ms=10.0,
                ),
                tags=["event-driven", "reference", "critical"],
            ),
            FeedConnector(
                feed_id="ref-holiday-calendars",
                name="Holiday & Trading Calendars",
                description=(
                    "Exchange trading calendars, settlement calendars, and "
                    "delivery calendars for all markets. Covers: NEXCOM exchange "
                    "holidays, Kenyan public holidays, UK bank holidays, "
                    "US federal holidays, Chinese public holidays, Indian market "
                    "holidays. Critical for T+1/T+2 settlement date calculation "
                    "and contract expiry determination."
                ),
                category=FeedCategory.REFERENCE,
                protocol=FeedProtocol.REST_POLL,
                source_endpoint="Internal calendar service + exchange websites",
                kafka_topic="nexcom.ingest.reference.calendars",
                lakehouse_target="bronze/reference/calendars",
                schema_name="calendar_entry_v1",
                refresh_interval_sec=86400,  # daily
                status=FeedStatus.ACTIVE,
                priority=2,
                metrics=FeedMetrics(
                    messages_received=365,
                    messages_processed=365,
                    bytes_received=182_000,
                    avg_latency_ms=50.0,
                ),
                tags=["daily", "reference", "settlement"],
            ),
            FeedConnector(
                feed_id="ref-margin-parameters",
                name="Margin Parameter Updates",
                description=(
                    "SPAN margin parameters: scanning risk arrays (16 scenarios), "
                    "inter-commodity spread credits, delivery month charges, "
                    "short option minimum charges. Also includes: collateral "
                    "haircuts (treasuries, gold, cash), concentration charges, "
                    "stress test multipliers. Published after daily risk review."
                ),
                category=FeedCategory.REFERENCE,
                protocol=FeedProtocol.KAFKA,
                source_endpoint="Risk committee decisions (internal Kafka topic)",
                kafka_topic="nexcom.ingest.reference.margin-params",
                lakehouse_target="bronze/reference/margin_parameters",
                schema_name="margin_param_v1",
                refresh_interval_sec=0,  # event-driven
                status=FeedStatus.ACTIVE,
                priority=1,
                metrics=FeedMetrics(
                    messages_received=730,
                    messages_processed=730,
                    bytes_received=3_650_000,
                    avg_latency_ms=5.0,
                ),
                tags=["event-driven", "reference", "risk", "critical"],
            ),
            FeedConnector(
                feed_id="ref-corporate-actions",
                name="Corporate Actions & Symbol Changes",
                description=(
                    "Lifecycle events affecting contracts: symbol changes, "
                    "contract splits/merges, delivery point additions/removals, "
                    "grade specification changes, warehouse certification "
                    "additions/revocations. Rare but critical for data integrity."
                ),
                category=FeedCategory.REFERENCE,
                protocol=FeedProtocol.KAFKA,
                source_endpoint="Internal operations team (manual + automated)",
                kafka_topic="nexcom.ingest.reference.corporate-actions",
                lakehouse_target="bronze/reference/corporate_actions",
                schema_name="corporate_action_v1",
                refresh_interval_sec=0,
                status=FeedStatus.ACTIVE,
                priority=2,
                metrics=FeedMetrics(
                    messages_received=50,
                    messages_processed=50,
                    bytes_received=250_000,
                    avg_latency_ms=20.0,
                ),
                tags=["event-driven", "reference", "lifecycle"],
            ),
        ]

        for feed in feeds:
            registry.register(feed)
