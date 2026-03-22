"""
Silver Layer — Cleaned, deduplicated, and enriched data.

The Silver layer applies data quality rules, deduplication, schema validation,
and enrichment transformations to Bronze data. All Silver tables are stored
as Delta Lake tables with ACID transactions.

Processing Rules:
  1. Deduplication: Remove exact duplicates by primary key
  2. Schema Validation: Enforce field types, nullability, value ranges
  3. Enrichment: Join with reference data (contract specs, calendars)
  4. Normalization: Unified timestamp format, currency conversion
  5. Data Quality: Flag records that fail quality checks

Silver Tables (managed by Spark ETL + Flink streaming):
  ┌───────────────────────────────────────────────────────────────────┐
  │                      SILVER LAYER                                 │
  │                                                                   │
  │  trades ─────────── Deduplicated + enriched with contract specs  │
  │  orders ─────────── Full lifecycle with fill analysis            │
  │  ohlcv ──────────── Aggregated candles (1m/5m/15m/1h/1d)        │
  │  market_data ────── Normalized cross-exchange data               │
  │  positions ──────── Real-time position snapshots                 │
  │  clearing ───────── Reconciled clearing + margin + ledger        │
  │  risk_metrics ───── VaR, SPAN, stress test results               │
  │  surveillance ───── Enriched surveillance alerts                 │
  │  alternative ────── Processed alternative data with ML features  │
  │  iot_anomalies ──── Detected sensor anomalies                    │
  └───────────────────────────────────────────────────────────────────┘
"""

import logging
from datetime import datetime, timezone

logger = logging.getLogger("ingestion-engine.silver")


class SilverTable:
    """Configuration for a Silver layer Delta Lake table."""

    def __init__(
        self,
        name: str,
        bronze_sources: list[str],
        primary_key: list[str],
        partition_by: list[str],
        merge_key: list[str],
        quality_rules: list[dict],
        enrichment_joins: list[dict],
        description: str,
    ):
        self.name = name
        self.bronze_sources = bronze_sources
        self.primary_key = primary_key
        self.partition_by = partition_by
        self.merge_key = merge_key
        self.quality_rules = quality_rules
        self.enrichment_joins = enrichment_joins
        self.description = description
        self.row_count = 0
        self.last_updated = datetime.now(timezone.utc).isoformat()
        self.quality_pass_rate = 99.97

    def to_dict(self) -> dict:
        return {
            "name": self.name,
            "bronze_sources": self.bronze_sources,
            "primary_key": self.primary_key,
            "partition_by": self.partition_by,
            "merge_key": self.merge_key,
            "quality_rules_count": len(self.quality_rules),
            "enrichment_joins_count": len(self.enrichment_joins),
            "description": self.description,
            "row_count": self.row_count,
            "last_updated": self.last_updated,
            "quality_pass_rate_pct": self.quality_pass_rate,
        }


