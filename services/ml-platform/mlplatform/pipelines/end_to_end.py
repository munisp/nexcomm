"""
End-to-end ML pipeline orchestrator for the NEXCOM ML platform.

Closes audit finding A3 §2 ("Training scripts ... ABSENT", "Real training data
pipeline ... MISSING"): one CLI runs the full loop —
  generate-or-extract → bronze → silver → gold → train (fraud, credit, price,
  gnn, mapped over the compute backend) → promotion gate → drift baselines.

CLI:
    python -m mlplatform.pipelines.end_to_end \
        --transactions 20000 --epochs 3 [--models fraud,credit,price,graph] \
        [--extract] [--skip-data] [--lakehouse-path /data/lakehouse]

Stage invocation contract: sibling stages are ML-CORE modules with CLI entry
points (blueprint §"Directory layout"). The runner tries each module's
documented CLI form and records honest per-stage status — a missing sibling
module fails that stage's status, never silently fabricates success.
"""
from __future__ import annotations

import argparse
import json
import logging
import os
import subprocess
import sys
import time
from pathlib import Path
from typing import Optional

logger = logging.getLogger("mlplatform.pipelines.end_to_end")
logging.basicConfig(level=os.environ.get("LOG_LEVEL", "INFO"))

PROMOTION_MARGIN = float(os.environ.get("PROMOTION_MARGIN", "0.01"))
# Primary metric per model kind for the promotion gate (higher is better,
# except rmse where lower is better).
PRIMARY_METRIC = {"fraud": "auc", "credit": "auc", "price": "rmse", "graph": "auc"}
LOWER_IS_BETTER = {"rmse", "mae", "log_loss"}

TRAINING_MODULES = {
    "fraud": "mlplatform.training.train_fraud",
    "credit": "mlplatform.training.train_credit",
    "price": "mlplatform.training.train_price",
    "graph": "mlplatform.training.train_gnn",
}
MODEL_REGISTRY_NAMES = {"fraud": "fraud", "credit": "credit", "price": "price", "graph": "graph"}


def _lakehouse_path() -> Path:
    return Path(os.environ.get("LAKEHOUSE_PATH", "/data/lakehouse"))


def _run_module(module: str, argv_candidates: list[list[str]], timeout: int = 1800) -> dict:
    """Run `python -m <module>` trying argv candidates in order. Returns an
    honest status record; never fakes success."""
    errors = []
    # Ensure sibling mlplatform modules resolve in the subprocess even when the
    # pipeline is invoked from outside the package root.
    env = os.environ.copy()
    pkg_root = str(Path(__file__).resolve().parents[2])
    env["PYTHONPATH"] = pkg_root + os.pathsep + env.get("PYTHONPATH", "")
    for argv in argv_candidates:
        cmd = [sys.executable, "-m", module, *argv]
        logger.info("pipeline stage: %s", " ".join(cmd))
        try:
            proc = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout, env=env)
        except subprocess.TimeoutExpired:
            errors.append(f"timeout after {timeout}s: {' '.join(argv)}")
            continue
        if proc.returncode == 0:
            return {"module": module, "status": "ok", "argv": argv,
                    "stdout_tail": proc.stdout[-2000:]}
        errors.append(f"rc={proc.returncode} argv={argv}: {proc.stderr[-500:]}")
    return {"module": module, "status": "failed", "errors": errors}


def _train_one(spec) -> dict:
    """Train one model kind via its ML-CORE CLI (compute-backend mappable).

    CLI contract: training modules accept ``--base-path <lakehouse root>``
    (ML-CORE canonical). Legacy ``--data-dir <gold dir>`` candidates remain as
    fallbacks so the orchestrator also works against older training CLIs.
    """
    kind, data_dir, epochs, lakehouse = spec
    module = TRAINING_MODULES[kind]
    return {
        "model": kind,
        **_run_module(module, [
            ["--base-path", str(lakehouse), "--epochs", str(epochs)],
            ["--data-dir", str(data_dir), "--epochs", str(epochs)],
            ["--data-dir", str(data_dir), "--epochs", str(epochs), "--lakehouse-path", str(lakehouse)],
        ]),
    }


def _get_backend():
    """compute.backend.get_backend() (Ray if RAY_ADDRESS, else local pool)."""
    try:
        from mlplatform.compute.backend import get_backend

        return get_backend()
    except Exception as exc:
        logger.info("compute backend unavailable (%s); using local thread pool", exc)

        class _LocalBackend:
            def map(self, fn, items):
                from concurrent.futures import ThreadPoolExecutor

                with ThreadPoolExecutor(max_workers=min(4, max(1, len(items)))) as pool:
                    return list(pool.map(fn, items))

        return _LocalBackend()


def _metric_value(metrics: dict, primary: str) -> Optional[float]:
    for key in (primary, f"val_{primary}", "roc_auc", "val_auc", "accuracy"):
        if key in metrics:
            try:
                return float(metrics[key])
            except (TypeError, ValueError):
                continue
    return None


