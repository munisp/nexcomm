"""docai.api — FastAPI router for the document-AI pipeline.

Endpoints
─────────
  POST /api/v1/docai/analyse      multipart: document (+ optional selfie) →
                                  OCR + structure + authenticity verdict,
                                  unified contract matching the TS portal's
                                  /analyse expectations
  POST /api/v1/liveness/challenge issue a single-use challenge (nonce, 60s TTL)
  POST /api/v1/liveness/verify    submit responses/frames → pass/fail +
                                  anti-spoof + face-match scores
  GET  /api/v1/docai/health       capability report (which components live)

The pipeline function `run_document_pipeline` is also used by main.py's
legacy /analyse endpoint so both paths share one implementation.
"""
from __future__ import annotations

import base64
import logging
import os
import tempfile
import time
from typing import Optional

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from models.schemas import DocumentType

from . import liveness as lv
from .ocr import OcrUnavailable, PaddleOcrEngine, get_ocr_engine
from .structure import DoclingStructureParser, StructureUnavailable, get_structure_parser
from .vlm import DocumentVerifier, get_verifier

logger = logging.getLogger("docai.api")

UPLOAD_DIR = os.environ.get("UPLOAD_DIR", "/tmp/kyc-uploads")

_DOC_TYPE_ALIASES = {
    "national_id": DocumentType.NATIONAL_ID,
    "nin_slip": DocumentType.NIN_SLIP,
    "nin": DocumentType.NIN_SLIP,
    "bvn": DocumentType.BVN_PRINTOUT,
    "bvn_printout": DocumentType.BVN_PRINTOUT,
    "passport": DocumentType.INTERNATIONAL_PASSPORT,
    "international_passport": DocumentType.INTERNATIONAL_PASSPORT,
    "drivers_license": DocumentType.DRIVERS_LICENSE,
    "voters_card": DocumentType.VOTERS_CARD,
    "utility_bill": DocumentType.UTILITY_BILL,
    "bank_statement": DocumentType.BANK_STATEMENT,
    "cac_certificate": DocumentType.CAC_CERTIFICATE,
    "cac": DocumentType.CAC_CERTIFICATE,
    "tax_clearance": DocumentType.TAX_CLEARANCE,
}


def resolve_doc_type(hint: Optional[str]) -> DocumentType:
    return _DOC_TYPE_ALIASES.get((hint or "").strip().lower(),
                                 DocumentType.NATIONAL_ID)


# ── Shared pipeline (used by /api/v1/docai/analyse AND main.py /analyse) ───────

def run_document_pipeline(
    doc_path: str,
    document_type: DocumentType,
    *,
    ocr_engine: Optional[PaddleOcrEngine] = None,
    structure_parser: Optional[DoclingStructureParser] = None,
    verifier: Optional[DocumentVerifier] = None,
    selfie_path: Optional[str] = None,
    application_id: Optional[str] = None,
) -> dict:
    """OCR → authenticity verification → structure parse → score.

    Fail-closed honesty: when OCR is unavailable the pipeline returns
    success=False with a clear capability error (the portal surfaces this
    instead of a fabricated pass).
    """
    ocr_engine = ocr_engine or get_ocr_engine()
    structure_parser = structure_parser or get_structure_parser()
    verifier = verifier or get_verifier()

    pipeline_caps = {
        "ocr": ocr_engine.capability(),
        "structure": structure_parser.capability(),
        "verifier": verifier.capability(),
    }

    # 1. OCR — fail-closed when the engine is absent
    try:
        ocr = ocr_engine.extract_fields(doc_path, document_type)
    except OcrUnavailable as exc:
        return {
            "success": False,
            "application_id": application_id,
            "error": f"ocr_unavailable: {exc}",
            "pipeline": pipeline_caps,
        }

    # 2. Authenticity verification (heuristic or VLM — verdict says which)
    verification = verifier.verify(doc_path, document_type,
                                   ocr["raw_text"], ocr["fields"])

    # 3. Structured parse (Docling) — best effort, honest marker on failure
    try:
        docling_analysis = structure_parser.parse(doc_path)
    except StructureUnavailable as exc:
        docling_analysis = {"available": False, "parser": "docling",
                            "error": str(exc)}
    except Exception as exc:  # noqa: BLE001
        logger.warning("structure parse failed: %s", exc)
        docling_analysis = {"available": False, "parser": "docling",
                            "error": f"{type(exc).__name__}: {exc}"}

    # 4. Selfie analysis is ASYNC (face matcher is async); async callers
    # (the router and main.py /analyse) run `_analyse_selfie_async` after the
    # pipeline and merge the results. In sync contexts we report honestly.
    selfie_analysis: dict = {}
    passive_liveness: dict = {}
    if selfie_path:
        selfie_analysis = {"deferred": "selfie analysis runs in the async endpoint"}
        passive_liveness = {}

    # 5. Score + recommendation
    overall_score = round(
        0.5 * float(ocr["overall_confidence"]) + 0.5 * float(verification["confidence"]), 4)
    risk_flags = list(verification["issues"])
    if passive_liveness and passive_liveness.get("is_live") is False:
        risk_flags.append("selfie_spoof_suspected")
    if overall_score >= 0.8 and verification["is_authentic"] and not risk_flags:
        risk_level, recommendation = "low", "auto_approve"
    elif overall_score >= 0.55:
        risk_level, recommendation = "medium", "manual_review"
    else:
        risk_level, recommendation = "high", "manual_review"

    return {
        "success": True,
        "application_id": application_id,
        "ocr": ocr,
        "document_analysis": verification,
        "selfie_analysis": selfie_analysis,
        "passive_liveness": passive_liveness,
        "docling_analysis": docling_analysis,
        "overall_risk_level": risk_level,
        "overall_score": overall_score,
        "risk_flags": risk_flags,
        "recommendation": recommendation,
        "pipeline": pipeline_caps,
    }


