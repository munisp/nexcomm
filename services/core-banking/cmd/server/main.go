// main.go — NEXCOM Core Banking Integration Service
//
// This service is the bridge between the NEXCOM Exchange platform and
// external core banking systems (Temenos Transact, Infosys Finacle, Mambu).
// It exposes:
//   - HTTP REST API on :8090  (health, metrics, account/loan/payment endpoints)
//   - gRPC API on :9090       (for internal microservice communication)
//
// The active CBS adapter is selected via the CBS_PROVIDER env variable:
//   CBS_PROVIDER=temenos|finacle|mambu
//
// All banking operations are published to Kafka topics under the "agri.*"
// namespace for consumption by risk, analytics, and notification services.
package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"
	"github.com/nexcom/core-banking/internal/adapters/finacle"
	"github.com/nexcom/core-banking/internal/adapters/mambu"
	"github.com/nexcom/core-banking/internal/adapters/temenos"
	"github.com/nexcom/core-banking/internal/agribanking"
	"github.com/nexcom/core-banking/internal/models"
	"github.com/prometheus/client_golang/prometheus/promhttp"
	"github.com/shopspring/decimal"
	"go.uber.org/zap"
)

func main() {
	log, _ := zap.NewProduction()
	defer log.Sync()

	// ── Select the required, explicitly configured CBS adapter ─────────────────
	provider := strings.ToLower(strings.TrimSpace(os.Getenv("CBS_PROVIDER")))
	var cbs models.CBSAdapter

	switch provider {
	case "temenos":
		cbs = temenos.New(temenos.Config{
			BaseURL:      requiredEnv(log, "TEMENOS_BASE_URL"),
			TokenURL:     requiredEnv(log, "TEMENOS_TOKEN_URL"),
			ClientID:     requiredEnv(log, "TEMENOS_CLIENT_ID"),
			ClientSecret: requiredEnv(log, "TEMENOS_CLIENT_SECRET"),
			CompanyID:    requiredEnv(log, "TEMENOS_COMPANY_ID"),
			Timeout:      30 * time.Second,
		}, log)
	case "finacle":
		cbs = finacle.New(finacle.Config{
			BaseURL:      requiredEnv(log, "FINACLE_BASE_URL"),
			TokenURL:     requiredEnv(log, "FINACLE_TOKEN_URL"),
			ClientID:     requiredEnv(log, "FINACLE_CLIENT_ID"),
			ClientSecret: requiredEnv(log, "FINACLE_CLIENT_SECRET"),
			BankCode:     requiredEnv(log, "FINACLE_BANK_CODE"),
			Timeout:      30 * time.Second,
		}, log)
	case "mambu":
		cbs = mambu.New(mambu.Config{
			BaseURL: requiredEnv(log, "MAMBU_BASE_URL"),
			APIKey:  requiredEnv(log, "MAMBU_API_KEY"),
			Timeout: 30 * time.Second,
		}, log)
	default:
		log.Fatal("CBS_PROVIDER must be one of temenos, finacle, or mambu; mock adapters are prohibited outside isolated tests")
	}

	log.Info("core banking service starting",
		zap.String("provider", cbs.Name()),
		zap.String("cbsProvider", provider))

	// ── Agribanking service ───────────────────────────────────────────────────
	agriSvc := agribanking.New(cbs, nil, log) // Kafka producer wired in production

	// ── HTTP router ───────────────────────────────────────────────────────────
	r := chi.NewRouter()
	r.Use(middleware.RequestID)
	r.Use(middleware.RealIP)
	r.Use(middleware.Logger)
	r.Use(middleware.Recoverer)
	r.Use(middleware.Timeout(30 * time.Second))
	r.Use(cors.Handler(cors.Options{
		AllowedOrigins: []string{"*"},
		AllowedMethods: []string{"GET", "POST", "PUT", "DELETE", "OPTIONS"},
		AllowedHeaders: []string{"Accept", "Authorization", "Content-Type", "X-Request-ID"},
	}))

	// Health
	r.Get("/health", func(w http.ResponseWriter, req *http.Request) {
		ctx, cancel := context.WithTimeout(req.Context(), 5*time.Second)
		defer cancel()
		status := "ok"
		if err := cbs.Ping(ctx); err != nil {
			status = "degraded"
		}
		writeJSON(w, http.StatusOK, map[string]string{
			"status":   status,
			"provider": cbs.Name(),
			"version":  "1.0.0",
		})
	})

	// Metrics
	r.Handle("/metrics", promhttp.Handler())

	// ── Account endpoints ─────────────────────────────────────────────────────
	r.Route("/accounts", func(r chi.Router) {
		r.Get("/{accountRef}", func(w http.ResponseWriter, req *http.Request) {
			ref := chi.URLParam(req, "accountRef")
			acct, err := cbs.GetAccount(req.Context(), ref)
			if err != nil {
				writeError(w, http.StatusBadGateway, err.Error())
				return
			}
			writeJSON(w, http.StatusOK, acct)
		})

		r.Get("/owner/{ownerID}", func(w http.ResponseWriter, req *http.Request) {
			ownerID := chi.URLParam(req, "ownerID")
			accounts, err := cbs.GetAccountsByOwner(req.Context(), ownerID)
			if err != nil {
				writeError(w, http.StatusBadGateway, err.Error())
				return
			}
			writeJSON(w, http.StatusOK, accounts)
		})

		r.Get("/{accountRef}/transactions", func(w http.ResponseWriter, req *http.Request) {
			ref := chi.URLParam(req, "accountRef")
			from := parseDate(req.URL.Query().Get("from"), time.Now().AddDate(0, -1, 0))
			to := parseDate(req.URL.Query().Get("to"), time.Now())
			txns, err := cbs.GetTransactions(req.Context(), ref, from, to)
			if err != nil {
				writeError(w, http.StatusBadGateway, err.Error())
				return
			}
			writeJSON(w, http.StatusOK, txns)
		})

		r.Post("/escrow", func(w http.ResponseWriter, req *http.Request) {
			var body struct {
				OwnerID  string `json:"ownerId"`
				Currency string `json:"currency"`
			}
			if err := json.NewDecoder(req.Body).Decode(&body); err != nil {
				writeError(w, http.StatusBadRequest, "invalid request body")
				return
			}
			acct, err := cbs.CreateEscrowAccount(req.Context(), body.OwnerID, body.Currency)
			if err != nil {
				writeError(w, http.StatusBadGateway, err.Error())
				return
			}
			writeJSON(w, http.StatusCreated, acct)
		})
	})

	// ── Loan endpoints ────────────────────────────────────────────────────────
	r.Route("/loans", func(r chi.Router) {
		r.Get("/{loanRef}", func(w http.ResponseWriter, req *http.Request) {
			ref := chi.URLParam(req, "loanRef")
			loan, err := cbs.GetLoan(req.Context(), ref)
			if err != nil {
				writeError(w, http.StatusBadGateway, err.Error())
				return
			}
			writeJSON(w, http.StatusOK, loan)
		})

		r.Get("/borrower/{borrowerID}", func(w http.ResponseWriter, req *http.Request) {
			borrowerID := chi.URLParam(req, "borrowerID")
			loans, err := cbs.GetLoansByBorrower(req.Context(), borrowerID)
			if err != nil {
				writeError(w, http.StatusBadGateway, err.Error())
				return
			}
			writeJSON(w, http.StatusOK, loans)
		})

		r.Post("/input", func(w http.ResponseWriter, req *http.Request) {
			var body agribanking.InputLoanRequest
			if err := json.NewDecoder(req.Body).Decode(&body); err != nil {
				writeError(w, http.StatusBadRequest, "invalid request body")
				return
			}
			loan, err := agriSvc.DisburseInputLoan(req.Context(), body)
			if err != nil {
				writeError(w, http.StatusBadGateway, err.Error())
				return
			}
			writeJSON(w, http.StatusCreated, loan)
		})

		r.Post("/wr-finance", func(w http.ResponseWriter, req *http.Request) {
			var body agribanking.WRFinancingRequest
			if err := json.NewDecoder(req.Body).Decode(&body); err != nil {
				writeError(w, http.StatusBadRequest, "invalid request body")
				return
			}
			result, err := agriSvc.IssueWRFinancing(req.Context(), body)
			if err != nil {
				writeError(w, http.StatusBadGateway, err.Error())
				return
			}
			writeJSON(w, http.StatusCreated, result)
		})

		r.Post("/{loanRef}/repayment", func(w http.ResponseWriter, req *http.Request) {
			ref := chi.URLParam(req, "loanRef")
			var body struct {
				Amount string `json:"amount"`
			}
			if err := json.NewDecoder(req.Body).Decode(&body); err != nil {
				writeError(w, http.StatusBadRequest, "invalid request body")
				return
			}
			amount, err := decimal.NewFromString(body.Amount)
			if err != nil {
				writeError(w, http.StatusBadRequest, "invalid amount")
				return
			}
			loan, err := cbs.RecordRepayment(req.Context(), ref, amount)
			if err != nil {
				writeError(w, http.StatusBadGateway, err.Error())
				return
			}
			writeJSON(w, http.StatusOK, loan)
		})
	})

	// ── Payment endpoints ─────────────────────────────────────────────────────
	r.Route("/payments", func(r chi.Router) {
		r.Post("/", func(w http.ResponseWriter, req *http.Request) {
			var instr models.PaymentInstruction
			if err := json.NewDecoder(req.Body).Decode(&instr); err != nil {
				writeError(w, http.StatusBadRequest, "invalid request body")
				return
			}
			status, err := cbs.InitiatePayment(req.Context(), &instr)
			if err != nil {
				writeError(w, http.StatusBadGateway, err.Error())
				return
			}
			writeJSON(w, http.StatusCreated, status)
		})

		r.Get("/{instructionID}/status", func(w http.ResponseWriter, req *http.Request) {
			id := chi.URLParam(req, "instructionID")
			status, err := cbs.GetPaymentStatus(req.Context(), id)
			if err != nil {
				writeError(w, http.StatusBadGateway, err.Error())
				return
			}
			writeJSON(w, http.StatusOK, status)
		})
	})

	// ── Agribanking endpoints ─────────────────────────────────────────────────
	r.Route("/agri", func(r chi.Router) {
		r.Post("/onboard-farmer", func(w http.ResponseWriter, req *http.Request) {
			var body agribanking.OnboardFarmerRequest
			if err := json.NewDecoder(req.Body).Decode(&body); err != nil {
				writeError(w, http.StatusBadRequest, "invalid request body")
				return
			}
			result, err := agriSvc.OnboardFarmer(req.Context(), body)
			if err != nil {
				writeError(w, http.StatusBadGateway, err.Error())
				return
			}
			writeJSON(w, http.StatusCreated, result)
		})

		r.Post("/crop-cycles", func(w http.ResponseWriter, req *http.Request) {
			var cycle models.CropCycle
			if err := json.NewDecoder(req.Body).Decode(&cycle); err != nil {
				writeError(w, http.StatusBadRequest, "invalid request body")
				return
			}
			result, err := agriSvc.RegisterCropCycle(req.Context(), &cycle)
			if err != nil {
				writeError(w, http.StatusInternalServerError, err.Error())
				return
			}
			writeJSON(w, http.StatusCreated, result)
		})

		r.Post("/settlement-repayment", func(w http.ResponseWriter, req *http.Request) {
			var body agribanking.SettlementRepaymentRequest
			if err := json.NewDecoder(req.Body).Decode(&body); err != nil {
				writeError(w, http.StatusBadRequest, "invalid request body")
				return
			}
			if err := agriSvc.ProcessSettlementRepayment(req.Context(), body); err != nil {
				writeError(w, http.StatusBadGateway, err.Error())
				return
			}
			writeJSON(w, http.StatusOK, map[string]string{"status": "processed"})
		})
	})

	// ── Start server ──────────────────────────────────────────────────────────
	port := getEnv("PORT", "8090")
	srv := &http.Server{
		Addr:         ":" + port,
		Handler:      r,
		ReadTimeout:  30 * time.Second,
		WriteTimeout: 30 * time.Second,
		IdleTimeout:  120 * time.Second,
	}

	go func() {
		log.Info("core banking service listening", zap.String("port", port))
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatal("server error", zap.Error(err))
		}
	}()

	// Graceful shutdown
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	log.Info("shutting down core banking service")
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	if err := srv.Shutdown(ctx); err != nil {
		log.Error("shutdown error", zap.Error(err))
	}
}

