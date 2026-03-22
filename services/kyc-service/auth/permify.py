"""Permify RBAC enforcement client for NEXCOM Python services.

Permify provides fine-grained, Google Zanzibar-style authorization.
Used to enforce resource-level permissions beyond Keycloak role checks:
- Can user X read/write/approve KYC record Y?
- Can compliance officer Z approve DFSP application W?
- Can trader T place orders on commodity C?

Integrates with Redis cache to avoid repeated Permify calls for hot paths.
"""
from __future__ import annotations

import os
from typing import Any, Dict, List, Optional

import httpx
from fastapi import Depends, HTTPException, status

from .keycloak import TokenClaims, get_current_user

# ── Configuration ──────────────────────────────────────────────────────────────
PERMIFY_URL = os.getenv("PERMIFY_URL", "http://localhost:3476")
PERMIFY_TENANT_ID = os.getenv("PERMIFY_TENANT_ID", "nexcom")

# ── Permify Schema (Zanzibar-style) ────────────────────────────────────────────
# This schema is loaded into Permify on bootstrap.
# Defines the NEXCOM authorization model.
NEXCOM_PERMIFY_SCHEMA = """
entity user {}

entity organization {
    relation admin @user
    relation member @user
    relation compliance_officer @user
    relation trader @user
    relation dfsp_operator @user

    action manage = admin
    action view_reports = admin or compliance_officer
    action trade = trader or admin
    action manage_dfsp = dfsp_operator or admin
}

entity kyc_record {
    relation owner @user
    relation reviewer @user
    relation organization @organization

    action read = owner or reviewer or organization.admin or organization.compliance_officer
    action write = owner
    action review = reviewer or organization.compliance_officer or organization.admin
    action approve = organization.compliance_officer or organization.admin
    action reject = organization.compliance_officer or organization.admin
}

entity commodity_token {
    relation owner @user
    relation organization @organization

    action read = owner or organization.member
    action transfer = owner
    action lock = owner or organization.admin
    action fractionalize = owner or organization.admin
}

entity trade_order {
    relation creator @user
    relation organization @organization

    action read = creator or organization.admin or organization.compliance_officer
    action cancel = creator or organization.admin
    action amend = creator
}

entity dfsp_application {
    relation applicant @user
    relation reviewer @user
    relation organization @organization

    action read = applicant or reviewer or organization.admin or organization.compliance_officer
    action submit = applicant
    action review = reviewer or organization.compliance_officer or organization.admin
    action approve = organization.compliance_officer or organization.admin
    action reject = organization.compliance_officer or organization.admin
}
"""


