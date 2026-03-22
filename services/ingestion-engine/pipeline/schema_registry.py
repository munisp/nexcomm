"""
Schema Registry — Manages Avro/JSON schemas for all 38 data feeds.
Provides schema validation, version management, and compatibility checking.

Every message flowing through the Universal Ingestion Engine is validated
against its registered schema before being written to the Lakehouse.

Schema Compatibility Rules:
  - BACKWARD: New schema can read old data (default)
  - FORWARD: Old schema can read new data
  - FULL: Both backward and forward compatible
  - NONE: No compatibility checking (use with caution)
"""

import logging
from datetime import datetime, timezone
from typing import Optional

logger = logging.getLogger("ingestion-engine.schema-registry")


class SchemaVersion:
    """A versioned schema definition."""

    def __init__(
        self,
        schema_name: str,
        version: int,
        fields: list[dict],
        description: str,
        compatibility: str = "BACKWARD",
    ):
        self.schema_name = schema_name
        self.version = version
        self.fields = fields
        self.description = description
        self.compatibility = compatibility
        self.created_at = datetime.now(timezone.utc).isoformat()

    def to_dict(self) -> dict:
        return {
            "schema_name": self.schema_name,
            "version": self.version,
            "fields": self.fields,
            "field_count": len(self.fields),
            "description": self.description,
            "compatibility": self.compatibility,
            "created_at": self.created_at,
        }


