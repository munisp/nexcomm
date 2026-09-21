"""
CPU champion/challenger model loader for the NEXCOM ML platform.

Closes audit finding A3 §2 ("Committed/versioned weights: NONE repo-wide",
"CPU inference ... sklearn/numpy only"): all models are loaded as real PyTorch
artifacts from the versioned model registry, pinned to CPU, warmed up, and
cached thread-safely.

Registry contract (binding, see ML_PLATFORM_BLUEPRINT.md):
    registry = mlplatform.registry.get_registry()
    artifact_dir, metadata = registry.load(name, stage)   # stage: "champion" | "challenger" | ...
    registry.list() -> iterable of version descriptors

Artifact directory layout (written by mlplatform.training.*):
    model.pt             torch checkpoint: either a full nn.Module or a dict with
                         "state_dict" (+ optional "model_type"/"hyperparameters")
    model.joblib|pkl     optional non-torch artifact (sklearn fallback models)
    metrics.json         validation metrics
    feature_schema.json  {"numeric": [names...],
                          "categorical": [{"name": ..., "cardinality": ...}...],
                          "sequence_length": int (price), "num_features": int (graph)}
    reference_stats.json drift baseline (see mlplatform.monitoring.drift)
    metadata.json        free-form metadata (model_type, trained_at, ...)

Everything is CPU-only: torch.load(map_location="cpu"), thread count from
ML_PLATFORM_NUM_THREADS / TORCH_NUM_THREADS env, inference under
torch.inference_mode().
"""
from __future__ import annotations

import hashlib
import json
import logging
import os
import threading
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Optional

import numpy as np

logger = logging.getLogger("mlplatform.serving.loader")

MODEL_KINDS = ("fraud", "credit", "price", "graph")

# Stage aliases: registries may label the live stage differently.
_STAGE_ALIASES = {
    "champion": ("champion", "production", "Production", "PRODUCTION"),
    "challenger": ("challenger", "staging", "Staging", "STAGING"),
}


def _env(name: str, default: str = "") -> str:
    """Read configuration from mlplatform.settings if available, else env."""
    try:  # optional: ML-CORE settings module (not required at runtime)
        from mlplatform import settings as _settings  # type: ignore

        val = getattr(_settings, name, None)
        if val is None and hasattr(_settings, "settings"):
            val = getattr(_settings.settings, name.lower(), None)
        if val:
            return str(val)
    except Exception:
        pass
    return os.environ.get(name, default)


def num_threads() -> int:
    """CPU thread count for intra-op parallelism (2 CPU / 4GB validation box)."""
    raw = _env("ML_PLATFORM_NUM_THREADS", "") or _env("TORCH_NUM_THREADS", "")
    try:
        n = int(raw)
        if n > 0:
            return n
    except ValueError:
        pass
    return max(1, min(4, (os.cpu_count() or 2)))


def registry_path() -> Path:
    return Path(_env("REGISTRY_PATH", "/data/model_registry"))


def lakehouse_path() -> Path:
    return Path(_env("LAKEHOUSE_PATH", "/data/lakehouse"))


def get_registry():
    """Resolve the platform model registry (mlflow adapter or local)."""
    from mlplatform.registry import get_registry as _get_registry  # ML-CORE

    return _get_registry()


@dataclass
class LoadedModel:
    """A versioned, CPU-pinned, ready-to-serve model artifact."""

    name: str
    version: str
    stage: str
    kind: str
    model: Any  # torch.nn.Module or sklearn-like object
    model_dir: Path
    metadata: dict = field(default_factory=dict)
    metrics: dict = field(default_factory=dict)
    feature_schema: dict = field(default_factory=dict)
    reference_stats: dict = field(default_factory=dict)
    model_config: dict = field(default_factory=dict)  # ctor kwargs from checkpoint
    framework: str = "torch"
    loaded_at: float = field(default_factory=time.time)

    @property
    def source_tag(self) -> str:
        return f"ml-platform@{self.name}:{self.version}"


class ModelNotFound(RuntimeError):
    """Raised when no usable artifact exists for (name, stage)."""


def _read_json(path: Path) -> dict:
    try:
        if path.is_file():
            return json.loads(path.read_text())
    except Exception as exc:  # corrupt sidecar must not kill serving
        logger.warning("Could not parse %s: %s", path, exc)
    return {}


def _torch_load(path: Path):
    import torch

    try:
        return torch.load(path, map_location="cpu", weights_only=True)
    except Exception:
        # Registry artifacts are first-party training outputs; allow full
        # unpickling for checkpoints that embed the nn.Module instance.
        return torch.load(path, map_location="cpu", weights_only=False)


#: Constructor-kwarg keys accepted in checkpoints/metadata, in precedence
#: order. ML-CORE's training.common.save_checkpoint writes "config";
#: "hyperparameters"/"hyperparams"/"params"/"model_config" are accepted too.
_CKPT_PARAM_KEYS = ("config", "hyperparameters", "hyperparams", "params", "model_config")

#: kind → (module, default class) for state_dict reconstruction.
_MODEL_BUILDERS = {
    "fraud": ("mlplatform.models.fraud_net", "FraudNet"),
    "credit": ("mlplatform.models.credit_net", "CreditNet"),
    "price": ("mlplatform.models.price_lstm", "PriceLSTM"),
    "graph": ("mlplatform.models.graphsage", "GraphSAGEClassifier"),
}


