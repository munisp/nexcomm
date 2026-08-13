package tigerbeetle

import (
	"errors"
	"fmt"
	"log"
	"math/big"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	tb "github.com/tigerbeetle/tigerbeetle-go"
	tb_types "github.com/tigerbeetle/tigerbeetle-go/pkg/types"
)

var ErrUnavailable = errors.New("tigerbeetle ledger unavailable")

const (
	TransferTradeSettlement uint16 = 1
	TransferMarginDeposit   uint16 = 2
	TransferMarginRelease   uint16 = 3
	TransferFeeCollection   uint16 = 4
	TransferWithdrawal      uint16 = 5
	TransferDeposit         uint16 = 6
)

const (
	LedgerNGN uint32 = 1
	LedgerUSD uint32 = 2
)

const (
	AccountCodeMargin     uint16 = 100
	AccountCodeSettlement uint16 = 101
	AccountCodeFee        uint16 = 102
	AccountCodeClearing   uint16 = 103
)

type Account struct {
	ID       string `json:"id"`
	UserID   string `json:"userId"`
	Type     string `json:"type"`
	Currency string `json:"currency"`
	Balance  int64  `json:"balance"`
	Pending  int64  `json:"pending"`
}

type Transfer struct {
	ID              string `json:"id"`
	DebitAccountID  string `json:"debitAccountId"`
	CreditAccountID string `json:"creditAccountId"`
	Amount          int64  `json:"amount"`
	Code            uint16 `json:"code"`
	Timestamp       int64  `json:"timestamp"`
	Status          string `json:"status"`
}

// Client wraps the official TigerBeetle SDK. It keeps only non-authoritative
// account labels for API display; every monetary balance and transfer result is
// retrieved from TigerBeetle itself.
type Client struct {
	tbClient  tb.Client
	addresses string
	connected bool
	mu        sync.RWMutex
	accounts  map[string]*Account
}

func NewClient(addresses string) *Client {
	c := &Client{addresses: addresses, accounts: make(map[string]*Account)}
	_ = c.connect()
	return c
}

func (c *Client) connect() error {
	addrs := strings.Split(c.addresses, ",")
	for i := range addrs {
		addrs[i] = strings.TrimSpace(addrs[i])
	}
	client, err := tb.NewClient(tb_types.ToUint128(0), addrs)
	if err != nil {
		c.mu.Lock()
		c.connected = false
		c.mu.Unlock()
		return fmt.Errorf("%w: create client: %v", ErrUnavailable, err)
	}
	if err := client.Nop(); err != nil {
		client.Close()
		c.mu.Lock()
		c.connected = false
		c.mu.Unlock()
		return fmt.Errorf("%w: health check: %v", ErrUnavailable, err)
	}
	c.mu.Lock()
	if c.tbClient != nil {
		c.tbClient.Close()
	}
	c.tbClient = client
	c.connected = true
	c.mu.Unlock()
	log.Printf("[TigerBeetle] Connected to %s", c.addresses)
	return nil
}

func (c *Client) requireClient() (tb.Client, error) {
	c.mu.RLock()
	client, connected := c.tbClient, c.connected
	c.mu.RUnlock()
	if connected && client != nil {
		return client, nil
	}
	if err := c.connect(); err != nil {
		return nil, err
	}
	c.mu.RLock()
	client = c.tbClient
	c.mu.RUnlock()
	if client == nil {
		return nil, ErrUnavailable
	}
	return client, nil
}

func uuidToUint128(id string) (tb_types.Uint128, error) {
	parsed, err := uuid.Parse(id)
	if err != nil {
		return tb_types.Uint128{}, fmt.Errorf("invalid UUID %q: %w", id, err)
	}
	return tb_types.BytesToUint128([16]byte(parsed)), nil
}

func ledgerForCurrency(currency string) (uint32, error) {
	switch strings.ToUpper(currency) {
	case "NGN":
		return LedgerNGN, nil
	case "USD":
		return LedgerUSD, nil
	default:
		return 0, fmt.Errorf("unsupported TigerBeetle currency %q", currency)
	}
}

