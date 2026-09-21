"""
NEXCOM ML platform serving app — CPU inference for fraud, credit, price and
graph (GNN) models behind one FastAPI service.

Closes audit finding A3 §2 ("PyTorch / real LSTM / GNN: ABSENT", "A/B testing
... ABSENT"): every prediction is served from a versioned registry artifact
(torch CPU, inference_mode), deterministically bucketed champion/challenger,
exposure-logged, and answers with an honest model_version / variant /
model_source triple.

Endpoints:
  GET  /health                    liveness
  GET  /readyz                    readiness (503 until at least one champion loads)
  POST /v1/predict/fraud          raw transaction fields → fraud probability
  POST /v1/predict/credit         user features → 300-900 score + default prob
  POST /v1/predict/price          symbol (+optional sequence) → next-day return dist
  POST /v1/predict/graph          account_id → GNN fraud-ring membership prob
  GET  /v1/models                 registry listing + loaded cache
  POST /v1/admin/reload           drop loader cache (all or one model)
  POST /v1/admin/retrain          launch the end-to-end pipeline in background
  GET  /v1/experiments/{model}    A/B exposure stats per variant
"""
from __future__ import annotations

import logging
import os
import threading
import time
import uuid
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any, Optional

import numpy as np
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

from . import ab as ab_mod
from .feature_store import FeatureStore, get_feature_store
from .loader import (
    FeatureEncodingError,
    GraphStore,
    ModelLoader,
    ModelNotFound,
    build_fraud_tensors,
    derive_fraud_numeric,
    get_loader,
    lakehouse_path,
    _env,
    _forward_credit,
    _forward_fraud,
    _forward_price,
    _schema_numerics,
)

logger = logging.getLogger("mlplatform.serving.app")
logging.basicConfig(level=os.environ.get("LOG_LEVEL", "INFO"))

# Registry model names (overridable per deployment).
MODEL_NAMES = {
    "fraud": _env("MODEL_NAME_FRAUD", "fraud"),
    "credit": _env("MODEL_NAME_CREDIT", "credit"),
    "price": _env("MODEL_NAME_PRICE", "price"),
    "graph": _env("MODEL_NAME_GRAPH", "graph"),
}


# ── Request/response models ──────────────────────────────────────────────────

class FraudRequest(BaseModel):
    """Raw transaction fields for fraud scoring (no pre-computed RNG features)."""

    transaction_id: Optional[str] = None
    account_id: str = Field(..., description="Payer/account under scoring (A/B key)")
    amount: float = 0.0
    currency: str = "NGN"
    transaction_type: str = "trade"  # ORDER|TRADE|SETTLEMENT|DEPOSIT|WITHDRAWAL (case-insensitive)
    channel: str = "web"  # web|ussd|whatsapp|agent
    state: Optional[str] = None
    commodity: Optional[str] = None
    payer_id: Optional[str] = None
    payee_id: Optional[str] = None
    device_id: Optional[str] = None
    ip_address: Optional[str] = None
    quantity_mt: Optional[float] = None
    price_ngn_per_mt: Optional[float] = None
    status: Optional[str] = None  # e.g. CANCELLED
    timestamp: Optional[float] = None  # unix seconds or ms
    txns_last_1h: float = 0.0
    txns_last_24h: float = 0.0
    amount_vs_user_avg: float = 1.0
    new_device: bool = False
    new_payee: bool = False
    features: dict[str, float] = Field(
        default_factory=dict,
        description="Explicit numeric overrides (highest precedence, incl. history numerics).",
    )


class CreditRequest(BaseModel):
    user_id: str
    features: dict[str, float] = Field(default_factory=dict)


class PriceRequest(BaseModel):
    symbol: str
    horizon: int = Field(default=1, ge=1, le=90)
    sequence: Optional[list[Any]] = Field(
        default=None,
        description="Recent price window: list[float] closes or list[list[float]] rows.",
    )


class GraphRequest(BaseModel):
    account_id: str


class ReloadRequest(BaseModel):
    model: Optional[str] = None  # kind or registry name; None = all


class RetrainRequest(BaseModel):
    transactions: int = 20000
    epochs: int = 3
    models: Optional[list[str]] = None  # subset of fraud/credit/price/graph