def _reconstruct_torch_model(kind: str, ckpt: dict, metadata: dict, schema: dict):
    """Rebuild an nn.Module from a state_dict checkpoint using ML-CORE model
    classes.

    Checkpoint contract (both shapes accepted):
      {"config": {...ctor kwargs...}, "class": "FraudNet", "state_dict": ...}
      {"hyperparameters": {...}, "state_dict": ...}
    The checkpoint's "config" is authoritative; metadata is a fallback source.
    The class is taken from ckpt/metadata "class" when present, else the
    kind's default builder class.
    """
    import torch.nn  # noqa: F401  (ensures torch present)
    import importlib

    params: dict = {}
    for src in (metadata, ckpt):  # later source wins → checkpoint authoritative
        for key in _CKPT_PARAM_KEYS:
            if isinstance(src, dict) and isinstance(src.get(key), dict):
                params.update(src[key])

    if kind not in _MODEL_BUILDERS:
        raise ModelNotFound(f"no model builder known for kind '{kind}'")
    module_name, default_cls = _MODEL_BUILDERS[kind]

    cls_name = default_cls
    for src in (ckpt, metadata):
        if isinstance(src, dict) and src.get("class"):
            cls_name = str(src["class"])
            break

    try:
        module = importlib.import_module(module_name)
    except Exception as exc:
        raise ModelNotFound(
            f"checkpoint for '{kind}' is a state_dict but model module "
            f"{module_name} is unavailable: {exc}"
        ) from exc
    cls = getattr(module, cls_name, None)
    if cls is None and cls_name != default_cls:
        cls = getattr(module, default_cls, None)  # fall back to kind default
    if cls is None:
        raise ModelNotFound(
            f"model class '{cls_name}' (or default '{default_cls}') not found "
            f"in {module_name} for kind '{kind}'"
        )
    try:
        model = cls(**params)
    except TypeError as exc:
        raise ModelNotFound(
            f"cannot construct {module_name}.{cls.__name__} with config keys "
            f"{sorted(params)}: {exc}"
        ) from exc
    model.load_state_dict(ckpt["state_dict"])
    return model


def _load_torch_artifact(model_dir: Path, kind: str, metadata: dict, schema: dict):
    """Returns (model, ctor_config) or None when no torch artifact exists."""
    import torch

    model_file = None
    for fname in ("model.pt", "model.pth", "model.bin"):
        if (model_dir / fname).is_file():
            model_file = model_dir / fname
            break
    if model_file is None:
        return None
    obj = _torch_load(model_file)
    config: dict = {}
    if isinstance(obj, torch.nn.Module):
        model = obj
        cfg_fn = getattr(model, "config", None)
        if callable(cfg_fn):
            try:
                config = dict(cfg_fn())
            except Exception:
                config = {}
    elif isinstance(obj, dict) and "state_dict" in obj:
        model = _reconstruct_torch_model(kind, obj, metadata, schema)
        for key in _CKPT_PARAM_KEYS:
            if isinstance(obj.get(key), dict):
                config.update(obj[key])
    elif isinstance(obj, dict) and isinstance(obj.get("model"), torch.nn.Module):
        model = obj["model"]
        if isinstance(obj.get("config"), dict):
            config = dict(obj["config"])
    else:
        raise ModelNotFound(
            f"unsupported checkpoint layout in {model_file} "
            f"(type={type(obj).__name__}); expected nn.Module or state_dict dict"
        )
    model.eval()
    return model, config


def _load_sklearn_artifact(model_dir: Path):
    for fname in ("model.joblib", "model.pkl"):
        f = model_dir / fname
        if f.is_file():
            if fname.endswith(".joblib"):
                import joblib

                return joblib.load(f)
            import pickle

            with open(f, "rb") as fh:
                return pickle.load(fh)
    return None


_KIND_TOKENS = {
    "fraud": {"fraud"},
    "credit": {"credit"},
    "price": {"price", "lstm"},
    "graph": {"graph", "gnn", "graphsage"},
}


def _kind_from_text(text: str) -> Optional[str]:
    """Token-based kind match: split on non-alphanumerics and compare whole
    tokens (no substring matching, so e.g. 'graphsage' matches 'graph' but a
    compound string only matches on real tokens). More specific kinds are
    checked before 'fraud'/'credit' so a graph/price task string wins."""
    import re

    tokens = {t for t in re.split(r"[^a-z0-9]+", text.lower()) if t}
    for kind in ("graph", "price", "credit", "fraud"):
        if tokens & _KIND_TOKENS[kind]:
            return kind
    return None


def _infer_kind(name: str, metadata: dict) -> str:
    """Kind inference: registry name first (names are canonical:
    fraud/credit/price/graph), then metadata model_type/kind/task.
    Token-based matching prevents 'fraud_ring_node_classification' (a graph
    task) from matching kind 'fraud'."""
    kind = _kind_from_text(name)
    if kind:
        return kind
    for key in ("model_type", "kind", "task"):
        kind = _kind_from_text(str(metadata.get(key, "")))
        if kind:
            return kind
    return "fraud"


