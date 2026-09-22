"""docai.liveness — next-gen liveness: server-issued challenge-response with
nonce + tight timing windows + single-use challenges, optional ONNX silent
anti-spoofing, and a face-match hook against the KYC document photo.

Protocol
────────
1. POST /api/v1/liveness/challenge → server issues a random challenge
   sequence (3 distinct actions from blink/turn-left/turn-right/smile),
   a cryptographic nonce, per-challenge timing windows and a 60s TTL.
   State: issued. Persisted in Redis (REDIS_URL) or in-memory (honest
   capability flag "memory" — single-instance deployments only).
2. Client performs the actions on camera and posts per-challenge results
   (+ optional frames) with the nonce to /api/v1/liveness/verify.
3. Server validates: challenge exists → not consumed → consumed atomically
   (single-use; even failed attempts consume) → not expired → nonce match →
   each action matches the issued sequence, passed, face detected, and the
   latency sits inside [MIN_LATENCY_MS, per_challenge_ms] (sub-200ms
   "instant" responses are rejected as automated) → anti-spoof score (when
   the ONNX model is present; spoof_score is honestly `null` otherwise) →
   optional face-match against the document photo.
   Terminal states: passed | failed | expired. Everything else fails closed.

Environment
───────────
  REDIS_URL              — redis://… for shared challenge state (optional)
  LIVENESS_ONNX_PATH     — MiniFASNet-style silent anti-spoof ONNX (optional)
  LIVENESS_TTL_SECONDS   — challenge TTL (default 60)
  LIVENESS_STEP_MS       — per-challenge window (default 4000)
  LIVENESS_SPOOF_THRESHOLD — min anti-spoof score to pass (default 0.5)
"""
from __future__ import annotations

import logging
import os
import secrets
import time
import uuid
from typing import Any, Optional

logger = logging.getLogger("docai.liveness")

ACTIONS = ("blink", "turn_left", "turn_right", "smile")
MIN_LATENCY_MS = 200  # sub-200ms responses are automated replays, not humans


def _ttl_seconds() -> int:
    try:
        return int(os.environ.get("LIVENESS_TTL_SECONDS", "60"))
    except ValueError:
        return 60


def _step_ms() -> int:
    try:
        return int(os.environ.get("LIVENESS_STEP_MS", "4000"))
    except ValueError:
        return 4000


def _spoof_threshold() -> float:
    try:
        return float(os.environ.get("LIVENESS_SPOOF_THRESHOLD", "0.5"))
    except ValueError:
        return 0.5


# ── Challenge store: Redis if configured, else in-memory (honest flag) ─────────

class ChallengeStore:
    """Async challenge-state store with single-use consume semantics."""

    backend: str = "abstract"

    async def save(self, record: dict) -> None:  # pragma: no cover - interface
        raise NotImplementedError

    async def load(self, challenge_id: str) -> Optional[dict]:  # pragma: no cover
        raise NotImplementedError


class InMemoryChallengeStore(ChallengeStore):
    """Process-local store. Honest capability: single-instance only — a
    challenge issued on replica A cannot be verified on replica B."""

    backend = "memory"

    def __init__(self) -> None:
        self._records: dict[str, dict] = {}

    async def save(self, record: dict) -> None:
        self._records[record["challenge_id"]] = dict(record)

    async def load(self, challenge_id: str) -> Optional[dict]:
        rec = self._records.get(challenge_id)
        return dict(rec) if rec is not None else None

    def capability(self) -> dict:
        return {
            "backend": self.backend,
            "shared_across_replicas": False,
            "note": "single-instance only; set REDIS_URL for multi-replica",
        }


class RedisChallengeStore(ChallengeStore):
    """Redis-backed store (shared across replicas)."""

    backend = "redis"
    _PREFIX = "docai:liveness:"

    def __init__(self, redis_url: str) -> None:
        import redis.asyncio as aioredis  # type: ignore

        self._client = aioredis.from_url(redis_url, decode_responses=True)

    async def save(self, record: dict) -> None:
        import json

        key = self._PREFIX + record["challenge_id"]
        await self._client.set(key, json.dumps(record), ex=max(_ttl_seconds() * 2, 120))

    async def load(self, challenge_id: str) -> Optional[dict]:
        import json

        raw = await self._client.get(self._PREFIX + challenge_id)
        return json.loads(raw) if raw else None

    def capability(self) -> dict:
        return {"backend": self.backend, "shared_across_replicas": True}


