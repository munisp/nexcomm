"""
NEXCOM ML Platform settings.

Environment-driven configuration (pydantic model; no hard dependency on
pydantic-settings). Env vars (per blueprint contract):
  LAKEHOUSE_PATH, REGISTRY_PATH, MLFLOW_TRACKING_URI, RAY_ADDRESS,
  DATABASE_URL, NEO4J_URI, NEO4J_USER, NEO4J_PASSWORD, ALERT_WEBHOOK_URL,
  ML_PLATFORM_PORT (default 8015), ML_SEED, PROMOTION_MARGIN,
  RISK_TRAINING_DATA_PATH, ML_PLATFORM_CONFIG (optional YAML file).

Closes audit A3 gaps: centralised, honest configuration for the new real
ML stack (previously hardcoded /tmp paths and RNG seeds across services).
"""
from __future__ import annotations

import os
from functools import lru_cache
from pathlib import Path
from typing import Any, Optional

from pydantic import BaseModel, Field

_DEFAULT_CONFIG_PATH = Path(__file__).resolve().parent.parent / "configs" / "default.yaml"


def _load_yaml_file(path: Path) -> dict[str, Any]:
    """Load a YAML config file if PyYAML is importable; otherwise return {}.

    PyYAML is an optional dependency (absent in the CPU validation image),
    so this import is strictly guarded. Env vars always win over file values.
    """
    if not path.is_file():
        return {}
    try:
        import yaml  # type: ignore
    except ImportError:
        return {}
    try:
        with open(path, "r", encoding="utf-8") as fh:
            data = yaml.safe_load(fh) or {}
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def _flatten(d: dict[str, Any], prefix: str = "") -> dict[str, Any]:
    out: dict[str, Any] = {}
    for k, v in d.items():
        key = f"{prefix}{k}" if not prefix else f"{prefix}.{k}"
        if isinstance(v, dict):
            out.update(_flatten(v, key))
        else:
            out[key] = v
    return out


class Settings(BaseModel):
    """Runtime settings for the ML platform. All fields have CPU-safe defaults."""

    # Core paths / connections
    lakehouse_path: str = Field(default="/data/lakehouse")
    registry_path: str = Field(default="/tmp/nexcom_models/registry")
    mlflow_tracking_uri: Optional[str] = Field(default=None)
    ray_address: Optional[str] = Field(default=None)
    database_url: Optional[str] = Field(default=None)
    neo4j_uri: Optional[str] = Field(default=None)
    neo4j_user: str = Field(default="neo4j")
    neo4j_password: Optional[str] = Field(default=None)
    alert_webhook_url: Optional[str] = Field(default=None)
    ml_platform_port: int = Field(default=8015)
    risk_training_data_path: Optional[str] = Field(default=None)

    # Behaviour
    seed: int = Field(default=42)
    promotion_margin: float = Field(default=0.01)
    degradation_tolerance: float = Field(default=0.05)
    retrain_interval_seconds: int = Field(default=3600)
    torch_num_threads: int = Field(default=2)

    # Training defaults (CPU <3 min)
    fraud_epochs: int = Field(default=5)
    credit_epochs: int = Field(default=5)
    price_epochs: int = Field(default=5)
    gnn_epochs: int = Field(default=10)
    batch_size: int = Field(default=256)
    learning_rate: float = Field(default=1e-3)

    @classmethod
    def from_env(cls, config_file: Optional[str] = None) -> "Settings":
        cfg_path = Path(
            config_file
            or os.environ.get("ML_PLATFORM_CONFIG", "")
            or (_DEFAULT_CONFIG_PATH if _DEFAULT_CONFIG_PATH.is_file() else "")
        ) if (config_file or os.environ.get("ML_PLATFORM_CONFIG") or _DEFAULT_CONFIG_PATH.is_file()) else None

        file_vals: dict[str, Any] = {}
        if cfg_path:
            flat = _flatten(_load_yaml_file(cfg_path))
            # map dotted yaml keys to field names where sensible
            alias = {
                "paths.lakehouse": "lakehouse_path",
                "paths.registry": "registry_path",
                "paths.risk_training_data": "risk_training_data_path",
                "integrations.mlflow_tracking_uri": "mlflow_tracking_uri",
                "integrations.ray_address": "ray_address",
                "integrations.database_url": "database_url",
                "integrations.neo4j_uri": "neo4j_uri",
                "integrations.neo4j_user": "neo4j_user",
                "integrations.neo4j_password": "neo4j_password",
                "integrations.alert_webhook_url": "alert_webhook_url",
                "serving.port": "ml_platform_port",
                "training.seed": "seed",
                "training.promotion_margin": "promotion_margin",
                "training.degradation_tolerance": "degradation_tolerance",
                "training.retrain_interval_seconds": "retrain_interval_seconds",
                "training.torch_num_threads": "torch_num_threads",
                "training.fraud_epochs": "fraud_epochs",
                "training.credit_epochs": "credit_epochs",
                "training.price_epochs": "price_epochs",
                "training.gnn_epochs": "gnn_epochs",
                "training.batch_size": "batch_size",
                "training.learning_rate": "learning_rate",
            }
            for dotted, field_name in alias.items():
                if dotted in flat and flat[dotted] is not None:
                    file_vals[field_name] = flat[dotted]

        env_map = {
            "lakehouse_path": "LAKEHOUSE_PATH",
            "registry_path": "REGISTRY_PATH",
            "mlflow_tracking_uri": "MLFLOW_TRACKING_URI",
            "ray_address": "RAY_ADDRESS",
            "database_url": "DATABASE_URL",
            "neo4j_uri": "NEO4J_URI",
            "neo4j_user": "NEO4J_USER",
            "neo4j_password": "NEO4J_PASSWORD",
            "alert_webhook_url": "ALERT_WEBHOOK_URL",
            "ml_platform_port": "ML_PLATFORM_PORT",
            "risk_training_data_path": "RISK_TRAINING_DATA_PATH",
            "seed": "ML_SEED",
            "promotion_margin": "PROMOTION_MARGIN",
            "degradation_tolerance": "DEGRADATION_TOLERANCE",
            "retrain_interval_seconds": "RETRAIN_INTERVAL_SECONDS",
            "torch_num_threads": "TORCH_NUM_THREADS",
        }
        values: dict[str, Any] = dict(file_vals)
        for field_name, env_name in env_map.items():
            raw = os.environ.get(env_name)
            if raw is not None and raw != "":
                values[field_name] = raw
        return cls(**values)

    def lakehouse(self, *parts: str) -> Path:
        p = Path(self.lakehouse_path)
        for part in parts:
            p = p / part
        return p


@lru_cache(maxsize=1)
def get_settings(refresh: bool = False) -> Settings:
    """Cached settings accessor. Pass refresh=True (after clearing cache) to reload."""
    return Settings.from_env()
