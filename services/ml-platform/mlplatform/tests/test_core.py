"""
Core smoke tests for the ML platform.

  pytest mlplatform/tests/test_core.py
or, without pytest installed:
  python -m mlplatform.tests.test_core

Pipeline: 2k-row synthetic generation → bronze/silver/gold → 47-feature
matrix + npz contract → 2-epoch training of all four models → registry
roundtrip. All CPU, target < 3 minutes total.
"""
from __future__ import annotations

import os
import sys
import tempfile
import time
from pathlib import Path

import numpy as np

try:
    import pytest  # noqa: F401 — tests are pytest-collectable when available
except ImportError:
    pytest = None  # module also runs standalone via `python -m mlplatform.tests.test_core`

# Ensure repo-relative imports work when run from the service directory
_SERVICE_DIR = Path(__file__).resolve().parents[2]
if str(_SERVICE_DIR) not in sys.path:
    sys.path.insert(0, str(_SERVICE_DIR))

SEED = 42
N_TXNS = 2000


def _make_base(tmp_root: str) -> tuple[str, dict]:
    """Generate the tiny synthetic dataset through the full medallion pipeline."""
    from mlplatform.data.synthetic_nigeria import SyntheticNigeriaGenerator
    from mlplatform.lakehouse.bronze import append_raw
    from mlplatform.lakehouse.gold import build_gold
    from mlplatform.lakehouse.silver import build_silver

    base = str(Path(tmp_root) / "lakehouse")
    gen = SyntheticNigeriaGenerator(seed=SEED, n_users=400, days=90)
    tables = gen.generate(N_TXNS)
    for name, df in tables.items():
        append_raw(df, name, base)
    build_silver(base)
    build_gold(base)
    return base, tables


def _registry(tmp_root: str):
    os.environ["REGISTRY_PATH"] = str(Path(tmp_root) / "registry")
    from mlplatform.registry.local import LocalRegistry

    return LocalRegistry(os.environ["REGISTRY_PATH"])


# ── tests ─────────────────────────────────────────────────────────────────────

def test_synthetic_generator(tmp_path=None):
    from mlplatform.data.synthetic_nigeria import SyntheticNigeriaGenerator

    tmp = str(tmp_path or tempfile.mkdtemp())
    gen = SyntheticNigeriaGenerator(seed=SEED, n_users=400, days=90)
    tables = gen.generate(N_TXNS)
    txns, labels = tables["transactions"], tables["fraud_labels"]
    assert len(txns) >= N_TXNS - 100
    fraud_rate = len(labels) / len(txns)
    assert 0.005 <= fraud_rate <= 0.05, f"fraud rate {fraud_rate}"
    assert set(labels["fraud_type"].unique()) <= {
        "wash_trading", "spoofing", "structuring", "account_takeover", "receipt_double_pledge"}
    # temporal causality: timestamps sorted & unique ids
    ts = np.asarray(txns["timestamp"])
    assert (ts[:-1] <= ts[1:]).all()
    assert txns["transaction_id"].is_unique
    # realism: states + commodities present
    assert txns["state"].nunique() >= 10
    assert tables["prices_daily"]["commodity"].nunique() == 10
    return tmp, tables


def test_fraud_features_npz(tmp_path=None):
    from mlplatform.features.fraud_features import FEATURE_NAMES, build_feature_matrix, export_npz

    tmp = str(tmp_path or tempfile.mkdtemp())
    base, _ = _make_base(tmp)
    X, y, names, user_ids = build_feature_matrix(base)
    assert X.shape[1] == 47 and names == FEATURE_NAMES
    assert X.dtype == np.float32 and y.dtype == np.int64
    assert np.isfinite(X).all()
    assert set(np.unique(y)) <= {0, 1, 2, 3} and len(np.unique(y)) >= 2
    assert len(X) >= 100
    out = Path(tmp) / "risk_training.npz"
    res = export_npz(base, out)
    data = np.load(out)
    assert data["features"].shape == (res["n"], 47)
    assert data["labels"].dtype == np.int64
    return tmp, base


def test_train_fraud(tmp_path=None):
    from mlplatform.training.train_fraud import train

    tmp = str(tmp_path or tempfile.mkdtemp())
    base, _ = _make_base(tmp)
    res = train(base, registry=_registry(tmp), epochs=2, seed=SEED)
    assert res["metrics"]["auc"] > 0.6, f"fraud AUC {res['metrics']['auc']} not above chance"
    assert "version" in res
    return tmp, res


