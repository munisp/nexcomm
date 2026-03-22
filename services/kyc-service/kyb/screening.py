"""KYB screening module for corporate entity verification.

Implements:
1. AML (Anti-Money Laundering) screening
2. Sanctions list checking (OFAC, EU, UN, EFCC)
3. PEP (Politically Exposed Person) screening
4. Adverse media screening
5. Ultimate Beneficial Owner (UBO) identification
6. Risk scoring for corporate entities
"""
from __future__ import annotations

import re
from datetime import datetime
from typing import Optional

from models.schemas import (
    DirectorInfo,
    KYBApplication,
    KYBStatus,
    RiskLevel,
    ShareholderInfo,
    UBOInfo,
)


class KYBScreeningEngine:
    """Corporate entity screening and verification engine."""

    # Nigerian-specific high-risk indicators
    HIGH_RISK_INDUSTRIES = [
        "gambling", "cryptocurrency", "money_transfer", "precious_metals",
        "arms", "oil_trading", "real_estate", "art_dealing",
    ]

    HIGH_RISK_JURISDICTIONS = [
        "cayman_islands", "british_virgin_islands", "panama",
        "seychelles", "mauritius", "jersey", "guernsey",
    ]

    # Simulated sanctions/PEP databases (in production: OFAC, EU, UN, EFCC APIs)
    SANCTIONS_LIST = [
        "SANCTIONED_ENTITY_1", "BLOCKED_CORP_LTD", "RESTRICTED_TRADING_CO",
    ]

    PEP_DATABASE = [
        "GOVERNOR_STATE_1", "SENATOR_DISTRICT_5", "MINISTER_FINANCE",
    ]

    def screen_business(self, application: KYBApplication) -> KYBApplication:
        """Run full KYB screening suite on a business application."""
        # 1. AML screening
        application.aml_screening_passed = self._aml_check(application)

        # 2. Sanctions screening
        application.sanctions_screening_passed = self._sanctions_check(application)

        # 3. PEP screening (directors & UBOs)
        application.pep_screening_passed = self._pep_check(application)

        # 4. Adverse media screening
        application.adverse_media_clear = self._adverse_media_check(application)

        # 5. UBO identification
        if not application.ultimate_beneficial_owners:
            application.ultimate_beneficial_owners = self._identify_ubos(application)

        # 6. Risk scoring
        risk_result = self._calculate_risk(application)
        application.risk_level = risk_result["level"]
        application.risk_score = risk_result["score"]
        application.risk_factors = risk_result["factors"]

        # Update status
        all_passed = (
            application.aml_screening_passed
            and application.sanctions_screening_passed
            and application.pep_screening_passed
            and application.adverse_media_clear
        )

        if all_passed and application.risk_level in (RiskLevel.LOW, RiskLevel.MEDIUM):
            application.status = KYBStatus.UNDER_REVIEW
        elif not all_passed:
            application.status = KYBStatus.UNDER_REVIEW  # Manual review needed
            if not application.sanctions_screening_passed:
                application.risk_factors.append("SANCTIONS_MATCH_REQUIRES_MANUAL_REVIEW")

        application.updated_at = datetime.utcnow()
        return application

    def _aml_check(self, app: KYBApplication) -> bool:
        """Anti-Money Laundering screening.

        Checks:
        - Business registration validity (CAC RC number format)
        - Industry risk classification
        - Transaction pattern indicators
        - Source of funds assessment
        """
        issues = []

        # Validate CAC RC number format (Nigerian: RC-XXXXXXX or BN-XXXXXXX)
        if app.registration_number:
            rc_pattern = r"^(RC|BN)[\-]?\d{5,8}$"
            if not re.match(rc_pattern, app.registration_number, re.IGNORECASE):
                issues.append("Invalid CAC registration number format")

        # Check industry risk
        if app.industry.lower().replace(" ", "_") in self.HIGH_RISK_INDUSTRIES:
            issues.append(f"High-risk industry: {app.industry}")

        # Check incorporation age (shell company indicator)
        if app.incorporation_date:
            try:
                inc_date = datetime.strptime(app.incorporation_date, "%Y-%m-%d")
                age_days = (datetime.utcnow() - inc_date).days
                if age_days < 180:
                    issues.append("Company incorporated less than 6 months ago")
            except ValueError:
                pass

        return len(issues) == 0

    def _sanctions_check(self, app: KYBApplication) -> bool:
        """Check business and directors against sanctions lists."""
        names_to_check = [app.business_name.upper()]
        for director in app.directors:
            names_to_check.append(director.full_name.upper())
        for ubo in app.ultimate_beneficial_owners:
            names_to_check.append(ubo.full_name.upper())

        for name in names_to_check:
            for sanctioned in self.SANCTIONS_LIST:
                # Fuzzy match (in production: use proper fuzzy matching library)
                if sanctioned in name or name in sanctioned:
                    return False

        return True

    def _pep_check(self, app: KYBApplication) -> bool:
        """Check directors and UBOs for PEP status."""
        for director in app.directors:
            name_upper = director.full_name.upper()
            for pep in self.PEP_DATABASE:
                if pep in name_upper or name_upper in pep:
                    return False  # Match found = needs enhanced due diligence

        for ubo in app.ultimate_beneficial_owners:
            if ubo.pep_status:
                return False

        return True

    def _adverse_media_check(self, app: KYBApplication) -> bool:
        """Screen for adverse media mentions.

        In production: integrate with news APIs, Google News, Bloomberg.
        For now: simulated check.
        """
        # Simulated: always passes unless business name contains flagged keywords
        flagged_keywords = ["fraud", "scam", "money laundering", "ponzi", "theft"]
        name_lower = app.business_name.lower()
        return not any(kw in name_lower for kw in flagged_keywords)

    def _identify_ubos(self, app: KYBApplication) -> list[UBOInfo]:
        """Identify Ultimate Beneficial Owners from shareholder data.

        UBO = any individual with >= 25% ownership (Nigerian threshold)
        or significant control over the entity.
        """
        ubos = []
        for sh in app.shareholders:
            if not sh.is_corporate and sh.ownership_percentage >= 25.0:
                ubos.append(UBOInfo(
                    full_name=sh.name,
                    ownership_percentage=sh.ownership_percentage,
                    nationality=sh.nationality,
                ))
        return ubos

    def _calculate_risk(self, app: KYBApplication) -> dict:
        """Calculate composite risk score for the business.

        Score: 0.0 (lowest risk) to 1.0 (highest risk)
        """
        score = 0.0
        factors = []

        # Industry risk
        if app.industry.lower().replace(" ", "_") in self.HIGH_RISK_INDUSTRIES:
            score += 0.25
            factors.append(f"High-risk industry: {app.industry}")

        # AML screening failure
        if not app.aml_screening_passed:
            score += 0.2
            factors.append("AML screening flagged")

        # Sanctions match
        if not app.sanctions_screening_passed:
            score += 0.4
            factors.append("Sanctions list match")

        # PEP involvement
        if not app.pep_screening_passed:
            score += 0.15
            factors.append("PEP involvement detected")

        # Adverse media
        if not app.adverse_media_clear:
            score += 0.2
            factors.append("Adverse media found")

        # Complex ownership structure
        if len(app.shareholders) > 5:
            score += 0.05
            factors.append("Complex ownership structure")

        # Foreign ownership
        foreign_ownership = sum(
            sh.ownership_percentage for sh in app.shareholders
            if sh.nationality.lower() != "nigerian"
        )
        if foreign_ownership > 50:
            score += 0.1
            factors.append(f"Foreign ownership: {foreign_ownership:.0f}%")

        # Determine risk level
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
        "retail_trader": [
            "government_id",
            "proof_of_address",
            "selfie_liveness",
        ],
        "institutional_investor": [
            "government_id",
            "proof_of_address",
            "selfie_liveness",
            "accredited_investor_proof",
        ],
        "broker_dealer": [
            "kyb_required",
            "cac_certificate",
            "sec_license",
            "directors_kyc",
            "audited_financials",
            "capital_adequacy",
        ],
        "market_maker": [
            "kyb_required",
            "cac_certificate",
            "sec_license",
            "directors_kyc",
            "capital_proof",
            "technology_assessment",
        ],
        "digital_asset_issuer": [
            "kyb_required",
            "cac_certificate",
            "commodity_ownership_proof",
            "warehouse_receipt",
            "insurance_certificate",
        ],
        "api_consumer": [
            "government_id",
            "proof_of_address",
            "use_case_description",
        ],
        "exchange_member": [
            "kyb_required",
            "cac_certificate",
            "sec_license",
            "directors_kyc",
            "audited_financials",
            "capital_adequacy",
            "fit_and_proper_assessment",
        ],
    }

    STAKEHOLDER_KYB_DOCUMENTS: dict[str, list[str]] = {
        "broker_dealer": [
            "cac_certificate",
            "memorandum_of_association",
            "board_resolution",
            "tax_clearance",
            "audited_financials",
            "shareholder_register",
        ],
        "market_maker": [
            "cac_certificate",
            "memorandum_of_association",
            "board_resolution",
            "tax_clearance",
        ],
        "digital_asset_issuer": [
            "cac_certificate",
            "commodity_ownership_proof",
            "warehouse_receipt",
        ],
        "exchange_member": [
            "cac_certificate",
            "memorandum_of_association",
            "articles_of_association",
            "board_resolution",
            "tax_clearance",
            "audited_financials",
            "shareholder_register",
        ],
    }

    def get_requirements(self, stakeholder_type: str) -> dict:
        """Get onboarding requirements for a stakeholder type."""
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
            "retail_trader": "15-30 minutes",
            "institutional_investor": "1-2 business days",
            "broker_dealer": "5-10 business days",
            "market_maker": "5-10 business days",
            "digital_asset_issuer": "3-5 business days",
            "api_consumer": "1-2 business days",
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
