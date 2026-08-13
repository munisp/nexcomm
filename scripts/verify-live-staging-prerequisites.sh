#!/usr/bin/env bash
# Fail-closed readiness gate for an authorized, isolated live staging cluster.
# It never creates resources, substitutes local endpoints, suppresses failures,
# or prints Secret values. Run only with isolated non-production credentials.
set -uo pipefail

report_path="${STAGING_ASSURANCE_REPORT_PATH:-test-results/live_staging_prerequisites.jsonl}"
namespace="${STAGING_NAMESPACE:-nexcom-staging}"
infra_namespace="${TIGERBEETLE_NAMESPACE:-nexcom-infra}"
keycloak_namespace="${STAGING_KEYCLOAK_NAMESPACE:-nexcom-iam}"
keycloak_deployment="${STAGING_KEYCLOAK_DEPLOYMENT:-nexcom-keycloak}"
permify_namespace="${STAGING_PERMIFY_NAMESPACE:-nexcom-infra}"
permify_deployment="${STAGING_PERMIFY_DEPLOYMENT:-permify}"
tigerbeetle_statefulset="${TIGERBEETLE_STATEFULSET:-tigerbeetle}"
expected_tigerbeetle_replicas="${TIGERBEETLE_EXPECTED_REPLICAS:-3}"
expected_platform_deployments="${EXPECTED_PLATFORM_DEPLOYMENTS:-29}"
failures=0
passes=0

mkdir -p "$(dirname "$report_path")"
: > "$report_path"

record() {
  local status="$1" name="$2" detail="$3"
  printf '{"status":"%s","name":"%s","detail":"%s"}\n' \
    "$status" "$name" "$(printf '%s' "$detail" | tr '\n' ' ' | sed 's/"/\\"/g')" >> "$report_path"
  if [ "$status" = PASS ]; then passes=$((passes + 1)); else failures=$((failures + 1)); fi
  printf '%-4s %s: %s\n' "$status" "$name" "$detail"
}

require_command() {
  local command_name="$1"
  if command -v "$command_name" >/dev/null 2>&1; then record PASS "command_${command_name}" "available"; else record FAIL "command_${command_name}" "not installed"; fi
}

require_env() {
  local variable="$1" value="${!1:-}"
  if [ -n "$value" ] && ! printf '%s' "$value" | grep -Eqi 'example\.invalid|replace-with|changeme|placeholder'; then
    record PASS "env_${variable}" "set"
  else
    record FAIL "env_${variable}" "missing or placeholder"
  fi
}

require_url() {
  local variable="$1" value="${!1:-}"
  if printf '%s' "$value" | grep -Eq '^https://[^/[:space:]]+' && ! printf '%s' "$value" | grep -Eqi 'localhost|127\.0\.0\.1|\[::1\]|example\.invalid'; then
    record PASS "url_${variable}" "HTTPS non-loopback endpoint configured"
  else
    record FAIL "url_${variable}" "must be a non-loopback HTTPS URL"
  fi
}

http_check() {
  local name="$1" url="$2" expected_regex="$3" auth_file="${4:-}"
  local status
  if [ -n "$auth_file" ]; then
    if [ ! -r "$auth_file" ]; then record FAIL "$name" "token file is unreadable"; return; fi
    status="$(curl --silent --show-error --output /dev/null --write-out '%{http_code}' --fail --cacert "${STAGING_CA_FILE:-/etc/ssl/certs/ca-certificates.crt}" -H "Authorization: Bearer $(cat "$auth_file")" "$url" 2>/dev/null || true)"
  else
    status="$(curl --silent --show-error --output /dev/null --write-out '%{http_code}' --fail --cacert "${STAGING_CA_FILE:-/etc/ssl/certs/ca-certificates.crt}" "$url" 2>/dev/null || true)"
  fi
  if printf '%s' "$status" | grep -Eq "$expected_regex"; then record PASS "$name" "HTTP $status"; else record FAIL "$name" "HTTP ${status:-network error}; expected $expected_regex"; fi
}

kubectl_check() {
  local name="$1"; shift
  if "$@" >/dev/null 2>&1; then record PASS "$name" "verified"; else record FAIL "$name" "command failed"; fi
}

for command_name in kubectl helm curl jq cosign; do require_command "$command_name"; done

