// Package clients provides typed HTTP clients for every NEXCOM platform service.
// Each client method maps to a real HTTP endpoint and returns typed results.
// All methods are safe to call from Temporal activities.
package clients

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"

	"github.com/munisp/nexcomm/journey-orchestrator/internal/config"
)

// Client is the unified HTTP client for all NEXCOM services.
type Client struct {
	http *http.Client
	cfg  *config.Services
}

// New creates a new Client with a 30-second timeout.
func New(cfg *config.Services) *Client {
	return &Client{
		http: &http.Client{Timeout: 30 * time.Second},
		cfg:  cfg,
	}
}

// ─── Generic helpers ──────────────────────────────────────────────────────────

func (c *Client) post(ctx context.Context, url string, body, result interface{}) error {
	b, err := json.Marshal(body)
	if err != nil {
		return fmt.Errorf("marshal: %w", err)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(b))
	if err != nil {
		return fmt.Errorf("new request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := c.http.Do(req)
	if err != nil {
		return fmt.Errorf("POST %s: %w", url, err)
	}
	defer resp.Body.Close()
	data, _ := io.ReadAll(resp.Body)
	if resp.StatusCode >= 400 {
		return fmt.Errorf("POST %s returned %d: %s", url, resp.StatusCode, string(data))
	}
	if result != nil {
		return json.Unmarshal(data, result)
	}
	return nil
}

func (c *Client) get(ctx context.Context, url string, result interface{}) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return fmt.Errorf("new request: %w", err)
	}
	resp, err := c.http.Do(req)
	if err != nil {
		return fmt.Errorf("GET %s: %w", url, err)
	}
	defer resp.Body.Close()
	data, _ := io.ReadAll(resp.Body)
	if resp.StatusCode >= 400 {
		return fmt.Errorf("GET %s returned %d: %s", url, resp.StatusCode, string(data))
	}
	if result != nil {
		return json.Unmarshal(data, result)
	}
	return nil
}

// ─── KYC Service ─────────────────────────────────────────────────────────────

type KYCRequest struct {
	UserID      string `json:"user_id"`
	DocumentType string `json:"document_type"` // "NIN" | "BVN" | "PASSPORT"
	DocumentNumber string `json:"document_number"`
	FirstName   string `json:"first_name"`
	LastName    string `json:"last_name"`
	DateOfBirth string `json:"date_of_birth"`
	PhoneNumber string `json:"phone_number"`
}

type KYCResult struct {
	Status      string `json:"status"` // "APPROVED" | "REJECTED" | "PENDING"
	KYCLevel    int    `json:"kyc_level"`
	RiskScore   float64 `json:"risk_score"`
	Reference   string `json:"reference"`
	FailReason  string `json:"fail_reason,omitempty"`
}

func (c *Client) SubmitKYC(ctx context.Context, req KYCRequest) (*KYCResult, error) {
	var result KYCResult
	err := c.post(ctx, c.cfg.KYCURL+"/api/v1/kyc/verify", req, &result)
	return &result, err
}

func (c *Client) GetKYCStatus(ctx context.Context, userID string) (*KYCResult, error) {
	var result KYCResult
	err := c.get(ctx, c.cfg.KYCURL+"/api/v1/kyc/status/"+userID, &result)
	return &result, err
}

// ─── AML / Risk Service ───────────────────────────────────────────────────────

type AMLScreenRequest struct {
	UserID   string  `json:"user_id"`
	Amount   float64 `json:"amount"`
	Currency string  `json:"currency"`
	Channel  string  `json:"channel"`
}

type AMLResult struct {
	Cleared    bool   `json:"cleared"`
	RiskLevel  string `json:"risk_level"` // "LOW" | "MEDIUM" | "HIGH" | "BLOCKED"
	AlertID    string `json:"alert_id,omitempty"`
	Reason     string `json:"reason,omitempty"`
}

