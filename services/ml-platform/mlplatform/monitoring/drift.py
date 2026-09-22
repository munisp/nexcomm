"""
Feature drift monitoring: PSI + two-sample KS for numeric features, total
variation distance for categoricals, against the champion artifact's
reference_stats.json. Threshold breaches POST to ALERT_WEBHOOK_URL.

Closes audit finding A3 §2 ("A/B testing, drift monitoring, continuous
retraining: ABSENT").

reference_stats.json contract (written by training / pipelines.end_to_end):
{
  "numeric": {
    "<feature>": {
      "mean": float, "std": float,
      "histogram": {"edges": [b0..bK], "counts": [c0..cK-1]},
      "sample": [float, ...]        # optional: enables exact KS
    }
  },
  "categorical": {"<feature>": {"frequencies": {"<value>": prob}}}
}

Function API:
    report = drift_report(model_dir_or_name, live)   # live: dict[str, array-like]
CLI:
    python -m mlplatform.monitoring.drift --model fraud \
        --live-file live.csv [--registry-path ...] [--psi-threshold 0.2]
"""
from __future__ import annotations

import argparse
import json
import logging
import math
import os
from pathlib import Path
from typing import Optional

import numpy as np
from scipy import stats as scipy_stats

logger = logging.getLogger("mlplatform.monitoring.drift")

PSI_THRESHOLD = float(os.environ.get("DRIFT_PSI_THRESHOLD", "0.2"))
KS_THRESHOLD = float(os.environ.get("DRIFT_KS_PVALUE_THRESHOLD", "0.01"))
TV_THRESHOLD = float(os.environ.get("DRIFT_TV_THRESHOLD", "0.2"))
MAX_DRIFTED_FRACTION = float(os.environ.get("DRIFT_MAX_FEATURE_FRACTION", "0.2"))
N_HIST_BINS = int(os.environ.get("DRIFT_HIST_BINS", "10"))
_EPS = 1e-6


def psi(reference_counts: np.ndarray, live_counts: np.ndarray) -> float:
    """Population Stability Index between two binned distributions."""
    ref = np.asarray(reference_counts, dtype=np.float64)
    live = np.asarray(live_counts, dtype=np.float64)
    ref_pct = np.clip(ref / max(ref.sum(), _EPS), _EPS, None)
    live_pct = np.clip(live / max(live.sum(), _EPS), _EPS, None)
    return float(np.sum((live_pct - ref_pct) * np.log(live_pct / ref_pct)))


def tv_distance(ref_freq: dict, live_freq: dict) -> float:
    """Total variation distance between two categorical distributions."""
    keys = set(ref_freq) | set(live_freq)
    ref_total = sum(ref_freq.values()) or 1.0
    live_total = sum(live_freq.values()) or 1.0
    return float(0.5 * sum(
        abs(ref_freq.get(k, 0.0) / ref_total - live_freq.get(k, 0.0) / live_total)
        for k in keys
    ))


def _numeric_feature_report(name: str, spec: dict, live: np.ndarray) -> dict:
    live = np.asarray(live, dtype=np.float64)
    live = live[np.isfinite(live)]
    entry: dict = {"feature": name, "type": "numeric", "live_count": int(live.size)}
    if live.size == 0:
        entry["error"] = "no finite live values"
        entry["drifted"] = False
        return entry

    hist = spec.get("histogram") or {}
    edges = np.asarray(hist.get("edges", []), dtype=np.float64)
    ref_counts = np.asarray(hist.get("counts", []), dtype=np.float64)
    if edges.size >= 2 and ref_counts.size == edges.size - 1:
        # Extend outermost bins so out-of-range live values still land in a bin.
        ext_edges = edges.copy()
        ext_edges[0] = -np.inf
        ext_edges[-1] = np.inf
        live_counts, _ = np.histogram(live, bins=ext_edges)
        entry["psi"] = round(psi(ref_counts, live_counts), 6)
        entry["psi_threshold"] = PSI_THRESHOLD
    ref_sample = spec.get("sample")
    if isinstance(ref_sample, list) and len(ref_sample) >= 20 and live.size >= 20:
        ks = scipy_stats.ks_2samp(np.asarray(ref_sample, dtype=np.float64), live)
        entry["ks_statistic"] = round(float(ks.statistic), 6)
        entry["ks_pvalue"] = float(ks.pvalue)
        entry["ks_pvalue_threshold"] = KS_THRESHOLD
    if "mean" in spec and "std" in spec:
        entry["live_mean"] = round(float(live.mean()), 6)
        entry["reference_mean"] = spec["mean"]
        ref_std = float(spec.get("std") or 0.0)
        entry["mean_shift_std"] = (
            round(abs(live.mean() - float(spec["mean"])) / ref_std, 4) if ref_std > 0 else None
        )
    drifted = False
    reasons = []
    if entry.get("psi") is not None and entry["psi"] >= PSI_THRESHOLD:
        drifted, reasons = True, reasons + [f"psi={entry['psi']}>={PSI_THRESHOLD}"]
    if entry.get("ks_pvalue") is not None and entry["ks_pvalue"] <= KS_THRESHOLD:
        drifted, reasons = True, reasons + [f"ks_p={entry['ks_pvalue']:.4g}<={KS_THRESHOLD}"]
    entry["drifted"] = drifted
    entry["reasons"] = reasons
    return entry


