"""
NEXCOM Universal Ingestion Engine
==================================
Centralized data ingestion service that collects, normalizes, validates, and routes
ALL data feeds into the NEXCOM Exchange Lakehouse via Kafka and Flink streaming.

Architecture:
  ┌─────────────────────────────────────────────────────────────────────┐
  │                    DATA SOURCES (6 Categories)                      │
  ├──────────┬──────────┬──────────┬──────────┬──────────┬─────────────┤
  │ Internal │ External │ Alt Data │Regulatory│ IoT/Phys │  Reference  │
  │ Exchange │ Markets  │          │          │          │    Data     │
  └────┬─────┴────┬─────┴────┬─────┴────┬─────┴────┬─────┴──────┬──────┘
       │          │          │          │          │            │
       ▼          ▼          ▼          ▼          ▼            ▼
  ┌─────────────────────────────────────────────────────────────────────┐
  │              UNIVERSAL INGESTION ENGINE (This Service)              │
  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐              │
  │  │Connectors│ │ Schema   │ │  Dedup   │ │  Router  │              │
  │  │  (36+)   │→│Validator │→│  Engine  │→│          │              │
  │  └──────────┘ └──────────┘ └──────────┘ └────┬─────┘              │
  └──────────────────────────────────────────────┼─────────────────────┘
                                                 │
       ┌─────────────────────────────────────────┼───────────────────┐
       │                    KAFKA TOPICS (17+)                       │
       │  nexcom.ingest.market-data    nexcom.ingest.trades          │
       │  nexcom.ingest.orders         nexcom.ingest.settlements     │
       │  nexcom.ingest.weather        nexcom.ingest.satellite       │
       │  nexcom.ingest.news           nexcom.ingest.regulatory      │
       │  nexcom.ingest.iot-sensors    nexcom.ingest.reference       │
       │  nexcom.ingest.fix-messages   nexcom.ingest.blockchain      │
       │  nexcom.ingest.shipping       nexcom.ingest.fx-rates        │
       │  nexcom.ingest.audit          nexcom.ingest.surveillance    │
       │  nexcom.ingest.social         nexcom.ingest.cot-reports     │
       │  nexcom.ingest.clearing                                     │
       └────────────────────────────┬────────────────────────────────┘
                                    │
       ┌────────────────────────────▼────────────────────────────────┐
       │                    LAKEHOUSE (Delta Lake)                    │
       │  ┌─────────┐    ┌─────────┐    ┌─────────┐                 │
       │  │ BRONZE   │───▶│ SILVER  │───▶│  GOLD   │                 │
       │  │Raw Ingest│    │Cleaned  │    │Business │                 │
       │  │(Flink)   │    │(Spark)  │    │(DataFu) │                 │
       │  └─────────┘    └─────────┘    └─────────┘                 │
       │  ┌──────────────────────────────────────┐                   │
       │  │ GEOSPATIAL (Apache Sedona)           │                   │
       │  │ Production regions, trade routes,     │                   │
       │  │ weather grids, satellite imagery      │                   │
       │  └──────────────────────────────────────┘                   │
       │  ┌──────────────────────────────────────┐                   │
       │  │ ML FEATURE STORE (Ray)               │                   │
       │  │ Price features, sentiment, anomalies  │                   │
       │  └──────────────────────────────────────┘                   │
       └─────────────────────────────────────────────────────────────┘

Data Feed Categories:
  1. INTERNAL EXCHANGE (12 feeds)
     - Matching engine: orders, trades, orderbook snapshots
     - Clearing: positions, margins, settlements, guarantee fund
     - Surveillance: alerts, position limits, audit trail
     - FIX gateway: session events, execution reports
     - HA/DR: replication events, failover signals

  2. EXTERNAL MARKET DATA (8 feeds)
     - CME Group Globex (MDP 3.0): futures, options, spreads
     - ICE (iMpact): energy, soft commodities
     - LME (LMEselect): base metals
     - SHFE: Chinese commodity futures
     - MCX: Indian commodity futures
     - Reuters/Refinitiv Elektron: reference prices, FX
     - Bloomberg B-PIPE: real-time pricing
     - Central bank rates: Fed, ECB, BoE, PBoC, RBI

  3. ALTERNATIVE DATA (6 feeds)
     - Satellite imagery: NDVI crop health, mine activity
     - Weather/climate: NOAA, ECMWF forecasts, precipitation
     - Shipping/AIS: vessel tracking, port congestion
     - News/NLP: Reuters, Bloomberg, local African news
     - Social sentiment: Twitter/X, Reddit, Telegram
     - On-chain: Ethereum, Polygon tokenization events

  4. REGULATORY DATA (4 feeds)
     - CFTC Commitments of Traders (COT) reports
     - FCA/CMA transaction reporting requirements
     - OFAC/EU/UN sanctions screening lists
     - Exchange position limit updates

  5. IOT / PHYSICAL (4 feeds)
     - Warehouse sensors: temperature, humidity, weight
     - GPS fleet tracking: delivery vehicles, rail cars
     - Port throughput: container movements, berth occupancy
     - Quality assurance: lab test results, grading data

  6. REFERENCE DATA (4 feeds)
     - Contract specifications: tick size, lot size, margins
     - Holiday calendars: exchange, settlement, delivery
     - Margin parameter updates: SPAN arrays, haircuts
     - Corporate actions: splits, symbol changes

Endpoints:
  GET  /health                          - Health check with all connector statuses
  GET  /api/v1/feeds                    - List all registered data feeds
  GET  /api/v1/feeds/{feed_id}/status   - Feed status and metrics
  POST /api/v1/feeds/{feed_id}/start    - Start a feed connector
  POST /api/v1/feeds/{feed_id}/stop     - Stop a feed connector
  GET  /api/v1/feeds/metrics            - Aggregated ingestion metrics
  GET  /api/v1/lakehouse/status         - Lakehouse layer status (bronze/silver/gold)
  GET  /api/v1/lakehouse/catalog        - Data catalog (tables, schemas, row counts)
  POST /api/v1/lakehouse/query          - Execute analytical query via DataFusion
  GET  /api/v1/lakehouse/lineage/{table} - Data lineage for a table
  GET  /api/v1/schema-registry          - List all registered schemas
  GET  /api/v1/pipeline/status          - Pipeline status (Flink jobs, Spark jobs)
  POST /api/v1/pipeline/backfill        - Trigger historical backfill
"""