class ModelLoader:
    """Thread-safe champion/challenger loader with warmup and caching."""

    def __init__(self, registry=None, warmup: bool = True):
        self._registry = registry
        self._warmup = warmup
        self._lock = threading.RLock()
        self._cache: dict[tuple[str, str], LoadedModel] = {}
        import torch

        torch.set_num_threads(num_threads())
        logger.info("ModelLoader: torch num_threads=%d", torch.get_num_threads())

    @property
    def registry(self):
        if self._registry is None:
            self._registry = get_registry()
        return self._registry

    # ── registry access ────────────────────────────────────────────────────

    def _load_from_registry(self, name: str, stage: str) -> tuple[Path, dict]:
        errors: list[str] = []
        for candidate in _STAGE_ALIASES.get(stage, (stage,)):
            try:
                artifact_dir, metadata = self.registry.load(name, candidate)
                return Path(artifact_dir), dict(metadata or {})
            except Exception as exc:
                errors.append(f"{candidate}: {exc}")
        # Fallback: scan registry.list() for the highest matching version.
        try:
            entries = list(self.registry.list())
        except Exception as exc:
            raise ModelNotFound(
                f"registry.load failed for {name}@{stage} ({'; '.join(errors)}) "
                f"and registry.list failed: {exc}"
            ) from exc
        matches = [e for e in entries if str(e.get("name", "")) == name]
        if not matches:
            raise ModelNotFound(f"model '{name}' not registered ({'; '.join(errors)})")

        # Normalize both listing shapes to (version, stage, entry) tuples:
        #  - flat per-version entries: {"name", "version", "stage", ...}
        #  - aggregated entries (ML-CORE LocalRegistry.list()):
        #    {"name", "versions": [...], "stages": {"champion": "v3", ...}}
        normalized: list[tuple[str, str, dict]] = []
        for e in matches:
            stages = e.get("stages")
            if isinstance(stages, dict) and stages:
                normalized.extend((str(ver), str(stg), e) for stg, ver in stages.items())
            else:
                normalized.append((str(e.get("version", "0")), str(e.get("stage", "")), e))

        def _version_key(version: str):
            try:
                return int(version.lstrip("v"))
            except ValueError:
                return 0

        aliases = {a.lower() for a in _STAGE_ALIASES.get(stage, (stage,))}
        stage_matches = [t for t in normalized if t[1].lower() in aliases]
        if not stage_matches:
            raise ModelNotFound(
                f"model '{name}' has no version at stage '{stage}' "
                f"(registered stages: {sorted({t[1] for t in normalized})})"
            )
        version, _stg, chosen = max(stage_matches, key=lambda t: _version_key(t[0]))
        artifact_dir = chosen.get("artifact_dir") or chosen.get("model_dir") or chosen.get("path")
        if artifact_dir is None:
            # Conventional local-registry layout: REGISTRY_PATH/<name>/v<n>/
            artifact_dir = registry_path() / name / version
        metadata = dict(chosen.get("metadata") or {})
        metadata.setdefault("version", version)
        return Path(artifact_dir), metadata

    # ── loading ────────────────────────────────────────────────────────────

    def load(self, name: str, stage: str = "champion") -> LoadedModel:
        artifact_dir, metadata = self._load_from_registry(name, stage)
        if not artifact_dir.is_dir():
            raise ModelNotFound(f"artifact dir missing for {name}@{stage}: {artifact_dir}")

        schema = _read_json(artifact_dir / "feature_schema.json")
        metrics = _read_json(artifact_dir / "metrics.json")
        reference_stats = _read_json(artifact_dir / "reference_stats.json")
        disk_metadata = _read_json(artifact_dir / "metadata.json")
        merged_metadata = {**disk_metadata, **metadata}
        kind = _infer_kind(name, merged_metadata)

        model_config: dict = {}
        torch_result = _load_torch_artifact(artifact_dir, kind, merged_metadata, schema)
        framework = "torch"
        if torch_result is not None:
            model, model_config = torch_result
        else:
            model = _load_sklearn_artifact(artifact_dir)
            framework = "sklearn" if model is not None else "torch"
        if model is None:
            raise ModelNotFound(f"no model.pt / model.joblib artifact in {artifact_dir}")
        if framework == "torch":
            model.eval()

        version = str(
            merged_metadata.get("version")
            or artifact_dir.name.lstrip("v")
            or "unknown"
        )
        loaded = LoadedModel(
            name=name,
            version=version,
            stage=stage,
            kind=kind,
            model=model,
            model_dir=artifact_dir,
            metadata=merged_metadata,
            metrics=metrics,
            feature_schema=schema,
            reference_stats=reference_stats,
            model_config=model_config,
            framework=framework,
        )
        if self._warmup:
            self._warmup_model(loaded)
        logger.info(
            "Loaded %s kind=%s version=%s stage=%s framework=%s from %s",
            name, kind, version, stage, framework, artifact_dir,
        )
        return loaded

    def _warmup_model(self, loaded: LoadedModel) -> None:
        """One dummy forward pass so first real request is not JIT/alloc slow."""
        try:
            if loaded.framework != "torch":
                n = (len(_schema_numerics(loaded.feature_schema, loaded.kind, loaded.model_config))
                     or loaded.model_config.get("num_numeric") or 8)
                loaded.model.predict(np.zeros((1, n), dtype=np.float64))
                return
            x_cat, x_num = build_fraud_tensors(loaded, {}, {})
            if loaded.kind == "fraud":
                _forward_fraud(loaded.model, x_cat, x_num)
            elif loaded.kind == "credit":
                n = (len(_schema_numerics(loaded.feature_schema, loaded.kind, loaded.model_config))
                     or loaded.model_config.get("num_numeric") or 8)
                _forward_credit(loaded.model, np.zeros((1, n), dtype=np.float32))
            elif loaded.kind == "price":
                # Train-time contract: sequence = {"seq_len": 20, "features":
                # [return_1d, volatility_realized_20d, rsi_14, macd_histogram]}
                seq_meta = loaded.feature_schema.get("sequence") or {}
                t = int(seq_meta.get("seq_len") or loaded.feature_schema.get("sequence_length")
                        or loaded.model_config.get("seq_len") or 20)
                feats = seq_meta.get("features")
                f = (len(feats) if isinstance(feats, list) else 0) or int(
                    loaded.feature_schema.get("num_features")
                    or loaded.model_config.get("num_features") or 4)
                _forward_price(loaded.model, np.zeros((1, t, f), dtype=np.float32))
            elif loaded.kind == "graph":
                # builder NODE_FEATURE_DIM=9; checkpoint config carries num_features
                f = int(loaded.model_config.get("num_features")
                        or loaded.feature_schema.get("num_features") or 9)
                import torch

                x = torch.zeros((1, f), dtype=torch.float32)
                ei = torch.zeros((2, 0), dtype=torch.long)
                _forward_graph(loaded.model, x, ei, 0)
        except Exception as exc:
            logger.warning("Warmup failed for %s:%s (%s) — continuing", loaded.name, loaded.version, exc)

    # ── cache API ──────────────────────────────────────────────────────────

    def get(self, name: str, stage: str = "champion") -> LoadedModel:
        key = (name, stage)
        with self._lock:
            if key in self._cache:
                return self._cache[key]
        loaded = self.load(name, stage)
        with self._lock:
            self._cache[key] = loaded
        return loaded

    def get_or_none(self, name: str, stage: str = "champion") -> Optional[LoadedModel]:
        try:
            return self.get(name, stage)
        except Exception as exc:
            logger.info("Model %s@%s unavailable: %s", name, stage, exc)
            return None

    def reload(self, name: Optional[str] = None) -> dict:
        """Drop cache entries so the next get() re-reads the registry."""
        with self._lock:
            if name is None:
                dropped = list(self._cache.keys())
                self._cache.clear()
            else:
                dropped = [k for k in self._cache if k[0] == name]
                for k in dropped:
                    self._cache.pop(k, None)
        # Eagerly re-load so reload failures surface to the caller.
        reloaded = []
        for mname, stage in dropped:
            self._cache.pop((mname, stage), None)
            self.get(mname, stage)
            reloaded.append(f"{mname}@{stage}")
        return {"reloaded": reloaded, "dropped": [f"{n}@{s}" for n, s in dropped]}

    def cache_info(self) -> list[dict]:
        with self._lock:
            return [
                {
                    "name": m.name, "version": m.version, "stage": m.stage,
                    "kind": m.kind, "framework": m.framework,
                    "loaded_at": m.loaded_at, "model_dir": str(m.model_dir),
                }
                for m in self._cache.values()
            ]