func accountCode(accountType string) (uint16, error) {
	switch accountType {
	case "margin":
		return AccountCodeMargin, nil
	case "settlement":
		return AccountCodeSettlement, nil
	case "fee":
		return AccountCodeFee, nil
	case "clearing":
		return AccountCodeClearing, nil
	default:
		return 0, fmt.Errorf("unsupported ledger account type %q", accountType)
	}
}

func (c *Client) CreateAccount(userID, accountType, currency string) (*Account, error) {
	if strings.TrimSpace(userID) == "" {
		return nil, errors.New("user ID is required")
	}
	client, err := c.requireClient()
	if err != nil {
		return nil, err
	}
	ledger, err := ledgerForCurrency(currency)
	if err != nil {
		return nil, err
	}
	code, err := accountCode(accountType)
	if err != nil {
		return nil, err
	}
	accountID := uuid.New().String()
	id128, err := uuidToUint128(accountID)
	if err != nil {
		return nil, err
	}
	results, err := client.CreateAccounts([]tb_types.Account{{ID: id128, Ledger: ledger, Code: code}})
	if err != nil {
		return nil, fmt.Errorf("TigerBeetle CreateAccounts: %w", err)
	}
	for _, result := range results {
		if result.Result != tb_types.AccountOK {
			return nil, fmt.Errorf("TigerBeetle account creation error: %v", result.Result)
		}
	}
	account := &Account{ID: accountID, UserID: userID, Type: accountType, Currency: strings.ToUpper(currency)}
	c.mu.Lock()
	c.accounts[accountID] = account
	c.mu.Unlock()
	return account, nil
}

func (c *Client) CreateTransfer(debitAccountID, creditAccountID string, amount int64, code uint16) (*Transfer, error) {
	if amount <= 0 {
		return nil, errors.New("transfer amount must be positive")
	}
	client, err := c.requireClient()
	if err != nil {
		return nil, err
	}
	transferID := uuid.New().String()
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
	results, err := client.CreateTransfers([]tb_types.Transfer{{ID: id128, DebitAccountID: debit128, CreditAccountID: credit128, Amount: tb_types.ToUint128(uint64(amount)), Ledger: LedgerNGN, Code: code}})
	if err != nil {
		return nil, fmt.Errorf("TigerBeetle CreateTransfers: %w", err)
	}
	for _, result := range results {
		if result.Result != tb_types.TransferOK {
			return nil, fmt.Errorf("TigerBeetle transfer error: %v", result.Result)
		}
	}
	return &Transfer{ID: transferID, DebitAccountID: debitAccountID, CreditAccountID: creditAccountID, Amount: amount, Code: code, Timestamp: time.Now().UnixMilli(), Status: "committed"}, nil
}

func (c *Client) CreatePendingTransfer(debitAccountID, creditAccountID string, amount int64, code uint16) (*Transfer, error) {
	if amount <= 0 {
		return nil, errors.New("pending transfer amount must be positive")
	}
	client, err := c.requireClient()
	if err != nil {
		return nil, err
	}
	transferID := uuid.New().String()
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
	results, err := client.CreateTransfers([]tb_types.Transfer{{ID: id128, DebitAccountID: debit128, CreditAccountID: credit128, Amount: tb_types.ToUint128(uint64(amount)), Ledger: LedgerNGN, Code: code, Flags: tb_types.TransferFlags{Pending: true}.ToUint16()}})
	if err != nil {
		return nil, fmt.Errorf("TigerBeetle CreatePendingTransfer: %w", err)
	}
	for _, result := range results {
		if result.Result != tb_types.TransferOK {
			return nil, fmt.Errorf("TigerBeetle pending-transfer error: %v", result.Result)
		}
	}
	return &Transfer{ID: transferID, DebitAccountID: debitAccountID, CreditAccountID: creditAccountID, Amount: amount, Code: code, Timestamp: time.Now().UnixMilli(), Status: "pending"}, nil
}

