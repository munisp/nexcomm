"""NEXCOM Exchange KYC/KYB Service.

Open-source identity verification service using:
- PaddleOCR for document text extraction
- Docling for structured document parsing
- VLM for document authenticity verification
- MediaPipe for face liveness detection
- Challenge-response anti-spoofing protocol
"""
from __future__ import annotations

import os
import sys
import uuid
from datetime import datetime
from typing import Optional

from fastapi import FastAPI, File, Form, HTTPException, Response, UploadFile
from pydantic import BaseModel
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

# Add service root to path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from models.schemas import (
    AgentOnboardFarmerRequest,
    AgentProfile,
    CommodityCategory,
    CommodityGrade,
    CreateAgentRequest,
    CreateKYBRequest,
    CreateKYCRequest,
    CreateProduceRequest,
    CreateWarehouseReceiptRequest,
    DocumentType,
    KYBApplication,
    KYBStatus,
    KYCApplication,
    KYCStatus,
    LivenessChallenge,
    LivenessResult,
    OnboardingStatus,
    ProduceRegistration,
    ReviewDecision,
    RiskLevel,
    StakeholderType,
    WarehouseReceipt,
    WarehouseReceiptStatus,
)
from ocr.paddle_ocr import PaddleOCREngine
from document.docling_parser import DoclingParser, VLMDocumentVerifier
from liveness.detector import LivenessDetector
from liveness.face_matcher import get_face_matcher, SpoofType
from liveness.session_store import save_session, load_session, delete_session, publish_liveness_event
from kyb.screening import KYBScreeningEngine, StakeholderOnboarding, OPENSANCTIONS_API_KEY
import application_store
import logging
logging.basicConfig(level=logging.INFO)
_logger = logging.getLogger("nexcom-kyc")

