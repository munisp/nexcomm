"""
NEXCOM Bot Logic — Async PostgreSQL connection pool.
"""

import os
import logging
import asyncpg

logger = logging.getLogger("nexcom.bot-logic.db.pool")

_pool: asyncpg.Pool | None = None


async def init_db():
    global _pool
    url = os.getenv("DATABASE_URL", "postgresql://nexcom:nexcom_secure_2026@localhost:5432/nexcom")
    try:
        _pool = await asyncpg.create_pool(url, min_size=2, max_size=10)
        logger.info("PostgreSQL connection pool initialized")
    except Exception as e:
        logger.error(f"Failed to connect to PostgreSQL: {e}")
        _pool = None


async def close_db():
    global _pool
    if _pool:
        await _pool.close()
        _pool = None


async def get_pool() -> asyncpg.Pool:
    if _pool is None:
        await init_db()
    return _pool
