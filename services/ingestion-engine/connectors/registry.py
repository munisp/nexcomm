"""
Connector Registry — Central registry for all 38+ data feed connectors.
Manages lifecycle (start/stop), metrics, and status for every feed.
"""

import time
import uuid
import logging
from enum import Enum
from typing import Optional
from datetime import datetime, timezone
from dataclasses import dataclass, field

logger = logging.getLogger("ingestion-engine.registry")


class FeedCategory(str, Enum):
    INTERNAL = "internal_exchange"
    EXTERNAL_MARKET = "external_market_data"
    ALTERNATIVE = "alternative_data"
    REGULATORY = "regulatory"
    IOT_PHYSICAL = "iot_physical"
    REFERENCE = "reference_data"


class FeedStatus(str, Enum):
    ACTIVE = "active"
    INACTIVE = "inactive"
    ERROR = "error"
    STARTING = "starting"
    STOPPING = "stopping"


class FeedProtocol(str, Enum):
    KAFKA = "kafka"
    FLUVIO = "fluvio"
    WEBSOCKET = "websocket"
    REST_POLL = "rest_poll"
    FIX = "fix_protocol"
    GRPC = "grpc"
    TCP_MULTICAST = "tcp_multicast"
    SFTP = "sftp"
    MQTT = "mqtt"
    DATABASE_CDC = "database_cdc"


@dataclass
class FeedMetrics:
    messages_received: int = 0
    messages_processed: int = 0
    messages_failed: int = 0
    bytes_received: int = 0
    avg_latency_ms: float = 0.0
    max_latency_ms: float = 0.0
    last_message_at: Optional[str] = None
    errors_last_hour: int = 0
    dedup_hits: int = 0
    schema_violations: int = 0
    throughput_msg_sec: float = 0.0
    uptime_pct: float = 99.9


@dataclass
class FeedConnector:
    """Represents a single data feed connector."""

    feed_id: str
    name: str
    description: str
    category: FeedCategory
    protocol: FeedProtocol
    source_endpoint: str
    kafka_topic: str
    lakehouse_target: str  # e.g. "bronze/market_data/cme"
    schema_name: str
    refresh_interval_sec: int = 1
    status: FeedStatus = FeedStatus.INACTIVE
    priority: int = 1  # 1=critical, 2=high, 3=medium, 4=low
    metrics: FeedMetrics = field(default_factory=FeedMetrics)
    started_at: Optional[str] = None
    tags: list[str] = field(default_factory=list)

    def start(self):
        self.status = FeedStatus.ACTIVE
        self.started_at = datetime.now(timezone.utc).isoformat()
        logger.info(f"[{self.feed_id}] Started — target: {self.kafka_topic}")

    def stop(self):
        self.status = FeedStatus.INACTIVE
        logger.info(f"[{self.feed_id}] Stopped")

    def record_message(self, size_bytes: int, latency_ms: float):
        self.metrics.messages_received += 1
        self.metrics.messages_processed += 1
        self.metrics.bytes_received += size_bytes
        self.metrics.last_message_at = datetime.now(timezone.utc).isoformat()
        # Running average
        n = self.metrics.messages_processed
        self.metrics.avg_latency_ms = (
            (self.metrics.avg_latency_ms * (n - 1) + latency_ms) / n
        )
        self.metrics.max_latency_ms = max(self.metrics.max_latency_ms, latency_ms)

    def record_error(self):
        self.metrics.messages_failed += 1
        self.metrics.errors_last_hour += 1

    def to_dict(self) -> dict:
        return {
            "feed_id": self.feed_id,
            "name": self.name,
            "description": self.description,
            "category": self.category.value,
            "protocol": self.protocol.value,
            "source_endpoint": self.source_endpoint,
            "kafka_topic": self.kafka_topic,
            "lakehouse_target": self.lakehouse_target,
            "schema_name": self.schema_name,
            "refresh_interval_sec": self.refresh_interval_sec,
            "status": self.status.value,
            "priority": self.priority,
            "tags": self.tags,
        }

    def detailed_status(self) -> dict:
        return {
            **self.to_dict(),
            "started_at": self.started_at,
            "metrics": {
                "messages_received": self.metrics.messages_received,
                "messages_processed": self.metrics.messages_processed,
                "messages_failed": self.metrics.messages_failed,
                "bytes_received": self.metrics.bytes_received,
                "avg_latency_ms": round(self.metrics.avg_latency_ms, 3),
                "max_latency_ms": round(self.metrics.max_latency_ms, 3),
                "last_message_at": self.metrics.last_message_at,
                "errors_last_hour": self.metrics.errors_last_hour,
                "dedup_hits": self.metrics.dedup_hits,
                "schema_violations": self.metrics.schema_violations,
                "throughput_msg_sec": round(self.metrics.throughput_msg_sec, 2),
                "uptime_pct": self.metrics.uptime_pct,
            },
        }