def test_train_credit(tmp_path=None):
    from mlplatform.training.train_credit import train

    tmp = str(tmp_path or tempfile.mkdtemp())
    base, _ = _make_base(tmp)
    res = train(base, registry=_registry(tmp), epochs=6, batch_size=32, seed=SEED)
    assert res["metrics"]["rmse"] < res["metrics"]["baseline_rmse"], \
        "credit net must beat mean-predictor baseline"
    return tmp, res


def test_train_price(tmp_path=None):
    from mlplatform.training.train_price import train

    tmp = str(tmp_path or tempfile.mkdtemp())
    base, _ = _make_base(tmp)
    res = train(base, registry=_registry(tmp), epochs=2, seed=SEED)
    assert np.isfinite(res["metrics"]["rmse"])
    assert res["metrics"]["mean_pred_std"] > 0
    return tmp, res


def test_train_gnn(tmp_path=None):
    from mlplatform.training.train_gnn import train

    tmp = str(tmp_path or tempfile.mkdtemp())
    base, _ = _make_base(tmp)
    res = train(base, registry=_registry(tmp), epochs=4, seed=SEED)
    assert res["metrics"]["auc"] > 0.5, f"gnn AUC {res['metrics']['auc']} not above chance"
    return tmp, res


def test_registry_roundtrip(tmp_path=None):
    import torch

    from mlplatform.models.fraud_net import FraudNet
    from mlplatform.training.common import load_checkpoint, register_model
    from mlplatform.training.train_fraud import CAT_CARDINALITIES, NUM_NAMES

    tmp = str(tmp_path or tempfile.mkdtemp())
    registry = _registry(tmp)
    model = FraudNet(CAT_CARDINALITIES, num_numeric=len(NUM_NAMES))
    model.eval()
    Xref = np.random.default_rng(0).random((50, 19)).astype(np.float32)
    version = register_model(registry, "fraud_net", model, {"auc": 0.9},
                             feature_names=[f"f{i}" for i in range(19)],
                             X_reference=Xref, stage="champion")
    assert version == "v1"
    artifact_dir, meta = registry.load("fraud_net", stage="champion")
    ckpt = load_checkpoint(artifact_dir / "model.pt")
    model2 = FraudNet(**{k: v for k, v in ckpt["config"].items()
                         if k in ("cat_cardinalities", "num_numeric", "hidden")})
    model2.load_state_dict(ckpt["state_dict"])
    model2.eval()
    x_cat = torch.zeros((2, 6), dtype=torch.long)
    x_num = torch.zeros((2, len(NUM_NAMES)), dtype=torch.float32)
    with torch.inference_mode():
        out1 = model(x_cat, x_num)
        out2 = model2(x_cat, x_num)
    assert torch.allclose(out1, out2)
    listing = registry.list_models()
    assert "fraud_net" in listing and listing["fraud_net"]["stages"]["champion"] == "v1"
    return tmp, version


def test_compute_backend(tmp_path=None):
    from mlplatform.compute.backend import LocalBackend

    backend = LocalBackend(max_workers=2)
    out = backend.map(lambda x: x * x, [1, 2, 3, 4])
    backend.shutdown()
    assert out == [1, 4, 9, 16]


def test_graph_builder(tmp_path=None):
    from mlplatform.graph.builder import build_graph

    tmp = str(tmp_path or tempfile.mkdtemp())
    base, _ = _make_base(tmp)
    g = build_graph(base)
    assert g["node_features"].shape[1] == 9
    assert g["edge_index"].shape[0] == 2
    assert (g["labels"] >= 0).sum() > 0
    assert (g["labels"] == 1).sum() > 0, "expected some fraud-labeled nodes"
    return tmp, g


def _standalone() -> int:
    """Run all tests without pytest (validation image lacks pytest)."""
    tests = [v for k, v in sorted(globals().items()) if k.startswith("test_")]
    failures = 0
    t0 = time.time()
    for fn in tests:
        tmp = tempfile.mkdtemp(prefix="mlcore-test-")
        try:
            fn(tmp)
            print(f"PASS {fn.__name__}")
        except Exception as exc:
            failures += 1
            import traceback

            traceback.print_exc()
            print(f"FAIL {fn.__name__}: {exc}")
    dt = time.time() - t0
    print(f"\n{len(tests) - failures}/{len(tests)} passed in {dt:.1f}s")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(_standalone())