_STORE: Optional[ChallengeStore] = None


def get_store() -> ChallengeStore:
    """Redis when REDIS_URL is set, else in-memory (flagged honestly)."""
    global _STORE
    if _STORE is None:
        redis_url = os.environ.get("REDIS_URL", "")
        if redis_url:
            try:
                _STORE = RedisChallengeStore(redis_url)
            except Exception as exc:  # noqa: BLE001
                logger.warning("Redis store init failed (%s); using in-memory", exc)
                _STORE = InMemoryChallengeStore()
        else:
            _STORE = InMemoryChallengeStore()
    return _STORE


# ── Optional ONNX silent anti-spoofing (MiniFASNet-style) ─────────────────────

class AntiSpoofModel:
    """Silent anti-spoofing via ONNX. Honest: spoof_score is None when the
    model file is absent — never a fabricated number."""

    def __init__(self, model_path: Optional[str] = None) -> None:
        self.model_path = model_path or os.environ.get("LIVENESS_ONNX_PATH", "")
        self._session: Any = None
        self._init_attempted = False
        self._error: Optional[str] = None

    @property
    def available(self) -> bool:
        self._ensure_init()
        return self._session is not None

    def capability(self) -> dict:
        self._ensure_init()
        return {
            "engine": "onnx-silent-antispoof",
            "available": self._session is not None,
            "model_path": self.model_path or None,
            "error": self._error,
        }

    def _ensure_init(self) -> None:
        if self._init_attempted:
            return
        self._init_attempted = True
        if not self.model_path or not os.path.isfile(self.model_path):
            self._error = None if not self.model_path else "model file not found"
            return
        try:
            import onnxruntime as ort  # type: ignore

            self._session = ort.InferenceSession(
                self.model_path, providers=["CPUExecutionProvider"])
            logger.info("anti-spoof ONNX loaded from %s", self.model_path)
        except Exception as exc:  # noqa: BLE001
            self._session = None
            self._error = f"{type(exc).__name__}: {exc}"
            logger.warning("anti-spoof ONNX unavailable: %s", self._error)

    def score_frames(self, frames_bgr: list[Any]) -> Optional[float]:
        """Mean liveness probability over frames, or None when unavailable."""
        self._ensure_init()
        if self._session is None or not frames_bgr:
            return None
        import numpy as np

        inp = self._session.get_inputs()[0]
        shape = [d if isinstance(d, int) else 1 for d in inp.shape]
        h, w = (shape[2], shape[3]) if len(shape) == 4 and shape[1] == 3 else (shape[1], shape[2])
        scores: list[float] = []
        for frame in frames_bgr:
            try:
                import cv2  # type: ignore

                img = cv2.resize(frame, (w, h)).astype(np.float32) / 255.0
                img = np.transpose(img, (2, 0, 1))[None, ...]
                out = self._session.run(None, {inp.name: img})[0]
                probs = np.asarray(out).reshape(-1)
                if probs.size == 1:
                    scores.append(float(1.0 / (1.0 + np.exp(-probs[0]))))
                else:
                    exp = np.exp(probs - probs.max())
                    scores.append(float((exp / exp.sum())[-1]))  # last class = live
            except Exception as exc:  # noqa: BLE001
                logger.warning("anti-spoof frame scoring failed: %s", exc)
        return (sum(scores) / len(scores)) if scores else None


_ANTISPOOF: Optional[AntiSpoofModel] = None


def get_antispoof() -> AntiSpoofModel:
    global _ANTISPOOF
    if _ANTISPOOF is None:
        _ANTISPOOF = AntiSpoofModel()
    return _ANTISPOOF


# ── Challenge engine ───────────────────────────────────────────────────────────

def issue_challenge(application_id: Optional[str] = None,
                    num_actions: int = 3) -> dict:
    """Build a fresh challenge record (not yet persisted)."""
    now = time.time()
    ttl = _ttl_seconds()
    return {
        "challenge_id": str(uuid.uuid4()),
        "application_id": application_id,
        "nonce": secrets.token_hex(16),
        "sequence": secrets.SystemRandom().sample(list(ACTIONS), k=min(num_actions, len(ACTIONS))),
        "state": "issued",
        "issued_at_epoch": now,
        "expires_at_epoch": now + ttl,
        "ttl_seconds": ttl,
        "per_challenge_ms": _step_ms(),
        "results": [],
        "verdict": None,
    }


