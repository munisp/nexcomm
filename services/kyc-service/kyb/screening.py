"""KYB screening module for corporate entity verification.
Implements:
1. AML (Anti-Money Laundering) screening
2. Live Sanctions list checking via OpenSanctions API (OFAC, EU, UN, EFCC, HMT)
3. PEP (Politically Exposed Person) screening via OpenSanctions API
4. Adverse media screening
5. Ultimate Beneficial Owner (UBO) identification
6. Risk scoring for corporate entities

OpenSanctions API: https://www.opensanctions.org/api/
  - Endpoint: https://api.opensanctions.org/match/default
  - Auth: Bearer token via OPENSANCTIONS_API_KEY env var
  - Fallback: rule-based screening if API key not configured
"""
from __future__ import annotations

import logging
import os
import re
from datetime import datetime
from typing import Any, Optional

import httpx

from models.schemas import (
    DirectorInfo,
    KYBApplication,
    KYBStatus,
    RiskLevel,
    ShareholderInfo,
    UBOInfo,
)

logger = logging.getLogger(__name__)

OPENSANCTIONS_API_URL = "https://api.opensanctions.org"
OPENSANCTIONS_API_KEY = os.environ.get("OPENSANCTIONS_API_KEY", "")
OPENSANCTIONS_TIMEOUT = 10
OPENSANCTIONS_SCORE_THRESHOLD = 0.70


def _opensanctions_match(
    name: str,
    birth_date: Optional[str] = None,
    country: Optional[str] = None,
    entity_type: str = "Person",
) -> dict[str, Any]:
    """Query the OpenSanctions /match/default endpoint for a single entity."""
    if not OPENSANCTIONS_API_KEY:
        return _fallback_match(name)

    properties: dict[str, Any] = {"name": [name]}
    if birth_date:
        properties["birthDate"] = [birth_date]
    if country:
        properties["nationality"] = [country]

    payload = {"queries": {"q1": {"schema": entity_type, "properties": properties}}}
    headers = {"Authorization": f"ApiKey {OPENSANCTIONS_API_KEY}", "Content-Type": "application/json"}

    try:
        with httpx.Client(timeout=OPENSANCTIONS_TIMEOUT) as client:
            resp = client.post(f"{OPENSANCTIONS_API_URL}/match/default", json=payload, headers=headers)
            resp.raise_for_status()
            data = resp.json()

        results = data.get("responses", {}).get("q1", {}).get("results", [])
        if not results:
            return {"matched": False, "score": 0.0, "datasets": [], "entity_id": None, "caption": None, "topics": [], "source": "opensanctions"}

        best = max(results, key=lambda r: r.get("score", 0))
        score = best.get("score", 0.0)
        return {
            "matched": score >= OPENSANCTIONS_SCORE_THRESHOLD,
            "score": score,
            "datasets": best.get("datasets", []),
            "entity_id": best.get("id"),
            "caption": best.get("caption"),
            "topics": best.get("properties", {}).get("topics", []),
            "source": "opensanctions",
        }
    except httpx.HTTPStatusError as e:
        if e.response.status_code == 402:
            logger.warning("[OpenSanctions] API quota exceeded — falling back to rule-based screening")
        else:
            logger.error("[OpenSanctions] HTTP error %s for query '%s': %s", e.response.status_code, name, e)
        return _fallback_match(name)
    except Exception as e:
        logger.error("[OpenSanctions] Unexpected error for query '%s': %s", name, e)
        return _fallback_match(name)


def _opensanctions_match_company(name: str, country: Optional[str] = None) -> dict[str, Any]:
    return _opensanctions_match(name, country=country, entity_type="Company")


def _fallback_match(name: str) -> dict[str, Any]:
    """Rule-based fallback when OpenSanctions API is unavailable."""
    KNOWN_SANCTIONED = {"sanctioned entity", "blocked corp", "restricted trading", "ofac blocked", "un sanctioned"}
    name_lower = name.lower()
    matched = any(s in name_lower for s in KNOWN_SANCTIONED)
    return {
        "matched": matched,
        "score": 1.0 if matched else 0.0,
        "datasets": ["fallback_local"] if matched else [],
        "entity_id": None,
        "caption": name if matched else None,
        "topics": ["sanction"] if matched else [],
        "source": "fallback",
    }


