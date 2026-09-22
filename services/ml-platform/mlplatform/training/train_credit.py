"""
Train CreditNet on gold user-behaviour features.

Ground truth for training is derived deterministically from realised
behaviour (tenure, volume, settlement discipline, fraud severity) — the same
kind of target the hand-coded Rust scorecard approximates — so the net learns
a real, reproducible mapping rather than noise.

CLI: python -m mlplatform.training.train_credit --base-path /data/lakehouse --epochs 5
"""
from __future__ import annotations

import argparse
import logging
import os
from pathlib import Path

import numpy as np
import pandas as pd
import torch
from torch import nn

from mlplatform.lakehouse.silver import read_silver
from mlplatform.lakehouse.storage import read_table
from mlplatform.models.credit_net import SCORE_MAX, SCORE_MIN, CreditNet
from mlplatform.training.common import (
    EarlyStopping,
    compute_clf_metrics,
    compute_reg_metrics,
    register_model,
    set_seed,
    train_val_split,
)

logger = logging.getLogger("mlplatform.training.train_credit")

# Contract registry name (serving/pipeline layer); env-overridable.
MODEL_NAME = os.environ.get("MLP_MODEL_NAME_CREDIT", "credit")

FEATURE_NAMES = [
    "log_txn_count", "txns_per_day_norm", "log_total_amount", "cancel_rate",
    "night_trading_ratio", "settlement_on_time_rate", "avg_settlement_delay_norm",
    "failed_settlements_norm", "account_age_norm", "kyc_level_norm",
    "distinct_commodities_norm", "distinct_counterparties_norm",
]

_SEVERITY = {"structuring": 1, "spoofing": 2, "account_takeover": 2,
             "wash_trading": 3, "receipt_double_pledge": 3}

# Exact training-time transforms over gold/user_behavior + users columns.
NUM_TRANSFORMS = [
    "log1p(txn_count) / 8.0",
    "clip(txns_per_day / 20.0, 0, 1)",
    "log1p(total_amount_ngn) / 25.0",
    "clip(cancel_rate, 0, 1)",
    "clip(night_trading_ratio, 0, 1)",
    "clip(settlement_on_time_rate, 0, 1)",
    "clip(avg_settlement_delay_hours / 72.0, 0, 1)",
    "clip(failed_settlement_count / 10.0, 0, 1)",
    "clip((now - created_at).days / 2000.0, 0, 1)",
    "kyc_level / 4.0",
    "clip(distinct_commodities / 10.0, 0, 1)",
    "clip(distinct_counterparties / 50.0, 0, 1)",
]


def credit_feature_contract(X_train: np.ndarray) -> dict:
    from mlplatform.training.common import numeric_entries

    return {
        "categoricals": [],
        "numerics": numeric_entries(FEATURE_NAMES, X_train, NUM_TRANSFORMS),
        "input_order": {"x": FEATURE_NAMES},
        "output": "score = sigmoid*600+300 (300-900); default_prob = sigmoid [0,1]",
    }


