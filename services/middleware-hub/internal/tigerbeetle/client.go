// Package tigerbeetle provides TigerBeetle double-entry ledger integration for NEXCOM.
// TigerBeetle is used for high-throughput, ACID-compliant financial accounting.
// All settlement amounts are recorded as immutable double-entry transfers.
package tigerbeetle

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"math/rand"
	"net/http"
	"os"
	"strings"
	"time"

	"go.uber.org/zap"
)

// Ledger IDs for different asset classes
const (
	LedgerFiat        = 1  // Fiat currency (USD, EUR, KES, NGN, etc.)
	LedgerCommodity   = 2  // Commodity tokens (grain, coffee, etc.)
	LedgerFee         = 3  // Exchange fee collection
	LedgerMargin      = 4  // Margin/collateral accounts
	LedgerSettlement  = 5  // Settlement clearing accounts
)

// Transfer codes for categorization
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

// Account represents a TigerBeetle account
type Account struct {
	ID             uint64 `json:"id"`
	UserData       string `json:"user_data"` // External reference (user ID, DFSP ID)
	Ledger         uint32 `json:"ledger"`
	Code           uint16 `json:"code"`
	Flags          uint16 `json:"flags"`
	DebitsPending  uint64 `json:"debits_pending"`
	DebitsPosted   uint64 `json:"debits_posted"`
	CreditsPending uint64 `json:"credits_pending"`
	CreditsPosted  uint64 `json:"credits_posted"`
	Timestamp      uint64 `json:"timestamp"`
}

// Transfer represents a TigerBeetle double-entry transfer
type Transfer struct {
	ID              uint64 `json:"id"`
	DebitAccountID  uint64 `json:"debit_account_id"`
	CreditAccountID uint64 `json:"credit_account_id"`
	Amount          uint64 `json:"amount"` // Amount in smallest unit (cents)
	PendingID       uint64 `json:"pending_id,omitempty"`
	UserData        string `json:"user_data"` // External reference
	Ledger          uint32 `json:"ledger"`
	Code            uint16 `json:"code"`
	Flags           uint16 `json:"flags"`
	Timeout         uint32 `json:"timeout,omitempty"`
	Timestamp       uint64 `json:"timestamp"`
}

// SettlementRecord represents a complete settlement entry in TigerBeetle
type SettlementRecord struct {
	TradeID      string
	BuyerAccID   uint64
	SellerAccID  uint64
	FeeAccID     uint64
	Amount       float64
	FeeAmount    float64
	Currency     string
	MojaloopTxID string
}

// Client wraps TigerBeetle HTTP API calls
type Client struct {
	httpClient *http.Client
	baseURL    string
	logger     *zap.SugaredLogger
}

// NewClient creates a new TigerBeetle client
func NewClient(logger *zap.SugaredLogger) *Client {
	baseURL := os.Getenv("TIGERBEETLE_HTTP_URL")
	if baseURL == "" {
		baseURL = "http://localhost:3003"
	}
	return &Client{
		httpClient: &http.Client{Timeout: 10 * time.Second},
		baseURL:    baseURL,
		logger:     logger,
	}
}

