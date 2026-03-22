// Package temenos implements the CBSAdapter interface for Temenos Transact
// (formerly T24). It communicates with the Temenos Internet Banking Server (IBS)
// REST API (OFS/REST bridge) and the newer Temenos Infinity API Gateway.
//
// API reference: https://developer.temenos.com/transact-apis
// Auth: OAuth 2.0 client_credentials → Bearer token
package temenos

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

// Config holds the Temenos Transact connection parameters.
type Config struct {
	BaseURL      string // e.g. https://t24.bank.example.com/irf-provider-container
	TokenURL     string // OAuth token endpoint
	ClientID     string
	ClientSecret string
	CompanyID    string // T24 company code, e.g. "BNK"
	Timeout      time.Duration
}

// Adapter implements models.CBSAdapter for Temenos Transact.
type Adapter struct {
	cfg    Config
	http   *http.Client
	log    *zap.Logger
	token  string
	tokenExpiry time.Time
}

// New creates a new Temenos Transact adapter.
func New(cfg Config, log *zap.Logger) *Adapter {
	return &Adapter{
		cfg:  cfg,
		http: &http.Client{Timeout: cfg.Timeout},
		log:  log.Named("temenos"),
	}
}

func (a *Adapter) Name() string { return "Temenos Transact" }

// ─── OAuth token management ───────────────────────────────────────────────────

