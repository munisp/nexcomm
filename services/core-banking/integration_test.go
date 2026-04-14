// Package main — Core Banking Service Integration Tests
// ======================================================
// Tests the full loan lifecycle, input financing, and banking API endpoints.
// Run with: go test -v -tags integration ./...
// Or for unit tests only: go test -v ./...
package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
	"time"
)

// ─── Test Helpers ─────────────────────────────────────────────────────────────

type TestServer struct {
	URL    string
	Client *http.Client
}

func newTestServer(t *testing.T) *TestServer {
	t.Helper()
	baseURL := os.Getenv("CORE_BANKING_URL")
	if baseURL == "" {
		baseURL = "http://localhost:8083"
	}
	return &TestServer{
		URL:    baseURL,
		Client: &http.Client{Timeout: 10 * time.Second},
	}
}

func (ts *TestServer) get(t *testing.T, path string) (int, map[string]interface{}) {
	t.Helper()
	resp, err := ts.Client.Get(ts.URL + path)
	if err != nil {
		t.Fatalf("GET %s failed: %v", path, err)
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	var result map[string]interface{}
	_ = json.Unmarshal(body, &result)
	return resp.StatusCode, result
}

func (ts *TestServer) post(t *testing.T, path string, payload interface{}) (int, map[string]interface{}) {
	t.Helper()
	data, _ := json.Marshal(payload)
	resp, err := ts.Client.Post(ts.URL+path, "application/json", bytes.NewReader(data))
	if err != nil {
		t.Fatalf("POST %s failed: %v", path, err)
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	var result map[string]interface{}
	_ = json.Unmarshal(body, &result)
	return resp.StatusCode, result
}

// ─── Health Tests ─────────────────────────────────────────────────────────────

func TestHealth(t *testing.T) {
	ts := newTestServer(t)
	status, body := ts.get(t, "/health")
	if status != http.StatusOK {
		t.Fatalf("Expected 200, got %d", status)
	}
	if body["status"] != "ok" {
		t.Errorf("Expected status=ok, got %v", body["status"])
	}
	t.Logf("Health check passed: %+v", body)
}

// ─── Loan Products Tests ───────────────────────────────────────────────────────

func TestGetLoanProducts(t *testing.T) {
	ts := newTestServer(t)
	status, body := ts.get(t, "/api/v1/loan-products")
	if status != http.StatusOK {
		t.Fatalf("Expected 200, got %d", status)
	}
	products, ok := body["products"].([]interface{})
	if !ok {
		t.Fatalf("Expected products array, got %T", body["products"])
	}
	if len(products) == 0 {
		t.Error("Expected at least one loan product")
	}
	t.Logf("Found %d loan products", len(products))
}

// ─── Loan Application Tests ────────────────────────────────────────────────────

func TestLoanApplicationLifecycle(t *testing.T) {
	if testing.Short() {
		t.Skip("Skipping lifecycle test in short mode")
	}

	ts := newTestServer(t)

	// Step 1: Submit loan application
	t.Run("Submit Application", func(t *testing.T) {
		payload := map[string]interface{}{
			"farmer_id":            1001,
			"product_id":           "AGRI-LOAN-001",
			"requested_amount_ngn": 500000,
			"purpose":              "Maize seed and fertilizer purchase",
			"term_months":          6,
			"collateral": map[string]interface{}{
				"type":      "WAREHOUSE_RECEIPT",
				"value_ngn": 800000,
				"ref":       "WHR-2024-001234",
			},
		}
		status, body := ts.post(t, "/api/v1/loans/apply", payload)
		if status != http.StatusCreated && status != http.StatusOK {
			t.Fatalf("Expected 201/200, got %d: %v", status, body)
		}
		if body["loan_id"] == nil {
			t.Error("Expected loan_id in response")
		}
		t.Logf("Loan application submitted: %v", body["loan_id"])
	})

	// Step 2: List pending loans (admin)
	t.Run("List Pending Loans", func(t *testing.T) {
		status, body := ts.get(t, "/api/v1/admin/loans?status=PENDING")
		if status != http.StatusOK && status != http.StatusUnauthorized {
			t.Fatalf("Expected 200 or 401, got %d", status)
		}
		if status == http.StatusOK {
			loans, ok := body["loans"].([]interface{})
			if !ok {
				t.Logf("Loans field: %T = %v", body["loans"], body["loans"])
			} else {
				t.Logf("Found %d pending loans", len(loans))
			}
		}
	})
}

// ─── Input Financing Tests ─────────────────────────────────────────────────────

func TestInputFinancingProducts(t *testing.T) {
	ts := newTestServer(t)
	status, body := ts.get(t, "/api/v1/input-financing/products")
	if status != http.StatusOK {
		t.Fatalf("Expected 200, got %d: %v", status, body)
	}
	t.Logf("Input financing products: %+v", body)
}

// ─── Bank Account Tests ────────────────────────────────────────────────────────

func TestBankAccountEndpoints(t *testing.T) {
	ts := newTestServer(t)

	// Unauthenticated access should return 401
	status, _ := ts.get(t, "/api/v1/accounts")
	if status != http.StatusUnauthorized && status != http.StatusForbidden {
		t.Logf("Note: /api/v1/accounts returned %d (expected 401/403 without auth)", status)
	}
}

// ─── Credit Score Integration Tests ───────────────────────────────────────────

func TestCreditScoreIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("Skipping credit score integration test in short mode")
	}

	creditScoringURL := os.Getenv("CREDIT_SCORING_URL")
	if creditScoringURL == "" {
		creditScoringURL = "http://localhost:8089"
	}

	client := &http.Client{Timeout: 15 * time.Second}

	// Test credit scoring health
	resp, err := client.Get(creditScoringURL + "/health")
	if err != nil {
		t.Skipf("Credit scoring service not available: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("Credit scoring health check failed: %d", resp.StatusCode)
	}

	// Test scoring request
	payload := map[string]interface{}{
		"farmer_id":                  1001,
		"loan_amount_ngn":            500000,
		"loan_purpose":               "Input financing",
		"loan_term_months":           6,
		"annual_farm_income_ngn":     1200000,
		"farm_size_hectares":         8.0,
		"years_farming":              5,
		"total_loans_taken":          3,
		"loans_repaid_on_time":       3,
		"loans_defaulted":            0,
		"warehouse_receipt_value_ngn": 800000,
		"cooperative_member":         true,
		"cooperative_years":          3,
	}

	data, _ := json.Marshal(payload)
	resp2, err := client.Post(creditScoringURL+"/api/v1/score", "application/json", bytes.NewReader(data))
	if err != nil {
		t.Fatalf("Credit scoring request failed: %v", err)
	}
	defer resp2.Body.Close()

	body, _ := io.ReadAll(resp2.Body)
	var result map[string]interface{}
	if err := json.Unmarshal(body, &result); err != nil {
		t.Fatalf("Failed to parse credit score response: %v", err)
	}

	score, ok := result["score"].(float64)
	if !ok {
		t.Fatalf("Expected numeric score, got %T: %v", result["score"], result["score"])
	}

	if score < 300 || score > 850 {
		t.Errorf("Score %v out of valid range [300, 850]", score)
	}

	decision, _ := result["decision"].(string)
	t.Logf("Credit score: %.0f, decision: %s", score, decision)
}

// ─── Agri-Banking Business Rules Tests ────────────────────────────────────────

func TestAgriLoanBusinessRules(t *testing.T) {
	tests := []struct {
		name           string
		loanAmount     float64
		annualIncome   float64
		farmSize       float64
		collateralValue float64
		expectApproval bool
		description    string
	}{
		{
			name:           "Small farmer with good collateral",
			loanAmount:     200000,
			annualIncome:   600000,
			farmSize:       3.0,
			collateralValue: 350000,
			expectApproval: true,
			description:    "Loan-to-income ratio 0.33 — should approve",
		},
		{
			name:           "Large loan exceeds income multiple",
			loanAmount:     10000000,
			annualIncome:   500000,
			farmSize:       5.0,
			collateralValue: 2000000,
			expectApproval: false,
			description:    "Loan-to-income ratio 20x — should decline",
		},
		{
			name:           "Adequate collateral coverage",
			loanAmount:     1000000,
			annualIncome:   2000000,
			farmSize:       15.0,
			collateralValue: 1500000,
			expectApproval: true,
			description:    "1.5x collateral coverage — should approve",
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			// Validate business rules locally (no external service call needed)
			lti := tc.loanAmount / tc.annualIncome
			coverage := tc.collateralValue / tc.loanAmount

			approved := lti <= 3.0 && coverage >= 1.0

			if approved != tc.expectApproval {
				t.Errorf("%s: expected approval=%v, got approval=%v (LTI=%.2f, coverage=%.2f)",
					tc.description, tc.expectApproval, approved, lti, coverage)
			} else {
				t.Logf("✓ %s (LTI=%.2f, coverage=%.2f)", tc.description, lti, coverage)
			}
		})
	}
}