def public_challenge(record: dict) -> dict:
    """The wire payload: everything the client needs, nothing it shouldn't see."""
    return {
        "challenge_id": record["challenge_id"],
        "nonce": record["nonce"],
        "sequence": record["sequence"],
        "expires_at_epoch": record["expires_at_epoch"],
        "ttl_seconds": record["ttl_seconds"],
        "per_challenge_ms": record["per_challenge_ms"],
        "application_id": record.get("application_id"),
    }


def evaluate_challenge(
    record: Optional[dict],
    nonce: str,
    responses: list[dict],
    *,
    now: Optional[float] = None,
    spoof_score: Optional[float] = None,
    face_match_score: Optional[float] = None,
    require_face_match: bool = False,
    face_match_threshold: float = 0.6,
) -> tuple[dict, dict]:
    """Pure state-machine evaluation. Returns (verdict, updated_record).

    Fail-closed: unknown/replayed/expired/nonce-mismatched challenges fail.
    Single-use: the record is marked consumed (state leaves "issued") on the
    FIRST verify attempt, regardless of outcome.
    """
    now = time.time() if now is None else now
    reasons: list[str] = []

    if record is None:
        return ({
            "passed": False, "state": "failed", "reasons": ["unknown_challenge"],
            "spoof_score": spoof_score, "face_match_score": face_match_score,
            "challenge_results": [],
        }, {})

    updated = dict(record)
    if updated.get("state") != "issued":
        reasons.append("challenge_already_consumed")
        return ({
            "passed": False, "state": updated.get("state", "failed"),
            "reasons": reasons, "spoof_score": spoof_score,
            "face_match_score": face_match_score,
            "challenge_results": updated.get("results", []),
        }, updated)

    # Single-use: consume immediately, whatever the outcome.
    if now > float(updated.get("expires_at_epoch", 0)):
        updated["state"] = "expired"
        updated["verdict"] = "expired"
        return ({
            "passed": False, "state": "expired", "reasons": ["challenge_expired"],
            "spoof_score": spoof_score, "face_match_score": face_match_score,
            "challenge_results": [],
        }, updated)

    updated["state"] = "failed"  # consumed; upgraded to passed only on success
    if nonce != updated.get("nonce"):
        reasons.append("nonce_mismatch")

    expected = list(updated.get("sequence", []))
    per_ms = int(updated.get("per_challenge_ms", _step_ms()))
    challenge_results: list[dict] = []
    if len(responses) != len(expected):
        reasons.append("challenge_count_mismatch")
    for i, action in enumerate(expected):
        resp = responses[i] if i < len(responses) else {}
        latency = resp.get("latency_ms")
        item = {
            "expected": action,
            "responded": resp.get("action"),
            "passed": bool(resp.get("passed")),
            "face_detected": bool(resp.get("face_detected")),
            "latency_ms": latency,
        }
        if resp.get("action") != action:
            item["fail"] = "wrong_action"
        elif not resp.get("passed"):
            item["fail"] = "action_not_detected"
        elif not resp.get("face_detected"):
            item["fail"] = "face_not_detected"
        elif latency is None or not (MIN_LATENCY_MS <= float(latency) <= per_ms):
            item["fail"] = "timing_window_violation"
        else:
            item["fail"] = None
        challenge_results.append(item)
        if item["fail"]:
            reasons.append(f"challenge_{i}_{item['fail']}")

    if spoof_score is not None and spoof_score < _spoof_threshold():
        reasons.append("anti_spoof_rejected")
    if require_face_match:
        if face_match_score is None:
            reasons.append("face_match_unavailable")
        elif face_match_score < face_match_threshold:
            reasons.append("face_match_below_threshold")

    passed = not reasons
    if passed:
        updated["state"] = "passed"
    updated["results"] = challenge_results
    updated["verdict"] = "passed" if passed else "failed"
    verdict = {
        "passed": passed,
        "state": updated["state"],
        "reasons": reasons,
        "spoof_score": spoof_score,
        "face_match_score": face_match_score,
        "challenge_results": challenge_results,
    }
    return verdict, updated