func (c *Client) AMLScreen(ctx context.Context, req AMLScreenRequest) (*AMLResult, error) {
	var result AMLResult
	err := c.post(ctx, c.cfg.RiskURL+"/api/v1/aml/screen", req, &result)
	return &result, err
}

// ─── TigerBeetle / Gateway ────────────────────────────────────────────────────

type CreateAccountRequest struct {
	UserID      string `json:"user_id"`
	AccountType string `json:"account_type"` // "TRADING" | "SETTLEMENT" | "MARGIN" | "FEE"
	Currency    string `json:"currency"`
}

type AccountResult struct {
	AccountID string `json:"account_id"`
	Balance   int64  `json:"balance"`
	Status    string `json:"status"`
}

func (c *Client) CreateLedgerAccount(ctx context.Context, req CreateAccountRequest) (*AccountResult, error) {
	var result AccountResult
	err := c.post(ctx, c.cfg.GatewayURL+"/api/v1/ledger/accounts", req, &result)
	return &result, err
}

func (c *Client) GetBalance(ctx context.Context, accountID string) (int64, error) {
	var result struct {
		Balance int64 `json:"balance"`
	}
	err := c.get(ctx, c.cfg.GatewayURL+"/api/v1/ledger/accounts/"+accountID+"/balance", &result)
	return result.Balance, err
}

type TransferRequest struct {
	DebitAccountID  string  `json:"debit_account_id"`
	CreditAccountID string  `json:"credit_account_id"`
	Amount          int64   `json:"amount"` // in kobo/cents
	Code            int     `json:"code"`
	Reference       string  `json:"reference"`
}

type TransferResult struct {
	TransferID string `json:"id"`
	Status     string `json:"status"`
}

func (c *Client) CreateTransfer(ctx context.Context, req TransferRequest) (*TransferResult, error) {
	var result TransferResult
	err := c.post(ctx, c.cfg.GatewayURL+"/api/v1/ledger/transfers", req, &result)
	return &result, err
}

func (c *Client) SettleTrade(ctx context.Context, buyerID, sellerID string, amount float64, currency, tradeID, settlementID string) error {
	body := map[string]interface{}{
		"buyer_user_id":  buyerID,
		"seller_user_id": sellerID,
		"amount":         amount,
		"currency":       currency,
		"trade_id":       tradeID,
		"settlement_id":  settlementID,
	}
	return c.post(ctx, c.cfg.GatewayURL+"/api/v1/settlement/settle", body, nil)
}

// ─── Matching Engine ──────────────────────────────────────────────────────────

type OrderRequest struct {
	ClientOrderID string  `json:"client_order_id"`
	AccountID     string  `json:"account_id"`
	Symbol        string  `json:"symbol"`
	Side          string  `json:"side"` // "BUY" | "SELL"
	OrderType     string  `json:"order_type"` // "MARKET" | "LIMIT"
	TimeInForce   string  `json:"time_in_force"` // "DAY" | "GTC" | "IOC" | "FOK"
	Price         float64 `json:"price,omitempty"`
	Quantity      float64 `json:"quantity"`
}

type OrderResult struct {
	Success bool `json:"success"`
	Data    struct {
		Order struct {
			ID              string  `json:"id"`
			Status          string  `json:"status"`
			FilledQuantity  float64 `json:"filled_quantity"`
			RemainingQty    float64 `json:"remaining_quantity"`
			AveragePrice    float64 `json:"average_price"`
		} `json:"order"`
		Trades []struct {
			ID       string  `json:"id"`
			Price    float64 `json:"price"`
			Quantity float64 `json:"quantity"`
		} `json:"trades"`
	} `json:"data"`
	Error string `json:"error,omitempty"`
}

func (c *Client) PlaceOrder(ctx context.Context, req OrderRequest) (*OrderResult, error) {
	var result OrderResult
	err := c.post(ctx, c.cfg.MatchingEngine+"/api/v1/orders", req, &result)
	return &result, err
}

