#!/usr/bin/env python3
"""Secured NEXCOMM staging integration tests.

The suite intentionally refuses to synthesize endpoints, credentials, tokens, or
service responses. It uses environment-provided URLs and a real staging test
account, then emits a JSON result suitable for CI evidence collection.
"""
from __future__ import annotations

import json
import os
import sys
import time
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urljoin, urlparse
import ipaddress
from urllib.request import Request, urlopen

TIMEOUT_SECONDS = int(os.environ.get("STAGING_E2E_TIMEOUT_SECONDS", "15"))
RESULT_PATH = Path(os.environ.get("STAGING_E2E_RESULT_PATH", "tests/integration/secured_staging_result.json"))


@dataclass
class Result:
    name: str
    status: str
    detail: str
    elapsed_ms: int


results: list[Result] = []


def endpoint(variable: str) -> str:
    value = os.environ.get(variable, "").strip()
    if not value:
        raise RuntimeError(f"{variable} is required; no synthetic endpoint will be used")
    parsed = urlparse(value)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise RuntimeError(f"{variable} must be an absolute HTTP(S) URL")
    try:
        is_loopback = ipaddress.ip_address(parsed.hostname).is_loopback
    except ValueError:
        is_loopback = parsed.hostname.lower() == "localhost"
    local_mode = os.environ.get("LOCAL_SMOKE_TEST_MODE", "") == "1"
    if is_loopback and not local_mode:
        raise RuntimeError(f"{variable} is a loopback endpoint; LOCAL_SMOKE_TEST_MODE=1 is required")
    if local_mode and not is_loopback:
        raise RuntimeError(f"{variable} must be loopback in LOCAL_SMOKE_TEST_MODE")
    return value.rstrip("/")


def request_json(name: str, method: str, base_url: str, path: str, *, body: dict[str, Any] | None = None,
                 headers: dict[str, str] | None = None, expected: tuple[int, ...] = (200,)) -> tuple[int, Any]:
    start = time.monotonic()
    payload = json.dumps(body).encode() if body is not None else None
    request_headers = {"Accept": "application/json"}
    if payload is not None:
        request_headers["Content-Type"] = "application/json"
    if headers:
        request_headers.update(headers)
    request = Request(urljoin(base_url + "/", path.lstrip("/")), data=payload, method=method, headers=request_headers)
    try:
        with urlopen(request, timeout=TIMEOUT_SECONDS) as response:
            status = response.status
            raw = response.read().decode("utf-8", errors="replace")
    except HTTPError as exc:
        status = exc.code
        raw = exc.read().decode("utf-8", errors="replace")
    except URLError as exc:
        elapsed = int((time.monotonic() - start) * 1000)
        results.append(Result(name, "FAIL", f"network error: {exc.reason}", elapsed))
        return 0, None
    except Exception as exc:  # no silent success
        elapsed = int((time.monotonic() - start) * 1000)
        results.append(Result(name, "FAIL", f"request error: {exc}", elapsed))
        return 0, None

    elapsed = int((time.monotonic() - start) * 1000)
    try:
        parsed: Any = json.loads(raw) if raw else None
    except json.JSONDecodeError:
        parsed = raw
    if status in expected:
        results.append(Result(name, "PASS", f"HTTP {status}", elapsed))
    else:
        preview = raw[:400].replace("\n", " ")
        results.append(Result(name, "FAIL", f"HTTP {status}; expected {expected}; body={preview}", elapsed))
    return status, parsed


def skip(name: str, detail: str) -> None:
    results.append(Result(name, "SKIP", detail, 0))


def main() -> int:
    try:
        gateway = endpoint("STAGING_GATEWAY_URL")
        keycloak = endpoint("STAGING_KEYCLOAK_URL")
        permify = endpoint("STAGING_PERMIFY_URL")
        temporal = endpoint("STAGING_TEMPORAL_HEALTH_URL")
        dapr = endpoint("STAGING_DAPR_HEALTH_URL")
    except RuntimeError as exc:
        results.append(Result("configuration_preflight", "FAIL", str(exc), 0))
        return finish()

    request_json("gateway_health", "GET", gateway, "/api/v1/health", expected=(200,))
    _, discovery = request_json(
        "keycloak_oidc_discovery", "GET", keycloak,
        "/realms/" + os.environ.get("KEYCLOAK_REALM", "nexcom") + "/.well-known/openid-configuration",
        expected=(200,),
    )
    if isinstance(discovery, dict) and discovery.get("issuer") and discovery.get("token_endpoint"):
        results.append(Result("keycloak_discovery_contract", "PASS", "issuer and token endpoint present", 0))
    else:
        results.append(Result("keycloak_discovery_contract", "FAIL", "OIDC discovery missing issuer or token_endpoint", 0))

    request_json("permify_health", "GET", permify, "/healthz", expected=(200,))
    request_json("temporal_health", "GET", temporal, "/", expected=(200, 204))
    request_json("dapr_sidecar_health", "GET", dapr, "/v1.0/healthz", expected=(200, 204))

    # Fail-closed authorization must reject unauthenticated requests.
    request_json(
        "gateway_rejects_unauthenticated_platform_health",
        "GET", gateway, "/api/v1/platform/health", expected=(401, 403),
    )

    username = os.environ.get("STAGING_TEST_USERNAME", "").strip()
    password = os.environ.get("STAGING_TEST_PASSWORD", "").strip()
    if not username or not password:
        skip("gateway_keycloak_login", "STAGING_TEST_USERNAME and STAGING_TEST_PASSWORD were not supplied")
        skip("gateway_authenticated_platform_health", "requires a real staging test account")
        return finish()

    _, login = request_json(
        "gateway_keycloak_login", "POST", gateway, "/api/v1/auth/login",
        body={"username": username, "password": password}, expected=(200,),
    )
    token = ""
    if isinstance(login, dict):
        token = str(login.get("access_token") or login.get("accessToken") or login.get("token") or "")
        data = login.get("data")
        if not token and isinstance(data, dict):
            token = str(data.get("access_token") or data.get("accessToken") or data.get("token") or "")
    if not token:
        results.append(Result("gateway_login_token_contract", "FAIL", "successful login contained no access token", 0))
        skip("gateway_authenticated_platform_health", "login token unavailable")
        return finish()

    results.append(Result("gateway_login_token_contract", "PASS", "access token present", 0))
    request_json(
        "gateway_authenticated_platform_health", "GET", gateway, "/api/v1/platform/health",
        headers={"Authorization": f"Bearer {token}"}, expected=(200,),
    )
    return finish()


def finish() -> int:
    RESULT_PATH.parent.mkdir(parents=True, exist_ok=True)
    summary = {
        "evidence_class": "LOCAL_TEST_ONLY_CONTRACT" if os.environ.get("LOCAL_SMOKE_TEST_MODE") == "1" else "LIVE_STAGING",
        "generated_at_epoch": int(time.time()),
        "results": [asdict(item) for item in results],
        "counts": {
            "passed": sum(item.status == "PASS" for item in results),
            "failed": sum(item.status == "FAIL" for item in results),
            "skipped": sum(item.status == "SKIP" for item in results),
        },
    }
    RESULT_PATH.write_text(json.dumps(summary, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(summary, indent=2))
    return 0 if summary["counts"]["failed"] == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