// ─── Mock adapter for development ────────────────────────────────────────────

type mockAdapter struct{ log *zap.Logger }

func (m *mockAdapter) Name() string { return "Mock CBS" }
func (m *mockAdapter) Ping(_ interface{}) error { return nil }

func (m *mockAdapter) GetAccount(_ interface{}, ref string) (*models.BankAccount, error) {
	return &models.BankAccount{
		ID: ref, ExternalRef: ref, Currency: "NGN",
		Balance: decimal.NewFromFloat(1500000), AvailBalance: decimal.NewFromFloat(1200000),
		OwnerID: "demo-user", Status: "ACTIVE", OpenedAt: time.Now().AddDate(-1, 0, 0),
	}, nil
}

func (m *mockAdapter) GetAccountsByOwner(_ interface{}, ownerID string) ([]*models.BankAccount, error) {
	return []*models.BankAccount{
		{ID: ownerID + "-SAV", ExternalRef: ownerID + "-SAV", Currency: "NGN",
			Balance: decimal.NewFromFloat(1500000), OwnerID: ownerID, Status: "ACTIVE"},
		{ID: ownerID + "-ESC", ExternalRef: ownerID + "-ESC", Currency: "NGN", Type: models.AccountTypeEscrow,
			Balance: decimal.NewFromFloat(500000), OwnerID: ownerID, Status: "ACTIVE"},
	}, nil
}

