package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/munisp/NGApp/services/gateway/internal/config"
	"github.com/munisp/NGApp/services/gateway/internal/dapr"
	"github.com/munisp/NGApp/services/gateway/internal/fluvio"
	kafkaclient "github.com/munisp/NGApp/services/gateway/internal/kafka"
	"github.com/munisp/NGApp/services/gateway/internal/keycloak"
	"github.com/munisp/NGApp/services/gateway/internal/permify"
	redisclient "github.com/munisp/NGApp/services/gateway/internal/redis"
	"github.com/munisp/NGApp/services/gateway/internal/temporal"
	"github.com/munisp/NGApp/services/gateway/internal/tigerbeetle"
)

// apiResp is a helper to parse the APIResponse wrapper
type apiResp struct {
	Success bool                   `json:"success"`
	Data    map[string]interface{} `json:"data"`
	Error   string                 `json:"error"`
}

func setupIntegrationServer() *gin.Engine {
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
	return srv.SetupRoutes()
}

func TestOrderLifecycle(t *testing.T) {
	router := setupIntegrationServer()

	// Create order (matching CreateOrderRequest: symbol, side, type, quantity, price)
	orderJSON := `{"symbol":"GOLD","side":"BUY","type":"LIMIT","quantity":10,"price":1950.50}`
	w := httptest.NewRecorder()
	req, _ := http.NewRequest("POST", "/api/v1/orders", strings.NewReader(orderJSON))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer test-token")
	router.ServeHTTP(w, req)

	if w.Code != http.StatusCreated {
		t.Fatalf("Create order: expected 201, got %d, body: %s", w.Code, w.Body.String())
	}

	var createResp apiResp
	json.Unmarshal(w.Body.Bytes(), &createResp)
	if !createResp.Success {
		t.Fatal("Create order: success=false")
	}
	orderID, ok := createResp.Data["id"].(string)
	if !ok || orderID == "" {
		t.Fatal("Create order: expected order ID in response")
	}

	// Read orders
	w = httptest.NewRecorder()
	req, _ = http.NewRequest("GET", "/api/v1/orders", nil)
	req.Header.Set("Authorization", "Bearer test-token")
	router.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("Get orders: expected 200, got %d", w.Code)
	}

	// Cancel order
	w = httptest.NewRecorder()
	req, _ = http.NewRequest("DELETE", fmt.Sprintf("/api/v1/orders/%s", orderID), nil)
	req.Header.Set("Authorization", "Bearer test-token")
	router.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("Cancel order: expected 200, got %d", w.Code)
	}
}

func TestAlertLifecycle(t *testing.T) {
	router := setupIntegrationServer()

	// Create alert (matching CreateAlertRequest: symbol, condition, targetPrice)
	alertJSON := `{"symbol":"COFFEE","condition":"above","targetPrice":250.00}`
	w := httptest.NewRecorder()
	req, _ := http.NewRequest("POST", "/api/v1/alerts", strings.NewReader(alertJSON))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer test-token")
	router.ServeHTTP(w, req)

	if w.Code != http.StatusCreated {
		t.Fatalf("Create alert: expected 201, got %d, body: %s", w.Code, w.Body.String())
	}

	var alertResp apiResp
	json.Unmarshal(w.Body.Bytes(), &alertResp)
	alertID, ok := alertResp.Data["id"].(string)
	if !ok || alertID == "" {
		t.Fatal("Create alert: expected alert ID")
	}

	// Read alerts
	w = httptest.NewRecorder()
	req, _ = http.NewRequest("GET", "/api/v1/alerts", nil)
	req.Header.Set("Authorization", "Bearer test-token")
	router.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("Get alerts: expected 200, got %d", w.Code)
	}

	// Update alert (PATCH, matching UpdateAlertRequest: active)
	w = httptest.NewRecorder()
	req, _ = http.NewRequest("PATCH", fmt.Sprintf("/api/v1/alerts/%s", alertID), strings.NewReader(`{"active":false}`))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer test-token")
	router.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("Update alert: expected 200, got %d", w.Code)
	}

	// Delete alert
	w = httptest.NewRecorder()
	req, _ = http.NewRequest("DELETE", fmt.Sprintf("/api/v1/alerts/%s", alertID), nil)
	req.Header.Set("Authorization", "Bearer test-token")
	router.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("Delete alert: expected 200, got %d", w.Code)
	}
}

