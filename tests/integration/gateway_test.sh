#!/bin/bash
# NEXCOM Exchange - Integration Test Suite
# Tests service-to-service communication through the Go Gateway
# Usage: ./gateway_test.sh [GATEWAY_URL]

set -euo pipefail

GATEWAY_URL="${1:-http://localhost:8000}"
PASS=0
FAIL=0
TOTAL=0

log_test() {
  TOTAL=$((TOTAL + 1))
  local name="$1"
  local expected_status="$2"
  local url="$3"
  local method="${4:-GET}"
  local body="${5:-}"

  if [ "$method" = "GET" ]; then
    response=$(curl -s -o /tmp/resp_body -w "%{http_code}" "$url" -H "Authorization: Bearer demo-token" 2>/dev/null || echo "000")
  else
    response=$(curl -s -o /tmp/resp_body -w "%{http_code}" -X "$method" "$url" -H "Authorization: Bearer demo-token" -H "Content-Type: application/json" -d "$body" 2>/dev/null || echo "000")
  fi

  resp_body=$(cat /tmp/resp_body 2>/dev/null || echo "")

  if [ "$response" = "$expected_status" ]; then
    echo "  PASS: $name (HTTP $response)"
    PASS=$((PASS + 1))
  else
    echo "  FAIL: $name (expected $expected_status, got $response)"
    echo "        Body: $(echo "$resp_body" | head -c 200)"
    FAIL=$((FAIL + 1))
  fi
}

echo "============================================================"
echo "NEXCOM Exchange - Integration Tests"
echo "Gateway: $GATEWAY_URL"
echo "============================================================"
echo ""

# Health
echo "[Health Checks]"
log_test "Gateway health" "200" "$GATEWAY_URL/health"
log_test "API v1 health" "200" "$GATEWAY_URL/api/v1/health"
echo ""

# Auth
echo "[Authentication]"
log_test "Login" "200" "$GATEWAY_URL/api/v1/auth/login" "POST" '{"email":"trader@nexcom.exchange","password":"demo"}'
log_test "Logout" "200" "$GATEWAY_URL/api/v1/auth/logout" "POST" '{}'
echo ""

# Markets
echo "[Markets]"
log_test "List markets" "200" "$GATEWAY_URL/api/v1/markets"
log_test "Search markets" "200" "$GATEWAY_URL/api/v1/markets/search?q=gold"
log_test "Get ticker" "200" "$GATEWAY_URL/api/v1/markets/GOLD/ticker"
log_test "Get orderbook" "200" "$GATEWAY_URL/api/v1/markets/GOLD/orderbook"
log_test "Get candles" "200" "$GATEWAY_URL/api/v1/markets/GOLD/candles?interval=1h&limit=50"
echo ""

# Orders CRUD
echo "[Orders CRUD]"
log_test "List orders" "200" "$GATEWAY_URL/api/v1/orders"
log_test "Create order" "200" "$GATEWAY_URL/api/v1/orders" "POST" '{"symbol":"MAIZE","side":"BUY","type":"LIMIT","quantity":100,"price":280.0}'
log_test "Get order" "200" "$GATEWAY_URL/api/v1/orders/ord-001"
log_test "Cancel order" "200" "$GATEWAY_URL/api/v1/orders/ord-001" "DELETE"
echo ""

# Trades
echo "[Trades]"
log_test "List trades" "200" "$GATEWAY_URL/api/v1/trades"
log_test "Get trade" "200" "$GATEWAY_URL/api/v1/trades/trd-001"
echo ""

# Portfolio
echo "[Portfolio]"
log_test "Get portfolio" "200" "$GATEWAY_URL/api/v1/portfolio"
log_test "List positions" "200" "$GATEWAY_URL/api/v1/portfolio/positions"
log_test "Portfolio history" "200" "$GATEWAY_URL/api/v1/portfolio/history"
echo ""

