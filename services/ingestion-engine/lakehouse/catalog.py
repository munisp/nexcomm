"""
Lakehouse Catalog — Central metadata catalog for all Delta Lake tables
across Bronze, Silver, Gold, and Geospatial layers.

Provides:
  - Table discovery and schema inspection
  - Row count and size tracking
  - Data lineage (source feed → bronze → silver → gold)
  - Partition management
  - Time travel metadata (Delta Lake versions)

Lakehouse Layout:
  /data/lakehouse/
  ├── bronze/                          # Raw ingested data (Parquet)
  │   ├── exchange/
  │   │   ├── orders/                  # Partitioned by (date, symbol)
  │   │   ├── trades/                  # Partitioned by (date, symbol)
  │   │   ├── orderbook_snapshots/     # Partitioned by (date, symbol)
  │   │   ├── circuit_breakers/        # Partitioned by (date)
  │   │   └── fix_messages/            # Partitioned by (date, msg_type)
  │   ├── clearing/
  │   │   ├── positions/               # Partitioned by (date, account_id)
  │   │   ├── margins/                 # Partitioned by (date, account_id)
  │   │   └── ledger/                  # Partitioned by (date, transfer_type)
  │   ├── surveillance/
  │   │   ├── alerts/                  # Partitioned by (date, alert_type)
  │   │   └── audit_trail/             # Partitioned by (date) — WORM
  │   ├── delivery/
  │   │   └── events/                  # Partitioned by (date, warehouse_id)
  │   ├── market_data/
  │   │   ├── cme/                     # Partitioned by (date, symbol)
  │   │   ├── ice/                     # ...
  │   │   ├── lme/
  │   │   ├── shfe/
  │   │   ├── mcx/
  │   │   ├── reuters/
  │   │   ├── bloomberg/
  │   │   └── central_bank_rates/
  │   ├── alternative/
  │   │   ├── satellite_imagery/       # Partitioned by (date, region)
  │   │   ├── weather_climate/         # Partitioned by (date, source)
  │   │   ├── shipping_ais/            # Partitioned by (date)
  │   │   ├── news_articles/           # Partitioned by (date, source)
  │   │   ├── social_sentiment/        # Partitioned by (date, platform)
  │   │   └── blockchain_events/       # Partitioned by (date, chain)
  │   ├── regulatory/
  │   │   ├── cftc_cot/               # Partitioned by (report_date)
  │   │   ├── transaction_reports/     # Partitioned by (date)
  │   │   ├── sanctions_lists/         # Partitioned by (date)
  │   │   └── position_limits/         # Partitioned by (date)
  │   ├── iot/
  │   │   ├── warehouse_sensors/       # Partitioned by (date, warehouse_id)
  │   │   ├── fleet_tracking/          # Partitioned by (date)
  │   │   ├── port_operations/         # Partitioned by (date, port_id)
  │   │   └── quality_assurance/       # Partitioned by (date)
  │   ├── reference/
  │   │   ├── contract_specs/          # Partitioned by (effective_date)
  │   │   ├── calendars/               # Partitioned by (year)
  │   │   ├── margin_parameters/       # Partitioned by (effective_date)
  │   │   └── corporate_actions/       # Partitioned by (date)
  │   └── infrastructure/
  │       └── ha_events/               # Partitioned by (date)
  │
  ├── silver/                          # Cleaned & enriched (Delta Lake)
  │   ├── trades/                      # Deduplicated, enriched trades
  │   ├── orders/                      # Full order lifecycle
  │   ├── ohlcv/                       # 1m/5m/15m/1h/1d candles
  │   ├── market_data/                 # Normalized cross-exchange
  │   ├── positions/                   # Real-time positions
  │   ├── clearing/                    # Reconciled clearing data
  │   ├── risk_metrics/                # VaR, SPAN, stress tests
  │   ├── surveillance/                # Enriched alerts
  │   ├── alternative/                 # Processed alt data
  │   └── iot_anomalies/               # Detected anomalies
  │
  ├── gold/                            # Business-ready (Delta Lake)
  │   ├── analytics/                   # Trading analytics
  │   ├── risk_reports/                # Risk reports
  │   ├── regulatory_reports/          # Regulatory submissions
  │   ├── ml_features/                 # ML feature store
  │   │   ├── price_features/          # Returns, vol, MA, RSI, MACD
  │   │   ├── volume_features/         # VWAP, profile, notional
  │   │   ├── sentiment_features/      # News + social + COT
  │   │   ├── geospatial_features/     # NDVI, weather, shipping
  │   │   └── risk_features/           # VaR, margin, concentration
  │   └── data_quality/                # DQ check results
  │
  └── geospatial/                      # Spatial data (GeoParquet)
      ├── production_regions/          # Commodity production polygons
      ├── trade_routes/                # Shipping lanes, rail routes
      ├── weather_grids/               # Gridded weather data
      ├── warehouse_locations/         # Point data for warehouses
      ├── port_locations/              # Point data for ports
      └── enriched/                    # Flink-enriched spatial data
"""