class KYBScreeningEngine:
    """Corporate entity screening and verification engine.

    Sanctions and PEP checks use the OpenSanctions API when
    OPENSANCTIONS_API_KEY is set; otherwise fall back to rule-based logic.
    """

    HIGH_RISK_INDUSTRIES = [
        "gambling", "cryptocurrency", "money_transfer", "precious_metals",
        "arms", "oil_trading", "real_estate", "art_dealing",
    ]
    HIGH_RISK_JURISDICTIONS = [
        "cayman_islands", "british_virgin_islands", "panama",
        "seychelles", "mauritius", "jersey", "guernsey",
    ]

    def screen_business(self, application: KYBApplication) -> KYBApplication:
        """Run full KYB screening suite on a business application."""
        application.aml_screening_passed = self._aml_check(application)

        sanctions_result = self._sanctions_check(application)
        application.sanctions_screening_passed = sanctions_result["passed"]
        if not sanctions_result["passed"]:
            application.risk_factors = application.risk_factors or []
            application.risk_factors.append(
                f"SANCTIONS_MATCH: {sanctions_result.get('detail', 'entity flagged')} "
                f"[source={sanctions_result.get('source', 'unknown')}]"
            )

        pep_result = self._pep_check(application)
        application.pep_screening_passed = pep_result["passed"]
        if pep_result.get("pep_detected"):
            application.risk_factors = application.risk_factors or []
            application.risk_factors.append(
                f"PEP_DETECTED (EDD required): {pep_result.get('detail', 'director/UBO is PEP')} "
                f"[source={pep_result.get('source', 'unknown')}]"
            )

        application.adverse_media_clear = self._adverse_media_check(application)

        if not application.ultimate_beneficial_owners:
            application.ultimate_beneficial_owners = self._identify_ubos(application)

        risk_result = self._calculate_risk(application)
        application.risk_level = risk_result["level"]
        application.risk_score = risk_result["score"]
        application.risk_factors = (application.risk_factors or []) + risk_result["factors"]

        all_passed = (
            application.aml_screening_passed
            and application.sanctions_screening_passed
            and application.pep_screening_passed
            and application.adverse_media_clear
        )
        if all_passed and application.risk_level in (RiskLevel.LOW, RiskLevel.MEDIUM):
            application.status = KYBStatus.UNDER_REVIEW
        elif not all_passed:
            application.status = KYBStatus.UNDER_REVIEW
            if not application.sanctions_screening_passed:
                application.risk_factors.append("SANCTIONS_MATCH_REQUIRES_MANUAL_REVIEW")

        application.updated_at = datetime.utcnow()
        return application

    def _aml_check(self, app: KYBApplication) -> bool:
        issues = []
        if app.registration_number:
            rc_pattern = r"^(RC|BN)[\-]?\d{5,8}$"
            if not re.match(rc_pattern, app.registration_number, re.IGNORECASE):
                issues.append("Invalid CAC registration number format")
        if app.industry.lower().replace(" ", "_") in self.HIGH_RISK_INDUSTRIES:
            issues.append(f"High-risk industry: {app.industry}")
        if app.incorporation_date:
            try:
                inc_date = datetime.strptime(app.incorporation_date, "%Y-%m-%d")
                age_days = (datetime.utcnow() - inc_date).days
                if age_days < 180:
                    issues.append("Company incorporated less than 6 months ago")
            except ValueError:
                pass
        if app.country_of_incorporation:
            country_key = app.country_of_incorporation.lower().replace(" ", "_")
            if country_key in self.HIGH_RISK_JURISDICTIONS:
                issues.append(f"High-risk jurisdiction: {app.country_of_incorporation}")
        if app.shareholders:
            corporate_shareholders = [s for s in app.shareholders if s.shareholder_type == "corporate"]
            if len(corporate_shareholders) > 3:
                issues.append("Complex corporate ownership structure (potential layering)")
        return len(issues) == 0

    def _sanctions_check(self, app: KYBApplication) -> dict[str, Any]:
        company_name = getattr(app, "company_name", None) or getattr(app, "business_name", "")
        company_result = _opensanctions_match_company(company_name, country=app.country_of_incorporation)
        if company_result["matched"]:
            datasets = ", ".join(company_result.get("datasets", []))
            return {"passed": False, "detail": f"Company '{company_name}' matched sanctions list(s): {datasets}", "source": company_result["source"]}

        for director in (app.directors or []):
            result = _opensanctions_match(director.full_name, birth_date=director.date_of_birth, country=director.nationality, entity_type="Person")
            if result["matched"] and "sanction" in result.get("topics", []):
                datasets = ", ".join(result.get("datasets", []))
                return {"passed": False, "detail": f"Director '{director.full_name}' matched sanctions list(s): {datasets}", "source": result["source"]}

        for shareholder in (app.shareholders or []):
            result = _opensanctions_match(shareholder.name, entity_type="Person" if shareholder.shareholder_type == "individual" else "Company")
            if result["matched"] and "sanction" in result.get("topics", []):
                datasets = ", ".join(result.get("datasets", []))
                return {"passed": False, "detail": f"Shareholder '{shareholder.name}' matched sanctions list(s): {datasets}", "source": result["source"]}

        return {"passed": True, "source": company_result["source"]}

    def _pep_check(self, app: KYBApplication) -> dict[str, Any]:
        pep_matches: list[str] = []
        pep_topics = {"pep", "pep-class-1", "pep-class-2", "pep-class-3", "pep-class-4"}

        for director in (app.directors or []):
            result = _opensanctions_match(director.full_name, birth_date=director.date_of_birth, country=director.nationality, entity_type="Person")
            if result["matched"] and pep_topics.intersection(set(result.get("topics", []))):
                pep_matches.append(f"Director '{director.full_name}' is a PEP [score={result['score']:.2f}, source={result['source']}]")

        for ubo in (app.ultimate_beneficial_owners or []):
            result = _opensanctions_match(ubo.full_name, birth_date=ubo.date_of_birth, country=ubo.nationality, entity_type="Person")
            if result["matched"] and pep_topics.intersection(set(result.get("topics", []))):
                pep_matches.append(f"UBO '{ubo.full_name}' is a PEP [score={result['score']:.2f}, source={result['source']}]")

        if pep_matches:
            return {"passed": True, "pep_detected": True, "detail": "; ".join(pep_matches), "source": "opensanctions", "requires_edd": True}
        return {"passed": True, "pep_detected": False, "source": "opensanctions"}

    def _adverse_media_check(self, app: KYBApplication) -> bool:
        company_name = getattr(app, "company_name", None) or getattr(app, "business_name", "")
        result = _opensanctions_match_company(company_name, country=app.country_of_incorporation)
        adverse_topics = {"debarment", "crime", "wanted", "terrorism", "money-laundering"}
        if result["matched"] and adverse_topics.intersection(set(result.get("topics", []))):
            logger.warning("[KYB] Adverse media flag for '%s': topics=%s", company_name, result.get("topics"))
            return False
        # Also check for flagged keywords in company name
        flagged_keywords = ["fraud", "scam", "money laundering", "ponzi", "theft"]
        if any(kw in company_name.lower() for kw in flagged_keywords):
            return False
        return True

    def _identify_ubos(self, application: KYBApplication) -> list[UBOInfo]:
        ubos = []
        for sh in (application.shareholders or []):
            if sh.ownership_percentage >= 25.0:
                ubo = UBOInfo(
                    full_name=sh.name,
                    ownership_percentage=sh.ownership_percentage,
                    nationality=getattr(sh, "nationality", None),
                    date_of_birth=getattr(sh, "date_of_birth", None),
                    is_pep=False,
                    is_sanctioned=False,
                )
                ubos.append(ubo)
        return ubos

    def _calculate_risk(self, application: KYBApplication) -> dict[str, Any]:
        score = 0.0
        factors: list[str] = []

        if application.industry.lower().replace(" ", "_") in self.HIGH_RISK_INDUSTRIES:
            score += 0.3
            factors.append(f"High-risk industry: {application.industry}")

        if application.country_of_incorporation:
            country_key = application.country_of_incorporation.lower().replace(" ", "_")
            if country_key in self.HIGH_RISK_JURISDICTIONS:
                score += 0.25
                factors.append(f"High-risk jurisdiction: {application.country_of_incorporation}")

        if application.incorporation_date:
            try:
                inc_date = datetime.strptime(application.incorporation_date, "%Y-%m-%d")
                age_days = (datetime.utcnow() - inc_date).days
                if age_days < 180:
                    score += 0.2
                    factors.append("Recently incorporated (< 6 months)")
                elif age_days < 365:
                    score += 0.1
                    factors.append("Incorporated less than 1 year ago")
            except ValueError:
                pass

        director_count = len(application.directors or [])
        if director_count == 0:
            score += 0.15
            factors.append("No directors listed")
        elif director_count == 1:
            score += 0.05
            factors.append("Single director (potential shell indicator)")

        if application.shareholders:
            total_foreign = sum(
                s.ownership_percentage
                for s in application.shareholders
                if getattr(s, "nationality", "nigerian").lower() != "nigerian"
            )
            if total_foreign > 50:
                score += 0.1
                factors.append(f"Foreign ownership: {total_foreign:.0f}%")

        score = min(score, 1.0)
        if score >= 0.7:
            level = RiskLevel.CRITICAL
        elif score >= 0.4:
            level = RiskLevel.HIGH
        elif score >= 0.2:
            level = RiskLevel.MEDIUM
        else:
            level = RiskLevel.LOW

        return {"level": level, "score": score, "factors": factors}