# ── Featurization + forward adapters ─────────────────────────────────────────
# These adapt HTTP request payloads to each model family's input signature.
# Feature order/cardinalities come from feature_schema.json in the artifact
# directory — the binding contract with mlplatform.training.* writers.

# Training-side categorical contract (ML-CORE training CLIs):
#   order        [state, commodity, channel, type, payer_bin, payee_bin]
#   cardinalities [38, 11, 5, 6, 257, 257]
#   encoding     vocab: index+1 with 0=unknown; payer/payee: md5 bucket
#                int(md5(str).hexdigest(), 16) % (cardinality - 1) + 1
DEFAULT_FRAUD_CAT_ORDER = ["state", "commodity", "channel", "type", "payer_bin", "payee_bin"]
DEFAULT_FRAUD_CAT_CARDINALITIES = [38, 11, 5, 6, 257, 257]
DEFAULT_FRAUD_CATEGORICAL = [
    {"name": n, "cardinality": c, "encoding": "md5_bucket", "unknown_index": 0}
    for n, c in zip(DEFAULT_FRAUD_CAT_ORDER, DEFAULT_FRAUD_CAT_CARDINALITIES)
]
# Canonical train-time numeric features (mlplatform.training.train_fraud
# NUM_NAMES / NUM_TRANSFORMS — serving reproduces them verbatim).
DEFAULT_FRAUD_NUMERIC = [
    "log_amount_norm", "hour_sin", "hour_cos", "is_weekend",
    "log_qty_norm", "price_dev", "payer_prior_txn_velocity", "sub_threshold_flag",
    "is_cancelled", "device_user_count_norm", "ip_user_count_norm",
    "payer_device_new", "amount_vs_payer_median",
]
# History-derived numerics that cannot be computed from a single request;
# these are filled from the gold/serving_features store (feature_store.py).
HISTORY_NUMERIC_NAMES = (
    "payer_prior_txn_velocity", "device_user_count_norm", "ip_user_count_norm",
    "payer_device_new", "amount_vs_payer_median", "price_dev",
)


class FeatureEncodingError(ValueError):
    """Raised when a request value cannot be encoded within the trained
    feature contract. Mapped to HTTP 422 by the serving app."""


def md5_bucket(value: Any, cardinality: int, unknown_index: int = 0) -> int:
    """Training-compatible bucket hash: md5_int % (cardinality - 1) + 1,
    reserving `unknown_index` (0) for missing values."""
    if value is None or str(value) == "":
        return unknown_index
    cardinality = int(cardinality)
    if cardinality < 2:
        raise FeatureEncodingError(f"cardinality {cardinality} too small for bucket encoding")
    return int(hashlib.md5(str(value).encode()).hexdigest(), 16) % (cardinality - 1) + 1


