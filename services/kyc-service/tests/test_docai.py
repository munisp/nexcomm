"""Protocol-level tests for the docai pipeline — no heavy models required.

Covers: challenge state machine (issued → passed/failed/expired), nonce
single-use / replay rejection, timing windows, verdict contract shape,
VLM provider fallback honesty, and the unified /analyse verdict contract.

Run: python -m pytest services/kyc-service/tests/test_docai.py
(pytest optional: `python tests/test_docai.py` also works)
"""
from __future__ import annotations

import asyncio
import os
import sys
import time
from pathlib import Path

# Make the service importable when run from anywhere
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ.pop("VLM_BASE_URL", None)
os.environ.pop("VLM_MODEL", None)
os.environ.pop("REDIS_URL", None)

from docai import liveness as lv  # noqa: E402
from docai.api import create_router, run_document_pipeline  # noqa: E402
from docai.vlm import (  # noqa: E402
    HeuristicDocumentVerifier,
    HttpVLMVerifier,
    get_verifier,
    validate_mrz,
)
from models.schemas import DocumentType  # noqa: E402


# ── Stub engines (no heavy models) ────────────────────────────────────────────

class StubOcrEngine:
    """Deterministic OCR stand-in producing REAL parsing output shape."""

    def __init__(self, raw_text: str):
        self._raw = raw_text

    def capability(self):
        return {"engine": "stub", "available": True}

    def extract_fields(self, path, document_type):
        from docai.ocr import _parse_fields
        fields = _parse_fields(self._raw, document_type)
        overall = sum(f["confidence"] for f in fields) / len(fields) if fields else 0.0
        return {
            "document_type": document_type.value,
            "fields": fields,
            "raw_text": self._raw,
            "overall_confidence": round(overall, 4),
            "processing_time_ms": 1,
            "language_detected": "en",
            "engine": "stub",
        }


class UnavailableOcr:
    def capability(self):
        return {"engine": "paddleocr", "available": False, "error": "not installed"}

    def extract_fields(self, path, document_type):
        from docai.ocr import OcrUnavailable
        raise OcrUnavailable("not installed")


class StubStructure:
    def capability(self):
        return {"engine": "docling", "available": True}

    def parse(self, path):
        return {"available": True, "parser": "stub", "sections": [],
                "tables": [], "text": "", "page_count": 1,
                "processing_time_ms": 1}


NIN_TEXT = (
    "NATIONAL IDENTIFICATION NUMBER\n"
    "NIN: 12345678901\n"
    "Name: ADEYEMI OLUWASEUN\n"
    "Date of Birth: 15/03/1990\n"
    "Tracking ID: ABC123\n"
)


# ── Challenge state machine ───────────────────────────────────────────────────

def _good_responses(record):
    return [
        {"action": a, "passed": True, "face_detected": True, "latency_ms": 1200}
        for a in record["sequence"]
    ]


def test_issue_challenge_shape():
    rec = lv.issue_challenge("app-1")
    pub = lv.public_challenge(rec)
    assert rec["state"] == "issued"
    assert len(rec["nonce"]) == 32
    assert len(rec["sequence"]) == 3 and len(set(rec["sequence"])) == 3
    assert all(a in lv.ACTIONS for a in rec["sequence"])
    assert rec["expires_at_epoch"] - rec["issued_at_epoch"] == 60
    assert pub["expires_at_epoch"] == rec["expires_at_epoch"]
    # nonce must never leak anything; public payload carries it for the client
    assert pub["nonce"] == rec["nonce"]


def test_challenge_pass():
    rec = lv.issue_challenge("app-1")
    verdict, updated = lv.evaluate_challenge(rec, rec["nonce"], _good_responses(rec))
    assert verdict["passed"] is True
    assert updated["state"] == "passed"
    assert verdict["reasons"] == []
    assert len(verdict["challenge_results"]) == 3
    assert verdict["spoof_score"] is None  # no ONNX model in tests — honest null


def test_challenge_single_use_replay_rejected():
    rec = lv.issue_challenge("app-1")
    verdict1, updated = lv.evaluate_challenge(rec, rec["nonce"], _good_responses(rec))
    assert verdict1["passed"] is True
    # Replay with the SAME nonce on the consumed record must fail closed
    verdict2, _ = lv.evaluate_challenge(updated, rec["nonce"], _good_responses(rec))
    assert verdict2["passed"] is False
    assert "challenge_already_consumed" in verdict2["reasons"]