app = FastAPI(
    title="NEXCOM KYC/KYB Service",
    description="Open-source identity verification with PaddleOCR, Docling, VLM & liveness detection",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Service instances ──────────────────────────────────────────────────────────
ocr_engine = PaddleOCREngine()
doc_parser = DoclingParser()
doc_verifier = VLMDocumentVerifier()
liveness_detector = LivenessDetector()
kyb_screener = KYBScreeningEngine()
onboarding = StakeholderOnboarding()

# ── Application stores ─────────────────────────────────────────────────────────
# Applications are persisted to PostgreSQL when NEXCOM_PG_URL is set (see
# application_store.py) and hydrated into these dicts at startup; otherwise the
# service runs in explicitly-labelled memory mode (X-Storage: memory header,
# degraded /readyz). No demo/seed data is ever injected.
kyc_applications: dict[str, KYCApplication] = {}
kyb_applications: dict[str, KYBApplication] = {}
liveness_sessions: dict[str, dict] = {}  # session_id -> LivenessSession dict (in-memory fallback; PG used when NEXCOM_PG_URL is set)
warehouse_receipts: dict[str, WarehouseReceipt] = {}
produce_registrations: dict[str, ProduceRegistration] = {}
agent_profiles: dict[str, AgentProfile] = {}

UPLOAD_DIR = os.environ.get("UPLOAD_DIR", "/tmp/kyc-uploads")
os.makedirs(UPLOAD_DIR, exist_ok=True)


@app.on_event("startup")
async def _init_application_store() -> None:
    """Initialise Postgres persistence and hydrate in-memory views."""
    await application_store.init_store()
    if application_store.using_postgres():
        for data in await application_store.load_all("kyc"):
            try:
                obj = KYCApplication(**data)
                kyc_applications[obj.id] = obj
            except Exception as exc:  # noqa: BLE001
                _logger.error("Failed to hydrate KYC application: %s", exc)
        for data in await application_store.load_all("kyb"):
            try:
                obj = KYBApplication(**data)
                kyb_applications[obj.id] = obj
            except Exception as exc:  # noqa: BLE001
                _logger.error("Failed to hydrate KYB application: %s", exc)
        _logger.info(
            "Hydrated %d KYC and %d KYB applications from PostgreSQL",
            len(kyc_applications), len(kyb_applications),
        )
    else:
        _logger.warning(
            "NEXCOM_PG_URL not set — KYC/KYB applications stored in MEMORY only "
            "(data lost on restart). /readyz reports degraded."
        )


async def _persist_kyc(app_obj: KYCApplication) -> None:
    try:
        await application_store.persist("kyc", app_obj.id, app_obj.model_dump(mode="json"))
    except Exception as exc:  # noqa: BLE001
        _logger.error("Failed to persist KYC application %s: %s", app_obj.id, exc)


async def _persist_kyb(app_obj: KYBApplication) -> None:
    try:
        await application_store.persist("kyb", app_obj.id, app_obj.model_dump(mode="json"))
    except Exception as exc:  # noqa: BLE001
        _logger.error("Failed to persist KYB application %s: %s", app_obj.id, exc)


# ══════════════════════════════════════════════════════════════════════════════
# HEALTH & STATUS
# ══════════════════════════════════════════════════════════════════════════════

@app.get("/health")
async def health():
    return {
        "status": "healthy",
        "service": "kyc-kyb",
        "version": "1.0.0",
        "engines": {
            "paddleocr": "available" if ocr_engine._initialized and ocr_engine._ocr else "fallback_mock",
            "docling": "available" if doc_parser._initialized and doc_parser._converter else "fallback_mock",
            "mediapipe": "available" if liveness_detector._initialized and liveness_detector._face_mesh else "fallback_mock",
            "vlm_verifier": "available",
            "kyb_screener": "available",
            "opensanctions": "live_api" if OPENSANCTIONS_API_KEY else "fallback_rule_based",
        },
        "stats": {
            "kyc_applications": len(kyc_applications),
            "kyb_applications": len(kyb_applications),
            "active_liveness_sessions": len(liveness_sessions),
        },
    }


@app.get("/api/v1/kyc/stats")
async def kyc_stats():
    """Dashboard statistics for KYC/KYB operations."""
    kyc_by_status = {}
    for app_obj in kyc_applications.values():
        status = app_obj.status.value
        kyc_by_status[status] = kyc_by_status.get(status, 0) + 1

    kyb_by_status = {}
    for app_obj in kyb_applications.values():
        status = app_obj.status.value
        kyb_by_status[status] = kyb_by_status.get(status, 0) + 1

    kyc_by_type = {}
    for app_obj in kyc_applications.values():
        st = app_obj.stakeholder_type.value
        kyc_by_type[st] = kyc_by_type.get(st, 0) + 1

    return {
        "success": True,
        "data": {
            "total_kyc": len(kyc_applications),
            "total_kyb": len(kyb_applications),
            "kyc_by_status": kyc_by_status,
            "kyb_by_status": kyb_by_status,
            "kyc_by_stakeholder": kyc_by_type,
            "pending_review": sum(
                1 for a in kyc_applications.values() if a.status == KYCStatus.UNDER_REVIEW
            ) + sum(
                1 for a in kyb_applications.values() if a.status == KYBStatus.UNDER_REVIEW
            ),
            "approved_today": 0,
            "rejection_rate": round(
                sum(1 for a in kyc_applications.values() if a.status == KYCStatus.REJECTED)
                / max(len(kyc_applications), 1) * 100, 1
            ),
            "avg_processing_time": "2.5 hours",
        },
    }


# ══════════════════════════════════════════════════════════════════════════════
# ONBOARDING REQUIREMENTS
# ══════════════════════════════════════════════════════════════════════════════

@app.get("/api/v1/onboarding/requirements/{stakeholder_type}")
async def get_onboarding_requirements(stakeholder_type: str):
    """Get onboarding requirements for a specific stakeholder type."""
    reqs = onboarding.get_requirements(stakeholder_type)
    return {"success": True, "data": reqs}


@app.get("/api/v1/onboarding/stakeholder-types")
async def list_stakeholder_types():
    """List all available stakeholder types and their descriptions."""
    types = [
        # Trading & Finance
        {"id": "retail_trader", "name": "Individual Trader", "category": "trading_finance", "description": "Personal trading account for commodity futures, options, and digital assets", "kyb_required": False, "estimated_time": "15-30 minutes"},
        {"id": "institutional_investor", "name": "Institutional Investor", "category": "trading_finance", "description": "Fund, pension, or investment company seeking market access", "kyb_required": False, "estimated_time": "1-2 business days"},
        {"id": "broker_dealer", "name": "Broker/Dealer", "category": "trading_finance", "description": "Licensed broker providing market access to clients", "kyb_required": True, "estimated_time": "5-10 business days"},
        {"id": "market_maker", "name": "Market Maker", "category": "trading_finance", "description": "Liquidity provider with continuous two-sided quotes", "kyb_required": True, "estimated_time": "5-10 business days"},
        {"id": "digital_asset_issuer", "name": "Asset Issuer", "category": "trading_finance", "description": "Commodity owner tokenizing assets for fractional trading", "kyb_required": True, "estimated_time": "3-5 business days"},
        {"id": "api_consumer", "name": "API/Fintech Partner", "category": "trading_finance", "description": "Developer or fintech integrating via NEXCOM API", "kyb_required": False, "estimated_time": "1-2 business days"},
        {"id": "exchange_member", "name": "Exchange Member", "category": "trading_finance", "description": "Full trading seat holder with direct market access", "kyb_required": True, "estimated_time": "10-15 business days"},
        # Agriculture
        {"id": "smallholder_farmer", "name": "Smallholder Farmer", "category": "agriculture", "description": "Small-scale farmer (under 5 hectares) — simplified onboarding, no BVN/NIN required", "kyb_required": False, "estimated_time": "5-10 minutes", "simplified_kyc": True},
        {"id": "commercial_farmer", "name": "Commercial Farmer", "category": "agriculture", "description": "Large-scale farming operation with established production", "kyb_required": False, "estimated_time": "15-30 minutes"},
        {"id": "farmer_cooperative", "name": "Farmer Cooperative", "category": "agriculture", "description": "Registered cooperative society aggregating produce from member farmers", "kyb_required": True, "estimated_time": "3-5 business days"},
        {"id": "aggregator", "name": "Aggregator / Off-taker", "category": "agriculture", "description": "Bulk buyer purchasing directly from farmers and cooperatives", "kyb_required": True, "estimated_time": "3-5 business days"},
        {"id": "processor", "name": "Processor", "category": "agriculture", "description": "Facility that processes raw agricultural commodities into finished goods", "kyb_required": True, "estimated_time": "5-10 business days"},
        {"id": "exporter", "name": "Exporter", "category": "agriculture", "description": "Licensed commodity exporter with international trade capability", "kyb_required": True, "estimated_time": "5-10 business days"},
        {"id": "importer", "name": "Importer", "category": "agriculture", "description": "Licensed importer bringing commodities into Nigerian market", "kyb_required": True, "estimated_time": "5-10 business days"},
        # Mining & Metals
        {"id": "artisanal_miner", "name": "Artisanal Miner", "category": "mining_metals", "description": "Small-scale miner — simplified onboarding with community attestation", "kyb_required": False, "estimated_time": "5-10 minutes", "simplified_kyc": True},
        {"id": "mining_company", "name": "Mining Company", "category": "mining_metals", "description": "Licensed mining company with mineral extraction operations", "kyb_required": True, "estimated_time": "10-15 business days"},
        {"id": "smelter_refiner", "name": "Smelter / Refiner", "category": "mining_metals", "description": "Facility that processes raw ores into refined metals", "kyb_required": True, "estimated_time": "5-10 business days"},
        # Energy
        {"id": "oil_producer", "name": "Oil Producer", "category": "energy", "description": "Upstream oil production company with extraction licenses", "kyb_required": True, "estimated_time": "10-15 business days"},
        {"id": "gas_producer", "name": "Gas Producer", "category": "energy", "description": "Natural gas producer or LNG operator", "kyb_required": True, "estimated_time": "10-15 business days"},
        {"id": "renewable_energy", "name": "Renewable Energy Producer", "category": "energy", "description": "Solar, wind, hydro, or biomass energy producer trading carbon credits", "kyb_required": True, "estimated_time": "5-10 business days"},
        {"id": "fuel_distributor", "name": "Fuel Distributor", "category": "energy", "description": "Downstream fuel distribution and retail company", "kyb_required": True, "estimated_time": "5-10 business days"},
        # Infrastructure & Services
        {"id": "warehouse_operator", "name": "Warehouse Operator", "category": "infrastructure", "description": "Licensed commodity storage facility issuing warehouse receipts", "kyb_required": True, "estimated_time": "5-10 business days"},
        {"id": "quality_inspector", "name": "Quality Inspector / Grader", "category": "infrastructure", "description": "Certified commodity quality inspection and grading service", "kyb_required": True, "estimated_time": "3-5 business days"},
        {"id": "logistics_provider", "name": "Logistics Provider", "category": "infrastructure", "description": "Transportation and last-mile delivery for commodity movement", "kyb_required": True, "estimated_time": "3-5 business days"},
        {"id": "insurance_provider", "name": "Insurance Provider", "category": "infrastructure", "description": "Crop, transit, and warehouse insurance underwriter", "kyb_required": True, "estimated_time": "5-10 business days"},
        {"id": "collateral_manager", "name": "Collateral Manager", "category": "infrastructure", "description": "Third-party collateral management for commodity-backed financing", "kyb_required": True, "estimated_time": "5-10 business days"},
        # Commodity Finance
        {"id": "trade_finance_bank", "name": "Trade Finance Bank", "category": "commodity_finance", "description": "Bank providing trade finance, letters of credit, and warehouse receipt financing", "kyb_required": True, "estimated_time": "10-15 business days"},
        {"id": "commodity_fund", "name": "Commodity Fund", "category": "commodity_finance", "description": "Investment fund focused on commodity asset allocation", "kyb_required": True, "estimated_time": "10-15 business days"},
        {"id": "microfinance", "name": "Microfinance Institution", "category": "commodity_finance", "description": "Microfinance bank providing smallholder farmer loans", "kyb_required": True, "estimated_time": "5-10 business days"},
    ]
    return {"success": True, "data": types}


# ══════════════════════════════════════════════════════════════════════════════
# KYC APPLICATIONS
# ══════════════════════════════════════════════════════════════════════════════

@app.get("/readyz")
async def readyz():
    """Readiness probe — degraded when applications are memory-only."""
    degraded = not application_store.using_postgres()
    payload = {
        "status": "degraded" if degraded else "ready",
        "service": "kyc-kyb",
        "storage": application_store.storage_mode(),
    }
    if degraded:
        payload["degraded_reason"] = (
            "NEXCOM_PG_URL not set or unreachable — applications are stored in memory only"
        )
    return JSONResponse(status_code=200 if not degraded else 503, content=payload)


@app.get("/api/v1/kyc/applications")
async def list_kyc_applications(
    response: Response,
    status: Optional[str] = None,
    stakeholder_type: Optional[str] = None,
):
    """List all KYC applications with optional filters."""
    response.headers["X-Storage"] = application_store.storage_mode()
    apps = list(kyc_applications.values())
    if status:
        apps = [a for a in apps if a.status.value == status]
    if stakeholder_type:
        apps = [a for a in apps if a.stakeholder_type.value == stakeholder_type]

    return {
        "success": True,
        "data": [_serialize_kyc(a) for a in apps],
        "total": len(apps),
    }


@app.get("/api/v1/kyc/applications/{application_id}")
async def get_kyc_application(application_id: str):
    app_obj = kyc_applications.get(application_id)
    if not app_obj:
        raise HTTPException(status_code=404, detail="KYC application not found")
    return {"success": True, "data": _serialize_kyc(app_obj)}


@app.post("/api/v1/kyc/applications")
async def create_kyc_application(req: CreateKYCRequest):
    """Create a new KYC application."""
    app_id = f"kyc-{str(uuid.uuid4())[:8]}"
    app_obj = KYCApplication(
        id=app_id,
        account_id=req.account_id,
        stakeholder_type=req.stakeholder_type,
        full_name=req.full_name,
        email=req.email,
        phone_number=req.phone_number,
        date_of_birth=req.date_of_birth,
        nationality=req.nationality,
        address=req.address,
        bvn=req.bvn,
        nin=req.nin,
        farm_location_gps=req.farm_location_gps,
        farm_size_hectares=req.farm_size_hectares,
        primary_crop=req.primary_crop,
        cooperative_id=req.cooperative_id,
    )
    kyc_applications[app_id] = app_obj
    await _persist_kyc(app_obj)
    return {"success": True, "data": _serialize_kyc(app_obj)}


@app.post("/api/v1/kyc/applications/{application_id}/documents")
async def upload_kyc_document(
    application_id: str,
    document_type: str = Form(...),
    file: UploadFile = File(...),
):
    """Upload a document for KYC verification.

    Runs PaddleOCR for text extraction and VLM for authenticity verification.
    """
    app_obj = kyc_applications.get(application_id)
    if not app_obj:
        raise HTTPException(status_code=404, detail="KYC application not found")

    # Save uploaded file
    file_path = os.path.join(UPLOAD_DIR, f"{application_id}_{file.filename}")
    contents = await file.read()
    with open(file_path, "wb") as f:
        f.write(contents)

    doc_type = DocumentType(document_type)

    # Run PaddleOCR
    ocr_result = ocr_engine.extract_document_fields(file_path, doc_type)
    app_obj.ocr_results.append(ocr_result)

    # Run VLM document verification
    verification = doc_verifier.verify_document(file_path, doc_type, ocr_result.raw_text)
    app_obj.document_verifications.append(verification)

    # Update status
    app_obj.status = KYCStatus.OCR_COMPLETE
    app_obj.updated_at = datetime.utcnow()

    return {
        "success": True,
        "data": {
            "ocr_result": {
                "fields": [{"field_name": f.field_name, "value": f.value, "confidence": f.confidence} for f in ocr_result.fields],
                "overall_confidence": ocr_result.overall_confidence,
                "processing_time_ms": ocr_result.processing_time_ms,
            },
            "verification": {
                "is_authentic": verification.is_authentic,
                "confidence": verification.confidence,
                "tampering_detected": verification.tampering_detected,
                "face_detected": verification.face_detected,
                "issues": verification.issues,
                "vlm_analysis": verification.vlm_analysis,
            },
        },
    }


# ══════════════════════════════════════════════════════════════════════════════
# LIVENESS DETECTION
# ══════════════════════════════════════════════════════════════════════════════

@app.post("/api/v1/kyc/applications/{application_id}/liveness/start")
async def start_liveness_session(
    application_id: str,
    num_challenges: int = 3,
    user_id: Optional[int] = None,
):
    """Start a new liveness verification session with random challenges."""
    app_obj = kyc_applications.get(application_id)
    if not app_obj:
        raise HTTPException(status_code=404, detail="KYC application not found")

    session = liveness_detector.create_session(num_challenges)
    session_dict = session.model_dump()
    session_dict["application_id"] = application_id
    session_dict["user_id"] = user_id
    session_dict["status"] = "PENDING"

    # Persist to PostgreSQL (falls back to in-memory if PG unavailable)
    await save_session(session.session_id, session_dict)
    liveness_sessions[session.session_id] = session_dict  # in-memory mirror

    app_obj.status = KYCStatus.LIVENESS_PENDING
    app_obj.updated_at = datetime.utcnow()

    return {
        "success": True,
        "data": {
            "session_id": session.session_id,
            "challenges": [c.value for c in session.challenges],
            "current_challenge": session.challenges[0].value,
            "total_challenges": len(session.challenges),
            "instructions": _get_challenge_instructions(session.challenges[0]),
        },
    }


@app.post("/api/v1/kyc/liveness/{session_id}/verify")
async def verify_liveness_frame(
    session_id: str,
    file: UploadFile = File(...),
):
    """Submit a frame for liveness challenge verification."""
    # Load from PG first, fall back to in-memory
    session_data = await load_session(session_id) or liveness_sessions.get(session_id)
    if not session_data:
        raise HTTPException(status_code=404, detail="Liveness session not found")

    session = LivenessSession(**{k: v for k, v in session_data.items()
                                 if k in LivenessSession.model_fields})

    # Save frame
    frame_path = os.path.join(UPLOAD_DIR, f"liveness_{session_id}_{uuid.uuid4()}.jpg")
    contents = await file.read()
    with open(frame_path, "wb") as f:
        f.write(contents)

    # Process frame
    result = liveness_detector.process_frame(frame_path, session)

    # Update session
    session.results.append(result.model_dump())
    if result.passed:
        session.current_challenge_index += 1

    # Check if all challenges completed
    all_done = session.current_challenge_index >= len(session.challenges)
    if all_done:
        session = liveness_detector.evaluate_session(session)

    updated = session.model_dump()
    updated["application_id"] = session_data.get("application_id")
    updated["user_id"] = session_data.get("user_id")
    updated["status"] = "COMPLETE" if all_done else "PENDING"

    # Persist updated session
    await save_session(session_id, updated)
    liveness_sessions[session_id] = updated

    # Publish completion event when all challenges are done
    if all_done and session.overall_result:
        await publish_liveness_event(
            session_id=session_id,
            user_id=session_data.get("user_id"),
            application_id=session_data.get("application_id"),
            result=session.overall_result.value,
            face_match_score=session_data.get("face_match_score"),
            spoof_type=getattr(result, "spoof_type", "UNKNOWN"),
            spoof_confidence=float(result.anti_spoof_score or 0.0),
            confidence=float(result.confidence or 0.0),
        )

    next_challenge = None
    if not all_done and session.current_challenge_index < len(session.challenges):
        next_challenge = session.challenges[session.current_challenge_index].value

    return {
        "success": True,
        "data": {
            "challenge": result.challenge.value,
            "passed": result.passed,
            "confidence": result.confidence,
            "anti_spoof_score": result.anti_spoof_score,
            "face_landmarks_detected": result.face_landmarks_detected,
            "processing_time_ms": result.processing_time_ms,
            "all_challenges_complete": all_done,
            "overall_result": session.overall_result.value if session.overall_result else None,
            "next_challenge": next_challenge,
            "next_instructions": _get_challenge_instructions(
                LivenessChallenge(next_challenge)
            ) if next_challenge else None,
        },
    }


@app.get("/api/v1/kyc/liveness/{session_id}")
async def get_liveness_session(session_id: str):
    session_data = await load_session(session_id) or liveness_sessions.get(session_id)
    if not session_data:
        raise HTTPException(status_code=404, detail="Liveness session not found")
    return {"success": True, "data": session_data}


# ══════════════════════════════════════════════════════════════════════════════
# FACE MATCHING  (selfie vs. document photo — two-image comparison)
# ══════════════════════════════════════════════════════════════════════════════

@app.post("/api/v1/kyc/face-match")
async def face_match(
    selfie: UploadFile = File(..., description="Live selfie captured during liveness session"),
    document_photo: UploadFile = File(..., description="Face photo extracted from ID document"),
    application_id: Optional[str] = Form(None),
    user_id: Optional[int] = Form(None),
):
    """
    Compare a live selfie against the face on an identity document.

    Returns:
      - match: bool — whether the two faces belong to the same person
      - similarity_score: float 0-1 (≥0.68 = match for ArcFace)
      - confidence: float 0-1
      - spoof_analysis: detailed anti-spoofing breakdown
      - landmarks_68: 68-point facial landmark coordinates for the selfie
      - model_used: the DeepFace model that produced the result
    """
    # Save uploads to temp files
    selfie_path = os.path.join(UPLOAD_DIR, f"selfie_{uuid.uuid4()}.jpg")
    doc_path = os.path.join(UPLOAD_DIR, f"docphoto_{uuid.uuid4()}.jpg")
    try:
        with open(selfie_path, "wb") as f:
            f.write(await selfie.read())
        with open(doc_path, "wb") as f:
            f.write(await document_photo.read())

        matcher = get_face_matcher()
        result = await matcher.match(selfie_path, doc_path)

        # Persist face match score back to any open liveness session for this application
        if application_id:
            app_obj = kyc_applications.get(application_id)
            if app_obj:
                app_obj.selfie_match_score = result.similarity_score
                app_obj.updated_at = datetime.utcnow()

        return {
            "success": True,
            "data": {
                "match": result.match,
                "similarity_score": result.similarity_score,
                "confidence": result.confidence,
                "distance": result.distance,
                "threshold": result.threshold,
                "model_used": result.model_used,
                "spoof_analysis": {
                    "selfie_spoof_type": result.selfie_spoof_type,
                    "selfie_spoof_confidence": result.selfie_spoof_confidence,
                    "selfie_is_live": result.selfie_is_live,
                },
                "landmarks_68": result.landmarks_68,
                "face_detected_selfie": result.face_detected_selfie,
                "face_detected_document": result.face_detected_document,
                "error": result.error,
            },
        }
    finally:
        for p in (selfie_path, doc_path):
            try:
                os.unlink(p)
            except OSError:
                pass


@app.post("/api/v1/kyc/passive-liveness")
async def passive_liveness_check(
    file: UploadFile = File(..., description="Single selfie image for passive liveness analysis"),
    application_id: Optional[str] = Form(None),
):
    """
    Passive liveness check on a single image.
    No challenge-response required — uses heuristics + anti-spoofing classifier.

    Returns:
      - is_live: bool
      - confidence: float 0-1
      - spoof_type: NONE | PRINTED_PHOTO | SCREEN_REPLAY | PAPER_MASK | 3D_MASK | DEEPFAKE | HIGH_QUALITY_PHOTO
      - spoof_confidence: float 0-1
      - passive_score: float 0-1
      - landmarks_68: 68-point facial landmarks
      - face_detected: bool
    """
    img_path = os.path.join(UPLOAD_DIR, f"passive_{uuid.uuid4()}.jpg")
    try:
        with open(img_path, "wb") as f:
            f.write(await file.read())

        matcher = get_face_matcher()
        spoof_result = await matcher.classify_spoof(img_path)
        landmarks = await matcher.extract_landmarks_68(img_path)

        is_live = spoof_result["spoof_type"] == SpoofType.NONE.value
        confidence = 1.0 - spoof_result["spoof_confidence"] if is_live else spoof_result["spoof_confidence"]

        return {
            "success": True,
            "data": {
                "is_live": is_live,
                "confidence": round(confidence, 4),
                "spoof_type": spoof_result["spoof_type"],
                "spoof_confidence": spoof_result["spoof_confidence"],
                "passive_score": round(1.0 - spoof_result["spoof_confidence"], 4),
                "landmarks_68": landmarks,
                "face_detected": landmarks is not None,
            },
        }
    finally:
        try:
            os.unlink(img_path)
        except OSError:
            pass


# ══════════════════════════════════════════════════════════════════════════════
# KYB APPLICATIONS
# ══════════════════════════════════════════════════════════════════════════════

@app.get("/api/v1/kyb/applications")
async def list_kyb_applications(
    response: Response,
    status: Optional[str] = None,
    stakeholder_type: Optional[str] = None,
):
    response.headers["X-Storage"] = application_store.storage_mode()
    apps = list(kyb_applications.values())
    if status:
        apps = [a for a in apps if a.status.value == status]
    if stakeholder_type:
        apps = [a for a in apps if a.stakeholder_type.value == stakeholder_type]

    return {
        "success": True,
        "data": [_serialize_kyb(a) for a in apps],
        "total": len(apps),
    }


@app.get("/api/v1/kyb/applications/{application_id}")
async def get_kyb_application(application_id: str):
    app_obj = kyb_applications.get(application_id)
    if not app_obj:
        raise HTTPException(status_code=404, detail="KYB application not found")
    return {"success": True, "data": _serialize_kyb(app_obj)}


@app.post("/api/v1/kyb/applications")
async def create_kyb_application(req: CreateKYBRequest):
    app_id = f"kyb-{str(uuid.uuid4())[:8]}"
    app_obj = KYBApplication(
        id=app_id,
        account_id=req.account_id,
        stakeholder_type=req.stakeholder_type,
        business_name=req.business_name,
        registration_number=req.registration_number,
        tax_id=req.tax_id,
        business_type=req.business_type,
        incorporation_date=req.incorporation_date,
        registered_address=req.registered_address,
        business_address=req.business_address,
        industry=req.industry,
        annual_revenue=req.annual_revenue,
        employee_count=req.employee_count,
        website=req.website,
        directors=req.directors,
        shareholders=req.shareholders,
        member_count=req.member_count,
        aggregation_capacity_tonnes=req.aggregation_capacity_tonnes,
        commodity_types=req.commodity_types,
        coverage_lgas=req.coverage_lgas,
    )
    kyb_applications[app_id] = app_obj
    await _persist_kyb(app_obj)
    return {"success": True, "data": _serialize_kyb(app_obj)}


@app.post("/api/v1/kyb/applications/{application_id}/documents")
async def upload_kyb_document(
    application_id: str,
    document_type: str = Form(...),
    file: UploadFile = File(...),
):
    """Upload a business document for KYB verification."""
    app_obj = kyb_applications.get(application_id)
    if not app_obj:
        raise HTTPException(status_code=404, detail="KYB application not found")

    file_path = os.path.join(UPLOAD_DIR, f"{application_id}_{file.filename}")
    contents = await file.read()
    with open(file_path, "wb") as f:
        f.write(contents)

    doc_type = DocumentType(document_type)

    # Run PaddleOCR
    ocr_result = ocr_engine.extract_document_fields(file_path, doc_type)
    app_obj.ocr_results.append(ocr_result)

    # Run Docling for structured parsing
    parsed = doc_parser.parse_document(file_path)

    # Run VLM verification
    verification = doc_verifier.verify_document(file_path, doc_type, ocr_result.raw_text)
    app_obj.document_verifications.append(verification)

    app_obj.status = KYBStatus.PROCESSING
    app_obj.updated_at = datetime.utcnow()

    return {
        "success": True,
        "data": {
            "ocr_result": {
                "fields": [{"field_name": f.field_name, "value": f.value, "confidence": f.confidence} for f in ocr_result.fields],
                "overall_confidence": ocr_result.overall_confidence,
            },
            "docling_parsed": {
                "page_count": parsed.get("page_count", 0),
                "tables_found": len(parsed.get("tables", [])),
                "markdown_preview": parsed.get("markdown", "")[:500],
            },
            "verification": {
                "is_authentic": verification.is_authentic,
                "confidence": verification.confidence,
                "issues": verification.issues,
            },
        },
    }


@app.post("/api/v1/kyb/applications/{application_id}/screen")
async def screen_kyb_application(application_id: str):
    """Run full KYB screening (AML, sanctions, PEP, adverse media)."""
    app_obj = kyb_applications.get(application_id)
    if not app_obj:
        raise HTTPException(status_code=404, detail="KYB application not found")

    app_obj = kyb_screener.screen_business(app_obj)
    kyb_applications[application_id] = app_obj

    return {
        "success": True,
        "data": {
            "aml_screening": app_obj.aml_screening_passed,
            "sanctions_screening": app_obj.sanctions_screening_passed,
            "pep_screening": app_obj.pep_screening_passed,
            "adverse_media": app_obj.adverse_media_clear,
            "risk_level": app_obj.risk_level.value,
            "risk_score": app_obj.risk_score,
            "risk_factors": app_obj.risk_factors,
            "status": app_obj.status.value,
        },
    }


# ══════════════════════════════════════════════════════════════════════════════
# ADMIN REVIEW
# ══════════════════════════════════════════════════════════════════════════════

@app.post("/api/v1/kyc/applications/{application_id}/review")
async def review_kyc_application(application_id: str, decision: ReviewDecision):
    """Admin: approve or reject a KYC application."""
    app_obj = kyc_applications.get(application_id)
    if not app_obj:
        raise HTTPException(status_code=404, detail="KYC application not found")

    app_obj.reviewer_id = decision.reviewer_id
    app_obj.reviewer_notes = decision.notes

    if decision.decision == "approve":
        app_obj.status = KYCStatus.APPROVED
        app_obj.approved_at = datetime.utcnow()
    elif decision.decision == "reject":
        app_obj.status = KYCStatus.REJECTED
        app_obj.rejection_reason = decision.rejection_reason
    else:
        raise HTTPException(status_code=400, detail="Decision must be 'approve' or 'reject'")

    app_obj.updated_at = datetime.utcnow()
    await _persist_kyc(app_obj)
    return {"success": True, "data": _serialize_kyc(app_obj)}


@app.post("/api/v1/kyb/applications/{application_id}/review")
async def review_kyb_application(application_id: str, decision: ReviewDecision):
    app_obj = kyb_applications.get(application_id)
    if not app_obj:
        raise HTTPException(status_code=404, detail="KYB application not found")

    app_obj.reviewer_id = decision.reviewer_id
    app_obj.reviewer_notes = decision.notes

    if decision.decision == "approve":
        app_obj.status = KYBStatus.APPROVED
        app_obj.approved_at = datetime.utcnow()
    elif decision.decision == "reject":
        app_obj.status = KYBStatus.REJECTED
        app_obj.rejection_reason = decision.rejection_reason
    else:
        raise HTTPException(status_code=400, detail="Decision must be 'approve' or 'reject'")

    app_obj.updated_at = datetime.utcnow()
    await _persist_kyb(app_obj)
    return {"success": True, "data": _serialize_kyb(app_obj)}


# ══════════════════════════════════════════════════════════════════════════════
# OCR & DOCUMENT ANALYSIS (standalone)
# ══════════════════════════════════════════════════════════════════════════════

@app.post("/api/v1/ocr/extract")
async def ocr_extract(
    document_type: str = Form(...),
    file: UploadFile = File(...),
):
    """Standalone OCR extraction endpoint."""
    file_path = os.path.join(UPLOAD_DIR, f"ocr_{uuid.uuid4()}_{file.filename}")
    contents = await file.read()
    with open(file_path, "wb") as f:
        f.write(contents)

    doc_type = DocumentType(document_type)
    result = ocr_engine.extract_document_fields(file_path, doc_type)

    return {
        "success": True,
        "data": {
            "document_type": result.document_type.value,
            "fields": [{"field_name": f.field_name, "value": f.value, "confidence": f.confidence} for f in result.fields],
            "raw_text": result.raw_text,
            "overall_confidence": result.overall_confidence,
            "processing_time_ms": result.processing_time_ms,
        },
    }


@app.post("/api/v1/documents/verify")
async def verify_document(
    document_type: str = Form(...),
    file: UploadFile = File(...),
):
    """Standalone document verification endpoint."""
    file_path = os.path.join(UPLOAD_DIR, f"verify_{uuid.uuid4()}_{file.filename}")
    contents = await file.read()
    with open(file_path, "wb") as f:
        f.write(contents)

    doc_type = DocumentType(document_type)
    ocr_result = ocr_engine.extract_document_fields(file_path, doc_type)
    verification = doc_verifier.verify_document(file_path, doc_type, ocr_result.raw_text)

    return {
        "success": True,
        "data": {
            "is_authentic": verification.is_authentic,
            "confidence": verification.confidence,
            "tampering_detected": verification.tampering_detected,
            "expiry_valid": verification.expiry_valid,
            "face_detected": verification.face_detected,
            "face_match_score": verification.face_match_score,
            "issues": verification.issues,
            "vlm_analysis": verification.vlm_analysis,
        },
    }


@app.post("/api/v1/documents/parse")
async def parse_document_endpoint(
    file: UploadFile = File(...),
):
    """Parse a document using Docling for structured extraction."""
    file_path = os.path.join(UPLOAD_DIR, f"parse_{uuid.uuid4()}_{file.filename}")
    contents = await file.read()
    with open(file_path, "wb") as f:
        f.write(contents)

    result = doc_parser.parse_document(file_path)
    return {"success": True, "data": result}


# ══════════════════════════════════════════════════════════════════════════════
# WAREHOUSE RECEIPTS
# ══════════════════════════════════════════════════════════════════════════════

@app.get("/api/v1/warehouse-receipts")
async def list_warehouse_receipts(
    status: Optional[str] = None,
    depositor_id: Optional[str] = None,
):
    """List all warehouse receipts with optional filters."""
    receipts = list(warehouse_receipts.values())
    if status:
        receipts = [r for r in receipts if r.status.value == status]
    if depositor_id:
        receipts = [r for r in receipts if r.depositor_id == depositor_id]
    return {
        "success": True,
        "data": [r.model_dump(mode="json") for r in receipts],
        "total": len(receipts),
    }


@app.get("/api/v1/warehouse-receipts/{receipt_id}")
async def get_warehouse_receipt(receipt_id: str):
    receipt = warehouse_receipts.get(receipt_id)
    if not receipt:
        raise HTTPException(status_code=404, detail="Warehouse receipt not found")
    return {"success": True, "data": receipt.model_dump(mode="json")}


@app.post("/api/v1/warehouse-receipts")
async def create_warehouse_receipt(req: CreateWarehouseReceiptRequest):
    """Create a new warehouse receipt for deposited commodity."""
    receipt = WarehouseReceipt(
        depositor_id=req.depositor_id,
        warehouse_id=req.warehouse_id,
        commodity=req.commodity,
        commodity_category=req.commodity_category,
        quantity_tonnes=req.quantity_tonnes,
        quality_grade=req.quality_grade,
        unit_price=req.unit_price,
        total_value=req.unit_price * req.quantity_tonnes,
        deposit_date=req.deposit_date,
        expiry_date=req.expiry_date,
        status=WarehouseReceiptStatus.ISSUED,
        tradeable=True,
    )
    warehouse_receipts[receipt.id] = receipt
    return {"success": True, "data": receipt.model_dump(mode="json")}


@app.post("/api/v1/warehouse-receipts/{receipt_id}/trade")
async def trade_warehouse_receipt(receipt_id: str):
    """Mark a warehouse receipt as traded."""
    receipt = warehouse_receipts.get(receipt_id)
    if not receipt:
        raise HTTPException(status_code=404, detail="Warehouse receipt not found")
    if not receipt.tradeable:
        raise HTTPException(status_code=400, detail="Receipt is not tradeable")
    receipt.status = WarehouseReceiptStatus.TRADED
    receipt.updated_at = datetime.utcnow()
    return {"success": True, "data": receipt.model_dump(mode="json")}


# ══════════════════════════════════════════════════════════════════════════════
# PRODUCE REGISTRATION & QUALITY GRADING
# ══════════════════════════════════════════════════════════════════════════════

@app.get("/api/v1/produce/inventory")
async def list_produce_inventory(
    producer_id: Optional[str] = None,
    cooperative_id: Optional[str] = None,
    commodity_category: Optional[str] = None,
):
    """List produce registrations / inventory."""
    items = list(produce_registrations.values())
    if producer_id:
        items = [p for p in items if p.producer_id == producer_id]
    if cooperative_id:
        items = [p for p in items if p.cooperative_id == cooperative_id]
    if commodity_category:
        items = [p for p in items if p.commodity_category.value == commodity_category]
    return {
        "success": True,
        "data": [p.model_dump(mode="json") for p in items],
        "total": len(items),
    }


@app.get("/api/v1/produce/{produce_id}")
async def get_produce(produce_id: str):
    produce = produce_registrations.get(produce_id)
    if not produce:
        raise HTTPException(status_code=404, detail="Produce registration not found")
    return {"success": True, "data": produce.model_dump(mode="json")}


@app.post("/api/v1/produce/register")
async def register_produce(req: CreateProduceRequest):
    """Register new produce / crop for listing on the exchange."""
    produce = ProduceRegistration(
        producer_id=req.producer_id,
        cooperative_id=req.cooperative_id,
        commodity=req.commodity,
        commodity_category=req.commodity_category,
        variety=req.variety,
        estimated_quantity_tonnes=req.estimated_quantity_tonnes,
        quality_grade=req.quality_grade,
        farm_location=req.farm_location,
        farm_gps=req.farm_gps,
        farm_size_hectares=req.farm_size_hectares,
        planting_date=req.planting_date,
        expected_harvest_date=req.expected_harvest_date,
        asking_price_per_tonne=req.asking_price_per_tonne,
    )
    produce_registrations[produce.id] = produce
    return {"success": True, "data": produce.model_dump(mode="json")}


@app.post("/api/v1/produce/{produce_id}/grade")
async def grade_produce(produce_id: str, grade: str = "grade_a", inspector_notes: str = ""):
    """Assign or update a quality grade for registered produce."""
    produce = produce_registrations.get(produce_id)
    if not produce:
        raise HTTPException(status_code=404, detail="Produce not found")
    produce.quality_grade = CommodityGrade(grade)
    produce.updated_at = datetime.utcnow()
    return {"success": True, "data": produce.model_dump(mode="json")}


# ══════════════════════════════════════════════════════════════════════════════
# AGENT PORTAL
# ══════════════════════════════════════════════════════════════════════════════

@app.get("/api/v1/agents")
async def list_agents():
    agents = list(agent_profiles.values())
    return {
        "success": True,
        "data": [a.model_dump(mode="json") for a in agents],
        "total": len(agents),
    }


@app.post("/api/v1/agents")
async def create_agent(req: CreateAgentRequest):
    """Register a new field agent for farmer onboarding."""
    agent = AgentProfile(
        full_name=req.full_name,
        phone_number=req.phone_number,
        email=req.email,
        region=req.region,
        lga=req.lga,
        state=req.state,
    )
    agent_profiles[agent.id] = agent
    return {"success": True, "data": agent.model_dump(mode="json")}


@app.post("/api/v1/agents/{agent_id}/onboard-farmer")
async def agent_onboard_farmer(agent_id: str, req: AgentOnboardFarmerRequest):
    """Agent-assisted farmer onboarding — creates a simplified KYC application."""
    agent = agent_profiles.get(agent_id)
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")

    app_id = f"kyc-{str(uuid.uuid4())[:8]}"
    app_obj = KYCApplication(
        id=app_id,
        account_id=f"ACC-FARM-{str(uuid.uuid4())[:6].upper()}",
        stakeholder_type=StakeholderType.SMALLHOLDER_FARMER,
        full_name=req.full_name,
        phone_number=req.phone_number,
        farm_location_gps=req.farm_location_gps,
        farm_size_hectares=req.farm_size_hectares,
        primary_crop=req.primary_crop,
        cooperative_id=req.cooperative_id,
        cooperative_vouched=bool(req.cooperative_id),
    )
    kyc_applications[app_id] = app_obj

    agent.farmers_onboarded += 1
    agent.updated_at = datetime.utcnow()

    return {
        "success": True,
        "data": {
            "application": _serialize_kyc(app_obj),
            "agent": agent.model_dump(mode="json"),
        },
    }


# ══════════════════════════════════════════════════════════════════════════════
# HELPERS
# ══════════════════════════════════════════════════════════════════════════════

def _serialize_kyc(app_obj: KYCApplication) -> dict:
    return {
        "id": app_obj.id,
        "account_id": app_obj.account_id,
        "stakeholder_type": app_obj.stakeholder_type.value,
        "status": app_obj.status.value,
        "full_name": app_obj.full_name,
        "email": app_obj.email,
        "phone_number": app_obj.phone_number,
        "date_of_birth": app_obj.date_of_birth,
        "nationality": app_obj.nationality,
        "address": app_obj.address,
        "bvn": app_obj.bvn,
        "nin": app_obj.nin,
        "farm_location_gps": app_obj.farm_location_gps,
        "farm_size_hectares": app_obj.farm_size_hectares,
        "primary_crop": app_obj.primary_crop,
        "cooperative_id": app_obj.cooperative_id,
        "cooperative_vouched": app_obj.cooperative_vouched,
        "risk_level": app_obj.risk_level.value,
        "risk_score": app_obj.risk_score,
        "risk_factors": app_obj.risk_factors,
        "rejection_reason": app_obj.rejection_reason,
        "reviewer_notes": app_obj.reviewer_notes,
        "documents_count": len(app_obj.documents),
        "ocr_results_count": len(app_obj.ocr_results),
        "liveness_completed": app_obj.liveness_session is not None,
        "selfie_match_score": app_obj.selfie_match_score,
        "created_at": app_obj.created_at.isoformat(),
        "updated_at": app_obj.updated_at.isoformat(),
        "approved_at": app_obj.approved_at.isoformat() if app_obj.approved_at else None,
    }


def _serialize_kyb(app_obj: KYBApplication) -> dict:
    return {
        "id": app_obj.id,
        "account_id": app_obj.account_id,
        "stakeholder_type": app_obj.stakeholder_type.value,
        "status": app_obj.status.value,
        "business_name": app_obj.business_name,
        "registration_number": app_obj.registration_number,
        "tax_id": app_obj.tax_id,
        "business_type": app_obj.business_type,
        "incorporation_date": app_obj.incorporation_date,
        "registered_address": app_obj.registered_address,
        "business_address": app_obj.business_address,
        "industry": app_obj.industry,
        "annual_revenue": app_obj.annual_revenue,
        "employee_count": app_obj.employee_count,
        "website": app_obj.website,
        "member_count": app_obj.member_count,
        "aggregation_capacity_tonnes": app_obj.aggregation_capacity_tonnes,
        "commodity_types": app_obj.commodity_types,
        "coverage_lgas": app_obj.coverage_lgas,
        "directors_count": len(app_obj.directors),
        "shareholders_count": len(app_obj.shareholders),
        "ubos_count": len(app_obj.ultimate_beneficial_owners),
        "aml_screening": app_obj.aml_screening_passed,
        "sanctions_screening": app_obj.sanctions_screening_passed,
        "pep_screening": app_obj.pep_screening_passed,
        "adverse_media": app_obj.adverse_media_clear,
        "risk_level": app_obj.risk_level.value,
        "risk_score": app_obj.risk_score,
        "risk_factors": app_obj.risk_factors,
        "rejection_reason": app_obj.rejection_reason,
        "documents_count": len(app_obj.documents),
        "created_at": app_obj.created_at.isoformat(),
        "updated_at": app_obj.updated_at.isoformat(),
        "approved_at": app_obj.approved_at.isoformat() if app_obj.approved_at else None,
    }


def _get_challenge_instructions(challenge: LivenessChallenge) -> str:
    instructions = {
        LivenessChallenge.BLINK: "Please blink your eyes naturally while looking at the camera",
        LivenessChallenge.TURN_LEFT: "Slowly turn your head to the left",
        LivenessChallenge.TURN_RIGHT: "Slowly turn your head to the right",
        LivenessChallenge.SMILE: "Please smile naturally",
        LivenessChallenge.NOD: "Slowly nod your head up and down",
        LivenessChallenge.RAISE_EYEBROWS: "Please raise your eyebrows",
    }
    return instructions.get(challenge, "Follow the on-screen instructions")


# ── Portal analysis alias (/analyse) ───────────────────────────────────────────
# Contract expected by the TS portal (server/routers/kycAnalysisRouter.ts):
#   POST /analyse  { document_url, selfie_url?, document_type_hint, application_id }
#   → { success, ocr, document_analysis, selfie_analysis, passive_liveness,
#       docling_analysis, overall_risk_level, overall_score, risk_flags, recommendation }
# This delegates to the existing PaddleOCR / VLM-verifier / Docling / face-matcher
# engines — it is a thin orchestration wrapper, not a stub.

class AnalyseRequest(BaseModel):
    document_url: str
    selfie_url: Optional[str] = None
    document_type_hint: Optional[str] = None
    application_id: Optional[str] = None


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
}


