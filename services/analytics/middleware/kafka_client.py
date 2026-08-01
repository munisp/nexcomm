"""
Kafka client for the NEXCOM Analytics service.
Uses confluent-kafka Python client when available.
Falls back to local in-process dispatch for development without a Kafka cluster.

Topics consumed: nexcom.market-data, nexcom.trades, nexcom.analytics
Topics produced: nexcom.analytics, nexcom.audit-log
"""
import json
import logging
import os
import threading
from typing import Any, Callable

logger = logging.getLogger(__name__)
KAFKA_BROKERS = os.getenv("KAFKA_BROKERS", "localhost:9092")


class KafkaClient:
    def __init__(self, brokers: str = KAFKA_BROKERS):
        self.brokers = brokers
        self._connected = False
        self._handlers: dict[str, list[Callable]] = {}
        self._producer = None
        self._consumer = None
        self._consumer_thread: threading.Thread | None = None
        self._running = False
        self._init_producer()

    def _init_producer(self) -> None:
        try:
            from confluent_kafka import Producer  # type: ignore
            self._producer = Producer({
                "bootstrap.servers": self.brokers,
                "acks": "all",
                "retries": 5,
                "retry.backoff.ms": 200,
                "enable.idempotence": True,
                "compression.type": "lz4",
            })
            self._connected = True
            logger.info("[Kafka] Producer connected to %s", self.brokers)
        except ImportError:
            logger.warning("[Kafka] confluent-kafka not installed — using local dispatch")
        except Exception as exc:
            logger.warning("[Kafka] Producer init failed (%s) — using local dispatch", exc)

    def produce(self, topic: str, key: str, value: Any) -> None:
        data = json.dumps(value) if not isinstance(value, str) else value
        if self._producer is not None:
            try:
                self._producer.produce(
                    topic,
                    key=key.encode("utf-8"),
                    value=data.encode("utf-8"),
                    on_delivery=self._delivery_report,
                )
                self._producer.poll(0)
                logger.debug("[Kafka] Produced to topic=%s key=%s size=%d", topic, key, len(data))
            except Exception as exc:
                logger.error("[Kafka] Produce error: %s", exc)
                self._dispatch_local(topic, data)
        else:
            self._dispatch_local(topic, data)

    def _dispatch_local(self, topic: str, data: str) -> None:
        for handler in self._handlers.get(topic, []):
            try:
                handler(json.loads(data) if isinstance(data, str) else data)
            except Exception as exc:
                logger.error("[Kafka] Local handler error: %s", exc)

    @staticmethod
    def _delivery_report(err, msg) -> None:
        if err:
            logger.error("[Kafka] Delivery failed for %s: %s", msg.topic(), err)

    def subscribe(self, topic: str, handler: Callable) -> None:
        if topic not in self._handlers:
            self._handlers[topic] = []
        self._handlers[topic].append(handler)
        logger.info("[Kafka] Subscribed to topic: %s", topic)

    def start_consumer(self, topics: list[str], group_id: str = "nexcom-analytics") -> None:
        if self._consumer_thread and self._consumer_thread.is_alive():
            return
        self._running = True
        self._consumer_thread = threading.Thread(
            target=self._consume_loop, args=(topics, group_id), daemon=True, name="kafka-consumer"
        )
        self._consumer_thread.start()
        logger.info("[Kafka] Consumer thread started for topics: %s", topics)

    def _consume_loop(self, topics: list[str], group_id: str) -> None:
        try:
            from confluent_kafka import Consumer, KafkaError  # type: ignore
            consumer = Consumer({
                "bootstrap.servers": self.brokers,
                "group.id": group_id,
                "auto.offset.reset": "latest",
                "enable.auto.commit": True,
            })
            consumer.subscribe(topics)
            self._consumer = consumer
            while self._running:
                msg = consumer.poll(timeout=1.0)
                if msg is None:
                    continue
                if msg.error():
                    if msg.error().code() != KafkaError._PARTITION_EOF:
                        logger.error("[Kafka] Consumer error: %s", msg.error())
                    continue
                try:
                    value = json.loads(msg.value().decode("utf-8"))
                    for handler in self._handlers.get(msg.topic(), []):
                        handler(value)
                except Exception as exc:
                    logger.error("[Kafka] Message processing error: %s", exc)
            consumer.close()
        except ImportError:
            logger.warning("[Kafka] confluent-kafka not installed — consumer unavailable")
        except Exception as exc:
            logger.error("[Kafka] Consumer loop failed: %s", exc)

    def flush(self, timeout: float = 5.0) -> None:
        if self._producer is not None:
            try:
                self._producer.flush(timeout=timeout)
            except Exception as exc:
                logger.error("[Kafka] Flush error: %s", exc)

    def is_connected(self) -> bool:
        return self._connected

    def close(self) -> None:
        self._running = False
        self.flush()
        if self._consumer is not None:
            try:
                self._consumer.close()
            except Exception:
                pass
        self._connected = False
        logger.info("[Kafka] Connection closed")
