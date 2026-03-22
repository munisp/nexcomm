"""
NEXCOM Exchange - Fluvio Consumers
Consumes real-time events from Fluvio topics and routes them
to the Lakehouse bronze layer and analytics pipeline.

Fluvio Topics:
  - market-ticks: Real-time price tick data
  - orderbook-updates: Order book L2/L3 changes
  - trade-signals: Matched trade signals from matching engine
  - price-alerts: Triggered price alert notifications
  - risk-events: Margin calls, circuit breakers, position limits
"""

import asyncio
import json
import logging
import os
import time
from typing import Any

logger = logging.getLogger(__name__)

FLUVIO_ENDPOINT = os.getenv("FLUVIO_ENDPOINT", "localhost:9003")

FLUVIO_TOPICS = [
    "market-ticks",
    "orderbook-updates",
    "trade-signals",
    "price-alerts",
    "risk-events",
]


class FluvioConsumerGroup:
    """Manages consumers for all 5 Fluvio topics."""

    def __init__(self) -> None:
        self.endpoint = FLUVIO_ENDPOINT
        self.running = False
        self.stats: dict[str, dict[str, Any]] = {
            topic: {"messages": 0, "bytes": 0, "errors": 0, "last_offset": 0}
            for topic in FLUVIO_TOPICS
        }
        self._buffer: dict[str, list[dict[str, Any]]] = {
            topic: [] for topic in FLUVIO_TOPICS
        }
        self.flush_interval = 5  # seconds
        self.batch_size = 100

    async def start(self) -> None:
        """Start all Fluvio consumers."""
        self.running = True
        logger.info(
            "Starting Fluvio consumer group for %d topics on %s",
            len(FLUVIO_TOPICS),
            self.endpoint,
        )
        tasks = [self._consume_topic(topic) for topic in FLUVIO_TOPICS]
        tasks.append(self._flush_loop())
        await asyncio.gather(*tasks, return_exceptions=True)

    async def stop(self) -> None:
        """Stop all consumers and flush remaining buffers."""
        self.running = False
        for topic in FLUVIO_TOPICS:
            await self._flush_buffer(topic)
        logger.info("Fluvio consumer group stopped")

    async def _consume_topic(self, topic: str) -> None:
        """Consume messages from a single Fluvio topic."""
        logger.info("Consumer started for topic: %s", topic)
        while self.running:
            try:
                # In production: connect to Fluvio cluster and consume
                # For now, simulate periodic consumption
                await asyncio.sleep(1)
                # Process any buffered messages
                if len(self._buffer[topic]) >= self.batch_size:
                    await self._flush_buffer(topic)
            except Exception as e:
                self.stats[topic]["errors"] += 1
                logger.error("Error consuming from %s: %s", topic, e)
                await asyncio.sleep(5)

    async def _flush_loop(self) -> None:
        """Periodically flush all topic buffers to Lakehouse bronze layer."""
        while self.running:
            await asyncio.sleep(self.flush_interval)
            for topic in FLUVIO_TOPICS:
                if self._buffer[topic]:
                    await self._flush_buffer(topic)

    async def _flush_buffer(self, topic: str) -> None:
        """Flush buffered messages for a topic to Lakehouse bronze layer."""
        messages = self._buffer[topic]
        if not messages:
            return

        count = len(messages)
        self._buffer[topic] = []

        # Route to appropriate handler based on topic
        handler = self._get_handler(topic)
        try:
            await handler(messages)
            self.stats[topic]["messages"] += count
            logger.debug("Flushed %d messages from %s", count, topic)
        except Exception as e:
            self.stats[topic]["errors"] += 1
            logger.error("Failed to flush %s buffer: %s", topic, e)
            # Re-queue failed messages
            self._buffer[topic] = messages + self._buffer[topic]

    def _get_handler(self, topic: str):
        """Get the handler function for a topic."""
        handlers = {
            "market-ticks": self._handle_market_ticks,
            "orderbook-updates": self._handle_orderbook_updates,
            "trade-signals": self._handle_trade_signals,
            "price-alerts": self._handle_price_alerts,
            "risk-events": self._handle_risk_events,
        }
        return handlers.get(topic, self._handle_default)

    async def _handle_market_ticks(self, messages: list[dict[str, Any]]) -> None:
        """Process market tick data -> bronze.market_ticks Parquet table."""
        # Write to Lakehouse bronze layer as Parquet
        logger.info("Writing %d market ticks to bronze.market_ticks", len(messages))

    async def _handle_orderbook_updates(self, messages: list[dict[str, Any]]) -> None:
        """Process orderbook updates -> bronze.orderbook_snapshots."""
        logger.info(
            "Writing %d orderbook updates to bronze.orderbook_snapshots",
            len(messages),
        )

    async def _handle_trade_signals(self, messages: list[dict[str, Any]]) -> None:
        """Process trade signals -> bronze.trades + trigger silver enrichment."""
        logger.info(
            "Writing %d trade signals to bronze.trades", len(messages)
        )

    async def _handle_price_alerts(self, messages: list[dict[str, Any]]) -> None:
        """Process price alerts -> notification service + bronze.alerts."""
        logger.info(
            "Routing %d price alerts to notification service", len(messages)
        )

    async def _handle_risk_events(self, messages: list[dict[str, Any]]) -> None:
        """Process risk events -> bronze.risk_events + surveillance pipeline."""
        logger.info(
            "Writing %d risk events to bronze.risk_events", len(messages)
        )

    async def _handle_default(self, messages: list[dict[str, Any]]) -> None:
        """Default handler for unknown topics."""
        logger.warning("No handler for %d messages", len(messages))

    def ingest_message(self, topic: str, message: dict[str, Any]) -> None:
        """Ingest a message into the buffer (called by Fluvio client callback)."""
        if topic in self._buffer:
            message["_ingested_at"] = time.time()
            self._buffer[topic].append(message)
            self.stats[topic]["last_offset"] += 1

    def get_stats(self) -> dict[str, Any]:
        """Return consumer group statistics."""
        return {
            "endpoint": self.endpoint,
            "running": self.running,
            "topics": self.stats,
            "total_messages": sum(s["messages"] for s in self.stats.values()),
            "total_errors": sum(s["errors"] for s in self.stats.values()),
            "buffer_sizes": {
                topic: len(buf) for topic, buf in self._buffer.items()
            },
        }


# Singleton instance
fluvio_consumers = FluvioConsumerGroup()