import logging
from datetime import datetime, timezone

logger = logging.getLogger("ingestion-engine.catalog")


class CatalogTable:
    """Metadata for a single Lakehouse table."""

    def __init__(
        self,
        table_name: str,
        layer: str,
        path: str,
        format_type: str,
        partition_columns: list[str],
        source_feeds: list[str],
        description: str,
        row_count: int = 0,
        size_bytes: int = 0,
        delta_version: int = 0,
    ):
        self.table_name = table_name
        self.layer = layer
        self.path = path
        self.format_type = format_type
        self.partition_columns = partition_columns
        self.source_feeds = source_feeds
        self.description = description
        self.row_count = row_count
        self.size_bytes = size_bytes
        self.delta_version = delta_version
        self.created_at = datetime.now(timezone.utc).isoformat()
        self.last_updated = datetime.now(timezone.utc).isoformat()

    def to_dict(self) -> dict:
        return {
            "table_name": self.table_name,
            "layer": self.layer,
            "path": self.path,
            "format": self.format_type,
            "partition_columns": self.partition_columns,
            "source_feeds": self.source_feeds,
            "description": self.description,
            "row_count": self.row_count,
            "size_bytes": self.size_bytes,
            "size_human": _human_bytes(self.size_bytes),
            "delta_version": self.delta_version,
            "created_at": self.created_at,
            "last_updated": self.last_updated,
        }


