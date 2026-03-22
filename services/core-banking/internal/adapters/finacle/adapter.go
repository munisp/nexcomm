// Package finacle implements the CBSAdapter interface for Infosys Finacle
// core banking system. Uses Finacle API Connect (REST/JSON) with JWT auth.
//
// API reference: Finacle API Connect Developer Portal
// Auth: JWT Bearer token via /oauth2/token
package finacle

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

// Config holds Finacle API Connect connection parameters.
type Config struct {
	BaseURL      string // e.g. https://finacle-api.bank.example.com/api/v1
	TokenURL     string
	ClientID     string
	ClientSecret string
	BankCode     string
	Timeout      time.Duration
}

// Adapter implements models.CBSAdapter for Finacle.
type Adapter struct {
	cfg         Config
	http        *http.Client
	log         *zap.Logger
	token       string
	tokenExpiry time.Time
}

func New(cfg Config, log *zap.Logger) *Adapter {
	return &Adapter{cfg: cfg, http: &http.Client{Timeout: cfg.Timeout}, log: log.Named("finacle")}
}

func (a *Adapter) Name() string { return "Infosys Finacle" }

func (a *Adapter) ensureToken(ctx context.Context) error {
	if time.Now().Before(a.tokenExpiry) {
		return nil
	}
	payload := map[string]string{
		"grant_type":    "client_credentials",
		"client_id":     a.cfg.ClientID,
		"client_secret": a.cfg.ClientSecret,
	}
	b, _ := json.Marshal(payload)
	req, _ := http.NewRequestWithContext(ctx, http.MethodPost, a.cfg.TokenURL, bytes.NewReader(b))
	req.Header.Set("Content-Type", "application/json")
	resp, err := a.http.Do(req)
	if err != nil {
		return fmt.Errorf("finacle token: %w", err)
	}
	defer resp.Body.Close()
	var tok struct {
		AccessToken string `json:"access_token"`
		ExpiresIn   int    `json:"expires_in"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&tok); err != nil {
		return fmt.Errorf("finacle token decode: %w", err)
	}
	a.token = tok.AccessToken
	a.tokenExpiry = time.Now().Add(time.Duration(tok.ExpiresIn-30) * time.Second)
	return nil
}

func (a *Adapter) call(ctx context.Context, method, path string, body, out any) error {
	if err := a.ensureToken(ctx); err != nil {
		return err
	}
	var br io.Reader
	if body != nil {
		b, _ := json.Marshal(body)
		br = bytes.NewReader(b)
	}
	req, _ := http.NewRequestWithContext(ctx, method, a.cfg.BaseURL+path, br)
	req.Header.Set("Authorization", "Bearer "+a.token)
	req.Header.Set("X-Bank-Code", a.cfg.BankCode)
	req.Header.Set("Accept", "application/json")
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	resp, err := a.http.Do(req)
	if err != nil {
		return fmt.Errorf("finacle %s %s: %w", method, path, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		rb, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("finacle %s %s: HTTP %d: %s", method, path, resp.StatusCode, rb)
	}
	if out != nil {
		return json.NewDecoder(resp.Body).Decode(out)
	}
	return nil
}

// ─── Account operations ───────────────────────────────────────────────────────

func (a *Adapter) GetAccount(ctx interface{}, accountRef string) (*models.BankAccount, error) {
	c := ctx.(context.Context)
	var raw struct {
		Data struct {
			AccountNumber  string  `json:"accountNumber"`
			CurrencyCode   string  `json:"currencyCode"`
			BookBalance    float64 `json:"bookBalance"`
			ClearedBalance float64 `json:"clearedBalance"`
			CustomerID     string  `json:"customerId"`
			CustomerName   string  `json:"customerName"`
			AccountStatus  string  `json:"accountStatus"`
			OpenDate       string  `json:"openDate"`
		} `json:"data"`
	}
	if err := a.call(c, http.MethodGet, fmt.Sprintf("/accounts/%s", accountRef), nil, &raw); err != nil {
		return nil, err
	}
	d := raw.Data
	opened, _ := time.Parse("2006-01-02", d.OpenDate)
	return &models.BankAccount{
		ID:           d.AccountNumber,
		ExternalRef:  d.AccountNumber,
		Currency:     d.CurrencyCode,
		Balance:      decimal.NewFromFloat(d.BookBalance),
		AvailBalance: decimal.NewFromFloat(d.ClearedBalance),
		OwnerID:      d.CustomerID,
		OwnerName:    d.CustomerName,
		Status:       d.AccountStatus,
		OpenedAt:     opened,
	}, nil
}

func (a *Adapter) GetAccountsByOwner(ctx interface{}, ownerID string) ([]*models.BankAccount, error) {
	c := ctx.(context.Context)
	var raw struct {
		Data []struct {
			AccountNumber string  `json:"accountNumber"`
			CurrencyCode  string  `json:"currencyCode"`
			BookBalance   float64 `json:"bookBalance"`
			AccountStatus string  `json:"accountStatus"`
		} `json:"data"`
	}
	if err := a.call(c, http.MethodGet, fmt.Sprintf("/customers/%s/accounts", ownerID), nil, &raw); err != nil {
		return nil, err
	}
	out := make([]*models.BankAccount, 0, len(raw.Data))
	for _, d := range raw.Data {
		out = append(out, &models.BankAccount{
			ID:          d.AccountNumber,
			ExternalRef: d.AccountNumber,
			Currency:    d.CurrencyCode,
			Balance:     decimal.NewFromFloat(d.BookBalance),
			OwnerID:     ownerID,
			Status:      d.AccountStatus,
		})
	}
	return out, nil
}

func (a *Adapter) GetTransactions(ctx interface{}, accountRef string, from, to time.Time) ([]*models.BankTransaction, error) {
	c := ctx.(context.Context)
	path := fmt.Sprintf("/accounts/%s/transactions?fromDate=%s&toDate=%s",
		accountRef, from.Format("2006-01-02"), to.Format("2006-01-02"))
	var raw struct {
		Data []struct {
			TxnID         string  `json:"txnId"`
			DrCrFlag      string  `json:"drCrFlag"`
			TxnAmount     float64 `json:"txnAmount"`
			CurrencyCode  string  `json:"currencyCode"`
			ClosingBalance float64 `json:"closingBalance"`
			ValueDate     string  `json:"valueDate"`
			TxnDate       string  `json:"txnDate"`
			Narration     string  `json:"narration"`
		} `json:"data"`
	}
	if err := a.call(c, http.MethodGet, path, nil, &raw); err != nil {
		return nil, err
	}
	out := make([]*models.BankTransaction, 0, len(raw.Data))
	for _, d := range raw.Data {
		vd, _ := time.Parse("2006-01-02", d.ValueDate)
		bd, _ := time.Parse("2006-01-02", d.TxnDate)
		txType := models.TxCredit
		if d.DrCrFlag == "D" {
			txType = models.TxDebit
		}
		out = append(out, &models.BankTransaction{
			ID:           d.TxnID,
			AccountID:    accountRef,
			ExternalRef:  d.TxnID,
			Type:         txType,
			Amount:       decimal.NewFromFloat(d.TxnAmount),
			Currency:     d.CurrencyCode,
			BalanceAfter: decimal.NewFromFloat(d.ClosingBalance),
			ValueDate:    vd,
			BookingDate:  bd,
			Narrative:    d.Narration,
		})
	}
	return out, nil
}

func (a *Adapter) CreateEscrowAccount(ctx interface{}, ownerID, currency string) (*models.BankAccount, error) {
	c := ctx.(context.Context)
	payload := map[string]any{
		"customerId":  ownerID,
		"productCode": "NEXCOM_ESCROW",
		"currency":    currency,
		"bankCode":    a.cfg.BankCode,
	}
	var raw struct {
		Data struct {
			AccountNumber string `json:"accountNumber"`
			Currency      string `json:"currencyCode"`
		} `json:"data"`
	}
	if err := a.call(c, http.MethodPost, "/accounts", payload, &raw); err != nil {
		return nil, err
	}
	return &models.BankAccount{
		ID:          raw.Data.AccountNumber,
		ExternalRef: raw.Data.AccountNumber,
		Currency:    raw.Data.Currency,
		OwnerID:     ownerID,
		Type:        models.AccountTypeEscrow,
		Status:      "ACTIVE",
		OpenedAt:    time.Now(),
	}, nil
}

func (a *Adapter) InitiatePayment(ctx interface{}, instr *models.PaymentInstruction) (*models.PaymentStatus, error) {
	c := ctx.(context.Context)
	payload := map[string]any{
		"debitAccountNumber":  instr.DebtorAcct,
		"creditAccountNumber": instr.CreditorAcct,
		"amount":              instr.Amount.InexactFloat64(),
		"currencyCode":        instr.Currency,
		"valueDate":           instr.ValueDate.Format("2006-01-02"),
		"narration":           instr.RemittanceInfo,
		"endToEndId":          instr.EndToEndID,
	}
	var raw struct {
		Data struct {
			TxnRefNo string `json:"txnRefNo"`
			Status   string `json:"status"`
		} `json:"data"`
	}
	if err := a.call(c, http.MethodPost, "/payments/fund-transfer", payload, &raw); err != nil {
		return nil, err
	}
	return &models.PaymentStatus{
		InstructionID: instr.ID,
		Status:        raw.Data.Status,
		CBSRef:        raw.Data.TxnRefNo,
		Timestamp:     time.Now(),
	}, nil
}

func (a *Adapter) GetPaymentStatus(ctx interface{}, instructionID string) (*models.PaymentStatus, error) {
	c := ctx.(context.Context)
	var raw struct {
		Data struct {
			Status string `json:"status"`
			TxnRef string `json:"txnRefNo"`
		} `json:"data"`
	}
	if err := a.call(c, http.MethodGet, fmt.Sprintf("/payments/%s/status", instructionID), nil, &raw); err != nil {
		return nil, err
	}
	return &models.PaymentStatus{
		InstructionID: instructionID,
		Status:        raw.Data.Status,
		CBSRef:        raw.Data.TxnRef,
		Timestamp:     time.Now(),
	}, nil
}

func (a *Adapter) GetLoan(ctx interface{}, loanRef string) (*models.AgriLoan, error) {
	c := ctx.(context.Context)
	var raw struct {
		Data struct {
			AccountNumber      string  `json:"accountNumber"`
			CustomerID         string  `json:"customerId"`
			CustomerName       string  `json:"customerName"`
			ProductCode        string  `json:"productCode"`
			SanctionedAmount   float64 `json:"sanctionedAmount"`
			OutstandingBalance float64 `json:"outstandingBalance"`
			InterestRate       float64 `json:"interestRate"`
			TenorMonths        int     `json:"tenorMonths"`
			AccountStatus      string  `json:"accountStatus"`
		} `json:"data"`
	}
	if err := a.call(c, http.MethodGet, fmt.Sprintf("/loans/%s", loanRef), nil, &raw); err != nil {
		return nil, err
	}
	d := raw.Data
	return &models.AgriLoan{
		ID:                 d.AccountNumber,
		ExternalRef:        d.AccountNumber,
		BorrowerID:         d.CustomerID,
		BorrowerName:       d.CustomerName,
		ProductCode:        d.ProductCode,
		Principal:          decimal.NewFromFloat(d.SanctionedAmount),
		OutstandingBalance: decimal.NewFromFloat(d.OutstandingBalance),
		InterestRate:       decimal.NewFromFloat(d.InterestRate),
		Tenor:              d.TenorMonths,
		Status:             models.LoanStatus(d.AccountStatus),
	}, nil
}

func (a *Adapter) GetLoansByBorrower(ctx interface{}, borrowerID string) ([]*models.AgriLoan, error) {
	c := ctx.(context.Context)
	var raw struct {
		Data []struct {
			AccountNumber string  `json:"accountNumber"`
			ProductCode   string  `json:"productCode"`
			SanctionedAmount float64 `json:"sanctionedAmount"`
			AccountStatus string  `json:"accountStatus"`
		} `json:"data"`
	}
	if err := a.call(c, http.MethodGet, fmt.Sprintf("/customers/%s/loans", borrowerID), nil, &raw); err != nil {
		return nil, err
	}
	out := make([]*models.AgriLoan, 0, len(raw.Data))
	for _, d := range raw.Data {
		out = append(out, &models.AgriLoan{
			ID:          d.AccountNumber,
			ExternalRef: d.AccountNumber,
			BorrowerID:  borrowerID,
			ProductCode: d.ProductCode,
			Principal:   decimal.NewFromFloat(d.SanctionedAmount),
			Status:      models.LoanStatus(d.AccountStatus),
		})
	}
	return out, nil
}

func (a *Adapter) DisburseInputLoan(ctx interface{}, loan *models.AgriLoan) (*models.AgriLoan, error) {
	c := ctx.(context.Context)
	payload := map[string]any{
		"customerId":          loan.BorrowerID,
		"productCode":         loan.ProductCode,
		"sanctionedAmount":    loan.Principal.InexactFloat64(),
		"interestRate":        loan.InterestRate.InexactFloat64(),
		"tenorMonths":         loan.Tenor,
		"disbursementAccount": loan.DisbursementAcct,
		"repaymentAccount":    loan.RepaymentAcct,
		"collateralType":      loan.CollateralType,
		"collateralRef":       loan.CollateralRef,
	}
	var raw struct {
		Data struct {
			AccountNumber string `json:"accountNumber"`
			Status        string `json:"accountStatus"`
		} `json:"data"`
	}
	if err := a.call(c, http.MethodPost, "/loans/disburse", payload, &raw); err != nil {
		return nil, err
	}
	now := time.Now()
	loan.ID = raw.Data.AccountNumber
	loan.ExternalRef = raw.Data.AccountNumber
	loan.Status = models.LoanStatus(raw.Data.Status)
	loan.DisbursedAt = &now
	return loan, nil
}

func (a *Adapter) RecordRepayment(ctx interface{}, loanRef string, amount decimal.Decimal) (*models.AgriLoan, error) {
	c := ctx.(context.Context)
	payload := map[string]any{
		"repaymentAmount": amount.InexactFloat64(),
		"repaymentDate":   time.Now().Format("2006-01-02"),
	}
	var raw struct {
		Data struct {
			OutstandingBalance float64 `json:"outstandingBalance"`
			AccountStatus      string  `json:"accountStatus"`
		} `json:"data"`
	}
	if err := a.call(c, http.MethodPost, fmt.Sprintf("/loans/%s/repayment", loanRef), payload, &raw); err != nil {
		return nil, err
	}
	return &models.AgriLoan{
		ID:                 loanRef,
		ExternalRef:        loanRef,
		OutstandingBalance: decimal.NewFromFloat(raw.Data.OutstandingBalance),
		Status:             models.LoanStatus(raw.Data.AccountStatus),
	}, nil
}

func (a *Adapter) Ping(ctx interface{}) error {
	c := ctx.(context.Context)
	return a.call(c, http.MethodGet, "/health", nil, nil)
}
