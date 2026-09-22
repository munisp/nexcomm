// Package tigerbeetle provides double-entry ledger integration for NEXCOM.
//
// IMPORTANT: TigerBeetle speaks a binary protocol — it has NO HTTP/JSON API.
// The previous version of this client POSTed JSON to the TigerBeetle port,
// which could never succeed. All ledger operations are now routed through the
// gateway-service ledger API (/api/v1/ledger/*), which owns the official
// TigerBeetle SDK client (see gateway-service/internal/tigerbeetle/client.go
// and gateway-service/internal/api/ledger_handlers.go).
//
// Fail-closed: any transport or gateway error fails the operation. No local
// or simulated ledger state is ever fabricated.
package tigerbeetle

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"time"

	"go.uber.org/zap"
)

// Transfer codes for categorization (must match gateway-service ledger codes)
const (
	CodeTradeBuy         = 1001 // Buyer pays for trade
	CodeTradeSell        = 1002 // Seller receives payment
	CodeFeeCollection    = 1003 // Exchange fee deduction
	CodeDeposit          = 1004 // User deposits funds
	CodeWithdrawal       = 1005 // User withdraws funds
	CodeMojaloopCredit   = 1006 // Mojaloop transfer credit
	CodeMojaloopDebit    = 1007 // Mojaloop transfer debit
	CodeMarginCall       = 1008 // Margin call deduction
	CodeSettlementCredit = 1009 // Settlement credit
	CodeSettlementDebit  = 1010 // Settlement debit
)

// Account mirrors the gateway ledger API account shape
// (gateway-service/internal/tigerbeetle/client.go Account).
type Account struct {
	ID       string `json:"id"`
	UserID   string `json:"userId"`
	Type     string `json:"type"`
	Currency string `json:"currency"`
	Balance  int64  `json:"balance"`
	Pending  int64  `json:"pending"`
}

// Transfer mirrors the gateway ledger API transfer shape.
type Transfer struct {
	ID              string `json:"id"`
	DebitAccountID  string `json:"debitAccountId"`
	CreditAccountID string `json:"creditAccountId"`
	Amount          int64  `json:"amount"` // smallest unit (cents)
	Code            uint16 `json:"code"`
	Timestamp       int64  `json:"timestamp"`
	Status          string `json:"status"`
}

// SettlementRecord represents a complete settlement entry to record.
type SettlementRecord struct {
	TradeID      string
	BuyerAccID   string // gateway ledger account UUID
	SellerAccID  string // gateway ledger account UUID
	FeeAccID     string // gateway ledger account UUID
	Amount       float64
	FeeAmount    float64
	Currency     string
	MojaloopTxID string
}

// Client calls the gateway-service ledger API.
type Client struct {
	httpClient *http.Client
	baseURL    string // gateway base URL, e.g. http://gateway:8200
	logger     *zap.SugaredLogger
}

// NewClient creates a ledger client targeting the gateway-service ledger API.
// Configuration: GATEWAY_URL (or LEDGER_API_URL), default http://localhost:8200.
// TIGERBEETLE_HTTP_URL is no longer used — TigerBeetle has no HTTP interface.
func NewClient(logger *zap.SugaredLogger) *Client {
	baseURL := os.Getenv("GATEWAY_URL")
	if baseURL == "" {
		baseURL = os.Getenv("LEDGER_API_URL")
	}
	if baseURL == "" {
		baseURL = "http://localhost:8200"
	}
	return &Client{
		httpClient: &http.Client{Timeout: 10 * time.Second},
		baseURL:    baseURL,
		logger:     logger,
	}
}

func (c *Client) post(ctx context.Context, path string, payload interface{}, out interface{}) error {
	data, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("marshal error: %w", err)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+path, bytes.NewReader(data))
	if err != nil {
		return fmt.Errorf("request creation error: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("gateway ledger API error: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusCreated {
		return fmt.Errorf("gateway ledger API returned status %d for %s", resp.StatusCode, path)
	}
	if out != nil {
		if err := json.NewDecoder(resp.Body).Decode(out); err != nil {
			return fmt.Errorf("decode error: %w", err)
		}
	}
	return nil
}

func (c *Client) get(ctx context.Context, path string, out interface{}) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.baseURL+path, nil)
	if err != nil {
		return fmt.Errorf("request creation error: %w", err)
	}
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("gateway ledger API error: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("gateway ledger API returned status %d for %s", resp.StatusCode, path)
	}
	if out != nil {
		if err := json.NewDecoder(resp.Body).Decode(out); err != nil {
			return fmt.Errorf("decode error: %w", err)
		}
	}
	return nil
}

