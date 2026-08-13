# Local Smoke Harness Guide

**Author:** Manus AI
**Purpose:** Exercise the request, authorization, OIDC-discovery, login-token, and protected-health branches of `tests/integration/secured_staging_e2e.py` against a loopback-only **test contract server**.

> **Evidence boundary:** This harness provides `LOCAL_TEST_ONLY_CONTRACT` evidence. It does **not** validate a live gateway, Keycloak, Permify, Temporal, Dapr, PostgreSQL, TigerBeetle, Redis, Kafka/Fluvio, APISIX, signatures, Kubernetes health, financial state, durability, authorization policy, or staging configuration.

## 1. Safety Controls

The test server at `tests/local_contract/local_smoke_gateway.py` is deliberately narrow. It binds only to an IP loopback address and refuses to start unless `LOCAL_SMOKE_TEST_MODE=1` and `ENVIRONMENT` is neither `staging` nor `production`. It implements only the small HTTP contract required to prove the smoke client’s request sequencing:

| Route class | Local contract behavior | What it does not emulate |
|---|---|---|
| Gateway health | Returns a test-only HTTP 200 marker. | Service dependencies, database, or real readiness. |
| OIDC discovery | Returns syntactically valid issuer and token endpoint fields. | Keycloak, signed tokens, users, realms, or JWKS. |
| Dependency health | Returns a test-only HTTP 200 marker for Permify, Temporal, and Dapr paths. | Any corresponding dependency. |
| Protected platform health | Returns HTTP 401 without the local contract token and HTTP 200 with it. | Gateway middleware or authorization policy. |
| Login | Returns a deterministic test-only token only for local test credentials. | Keycloak grant flow, password storage, client credentials, or token verification. |

The smoke client was hardened so that a loopback URL is rejected unless `LOCAL_SMOKE_TEST_MODE=1`. Conversely, local test mode rejects non-loopback endpoints. Every result contains `evidence_class: LOCAL_TEST_ONLY_CONTRACT` when local mode is active.

## 2. Run the Test-Only Contract Harness

```bash
cd /path/to/nexcomm
chmod 700 tests/local_contract/run_local_smoke_contract.sh \
  tests/local_contract/local_smoke_gateway.py

LOCAL_SMOKE_TEST_MODE=1 \
ENVIRONMENT=local-test \
./tests/local_contract/run_local_smoke_contract.sh
```

The launcher starts the loopback server at `127.0.0.1:18090`, waits for its test health route, invokes the unmodified smoke suite with all five endpoint variables set to that loopback server, and stops the process on exit. It writes:

| Artifact | Purpose |
|---|---|
| `test-results/local_smoke_contract_result.json` | Machine-readable contract result, explicitly labelled `LOCAL_TEST_ONLY_CONTRACT`. |
| `test-results/local_smoke_contract_run.log` | Existing smoke-suite console output. |
| `test-results/local_smoke_contract_server.log` | Loopback server request log without credentials or authorization headers. |
| `test-results/local_smoke_contract_launcher.log` | Launcher output and artifact locations. |

## 3. Expected Result

The local harness should report ten passing request/contract assertions and zero failures:

```text
passed: 10
failed: 0
skipped: 0
evidence_class: LOCAL_TEST_ONLY_CONTRACT
```

A failure proves only a local smoke-client or local contract discrepancy. It must not be converted into an assertion about shared staging until the same test runs against real, isolated staging endpoints.

## 4. Verify the Misclassification Guard

The following negative test must fail. It demonstrates that a local endpoint cannot accidentally generate `LIVE_STAGING` pass evidence:

```bash
# With a loopback endpoint and without LOCAL_SMOKE_TEST_MODE=1, the smoke client
# exits non-zero with: "STAGING_GATEWAY_URL is a loopback endpoint; ... required".
ENVIRONMENT=staging \
STAGING_GATEWAY_URL=http://127.0.0.1:18090 \
STAGING_KEYCLOAK_URL=http://127.0.0.1:18090 \
STAGING_PERMIFY_URL=http://127.0.0.1:18090 \
STAGING_TEMPORAL_HEALTH_URL=http://127.0.0.1:18090 \
STAGING_DAPR_HEALTH_URL=http://127.0.0.1:18090 \
python3 tests/integration/secured_staging_e2e.py
```

## 5. Required Evidence for Real Staging

Before using this smoke suite as staging evidence, remove every `LOCAL_SMOKE_*` setting, set the five `STAGING_*_URL` variables to real HTTPS endpoints, supply a dedicated low-privilege test account, and retain the signed raw results plus Kubernetes deployment/pod health. A passing local contract test never clears these requirements.