def hash_to_bucket(value: Any, cardinality: int) -> int:
    """Legacy sha256 hash (kept for callers that predate the md5 contract)."""
    if value is None:
        return 0
    digest = hashlib.sha256(str(value).encode()).hexdigest()
    return int(digest[:12], 16) % max(1, int(cardinality))


def encode_categorical(spec: dict, value: Any) -> int:
    """Encode one categorical value per the artifact feature_schema contract:
      {"name", "cardinality", "encoding": "vocab"|"md5_bucket",
       "vocab": [...], "unknown_index": 0}
    vocab encoding → vocab.index(str(value)) + 1 (0 = unknown);
    md5_bucket     → int(md5(str).hexdigest(), 16) % (cardinality-1) + 1.
    Indices are hard-validated against cardinality.
    """
    name = spec.get("name", "?")
    cardinality = int(spec.get("cardinality", 0))
    if cardinality < 1:
        raise FeatureEncodingError(f"categorical '{name}' has invalid cardinality {cardinality}")
    unknown_index = int(spec.get("unknown_index", 0))
    encoding = spec.get("encoding")
    vocab = spec.get("vocab")
    if encoding == "vocab" or (encoding is None and vocab):
        vocab_list = [str(v) for v in (vocab or [])]
        sval = "" if value is None else str(value)
        # Case-tolerant lookup (training vocabs: types UPPERCASE, states Title,
        # commodities lowercase) — exact match wins, then case variants.
        idx = None
        for candidate in (sval, sval.upper(), sval.lower(), sval.title()):
            if candidate in vocab_list:
                idx = vocab_list.index(candidate) + 1
                break
        if idx is None:
            idx = unknown_index
    elif encoding in (None, "md5_bucket"):
        idx = md5_bucket(value, cardinality, unknown_index)
    else:
        raise FeatureEncodingError(f"categorical '{name}' has unknown encoding '{encoding}'")
    if not 0 <= idx < cardinality:
        raise FeatureEncodingError(
            f"categorical '{name}' value {value!r} encoded to index {idx}, "
            f"outside trained cardinality {cardinality} (encoding={encoding or 'md5_bucket'})"
        )
    return idx


def _schema_categoricals(schema: dict, model_config: Optional[dict] = None) -> list[dict]:
    """Categorical feature contract for a model, in training feature order.

    Sources, in precedence order:
      1. feature_schema.json "categoricals" (full contract) or legacy
         "categorical" list ({"name","cardinality"} entries, md5 encoding).
      2. Checkpoint config "cat_cardinalities" mapped onto
         DEFAULT_FRAUD_CAT_ORDER with md5_bucket encoding.
      3. DEFAULT_FRAUD_CATEGORICAL.
    """
    raw = schema.get("categoricals") or schema.get("categorical")
    if raw:
        out = []
        for c in raw:
            if isinstance(c, dict):
                out.append({
                    "name": str(c["name"]),
                    "cardinality": int(c.get("cardinality", 257)),
                    "encoding": c.get("encoding", "md5_bucket"),
                    "vocab": c.get("vocab"),
                    "unknown_index": int(c.get("unknown_index", 0)),
                })
            else:
                out.append({"name": str(c), "cardinality": 257,
                            "encoding": "md5_bucket", "vocab": None, "unknown_index": 0})
        return out
    cards = (model_config or {}).get("cat_cardinalities")
    if isinstance(cards, (list, tuple)) and cards:
        return [
            {
                "name": DEFAULT_FRAUD_CAT_ORDER[i] if i < len(DEFAULT_FRAUD_CAT_ORDER) else f"cat_{i}",
                "cardinality": int(card),
                "encoding": "md5_bucket",
                "vocab": None,
                "unknown_index": 0,
            }
            for i, card in enumerate(cards)
        ]
    return [dict(c) for c in DEFAULT_FRAUD_CATEGORICAL]


def _schema_numerics(schema: dict, kind: str, model_config: Optional[dict] = None) -> list[dict]:
    """Numeric feature contract: [{"name", "mean", "std"}] in training order.

    Sources: feature_schema.json "numerics" (full contract incl. stored
    mean/std normalization) or legacy "numeric" name list (unnormalized —
    without the contract we cannot know whether training normalized, so raw
    values are passed through); fallback DEFAULT_FRAUD_NUMERIC for fraud,
    padded/truncated to the checkpoint's num_numeric when known.
    """
    raw = schema.get("numerics")
    if raw:
        return [
            {"name": str(n["name"]),
             "mean": float(n.get("mean", 0.0)),
             "std": float(n.get("std", 1.0)) or 1.0}
            for n in raw
        ]
    names = [str(n) for n in (schema.get("numeric") or [])]
    if not names and kind == "fraud":
        names = list(DEFAULT_FRAUD_NUMERIC)
    expected = (model_config or {}).get("num_numeric")
    if expected and names:
        if len(names) < int(expected):
            names = names + [f"pad_{i}" for i in range(len(names), int(expected))]
        else:
            names = names[: int(expected)]
    return [{"name": n, "mean": 0.0, "std": 1.0} for n in names]


def _clip(v: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, v))


