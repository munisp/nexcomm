"""
ContinuousTrainer — dataset fingerprint polling, challenger retraining via the
compute backend, and a champion/challenger promotion gate.

Promotion rule: a challenger is promoted only if it beats the champion's
registered validation metric by at least PROMOTION_MARGIN (direction-aware).
On promotion (or notable drift/failure) an alert is POSTed to
ALERT_WEBHOOK_URL via httpx (guarded; no-op when unset/unavailable).

CLI:
  python -m mlplatform.training.continuous --base-path /data/lakehouse --once
  python -m mlplatform.training.continuous --base-path /data/lakehouse --interval 3600

Closes audit A3 gap: no continuous retraining, no A/B or promotion discipline
existed anywhere in the repo.
"""
from __future__ import annotations

import argparse
import logging
import time
from pathlib import Path

from mlplatform.lakehouse.storage import fingerprint
from mlplatform.settings import get_settings

logger = logging.getLogger("mlplatform.training.continuous")

# contract registry name -> (validation metric key, direction)
METRIC_GATE = {
    "fraud": ("auc", "max"),
    "credit": ("rmse", "min"),
    "price": ("rmse", "min"),
    "graph": ("auc", "max"),
}

STATE_FILE = ".continuous_trainer_state.json"


def _train_one(model_name: str, base_path: str, registry_path: str,
               epochs: int, seed: int) -> dict:
    """Train one challenger in isolation (mapped onto the compute backend)."""
    from mlplatform.registry.local import LocalRegistry

    registry = LocalRegistry(registry_path)
    if model_name == "fraud":
        from mlplatform.training.train_fraud import train
        return {"name": model_name, **{k: v for k, v in train(base_path, registry=registry, epochs=epochs, seed=seed).items() if k != "model"}}
    if model_name == "credit":
        from mlplatform.training.train_credit import train
        return {"name": model_name, **{k: v for k, v in train(base_path, registry=registry, epochs=epochs, seed=seed).items() if k != "model"}}
    if model_name == "price":
        from mlplatform.training.train_price import train
        return {"name": model_name, **{k: v for k, v in train(base_path, registry=registry, epochs=epochs, seed=seed).items() if k != "model"}}
    if model_name == "graph":
        from mlplatform.training.train_gnn import train
        res = train(base_path, registry=registry, epochs=max(epochs * 2, 4), seed=seed)
        return {"name": model_name, "metrics": res["metrics"], "version": res.get("version")}
    raise ValueError(f"unknown model '{model_name}'")


