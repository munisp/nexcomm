// Package generic provides a template CBS adapter that institutions can use
// as a starting point for integrating any core banking system not natively
// supported by NEXCOM Exchange.
//
// To integrate a custom CBS:
//  1. Copy this file to a new package (e.g., internal/adapters/mybank/)
//  2. Replace every TODO comment with your CBS-specific API calls
//  3. Register the adapter in your main.go or via an init() function:
//     registry.Register("mybank", mybank.Factory)
//  4. Set CBS_PROVIDER=mybank in your environment
//
// The adapter communicates with the CBS via HTTP REST by default.
// Swap the HTTP client for gRPC, SOAP, ISO 8583, or any other protocol
// by replacing the `do` helper at the bottom of this file.
package generic

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"

	"github.com/nexcom/core-banking/internal/models"
	"github.com/shopspring/decimal"
	"go.uber.org/zap"
)

// Config holds all configuration for the generic CBS adapter.
// Values are populated from environment variables by the registry.Build() call.
type Config struct {
	// BaseURL is the root URL of the CBS REST API.
	// e.g. "https://cbs.mybank.com/api/v1"
	BaseURL string

	// APIKey is the API key or Bearer token for authentication.
	// If your CBS uses OAuth 2.0, replace this with ClientID + ClientSecret
	// and add a token refresh loop (see temenos/adapter.go for reference).
	APIKey string

	// BankCode is the institution code used in CBS requests (if required).
	BankCode string

	// Timeout is the HTTP request timeout. Defaults to 30 seconds.
	Timeout time.Duration
}

// Adapter is the generic CBS adapter. Replace the method bodies with
// your CBS-specific API calls.
type Adapter struct {
	cfg    Config
	client *http.Client
	log    *zap.Logger
}

// Factory is the registry.FactoryFunc for the generic adapter.
// Register it as: registry.Register("mybank", generic.Factory)
func Factory(cfg map[string]string, log *zap.Logger) (models.CBSAdapter, error) {
	timeout := 30 * time.Second
	return &Adapter{
		cfg: Config{
			BaseURL:  cfg["base_url"],
			APIKey:   cfg["api_key"],
			BankCode: cfg["bank_code"],
			Timeout:  timeout,
		},
		client: &http.Client{Timeout: timeout},
		log:    log.Named("generic-cbs"),
	}, nil
}

// Name returns a human-readable name for this adapter.
// Override with your CBS name, e.g. "MyBank Core Banking".
func (a *Adapter) Name() string { return "Generic CBS Adapter" }

// Ping checks connectivity to the CBS. Replace with a real health endpoint.
func (a *Adapter) Ping(ctx context.Context) error {
	// TODO: Replace with your CBS health check endpoint
	// e.g. GET /health or GET /api/v1/status
	_, err := a.get(ctx, "/health", nil)
	return err
}

// ─── Account Operations ───────────────────────────────────────────────────────

// GetAccount retrieves account details by external reference.
func (a *Adapter) GetAccount(ctx context.Context, ref string) (*models.BankAccount, error) {
	// TODO: Replace with your CBS account inquiry endpoint
	// e.g. GET /accounts/{ref}
	var resp struct {
		AccountID    string  `json:"accountId"`
		Currency     string  `json:"currency"`
		Balance      float64 `json:"balance"`
		AvailBalance float64 `json:"availableBalance"`
		Status       string  `json:"status"`
		OwnerID      string  `json:"customerId"`
		OpenedAt     string  `json:"openDate"`
	}
	if err := a.getJSON(ctx, fmt.Sprintf("/accounts/%s", ref), &resp); err != nil {
		return nil, err
	}
	openedAt, _ := time.Parse("2006-01-02", resp.OpenedAt)
	return &models.BankAccount{
		ID:           resp.AccountID,
		ExternalRef:  ref,
		Currency:     resp.Currency,
		Balance:      decimal.NewFromFloat(resp.Balance),
		AvailBalance: decimal.NewFromFloat(resp.AvailBalance),
		Status:       resp.Status,
		OwnerID:      resp.OwnerID,
		OpenedAt:     openedAt,
	}, nil
}

