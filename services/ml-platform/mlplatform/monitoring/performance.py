"""
Live model performance monitoring: joins serving exposure logs with realized
labels on the request/user key and alerts when the live metric degrades beyond
DEGRADATION_TOLERANCE relative to the registered validation metric.

Closes audit finding A3 §2 ("A/B testing, drift monitoring, continuous
retraining: ABSENT") — this is the continuous *evaluation* half.

Data sources:
  - predictions: exposure JSONL written by mlplatform.serving.ab
      {ts, model, version, variant, user_id, score, latency_ms, request_id}
  - labels: CSV/parquet with a join key (user_id or request_id), a binary or
    numeric outcome column, and a timestamp column. Only labels realized
    *after* the prediction timestamp are joined (no lookahead).

Function API:
    report = performance_report("fraud", labels=df, ...)
CLI:
    python -m mlplatform.monitoring.performance --model fraud \
        --labels-file labels.csv --label-column is_fraud
"""
from __future__ import annotations

import argparse
import json
import logging
import os
from pathlib import Path
from typing import Optional

import numpy as np

from ..serving import ab as ab_mod

logger = logging.getLogger("mlplatform.monitoring.performance")

DEGRADATION_TOLERANCE = float(os.environ.get("DEGRADATION_TOLERANCE", "0.05"))
ROLLING_WINDOW_HOURS = float(os.environ.get("PERF_WINDOW_HOURS", "24"))
MIN_JOINED_SAMPLES = int(os.environ.get("PERF_MIN_SAMPLES", "50"))


def _binary_metrics(y_true: np.ndarray, scores: np.ndarray) -> dict:
    """AUC (rank-based, no sklearn dependency), accuracy, log-loss."""
    y = np.asarray(y_true, dtype=np.float64)
    s = np.asarray(scores, dtype=np.float64)
    out: dict = {"n": int(y.size)}
    if y.size == 0:
        return out
    pos = y > 0.5
    if pos.any() and (~pos).any():
        # Mann-Whitney AUC
        order = np.argsort(s, kind="mergesort")
        ranks = np.empty_like(order, dtype=np.float64)
        ranks[order] = np.arange(1, s.size + 1)
        n_pos, n_neg = pos.sum(), (~pos).sum()
        out["auc"] = float((ranks[pos].sum() - n_pos * (n_pos + 1) / 2) / (n_pos * n_neg))
    preds = (s >= 0.5).astype(np.float64)
    out["accuracy"] = float((preds == (y > 0.5)).mean())
    clipped = np.clip(s, 1e-7, 1 - 1e-7)
    out["log_loss"] = float(-(y * np.log(clipped) + (1 - y) * np.log(1 - clipped)).mean())
    return out


def _regression_metrics(y_true: np.ndarray, scores: np.ndarray) -> dict:
    y = np.asarray(y_true, dtype=np.float64)
    s = np.asarray(scores, dtype=np.float64)
    if y.size == 0:
        return {"n": 0}
    err = s - y
    return {
        "n": int(y.size),
        "rmse": float(np.sqrt((err**2).mean())),
        "mae": float(np.abs(err).mean()),
    }


def _load_registered_metric(model: str) -> tuple[dict, Optional[str]]:
    """Champion metrics.json from the registry (best-effort)."""
    try:
        from mlplatform.registry import get_registry

        artifact_dir, _ = get_registry().load(model, "champion")
        metrics_file = Path(artifact_dir) / "metrics.json"
        if metrics_file.is_file():
            return json.loads(metrics_file.read_text()), str(metrics_file)
    except Exception as exc:
        logger.info("could not load registered metrics for %s: %s", model, exc)
    base = Path(os.environ.get("REGISTRY_PATH", "/data/model_registry")) / model
    versions = sorted(
        (d for d in base.glob("v*") if d.is_dir()),
        key=lambda d: int(d.name[1:]) if d.name[1:].isdigit() else -1,
    )
    if versions and (versions[-1] / "metrics.json").is_file():
        return json.loads((versions[-1] / "metrics.json").read_text()), str(versions[-1] / "metrics.json")
    return {}, None


def join_labels_with_exposures(
    model: str,
    labels,
    label_column: str = "label",
    join_key: str = "user_id",
    label_ts_column: Optional[str] = None,
    window_hours: float = ROLLING_WINDOW_HOURS,
    log_dir: Optional[Path] = None,
):
    """Rolling labeled-outcome join: each label row is matched to the most
    recent exposure for the same key at-or-before label time (no lookahead)."""
    import pandas as pd

    exposures = ab_mod.read_exposures(model, log_dir)
    if not exposures:
        return pd.DataFrame()
    exp = pd.DataFrame(exposures)
    lab = labels.copy()
    if label_ts_column and label_ts_column in lab.columns:
        col = lab[label_ts_column]
        if np.issubdtype(col.dtype, np.number):
            median = float(col.dropna().median()) if col.notna().any() else 0.0
            unit = "ms" if median > 1e12 else "s"  # epoch seconds vs milliseconds
            lab["label_ts_epoch"] = col / (1e3 if unit == "ms" else 1.0)
        else:
            lab_ts = pd.to_datetime(col, utc=True, errors="coerce")
            lab["label_ts_epoch"] = lab_ts.astype("int64") / 1e9
    else:
        lab["label_ts_epoch"] = np.nan
    cutoff = np.nan
    if lab["label_ts_epoch"].notna().any():
        cutoff = float(lab["label_ts_epoch"].max()) - window_hours * 3600
        lab = lab[lab["label_ts_epoch"] >= cutoff]
    exp = exp.sort_values("ts")
    lab = lab.sort_values("label_ts_epoch" if lab["label_ts_epoch"].notna().all() else label_column)

    joined_rows = []
    by_key: dict[str, list[tuple[float, int]]] = {}
    exp_records = exp.reset_index()
    for row in exp_records.itertuples():
        by_key.setdefault(str(getattr(row, join_key, row.user_id)), []).append(
            (float(row.ts), int(row.Index))
        )
    for lrow in lab.itertuples():
        key = str(getattr(lrow, join_key, getattr(lrow, "user_id", "")))
        cand = by_key.get(key)
        if not cand:
            continue
        lts = float(getattr(lrow, "label_ts_epoch"))
        eligible = [c for c in cand if not np.isfinite(lts) or c[0] <= lts]
        if not eligible:
            continue
        _, exp_idx = eligible[-1]  # most recent prediction at-or-before the label
        erow = exp.loc[exp_idx]
        joined_rows.append({
            "key": key,
            "label": float(getattr(lrow, label_column)),
            "score": float(erow["score"]),
            "variant": erow.get("variant", "champion"),
            "version": str(erow.get("version", "")),
            "prediction_ts": float(erow["ts"]),
            "label_ts": lts if np.isfinite(lts) else None,
        })
    return pd.DataFrame(joined_rows)