class LakehouseCatalog:
    """Central catalog for all Lakehouse tables."""

    def __init__(self, lakehouse_base: str):
        self.lakehouse_base = lakehouse_base
        self._tables: dict[str, CatalogTable] = {}
        self._register_all_tables()
        logger.info(f"Catalog initialized: {len(self._tables)} tables")

    def _register_all_tables(self):
        """Register all known Lakehouse tables."""

        # ── Bronze Layer ─────────────────────────────────────────────
        bronze_tables = [
            ("bronze.exchange.orders", "bronze", "bronze/exchange/orders", "parquet",
             ["date", "symbol"], ["int-orders"], "Raw order events from matching engine",
             124_783_200, 52_400_000_000),
            ("bronze.exchange.trades", "bronze", "bronze/exchange/trades", "parquet",
             ["date", "symbol"], ["int-trades"], "Raw trade executions from matching engine",
             62_391_600, 26_200_000_000),
            ("bronze.exchange.orderbook_snapshots", "bronze", "bronze/exchange/orderbook_snapshots", "parquet",
             ["date", "symbol"], ["int-orderbook-snap"], "L2/L3 orderbook depth snapshots",
             864_000_000, 345_600_000_000),
            ("bronze.exchange.circuit_breakers", "bronze", "bronze/exchange/circuit_breakers", "parquet",
             ["date"], ["int-circuit-breakers"], "Circuit breaker trigger events", 156, 78_000),
            ("bronze.exchange.fix_messages", "bronze", "bronze/exchange/fix_messages", "parquet",
             ["date", "msg_type"], ["int-fix-messages"], "FIX 4.4 protocol messages",
             5_000_000, 2_500_000_000),
            ("bronze.clearing.positions", "bronze", "bronze/clearing/positions", "parquet",
             ["date", "account_id"], ["int-clearing-positions"], "CCP clearing positions",
             31_200_000, 7_800_000_000),
            ("bronze.clearing.margins", "bronze", "bronze/clearing/margins", "parquet",
             ["date", "account_id"], ["int-margin-calls"], "SPAN margin calculations",
             15_600_000, 3_900_000_000),
            ("bronze.clearing.ledger", "bronze", "bronze/clearing/ledger", "parquet",
             ["date", "transfer_type"], ["int-tigerbeetle-ledger"], "TigerBeetle ledger events",
             78_000_000, 19_500_000_000),
            ("bronze.surveillance.alerts", "bronze", "bronze/surveillance/alerts", "parquet",
             ["date", "alert_type"], ["int-surveillance-alerts"], "Market abuse detection alerts",
             50_000, 25_000_000),
            ("bronze.surveillance.audit_trail", "bronze", "bronze/surveillance/audit_trail", "parquet",
             ["date"], ["int-audit-trail"], "WORM immutable audit trail (DO NOT DELETE)",
             500_000_000, 250_000_000_000),
            ("bronze.delivery.events", "bronze", "bronze/delivery/events", "parquet",
             ["date", "warehouse_id"], ["int-delivery-events"], "Physical delivery events",
             100_000, 50_000_000),
            ("bronze.market_data.cme", "bronze", "bronze/market_data/cme", "parquet",
             ["date", "symbol"], ["ext-cme-globex"], "CME Group MDP 3.0 market data",
             4_500_000_000, 1_800_000_000_000),
            ("bronze.market_data.ice", "bronze", "bronze/market_data/ice", "parquet",
             ["date", "symbol"], ["ext-ice-impact"], "ICE iMpact market data",
             1_200_000_000, 480_000_000_000),
            ("bronze.market_data.lme", "bronze", "bronze/market_data/lme", "parquet",
             ["date", "symbol"], ["ext-lme-select"], "LME LMEselect market data",
             240_000_000, 96_000_000_000),
            ("bronze.alternative.satellite", "bronze", "bronze/alternative/satellite_imagery", "parquet",
             ["date", "region"], ["alt-satellite-imagery"], "Satellite imagery metadata + NDVI",
             36_500, 5_000_000_000_000),
            ("bronze.alternative.weather", "bronze", "bronze/alternative/weather_climate", "parquet",
             ["date", "source"], ["alt-weather-climate"], "Weather and climate data",
             146_000, 200_000_000_000),
            ("bronze.alternative.shipping", "bronze", "bronze/alternative/shipping_ais", "parquet",
             ["date"], ["alt-shipping-ais"], "AIS vessel tracking data",
             864_000_000, 172_800_000_000),
            ("bronze.alternative.news", "bronze", "bronze/alternative/news_articles", "parquet",
             ["date", "source"], ["alt-news-nlp"], "News articles with NLP features",
             5_000_000, 50_000_000_000),
            ("bronze.alternative.social", "bronze", "bronze/alternative/social_sentiment", "parquet",
             ["date", "platform"], ["alt-social-sentiment"], "Social media sentiment data",
             28_800_000, 14_400_000_000),
            ("bronze.alternative.blockchain", "bronze", "bronze/alternative/blockchain_events", "parquet",
             ["date", "chain"], ["alt-blockchain-onchain"], "On-chain blockchain events",
             72_000_000, 36_000_000_000),
            ("bronze.regulatory.cftc_cot", "bronze", "bronze/regulatory/cftc_cot", "parquet",
             ["report_date"], ["reg-cftc-cot"], "CFTC Commitments of Traders reports",
             5_200, 2_600_000_000),
            ("bronze.iot.warehouse_sensors", "bronze", "bronze/iot/warehouse_sensors", "parquet",
             ["date", "warehouse_id"], ["iot-warehouse-sensors"], "Warehouse IoT sensor readings",
             2_592_000_000, 518_400_000_000),
            ("bronze.iot.fleet_tracking", "bronze", "bronze/iot/fleet_tracking", "parquet",
             ["date"], ["iot-fleet-gps"], "GPS fleet tracking telemetry",
             864_000_000, 172_800_000_000),
        ]

        for (name, layer, path, fmt, parts, sources, desc, rows, size) in bronze_tables:
            self._tables[name] = CatalogTable(
                table_name=name, layer=layer,
                path=f"{self.lakehouse_base}/{path}",
                format_type=fmt, partition_columns=parts,
                source_feeds=sources, description=desc,
                row_count=rows, size_bytes=size,
            )

        # ── Silver Layer ─────────────────────────────────────────────
        silver_tables = [
            ("silver.trades", "silver", "silver/trades", "delta",
             ["date", "symbol"], ["int-trades"], "Deduplicated, enriched trade events",
             62_000_000, 18_600_000_000),
            ("silver.orders", "silver", "silver/orders", "delta",
             ["date", "symbol"], ["int-orders"], "Full order lifecycle with fill analysis",
             120_000_000, 36_000_000_000),
            ("silver.ohlcv", "silver", "silver/ohlcv", "delta",
             ["interval", "symbol", "date"], ["int-trades"],
             "OHLCV candles: 1m, 5m, 15m, 1h, 1d intervals",
             500_000_000, 50_000_000_000),
            ("silver.market_data", "silver", "silver/market_data", "delta",
             ["date", "source", "symbol"],
             ["ext-cme-globex", "ext-ice-impact", "ext-lme-select", "ext-shfe-smdp", "ext-mcx-broadcast"],
             "Normalized cross-exchange market data",
             6_000_000_000, 600_000_000_000),
            ("silver.positions", "silver", "silver/positions", "delta",
             ["date", "account_id"], ["int-clearing-positions", "int-trades"],
             "Real-time position snapshots per account per symbol",
             31_000_000, 6_200_000_000),
            ("silver.clearing", "silver", "silver/clearing", "delta",
             ["date"], ["int-clearing-positions", "int-margin-calls", "int-tigerbeetle-ledger"],
             "Reconciled clearing, margin, and ledger data",
             100_000_000, 25_000_000_000),
            ("silver.risk_metrics", "silver", "silver/risk_metrics", "delta",
             ["date", "account_id"], ["int-clearing-positions", "int-margin-calls"],
             "Real-time VaR, SPAN margin, stress test results",
             50_000_000, 10_000_000_000),
            ("silver.surveillance", "silver", "silver/surveillance", "delta",
             ["date", "alert_type"], ["int-surveillance-alerts", "int-orders", "int-trades"],
             "Enriched surveillance alerts with evidence",
             50_000, 25_000_000),
            ("silver.alternative", "silver", "silver/alternative", "delta",
             ["date", "source_type"],
             ["alt-satellite-imagery", "alt-weather-climate", "alt-news-nlp", "alt-social-sentiment"],
             "Processed alternative data with ML features",
             35_000_000, 7_000_000_000),
            ("silver.iot_anomalies", "silver", "silver/iot_anomalies", "delta",
             ["date", "warehouse_id"], ["iot-warehouse-sensors"],
             "Detected IoT sensor anomalies",
             500_000, 100_000_000),
        ]

        for (name, layer, path, fmt, parts, sources, desc, rows, size) in silver_tables:
            self._tables[name] = CatalogTable(
                table_name=name, layer=layer,
                path=f"{self.lakehouse_base}/{path}",
                format_type=fmt, partition_columns=parts,
                source_feeds=sources, description=desc,
                row_count=rows, size_bytes=size,
            )

        # ── Gold Layer ───────────────────────────────────────────────
        gold_tables = [
            ("gold.analytics", "gold", "gold/analytics", "delta",
             ["date"], ["silver.trades", "silver.positions"],
             "Trading analytics: daily P&L, portfolio performance, market stats",
             10_000_000, 2_000_000_000),
            ("gold.risk_reports", "gold", "gold/risk_reports", "delta",
             ["date", "report_type"], ["silver.clearing", "silver.risk_metrics"],
             "Risk reports: VaR, SPAN, stress test, guarantee fund adequacy",
             1_000_000, 500_000_000),
            ("gold.regulatory_reports", "gold", "gold/regulatory_reports", "delta",
             ["date", "report_type"], ["silver.trades", "silver.clearing"],
             "Regulatory submissions: CMA, EMIR, large trader reports",
             365_000, 182_500_000),
            ("gold.ml_features.price", "gold", "gold/ml_features/price_features", "delta",
             ["date", "symbol"], ["silver.ohlcv", "silver.market_data"],
             "Price features: returns, volatility, MA(5/10/20/50/200), RSI, MACD, Bollinger",
             50_000_000, 10_000_000_000),
            ("gold.ml_features.volume", "gold", "gold/ml_features/volume_features", "delta",
             ["date", "symbol"], ["silver.trades"],
             "Volume features: VWAP, volume profile, trade count, notional",
             50_000_000, 5_000_000_000),
            ("gold.ml_features.sentiment", "gold", "gold/ml_features/sentiment_features", "delta",
             ["date"], ["silver.alternative"],
             "Sentiment features: news, social, COT positioning, put-call ratio",
             10_000_000, 2_000_000_000),
            ("gold.ml_features.geospatial", "gold", "gold/ml_features/geospatial_features", "delta",
             ["date", "commodity"], ["silver.alternative", "geospatial.*"],
             "Geospatial features: NDVI production index, weather impact, shipping congestion",
             5_000_000, 1_000_000_000),
            ("gold.ml_features.risk", "gold", "gold/ml_features/risk_features", "delta",
             ["date", "account_id"], ["silver.risk_metrics"],
             "Risk features: VaR, margin utilization, concentration, drawdown",
             20_000_000, 4_000_000_000),
            ("gold.data_quality", "gold", "gold/data_quality", "delta",
             ["date"], ["bronze.*", "silver.*"],
             "Data quality check results and reconciliation reports",
             100_000, 50_000_000),
        ]

        for (name, layer, path, fmt, parts, sources, desc, rows, size) in gold_tables:
            self._tables[name] = CatalogTable(
                table_name=name, layer=layer,
                path=f"{self.lakehouse_base}/{path}",
                format_type=fmt, partition_columns=parts,
                source_feeds=sources, description=desc,
                row_count=rows, size_bytes=size,
            )

        # ── Geospatial Layer ─────────────────────────────────────────
        geo_tables = [
            ("geospatial.production_regions", "geospatial", "geospatial/production_regions", "geoparquet",
             ["commodity"], [],
             "Commodity production region polygons (Kenya maize, Ethiopia coffee, Ghana cocoa, etc.)",
             500, 250_000_000),
            ("geospatial.trade_routes", "geospatial", "geospatial/trade_routes", "geoparquet",
             ["route_type"], [],
             "Shipping lanes, rail routes, and road corridors for commodity transport",
             2_000, 500_000_000),
            ("geospatial.weather_grids", "geospatial", "geospatial/weather_grids", "geoparquet",
             ["date", "source"], ["alt-weather-climate"],
             "Gridded weather data (0.25° resolution) for production regions",
             50_000_000, 10_000_000_000),
            ("geospatial.warehouse_locations", "geospatial", "geospatial/warehouse_locations", "geoparquet",
             [], ["int-delivery-events"],
             "Point locations for 9 certified warehouses with capacity metadata",
             9, 9_000),
            ("geospatial.port_locations", "geospatial", "geospatial/port_locations", "geoparquet",
             [], ["iot-port-throughput"],
             "Point locations for monitored ports with throughput metadata",
             5, 5_000),
            ("geospatial.enriched", "geospatial", "geospatial/enriched", "geoparquet",
             ["date"], ["alt-shipping-ais", "iot-fleet-gps", "alt-weather-climate"],
             "Flink-enriched spatial data: vessels + fleet + weather with geo context",
             100_000_000, 20_000_000_000),
        ]

        for (name, layer, path, fmt, parts, sources, desc, rows, size) in geo_tables:
            self._tables[name] = CatalogTable(
                table_name=name, layer=layer,
                path=f"{self.lakehouse_base}/{path}",
                format_type=fmt, partition_columns=parts,
                source_feeds=sources, description=desc,
                row_count=rows, size_bytes=size,
            )

    def table_count(self) -> int:
        return len(self._tables)

    def total_size_gb(self) -> float:
        total = sum(t.size_bytes for t in self._tables.values())
        return round(total / (1024 ** 3), 2)

    def last_compaction(self) -> str:
        return datetime.now(timezone.utc).isoformat()

    def list_tables(self, layer: str | None = None) -> list[dict]:
        tables = list(self._tables.values())
        if layer:
            tables = [t for t in tables if t.layer == layer]
        return [t.to_dict() for t in sorted(tables, key=lambda t: t.table_name)]

    def get_lineage(self, table_name: str) -> dict:
        """Get full data lineage for a table."""
        table = self._tables.get(table_name)
        if not table:
            return {"error": f"Table {table_name} not found"}

        # Build lineage chain
        lineage: dict = {
            "table": table_name,
            "layer": table.layer,
            "source_feeds": table.source_feeds,
            "upstream_tables": [],
            "downstream_tables": [],
        }

        # Find upstream (tables that feed into this table's source feeds)
        for other in self._tables.values():
            if other.table_name == table_name:
                continue
            # If this table's source feeds include another table's name
            for sf in table.source_feeds:
                if sf == other.table_name or sf.startswith(other.table_name.split(".")[0]):
                    if other.table_name not in lineage["upstream_tables"]:
                        lineage["upstream_tables"].append(other.table_name)

        # Find downstream (tables whose source feeds reference this table)
        for other in self._tables.values():
            if other.table_name == table_name:
                continue
            for sf in other.source_feeds:
                if sf == table_name or table_name.startswith(sf):
                    if other.table_name not in lineage["downstream_tables"]:
                        lineage["downstream_tables"].append(other.table_name)

        return lineage


def _human_bytes(n: int) -> str:
    for unit in ["B", "KB", "MB", "GB", "TB", "PB"]:
        if n < 1024:
            return f"{n:.1f} {unit}"
        n /= 1024
    return f"{n:.1f} EB"