class StakeholderOnboarding:
    """Stakeholder-specific onboarding workflows."""

    STAKEHOLDER_KYC_REQUIREMENTS: dict[str, list[str]] = {
        "retail_trader": ["government_id", "proof_of_address", "selfie_liveness"],
        "institutional_investor": ["government_id", "proof_of_address", "selfie_liveness", "accredited_investor_proof"],
        "broker_dealer": ["kyb_required", "cac_certificate", "sec_license", "directors_kyc", "audited_financials", "capital_adequacy"],
        "market_maker": ["kyb_required", "cac_certificate", "sec_license", "directors_kyc", "capital_proof", "technology_assessment"],
        "digital_asset_issuer": ["kyb_required", "cac_certificate", "commodity_ownership_proof", "warehouse_receipt", "insurance_certificate"],
        "api_consumer": ["government_id", "proof_of_address", "use_case_description"],
        "exchange_member": ["kyb_required", "cac_certificate", "sec_license", "directors_kyc", "audited_financials", "capital_adequacy", "fit_and_proper_assessment"],
    }

    STAKEHOLDER_KYB_DOCUMENTS: dict[str, list[str]] = {
        "broker_dealer": ["cac_certificate", "memorandum_of_association", "board_resolution", "tax_clearance", "audited_financials", "shareholder_register"],
        "market_maker": ["cac_certificate", "memorandum_of_association", "board_resolution", "tax_clearance"],
        "digital_asset_issuer": ["cac_certificate", "commodity_ownership_proof", "warehouse_receipt"],
        "exchange_member": ["cac_certificate", "memorandum_of_association", "articles_of_association", "board_resolution", "tax_clearance", "audited_financials", "shareholder_register"],
    }

    def get_requirements(self, stakeholder_type: str) -> dict:
        kyc_reqs = self.STAKEHOLDER_KYC_REQUIREMENTS.get(stakeholder_type, [])
        kyb_docs = self.STAKEHOLDER_KYB_DOCUMENTS.get(stakeholder_type, [])
        needs_kyb = "kyb_required" in kyc_reqs
        return {
            "stakeholder_type": stakeholder_type,
            "needs_kyb": needs_kyb,
            "kyc_steps": [r for r in kyc_reqs if r != "kyb_required"],
            "kyb_documents": kyb_docs,
            "estimated_time": self._estimate_time(stakeholder_type),
            "fees": self._get_fees(stakeholder_type),
        }

    def _estimate_time(self, stakeholder_type: str) -> str:
        times = {
            "retail_trader": "15-30 minutes", "institutional_investor": "1-2 business days",
            "broker_dealer": "5-10 business days", "market_maker": "5-10 business days",
            "digital_asset_issuer": "3-5 business days", "api_consumer": "1-2 business days",
            "exchange_member": "10-15 business days",
        }
        return times.get(stakeholder_type, "3-5 business days")

    def _get_fees(self, stakeholder_type: str) -> dict:
        fees = {
            "retail_trader": {"kyc_fee": 5000, "currency": "NGN"},
            "institutional_investor": {"kyc_fee": 25000, "currency": "NGN"},
            "broker_dealer": {"kyc_fee": 50000, "kyb_fee": 100000, "membership_fee": 500000, "currency": "NGN"},
            "market_maker": {"kyc_fee": 50000, "kyb_fee": 75000, "registration_fee": 250000, "currency": "NGN"},
            "digital_asset_issuer": {"kyc_fee": 25000, "kyb_fee": 50000, "listing_fee": 100000, "currency": "NGN"},
            "api_consumer": {"kyc_fee": 10000, "currency": "NGN"},
            "exchange_member": {"kyc_fee": 50000, "kyb_fee": 150000, "seat_fee": 1000000, "currency": "NGN"},
        }
        return fees.get(stakeholder_type, {"kyc_fee": 5000, "currency": "NGN"})
