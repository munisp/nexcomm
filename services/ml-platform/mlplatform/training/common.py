"""
Shared training utilities: deterministic seeds, splits, early stopping,
real metrics (AUC / PR-AUC / F1 / precision / recall; RMSE / MAE), class
imbalance weights, and checkpoint save/load.
"""
from __future__ import annotations

import json
import os
import random
from pathlib import Path

import numpy as np
import torch
from sklearn.metrics import (
    average_precision_score,
    f1_score,
    precision_score,
    recall_score,
    roc_auc_score,
)


def set_seed(seed: int = 42) -> None:
    """Deterministic seeds everywhere (numpy, torch, random)."""
    random.seed(seed)
    np.random.seed(seed)
    torch.manual_seed(seed)
    torch.cuda.manual_seed_all(seed)
    os.environ["PYTHONHASHSEED"] = str(seed)
    torch.use_deterministic_algorithms(False)  # CPU scatter ops are deterministic already


def train_val_split(n: int, val_frac: float = 0.2, seed: int = 42,
                    stratify: np.ndarray | None = None) -> tuple[np.ndarray, np.ndarray]:
    rng = np.random.default_rng(seed)
    if stratify is not None and len(np.unique(stratify)) > 1:
        train_idx, val_idx = [], []
        for cls in np.unique(stratify):
            idx = np.where(stratify == cls)[0]
            rng.shuffle(idx)
            k = max(1, int(len(idx) * val_frac)) if len(idx) >= 2 else 0
            val_idx.extend(idx[:k])
            train_idx.extend(idx[k:])
        rng.shuffle(train_idx)
        rng.shuffle(val_idx)
        return np.asarray(train_idx), np.asarray(val_idx)
    idx = rng.permutation(n)
    k = max(1, int(n * val_frac))
    return idx[k:], idx[:k]


class EarlyStopping:
    def __init__(self, patience: int = 5, min_delta: float = 1e-4, mode: str = "max"):
        self.patience = patience
        self.min_delta = min_delta
        self.mode = mode
        self.best: float | None = None
        self.bad_epochs = 0

    def step(self, value: float) -> bool:
        """Returns True when training should stop."""
        improved = (
            self.best is None
            or (self.mode == "max" and value > self.best + self.min_delta)
            or (self.mode == "min" and value < self.best - self.min_delta)
        )
        if improved:
            self.best = value
            self.bad_epochs = 0
            return False
        self.bad_epochs += 1
        return self.bad_epochs >= self.patience


def compute_clf_metrics(y_true: np.ndarray, y_prob: np.ndarray,
                        threshold: float = 0.5) -> dict:
    """Binary classification metrics: AUC / PR-AUC / F1 / precision / recall."""
    y_true = np.asarray(y_true).astype(int)
    y_prob = np.asarray(y_prob).astype(float)
    y_pred = (y_prob >= threshold).astype(int)
    out: dict[str, float] = {}
    if len(np.unique(y_true)) > 1:
        out["auc"] = float(roc_auc_score(y_true, y_prob))
        out["pr_auc"] = float(average_precision_score(y_true, y_prob))
    else:
        out["auc"] = 0.5
        out["pr_auc"] = float(y_true.mean())
    out["f1"] = float(f1_score(y_true, y_pred, zero_division=0))
    out["precision"] = float(precision_score(y_true, y_pred, zero_division=0))
    out["recall"] = float(recall_score(y_true, y_pred, zero_division=0))
    out["accuracy"] = float((y_pred == y_true).mean())
    return out


def compute_reg_metrics(y_true: np.ndarray, y_pred: np.ndarray) -> dict:
    y_true = np.asarray(y_true, dtype=float)
    y_pred = np.asarray(y_pred, dtype=float)
    err = y_pred - y_true
    return {
        "rmse": float(np.sqrt(np.mean(err ** 2))),
        "mae": float(np.mean(np.abs(err))),
    }


def class_weights(y: np.ndarray) -> torch.FloatTensor:
    """Inverse-frequency weights for imbalanced binary labels."""
    y = np.asarray(y).astype(int)
    n_pos = max(1, int((y == 1).sum()))
    n_neg = max(1, int((y == 0).sum()))
    w_pos = n_neg / n_pos
    return torch.tensor([1.0, w_pos], dtype=torch.float32)


def save_checkpoint(model: torch.nn.Module, path: str | Path,
                    config: dict | None = None, extra: dict | None = None) -> Path:
    """Save state_dict + constructor config so serving can rebuild the module."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    cfg = dict(config or {})
    if hasattr(model, "config"):
        cfg = {**model.config(), **cfg}
    payload = {
        "state_dict": model.state_dict(),
        "config": cfg,
        "class": type(model).__name__,
        **(extra or {}),
    }
    tmp = path.with_suffix(".tmp")
    torch.save(payload, tmp)
    tmp.replace(path)
    return path


def load_checkpoint(path: str | Path) -> dict:
    return torch.load(path, map_location="cpu", weights_only=False)


def write_reference_stats(X: np.ndarray, feature_names: list[str], path: str | Path) -> dict:
    """Per-feature mean/std used later by monitoring/drift.py (PSI/KS)."""
    stats = {
        name: {"mean": float(np.mean(X[:, i])), "std": float(np.std(X[:, i]) or 1.0),
               "min": float(np.min(X[:, i])), "max": float(np.max(X[:, i]))}
        for i, name in enumerate(feature_names)
    }
    Path(path).write_text(json.dumps(stats, indent=2))
    return stats


def numeric_entries(names: list[str], X_train: np.ndarray,
                    transforms: list[str] | None = None) -> list[dict]:
    """Build the `numerics` feature-schema entries: name + exact train-time
    transform note + train-set mean/std (for drift checks and standardisation)."""
    X_train = np.asarray(X_train, dtype=float)
    entries = []
    for i, n in enumerate(names):
        col = X_train[:, i] if X_train.ndim == 2 and X_train.shape[1] == len(names) else np.zeros(1)
        entries.append({
            "name": n,
            "transform": (transforms[i] if transforms else "raw"),
            "mean": float(np.mean(col)),
            "std": float(np.std(col) or 1.0),
        })
    return entries


def register_model(registry, name: str, model: torch.nn.Module, metrics: dict,
                   feature_names: list[str], X_reference: np.ndarray,
                   metadata: dict | None = None, stage: str = "challenger",
                   work_dir: str | Path | None = None,
                   feature_contract: dict | None = None) -> str:
    """Build the artifact directory (model.pt + schema + reference stats) and
    register it. Returns the assigned version.

    feature_contract (optional) extends feature_schema.json with the full
    inference contract — categorical encodings (vocab/md5_bucket) and numeric
    transforms — so serving can reproduce training-time encoding exactly.
    """
    import tempfile

    if work_dir is None:
        work_dir = Path(tempfile.mkdtemp(prefix=f"mlplatform-{name}-"))
    work_dir = Path(work_dir)
    work_dir.mkdir(parents=True, exist_ok=True)
    save_checkpoint(model, work_dir / "model.pt")
    feature_schema = {"features": feature_names, "n_features": len(feature_names)}
    if feature_contract:
        feature_schema.update(feature_contract)
    (work_dir / "feature_schema.json").write_text(json.dumps(feature_schema, indent=2))
    if X_reference is not None and len(X_reference):
        write_reference_stats(np.asarray(X_reference, dtype=float), feature_names,
                              work_dir / "reference_stats.json")
    return registry.register(name, work_dir, metrics=metrics, stage=stage,
                             metadata=metadata or {},
                             feature_schema=feature_schema)