for variable in STAGING_CONTEXT STAGING_GATEWAY_URL STAGING_KEYCLOAK_URL STAGING_KEYCLOAK_ISSUER STAGING_PERMIFY_URL STAGING_TEMPORAL_HEALTH_URL STAGING_DAPR_HEALTH_URL STAGING_COSIGN_IDENTITY_REGEX PERMIFY_AUTH_TOKEN_FILE TIGERBEETLE_ADDRESSES TIGERBEETLE_CLUSTER_ID PERMIFY_ALLOW_CHECK_BODY_FILE PERMIFY_DENY_CHECK_BODY_FILE; do require_env "$variable"; done
for variable in STAGING_GATEWAY_URL STAGING_KEYCLOAK_URL STAGING_PERMIFY_URL STAGING_TEMPORAL_HEALTH_URL STAGING_DAPR_HEALTH_URL; do require_url "$variable"; done

if [ "${TIGERBEETLE_CLUSTER_ID:-0}" = "0" ]; then record FAIL tigerbeetle_cluster_id "cluster ID must be a nonzero globally unique value"; else record PASS tigerbeetle_cluster_id "nonzero value configured"; fi
if [ -n "${PERMIFY_AUTH_TOKEN_FILE:-}" ] && [ -r "${PERMIFY_AUTH_TOKEN_FILE:-}" ] && [ -s "${PERMIFY_AUTH_TOKEN_FILE:-}" ]; then record PASS permify_token_file "readable nonempty file"; else record FAIL permify_token_file "missing, unreadable, or empty"; fi
if [ -n "${STAGING_CA_FILE:-}" ] && [ -r "${STAGING_CA_FILE:-}" ]; then record PASS staging_ca_file "readable"; elif [ -z "${STAGING_CA_FILE:-}" ]; then record PASS staging_ca_file "system trust store selected"; else record FAIL staging_ca_file "unreadable"; fi

