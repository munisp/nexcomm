"""Model registry: local versioned registry, optional MLflow adapter."""
from __future__ import annotations

import logging
import os

logger = logging.getLogger("mlplatform.registry")


def get_registry():
    """Return an MLflow-backed registry when configured and importable, else local.

    Contract from the blueprint: mlflow if MLFLOW_TRACKING_URI set & importable,
    else the versioned local filesystem registry (which really versions).
    """
    from mlplatform.settings import get_settings

    settings = get_settings()
    uri = settings.mlflow_tracking_uri or os.environ.get("MLFLOW_TRACKING_URI")
    if uri:
        try:
            from mlplatform.registry.mlflow_adapter import MlflowRegistry

            return MlflowRegistry(tracking_uri=uri, fallback_path=settings.registry_path)
        except ImportError:
            logger.warning(
                "MLFLOW_TRACKING_URI is set but mlflow is not importable; "
                "falling back to LocalRegistry at %s",
                settings.registry_path,
            )
    from mlplatform.registry.local import LocalRegistry

    return LocalRegistry(settings.registry_path)


__all__ = ["get_registry"]
