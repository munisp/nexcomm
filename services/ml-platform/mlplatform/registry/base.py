"""
Model registry abstract contract.

Implementations: registry/local.py (versioned filesystem — the default) and
registry/mlflow_adapter.py (when mlflow is importable and MLFLOW_TRACKING_URI
is set).

Closes audit A3 gap: "registry" was a named Docker volume of raw pickles with
no versioning, metadata or stages.
"""
from __future__ import annotations

from abc import ABC, abstractmethod
from pathlib import Path


class ModelRegistry(ABC):
    STAGES = ("challenger", "champion", "archived")

    @abstractmethod
    def register(self, name: str, model_dir: str | Path, metrics: dict,
                 stage: str = "challenger", metadata: dict | None = None,
                 feature_schema: dict | None = None,
                 reference_stats: dict | None = None) -> str:
        """Copy artifacts from model_dir into a new version. Returns version id."""

    @abstractmethod
    def load(self, name: str, stage: str | None = None,
             version: str | None = None) -> tuple[Path, dict]:
        """Resolve (artifact_dir, metadata) for a stage or explicit version."""

    @abstractmethod
    def set_stage(self, name: str, version: str, stage: str) -> None:
        ...

    @abstractmethod
    def list_models(self) -> dict:
        ...

    @abstractmethod
    def list(self) -> list[dict]:
        """Contract listing (serving iterates this): a LIST of entries, each
        {"name": str, "versions": [...], "stages": {...}, "latest_metrics": {...}}."""
        ...

    def get_champion(self, name: str) -> tuple[Path, dict] | None:
        try:
            return self.load(name, stage="champion")
        except (FileNotFoundError, KeyError):
            return None

    def get_challenger(self, name: str) -> tuple[Path, dict] | None:
        try:
            return self.load(name, stage="challenger")
        except (FileNotFoundError, KeyError):
            return None