func (a *Adapter) ensureToken(ctx context.Context) error {
	if time.Now().Before(a.tokenExpiry) {
		return nil
	}
	body := fmt.Sprintf("grant_type=client_credentials&client_id=%s&client_secret=%s",
		a.cfg.ClientID, a.cfg.ClientSecret)
	req, _ := http.NewRequestWithContext(ctx, http.MethodPost, a.cfg.TokenURL,
		bytes.NewBufferString(body))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	resp, err := a.http.Do(req)
	if err != nil {
		return fmt.Errorf("temenos token: %w", err)
	}
	defer resp.Body.Close()
	var tok struct {
		AccessToken string `json:"access_token"`
		ExpiresIn   int    `json:"expires_in"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&tok); err != nil {
		return fmt.Errorf("temenos token decode: %w", err)
	}
	a.token = tok.AccessToken
	a.tokenExpiry = time.Now().Add(time.Duration(tok.ExpiresIn-30) * time.Second)
	return nil
}

// ─── HTTP helper ─────────────────────────────────────────────────────────────

func (a *Adapter) get(ctx context.Context, path string, out any) error {
	if err := a.ensureToken(ctx); err != nil {
		return err
	}
	req, _ := http.NewRequestWithContext(ctx, http.MethodGet, a.cfg.BaseURL+path, nil)
	req.Header.Set("Authorization", "Bearer "+a.token)
	req.Header.Set("Accept", "application/json")
	resp, err := a.http.Do(req)
	if err != nil {
		return fmt.Errorf("temenos GET %s: %w", path, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		b, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("temenos GET %s: HTTP %d: %s", path, resp.StatusCode, b)
	}
	return json.NewDecoder(resp.Body).Decode(out)
}

func (a *Adapter) post(ctx context.Context, path string, body, out any) error {
	if err := a.ensureToken(ctx); err != nil {
		return err
	}
	b, _ := json.Marshal(body)
	req, _ := http.NewRequestWithContext(ctx, http.MethodPost, a.cfg.BaseURL+path,
		bytes.NewReader(b))
	req.Header.Set("Authorization", "Bearer "+a.token)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	resp, err := a.http.Do(req)
	if err != nil {
		return fmt.Errorf("temenos POST %s: %w", path, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		rb, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("temenos POST %s: HTTP %d: %s", path, resp.StatusCode, rb)
	}
	return json.NewDecoder(resp.Body).Decode(out)
}

// ─── Account operations ───────────────────────────────────────────────────────

// GetAccount retrieves a single account by T24 account number.
// Maps to Temenos Transact API: GET /holdings/accounts/{accountId}
func (a *Adapter) GetAccount(ctx interface{}, accountRef string) (*models.BankAccount, error) {
	c := ctx.(context.Context)
	var raw struct {
		Body struct {
			AccountID   string `json:"accountId"`
			Currency    string `json:"currency"`
			WorkingBalance string `json:"workingBalance"`
			AvailableBalance string `json:"availableBalance"`
			CustomerID  string `json:"customerId"`
			CustomerName string `json:"customerName"`
			AccountStatus string `json:"accountStatus"`
			OpenDate    string `json:"openDate"`
		} `json:"body"`
	}
	if err := a.get(c, fmt.Sprintf("/holdings/accounts/%s", accountRef), &raw); err != nil {
		return nil, err
	}
	b := raw.Body
	bal, _ := decimal.NewFromString(b.WorkingBalance)
	avail, _ := decimal.NewFromString(b.AvailableBalance)
	opened, _ := time.Parse("20060102", b.OpenDate)
	return &models.BankAccount{
		ID:           b.AccountID,
		ExternalRef:  b.AccountID,
		Currency:     b.Currency,
		Balance:      bal,
		AvailBalance: avail,
		OwnerID:      b.CustomerID,
		OwnerName:    b.CustomerName,
		Status:       b.AccountStatus,
		OpenedAt:     opened,
	}, nil
}

// GetAccountsByOwner retrieves all accounts for a customer.
// Maps to: GET /holdings/accounts?customerId={id}
func (a *Adapter) GetAccountsByOwner(ctx interface{}, ownerID string) ([]*models.BankAccount, error) {
	c := ctx.(context.Context)
	var raw struct {
		Body []struct {
			AccountID string `json:"accountId"`
			Currency  string `json:"currency"`
			WorkingBalance string `json:"workingBalance"`
			AvailableBalance string `json:"availableBalance"`
			AccountStatus string `json:"accountStatus"`
		} `json:"body"`
	}
	if err := a.get(c, fmt.Sprintf("/holdings/accounts?customerId=%s", ownerID), &raw); err != nil {
		return nil, err
	}
	out := make([]*models.BankAccount, 0, len(raw.Body))
	for _, b := range raw.Body {
		bal, _ := decimal.NewFromString(b.WorkingBalance)
		avail, _ := decimal.NewFromString(b.AvailableBalance)
		out = append(out, &models.BankAccount{
			ID:           b.AccountID,
			ExternalRef:  b.AccountID,
			Currency:     b.Currency,
			Balance:      bal,
			AvailBalance: avail,
			OwnerID:      ownerID,
			Status:       b.AccountStatus,
		})
	}
	return out, nil
}

// GetTransactions retrieves account statement lines.
// Maps to: GET /holdings/accounts/{id}/transactions?dateFrom=&dateTo=
func (a *Adapter) GetTransactions(ctx interface{}, accountRef string, from, to time.Time) ([]*models.BankTransaction, error) {
	c := ctx.(context.Context)
	path := fmt.Sprintf("/holdings/accounts/%s/transactions?dateFrom=%s&dateTo=%s",
		accountRef, from.Format("20060102"), to.Format("20060102"))
	var raw struct {
		Body []struct {
			TransactionID string `json:"transactionId"`
			DebitCredit   string `json:"debitCreditIndicator"`
			Amount        string `json:"transactionAmount"`
			Currency      string `json:"transactionCurrency"`
			ValueDate     string `json:"valueDate"`
			BookingDate   string `json:"bookingDate"`
			Narrative     string `json:"narrative"`
			Balance       string `json:"bookingBalance"`
		} `json:"body"`
	}
	if err := a.get(c, path, &raw); err != nil {
		return nil, err
	}
	out := make([]*models.BankTransaction, 0, len(raw.Body))
	for _, b := range raw.Body {
		amt, _ := decimal.NewFromString(b.Amount)
		bal, _ := decimal.NewFromString(b.Balance)
		vd, _ := time.Parse("20060102", b.ValueDate)
		bd, _ := time.Parse("20060102", b.BookingDate)
		txType := models.TxCredit
		if b.DebitCredit == "D" {
			txType = models.TxDebit
		}
		out = append(out, &models.BankTransaction{
			ID:           b.TransactionID,
			AccountID:    accountRef,
			ExternalRef:  b.TransactionID,
			Type:         txType,
			Amount:       amt,
			Currency:     b.Currency,
			BalanceAfter: bal,
			ValueDate:    vd,
			BookingDate:  bd,
			Narrative:    b.Narrative,
		})
	}
	return out, nil
}

// CreateEscrowAccount creates a new escrow account for trade settlement.
// Maps to: POST /party/customers/{id}/accounts (ESCROW product)
func (a *Adapter) CreateEscrowAccount(ctx interface{}, ownerID, currency string) (*models.BankAccount, error) {
	c := ctx.(context.Context)
	payload := map[string]any{
		"customerId":  ownerID,
		"productId":   "NEXCOM.ESCROW",
		"currency":    currency,
		"companyId":   a.cfg.CompanyID,
	}
	var raw struct {
		Body struct {
			AccountID string `json:"accountId"`
			Currency  string `json:"currency"`
		} `json:"body"`
	}
	if err := a.post(c, fmt.Sprintf("/party/customers/%s/accounts", ownerID), payload, &raw); err != nil {
		return nil, err
	}
	return &models.BankAccount{
		ID:          raw.Body.AccountID,
		ExternalRef: raw.Body.AccountID,
		Currency:    raw.Body.Currency,
		OwnerID:     ownerID,
		Type:        models.AccountTypeEscrow,
		Status:      "ACTIVE",
		OpenedAt:    time.Now(),
	}, nil
}

// ─── Payment operations ───────────────────────────────────────────────────────

// InitiatePayment sends a credit transfer instruction to Temenos.
// Maps to: POST /order/payments/initiation/creditTransfers (ISO 20022 pacs.008)
func (a *Adapter) InitiatePayment(ctx interface{}, instr *models.PaymentInstruction) (*models.PaymentStatus, error) {
	c := ctx.(context.Context)
	payload := map[string]any{
		"endToEndId":     instr.EndToEndID,
		"debtorAccount":  instr.DebtorAcct,
		"creditorAccount": instr.CreditorAcct,
		"creditorName":   instr.CreditorName,
		"amount":         instr.Amount.String(),
		"currency":       instr.Currency,
		"valueDate":      instr.ValueDate.Format("20060102"),
		"remittanceInfo": instr.RemittanceInfo,
		"purpose":        instr.Purpose,
	}
	var raw struct {
		Body struct {
			PaymentID string `json:"paymentId"`
			Status    string `json:"status"`
		} `json:"body"`
	}
	if err := a.post(c, "/order/payments/initiation/creditTransfers", payload, &raw); err != nil {
		return nil, err
	}
	return &models.PaymentStatus{
		InstructionID: instr.ID,
		Status:        raw.Body.Status,
		CBSRef:        raw.Body.PaymentID,
		Timestamp:     time.Now(),
	}, nil
}

// GetPaymentStatus retrieves the current status of a payment.
// Maps to: GET /order/payments/initiation/creditTransfers/{paymentId}
func (a *Adapter) GetPaymentStatus(ctx interface{}, instructionID string) (*models.PaymentStatus, error) {
	c := ctx.(context.Context)
	var raw struct {
		Body struct {
			Status    string `json:"status"`
			PaymentID string `json:"paymentId"`
		} `json:"body"`
	}
	if err := a.get(c, fmt.Sprintf("/order/payments/initiation/creditTransfers/%s", instructionID), &raw); err != nil {
		return nil, err
	}
	return &models.PaymentStatus{
		InstructionID: instructionID,
		Status:        raw.Body.Status,
		CBSRef:        raw.Body.PaymentID,
		Timestamp:     time.Now(),
	}, nil
}

// ─── Loan operations ──────────────────────────────────────────────────────────

// GetLoan retrieves an agricultural loan by T24 arrangement ID.
func (a *Adapter) GetLoan(ctx interface{}, loanRef string) (*models.AgriLoan, error) {
	c := ctx.(context.Context)
	var raw struct {
		Body struct {
			ArrangementID   string `json:"arrangementId"`
			CustomerId      string `json:"customerId"`
			CustomerName    string `json:"customerName"`
			ProductId       string `json:"productId"`
			Amount          string `json:"amount"`
			OutstandingBalance string `json:"outstandingBalance"`
			InterestRate    string `json:"interestRate"`
			Tenor           int    `json:"tenor"`
			Status          string `json:"status"`
			DisbursementAccount string `json:"disbursementAccount"`
			RepaymentAccount string `json:"repaymentAccount"`
		} `json:"body"`
	}
	if err := a.get(c, fmt.Sprintf("/holdings/arrangements/%s", loanRef), &raw); err != nil {
		return nil, err
	}
	b := raw.Body
	principal, _ := decimal.NewFromString(b.Amount)
	outstanding, _ := decimal.NewFromString(b.OutstandingBalance)
	rate, _ := decimal.NewFromString(b.InterestRate)
	return &models.AgriLoan{
		ID:                 b.ArrangementID,
		ExternalRef:        b.ArrangementID,
		BorrowerID:         b.CustomerId,
		BorrowerName:       b.CustomerName,
		ProductCode:        b.ProductId,
		Principal:          principal,
		OutstandingBalance: outstanding,
		InterestRate:       rate,
		Tenor:              b.Tenor,
		Status:             models.LoanStatus(b.Status),
		DisbursementAcct:   b.DisbursementAccount,
		RepaymentAcct:      b.RepaymentAccount,
	}, nil
}

// GetLoansByBorrower retrieves all loans for a borrower.
func (a *Adapter) GetLoansByBorrower(ctx interface{}, borrowerID string) ([]*models.AgriLoan, error) {
	c := ctx.(context.Context)
	var raw struct {
		Body []struct {
			ArrangementID string `json:"arrangementId"`
			ProductId     string `json:"productId"`
			Amount        string `json:"amount"`
			Status        string `json:"status"`
		} `json:"body"`
	}
	if err := a.get(c, fmt.Sprintf("/holdings/arrangements?customerId=%s&productLine=LOANS", borrowerID), &raw); err != nil {
		return nil, err
	}
	out := make([]*models.AgriLoan, 0, len(raw.Body))
	for _, b := range raw.Body {
		principal, _ := decimal.NewFromString(b.Amount)
		out = append(out, &models.AgriLoan{
			ID:          b.ArrangementID,
			ExternalRef: b.ArrangementID,
			BorrowerID:  borrowerID,
			ProductCode: b.ProductId,
			Principal:   principal,
			Status:      models.LoanStatus(b.Status),
		})
	}
	return out, nil
}

// DisburseInputLoan creates and disburses an agricultural input loan.
func (a *Adapter) DisburseInputLoan(ctx interface{}, loan *models.AgriLoan) (*models.AgriLoan, error) {
	c := ctx.(context.Context)
	payload := map[string]any{
		"customerId":          loan.BorrowerID,
		"productId":           loan.ProductCode,
		"amount":              loan.Principal.String(),
		"currency":            "NGN",
		"tenor":               loan.Tenor,
		"interestRate":        loan.InterestRate.String(),
		"disbursementAccount": loan.DisbursementAcct,
		"repaymentAccount":    loan.RepaymentAcct,
		"collateralType":      loan.CollateralType,
		"collateralRef":       loan.CollateralRef,
	}
	var raw struct {
		Body struct {
			ArrangementID string `json:"arrangementId"`
			Status        string `json:"status"`
		} `json:"body"`
	}
	if err := a.post(c, "/holdings/arrangements", payload, &raw); err != nil {
		return nil, err
	}
	loan.ID = raw.Body.ArrangementID
	loan.ExternalRef = raw.Body.ArrangementID
	loan.Status = models.LoanStatus(raw.Body.Status)
	now := time.Now()
	loan.DisbursedAt = &now
	return loan, nil
}

// RecordRepayment posts a loan repayment to Temenos.
func (a *Adapter) RecordRepayment(ctx interface{}, loanRef string, amount decimal.Decimal) (*models.AgriLoan, error) {
	c := ctx.(context.Context)
	payload := map[string]any{
		"arrangementId": loanRef,
		"paymentAmount": amount.String(),
		"paymentDate":   time.Now().Format("20060102"),
	}
	var raw struct {
		Body struct {
			ArrangementID      string `json:"arrangementId"`
			OutstandingBalance string `json:"outstandingBalance"`
			Status             string `json:"status"`
		} `json:"body"`
	}
	if err := a.post(c, fmt.Sprintf("/holdings/arrangements/%s/payments", loanRef), payload, &raw); err != nil {
		return nil, err
	}
	outstanding, _ := decimal.NewFromString(raw.Body.OutstandingBalance)
	return &models.AgriLoan{
		ID:                 loanRef,
		ExternalRef:        loanRef,
		OutstandingBalance: outstanding,
		Status:             models.LoanStatus(raw.Body.Status),
	}, nil
}

// Ping checks connectivity to the Temenos Transact API.
func (a *Adapter) Ping(ctx interface{}) error {
	c := ctx.(context.Context)
	return a.get(c, "/meta/ping", &struct{}{})
}