// GetAccountsByOwner returns all accounts for a customer.
func (a *Adapter) GetAccountsByOwner(ctx context.Context, ownerID string) ([]*models.BankAccount, error) {
	// TODO: Replace with your CBS customer account list endpoint
	// e.g. GET /customers/{ownerID}/accounts
	var resp []struct {
		AccountID string  `json:"accountId"`
		Currency  string  `json:"currency"`
		Balance   float64 `json:"balance"`
		Status    string  `json:"status"`
		Type      string  `json:"accountType"`
	}
	if err := a.getJSON(ctx, fmt.Sprintf("/customers/%s/accounts", ownerID), &resp); err != nil {
		return nil, err
	}
	accounts := make([]*models.BankAccount, 0, len(resp))
	for _, r := range resp {
		accounts = append(accounts, &models.BankAccount{
			ID:          r.AccountID,
			ExternalRef: r.AccountID,
			Currency:    r.Currency,
			Balance:     decimal.NewFromFloat(r.Balance),
			OwnerID:     ownerID,
			Status:      r.Status,
		})
	}
	return accounts, nil
}

// GetTransactions returns transaction history for an account.
func (a *Adapter) GetTransactions(ctx context.Context, accountRef string, from, to time.Time) ([]*models.BankTransaction, error) {
	// TODO: Replace with your CBS transaction history endpoint
	// e.g. GET /accounts/{ref}/transactions?from=2006-01-02&to=2006-01-02
	url := fmt.Sprintf("/accounts/%s/transactions?from=%s&to=%s",
		accountRef, from.Format("2006-01-02"), to.Format("2006-01-02"))
	var resp []struct {
		TxID         string  `json:"transactionId"`
		Type         string  `json:"type"` // "CREDIT" or "DEBIT"
		Amount       float64 `json:"amount"`
		Currency     string  `json:"currency"`
		BalanceAfter float64 `json:"runningBalance"`
		ValueDate    string  `json:"valueDate"`
		Narrative    string  `json:"narrative"`
	}
	if err := a.getJSON(ctx, url, &resp); err != nil {
		return nil, err
	}
	txns := make([]*models.BankTransaction, 0, len(resp))
	for _, r := range resp {
		txType := models.TxCredit
		if r.Type == "DEBIT" {
			txType = models.TxDebit
		}
		valueDate, _ := time.Parse("2006-01-02", r.ValueDate)
		txns = append(txns, &models.BankTransaction{
			ID:           r.TxID,
			AccountID:    accountRef,
			Type:         txType,
			Amount:       decimal.NewFromFloat(r.Amount),
			Currency:     r.Currency,
			BalanceAfter: decimal.NewFromFloat(r.BalanceAfter),
			ValueDate:    valueDate,
			BookingDate:  valueDate,
			Narrative:    r.Narrative,
		})
	}
	return txns, nil
}

// CreateEscrowAccount opens a new escrow account for trade settlement.
func (a *Adapter) CreateEscrowAccount(ctx context.Context, ownerID, currency string) (*models.BankAccount, error) {
	// TODO: Replace with your CBS account opening endpoint
	// e.g. POST /accounts with account type = ESCROW
	body := map[string]any{
		"customerId":  ownerID,
		"currency":    currency,
		"accountType": "ESCROW",
		"productCode": "NEXCOM_ESCROW", // TODO: use your CBS escrow product code
	}
	var resp struct {
		AccountID string `json:"accountId"`
		Status    string `json:"status"`
	}
	if err := a.postJSON(ctx, "/accounts", body, &resp); err != nil {
		return nil, err
	}
	return &models.BankAccount{
		ID:          resp.AccountID,
		ExternalRef: resp.AccountID,
		Currency:    currency,
		OwnerID:     ownerID,
		Type:        models.AccountTypeEscrow,
		Status:      "ACTIVE",
		OpenedAt:    time.Now(),
	}, nil
}

// ─── Payment Operations ───────────────────────────────────────────────────────

// InitiatePayment submits a payment instruction to the CBS.
func (a *Adapter) InitiatePayment(ctx context.Context, instr *models.PaymentInstruction) (*models.PaymentStatus, error) {
	// TODO: Replace with your CBS payment initiation endpoint
	// e.g. POST /payments/transfer
	body := map[string]any{
		"endToEndId":     instr.EndToEndID,
		"debtorAccount":  instr.DebtorAcct,
		"creditorAccount": instr.CreditorAcct,
		"creditorName":   instr.CreditorName,
		"amount":         instr.Amount.String(),
		"currency":       instr.Currency,
		"valueDate":      instr.ValueDate.Format("2006-01-02"),
		"remittanceInfo": instr.RemittanceInfo,
		"nexcomRef":      instr.NexcomRef,
	}
	var resp struct {
		InstructionID string `json:"instructionId"`
		CBSRef        string `json:"cbsReference"`
		Status        string `json:"status"`
	}
	if err := a.postJSON(ctx, "/payments/transfer", body, &resp); err != nil {
		return nil, err
	}
	return &models.PaymentStatus{
		InstructionID: instr.ID,
		Status:        resp.Status,
		CBSRef:        resp.CBSRef,
		Timestamp:     time.Now(),
	}, nil
}