def _categorical_feature_report(name: str, spec: dict, live: np.ndarray) -> dict:
    values, counts = np.unique(np.asarray(live).astype(str), return_counts=True)
    live_freq = dict(zip(values.tolist(), counts.astype(float).tolist()))
    ref_freq = {str(k): float(v) for k, v in (spec.get("frequencies") or {}).items()}
    tv = tv_distance(ref_freq, live_freq)
    return {
        "feature": name,
        "type": "categorical",
        "tv_distance": round(tv, 6),
        "tv_threshold": TV_THRESHOLD,
        "live_count": int(counts.sum()),
        "drifted": tv >= TV_THRESHOLD,
        "reasons": [f"tv={tv:.4f}>={TV_THRESHOLD}"] if tv >= TV_THRESHOLD else [],
    }


def compute_reference_stats(df) -> dict:
    """Build a reference_stats.json payload from a training dataframe.

    Numeric columns → mean/std + histogram + capped reservoir sample (for KS);
    everything else → categorical frequencies. Used by pipelines.end_to_end
    to set drift baselines and by training scripts.
    """
    import pandas as pd  # noqa: F401

    max_sample = int(os.environ.get("DRIFT_REFERENCE_SAMPLE", "2000"))
    numeric: dict = {}
    categorical: dict = {}
    for col in df.columns:
        series = df[col]
        if np.issubdtype(series.dtype, np.number):
            vals = series.to_numpy(dtype=np.float64)
            vals = vals[np.isfinite(vals)]
            if vals.size == 0:
                continue
            counts, edges = np.histogram(vals, bins=N_HIST_BINS)
            rng = np.random.default_rng(42)
            sample = vals if vals.size <= max_sample else rng.choice(vals, max_sample, replace=False)
            numeric[str(col)] = {
                "mean": float(vals.mean()),
                "std": float(vals.std()),
                "histogram": {"edges": edges.tolist(), "counts": counts.tolist()},
                "sample": [float(v) for v in sample],
            }
        else:
            freq = series.astype(str).value_counts(normalize=True)
            categorical[str(col)] = {"frequencies": {str(k): float(v) for k, v in freq.items()}}
    return {"numeric": numeric, "categorical": categorical}


def _resolve_reference(model: str, registry_path: Optional[Path]) -> tuple[dict, Path]:
    """Load reference_stats.json for a registry model (champion stage)."""
    try:
        from mlplatform.registry import get_registry

        artifact_dir, _ = get_registry().load(model, "champion")
        ref_path = Path(artifact_dir) / "reference_stats.json"
    except Exception:
        base = Path(registry_path or os.environ.get("REGISTRY_PATH", "/data/model_registry"))
        model_dir = base / model
        versions = sorted(
            (d for d in model_dir.glob("v*") if d.is_dir()),
            key=lambda d: int(d.name[1:]) if d.name[1:].isdigit() else -1,
        )
        ref_path = (model_dir / "reference_stats.json") if not versions else versions[-1] / "reference_stats.json"
    if not ref_path.is_file():
        raise FileNotFoundError(f"no reference_stats.json for model '{model}' (looked at {ref_path})")
    return json.loads(ref_path.read_text()), ref_path