class SchemaRegistry:
    """Central schema registry for all ingestion feed schemas."""

    def __init__(self):
        self._schemas: dict[str, list[SchemaVersion]] = {}
        self._register_all_schemas()
        logger.info(f"Schema registry initialized: {self.schema_count()} schemas")

    def _register_all_schemas(self):
        """Register schemas for all 38 data feeds."""

        # ── Internal Exchange Schemas ────────────────────────────────
        self._register(SchemaVersion(
            schema_name="order_event_v1",
            version=1,
            description="Order lifecycle events from matching engine",
            fields=[
                {"name": "event_id", "type": "string", "required": True, "description": "UUID v7 event identifier"},
                {"name": "event_type", "type": "string", "required": True, "description": "NEW|AMEND|CANCEL|FILL|PARTIAL_FILL|REJECT"},
                {"name": "order_id", "type": "string", "required": True, "description": "UUID v7 order identifier"},
                {"name": "client_order_id", "type": "string", "required": True, "description": "Client-assigned order ID"},
                {"name": "account_id", "type": "string", "required": True, "description": "Trading account identifier"},
                {"name": "symbol", "type": "string", "required": True, "description": "Contract symbol (e.g., GOLD-2026-06)"},
                {"name": "side", "type": "string", "required": True, "description": "BUY|SELL"},
                {"name": "order_type", "type": "string", "required": True, "description": "MARKET|LIMIT|STOP|STOP_LIMIT"},
                {"name": "price", "type": "int64", "required": False, "description": "Price in fixed-point (8 decimals)"},
                {"name": "quantity", "type": "int64", "required": True, "description": "Order quantity in lots"},
                {"name": "filled_quantity", "type": "int64", "required": False, "description": "Cumulative filled quantity"},
                {"name": "remaining_quantity", "type": "int64", "required": False, "description": "Remaining unfilled quantity"},
                {"name": "time_in_force", "type": "string", "required": True, "description": "GTC|IOC|FOK|DAY"},
                {"name": "timestamp_ns", "type": "int64", "required": True, "description": "Event timestamp (nanoseconds since epoch)"},
                {"name": "sequence_number", "type": "int64", "required": True, "description": "Monotonic sequence number"},
            ],
        ))

        self._register(SchemaVersion(
            schema_name="trade_event_v1",
            version=1,
            description="Matched trade execution events",
            fields=[
                {"name": "trade_id", "type": "string", "required": True, "description": "UUID v7 trade identifier"},
                {"name": "symbol", "type": "string", "required": True, "description": "Contract symbol"},
                {"name": "buyer_account", "type": "string", "required": True, "description": "Buyer account ID"},
                {"name": "seller_account", "type": "string", "required": True, "description": "Seller account ID"},
                {"name": "buyer_order_id", "type": "string", "required": True, "description": "Buyer order ID"},
                {"name": "seller_order_id", "type": "string", "required": True, "description": "Seller order ID"},
                {"name": "price", "type": "int64", "required": True, "description": "Execution price (fixed-point i64, 8 decimals)"},
                {"name": "quantity", "type": "int64", "required": True, "description": "Trade quantity in lots"},
                {"name": "aggressor_side", "type": "string", "required": True, "description": "BUY|SELL — which side was the taker"},
                {"name": "timestamp_ns", "type": "int64", "required": True, "description": "Trade timestamp (nanoseconds)"},
                {"name": "sequence_number", "type": "int64", "required": True, "description": "Monotonic sequence number"},
            ],
        ))

        self._register(SchemaVersion(
            schema_name="orderbook_snapshot_v1",
            version=1,
            description="L2/L3 orderbook depth snapshots",
            fields=[
                {"name": "symbol", "type": "string", "required": True},
                {"name": "snapshot_type", "type": "string", "required": True, "description": "L2|L3"},
                {"name": "bids", "type": "array<{price:int64, quantity:int64, count:int32}>", "required": True},
                {"name": "asks", "type": "array<{price:int64, quantity:int64, count:int32}>", "required": True},
                {"name": "timestamp_ns", "type": "int64", "required": True},
                {"name": "sequence_number", "type": "int64", "required": True},
            ],
        ))

        self._register(SchemaVersion(
            schema_name="circuit_breaker_v1",
            version=1,
            description="Circuit breaker trigger events",
            fields=[
                {"name": "event_id", "type": "string", "required": True},
                {"name": "symbol", "type": "string", "required": True},
                {"name": "trigger_type", "type": "string", "required": True, "description": "UPPER_LIMIT|LOWER_LIMIT|VOLATILITY"},
                {"name": "trigger_price", "type": "int64", "required": True},
                {"name": "reference_price", "type": "int64", "required": True},
                {"name": "halt_duration_sec", "type": "int32", "required": True},
                {"name": "timestamp_ns", "type": "int64", "required": True},
            ],
        ))

        self._register(SchemaVersion(
            schema_name="clearing_position_v1",
            version=1,
            description="CCP clearing position updates after novation",
            fields=[
                {"name": "position_id", "type": "string", "required": True},
                {"name": "account_id", "type": "string", "required": True},
                {"name": "symbol", "type": "string", "required": True},
                {"name": "side", "type": "string", "required": True, "description": "LONG|SHORT"},
                {"name": "net_quantity", "type": "int64", "required": True},
                {"name": "average_price", "type": "int64", "required": True},
                {"name": "unrealized_pnl", "type": "int64", "required": True},
                {"name": "initial_margin", "type": "int64", "required": True},
                {"name": "maintenance_margin", "type": "int64", "required": True},
                {"name": "timestamp_ns", "type": "int64", "required": True},
            ],
        ))

        self._register(SchemaVersion(
            schema_name="margin_settlement_v1",
            version=1,
            description="SPAN margin calculations and settlement events",
            fields=[
                {"name": "event_id", "type": "string", "required": True},
                {"name": "event_type", "type": "string", "required": True, "description": "MARGIN_CALC|MARGIN_CALL|VARIATION_MARGIN|GF_CONTRIBUTION"},
                {"name": "account_id", "type": "string", "required": True},
                {"name": "scanning_risk", "type": "int64", "required": False},
                {"name": "initial_margin", "type": "int64", "required": False},
                {"name": "maintenance_margin", "type": "int64", "required": False},
                {"name": "amount", "type": "int64", "required": True},
                {"name": "currency", "type": "string", "required": True, "description": "USD|KES|EUR|GBP"},
                {"name": "timestamp_ns", "type": "int64", "required": True},
            ],
        ))

        self._register(SchemaVersion(
            schema_name="surveillance_alert_v1",
            version=1,
            description="Market abuse detection alerts",
            fields=[
                {"name": "alert_id", "type": "string", "required": True},
                {"name": "alert_type", "type": "string", "required": True, "description": "SPOOFING|WASH_TRADE|LAYERING|POSITION_LIMIT|UNUSUAL_VOLUME"},
                {"name": "severity", "type": "string", "required": True, "description": "CRITICAL|HIGH|MEDIUM|LOW"},
                {"name": "account_id", "type": "string", "required": True},
                {"name": "symbol", "type": "string", "required": False},
                {"name": "evidence", "type": "string", "required": True, "description": "JSON evidence payload"},
                {"name": "detection_model", "type": "string", "required": True},
                {"name": "resolution_status", "type": "string", "required": True, "description": "OPEN|INVESTIGATING|RESOLVED|ESCALATED"},
                {"name": "timestamp_ns", "type": "int64", "required": True},
            ],
        ))

        self._register(SchemaVersion(
            schema_name="audit_entry_v1",
            version=1,
            description="WORM immutable audit trail entries",
            fields=[
                {"name": "sequence_number", "type": "int64", "required": True},
                {"name": "entry_type", "type": "string", "required": True},
                {"name": "payload", "type": "string", "required": True, "description": "JSON event payload"},
                {"name": "checksum", "type": "string", "required": True, "description": "SHA-256 chain checksum"},
                {"name": "previous_checksum", "type": "string", "required": True},
                {"name": "timestamp_ns", "type": "int64", "required": True},
            ],
        ))

        self._register(SchemaVersion(
            schema_name="fix_message_v1",
            version=1,
            description="FIX 4.4 protocol messages",
            fields=[
                {"name": "message_id", "type": "string", "required": True},
                {"name": "msg_type", "type": "string", "required": True, "description": "FIX MsgType (35=)"},
                {"name": "sender_comp_id", "type": "string", "required": True},
                {"name": "target_comp_id", "type": "string", "required": True},
                {"name": "msg_seq_num", "type": "int64", "required": True},
                {"name": "raw_message", "type": "string", "required": True},
                {"name": "timestamp_ns", "type": "int64", "required": True},
            ],
        ))

        self._register(SchemaVersion(
            schema_name="delivery_event_v1",
            version=1,
            description="Physical delivery and warehouse receipt events",
            fields=[
                {"name": "event_id", "type": "string", "required": True},
                {"name": "event_type", "type": "string", "required": True, "description": "RECEIPT_ISSUED|RECEIPT_TRANSFERRED|DELIVERY_INTENT|DELIVERY_ASSIGNED|DELIVERY_COMPLETE"},
                {"name": "receipt_id", "type": "string", "required": False},
                {"name": "warehouse_id", "type": "string", "required": True},
                {"name": "commodity", "type": "string", "required": True},
                {"name": "grade", "type": "string", "required": True},
                {"name": "quantity_mt", "type": "float64", "required": True},
                {"name": "owner_account", "type": "string", "required": True},
                {"name": "timestamp", "type": "string", "required": True},
            ],
        ))

        self._register(SchemaVersion(
            schema_name="ha_replication_v1",
            version=1,
            description="HA replication and failover events",
            fields=[
                {"name": "event_type", "type": "string", "required": True, "description": "HEARTBEAT|STATE_SYNC|FAILOVER|PROMOTE|DEMOTE"},
                {"name": "node_id", "type": "string", "required": True},
                {"name": "role", "type": "string", "required": True, "description": "PRIMARY|STANDBY"},
                {"name": "sequence_number", "type": "int64", "required": True},
                {"name": "state_hash", "type": "string", "required": False},
                {"name": "timestamp_ns", "type": "int64", "required": True},
            ],
        ))

        self._register(SchemaVersion(
            schema_name="ledger_event_v1",
            version=1,
            description="TigerBeetle financial ledger events",
            fields=[
                {"name": "transfer_id", "type": "string", "required": True},
                {"name": "debit_account", "type": "string", "required": True},
                {"name": "credit_account", "type": "string", "required": True},
                {"name": "amount", "type": "int64", "required": True},
                {"name": "currency_code", "type": "int32", "required": True},
                {"name": "ledger", "type": "int32", "required": True},
                {"name": "transfer_type", "type": "string", "required": True, "description": "SETTLEMENT|MARGIN|FEE|COLLATERAL"},
                {"name": "pending", "type": "boolean", "required": True},
                {"name": "timestamp", "type": "int64", "required": True},
            ],
        ))

        # ── External Market Data Schemas ─────────────────────────────
        self._register(SchemaVersion(
            schema_name="cme_mdp3_v1",
            version=1,
            description="CME Group MDP 3.0 market data",
            fields=[
                {"name": "symbol", "type": "string", "required": True},
                {"name": "msg_type", "type": "string", "required": True, "description": "TRADE|BID|ASK|SETTLEMENT|OPEN_INTEREST"},
                {"name": "price", "type": "int64", "required": True},
                {"name": "quantity", "type": "int64", "required": False},
                {"name": "rpt_seq", "type": "int64", "required": True},
                {"name": "sending_time", "type": "int64", "required": True},
            ],
        ))

        self._register(SchemaVersion(
            schema_name="ice_impact_v1",
            version=1,
            description="ICE iMpact market data",
            fields=[
                {"name": "symbol", "type": "string", "required": True},
                {"name": "msg_type", "type": "string", "required": True},
                {"name": "price", "type": "int64", "required": True},
                {"name": "quantity", "type": "int64", "required": False},
                {"name": "sequence", "type": "int64", "required": True},
                {"name": "timestamp", "type": "int64", "required": True},
            ],
        ))

        self._register(SchemaVersion(
            schema_name="lme_market_data_v1",
            version=1,
            description="LME LMEselect market data",
            fields=[
                {"name": "symbol", "type": "string", "required": True},
                {"name": "bid", "type": "int64", "required": False},
                {"name": "ask", "type": "int64", "required": False},
                {"name": "last", "type": "int64", "required": False},
                {"name": "volume", "type": "int64", "required": False},
                {"name": "open_interest", "type": "int64", "required": False},
                {"name": "cash_price", "type": "int64", "required": False},
                {"name": "three_month_price", "type": "int64", "required": False},
                {"name": "timestamp", "type": "int64", "required": True},
            ],
        ))

        for schema_name in [
            "shfe_smdp_v1", "mcx_broadcast_v1", "reuters_elektron_v1",
            "bloomberg_bpipe_v1", "central_bank_rate_v1",
        ]:
            self._register(SchemaVersion(
                schema_name=schema_name,
                version=1,
                description=f"Market data schema: {schema_name}",
                fields=[
                    {"name": "symbol", "type": "string", "required": True},
                    {"name": "price", "type": "int64", "required": True},
                    {"name": "timestamp", "type": "int64", "required": True},
                    {"name": "source", "type": "string", "required": True},
                    {"name": "metadata", "type": "string", "required": False},
                ],
            ))

        # ── Alternative Data Schemas ─────────────────────────────────
        self._register(SchemaVersion(
            schema_name="satellite_imagery_v1",
            version=1,
            description="Satellite imagery and NDVI data",
            fields=[
                {"name": "image_id", "type": "string", "required": True},
                {"name": "source", "type": "string", "required": True, "description": "PLANET|SENTINEL2"},
                {"name": "region", "type": "string", "required": True},
                {"name": "bbox", "type": "array<float64>", "required": True, "description": "[min_lon, min_lat, max_lon, max_lat]"},
                {"name": "ndvi_mean", "type": "float64", "required": False},
                {"name": "ndvi_std", "type": "float64", "required": False},
                {"name": "cloud_cover_pct", "type": "float64", "required": True},
                {"name": "resolution_m", "type": "float64", "required": True},
                {"name": "capture_date", "type": "string", "required": True},
                {"name": "storage_path", "type": "string", "required": True},
            ],
        ))

        self._register(SchemaVersion(
            schema_name="weather_data_v1",
            version=1,
            description="Weather and climate forecast data",
            fields=[
                {"name": "station_id", "type": "string", "required": False},
                {"name": "latitude", "type": "float64", "required": True},
                {"name": "longitude", "type": "float64", "required": True},
                {"name": "temperature_c", "type": "float64", "required": True},
                {"name": "precipitation_mm", "type": "float64", "required": True},
                {"name": "humidity_pct", "type": "float64", "required": True},
                {"name": "wind_speed_ms", "type": "float64", "required": True},
                {"name": "soil_moisture", "type": "float64", "required": False},
                {"name": "forecast_source", "type": "string", "required": True, "description": "GFS|ECMWF|LOCAL"},
                {"name": "valid_time", "type": "string", "required": True},
                {"name": "forecast_hour", "type": "int32", "required": True},
            ],
        ))

        self._register(SchemaVersion(
            schema_name="ais_position_v1",
            version=1,
            description="AIS vessel position and tracking data",
            fields=[
                {"name": "mmsi", "type": "string", "required": True, "description": "Maritime Mobile Service Identity"},
                {"name": "vessel_name", "type": "string", "required": False},
                {"name": "vessel_type", "type": "string", "required": True, "description": "TANKER|BULK_CARRIER|CONTAINER"},
                {"name": "latitude", "type": "float64", "required": True},
                {"name": "longitude", "type": "float64", "required": True},
                {"name": "speed_knots", "type": "float64", "required": True},
                {"name": "heading_deg", "type": "float64", "required": True},
                {"name": "draft_m", "type": "float64", "required": False, "description": "Vessel draft (cargo load indicator)"},
                {"name": "destination", "type": "string", "required": False},
                {"name": "eta", "type": "string", "required": False},
                {"name": "timestamp", "type": "int64", "required": True},
            ],
        ))

        self._register(SchemaVersion(
            schema_name="news_article_v1",
            version=1,
            description="News articles with NLP-extracted features",
            fields=[
                {"name": "article_id", "type": "string", "required": True},
                {"name": "source", "type": "string", "required": True},
                {"name": "title", "type": "string", "required": True},
                {"name": "body", "type": "string", "required": True},
                {"name": "commodities_mentioned", "type": "array<string>", "required": False},
                {"name": "sentiment_score", "type": "float64", "required": False, "description": "-1.0 (bearish) to +1.0 (bullish)"},
                {"name": "named_entities", "type": "string", "required": False, "description": "JSON array of NER results"},
                {"name": "event_type", "type": "string", "required": False, "description": "SUPPLY_DISRUPTION|POLICY_CHANGE|WEATHER|GEOPOLITICAL"},
                {"name": "published_at", "type": "string", "required": True},
            ],
        ))

        self._register(SchemaVersion(
            schema_name="social_post_v1",
            version=1,
            description="Social media posts with sentiment",
            fields=[
                {"name": "post_id", "type": "string", "required": True},
                {"name": "platform", "type": "string", "required": True, "description": "TWITTER|REDDIT|TELEGRAM"},
                {"name": "author", "type": "string", "required": True},
                {"name": "content", "type": "string", "required": True},
                {"name": "sentiment_score", "type": "float64", "required": False},
                {"name": "commodities_mentioned", "type": "array<string>", "required": False},
                {"name": "engagement_count", "type": "int32", "required": False},
                {"name": "timestamp", "type": "string", "required": True},
            ],
        ))

        self._register(SchemaVersion(
            schema_name="blockchain_event_v1",
            version=1,
            description="On-chain blockchain events",
            fields=[
                {"name": "tx_hash", "type": "string", "required": True},
                {"name": "block_number", "type": "int64", "required": True},
                {"name": "chain", "type": "string", "required": True, "description": "ETHEREUM|POLYGON|HYPERLEDGER"},
                {"name": "contract_address", "type": "string", "required": True},
                {"name": "event_name", "type": "string", "required": True, "description": "MINT|BURN|TRANSFER|DEPOSIT|RELEASE"},
                {"name": "token_id", "type": "string", "required": False},
                {"name": "from_address", "type": "string", "required": True},
                {"name": "to_address", "type": "string", "required": True},
                {"name": "amount", "type": "string", "required": True},
                {"name": "timestamp", "type": "int64", "required": True},
            ],
        ))

        # ── Regulatory Schemas ───────────────────────────────────────
        self._register(SchemaVersion(
            schema_name="cftc_cot_v1",
            version=1,
            description="CFTC Commitments of Traders report",
            fields=[
                {"name": "report_date", "type": "string", "required": True},
                {"name": "commodity", "type": "string", "required": True},
                {"name": "exchange", "type": "string", "required": True},
                {"name": "commercial_long", "type": "int64", "required": True},
                {"name": "commercial_short", "type": "int64", "required": True},
                {"name": "managed_money_long", "type": "int64", "required": True},
                {"name": "managed_money_short", "type": "int64", "required": True},
                {"name": "swap_dealer_long", "type": "int64", "required": True},
                {"name": "swap_dealer_short", "type": "int64", "required": True},
                {"name": "open_interest", "type": "int64", "required": True},
            ],
        ))

        for schema_name in [
            "transaction_report_v1", "sanctions_entry_v1",
            "position_limit_update_v1",
        ]:
            self._register(SchemaVersion(
                schema_name=schema_name,
                version=1,
                description=f"Regulatory schema: {schema_name}",
                fields=[
                    {"name": "record_id", "type": "string", "required": True},
                    {"name": "record_type", "type": "string", "required": True},
                    {"name": "payload", "type": "string", "required": True},
                    {"name": "source", "type": "string", "required": True},
                    {"name": "effective_date", "type": "string", "required": True},
                    {"name": "timestamp", "type": "string", "required": True},
                ],
            ))

        # ── IoT / Physical Schemas ───────────────────────────────────
        self._register(SchemaVersion(
            schema_name="warehouse_sensor_v1",
            version=1,
            description="Warehouse IoT sensor readings",
            fields=[
                {"name": "sensor_id", "type": "string", "required": True},
                {"name": "warehouse_id", "type": "string", "required": True},
                {"name": "sensor_type", "type": "string", "required": True, "description": "TEMPERATURE|HUMIDITY|WEIGHT|DOOR|SMOKE|PEST"},
                {"name": "value", "type": "float64", "required": True},
                {"name": "unit", "type": "string", "required": True},
                {"name": "latitude", "type": "float64", "required": False},
                {"name": "longitude", "type": "float64", "required": False},
                {"name": "battery_pct", "type": "float64", "required": False},
                {"name": "timestamp", "type": "int64", "required": True},
            ],
        ))

        self._register(SchemaVersion(
            schema_name="fleet_gps_v1",
            version=1,
            description="Fleet GPS tracking telemetry",
            fields=[
                {"name": "vehicle_id", "type": "string", "required": True},
                {"name": "latitude", "type": "float64", "required": True},
                {"name": "longitude", "type": "float64", "required": True},
                {"name": "speed_kmh", "type": "float64", "required": True},
                {"name": "heading_deg", "type": "float64", "required": True},
                {"name": "fuel_level_pct", "type": "float64", "required": False},
                {"name": "cargo_temp_c", "type": "float64", "required": False},
                {"name": "eta_minutes", "type": "int32", "required": False},
                {"name": "geofence_status", "type": "string", "required": False},
                {"name": "timestamp", "type": "int64", "required": True},
            ],
        ))

        for schema_name in ["port_throughput_v1", "quality_test_v1"]:
            self._register(SchemaVersion(
                schema_name=schema_name,
                version=1,
                description=f"IoT/Physical schema: {schema_name}",
                fields=[
                    {"name": "record_id", "type": "string", "required": True},
                    {"name": "location_id", "type": "string", "required": True},
                    {"name": "record_type", "type": "string", "required": True},
                    {"name": "payload", "type": "string", "required": True},
                    {"name": "latitude", "type": "float64", "required": False},
                    {"name": "longitude", "type": "float64", "required": False},
                    {"name": "timestamp", "type": "string", "required": True},
                ],
            ))

        # ── Reference Data Schemas ───────────────────────────────────
        self._register(SchemaVersion(
            schema_name="contract_spec_v1",
            version=1,
            description="Contract specifications master data",
            fields=[
                {"name": "symbol", "type": "string", "required": True},
                {"name": "commodity_class", "type": "string", "required": True},
                {"name": "tick_size", "type": "int64", "required": True},
                {"name": "lot_size", "type": "int64", "required": True},
                {"name": "contract_multiplier", "type": "float64", "required": True},
                {"name": "margin_pct", "type": "float64", "required": True},
                {"name": "daily_price_limit_pct", "type": "float64", "required": True},
                {"name": "settlement_method", "type": "string", "required": True, "description": "CASH|PHYSICAL"},
                {"name": "last_trading_day", "type": "string", "required": True},
                {"name": "delivery_start", "type": "string", "required": False},
                {"name": "delivery_end", "type": "string", "required": False},
                {"name": "effective_date", "type": "string", "required": True},
            ],
        ))

        for schema_name in [
            "calendar_entry_v1", "margin_param_v1", "corporate_action_v1",
        ]:
            self._register(SchemaVersion(
                schema_name=schema_name,
                version=1,
                description=f"Reference data schema: {schema_name}",
                fields=[
                    {"name": "record_id", "type": "string", "required": True},
                    {"name": "record_type", "type": "string", "required": True},
                    {"name": "payload", "type": "string", "required": True},
                    {"name": "effective_date", "type": "string", "required": True},
                    {"name": "source", "type": "string", "required": True},
                    {"name": "timestamp", "type": "string", "required": True},
                ],
            ))

    def _register(self, schema: SchemaVersion):
        if schema.schema_name not in self._schemas:
            self._schemas[schema.schema_name] = []
        self._schemas[schema.schema_name].append(schema)

    def schema_count(self) -> int:
        return len(self._schemas)

    def list_schemas(self) -> list[dict]:
        result = []
        for name, versions in sorted(self._schemas.items()):
            latest = versions[-1]
            result.append({
                **latest.to_dict(),
                "versions_count": len(versions),
            })
        return result

    def get_schema(self, name: str, version: Optional[int] = None) -> Optional[SchemaVersion]:
        versions = self._schemas.get(name)
        if not versions:
            return None
        if version is None:
            return versions[-1]  # latest
        for v in versions:
            if v.version == version:
                return v
        return None

    def validate(self, schema_name: str, record: dict) -> tuple[bool, list[str]]:
        """Validate a record against its schema. Returns (valid, errors)."""
        schema = self.get_schema(schema_name)
        if not schema:
            return False, [f"Schema {schema_name} not found"]

        errors = []
        for field_def in schema.fields:
            if field_def.get("required") and field_def["name"] not in record:
                errors.append(f"Missing required field: {field_def['name']}")

        return len(errors) == 0, errors

    def status(self) -> str:
        return "healthy"