func TestMarketDataConsistency(t *testing.T) {
	router := setupIntegrationServer()

	// Get markets - needs auth in dev mode
	w := httptest.NewRecorder()
	req, _ := http.NewRequest("GET", "/api/v1/markets", nil)
	req.Header.Set("Authorization", "Bearer test-token")
	router.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("Get markets: expected 200, got %d", w.Code)
	}

	var resp apiResp
	json.Unmarshal(w.Body.Bytes(), &resp)
	if !resp.Success {
		t.Fatal("Get markets: success=false")
	}

	commodities, ok := resp.Data["commodities"].([]interface{})
	if !ok || len(commodities) == 0 {
		t.Fatal("Get markets: expected commodities array")
	}

	first := commodities[0].(map[string]interface{})
	symbol := first["symbol"].(string)

	// Get ticker for this symbol
	w = httptest.NewRecorder()
	req, _ = http.NewRequest("GET", fmt.Sprintf("/api/v1/markets/%s/ticker", symbol), nil)
	req.Header.Set("Authorization", "Bearer test-token")
	router.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Errorf("Get ticker for %s: expected 200, got %d", symbol, w.Code)
	}
}

func TestPortfolioAfterTrade(t *testing.T) {
	router := setupIntegrationServer()

	w := httptest.NewRecorder()
	req, _ := http.NewRequest("GET", "/api/v1/portfolio", nil)
	req.Header.Set("Authorization", "Bearer test-token")
	router.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("Get portfolio: expected 200, got %d", w.Code)
	}

	// Create order
	w = httptest.NewRecorder()
	req, _ = http.NewRequest("POST", "/api/v1/orders", strings.NewReader(`{"symbol":"SILVER","side":"BUY","type":"MARKET","quantity":100,"price":25.50}`))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer test-token")
	router.ServeHTTP(w, req)
	if w.Code != http.StatusCreated {
		t.Fatalf("Create order: expected 201, got %d", w.Code)
	}

	// Portfolio still accessible
	w = httptest.NewRecorder()
	req, _ = http.NewRequest("GET", "/api/v1/portfolio", nil)
	req.Header.Set("Authorization", "Bearer test-token")
	router.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("Get portfolio after trade: expected 200, got %d", w.Code)
	}
}

func TestHealthEndpointIntegration(t *testing.T) {
	router := setupIntegrationServer()

	w := httptest.NewRecorder()
	req, _ := http.NewRequest("GET", "/api/v1/health", nil)
	router.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("Health: expected 200, got %d", w.Code)
	}

	var resp apiResp
	json.Unmarshal(w.Body.Bytes(), &resp)
	if !resp.Success {
		t.Fatal("Health: success=false")
	}

	middleware, ok := resp.Data["middleware"].(map[string]interface{})
	if !ok {
		t.Fatal("Health: expected middleware section")
	}

	for _, name := range []string{"kafka", "redis", "temporal", "tigerbeetle", "dapr", "fluvio"} {
		if _, exists := middleware[name]; !exists {
			t.Errorf("Health: missing middleware status for %s", name)
		}
	}
}

func TestNotificationsFlow(t *testing.T) {
	router := setupIntegrationServer()

	w := httptest.NewRecorder()
	req, _ := http.NewRequest("GET", "/api/v1/notifications", nil)
	req.Header.Set("Authorization", "Bearer test-token")
	router.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("Get notifications: expected 200, got %d", w.Code)
	}

	w = httptest.NewRecorder()
	req, _ = http.NewRequest("POST", "/api/v1/notifications/read-all", nil)
	req.Header.Set("Authorization", "Bearer test-token")
	router.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("Mark all read: expected 200, got %d", w.Code)
	}
}

func TestAccountProfileFlow(t *testing.T) {
	router := setupIntegrationServer()

	w := httptest.NewRecorder()
	req, _ := http.NewRequest("GET", "/api/v1/account/profile", nil)
	req.Header.Set("Authorization", "Bearer test-token")
	router.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("Get profile: expected 200, got %d", w.Code)
	}

	// Update profile (matching UpdateProfileRequest: name, phone, country)
	w = httptest.NewRecorder()
	req, _ = http.NewRequest("PATCH", "/api/v1/account/profile", strings.NewReader(`{"name":"Test User","phone":"+254712345678","country":"KE"}`))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer test-token")
	router.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("Update profile: expected 200, got %d", w.Code)
	}
}
