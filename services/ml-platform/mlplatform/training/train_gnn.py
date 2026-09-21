"""
Train the pure-torch GraphSAGE classifier for fraud-ring membership on the
heterogeneous transaction graph (node classification over account nodes).

CLI: python -m mlplatform.training.train_gnn --base-path /data/lakehouse --epochs 10
"""
from __future__ import annotations

import argparse
import logging
import os
from pathlib import Path

import numpy as np
import torch
from torch import nn

from mlplatform.graph.builder import NODE_FEATURE_DIM, build_graph
from mlplatform.models.graphsage import GraphSAGEClassifier
from mlplatform.training.common import (
    EarlyStopping,
    compute_clf_metrics,
    register_model,
    set_seed,
    train_val_split,
)

logger = logging.getLogger("mlplatform.training.train_gnn")

# Contract registry name (serving/pipeline layer); env-overridable.
MODEL_NAME = os.environ.get("MLP_MODEL_NAME_GRAPH", "graph")

GRAPH_NODE_FEATURES = [
    "is_account", "is_device", "is_ip", "is_receipt", "log_degree",
    "log_total_amount", "night_ratio", "cancel_rate", "community_fraud_density",
]

# Exact node-feature transforms applied by graph/builder.py.
NODE_TRANSFORMS = [
    "one-hot: node_type == account",
    "one-hot: node_type == device",
    "one-hot: node_type == ip",
    "one-hot: node_type == receipt",
    "log1p(transaction degree)",
    "log1p(total transacted NGN) / 20.0",
    "share of txns in hours {22,23,0..4}",
    "share of txns with status CANCELLED",
    "fraction of labeled-fraud members in the node's greedy-modularity community",
]


def gnn_feature_contract(X_train: np.ndarray) -> dict:
    from mlplatform.training.common import numeric_entries

    return {
        "categoricals": [],
        "numerics": numeric_entries(GRAPH_NODE_FEATURES, X_train, NODE_TRANSFORMS),
        "input_order": {"node_features": GRAPH_NODE_FEATURES},
        "graph": {
            "edge_index_layout": "int64 (2, E): row 0 = src, row 1 = dst",
            "labels": "-1 unlabeled, 0 clean, 1 fraud-ring member",
            "output": "node logits (N, 2); fraud prob = softmax[..., 1]",
        },
    }


def train(base_path: str | Path, registry=None, epochs: int = 10, lr: float = 5e-3,
          seed: int = 42, patience: int = 5, hidden: int = 32) -> dict:
    set_seed(seed)
    torch.set_num_threads(2)
    graph = build_graph(base_path)
    feats = torch.from_numpy(graph["node_features"].astype(np.float32))
    edge_index = torch.from_numpy(graph["edge_index"].astype(np.int64))
    labels = graph["labels"]
    mask = graph["train_mask"]
    labeled_idx = np.where(mask & (labels >= 0))[0]
    y = labels[labeled_idx].astype(np.int64)
    if len(np.unique(y)) < 2:
        raise ValueError("need both fraud and clean labeled nodes to train GNN")

    tr, va = train_val_split(len(labeled_idx), val_frac=0.25, seed=seed, stratify=y)
    tr_nodes = labeled_idx[tr]
    va_nodes = labeled_idx[va]

    model = GraphSAGEClassifier(num_features=NODE_FEATURE_DIM, hidden=hidden, layers=2)
    opt = torch.optim.Adam(model.parameters(), lr=lr)
    n_pos = max(1, int((y[tr] == 1).sum()))
    n_neg = max(1, int((y[tr] == 0).sum()))
    weight = torch.tensor([1.0, n_neg / n_pos], dtype=torch.float32)
    loss_fn = nn.CrossEntropyLoss(weight=weight)

    stopper = EarlyStopping(patience=patience, mode="max")
    best_auc = 0.0
    best_state = None
    for epoch in range(epochs):
        model.train()
        opt.zero_grad()
        logits = model(feats, edge_index)
        loss = loss_fn(logits[tr_nodes], torch.from_numpy(y[tr]))
        loss.backward()
        opt.step()
        model.eval()
        with torch.inference_mode():
            probs = torch.softmax(model(feats, edge_index), dim=1)[:, 1].numpy()
        m = compute_clf_metrics(y[va], probs[va_nodes])
        logger.info("epoch %d loss=%.4f val_auc=%.4f", epoch, float(loss.item()), m["auc"])
        if m["auc"] > best_auc:
            best_auc = m["auc"]
            best_state = {k: v.clone() for k, v in model.state_dict().items()}
        if stopper.step(m["auc"]):
            break
    if best_state is not None:
        model.load_state_dict(best_state)
    model.eval()
    with torch.inference_mode():
        probs = torch.softmax(model(feats, edge_index), dim=1)[:, 1].numpy()
    metrics = compute_clf_metrics(y[va], probs[va_nodes])
    metrics["n_nodes"] = int(feats.shape[0])
    metrics["n_edges"] = int(edge_index.shape[1])
    metrics["val_size"] = int(len(va_nodes))

    result = {"model": model, "metrics": metrics, "graph": graph}
    if registry is not None:
        version = register_model(registry, MODEL_NAME, model, metrics,
                                 feature_names=GRAPH_NODE_FEATURES,
                                 X_reference=graph["node_features"][tr_nodes],
                                 metadata={"kind": "graph",
                                           "task": "fraud_ring_node_classification",
                                           "seed": seed},
                                 feature_contract=gnn_feature_contract(
                                     graph["node_features"][tr_nodes]))
        result["version"] = version
        logger.info("registered %s %s val_auc=%.4f", MODEL_NAME, version, metrics["auc"])
    return result


def main(argv: list[str] | None = None) -> dict:
    parser = argparse.ArgumentParser(description="Train GraphSAGE fraud-ring classifier")
    parser.add_argument("--base-path", "--lakehouse-path", "--data-dir", dest="base_path", required=True)
    parser.add_argument("--epochs", type=int, default=10)
    parser.add_argument("--lr", type=float, default=5e-3)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--no-register", action="store_true")
    args = parser.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")
    registry = None
    if not args.no_register:
        from mlplatform.registry import get_registry

        registry = get_registry()
    res = train(args.base_path, registry=registry, epochs=args.epochs,
                lr=args.lr, seed=args.seed)
    print({k: v for k, v in res.items() if k not in ("model", "graph")})
    return res


if __name__ == "__main__":
    main()