async def _analyse_selfie_async(selfie_path: str, doc_path: str,
                                document_type: DocumentType) -> tuple[dict, dict]:
    """Async selfie analysis: face detection + doc-photo face match."""
    from liveness.face_matcher import get_face_matcher  # existing service module

    matcher = get_face_matcher()
    selfie_analysis: dict = {}
    passive_liveness: dict = {}
    try:
        emb = await matcher.extract_embedding(selfie_path)
        selfie_analysis["face_detected"] = bool(
            getattr(emb, "face_detected", True) if not isinstance(emb, dict)
            else emb.get("face_detected", True))
        selfie_analysis["embedding_extracted"] = True
    except Exception as exc:  # noqa: BLE001
        selfie_analysis = {"face_detected": None, "embedding_extracted": False,
                           "error": f"{type(exc).__name__}: {exc}"}
    # Face match against the document photo (photo-bearing IDs only)
    photo_docs = {DocumentType.NATIONAL_ID, DocumentType.INTERNATIONAL_PASSPORT,
                  DocumentType.DRIVERS_LICENSE, DocumentType.VOTERS_CARD,
                  DocumentType.NIN_SLIP}
    if document_type in photo_docs:
        try:
            result = await matcher.compare(selfie_path, doc_path)
            score = getattr(result, "similarity", None)
            if score is None and isinstance(result, dict):
                score = result.get("similarity")
            passive_liveness["face_match_score"] = score
            passive_liveness["face_match_passed"] = (
                score is not None and float(score) >= 0.6)
        except AttributeError:
            passive_liveness["face_match_score"] = None
            passive_liveness["face_match_note"] = "matcher has no compare() API"
        except Exception as exc:  # noqa: BLE001
            passive_liveness["face_match_score"] = None
            passive_liveness["face_match_error"] = f"{type(exc).__name__}: {exc}"
    return selfie_analysis, passive_liveness


# ── Request/response models ────────────────────────────────────────────────────

class LivenessVerifyRequest(BaseModel):
    challenge_id: str
    nonce: str
    responses: list[dict] = []        # [{action, passed, face_detected, latency_ms}]
    frames: list[str] = []            # base64 JPEG frames (anti-spoof input)
    selfie_frame: Optional[str] = None   # base64 JPEG for face-match
    document_photo_url: Optional[str] = None
    require_face_match: bool = False


# ── Router factory (dependency-injectable for tests) ───────────────────────────