func (c *Client) CancelOrder(ctx context.Context, symbol, orderID string) error {
	return c.post(ctx, fmt.Sprintf("%s/api/v1/orders/%s/%s/cancel", c.cfg.MatchingEngine, symbol, orderID), nil, nil)
}

func (c *Client) GetMarketDepth(ctx context.Context, symbol string) (map[string]interface{}, error) {
	var result map[string]interface{}
	err := c.get(ctx, c.cfg.MatchingEngine+"/api/v1/depth/"+symbol, &result)
	return result, err
}

// ─── Warehouse / Commodity ────────────────────────────────────────────────────

type WarehouseReceiptRequest struct {
	WarehouseID     string  `json:"warehouse_id"`
	CommoditySymbol string  `json:"commodity_symbol"`
	QuantityTonnes  float64 `json:"quantity_tonnes"`
	Grade           string  `json:"grade"`
	OwnerAccountID  string  `json:"owner_account"`
}

type WarehouseReceiptResult struct {
	ReceiptID  string `json:"id"`
	LotNumber  string `json:"lot_number"`
	Status     string `json:"status"`
	IssuedAt   string `json:"issued_at"`
}

func (c *Client) IssueWarehouseReceipt(ctx context.Context, req WarehouseReceiptRequest) (*WarehouseReceiptResult, error) {
	var result WarehouseReceiptResult
	err := c.post(ctx, c.cfg.MatchingEngine+"/api/v1/delivery/receipts", req, &result)
	return &result, err
}

// ─── Blockchain / Tokenization ────────────────────────────────────────────────

type TokenizeRequest struct {
	CommoditySymbol    string `json:"commodity_symbol"`
	Quantity           string `json:"quantity"`
	OwnerID            string `json:"owner_id"`
	WarehouseReceiptID string `json:"warehouse_receipt_id"`
	Chain              string `json:"chain"` // "hyperledger" | "polygon"
}

type TokenizeResult struct {
	TokenID         string `json:"token_id"`
	ContractAddress string `json:"contract_address"`
	TxHash          string `json:"tx_hash"`
	MetadataCID     string `json:"metadata_cid"`
	Status          string `json:"status"`
}

func (c *Client) TokenizeCommodity(ctx context.Context, req TokenizeRequest) (*TokenizeResult, error) {
	var result TokenizeResult
	err := c.post(ctx, c.cfg.BlockchainURL+"/api/v1/blockchain/tokenize", req, &result)
	return &result, err
}

// ─── Credit Scoring ───────────────────────────────────────────────────────────

type CreditScoreRequest struct {
	FarmerID         int64   `json:"farmer_id"`
	LoanAmountNGN    float64 `json:"loan_amount_ngn"`
	LoanPurpose      string  `json:"loan_purpose"`
	LoanTermMonths   int     `json:"loan_term_months"`
	TotalLoansTaken  int     `json:"total_loans_taken"`
	LoansRepaidOnTime int    `json:"loans_repaid_on_time"`
	LoansDefaulted   int     `json:"loans_defaulted"`
	FarmSizeHectares float64 `json:"farm_size_hectares"`
	AnnualFarmIncome float64 `json:"annual_farm_income_ngn"`
	CollateralValue  float64 `json:"warehouse_receipt_value_ngn"`
	CooperativeMember bool   `json:"cooperative_member"`
}

type CreditScoreResult struct {
	Score              int     `json:"score"`
	ScoreBand          string  `json:"score_band"`
	Decision           string  `json:"decision"`
	MaxLoanAmountNGN   float64 `json:"max_loan_amount_ngn"`
	InterestRatePremium int    `json:"interest_rate_premium_bps"`
	BureauRef          string  `json:"bureau_ref"`
}

func (c *Client) ScoreFarmer(ctx context.Context, req CreditScoreRequest) (*CreditScoreResult, error) {
	var result CreditScoreResult
	err := c.post(ctx, c.cfg.CreditScoringURL+"/api/v1/score", req, &result)
	return &result, err
}

// ─── Notification Service ─────────────────────────────────────────────────────

