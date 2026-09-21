"""
Thin httpx client for the NEXCOM ML platform serving API (services/ml-platform).

Closes audit finding A3 §1 (ai-ml routes previously scored from per-request
RNG features): routes call this client first and mark responses with
``model_source: "ml-platform@<name>:<version>"`` on success; on any failure
they fall back to the legacy sklearn path and mark ``"legacy-synthetic"``.

Configuration:
  ML_PLATFORM_URL          default http://ml-platform:8015
  ML_PLATFORM_TIMEOUT      seconds, default 2.0
  ML_PLATFORM_CB_FAILURES  consecutive failures before the breaker opens (3)
  ML_PLATFORM_CB_COOLDOWN  seconds the breaker stays open (30)

The circuit breaker is fail-open-after-cooldown (half-open single probe).
All functions return None on failure — callers decide the fallback.
"""
from __future__ import annotations

import logging
import os
import threading
import time
from typing import Optional

import httpx

logger = logging.getLogger("nexcom.ai.mlplatform_client")

ML_PLATFORM_URL = os.environ.get("ML_PLATFORM_URL", "http://ml-platform:8015").rstrip("/")
TIMEOUT = float(os.environ.get("ML_PLATFORM_TIMEOUT", "2.0"))
_CB_FAILURE_THRESHOLD = int(os.environ.get("ML_PLATFORM_CB_FAILURES", "3"))
_CB_COOLDOWN_SECONDS = float(os.environ.get("ML_PLATFORM_CB_COOLDOWN", "30"))


class _CircuitBreaker:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._failures = 0
        self._opened_at: Optional[float] = None

    def allow(self) -> bool:
        with self._lock:
            if self._opened_at is None:
                return True
            if time.monotonic() - self._opened_at >= _CB_COOLDOWN_SECONDS:
                return True  # half-open probe
            return False

    def success(self) -> None:
        with self._lock:
            self._failures = 0
            self._opened_at = None

    def failure(self) -> None:
        with self._lock:
            self._failures += 1
            if self._failures >= _CB_FAILURE_THRESHOLD and self._opened_at is None:
                self._opened_at = time.monotonic()
                logger.warning(
                    "[mlplatform-client] circuit breaker OPEN after %d failures; "
                    "cooldown %.0fs", self._failures, _CB_COOLDOWN_SECONDS,
                )

    def state(self) -> str:
        with self._lock:
            if self._opened_at is None:
                return "closed"
            return "half-open" if time.monotonic() - self._opened_at >= _CB_COOLDOWN_SECONDS else "open"


_breaker = _CircuitBreaker()


def _post(path: str, payload: dict) -> Optional[dict]:
    """POST with circuit breaker. Returns parsed JSON or None on any failure."""
    if not _breaker.allow():
        return None
    try:
        with httpx.Client(base_url=ML_PLATFORM_URL, timeout=TIMEOUT) as client:
            resp = client.post(path, json=payload)
        if resp.status_code != 200:
            # 503 (model not trained yet) is a known, non-fault response.
            if resp.status_code == 503:
                logger.info("[mlplatform-client] %s → 503 (model unavailable)", path)
            else:
                _breaker.failure()
                logger.warning("[mlplatform-client] %s → %s", path, resp.status_code)
            return None
        _breaker.success()
        return resp.json()
    except Exception as exc:
        _breaker.failure()
        logger.info("[mlplatform-client] %s failed: %s", path, exc)
        return None


def _get(path: str) -> Optional[dict]:
    if not _breaker.allow():
        return None
    try:
        with httpx.Client(base_url=ML_PLATFORM_URL, timeout=TIMEOUT) as client:
            resp = client.get(path)
        if resp.status_code != 200:
            return None
        _breaker.success()
        return resp.json()
    except Exception as exc:
        _breaker.failure()
        logger.info("[mlplatform-client] GET %s failed: %s", path, exc)
        return None


# ── Prediction calls ─────────────────────────────────────────────────────────

def predict_fraud(payload: dict) -> Optional[dict]:
    """Raw transaction fields → fraud probability (FraudNet champion)."""
    return _post("/v1/predict/fraud", payload)


def predict_credit(user_id: str, features: dict) -> Optional[dict]:
    """User features → 300-900 credit score + default probability."""
    return _post("/v1/predict/credit", {"user_id": user_id, "features": features})


def predict_price(symbol: str, horizon: int = 1, sequence: Optional[list] = None) -> Optional[dict]:
    """Symbol (+optional recent price window) → next-day return distribution."""
    payload: dict = {"symbol": symbol, "horizon": horizon}
    if sequence is not None:
        payload["sequence"] = sequence
    return _post("/v1/predict/price", payload)


def predict_graph(account_id: str) -> Optional[dict]:
    """Account id → GNN fraud-ring membership probability."""
    return _post("/v1/predict/graph", {"account_id": account_id})


def list_models() -> Optional[dict]:
    return _get("/v1/models")


def health() -> dict:
    """Honest connectivity check for /healthz reporting."""
    result = _get("/health")
    return {
        "url": ML_PLATFORM_URL,
        "reachable": result is not None,
        "circuit_breaker": _breaker.state(),
        "detail": result if result else None,
    }
