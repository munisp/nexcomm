"""
LocalRegistry — versioned, human-inspectable filesystem model registry.

Layout:
  {REGISTRY_PATH}/<name>/v<n>/
      model.pt              torch checkpoint (state_dict + config)
      metrics.json          validation metrics
      feature_schema.json   feature names/dtypes used at train time
      reference_stats.json  per-feature mean/std (drift baselines)
      metadata.json         training metadata (seed, epochs, timestamps, git)
  {REGISTRY_PATH}/<name>/STAGE   e.g. "champion=v3\\nchallenger=v4"

Writes are atomic-ish: artifacts land in a tmp dir then rename; STAGE updates
go through tmp+replace.
"""
from __future__ import annotations

import json
import logging
import shutil
import time
from pathlib import Path

from mlplatform.registry.base import ModelRegistry

logger = logging.getLogger("mlplatform.registry.local")

ARTIFACT_FILES = ("model.pt", "metrics.json", "feature_schema.json",
                  "reference_stats.json", "metadata.json")


class LocalRegistry(ModelRegistry):
    def __init__(self, root: str | Path):
        self.root = Path(root)
        self.root.mkdir(parents=True, exist_ok=True)

    # ── internals ─────────────────────────────────────────────────────────────
    def _model_dir(self, name: str) -> Path:
        return self.root / name

    def _stage_file(self, name: str) -> Path:
        return self._model_dir(name) / "STAGE"

    def _read_stages(self, name: str) -> dict[str, str]:
        p = self._stage_file(name)
        stages: dict[str, str] = {}
        if p.is_file():
            for line in p.read_text().splitlines():
                if "=" in line:
                    k, v = line.split("=", 1)
                    stages[k.strip()] = v.strip()
        return stages

    def _write_stages(self, name: str, stages: dict[str, str]) -> None:
        p = self._stage_file(name)
        tmp = p.with_suffix(".tmp")
        tmp.write_text("\n".join(f"{k}={v}" for k, v in sorted(stages.items())) + "\n")
        tmp.replace(p)

    def _versions(self, name: str) -> list[str]:
        d = self._model_dir(name)
        if not d.is_dir():
            return []
        return sorted((p.name for p in d.iterdir() if p.is_dir() and p.name.startswith("v")),
                      key=lambda v: int(v[1:]))

    def _next_version(self, name: str) -> str:
        vs = self._versions(name)
        return f"v{(int(vs[-1][1:]) + 1) if vs else 1}"

    # ── ABC ───────────────────────────────────────────────────────────────────
    def register(self, name: str, model_dir: str | Path, metrics: dict,
                 stage: str = "challenger", metadata: dict | None = None,
                 feature_schema: dict | None = None,
                 reference_stats: dict | None = None) -> str:
        if stage not in self.STAGES:
            raise ValueError(f"stage must be one of {self.STAGES}")
        model_dir = Path(model_dir)
        if not (model_dir / "model.pt").is_file():
            raise FileNotFoundError(f"{model_dir}/model.pt is required")

        version = self._next_version(name)
        dest = self._model_dir(name) / version
        tmp = self._model_dir(name) / f".tmp-{version}-{int(time.time()*1000)}"
        tmp.parent.mkdir(parents=True, exist_ok=True)

        meta = dict(metadata or {})
        meta.update({"name": name, "version": version, "registered_at": time.time(),
                     "registry": "local"})
        payload = {
            "metrics.json": metrics,
            "feature_schema.json": feature_schema or {},
            "reference_stats.json": reference_stats or {},
            "metadata.json": meta,
        }
        tmp.mkdir(parents=True, exist_ok=False)
        try:
            shutil.copy2(model_dir / "model.pt", tmp / "model.pt")
            for extra in model_dir.iterdir():
                if extra.name != "model.pt" and extra.is_file():
                    shutil.copy2(extra, tmp / extra.name)
            for fname, obj in payload.items():
                (tmp / fname).write_text(json.dumps(obj, indent=2, default=str))
            tmp.rename(dest)
        except Exception:
            shutil.rmtree(tmp, ignore_errors=True)
            raise

        stages = self._read_stages(name)
        # a fresh challenger demotes an existing challenger record; champion untouched
        stages[stage] = version
        if stage == "challenger" and "champion" not in stages:
            stages["champion"] = version  # first-ever registration becomes champion
        self._write_stages(name, stages)
        logger.info("registered %s %s (stage=%s)", name, version, stage)
        return version

    def load(self, name: str, stage: str | None = None,
             version: str | None = None) -> tuple[Path, dict]:
        if version is None:
            stages = self._read_stages(name)
            if stage is None:
                stage = "champion"
            version = stages.get(stage)
            if version is None:
                raise FileNotFoundError(f"no {stage} registered for '{name}'")
        dest = self._model_dir(name) / version
        if not dest.is_dir():
            raise FileNotFoundError(f"{name}/{version} not found in {self.root}")
        meta = json.loads((dest / "metadata.json").read_text()) if (dest / "metadata.json").is_file() else {}
        return dest, meta

    def set_stage(self, name: str, version: str, stage: str) -> None:
        if stage not in self.STAGES:
            raise ValueError(f"stage must be one of {self.STAGES}")
        if not (self._model_dir(name) / version).is_dir():
            raise FileNotFoundError(f"{name}/{version} not found")
        stages = self._read_stages(name)
        stages[stage] = version
        self._write_stages(name, stages)

    def list_models(self) -> dict:
        out: dict[str, dict] = {}
        for d in sorted(self.root.iterdir()) if self.root.is_dir() else []:
            if not d.is_dir() or d.name.startswith("."):
                continue
            versions = self._versions(d.name)
            if not versions:
                continue
            stages = self._read_stages(d.name)
            entry: dict[str, object] = {"versions": versions, "stages": stages}
            metrics_path = d / versions[-1] / "metrics.json"
            if metrics_path.is_file():
                entry["latest_metrics"] = json.loads(metrics_path.read_text())
            out[d.name] = entry
        return out

    def list(self) -> list[dict]:
        """Contract listing: list of per-model entries (same info as list_models)."""
        models = self.list_models()
        return [{"name": name, **info} for name, info in models.items()]

    def load_metrics(self, name: str, version: str) -> dict:
        p = self._model_dir(name) / version / "metrics.json"
        return json.loads(p.read_text()) if p.is_file() else {}