type NotificationRequest struct {
	UserID  int    `json:"user_id"`
	Channel string `json:"channel"` // "email" | "sms" | "push" | "in_app"
	Type    string `json:"type"`
	Title   string `json:"title"`
	Message string `json:"message"`
	Data    map[string]interface{} `json:"data,omitempty"`
}

func (c *Client) SendNotification(ctx context.Context, req NotificationRequest) error {
	return c.post(ctx, c.cfg.NotificationURL+"/api/v1/notifications/send", req, nil)
}

// ─── Lakehouse / Ingestion ────────────────────────────────────────────────────

type LakehouseIngestRequest struct {
	Topic  string                 `json:"topic"`
	Record map[string]interface{} `json:"record"`
}

func (c *Client) IngestToLakehouse(ctx context.Context, topic string, record map[string]interface{}) error {
	return c.post(ctx, c.cfg.IngestionURL+"/api/v1/kafka/ingest", LakehouseIngestRequest{
		Topic:  topic,
		Record: record,
	}, nil)
}

// ─── Fluvio Real-time Stream ──────────────────────────────────────────────────

type FluvioProduceRequest struct {
	Topic string                 `json:"topic"`
	Key   string                 `json:"key"`
	Value map[string]interface{} `json:"value"`
}

func (c *Client) ProduceFluvio(ctx context.Context, topic, key string, value map[string]interface{}) error {
	return c.post(ctx, c.cfg.FluvioURL+"/api/v1/produce", FluvioProduceRequest{
		Topic: topic,
		Key:   key,
		Value: value,
	}, nil)
}

// ─── AI/ML Service ────────────────────────────────────────────────────────────

type AnomalyDetectRequest struct {
	UserID    string    `json:"user_id"`
	EventType string    `json:"event_type"`
	Features  []float64 `json:"features"`
}

type AnomalyResult struct {
	IsAnomaly   bool    `json:"is_anomaly"`
	Score       float64 `json:"score"`
	Explanation string  `json:"explanation"`
}

func (c *Client) DetectAnomaly(ctx context.Context, req AnomalyDetectRequest) (*AnomalyResult, error) {
	var result AnomalyResult
	err := c.post(ctx, c.cfg.AiMlURL+"/api/v1/anomaly/detect", req, &result)
	return &result, err
}

// ─── Mojaloop ─────────────────────────────────────────────────────────────────

type MojaloopTransferRequest struct {
	TransferID      string  `json:"transfer_id"`
	SenderFSP       string  `json:"sender_fsp"`
	ReceiverFSP     string  `json:"receiver_fsp"`
	ReceiverAccount string  `json:"receiver_account"`
	Amount          float64 `json:"amount"`
	Currency        string  `json:"currency"`
	Note            string  `json:"note"`
}

type MojaloopTransferResult struct {
	TransferID string `json:"transfer_id"`
	Status     string `json:"status"`
	Fulfillment string `json:"fulfillment,omitempty"`
}

func (c *Client) InitiateMojaloopTransfer(ctx context.Context, req MojaloopTransferRequest) (*MojaloopTransferResult, error) {
	var result MojaloopTransferResult
	err := c.post(ctx, c.cfg.GatewayURL+"/api/v1/mojaloop/transfer", req, &result)
	return &result, err
}

// ─── Surveillance ─────────────────────────────────────────────────────────────

type SurveillanceAlertRequest struct {
	AlertType  string `json:"alert_type"`
	UserID     string `json:"user_id"`
	Symbol     string `json:"symbol"`
	OrderID    string `json:"order_id,omitempty"`
	Severity   string `json:"severity"` // "LOW" | "MEDIUM" | "HIGH" | "CRITICAL"
	Evidence   map[string]interface{} `json:"evidence"`
}

func (c *Client) RaiseSurveillanceAlert(ctx context.Context, req SurveillanceAlertRequest) error {
	return c.post(ctx, c.cfg.MatchingEngine+"/api/v1/surveillance/alerts", req, nil)
}