if command -v kubectl >/dev/null 2>&1; then
  active_context="$(kubectl config current-context 2>/dev/null || true)"
  if [ "$active_context" = "${STAGING_CONTEXT:-}" ]; then record PASS kubernetes_context "active context matches configured staging context"; else record FAIL kubernetes_context "active=$active_context configured=${STAGING_CONTEXT:-missing}"; fi
  case "$active_context" in *prod*|*production*) record FAIL kubernetes_context_safety "context name appears production-like" ;; *) record PASS kubernetes_context_safety "context name is not production-like" ;; esac
  kubectl_check staging_namespace kubectl get namespace "$namespace"
  kubectl_check staging_deployer_serviceaccount kubectl -n "$namespace" get serviceaccount nexcom-staging-deployer
  kubectl_check staging_observer_serviceaccount kubectl -n "$namespace" get serviceaccount nexcom-staging-smoke-observer
  kubectl_check staging_secret_exists kubectl -n "$namespace" get secret "${STAGING_SECRET_NAME:-nexcom-staging-secrets}"
  if kubectl -n "$namespace" get secret "${STAGING_SECRET_NAME:-nexcom-staging-secrets}" -o json 2>/dev/null | jq -e '.data | has("PERMIFY_AUTH_TOKEN") and has("DATABASE_URL") and has("POSTGRES_URL") and has("JWT_SECRET") and has("KEYCLOAK_CLIENT_SECRET") and has("APISIX_ADMIN_KEY")' >/dev/null; then record PASS staging_secret_key_contract "required key names present"; else record FAIL staging_secret_key_contract "one or more required Secret keys absent"; fi
  if kubectl auth can-i patch deployments -n "$namespace" --as="system:serviceaccount:${namespace}:nexcom-staging-deployer" 2>/dev/null | grep -qx yes; then record PASS deployer_can_patch_deployments "allowed as required"; else record FAIL deployer_can_patch_deployments "must be allowed"; fi
  if kubectl auth can-i get secrets -n "$namespace" --as="system:serviceaccount:${namespace}:nexcom-staging-deployer" 2>/dev/null | grep -qx no; then record PASS deployer_cannot_read_secrets "denied as required"; else record FAIL deployer_cannot_read_secrets "must be denied"; fi
  if kubectl auth can-i get pods -n "$namespace" --as="system:serviceaccount:${namespace}:nexcom-staging-smoke-observer" 2>/dev/null | grep -qx yes; then record PASS observer_can_get_pods "allowed as required"; else record FAIL observer_can_get_pods "must be allowed"; fi
  if kubectl auth can-i create pods/exec -n "$namespace" --as="system:serviceaccount:${namespace}:nexcom-staging-smoke-observer" 2>/dev/null | grep -qx no; then record PASS observer_cannot_exec_pods "denied as required"; else record FAIL observer_cannot_exec_pods "must be denied"; fi

  platform_json="$(kubectl -n "$namespace" get deployments -l app.kubernetes.io/part-of=nexcom-exchange -o json 2>/dev/null || true)"
  platform_count="$(printf '%s' "$platform_json" | jq '[.items[]?] | length' 2>/dev/null || echo 0)"
  if [ "$platform_count" -ge "$expected_platform_deployments" ]; then record PASS platform_deployment_count "$platform_count deployments"; else record FAIL platform_deployment_count "$platform_count found; expected at least $expected_platform_deployments"; fi
  mutable_count="$(printf '%s' "$platform_json" | jq '[.items[]?.spec.template.spec.containers[]?.image | select(test("@sha256:[0-9a-f]{64}$") | not)] | length' 2>/dev/null || echo 999)"
  if [ "$mutable_count" = 0 ]; then record PASS platform_images_immutable "all platform images are full digests"; else record FAIL platform_images_immutable "$mutable_count mutable or malformed images"; fi

  keycloak_ready="$(kubectl -n "$keycloak_namespace" get deployment "$keycloak_deployment" -o jsonpath='{.status.readyReplicas}' 2>/dev/null || true)"
  if [ "${keycloak_ready:-0}" -ge 2 ] 2>/dev/null; then record PASS keycloak_replicas "$keycloak_ready ready replicas"; else record FAIL keycloak_replicas "expected at least two ready replicas; got ${keycloak_ready:-0}"; fi
  permify_ready="$(kubectl -n "$permify_namespace" get deployment "$permify_deployment" -o jsonpath='{.status.readyReplicas}' 2>/dev/null || true)"
  if [ "${permify_ready:-0}" -ge 2 ] 2>/dev/null; then record PASS permify_replicas "$permify_ready ready replicas"; else record FAIL permify_replicas "expected at least two ready replicas; got ${permify_ready:-0}"; fi
  tb_ready="$(kubectl -n "$infra_namespace" get statefulset "$tigerbeetle_statefulset" -o jsonpath='{.status.readyReplicas}' 2>/dev/null || true)"
  if [ "${tb_ready:-0}" = "$expected_tigerbeetle_replicas" ]; then record PASS tigerbeetle_replicas "$tb_ready ready replicas"; else record FAIL tigerbeetle_replicas "expected $expected_tigerbeetle_replicas ready replicas; got ${tb_ready:-0}"; fi
  bound_pvcs="$(kubectl -n "$infra_namespace" get pvc -o json 2>/dev/null | jq '[.items[]? | select(.status.phase=="Bound") | select(.metadata.name | startswith("tigerbeetle-data-"))] | length' 2>/dev/null || echo 0)"
  if [ "$bound_pvcs" -ge "$expected_tigerbeetle_replicas" ]; then record PASS tigerbeetle_persistent_volumes "$bound_pvcs bound PVCs"; else record FAIL tigerbeetle_persistent_volumes "$bound_pvcs bound PVCs; expected $expected_tigerbeetle_replicas"; fi
fi

http_check keycloak_oidc_discovery "${STAGING_KEYCLOAK_URL:-}/realms/${KEYCLOAK_REALM:-nexcom}/.well-known/openid-configuration" '^200$'
if command -v curl >/dev/null 2>&1 && command -v jq >/dev/null 2>&1 && [ -n "${STAGING_KEYCLOAK_ISSUER:-}" ]; then
  issuer="$(curl --silent --show-error --fail --cacert "${STAGING_CA_FILE:-/etc/ssl/certs/ca-certificates.crt}" "${STAGING_KEYCLOAK_URL:-}/realms/${KEYCLOAK_REALM:-nexcom}/.well-known/openid-configuration" 2>/dev/null | jq -r '.issuer // empty' 2>/dev/null || true)"
  if [ "$issuer" = "$STAGING_KEYCLOAK_ISSUER" ]; then record PASS keycloak_issuer_contract "issuer matches configured public issuer"; else record FAIL keycloak_issuer_contract "discovery issuer mismatch"; fi