def _prediction_envelope(loaded, variant: str, latency_ms: float, request_id: str) -> dict:
    return {
        "model_version": loaded.version,
        "variant": variant,
        "model_source": loaded.source_tag,
        "latency_ms": round(latency_ms, 3),
        "request_id": request_id,
    }


# ── App factory ──────────────────────────────────────────────────────────────

def create_app(
    registry=None,
    loader: Optional[ModelLoader] = None,
    exposure_logger: Optional[ab_mod.ExposureLogger] = None,
    graph_store: Optional[GraphStore] = None,
    feature_store: Optional[FeatureStore] = None,
) -> FastAPI:
    mloader = loader or get_loader(registry=registry)
    exposures = exposure_logger or ab_mod.ExposureLogger()
    graphs = graph_store or GraphStore()
    fstore = feature_store or get_feature_store()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        app.state.ready = False

        def _warm():
            loaded_any = False
            for kind, name in MODEL_NAMES.items():
                for stage in ("champion", "challenger"):
                    if ab_mod.challenger_pct(name) == 0 and stage == "challenger":
                        continue
                    try:
                        mloader.get(name, stage)
                        loaded_any = loaded_any or stage == "champion"
                    except Exception as exc:
                        logger.info("startup load %s@%s skipped: %s", name, stage, exc)
            app.state.ready = loaded_any
            if not loaded_any:
                logger.warning("No champion models available at startup — /readyz will 503")

        threading.Thread(target=_warm, daemon=True).start()
        yield

    app = FastAPI(
        title="NEXCOM ML Platform",
        description="CPU serving for versioned PyTorch fraud/credit/price/graph models "
                    "with deterministic champion/challenger A/B and exposure logging.",
        version="1.0.0",
        lifespan=lifespan,
    )
    app.state.ready = False

    def _select(kind: str, user_id: str):
        """Pick champion/challenger per deterministic bucket; fall back to champion."""
        name = MODEL_NAMES[kind]
        variant, bucket = ab_mod.assign_variant(name, user_id)
        loaded = mloader.get_or_none(name, variant)
        if loaded is None and variant != "champion":
            variant = "champion"
            loaded = mloader.get_or_none(name, "champion")
        if loaded is None:
            raise HTTPException(
                status_code=503,
                detail=f"no '{name}' model available in registry (kind={kind}); "
                       f"run mlplatform.pipelines.end_to_end to train and register one",
            )
        return name, loaded, variant, bucket

    # ── health ─────────────────────────────────────────────────────────────

    @app.get("/health")
    def health():
        return {
            "status": "healthy",
            "service": "ml-platform",
            "models_loaded": mloader.cache_info(),
            "feature_store": fstore.stats(),
        }

    @app.get("/readyz")
    def readyz():
        if not app.state.ready and not mloader.cache_info():
            raise HTTPException(status_code=503, detail="model artifacts unavailable")
        return {"status": "ready", "models": mloader.cache_info()}

    # ── predictions ────────────────────────────────────────────────────────

    @app.post("/v1/predict/fraud")
    def predict_fraud(req: FraudRequest):
        request_id = req.transaction_id or uuid.uuid4().hex[:16]
        t0 = time.perf_counter()
        name, loaded, variant, bucket = _select("fraud", req.account_id)
        # Contract feature names plus request aliases (type←transaction_type,
        # payer_bin←payer_id, payee_bin←payee_id) — see feature_schema.json.
        cat_raw = {
            "state": req.state, "commodity": req.commodity, "channel": req.channel,
            "type": req.transaction_type, "transaction_type": req.transaction_type,
            "payer_id": req.payer_id or req.account_id, "payee_id": req.payee_id,
            "payer_bin": req.payer_id or req.account_id, "payee_bin": req.payee_id,
            "device_id": req.device_id,
        }
        num_raw = {**req.model_dump(exclude={"features"}), "features": req.features}
        # Online feature join: history numerics from gold/serving_features,
        # keyed by payer (fallback account_id). Unknown account → cold-start.
        history = fstore.get(req.payer_id or req.account_id)
        cold_start = history is None
        history = history or {}
        overrides_history = any(k in req.features for k in (
            "payer_prior_txn_velocity", "device_user_count_norm", "ip_user_count_norm",
            "payer_device_new", "amount_vs_payer_median", "price_dev"))
        feature_source = (
            "request" if overrides_history else ("cold-start" if cold_start else "store")
        )
        try:
            if loaded.framework == "torch":
                x_cat, x_num = build_fraud_tensors(loaded, cat_raw, num_raw, history)
                prob = _forward_fraud(loaded.model, x_cat, x_num)
            else:
                derived = derive_fraud_numeric(num_raw, history)
                nums = [n["name"] for n in _schema_numerics(
                    loaded.feature_schema, "fraud", loaded.model_config
                )] or sorted(derived.keys())
                vec = np.array([[float(derived.get(n, 0.0)) for n in nums]], dtype=np.float64)
                if hasattr(loaded.model, "predict_proba"):
                    prob = float(loaded.model.predict_proba(vec)[0][-1])
                else:  # IsolationForest-style anomaly score → [0,1]
                    raw = float(loaded.model.score_samples(vec)[0])
                    prob = max(0.0, min(1.0, (-raw - 0.1) / 0.5))
        except FeatureEncodingError as exc:
            raise HTTPException(status_code=422, detail=f"feature encoding failed: {exc}") from exc
        except IndexError as exc:  # embedding index escape — contract violation
            raise HTTPException(
                status_code=422,
                detail=f"categorical index out of trained range for {loaded.source_tag}: {exc}",
            ) from exc
        latency = (time.perf_counter() - t0) * 1000
        exposures.log(name, loaded.version, variant, req.account_id, prob, latency, request_id)
        return {
            "transaction_id": req.transaction_id,
            "account_id": req.account_id,
            "fraud_probability": round(prob, 6),
            "risk_score": round(prob, 4),
            "decision": "block" if prob >= 0.85 else ("review" if prob >= 0.5 else "allow"),
            "bucket": bucket,
            "cold_start": cold_start,
            "feature_source": feature_source,
            **_prediction_envelope(loaded, variant, latency, request_id),
        }

    @app.post("/v1/predict/credit")
    def predict_credit(req: CreditRequest):
        request_id = uuid.uuid4().hex[:16]
        t0 = time.perf_counter()
        name, loaded, variant, bucket = _select("credit", req.user_id)
        # Same online join as fraud: serving-store history keyed by user_id,
        # request features override. Unknown user → cold-start zeros.
        history = fstore.get(req.user_id)
        cold_start = history is None
        merged: dict[str, float] = {}
        for k, v in (history or {}).items():
            try:
                f = float(v)
                if f == f:
                    merged[k] = f
            except (TypeError, ValueError):
                continue
        merged.update(req.features)
        feature_source = "request" if req.features else ("cold-start" if cold_start else "store")
        numerics = _schema_numerics(loaded.feature_schema, "credit", loaded.model_config)
        names = [n["name"] for n in numerics] or sorted(merged.keys())
        # gold/serving_features names credit columns with a "credit_" prefix
        # (credit_log_txn_count etc.) while the schema contract is unprefixed
        # (log_txn_count ...). Resolve unprefixed first, then prefixed store
        # column; request `features` overrides keep schema-name semantics.
        def _credit_value(feat_name: str) -> float:
            v = merged.get(feat_name)
            if v is None:
                v = merged.get("credit_" + feat_name, 0.0)
            return float(v)

        try:
            vec = np.array(
                [[(_credit_value(n["name"]) - n["mean"]) / n["std"]
                  for n in numerics]] if numerics else
                [[_credit_value(n) for n in names]],
                dtype=np.float32,
            )
        except (TypeError, ValueError) as exc:
            raise HTTPException(status_code=422, detail=f"credit feature encoding failed: {exc}") from exc
        if loaded.framework == "torch":
            score, default_prob = _forward_credit(loaded.model, vec)
        else:
            raw = float(np.asarray(loaded.model.predict(vec)).reshape(-1)[0])
            score, default_prob = min(900.0, max(300.0, raw)), 1.0 - (raw - 300.0) / 600.0
        latency = (time.perf_counter() - t0) * 1000
        exposures.log(name, loaded.version, variant, req.user_id, default_prob, latency, request_id)
        band = ("prime" if score >= 750 else "good" if score >= 670
                else "fair" if score >= 580 else "subprime")
        credit_envelope_extra = {"cold_start": cold_start, "feature_source": feature_source}
        return {
            "user_id": req.user_id,
            "credit_score": round(score, 1),
            "default_probability": round(default_prob, 6),
            "band": band,
            "bucket": bucket,
            **credit_envelope_extra,
            **_prediction_envelope(loaded, variant, latency, request_id),
        }

    # Exact train-time sequence contract (lakehouse/gold.py + train_price.py):
    # features [return_1d, volatility_realized_20d, rsi_14, macd_histogram],
    # rsi NaN→0.5 then all NaN→0, per-commodity standardization with
    # feat_mean/feat_std, seq_len=20 windows.
    PRICE_SEQ_FEATURES = ["return_1d", "volatility_realized_20d", "rsi_14", "macd_histogram"]

    def _read_part_dir(path: Path):
        """Flat file or partitioned part-file directory (date=*/part-*.csv)."""
        import pandas as pd

        if path.is_file():
            return pd.read_parquet(path) if path.suffix == ".parquet" else pd.read_csv(path)
        if path.is_dir():
            frames = []
            for pattern, reader in (("**/*.parquet", pd.read_parquet), ("**/*.csv", pd.read_csv)):
                for part in sorted(path.glob(pattern)):
                    try:
                        frames.append(reader(part))
                    except Exception:
                        continue
                if frames:
                    break
            if frames:
                return pd.concat(frames, ignore_index=True) if len(frames) > 1 else frames[0]
        return None

    def _compute_price_seq_features(g):
        """gold.py train-time transforms, verbatim."""
        import math

        import pandas as pd

        close = pd.to_numeric(g["close"], errors="coerce")
        log_close = np.log(close.where(close > 0))
        ret = log_close.diff(1)
        delta = close.diff()
        gain = delta.clip(lower=0).ewm(alpha=1 / 14, adjust=False).mean()
        loss = (-delta.clip(upper=0)).ewm(alpha=1 / 14, adjust=False).mean()
        rs = gain / loss.replace(0, np.nan)
        rsi = 100 - 100 / (1 + rs)
        ema12 = close.ewm(span=12, adjust=False).mean()
        ema26 = close.ewm(span=26, adjust=False).mean()
        macd = ema12 - ema26
        macd_hist = macd - macd.ewm(span=9, adjust=False).mean()
        feats = pd.DataFrame({
            "return_1d": ret,
            "volatility_realized_20d": ret.rolling(20).std() * math.sqrt(252),
            "rsi_14": rsi.fillna(50.0) / 100.0,
            "macd_histogram": macd_hist,
        })
        return feats.fillna(0.0), close

    def _seq_len_for(loaded, npz=None) -> int:
        seq_meta = loaded.feature_schema.get("sequence") or {}
        if seq_meta.get("seq_len"):
            return int(seq_meta["seq_len"])
        if npz is not None and "X" in npz and npz["X"].ndim == 3:
            return int(npz["X"].shape[1])
        return int(loaded.feature_schema.get("sequence_length", 20))

    def _load_price_sequence(symbol: str, loaded):
        """Returns (seq (T,F) float32, pre_normalized: bool, last_close|None).

        Sources in order:
          a. gold/price_sequences/sequences.npz — last training window owned by
             the commodity (already per-commodity standardized; feed directly).
          b. silver/prices_daily partitioned parts (date=*/part-*.csv) — full
             train-time transform pipeline + stored feat_mean/feat_std.
        """
        import pandas as pd

        lake = lakehouse_path()
        npz_path = lake / "gold" / "price_sequences" / "sequences.npz"
        packed = None
        if npz_path.is_file():
            try:
                packed = np.load(npz_path, allow_pickle=False)
            except Exception as exc:
                logger.warning("sequences.npz unreadable: %s", exc)
        seq_len = _seq_len_for(loaded, packed)

        # (a) last standardized window owned by the commodity
        if packed is not None and {"X", "commodity"} <= set(packed.files) and packed["X"].size:
            owners = np.asarray([str(c).upper() for c in packed["commodity"]])
            idxs = np.where(owners == symbol.upper())[0]
            if idxs.size:
                window = packed["X"][idxs[-1]].astype(np.float32)
                last_close = None
                daily = _read_part_dir(lake / "silver" / "prices_daily")
                if daily is not None and "commodity" in daily.columns and "close" in daily.columns:
                    d = daily[daily["commodity"].astype(str).str.upper() == symbol.upper()]
                    if not d.empty:
                        d = d.sort_values("date") if "date" in d.columns else d
                        last_close = float(pd.to_numeric(d["close"], errors="coerce").dropna().iloc[-1]) \
                            if pd.to_numeric(d["close"], errors="coerce").notna().any() else None
                return window, True, last_close

        # (b) silver prices_daily → train-time transforms → standardize
        daily = _read_part_dir(lake / "silver" / "prices_daily")
        if daily is None:
            daily = _read_part_dir(lake / "gold" / "prices_daily")  # flat legacy
        if daily is not None:
            sym_col = next((c for c in ("commodity", "symbol", "instrument") if c in daily.columns), None)
            if sym_col:
                daily = daily[daily[sym_col].astype(str).str.upper() == symbol.upper()]
            if not daily.empty and "close" in daily.columns:
                if "date" in daily.columns:
                    daily = daily.sort_values("date")
                daily = daily.reset_index(drop=True)
                feats, close = _compute_price_seq_features(daily)
                # Standardize with the stored per-commodity stats (exact
                # training numbers) when available, else computed from this
                # frame (matches training when silver is unchanged).
                mean = std = None
                if packed is not None and {"stat_commodity", "feat_mean", "feat_std"} <= set(packed.files):
                    stat_comms = [str(c).upper() for c in packed["stat_commodity"]]
                    if symbol.upper() in stat_comms:
                        i = stat_comms.index(symbol.upper())
                        mean = np.asarray(packed["feat_mean"][i], dtype=np.float32)
                        std = np.asarray(packed["feat_std"][i], dtype=np.float32)
                if mean is None:
                    mean = feats[PRICE_SEQ_FEATURES].mean().to_numpy(dtype=np.float32)
                    std = feats[PRICE_SEQ_FEATURES].std().replace(0, 1.0).to_numpy(dtype=np.float32)
                std = np.where(std == 0, 1.0, std)
                normed = ((feats[PRICE_SEQ_FEATURES].to_numpy(dtype=np.float32) - mean) / std)
                window = normed[-seq_len:].astype(np.float32)
                if len(window) < seq_len:  # left-pad with first row
                    window = np.vstack([np.repeat(window[:1], seq_len - len(window), axis=0), window])
                last_close = float(close.dropna().iloc[-1]) if close.notna().any() else None
                return window, True, last_close

        raise HTTPException(
            status_code=503,
            detail=f"no price history for {symbol} under {lake} "
                   "(gold/price_sequences/sequences.npz or silver/prices_daily parts) "
                   "and no sequence supplied in request",
        )

    @app.post("/v1/predict/price")
    def predict_price(req: PriceRequest):
        request_id = uuid.uuid4().hex[:16]
        t0 = time.perf_counter()
        name, loaded, variant, bucket = _select("price", req.symbol)
        if req.sequence:
            arr = np.asarray(req.sequence, dtype=np.float32)
            if arr.ndim == 1:
                arr = arr.reshape(-1, 1)
            seq = arr
            pre_normalized = False
            last_close = float(seq[-1][0]) if seq.size else None
        else:
            seq, pre_normalized, last_close = _load_price_sequence(req.symbol, loaded)
        # Request-supplied raw sequences get the numerics-contract
        # normalization; lakehouse windows are already per-commodity
        # standardized (train-time semantics) and must NOT be re-normalized.
        if not pre_normalized:
            numerics = _schema_numerics(loaded.feature_schema, "price", loaded.model_config)
            if numerics and seq.ndim == 2 and seq.shape[1] == len(numerics) and any(
                n["mean"] != 0.0 or n["std"] != 1.0 for n in numerics
            ):
                means = np.array([n["mean"] for n in numerics], dtype=np.float32)
                stds = np.array([n["std"] for n in numerics], dtype=np.float32)
                seq = (seq - means) / stds
        mean, std = _forward_price(loaded.model, seq)
        # train_price outputs are scaled by target_scale; rescale back.
        target_scale = float((loaded.feature_schema.get("sequence") or {}).get("target_scale", 1.0)) or 1.0
        mean, std = mean * target_scale, std * target_scale
        latency = (time.perf_counter() - t0) * 1000
        exposures.log(name, loaded.version, variant, req.symbol, mean, latency, request_id)
        # Next-day log-return distribution → price interval for the horizon.
        import math

        scale = math.sqrt(max(1, req.horizon))
        exp_mean = last_close * math.exp(mean * req.horizon) if last_close else None
        return {
            "symbol": req.symbol.upper(),
            "horizon_days": req.horizon,
            "expected_log_return": round(mean, 6),
            "return_std": round(std, 6),
            "last_close": last_close or None,
            "expected_price": round(exp_mean, 4) if exp_mean else None,
            "confidence_interval_95": (
                [round(last_close * math.exp(mean * req.horizon - 1.96 * std * scale), 4),
                 round(last_close * math.exp(mean * req.horizon + 1.96 * std * scale), 4)]
                if last_close else None
            ),
            "bucket": bucket,
            **_prediction_envelope(loaded, variant, latency, request_id),
        }

    @app.post("/v1/predict/graph")
    def predict_graph(req: GraphRequest):
        request_id = uuid.uuid4().hex[:16]
        t0 = time.perf_counter()
        name, loaded, variant, bucket = _select("graph", req.account_id)
        try:
            prob = graphs.score(loaded, req.account_id)
        except KeyError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        except ModelNotFound as exc:
            raise HTTPException(status_code=503, detail=str(exc)) from exc
        latency = (time.perf_counter() - t0) * 1000
        exposures.log(name, loaded.version, variant, req.account_id, prob, latency, request_id)
        return {
            "account_id": req.account_id,
            "fraud_ring_probability": round(prob, 6),
            "is_suspicious": prob >= 0.5,
            "bucket": bucket,
            **_prediction_envelope(loaded, variant, latency, request_id),
        }

    # ── registry / admin / experiments ─────────────────────────────────────

    @app.get("/v1/models")
    def list_models():
        try:
            entries = list(mloader.registry.list())
        except Exception as exc:
            entries = []
            logger.info("registry.list failed: %s", exc)
        return {
            "registry": type(mloader.registry).__name__,
            "registered": entries,
            "loaded": mloader.cache_info(),
            "model_names": MODEL_NAMES,
        }

    @app.post("/v1/admin/reload")
    def admin_reload(req: Optional[ReloadRequest] = None):
        req = req or ReloadRequest()
        target = req.model
        if target in MODEL_NAMES:
            target = MODEL_NAMES[target]
        try:
            result = mloader.reload(target)
        except Exception as exc:
            raise HTTPException(status_code=500, detail=f"reload failed: {exc}") from exc
        app.state.ready = bool(mloader.cache_info())
        return {"status": "reloaded", **result}

    @app.post("/v1/admin/retrain")
    def admin_retrain(req: Optional[RetrainRequest] = None):
        """Launch the real end-to-end training pipeline in a background thread.

        Called by services/fraud-engine /model/retrain — replaces synthetic
        model reseeding with an actual train → register → promotion-gate run.
        """
        req = req or RetrainRequest()

        def _run():
            try:
                from mlplatform.pipelines.end_to_end import run_pipeline

                run_pipeline(
                    transactions=req.transactions,
                    epochs=req.epochs,
                    models=req.models,
                    skip_data=False,
                )
                mloader.reload(None)
                app.state.ready = bool(mloader.cache_info())
            except Exception:
                logger.exception("background retrain pipeline failed")

        thread = threading.Thread(target=_run, daemon=True, name="ml-retrain")
        thread.start()
        return {
            "status": "pipeline_started",
            "thread": thread.name,
            "transactions": req.transactions,
            "epochs": req.epochs,
            "models": req.models or list(MODEL_NAMES),
        }

    @app.get("/v1/experiments/{model}")
    def experiment(model: str):
        name = MODEL_NAMES.get(model, model)
        stats = ab_mod.experiment_stats(name, exposures.log_dir)
        stats["in_memory"] = exposures.aggregate(name).get(name, {})
        return stats

    return app


app = create_app()


def main() -> None:
    import uvicorn

    port = int(_env("ML_PLATFORM_PORT", "8015"))
    uvicorn.run("mlplatform.serving.app:app", host="0.0.0.0", port=port, workers=1)


if __name__ == "__main__":
    main()