import os
import time
import hashlib
import logging
import random
from datetime import datetime, timedelta, timezone
from typing import Optional
from enum import Enum

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from connectors.registry import ConnectorRegistry, FeedCategory, FeedStatus
from connectors.internal import InternalExchangeConnectors
from connectors.external_market import ExternalMarketDataConnectors
from connectors.alternative import AlternativeDataConnectors
from connectors.regulatory import RegulatoryDataConnectors
from connectors.iot_physical import IoTPhysicalConnectors
from connectors.reference import ReferenceDataConnectors
from pipeline.flink_processor import FlinkStreamProcessor
from pipeline.spark_etl import SparkETLPipeline
from pipeline.schema_registry import SchemaRegistry
from pipeline.dedup_engine import DeduplicationEngine
from lakehouse.catalog import LakehouseCatalog
from lakehouse.bronze import BronzeLayerManager
from lakehouse.silver import SilverLayerManager
from lakehouse.gold import GoldLayerManager
from lakehouse.geospatial import GeospatialLayerManager

# ============================================================
# Configuration
# ============================================================

KAFKA_BROKERS = os.getenv("KAFKA_BROKERS", "localhost:9092")
REDIS_URL = os.getenv("REDIS_URL", "localhost:6379")
FLUVIO_ENDPOINT = os.getenv("FLUVIO_ENDPOINT", "localhost:9003")
OPENSEARCH_URL = os.getenv("OPENSEARCH_URL", "http://localhost:9200")
POSTGRES_URL = os.getenv("POSTGRES_URL", "postgresql://nexcom:nexcom_dev@localhost:5432/nexcom")
TEMPORAL_HOST = os.getenv("TEMPORAL_HOST", "localhost:7233")
TIGERBEETLE_ADDR = os.getenv("TIGERBEETLE_ADDRESSES", "localhost:3001")
MATCHING_ENGINE_URL = os.getenv("MATCHING_ENGINE_URL", "http://localhost:8080")
MINIO_ENDPOINT = os.getenv("MINIO_ENDPOINT", "localhost:9000")
LAKEHOUSE_BASE = os.getenv("LAKEHOUSE_BASE", "/data/lakehouse")
ENVIRONMENT = os.getenv("ENVIRONMENT", "development")

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(name)s] %(levelname)s: %(message)s")
logger = logging.getLogger("ingestion-engine")

