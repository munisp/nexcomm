#!/usr/bin/env bash
# Generates an untracked, local-only Secret input for Kubernetes bootstrap tests.
# It must never be used for CI, shared staging, production, or financial flows.
set -euo pipefail

output="${1:-.local/.env.local-staging.secrets}"
command -v openssl >/dev/null 2>&1 || { echo "ERROR: openssl is required" >&2; exit 2; }
mkdir -p "$(dirname "$output")"
umask 077

random_hex() { openssl rand -hex "${1:-32}"; }
postgres_password="$(random_hex 24)"
redis_password="$(random_hex 24)"
kafka_password="$(random_hex 24)"

cat > "$output" <<EOF
# LOCAL TEST-ONLY VALUES. Generated $(date -u +%Y-%m-%dT%H:%M:%SZ).
# This file is intentionally untracked and must not leave the developer host.
DATABASE_URL=postgresql://nexcom:${postgres_password}@postgres:5432/nexcom
POSTGRES_URL=postgresql://nexcom:${postgres_password}@postgres:5432/nexcom
POSTGRES_PASSWORD=${postgres_password}
JWT_SECRET=$(random_hex 48)
REDIS_URL=redis://:${redis_password}@redis:6379/0
REDIS_PASSWORD=${redis_password}
KAFKA_BROKERS=kafka:9092
KAFKA_SASL_USERNAME=local-smoke
KAFKA_SASL_PASSWORD=${kafka_password}
KEYCLOAK_CLIENT_SECRET=$(random_hex 32)
KEYCLOAK_ADMIN_CLIENT_ID=nexcom-admin
KEYCLOAK_ADMIN_CLIENT_SECRET=$(random_hex 32)
KEYCLOAK_ADMIN_USERNAME=local-bootstrap-admin
KEYCLOAK_ADMIN_PASSWORD=$(random_hex 24)
APISIX_ADMIN_KEY=$(random_hex 32)
APISIX_DASHBOARD_JWT_SECRET=$(random_hex 32)
APISIX_DASHBOARD_ADMIN_USERNAME=local-dashboard-admin
APISIX_DASHBOARD_ADMIN_PASSWORD=$(random_hex 24)
INTERNAL_SECRET=$(random_hex 32)
EOF
chmod 600 "$output"
printf 'Wrote local test-only staging secret input: %s\n' "$output"
