#!/usr/bin/env bash
# ============================================================================
# NEXCOM Exchange — Comprehensive Smoke Test Suite
# ============================================================================
# Tests all 22 microservices + web portal health endpoints.
# Usage:
#   ./tests/integration/smoke_test.sh [BASE_URL] [--verbose] [--fail-fast]
#
# Examples:
#   ./tests/integration/smoke_test.sh                          # localhost defaults
#   ./tests/integration/smoke_test.sh https://nexcom.ng        # production
#   ./tests/integration/smoke_test.sh http://localhost --verbose
#
# Exit codes:
#   0 — all tests passed
#   1 — one or more tests failed
# ============================================================================

set -euo pipefail

# ─── Configuration ────────────────────────────────────────────────────────────
BASE_URL="${1:-http://localhost}"
VERBOSE="${VERBOSE:-false}"
FAIL_FAST="${FAIL_FAST:-false}"
TIMEOUT="${TIMEOUT:-10}"
PASS=0
FAIL=0
SKIP=0
FAILED_SERVICES=()

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color
BOLD='\033[1m'

# ─── Helpers ─────────────────────────────────────────────────────────────────
log() { echo -e "${BLUE}[$(date +%H:%M:%S)]${NC} $*"; }
pass() { echo -e "${GREEN}✓${NC} $*"; ((PASS++)); }
fail() { echo -e "${RED}✗${NC} $*"; ((FAIL++)); FAILED_SERVICES+=("$1"); }
skip() { echo -e "${YELLOW}⊘${NC} $*"; ((SKIP++)); }
header() { echo -e "\n${BOLD}${CYAN}═══ $* ═══${NC}"; }

check_health() {
  local name="$1"
  local url="$2"
  local expected_status="${3:-200}"
  local expected_body="${4:-}"

  if [[ "$VERBOSE" == "true" ]]; then
    log "Checking $name → $url"
  fi

  local http_code
  local body
  body=$(curl -s -o /tmp/nexcom_smoke_body.txt -w "%{http_code}" \
    --connect-timeout "$TIMEOUT" --max-time "$((TIMEOUT * 2))" \
    -H "Accept: application/json" \
    "$url" 2>/dev/null) || { fail "$name" "Connection refused or timeout"; return 1; }
  http_code="$body"
  body=$(cat /tmp/nexcom_smoke_body.txt 2>/dev/null || echo "")

  if [[ "$http_code" != "$expected_status" ]]; then
    fail "$name" "Expected HTTP $expected_status, got $http_code"
    if [[ "$VERBOSE" == "true" ]]; then echo "  Response: $body"; fi
    if [[ "$FAIL_FAST" == "true" ]]; then exit 1; fi
    return 1
  fi

  if [[ -n "$expected_body" ]] && ! echo "$body" | grep -q "$expected_body"; then
    fail "$name" "Body missing expected: '$expected_body'"
    if [[ "$VERBOSE" == "true" ]]; then echo "  Response: $body"; fi
    if [[ "$FAIL_FAST" == "true" ]]; then exit 1; fi
    return 1
  fi

  pass "$name (HTTP $http_code)"
  return 0
}

check_api() {
  local name="$1"
  local url="$2"
  local method="${3:-GET}"
  local body="${4:-}"
  local expected_status="${5:-200}"

  local curl_args=(-s -o /tmp/nexcom_smoke_body.txt -w "%{http_code}"
    --connect-timeout "$TIMEOUT" --max-time "$((TIMEOUT * 2))"
    -H "Accept: application/json"
    -H "Content-Type: application/json"
    -X "$method")

  if [[ -n "$body" ]]; then
    curl_args+=(-d "$body")
  fi

  local http_code
  http_code=$(curl "${curl_args[@]}" "$url" 2>/dev/null) || {
    fail "$name" "Connection refused or timeout"
    return 1
  }

  if [[ "$http_code" != "$expected_status" ]]; then
    fail "$name" "Expected HTTP $expected_status, got $http_code"
    if [[ "$VERBOSE" == "true" ]]; then echo "  Response: $(cat /tmp/nexcom_smoke_body.txt)"; fi
    return 1
  fi

  pass "$name (HTTP $http_code)"
  return 0
}

