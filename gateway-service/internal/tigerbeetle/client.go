// Package tigerbeetle provides a production-grade TigerBeetle ledger client
// for NEXCOM Exchange. Uses the official github.com/tigerbeetle/tigerbeetle-go
// SDK with the correct binary protocol, replacing the previous custom TCP
// implementation. Maintains the same public interface so callers in server.go
// require no changes.
package tigerbeetle

import (
	"fmt"
	"log"
	"strings"
	"math/big"
	"sync"
	"time"

	tb "github.com/tigerbeetle/tigerbeetle-go"
	tb_types "github.com/tigerbeetle/tigerbeetle-go/pkg/types"
	"github.com/google/uuid"
)

// Transfer type codes (preserved from original)
const (
	TransferTradeSettlement uint16 = 1
	TransferMarginDeposit   uint16 = 2
	TransferMarginRelease   uint16 = 3
	TransferFeeCollection   uint16 = 4
	TransferWithdrawal      uint16 = 5
	TransferDeposit         uint16 = 6
)

// Ledger IDs
const (
	LedgerNGN uint32 = 1
	LedgerUSD uint32 = 2
)

// Account type codes
const (
	AccountCodeMargin     uint16 = 100
	AccountCodeSettlement uint16 = 101
	AccountCodeFee        uint16 = 102
	AccountCodeClearing   uint16 = 103
)

// Account mirrors the original struct for compatibility with callers.
type Account struct {
	ID       string `json:"id"`
	UserID   string `json:"userId"`
	Type     string `json:"type"`
	Currency string `json:"currency"`
	Balance  int64  `json:"balance"`
	Pending  int64  `json:"pending"`
}

// Transfer mirrors the original struct for compatibility with callers.
type Transfer struct {
	ID              string `json:"id"`
	DebitAccountID  string `json:"debitAccountId"`
	CreditAccountID string `json:"creditAccountId"`
	Amount          int64  `json:"amount"`
	Code            uint16 `json:"code"`
	Timestamp       int64  `json:"timestamp"`
	Status          string `json:"status"`
}

// Client wraps the official TigerBeetle Go SDK with graceful fallback to
// an in-memory double-entry ledger when TigerBeetle is unavailable.
type Client struct {
	tbClient     tb.Client
	addresses    string
	connected    bool
	fallbackMode bool
	mu           sync.RWMutex
	accounts     map[string]*Account
	transfers    []Transfer
}

// NewClient creates a TigerBeetle client connecting to the given addresses.
func NewClient(addresses string) *Client {
	c := &Client{
		addresses: addresses,
		accounts:  make(map[string]*Account),
		transfers: make([]Transfer, 0),
	}
	c.connect()
	return c
}

func (c *Client) connect() {
	log.Printf("[TigerBeetle] Connecting to cluster: %s", c.addresses)
	addrs := strings.Split(c.addresses, ",")
	for i := range addrs {
		addrs[i] = strings.TrimSpace(addrs[i])
	}

	clusterID := tb_types.ToUint128(0)
	client, err := tb.NewClient(clusterID, addrs)
	if err != nil {
		log.Printf("[TigerBeetle] WARN: Cannot connect to %s: %v — running in fallback mode (in-memory ledger)", c.addresses, err)
		c.mu.Lock()
		c.fallbackMode = true
		c.connected = false
		c.mu.Unlock()
		return
	}

	if nopErr := client.Nop(); nopErr != nil {
		log.Printf("[TigerBeetle] WARN: Nop failed: %v — running in fallback mode", nopErr)
		client.Close()
		c.mu.Lock()
		c.fallbackMode = true
		c.connected = false
		c.mu.Unlock()
		return
	}

	c.mu.Lock()
	c.tbClient = client
	c.connected = true
	c.fallbackMode = false
	c.mu.Unlock()
	log.Printf("[TigerBeetle] Connected to %s (Nop verified, official SDK)", c.addresses)
}

func uuidToUint128(id string) (tb_types.Uint128, error) {
	parsed, err := uuid.Parse(id)
	if err != nil {
		return tb_types.Uint128{}, fmt.Errorf("invalid uuid %q: %w", id, err)
	}
	return tb_types.BytesToUint128([16]byte(parsed)), nil
}