fi
http_check permify_health "${STAGING_PERMIFY_URL:-}/healthz" '^200$' "${PERMIFY_AUTH_TOKEN_FILE:-}"
http_check temporal_health "${STAGING_TEMPORAL_HEALTH_URL:-}/" '^(200|204)$'
http_check dapr_health "${STAGING_DAPR_HEALTH_URL:-}/v1.0/healthz" '^(200|204)$'
http_check gateway_health "${STAGING_GATEWAY_URL:-}/api/v1/health" '^200$'

if [ -r "${PERMIFY_ALLOW_CHECK_BODY_FILE:-}" ] && [ -r "${PERMIFY_DENY_CHECK_BODY_FILE:-}" ] && [ -r "${PERMIFY_AUTH_TOKEN_FILE:-}" ]; then
  auth_header="Authorization: Bearer $(cat "$PERMIFY_AUTH_TOKEN_FILE")"
  allow_can="$(curl --silent --show-error --fail --cacert "${STAGING_CA_FILE:-/etc/ssl/certs/ca-certificates.crt}" -H 'Content-Type: application/json' -H "$auth_header" --data @"$PERMIFY_ALLOW_CHECK_BODY_FILE" "${STAGING_PERMIFY_URL:-}/v1/tenants/${PERMIFY_TENANT_ID:-nexcom}/permissions/check" 2>/dev/null | jq -r '.can // empty' 2>/dev/null || true)"
  deny_can="$(curl --silent --show-error --fail --cacert "${STAGING_CA_FILE:-/etc/ssl/certs/ca-certificates.crt}" -H 'Content-Type: application/json' -H "$auth_header" --data @"$PERMIFY_DENY_CHECK_BODY_FILE" "${STAGING_PERMIFY_URL:-}/v1/tenants/${PERMIFY_TENANT_ID:-nexcom}/permissions/check" 2>/dev/null | jq -r '.can // empty' 2>/dev/null || true)"
  if [ "$allow_can" = CHECK_RESULT_ALLOWED ]; then record PASS permify_allow_check "received CHECK_RESULT_ALLOWED"; else record FAIL permify_allow_check "received ${allow_can:-no result}"; fi
  if [ "$deny_can" = CHECK_RESULT_DENIED ]; then record PASS permify_deny_check "received CHECK_RESULT_DENIED"; else record FAIL permify_deny_check "received ${deny_can:-no result}"; fi
else
  record FAIL permify_policy_check_inputs "allow/deny body files and token file are required"
fi

if [ "${VERIFY_COSIGN_IMAGES:-1}" = 1 ] && command -v cosign >/dev/null 2>&1 && command -v kubectl >/dev/null 2>&1; then
  image_count=0
  cosign_failures=0
  while IFS= read -r image; do
    [ -n "$image" ] || continue
    image_count=$((image_count + 1))
    if ! cosign verify --certificate-identity-regexp "${STAGING_COSIGN_IDENTITY_REGEX:-}" --certificate-oidc-issuer https://token.actions.githubusercontent.com "$image" >/dev/null 2>&1; then cosign_failures=$((cosign_failures + 1)); fi
  done < <(kubectl -n "$namespace" get deployments -l app.kubernetes.io/part-of=nexcom-exchange -o json 2>/dev/null | jq -r '.items[]?.spec.template.spec.containers[]?.image')
  if [ "$image_count" -ge "$expected_platform_deployments" ] && [ "$cosign_failures" = 0 ]; then record PASS cosign_platform_images "$image_count images verified"; else record FAIL cosign_platform_images "$image_count images checked; $cosign_failures verification failures"; fi
fi

if [ "${EXECUTE_LIVE_SMOKE:-0}" = 1 ]; then
  STAGING_E2E_RESULT_PATH="${STAGING_E2E_RESULT_PATH:-test-results/live_secured_staging_e2e.json}" python3 tests/integration/secured_staging_e2e.py
  smoke_status=$?
  if [ "$smoke_status" = 0 ]; then record PASS secured_staging_smoke "smoke suite passed"; else record FAIL secured_staging_smoke "smoke suite failed"; fi
else
  record FAIL secured_staging_smoke "not executed; set EXECUTE_LIVE_SMOKE=1 only after all prerequisites pass"
fi

printf '{"summary":{"passed":%s,"failed":%s},"report":"%s"}\n' "$passes" "$failures" "$report_path"
[ "$failures" = 0 ]