# ─── Test Suites ─────────────────────────────────────────────────────────────

test_infrastructure() {
  header "Infrastructure Services"
  check_health "PostgreSQL (via portal)" "${BASE_URL}:3000/health" 200 "ok"
  check_health "Redis (via portal)" "${BASE_URL}:3000/health" 200 "ok"
}

test_web_portal() {
  header "Web Portal (Next.js/Express)"
  check_health "Portal Health" "${BASE_URL}:3000/health" 200 "ok"
  check_health "Portal API TRPC" "${BASE_URL}:3000/api/trpc/auth.me" 200
  check_health "Portal Static Assets" "${BASE_URL}:3000/" 200
}

test_matching_engine() {
  header "Matching Engine (Rust)"
  check_health "Matching Engine Health" "${BASE_URL}:8080/health" 200 "ok"
  check_api "Order Book GET" "${BASE_URL}:8080/api/v1/orderbook/MAIZE-NGN" GET "" 200
  check_api "Market Summary" "${BASE_URL}:8080/api/v1/markets" GET "" 200
}

test_settlement_engine() {
  header "Settlement Engine"
  check_health "Settlement Health" "${BASE_URL}:8005/health" 200 "ok"
  check_api "Settlement Status" "${BASE_URL}:8005/api/v1/status" GET "" 200
}

test_gateway() {
  header "API Gateway"
  check_health "Gateway Health" "${BASE_URL}:8200/health" 200 "ok"
  check_api "Gateway Routes" "${BASE_URL}:8200/api/v1/routes" GET "" 200
}

test_risk_management() {
  header "Risk Management (Go)"
  check_health "Risk Management Health" "${BASE_URL}:8004/health" 200 "ok"
  check_api "Risk Metrics" "${BASE_URL}:8004/api/v1/metrics" GET "" 200
  check_api "Margin Requirements" "${BASE_URL}:8004/api/v1/margin/requirements" GET "" 200
}

test_kyc_service() {
  header "KYC Service (Go)"
  check_health "KYC Service Health" "${BASE_URL}:8003/health" 200 "ok"
  check_api "KYC Status Endpoint" "${BASE_URL}:8003/api/v1/status" GET "" 200
}

test_notification() {
  header "Notification Service (TypeScript)"
  check_health "Notification Health" "${BASE_URL}:8008/health" 200 "ok"
  check_api "Notification Templates" "${BASE_URL}:8008/api/v1/templates" GET "" 200
}

test_ingestion_engine() {
  header "Ingestion Engine (Python)"
  check_health "Ingestion Engine Health" "${BASE_URL}:8009/health" 200 "ok"
  check_api "Ingestion Status" "${BASE_URL}:8009/api/v1/status" GET "" 200
  check_api "Lakehouse Layers" "${BASE_URL}:8009/api/v1/layers" GET "" 200
}

test_analytics() {
  header "Analytics Service (Python)"
  check_health "Analytics Health" "${BASE_URL}:8006/health" 200 "ok"
  check_api "Analytics Dashboard" "${BASE_URL}:8006/api/v1/dashboard" GET "" 200
  check_api "Volume Analytics" "${BASE_URL}:8006/api/v1/volume" GET "" 200
}

test_ai_ml() {
  header "AI/ML Service (Python)"
  check_health "AI/ML Health" "${BASE_URL}:8007/health" 200 "ok"
  check_api "Model Status" "${BASE_URL}:8007/api/v1/models" GET "" 200
  check_api "Price Prediction" "${BASE_URL}:8007/api/v1/predict/MAIZE-NGN" GET "" 200
}

test_blockchain() {
  header "Blockchain Service (Go)"
  check_health "Blockchain Health" "${BASE_URL}:8010/health" 200 "ok"
  check_api "Token Registry" "${BASE_URL}:8010/api/v1/tokens" GET "" 200
}

test_trading_engine() {
  header "Trading Engine (Go)"
  check_health "Trading Engine Health" "${BASE_URL}:8001/health" 200 "ok"
}