def _hist_float(history: Optional[dict], *names: str) -> Optional[float]:
    if not history:
        return None
    for n in names:
        v = history.get(n)
        if v is None:
            continue
        try:
            f = float(v)
            if f == f:  # NaN guard
                return f
        except (TypeError, ValueError):
            continue
    return None


def derive_fraud_numeric(raw: dict, history: Optional[dict] = None) -> dict:
    """Derive the 13 canonical fraud numerics with exact train-time semantics
    (see mlplatform.training.train_fraud.NUM_TRANSFORMS).

    Merge order (online feature join, closes the offline/online skew gap):
      a. stateless numerics derived from raw request fields;
      b. history numerics filled from the gold/serving_features store row
         (`history`, keyed by account/payer id);
      c. explicit request ``features`` dict overrides both.
    Cold-start (history=None): documented defaults, callers mark the response
    with cold_start=true. All derivations are deterministic; no randomness.
    """
    import math
    from datetime import datetime, timezone

    history = history or {}
    amount = float(raw.get("amount", raw.get("amount_ngn", 0.0)) or 0.0)
    quantity = float(raw.get("quantity_mt", 0.0) or 0.0)
    price = float(raw.get("price_ngn_per_mt", 0.0) or 0.0)
    txn_type = str(raw.get("transaction_type", raw.get("type", "")) or "").upper()
    status = str(raw.get("status", "") or "").upper()
    ts = raw.get("timestamp") or raw.get("timestamp_ms")
    if ts:
        ts = float(ts)
        if ts > 1e12:
            ts /= 1000.0
        dt = datetime.fromtimestamp(ts, tz=timezone.utc)
    else:
        dt = datetime.now(timezone.utc)
    hour = dt.hour + dt.minute / 60.0

    # (a) stateless, request-derived — train-time transforms verbatim.
    derived = {
        "log_amount_norm": math.log1p(max(amount, 0.0)) / 20.0,
        "hour_sin": math.sin(2 * math.pi * hour / 24.0),
        "hour_cos": math.cos(2 * math.pi * hour / 24.0),
        "is_weekend": 1.0 if dt.weekday() >= 5 else 0.0,
        "log_qty_norm": math.log1p(max(quantity, 0.0)) / 10.0,
        "sub_threshold_flag": 1.0 if (txn_type == "DEPOSIT" and 5_000_000 <= amount < 10_000_000) else 0.0,
        "is_cancelled": 1.0 if status == "CANCELLED" else 0.0,
    }

    # (b) history-derived numerics from the serving feature store.
    commodity_median = _hist_float(history, "commodity_median_price_ngn_per_mt", "commodity_median_price")
    if price and commodity_median:
        derived["price_dev"] = _clip(price / commodity_median - 1.0, -2.0, 2.0)
    else:
        derived["price_dev"] = 0.0  # train-time NaN→0 semantics

    prior_velocity = _hist_float(history, "payer_prior_txn_velocity")
    if prior_velocity is None:
        prior_count = _hist_float(history, "payer_prior_txn_count")
        prior_velocity = _clip(prior_count / 100.0, 0.0, 1.0) if prior_count is not None else 0.0
    derived["payer_prior_txn_velocity"] = _clip(prior_velocity, 0.0, 1.0)

    dev_norm = _hist_float(history, "device_user_count_norm")
    if dev_norm is None:
        dev_count = _hist_float(history, "device_user_count")
        # Cold-start: a single observed user on this device → count 1.
        dev_norm = _clip(dev_count / 10.0, 0.0, 1.0) if dev_count is not None else 0.1
    derived["device_user_count_norm"] = _clip(dev_norm, 0.0, 1.0)

    ip_norm = _hist_float(history, "ip_user_count_norm")
    if ip_norm is None:
        ip_count = _hist_float(history, "ip_user_count")
        ip_norm = _clip(ip_count / 10.0, 0.0, 1.0) if ip_count is not None else 0.1
    derived["ip_user_count_norm"] = _clip(ip_norm, 0.0, 1.0)

    device_new = _hist_float(history, "payer_device_new")
    if device_new is None:
        device_id = raw.get("device_id")
        if device_id:
            from .feature_store import parse_known_devices

            known = parse_known_devices(history)
            last_dev = history.get("last_device_id")
            if known:
                device_new = 0.0 if str(device_id) in known else 1.0
            elif last_dev is not None:
                device_new = 0.0 if str(device_id) == str(last_dev) else 1.0
            else:
                device_new = 1.0  # cold-start: unseen device
        else:
            device_new = 1.0 if not history else 0.0
    derived["payer_device_new"] = float(device_new)

    median_amt = _hist_float(history, "payer_median_amount_ngn", "payer_median_amount")
    if median_amt:
        derived["amount_vs_payer_median"] = _clip(amount / median_amt - 1.0, -5.0, 5.0) / 5.0
    else:
        derived["amount_vs_payer_median"] = 0.0  # cold-start neutral

    # (c) explicit request features override everything.
    for k, v in (raw.get("features") or {}).items():
        try:
            derived[str(k)] = float(v)
        except (TypeError, ValueError):
            continue
    return derived