# Alerts CRUD
echo "[Alerts CRUD]"
log_test "List alerts" "200" "$GATEWAY_URL/api/v1/alerts"
log_test "Create alert" "200" "$GATEWAY_URL/api/v1/alerts" "POST" '{"symbol":"GOLD","condition":"above","targetPrice":2100.0}'
log_test "Update alert" "200" "$GATEWAY_URL/api/v1/alerts/alt-001" "PATCH" '{"active":false}'
log_test "Delete alert" "200" "$GATEWAY_URL/api/v1/alerts/alt-001" "DELETE"
echo ""

# Account
echo "[Account]"
log_test "Get profile" "200" "$GATEWAY_URL/api/v1/account/profile"
log_test "Update profile" "200" "$GATEWAY_URL/api/v1/account/profile" "PATCH" '{"name":"Alex Updated"}'
log_test "Get KYC" "200" "$GATEWAY_URL/api/v1/account/kyc"
log_test "Get sessions" "200" "$GATEWAY_URL/api/v1/account/sessions"
log_test "Get preferences" "200" "$GATEWAY_URL/api/v1/account/preferences"
log_test "Update preferences" "200" "$GATEWAY_URL/api/v1/account/preferences" "PATCH" '{"orderFilled":true}'
echo ""

# Notifications
echo "[Notifications]"
log_test "List notifications" "200" "$GATEWAY_URL/api/v1/notifications"
log_test "Mark notification read" "200" "$GATEWAY_URL/api/v1/notifications/notif-001/read" "PATCH"
log_test "Mark all read" "200" "$GATEWAY_URL/api/v1/notifications/read-all" "POST" '{}'
echo ""

# Analytics
echo "[Analytics]"
log_test "Dashboard" "200" "$GATEWAY_URL/api/v1/analytics/dashboard"
log_test "PnL report" "200" "$GATEWAY_URL/api/v1/analytics/pnl"
log_test "Geospatial" "200" "$GATEWAY_URL/api/v1/analytics/geospatial/MAIZE"
log_test "AI insights" "200" "$GATEWAY_URL/api/v1/analytics/ai-insights"
log_test "Price forecast" "200" "$GATEWAY_URL/api/v1/analytics/forecast/GOLD"
echo ""

# Matching Engine (proxied)
echo "[Matching Engine Proxy]"
log_test "ME status" "200" "$GATEWAY_URL/api/v1/matching-engine/status"
log_test "ME futures" "200" "$GATEWAY_URL/api/v1/matching-engine/futures/contracts"
log_test "ME warehouses" "200" "$GATEWAY_URL/api/v1/matching-engine/delivery/warehouses"
echo ""

# Ingestion Engine (proxied)
echo "[Ingestion Engine Proxy]"
log_test "IE feeds" "200" "$GATEWAY_URL/api/v1/ingestion/feeds"
log_test "IE lakehouse" "200" "$GATEWAY_URL/api/v1/ingestion/lakehouse/status"
echo ""

# Platform Health Aggregator
echo "[Platform Health]"
log_test "Platform health" "200" "$GATEWAY_URL/api/v1/platform/health"
echo ""

# Accounts CRUD
echo "[Accounts CRUD]"
log_test "List accounts" "200" "$GATEWAY_URL/api/v1/accounts"
log_test "Create account" "201" "$GATEWAY_URL/api/v1/accounts" "POST" '{"userId":"usr-001","type":"trading","currency":"USD"}'
echo ""

# Audit Log
echo "[Audit Log]"
log_test "List audit log" "200" "$GATEWAY_URL/api/v1/audit-log"
echo ""

# Middleware Status
echo "[Middleware]"
log_test "Middleware status" "200" "$GATEWAY_URL/api/v1/middleware/status"
echo ""

# WebSocket endpoints
echo "[WebSocket]"
log_test "WS notifications info" "200" "$GATEWAY_URL/api/v1/ws/notifications"
log_test "WS market-data info" "200" "$GATEWAY_URL/api/v1/ws/market-data"
echo ""

echo "============================================================"
echo "Results: $PASS/$TOTAL passed, $FAIL failed"
echo "============================================================"

if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