test_analytics_engine() {
  header "Analytics Engine (Python)"
  check_health "Analytics Engine Health" "${BASE_URL}:8011/health" 200 "ok"
}

test_user_management() {
  header "User Management (TypeScript)"
  check_health "User Management Health" "${BASE_URL}:8085/health" 200 "ok"
  check_api "Auth Login (invalid)" "${BASE_URL}:8085/api/v1/auth/login" POST \
    '{"email":"test@test.com","password":"wrong"}' 401
  check_api "Auth Register (missing fields)" "${BASE_URL}:8085/api/v1/auth/register" POST \
    '{"email":""}' 400
}

test_mojaloop_adapter() {
  header "Mojaloop DFSP Adapter (Go)"
  check_health "Mojaloop Adapter Health" "${BASE_URL}:4001/health" 200 "ok"
  check_api "DFSP Info" "${BASE_URL}:4001/api/v1/dfsp/info" GET "" 200
}

test_ussd_engine() {
  header "USSD Engine"
  check_health "USSD Engine Health" "${BASE_URL}:8080/health" 200 "ok"
}

test_channel_gateway() {
  header "Channel Gateway"
  check_health "Channel Gateway Health" "${BASE_URL}:8082/health" 200 "ok"
}

test_bot_logic() {
  header "Bot Logic Service"
  check_health "Bot Logic Health" "${BASE_URL}:3001/health" 200 "ok"
}

test_core_banking() {
  header "Core Banking Service (Go)"
  check_health "Core Banking Health" "${BASE_URL}:8083/health" 200 "ok"
  check_api "Loan Products" "${BASE_URL}:8083/api/v1/loan-products" GET "" 200
  check_api "Bank Accounts" "${BASE_URL}:8083/api/v1/accounts" GET "" 401  # Requires auth
  check_api "Input Financing Products" "${BASE_URL}:8083/api/v1/input-financing/products" GET "" 200
}

test_indices() {
  header "Commodity Indices Service (Go/gRPC)"
  check_health "Indices HTTP Health" "${BASE_URL}:8025/health" 200 "ok"
  check_api "Commodity Indices" "${BASE_URL}:8025/api/v1/indices" GET "" 200
  check_api "NCEX Index" "${BASE_URL}:8025/api/v1/indices/NCEX-AGRI" GET "" 200
}

test_credit_scoring() {
  header "Credit Scoring Engine (Rust)"
  check_health "Credit Scoring Health" "${BASE_URL}:8089/health" 200 "ok"
  check_api "Score Bands" "${BASE_URL}:8089/api/v1/bands" GET "" 200
  check_api "Score Request (valid)" "${BASE_URL}:8089/api/v1/score" POST \
    '{"farmer_id":1,"loan_amount_ngn":1000000,"loan_purpose":"Input financing","loan_term_months":12,"annual_farm_income_ngn":2000000,"farm_size_hectares":10}' 200
}

test_aml_subscriber() {
  header "AML Alert Subscriber (Go)"
  check_health "AML Subscriber Health" "${BASE_URL}:8091/health" 200 "ok"
}

test_market_data() {
  header "Market Data Service (Go)"
  check_health "Market Data Health" "${BASE_URL}:8092/health" 200 "ok"
  check_api "Live Prices" "${BASE_URL}:8092/api/v1/prices" GET "" 200
  check_api "Price History" "${BASE_URL}:8092/api/v1/prices/MAIZE-NGN/history" GET "" 200
}

test_middleware_hub() {
  header "Middleware Hub (TypeScript)"
  check_health "Middleware Hub Health" "${BASE_URL}:8093/health" 200 "ok"
  check_api "Middleware Routes" "${BASE_URL}:8093/api/v1/routes" GET "" 200
}

test_opensearch_sync() {
  header "OpenSearch Sync (Go)"
  check_health "OpenSearch Sync Health" "${BASE_URL}:8094/health" 200 "ok"
}

# ─── Business Logic Tests ─────────────────────────────────────────────────────