def build_credit_dataset(base_path: str | Path) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Returns (X float32 (n,12), score y float32 (n,), default y int64 (n,))."""
    base_path = Path(base_path)
    txns = read_silver(base_path, "transactions")
    users = read_silver(base_path, "users")
    labels = read_silver(base_path, "fraud_labels")
    ub = read_table(base_path / "gold", "user_behavior")
    if ub.empty:
        from mlplatform.lakehouse.gold import compute_user_behavior

        ub = compute_user_behavior(txns, users)
    if ub.empty or users.empty:
        raise ValueError("no user behaviour; run silver→gold first")

    df = users.merge(ub, on="user_id", how="left").fillna(0)
    now = pd.to_datetime(txns["timestamp"], utc=True, errors="coerce").max()
    created = pd.to_datetime(df["created_at"], utc=True, errors="coerce")
    age_days = (now - created).dt.days.fillna(30).clip(lower=1)

    for c in ("txn_count", "txns_per_day", "total_amount_ngn", "cancel_rate",
              "night_trading_ratio", "settlement_on_time_rate",
              "avg_settlement_delay_hours", "failed_settlement_count",
              "distinct_commodities", "distinct_counterparties"):
        df[c] = pd.to_numeric(df[c], errors="coerce").fillna(0)

    X = np.stack([
        np.log1p(df["txn_count"]) / 8.0,
        (df["txns_per_day"] / 20.0).clip(0, 1),
        np.log1p(df["total_amount_ngn"]) / 25.0,
        df["cancel_rate"].clip(0, 1),
        df["night_trading_ratio"].clip(0, 1),
        df["settlement_on_time_rate"].clip(0, 1),
        (df["avg_settlement_delay_hours"] / 72.0).clip(0, 1),
        (df["failed_settlement_count"] / 10.0).clip(0, 1),
        (age_days / 2000.0).clip(0, 1),
        (pd.to_numeric(df["kyc_level"], errors="coerce").fillna(1) / 4.0),
        (df["distinct_commodities"] / 10.0).clip(0, 1),
        (df["distinct_counterparties"] / 50.0).clip(0, 1),
    ], axis=1).astype(np.float32)

    # fraud severity per user
    sev_map: dict[str, int] = {}
    if not labels.empty:
        lab = labels.copy()
        lab["is_fraud"] = lab["is_fraud"].astype(str).str.lower().isin(["true", "1", "t"])
        for uid, grp in lab[lab["is_fraud"]].groupby(lab["user_id"].astype(str)):
            sev_map[uid] = max((_SEVERITY.get(str(t), 1) for t in grp["fraud_type"]), default=0)
    severity = df["user_id"].map(sev_map).fillna(0).to_numpy(dtype=float)

    # deterministic ground-truth score from realised behaviour
    score = (
        500.0
        + 120.0 * (age_days / 2000.0).clip(0, 1).to_numpy()
        + 100.0 * df["settlement_on_time_rate"].clip(0, 1).to_numpy()
        + 60.0 * (np.log1p(df["txn_count"]) / 8.0).clip(0, 1).to_numpy()
        - 150.0 * df["cancel_rate"].clip(0, 1).to_numpy()
        - 80.0 * (df["failed_settlement_count"] / 10.0).clip(0, 1).to_numpy()
        - 60.0 * severity
    )
    rng = np.random.default_rng(42)
    score = np.clip(score + rng.normal(0, 15, size=len(score)), SCORE_MIN, SCORE_MAX)
    y_score = score.astype(np.float32)
    y_default = ((severity >= 2) | (df["settlement_on_time_rate"].to_numpy() < 0.6)
                 | (df["failed_settlement_count"].to_numpy() >= 3)).astype(np.int64)
    return X, y_score, y_default


def train(base_path: str | Path, registry=None, epochs: int = 10, batch_size: int = 32,
          lr: float = 1e-2, seed: int = 42, patience: int = 5) -> dict:
    set_seed(seed)
    torch.set_num_threads(2)
    X, y_score, y_default = build_credit_dataset(base_path)
    tr, va = train_val_split(len(X), val_frac=0.2, seed=seed)
    model = CreditNet(num_features=len(FEATURE_NAMES))
    opt = torch.optim.Adam(model.parameters(), lr=lr)

    stopper = EarlyStopping(patience=patience, mode="min")
    best_rmse = float("inf")
    best_state = None
    yt_tr = torch.from_numpy(((y_score[tr] - SCORE_MIN) / (SCORE_MAX - SCORE_MIN)).astype(np.float32))
    yd_tr = torch.from_numpy(y_default[tr].astype(np.float32))
    for epoch in range(epochs):
        model.train()
        perm = np.random.default_rng(seed + epoch).permutation(len(tr))
        for i in range(0, len(tr), batch_size):
            b = perm[i:i + batch_size]
            xb = torch.from_numpy(X[tr[b]])
            opt.zero_grad()
            score_pred, def_pred = model(xb)
            score_scaled = (score_pred - SCORE_MIN) / (SCORE_MAX - SCORE_MIN)
            loss = (nn.functional.mse_loss(score_scaled, yt_tr[b])
                    + nn.functional.binary_cross_entropy(def_pred, yd_tr[b]))
            loss.backward()
            opt.step()
        model.eval()
        with torch.inference_mode():
            vs, vd = model(torch.from_numpy(X[va]))
        rmse = compute_reg_metrics(y_score[va], vs.numpy())["rmse"]
        logger.info("epoch %d val_rmse=%.2f", epoch, rmse)
        if rmse < best_rmse:
            best_rmse = rmse
            best_state = {k: v.clone() for k, v in model.state_dict().items()}
        if stopper.step(rmse):
            break
    if best_state is not None:
        model.load_state_dict(best_state)
    model.eval()
    with torch.inference_mode():
        vs, vd = model(torch.from_numpy(X[va]))
    metrics = compute_reg_metrics(y_score[va], vs.numpy())
    metrics.update({f"default_{k}": v for k, v in compute_clf_metrics(y_default[va], vd.numpy()).items()})
    # baseline: predicting the train mean must be beaten
    baseline_rmse = float(np.sqrt(np.mean((y_score[va] - y_score[tr].mean()) ** 2)))
    metrics["baseline_rmse"] = baseline_rmse

    result = {"model": model, "metrics": metrics}
    if registry is not None:
        version = register_model(registry, MODEL_NAME, model, metrics,
                                 feature_names=FEATURE_NAMES, X_reference=X[tr],
                                 metadata={"kind": "credit", "task": "credit_scoring", "seed": seed},
                                 feature_contract=credit_feature_contract(X[tr]))
        result["version"] = version
        logger.info("registered %s %s val_rmse=%.2f (baseline %.2f)",
                    MODEL_NAME, version, metrics["rmse"], baseline_rmse)
    return result


def main(argv: list[str] | None = None) -> dict:
    parser = argparse.ArgumentParser(description="Train CreditNet")
    parser.add_argument("--base-path", "--lakehouse-path", "--data-dir", dest="base_path", required=True)
    parser.add_argument("--epochs", type=int, default=5)
    parser.add_argument("--batch-size", type=int, default=128)
    parser.add_argument("--lr", type=float, default=1e-3)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--no-register", action="store_true")
    args = parser.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")
    registry = None
    if not args.no_register:
        from mlplatform.registry import get_registry

        registry = get_registry()
    res = train(args.base_path, registry=registry, epochs=args.epochs,
                batch_size=args.batch_size, lr=args.lr, seed=args.seed)
    print({k: v for k, v in res.items() if k != "model"})
    return res


if __name__ == "__main__":
    main()
