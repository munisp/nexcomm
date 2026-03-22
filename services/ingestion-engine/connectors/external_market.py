"""
External Market Data Connectors — 8 feeds from global commodity exchanges,
data vendors, and central banks.

These feeds provide reference pricing, cross-market data, and benchmarks
that NEXCOM uses for mark-to-market, risk calculations, and price discovery.

Feed Map:
  ┌────────────────────────────────────────────────────────────────────┐
  │                GLOBAL COMMODITY EXCHANGES                          │
  │                                                                    │
  │  CME Group ──── MDP 3.0 multicast ──── Futures, Options, Spreads  │
  │  ICE ────────── iMpact feed ─────────── Energy, Soft Commodities  │
  │  LME ────────── LMEselect API ───────── Base Metals (Cu, Al, Zn) │
  │  SHFE ───────── SMDP 2.0 ───────────── Chinese Commodity Futures │
  │  MCX ────────── Broadcast feed ──────── Indian Commodity Futures  │
  │                                                                    │
  │  Reuters ────── Elektron / TREP ─────── Reference Prices, FX      │
  │  Bloomberg ──── B-PIPE ──────────────── Real-time Pricing         │
  │  Central Banks─ REST API polling ────── Interest Rates, FX Fixes  │
  └────────────────────────────────────────────────────────────────────┘
"""

from connectors.registry import (
    ConnectorRegistry,
    FeedConnector,
    FeedCategory,
    FeedProtocol,
    FeedStatus,
    FeedMetrics,
)


