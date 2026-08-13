#!/usr/bin/env sh
# Writes the NEXCOMM authorization schema to a live Permify tenant.
# Staging and production fail closed on unavailable Permify, insecure transport,
# missing API authentication, malformed schema input, or schema-write failure.
set -eu

PERMIFY_HOST="${PERMIFY_HOST:-permify}"
PERMIFY_HTTP_PORT="${PERMIFY_HTTP_PORT:-3476}"
PERMIFY_TENANT_ID="${PERMIFY_TENANT_ID:-t1}"
PERMIFY_SCHEME="${PERMIFY_SCHEME:-https}"
PERMIFY_CA_FILE="${PERMIFY_CA_FILE:-}"
PERMIFY_AUTH_TOKEN="${PERMIFY_AUTH_TOKEN:-}"
PERMIFY_AUTH_TOKEN_FILE="${PERMIFY_AUTH_TOKEN_FILE:-}"
PERMIFY_ALLOW_INSECURE_LOCAL="${PERMIFY_ALLOW_INSECURE_LOCAL:-0}"
ENVIRONMENT="${ENVIRONMENT:-staging}"
SCHEMA_FILE="${SCHEMA_FILE:-/app/permify.perm}"
MAX_WAIT="${MAX_WAIT:-120}"
INTERVAL="${INTERVAL:-3}"
BASE_URL="${PERMIFY_SCHEME}://${PERMIFY_HOST}:${PERMIFY_HTTP_PORT}"

if [ -n "$PERMIFY_AUTH_TOKEN" ] && [ -n "$PERMIFY_AUTH_TOKEN_FILE" ]; then
  echo "ERROR: set only one of PERMIFY_AUTH_TOKEN or PERMIFY_AUTH_TOKEN_FILE" >&2
  exit 2
fi
if [ -n "$PERMIFY_AUTH_TOKEN_FILE" ]; then
  [ -r "$PERMIFY_AUTH_TOKEN_FILE" ] || { echo "ERROR: PERMIFY_AUTH_TOKEN_FILE is unreadable" >&2; exit 2; }
  PERMIFY_AUTH_TOKEN="$(cat "$PERMIFY_AUTH_TOKEN_FILE")"
fi
if [ "$PERMIFY_SCHEME" != "https" ]; then
  if [ "$PERMIFY_ALLOW_INSECURE_LOCAL" != "1" ] || [ "$ENVIRONMENT" != "local-test" ]; then
    echo "ERROR: HTTPS is required outside explicit ENVIRONMENT=local-test" >&2
    exit 2
  fi
fi
if [ "$ENVIRONMENT" = "staging" ] || [ "$ENVIRONMENT" = "production" ] || [ "$ENVIRONMENT" = "prod" ]; then
  [ -n "$PERMIFY_AUTH_TOKEN" ] || { echo "ERROR: PERMIFY_AUTH_TOKEN or PERMIFY_AUTH_TOKEN_FILE is required" >&2; exit 2; }
fi
[ -f "$SCHEMA_FILE" ] || { echo "ERROR: schema file not found: $SCHEMA_FILE" >&2; exit 2; }

curl_args="--fail --show-error --silent"
if [ -n "$PERMIFY_CA_FILE" ]; then
  [ -r "$PERMIFY_CA_FILE" ] || { echo "ERROR: PERMIFY_CA_FILE is unreadable" >&2; exit 2; }
  curl_args="$curl_args --cacert $PERMIFY_CA_FILE"
fi
if [ -n "$PERMIFY_AUTH_TOKEN" ]; then
  auth_header="Authorization: Bearer $PERMIFY_AUTH_TOKEN"
else
  auth_header=""
fi

request_health() {
  if [ -n "$auth_header" ]; then
    # shellcheck disable=SC2086
    curl $curl_args -H "$auth_header" "$BASE_URL/healthz" >/dev/null
  else
    # shellcheck disable=SC2086
    curl $curl_args "$BASE_URL/healthz" >/dev/null
  fi
}

echo "[permify-push] waiting for authenticated Permify health at ${BASE_URL}/healthz"
elapsed=0
until request_health; do
  if [ "$elapsed" -ge "$MAX_WAIT" ]; then
    echo "ERROR: Permify did not become healthy within ${MAX_WAIT}s" >&2
    exit 1
  fi
  sleep "$INTERVAL"
  elapsed=$((elapsed + INTERVAL))
done

payload="$(jq -n --rawfile schema "$SCHEMA_FILE" '{schema: $schema}')"
response_file="$(mktemp)"
trap 'rm -f "$response_file"' EXIT HUP INT TERM
if [ -n "$auth_header" ]; then
  # shellcheck disable=SC2086
  status="$(curl $curl_args -o "$response_file" -w '%{http_code}' -X POST -H 'Content-Type: application/json' -H "$auth_header" --data "$payload" "$BASE_URL/v1/tenants/$PERMIFY_TENANT_ID/schemas/write")"
else
  # shellcheck disable=SC2086
  status="$(curl $curl_args -o "$response_file" -w '%{http_code}' -X POST -H 'Content-Type: application/json' --data "$payload" "$BASE_URL/v1/tenants/$PERMIFY_TENANT_ID/schemas/write")"
fi
case "$status" in
  200|201) ;;
  *) echo "ERROR: schema write returned HTTP $status" >&2; cat "$response_file" >&2; exit 1 ;;
esac
jq -e 'type == "object"' "$response_file" >/dev/null || { echo "ERROR: schema write response was not JSON" >&2; exit 1; }
echo "[permify-push] schema write succeeded for tenant ${PERMIFY_TENANT_ID} (HTTP ${status})"
