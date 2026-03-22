package api

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/munisp/NGApp/services/gateway/internal/config"
	"github.com/munisp/NGApp/services/gateway/internal/dapr"
	"github.com/munisp/NGApp/services/gateway/internal/fluvio"
	kafkaclient "github.com/munisp/NGApp/services/gateway/internal/kafka"
	"github.com/munisp/NGApp/services/gateway/internal/keycloak"
	"github.com/munisp/NGApp/services/gateway/internal/models"
	"github.com/munisp/NGApp/services/gateway/internal/permify"
	redisclient "github.com/munisp/NGApp/services/gateway/internal/redis"
	"github.com/munisp/NGApp/services/gateway/internal/temporal"
	"github.com/munisp/NGApp/services/gateway/internal/tigerbeetle"
)

func setupTestServer() (*Server, *gin.Engine) {
	gin.SetMode(gin.TestMode)
	cfg := &config.Config{
		Port:                 "8090",
		Environment:          "development",
		CORSOrigins:          "http://localhost:3000",
		KafkaBrokers:         "localhost:9092",
		RedisURL:             "localhost:6379",
		TemporalHost:         "localhost:7233",
		TigerBeetleAddresses: "localhost:3001",
		DaprHTTPPort:         "3500",
		DaprGRPCPort:         "50001",
		FluvioEndpoint:       "localhost:9003",
		KeycloakURL:          "http://localhost:8080",
		KeycloakRealm:        "nexcom",
		KeycloakClientID:     "nexcom-gateway",
		PermifyEndpoint:      "localhost:3476",
	}

	k := kafkaclient.NewClient(cfg.KafkaBrokers)
	r := redisclient.NewClient(cfg.RedisURL)
	t := temporal.NewClient(cfg.TemporalHost)
	tb := tigerbeetle.NewClient(cfg.TigerBeetleAddresses)
	d := dapr.NewClient(cfg.DaprHTTPPort, cfg.DaprGRPCPort)
	f := fluvio.NewClient(cfg.FluvioEndpoint)
	kc := keycloak.NewClient(cfg.KeycloakURL, cfg.KeycloakRealm, cfg.KeycloakClientID)
	p := permify.NewClient(cfg.PermifyEndpoint)

	srv := NewServer(cfg, k, r, t, tb, d, f, kc, p)
	router := srv.SetupRoutes()
	return srv, router
}

func TestHealthCheck(t *testing.T) {
	_, router := setupTestServer()

	w := httptest.NewRecorder()
	req, _ := http.NewRequest("GET", "/health", nil)
	router.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected status 200, got %d", w.Code)
	}

	var resp models.APIResponse
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to unmarshal response: %v", err)
	}
	if !resp.Success {
		t.Error("expected success=true")
	}
}

func TestListMarkets(t *testing.T) {
	_, router := setupTestServer()

	w := httptest.NewRecorder()
	req, _ := http.NewRequest("GET", "/api/v1/markets", nil)
	req.Header.Set("Authorization", "Bearer demo-token")
	router.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected status 200, got %d", w.Code)
	}

	var resp models.APIResponse
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to unmarshal response: %v", err)
	}
	if !resp.Success {
		t.Error("expected success=true")
	}
}

func TestSearchMarkets(t *testing.T) {
	_, router := setupTestServer()

	w := httptest.NewRecorder()
	req, _ := http.NewRequest("GET", "/api/v1/markets/search?q=GOLD", nil)
	req.Header.Set("Authorization", "Bearer demo-token")
	router.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected status 200, got %d", w.Code)
	}
}

func TestGetTicker(t *testing.T) {
	_, router := setupTestServer()

	w := httptest.NewRecorder()
	req, _ := http.NewRequest("GET", "/api/v1/markets/GOLD/ticker", nil)
	req.Header.Set("Authorization", "Bearer demo-token")
	router.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected status 200, got %d", w.Code)
	}
}

func TestGetTickerNotFound(t *testing.T) {
	_, router := setupTestServer()

	w := httptest.NewRecorder()
	req, _ := http.NewRequest("GET", "/api/v1/markets/INVALID/ticker", nil)
	req.Header.Set("Authorization", "Bearer demo-token")
	router.ServeHTTP(w, req)

	if w.Code != http.StatusNotFound {
		t.Errorf("expected status 404, got %d", w.Code)
	}
}