// CreateAccount creates a ledger account for a user.
func (c *Client) CreateAccount(userID, accountType, currency string) (*Account, error) {
	accountID := uuid.New().String()
	account := &Account{
		ID:       accountID,
		UserID:   userID,
		Type:     accountType,
		Currency: currency,
		Balance:  0,
		Pending:  0,
	}

	c.mu.RLock()
	fb := c.fallbackMode
	c.mu.RUnlock()

	if fb {
		c.mu.Lock()
		c.accounts[accountID] = account
		c.mu.Unlock()
		log.Printf("[TigerBeetle] Created account (fallback): id=%s user=%s type=%s", accountID, userID, accountType)
		return account, nil
	}

	id128, err := uuidToUint128(accountID)
	if err != nil {
		return nil, err
	}
	ledger := LedgerNGN
	if currency == "USD" {
		ledger = LedgerUSD
	}
	code := AccountCodeMargin
	switch accountType {
	case "settlement":
		code = AccountCodeSettlement
	case "fee":
		code = AccountCodeFee
	case "clearing":
		code = AccountCodeClearing
	}

	results, err := c.tbClient.CreateAccounts([]tb_types.Account{
		{ID: id128, Ledger: ledger, Code: uint16(code)},
	})
	if err != nil {
		return nil, fmt.Errorf("tigerbeetle CreateAccount: %w", err)
	}
	for _, r := range results {
		if r.Result != tb_types.AccountOK {
			return nil, fmt.Errorf("tigerbeetle account creation error: %v", r.Result)
		}
	}
	log.Printf("[TigerBeetle] Created account: id=%s user=%s type=%s", accountID, userID, accountType)
	return account, nil
}

// CreateTransfer creates an immediate double-entry transfer between two accounts.
func (c *Client) CreateTransfer(debitAccountID, creditAccountID string, amount int64, code uint16) (*Transfer, error) {
	transferID := uuid.New().String()
	transfer := &Transfer{
		ID:              transferID,
		DebitAccountID:  debitAccountID,
		CreditAccountID: creditAccountID,
		Amount:          amount,
		Code:            code,
		Timestamp:       time.Now().UnixMilli(),
		Status:          "committed",
	}

	c.mu.RLock()
	fb := c.fallbackMode
	c.mu.RUnlock()

	if fb {
		c.mu.Lock()
		c.transfers = append(c.transfers, *transfer)
		if debit, ok := c.accounts[debitAccountID]; ok {
			debit.Balance -= amount
		}
		if credit, ok := c.accounts[creditAccountID]; ok {
			credit.Balance += amount
		}
		c.mu.Unlock()
		log.Printf("[TigerBeetle] Transfer (fallback): debit=%s credit=%s amount=%d code=%d", debitAccountID, creditAccountID, amount, code)
		return transfer, nil
	}

	id128, err := uuidToUint128(transferID)
	if err != nil {
		return nil, err
	}
	debit128, err := uuidToUint128(debitAccountID)
	if err != nil {
		return nil, err
	}
	credit128, err := uuidToUint128(creditAccountID)
	if err != nil {
		return nil, err
	}

	results, err := c.tbClient.CreateTransfers([]tb_types.Transfer{
		{
			ID:              id128,
			DebitAccountID:  debit128,
			CreditAccountID: credit128,
			Amount:          tb_types.ToUint128(uint64(amount)),
			Ledger:          LedgerNGN,
			Code:            code,
		},
	})
	if err != nil {
		return nil, fmt.Errorf("tigerbeetle CreateTransfer: %w", err)
	}
	for _, r := range results {
		if r.Result != tb_types.TransferOK {
			return nil, fmt.Errorf("tigerbeetle transfer error: %v", r.Result)
		}
	}
	log.Printf("[TigerBeetle] Transfer: debit=%s credit=%s amount=%d code=%d", debitAccountID, creditAccountID, amount, code)
	return transfer, nil
}