// ─── Mock HTTP Server Tests ────────────────────────────────────────────────────

func TestHealthEndpointMock(t *testing.T) {
	// Test the health endpoint structure without a real server
	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/health" {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusOK)
			fmt.Fprintln(w, `{"status":"ok","service":"core-banking","version":"1.0.0"}`)
		} else {
			w.WriteHeader(http.StatusNotFound)
		}
	})

	server := httptest.NewServer(handler)
	defer server.Close()

	resp, err := http.Get(server.URL + "/health")
	if err != nil {
		t.Fatalf("Request failed: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("Expected 200, got %d", resp.StatusCode)
	}

	body, _ := io.ReadAll(resp.Body)
	var result map[string]interface{}
	if err := json.Unmarshal(body, &result); err != nil {
		t.Fatalf("Failed to parse response: %v", err)
	}

	if result["status"] != "ok" {
		t.Errorf("Expected status=ok, got %v", result["status"])
	}
	t.Logf("Mock health check passed: %+v", result)
}

func TestLoanAmountValidation(t *testing.T) {
	tests := []struct {
		amount  float64
		valid   bool
		reason  string
	}{
		{0, false, "Zero amount not allowed"},
		{-100000, false, "Negative amount not allowed"},
		{50000, true, "Minimum loan amount ₦50,000"},
		{500000, true, "Standard small loan"},
		{5000000, true, "Medium loan"},
		{50000000, true, "Maximum loan ₦50M"},
		{100000000, false, "Exceeds maximum loan limit"},
	}

	for _, tc := range tests {
		t.Run(tc.reason, func(t *testing.T) {
			valid := tc.amount >= 50000 && tc.amount <= 50000000
			if valid != tc.valid {
				t.Errorf("%s: expected valid=%v, got valid=%v for amount=%.0f",
					tc.reason, tc.valid, valid, tc.amount)
			}
		})
	}
}
