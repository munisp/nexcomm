"""
Alternative Data Connectors — 6 feeds providing non-traditional data sources
for alpha generation, risk assessment, and supply chain intelligence.

These feeds are unique to NEXCOM's pan-African commodity focus and provide
competitive advantage through satellite imagery, weather, shipping, news,
social sentiment, and blockchain on-chain data.

Feed Map:
  ┌───────────────────────────────────────────────────────────────────┐
  │                   ALTERNATIVE DATA SOURCES                        │
  │                                                                   │
  │  Satellite ──── Planet Labs, Sentinel-2 ──── NDVI, Mine Activity │
  │  Weather ────── NOAA, ECMWF ─────────────── Forecasts, Precip   │
  │  Shipping ──── MarineTraffic AIS ─────────── Vessel Tracking     │
  │  News ──────── Reuters, Bloomberg, Local ─── NLP Sentiment       │
  │  Social ────── Twitter/X, Reddit ─────────── Market Sentiment    │
  │  Blockchain ── Ethereum, Polygon ─────────── Tokenization Events │
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


class AlternativeDataConnectors:
    """Registers all 6 alternative data feed connectors."""

    @staticmethod
    def register(registry: ConnectorRegistry):
        feeds = [
            FeedConnector(
                feed_id="alt-satellite-imagery",
                name="Satellite Imagery (NDVI / Mine Activity)",
                description=(
                    "Satellite imagery from Planet Labs (3m resolution, daily) and "
                    "ESA Sentinel-2 (10m, 5-day revisit). Provides: "
                    "NDVI crop health indices for agricultural regions (Kenya maize, "
                    "Ethiopian coffee, Ghana cocoa), mine activity detection for "
                    "gold/copper operations, deforestation monitoring for carbon "
                    "credit verification. Processed via Ray for ML inference."
                ),
                category=FeedCategory.ALTERNATIVE,
                protocol=FeedProtocol.REST_POLL,
                source_endpoint="api.planet.com/data/v1 + scihub.copernicus.eu/apihub",
                kafka_topic="nexcom.ingest.satellite",
                lakehouse_target="bronze/alternative/satellite_imagery",
                schema_name="satellite_imagery_v1",
                refresh_interval_sec=86400,  # daily
                status=FeedStatus.ACTIVE,
                priority=3,
                metrics=FeedMetrics(
                    messages_received=365,
                    messages_processed=365,
                    bytes_received=50_000_000_000,  # ~50GB imagery
                    avg_latency_ms=5000.0,
                    throughput_msg_sec=0.00001,
                ),
                tags=["daily", "geospatial", "ml", "agriculture", "mining"],
            ),
            FeedConnector(
                feed_id="alt-weather-climate",
                name="Weather & Climate Data",
                description=(
                    "Weather forecasts and historical climate data from: "
                    "NOAA GFS (Global Forecast System, 0.25° grid, 16-day forecast), "
                    "ECMWF ERA5 (reanalysis, 0.25°, hourly), "
                    "local African met services (KMD Kenya, NMA Ethiopia). "
                    "Variables: temperature, precipitation, soil moisture, wind speed, "
                    "humidity. Critical for agricultural commodity pricing and "
                    "natural gas demand forecasting."
                ),
                category=FeedCategory.ALTERNATIVE,
                protocol=FeedProtocol.REST_POLL,
                source_endpoint="api.weather.gov + cds.climate.copernicus.eu/api/v2",
                kafka_topic="nexcom.ingest.weather",
                lakehouse_target="bronze/alternative/weather_climate",
                schema_name="weather_data_v1",
                refresh_interval_sec=21600,  # every 6 hours
                status=FeedStatus.ACTIVE,
                priority=3,
                metrics=FeedMetrics(
                    messages_received=1460,
                    messages_processed=1460,
                    bytes_received=2_000_000_000,
                    avg_latency_ms=3000.0,
                    throughput_msg_sec=0.00007,
                ),
                tags=["scheduled", "geospatial", "weather", "agriculture"],
            ),
            FeedConnector(
                feed_id="alt-shipping-ais",
                name="Shipping / AIS Vessel Tracking",
                description=(
                    "Automatic Identification System (AIS) data via MarineTraffic "
                    "and Spire Maritime. Tracks commodity tankers, bulk carriers, "
                    "and container ships. Provides: vessel positions, speed, heading, "
                    "draft (cargo load indicator), port calls, ETA estimates. "
                    "Covers key African ports: Mombasa, Dar es Salaam, Lagos, Durban."
                ),
                category=FeedCategory.ALTERNATIVE,
                protocol=FeedProtocol.WEBSOCKET,
                source_endpoint="services.marinetraffic.com/api/v8 (WebSocket stream)",
                kafka_topic="nexcom.ingest.shipping",
                lakehouse_target="bronze/alternative/shipping_ais",
                schema_name="ais_position_v1",
                refresh_interval_sec=60,
                status=FeedStatus.ACTIVE,
                priority=3,
                metrics=FeedMetrics(
                    messages_received=8_640_000,
                    messages_processed=8_640_000,
                    bytes_received=1_728_000_000,
                    avg_latency_ms=500.0,
                    throughput_msg_sec=100,
                ),
                tags=["real-time", "geospatial", "logistics", "supply-chain"],
            ),
            FeedConnector(
                feed_id="alt-news-nlp",
                name="News Feed (NLP Sentiment)",
                description=(
                    "Real-time news articles from Reuters, Bloomberg, African "
                    "media (Nation Kenya, Guardian Tanzania, Premium Times Nigeria). "
                    "NLP pipeline extracts: commodity mentions, sentiment scores, "
                    "named entities (companies, regions, policy makers), event "
                    "classification (supply disruption, policy change, weather event). "
                    "Processed via Ray-distributed BERT models."
                ),
                category=FeedCategory.ALTERNATIVE,
                protocol=FeedProtocol.WEBSOCKET,
                source_endpoint="newsapi.org/v2 + custom African news scrapers",
                kafka_topic="nexcom.ingest.news",
                lakehouse_target="bronze/alternative/news_articles",
                schema_name="news_article_v1",
                refresh_interval_sec=60,
                status=FeedStatus.ACTIVE,
                priority=3,
                metrics=FeedMetrics(
                    messages_received=50_000,
                    messages_processed=50_000,
                    bytes_received=500_000_000,
                    avg_latency_ms=200.0,
                    throughput_msg_sec=0.6,
                ),
                tags=["real-time", "nlp", "sentiment", "ml"],
            ),
            FeedConnector(
                feed_id="alt-social-sentiment",
                name="Social Media Sentiment",
                description=(
                    "Social media monitoring for commodity market sentiment: "
                    "Twitter/X (commodity cashtags, trader accounts), "
                    "Reddit (r/commodities, r/trading, r/agriculture), "
                    "Telegram (commodity trading groups). "
                    "Sentiment scoring via fine-tuned FinBERT model on Ray."
                ),
                category=FeedCategory.ALTERNATIVE,
                protocol=FeedProtocol.REST_POLL,
                source_endpoint="api.twitter.com/2/tweets/search + reddit.com/api",
                kafka_topic="nexcom.ingest.social",
                lakehouse_target="bronze/alternative/social_sentiment",
                schema_name="social_post_v1",
                refresh_interval_sec=300,  # every 5 minutes
                status=FeedStatus.ACTIVE,
                priority=4,
                metrics=FeedMetrics(
                    messages_received=288_000,
                    messages_processed=288_000,
                    bytes_received=144_000_000,
                    avg_latency_ms=150.0,
                    throughput_msg_sec=3.3,
                ),
                tags=["scheduled", "sentiment", "ml", "social"],
            ),
            FeedConnector(
                feed_id="alt-blockchain-onchain",
                name="Blockchain On-Chain Events",
                description=(
                    "On-chain events from NEXCOM's smart contracts: "
                    "Ethereum L1 and Polygon L2 — ERC-1155 CommodityToken "
                    "mint/burn/transfer events, SettlementEscrow deposits/"
                    "releases, tokenization lifecycle. Also monitors "
                    "DeFi commodity protocols and stablecoin flows."
                ),
                category=FeedCategory.ALTERNATIVE,
                protocol=FeedProtocol.WEBSOCKET,
                source_endpoint="wss://mainnet.infura.io/ws + wss://polygon-rpc.com/ws",
                kafka_topic="nexcom.ingest.blockchain",
                lakehouse_target="bronze/alternative/blockchain_events",
                schema_name="blockchain_event_v1",
                refresh_interval_sec=12,  # every block (~12s Ethereum)
                status=FeedStatus.ACTIVE,
                priority=3,
                metrics=FeedMetrics(
                    messages_received=720_000,
                    messages_processed=720_000,
                    bytes_received=360_000_000,
                    avg_latency_ms=2000.0,
                    throughput_msg_sec=8.3,
                ),
                tags=["real-time", "blockchain", "tokenization", "defi"],
            ),
        ]

        for feed in feeds:
            registry.register(feed)