// CreateAccount creates a ledger account via POST /api/v1/ledger/accounts.
// accountType must be one of the gateway-supported types: margin, settlement,
// fee, clearing.
func (c *Client) CreateAccount(ctx context.Context, userID, accountType, currency string) (*Account, error) {
	var account Account
	err := c.post(ctx, "/api/v1/ledger/accounts", map[string]interface{}{
		"user_id":      userID,
		"account_type": accountType,
		"currency":     currency,
	}, &account)
	if err != nil {
		return nil, err
	}
	c.logger.Debugw("Created ledger account via gateway", "account_id", account.ID, "user_id", userID)
	return &account, nil
}

// GetAccountsByUser lists a user's accounts via GET /api/v1/ledger/accounts/:user_id.
func (c *Client) GetAccountsByUser(ctx context.Context, userID string) ([]Account, error) {
	var resp struct {
		Accounts []Account `json:"accounts"`
		Count    int       `json:"count"`
	}
	if err := c.get(ctx, "/api/v1/ledger/accounts/"+userID, &resp); err != nil {
		return nil, err
	}
	return resp.Accounts, nil
}

// GetAccountBalance returns the posted balance for an account (in smallest
// units) via GET /api/v1/ledger/accounts/:account_id/balance.
func (c *Client) GetAccountBalance(ctx context.Context, accountID string) (int64, error) {
	var resp struct {
		AccountID string `json:"account_id"`
		Balance   int64  `json:"balance"`
		Currency  string `json:"currency"`
	}
	if err := c.get(ctx, "/api/v1/ledger/accounts/"+accountID+"/balance", &resp); err != nil {
		return 0, err
	}
	return resp.Balance, nil
}

// CreateTransfer posts an immediate double-entry transfer via
// POST /api/v1/ledger/transfers. Account IDs are gateway ledger UUIDs.
func (c *Client) CreateTransfer(ctx context.Context, debitAccountID, creditAccountID string, amount int64, code uint16, reference string) (*Transfer, error) {
	if amount <= 0 {
		return nil, fmt.Errorf("transfer amount must be positive")
	}
	var transfer Transfer
	err := c.post(ctx, "/api/v1/ledger/transfers", map[string]interface{}{
		"debit_account_id":  debitAccountID,
		"credit_account_id": creditAccountID,
		"amount":            amount,
		"code":              code,
		"reference":         reference,
	}, &transfer)
	if err != nil {
		return nil, err
	}
	return &transfer, nil
}

// CreatePendingTransfer creates a two-phase (pending) transfer via
// POST /api/v1/ledger/transfers/pending.
func (c *Client) CreatePendingTransfer(ctx context.Context, debitAccountID, creditAccountID string, amount int64, code uint16, reference string) (*Transfer, error) {
	if amount <= 0 {
		return nil, fmt.Errorf("transfer amount must be positive")
	}
	var transfer Transfer
	err := c.post(ctx, "/api/v1/ledger/transfers/pending", map[string]interface{}{
		"debit_account_id":  debitAccountID,
		"credit_account_id": creditAccountID,
		"amount":            amount,
		"code":              code,
		"reference":         reference,
	}, &transfer)
	if err != nil {
		return nil, err
	}
	return &transfer, nil
}

// RecordSettlement records a trade settlement as two double-entry transfers
// (principal buyer→seller, fee buyer→fee account) via the gateway ledger API.
// If the fee leg fails after the principal leg posted, the error propagates —
// reconciliation is handled by the calling Temporal workflow's compensation.
func (c *Client) RecordSettlement(ctx context.Context, record SettlementRecord) ([]string, error) {
	principalAmount := int64(record.Amount * 100) // cents
	feeAmount := int64(record.FeeAmount * 100)

	ids := make([]string, 0, 2)

	principal, err := c.CreateTransfer(ctx, record.BuyerAccID, record.SellerAccID, principalAmount, CodeTradeBuy, record.MojaloopTxID)
	if err != nil {
		return nil, fmt.Errorf("principal leg failed: %w", err)
	}
	ids = append(ids, principal.ID)

	if feeAmount > 0 && record.FeeAccID != "" {
		fee, err := c.CreateTransfer(ctx, record.BuyerAccID, record.FeeAccID, feeAmount, CodeFeeCollection, fmt.Sprintf("FEE-%s", record.TradeID))
		if err != nil {
			return ids, fmt.Errorf("fee leg failed (principal posted as %s): %w", principal.ID, err)
		}
		ids = append(ids, fee.ID)
	}

	c.logger.Infow("Recorded settlement via gateway ledger API",
		"trade_id", record.TradeID,
		"amount", record.Amount,
		"fee", record.FeeAmount,
		"transfer_count", len(ids),
	)
	return ids, nil
}

// HealthCheck verifies gateway (and thus ledger path) connectivity.
func (c *Client) HealthCheck(ctx context.Context) bool {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.baseURL+"/health", nil)
	if err != nil {
		return false
	}
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return false
	}
	defer resp.Body.Close()
	return resp.StatusCode == http.StatusOK
}
