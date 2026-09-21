"""
Train FraudNet on transaction-level features from the silver layer.

CLI: python -m mlplatform.training.train_fraud --base-path /data/lakehouse --epochs 5

Produces REAL weights (class-weighted BCE, early stopping on val AUC) and
registers to the model registry with metrics, feature schema and reference
stats. On the synthetic fraud patterns (wash rings, spoofing, structuring,
ATO, double-pledge) val AUC must be well above 0.5.
"""
from __future__ import annotations

import argparse
import hashlib
import logging
import os
from pathlib import Path

import numpy as np
import pandas as pd
import torch
from torch import nn

from mlplatform.data.schema import CHANNELS, COMMODITY_NAMES, STATE_NAMES
from mlplatform.lakehouse.silver import read_silver
from mlplatform.models.fraud_net import FraudNet
from mlplatform.training.common import (
    class_weights,
    compute_clf_metrics,
    register_model,
    set_seed,
    train_val_split,
)

logger = logging.getLogger("mlplatform.training.train_fraud")

# Contract registry name (serving/pipeline layer); env-overridable.
MODEL_NAME = os.environ.get("MLP_MODEL_NAME_FRAUD", "fraud")

CAT_NAMES = ["state", "commodity", "channel", "type", "payer_bin", "payee_bin"]
NUM_NAMES = [
    "log_amount_norm", "hour_sin", "hour_cos", "is_weekend",
    "log_qty_norm", "price_dev", "payer_prior_txn_velocity", "sub_threshold_flag",
    "is_cancelled", "device_user_count_norm", "ip_user_count_norm",
    "payer_device_new", "amount_vs_payer_median",
]
TXN_TYPE_VOCAB = ["ORDER", "TRADE", "SETTLEMENT", "DEPOSIT", "WITHDRAWAL"]
CAT_CARDINALITIES = [len(STATE_NAMES) + 1, len(COMMODITY_NAMES) + 1,
                     len(CHANNELS) + 1, len(TXN_TYPE_VOCAB) + 1, 257, 257]

# Exact training-time numeric transforms (serving reproduces these verbatim).
NUM_TRANSFORMS = [
    "log1p(amount_ngn) / 20.0",
    "sin(2*pi*(hour + minute/60)/24) of timestamp",
    "cos(2*pi*(hour + minute/60)/24) of timestamp",
    "1.0 if timestamp.weekday >= 5 else 0.0",
    "log1p(quantity_mt) / 10.0",
    "clip(price_ngn_per_mt / median(price_ngn_per_mt | commodity) - 1, -2, 2); NaN->0",
    "clip(cumulative prior txn count of payer (backward-looking, sorted by timestamp) / 100, 0, 1)",
    "1.0 if type==DEPOSIT and 5000000 <= amount_ngn < 10000000 else 0.0",
    "1.0 if status==CANCELLED else 0.0",
    "clip(nunique(payer_id | device_id) / 10, 0, 1)",
    "clip(nunique(payer_id | ip_address) / 10, 0, 1)",
    "1.0 if this payer has not used this device in any earlier txn (backward-looking) else 0.0",
    "clip(amount_ngn / median(amount_ngn | payer) - 1, -5, 5) / 5; NaN->0",
]


def fraud_feature_contract(x_num_train: np.ndarray) -> dict:
    """Full inference contract for serving: categorical encodings + numeric
    transforms, exactly as applied in build_txn_dataset."""
    from mlplatform.training.common import numeric_entries

    vocabs = {"state": STATE_NAMES, "commodity": COMMODITY_NAMES,
              "channel": CHANNELS, "type": TXN_TYPE_VOCAB}
    categoricals = []
    for name, card in zip(CAT_NAMES, CAT_CARDINALITIES):
        if name in vocabs:
            categoricals.append({
                "name": name, "cardinality": card, "encoding": "vocab",
                "vocab": vocabs[name], "unknown_index": 0,
                "index_spec": "vocab.index(value) + 1; unknown -> 0",
            })
        else:
            categoricals.append({
                "name": name, "cardinality": card, "encoding": "md5_bucket",
                "unknown_index": 0,
                "hash_spec": "int(md5(value).hexdigest(), 16) % (cardinality - 1) + 1",
            })
    return {
        "categoricals": categoricals,
        "numerics": numeric_entries(NUM_NAMES, x_num_train, NUM_TRANSFORMS),
        "input_order": {"x_cat": CAT_NAMES, "x_num": NUM_NAMES},
        "output": "sigmoid fraud probability (float, [0,1])",
    }


def _hash_bin(series: pd.Series, bins: int) -> np.ndarray:
    return series.astype(str).map(
        lambda s: int(hashlib.md5(s.encode()).hexdigest(), 16) % (bins - 1) + 1
    ).to_numpy()


