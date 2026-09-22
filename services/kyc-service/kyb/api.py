"""KYB screening API (FIX-KYB).

FastAPI router exposing the KYB screening engine to the NEXCOM portal:

  POST /api/v1/kyb/screen
      Runs KYBScreeningEngine over the corporate entity + directors + UBOs
      (sanctions / PEP / adverse media via OpenSanctions with the existing
      rule-based fallback), computes a risk level, and returns a structured
      result: matches (with OpenSanctions scores), adverseMedia, uboRisk and
      a recommendation (APPROVE / REVIEW / REJECT). Results are persisted to
      Postgres (table kyb_screening_results, created on demand) when
      NEXCOM_PG_URL is set; otherwise kept in memory and the response carries
      an `X-Storage: memory` header so callers can tell.

  GET /api/v1/kyb/screen/{application_id}
      Returns the most recent screening result for an application
      (404 when none exists).

This router is included from main.py (marked FIX-KYB). It does NOT replace the
legacy in-memory /api/v1/kyb/applications store; the portal's kybRouter is the
system of record for KYB applications — this service performs screening only.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
from datetime import datetime, timezone
from typing import Any, Optional

from fastapi import APIRouter, HTTPException, Response
from pydantic import BaseModel, Field

from kyb.screening import (
    KYBScreeningEngine,
    OPENSANCTIONS_API_KEY,
    _opensanctions_match,
    _opensanctions_match_company,
)
from models.schemas import (
    DirectorInfo,
    KYBApplication,
    RiskLevel,
    ShareholderInfo,
    StakeholderType,
    UBOInfo,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/kyb", tags=["kyb-screening"])

_engine = KYBScreeningEngine()

# ── Persistence (asyncpg when NEXCOM_PG_URL is set, else in-memory) ───────────

NEXCOM_PG_URL = os.environ.get("NEXCOM_PG_URL", "")
_pg_pool: Optional[Any] = None
_pg_lock = asyncio.Lock()
_memory_results: dict[str, dict[str, Any]] = {}

_CREATE_TABLE_SQL = """
CREATE TABLE IF NOT EXISTS kyb_screening_results (
  id BIGSERIAL PRIMARY KEY,
  application_id TEXT NOT NULL,
  result JSONB NOT NULL,
  risk_level TEXT,
  recommendation TEXT,
  screening_source TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_kyb_screening_results_app
  ON kyb_screening_results (application_id, created_at DESC);
"""


async def _get_pool() -> Optional[Any]:
    global _pg_pool
    if not NEXCOM_PG_URL:
        return None
    if _pg_pool is not None:
        return _pg_pool
    async with _pg_lock:
        if _pg_pool is not None:
            return _pg_pool
        try:
            import asyncpg  # type: ignore

            pool = await asyncpg.create_pool(NEXCOM_PG_URL, min_size=1, max_size=3, command_timeout=10)
            async with pool.acquire() as conn:
                await conn.execute(_CREATE_TABLE_SQL)
            _pg_pool = pool
            logger.info("[KYB API] asyncpg pool connected; kyb_screening_results table ready")
        except Exception as exc:  # pragma: no cover - depends on environment
            logger.warning("[KYB API] PostgreSQL unavailable, using in-memory results: %s", exc)
            _pg_pool = None
    return _pg_pool


async def _persist_result(application_id: str, result: dict[str, Any]) -> str:
    """Persist a screening result. Returns 'postgres' or 'memory'."""
    pool = await _get_pool()
    if pool is None:
        _memory_results[application_id] = result
        return "memory"
    try:
        async with pool.acquire() as conn:
            await conn.execute(
                """
                INSERT INTO kyb_screening_results
                    (application_id, result, risk_level, recommendation, screening_source)
                VALUES ($1, $2, $3, $4, $5)
                """,
                application_id,
                json.dumps(result),
                result.get("riskLevel"),
                result.get("recommendation"),
                result.get("screeningSource"),
            )
        return "postgres"
    except Exception as exc:
        logger.warning("[KYB API] PG insert failed, falling back to memory: %s", exc)
        _memory_results[application_id] = result
        return "memory"


async def _load_latest(application_id: str) -> tuple[Optional[dict[str, Any]], str]:
    pool = await _get_pool()
    if pool is None:
        return _memory_results.get(application_id), "memory"
    try:
        async with pool.acquire() as conn:
            row = await conn.fetchrow(
                """
                SELECT result FROM kyb_screening_results
                WHERE application_id = $1
                ORDER BY created_at DESC
                LIMIT 1
                """,
                application_id,
            )
        if row is None:
            return None, "postgres"
        result = row["result"]
        if isinstance(result, str):
            result = json.loads(result)
        return result, "postgres"
    except Exception as exc:
        logger.warning("[KYB API] PG read failed, falling back to memory: %s", exc)
        return _memory_results.get(application_id), "memory"


# ── Request / response models ─────────────────────────────────────────────────

class ScreenDirector(BaseModel):
    fullName: str
    role: str = "Director"
    nationality: str = "Nigerian"
    dateOfBirth: Optional[str] = None


class ScreenBeneficialOwner(BaseModel):
    fullName: str
    ownershipPercent: float = Field(ge=0, le=100)
    nationality: str = "Nigerian"
    dateOfBirth: Optional[str] = None
    isPep: bool = False


class KybScreenRequest(BaseModel):
    applicationId: str
    businessName: str
    businessType: str = ""
    registrationNumber: str = ""
    taxId: str = ""
    incorporationDate: Optional[str] = None
    registeredAddress: str = ""
    countryOfIncorporation: str = "Nigeria"
    industry: str = ""
    operatingStates: list[str] = Field(default_factory=list)
    directors: list[ScreenDirector] = Field(default_factory=list)
    beneficialOwners: list[ScreenBeneficialOwner] = Field(default_factory=list)


# ── Screening logic ───────────────────────────────────────────────────────────

def _collect_matches(req: KybScreenRequest) -> list[dict[str, Any]]:
    """Structured OpenSanctions (or fallback) match detail per party."""
    matches: list[dict[str, Any]] = []

    company = _opensanctions_match_company(req.businessName, country=req.countryOfIncorporation)
    matches.append({"party": "entity", "name": req.businessName, **company})

    for d in req.directors:
        r = _opensanctions_match(
            d.fullName, birth_date=d.dateOfBirth, country=d.nationality, entity_type="Person"
        )
        matches.append({"party": "director", "name": d.fullName, **r})

    for o in req.beneficialOwners:
        r = _opensanctions_match(
            o.fullName, birth_date=o.dateOfBirth, country=o.nationality, entity_type="Person"
        )
        matches.append({"party": "ubo", "name": o.fullName, **r})

    return matches


def _ubo_risk(req: KybScreenRequest, matches: list[dict[str, Any]]) -> dict[str, Any]:
    total = sum(o.ownershipPercent for o in req.beneficialOwners)
    ubo_matches = {m["name"]: m for m in matches if m["party"] == "ubo"}
    pep_ubos = [
        o.fullName
        for o in req.beneficialOwners
        if o.isPep or any(t.startswith("pep") for t in ubo_matches.get(o.fullName, {}).get("topics", []))
    ]
    sanctioned_ubos = [
        o.fullName
        for o in req.beneficialOwners
        if "sanction" in ubo_matches.get(o.fullName, {}).get("topics", [])
    ]
    declared_ubo_count = sum(1 for o in req.beneficialOwners if o.ownershipPercent >= 25.0)
    return {
        "declaredOwners": len(req.beneficialOwners),
        "declaredUboCount25Pct": declared_ubo_count,
        "totalOwnershipPercent": round(total, 2),
        "pepUbos": pep_ubos,
        "sanctionedUbos": sanctioned_ubos,
        "possibleUndeclaredUbo": declared_ubo_count == 0 or total < 100.0,
    }


def _recommendation(
    app: KYBApplication, matches: list[dict[str, Any]], ubo_risk: dict[str, Any]
) -> str:
    sanctions_hit = any(
        m.get("matched") and "sanction" in (m.get("topics") or []) for m in matches
    )
    if sanctions_hit or app.risk_level == RiskLevel.CRITICAL or ubo_risk["sanctionedUbos"]:
        return "REJECT"
    if not (
        app.aml_screening_passed
        and app.sanctions_screening_passed
        and app.pep_screening_passed
        and app.adverse_media_clear
    ):
        return "REVIEW"
    if (
        app.risk_level in (RiskLevel.HIGH, RiskLevel.MEDIUM)
        or ubo_risk["pepUbos"]
        or ubo_risk["possibleUndeclaredUbo"]
    ):
        return "REVIEW"
    return "APPROVE"


@router.post("/screen")
async def screen_kyb_application(req: KybScreenRequest, response: Response) -> dict[str, Any]:
    """Screen a corporate KYB application and return a structured result."""
    # Build the engine's application model from the portal payload.
    app = KYBApplication(
        id=req.applicationId,
        account_id=req.applicationId,
        stakeholder_type=StakeholderType.EXCHANGE_MEMBER,
        business_name=req.businessName,
        registration_number=req.registrationNumber,
        tax_id=req.taxId,
        business_type=req.businessType,
        incorporation_date=req.incorporationDate,
        registered_address=req.registeredAddress,
        industry=req.industry,
        directors=[
            DirectorInfo(full_name=d.fullName, position=d.role, nationality=d.nationality)
            for d in req.directors
        ],
        shareholders=[
            ShareholderInfo(
                name=o.fullName,
                is_corporate=False,
                ownership_percentage=o.ownershipPercent,
                nationality=o.nationality,
            )
            for o in req.beneficialOwners
        ],
        ultimate_beneficial_owners=[
            UBOInfo(
                full_name=o.fullName,
                ownership_percentage=o.ownershipPercent,
                nationality=o.nationality,
                date_of_birth=o.dateOfBirth,
                pep_status=o.isPep,
            )
            for o in req.beneficialOwners
        ],
    )

    try:
        screened = _engine.screen_business(app)
    except Exception as exc:
        logger.exception("[KYB API] screening engine failed for %s", req.applicationId)
        raise HTTPException(status_code=500, detail=f"Screening engine error: {exc}")

    matches = _collect_matches(req)
    adverse_media_hits = [
        {"name": m["name"], "topics": m.get("topics", []), "score": m.get("score", 0.0)}
        for m in matches
        if m.get("matched")
        and {"debarment", "crime", "wanted", "terrorism", "money-laundering"}.intersection(
            set(m.get("topics") or [])
        )
    ]
    ubo_risk = _ubo_risk(req, matches)
    recommendation = _recommendation(screened, matches, ubo_risk)

    result: dict[str, Any] = {
        "applicationId": req.applicationId,
        "businessName": req.businessName,
        "checks": {
            "amlPassed": screened.aml_screening_passed,
            "sanctionsPassed": screened.sanctions_screening_passed,
            "pepPassed": screened.pep_screening_passed,
            "adverseMediaClear": screened.adverse_media_clear,
        },
        "matches": matches,
        "adverseMedia": {"clear": screened.adverse_media_clear, "hits": adverse_media_hits},
        "uboRisk": ubo_risk,
        "riskLevel": screened.risk_level.value.upper(),
        "riskScore": screened.risk_score,
        "riskFactors": screened.risk_factors,
        "recommendation": recommendation,
        "screeningSource": "opensanctions" if OPENSANCTIONS_API_KEY else "rule-based-fallback",
        "screenedAt": datetime.now(timezone.utc).isoformat(),
    }

    storage = await _persist_result(req.applicationId, result)
    result["storage"] = storage
    if storage == "memory":
        response.headers["X-Storage"] = "memory"
    return result


@router.get("/screen/{application_id}")
async def get_kyb_screening(application_id: str, response: Response) -> dict[str, Any]:
    """Retrieve the most recent screening result for an application."""
    result, storage = await _load_latest(application_id)
    if storage == "memory":
        response.headers["X-Storage"] = "memory"
    if result is None:
        raise HTTPException(status_code=404, detail="No screening result for this application")
    return result
