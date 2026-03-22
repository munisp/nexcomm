"""
Regulatory Data Connectors — 4 feeds providing compliance-critical data
from regulatory bodies and sanctions authorities.

These feeds are mandatory for any licensed commodity exchange and enable
position limit enforcement, transaction reporting, and sanctions screening.

Feed Map:
  ┌───────────────────────────────────────────────────────────────────┐
  │                   REGULATORY DATA SOURCES                         │
  │                                                                   │
  │  CFTC ──────── COT Reports ──────── Weekly Commitments of Traders│
  │  FCA/CMA ───── Transaction Reporting ── MiFID II / Kenya CMA     │
  │  OFAC/EU/UN ── Sanctions Lists ──────── SDN, Consolidated Lists  │
  │  Exchanges ─── Position Limit Updates ── Spec limit changes      │
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


class RegulatoryDataConnectors:
    """Registers all 4 regulatory data feed connectors."""

    @staticmethod
    def register(registry: ConnectorRegistry):
        feeds = [
            FeedConnector(
                feed_id="reg-cftc-cot",
                name="CFTC Commitments of Traders (COT)",
                description=(
                    "Weekly COT reports from the U.S. Commodity Futures Trading "
                    "Commission. Shows positions held by commercial hedgers, "
                    "managed money, swap dealers, and other reportables. "
                    "Covers all CME/ICE/NYMEX commodity futures. Published "
                    "every Friday at 15:30 ET for positions as of Tuesday. "
                    "Key for sentiment analysis and positioning intelligence."
                ),
                category=FeedCategory.REGULATORY,
                protocol=FeedProtocol.REST_POLL,
                source_endpoint="https://www.cftc.gov/dea/newcot/deafut.txt (+ JSON API)",
                kafka_topic="nexcom.ingest.cot-reports",
                lakehouse_target="bronze/regulatory/cftc_cot",
                schema_name="cftc_cot_v1",
                refresh_interval_sec=604800,  # weekly
                status=FeedStatus.ACTIVE,
                priority=2,
                metrics=FeedMetrics(
                    messages_received=52,
                    messages_processed=52,
                    bytes_received=26_000_000,
                    avg_latency_ms=500.0,
                    throughput_msg_sec=0.000001,
                ),
                tags=["weekly", "compliance", "positioning", "cftc"],
            ),
            FeedConnector(
                feed_id="reg-transaction-reporting",
                name="Regulatory Transaction Reporting",
                description=(
                    "Outbound transaction reports to regulatory authorities: "
                    "Kenya Capital Markets Authority (CMA) — daily trade reports, "
                    "FCA (UK) — MiFID II RTS 25 transaction reports, "
                    "EMIR trade reporting to trade repositories. "
                    "Includes position reports, large trader reports, "
                    "and exceptional event notifications."
                ),
                category=FeedCategory.REGULATORY,
                protocol=FeedProtocol.SFTP,
                source_endpoint="sftp.cma.or.ke + sftp.fca.org.uk (outbound reports)",
                kafka_topic="nexcom.ingest.regulatory-reports",
                lakehouse_target="bronze/regulatory/transaction_reports",
                schema_name="transaction_report_v1",
                refresh_interval_sec=86400,  # daily
                status=FeedStatus.ACTIVE,
                priority=1,
                metrics=FeedMetrics(
                    messages_received=365,
                    messages_processed=365,
                    bytes_received=182_500_000,
                    avg_latency_ms=1000.0,
                ),
                tags=["daily", "compliance", "mandatory", "reporting"],
            ),
            FeedConnector(
                feed_id="reg-sanctions-lists",
                name="Sanctions Screening Lists",
                description=(
                    "Sanctions and PEP (Politically Exposed Persons) lists: "
                    "OFAC SDN (Specially Designated Nationals), "
                    "EU Consolidated Sanctions, UN Security Council sanctions, "
                    "UK HMT sanctions, African Union sanctions. "
                    "Used for KYC/AML screening of all exchange participants. "
                    "Delta updates checked hourly, full refresh daily."
                ),
                category=FeedCategory.REGULATORY,
                protocol=FeedProtocol.REST_POLL,
                source_endpoint="https://sanctionslist.ofac.treas.gov/api + EU/UN APIs",
                kafka_topic="nexcom.ingest.sanctions-lists",
                lakehouse_target="bronze/regulatory/sanctions_lists",
                schema_name="sanctions_entry_v1",
                refresh_interval_sec=3600,  # hourly delta, daily full
                status=FeedStatus.ACTIVE,
                priority=1,
                metrics=FeedMetrics(
                    messages_received=8760,
                    messages_processed=8760,
                    bytes_received=43_800_000,
                    avg_latency_ms=300.0,
                ),
                tags=["hourly", "compliance", "mandatory", "aml", "kyc"],
            ),
            FeedConnector(
                feed_id="reg-position-limits",
                name="Exchange Position Limit Updates",
                description=(
                    "Position limit parameter updates from the exchange's own "
                    "risk committee and from referenced exchanges (CME, ICE). "
                    "Includes spot-month limits, single-month limits, "
                    "all-months-combined limits, and accountability levels. "
                    "Triggers immediate recalculation of position limit checks "
                    "in the surveillance engine."
                ),
                category=FeedCategory.REGULATORY,
                protocol=FeedProtocol.KAFKA,
                source_endpoint="Internal risk committee decisions + CME/ICE advisories",
                kafka_topic="nexcom.ingest.position-limit-updates",
                lakehouse_target="bronze/regulatory/position_limits",
                schema_name="position_limit_update_v1",
                refresh_interval_sec=0,  # event-driven
                status=FeedStatus.ACTIVE,
                priority=1,
                tags=["event-driven", "compliance", "risk", "surveillance"],
            ),
        ]

        for feed in feeds:
            registry.register(feed)