class ConnectorRegistry:
    """Central registry managing all feed connectors."""

    def __init__(self):
        self._feeds: dict[str, FeedConnector] = {}

    def register(self, connector: FeedConnector):
        self._feeds[connector.feed_id] = connector
        logger.info(
            f"Registered feed: {connector.feed_id} [{connector.category.value}] "
            f"→ {connector.kafka_topic}"
        )

    def get_feed(self, feed_id: str) -> Optional[FeedConnector]:
        return self._feeds.get(feed_id)

    def list_feeds(
        self,
        category: Optional[FeedCategory] = None,
        status: Optional[FeedStatus] = None,
    ) -> list[FeedConnector]:
        feeds = list(self._feeds.values())
        if category:
            feeds = [f for f in feeds if f.category == category]
        if status:
            feeds = [f for f in feeds if f.status == status]
        return sorted(feeds, key=lambda f: (f.priority, f.feed_id))

    def feed_count(self) -> int:
        return len(self._feeds)

    def all_statuses(self) -> dict[str, FeedStatus]:
        return {fid: f.status for fid, f in self._feeds.items()}

    def category_summary(self) -> dict:
        summary: dict[str, dict] = {}
        for f in self._feeds.values():
            cat = f.category.value
            if cat not in summary:
                summary[cat] = {"total": 0, "active": 0, "feeds": []}
            summary[cat]["total"] += 1
            if f.status == FeedStatus.ACTIVE:
                summary[cat]["active"] += 1
            summary[cat]["feeds"].append(f.feed_id)
        return summary

    def aggregated_metrics(self) -> dict:
        total_msgs = sum(f.metrics.messages_received for f in self._feeds.values())
        total_bytes = sum(f.metrics.bytes_received for f in self._feeds.values())
        total_errors = sum(f.metrics.messages_failed for f in self._feeds.values())
        active = sum(1 for f in self._feeds.values() if f.status == FeedStatus.ACTIVE)

        # Per-category breakdown
        by_category: dict[str, dict] = {}
        for f in self._feeds.values():
            cat = f.category.value
            if cat not in by_category:
                by_category[cat] = {"messages": 0, "bytes": 0, "errors": 0, "feeds": 0}
            by_category[cat]["messages"] += f.metrics.messages_received
            by_category[cat]["bytes"] += f.metrics.bytes_received
            by_category[cat]["errors"] += f.metrics.messages_failed
            by_category[cat]["feeds"] += 1

        # Top feeds by throughput
        top_feeds = sorted(
            self._feeds.values(),
            key=lambda f: f.metrics.messages_received,
            reverse=True,
        )[:10]

        return {
            "total_messages": total_msgs,
            "total_bytes": total_bytes,
            "total_bytes_human": _human_bytes(total_bytes),
            "total_errors": total_errors,
            "error_rate_pct": round(total_errors / max(total_msgs, 1) * 100, 4),
            "active_feeds": active,
            "total_feeds": len(self._feeds),
            "by_category": by_category,
            "top_feeds": [
                {
                    "feed_id": f.feed_id,
                    "messages": f.metrics.messages_received,
                    "avg_latency_ms": round(f.metrics.avg_latency_ms, 3),
                }
                for f in top_feeds
            ],
        }


def _human_bytes(n: int) -> str:
    for unit in ["B", "KB", "MB", "GB", "TB"]:
        if n < 1024:
            return f"{n:.1f} {unit}"
        n /= 1024
    return f"{n:.1f} PB"