func (c *Client) CommitTransfer(transferID string) error {
	return c.resolvePendingTransfer(transferID, true)
}
func (c *Client) VoidTransfer(transferID string) error {
	return c.resolvePendingTransfer(transferID, false)
}

func (c *Client) resolvePendingTransfer(transferID string, commit bool) error {
	client, err := c.requireClient()
	if err != nil {
		return err
	}
	pendingID, err := uuidToUint128(transferID)
	if err != nil {
		return err
	}
	resolutionID, err := uuidToUint128(uuid.New().String())
	if err != nil {
		return err
	}
	flags := tb_types.TransferFlags{VoidPendingTransfer: true}.ToUint16()
	if commit {
		flags = tb_types.TransferFlags{PostPendingTransfer: true}.ToUint16()
	}
	results, err := client.CreateTransfers([]tb_types.Transfer{{ID: resolutionID, PendingID: pendingID, Flags: flags, Ledger: LedgerNGN}})
	if err != nil {
		return fmt.Errorf("TigerBeetle resolve pending transfer: %w", err)
	}
	for _, result := range results {
		if result.Result != tb_types.TransferOK {
			return fmt.Errorf("TigerBeetle pending-resolution error: %v", result.Result)
		}
	}
	return nil
}

func (c *Client) GetAccountBalance(accountID string) (int64, error) {
	client, err := c.requireClient()
	if err != nil {
		return 0, err
	}
	id128, err := uuidToUint128(accountID)
	if err != nil {
		return 0, err
	}
	accounts, err := client.LookupAccounts([]tb_types.Uint128{id128})
	if err != nil {
		return 0, fmt.Errorf("TigerBeetle LookupAccounts: %w", err)
	}
	if len(accounts) != 1 {
		return 0, fmt.Errorf("ledger account %s not found", accountID)
	}
	credits := bigIntToInt64(accounts[0].CreditsPosted.BigInt())
	debits := bigIntToInt64(accounts[0].DebitsPosted.BigInt())
	return credits - debits, nil
}

func (c *Client) GetAccountTransfers(accountID string, limit int) ([]Transfer, error) {
	client, err := c.requireClient()
	if err != nil {
		return nil, err
	}
	if limit <= 0 || limit > 1000 {
		limit = 100
	}
	id128, err := uuidToUint128(accountID)
	if err != nil {
		return nil, err
	}
	transfers, err := client.GetAccountTransfers(tb_types.AccountFilter{AccountID: id128, Limit: uint32(limit), Flags: tb_types.AccountFilterFlags{Debits: true, Credits: true, Reversed: true}.ToUint32()})
	if err != nil {
		return nil, fmt.Errorf("TigerBeetle GetAccountTransfers: %w", err)
	}
	result := make([]Transfer, 0, len(transfers))
	for _, transfer := range transfers {
		result = append(result, Transfer{ID: transfer.ID.String(), DebitAccountID: transfer.DebitAccountID.String(), CreditAccountID: transfer.CreditAccountID.String(), Amount: bigIntToInt64(transfer.Amount.BigInt()), Code: transfer.Code, Timestamp: int64(transfer.Timestamp), Status: "committed"})
	}
	return result, nil
}

// GetAllAccounts returns only labels for accounts successfully created through
// this process. Financial balances are retrieved per-account from TigerBeetle.
// A durable account-directory adapter must be used for cross-process discovery.
func (c *Client) GetAllAccounts(userID string) []*Account {
	c.mu.RLock()
	defer c.mu.RUnlock()
	result := make([]*Account, 0)
	for _, account := range c.accounts {
		if account.UserID == userID {
			clone := *account
			result = append(result, &clone)
		}
	}
	return result
}

func bigIntToInt64(value big.Int) int64 { return value.Int64() }
func (c *Client) IsConnected() bool     { c.mu.RLock(); defer c.mu.RUnlock(); return c.connected }
func (c *Client) IsFallback() bool      { return false }
func (c *Client) Close() {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.tbClient != nil {
		c.tbClient.Close()
		c.tbClient = nil
	}
	c.connected = false
}
