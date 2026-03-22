"""
Kafka client for the NEXCOM Analytics service.
In production: uses confluent-kafka Python client.
Topics consumed: nexcom.market-data, nexcom.trades, nexcom.analytics
Topics produced: nexcom.analytics, nexcom.audit-log
"""

import json
import logging
from typing import Any, Callable

logger = logging.getLogger(__name__)


class KafkaClient:
    def __init__(self, brokers: str):
        self.brokers = brokers
        self._connected = True
        self._handlers: dict[str, list[Callable]] = {}
        logger.info(f"[Kafka] Initialized with brokers: {brokers}")

    def produce(self, topic: str, key: str, value: Any) -> None:
        """Produce a message to a Kafka topic."""
        data = json.dumps(value) if not isinstance(value, str) else value
        logger.info(f"[Kafka] Producing to topic={topic} key={key} size={len(data)}")
        # In production: self.producer.produce(topic, key=key, value=data)
        # Dispatch to local handlers
        for handler in self._handlers.get(topic, []):
            try:
                handler(json.loads(data) if isinstance(data, str) else data)
            except Exception as e:
                logger.error(f"[Kafka] Handler error: {e}")

    def subscribe(self, topic: str, handler: Callable) -> None:
        """Subscribe to a Kafka topic with a handler function."""
        if topic not in self._handlers:
            self._handlers[topic] = []
        self._handlers[topic].append(handler)
        logger.info(f"[Kafka] Subscribed to topic: {topic}")

    def is_connected(self) -> bool:
        return self._connected

    def close(self) -> None:
        self._connected = False
        logger.info("[Kafka] Connection closed")
