"""
NEXCOM Bot Logic — Kafka Producer
Emits bot events to the NEXCOM event bus.
"""

import json
import logging
import os
from datetime import datetime, timezone

logger = logging.getLogger("nexcom.bot-logic.kafka")


class KafkaProducer:
    """Kafka producer with graceful degradation when Kafka is unavailable."""

    def __init__(self, brokers: str):
        self._producer = None
        self._active = False
        try:
            from confluent_kafka import Producer as ConfluentProducer
            self._producer = ConfluentProducer({
                "bootstrap.servers": brokers,
                "message.timeout.ms": 5000,
                "queue.buffering.max.ms": 100,
            })
            self._active = True
            logger.info(f"Kafka producer connected to {brokers}")
        except Exception as e:
            logger.warning(f"Kafka not available ({e}). Events will be skipped.")

    def emit(self, topic: str, payload: dict) -> None:
        """Emit an event to a Kafka topic."""
        if not self._active or self._producer is None:
            return
        try:
            payload["_ts"] = datetime.now(timezone.utc).isoformat()
            self._producer.produce(
                topic,
                value=json.dumps(payload).encode("utf-8"),
                callback=self._delivery_callback,
            )
            self._producer.poll(0)
        except Exception as e:
            logger.warning(f"Kafka emit failed for {topic}: {e}")
            self._active = False

    def _delivery_callback(self, err, msg):
        if err:
            logger.warning(f"Kafka delivery failed: {err}")

    def close(self):
        if self._producer:
            self._producer.flush(timeout=5)
