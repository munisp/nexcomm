"""
session_store.py
───────────────────────────────────────────────────────────────────────────────
Persistent storage for active liveness sessions.

Design
──────
• Primary store: PostgreSQL via asyncpg (same DB as the Node.js server).
  Table: kyc_liveness_sessions (created by Drizzle migration).
• Fallback: in-memory dict (used when NEXCOM_PG_URL is not set — dev/sandbox).
• Event webhook: on session completion (PASS or FAIL), posts a JSON event to
  the Node.js server's /api/internal/liveness-event endpoint so it can write
  to the securityEvents table and trigger any downstream actions.

Environment variables
──────────────────────
  NEXCOM_PG_URL          — PostgreSQL connection string (optional)
  NEXCOM_SERVER_URL      — Node.js server base URL for event callbacks
  NEXCOM_INTERNAL_SECRET — Shared secret for internal API calls
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import time
from datetime import datetime, timezone
from typing import Any, Optional

import httpx

logger = logging.getLogger(__name__)

# ── Configuration ──────────────────────────────────────────────────────────────
NEXCOM_PG_URL = os.environ.get("NEXCOM_PG_URL", "")
NEXCOM_SERVER_URL = os.environ.get("NEXCOM_SERVER_URL", "http://localhost:3000")
NEXCOM_INTERNAL_SECRET = os.environ.get(
    "NEXCOM_INTERNAL_SECRET",
    os.environ.get("JWT_SECRET", "nexcom-internal-2026"),
)

# ── In-memory fallback ─────────────────────────────────────────────────────────
_memory_store: dict[str, dict[str, Any]] = {}

# ── asyncpg pool (lazy-initialised) ───────────────────────────────────────────
_pg_pool: Optional[Any] = None
_pg_init_lock = asyncio.Lock()


async def _get_pool() -> Optional[Any]:
    """Return an asyncpg connection pool, or None if PG is not configured."""
    global _pg_pool
    if not NEXCOM_PG_URL:
        return None
    if _pg_pool is not None:
        return _pg_pool
    async with _pg_init_lock:
        if _pg_pool is not None:
            return _pg_pool
        try:
            import asyncpg  # type: ignore
            _pg_pool = await asyncpg.create_pool(
                NEXCOM_PG_URL,
                min_size=1,
                max_size=5,
                command_timeout=10,
            )
            logger.info("[SessionStore] asyncpg pool connected to PostgreSQL")
        except Exception as exc:
            logger.warning("[SessionStore] PostgreSQL unavailable, using in-memory store: %s", exc)
            _pg_pool = None
    return _pg_pool


# ── Public API ─────────────────────────────────────────────────────────────────

async def save_session(session_id: str, session_data: dict[str, Any]) -> None:
    """Upsert a liveness session into the store."""
    pool = await _get_pool()
    if pool is None:
        _memory_store[session_id] = session_data
        return
    try:
        async with pool.acquire() as conn:
            await conn.execute(
                """
                INSERT INTO kyc_liveness_sessions (
                    session_id, application_id, user_id,
                    challenges, current_challenge_index, results,
                    overall_result, face_match_score, spoof_type,
                    spoof_confidence, landmarks_json, status,
                    created_at, updated_at
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW(), NOW())
                ON CONFLICT (session_id) DO UPDATE SET
                    current_challenge_index = EXCLUDED.current_challenge_index,
                    results                 = EXCLUDED.results,
                    overall_result          = EXCLUDED.overall_result,
                    face_match_score        = EXCLUDED.face_match_score,
                    spoof_type              = EXCLUDED.spoof_type,
                    spoof_confidence        = EXCLUDED.spoof_confidence,
                    landmarks_json          = EXCLUDED.landmarks_json,
                    status                  = EXCLUDED.status,
                    updated_at              = NOW()
                """,
                session_id,
                session_data.get("application_id"),
                session_data.get("user_id"),
                json.dumps(session_data.get("challenges", [])),
                session_data.get("current_challenge_index", 0),
                json.dumps(session_data.get("results", [])),
                session_data.get("overall_result"),
                session_data.get("face_match_score"),
                session_data.get("spoof_type"),
                session_data.get("spoof_confidence"),
                json.dumps(session_data.get("landmarks_68")) if session_data.get("landmarks_68") else None,
                session_data.get("status", "PENDING"),
            )
    except Exception as exc:
        logger.warning("[SessionStore] PG upsert failed, falling back to memory: %s", exc)
        _memory_store[session_id] = session_data


async def load_session(session_id: str) -> Optional[dict[str, Any]]:
    """Load a liveness session from the store."""
    pool = await _get_pool()
    if pool is None:
        return _memory_store.get(session_id)
    try:
        async with pool.acquire() as conn:
            row = await conn.fetchrow(
                "SELECT * FROM kyc_liveness_sessions WHERE session_id = $1",
                session_id,
            )
            if row is None:
                return _memory_store.get(session_id)
            data = dict(row)
            # Deserialise JSON columns
            for col in ("challenges", "results", "landmarks_json"):
                if data.get(col) and isinstance(data[col], str):
                    try:
                        data[col] = json.loads(data[col])
                    except Exception:
                        pass
            return data
    except Exception as exc:
        logger.warning("[SessionStore] PG load failed, falling back to memory: %s", exc)
        return _memory_store.get(session_id)


async def delete_session(session_id: str) -> None:
    """Remove a completed session from the store."""
    _memory_store.pop(session_id, None)
    pool = await _get_pool()
    if pool is None:
        return
    try:
        async with pool.acquire() as conn:
            await conn.execute(
                "DELETE FROM kyc_liveness_sessions WHERE session_id = $1",
                session_id,
            )
    except Exception as exc:
        logger.warning("[SessionStore] PG delete failed: %s", exc)


async def publish_liveness_event(
    session_id: str,
    user_id: Optional[int],
    application_id: Optional[str],
    result: str,          # "PASS" | "FAIL"
    face_match_score: Optional[float],
    spoof_type: str,
    spoof_confidence: float,
    confidence: float,
) -> None:
    """
    POST a liveness completion event to the Node.js server so it can:
      1. Write a row to the securityEvents table.
      2. Trigger downstream actions (re-KYC scheduler, notifications, etc.).
    """
    payload = {
        "sessionId": session_id,
        "userId": user_id,
        "applicationId": application_id,
        "result": result,
        "faceMatchScore": face_match_score,
        "spoofType": spoof_type,
        "spoofConfidence": spoof_confidence,
        "confidence": confidence,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }
    url = f"{NEXCOM_SERVER_URL}/api/internal/liveness-event"
    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            resp = await client.post(
                url,
                json=payload,
                headers={
                    "Content-Type": "application/json",
                    "X-Internal-Secret": NEXCOM_INTERNAL_SECRET,
                },
            )
            if resp.status_code not in (200, 201, 204):
                logger.warning(
                    "[SessionStore] liveness event webhook returned %d: %s",
                    resp.status_code,
                    resp.text[:200],
                )
            else:
                logger.info(
                    "[SessionStore] liveness event published: session=%s result=%s",
                    session_id,
                    result,
                )
    except Exception as exc:
        logger.warning("[SessionStore] liveness event webhook failed: %s", exc)