# ============================================================
# App Setup
# ============================================================

app = FastAPI(
    title="NEXCOM Universal Ingestion Engine",
    description="Centralized data ingestion for ALL exchange data feeds → Lakehouse",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ============================================================
# Initialize Components
# ============================================================

# Connector Registry (manages all 38 feed connectors)
registry = ConnectorRegistry()

# Register all connectors by category
InternalExchangeConnectors.register(registry)
ExternalMarketDataConnectors.register(registry)
AlternativeDataConnectors.register(registry)
RegulatoryDataConnectors.register(registry)
IoTPhysicalConnectors.register(registry)
ReferenceDataConnectors.register(registry)

# Pipeline Components
schema_registry = SchemaRegistry()
dedup_engine = DeduplicationEngine()
flink_processor = FlinkStreamProcessor(KAFKA_BROKERS)
spark_etl = SparkETLPipeline(LAKEHOUSE_BASE)

# Lakehouse Layers
catalog = LakehouseCatalog(LAKEHOUSE_BASE)
bronze = BronzeLayerManager(f"{LAKEHOUSE_BASE}/bronze")
silver = SilverLayerManager(f"{LAKEHOUSE_BASE}/silver")
gold = GoldLayerManager(f"{LAKEHOUSE_BASE}/gold")
geospatial = GeospatialLayerManager(f"{LAKEHOUSE_BASE}/geospatial")

logger.info(
    f"Ingestion engine initialized: {registry.feed_count()} feeds, "
    f"{schema_registry.schema_count()} schemas, "
    f"Lakehouse at {LAKEHOUSE_BASE}"
)

# ============================================================
# Models
# ============================================================

class APIResponse(BaseModel):
    success: bool
    data: Optional[dict] = None
    error: Optional[str] = None
    timestamp: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


class BackfillRequest(BaseModel):
    feed_id: str
    start_date: str
    end_date: str
    parallelism: int = 4


class QueryRequest(BaseModel):
    sql: str
    engine: str = "datafusion"  # datafusion | spark | sedona


def _require_lakehouse_executor() -> str:
    """Return the configured execution endpoint or fail rather than fabricate a result."""
    endpoint = os.getenv("LAKEHOUSE_EXECUTOR_URL", "").strip()
    if not endpoint:
        raise HTTPException(
            status_code=503,
            detail="Lakehouse executor is not configured; refusing to report an unexecuted query as successful",
        )
    return endpoint.rstrip("/")


# ============================================================
# Health
# ============================================================

@app.get("/health")
async def health():
    connector_status = registry.all_statuses()
    active = sum(1 for s in connector_status.values() if s == FeedStatus.ACTIVE)
    errored = sum(1 for s in connector_status.values() if s == FeedStatus.ERROR)

    return APIResponse(
        success=True,
        data={
            "status": "healthy" if errored == 0 else "degraded",
            "service": "nexcom-ingestion-engine",
            "version": "1.0.0",
            "feeds": {
                "total": len(connector_status),
                "active": active,
                "inactive": len(connector_status) - active - errored,
                "errored": errored,
            },
            "pipeline": {
                "flink": flink_processor.status(),
                "spark": spark_etl.status(),
                "dedup_engine": dedup_engine.status(),
                "schema_registry": schema_registry.status(),
            },
            "lakehouse": {
                "bronze": bronze.status(),
                "silver": silver.status(),
                "gold": gold.status(),
                "geospatial": geospatial.status(),
                "catalog_tables": catalog.table_count(),
            },
            "infrastructure": {
                "kafka": KAFKA_BROKERS,
                "fluvio": FLUVIO_ENDPOINT,
                "opensearch": OPENSEARCH_URL,
                "minio": MINIO_ENDPOINT,
                "temporal": TEMPORAL_HOST,
                "matching_engine": MATCHING_ENGINE_URL,
            },
        },
    )


# ============================================================
# Feed Management
# ============================================================

@app.get("/api/v1/feeds")
async def list_feeds(
    category: Optional[str] = Query(None, description="Filter by category"),
    status: Optional[str] = Query(None, description="Filter by status"),
):
    """List all registered data feeds with their configuration and status."""
    feeds = registry.list_feeds(
        category=FeedCategory(category) if category else None,
        status=FeedStatus(status) if status else None,
    )
    return APIResponse(
        success=True,
        data={
            "feeds": [f.to_dict() for f in feeds],
            "total": len(feeds),
            "categories": registry.category_summary(),
        },
    )


@app.get("/api/v1/feeds/{feed_id}/status")
async def feed_status(feed_id: str):
    """Get detailed status and metrics for a specific feed."""
    feed = registry.get_feed(feed_id)
    if not feed:
        raise HTTPException(status_code=404, detail=f"Feed {feed_id} not found")
    return APIResponse(success=True, data=feed.detailed_status())


@app.post("/api/v1/feeds/{feed_id}/start")
async def start_feed(feed_id: str):
    """Start a feed connector."""
    feed = registry.get_feed(feed_id)
    if not feed:
        raise HTTPException(status_code=404, detail=f"Feed {feed_id} not found")
    feed.start()
    return APIResponse(success=True, data={"feed_id": feed_id, "status": "started"})


@app.post("/api/v1/feeds/{feed_id}/stop")
async def stop_feed(feed_id: str):
    """Stop a feed connector."""
    feed = registry.get_feed(feed_id)
    if not feed:
        raise HTTPException(status_code=404, detail=f"Feed {feed_id} not found")
    feed.stop()
    return APIResponse(success=True, data={"feed_id": feed_id, "status": "stopped"})


@app.get("/api/v1/feeds/metrics")
async def feed_metrics():
    """Aggregated ingestion metrics across all feeds."""
    return APIResponse(
        success=True,
        data=registry.aggregated_metrics(),
    )


# ============================================================
# Lakehouse
# ============================================================

@app.get("/api/v1/lakehouse/status")
async def lakehouse_status():
    """Status of all Lakehouse layers (Bronze → Silver → Gold + Geospatial)."""
    return APIResponse(
        success=True,
        data={
            "bronze": bronze.status(),
            "silver": silver.status(),
            "gold": gold.status(),
            "geospatial": geospatial.status(),
            "total_tables": catalog.table_count(),
            "total_size_gb": catalog.total_size_gb(),
            "last_compaction": catalog.last_compaction(),
            "delta_lake_version": "3.1.0",
            "storage_backend": "MinIO (S3-compatible)",
        },
    )


@app.get("/api/v1/lakehouse/catalog")
async def lakehouse_catalog(layer: Optional[str] = Query(None)):
    """Data catalog showing all tables, schemas, row counts, and partitioning."""
    tables = catalog.list_tables(layer=layer)
    return APIResponse(
        success=True,
        data={
            "tables": tables,
            "total": len(tables),
        },
    )


@app.post("/api/v1/lakehouse/query")
async def lakehouse_query(req: QueryRequest):
    """Execute an analytical query through a configured lakehouse executor."""
    if req.engine not in {"datafusion", "spark", "sedona"}:
        raise HTTPException(status_code=400, detail=f"Unknown engine: {req.engine}")
    executor = _require_lakehouse_executor()
    try:
        import httpx
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(f"{executor}/query", json={"sql": req.sql, "engine": req.engine})
        response.raise_for_status()
        result = response.json()
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"Lakehouse executor failed: {exc}") from exc
    return APIResponse(success=True, data={"engine": req.engine, "result": result, "executor": executor})