// GetPaymentStatus polls the CBS for the current status of a payment.
func (a *Adapter) GetPaymentStatus(ctx context.Context, instructionID string) (*models.PaymentStatus, error) {
	// TODO: Replace with your CBS payment status endpoint
	// e.g. GET /payments/{instructionID}/status
	var resp struct {
		Status    string `json:"status"`
		CBSRef    string `json:"cbsReference"`
		Timestamp string `json:"timestamp"`
	}
	if err := a.getJSON(ctx, fmt.Sprintf("/payments/%s/status", instructionID), &resp); err != nil {
		return nil, err
	}
	ts, _ := time.Parse(time.RFC3339, resp.Timestamp)
	return &models.PaymentStatus{
		InstructionID: instructionID,
		Status:        resp.Status,
		CBSRef:        resp.CBSRef,
		Timestamp:     ts,
	}, nil
}

// ─── Loan Operations ──────────────────────────────────────────────────────────

// GetLoan retrieves loan details by external reference.
func (a *Adapter) GetLoan(ctx context.Context, loanRef string) (*models.AgriLoan, error) {
	// TODO: Replace with your CBS loan inquiry endpoint
	// e.g. GET /loans/{loanRef}
	var resp struct {
		LoanID      string  `json:"loanId"`
		ProductCode string  `json:"productCode"`
		Principal   float64 `json:"principal"`
		Outstanding float64 `json:"outstandingBalance"`
		Rate        float64 `json:"interestRate"`
		Tenor       int     `json:"tenorMonths"`
		Status      string  `json:"status"`
		BorrowerID  string  `json:"borrowerId"`
	}
	if err := a.getJSON(ctx, fmt.Sprintf("/loans/%s", loanRef), &resp); err != nil {
		return nil, err
	}
	return &models.AgriLoan{
		ID:                 resp.LoanID,
		ExternalRef:        loanRef,
		BorrowerID:         resp.BorrowerID,
		ProductCode:        resp.ProductCode,
		Principal:          decimal.NewFromFloat(resp.Principal),
		OutstandingBalance: decimal.NewFromFloat(resp.Outstanding),
		InterestRate:       decimal.NewFromFloat(resp.Rate),
		Tenor:              resp.Tenor,
		Status:             models.LoanStatus(resp.Status),
	}, nil
}

// GetLoansByBorrower returns all loans for a borrower.
func (a *Adapter) GetLoansByBorrower(ctx context.Context, borrowerID string) ([]*models.AgriLoan, error) {
	// TODO: Replace with your CBS borrower loan list endpoint
	// e.g. GET /customers/{borrowerID}/loans
	var resp []struct {
		LoanID      string  `json:"loanId"`
		ProductCode string  `json:"productCode"`
		Principal   float64 `json:"principal"`
		Outstanding float64 `json:"outstandingBalance"`
		Status      string  `json:"status"`
	}
	if err := a.getJSON(ctx, fmt.Sprintf("/customers/%s/loans", borrowerID), &resp); err != nil {
		return nil, err
	}
	loans := make([]*models.AgriLoan, 0, len(resp))
	for _, r := range resp {
		loans = append(loans, &models.AgriLoan{
			ID:                 r.LoanID,
			ExternalRef:        r.LoanID,
			BorrowerID:         borrowerID,
			ProductCode:        r.ProductCode,
			Principal:          decimal.NewFromFloat(r.Principal),
			OutstandingBalance: decimal.NewFromFloat(r.Outstanding),
			Status:             models.LoanStatus(r.Status),
		})
	}
	return loans, nil
}