def build_fraud_tensors(loaded: LoadedModel, cat_raw: dict, num_raw: dict,
                        history: Optional[dict] = None):
    """Build (x_cat, x_num) per the artifact's feature_schema contract:
    categoricals encoded via vocab (unknown→0) / md5_bucket, numerics derived
    with train-time transforms (stateless from the request, history numerics
    from the serving feature store), then normalized with stored mean/std.
    Raises FeatureEncodingError (→ HTTP 422) on any value that cannot be
    encoded within the trained contract."""
    import torch

    cats = _schema_categoricals(loaded.feature_schema, loaded.model_config)
    nums = _schema_numerics(loaded.feature_schema, "fraud", loaded.model_config)
    derived = derive_fraud_numeric(num_raw, history)

    cat_vals = []
    for c in cats:
        value = cat_raw.get(c["name"])
        if value is None:
            # Contract aliases: type←transaction_type, payer_bin←payer_id, ...
            alias = {"type": "transaction_type", "payer_bin": "payer_id",
                     "payee_bin": "payee_id"}.get(c["name"])
            if alias:
                value = cat_raw.get(alias)
        cat_vals.append(encode_categorical(c, value))
    num_vals = []
    for n in nums:
        try:
            raw_val = float(derived.get(n["name"], num_raw.get(n["name"], 0.0)) or 0.0)
        except (TypeError, ValueError) as exc:
            raise FeatureEncodingError(
                f"numeric feature '{n['name']}' is not a number: "
                f"{num_raw.get(n['name'])!r}"
            ) from exc
        num_vals.append((raw_val - n["mean"]) / n["std"])

    x_cat = torch.tensor([cat_vals], dtype=torch.long)
    x_num = torch.tensor([num_vals], dtype=torch.float32)
    # Hard guard: every embedding index must be inside the trained cardinality.
    for i, c in enumerate(cats):
        idx = int(x_cat[0, i])
        if not 0 <= idx < c["cardinality"]:
            raise FeatureEncodingError(
                f"categorical '{c['name']}' index {idx} out of range "
                f"[0, {c['cardinality']})"
            )
    return x_cat, x_num


def _forward_fraud(model, x_cat, x_num) -> float:
    import torch

    with torch.inference_mode():
        try:
            out = model(x_cat, x_num)
        except TypeError:
            out = model(x_num)
    arr = np.asarray(out.detach().cpu(), dtype=np.float64).reshape(-1)
    p = float(arr[0])
    if p < 0.0 or p > 1.0:  # logits instead of probabilities
        p = float(1.0 / (1.0 + np.exp(-p)))
    return p


def _forward_credit(model, x: np.ndarray):
    import torch

    with torch.inference_mode():
        out = model(torch.tensor(x, dtype=torch.float32))
    if isinstance(out, (tuple, list)):
        score_raw = float(np.asarray(out[0].detach().cpu()).reshape(-1)[0])
        prob_raw = float(np.asarray(out[1].detach().cpu()).reshape(-1)[0])
    else:
        arr = np.asarray(out.detach().cpu(), dtype=np.float64).reshape(-1)
        score_raw, prob_raw = float(arr[0]), float(arr[1] if arr.size > 1 else 0.5)
    # CreditNet contract: score head in 300-900, default-prob head in [0,1].
    score = min(900.0, max(300.0, score_raw))
    prob = min(1.0, max(0.0, prob_raw if 0.0 <= prob_raw <= 1.0 else 1.0 / (1.0 + np.exp(-prob_raw))))
    return score, prob


def _forward_price(model, seq: np.ndarray):
    """seq: (T, F) or (1, T, F) float32 → (mean_log_return, std_log_return)."""
    import torch

    x = seq.astype(np.float32)
    if x.ndim == 2:
        x = x[None, :, :]
    with torch.inference_mode():
        out = model(torch.tensor(x, dtype=torch.float32))
    if isinstance(out, (tuple, list)):
        mean = float(np.asarray(out[0].detach().cpu()).reshape(-1)[0])
        std = float(np.asarray(out[1].detach().cpu()).reshape(-1)[0])
    else:
        arr = np.asarray(out.detach().cpu(), dtype=np.float64).reshape(-1)
        mean = float(arr[0])
        std = float(arr[1] if arr.size > 1 else 0.01)
    return mean, max(std, 1e-6)


def _forward_graph(model, x, edge_index, node_idx: int) -> float:
    import torch

    with torch.inference_mode():
        try:
            out = model(x, edge_index)
        except TypeError:
            out = model(x)
    arr = np.asarray(out.detach().cpu(), dtype=np.float64)
    if arr.ndim == 2:  # (N, C) logits
        row = arr[node_idx]
        if row.size >= 2:
            e = np.exp(row - row.max())
            return float(e[1] / e.sum())  # P(fraud class)
        return float(1.0 / (1.0 + np.exp(-row[0])))
    flat = arr.reshape(-1)
    p = float(flat[node_idx] if flat.size > 1 else flat[0])
    return p if 0.0 <= p <= 1.0 else float(1.0 / (1.0 + np.exp(-p)))


