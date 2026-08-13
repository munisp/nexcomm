"""
Keycloak OIDC client for the NEXCOM Analytics service.
Validates JWT tokens against the Keycloak JWKS endpoint.
Fails closed when Keycloak or the JWT verification dependency is unavailable.
"""
import logging
import os
import time
from typing import Optional

import requests

logger = logging.getLogger(__name__)

KEYCLOAK_URL = os.getenv("KEYCLOAK_URL", "http://keycloak:8080")
KEYCLOAK_REALM = os.getenv("KEYCLOAK_REALM", "nexcom")
KEYCLOAK_CLIENT_ID = os.getenv("KEYCLOAK_CLIENT_ID", "nexcom-app")


class KeycloakClient:
    def __init__(self, url: str = KEYCLOAK_URL, realm: str = KEYCLOAK_REALM, client_id: str = KEYCLOAK_CLIENT_ID):
        self.url = url.rstrip("/")
        self.realm = realm
        self.client_id = client_id
        self._jwks: dict | None = None
        self._jwks_fetched_at: float = 0
        self._jwks_ttl: float = 300.0  # refresh JWKS every 5 minutes
        logger.info("[Keycloak] Initialized for realm=%s client=%s", realm, client_id)

    @property
    def _jwks_uri(self) -> str:
        return f"{self.url}/realms/{self.realm}/protocol/openid-connect/certs"

    @property
    def _userinfo_uri(self) -> str:
        return f"{self.url}/realms/{self.realm}/protocol/openid-connect/userinfo"

    def _get_jwks(self) -> dict | None:
        """Fetch JWKS from Keycloak, cached for 5 minutes."""
        now = time.time()
        if self._jwks is not None and (now - self._jwks_fetched_at) < self._jwks_ttl:
            return self._jwks
        try:
            resp = requests.get(self._jwks_uri, timeout=5)
            resp.raise_for_status()
            self._jwks = resp.json()
            self._jwks_fetched_at = now
            logger.debug("[Keycloak] JWKS refreshed (%d keys)", len(self._jwks.get("keys", [])))
            return self._jwks
        except Exception as exc:
            logger.warning("[Keycloak] JWKS fetch failed: %s", exc)
            return self._jwks  # return stale cache if available

    def validate_token(self, token: str) -> Optional[dict]:
        """Validate a JWT token against Keycloak JWKS and return claims."""
        if not token:
            return None
        # Try PyJWT with JWKS validation first
        try:
            import jwt as pyjwt  # type: ignore
            from jwt import PyJWKClient  # type: ignore
            jwks_client = PyJWKClient(self._jwks_uri, cache_keys=True, max_cached_keys=16)
            signing_key = jwks_client.get_signing_key_from_jwt(token)
            claims = pyjwt.decode(
                token,
                signing_key.key,
                algorithms=["RS256", "ES256"],
                audience=self.client_id,
                options={"verify_exp": True},
            )
            return claims
        except ImportError:
            logger.error("[Keycloak] PyJWT is required for signature verification")
            return None
        except Exception as exc:
            logger.warning("[Keycloak] JWT validation failed: %s", exc)
            return None

    def get_userinfo(self, token: str) -> Optional[dict]:
        """Retrieve user info from Keycloak userinfo endpoint."""
        try:
            resp = requests.get(
                self._userinfo_uri,
                headers={"Authorization": f"Bearer {token}"},
                timeout=5,
            )
            if resp.status_code == 200:
                return resp.json()
            logger.warning("[Keycloak] Userinfo returned %d", resp.status_code)
        except Exception as exc:
            logger.warning("[Keycloak] Userinfo request failed: %s", exc)
        # Fallback to token claims
        return self.validate_token(token)