// ─── User Management ──────────────────────────────────────────────────────────

type UserProfileResult struct {
	ID          int    `json:"id"`
	Email       string `json:"email"`
	KYCStatus   string `json:"kyc_status"`
	AccountType string `json:"account_type"`
	Status      string `json:"status"`
}

func (c *Client) GetUserProfile(ctx context.Context, userID string) (*UserProfileResult, error) {
	var result UserProfileResult
	err := c.get(ctx, c.cfg.UserMgmtURL+"/api/v1/users/"+userID, &result)
	return &result, err
}

// ─── Futures ──────────────────────────────────────────────────────────────────

type FuturesOrderRequest struct {
	AccountID   string  `json:"account_id"`
	Symbol      string  `json:"symbol"`
	Side        string  `json:"side"`
	Quantity    float64 `json:"quantity"`
	Price       float64 `json:"price"`
	OrderType   string  `json:"order_type"`
}

func (c *Client) PlaceFuturesOrder(ctx context.Context, req FuturesOrderRequest) (map[string]interface{}, error) {
	var result map[string]interface{}
	err := c.post(ctx, c.cfg.MatchingEngine+"/api/v1/orders", req, &result)
	return result, err
}

func (c *Client) GetMarginRequirements(ctx context.Context, accountID string) (map[string]interface{}, error) {
	var result map[string]interface{}
	err := c.get(ctx, c.cfg.MatchingEngine+"/api/v1/clearing/margins/"+accountID, &result)
	return result, err
}

// ─── Broker ───────────────────────────────────────────────────────────────────

type BrokerRegistrationRequest struct {
	BrokerID    string `json:"broker_id"`
	Name        string `json:"name"`
	LicenseNo   string `json:"license_no"`
	ContactEmail string `json:"contact_email"`
}

func (c *Client) RegisterBroker(ctx context.Context, req BrokerRegistrationRequest) (map[string]interface{}, error) {
	var result map[string]interface{}
	err := c.post(ctx, c.cfg.MatchingEngine+"/api/v1/brokers", req, &result)
	return result, err
}

// ─── Market Maker ─────────────────────────────────────────────────────────────

type MarketMakerQuoteRequest struct {
	MarketMakerID string  `json:"market_maker_id"`
	Symbol        string  `json:"symbol"`
	BidPrice      float64 `json:"bid_price"`
	AskPrice      float64 `json:"ask_price"`
	BidSize       float64 `json:"bid_size"`
	AskSize       float64 `json:"ask_size"`
}

func (c *Client) SubmitMarketMakerQuote(ctx context.Context, req MarketMakerQuoteRequest) (map[string]interface{}, error) {
	var result map[string]interface{}
	err := c.post(ctx, c.cfg.MatchingEngine+"/api/v1/market-makers/quotes", req, &result)
	return result, err
}

// ─── Corporate Actions ────────────────────────────────────────────────────────

func (c *Client) ProcessCorporateAction(ctx context.Context, actionID string) (map[string]interface{}, error) {
	var result map[string]interface{}
	err := c.post(ctx, fmt.Sprintf("%s/api/v1/corporate-actions/%s/process", c.cfg.MatchingEngine, actionID), nil, &result)
	return result, err
}

// ─── Compliance / Regulator ───────────────────────────────────────────────────

type ComplianceReportRequest struct {
	ReportType  string `json:"report_type"` // "STR" | "CTR" | "DAILY_POSITION" | "TRADE_SURVEILLANCE"
	PeriodStart string `json:"period_start"`
	PeriodEnd   string `json:"period_end"`
	GeneratedBy string `json:"generated_by"`
}

func (c *Client) GenerateComplianceReport(ctx context.Context, req ComplianceReportRequest) (map[string]interface{}, error) {
	var result map[string]interface{}
	err := c.post(ctx, c.cfg.AnalyticsURL+"/api/v1/compliance/reports", req, &result)
	return result, err
}