@app.get("/api/v1/lakehouse/lineage/{table}")
async def data_lineage(table: str):
    """Data lineage tracking — trace a table back to its source feeds."""
    lineage = catalog.get_lineage(table)
    return APIResponse(success=True, data=lineage)


# ============================================================
# Schema Registry
# ============================================================

@app.get("/api/v1/schema-registry")
async def list_schemas():
    """List all registered data schemas with versions."""
    return APIResponse(
        success=True,
        data={
            "schemas": schema_registry.list_schemas(),
            "total": schema_registry.schema_count(),
        },
    )


# ============================================================
# Pipeline Status
# ============================================================

@app.get("/api/v1/pipeline/status")
async def pipeline_status():
    """Pipeline status — Flink streaming jobs, Spark batch jobs."""
    return APIResponse(
        success=True,
        data={
            "flink": flink_processor.detailed_status(),
            "spark": spark_etl.detailed_status(),
            "dedup": dedup_engine.detailed_status(),
        },
    )


@app.post("/api/v1/pipeline/backfill")
async def trigger_backfill(req: BackfillRequest):
    """Trigger a historical data backfill via Temporal workflow."""
    job_id = spark_etl.trigger_backfill(
        feed_id=req.feed_id,
        start_date=req.start_date,
        end_date=req.end_date,
        parallelism=req.parallelism,
    )
    return APIResponse(
        success=True,
        data={
            "job_id": job_id,
            "feed_id": req.feed_id,
            "start_date": req.start_date,
            "end_date": req.end_date,
            "status": "submitted",
        },
    )


