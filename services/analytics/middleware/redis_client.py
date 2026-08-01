"""
Redis client for the NEXCOM Analytics service.
Uses redis-py when available. Falls back to in-process dict cache for development.
"""
import json
import logging
import os
import time
from typing import Any, Optional

logger = logging.getLogger(__name__)

REDIS_URL = os.getenv("REDIS_URL", "redis://redis:6379/0")


class RedisClient:
    def __init__(self, url: str = REDIS_URL):
        self.url = url
        self._redis = None
        self._connected = False
        self._store: dict[str, tuple[Any, float]] = {}  # fallback in-process cache
        self._init_redis()

    def _init_redis(self) -> None:
        try:
            import redis  # type: ignore
            self._redis = redis.from_url(self.url, decode_responses=True, socket_timeout=3, socket_connect_timeout=3)
            self._redis.ping()
            self._connected = True
            logger.info("[Redis] Connected to %s", self.url)
        except ImportError:
            logger.warning("[Redis] redis-py not installed — using in-process dict cache")
        except Exception as exc:
            logger.warning("[Redis] Connection failed (%s) — using in-process dict cache", exc)

    def set(self, key: str, value: Any, ttl: int = 60) -> None:
        serialized = json.dumps(value) if not isinstance(value, str) else value
        if self._redis is not None:
            try:
                self._redis.setex(key, ttl, serialized)
                return
            except Exception as exc:
                logger.warning("[Redis] SET failed: %s", exc)
        self._store[key] = (value, time.time() + ttl)

    def get(self, key: str) -> Optional[Any]:
        if self._redis is not None:
            try:
                val = self._redis.get(key)
                if val is None:
                    return None
                try:
                    return json.loads(val)
                except (json.JSONDecodeError, TypeError):
                    return val
            except Exception as exc:
                logger.warning("[Redis] GET failed: %s", exc)
        entry = self._store.get(key)
        if entry is None:
            return None
        value, expires_at = entry
        if time.time() > expires_at:
            del self._store[key]
            return None
        return value

    def delete(self, key: str) -> None:
        if self._redis is not None:
            try:
                self._redis.delete(key)
                return
            except Exception as exc:
                logger.warning("[Redis] DEL failed: %s", exc)
        self._store.pop(key, None)

    def increment(self, key: str, ttl: int = 60) -> int:
        if self._redis is not None:
            try:
                pipe = self._redis.pipeline()
                pipe.incr(key)
                pipe.expire(key, ttl)
                results = pipe.execute()
                return int(results[0])
            except Exception as exc:
                logger.warning("[Redis] INCR failed: %s", exc)
        entry = self._store.get(key)
        if entry is None or time.time() > entry[1]:
            self._store[key] = (1, time.time() + ttl)
            return 1
        count = entry[0] + 1
        self._store[key] = (count, entry[1])
        return count

    def hset(self, name: str, mapping: dict) -> None:
        if self._redis is not None:
            try:
                self._redis.hset(name, mapping={k: json.dumps(v) if not isinstance(v, str) else v for k, v in mapping.items()})
                return
            except Exception as exc:
                logger.warning("[Redis] HSET failed: %s", exc)
        self._store[name] = (mapping, time.time() + 86400)

    def hgetall(self, name: str) -> dict:
        if self._redis is not None:
            try:
                raw = self._redis.hgetall(name)
                return {k: json.loads(v) if v and v[0] in ('{', '[', '"') else v for k, v in raw.items()}
            except Exception as exc:
                logger.warning("[Redis] HGETALL failed: %s", exc)
        entry = self._store.get(name)
        return entry[0] if entry and isinstance(entry[0], dict) else {}

    def is_connected(self) -> bool:
        return self._connected

    def close(self) -> None:
        if self._redis is not None:
            try:
                self._redis.close()
            except Exception:
                pass
        self._connected = False
        logger.info("[Redis] Connection closed")
