"""
Online feature store: per-account latest history features for serving.

Closes the offline/online skew gap (audit-grade honesty): history-derived
numerics (payer_prior_txn_velocity, device/ip sharing counts, device novelty,
amount_vs_payer_median) cannot be derived from a single request — they are
loaded from the gold layer's `serving_features` table, written by the
lakehouse gold job with exact train-time semantics.

Store layout (produced by ML-CORE lakehouse/gold):
  {LAKEHOUSE_PATH}/gold/serving_features.parquet
  {LAKEHOUSE_PATH}/gold/serving_features.csv
  {LAKEHOUSE_PATH}/gold/serving_features/         (dir of part files, either)

One row per account. Key column: first present of
["account_id", "payer_id", "user_id"]. Recognized history columns (raw forms
are normalized at serve time with the train-time transforms; pre-normalized
aliases are accepted verbatim):

  payer_prior_txn_count        raw backward-looking txn count → clip(c/100,0,1)
  payer_prior_txn_velocity     pre-normalized equivalent
  payer_median_amount_ngn      median historical amount → amount_vs_payer_median
  device_user_count            distinct users on the account's device → clip(/10,0,1)
  device_user_count_norm       pre-normalized equivalent
  ip_user_count / ip_user_count_norm        same for IP
  known_device_ids             JSON/semicolon list of devices the account used
  last_device_id               most recent device (novelty check fallback)
  payer_device_new             direct 0/1 override
  commodity_median_price_ngn_per_mt         commodity median price context

Any additional numeric columns are exposed to the request `features` merge
verbatim. Unknown accounts yield None (callers apply cold-start defaults and
mark the response honestly).

Thread-safe, TTL-reloading (FEATURE_STORE_TTL_SECONDS, default 300), and
honest in empty-store mode: no fabricated history, just cold-start defaults.
"""
from __future__ import annotations

import json
import logging
import os
import threading
import time
from pathlib import Path
from typing import Optional

logger = logging.getLogger("mlplatform.serving.feature_store")

_KEY_COLUMNS = ("account_id", "payer_id", "user_id")


def _ttl_seconds() -> float:
    try:
        return float(os.environ.get("FEATURE_STORE_TTL_SECONDS", "300"))
    except ValueError:
        return 300.0


def _lakehouse_path() -> Path:
    try:
        from mlplatform import settings as _settings  # type: ignore

        val = getattr(_settings, "LAKEHOUSE_PATH", None)
        if val is None and hasattr(_settings, "get_settings"):
            val = getattr(_settings.get_settings(), "lakehouse_path", None)
        if val:
            return Path(str(val))
    except Exception:
        pass
    return Path(os.environ.get("LAKEHOUSE_PATH", "/data/lakehouse"))


class FeatureStore:
    """In-memory snapshot of gold/serving_features keyed by account id."""

    def __init__(self, lakehouse_path: Optional[Path] = None, ttl_seconds: Optional[float] = None):
        self.base = Path(lakehouse_path) if lakehouse_path else _lakehouse_path()
        self.ttl = ttl_seconds if ttl_seconds is not None else _ttl_seconds()
        self._lock = threading.RLock()
        self._loaded_at = 0.0
        self._rows: dict[str, dict] = {}
        self._source: Optional[str] = None
        self._last_error: Optional[str] = None

    # ── loading ────────────────────────────────────────────────────────────

    def _candidate_paths(self) -> list[Path]:
        gold = self.base / "gold"
        return [
            gold / "serving_features.parquet",
            gold / "serving_features.csv",
            gold / "serving_features",
        ]

    def _read_frame(self):
        import pandas as pd

        frames = []
        for path in self._candidate_paths():
            if path.is_file():
                try:
                    if path.suffix == ".parquet":
                        frames.append(pd.read_parquet(path))
                    elif path.suffix == ".csv":
                        frames.append(pd.read_csv(path))
                except Exception as exc:
                    logger.warning("feature store read failed for %s: %s", path, exc)
            elif path.is_dir():
                for part in sorted(path.iterdir()):
                    try:
                        if part.suffix == ".parquet":
                            frames.append(pd.read_parquet(part))
                        elif part.suffix == ".csv":
                            frames.append(pd.read_csv(part))
                    except Exception as exc:
                        logger.warning("feature store part read failed for %s: %s", part, exc)
        if not frames:
            return None
        import pandas as pd

        df = pd.concat(frames, ignore_index=True) if len(frames) > 1 else frames[0]
        key_col = next((c for c in _KEY_COLUMNS if c in df.columns), None)
        if key_col is None:
            raise ValueError(
                f"serving_features has none of the key columns {_KEY_COLUMNS}; "
                f"columns: {list(df.columns)[:12]}"
            )
        return df, key_col

    def _refresh_locked(self) -> None:
        self._loaded_at = time.monotonic()
        result = self._read_frame()
        if result is None:
            if self._rows:
                logger.info("feature store source gone; keeping %d stale rows", len(self._rows))
            else:
                logger.info("feature store empty (no gold/serving_features under %s)", self.base)
            self._source = None
            return
        df, key_col = result
        rows: dict[str, dict] = {}
        for record in df.to_dict(orient="records"):
            key = record.get(key_col)
            if key is None or (isinstance(key, float) and key != key):  # NaN
                continue
            rows[str(key)] = {str(k): v for k, v in record.items() if k != key_col}
        self._rows = rows
        self._source = str(self.base / "gold" / "serving_features")
        logger.info("feature store loaded: %d accounts from %s", len(rows), self._source)

    def _maybe_refresh(self) -> None:
        with self._lock:
            if self._loaded_at == 0.0 or (time.monotonic() - self._loaded_at) >= self.ttl:
                try:
                    self._refresh_locked()
                    self._last_error = None
                except Exception as exc:
                    self._last_error = str(exc)
                    logger.warning("feature store refresh failed: %s", exc)

    # ── reads ──────────────────────────────────────────────────────────────

    def get(self, account_id: Optional[str]) -> Optional[dict]:
        """Latest history features for an account, or None when unknown
        (cold-start) / store empty. Never fabricates values."""
        if not account_id:
            return None
        self._maybe_refresh()
        with self._lock:
            row = self._rows.get(str(account_id))
            return dict(row) if row is not None else None

    def stats(self) -> dict:
        self._maybe_refresh()
        with self._lock:
            return {
                "accounts": len(self._rows),
                "source": self._source,
                "empty": not self._rows,
                "ttl_seconds": self.ttl,
                "last_error": self._last_error,
            }


_MODULE_STORE: Optional[FeatureStore] = None
_MODULE_LOCK = threading.Lock()


def get_feature_store(lakehouse_path: Optional[Path] = None) -> FeatureStore:
    """Process-wide feature store singleton (path injectable for tests)."""
    global _MODULE_STORE
    with _MODULE_LOCK:
        if _MODULE_STORE is None or lakehouse_path is not None:
            _MODULE_STORE = FeatureStore(lakehouse_path)
        return _MODULE_STORE


def parse_known_devices(row: dict) -> set[str]:
    """known_device_ids column → set of device strings (JSON list or ';'-sep)."""
    raw = row.get("known_device_ids")
    if raw is None:
        return set()
    if isinstance(raw, (list, tuple, set)):
        return {str(v) for v in raw}
    text = str(raw).strip()
    if not text:
        return set()
    try:
        parsed = json.loads(text)
        if isinstance(parsed, list):
            return {str(v) for v in parsed}
    except (json.JSONDecodeError, TypeError):
        pass
    return {p.strip() for p in text.split(";") if p.strip()}