// CreatePendingTransfer creates a two-phase pending transfer for margin reservation.
func (c *Client) CreatePendingTransfer(debitAccountID, creditAccountID string, amount int64, code uint16) (*Transfer, error) {
	transferID := uuid.New().String()
	transfer := &Transfer{
		ID:              transferID,
		DebitAccountID:  debitAccountID,
		CreditAccountID: creditAccountID,
		Amount:          amount,
		Code:            code,
		Timestamp:       time.Now().UnixMilli(),
		Status:          "pending",
	}

	c.mu.RLock()
	fb := c.fallbackMode
	c.mu.RUnlock()

	if fb {
		c.mu.Lock()
		c.transfers = append(c.transfers, *transfer)
		if debit, ok := c.accounts[debitAccountID]; ok {
			debit.Pending += amount
		}
		c.mu.Unlock()
		log.Printf("[TigerBeetle] Pending transfer (fallback): id=%s amount=%d", transferID, amount)
		return transfer, nil
	}

	id128, err := uuidToUint128(transferID)
	if err != nil {
		return nil, err
	}
	debit128, err := uuidToUint128(debitAccountID)
	if err != nil {
		return nil, err
	}
	credit128, err := uuidToUint128(creditAccountID)
	if err != nil {
		return nil, err
	}

	results, err := c.tbClient.CreateTransfers([]tb_types.Transfer{
		{
			ID:              id128,
			DebitAccountID:  debit128,
			CreditAccountID: credit128,
			Amount:          tb_types.ToUint128(uint64(amount)),
			Ledger:          LedgerNGN,
			Code:            code,
			Flags:           tb_types.TransferFlags{Pending: true}.ToUint16(),
		},
	})
	if err != nil {
		return nil, fmt.Errorf("tigerbeetle CreatePendingTransfer: %w", err)
	}
	for _, r := range results {
		if r.Result != tb_types.TransferOK {
			return nil, fmt.Errorf("tigerbeetle pending transfer error: %v", r.Result)
		}
	}
	log.Printf("[TigerBeetle] Pending transfer: id=%s amount=%d", transferID, amount)
	return transfer, nil
}

// CommitTransfer posts (commits) a pending two-phase transfer.
func (c *Client) CommitTransfer(transferID string) error {
	c.mu.RLock()
	fb := c.fallbackMode
	c.mu.RUnlock()

	if fb {
		c.mu.Lock()
		defer c.mu.Unlock()
		for i := range c.transfers {
			if c.transfers[i].ID == transferID && c.transfers[i].Status == "pending" {
				c.transfers[i].Status = "committed"
				if debit, ok := c.accounts[c.transfers[i].DebitAccountID]; ok {
					debit.Pending -= c.transfers[i].Amount
					debit.Balance -= c.transfers[i].Amount
				}
				if credit, ok := c.accounts[c.transfers[i].CreditAccountID]; ok {
					credit.Balance += c.transfers[i].Amount
				}
				log.Printf("[TigerBeetle] Committed transfer (fallback): %s", transferID)
				return nil
			}
		}
		return nil
	}

	postID := uuid.New().String()
	postID128, err := uuidToUint128(postID)
	if err != nil {
		return err
	}
	pending128, err := uuidToUint128(transferID)
	if err != nil {
		return err
	}

	results, err := c.tbClient.CreateTransfers([]tb_types.Transfer{
		{
			ID:        postID128,
			PendingID: pending128,
			Flags:     tb_types.TransferFlags{PostPendingTransfer: true}.ToUint16(),
			Ledger:    LedgerNGN,
		},
	})
	if err != nil {
		return fmt.Errorf("tigerbeetle CommitTransfer: %w", err)
	}
	for _, r := range results {
		if r.Result != tb_types.TransferOK {
			return fmt.Errorf("tigerbeetle commit error: %v", r.Result)
		}
	}
	log.Printf("[TigerBeetle] Committed transfer: %s", transferID)
	return nil
}

// VoidTransfer voids a pending two-phase transfer, releasing reserved funds.
func (c *Client) VoidTransfer(transferID string) error {
	c.mu.RLock()
	fb := c.fallbackMode
	c.mu.RUnlock()

	if fb {
		c.mu.Lock()
		defer c.mu.Unlock()
		for i := range c.transfers {
			if c.transfers[i].ID == transferID && c.transfers[i].Status == "pending" {
				c.transfers[i].Status = "voided"
				if debit, ok := c.accounts[c.transfers[i].DebitAccountID]; ok {
					debit.Pending -= c.transfers[i].Amount
				}
				log.Printf("[TigerBeetle] Voided transfer (fallback): %s", transferID)
				return nil
			}
		}
		return nil
	}

	voidID := uuid.New().String()
	voidID128, err := uuidToUint128(voidID)
	if err != nil {
		return err
	}
	pending128, err := uuidToUint128(transferID)
	if err != nil {
		return err
	}

	results, err := c.tbClient.CreateTransfers([]tb_types.Transfer{
		{
			ID:        voidID128,
			PendingID: pending128,
			Flags:     tb_types.TransferFlags{VoidPendingTransfer: true}.ToUint16(),
			Ledger:    LedgerNGN,
		},
	})
	if err != nil {
		return fmt.Errorf("tigerbeetle VoidTransfer: %w", err)
	}
	for _, r := range results {
		if r.Result != tb_types.TransferOK {
			return fmt.Errorf("tigerbeetle void error: %v", r.Result)
		}
	}
	log.Printf("[TigerBeetle] Voided transfer: %s", transferID)
	return nil
}

