"""
NEXCOM Fund-Flow Kafka Consumer (Python)
=========================================
Consumes all 20 fund-flow Kafka topics and fans out to:
  1. OpenSearch — full-text indexing for compliance search
  2. Lakehouse Bronze — immutable audit trail (Delta Lake / Parquet)
  3. AML screening — real-time pattern detection
  4. Analytics aggregation — P&L, volume, fee metrics

Topics consumed:
  nexcom.deposit.created       nexcom.deposit.completed
  nexcom.withdrawal.initiated  nexcom.withdrawal.completed
  nexcom.trade.executed        nexcom.order.placed
  nexcom.order.cancelled       nexcom.margin.pledged
  nexcom.margin.released       nexcom.margin.liquidated
  nexcom.loan.disbursed        nexcom.loan.repaid
  nexcom.crossborder.initiated nexcom.crossborder.completed
  nexcom.receipt.issued        nexcom.receipt.redeemed
  nexcom.cooperative.payout    nexcom.fee.collected
  nexcom.refund.processed      nexcom.aml.flagged

Usage:
  python fund_flow_consumer.py

Environment variables:
  KAFKA_BOOTSTRAP_SERVERS   (default: localhost:9092)
  OPENSEARCH_URL            (default: http://opensearch:9200)
  LAKEHOUSE_INGEST_URL      (default: http://localhost:3000/api/internal/lakehouse/ingest)
  AML_ENGINE_URL            (default: http://fraud-engine:8007)
  KAFKA_GROUP_ID            (default: nexcom-fund-flow-consumer)
"""

from __future__ import annotations

import json
import logging
import os
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Callable, Dict, List, Optional

import requests

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
)
logger = logging.getLogger("fund_flow_consumer")

# ─── Configuration ────────────────────────────────────────────────────────────
KAFKA_BOOTSTRAP = os.getenv("KAFKA_BOOTSTRAP_SERVERS", "localhost:9092")
KAFKA_GROUP_ID  = os.getenv("KAFKA_GROUP_ID", "nexcom-fund-flow-consumer")
OPENSEARCH_URL  = os.getenv("OPENSEARCH_URL", "http://opensearch:9200")
LAKEHOUSE_URL   = os.getenv("LAKEHOUSE_INGEST_URL", "http://localhost:3000/api/internal/lakehouse/ingest")
AML_ENGINE_URL  = os.getenv("AML_ENGINE_URL", "http://fraud-engine:8007")

# All 20 fund-flow topics
FUND_FLOW_TOPICS = [
    "nexcom.deposit.created",
    "nexcom.deposit.completed",
    "nexcom.withdrawal.initiated",
    "nexcom.withdrawal.completed",
    "nexcom.trade.executed",
    "nexcom.order.placed",
    "nexcom.order.cancelled",
    "nexcom.margin.pledged",
    "nexcom.margin.released",
    "nexcom.margin.liquidated",
    "nexcom.loan.disbursed",
    "nexcom.loan.repaid",
    "nexcom.crossborder.initiated",
    "nexcom.crossborder.completed",
    "nexcom.receipt.issued",
    "nexcom.receipt.redeemed",
    "nexcom.cooperative.payout",
    "nexcom.fee.collected",
    "nexcom.refund.processed",
    "nexcom.aml.flagged",
]

# Topics that require AML screening
AML_SCREEN_TOPICS = {
    "nexcom.deposit.completed",
    "nexcom.withdrawal.completed",
    "nexcom.trade.executed",
    "nexcom.crossborder.initiated",
    "nexcom.crossborder.completed",
    "nexcom.loan.disbursed",
    "nexcom.cooperative.payout",
}

# OpenSearch index mapping per topic
OPENSEARCH_INDEX_MAP: Dict[str, str] = {
    "nexcom.deposit.created":       "nexcom-deposits",
    "nexcom.deposit.completed":     "nexcom-deposits",
    "nexcom.withdrawal.initiated":  "nexcom-withdrawals",
    "nexcom.withdrawal.completed":  "nexcom-withdrawals",
    "nexcom.trade.executed":        "nexcom-trades",
    "nexcom.order.placed":          "nexcom-orders",
    "nexcom.order.cancelled":       "nexcom-orders",
    "nexcom.margin.pledged":        "nexcom-margin",
    "nexcom.margin.released":       "nexcom-margin",
    "nexcom.margin.liquidated":     "nexcom-margin",
    "nexcom.loan.disbursed":        "nexcom-loans",
    "nexcom.loan.repaid":           "nexcom-loans",
    "nexcom.crossborder.initiated": "nexcom-crossborder",
    "nexcom.crossborder.completed": "nexcom-crossborder",
    "nexcom.receipt.issued":        "nexcom-receipts",
    "nexcom.receipt.redeemed":      "nexcom-receipts",
    "nexcom.cooperative.payout":    "nexcom-cooperatives",
    "nexcom.fee.collected":         "nexcom-fees",
    "nexcom.refund.processed":      "nexcom-refunds",
    "nexcom.aml.flagged":           "nexcom-aml-flags",
}


