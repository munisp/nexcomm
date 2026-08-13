"""
Permify fine-grained authorization client for the NEXCOM Analytics service.
Uses the Permify REST API for relationship-based access control (ReBAC).
Fails closed when Permify is not reachable or rejects an authorization request.
"""
import logging
import os
from typing import Optional

import requests

logger = logging.getLogger(__name__)

PERMIFY_URL = os.getenv("PERMIFY_URL", "http://permify:3476")
PERMIFY_TENANT = os.getenv("PERMIFY_TENANT", "nexcom")


class PermifyClient:
    def __init__(self, endpoint: str = PERMIFY_URL):
        self.endpoint = endpoint.rstrip("/")
        self.tenant = PERMIFY_TENANT
        self._connected = False
        self._check_connection()

    def _check_connection(self) -> None:
        try:
            resp = requests.get(f"{self.endpoint}/healthz", timeout=3)
            self._connected = resp.status_code == 200
            if self._connected:
                logger.info("[Permify] Connected to %s", self.endpoint)
            else:
                logger.warning("[Permify] Health check returned %d", resp.status_code)
        except Exception as exc:
            self._connected = False
            logger.warning("[Permify] Not reachable (%s); authorization will fail closed", exc)

    def check(
        self,
        entity_type: str,
        entity_id: str,
        permission: str,
        subject_type: str,
        subject_id: str,
    ) -> bool:
        """Check if a subject has a permission on an entity via Permify REST API."""
        if not self._connected:
            self._check_connection()
        if not self._connected:
            logger.warning("[Permify] Denying %s:%s#%s@%s:%s because Permify is unavailable",
                           entity_type, entity_id, permission, subject_type, subject_id)
            return False
        try:
            payload = {
                "metadata": {"schema_version": "", "snap_token": "", "depth": 20},
                "entity": {"type": entity_type, "id": entity_id},
                "permission": permission,
                "subject": {"type": subject_type, "id": subject_id},
            }
            resp = requests.post(
                f"{self.endpoint}/v1/tenants/{self.tenant}/permissions/check",
                json=payload,
                timeout=5,
            )
            if resp.status_code == 200:
                data = resp.json()
                result = data.get("can") == "CHECK_RESULT_ALLOWED"
                logger.debug("[Permify] %s:%s#%s@%s:%s → %s",
                             entity_type, entity_id, permission, subject_type, subject_id,
                             "ALLOW" if result else "DENY")
                return result
            logger.warning("[Permify] Check returned %d; denying request", resp.status_code)
            return False
        except Exception as exc:
            self._connected = False
            logger.warning("[Permify] Check failed (%s); denying request", exc)
            return False

    def write_relationship(
        self,
        entity_type: str,
        entity_id: str,
        relation: str,
        subject_type: str,
        subject_id: str,
    ) -> bool:
        """Create a relationship tuple in Permify and report real completion."""
        if not self._connected:
            self._check_connection()
        if not self._connected:
            logger.error("[Permify] WriteRelationship refused because Permify is unavailable")
            return False
        try:
            payload = {
                "metadata": {"schema_version": ""},
                "tuples": [{
                    "entity": {"type": entity_type, "id": entity_id},
                    "relation": relation,
                    "subject": {"type": subject_type, "id": subject_id},
                }],
            }
            resp = requests.post(
                f"{self.endpoint}/v1/tenants/{self.tenant}/relationships/write",
                json=payload,
                timeout=5,
            )
            if resp.status_code in (200, 201):
                return True
            logger.warning("[Permify] WriteRelationship returned %d", resp.status_code)
            return False
        except Exception as exc:
            self._connected = False
            logger.warning("[Permify] WriteRelationship failed: %s", exc)
            return False

    def check_analytics_access(self, user_id: str, report_type: str) -> bool:
        return self.check("report", report_type, "view", "user", user_id)

    def is_connected(self) -> bool:
        return self._connected

    def close(self) -> None:
        self._connected = False
        logger.info("[Permify] Connection closed")