class SilverLayerManager:
    """Manages the Silver (cleaned/enriched) layer."""

    def __init__(self, base_path: str):
        self.base_path = base_path
        self._tables: dict[str, SilverTable] = {}
        self._define_tables()
        logger.info(f"Silver layer initialized at {base_path}: {len(self._tables)} tables")

    def _define_tables(self):
        tables = [
            SilverTable(
                name="silver.trades",
                bronze_sources=["bronze.exchange.trades"],
                primary_key=["trade_id"],
                partition_by=["date", "symbol"],
                merge_key=["trade_id"],
                quality_rules=[
                    {"rule": "NOT_NULL", "columns": ["trade_id", "symbol", "price", "quantity"]},
                    {"rule": "POSITIVE", "columns": ["price", "quantity"]},
                    {"rule": "IN_SET", "column": "aggressor_side", "values": ["BUY", "SELL"]},
                    {"rule": "REFERENTIAL", "column": "symbol", "reference_table": "reference.contract_specs"},
                ],
                enrichment_joins=[
                    {"table": "reference.contract_specs", "on": "symbol", "fields": ["tick_size", "lot_size", "commodity_class"]},
                    {"table": "reference.calendars", "on": "date", "fields": ["is_trading_day", "settlement_date"]},
                ],
                description="Deduplicated trade executions enriched with contract specs",
            ),
            SilverTable(
                name="silver.orders",
                bronze_sources=["bronze.exchange.orders"],
                primary_key=["order_id", "event_type"],
                partition_by=["date", "symbol"],
                merge_key=["order_id", "sequence_number"],
                quality_rules=[
                    {"rule": "NOT_NULL", "columns": ["order_id", "symbol", "side", "order_type"]},
                    {"rule": "IN_SET", "column": "side", "values": ["BUY", "SELL"]},
                    {"rule": "IN_SET", "column": "order_type", "values": ["MARKET", "LIMIT", "STOP", "STOP_LIMIT"]},
                    {"rule": "MONOTONIC", "column": "sequence_number"},
                ],
                enrichment_joins=[
                    {"table": "reference.contract_specs", "on": "symbol", "fields": ["tick_size", "lot_size"]},
                ],
                description="Full order lifecycle events with fill analysis",
            ),
            SilverTable(
                name="silver.ohlcv",
                bronze_sources=["bronze.exchange.trades"],
                primary_key=["symbol", "interval", "candle_time"],
                partition_by=["interval", "symbol", "date"],
                merge_key=["symbol", "interval", "candle_time"],
                quality_rules=[
                    {"rule": "NOT_NULL", "columns": ["symbol", "open", "high", "low", "close", "volume"]},
                    {"rule": "RANGE", "column": "high", "min_expr": "open", "description": "high >= open"},
                    {"rule": "RANGE", "column": "low", "max_expr": "open", "description": "low <= open"},
                ],
                enrichment_joins=[],
                description="OHLCV candles at 1m/5m/15m/1h/1d intervals",
            ),
            SilverTable(
                name="silver.market_data",
                bronze_sources=[
                    "bronze.market_data.cme", "bronze.market_data.ice",
                    "bronze.market_data.lme", "bronze.market_data.shfe",
                    "bronze.market_data.mcx", "bronze.market_data.reuters",
                    "bronze.market_data.bloomberg",
                ],
                primary_key=["source", "symbol", "timestamp"],
                partition_by=["date", "source", "symbol"],
                merge_key=["source", "symbol", "timestamp"],
                quality_rules=[
                    {"rule": "NOT_NULL", "columns": ["source", "symbol", "price", "timestamp"]},
                    {"rule": "POSITIVE", "columns": ["price"]},
                    {"rule": "FRESHNESS", "column": "timestamp", "max_delay_sec": 300},
                ],
                enrichment_joins=[
                    {"table": "reference.fx_rates", "on": "currency", "fields": ["usd_rate"]},
                ],
                description="Normalized cross-exchange market data with FX conversion",
            ),
            SilverTable(
                name="silver.positions",
                bronze_sources=["bronze.clearing.positions", "bronze.exchange.trades"],
                primary_key=["account_id", "symbol", "snapshot_time"],
                partition_by=["date", "account_id"],
                merge_key=["account_id", "symbol"],
                quality_rules=[
                    {"rule": "NOT_NULL", "columns": ["account_id", "symbol", "net_quantity"]},
                    {"rule": "RECONCILE", "with_table": "silver.clearing", "description": "positions match clearing"},
                ],
                enrichment_joins=[
                    {"table": "reference.contract_specs", "on": "symbol", "fields": ["margin_pct", "contract_multiplier"]},
                ],
                description="Real-time position snapshots per account per symbol",
            ),
            SilverTable(
                name="silver.clearing",
                bronze_sources=["bronze.clearing.positions", "bronze.clearing.margins", "bronze.clearing.ledger"],
                primary_key=["event_id"],
                partition_by=["date"],
                merge_key=["event_id"],
                quality_rules=[
                    {"rule": "NOT_NULL", "columns": ["event_id", "account_id", "amount"]},
                    {"rule": "BALANCE", "description": "sum(debits) == sum(credits) for ledger"},
                ],
                enrichment_joins=[],
                description="Reconciled clearing, margin, and TigerBeetle ledger data",
            ),
            SilverTable(
                name="silver.risk_metrics",
                bronze_sources=["bronze.clearing.positions", "bronze.clearing.margins"],
                primary_key=["account_id", "calculation_time"],
                partition_by=["date", "account_id"],
                merge_key=["account_id", "calculation_time"],
                quality_rules=[
                    {"rule": "NOT_NULL", "columns": ["account_id", "var_99"]},
                    {"rule": "POSITIVE", "columns": ["initial_margin"]},
                ],
                enrichment_joins=[],
                description="Real-time VaR, SPAN margin, and stress test results",
            ),
            SilverTable(
                name="silver.surveillance",
                bronze_sources=["bronze.surveillance.alerts"],
                primary_key=["alert_id"],
                partition_by=["date", "alert_type"],
                merge_key=["alert_id"],
                quality_rules=[
                    {"rule": "NOT_NULL", "columns": ["alert_id", "alert_type", "account_id"]},
                    {"rule": "IN_SET", "column": "severity", "values": ["CRITICAL", "HIGH", "MEDIUM", "LOW"]},
                ],
                enrichment_joins=[
                    {"table": "silver.orders", "on": "account_id+timestamp_range", "fields": ["related_orders"]},
                    {"table": "silver.trades", "on": "account_id+timestamp_range", "fields": ["related_trades"]},
                ],
                description="Enriched surveillance alerts with order/trade evidence",
            ),
            SilverTable(
                name="silver.alternative",
                bronze_sources=[
                    "bronze.alternative.satellite", "bronze.alternative.weather",
                    "bronze.alternative.news", "bronze.alternative.social",
                ],
                primary_key=["source_type", "record_id"],
                partition_by=["date", "source_type"],
                merge_key=["source_type", "record_id"],
                quality_rules=[
                    {"rule": "NOT_NULL", "columns": ["record_id", "source_type"]},
                    {"rule": "RANGE", "column": "sentiment_score", "min": -1.0, "max": 1.0},
                ],
                enrichment_joins=[],
                description="Processed alternative data with ML-extracted features",
            ),
            SilverTable(
                name="silver.iot_anomalies",
                bronze_sources=["bronze.iot.warehouse_sensors"],
                primary_key=["anomaly_id"],
                partition_by=["date", "warehouse_id"],
                merge_key=["anomaly_id"],
                quality_rules=[
                    {"rule": "NOT_NULL", "columns": ["anomaly_id", "warehouse_id", "sensor_type"]},
                ],
                enrichment_joins=[
                    {"table": "geospatial.warehouse_locations", "on": "warehouse_id", "fields": ["latitude", "longitude"]},
                ],
                description="Detected IoT sensor anomalies from warehouse monitoring",
            ),
        ]

        for table in tables:
            table.row_count = 50_000_000  # simulated
            self._tables[table.name] = table

    def status(self) -> dict:
        return {
            "status": "healthy",
            "base_path": self.base_path,
            "table_count": len(self._tables),
            "tables": {name: t.to_dict() for name, t in self._tables.items()},
        }