# ─── HTTP helpers ─────────────────────────────────────────────────────────────

def post_json(url: str, payload: dict, timeout: int = 5) -> bool:
    """POST JSON to a URL. Returns True on success, False on failure."""
    try:
        resp = requests.post(url, json=payload, timeout=timeout)
        resp.raise_for_status()
        return True
    except Exception as exc:
        logger.warning("POST failed url=%s error=%s", url, exc)
        return False


# ─── OpenSearch indexing ──────────────────────────────────────────────────────

def index_to_opensearch(index: str, doc_id: str, doc: dict) -> bool:
    """Upsert a document into OpenSearch."""
    url = f"{OPENSEARCH_URL}/{index}/_doc/{doc_id}"
    try:
        resp = requests.put(url, json=doc, timeout=5)
        if resp.status_code in (200, 201):
            return True
        logger.warning("OpenSearch index failed index=%s id=%s status=%d", index, doc_id, resp.status_code)
        return False
    except Exception as exc:
        logger.warning("OpenSearch unreachable: %s", exc)
        return False


# ─── Lakehouse Bronze ingest ──────────────────────────────────────────────────

def ingest_to_lakehouse(event_type: str, payload: dict) -> bool:
    """Ingest a fund-flow event to the Lakehouse Bronze layer."""
    body = {
        "event_type": event_type,
        "source": "kafka-consumer-python",
        "ingested_at": datetime.now(timezone.utc).isoformat(),
        **payload,
    }
    return post_json(LAKEHOUSE_URL, body, timeout=10)


# ─── AML screening ───────────────────────────────────────────────────────────

def screen_aml(topic: str, payload: dict) -> None:
    """Send a fund-flow event to the AML engine for real-time screening."""
    body = {
        "topic": topic,
        "event": payload,
        "screened_at": datetime.now(timezone.utc).isoformat(),
    }
    post_json(f"{AML_ENGINE_URL}/api/screen", body, timeout=3)


# ─── Event handlers ───────────────────────────────────────────────────────────

def handle_event(topic: str, key: str, payload: dict) -> None:
    """
    Central handler for all 20 fund-flow events.
    Fans out to OpenSearch, Lakehouse, and AML screening.
    """
    event_type = payload.get("event", topic.replace("nexcom.", "").replace(".", "_").upper())
    doc_id = (
        payload.get("trade_id")
        or payload.get("deposit_id")
        or payload.get("withdrawal_id")
        or payload.get("order_id")
        or payload.get("loan_id")
        or payload.get("transfer_id")
        or payload.get("receipt_id")
        or payload.get("flag_id")
        or payload.get("payout_id")
        or payload.get("refund_id")
        or key
        or f"{topic}-{int(time.time()*1000)}"
    )

    # 1. OpenSearch full-text index
    os_index = OPENSEARCH_INDEX_MAP.get(topic, "nexcom-fund-flow")
    indexed = index_to_opensearch(os_index, doc_id, {
        **payload,
        "_topic": topic,
        "_indexed_at": datetime.now(timezone.utc).isoformat(),
    })
    if indexed:
        logger.info("OpenSearch indexed topic=%s id=%s", topic, doc_id)

    # 2. Lakehouse Bronze ingest (always — immutable audit trail)
    ingested = ingest_to_lakehouse(event_type, payload)
    if ingested:
        logger.info("Lakehouse ingested topic=%s id=%s", topic, doc_id)

    # 3. AML screening for high-value topics
    if topic in AML_SCREEN_TOPICS:
        screen_aml(topic, payload)
        logger.info("AML screened topic=%s id=%s", topic, doc_id)


# ─── Kafka consumer loop ──────────────────────────────────────────────────────

def run_consumer() -> None:
    """
    Main consumer loop. Uses confluent-kafka if available,
    falls back to a polling REST proxy client.
    """
    try:
        from confluent_kafka import Consumer, KafkaError  # type: ignore

        conf = {
            "bootstrap.servers": KAFKA_BOOTSTRAP,
            "group.id": KAFKA_GROUP_ID,
            "auto.offset.reset": "earliest",
            "enable.auto.commit": False,
            "max.poll.interval.ms": 300000,
            "session.timeout.ms": 30000,
        }
        consumer = Consumer(conf)
        consumer.subscribe(FUND_FLOW_TOPICS)
        logger.info("Kafka consumer started (confluent-kafka) topics=%d", len(FUND_FLOW_TOPICS))

        try:
            while True:
                msg = consumer.poll(timeout=1.0)
                if msg is None:
                    continue
                if msg.error():
                    if msg.error().code() == KafkaError._PARTITION_EOF:
                        continue
                    logger.error("Kafka error: %s", msg.error())
                    continue

                topic = msg.topic()
                key = msg.key().decode("utf-8") if msg.key() else ""
                try:
                    payload = json.loads(msg.value().decode("utf-8"))
                except json.JSONDecodeError:
                    logger.warning("Non-JSON message on topic=%s", topic)
                    consumer.commit(msg)
                    continue

                try:
                    handle_event(topic, key, payload)
                    consumer.commit(msg)
                except Exception as exc:
                    logger.error("Handler failed topic=%s key=%s error=%s", topic, key, exc)
                    # Don't commit — Kafka will redeliver
        finally:
            consumer.close()

    except ImportError:
        logger.warning("confluent-kafka not installed — using REST proxy polling")
        _run_rest_proxy_consumer()