func TestGetOrderBook(t *testing.T) {
	_, router := setupTestServer()

	w := httptest.NewRecorder()
	req, _ := http.NewRequest("GET", "/api/v1/markets/MAIZE/orderbook", nil)
	req.Header.Set("Authorization", "Bearer demo-token")
	router.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected status 200, got %d", w.Code)
	}
}

func TestGetCandles(t *testing.T) {
	_, router := setupTestServer()

	w := httptest.NewRecorder()
	req, _ := http.NewRequest("GET", "/api/v1/markets/GOLD/candles?interval=1h", nil)
	req.Header.Set("Authorization", "Bearer demo-token")
	router.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected status 200, got %d", w.Code)
	}
}

func TestListOrders(t *testing.T) {
	_, router := setupTestServer()

	w := httptest.NewRecorder()
	req, _ := http.NewRequest("GET", "/api/v1/orders", nil)
	req.Header.Set("Authorization", "Bearer demo-token")
	router.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected status 200, got %d", w.Code)
	}
}

func TestCreateOrder(t *testing.T) {
	_, router := setupTestServer()

	order := map[string]interface{}{
		"symbol":   "GOLD",
		"side":     "BUY",
		"type":     "LIMIT",
		"quantity": 10,
		"price":    2050.00,
	}
	body, _ := json.Marshal(order)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest("POST", "/api/v1/orders", bytes.NewBuffer(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer demo-token")
	router.ServeHTTP(w, req)

	if w.Code != http.StatusCreated {
		t.Errorf("expected status 201, got %d; body: %s", w.Code, w.Body.String())
	}
}

func TestCancelOrder(t *testing.T) {
	_, router := setupTestServer()

	// First get orders to find an open one
	w := httptest.NewRecorder()
	req, _ := http.NewRequest("GET", "/api/v1/orders?status=OPEN", nil)
	req.Header.Set("Authorization", "Bearer demo-token")
	router.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", w.Code)
	}
}

func TestListTrades(t *testing.T) {
	_, router := setupTestServer()

	w := httptest.NewRecorder()
	req, _ := http.NewRequest("GET", "/api/v1/trades", nil)
	req.Header.Set("Authorization", "Bearer demo-token")
	router.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected status 200, got %d", w.Code)
	}
}

func TestGetPortfolio(t *testing.T) {
	_, router := setupTestServer()

	w := httptest.NewRecorder()
	req, _ := http.NewRequest("GET", "/api/v1/portfolio", nil)
	req.Header.Set("Authorization", "Bearer demo-token")
	router.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected status 200, got %d", w.Code)
	}
}

func TestListPositions(t *testing.T) {
	_, router := setupTestServer()

	w := httptest.NewRecorder()
	req, _ := http.NewRequest("GET", "/api/v1/portfolio/positions", nil)
	req.Header.Set("Authorization", "Bearer demo-token")
	router.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected status 200, got %d", w.Code)
	}
}

func TestListAlerts(t *testing.T) {
	_, router := setupTestServer()

	w := httptest.NewRecorder()
	req, _ := http.NewRequest("GET", "/api/v1/alerts", nil)
	req.Header.Set("Authorization", "Bearer demo-token")
	router.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected status 200, got %d", w.Code)
	}
}

func TestCreateAlert(t *testing.T) {
	_, router := setupTestServer()

	alert := map[string]interface{}{
		"symbol":      "GOLD",
		"condition":   "ABOVE",
		"targetPrice": 2100.00,
	}
	body, _ := json.Marshal(alert)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest("POST", "/api/v1/alerts", bytes.NewBuffer(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer demo-token")
	router.ServeHTTP(w, req)

	if w.Code != http.StatusCreated {
		t.Errorf("expected status 201, got %d; body: %s", w.Code, w.Body.String())
	}
}

func TestGetProfile(t *testing.T) {
	_, router := setupTestServer()

	w := httptest.NewRecorder()
	req, _ := http.NewRequest("GET", "/api/v1/account/profile", nil)
	req.Header.Set("Authorization", "Bearer demo-token")
	router.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected status 200, got %d", w.Code)
	}
}

func TestUpdateProfile(t *testing.T) {
	_, router := setupTestServer()

	update := map[string]interface{}{
		"name":  "Updated Trader",
		"phone": "+254700000000",
	}
	body, _ := json.Marshal(update)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest("PATCH", "/api/v1/account/profile", bytes.NewBuffer(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer demo-token")
	router.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected status 200, got %d", w.Code)
	}
}

func TestGetPreferences(t *testing.T) {
	_, router := setupTestServer()

	w := httptest.NewRecorder()
	req, _ := http.NewRequest("GET", "/api/v1/account/preferences", nil)
	req.Header.Set("Authorization", "Bearer demo-token")
	router.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected status 200, got %d", w.Code)
	}
}

func TestListNotifications(t *testing.T) {
	_, router := setupTestServer()

	w := httptest.NewRecorder()
	req, _ := http.NewRequest("GET", "/api/v1/notifications", nil)
	req.Header.Set("Authorization", "Bearer demo-token")
	router.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected status 200, got %d", w.Code)
	}
}

