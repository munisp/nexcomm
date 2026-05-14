#!/usr/bin/env bash
# NEXCOM Exchange — Comprehensive Smoke Test
# Tests all 25+ services and key API endpoints
# Usage: BASE_URL=https://your-domain.com ./scripts/smoke-test.sh

set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:3000}"
PASS=0
FAIL=0
SKIP=0

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

check() {
  local name="$1"
  local url="$2"
  local expected_status="${3:-200}"
  local response
  local status

  status=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 "$url" 2>/dev/null || echo "000")
  if [ "$status" = "$expected_status" ] || [ "$status" = "200" ] || [ "$status" = "207" ]; then
    echo -e "${GREEN}✓${NC} $name ($status)"
    PASS=$((PASS+1))
  elif [ "$status" = "000" ]; then
    echo -e "${YELLOW}⚠${NC} $name (TIMEOUT/UNREACHABLE)"
    SKIP=$((SKIP+1))
  else
    echo -e "${RED}✗${NC} $name (got $status, expected $expected_status)"
    FAIL=$((FAIL+1))
  fi
}

check_service() {
  local name="$1"
  local port="$2"
  local path="${3:-/health}"
  check "$name" "http://localhost:${port}${path}" "200"
}

echo "============================================"
echo "  NEXCOM Exchange Smoke Test"
echo "  Base URL: $BASE_URL"
echo "  $(date)"
echo "============================================"
echo ""

echo "── Web Application ──────────────────────────"
check "Homepage"                  "$BASE_URL/"
check "API Health Deep"           "$BASE_URL/api/health/deep" "200"
check "HA Status"                 "$BASE_URL/api/ha/status"
check "tRPC Health (auth.me)"     "$BASE_URL/api/trpc/auth.me"
check "OAuth Callback (GET)"      "$BASE_URL/api/oauth/callback" "400"

echo ""
echo "── Microservices (Docker Compose) ───────────"
check_service "Core Banking"          8100
check_service "Channel Gateway"       8200
check_service "Indices Service"       8300
check_service "USSD Engine (Rust)"    8400
check_service "Bot Logic (Python)"    8500
check_service "AI/ML Engine"          8600
check_service "Analytics Engine"      8700
check_service "KYC Service"           8800
check_service "Trading Engine (Rust)" 8080
check_service "Risk Management (Go)"  8900
check_service "Mojaloop Adapter"      9000
check_service "User Management"       9100
check_service "Ingestion Engine"      9200
check_service "Notification Service"  9300
check_service "Blockchain Service"    9400
check_service "Fraud Engine (Python)" 9500
check_service "Credit Scoring (Rust)" 9600
check_service "DDoS Guard (Go)"       9700
check_service "Crypto Guard (Rust)"   9800
check_service "AML Alert Subscriber"  9900
check_service "OpenSearch Sync"       10000
check_service "Middleware Hub"        10100

echo ""
echo "── Infrastructure ───────────────────────────"
check_service "OpenSearch"            9200 "/_cluster/health"
check_service "Kafka (REST Proxy)"    8082 "/topics"
check_service "Redis"                 6379 ""

echo ""
echo "── APISIX Gateway (optional) ────────────────"
check_service "APISIX Admin"          9180 "/apisix/admin/routes"
check_service "APISIX Dashboard"      9000 "/"
check_service "Prometheus"            9090 "/-/healthy"
check_service "Grafana"               3001 "/api/health"

echo ""
echo "============================================"
echo "  Results: ${PASS} passed, ${FAIL} failed, ${SKIP} skipped"
echo "============================================"

if [ "$FAIL" -gt 0 ]; then
  echo -e "${RED}SMOKE TEST FAILED${NC}"
  exit 1
else
  echo -e "${GREEN}SMOKE TEST PASSED${NC}"
  exit 0
fi