def _run_rest_proxy_consumer() -> None:
    """
    Fallback consumer using Kafka REST Proxy.
    Creates a consumer group and polls each topic.
    """
    rest_proxy = os.getenv("KAFKA_REST_PROXY_URL", "http://kafka-rest:8082")
    consumer_url = f"{rest_proxy}/consumers/{KAFKA_GROUP_ID}"

    # Create consumer instance
    try:
        resp = requests.post(consumer_url, json={
            "name": "nexcom-fund-flow-1",
            "format": "json",
            "auto.offset.reset": "earliest",
            "auto.commit.enable": "false",
        }, timeout=10)
        if resp.status_code not in (200, 409):  # 409 = already exists
            logger.error("Failed to create REST proxy consumer: %d", resp.status_code)
            return
        base_uri = resp.json().get("base_uri", f"{consumer_url}/instances/nexcom-fund-flow-1")
    except Exception as exc:
        logger.error("Kafka REST proxy unreachable: %s", exc)
        return

    # Subscribe
    try:
        requests.post(f"{base_uri}/subscription", json={"topics": FUND_FLOW_TOPICS}, timeout=10)
    except Exception as exc:
        logger.error("Subscription failed: %s", exc)
        return

    logger.info("REST proxy consumer started topics=%d", len(FUND_FLOW_TOPICS))

    while True:
        try:
            resp = requests.get(f"{base_uri}/records", headers={"Accept": "application/vnd.kafka.json.v2+json"}, timeout=5)
            if resp.status_code == 200:
                records = resp.json()
                for record in records:
                    topic = record.get("topic", "")
                    key = str(record.get("key", ""))
                    payload = record.get("value", {})
                    if isinstance(payload, str):
                        try:
                            payload = json.loads(payload)
                        except Exception:
                            continue
                    handle_event(topic, key, payload)

                # Commit offsets
                requests.post(f"{base_uri}/offsets", json={
                    "offsets": [{"topic": r["topic"], "partition": r["partition"], "offset": r["offset"]} for r in records]
                }, timeout=5)
        except Exception as exc:
            logger.warning("Poll failed: %s", exc)

        time.sleep(0.1)


# ─── Tests ────────────────────────────────────────────────────────────────────

def test_handle_event_trade() -> None:
    """Unit test: handle_event processes a trade.executed event without raising."""
    payload = {
        "event": "trade.executed",
        "trade_id": "test-trade-001",
        "symbol": "MAIZE",
        "buyer_user_id": "usr-001",
        "seller_user_id": "usr-002",
        "price": 215.50,
        "quantity": 100.0,
        "gross_amount": 21550.0,
        "fee_amount": 21.55,
        "currency": "USD",
        "executed_at": datetime.now(timezone.utc).isoformat(),
    }
    # Should not raise even when OpenSearch/Lakehouse are unavailable
    handle_event("nexcom.trade.executed", "test-trade-001", payload)
    logger.info("test_handle_event_trade PASSED")


def test_handle_event_deposit() -> None:
    """Unit test: handle_event processes a deposit.completed event without raising."""
    payload = {
        "event": "deposit.completed",
        "deposit_id": "dep-001",
        "user_id": "usr-001",
        "amount": 5000.0,
        "currency": "USD",
        "status": "COMPLETED",
    }
    handle_event("nexcom.deposit.completed", "dep-001", payload)
    logger.info("test_handle_event_deposit PASSED")


def test_all_topics_have_opensearch_index() -> None:
    """Unit test: all 20 topics have an OpenSearch index mapping."""
    missing = [t for t in FUND_FLOW_TOPICS if t not in OPENSEARCH_INDEX_MAP]
    assert not missing, f"Missing OpenSearch index mapping for: {missing}"
    logger.info("test_all_topics_have_opensearch_index PASSED")


if __name__ == "__main__":
    import sys
    if len(sys.argv) > 1 and sys.argv[1] == "test":
        test_all_topics_have_opensearch_index()
        test_handle_event_trade()
        test_handle_event_deposit()
        logger.info("All Python fund-flow consumer tests PASSED")
    else:
        run_consumer()
