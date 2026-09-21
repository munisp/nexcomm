"""
MlflowRegistry — implements the ModelRegistry ABC against MLflow when the
`mlflow` package is importable. Logs params/metrics/artifacts and mirrors the
champion/challenger stage concept onto MLflow model-version tags/aliases.

Import-guarded: this module must only be constructed when mlflow is present
(registry/__init__.py does that check). A LocalRegistry is kept alongside as
the durable artifact store so load() always has a concrete directory to hand
to the serving layer even if the tracking server is later unreachable.
"""
from __future__ import annotations

import logging
import time
from pathlib import Path

from mlplatform.registry.base import ModelRegistry
from mlplatform.registry.local import LocalRegistry

logger = logging.getLogger("mlplatform.registry.mlflow_adapter")


class MlflowRegistry(ModelRegistry):
    def __init__(self, tracking_uri: str, fallback_path: str | Path):
        import mlflow  # noqa: F401 — ImportError propagates to get_registry()

        self._mlflow = mlflow
        mlflow.set_tracking_uri(tracking_uri)
        self.tracking_uri = tracking_uri
        self._local = LocalRegistry(fallback_path)  # durable artifact mirror
        logger.info("MlflowRegistry at %s (local mirror %s)", tracking_uri, fallback_path)

    def register(self, name: str, model_dir: str | Path, metrics: dict,
                 stage: str = "challenger", metadata: dict | None = None,
                 feature_schema: dict | None = None,
                 reference_stats: dict | None = None) -> str:
        version = self._local.register(name, model_dir, metrics, stage=stage,
                                       metadata=metadata, feature_schema=feature_schema,
                                       reference_stats=reference_stats)
        try:
            mlflow = self._mlflow
            mlflow.set_experiment(f"nexcom/{name}")
            with mlflow.start_run(run_name=f"{name}-{version}"):
                mlflow.log_params({"name": name, "version": version, "stage": stage,
                                   **{k: str(v) for k, v in (metadata or {}).items()
                                      if isinstance(v, (int, float, str, bool))}})
                for k, v in metrics.items():
                    if isinstance(v, (int, float)):
                        mlflow.log_metric(k, float(v))
                mlflow.log_artifacts(str(model_dir), artifact_path=version)
                mlflow.set_tag("stage", stage)
        except Exception as exc:
            logger.warning("mlflow logging failed (%s); local registry copy is authoritative", exc)
        return version

    def load(self, name: str, stage: str | None = None,
             version: str | None = None) -> tuple[Path, dict]:
        return self._local.load(name, stage=stage, version=version)

    def set_stage(self, name: str, version: str, stage: str) -> None:
        self._local.set_stage(name, version, stage)
        try:
            client = self._mlflow.tracking.MlflowClient(tracking_uri=self.tracking_uri)
            client.set_registered_model_alias(name, stage, int(version.lstrip("v")))
        except Exception as exc:
            logger.warning("mlflow alias update failed (%s)", exc)

    def list_models(self) -> dict:
        return self._local.list_models()

    def list(self) -> list[dict]:
        """Contract listing: list of per-model entries (same info as list_models)."""
        return [{"name": name, **info} for name, info in self.list_models().items()]
