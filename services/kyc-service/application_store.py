"""
application_store.py
───────────────────────────────────────────────────────────────────────────────
Persistence for KYC/KYB applications.

Design
──────
• Primary store: PostgreSQL via asyncpg when NEXCOM_PG_URL is set.
  Tables: kyc_applications, kyb_applications (id PK + JSONB payload).
• Fallback: in-memory (the dicts in main.py) when NEXCOM_PG_URL is not set.
  In that mode the service reports degraded readiness (/readyz) and list
  endpoints carry the `X-Storage: memory` response header.

Environment variables
─────────────────────
  NEXCOM_PG_URL — PostgreSQL connection string (optional)
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
from typing import Any, Optional

logger = logging.getLogger(__name__)

NEXCOM_PG_URL = os.environ.get("NEXCOM_PG_URL", "")

_pg_pool: Optional[Any] = None
_pg_failed = False
_pg_init_lock = asyncio.Lock()

_TABLES = ("kyc_applications", "kyb_applications")


def using_postgres() -> bool:
    return bool(NEXCOM_PG_URL) and not _pg_failed


def storage_mode() -> str:
    return "postgres" if using_postgres() else "memory"


async def _get_pool() -> Optional[Any]:
    global _pg_pool, _pg_failed
    if not NEXCOM_PG_URL or _pg_failed:
        return None
    if _pg_pool is not None:
        return _pg_pool
    async with _pg_init_lock:
        if _pg_pool is not None:
            return _pg_pool
        try:
            import asyncpg  # type: ignore
            _pg_pool = await asyncpg.create_pool(NEXCOM_PG_URL, min_size=1, max_size=4)
            async with _pg_pool.acquire() as conn:
                for table in _TABLES:
                    await conn.execute(
                        f"""
                        CREATE TABLE IF NOT EXISTS {table} (
                            id TEXT PRIMARY KEY,
                            status TEXT NOT NULL,
                            stakeholder_type TEXT NOT NULL,
                            data JSONB NOT NULL,
                            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                            updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
                        )
                        """
                    )
            logger.info("[application_store] PostgreSQL persistence enabled")
        except Exception as exc:  # noqa: BLE001
            _pg_failed = True
            logger.error("[application_store] PostgreSQL init failed; using memory store: %s", exc)
            return None
    return _pg_pool


async def init_store() -> None:
    """Initialise the pool and tables (called at app startup)."""
    await _get_pool()


async def load_all(kind: str) -> list[dict]:
    """Load all application payloads of a kind ('kyc' | 'kyb') from Postgres."""
    pool = await _get_pool()
    if pool is None:
        return []
    table = f"{kind}_applications"
    async with pool.acquire() as conn:
        rows = await conn.fetch(f"SELECT data FROM {table} ORDER BY created_at")
    return [json.loads(r["data"]) for r in rows]


async def persist(kind: str, app_id: str, payload: dict) -> None:
    """Upsert an application payload. No-op (memory mode) when PG is absent."""
    pool = await _get_pool()
    if pool is None:
        return
    table = f"{kind}_applications"
    status = str(payload.get("status", ""))
    stakeholder_type = str(payload.get("stakeholder_type", ""))
    async with pool.acquire() as conn:
        await conn.execute(
            f"""
            INSERT INTO {table} (id, status, stakeholder_type, data, updated_at)
            VALUES ($1, $2, $3, $4::jsonb, now())
            ON CONFLICT (id) DO UPDATE
              SET status = EXCLUDED.status,
                  stakeholder_type = EXCLUDED.stakeholder_type,
                  data = EXCLUDED.data,
                  updated_at = now()
            """,
            app_id, status, stakeholder_type, json.dumps(payload),
        )
