"""
Redis client for the NEXCOM Analytics service.
Used for caching analytics results and rate limiting.
In production: uses redis-py async client.
"""

import json
import logging
import time
from typing import Any, Optional

logger = logging.getLogger(__name__)


class RedisClient:
    def __init__(self, url: str):
        self.url = url
        self._connected = True
        self._store: dict[str, tuple[Any, float]] = {}  # key -> (value, expires_at)
        logger.info(f"[Redis] Initialized with URL: {url}")

    def set(self, key: str, value: Any, ttl: int = 60) -> None:
        """Set a cache entry with TTL in seconds."""
        self._store[key] = (value, time.time() + ttl)
        logger.debug(f"[Redis] SET key={key} ttl={ttl}")

    def get(self, key: str) -> Optional[Any]:
        """Get a cached value. Returns None on miss or expiry."""
        entry = self._store.get(key)
        if entry is None:
            return None
        value, expires_at = entry
        if time.time() > expires_at:
            del self._store[key]
            return None
        return value

    def delete(self, key: str) -> None:
        """Delete a cache entry."""
        self._store.pop(key, None)
        logger.debug(f"[Redis] DEL key={key}")

    def increment(self, key: str, ttl: int = 60) -> int:
        """Increment a counter (for rate limiting)."""
        entry = self._store.get(key)
        if entry is None or time.time() > entry[1]:
            self._store[key] = (1, time.time() + ttl)
            return 1
        count = entry[0] + 1
        self._store[key] = (count, entry[1])
        return count

    def is_connected(self) -> bool:
        return self._connected

    def close(self) -> None:
        self._connected = False
        logger.info("[Redis] Connection closed")