// GetAccountBalance returns the current balance of an account.
func (c *Client) GetAccountBalance(accountID string) (int64, error) {
	c.mu.RLock()
	fb := c.fallbackMode
	c.mu.RUnlock()

	if fb {
		c.mu.RLock()
		defer c.mu.RUnlock()
		if account, ok := c.accounts[accountID]; ok {
			return account.Balance, nil
		}
		return 0, nil
	}

	id128, err := uuidToUint128(accountID)
	if err != nil {
		return 0, err
	}
	accounts, err := c.tbClient.LookupAccounts([]tb_types.Uint128{id128})
	if err != nil {
		return 0, fmt.Errorf("tigerbeetle LookupAccounts: %w", err)
	}
	if len(accounts) == 0 {
		return 0, nil
	}
	acc := accounts[0]
	creditsPosted := bigIntToInt64(acc.CreditsPosted.BigInt())
	debitsPosted := bigIntToInt64(acc.DebitsPosted.BigInt())
	return creditsPosted - debitsPosted, nil
}

// GetAccountTransfers returns recent transfers for an account.
func (c *Client) GetAccountTransfers(accountID string, limit int) ([]Transfer, error) {
	c.mu.RLock()
	fb := c.fallbackMode
	c.mu.RUnlock()

	if fb {
		c.mu.RLock()
		defer c.mu.RUnlock()
		var result []Transfer
		for _, t := range c.transfers {
			if t.DebitAccountID == accountID || t.CreditAccountID == accountID {
				result = append(result, t)
			}
		}
		if len(result) > limit && limit > 0 {
			result = result[len(result)-limit:]
		}
		return result, nil
	}

	id128, err := uuidToUint128(accountID)
	if err != nil {
		return nil, err
	}
	tbTransfers, err := c.tbClient.GetAccountTransfers(tb_types.AccountFilter{
		AccountID: id128,
		Limit:     uint32(limit),
		Flags:     tb_types.AccountFilterFlags{Debits: true, Credits: true, Reversed: true}.ToUint32(),
	})
	if err != nil {
		return nil, fmt.Errorf("tigerbeetle GetAccountTransfers: %w", err)
	}
	result := make([]Transfer, 0, len(tbTransfers))
	for _, t := range tbTransfers {
		result = append(result, Transfer{
			ID:              t.ID.String(),
			DebitAccountID:  t.DebitAccountID.String(),
			CreditAccountID: t.CreditAccountID.String(),
			Amount:          bigIntToInt64(t.Amount.BigInt()),
			Code:            t.Code,
			Timestamp:       int64(t.Timestamp),
			Status:          "committed",
		})
	}
	return result, nil
}

// GetAllAccounts returns all accounts for a user (in-memory fallback).
func (c *Client) GetAllAccounts(userID string) []*Account {
	c.mu.RLock()
	defer c.mu.RUnlock()
	var result []*Account
	for _, a := range c.accounts {
		if a.UserID == userID {
			result = append(result, a)
		}
	}
	return result
}


// bigIntToInt64 converts a big.Int value to int64.
func bigIntToInt64(v big.Int) int64 {
	return v.Int64()
}

// IsConnected returns true if the client has a live TigerBeetle connection.
func (c *Client) IsConnected() bool {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.connected
}

// IsFallback returns true if the client is running in in-memory fallback mode.
func (c *Client) IsFallback() bool {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.fallbackMode
}

// Close gracefully closes the TigerBeetle connection.
func (c *Client) Close() {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.tbClient != nil {
		c.tbClient.Close()
	}
	c.connected = false
	log.Println("[TigerBeetle] Connection closed")
}