# ============================================================
# Kafka Consumer — Matching Engine & Settlement Engine Events
# ============================================================
from consumers.kafka_consumers import kafka_matching_settlement_consumer  # noqa: E402


@app.on_event("startup")
async def start_kafka_consumer():
    """Start the Kafka consumer for matching/settlement engine events on app startup."""
    import asyncio
    asyncio.create_task(kafka_matching_settlement_consumer.start())
    logger.info("Kafka matching/settlement consumer started")


@app.on_event("shutdown")
async def stop_kafka_consumer():
    """Flush buffers and stop the Kafka consumer on app shutdown."""
    await kafka_matching_settlement_consumer.stop()
    logger.info("Kafka matching/settlement consumer stopped")


@app.get("/api/v1/kafka/stats")
async def kafka_consumer_stats():
    """Return Kafka consumer statistics (consumed/written/errors per topic)."""
    return APIResponse(
        success=True,
        data=kafka_matching_settlement_consumer.get_stats(),
    )


class IngestEventRequest(BaseModel):
    """Request body for injecting a single event via HTTP (webhook mode)."""
    topic: str
    record: dict


@app.post("/api/v1/kafka/ingest")
async def ingest_event(req: IngestEventRequest):
    """
    HTTP webhook endpoint for injecting a single event into the Kafka consumer
    buffer. Useful when the matching or settlement engine cannot reach Kafka
    directly (e.g., during local development or disaster recovery).
    """
    kafka_matching_settlement_consumer.ingest_event(req.topic, req.record)
    return APIResponse(
        success=True,
        data={"topic": req.topic, "queued": True},
    )


# ============================================================
# Silver Layer Transformation Viewer
# ============================================================

@app.get("/api/v1/lakehouse/silver")
async def list_silver_tables():
    """List all Silver layer tables with their transformation summary."""
    tables = []
    for name, table in silver._tables.items():
        tables.append({
            "table_name": name,
            "description": table.description,
            "bronze_sources_count": len(table.bronze_sources),
            "quality_rules_count": len(table.quality_rules),
            "enrichment_joins_count": len(table.enrichment_joins),
            "row_count": table.row_count,
            "last_updated": table.last_updated,
            "quality_pass_rate_pct": table.quality_pass_rate,
        })
    return APIResponse(success=True, data={"tables": tables, "total": len(tables)})


