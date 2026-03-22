"""Keycloak JWT validation middleware for NEXCOM Python services.

Validates Bearer tokens issued by Keycloak using JWKS (JSON Web Key Sets).
Enforces role-based access control using Keycloak realm roles and client roles.
Integrates with Permify for fine-grained resource authorization.
"""
from __future__ import annotations

import os
import time
from functools import lru_cache
from typing import Any, Dict, List, Optional

import httpx
from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwk, jwt
from jose.utils import base64url_decode

# ── Configuration ──────────────────────────────────────────────────────────────
KEYCLOAK_URL = os.getenv("KEYCLOAK_URL", "http://localhost:8080")
KEYCLOAK_REALM = os.getenv("KEYCLOAK_REALM", "nexcom")
KEYCLOAK_CLIENT_ID = os.getenv("KEYCLOAK_CLIENT_ID", "nexcom-api")
JWKS_URL = f"{KEYCLOAK_URL}/realms/{KEYCLOAK_REALM}/protocol/openid-connect/certs"
ISSUER = f"{KEYCLOAK_URL}/realms/{KEYCLOAK_REALM}"

# JWKS cache TTL (seconds) — refresh keys every 5 minutes
JWKS_CACHE_TTL = 300

# ── JWKS Cache ─────────────────────────────────────────────────────────────────
_jwks_cache: Optional[Dict] = None
_jwks_cached_at: float = 0.0


async def get_jwks() -> Dict:
    """Fetch and cache JWKS from Keycloak. Refreshes every JWKS_CACHE_TTL seconds."""
    global _jwks_cache, _jwks_cached_at
    now = time.time()
    if _jwks_cache is None or (now - _jwks_cached_at) > JWKS_CACHE_TTL:
        async with httpx.AsyncClient(timeout=10.0) as client:
            try:
                resp = await client.get(JWKS_URL)
                resp.raise_for_status()
                _jwks_cache = resp.json()
                _jwks_cached_at = now
            except httpx.HTTPError as e:
                if _jwks_cache is None:
                    raise HTTPException(
                        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                        detail=f"Keycloak JWKS unavailable: {e}",
                    )
                # Use stale cache if Keycloak is temporarily unavailable
    return _jwks_cache


# ── Token Models ───────────────────────────────────────────────────────────────
class TokenClaims:
    """Parsed and validated JWT claims from Keycloak."""

    def __init__(self, payload: Dict[str, Any]):
        self.sub: str = payload.get("sub", "")
        self.email: str = payload.get("email", "")
        self.name: str = payload.get("name", "")
        self.preferred_username: str = payload.get("preferred_username", "")
        self.realm_roles: List[str] = (
            payload.get("realm_access", {}).get("roles", [])
        )
        self.client_roles: List[str] = (
            payload.get("resource_access", {})
            .get(KEYCLOAK_CLIENT_ID, {})
            .get("roles", [])
        )
        self.all_roles: List[str] = list(set(self.realm_roles + self.client_roles))
        self.exp: int = payload.get("exp", 0)
        self.iat: int = payload.get("iat", 0)
        self.iss: str = payload.get("iss", "")
        self.jti: str = payload.get("jti", "")
        self.raw: Dict[str, Any] = payload

    def has_role(self, role: str) -> bool:
        """Check if the token contains a specific role."""
        return role in self.all_roles

    def has_any_role(self, *roles: str) -> bool:
        """Check if the token contains any of the specified roles."""
        return any(role in self.all_roles for role in roles)

    def has_all_roles(self, *roles: str) -> bool:
        """Check if the token contains all of the specified roles."""
        return all(role in self.all_roles for role in roles)

    @property
    def is_admin(self) -> bool:
        return self.has_any_role("nexcom-admin", "realm-admin", "admin")

    @property
    def is_compliance_officer(self) -> bool:
        return self.has_any_role("compliance-officer", "kyc-reviewer", "aml-analyst")

    @property
    def is_trader(self) -> bool:
        return self.has_any_role("trader", "institutional-trader", "retail-trader")

    @property
    def is_dfsp(self) -> bool:
        return self.has_role("dfsp-operator")


# ── JWT Validation ─────────────────────────────────────────────────────────────
async def validate_token(token: str) -> TokenClaims:
    """Validate a JWT token against Keycloak JWKS and return parsed claims."""
    try:
        # Decode header to get key ID (kid)
        unverified_header = jwt.get_unverified_header(token)
        kid = unverified_header.get("kid")
        alg = unverified_header.get("alg", "RS256")

        # Fetch JWKS and find matching key
        jwks = await get_jwks()
        matching_key = None
        for key_data in jwks.get("keys", []):
            if key_data.get("kid") == kid:
                matching_key = key_data
                break

        if matching_key is None:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="JWT key ID not found in JWKS",
            )

        # Construct public key and verify token
        public_key = jwk.construct(matching_key)
        payload = jwt.decode(
            token,
            public_key,
            algorithms=[alg],
            issuer=ISSUER,
            options={
                "verify_exp": True,
                "verify_iat": True,
                "verify_iss": True,
            },
        )

        return TokenClaims(payload)

    except JWTError as e:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Invalid JWT token: {e}",
            headers={"WWW-Authenticate": "Bearer"},
        )


# ── FastAPI Dependencies ───────────────────────────────────────────────────────
security = HTTPBearer(auto_error=False)


async def get_current_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security),
) -> TokenClaims:
    """FastAPI dependency: validates Bearer token and returns claims."""
    if credentials is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authorization header missing",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return await validate_token(credentials.credentials)


async def get_optional_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security),
) -> Optional[TokenClaims]:
    """FastAPI dependency: returns claims if token present, None otherwise."""
    if credentials is None:
        return None
    try:
        return await validate_token(credentials.credentials)
    except HTTPException:
        return None


def require_role(*roles: str):
    """Dependency factory: requires at least one of the specified roles."""
    async def _check(user: TokenClaims = Depends(get_current_user)) -> TokenClaims:
        if not user.has_any_role(*roles):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Required roles: {list(roles)}. User has: {user.all_roles}",
            )
        return user
    return _check


def require_all_roles(*roles: str):
    """Dependency factory: requires all of the specified roles."""
    async def _check(user: TokenClaims = Depends(get_current_user)) -> TokenClaims:
        if not user.has_all_roles(*roles):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"All required roles: {list(roles)}. User has: {user.all_roles}",
            )
        return user
    return _check


# ── Convenience role dependencies ─────────────────────────────────────────────
require_admin = require_role("nexcom-admin", "realm-admin", "admin")
require_compliance = require_role("compliance-officer", "kyc-reviewer", "aml-analyst")
require_trader = require_role("trader", "institutional-trader", "retail-trader")
require_dfsp = require_role("dfsp-operator")
