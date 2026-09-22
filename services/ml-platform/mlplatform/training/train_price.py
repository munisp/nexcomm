"""
Train PriceLSTM on gold price sequences (Gaussian NLL on next-day log-return).

CLI: python -m mlplatform.training.train_price --base-path /data/lakehouse --epochs 5
"""
from __future__ import annotations

import argparse
import logging
import os
from pathlib import Path

import numpy as np
import torch
from torch import nn

from mlplatform.models.price_lstm import PriceLSTM
from mlplatform.training.common import (
    EarlyStopping,
    compute_reg_metrics,
    register_model,
    set_seed,
    train_val_split,
)

logger = logging.getLogger("mlplatform.training.train_price")

# Contract registry name (serving/pipeline layer); env-overridable.
MODEL_NAME = os.environ.get("MLP_MODEL_NAME_PRICE", "price")

SEQ_FEATURE_NAMES = ["return_1d", "volatility_realized_20d", "rsi_14", "macd_histogram"]

# Raw-input transforms applied BEFORE per-commodity standardisation (gold layer).
SEQ_RAW_TRANSFORMS = [
    "raw log return of close",
    "raw 20d realized vol (annualised)",
    "rsi_14 / 100.0 (NaN -> 0.5)",
    "raw macd_histogram",
]


def _load_sequences(base_path: str | Path) -> tuple[np.ndarray, np.ndarray]:
    npz_path = Path(base_path) / "gold" / "price_sequences" / "sequences.npz"
    if not npz_path.is_file():
        from mlplatform.lakehouse.gold import build_gold

        build_gold(base_path)
    data = np.load(npz_path)
    return data["X"].astype(np.float32), data["y"].astype(np.float32)


def _load_scaling(base_path: str | Path) -> dict:
    """Per-commodity standardisation stats persisted by the gold layer."""
    npz_path = Path(base_path) / "gold" / "price_sequences" / "sequences.npz"
    if not npz_path.is_file():
        return {}
    data = np.load(npz_path)
    if "stat_commodity" not in data.files:
        return {}
    return {
        "per_commodity_standardization": {
            str(c): {"mean": [float(v) for v in m], "std": [float(v) for v in s]}
            for c, m, s in zip(data["stat_commodity"], data["feat_mean"], data["feat_std"])
        }
    }


def price_feature_contract(X_train: np.ndarray, seq_len: int, y_scale: float,
                           base_path: str | Path) -> dict:
    from mlplatform.training.common import numeric_entries

    contract = {
        "categoricals": [],
        "numerics": numeric_entries(SEQ_FEATURE_NAMES, X_train.reshape(-1, X_train.shape[-1]),
                                    SEQ_RAW_TRANSFORMS),
        "input_order": {"seq_features": SEQ_FEATURE_NAMES},
        "sequence": {
            "seq_len": int(seq_len),
            "standardization": "per commodity: (x - mean) / std after the raw "
                               "transforms; stats in per_commodity_standardization",
            "target": "next-day log return of close",
            "target_scale": float(y_scale),
            "output": "(mean, std) of next-day log-return; rescale: mean*target_scale, std*target_scale",
        },
    }
    contract.update(_load_scaling(base_path))
    return contract


def train(base_path: str | Path, registry=None, epochs: int = 5, batch_size: int = 64,
          lr: float = 5e-3, seed: int = 42, patience: int = 4,
          max_seqs: int = 5_000) -> dict:
    set_seed(seed)
    torch.set_num_threads(2)
    X, y = _load_sequences(base_path)
    if len(X) == 0:
        raise ValueError("no price sequences; run gold build first")
    if len(X) > max_seqs:
        idx = np.random.default_rng(seed).choice(len(X), size=max_seqs, replace=False)
        X, y = X[idx], y[idx]
    tr, va = train_val_split(len(X), val_frac=0.2, seed=seed)

    # Targets are tiny (daily log-returns ~1e-2); normalise for stable NLL
    # optimisation and rescale predictions back for metrics.
    y_scale = float(np.std(y[tr])) or 1.0
    yn = (y / y_scale).astype(np.float32)

    model = PriceLSTM(input_dim=X.shape[2])
    opt = torch.optim.Adam(model.parameters(), lr=lr)
    stopper = EarlyStopping(patience=patience, mode="min")
    best_nll = float("inf")
    best_state = None

    def _nll(mean, std, target):
        var = std ** 2
        return (0.5 * torch.log(2 * torch.pi * var) + (target - mean) ** 2 / (2 * var)).mean()

    for epoch in range(epochs):
        model.train()
        perm = np.random.default_rng(seed + epoch).permutation(len(tr))
        for i in range(0, len(tr), batch_size):
            b = perm[i:i + batch_size]
            xb = torch.from_numpy(X[tr[b]])
            yb = torch.from_numpy(yn[tr[b]])
            opt.zero_grad()
            mean, std = model(xb)
            loss = _nll(mean, std, yb)
            loss.backward()
            opt.step()
        model.eval()
        with torch.inference_mode():
            vm, vs = model(torch.from_numpy(X[va]))
        nll = float(_nll(vm, vs, torch.from_numpy(yn[va])))
        logger.info("epoch %d val_nll=%.4f", epoch, nll)
        if nll < best_nll:
            best_nll = nll
            best_state = {k: v.clone() for k, v in model.state_dict().items()}
        if stopper.step(nll):
            break
    if best_state is not None:
        model.load_state_dict(best_state)
    model.eval()
    with torch.inference_mode():
        vm, vs = model(torch.from_numpy(X[va]))
    pred_mean = vm.numpy() * y_scale
    metrics = compute_reg_metrics(y[va], pred_mean)
    metrics["nll"] = float(_nll(vm, vs, torch.from_numpy(yn[va])))
    metrics["target_scale"] = y_scale
    metrics["baseline_rmse"] = float(np.sqrt(np.mean(y[va] ** 2)))  # predict zero return
    metrics["mean_pred_std"] = float(vs.mean() * y_scale)

    result = {"model": model, "metrics": metrics}
    if registry is not None:
        n, t, f = X.shape
        version = register_model(registry, MODEL_NAME, model, metrics,
                                 feature_names=SEQ_FEATURE_NAMES,
                                 X_reference=X[tr].reshape(len(tr), -1),
                                 metadata={"kind": "price", "task": "price_forecast",
                                           "seq_len": int(t), "seed": seed},
                                 feature_contract=price_feature_contract(X[tr], t, y_scale,
                                                                         base_path))
        result["version"] = version
        logger.info("registered %s %s val_rmse=%.5f (baseline %.5f)",
                    MODEL_NAME, version, metrics["rmse"], metrics["baseline_rmse"])
    return result


def main(argv: list[str] | None = None) -> dict:
    parser = argparse.ArgumentParser(description="Train PriceLSTM")
    parser.add_argument("--base-path", "--lakehouse-path", "--data-dir", dest="base_path", required=True)
    parser.add_argument("--epochs", type=int, default=5)
    parser.add_argument("--batch-size", type=int, default=64)
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