def test_challenge_wrong_nonce_fails_and_consumes():
    rec = lv.issue_challenge("app-1")
    verdict, updated = lv.evaluate_challenge(rec, "0" * 32, _good_responses(rec))
    assert verdict["passed"] is False
    assert "nonce_mismatch" in verdict["reasons"]
    assert updated["state"] == "failed"  # consumed even though it failed
    verdict2, _ = lv.evaluate_challenge(updated, rec["nonce"], _good_responses(rec))
    assert verdict2["passed"] is False  # correct nonce too late — single-use


def test_challenge_expiry():
    rec = lv.issue_challenge("app-1")
    future = rec["expires_at_epoch"] + 1
    verdict, updated = lv.evaluate_challenge(rec, rec["nonce"],
                                             _good_responses(rec), now=future)
    assert verdict["passed"] is False
    assert verdict["state"] == "expired"
    assert updated["state"] == "expired"
    assert "challenge_expired" in verdict["reasons"]


def test_challenge_timing_window():
    rec = lv.issue_challenge("app-1")
    too_fast = [{"action": a, "passed": True, "face_detected": True,
                 "latency_ms": 50} for a in rec["sequence"]]
    verdict, _ = lv.evaluate_challenge(rec, rec["nonce"], too_fast)
    assert verdict["passed"] is False
    assert any("timing_window_violation" in r for r in verdict["reasons"])

    rec2 = lv.issue_challenge("app-2")
    too_slow = [{"action": a, "passed": True, "face_detected": True,
                 "latency_ms": 99999} for a in rec2["sequence"]]
    verdict2, _ = lv.evaluate_challenge(rec2, rec2["nonce"], too_slow)
    assert verdict2["passed"] is False


def test_challenge_wrong_action_and_missing_face():
    rec = lv.issue_challenge("app-1")
    bad = [{"action": "spin", "passed": True, "face_detected": True,
            "latency_ms": 1000} for _ in rec["sequence"]]
    verdict, _ = lv.evaluate_challenge(rec, rec["nonce"], bad)
    assert verdict["passed"] is False
    assert any("wrong_action" in r for r in verdict["reasons"])

    rec2 = lv.issue_challenge("app-2")
    noface = [{"action": a, "passed": True, "face_detected": False,
               "latency_ms": 1000} for a in rec2["sequence"]]
    verdict2, _ = lv.evaluate_challenge(rec2, rec2["nonce"], noface)
    assert verdict2["passed"] is False
    assert any("face_not_detected" in r for r in verdict2["reasons"])


def test_unknown_challenge_fails_closed():
    verdict, updated = lv.evaluate_challenge(None, "x" * 32, [])
    assert verdict["passed"] is False
    assert "unknown_challenge" in verdict["reasons"]
    assert updated == {}


def test_spoof_threshold_and_face_match_requirement():
    rec = lv.issue_challenge("app-1")
    verdict, _ = lv.evaluate_challenge(rec, rec["nonce"], _good_responses(rec),
                                       spoof_score=0.1)
    assert verdict["passed"] is False
    assert "anti_spoof_rejected" in verdict["reasons"]

    rec2 = lv.issue_challenge("app-2")
    verdict2, _ = lv.evaluate_challenge(rec2, rec2["nonce"], _good_responses(rec2),
                                        spoof_score=0.9, require_face_match=True,
                                        face_match_score=None)
    assert verdict2["passed"] is False
    assert "face_match_unavailable" in verdict2["reasons"]

    rec3 = lv.issue_challenge("app-3")
    verdict3, _ = lv.evaluate_challenge(rec3, rec3["nonce"], _good_responses(rec3),
                                        spoof_score=0.9, require_face_match=True,
                                        face_match_score=0.8)
    assert verdict3["passed"] is True


def test_inmemory_store_roundtrip_and_capability():
    store = lv.InMemoryChallengeStore()
    assert store.capability()["shared_across_replicas"] is False
    rec = lv.issue_challenge("app-x")
    loop = asyncio.new_event_loop()
    try:
        loop.run_until_complete(store.save(rec))
        loaded = loop.run_until_complete(store.load(rec["challenge_id"]))
        missing = loop.run_until_complete(store.load("nope"))
    finally:
        loop.close()
    assert loaded is not None and loaded["nonce"] == rec["nonce"]
    assert missing is None


# ── Verifier contract ─────────────────────────────────────────────────────────