@app.get("/api/v1/lakehouse/silver/{table_name:path}")
async def get_silver_transformation(table_name: str):
    """
    Return full transformation details for a Silver layer table:
    bronze sources, dedup rule, quality rules, enrichment joins, schema diff, Spark job.
    """
    if not table_name.startswith("silver."):
        table_name = f"silver.{table_name}"

    table = silver._tables.get(table_name)
    if not table:
        raise HTTPException(status_code=404, detail=f"Silver table '{table_name}' not found")

    # Find the Spark ETL job that produces this table
    spark_job = None
    for job in spark_etl._jobs.values():
        if job.target_layer == "silver" and table_name.split(".")[-1] in job.name.lower():
            spark_job = job.to_dict()
            break

    # Build schema diff (simulated — in production from Delta Lake DESCRIBE HISTORY)
    bronze_schema = _build_bronze_schema(table.bronze_sources[0] if table.bronze_sources else "")
    silver_schema = _build_silver_schema(table_name)

    return APIResponse(
        success=True,
        data={
            "table_name": table_name,
            "description": table.description,
            "bronze_sources": table.bronze_sources,
            "dedup_rule": {
                "merge_key": table.merge_key,
                "strategy": "MERGE_UPSERT",
                "partition_by": table.partition_by,
                "primary_key": table.primary_key,
            },
            "quality_rules": table.quality_rules,
            "quality_pass_rate_pct": table.quality_pass_rate,
            "enrichment_joins": table.enrichment_joins,
            "schema_diff": {
                "bronze_columns": bronze_schema,
                "silver_columns": silver_schema,
                "added_columns": [c["name"] for c in silver_schema
                                  if c["name"] not in {b["name"] for b in bronze_schema}],
                "removed_columns": [],
            },
            "spark_job": spark_job,
            "row_count": table.row_count,
            "last_updated": table.last_updated,
        },
    )


def _build_bronze_schema(source: str) -> list:
    """Return a representative Bronze schema for a given source table."""
    base = [
        {"name": "ingestion_id", "type": "STRING", "nullable": False, "description": "Unique ingestion record ID"},
        {"name": "ingested_at", "type": "TIMESTAMP", "nullable": False, "description": "Ingestion timestamp (UTC)"},
        {"name": "source_topic", "type": "STRING", "nullable": False, "description": "Kafka topic source"},
        {"name": "partition_date", "type": "DATE", "nullable": False, "description": "Partition date"},
        {"name": "raw_payload", "type": "STRING", "nullable": True, "description": "Raw JSON payload"},
    ]
    if "orders" in source:
        base += [
            {"name": "order_id", "type": "STRING", "nullable": False, "description": "Matching engine order UUID"},
            {"name": "account_id", "type": "STRING", "nullable": False, "description": "Trader account ID"},
            {"name": "symbol", "type": "STRING", "nullable": False, "description": "Instrument symbol"},
            {"name": "side", "type": "STRING", "nullable": False, "description": "BUY or SELL"},
            {"name": "order_type", "type": "STRING", "nullable": False, "description": "LIMIT, MARKET, etc."},
            {"name": "price", "type": "DECIMAL(18,6)", "nullable": True, "description": "Limit price"},
            {"name": "quantity", "type": "DECIMAL(18,6)", "nullable": False, "description": "Order quantity"},
            {"name": "status", "type": "STRING", "nullable": False, "description": "Order status"},
            {"name": "timestamp_us", "type": "BIGINT", "nullable": False, "description": "Microsecond timestamp"},
        ]
    elif "trades" in source:
        base += [
            {"name": "trade_id", "type": "STRING", "nullable": False, "description": "Trade UUID"},
            {"name": "symbol", "type": "STRING", "nullable": False, "description": "Instrument symbol"},
            {"name": "buyer_order_id", "type": "STRING", "nullable": False, "description": "Buyer order UUID"},
            {"name": "seller_order_id", "type": "STRING", "nullable": False, "description": "Seller order UUID"},
            {"name": "price", "type": "DECIMAL(18,6)", "nullable": False, "description": "Execution price"},
            {"name": "quantity", "type": "DECIMAL(18,6)", "nullable": False, "description": "Execution quantity"},
            {"name": "timestamp_us", "type": "BIGINT", "nullable": False, "description": "Microsecond timestamp"},
        ]
    elif "settlement" in source:
        base += [
            {"name": "settlement_id", "type": "STRING", "nullable": False, "description": "Settlement UUID"},
            {"name": "trade_id", "type": "STRING", "nullable": False, "description": "Linked trade UUID"},
            {"name": "amount", "type": "DECIMAL(18,6)", "nullable": False, "description": "Settlement amount"},
            {"name": "currency", "type": "STRING", "nullable": False, "description": "Settlement currency"},
            {"name": "status", "type": "STRING", "nullable": False, "description": "Settlement status"},
        ]
    return base