class GraphStore:
    """Lazy, thread-safe holder for the order-flow graph used by the GNN.

    Reads gold-layer graph artifacts produced by mlplatform.graph.builder:
    Actual gold-layer layout (mlplatform.graph.builder): partitioned part-file
    directories — node_index/part-*.csv (node_type, node_id, idx),
    edges/part-*.csv (src_idx, dst_idx, edge_type, weight), plus graph.npz
    (keys: node_features (N,F) float32, edge_index (2,E) int64, labels,
    train_mask). Flat files are also accepted (first choice).
    """

    def __init__(self, graph_dir: Optional[Path] = None):
        self.graph_dir = Path(graph_dir) if graph_dir else lakehouse_path() / "gold" / "graph"
        self._lock = threading.RLock()
        self._loaded = False
        self.node_ids: list[str] = []
        self.node_lookup: dict[str, int] = {}
        self.features: Optional[np.ndarray] = None
        self.edge_index = None

    def _read_table(self, stem: str):
        """Flat file first, then a partitioned part-file directory
        (<stem>/part-*.csv|parquet, recursively — partition dir names like
        date=... carry no columns; the CSVs inside do)."""
        import pandas as pd

        for ext, reader in ((".parquet", pd.read_parquet), (".csv", pd.read_csv)):
            f = self.graph_dir / f"{stem}{ext}"
            if f.is_file():
                try:
                    return reader(f)
                except Exception as exc:
                    if ext == ".parquet":  # pyarrow missing → try csv sibling
                        logger.warning("parquet read failed for %s (%s)", f, exc)
                        continue
                    raise
        part_dir = self.graph_dir / stem
        if part_dir.is_dir():
            frames = []
            for pattern, reader in (("**/*.parquet", pd.read_parquet), ("**/*.csv", pd.read_csv)):
                for part in sorted(part_dir.glob(pattern)):
                    try:
                        frames.append(reader(part))
                    except Exception as exc:
                        logger.warning("part read failed for %s: %s", part, exc)
                if frames:
                    break  # don't mix parquet and csv parts of the same table
            if frames:
                return pd.concat(frames, ignore_index=True) if len(frames) > 1 else frames[0]
        return None

    def ensure_loaded(self) -> bool:
        with self._lock:
            if self._loaded:
                return self.features is not None
            self._loaded = True
            nodes = self._read_table("node_index")
            edges = self._read_table("edges")
            graph_npz = self.graph_dir / "graph.npz"
            feat_npy = self.graph_dir / "node_features.npy"
            feat_csv = self.graph_dir / "node_features.csv"
            feats = None
            ei = None
            if graph_npz.is_file():
                packed = np.load(graph_npz)
                if "node_features" in packed:
                    feats = packed["node_features"].astype(np.float32)
                if "edge_index" in packed:
                    import torch

                    ei = torch.tensor(np.asarray(packed["edge_index"]), dtype=torch.long)
            if feats is None and feat_npy.is_file():
                feats = np.load(feat_npy).astype(np.float32)
            elif feats is None and feat_csv.is_file():
                feats = np.loadtxt(feat_csv, delimiter=",").astype(np.float32)
            if nodes is None or feats is None or (edges is None and ei is None):
                logger.warning("Graph artifacts incomplete under %s", self.graph_dir)
                return False
            id_col = "node_id" if "node_id" in nodes.columns else nodes.columns[0]
            # builder layout uses "idx"; legacy layout uses "node_index"
            idx_col = ("idx" if "idx" in nodes.columns
                       else "node_index" if "node_index" in nodes.columns
                       else nodes.columns[1])
            nodes = nodes.sort_values(idx_col)
            self.node_ids = [str(v) for v in nodes[id_col].tolist()]
            self.node_lookup = {nid: int(nodes.iloc[i][idx_col]) for i, nid in enumerate(self.node_ids)}
            if ei is None:
                src_col = next((c for c in ("src_idx", "source", "src") if c in edges.columns), edges.columns[0])
                dst_col = next((c for c in ("dst_idx", "target", "dst") if c in edges.columns), edges.columns[1])
                import torch

                ei = torch.tensor(
                    edges[[src_col, dst_col]].to_numpy(dtype=np.int64).T, dtype=torch.long
                )
            self.features = feats
            self.edge_index = ei
            logger.info(
                "GraphStore loaded: %d nodes, %d edges, %d features",
                len(self.node_ids), ei.shape[1], feats.shape[1],
            )
            return True

    def score(self, loaded: LoadedModel, account_id: str) -> float:
        import torch

        if not self.ensure_loaded():
            raise ModelNotFound(
                f"graph artifacts not available under {self.graph_dir} "
                "(run mlplatform.graph.builder via the end-to-end pipeline)"
            )
        if account_id not in self.node_lookup:
            raise KeyError(f"account '{account_id}' not present in graph node index")
        idx = self.node_lookup[account_id]
        x = torch.tensor(self.features, dtype=torch.float32)
        x = self.normalize(loaded, x)
        return _forward_graph(loaded.model, x, self.edge_index, idx)

    def normalize(self, loaded: LoadedModel, x) -> Any:
        """Apply the artifact's numerics mean/std contract to a node-feature
        matrix when widths match; otherwise pass through unchanged."""
        import torch as _torch

        nums = _schema_numerics(loaded.feature_schema, "graph", loaded.model_config)
        if nums and x.ndim == 2 and x.shape[1] == len(nums) and any(
            n["mean"] != 0.0 or n["std"] != 1.0 for n in nums
        ):
            mean = _torch.tensor([n["mean"] for n in nums], dtype=_torch.float32)
            std = _torch.tensor([n["std"] for n in nums], dtype=_torch.float32)
            return (x - mean) / std
        return x


_MODULE_LOADER: Optional[ModelLoader] = None
_MODULE_LOCK = threading.Lock()


def get_loader(registry=None, warmup: bool = True) -> ModelLoader:
    """Process-wide loader singleton (registry injectable for tests)."""
    global _MODULE_LOADER
    with _MODULE_LOCK:
        if _MODULE_LOADER is None or registry is not None:
            _MODULE_LOADER = ModelLoader(registry=registry, warmup=warmup)
        return _MODULE_LOADER