// DisburseInputLoan creates and disburses an agricultural input loan.
func (a *Adapter) DisburseInputLoan(ctx context.Context, loan *models.AgriLoan) (*models.AgriLoan, error) {
	// TODO: Replace with your CBS loan origination endpoint
	// e.g. POST /loans/disburse
	body := map[string]any{
		"borrowerId":       loan.BorrowerID,
		"productCode":      loan.ProductCode,
		"principal":        loan.Principal.String(),
		"interestRate":     loan.InterestRate.String(),
		"tenorMonths":      loan.Tenor,
		"disbursementAcct": loan.DisbursementAcct,
		"repaymentAcct":    loan.RepaymentAcct,
		"collateralType":   loan.CollateralType,
		"collateralRef":    loan.CollateralRef,
	}
	var resp struct {
		LoanID      string `json:"loanId"`
		CBSRef      string `json:"cbsReference"`
		Status      string `json:"status"`
		DisbursedAt string `json:"disbursedAt"`
	}
	if err := a.postJSON(ctx, "/loans/disburse", body, &resp); err != nil {
		return nil, err
	}
	now := time.Now()
	loan.ExternalRef = resp.CBSRef
	loan.Status = models.LoanStatusActive
	loan.DisbursedAt = &now
	return loan, nil
}

// RecordRepayment posts a repayment against a loan.
func (a *Adapter) RecordRepayment(ctx context.Context, loanRef string, amount decimal.Decimal) (*models.AgriLoan, error) {
	// TODO: Replace with your CBS repayment endpoint
	// e.g. POST /loans/{loanRef}/repayments
	body := map[string]any{
		"amount":    amount.String(),
		"valueDate": time.Now().Format("2006-01-02"),
	}
	var resp struct {
		OutstandingBalance float64 `json:"outstandingBalance"`
		Status             string  `json:"status"`
	}
	if err := a.postJSON(ctx, fmt.Sprintf("/loans/%s/repayments", loanRef), body, &resp); err != nil {
		return nil, err
	}
	status := models.LoanStatusActive
	if resp.OutstandingBalance == 0 {
		status = models.LoanStatusClosed
	}
	return &models.AgriLoan{
		ID:                 loanRef,
		ExternalRef:        loanRef,
		OutstandingBalance: decimal.NewFromFloat(resp.OutstandingBalance),
		Status:             status,
	}, nil
}

// ─── HTTP helpers ─────────────────────────────────────────────────────────────

func (a *Adapter) getJSON(ctx context.Context, path string, out any) error {
	body, err := a.get(ctx, path, nil)
	if err != nil {
		return err
	}
	return json.Unmarshal(body, out)
}

func (a *Adapter) postJSON(ctx context.Context, path string, in, out any) error {
	b, err := json.Marshal(in)
	if err != nil {
		return fmt.Errorf("marshal request: %w", err)
	}
	body, err := a.do(ctx, http.MethodPost, path, b)
	if err != nil {
		return err
	}
	if out != nil {
		return json.Unmarshal(body, out)
	}
	return nil
}

func (a *Adapter) get(ctx context.Context, path string, _ any) ([]byte, error) {
	return a.do(ctx, http.MethodGet, path, nil)
}

// do executes an HTTP request against the CBS.
// TODO: If your CBS uses a different protocol (gRPC, SOAP, ISO 8583),
// replace this method with the appropriate client call.
func (a *Adapter) do(ctx context.Context, method, path string, body []byte) ([]byte, error) {
	url := a.cfg.BaseURL + path
	var bodyReader io.Reader
	if body != nil {
		bodyReader = bytes.NewReader(body)
	}
	req, err := http.NewRequestWithContext(ctx, method, url, bodyReader)
	if err != nil {
		return nil, fmt.Errorf("create request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	// TODO: Replace with your CBS authentication header
	// For Bearer token:  req.Header.Set("Authorization", "Bearer "+a.cfg.APIKey)
	// For API key:       req.Header.Set("X-API-Key", a.cfg.APIKey)
	// For Basic auth:    req.SetBasicAuth(a.cfg.ClientID, a.cfg.ClientSecret)
	req.Header.Set("Authorization", "Bearer "+a.cfg.APIKey)
	if a.cfg.BankCode != "" {
		req.Header.Set("X-Bank-Code", a.cfg.BankCode)
	}

	resp, err := a.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("CBS request %s %s: %w", method, path, err)
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("read response: %w", err)
	}

	if resp.StatusCode >= 400 {
		return nil, fmt.Errorf("CBS error %d for %s %s: %s", resp.StatusCode, method, path, string(respBody))
	}

	return respBody, nil
}