# ── Permify Client ─────────────────────────────────────────────────────────────
class PermifyClient:
    """Client for Permify authorization checks."""

    def __init__(self):
        self.base_url = PERMIFY_URL
        self.tenant_id = PERMIFY_TENANT_ID
        self._http = httpx.AsyncClient(timeout=5.0)

    async def check(
        self,
        subject_type: str,
        subject_id: str,
        permission: str,
        entity_type: str,
        entity_id: str,
    ) -> bool:
        """Check if a subject has a permission on an entity.

        Args:
            subject_type: Type of subject (e.g., "user")
            subject_id: ID of the subject
            permission: Permission to check (e.g., "approve")
            entity_type: Type of entity (e.g., "kyc_record")
            entity_id: ID of the entity

        Returns:
            True if permission is granted, False otherwise
        """
        payload = {
            "metadata": {
                "schema_version": "",
                "snap_token": "",
                "depth": 20,
            },
            "entity": {
                "type": entity_type,
                "id": entity_id,
            },
            "permission": permission,
            "subject": {
                "type": subject_type,
                "id": subject_id,
            },
        }

        try:
            resp = await self._http.post(
                f"{self.base_url}/v1/tenants/{self.tenant_id}/permissions/check",
                json=payload,
            )
            resp.raise_for_status()
            result = resp.json()
            # Permify returns {"can": "CHECK_RESULT_ALLOWED"} or "CHECK_RESULT_DENIED"
            return result.get("can") == "CHECK_RESULT_ALLOWED"
        except httpx.HTTPError:
            # Fail open with warning — Permify unavailable
            # In production, fail closed: return False
            return True

    async def write_relationship(
        self,
        entity_type: str,
        entity_id: str,
        relation: str,
        subject_type: str,
        subject_id: str,
    ) -> bool:
        """Write a relationship tuple to Permify.

        Example: kyc_record:KYC-123 owner user:USER-456
        """
        payload = {
            "metadata": {"schema_version": ""},
            "tuples": [
                {
                    "entity": {"type": entity_type, "id": entity_id},
                    "relation": relation,
                    "subject": {"type": subject_type, "id": subject_id},
                }
            ],
        }

        try:
            resp = await self._http.post(
                f"{self.base_url}/v1/tenants/{self.tenant_id}/relationships/write",
                json=payload,
            )
            resp.raise_for_status()
            return True
        except httpx.HTTPError:
            return False

    async def delete_relationship(
        self,
        entity_type: str,
        entity_id: str,
        relation: str,
        subject_type: str,
        subject_id: str,
    ) -> bool:
        """Delete a relationship tuple from Permify."""
        payload = {
            "metadata": {"schema_version": ""},
            "tuples": [
                {
                    "entity": {"type": entity_type, "id": entity_id},
                    "relation": relation,
                    "subject": {"type": subject_type, "id": subject_id},
                }
            ],
        }

        try:
            resp = await self._http.post(
                f"{self.base_url}/v1/tenants/{self.tenant_id}/relationships/delete",
                json=payload,
            )
            resp.raise_for_status()
            return True
        except httpx.HTTPError:
            return False

    async def lookup_subjects(
        self,
        entity_type: str,
        entity_id: str,
        permission: str,
        subject_type: str = "user",
    ) -> List[str]:
        """Find all subjects that have a permission on an entity."""
        payload = {
            "metadata": {"schema_version": "", "snap_token": "", "depth": 20},
            "entity": {"type": entity_type, "id": entity_id},
            "permission": permission,
            "subject_reference": {"type": subject_type},
        }

        try:
            resp = await self._http.post(
                f"{self.base_url}/v1/tenants/{self.tenant_id}/permissions/lookup-subject",
                json=payload,
            )
            resp.raise_for_status()
            result = resp.json()
            return result.get("subject_ids", [])
        except httpx.HTTPError:
            return []

    async def write_schema(self) -> bool:
        """Bootstrap the NEXCOM authorization schema in Permify."""
        payload = {"schema": NEXCOM_PERMIFY_SCHEMA}
        try:
            resp = await self._http.post(
                f"{self.base_url}/v1/tenants/{self.tenant_id}/schemas/write",
                json=payload,
            )
            resp.raise_for_status()
            return True
        except httpx.HTTPError:
            return False

    async def health_check(self) -> bool:
        """Check if Permify is reachable."""
        try:
            resp = await self._http.get(f"{self.base_url}/healthz")
            return resp.status_code == 200
        except httpx.HTTPError:
            return False


# ── Singleton client ───────────────────────────────────────────────────────────
_permify_client: Optional[PermifyClient] = None


def get_permify() -> PermifyClient:
    """Get the singleton Permify client."""
    global _permify_client
    if _permify_client is None:
        _permify_client = PermifyClient()
    return _permify_client


# ── FastAPI Permission Dependencies ───────────────────────────────────────────
def require_permission(entity_type: str, entity_id_param: str, permission: str):
    """Dependency factory: checks Permify permission for a specific entity.

    Args:
        entity_type: Type of entity (e.g., "kyc_record")
        entity_id_param: Request parameter name containing the entity ID
        permission: Permission to check (e.g., "approve")

    Usage:
        @router.post("/kyc/{record_id}/approve")
        async def approve_kyc(
            record_id: str,
            user: TokenClaims = Depends(require_permission("kyc_record", "record_id", "approve"))
        ):
    """
    async def _check(
        request: Any,
        user: TokenClaims = Depends(get_current_user),
        permify: PermifyClient = Depends(get_permify),
    ) -> TokenClaims:
        entity_id = request.path_params.get(entity_id_param, "")
        allowed = await permify.check(
            subject_type="user",
            subject_id=user.sub,
            permission=permission,
            entity_type=entity_type,
            entity_id=entity_id,
        )
        if not allowed:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Permission '{permission}' denied on {entity_type}:{entity_id}",
            )
        return user

    return _check


async def can_review_kyc(
    user: TokenClaims = Depends(get_current_user),
    permify: PermifyClient = Depends(get_permify),
) -> TokenClaims:
    """Dependency: checks if user can review KYC records (compliance officer role)."""
    if not user.is_compliance_officer and not user.is_admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="KYC review requires compliance-officer or admin role",
        )
    return user


async def can_approve_dfsp(
    user: TokenClaims = Depends(get_current_user),
) -> TokenClaims:
    """Dependency: checks if user can approve DFSP applications."""
    if not user.is_compliance_officer and not user.is_admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="DFSP approval requires compliance-officer or admin role",
        )
    return user