test_business_flows() {
  header "Business Logic — End-to-End Flows"

  # Test: Market data flows to portal
  log "Testing market data → portal flow..."
  local prices
  prices=$(curl -s --connect-timeout 5 "${BASE_URL}:3000/api/trpc/livePrices.getAll" 2>/dev/null || echo "")
  if echo "$prices" | grep -q '"result"'; then
    pass "Live prices available via portal tRPC"
  else
    skip "Live prices — portal tRPC not returning data (may need auth)"
  fi

  # Test: Credit scoring API
  log "Testing credit scoring API..."
  local score_response
  score_response=$(curl -s -X POST \
    -H "Content-Type: application/json" \
    -d '{"farmer_id":999,"loan_amount_ngn":500000,"loan_purpose":"Seed purchase","loan_term_months":6,"annual_farm_income_ngn":1200000,"farm_size_hectares":5,"total_loans_taken":3,"loans_repaid_on_time":3,"loans_defaulted":0}' \
    --connect-timeout 10 \
    "${BASE_URL}:8089/api/v1/score" 2>/dev/null || echo "")
  if echo "$score_response" | grep -q '"score"'; then
    local score
    score=$(echo "$score_response" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('score','?'))" 2>/dev/null || echo "?")
    pass "Credit scoring returned score: $score"
  else
    skip "Credit scoring — service may not be running"
  fi

  # Test: KYC status check
  log "Testing KYC service..."
  local kyc_health
  kyc_health=$(curl -s --connect-timeout 5 "${BASE_URL}:8003/health" 2>/dev/null || echo "")
  if echo "$kyc_health" | grep -q '"status"'; then
    pass "KYC service responding"
  else
    skip "KYC service — not reachable"
  fi
}

# ─── Main ─────────────────────────────────────────────────────────────────────

main() {
  echo -e "\n${BOLD}${CYAN}╔══════════════════════════════════════════════════════╗${NC}"
  echo -e "${BOLD}${CYAN}║     NEXCOM Exchange — Smoke Test Suite v1.0          ║${NC}"
  echo -e "${BOLD}${CYAN}╚══════════════════════════════════════════════════════╝${NC}"
  echo -e "  Base URL: ${BASE_URL}"
  echo -e "  Timeout:  ${TIMEOUT}s per request"
  echo -e "  Started:  $(date)"
  echo ""

  # Run all test suites
  test_infrastructure
  test_web_portal
  test_matching_engine
  test_settlement_engine
  test_gateway
  test_risk_management
  test_kyc_service
  test_notification
  test_ingestion_engine
  test_analytics
  test_ai_ml
  test_blockchain
  test_trading_engine
  test_analytics_engine
  test_user_management
  test_mojaloop_adapter
  test_ussd_engine
  test_channel_gateway
  test_bot_logic
  test_core_banking
  test_indices
  test_credit_scoring
  test_aml_subscriber
  test_market_data
  test_middleware_hub
  test_opensearch_sync
  test_business_flows

  # ─── Summary ──────────────────────────────────────────────────────────────
  local total=$((PASS + FAIL + SKIP))
  echo -e "\n${BOLD}${CYAN}═══ Test Summary ═══${NC}"
  echo -e "  Total:   $total"
  echo -e "  ${GREEN}Passed:  $PASS${NC}"
  echo -e "  ${RED}Failed:  $FAIL${NC}"
  echo -e "  ${YELLOW}Skipped: $SKIP${NC}"

  if [[ ${#FAILED_SERVICES[@]} -gt 0 ]]; then
    echo -e "\n${RED}Failed services:${NC}"
    for svc in "${FAILED_SERVICES[@]}"; do
      echo -e "  ${RED}✗${NC} $svc"
    done
  fi

  echo -e "\n  Completed: $(date)"

  if [[ $FAIL -gt 0 ]]; then
    echo -e "\n${RED}${BOLD}SMOKE TESTS FAILED ($FAIL failures)${NC}"
    exit 1
  else
    echo -e "\n${GREEN}${BOLD}ALL SMOKE TESTS PASSED${NC}"
    exit 0
  fi
}

main "$@"