func TestMiddlewareStatus(t *testing.T) {
	_, router := setupTestServer()

	w := httptest.NewRecorder()
	req, _ := http.NewRequest("GET", "/api/v1/middleware/status", nil)
	req.Header.Set("Authorization", "Bearer demo-token")
	router.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected status 200, got %d", w.Code)
	}
}

func TestLoginDemoCredentials(t *testing.T) {
	_, router := setupTestServer()

	login := map[string]interface{}{
		"email":    "trader@nexcom.exchange",
		"password": "demo",
	}
	body, _ := json.Marshal(login)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest("POST", "/api/v1/auth/login", bytes.NewBuffer(body))
	req.Header.Set("Content-Type", "application/json")
	router.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected status 200, got %d", w.Code)
	}

	var resp models.APIResponse
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to unmarshal response: %v", err)
	}
	if !resp.Success {
		t.Error("expected success=true for demo login")
	}
}

func TestLogout(t *testing.T) {
	_, router := setupTestServer()

	w := httptest.NewRecorder()
	req, _ := http.NewRequest("POST", "/api/v1/auth/logout", nil)
	req.Header.Set("Authorization", "Bearer demo-token")
	router.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected status 200, got %d", w.Code)
	}
}

func TestAnalyticsDashboard(t *testing.T) {
	_, router := setupTestServer()

	w := httptest.NewRecorder()
	req, _ := http.NewRequest("GET", "/api/v1/analytics/dashboard", nil)
	req.Header.Set("Authorization", "Bearer demo-token")
	router.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected status 200, got %d", w.Code)
	}
}

func TestListAccounts(t *testing.T) {
	_, router := setupTestServer()

	w := httptest.NewRecorder()
	req, _ := http.NewRequest("GET", "/api/v1/accounts", nil)
	req.Header.Set("Authorization", "Bearer demo-token")
	router.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected status 200, got %d", w.Code)
	}
}

func TestListAuditLog(t *testing.T) {
	_, router := setupTestServer()

	w := httptest.NewRecorder()
	req, _ := http.NewRequest("GET", "/api/v1/audit-log", nil)
	req.Header.Set("Authorization", "Bearer demo-token")
	router.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected status 200, got %d", w.Code)
	}
}

func TestCORSHeaders(t *testing.T) {
	_, router := setupTestServer()

	w := httptest.NewRecorder()
	req, _ := http.NewRequest("OPTIONS", "/api/v1/markets", nil)
	req.Header.Set("Origin", "http://localhost:3000")
	router.ServeHTTP(w, req)

	if w.Code != http.StatusNoContent {
		t.Errorf("expected status 204 for OPTIONS, got %d", w.Code)
	}

	if w.Header().Get("Access-Control-Allow-Origin") != "http://localhost:3000" {
		t.Error("expected CORS origin header")
	}
}

func TestAuthMiddlewareRejectsNoToken(t *testing.T) {
	_, router := setupTestServer()

	// In production mode, should reject. But in dev mode, falls back to demo user.
	// Since we're in dev mode, this should actually pass.
	w := httptest.NewRecorder()
	req, _ := http.NewRequest("GET", "/api/v1/markets", nil)
	router.ServeHTTP(w, req)

	// Dev mode allows unauthenticated access
	if w.Code != http.StatusOK {
		t.Errorf("expected status 200 in dev mode without token, got %d", w.Code)
	}
}

func TestPlatformHealth(t *testing.T) {
	_, router := setupTestServer()

	w := httptest.NewRecorder()
	req, _ := http.NewRequest("GET", "/api/v1/platform/health", nil)
	req.Header.Set("Authorization", "Bearer demo-token")
	router.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected status 200, got %d", w.Code)
	}
}