func (m *mockAdapter) GetTransactions(_ interface{}, accountRef string, from, to time.Time) ([]*models.BankTransaction, error) {
	return []*models.BankTransaction{
		{ID: "TXN001", AccountID: accountRef, Type: models.TxCredit,
			Amount: decimal.NewFromFloat(250000), Currency: "NGN",
			BalanceAfter: decimal.NewFromFloat(1500000), ValueDate: time.Now().AddDate(0, 0, -3),
			BookingDate: time.Now().AddDate(0, 0, -3), Narrative: "NEXCOM Trade Settlement"},
		{ID: "TXN002", AccountID: accountRef, Type: models.TxDebit,
			Amount: decimal.NewFromFloat(50000), Currency: "NGN",
			BalanceAfter: decimal.NewFromFloat(1250000), ValueDate: time.Now().AddDate(0, 0, -7),
			BookingDate: time.Now().AddDate(0, 0, -7), Narrative: "Input Loan Repayment"},
	}, nil
}

func (m *mockAdapter) CreateEscrowAccount(_ interface{}, ownerID, currency string) (*models.BankAccount, error) {
	return &models.BankAccount{
		ID: fmt.Sprintf("ESC-%s-%d", ownerID, time.Now().Unix()),
		ExternalRef: fmt.Sprintf("ESC-%s-%d", ownerID, time.Now().Unix()),
		Currency: currency, OwnerID: ownerID, Type: models.AccountTypeEscrow,
		Status: "ACTIVE", OpenedAt: time.Now(),
	}, nil
}

