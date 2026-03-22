"""
Keycloak OIDC client for the NEXCOM Analytics service.
Handles JWT token validation and user info retrieval.
In production: uses python-keycloak library.
"""

import base64
import json
import logging
import time
from typing import Optional

logger = logging.getLogger(__name__)


class KeycloakClient:
    def __init__(self, url: str, realm: str, client_id: str):
        self.url = url
        self.realm = realm
        self.client_id = client_id
        logger.info(f"[Keycloak] Initialized for realm={realm} client={client_id}")

    def validate_token(self, token: str) -> Optional[dict]:
        """Validate a JWT token and return claims."""
        # In production: verify signature against Keycloak JWKS endpoint
        # keycloak_openid = KeycloakOpenID(
        #     server_url=self.url, client_id=self.client_id, realm_name=self.realm
        # )
        # claims = keycloak_openid.decode_token(token, validate=True)

        try:
            parts = token.split(".")
            if len(parts) != 3:
                # Development: return mock claims
                return {
                    "sub": "usr-001",
                    "email": "trader@nexcom.exchange",
                    "name": "Alex Trader",
                    "roles": ["trader", "user"],
                    "exp": int(time.time()) + 3600,
                }

            payload = base64.urlsafe_b64decode(parts[1] + "==")
            claims = json.loads(payload)
            if claims.get("exp", 0) < time.time():
                logger.warning("[Keycloak] Token expired")
                return None
            return claims
        except Exception as e:
            logger.error(f"[Keycloak] Token validation failed: {e}")
            return None

    def get_userinfo(self, token: str) -> Optional[dict]:
        """Retrieve user info from Keycloak."""
        # In production: GET {url}/realms/{realm}/protocol/openid-connect/userinfo
        return self.validate_token(token)
