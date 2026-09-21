"""
Serving smoke test: register a tiny, genuinely-trained torch model in a local
registry, then exercise the FastAPI app via TestClient — /health, /readyz,
/v1/predict/fraud (champion + challenger A/B), /v1/models,
/v1/experiments/{model}, /v1/admin/reload — plus a drift-report roundtrip.

Runs offline on CPU with core deps only (torch, numpy, pandas, scipy, fastapi).
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

torch = pytest.importorskip("torch")
from torch import nn  # noqa: E402

from fastapi.testclient import TestClient  # noqa: E402

from mlplatform.monitoring import drift as drift_mod  # noqa: E402
from mlplatform.serving import ab as ab_mod  # noqa: E402
from mlplatform.serving.app import create_app  # noqa: E402
from mlplatform.serving.loader import (  # noqa: E402
    DEFAULT_FRAUD_CATEGORICAL, DEFAULT_FRAUD_NUMERIC,
)


# ── Tiny real model + local registry ─────────────────────────────────────────

class TinyFraudNet(nn.Module):
    def __init__(self, cardinalities, num_numeric, emb=4, hidden=16):
        super().__init__()
        self.embs = nn.ModuleList([nn.Embedding(c, emb) for c in cardinalities])
        self.mlp = nn.Sequential(
            nn.Linear(len(cardinalities) * emb + num_numeric, hidden),
            nn.ReLU(),
            nn.Linear(hidden, 1),
            nn.Sigmoid(),
        )

    def forward(self, x_cat, x_num):
        embs = [emb(x_cat[:, i]) for i, emb in enumerate(self.embs)]
        x = torch.cat(embs + [x_num], dim=1)
        return self.mlp(x).squeeze(-1)


def _train_tiny_fraud(seed: int = 42) -> TinyFraudNet:
    """Actually train (a few real gradient steps) on a learnable pattern:
    fraud probability rises with log_amount_norm and payer_prior_txn_velocity
    (canonical train-time numeric contract, NUM_NAMES indices 0 and 6)."""
    torch.manual_seed(seed)
    rng = np.random.default_rng(seed)
    cards = [c["cardinality"] for c in DEFAULT_FRAUD_CATEGORICAL]
    n_num = len(DEFAULT_FRAUD_NUMERIC)
    model = TinyFraudNet(cards, n_num)
    n = 512
    x_cat = torch.tensor(
        np.column_stack([rng.integers(0, c, n) for c in cards]), dtype=torch.long
    )
    # Realistic ranges matching serving-time derivation:
    # log_amount_norm ~ log1p(amount)/20 in [0, ~0.9], velocity in [0, 1].
    x_num = torch.tensor(rng.uniform(0, 1, (n, n_num)), dtype=torch.float32)
    x_num[:, 0] = torch.tensor(rng.uniform(0.2, 0.9, n), dtype=torch.float32)
    x_num[:, 6] = torch.tensor(rng.uniform(0.0, 1.0, n), dtype=torch.float32)
    logit = 4.0 * (x_num[:, 0] - 0.55) + 2.0 * (x_num[:, 6] - 0.4)
    y = (torch.rand(n) < torch.sigmoid(logit)).float()
    opt = torch.optim.Adam(model.parameters(), lr=0.02)
    loss_fn = nn.BCELoss()
    model.train()
    for _ in range(30):
        opt.zero_grad()
        loss = loss_fn(model(x_cat, x_num), y)
        loss.backward()
        opt.step()
    model.eval()
    return model


class TinyLocalRegistry:
    """Minimal in-memory registry honouring the blueprint ModelRegistry ABC:
    register(name, model_dir, metrics, stage, metadata)->version;
    load(name, stage)->(artifact_dir, metadata); set_stage; list."""

    def __init__(self, root: Path):
        self.root = root
        self.root.mkdir(parents=True, exist_ok=True)
        self._versions: dict[str, list[dict]] = {}

    def register(self, name, model_dir, metrics=None, stage="challenger", metadata=None):
        versions = self._versions.setdefault(name, [])
        version = f"v{len(versions) + 1}"
        dest = self.root / name / version
        dest.mkdir(parents=True, exist_ok=True)
        import shutil

        for f in Path(model_dir).iterdir():
            if f.is_file():
                shutil.copy2(f, dest / f.name)
        entry = {
            "name": name, "version": version, "stage": stage,
            "artifact_dir": str(dest), "metrics": metrics or {},
            "metadata": metadata or {},
        }
        versions.append(entry)
        return version

    def load(self, name, stage="champion"):
        for e in reversed(self._versions.get(name, [])):
            if e["stage"] == stage:
                return e["artifact_dir"], {**e["metadata"], "version": e["version"], "metrics": e["metrics"]}
        raise KeyError(f"{name}@{stage} not found")

    def set_stage(self, name, version, stage):
        for e in self._versions.get(name, []):
            if e["version"] == str(version):
                e["stage"] = stage
                return
        raise KeyError(f"{name}:{version} not found")

    def list(self):
        return [e for versions in self._versions.values() for e in versions]


def _write_artifacts(model_dir: Path, model: nn.Module) -> None:
    model_dir.mkdir(parents=True, exist_ok=True)
    torch.save(model, model_dir / "model.pt")
    (model_dir / "metrics.json").write_text(json.dumps({"auc": 0.9, "log_loss": 0.4}))
    (model_dir / "feature_schema.json").write_text(json.dumps({
        "categorical": DEFAULT_FRAUD_CATEGORICAL,
        "numeric": DEFAULT_FRAUD_NUMERIC,
    }))
    rng = np.random.default_rng(0)
    sample = rng.uniform(0, 1, 200)
    counts, edges = np.histogram(sample, bins=10)
    (model_dir / "reference_stats.json").write_text(json.dumps({
        "numeric": {
            "log_amount_norm": {
                "mean": float(sample.mean()), "std": float(sample.std()),
                "histogram": {"edges": edges.tolist(), "counts": counts.tolist()},
                "sample": sample.tolist(),
            }
        },
        "categorical": {"channel": {"frequencies": {"web": 0.6, "ussd": 0.4}}},
    }))
    (model_dir / "metadata.json").write_text(json.dumps({
        "model_type": "fraud", "framework": "torch", "trained_at": "test",
    }))


@pytest.fixture()
def stack(tmp_path, monkeypatch):
    monkeypatch.setenv("EXPOSURE_LOG_PATH", str(tmp_path / "exposures"))
    registry = TinyLocalRegistry(tmp_path / "registry")
    staging = tmp_path / "staging"
    _write_artifacts(staging, _train_tiny_fraud())
    registry.register("fraud", staging, metrics={"auc": 0.9}, stage="champion",
                      metadata={"model_type": "fraud"})
    app = create_app(
        registry=registry,
        exposure_logger=ab_mod.ExposureLogger(tmp_path / "exposures"),
    )
    return app, registry, tmp_path


# ── Tests ────────────────────────────────────────────────────────────────────

def test_health_readyz_and_predict_fraud(stack):
    app, registry, _ = stack
    with TestClient(app) as client:
        app.state.ready = True  # warm thread is async in prod; fixture pre-registered
        assert client.get("/health").status_code == 200
        assert client.get("/readyz").status_code == 200

        payload = {
            "account_id": "acct-001",
            "amount": 5_000_000.0,
            "currency": "NGN",
            "transaction_type": "withdrawal",
            "channel": "ussd",
            "state": "Kano",
            "commodity": "maize",
            "payee_id": "acct-999",
            "txns_last_1h": 12.0,
            "new_payee": True,
        }
        resp = client.post("/v1/predict/fraud", json=payload)
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert 0.0 <= body["fraud_probability"] <= 1.0
        assert body["model_version"] == "v1"
        assert body["variant"] == "champion"
        assert body["model_source"].startswith("ml-platform@fraud:")

        # Determinism: same payload → same score.
        again = client.post("/v1/predict/fraud", json=payload).json()
        assert again["fraud_probability"] == pytest.approx(body["fraud_probability"])

        # Trained model must score the high-risk payload above a benign one.
        benign = dict(payload, amount=1_000.0, txns_last_1h=0.0, new_payee=False)
        benign_score = client.post("/v1/predict/fraud", json=benign).json()["fraud_probability"]
        assert body["fraud_probability"] > benign_score


def test_models_experiments_reload_and_ab(stack, monkeypatch):
    app, registry, tmp_path = stack
    monkeypatch.setenv("AB_CHALLENGER_PCT_FRAUD", "50")
    # Register a challenger version.
    staging2 = tmp_path / "staging2"
    _write_artifacts(staging2, _train_tiny_fraud(seed=7))
    registry.register("fraud", staging2, metrics={"auc": 0.91}, stage="challenger",
                      metadata={"model_type": "fraud"})

    with TestClient(app) as client:
        app.state.ready = True
        models = client.get("/v1/models")
        assert models.status_code == 200
        registered = models.json()["registered"]
        assert {e["stage"] for e in registered} == {"champion", "challenger"}

        variants = set()
        for i in range(20):
            body = client.post("/v1/predict/fraud", json={
                "account_id": f"user-{i}", "amount": 1000.0 + i,
            }).json()
            variants.add(body["variant"])
            assert body["model_version"] in ("v1", "v2")
        assert variants <= {"champion", "challenger"}
        # Deterministic bucketing: same user always same variant.
        v1 = client.post("/v1/predict/fraud", json={"account_id": "user-3", "amount": 5.0}).json()["variant"]
        v2 = client.post("/v1/predict/fraud", json={"account_id": "user-3", "amount": 5.0}).json()["variant"]
        assert v1 == v2

        exp = client.get("/v1/experiments/fraud")
        assert exp.status_code == 200
        stats = exp.json()
        assert stats["challenger_pct"] == 50
        assert stats["total_exposures"] >= 20
        assert stats["variants"]["champion"]["exposures"] >= 1

        reload_resp = client.post("/v1/admin/reload", json={"model": "fraud"})
        assert reload_resp.status_code == 200, reload_resp.text

        # Exposure log is real JSONL on disk.
        log_file = tmp_path / "exposures" / "fraud.jsonl"
        assert log_file.is_file()
        records = [json.loads(line) for line in log_file.read_text().splitlines()]
        assert all({"model", "version", "variant", "user_id", "score", "ts"} <= set(r)
                   for r in records)


def test_feature_store_join(tmp_path, monkeypatch):
    """Online feature join: history numerics from gold/serving_features drive
    the score; cold-start accounts get honest defaults + markers; explicit
    request features override the store."""
    import pandas as pd

    from mlplatform.serving.feature_store import FeatureStore

    monkeypatch.setenv("EXPOSURE_LOG_PATH", str(tmp_path / "exposures"))
    registry = TinyLocalRegistry(tmp_path / "registry")
    staging = tmp_path / "staging"
    _write_artifacts(staging, _train_tiny_fraud())
    registry.register("fraud", staging, metrics={"auc": 0.9}, stage="champion",
                      metadata={"model_type": "fraud"})

    lake = tmp_path / "lake"
    (lake / "gold").mkdir(parents=True)
    pd.DataFrame([{
        "payer_id": "acct-known",
        "payer_prior_txn_count": 90.0,  # → payer_prior_txn_velocity 0.9 (high)
        "payer_median_amount_ngn": 1000.0,
        "device_user_count": 1.0,
        "ip_user_count": 1.0,
        "known_device_ids": "dev-1",
        "last_device_id": "dev-1",
    }]).to_csv(lake / "gold" / "serving_features.csv", index=False)

    app = create_app(
        registry=registry,
        exposure_logger=ab_mod.ExposureLogger(tmp_path / "exposures"),
        feature_store=FeatureStore(lake, ttl_seconds=1),
    )
    with TestClient(app) as client:
        app.state.ready = True
        base = {"amount": 1_000.0, "channel": "web", "device_id": "dev-1"}
        known = client.post("/v1/predict/fraud", json={**base, "account_id": "acct-known"}).json()
        unknown = client.post("/v1/predict/fraud", json={**base, "account_id": "acct-stranger"}).json()
        assert known["feature_source"] == "store" and known["cold_start"] is False
        assert unknown["feature_source"] == "cold-start" and unknown["cold_start"] is True
        # The tiny model was trained with fraud ↑ in payer_prior_txn_velocity
        # (index 6): known account (velocity 0.9) must outscore cold-start (0.0).
        assert known["fraud_probability"] > unknown["fraud_probability"]

        override = client.post("/v1/predict/fraud", json={
            **base, "account_id": "acct-known",
            "features": {"payer_prior_txn_velocity": 0.0},
        }).json()
        assert override["feature_source"] == "request"
        assert override["fraud_probability"] < known["fraud_probability"]

        # Store stats are honest about source and size.
        stats = client.get("/health").json()["feature_store"]
        assert stats["accounts"] == 1 and stats["empty"] is False


def test_unavailable_model_returns_503(tmp_path, monkeypatch):
    monkeypatch.setenv("EXPOSURE_LOG_PATH", str(tmp_path / "exposures"))
    registry = TinyLocalRegistry(tmp_path / "registry")
    app = create_app(registry=registry,
                     exposure_logger=ab_mod.ExposureLogger(tmp_path / "exposures"))
    with TestClient(app) as client:
        resp = client.post("/v1/predict/fraud", json={"account_id": "x", "amount": 1.0})
        assert resp.status_code == 503


def test_drift_report_roundtrip(tmp_path):
    import pandas as pd

    rng = np.random.default_rng(1)
    ref_frame = pd.DataFrame({
        "amount_log": rng.normal(5.0, 1.0, 500),
        "channel": rng.choice(["web", "ussd"], 500, p=[0.6, 0.4]),
    })
    reference = drift_mod.compute_reference_stats(ref_frame)

    calm = pd.DataFrame({
        "amount_log": rng.normal(5.0, 1.0, 300),
        "channel": rng.choice(["web", "ussd"], 300, p=[0.6, 0.4]),
    })
    report = drift_mod.drift_report("fraud", calm, reference=reference, alert=False)
    assert report["n_drifted"] == 0, report["drifted_features"]
    assert not report["alert"]

    shifted = pd.DataFrame({
        "amount_log": rng.normal(9.0, 1.0, 300),
        "channel": rng.choice(["web", "agent"], 300, p=[0.1, 0.9]),
    })
    report = drift_mod.drift_report("fraud", shifted, reference=reference, alert=False)
    assert report["n_drifted"] == 2
    assert report["alert"]
    by_name = {f["feature"]: f for f in report["features"]}
    assert by_name["amount_log"]["psi"] >= drift_mod.PSI_THRESHOLD
    assert "ks_pvalue" in by_name["amount_log"]
    assert by_name["channel"]["tv_distance"] >= drift_mod.TV_THRESHOLD