func (m *mockAdapter) InitiatePayment(_ interface{}, instr *models.PaymentInstruction) (*models.PaymentStatus, error) {
	return &models.PaymentStatus{
		InstructionID: instr.ID, Status: "SETTLED",
		CBSRef: fmt.Sprintf("CBS-%d", time.Now().UnixNano()), Timestamp: time.Now(),
	}, nil
}

func (m *mockAdapter) GetPaymentStatus(_ interface{}, instructionID string) (*models.PaymentStatus, error) {
	return &models.PaymentStatus{InstructionID: instructionID, Status: "SETTLED", Timestamp: time.Now()}, nil
}

func (m *mockAdapter) GetLoan(_ interface{}, loanRef string) (*models.AgriLoan, error) {
	return &models.AgriLoan{
		ID: loanRef, ExternalRef: loanRef, ProductCode: "AGRI_INPUT_LOAN_NGN",
		Principal: decimal.NewFromFloat(500000), OutstandingBalance: decimal.NewFromFloat(350000),
		InterestRate: decimal.NewFromFloat(12), Tenor: 12, Status: models.LoanStatusActive,
	}, nil
}

func (m *mockAdapter) GetLoansByBorrower(_ interface{}, borrowerID string) ([]*models.AgriLoan, error) {
	return []*models.AgriLoan{
		{ID: "LOAN-001", BorrowerID: borrowerID, ProductCode: "AGRI_INPUT_LOAN_NGN",
			Principal: decimal.NewFromFloat(500000), Status: models.LoanStatusActive},
	}, nil
}

func (m *mockAdapter) DisburseInputLoan(_ interface{}, loan *models.AgriLoan) (*models.AgriLoan, error) {
	now := time.Now()
	loan.Status = models.LoanStatusActive
	loan.DisbursedAt = &now
	return loan, nil
}

func (m *mockAdapter) RecordRepayment(_ interface{}, loanRef string, amount decimal.Decimal) (*models.AgriLoan, error) {
	return &models.AgriLoan{
		ID: loanRef, OutstandingBalance: decimal.NewFromFloat(200000), Status: models.LoanStatusActive,
	}, nil
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}

func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func requiredEnv(log *zap.Logger, key string) string {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		log.Fatal("required core-banking configuration is missing", zap.String("variable", key))
	}
	return value
}

func parseDate(s string, fallback time.Time) time.Time {
	if s == "" {
		return fallback
	}
	t, err := time.Parse("2006-01-02", s)
	if err != nil {
		return fallback
	}
	return t
}