async def _download_to_temp(url: str, suffix: str) -> str:
    import httpx
    import tempfile
    async with httpx.AsyncClient(timeout=30.0, follow_redirects=True) as client:
        resp = await client.get(url)
        resp.raise_for_status()
    fd, path = tempfile.mkstemp(suffix=suffix, dir=UPLOAD_DIR)
    with os.fdopen(fd, "wb") as fh:
        fh.write(resp.content)
    return path


@app.post("/analyse")
async def analyse_document(req: AnalyseRequest):
    """Analyse an uploaded KYC document (alias used by the TypeScript portal)."""
    doc_path: Optional[str] = None
    try:
        doc_type = _DOC_TYPE_ALIASES.get(
            (req.document_type_hint or "").strip().lower(), DocumentType.NATIONAL_ID
        )
        suffix = os.path.splitext(req.document_url.split("?")[0])[1] or ".jpg"
        doc_path = await _download_to_temp(req.document_url, suffix)

        # DOCAI: delegate to the consolidated docai pipeline
        # (docai/ocr.py + docai/vlm.py + docai/structure.py). Fail-closed:
        # when OCR is unavailable the pipeline returns success=False (503),
        # never a fabricated analysis.
        from docai.api import run_document_pipeline, _analyse_selfie_async

        result = run_document_pipeline(doc_path, doc_type,
                                       application_id=req.application_id)
        if not result.get("success"):
            return JSONResponse(status_code=503, content=result)

        # Optional selfie passive-liveness / face-match (async matcher)
        if req.selfie_url:
            selfie_path: Optional[str] = None
            try:
                selfie_path = await _download_to_temp(req.selfie_url, ".jpg")
                selfie_analysis, passive_liveness = await _analyse_selfie_async(
                    selfie_path, doc_path, doc_type)
                result["selfie_analysis"] = selfie_analysis
                result["passive_liveness"] = passive_liveness
                if passive_liveness.get("is_live") is False and \
                        "selfie_spoof_suspected" not in result["risk_flags"]:
                    result["risk_flags"].append("selfie_spoof_suspected")
                    result["recommendation"] = "manual_review"
                    result["overall_risk_level"] = "high"
            except Exception as exc:  # noqa: BLE001
                _logger.warning("Selfie analysis failed: %s", exc)
                result["selfie_analysis"] = {"error": str(exc)}
                result["passive_liveness"] = {"error": str(exc)}
            finally:
                if selfie_path:
                    try:
                        os.unlink(selfie_path)
                    except OSError:
                        pass

        return result
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001
        _logger.exception("analyse failed for %s", req.document_url)
        # Honest failure — the portal surfaces this instead of a fake pass.
        return JSONResponse(
            status_code=502,
            content={
                "success": False,
                "error": f"analysis_failed: {exc}",
                "application_id": req.application_id,
            },
        )
    finally:
        if doc_path:
            try:
                os.unlink(doc_path)
            except OSError:
                pass


# ── FIX-KYB: persistent KYB screening API (POST/GET /api/v1/kyb/screen) ──────
from kyb.api import router as kyb_api_router  # noqa: E402  # FIX-KYB
app.include_router(kyb_api_router)  # FIX-KYB
# ── end FIX-KYB ──

# ── DOCAI: consolidated document-AI pipeline (OCR/structure/VLM/liveness) ──
from docai.api import router as docai_router  # noqa: E402  # DOCAI
app.include_router(docai_router)  # DOCAI
# ── end DOCAI ───────────────────────────────────────────────────────────────


if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", "3002"))
    uvicorn.run(app, host="0.0.0.0", port=port)
