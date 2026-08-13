#!/usr/bin/env bash
# Runs a loopback-only smoke-harness contract test. This is test evidence for
# request/response wiring only and is never release, staging, or integration
# evidence for external dependencies.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
host="${LOCAL_SMOKE_BIND_HOST:-127.0.0.1}"
port="${LOCAL_SMOKE_PORT:-18090}"
base_url="http://${host}:${port}"
result_path="$repo_root/test-results/local_smoke_contract_result.json"
server_log="$repo_root/test-results/local_smoke_contract_server.log"
smoke_log="$repo_root/test-results/local_smoke_contract_run.log"

if [[ "${LOCAL_SMOKE_TEST_MODE:-}" != "1" ]]; then
  echo "ERROR: LOCAL_SMOKE_TEST_MODE=1 is required" >&2
  exit 2
fi
if [[ "${ENVIRONMENT:-local-test}" =~ ^(staging|production|prod)$ ]]; then
  echo "ERROR: local contract smoke test refuses ENVIRONMENT=${ENVIRONMENT}" >&2
  exit 2
fi
if [[ "$host" != "127.0.0.1" && "$host" != "::1" ]]; then
  echo "ERROR: LOCAL_SMOKE_BIND_HOST must be loopback" >&2
  exit 2
fi

mkdir -p "$repo_root/test-results"
: > "$server_log"
: > "$smoke_log"
LOCAL_SMOKE_TEST_MODE=1 \
LOCAL_SMOKE_BIND_HOST="$host" \
LOCAL_SMOKE_PORT="$port" \
LOCAL_SMOKE_TEST_USERNAME="${LOCAL_SMOKE_TEST_USERNAME:-local-smoke-user}" \
LOCAL_SMOKE_TEST_PASSWORD="${LOCAL_SMOKE_TEST_PASSWORD:-local-smoke-password}" \
ENVIRONMENT=local-test \
python3 "$repo_root/tests/local_contract/local_smoke_gateway.py" > "$server_log" 2>&1 &
server_pid=$!
cleanup() {
  kill "$server_pid" >/dev/null 2>&1 || true
  wait "$server_pid" >/dev/null 2>&1 || true
}
trap cleanup EXIT

for _ in $(seq 1 30); do
  if curl --fail --silent --show-error "$base_url/api/v1/health" >/dev/null 2>&1; then break; fi
  sleep 0.1
done
if ! curl --fail --silent --show-error "$base_url/api/v1/health" >/dev/null; then
  echo "ERROR: local test-only contract server did not become ready" >&2
  exit 1
fi

set +e
LOCAL_SMOKE_TEST_MODE=1 \
ENVIRONMENT=local-test \
STAGING_GATEWAY_URL="$base_url" \
STAGING_KEYCLOAK_URL="$base_url" \
STAGING_PERMIFY_URL="$base_url" \
STAGING_TEMPORAL_HEALTH_URL="$base_url" \
STAGING_DAPR_HEALTH_URL="$base_url" \
KEYCLOAK_REALM=nexcom \
STAGING_TEST_USERNAME="${LOCAL_SMOKE_TEST_USERNAME:-local-smoke-user}" \
STAGING_TEST_PASSWORD="${LOCAL_SMOKE_TEST_PASSWORD:-local-smoke-password}" \
STAGING_E2E_TIMEOUT_SECONDS=3 \
STAGING_E2E_RESULT_PATH="$result_path" \
python3 "$repo_root/tests/integration/secured_staging_e2e.py" > "$smoke_log" 2>&1
smoke_status=$?
set -e

jq --arg evidence_class "LOCAL_TEST_ONLY_CONTRACT" \
   --arg endpoint "$base_url" \
   --argjson smoke_exit_code "$smoke_status" \
   '. + {evidence_class: $evidence_class, local_loopback_endpoint: $endpoint, smoke_exit_code: $smoke_exit_code}' \
   "$result_path" > "${result_path}.tmp"
mv "${result_path}.tmp" "$result_path"

cat <<EOF
LOCAL_TEST_ONLY_CONTRACT_RESULT=$result_path
LOCAL_TEST_ONLY_SERVER_LOG=$server_log
LOCAL_TEST_ONLY_SMOKE_LOG=$smoke_log
EOF
cat "$result_path"
exit "$smoke_status"
