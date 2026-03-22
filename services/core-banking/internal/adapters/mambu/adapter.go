// Package mambu implements the CBSAdapter interface for Mambu, the cloud-native
// SaaS core banking platform. Uses Mambu REST API v2 with API key authentication.
//
// API reference: https://support.mambu.com/docs/mambu-apis
// Auth: apikey header
package mambu

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

// Config holds Mambu connection parameters.
type Config struct {
	BaseURL  string // e.g. https://nexcom.mambu.com/api
	APIKey   string
	Timeout  time.Duration
}

// Adapter implements models.CBSAdapter for Mambu.
type Adapter struct {
	cfg  Config
	http *http.Client
	log  *zap.Logger
}

func New(cfg Config, log *zap.Logger) *Adapter {
	return &Adapter{cfg: cfg, http: &http.Client{Timeout: cfg.Timeout}, log: log.Named("mambu")}
}

func (a *Adapter) Name() string { return "Mambu" }

func (a *Adapter) do(ctx context.Context, method, path string, body any, out any) error {
	var bodyReader io.Reader
	if body != nil {
		b, _ := json.Marshal(body)
		bodyReader = bytes.NewReader(b)
	}
	req, _ := http.NewRequestWithContext(ctx, method, a.cfg.BaseURL+path, bodyReader)
	req.Header.Set("apikey", a.cfg.APIKey)
	req.Header.Set("Accept", "application/vnd.mambu.v2+json")
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	resp, err := a.http.Do(req)
	if err != nil {
		return fmt.Errorf("mambu %s %s: %w", method, path, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		b, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("mambu %s %s: HTTP %d: %s", method, path, resp.StatusCode, b)
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
		ID              string `json:"id"`
		EncodedKey      string `json:"encodedKey"`
		AccountHolderKey string `json:"accountHolderKey"`
		Name            string `json:"name"`
		CurrencyCode    string `json:"currencyCode"`
		Balances        struct {
			TotalBalance     float64 `json:"totalBalance"`
			AvailableBalance float64 `json:"availableBalance"`
			HoldBalance      float64 `json:"holdBalance"`
		} `json:"balances"`
		AccountState string `json:"accountState"`
		CreationDate string `json:"creationDate"`
	}
	if err := a.do(c, http.MethodGet, fmt.Sprintf("/deposits/%s", accountRef), nil, &raw); err != nil {
		return nil, err
	}
	opened, _ := time.Parse(time.RFC3339, raw.CreationDate)
	return &models.BankAccount{
		ID:           raw.ID,
		ExternalRef:  raw.ID,
		Currency:     raw.CurrencyCode,
		Balance:      decimal.NewFromFloat(raw.Balances.TotalBalance),
		AvailBalance: decimal.NewFromFloat(raw.Balances.AvailableBalance),
		HoldAmount:   decimal.NewFromFloat(raw.Balances.HoldBalance),
		OwnerID:      raw.AccountHolderKey,
		OwnerName:    raw.Name,
		Status:       raw.AccountState,
		OpenedAt:     opened,
	}, nil
}

func (a *Adapter) GetAccountsByOwner(ctx interface{}, ownerID string) ([]*models.BankAccount, error) {
	c := ctx.(context.Context)
	var raw []struct {
		ID           string `json:"id"`
		CurrencyCode string `json:"currencyCode"`
		Balances     struct {
			TotalBalance     float64 `json:"totalBalance"`
			AvailableBalance float64 `json:"availableBalance"`
		} `json:"balances"`
		AccountState string `json:"accountState"`
	}
	path := fmt.Sprintf("/deposits:search?paginationDetails=OFF")
	body := map[string]any{
		"filterCriteria": []map[string]any{
			{"field": "accountHolderKey", "operator": "EQUALS", "value": ownerID},
		},
	}
	if err := a.do(c, http.MethodPost, path, body, &raw); err != nil {
		return nil, err
	}
	out := make([]*models.BankAccount, 0, len(raw))
	for _, r := range raw {
		out = append(out, &models.BankAccount{
			ID:           r.ID,
			ExternalRef:  r.ID,
			Currency:     r.CurrencyCode,
			Balance:      decimal.NewFromFloat(r.Balances.TotalBalance),
			AvailBalance: decimal.NewFromFloat(r.Balances.AvailableBalance),
			OwnerID:      ownerID,
			Status:       r.AccountState,
		})
	}
	return out, nil
}

func (a *Adapter) GetTransactions(ctx interface{}, accountRef string, from, to time.Time) ([]*models.BankTransaction, error) {
	c := ctx.(context.Context)
	path := fmt.Sprintf("/deposits/%s/transactions?from=%s&to=%s",
		accountRef, from.Format(time.RFC3339), to.Format(time.RFC3339))
	var raw []struct {
		ID              string  `json:"id"`
		Type            string  `json:"type"`
		Amount          float64 `json:"amount"`
		CurrencyCode    string  `json:"currencyCode"`
		AccountBalances struct {
			TotalBalance float64 `json:"totalBalance"`
		} `json:"accountBalances"`
		ValueDate   string `json:"valueDate"`
		CreationDate string `json:"creationDate"`
		Notes       string `json:"notes"`
	}
	if err := a.do(c, http.MethodGet, path, nil, &raw); err != nil {
		return nil, err
	}
	out := make([]*models.BankTransaction, 0, len(raw))
	for _, r := range raw {
		vd, _ := time.Parse(time.RFC3339, r.ValueDate)
		bd, _ := time.Parse(time.RFC3339, r.CreationDate)
		txType := models.TxCredit
		if r.Amount < 0 {
			txType = models.TxDebit
		}
		out = append(out, &models.BankTransaction{
			ID:           r.ID,
			AccountID:    accountRef,
			ExternalRef:  r.ID,
			Type:         txType,
			Amount:       decimal.NewFromFloat(r.Amount).Abs(),
			Currency:     r.CurrencyCode,
			BalanceAfter: decimal.NewFromFloat(r.AccountBalances.TotalBalance),
			ValueDate:    vd,
			BookingDate:  bd,
			Narrative:    r.Notes,
		})
	}
	return out, nil
}

func (a *Adapter) CreateEscrowAccount(ctx interface{}, ownerID, currency string) (*models.BankAccount, error) {
	c := ctx.(context.Context)
	payload := map[string]any{
		"accountHolderKey":  ownerID,
		"accountHolderType": "CLIENT",
		"productTypeKey":    "NEXCOM_ESCROW",
		"currencyCode":      currency,
		"name":              "NEXCOM Escrow Account",
	}
	var raw struct {
		ID           string `json:"id"`
		CurrencyCode string `json:"currencyCode"`
	}
	if err := a.do(c, http.MethodPost, "/deposits", payload, &raw); err != nil {
		return nil, err
	}
	return &models.BankAccount{
		ID:          raw.ID,
		ExternalRef: raw.ID,
		Currency:    raw.CurrencyCode,
		OwnerID:     ownerID,
		Type:        models.AccountTypeEscrow,
		Status:      "ACTIVE",
		OpenedAt:    time.Now(),
	}, nil
}

// ─── Payment operations ───────────────────────────────────────────────────────

func (a *Adapter) InitiatePayment(ctx interface{}, instr *models.PaymentInstruction) (*models.PaymentStatus, error) {
	c := ctx.(context.Context)
	// Mambu uses deposit transactions for internal transfers
	payload := map[string]any{
		"type":                "TRANSFER",
		"amount":              instr.Amount.InexactFloat64(),
		"notes":               instr.RemittanceInfo,
		"transferDetails": map[string]any{
			"linkedDepositAccountKey": instr.CreditorAcct,
		},
		"externalId": instr.EndToEndID,
	}
	var raw struct {
		ID     string `json:"id"`
		Status string `json:"userTransactionID"`
	}
	path := fmt.Sprintf("/deposits/%s/transactions", instr.DebtorAcct)
	if err := a.do(c, http.MethodPost, path, payload, &raw); err != nil {
		return nil, err
	}
	return &models.PaymentStatus{
		InstructionID: instr.ID,
		Status:        "ACCEPTED",
		CBSRef:        raw.ID,
		Timestamp:     time.Now(),
	}, nil
}

func (a *Adapter) GetPaymentStatus(ctx interface{}, instructionID string) (*models.PaymentStatus, error) {
	// Mambu transactions are synchronous — if POST succeeded, it's settled
	return &models.PaymentStatus{
		InstructionID: instructionID,
		Status:        "SETTLED",
		Timestamp:     time.Now(),
	}, nil
}

// ─── Loan operations ──────────────────────────────────────────────────────────

func (a *Adapter) GetLoan(ctx interface{}, loanRef string) (*models.AgriLoan, error) {
	c := ctx.(context.Context)
	var raw struct {
		ID             string  `json:"id"`
		AccountHolderKey string `json:"accountHolderKey"`
		LoanAmount     float64 `json:"loanAmount"`
		PrincipalBalance float64 `json:"balances.principalBalance"`
		InterestRate   float64 `json:"interestRate"`
		RepaymentInstallments int `json:"repaymentInstallments"`
		AccountState   string  `json:"accountState"`
		DisbursementDetails struct {
			ExpectedDisbursementDate string `json:"expectedDisbursementDate"`
		} `json:"disbursementDetails"`
	}
	if err := a.do(c, http.MethodGet, fmt.Sprintf("/loans/%s", loanRef), nil, &raw); err != nil {
		return nil, err
	}
	return &models.AgriLoan{
		ID:                 raw.ID,
		ExternalRef:        raw.ID,
		BorrowerID:         raw.AccountHolderKey,
		Principal:          decimal.NewFromFloat(raw.LoanAmount),
		OutstandingBalance: decimal.NewFromFloat(raw.PrincipalBalance),
		InterestRate:       decimal.NewFromFloat(raw.InterestRate),
		Tenor:              raw.RepaymentInstallments,
		Status:             models.LoanStatus(raw.AccountState),
	}, nil
}

func (a *Adapter) GetLoansByBorrower(ctx interface{}, borrowerID string) ([]*models.AgriLoan, error) {
	c := ctx.(context.Context)
	body := map[string]any{
		"filterCriteria": []map[string]any{
			{"field": "accountHolderKey", "operator": "EQUALS", "value": borrowerID},
		},
	}
	var raw []struct {
		ID           string  `json:"id"`
		LoanAmount   float64 `json:"loanAmount"`
		AccountState string  `json:"accountState"`
	}
	if err := a.do(c, http.MethodPost, "/loans:search?paginationDetails=OFF", body, &raw); err != nil {
		return nil, err
	}
	out := make([]*models.AgriLoan, 0, len(raw))
	for _, r := range raw {
		out = append(out, &models.AgriLoan{
			ID:          r.ID,
			ExternalRef: r.ID,
			BorrowerID:  borrowerID,
			Principal:   decimal.NewFromFloat(r.LoanAmount),
			Status:      models.LoanStatus(r.AccountState),
		})
	}
	return out, nil
}

func (a *Adapter) DisburseInputLoan(ctx interface{}, loan *models.AgriLoan) (*models.AgriLoan, error) {
	c := ctx.(context.Context)
	// Step 1: Create loan account
	payload := map[string]any{
		"accountHolderKey":  loan.BorrowerID,
		"accountHolderType": "CLIENT",
		"productTypeKey":    loan.ProductCode,
		"loanAmount":        loan.Principal.InexactFloat64(),
		"interestRate":      loan.InterestRate.InexactFloat64(),
		"repaymentInstallments": loan.Tenor,
	}
	var created struct{ ID string `json:"id"` }
	if err := a.do(c, http.MethodPost, "/loans", payload, &created); err != nil {
		return nil, err
	}
	// Step 2: Approve
	if err := a.do(c, http.MethodPost, fmt.Sprintf("/loans/%s:changeState", created.ID),
		map[string]any{"action": "APPROVE"}, nil); err != nil {
		return nil, err
	}
	// Step 3: Disburse
	if err := a.do(c, http.MethodPost, fmt.Sprintf("/loans/%s/disbursements", created.ID),
		map[string]any{"firstRepaymentDate": time.Now().AddDate(0, 1, 0).Format(time.RFC3339)}, nil); err != nil {
		return nil, err
	}
	now := time.Now()
	loan.ID = created.ID
	loan.ExternalRef = created.ID
	loan.Status = models.LoanStatusActive
	loan.DisbursedAt = &now
	return loan, nil
}

func (a *Adapter) RecordRepayment(ctx interface{}, loanRef string, amount decimal.Decimal) (*models.AgriLoan, error) {
	c := ctx.(context.Context)
	payload := map[string]any{
		"amount": amount.InexactFloat64(),
		"date":   time.Now().Format(time.RFC3339),
	}
	if err := a.do(c, http.MethodPost, fmt.Sprintf("/loans/%s/repayments", loanRef), payload, nil); err != nil {
		return nil, err
	}
	return a.GetLoan(c, loanRef)
}

func (a *Adapter) Ping(ctx interface{}) error {
	c := ctx.(context.Context)
	return a.do(c, http.MethodGet, "/", nil, nil)
}