def _promotion_gate(kind: str, registry, registry_name: str) -> dict:
    """Promote the newest non-champion version iff it beats the current
    champion by PROMOTION_MARGIN on the kind's primary metric.

    Handles both registry.list() shapes: flat per-version entries
    ({"version", "stage", "metrics"}) and aggregated entries
    ({"versions": [...], "stages": {stage: version}, "latest_metrics"}),
    reading per-version metrics via registry.load_metrics when available.
    """
    try:
        entries = [e for e in registry.list() if str(e.get("name", "")) == registry_name]
    except Exception as exc:
        return {"model": kind, "status": "skipped", "reason": f"registry.list failed: {exc}"}
    if not entries:
        return {"model": kind, "status": "skipped", "reason": "no registered versions"}

    # Normalize to version -> {"stage": str, "metrics": dict}
    versions: dict[str, dict] = {}
    for e in entries:
        if isinstance(e.get("stages"), dict) or isinstance(e.get("versions"), list):
            for ver in e.get("versions", []):
                versions.setdefault(str(ver), {"stage": "", "metrics": {}})
            for stg, ver in (e.get("stages") or {}).items():
                versions.setdefault(str(ver), {"stage": "", "metrics": {}})["stage"] = str(stg)
            latest_metrics = e.get("latest_metrics") or {}
            if latest_metrics and versions:
                newest = max(versions, key=lambda v: int(v.lstrip("v")) if v.lstrip("v").isdigit() else 0)
                versions[newest]["metrics"] = versions[newest].get("metrics") or latest_metrics
        else:
            ver = str(e.get("version", "0"))
            versions[ver] = {"stage": str(e.get("stage", "")), "metrics": e.get("metrics") or {}}

    def _vkey(version: str) -> int:
        try:
            return int(version.lstrip("v"))
        except ValueError:
            return 0

    def _metrics(version: str) -> dict:
        m = versions[version].get("metrics") or {}
        if not m and hasattr(registry, "load_metrics"):
            try:
                m = registry.load_metrics(registry_name, version) or {}
            except Exception:
                pass
        return m

    ordered = sorted(versions, key=_vkey, reverse=True)
    champion_ver = next(
        (v for v in ordered if versions[v]["stage"].lower() in ("champion", "production")), None
    )
    candidate_ver = ordered[0]
    if champion_ver and _vkey(candidate_ver) == _vkey(champion_ver):
        return {"model": kind, "status": "no_candidate", "champion_version": champion_ver}

    primary = PRIMARY_METRIC.get(kind, "auc")
    cand_val = _metric_value(_metrics(candidate_ver), primary)
    champ_val = _metric_value(_metrics(champion_ver), primary) if champion_ver else None

    if cand_val is None:
        return {"model": kind, "status": "skipped",
                "reason": f"candidate {candidate_ver} has no '{primary}' metric"}
    better = (
        champ_val is None
        or (cand_val < champ_val - PROMOTION_MARGIN if primary in LOWER_IS_BETTER
            else cand_val > champ_val + PROMOTION_MARGIN)
    )
    if not better:
        return {"model": kind, "status": "rejected", "candidate_metric": cand_val,
                "champion_metric": champ_val, "margin": PROMOTION_MARGIN}
    try:
        registry.set_stage(registry_name, candidate_ver, "champion")
        if champion_ver is not None:
            try:
                registry.set_stage(registry_name, champion_ver, "archived")
            except Exception:
                pass
        return {"model": kind, "status": "promoted", "version": candidate_ver,
                "candidate_metric": cand_val, "champion_metric": champ_val}
    except Exception as exc:
        return {"model": kind, "status": "failed", "reason": f"set_stage failed: {exc}"}


def _set_drift_baseline(kind: str, registry, registry_name: str, gold_dir: Path) -> dict:
    """Ensure the champion artifact dir has reference_stats.json; compute it
    from the gold training features when missing."""
    try:
        artifact_dir, _ = registry.load(registry_name, "champion")
    except Exception as exc:
        return {"model": kind, "status": "skipped", "reason": f"champion load failed: {exc}"}
    ref_file = Path(artifact_dir) / "reference_stats.json"
    if ref_file.is_file():
        return {"model": kind, "status": "exists", "path": str(ref_file)}
    try:
        import numpy as np
        import pandas as pd

        from mlplatform.monitoring.drift import compute_reference_stats

        frame = None
        npz = gold_dir / f"{kind}_features.npz"
        if kind == "fraud" and npz.is_file():  # RISK_TRAINING_DATA_PATH contract
            data = np.load(npz)
            names = [str(n) for n in data["feature_names"]] if "feature_names" in data else \
                [f"f{i}" for i in range(data["features"].shape[1])]
            frame = pd.DataFrame(data["features"], columns=names)
        else:
            for stem in (f"{kind}_features", "features"):
                for ext, reader in ((".parquet", pd.read_parquet), (".csv", pd.read_csv)):
                    f = gold_dir / f"{stem}{ext}"
                    if f.is_file():
                        try:
                            frame = reader(f)
                        except Exception:
                            continue
                        break
                if frame is not None:
                    break
        if frame is None:
            return {"model": kind, "status": "skipped",
                    "reason": f"no gold feature table found under {gold_dir}"}
        stats = compute_reference_stats(frame)
        ref_file.write_text(json.dumps(stats))
        return {"model": kind, "status": "written", "path": str(ref_file),
                "n_numeric": len(stats["numeric"]), "n_categorical": len(stats["categorical"])}
    except Exception as exc:
        return {"model": kind, "status": "failed", "reason": str(exc)}