class ExternalMarketDataConnectors:
    """Registers all 8 external market data feed connectors."""

    @staticmethod
    def register(registry: ConnectorRegistry):
        feeds = [
            FeedConnector(
                feed_id="ext-cme-globex",
                name="CME Group Globex (MDP 3.0)",
                description=(
                    "CME Group market data via MDP 3.0 multicast protocol. "
                    "Covers agricultural futures (corn, wheat, soybeans), metals "
                    "(gold, silver, copper), energy (crude oil, natural gas), and "
                    "commodity options. Includes top-of-book, depth, settlement "
                    "prices, and open interest. ~26.5M contracts/day."
                ),
                category=FeedCategory.EXTERNAL_MARKET,
                protocol=FeedProtocol.TCP_MULTICAST,
                source_endpoint="mdp3.cmegroup.com:9000 (incremental + snapshot)",
                kafka_topic="nexcom.ingest.market-data.cme",
                lakehouse_target="bronze/market_data/cme",
                schema_name="cme_mdp3_v1",
                refresh_interval_sec=0,
                status=FeedStatus.ACTIVE,
                priority=1,
                metrics=FeedMetrics(
                    messages_received=45_000_000,
                    messages_processed=44_999_800,
                    messages_failed=200,
                    bytes_received=18_000_000_000,
                    avg_latency_ms=0.5,
                    max_latency_ms=12.0,
                    throughput_msg_sec=520,
                    uptime_pct=99.99,
                ),
                tags=["critical", "real-time", "exchange", "cme"],
            ),
            FeedConnector(
                feed_id="ext-ice-impact",
                name="ICE iMpact Market Data",
                description=(
                    "Intercontinental Exchange real-time market data via iMpact. "
                    "Covers Brent crude, gas oil, coffee (Robusta), cocoa, sugar, "
                    "cotton, and carbon credits (EUA). Includes trade, bid/ask, "
                    "settlement, and open interest messages."
                ),
                category=FeedCategory.EXTERNAL_MARKET,
                protocol=FeedProtocol.TCP_MULTICAST,
                source_endpoint="impact.theice.com:8200",
                kafka_topic="nexcom.ingest.market-data.ice",
                lakehouse_target="bronze/market_data/ice",
                schema_name="ice_impact_v1",
                refresh_interval_sec=0,
                status=FeedStatus.ACTIVE,
                priority=1,
                metrics=FeedMetrics(
                    messages_received=12_000_000,
                    messages_processed=12_000_000,
                    bytes_received=4_800_000_000,
                    avg_latency_ms=0.8,
                    throughput_msg_sec=140,
                ),
                tags=["critical", "real-time", "exchange", "ice"],
            ),
            FeedConnector(
                feed_id="ext-lme-select",
                name="LME LMEselect Market Data",
                description=(
                    "London Metal Exchange electronic trading platform data. "
                    "Covers base metals: copper, aluminium, zinc, nickel, tin, lead, "
                    "cobalt, steel. Unique features: 3-month forward pricing, "
                    "warehouse warrant data, cash-to-3-month spreads."
                ),
                category=FeedCategory.EXTERNAL_MARKET,
                protocol=FeedProtocol.WEBSOCKET,
                source_endpoint="api.lme.com/v2/market-data (WebSocket)",
                kafka_topic="nexcom.ingest.market-data.lme",
                lakehouse_target="bronze/market_data/lme",
                schema_name="lme_market_data_v1",
                refresh_interval_sec=0,
                status=FeedStatus.ACTIVE,
                priority=2,
                metrics=FeedMetrics(
                    messages_received=2_400_000,
                    messages_processed=2_400_000,
                    bytes_received=960_000_000,
                    avg_latency_ms=15.0,
                    throughput_msg_sec=28,
                ),
                tags=["real-time", "exchange", "lme", "metals"],
            ),
            FeedConnector(
                feed_id="ext-shfe-smdp",
                name="SHFE Market Data (SMDP 2.0)",
                description=(
                    "Shanghai Futures Exchange data: gold, silver, copper, aluminium, "
                    "zinc, nickel, tin, lead, fuel oil, bitumen, natural rubber, "
                    "stainless steel. Trading hours: 09:00-15:00 CST + night session."
                ),
                category=FeedCategory.EXTERNAL_MARKET,
                protocol=FeedProtocol.TCP_MULTICAST,
                source_endpoint="smdp.shfe.com.cn:5100",
                kafka_topic="nexcom.ingest.market-data.shfe",
                lakehouse_target="bronze/market_data/shfe",
                schema_name="shfe_smdp_v1",
                refresh_interval_sec=0,
                status=FeedStatus.ACTIVE,
                priority=2,
                metrics=FeedMetrics(
                    messages_received=18_000_000,
                    messages_processed=18_000_000,
                    bytes_received=7_200_000_000,
                    avg_latency_ms=120.0,
                    throughput_msg_sec=210,
                ),
                tags=["real-time", "exchange", "shfe", "china"],
            ),
            FeedConnector(
                feed_id="ext-mcx-broadcast",
                name="MCX Market Data Broadcast",
                description=(
                    "Multi Commodity Exchange of India: gold, silver, crude oil, "
                    "natural gas, copper, zinc, nickel, lead, cotton, mentha oil. "
                    "Includes iCOMDEX commodity index values."
                ),
                category=FeedCategory.EXTERNAL_MARKET,
                protocol=FeedProtocol.TCP_MULTICAST,
                source_endpoint="mdp.mcxindia.com:6100",
                kafka_topic="nexcom.ingest.market-data.mcx",
                lakehouse_target="bronze/market_data/mcx",
                schema_name="mcx_broadcast_v1",
                refresh_interval_sec=0,
                status=FeedStatus.ACTIVE,
                priority=2,
                metrics=FeedMetrics(
                    messages_received=8_000_000,
                    messages_processed=8_000_000,
                    bytes_received=3_200_000_000,
                    avg_latency_ms=85.0,
                    throughput_msg_sec=93,
                ),
                tags=["real-time", "exchange", "mcx", "india"],
            ),
            FeedConnector(
                feed_id="ext-reuters-elektron",
                name="Reuters/Refinitiv Elektron",
                description=(
                    "Thomson Reuters Elektron real-time and reference data. "
                    "FX spot/forward rates (170+ currency pairs), commodity "
                    "reference prices, economic indicators, fixings (London Gold Fix, "
                    "LBMA Silver Price, ICE Brent settlement)."
                ),
                category=FeedCategory.EXTERNAL_MARKET,
                protocol=FeedProtocol.WEBSOCKET,
                source_endpoint="api.refinitiv.com/streaming/pricing/v1",
                kafka_topic="nexcom.ingest.market-data.reuters",
                lakehouse_target="bronze/market_data/reuters",
                schema_name="reuters_elektron_v1",
                refresh_interval_sec=0,
                status=FeedStatus.ACTIVE,
                priority=2,
                metrics=FeedMetrics(
                    messages_received=5_000_000,
                    messages_processed=5_000_000,
                    bytes_received=2_000_000_000,
                    avg_latency_ms=5.0,
                    throughput_msg_sec=58,
                ),
                tags=["real-time", "vendor", "fx", "reference-prices"],
            ),
            FeedConnector(
                feed_id="ext-bloomberg-bpipe",
                name="Bloomberg B-PIPE",
                description=(
                    "Bloomberg real-time data: commodity prices, OTC derivatives, "
                    "credit spreads, sovereign yields, commodity indices (BCOM), "
                    "and evaluated prices for illiquid instruments."
                ),
                category=FeedCategory.EXTERNAL_MARKET,
                protocol=FeedProtocol.TCP_MULTICAST,
                source_endpoint="bpipe.bloomberg.net:8194",
                kafka_topic="nexcom.ingest.market-data.bloomberg",
                lakehouse_target="bronze/market_data/bloomberg",
                schema_name="bloomberg_bpipe_v1",
                refresh_interval_sec=0,
                status=FeedStatus.ACTIVE,
                priority=2,
                metrics=FeedMetrics(
                    messages_received=3_000_000,
                    messages_processed=3_000_000,
                    bytes_received=1_200_000_000,
                    avg_latency_ms=3.0,
                    throughput_msg_sec=35,
                ),
                tags=["real-time", "vendor", "bloomberg"],
            ),
            FeedConnector(
                feed_id="ext-central-bank-rates",
                name="Central Bank Interest Rates",
                description=(
                    "Interest rate decisions and daily fixings from: "
                    "Federal Reserve (Fed Funds Rate, SOFR), ECB (€STR, deposit rate), "
                    "Bank of England (SONIA), PBoC (LPR, MLF), RBI (repo rate), "
                    "CBK Kenya (CBR), SARB South Africa (repo). Used for options "
                    "pricing (risk-free rate in Black-76) and cost-of-carry."
                ),
                category=FeedCategory.EXTERNAL_MARKET,
                protocol=FeedProtocol.REST_POLL,
                source_endpoint="Multiple central bank APIs (Fed, ECB, BoE, PBoC, RBI, CBK, SARB)",
                kafka_topic="nexcom.ingest.fx-rates",
                lakehouse_target="bronze/market_data/central_bank_rates",
                schema_name="central_bank_rate_v1",
                refresh_interval_sec=3600,  # hourly
                status=FeedStatus.ACTIVE,
                priority=3,
                metrics=FeedMetrics(
                    messages_received=168,
                    messages_processed=168,
                    bytes_received=84_000,
                    avg_latency_ms=250.0,
                    throughput_msg_sec=0.002,
                ),
                tags=["scheduled", "reference", "rates"],
            ),
        ]

        for feed in feeds:
            registry.register(feed)