def create_router(
    ocr_engine: Optional[PaddleOcrEngine] = None,
    structure_parser: Optional[DoclingStructureParser] = None,
    verifier: Optional[DocumentVerifier] = None,
    store: Optional[lv.ChallengeStore] = None,
    antispoof: Optional[lv.AntiSpoofModel] = None,
) -> APIRouter:
    ocr_engine = ocr_engine or get_ocr_engine()
    structure_parser = structure_parser or get_structure_parser()
    verifier = verifier or get_verifier()
    store = store or lv.get_store()
    antispoof = antispoof or lv.get_antispoof()

    router = APIRouter(tags=["docai"])

    @router.get("/api/v1/docai/health")
    async def docai_health():
        return {
            "status": "healthy",
            "service": "docai",
            "components": {
                "ocr": ocr_engine.capability(),
                "structure": structure_parser.capability(),
                "verifier": verifier.capability(),
                "liveness_store": getattr(store, "capability", lambda: {
                    "backend": getattr(store, "backend", "unknown")})(),
                "anti_spoof": antispoof.capability(),
            },
        }

    @router.post("/api/v1/docai/analyse")
    async def docai_analyse(
        file: UploadFile = File(...),
        selfie: Optional[UploadFile] = File(default=None),
        document_type_hint: Optional[str] = Form(default=None),
        application_id: Optional[str] = Form(default=None),
    ):
        os.makedirs(UPLOAD_DIR, exist_ok=True)
        doc_path = selfie_path = None
        try:
            doc_type = resolve_doc_type(document_type_hint)
            suffix = os.path.splitext(file.filename or "")[1] or ".jpg"
            fd, doc_path = tempfile.mkstemp(suffix=suffix, dir=UPLOAD_DIR)
            with os.fdopen(fd, "wb") as fh:
                fh.write(await file.read())
            if selfie is not None:
                fd, selfie_path = tempfile.mkstemp(suffix=".jpg", dir=UPLOAD_DIR)
                with os.fdopen(fd, "wb") as fh:
                    fh.write(await selfie.read())

            result = run_document_pipeline(
                doc_path, doc_type,
                ocr_engine=ocr_engine, structure_parser=structure_parser,
                verifier=verifier, application_id=application_id)
            # Selfie analysis needs the async matcher; done here when provided.
            if selfie_path and result.get("success"):
                try:
                    sa, pl = await _analyse_selfie_async(selfie_path, doc_path, doc_type)
                    result["selfie_analysis"] = sa
                    result["passive_liveness"] = pl
                    if pl.get("is_live") is False and "selfie_spoof_suspected" not in result["risk_flags"]:
                        result["risk_flags"].append("selfie_spoof_suspected")
                except Exception as exc:  # noqa: BLE001
                    result["selfie_analysis"] = {"error": f"{type(exc).__name__}: {exc}"}
            status = 200 if result.get("success") else 503
            return JSONResponse(status_code=status, content=result)
        finally:
            for p in (doc_path, selfie_path):
                if p:
                    try:
                        os.unlink(p)
                    except OSError:
                        pass

    @router.post("/api/v1/liveness/challenge")
    async def liveness_challenge(application_id: Optional[str] = None):
        record = lv.issue_challenge(application_id)
        await store.save(record)
        return {
            "success": True,
            **lv.public_challenge(record),
            "store_backend": getattr(store, "backend", "unknown"),
        }

    @router.post("/api/v1/liveness/verify")
    async def liveness_verify(req: LivenessVerifyRequest):
        record = await store.load(req.challenge_id)
        # Anti-spoof scoring (None when the ONNX model is absent — honest).
        spoof_score: Optional[float] = None
        frames_bgr = _decode_frames(req.frames)
        if frames_bgr:
            spoof_score = antispoof.score_frames(frames_bgr)
        # Optional face match (document photo vs selfie frame)
        face_match_score: Optional[float] = None
        if req.document_photo_url and req.selfie_frame:
            face_match_score = await _face_match_urls(
                req.document_photo_url, req.selfie_frame)
        verdict, updated = lv.evaluate_challenge(
            record, req.nonce, req.responses,
            spoof_score=spoof_score, face_match_score=face_match_score,
            require_face_match=req.require_face_match)
        if updated:
            await store.save(updated)
        status = 200 if verdict["passed"] else (410 if verdict["state"] == "expired" else 200)
        return JSONResponse(status_code=status, content={
            "success": True,
            "challenge_id": req.challenge_id,
            **verdict,
            "anti_spoof_available": antispoof.available,
            "capabilities": {
                "store_backend": getattr(store, "backend", "unknown"),
                "anti_spoof": antispoof.capability(),
            },
        })

    return router


def _decode_frames(frames_b64: list[str]) -> list:
    """base64 JPEG → BGR ndarray list; empty when cv2 is absent (anti-spoof
    then reports spoof_score=null rather than guessing)."""
    if not frames_b64:
        return []
    try:
        import cv2  # type: ignore
        import numpy as np
    except Exception:  # noqa: BLE001
        return []
    frames = []
    for b64 in frames_b64[:8]:  # cap work
        try:
            buf = np.frombuffer(base64.b64decode(b64), dtype=np.uint8)
            img = cv2.imdecode(buf, cv2.IMREAD_COLOR)
            if img is not None:
                frames.append(img)
        except Exception:  # noqa: BLE001
            continue
    return frames


async def _face_match_urls(document_photo_url: str, selfie_b64: str) -> Optional[float]:
    """Face-match document photo vs selfie frame via the existing matcher.
    None when the matcher/score is unavailable (honest)."""
    try:
        import httpx
        from liveness.face_matcher import get_face_matcher

        os.makedirs(UPLOAD_DIR, exist_ok=True)
        fd, doc_path = tempfile.mkstemp(suffix=".jpg", dir=UPLOAD_DIR)
        fd2, selfie_path = tempfile.mkstemp(suffix=".jpg", dir=UPLOAD_DIR)
        try:
            async with httpx.AsyncClient(timeout=30.0, follow_redirects=True) as client:
                resp = await client.get(document_photo_url)
                resp.raise_for_status()
            with os.fdopen(fd, "wb") as fh:
                fh.write(resp.content)
            with os.fdopen(fd2, "wb") as fh:
                fh.write(base64.b64decode(selfie_b64))
            matcher = get_face_matcher()
            result = await matcher.compare(selfie_path, doc_path)
            score = getattr(result, "similarity", None)
            if score is None and isinstance(result, dict):
                score = result.get("similarity")
            return float(score) if score is not None else None
        finally:
            for p in (doc_path, selfie_path):
                try:
                    os.unlink(p)
                except OSError:
                    pass
    except Exception as exc:  # noqa: BLE001
        logger.warning("face-match hook failed: %s", exc)
        return None


# Default module router (production wiring in main.py)
router = create_router()