def drift_report(
    model: str,
    live,
    registry_path: Optional[Path] = None,
    reference: Optional[dict] = None,
    alert: bool = True,
) -> dict:
    """Compute a drift report for a model against live feature data.

    live: pandas DataFrame or dict[str, array-like] with one entry per feature.
    """
    import pandas as pd

    if reference is None:
        reference, ref_path = _resolve_reference(model, registry_path)
    else:
        ref_path = None
    frame = live if isinstance(live, pd.DataFrame) else pd.DataFrame({k: list(v) for k, v in live.items()})

    features = []
    for name, spec in (reference.get("numeric") or {}).items():
        if name not in frame.columns:
            features.append({"feature": name, "type": "numeric", "error": "missing in live data",
                             "drifted": False, "reasons": []})
            continue
        features.append(_numeric_feature_report(name, spec, frame[name].to_numpy()))
    for name, spec in (reference.get("categorical") or {}).items():
        if name not in frame.columns:
            features.append({"feature": name, "type": "categorical", "error": "missing in live data",
                             "drifted": False, "reasons": []})
            continue
        features.append(_categorical_feature_report(name, spec, frame[name].to_numpy()))

    drifted = [f for f in features if f.get("drifted")]
    fraction = len(drifted) / max(len(features), 1)
    report = {
        "model": model,
        "reference_path": str(ref_path) if ref_path else None,
        "n_features": len(features),
        "n_drifted": len(drifted),
        "drifted_fraction": round(fraction, 4),
        "drifted_features": [f["feature"] for f in drifted],
        "alert": fraction > MAX_DRIFTED_FRACTION and len(drifted) > 0,
        "thresholds": {
            "psi": PSI_THRESHOLD, "ks_pvalue": KS_THRESHOLD,
            "tv": TV_THRESHOLD, "max_drifted_fraction": MAX_DRIFTED_FRACTION,
        },
        "features": features,
    }
    if report["alert"] and alert:
        send_drift_alert(report)
    return report


def send_drift_alert(report: dict) -> bool:
    """POST the drift alert to ALERT_WEBHOOK_URL (guarded httpx; no-op if unset)."""
    url = os.environ.get("ALERT_WEBHOOK_URL", "")
    if not url:
        logger.warning("Drift alert for %s (%d/%d features drifted) — ALERT_WEBHOOK_URL unset",
                       report["model"], report["n_drifted"], report["n_features"])
        return False
    payload = {
        "alert_type": "MODEL_DRIFT",
        "severity": "HIGH" if report["drifted_fraction"] > 0.5 else "MEDIUM",
        "model": report["model"],
        "drifted_fraction": report["drifted_fraction"],
        "drifted_features": report["drifted_features"],
        "thresholds": report["thresholds"],
    }
    try:
        import httpx

        with httpx.Client(timeout=5.0) as client:
            resp = client.post(url, json=payload)
        logger.info("Drift alert POSTed to %s → %s", url, resp.status_code)
        return resp.status_code < 400
    except Exception as exc:
        logger.error("Drift alert delivery failed (%s): %s", url, exc)
        return False


def main(argv: Optional[list[str]] = None) -> int:
    parser = argparse.ArgumentParser(description="Feature drift report vs registry reference stats")
    parser.add_argument("--model", required=True, help="registry model name (e.g. fraud)")
    parser.add_argument("--live-file", required=True, help="CSV/parquet/json of live feature rows")
    parser.add_argument("--registry-path", default=None)
    parser.add_argument("--no-alert", action="store_true")
    parser.add_argument("--out", default=None, help="write report JSON here")
    args = parser.parse_args(argv)

    import pandas as pd

    live_path = Path(args.live_file)
    if live_path.suffix == ".parquet":
        live = pd.read_parquet(live_path)
    elif live_path.suffix in (".json", ".jsonl"):
        live = pd.read_json(live_path, lines=live_path.suffix == ".jsonl")
    else:
        live = pd.read_csv(live_path)

    report = drift_report(
        args.model, live,
        registry_path=Path(args.registry_path) if args.registry_path else None,
        alert=not args.no_alert,
    )
    text = json.dumps(report, indent=2)
    if args.out:
        Path(args.out).write_text(text)
    print(text)
    return 1 if report["alert"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
