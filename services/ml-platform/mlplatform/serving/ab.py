"""
Deterministic champion/challenger A/B assignment with exposure logging.

Closes audit finding A3 §2 ("A/B testing, drift monitoring, continuous
retraining: ABSENT").

Assignment rule (binding blueprint contract):
    bucket = int(sha256(f"{model}:{user_id}").hexdigest(), 16) % 100
    variant = "challenger" if bucket < challenger_pct else "champion"

- challenger_pct comes from env AB_CHALLENGER_PCT_<MODEL> (per model),
  AB_CHALLENGER_PCT (global), or configs/default.yaml serving.challenger_pct
  when present. Default 0 (champion only).
- Every served prediction logs one JSON line per exposure:
  {ts, model, version, variant, user_id, score, latency_ms}
- Exposure logs live under EXPOSURE_LOG_PATH (default REGISTRY_PATH/exposures)
  as <model>.jsonl and are the join key source for
  mlplatform.monitoring.performance (labeled-outcome joins).
"""
from __future__ import annotations

import hashlib
import json
import logging
import os
import threading
import time
from collections import defaultdict
from pathlib import Path
from typing import Optional

logger = logging.getLogger("mlplatform.serving.ab")

_VARIANTS = ("champion", "challenger")


def _env(name: str, default: str = "") -> str:
    return os.environ.get(name, default)


def exposure_log_dir() -> Path:
    default = Path(_env("REGISTRY_PATH", "/data/model_registry")) / "exposures"
    return Path(_env("EXPOSURE_LOG_PATH", str(default)))


def challenger_pct(model: str) -> int:
    """Challenger traffic percentage for a model (0-100)."""
    per_model = _env(f"AB_CHALLENGER_PCT_{model.upper().replace('-', '_')}")
    raw = per_model or _env("AB_CHALLENGER_PCT", "")
    if not raw:
        raw = str(_yaml_challenger_pct(model))
    try:
        return max(0, min(100, int(float(raw))))
    except (TypeError, ValueError):
        return 0


def _yaml_challenger_pct(model: str) -> int:
    """Best-effort read of configs/default.yaml serving.challenger_pct."""
    cfg = Path(__file__).resolve().parents[2] / "configs" / "default.yaml"
    if not cfg.is_file():
        return 0
    try:
        import yaml  # type: ignore

        data = yaml.safe_load(cfg.read_text()) or {}
        serving = data.get("serving", {})
        per_model = serving.get("challenger_pct_by_model", {}) or {}
        return int(per_model.get(model, serving.get("challenger_pct", 0)))
    except Exception:
        return 0


def assign_variant(model: str, user_id: str, pct: Optional[int] = None) -> tuple[str, int]:
    """Deterministic (variant, bucket) for (model, user_id)."""
    pct = challenger_pct(model) if pct is None else max(0, min(100, int(pct)))
    bucket = int(hashlib.sha256(f"{model}:{user_id}".encode()).hexdigest(), 16) % 100
    return ("challenger" if bucket < pct else "champion"), bucket


class ExposureLogger:
    """Append-only JSONL exposure log with in-memory metric aggregation."""

    def __init__(self, log_dir: Optional[Path] = None):
        self.log_dir = Path(log_dir) if log_dir else exposure_log_dir()
        self._lock = threading.Lock()
        self._handles: dict[str, object] = {}
        self._stats: dict[str, dict[str, dict[str, float]]] = defaultdict(
            lambda: defaultdict(lambda: {"count": 0, "score_sum": 0.0, "lat_sum": 0.0, "lat_max": 0.0})
        )

    def _handle(self, model: str):
        if model not in self._handles:
            self.log_dir.mkdir(parents=True, exist_ok=True)
            self._handles[model] = open(self.log_dir / f"{model}.jsonl", "a", buffering=1)
        return self._handles[model]

    def log(
        self,
        model: str,
        version: str,
        variant: str,
        user_id: str,
        score: float,
        latency_ms: float,
        request_id: Optional[str] = None,
    ) -> dict:
        record = {
            "ts": time.time(),
            "model": model,
            "version": str(version),
            "variant": variant,
            "user_id": str(user_id),
            "score": float(score),
            "latency_ms": round(float(latency_ms), 3),
        }
        if request_id:
            record["request_id"] = request_id
        try:
            with self._lock:
                self._handle(model).write(json.dumps(record) + "\n")
                agg = self._stats[model][variant]
                agg["count"] += 1
                agg["score_sum"] += record["score"]
                agg["lat_sum"] += record["latency_ms"]
                agg["lat_max"] = max(agg["lat_max"], record["latency_ms"])
        except OSError as exc:
            # Exposure logging must never fail a prediction request.
            logger.warning("exposure log write failed for %s: %s", model, exc)
        return record

    def aggregate(self, model: Optional[str] = None) -> dict:
        """Per-variant aggregates from the in-memory accumulators."""
        with self._lock:
            models = [model] if model else list(self._stats.keys())
            out: dict[str, dict] = {}
            for m in models:
                variants = {}
                for variant in _VARIANTS:
                    agg = self._stats[m].get(variant)
                    if not agg or not agg["count"]:
                        variants[variant] = {"exposures": 0}
                        continue
                    variants[variant] = {
                        "exposures": int(agg["count"]),
                        "mean_score": round(agg["score_sum"] / agg["count"], 6),
                        "mean_latency_ms": round(agg["lat_sum"] / agg["count"], 3),
                        "max_latency_ms": round(agg["lat_max"], 3),
                    }
                out[m] = variants
            return out


def read_exposures(model: str, log_dir: Optional[Path] = None, since_ts: float = 0.0) -> list[dict]:
    """Replay exposure records for a model (used by monitoring.performance)."""
    path = (Path(log_dir) if log_dir else exposure_log_dir()) / f"{model}.jsonl"
    records: list[dict] = []
    if not path.is_file():
        return records
    with open(path) as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            try:
                rec = json.loads(line)
            except json.JSONDecodeError:
                continue
            if rec.get("ts", 0.0) >= since_ts:
                records.append(rec)
    return records


def experiment_stats(model: str, log_dir: Optional[Path] = None) -> dict:
    """Durable per-variant stats computed by replaying the JSONL log."""
    records = read_exposures(model, log_dir)
    by_variant: dict[str, list[dict]] = {v: [] for v in _VARIANTS}
    for rec in records:
        by_variant.setdefault(rec.get("variant", "champion"), []).append(rec)
    variants = {}
    for variant, recs in by_variant.items():
        if not recs:
            variants[variant] = {"exposures": 0}
            continue
        scores = sorted(float(r["score"]) for r in recs)
        lats = sorted(float(r.get("latency_ms", 0.0)) for r in recs)
        versions = sorted({str(r.get("version", "")) for r in recs})
        variants[variant] = {
            "exposures": len(recs),
            "mean_score": round(sum(scores) / len(scores), 6),
            "p50_score": scores[len(scores) // 2],
            "p50_latency_ms": lats[len(lats) // 2],
            "versions": versions,
        }
    return {
        "model": model,
        "challenger_pct": challenger_pct(model),
        "total_exposures": len(records),
        "variants": variants,
    }