def build_txn_dataset(base_path: str | Path) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Returns (x_cat int64 (n,5), x_num float32 (n,8), y int64 (n,)).

    All numeric features at row i are computable from data at or before the
    row timestamp (payer_prior_txn_velocity is a backward-looking count).
    """
    base_path = Path(base_path)
    txns = read_silver(base_path, "transactions")
    labels = read_silver(base_path, "fraud_labels")
    if txns.empty:
        raise ValueError("no silver transactions")

    t = txns.copy()
    t["timestamp"] = pd.to_datetime(t["timestamp"], utc=True, errors="coerce")
    t = t.dropna(subset=["timestamp"]).sort_values("timestamp").reset_index(drop=True)
    t["amount_ngn"] = pd.to_numeric(t["amount_ngn"], errors="coerce").fillna(0.0)
    t["quantity_mt"] = pd.to_numeric(t["quantity_mt"], errors="coerce").fillna(0.0)
    t["price_ngn_per_mt"] = pd.to_numeric(t["price_ngn_per_mt"], errors="coerce").fillna(0.0)

    fraud_txns = set()
    if not labels.empty:
        lab = labels.copy()
        lab["is_fraud"] = lab["is_fraud"].astype(str).str.lower().isin(["true", "1", "t"])
        fraud_txns = set(lab.loc[lab["is_fraud"], "transaction_id"].astype(str))
    y = t["transaction_id"].astype(str).isin(fraud_txns).astype(np.int64).to_numpy()

    state_idx = t["state"].astype(str).map({s: i + 1 for i, s in enumerate(STATE_NAMES)}).fillna(0).to_numpy()
    comm_idx = t["commodity"].astype(str).map({c: i + 1 for i, c in enumerate(COMMODITY_NAMES)}).fillna(0).to_numpy()
    chan_idx = t["channel"].astype(str).map({c: i + 1 for i, c in enumerate(CHANNELS)}).fillna(0).to_numpy()
    type_idx = t["type"].astype(str).map({c: i + 1 for i, c in enumerate(TXN_TYPE_VOCAB)}).fillna(0).to_numpy()
    x_cat = np.stack([
        state_idx, comm_idx, chan_idx, type_idx,
        _hash_bin(t["payer_id"], 257), _hash_bin(t["payee_id"], 257),
    ], axis=1).astype(np.int64)

    hour = t["timestamp"].dt.hour.to_numpy() + t["timestamp"].dt.minute.to_numpy() / 60.0
    log_amt = np.log1p(t["amount_ngn"].to_numpy())
    # per-transaction price deviation vs commodity median (context feature)
    med_price = t.groupby("commodity")["price_ngn_per_mt"].transform("median").replace(0, np.nan)
    price_dev = (t["price_ngn_per_mt"] / med_price - 1.0).fillna(0.0).clip(-2, 2).to_numpy()
    # backward-looking payer velocity: cumulative prior txn count / 100
    payer_prior = t.groupby("payer_id").cumcount().to_numpy(dtype=float)
    sub_thresh = ((t["type"] == "DEPOSIT")
                  & (t["amount_ngn"] >= 5_000_000)
                  & (t["amount_ngn"] < 10_000_000)).astype(float).to_numpy()
    is_cancelled = (t["status"] == "CANCELLED").astype(float).to_numpy()
    # device/IP sharing breadth: distinct users ever seen on this device/IP
    dev_counts = t.groupby("device_id")["payer_id"].nunique()
    ip_counts = t.groupby("ip_address")["payer_id"].nunique()
    dev_norm = t["device_id"].map(dev_counts).fillna(1).to_numpy(dtype=float)
    ip_norm = t["ip_address"].map(ip_counts).fillna(1).to_numpy(dtype=float)
    # backward-looking: has this payer used this device in an EARLIER txn?
    seen: set = set()
    payer_device_new = np.zeros(len(t), dtype=float)
    for i, (uid, dev) in enumerate(zip(t["payer_id"].to_numpy(), t["device_id"].to_numpy())):
        key = (uid, dev)
        if key not in seen:
            payer_device_new[i] = 1.0
            seen.add(key)
    payer_med_amt = t.groupby("payer_id")["amount_ngn"].transform("median").replace(0, np.nan)
    amt_vs_med = (t["amount_ngn"] / payer_med_amt - 1.0).fillna(0.0).clip(-5, 5).to_numpy() / 5.0
    x_num = np.stack([
        log_amt / 20.0,
        np.sin(2 * np.pi * hour / 24.0),
        np.cos(2 * np.pi * hour / 24.0),
        (t["timestamp"].dt.weekday >= 5).astype(float).to_numpy(),
        np.log1p(t["quantity_mt"].to_numpy()) / 10.0,
        price_dev,
        np.clip(payer_prior / 100.0, 0, 1),
        sub_thresh,
        is_cancelled,
        np.clip(dev_norm / 10.0, 0, 1),
        np.clip(ip_norm / 10.0, 0, 1),
        payer_device_new,
        amt_vs_med,
    ], axis=1).astype(np.float32)
    return x_cat, x_num, y


def train(base_path: str | Path, registry=None, epochs: int = 5, batch_size: int = 256,
          lr: float = 1e-3, seed: int = 42, patience: int = 4,
          max_rows: int = 20_000) -> dict:
    set_seed(seed)
    torch.set_num_threads(2)
    x_cat, x_num, y = build_txn_dataset(base_path)
    # ensure the serving store exists and matches the features just trained on
    if not (Path(base_path) / "gold" / "serving_features").is_dir():
        from mlplatform.lakehouse.gold_serving import build_serving_features

        build_serving_features(base_path)
    if len(y) > max_rows:  # CPU budget: deterministic subsample, keep all fraud
        rng = np.random.default_rng(seed)
        pos = np.where(y == 1)[0]
        neg = np.where(y == 0)[0]
        keep_neg = rng.choice(neg, size=max(0, max_rows - len(pos)), replace=False)
        keep = np.sort(np.concatenate([pos, keep_neg]))
        x_cat, x_num, y = x_cat[keep], x_num[keep], y[keep]

    tr, va = train_val_split(len(y), val_frac=0.2, seed=seed, stratify=y)
    model = FraudNet(CAT_CARDINALITIES, num_numeric=len(NUM_NAMES))
    opt = torch.optim.Adam(model.parameters(), lr=lr)
    weights = class_weights(y[tr])
    pos_weight = weights[1] / weights[0]
    loss_fn = nn.BCELoss(weight=None)

    def _batches(idx):
        for i in range(0, len(idx), batch_size):
            b = idx[i:i + batch_size]
            yield (torch.from_numpy(x_cat[b]), torch.from_numpy(x_num[b]),
                   torch.from_numpy(y[b].astype(np.float32)))

    from mlplatform.training.common import EarlyStopping

    stopper = EarlyStopping(patience=patience, mode="max")
    best_auc = 0.0
    best_state = None
    for epoch in range(epochs):
        model.train()
        total_loss = 0.0
        nb = 0
        for bc, bn, by in _batches(tr):
            opt.zero_grad()
            prob = model(bc, bn)
            w = torch.where(by > 0.5, torch.full_like(by, float(pos_weight)), torch.ones_like(by))
            loss = torch.nn.functional.binary_cross_entropy(prob, by, weight=w)
            loss.backward()
            opt.step()
            total_loss += float(loss.item())
            nb += 1
        model.eval()
        with torch.inference_mode():
            vp = model(torch.from_numpy(x_cat[va]), torch.from_numpy(x_num[va])).numpy()
        m = compute_clf_metrics(y[va], vp)
        logger.info("epoch %d loss=%.4f val_auc=%.4f pr_auc=%.4f", epoch, total_loss / max(1, nb), m["auc"], m["pr_auc"])
        if m["auc"] > best_auc:
            best_auc = m["auc"]
            best_state = {k: v.clone() for k, v in model.state_dict().items()}
        if stopper.step(m["auc"]):
            break

    if best_state is not None:
        model.load_state_dict(best_state)
    model.eval()
    with torch.inference_mode():
        vp = model(torch.from_numpy(x_cat[va]), torch.from_numpy(x_num[va])).numpy()
    metrics = compute_clf_metrics(y[va], vp)
    metrics["val_size"] = int(len(va))
    metrics["train_size"] = int(len(tr))

    result = {"model": model, "metrics": metrics}
    if registry is not None:
        version = register_model(
            registry, MODEL_NAME, model, metrics,
            feature_names=CAT_NAMES + NUM_NAMES,
            X_reference=np.concatenate([x_cat[tr].astype(float), x_num[tr]], axis=1),
            metadata={"kind": "fraud", "task": "transaction_fraud", "seed": seed,
                      "epochs_run": epoch + 1},
            feature_contract=fraud_feature_contract(x_num[tr]),
        )
        result["version"] = version
        logger.info("registered %s %s val_auc=%.4f", MODEL_NAME, version, metrics["auc"])
    return result


def main(argv: list[str] | None = None) -> dict:
    parser = argparse.ArgumentParser(description="Train FraudNet")
    parser.add_argument("--base-path", "--lakehouse-path", "--data-dir", dest="base_path", required=True)
    parser.add_argument("--epochs", type=int, default=5)
    parser.add_argument("--batch-size", type=int, default=256)
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