def performance_report(
    model: str,
    labels,
    label_column: str = "label",
    join_key: str = "user_id",
    label_ts_column: Optional[str] = None,
    task: str = "classification",
    window_hours: float = ROLLING_WINDOW_HOURS,
    log_dir: Optional[Path] = None,
    alert: bool = True,
) -> dict:
    """Compute live-vs-registered performance report; alert on degradation."""
    joined = join_labels_with_exposures(
        model, labels, label_column, join_key, label_ts_column, window_hours, log_dir
    )
    registered, metrics_source = _load_registered_metric(model)

    if len(joined) < MIN_JOINED_SAMPLES:
        return {
            "model": model,
            "status": "insufficient_data",
            "joined_samples": int(len(joined)),
            "min_samples_required": MIN_JOINED_SAMPLES,
            "metrics_source": metrics_source,
            "alert": False,
        }

    metric_fn = _binary_metrics if task == "classification" else _regression_metrics
    live = metric_fn(joined["label"].to_numpy(), joined["score"].to_numpy())
    per_variant = {
        variant: metric_fn(
            joined.loc[joined["variant"] == variant, "label"].to_numpy(),
            joined.loc[joined["variant"] == variant, "score"].to_numpy(),
        )
        for variant in sorted(joined["variant"].unique())
    }

    primary = "auc" if task == "classification" else "rmse"
    higher_is_better = task == "classification"
    registered_value = None
    for key in (primary, f"val_{primary}", "roc_auc", "val_auc"):
        if key in registered:
            registered_value = float(registered[key])
            break
    degraded = False
    delta = None
    if registered_value is not None and primary in live:
        delta = (live[primary] - registered_value) if higher_is_better else (registered_value - live[primary])
        degraded = delta < -DEGRADATION_TOLERANCE

    report = {
        "model": model,
        "status": "degraded" if degraded else "ok",
        "window_hours": window_hours,
        "joined_samples": int(len(joined)),
        "live_metrics": live,
        "per_variant": per_variant,
        "registered_metrics": registered,
        "metrics_source": metrics_source,
        "primary_metric": primary,
        "live_vs_registered_delta": round(delta, 6) if delta is not None else None,
        "degradation_tolerance": DEGRADATION_TOLERANCE,
        "alert": degraded,
    }
    if degraded and alert:
        _send_performance_alert(report)
    return report


def _send_performance_alert(report: dict) -> bool:
    url = os.environ.get("ALERT_WEBHOOK_URL", "")
    payload = {
        "alert_type": "MODEL_PERFORMANCE_DEGRADATION",
        "severity": "HIGH",
        "model": report["model"],
        "primary_metric": report["primary_metric"],
        "live_vs_registered_delta": report["live_vs_registered_delta"],
        "degradation_tolerance": report["degradation_tolerance"],
        "joined_samples": report["joined_samples"],
    }
    if not url:
        logger.warning("Performance degradation for %s (delta=%s) — ALERT_WEBHOOK_URL unset",
                       report["model"], report["live_vs_registered_delta"])
        return False
    try:
        import httpx

        with httpx.Client(timeout=5.0) as client:
            resp = client.post(url, json=payload)
        logger.info("Performance alert POSTed to %s → %s", url, resp.status_code)
        return resp.status_code < 400
    except Exception as exc:
        logger.error("Performance alert delivery failed (%s): %s", url, exc)
        return False


def main(argv: Optional[list[str]] = None) -> int:
    parser = argparse.ArgumentParser(description="Live model performance vs registered validation metric")
    parser.add_argument("--model", required=True)
    parser.add_argument("--labels-file", required=True, help="CSV/parquet with realized outcomes")
    parser.add_argument("--label-column", default="label")
    parser.add_argument("--join-key", default="user_id")
    parser.add_argument("--label-ts-column", default=None)
    parser.add_argument("--task", choices=["classification", "regression"], default="classification")
    parser.add_argument("--window-hours", type=float, default=ROLLING_WINDOW_HOURS)
    parser.add_argument("--no-alert", action="store_true")
    args = parser.parse_args(argv)

    import pandas as pd

    path = Path(args.labels_file)
    labels = pd.read_parquet(path) if path.suffix == ".parquet" else pd.read_csv(path)
    report = performance_report(
        args.model, labels,
        label_column=args.label_column,
        join_key=args.join_key,
        label_ts_column=args.label_ts_column,
        task=args.task,
        window_hours=args.window_hours,
        alert=not args.no_alert,
    )
    print(json.dumps(report, indent=2, default=str))
    return 1 if report["alert"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
