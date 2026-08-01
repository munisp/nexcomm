"""
NEXCOM Exchange — Kafka Consumers for Matching Engine & Settlement Engine
=========================================================================
Consumes events from the Kafka topics published by the matching engine
(Rust) and settlement engine (Rust/TigerBeetle) and writes them to the
Lakehouse Bronze layer.

Kafka Topics consumed:
  Matching Engine (published by matching-engine Rust service):
    nexcom.order.placed          — new order accepted by the book
    nexcom.order.filled          — order fully or partially filled
    nexcom.order.cancelled       — order cancelled (user or system)
    nexcom.trade.executed        — matched trade (both sides)
    nexcom.orderbook.snapshot    — periodic L2 orderbook snapshot

  Settlement Engine (published by settlement-engine Rust service):
    nexcom.settlement.completed  — trade settled, TigerBeetle transfer posted
    nexcom.settlement.failed     — settlement failure (margin, counterparty)
    nexcom.payment.processed     — Mojaloop payment confirmed
    nexcom.clearing.margin_call  — margin call triggered
    nexcom.clearing.position_update — position delta after trade

  Risk Management (published by risk-management Go service):
    nexcom.risk.circuit_breaker  — circuit breaker triggered/reset
    nexcom.risk.limit_breach     — position/order limit breached

  Mojaloop DFSP Adapter (published by Go mojaloop-adapter service):
    mojaloop.transfer.initiated  — FSPIOP transfer created (POST /transfers)
    mojaloop.transfer.committed  — FSPIOP transfer fulfilled (PUT /callbacks/transfers/{id})
    mojaloop.transfer.aborted    — FSPIOP transfer rejected (PUT /callbacks/transfers/{id}/error)
    mojaloop.quote.accepted      — FSPIOP quote accepted (PUT /callbacks/quotes/{id})

All events are written to the Bronze layer as Parquet files, partitioned
by (date, symbol) or (date, account_id) depending on the event type.
Silver and Gold layer enrichment is triggered asynchronously via the
Flink/Spark pipeline after Bronze write.

Production note: Uses aiokafka for async Kafka consumption. Falls back to
a polling stub when KAFKA_BROKERS is not reachable (for local dev without
a running Kafka cluster).
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import time
from datetime import datetime, timezone
from typing import Any, Callable, Coroutine

logger = logging.getLogger("ingestion-engine.kafka_consumers")

KAFKA_BROKERS = os.getenv("KAFKA_BROKERS", "localhost:9092")
CONSUMER_GROUP = "nexcom-ingestion-engine"
LAKEHOUSE_BASE_PATH = os.getenv("LAKEHOUSE_BASE_PATH", "/data/lakehouse")

# ─── Topic → (bronze table path, partition key extractor) ─────────────────────
# Each entry maps a Kafka topic to:
#   - table_path: the bronze layer table (relative to bronze/)
#   - partition_key: callable(record) → str used as extra partition value
#   - description: human-readable description for logging

TOPIC_CONFIG: dict[str, dict[str, Any]] = {
    # ── Matching Engine ────────────────────────────────────────────────────────
    "nexcom.order.placed": {
        "table_path": "exchange/orders",
        "partition_key": lambda r: r.get("symbol", "UNKNOWN"),
        "description": "Order placed (new order accepted by matching engine)",
    },
    "nexcom.order.filled": {
        "table_path": "exchange/orders",
        "partition_key": lambda r: r.get("symbol", "UNKNOWN"),
        "description": "Order filled (full or partial fill)",
    },
    "nexcom.order.cancelled": {
        "table_path": "exchange/orders",
        "partition_key": lambda r: r.get("symbol", "UNKNOWN"),
        "description": "Order cancelled",
    },
    "nexcom.trade.executed": {
        "table_path": "exchange/trades",
        "partition_key": lambda r: r.get("symbol", "UNKNOWN"),
        "description": "Trade executed (matched by matching engine)",
    },
    "nexcom.orderbook.snapshot": {
        "table_path": "exchange/orderbook_snapshots",
        "partition_key": lambda r: r.get("symbol", "UNKNOWN"),
        "description": "L2 orderbook snapshot",
    },
    # ── Settlement Engine ──────────────────────────────────────────────────────
    "nexcom.settlement.completed": {
        "table_path": "clearing/ledger",
        "partition_key": lambda r: r.get("transfer_type", "settlement"),
        "description": "Settlement completed (TigerBeetle transfer posted)",
    },
    "nexcom.settlement.failed": {
        "table_path": "clearing/ledger",
        "partition_key": lambda r: "failed",
        "description": "Settlement failed",
    },
    "nexcom.payment.processed": {
        "table_path": "clearing/ledger",
        "partition_key": lambda r: "payment",
        "description": "Mojaloop payment confirmed",
    },
    "nexcom.clearing.margin_call": {
        "table_path": "clearing/margins",
        "partition_key": lambda r: r.get("account_id", "UNKNOWN"),
        "description": "Margin call triggered",
    },
    "nexcom.clearing.position_update": {
        "table_path": "clearing/positions",
        "partition_key": lambda r: r.get("account_id", "UNKNOWN"),
        "description": "Position update after trade",
    },
    # ── Risk Management ────────────────────────────────────────────────────────
    "nexcom.risk.circuit_breaker": {
        "table_path": "exchange/circuit_breakers",
        "partition_key": lambda r: r.get("symbol", "SYSTEM"),
        "description": "Circuit breaker triggered or reset",
    },
    "nexcom.risk.limit_breach": {
        "table_path": "surveillance/alerts",
        "partition_key": lambda r: r.get("alert_type", "limit_breach"),
        "description": "Position or order limit breached",
    },
    # ── Mojaloop DFSP Adapter (published by Go mojaloop-adapter service) ───────
    "mojaloop.transfer.initiated": {
        "table_path": "payments/mojaloop_transfers",
        "partition_key": lambda r: r.get("currency", "UNKNOWN"),
        "description": "Mojaloop FSPIOP transfer initiated (POST /transfers)",
    },
    "mojaloop.transfer.committed": {
        "table_path": "payments/mojaloop_transfers",
        "partition_key": lambda r: r.get("currency", "UNKNOWN"),
        "description": "Mojaloop FSPIOP transfer committed (fulfil callback received)",
    },
    "mojaloop.transfer.aborted": {
        "table_path": "payments/mojaloop_transfers",
        "partition_key": lambda r: r.get("errorCode", "UNKNOWN"),
        "description": "Mojaloop FSPIOP transfer aborted (error callback received)",
    },
    "mojaloop.quote.accepted": {
        "table_path": "payments/mojaloop_quotes",
        "partition_key": lambda r: r.get("currency", "UNKNOWN"),
        "description": "Mojaloop FSPIOP quote accepted (quote callback received)",
    },
    # ── Journey Orchestrator Events (all 20 journeys) ──────────────────────────
    "nexcom.users.onboarded": {
        "table_path": "users/onboarding_events",
        "partition_key": lambda r: r.get("farm_location", "UNKNOWN"),
        "description": "Journey 1: Farmer onboarding completed",
    },
    "nexcom.compliance.kyc_reviews": {
        "table_path": "compliance/kyc_reviews",
        "partition_key": lambda r: r.get("decision", "UNKNOWN"),
        "description": "Journey 2: KYC/AML review completed",
    },
    "nexcom.warehouse.receipts_issued": {
        "table_path": "warehouse/receipts",
        "partition_key": lambda r: r.get("commodity", "UNKNOWN"),
        "description": "Journey 3: Warehouse receipt issued",
    },
    "nexcom.listings.created": {
        "table_path": "exchange/listings",
        "partition_key": lambda r: r.get("symbol", "UNKNOWN"),
        "description": "Journey 4: Commodity listing created",
    },
    "nexcom.listings.new": {
        "table_path": "exchange/listings",
        "partition_key": lambda r: r.get("symbol", "UNKNOWN"),
        "description": "Journey 4: New listing Fluvio event",
    },
    "nexcom.trades.executed": {
        "table_path": "exchange/trades",
        "partition_key": lambda r: r.get("symbol", "UNKNOWN"),
        "description": "Journey 5: Spot trade executed",
    },
    "nexcom.trades.live": {
        "table_path": "exchange/trades_live",
        "partition_key": lambda r: r.get("symbol", "UNKNOWN"),
        "description": "Journey 5/7: Real-time trade event",
    },
    "nexcom.futures.orders": {
        "table_path": "exchange/futures_orders",
        "partition_key": lambda r: r.get("contract", "UNKNOWN"),
        "description": "Journey 7: Futures order executed",
    },
    "nexcom.risk.margin_calls": {
        "table_path": "clearing/margin_calls",
        "partition_key": lambda r: r.get("outcome", "UNKNOWN"),
        "description": "Journey 8: Margin call resolved",
    },
    "nexcom.crossborder.transfers": {
        "table_path": "payments/crossborder_transfers",
        "partition_key": lambda r: r.get("receive_currency", "UNKNOWN"),
        "description": "Journey 9: Cross-border FX transfer completed",
    },
    "nexcom.crossborder.completed": {
        "table_path": "payments/crossborder_transfers",
        "partition_key": lambda r: r.get("receive_currency", "UNKNOWN"),
        "description": "Journey 9: Cross-border FX Fluvio event",
    },
    "nexcom.funds.DEPOSIT": {
        "table_path": "payments/deposits",
        "partition_key": lambda r: r.get("channel", "UNKNOWN"),
        "description": "Journey 10: Deposit completed",
    },
    "nexcom.funds.WITHDRAWAL": {
        "table_path": "payments/withdrawals",
        "partition_key": lambda r: r.get("channel", "UNKNOWN"),
        "description": "Journey 10: Withdrawal completed",
    },
    "nexcom.ussd.trades": {
        "table_path": "channels/ussd_trades",
        "partition_key": lambda r: r.get("symbol", "UNKNOWN"),
        "description": "Journey 11: USSD mobile trade executed",
    },
    "nexcom.ussd.orders": {
        "table_path": "channels/ussd_orders",
        "partition_key": lambda r: r.get("symbol", "UNKNOWN"),
        "description": "Journey 11: USSD order submitted",
    },
    "nexcom.ussd.repayments": {
        "table_path": "banking/loan_repayments",
        "partition_key": lambda r: "repayment",
        "description": "USSD loan repayment event",
    },
    "nexcom.loans.applications": {
        "table_path": "banking/loan_applications",
        "partition_key": lambda r: r.get("decision", "UNKNOWN"),
        "description": "Journey 12: Loan application processed",
    },
    "nexcom.loans.disbursements": {
        "table_path": "banking/loan_disbursements",
        "partition_key": lambda r: "disbursed",
        "description": "Journey 13: Loan disbursed",
    },
    "nexcom.corporate_actions.processed": {
        "table_path": "exchange/corporate_actions",
        "partition_key": lambda r: r.get("action_type", "UNKNOWN"),
        "description": "Journey 14: Corporate action processed",
    },
    "nexcom.surveillance.alerts": {
        "table_path": "compliance/surveillance_alerts",
        "partition_key": lambda r: r.get("severity", "UNKNOWN"),
        "description": "Journey 15: Market surveillance alert",
    },
    "nexcom.compliance.audits": {
        "table_path": "compliance/audits",
        "partition_key": lambda r: r.get("audit_type", "UNKNOWN"),
        "description": "Journey 16: Compliance audit completed",
    },
    "nexcom.brokers.onboarded": {
        "table_path": "users/broker_onboarding",
        "partition_key": lambda r: "broker",
        "description": "Journey 17: Broker onboarding completed",
    },
    "nexcom.marketmaker.quotes": {
        "table_path": "exchange/market_maker_quotes",
        "partition_key": lambda r: r.get("symbol", "UNKNOWN"),
        "description": "Journey 18: Market maker quote submitted",
    },
    "nexcom.marketdata.quotes": {
        "table_path": "exchange/market_maker_quotes",
        "partition_key": lambda r: r.get("symbol", "UNKNOWN"),
        "description": "Journey 18: Market data quote Fluvio event",
    },
    "nexcom.regulatory.submissions": {
        "table_path": "compliance/regulatory_submissions",
        "partition_key": lambda r: r.get("regulator", "UNKNOWN"),
        "description": "Journey 19: Regulatory report submitted",
    },
    "nexcom.platform.health": {
        "table_path": "operations/platform_health",
        "partition_key": lambda r: str(r.get("overall_healthy", "unknown")),
        "description": "Journey 20: Platform health check completed",
    },
}

ALL_TOPICS = list(TOPIC_CONFIG.keys())


# ─── Bronze layer import (lazy to avoid circular imports) ─────────────────────
def _get_bronze():
    from ..lakehouse.bronze import BronzeLayerManager
    return BronzeLayerManager(LAKEHOUSE_BASE_PATH)


# ─── Main consumer class ───────────────────────────────────────────────────────
class KafkaMatchingSettlementConsumer:
    """
    Async Kafka consumer for matching engine and settlement engine events.

    Uses aiokafka when available. Falls back to a polling stub for local
    development without a running Kafka cluster.
    """

    def __init__(self) -> None:
        self.brokers = KAFKA_BROKERS
        self.group_id = CONSUMER_GROUP
        self.running = False
        self._bronze = _get_bronze()
        self._stats: dict[str, dict[str, int]] = {
            topic: {"consumed": 0, "written": 0, "errors": 0}
            for topic in ALL_TOPICS
        }
        self._batch_buffer: dict[str, list[dict]] = {
            topic: [] for topic in ALL_TOPICS
        }
        self._batch_size = int(os.getenv("KAFKA_BATCH_SIZE", "50"))
        self._flush_interval = float(os.getenv("KAFKA_FLUSH_INTERVAL_SEC", "5.0"))
        self._consumer = None  # aiokafka AIOKafkaConsumer instance

    # ── Lifecycle ──────────────────────────────────────────────────────────────

    async def start(self) -> None:
        """Start consuming from all matching/settlement topics."""
        self.running = True
        logger.info(
            "Starting Kafka consumer for %d topics on %s (group=%s)",
            len(ALL_TOPICS), self.brokers, self.group_id,
        )
        try:
            await self._start_aiokafka()
        except ImportError:
            logger.warning(
                "aiokafka not installed — running in stub mode (no real Kafka consumption)"
            )
            await self._run_stub()
        except Exception as exc:
            logger.warning(
                "Kafka unavailable (%s) — running in stub mode", exc
            )
            await self._run_stub()

    async def stop(self) -> None:
        """Flush buffers and stop the consumer."""
        self.running = False
        await self._flush_all()
        if self._consumer is not None:
            try:
                await self._consumer.stop()
            except Exception:
                pass
        logger.info("Kafka consumer stopped. Stats: %s", self._stats)

    # ── aiokafka consumer ──────────────────────────────────────────────────────

    async def _start_aiokafka(self) -> None:
        """Start real aiokafka consumer."""
        from aiokafka import AIOKafkaConsumer  # type: ignore

        self._consumer = AIOKafkaConsumer(
            *ALL_TOPICS,
            bootstrap_servers=self.brokers,
            group_id=self.group_id,
            auto_offset_reset="earliest",
            enable_auto_commit=True,
            value_deserializer=lambda v: json.loads(v.decode("utf-8")),
        )
        await self._consumer.start()
        logger.info("aiokafka consumer started, subscribed to %d topics", len(ALL_TOPICS))

        # Run flush loop alongside consumption
        flush_task = asyncio.create_task(self._flush_loop())
        try:
            async for msg in self._consumer:
                if not self.running:
                    break
                await self._handle_message(msg.topic, msg.value)
        finally:
            flush_task.cancel()
            await self._flush_all()
            await self._consumer.stop()

    # ── Message handling ───────────────────────────────────────────────────────

    async def _handle_message(self, topic: str, record: dict) -> None:
        """Route a Kafka message to the appropriate bronze table buffer."""
        cfg = TOPIC_CONFIG.get(topic)
        if cfg is None:
            return

        # Stamp with ingestion metadata
        record["_kafka_topic"] = topic
        record["_ingested_at"] = datetime.now(timezone.utc).isoformat()
        record.setdefault("_event_type", topic.split(".")[-1])

        self._batch_buffer[topic].append(record)
        self._stats[topic]["consumed"] += 1

        # Flush if batch is full
        if len(self._batch_buffer[topic]) >= self._batch_size:
            await self._flush_topic(topic)

    async def _flush_topic(self, topic: str) -> None:
        """Flush buffered records for a topic to the Bronze layer."""
        records = self._batch_buffer[topic]
        if not records:
            return

        self._batch_buffer[topic] = []
        cfg = TOPIC_CONFIG[topic]
        table_path = cfg["table_path"]
        partition_key_fn: Callable[[dict], str] = cfg["partition_key"]

        # Group by partition key for efficient writes
        by_partition: dict[str, list[dict]] = {}
        for r in records:
            try:
                pk = partition_key_fn(r)
            except Exception:
                pk = "UNKNOWN"
            by_partition.setdefault(pk, []).append(r)

        today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        for pk, batch in by_partition.items():
            try:
                result = self._bronze.write_batch(
                    table_path=table_path,
                    records=batch,
                    partition_date=today,
                    extra_partition=pk,
                )
                self._stats[topic]["written"] += result.get("rows", 0)
                logger.debug(
                    "Flushed %d records from %s → bronze/%s (partition=%s)",
                    len(batch), topic, table_path, pk,
                )
            except Exception as exc:
                self._stats[topic]["errors"] += len(batch)
                logger.error(
                    "Failed to write %d records from %s to bronze/%s: %s",
                    len(batch), topic, table_path, exc,
                )
                # Re-queue on failure
                self._batch_buffer[topic] = batch + self._batch_buffer[topic]

    async def _flush_all(self) -> None:
        """Flush all topic buffers."""
        for topic in ALL_TOPICS:
            await self._flush_topic(topic)

    async def _flush_loop(self) -> None:
        """Periodically flush all buffers on a timer."""
        while self.running:
            await asyncio.sleep(self._flush_interval)
            await self._flush_all()

    # ── Stub mode (no Kafka) ───────────────────────────────────────────────────

    async def _run_stub(self) -> None:
        """
        Stub consumer for local development without Kafka.
        Periodically generates synthetic matching/settlement events and
        writes them to the Bronze layer so the Lakehouse pipeline can be
        tested end-to-end without running the full microservice stack.
        """
        logger.info("Stub consumer active — generating synthetic events every 30s")
        while self.running:
            await asyncio.sleep(30)
            await self._generate_stub_events()

    async def _generate_stub_events(self) -> None:
        """Generate synthetic matching and settlement events for testing."""
        import random
        symbols = ["MAIZE-MAR26", "WHEAT-MAR26", "SOYBEANS-JUN26", "COTTON-MAR26"]
        now = datetime.now(timezone.utc).isoformat()

        # Synthetic order placed
        for _ in range(5):
            sym = random.choice(symbols)
            await self._handle_message("nexcom.order.placed", {
                "order_id": f"ORD-{int(time.time() * 1000)}",
                "symbol": sym,
                "side": random.choice(["BUY", "SELL"]),
                "order_type": random.choice(["LIMIT", "MARKET"]),
                "quantity": random.randint(1, 100),
                "price": round(random.uniform(200, 800), 2),
                "account_id": f"ACC-{random.randint(1000, 9999)}",
                "timestamp": now,
            })

        # Synthetic trade executed
        for _ in range(3):
            sym = random.choice(symbols)
            price = round(random.uniform(200, 800), 2)
            qty = random.randint(1, 50)
            await self._handle_message("nexcom.trade.executed", {
                "trade_id": f"TRD-{int(time.time() * 1000)}",
                "symbol": sym,
                "price": price,
                "quantity": qty,
                "buyer_account": f"ACC-{random.randint(1000, 9999)}",
                "seller_account": f"ACC-{random.randint(1000, 9999)}",
                "notional": round(price * qty, 2),
                "timestamp": now,
            })

        # Synthetic settlement completed
        for _ in range(2):
            await self._handle_message("nexcom.settlement.completed", {
                "settlement_id": f"SET-{int(time.time() * 1000)}",
                "trade_id": f"TRD-{random.randint(10000, 99999)}",
                "transfer_type": "settlement",
                "amount": round(random.uniform(5000, 50000), 2),
                "currency": "USD",
                "buyer_account": f"ACC-{random.randint(1000, 9999)}",
                "seller_account": f"ACC-{random.randint(1000, 9999)}",
                "tigerbeetle_transfer_id": random.randint(1, 999999),
                "timestamp": now,
            })

        # Flush immediately after generating
        await self._flush_all()
        logger.debug("Stub: generated and flushed synthetic events")

    # ── Public API ─────────────────────────────────────────────────────────────

    def ingest_event(self, topic: str, record: dict) -> None:
        """
        Synchronous entry point for injecting events from the HTTP API
        (e.g., webhook callbacks from the matching engine or settlement engine).
        Adds the record to the buffer; flushed on the next flush cycle.
        """
        if topic not in self._batch_buffer:
            logger.warning("Unknown topic: %s", topic)
            return
        record["_kafka_topic"] = topic
        record["_ingested_at"] = datetime.now(timezone.utc).isoformat()
        self._batch_buffer[topic].append(record)
        self._stats[topic]["consumed"] += 1

    def get_stats(self) -> dict[str, Any]:
        """Return consumer statistics for the health endpoint."""
        return {
            "brokers": self.brokers,
            "group_id": self.group_id,
            "running": self.running,
            "topics": self._stats,
            "buffer_sizes": {t: len(b) for t, b in self._batch_buffer.items()},
            "total_consumed": sum(s["consumed"] for s in self._stats.values()),
            "total_written": sum(s["written"] for s in self._stats.values()),
            "total_errors": sum(s["errors"] for s in self._stats.values()),
        }


# ── Singleton ──────────────────────────────────────────────────────────────────
kafka_matching_settlement_consumer = KafkaMatchingSettlementConsumer()