class ContinuousTrainer:
    def __init__(self, base_path: str | Path, registry=None,
                 promotion_margin: float | None = None,
                 alert_webhook_url: str | None = None,
                 interval_seconds: int | None = None,
                 epochs: int = 3, seed: int = 42,
                 models: list[str] | None = None):
        settings = get_settings()
        self.base_path = Path(base_path)
        self.margin = promotion_margin if promotion_margin is not None else settings.promotion_margin
        self.webhook = alert_webhook_url or settings.alert_webhook_url
        self.interval = interval_seconds or settings.retrain_interval_seconds
        self.epochs = epochs
        self.seed = seed
        self.models = models or list(METRIC_GATE.keys())
        if registry is None:
            from mlplatform.registry import get_registry

            registry = get_registry()
        self.registry = registry
        self._state_path = self.base_path / STATE_FILE

    # ── state ─────────────────────────────────────────────────────────────────
    def _last_fingerprint(self) -> str:
        import json

        if self._state_path.is_file():
            return json.loads(self._state_path.read_text()).get("fingerprint", "")
        return ""

    def _save_fingerprint(self, fp: str) -> None:
        import json

        tmp = self._state_path.with_suffix(".tmp")
        tmp.write_text(json.dumps({"fingerprint": fp, "ts": time.time()}))
        tmp.replace(self._state_path)

    # ── alerting ──────────────────────────────────────────────────────────────
    def alert(self, event: str, payload: dict) -> bool:
        """POST to ALERT_WEBHOOK_URL (guarded httpx). Returns True if delivered."""
        if not self.webhook:
            logger.info("alert (no webhook configured): %s %s", event, payload)
            return False
        try:
            import httpx
        except ImportError:
            logger.warning("httpx unavailable; alert dropped: %s", event)
            return False
        try:
            resp = httpx.post(self.webhook, json={"event": event, **payload}, timeout=5.0)
            logger.info("alert %s delivered (HTTP %s)", event, resp.status_code)
            return resp.status_code < 400
        except Exception as exc:
            logger.warning("alert webhook failed: %s", exc)
            return False

    # ── promotion gate ────────────────────────────────────────────────────────
    def _beats_champion(self, name: str, challenger_metrics: dict) -> tuple[bool, str]:
        key, direction = METRIC_GATE[name]
        challenger_val = challenger_metrics.get(key)
        if challenger_val is None:
            return False, f"missing metric {key}"
        champion = self.registry.get_champion(name)
        if champion is None:
            return True, "no champion registered"
        champ_dir, champ_meta = champion
        import json

        mpath = champ_dir / "metrics.json"
        champ_metrics = json.loads(mpath.read_text()) if mpath.is_file() else {}
        champ_version = champ_meta.get("version", champ_dir.name)
        champ_val = champ_metrics.get(key)
        if champ_val is None:
            return True, f"champion {champ_version} lacks metric {key}"
        if champ_version == challenger_metrics.get("_version"):
            return False, "challenger is the champion"
        delta = challenger_val - champ_val if direction == "max" else champ_val - challenger_val
        ok = delta >= self.margin
        return ok, (f"{key}: champion={champ_val:.4f} challenger={challenger_val:.4f} "
                    f"margin={delta:+.4f} required={self.margin:+.4f}")

    # ── main loop ─────────────────────────────────────────────────────────────
    def check_once(self, force: bool = False) -> dict:
        """One pass: fingerprint → retrain challengers → promotion gate."""
        fp = fingerprint(self.base_path / "gold")
        last = self._last_fingerprint()
        if not force and fp == last:
            logger.info("gold fingerprint unchanged (%s…); skipping", fp[:8])
            return {"changed": False, "fingerprint": fp}
        logger.info("gold fingerprint changed (%s… → %s…); retraining challengers",
                    last[:8], fp[:8])

        from mlplatform.compute.backend import get_backend
        from mlplatform.settings import get_settings

        backend = get_backend()
        registry_path = str(get_settings().registry_path)
        try:
            results = backend.map(
                lambda name: _train_one(name, str(self.base_path), registry_path,
                                        self.epochs, self.seed),
                self.models,
            )
        finally:
            backend.shutdown()

        promotions = []
        for res in results:
            name = res["name"]
            metrics = res.get("metrics", {})
            version = res.get("version")
            metrics["_version"] = version
            promote, reason = self._beats_champion(name, metrics)
            logger.info("promotion gate %s v=%s: %s (%s)", name, version,
                        "PROMOTE" if promote else "keep champion", reason)
            if promote and version:
                self.registry.set_stage(name, version, "champion")
                promotions.append({"model": name, "version": version, "reason": reason})
                self.alert("model_promoted", {"model": name, "version": version,
                                              "reason": reason})
        self._save_fingerprint(fp)
        return {"changed": True, "fingerprint": fp, "promotions": promotions,
                "trained": [{"name": r["name"], "version": r.get("version"),
                             "metrics": r.get("metrics")} for r in results]}

    def run_forever(self) -> None:
        logger.info("continuous trainer loop: interval=%ds models=%s",
                    self.interval, self.models)
        while True:
            try:
                self.check_once()
            except Exception as exc:
                logger.exception("continuous pass failed: %s", exc)
                self.alert("continuous_trainer_error", {"error": str(exc)})
            time.sleep(self.interval)


def main(argv: list[str] | None = None) -> dict | None:
    parser = argparse.ArgumentParser(description="Continuous retraining with promotion gate")
    parser.add_argument("--base-path", "--lakehouse-path", "--data-dir", dest="base_path", required=True)
    parser.add_argument("--interval", type=int, default=None)
    parser.add_argument("--epochs", type=int, default=3)
    parser.add_argument("--margin", type=float, default=None)
    parser.add_argument("--once", action="store_true", help="single pass then exit")
    parser.add_argument("--force", action="store_true", help="ignore fingerprint cache")
    args = parser.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")
    trainer = ContinuousTrainer(args.base_path, promotion_margin=args.margin,
                                interval_seconds=args.interval, epochs=args.epochs)
    if args.once:
        result = trainer.check_once(force=args.force)
        print(result)
        return result
    trainer.run_forever()
    return None


if __name__ == "__main__":
    main()