def _build_silver_schema(table_name: str) -> list:
    """Return a representative Silver schema with enrichment columns added."""
    base = [
        {"name": "surrogate_key", "type": "STRING", "nullable": False, "description": "SHA-256 dedup key"},
        {"name": "effective_from", "type": "TIMESTAMP", "nullable": False, "description": "SCD2 effective start"},
        {"name": "effective_to", "type": "TIMESTAMP", "nullable": True, "description": "SCD2 effective end (NULL = current)"},
        {"name": "is_current", "type": "BOOLEAN", "nullable": False, "description": "SCD2 current flag"},
        {"name": "dq_passed", "type": "BOOLEAN", "nullable": False, "description": "Data quality check result"},
        {"name": "dq_score", "type": "FLOAT", "nullable": False, "description": "Data quality score (0-1)"},
        {"name": "partition_date", "type": "DATE", "nullable": False, "description": "Partition date"},
    ]
    if "trades" in table_name:
        base += [
            {"name": "trade_id", "type": "STRING", "nullable": False, "description": "Deduplicated trade UUID"},
            {"name": "symbol", "type": "STRING", "nullable": False, "description": "Instrument symbol"},
            {"name": "price", "type": "DECIMAL(18,6)", "nullable": False, "description": "Execution price"},
            {"name": "quantity", "type": "DECIMAL(18,6)", "nullable": False, "description": "Execution quantity"},
            {"name": "notional_usd", "type": "DECIMAL(18,2)", "nullable": False, "description": "Notional value in USD (enriched)"},
            {"name": "buyer_account_id", "type": "STRING", "nullable": False, "description": "Buyer account"},
            {"name": "seller_account_id", "type": "STRING", "nullable": False, "description": "Seller account"},
            {"name": "contract_multiplier", "type": "DECIMAL(10,4)", "nullable": True, "description": "From reference.contract_specs (enriched)"},
            {"name": "trade_timestamp", "type": "TIMESTAMP", "nullable": False, "description": "Trade execution time (UTC)"},
        ]
    elif "orders" in table_name:
        base += [
            {"name": "order_id", "type": "STRING", "nullable": False, "description": "Deduplicated order UUID"},
            {"name": "account_id", "type": "STRING", "nullable": False, "description": "Trader account"},
            {"name": "symbol", "type": "STRING", "nullable": False, "description": "Instrument symbol"},
            {"name": "side", "type": "STRING", "nullable": False, "description": "BUY or SELL"},
            {"name": "order_type", "type": "STRING", "nullable": False, "description": "Order type"},
            {"name": "price", "type": "DECIMAL(18,6)", "nullable": True, "description": "Limit price"},
            {"name": "quantity", "type": "DECIMAL(18,6)", "nullable": False, "description": "Order quantity"},
            {"name": "status", "type": "STRING", "nullable": False, "description": "Latest order status"},
            {"name": "fill_rate_pct", "type": "FLOAT", "nullable": False, "description": "Fill percentage (enriched)"},
        ]
    return base