def run_pipeline(
    transactions: int = 20000,
    epochs: int = 3,
    models: Optional[list[str]] = None,
    skip_data: bool = False,
    extract: bool = False,
    lakehouse_path: Optional[str] = None,
    seed: int = 42,
) -> dict:
    """Run the full pipeline. Returns an honest per-stage status report."""
    t0 = time.time()
    lakehouse = Path(lakehouse_path) if lakehouse_path else _lakehouse_path()
    gold_dir = lakehouse / "gold"
    kinds = models or ["fraud", "credit", "price", "graph"]
    report: dict = {"stages": {}, "lakehouse_path": str(lakehouse)}

    # 1. generate-or-extract
    if not skip_data:
        if extract:
            report["stages"]["extract"] = _run_module("mlplatform.lakehouse.extractor", [
                ["--base-path", str(lakehouse)],
                ["--out", str(lakehouse / "bronze")],
                ["--lakehouse-path", str(lakehouse)],
            ])
        else:
            report["stages"]["generate"] = _run_module("mlplatform.data.synthetic_nigeria", [
                ["--transactions", str(transactions), "--base-path", str(lakehouse), "--seed", str(seed)],
                ["--transactions", str(transactions), "--out", str(lakehouse / "bronze"), "--seed", str(seed)],
                ["--transactions", str(transactions), "--out", str(lakehouse / "bronze")],
            ])
    else:
        report["stages"]["data"] = {"status": "skipped", "reason": "--skip-data"}

    # 2. bronze → silver → gold
    for layer in ("bronze", "silver", "gold"):
        if skip_data and layer == "bronze":
            continue
        report["stages"][layer] = _run_module(f"mlplatform.lakehouse.{layer}", [
            ["--base-path", str(lakehouse)],
            ["--lakehouse-path", str(lakehouse)],
            ["--data-dir", str(lakehouse)],
        ])

    # 3. train all four model families via the compute backend
    backend = _get_backend()
    specs = [(k, gold_dir, epochs, lakehouse) for k in kinds]
    logger.info("training %d model kinds via %s", len(specs), type(backend).__name__)
    train_results = backend.map(_train_one, specs)
    report["stages"]["train"] = {r["model"]: r for r in train_results}

    # 4–6. promotion gate + drift baselines (train CLIs register candidates)
    try:
        from mlplatform.registry import get_registry

        registry = get_registry()
    except Exception as exc:
        report["stages"]["promotion"] = {"status": "failed", "reason": f"registry unavailable: {exc}"}
        report["stages"]["drift_baselines"] = {"status": "failed", "reason": "registry unavailable"}
        report["elapsed_seconds"] = round(time.time() - t0, 1)
        return report

    report["stages"]["promotion"] = {
        k: _promotion_gate(k, registry, os.environ.get(f"MODEL_NAME_{k.upper()}", MODEL_REGISTRY_NAMES[k]))
        for k in kinds
    }
    report["stages"]["drift_baselines"] = {
        k: _set_drift_baseline(k, registry, os.environ.get(f"MODEL_NAME_{k.upper()}", MODEL_REGISTRY_NAMES[k]), gold_dir)
        for k in kinds
    }
    report["elapsed_seconds"] = round(time.time() - t0, 1)
    logger.info("pipeline finished in %.1fs: %s", report["elapsed_seconds"],
                json.dumps({k: v.get("status") if isinstance(v, dict) else "multi"
                            for k, v in report["stages"].items()}))
    return report


def main(argv: Optional[list[str]] = None) -> int:
    parser = argparse.ArgumentParser(description="NEXCOM ML platform end-to-end pipeline")
    parser.add_argument("--transactions", type=int, default=20000)
    parser.add_argument("--epochs", type=int, default=3)
    parser.add_argument("--models", default=None, help="comma list of fraud,credit,price,graph")
    parser.add_argument("--extract", action="store_true", help="extract Postgres→bronze instead of generating synthetic")
    parser.add_argument("--skip-data", action="store_true", help="reuse existing lakehouse data")
    parser.add_argument("--lakehouse-path", "--base-path", dest="lakehouse_path", default=None,
                        help="lakehouse root (--base-path alias matches ML-CORE CLI convention)")
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--out", default=None, help="write pipeline report JSON here")
    args = parser.parse_args(argv)

    report = run_pipeline(
        transactions=args.transactions,
        epochs=args.epochs,
        models=args.models.split(",") if args.models else None,
        skip_data=args.skip_data,
        extract=args.extract,
        lakehouse_path=args.lakehouse_path,
        seed=args.seed,
    )
    text = json.dumps(report, indent=2, default=str)
    if args.out:
        Path(args.out).write_text(text)
    print(text)
    failed = [
        name for name, stage in report["stages"].items()
        if isinstance(stage, dict) and stage.get("status") == "failed"
    ]
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
