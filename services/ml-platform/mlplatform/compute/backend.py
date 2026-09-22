"""
Distributed compute backend abstraction.

  - DistributedBackend(ABC): map(fn, items) -> list
  - RayBackend: real Ray remote tasks, honours RAY_ADDRESS (import-guarded)
  - LocalBackend: concurrent.futures ThreadPoolExecutor (threads because the
    hot paths release the GIL inside torch/numpy; a ProcessPoolExecutor variant
    is available for pure-Python workloads)
  - get_backend(): auto-selects Ray when importable (and RAY_ADDRESS set or
    local ray start succeeds), else LocalBackend.

Closes audit A3 gap: Ray was commented-out/dormant everywhere in the repo.
"""
from __future__ import annotations

import logging
import os
from abc import ABC, abstractmethod
from concurrent.futures import ProcessPoolExecutor, ThreadPoolExecutor
from typing import Any, Callable, Iterable, TypeVar

logger = logging.getLogger("mlplatform.compute")

T = TypeVar("T")
R = TypeVar("R")


class DistributedBackend(ABC):
    """Minimal map-based distributed compute contract."""

    name: str = "abstract"

    @abstractmethod
    def map(self, fn: Callable[[T], R], items: Iterable[T]) -> list[R]:
        """Apply fn to each item, preserving order."""

    @abstractmethod
    def shutdown(self) -> None:
        ...


class LocalBackend(DistributedBackend):
    """Threaded local backend (default). Really parallelises map()."""

    name = "local"

    def __init__(self, max_workers: int | None = None, use_processes: bool = False):
        self.max_workers = max_workers or min(4, (os.cpu_count() or 2))
        self._executor_cls = ProcessPoolExecutor if use_processes else ThreadPoolExecutor
        self._executor = None

    def _pool(self):
        if self._executor is None:
            self._executor = self._executor_cls(max_workers=self.max_workers)
        return self._executor

    def map(self, fn: Callable[[T], R], items: Iterable[T]) -> list[R]:
        items = list(items)
        if not items:
            return []
        return list(self._pool().map(fn, items))

    def shutdown(self) -> None:
        if self._executor is not None:
            self._executor.shutdown(wait=True)
            self._executor = None

    def __del__(self):  # best-effort cleanup
        try:
            self.shutdown()
        except Exception:
            pass


class RayBackend(DistributedBackend):
    """Ray backend. Requires `ray` importable; connects to RAY_ADDRESS or starts local."""

    name = "ray"

    def __init__(self, address: str | None = None):
        import ray  # noqa: F401 — ImportError propagates to caller by design

        self._ray = ray
        init_kwargs: dict[str, Any] = {"ignore_reinit_error": True, "log_to_driver": False}
        if address:
            init_kwargs["address"] = address
        else:
            init_kwargs["num_cpus"] = min(4, (os.cpu_count() or 2))
        if not ray.is_initialized():
            ray.init(**init_kwargs)
        logger.info("RayBackend initialised (address=%s)", address or "local")

    def map(self, fn: Callable[[T], R], items: Iterable[T]) -> list[R]:
        ray = self._ray
        remote_fn = ray.remote(fn)
        refs = [remote_fn.remote(item) for item in items]
        return list(ray.get(refs))

    def shutdown(self) -> None:
        if self._ray.is_initialized():
            self._ray.shutdown()


def get_backend(prefer_ray: bool = True) -> DistributedBackend:
    """Auto-select: Ray when importable (and reachable), else LocalBackend."""
    from mlplatform.settings import get_settings

    settings = get_settings()
    address = settings.ray_address or os.environ.get("RAY_ADDRESS")
    if prefer_ray:
        try:
            return RayBackend(address=address)
        except ImportError:
            logger.info("ray not importable; using LocalBackend")
        except Exception as exc:
            logger.warning("ray init failed (%s); using LocalBackend", exc)
    return LocalBackend()