@app.get("/api/v1/lakehouse/gold/health")
async def gold_layer_health():
    """
    Gold layer health monitor: row counts, null rates, freshness, and
    feature store statistics per Gold table.
    """
    import time, random, datetime

    gold_tables = [
        {
            "name": "gold.market_summary",
            "description": "OHLCV aggregates per symbol per interval",
            "source_silver": ["silver.trades", "silver.orders"],
            "refresh_interval": "5m",
            "primary_keys": ["symbol", "interval", "window_start"],
        },
        {
            "name": "gold.trade_analytics",
            "description": "Trade-level analytics: notional, spread, market impact",
            "source_silver": ["silver.trades", "silver.clearing"],
            "refresh_interval": "1m",
            "primary_keys": ["trade_id"],
        },
        {
            "name": "gold.risk_metrics",
            "description": "Portfolio VaR, CVaR, margin utilization per account",
            "source_silver": ["silver.positions", "silver.risk_metrics", "silver.clearing"],
            "refresh_interval": "5m",
            "primary_keys": ["account_id", "snapshot_time"],
        },
        {
            "name": "gold.feature_store",
            "description": "ML feature vectors for LSTM, GNN, and risk scoring models",
            "source_silver": ["silver.trades", "silver.orders", "silver.positions", "silver.alternative", "silver.risk_metrics"],
            "refresh_interval": "1h",
            "primary_keys": ["symbol", "feature_timestamp"],
        },
        {
            "name": "gold.settlement_summary",
            "description": "Daily settlement P&L, margin calls, and delivery obligations",
            "source_silver": ["silver.clearing", "silver.positions"],
            "refresh_interval": "1d",
            "primary_keys": ["account_id", "settlement_date"],
        },
        {
            "name": "gold.geospatial_enriched",
            "description": "Supply chain analytics: NDVI, weather, port congestion, warehouse utilization",
            "source_silver": ["silver.alternative", "silver.iot_anomalies"],
            "refresh_interval": "1h",
            "primary_keys": ["region_id", "snapshot_time"],
        },
    ]

    now = datetime.datetime.utcnow()
    tables_health = []
    for t in gold_tables:
        # Simulate realistic health metrics (in production these come from Delta Lake table stats)
        row_count = random.randint(50_000, 5_000_000)
        null_rate_pct = round(random.uniform(0.0, 2.5), 2)
        last_updated_ago_min = random.randint(1, 30)
        last_updated = (now - datetime.timedelta(minutes=last_updated_ago_min)).strftime("%Y-%m-%dT%H:%M:%SZ")
        size_mb = round(row_count * random.uniform(0.0005, 0.002), 1)
        partition_count = random.randint(5, 120)
        stale = last_updated_ago_min > 60

        # Derive freshness status from refresh interval
        interval_str = t["refresh_interval"]
        if interval_str.endswith("m"):
            threshold_min = int(interval_str[:-1]) * 3  # warn if 3x overdue
        elif interval_str.endswith("h"):
            threshold_min = int(interval_str[:-1]) * 60 * 3
        else:
            threshold_min = 24 * 60 * 3  # daily

        freshness_status = "fresh" if last_updated_ago_min <= threshold_min else "stale"

        tables_health.append({
            "name": t["name"],
            "description": t["description"],
            "source_silver": t["source_silver"],
            "refresh_interval": t["refresh_interval"],
            "primary_keys": t["primary_keys"],
            "row_count": row_count,
            "null_rate_pct": null_rate_pct,
            "size_mb": size_mb,
            "partition_count": partition_count,
            "last_updated": last_updated,
            "last_updated_ago_min": last_updated_ago_min,
            "freshness_status": freshness_status,
            "is_stale": stale,
        })

    # Feature store summary
    feature_store_summary = {
        "total_features": 87,
        "categories": {
            "price_features": 12,
            "volume_features": 8,
            "microstructure_features": 10,
            "risk_features": 8,
            "sentiment_features": 10,
            "geospatial_features": 10,
            "technical_indicators": 15,
            "macro_features": 14,
        },
        "last_recomputed": (now - datetime.timedelta(minutes=random.randint(5, 90))).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "coverage_symbols": 47,
    }

    total_rows = sum(t["row_count"] for t in tables_health)
    stale_count = sum(1 for t in tables_health if t["is_stale"])
    overall_health = "healthy" if stale_count == 0 else ("degraded" if stale_count < 3 else "critical")

    return {
        "overall_health": overall_health,
        "stale_tables": stale_count,
        "total_tables": len(tables_health),
        "total_rows": total_rows,
        "tables": tables_health,
        "feature_store": feature_store_summary,
        "checked_at": now.strftime("%Y-%m-%dT%H:%M:%SZ"),
    }
