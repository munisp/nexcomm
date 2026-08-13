#!/usr/bin/env python3
"""Loopback-only contract double for local smoke-harness validation.

This server is intentionally *not* a staging implementation. It validates only
that tests/integration/secured_staging_e2e.py sends the expected requests and
handles authorization/login contract branches. It never emulates financial,
ledger, persistence, workflow, or external-service behavior.
"""
from __future__ import annotations

import ipaddress
import json
import os
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HOST = os.environ.get("LOCAL_SMOKE_BIND_HOST", "127.0.0.1")
PORT = int(os.environ.get("LOCAL_SMOKE_PORT", "18090"))
MODE = os.environ.get("LOCAL_SMOKE_TEST_MODE", "")
USERNAME = os.environ.get("LOCAL_SMOKE_TEST_USERNAME", "local-smoke-user")
PASSWORD = os.environ.get("LOCAL_SMOKE_TEST_PASSWORD", "local-smoke-password")
TOKEN = "LOCAL_TEST_ONLY_ACCESS_TOKEN"


def require_safe_mode() -> None:
    if MODE != "1":
        raise SystemExit("LOCAL_SMOKE_TEST_MODE=1 is required")
    try:
        address = ipaddress.ip_address(HOST)
    except ValueError as exc:
        raise SystemExit(f"LOCAL_SMOKE_BIND_HOST must be an IP address: {exc}") from exc
    if not address.is_loopback:
        raise SystemExit("local smoke server may bind only to a loopback address")
    if os.environ.get("ENVIRONMENT", "").lower() in {"staging", "production", "prod"}:
        raise SystemExit("local smoke server refuses ENVIRONMENT=staging/production")


class Handler(BaseHTTPRequestHandler):
    server_version = "NexcomLocalSmokeContract/1.0"

    def log_message(self, format: str, *args: object) -> None:
        # Do not log request bodies or Authorization headers.
        print("LOCAL_TEST_ONLY", self.address_string(), format % args, flush=True)

    def send_json(self, status: int, payload: dict[str, object]) -> None:
        body = json.dumps({"test_only": True, **payload}).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:  # noqa: N802
        path = self.path.split("?", 1)[0]
        if path == "/api/v1/health":
            self.send_json(HTTPStatus.OK, {"status": "local-contract-healthy"})
        elif path == "/realms/nexcom/.well-known/openid-configuration":
            origin = f"http://{HOST}:{PORT}"
            self.send_json(HTTPStatus.OK, {
                "issuer": f"{origin}/realms/nexcom",
                "token_endpoint": f"{origin}/realms/nexcom/protocol/openid-connect/token",
            })
        elif path in {"/healthz", "/", "/v1.0/healthz"}:
            self.send_json(HTTPStatus.OK, {"status": "local-contract-healthy", "path": path})
        elif path == "/api/v1/platform/health":
            if self.headers.get("Authorization") == f"Bearer {TOKEN}":
                self.send_json(HTTPStatus.OK, {"status": "local-contract-authenticated"})
            else:
                self.send_json(HTTPStatus.UNAUTHORIZED, {"error": "test-only authorization required"})
        else:
            self.send_json(HTTPStatus.NOT_FOUND, {"error": "local contract route not defined"})

    def do_POST(self) -> None:  # noqa: N802
        path = self.path.split("?", 1)[0]
        if path != "/api/v1/auth/login":
            self.send_json(HTTPStatus.NOT_FOUND, {"error": "local contract route not defined"})
            return
        length = int(self.headers.get("Content-Length", "0"))
        try:
            payload = json.loads(self.rfile.read(length).decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            self.send_json(HTTPStatus.BAD_REQUEST, {"error": "invalid JSON"})
            return
        if payload.get("username") == USERNAME and payload.get("password") == PASSWORD:
            self.send_json(HTTPStatus.OK, {"access_token": TOKEN, "token_type": "Bearer"})
        else:
            self.send_json(HTTPStatus.UNAUTHORIZED, {"error": "test-only credentials rejected"})


def main() -> None:
    require_safe_mode()
    print(f"LOCAL_TEST_ONLY_SERVER=http://{HOST}:{PORT}", flush=True)
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()


if __name__ == "__main__":
    main()