// CreateAccount creates a new account in TigerBeetle
func (c *Client) CreateAccount(ctx context.Context, userID string, ledger uint32, code uint16) (uint64, error) {
	accountID := rand.Uint64()
	payload := map[string]interface{}{
		"accounts": []map[string]interface{}{
			{
				"id":        accountID,
				"user_data": userID,
				"ledger":    ledger,
				"code":      code,
				"flags":     0,
			},
		},
	}

	data, err := json.Marshal(payload)
	if err != nil {
		return 0, fmt.Errorf("marshal error: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost,
		fmt.Sprintf("%s/api/v1/accounts", c.baseURL),
		strings.NewReader(string(data)),
	)
	if err != nil {
		return 0, fmt.Errorf("request creation error: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return 0, fmt.Errorf("tigerbeetle error: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusCreated {
		return 0, fmt.Errorf("tigerbeetle returned status %d", resp.StatusCode)
	}

	c.logger.Debugw("Created TigerBeetle account", "account_id", accountID, "user_id", userID)
	return accountID, nil
}

// GetAccount retrieves account balance from TigerBeetle
func (c *Client) GetAccount(ctx context.Context, accountID uint64) (*Account, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet,
		fmt.Sprintf("%s/api/v1/accounts/%d", c.baseURL, accountID),
		nil,
	)
	if err != nil {
		return nil, fmt.Errorf("request creation error: %w", err)
	}

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("tigerbeetle error: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusNotFound {
		return nil, nil
	}

	var account Account
	if err := json.NewDecoder(resp.Body).Decode(&account); err != nil {
		return nil, fmt.Errorf("decode error: %w", err)
	}

	return &account, nil
}

// RecordSettlement records a complete trade settlement as double-entry transfers
// This creates 3 transfers: buyer→seller (principal), buyer→fee account (fee), audit trail
func (c *Client) RecordSettlement(ctx context.Context, record SettlementRecord) ([]uint64, error) {
	principalAmount := uint64(record.Amount * 100)    // Convert to cents
	feeAmount := uint64(record.FeeAmount * 100)

	transfers := []map[string]interface{}{
		// Transfer 1: Buyer pays seller (principal amount)
		{
			"id":               rand.Uint64(),
			"debit_account_id": record.BuyerAccID,
			"credit_account_id": record.SellerAccID,
			"amount":           principalAmount,
			"user_data":        record.MojaloopTxID,
			"ledger":           LedgerFiat,
			"code":             CodeTradeBuy,
			"flags":            0,
		},
		// Transfer 2: Buyer pays exchange fee
		{
			"id":               rand.Uint64(),
			"debit_account_id": record.BuyerAccID,
			"credit_account_id": record.FeeAccID,
			"amount":           feeAmount,
			"user_data":        fmt.Sprintf("FEE-%s", record.TradeID),
			"ledger":           LedgerFee,
			"code":             CodeFeeCollection,
			"flags":            0,
		},
	}

	payload := map[string]interface{}{"transfers": transfers}
	data, err := json.Marshal(payload)
	if err != nil {
		return nil, fmt.Errorf("marshal error: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost,
		fmt.Sprintf("%s/api/v1/transfers", c.baseURL),
		strings.NewReader(string(data)),
	)
	if err != nil {
		return nil, fmt.Errorf("request creation error: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("tigerbeetle error: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusCreated {
		return nil, fmt.Errorf("tigerbeetle returned status %d", resp.StatusCode)
	}

	var result struct {
		TransferIDs []uint64 `json:"transfer_ids"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("decode error: %w", err)
	}

	c.logger.Infow("Recorded settlement in TigerBeetle",
		"trade_id", record.TradeID,
		"amount", record.Amount,
		"fee", record.FeeAmount,
		"transfer_count", len(result.TransferIDs),
	)

	return result.TransferIDs, nil
}

// GetAccountBalance returns the net balance (credits - debits) for an account
func (c *Client) GetAccountBalance(ctx context.Context, accountID uint64) (int64, error) {
	account, err := c.GetAccount(ctx, accountID)
	if err != nil {
		return 0, err
	}
	if account == nil {
		return 0, fmt.Errorf("account %d not found", accountID)
	}

	// Net balance = credits_posted - debits_posted (in cents)
	balance := int64(account.CreditsPosted) - int64(account.DebitsPosted)
	return balance, nil
}

// HealthCheck verifies TigerBeetle connectivity
func (c *Client) HealthCheck(ctx context.Context) bool {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet,
		fmt.Sprintf("%s/api/v1/health", c.baseURL),
		nil,
	)
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

// CreateTransfer creates a double-entry transfer in TigerBeetle.
func (c *Client) CreateTransfer(ctx context.Context, transferID uint64, debitAccount uint64, creditAccount uint64, amount uint64, ledger uint32, code uint16) error {
	payload := map[string]interface{}{
		"transfer_id":    transferID,
		"debit_account":  debitAccount,
		"credit_account": creditAccount,
		"amount":         amount,
		"ledger":         ledger,
		"code":           code,
	}
	body, _ := json.Marshal(payload)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+"/api/v1/transfers", bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("tigerbeetle CreateTransfer: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusCreated {
		return fmt.Errorf("tigerbeetle CreateTransfer: status %d", resp.StatusCode)
	}
	return nil
}