def test_heuristic_verdict_contract():
    v = HeuristicDocumentVerifier()
    verdict = v.verify("/nonexistent.png", DocumentType.NIN_SLIP, NIN_TEXT,
                       [{"field_name": "nin", "value": "12345678901"}])
    for key in ("is_authentic", "confidence", "verifier", "issues", "checks",
                "vlm_analysis", "expiry_valid", "tampering_detected",
                "processing_time_ms"):
        assert key in verdict, key
    assert verdict["verifier"] == "heuristic"
    assert verdict["confidence"] <= 0.75  # honest cap
    assert verdict["is_authentic"] is True


def test_heuristic_expiry_logic():
    v = HeuristicDocumentVerifier()
    text = NIN_TEXT + "\nExpiry: 01/01/2020\n"
    verdict = v.verify("/x.png", DocumentType.NIN_SLIP, text,
                       [{"field_name": "nin", "value": "12345678901"},
                        {"field_name": "expiry_date", "value": "01/01/2020"}])
    assert verdict["expiry_valid"] is False
    assert "document_expired" in verdict["issues"]
    assert verdict["is_authentic"] is False


def test_heuristic_missing_keywords():
    v = HeuristicDocumentVerifier()
    verdict = v.verify("/x.png", DocumentType.NIN_SLIP, "random junk text", [])
    assert "missing_expected_document_keywords" in verdict["issues"]
    assert verdict["is_authentic"] is False


def test_mrz_checksum():
    # ICAO 9303 example-style line with valid check digits computed at runtime
    from docai.vlm import _icao_check_digit
    doc_no = "A12345678"
    dob = "900315"
    expiry = "301231"
    line2 = (doc_no + str(_icao_check_digit(doc_no)) + "NGA"
             + dob + str(_icao_check_digit(dob)) + "M"
             + expiry + str(_icao_check_digit(expiry)) + "<<<<<<<<<<<<<<04")
    line2 = line2[:43]
    composite = line2[0:10] + line2[13:20] + line2[21:43]
    line2 += str(_icao_check_digit(composite))
    assert len(line2) == 44
    ok, issues = validate_mrz(line2)
    assert ok, issues
    bad = line2[:9] + str((int(line2[9]) + 1) % 10) + line2[10:]
    ok2, issues2 = validate_mrz(bad)
    assert not ok2 and "mrz_doc_number_checksum" in issues2


def test_vlm_provider_fallback_honesty():
    # Unreachable endpoint → verdict degrades to heuristic with explicit marker
    img = Path(os.environ.get("TMPDIR", "/tmp")) / "docai_vlm_test.png"
    img.write_bytes(b"\x89PNG\r\n\x1a\nfake")
    v = HttpVLMVerifier(base_url="http://127.0.0.1:9", model="qwen-vl", timeout=2.0)
    assert v.configured
    try:
        verdict = v.verify(str(img), DocumentType.NIN_SLIP, NIN_TEXT,
                           [{"field_name": "nin", "value": "12345678901"}])
    finally:
        img.unlink(missing_ok=True)
    assert verdict["verifier"] == "heuristic"
    assert "vlm_unavailable" in verdict["issues"]
    assert "vlm" in verdict["checks"] and "error" in verdict["checks"]["vlm"]

    # Unconfigured → heuristic with marker
    v2 = HttpVLMVerifier(base_url="", api_key="", model="")
    verdict2 = v2.verify("/x.png", DocumentType.NIN_SLIP, NIN_TEXT, [])
    assert verdict2["verifier"] == "heuristic"
    assert "vlm_not_configured" in verdict2["issues"]

    # get_verifier() with no env → heuristic
    assert get_verifier().name == "heuristic"


# ── Pipeline + router contract ────────────────────────────────────────────────

def test_pipeline_contract_shape(tmp_path=None):
    doc = Path(os.environ.get("TMPDIR", "/tmp")) / "docai_test_doc.png"
    doc.write_bytes(b"\x89PNG\r\n\x1a\n")  # content irrelevant for stub OCR
    try:
        result = run_document_pipeline(
            str(doc), DocumentType.NIN_SLIP,
            ocr_engine=StubOcrEngine(NIN_TEXT),  # type: ignore[arg-type]
            structure_parser=StubStructure(),  # type: ignore[arg-type]
            verifier=HeuristicDocumentVerifier(),
            application_id="app-1")
    finally:
        doc.unlink(missing_ok=True)
    assert result["success"] is True
    # Portal contract keys (server/routers/kycAnalysisRouter.ts expectations)
    for key in ("success", "ocr", "document_analysis", "selfie_analysis",
                "passive_liveness", "docling_analysis", "overall_risk_level",
                "overall_score", "risk_flags", "recommendation"):
        assert key in result, key
    assert result["document_analysis"]["verifier"] == "heuristic"
    assert result["recommendation"] in ("auto_approve", "manual_review")
    assert result["pipeline"]["ocr"]["engine"] == "stub"


