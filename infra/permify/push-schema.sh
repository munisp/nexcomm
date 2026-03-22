#!/usr/bin/env sh
# infra/permify/push-schema.sh
#
# Waits for the Permify HTTP server to become healthy, then writes the
# nexcom RBAC schema from permify.perm into the Permify tenant store.
#
# Environment variables (all optional — defaults shown):
#   PERMIFY_HOST       Permify HTTP host   (default: localhost)
#   PERMIFY_HTTP_PORT  Permify HTTP port   (default: 3476)
#   PERMIFY_TENANT_ID  Permify tenant ID   (default: t1)
#   SCHEMA_FILE        Path to .perm file  (default: /app/permify.perm)
#
# Usage (Docker):
#   CMD ["sh", "/app/push-schema.sh"]

set -eu

PERMIFY_HOST="${PERMIFY_HOST:-localhost}"
PERMIFY_HTTP_PORT="${PERMIFY_HTTP_PORT:-3476}"
PERMIFY_TENANT_ID="${PERMIFY_TENANT_ID:-t1}"
SCHEMA_FILE="${SCHEMA_FILE:-/app/permify.perm}"
BASE_URL="http://${PERMIFY_HOST}:${PERMIFY_HTTP_PORT}"
MAX_WAIT=120   # seconds
INTERVAL=3

echo "[permify-push] Waiting for Permify at ${BASE_URL}/healthz …"
elapsed=0
until curl -sf "${BASE_URL}/healthz" > /dev/null 2>&1; do
  if [ "$elapsed" -ge "$MAX_WAIT" ]; then
    echo "[permify-push] ERROR: Permify did not become healthy within ${MAX_WAIT}s" >&2
    exit 1
  fi
  sleep "$INTERVAL"
  elapsed=$((elapsed + INTERVAL))
done
echo "[permify-push] Permify is healthy after ${elapsed}s."

# Read the schema file
if [ ! -f "$SCHEMA_FILE" ]; then
  echo "[permify-push] ERROR: Schema file not found: ${SCHEMA_FILE}" >&2
  exit 1
fi
SCHEMA=$(cat "$SCHEMA_FILE")

# Escape the schema for JSON (replace \ → \\, " → \", newline → \n)
SCHEMA_JSON=$(printf '%s' "$SCHEMA" \
  | sed 's/\\/\\\\/g' \
  | sed 's/"/\\"/g' \
  | tr '\n' '\\' \
  | sed 's/\\/\\n/g')

PAYLOAD="{\"schema\":\"${SCHEMA_JSON}\"}"

echo "[permify-push] Writing schema to tenant '${PERMIFY_TENANT_ID}' …"
HTTP_STATUS=$(curl -sf -o /tmp/permify_response.json -w "%{http_code}" \
  -X POST \
  -H "Content-Type: application/json" \
  -d "$PAYLOAD" \
  "${BASE_URL}/v1/tenants/${PERMIFY_TENANT_ID}/schemas/write" 2>&1) || true

if [ "$HTTP_STATUS" = "200" ] || [ "$HTTP_STATUS" = "201" ]; then
  echo "[permify-push] Schema pushed successfully (HTTP ${HTTP_STATUS})."
  cat /tmp/permify_response.json 2>/dev/null || true
  echo ""
else
  echo "[permify-push] WARNING: Schema push returned HTTP ${HTTP_STATUS}." >&2
  cat /tmp/permify_response.json 2>/dev/null || true
  echo ""
  # Non-fatal: the server may already have the latest schema version.
  # The main Permify service will still start correctly.
fi

echo "[permify-push] Done."