def test_pipeline_fails_closed_when_ocr_unavailable():
    result = run_document_pipeline(
        "/nonexistent.png", DocumentType.NIN_SLIP,
        ocr_engine=UnavailableOcr(),  # type: ignore[arg-type]
        structure_parser=StubStructure(),  # type: ignore[arg-type]
        verifier=HeuristicDocumentVerifier())
    assert result["success"] is False
    assert "ocr_unavailable" in result["error"]
    assert result["pipeline"]["ocr"]["available"] is False


def test_router_liveness_endpoints():
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    app = FastAPI()
    app.include_router(create_router(
        ocr_engine=StubOcrEngine(NIN_TEXT),  # type: ignore[arg-type]
        structure_parser=StubStructure(),  # type: ignore[arg-type]
        verifier=HeuristicDocumentVerifier(),
        store=lv.InMemoryChallengeStore()))
    client = TestClient(app)

    health = client.get("/api/v1/docai/health")
    assert health.status_code == 200
    comps = health.json()["components"]
    assert comps["verifier"]["verifier"] == "heuristic"
    assert comps["liveness_store"]["backend"] == "memory"
    assert comps["anti_spoof"]["available"] is False  # no ONNX in tests

    issued = client.post("/api/v1/liveness/challenge",
                         params={"application_id": "app-1"}).json()
    assert issued["success"] and issued["store_backend"] == "memory"
    assert len(issued["sequence"]) == 3 and issued["nonce"]

    responses = [{"action": a, "passed": True, "face_detected": True,
                  "latency_ms": 1500} for a in issued["sequence"]]
    v = client.post("/api/v1/liveness/verify", json={
        "challenge_id": issued["challenge_id"], "nonce": issued["nonce"],
        "responses": responses}).json()
    assert v["passed"] is True
    assert v["spoof_score"] is None  # honest: no anti-spoof model
    assert v["anti_spoof_available"] is False

    # Replay the same challenge → fail closed
    v2 = client.post("/api/v1/liveness/verify", json={
        "challenge_id": issued["challenge_id"], "nonce": issued["nonce"],
        "responses": responses}).json()
    assert v2["passed"] is False
    assert "challenge_already_consumed" in v2["reasons"]

    # Unknown challenge → fail closed
    v3 = client.post("/api/v1/liveness/verify", json={
        "challenge_id": "does-not-exist", "nonce": "x" * 32,
        "responses": []}).json()
    assert v3["passed"] is False


def test_router_analyse_multipart():
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    app = FastAPI()
    app.include_router(create_router(
        ocr_engine=StubOcrEngine(NIN_TEXT),  # type: ignore[arg-type]
        structure_parser=StubStructure(),  # type: ignore[arg-type]
        verifier=HeuristicDocumentVerifier(),
        store=lv.InMemoryChallengeStore()))
    client = TestClient(app)
    resp = client.post(
        "/api/v1/docai/analyse",
        files={"file": ("nin.png", b"\x89PNG\r\n\x1a\nfake", "image/png")},
        data={"document_type_hint": "nin_slip", "application_id": "app-9"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["success"] is True
    assert body["application_id"] == "app-9"
    field_names = {f["field_name"] for f in body["ocr"]["fields"]}
    assert "nin" in field_names
    assert body["overall_risk_level"] in ("low", "medium", "high")


if __name__ == "__main__":
    # Minimal runner for environments without pytest
    fns = [(n, f) for n, f in sorted(globals().items())
           if n.startswith("test_") and callable(f)]
    failed = 0
    for name, fn in fns:
        try:
            fn()
            print(f"PASS {name}")
        except Exception as exc:  # noqa: BLE001
            failed += 1
            import traceback
            traceback.print_exc(limit=3)
            print(f"FAIL {name}: {exc}")
    print(f"\n{len(fns) - failed}/{len(fns)} passed")
    sys.exit(1 if failed else 0)
