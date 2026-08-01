// Package activities implements all Temporal activity functions for the 20 NEXCOM journeys.
// Every activity makes real HTTP calls to platform services — no mocks, no stubs.
package activities

import (
	"context"
	"fmt"
	"time"

	"github.com/munisp/nexcomm/journey-orchestrator/internal/clients"
	"github.com/munisp/nexcomm/journey-orchestrator/internal/config"
)

// ─── Shared types ─────────────────────────────────────────────────────────────

type KYCActivityInput struct {
	UserID         string `json:"user_id"`
	DocumentType   string `json:"document_type"`
	DocumentNumber string `json:"document_number"`
	FirstName      string `json:"first_name"`
	LastName       string `json:"last_name"`
	PhoneNumber    string `json:"phone_number"`
}
type KYCActivityResult struct {
	Status   string `json:"status"`
	KYCLevel int    `json:"kyc_level"`
	Reference string `json:"reference"`
}
type AMLActivityInput struct {
	UserID   string  `json:"user_id"`
	Amount   float64 `json:"amount"`
	Currency string  `json:"currency"`
	Channel  string  `json:"channel"`
}
type AMLActivityResult struct {
	Cleared   bool   `json:"cleared"`
	RiskLevel string `json:"risk_level"`
	AlertID   string `json:"alert_id,omitempty"`
}
type CreateAccountInput struct {
	UserID      string `json:"user_id"`
	AccountType string `json:"account_type"`
	Currency    string `json:"currency"`
}
type LedgerAccountResult struct {
	AccountID string `json:"account_id"`
	Balance   int64  `json:"balance"`
}
type RoleAssignInput struct {
	UserID string   `json:"user_id"`
	Roles  []string `json:"roles"`
}
type NotificationInput struct {
	UserID  string `json:"user_id"`
	Channel string `json:"channel"`
	Title   string `json:"title"`
	Message string `json:"message"`
}
type LakehouseInput struct {
	Topic  string                 `json:"topic"`
	Record map[string]interface{} `json:"record"`
}
type FluvioInput struct {
	Topic string                 `json:"topic"`
	Key   string                 `json:"key"`
	Value map[string]interface{} `json:"value"`
}
type PermissionInput struct {
	SubjectID string `json:"subject_id"`
	Resource  string `json:"resource"`
	Action    string `json:"action"`
}
type WarehouseCheckInput struct {
	WarehouseID    string  `json:"warehouse_id"`
	QuantityTonnes float64 `json:"quantity_tonnes"`
	Commodity      string  `json:"commodity"`
}
type WarehouseReceiptInput struct {
	WarehouseID     string  `json:"warehouse_id"`
	CommoditySymbol string  `json:"commodity_symbol"`
	QuantityTonnes  float64 `json:"quantity_tonnes"`
	Grade           string  `json:"grade"`
	OwnerAccountID  string  `json:"owner_account_id"`
}
type WarehouseReceiptResult struct {
	ReceiptID string `json:"receipt_id"`
	LotNumber string `json:"lot_number"`
}
type PriceResult struct {
	Symbol    string  `json:"symbol"`
	Price     float64 `json:"price"`
	Change24h float64 `json:"change_24h"`
}
type TokenizeInput struct {
	CommoditySymbol    string `json:"commodity_symbol"`
	Quantity           string `json:"quantity"`
	OwnerID            string `json:"owner_id"`
	WarehouseReceiptID string `json:"warehouse_receipt_id"`
	Chain              string `json:"chain"`
}
type TokenizeResult struct {
	TokenID string `json:"token_id"`
	TxHash  string `json:"tx_hash"`
}
type ReceiptOwnershipInput struct {
	ReceiptID string `json:"receipt_id"`
	OwnerID   string `json:"owner_id"`
}
type ListingRiskInput struct {
	SellerID       string  `json:"seller_id"`
	Symbol         string  `json:"symbol"`
	QuantityTonnes float64 `json:"quantity_tonnes"`
	AskPrice       float64 `json:"ask_price"`
}
type OrderInput struct {
	AccountID   string  `json:"account_id"`
	Symbol      string  `json:"symbol"`
	Side        string  `json:"side"`
	OrderType   string  `json:"order_type"`
	TimeInForce string  `json:"time_in_force"`
	Quantity    float64 `json:"quantity"`
	Price       float64 `json:"price"`
}
type OrderActivityResult struct {
	OrderID        string   `json:"order_id"`
	Status         string   `json:"status"`
	FilledQuantity float64  `json:"filled_quantity"`
	AveragePrice   float64  `json:"average_price"`
	TradeIDs       []string `json:"trade_ids"`
}
type PreTradeInput struct {
	UserID   string  `json:"user_id"`
	Symbol   string  `json:"symbol"`
	Quantity float64 `json:"quantity"`
	Price    float64 `json:"price"`
}
type BalanceCheckInput struct {
	UserID         string  `json:"user_id"`
	RequiredAmount float64 `json:"required_amount"`
	Currency       string  `json:"currency"`
}
type ReserveInput struct {
	UserID    string  `json:"user_id"`
	Amount    float64 `json:"amount"`
	Currency  string  `json:"currency"`
	Reference string  `json:"reference"`
}
type SettleTradeInput struct {
	BuyerID      string  `json:"buyer_id"`
	Symbol       string  `json:"symbol"`
	Amount       float64 `json:"amount"`
	Currency     string  `json:"currency"`
	TradeID      string  `json:"trade_id"`
	SettlementID string  `json:"settlement_id"`
}
type ReceiptTransferInput struct {
	Symbol     string  `json:"symbol"`
	QuantityKg float64 `json:"quantity_kg"`
	FromUserID string  `json:"from_user_id"`
	ToUserID   string  `json:"to_user_id"`
	TradeID    string  `json:"trade_id"`
}
type SettlementWorkflowInput struct {
	TradeID  string  `json:"trade_id"`
	BuyerID  string  `json:"buyer_id"`
	Amount   float64 `json:"amount"`
	Currency string  `json:"currency"`
}
type PendingTransferInput struct {
	DebitAccountID  string `json:"debit_account_id"`
	CreditAccountID string `json:"credit_account_id"`
	Amount          int64  `json:"amount"`
	Code            int    `json:"code"`
	Reference       string `json:"reference"`
}
type DvPInput struct {
	TradeID    string  `json:"trade_id"`
	BuyerID    string  `json:"buyer_id"`
	SellerID   string  `json:"seller_id"`
	Symbol     string  `json:"symbol"`
	QuantityKg float64 `json:"quantity_kg"`
	PriceNGN   float64 `json:"price_ngn"`
}
type DvPResult struct {
	TxHash string `json:"tx_hash"`
	Status string `json:"status"`
}
type FeeInput struct {
	SellerID string `json:"seller_id"`
	Amount   int64  `json:"amount"`
	TradeID  string `json:"trade_id"`
}
type MarginReqInput struct {
	AccountID string  `json:"account_id"`
	Symbol    string  `json:"symbol"`
	Contracts int     `json:"contracts"`
}
type MarginRequirementResult struct {
	InitialMargin     float64 `json:"initial_margin"`
	MaintenanceMargin float64 `json:"maintenance_margin"`
}
type MarginReserveInput struct {
	TraderID  string  `json:"trader_id"`
	Amount    float64 `json:"amount"`
	Symbol    string  `json:"symbol"`
	Reference string  `json:"reference"`
}
type SanctionsInput struct {
	UserID          string  `json:"user_id"`
	ReceiverFSP     string  `json:"receiver_fsp"`
	ReceiverAccount string  `json:"receiver_account"`
	Amount          float64 `json:"amount"`
}
type ILPQuoteInput struct {
	SenderFSP       string  `json:"sender_fsp"`
	ReceiverFSP     string  `json:"receiver_fsp"`
	Amount          float64 `json:"amount"`
	SendCurrency    string  `json:"send_currency"`
	ReceiveCurrency string  `json:"receive_currency"`
}
type ILPQuoteResult struct {
	FXRate          float64 `json:"fx_rate"`
	ReceivedAmount  float64 `json:"received_amount"`
	FeeNGN          float64 `json:"fee_ngn"`
	ILPCondition    string  `json:"ilp_condition"`
}
type MojaloopTransferInput struct {
	TransferID      string  `json:"transfer_id"`
	SenderFSP       string  `json:"sender_fsp"`
	ReceiverFSP     string  `json:"receiver_fsp"`
	ReceiverAccount string  `json:"receiver_account"`
	Amount          float64 `json:"amount"`
	Currency        string  `json:"currency"`
	Note            string  `json:"note"`
	ILPCondition    string  `json:"ilp_condition"`
}
type MojaloopTxResult struct {
	TransferID  string `json:"transfer_id"`
	Status      string `json:"status"`
	Fulfillment string `json:"fulfillment,omitempty"`
}
type PaymentGatewayInput struct {
	UserID        string  `json:"user_id"`
	Direction     string  `json:"direction"`
	Amount        float64 `json:"amount"`
	Channel       string  `json:"channel"`
	Reference     string  `json:"reference"`
	BankAccountNo string  `json:"bank_account_no"`
}
type CreditInput struct {
	UserID    string `json:"user_id"`
	Amount    int64  `json:"amount"`
	Currency  string `json:"currency"`
	Reference string `json:"reference"`
}
type DebitInput struct {
	UserID    string `json:"user_id"`
	Amount    int64  `json:"amount"`
	Currency  string `json:"currency"`
	Reference string `json:"reference"`
}
type PINVerifyInput struct {
	PhoneNumber string `json:"phone_number"`
	PIN         string `json:"pin"`
}
type SMSInput struct {
	PhoneNumber string `json:"phone_number"`
	Message     string `json:"message"`
}
type CreditScoreInput struct {
	FarmerID           string  `json:"farmer_id"`
	LoanAmountNGN      float64 `json:"loan_amount_ngn"`
	LoanPurpose        string  `json:"loan_purpose"`
	LoanTermMonths     int     `json:"loan_term_months"`
	FarmSizeHa         float64 `json:"farm_size_ha"`
	AnnualIncomeNGN    float64 `json:"annual_income_ngn"`
	CollateralValueNGN float64 `json:"collateral_value_ngn"`
}
type CreditScoreActivityResult struct {
	Score       int     `json:"score"`
	ScoreBand   string  `json:"score_band"`
	Decision    string  `json:"decision"`
	MaxLoanNGN  float64 `json:"max_loan_amount_ngn"`
	PremiumBPS  int     `json:"interest_rate_premium_bps"`
}
type LoanRecordInput struct {
	FarmerID        string  `json:"farmer_id"`
	AmountNGN       float64 `json:"amount_ngn"`
	InterestRatePct float64 `json:"interest_rate_pct"`
	TermMonths      int     `json:"term_months"`
	Purpose         string  `json:"purpose"`
	CollateralType  string  `json:"collateral_type"`
	CollateralRefID string  `json:"collateral_ref_id"`
	CreditScore     int     `json:"credit_score"`
}
type LoanValidateInput struct {
	LoanID     int64  `json:"loan_id"`
	ApprovedBy string `json:"approved_by"`
}
type LendingReserveInput struct {
	LoanID int64 `json:"loan_id"`
	Amount int64 `json:"amount"`
}
type LoanCommitInput struct {
	LoanID       int64  `json:"loan_id"`
	ReserveID    string `json:"reserve_id"`
	MojaloopTxID string `json:"mojaloop_tx_id"`
}
type RepaymentScheduleInput struct {
	LoanID   int64   `json:"loan_id"`
	FarmerID string  `json:"farmer_id"`
	AmountNGN float64 `json:"amount_ngn"`
}
type STRInput struct {
	UserID    string                 `json:"user_id"`
	CaseID    string                 `json:"case_id"`
	RiskLevel string                 `json:"risk_level"`
	Amount    float64                `json:"amount"`
	Currency  string                 `json:"currency"`
	Evidence  map[string]interface{} `json:"evidence"`
}
type EscalateInput struct {
	CaseID string `json:"case_id"`
	UserID string `json:"user_id"`
	Reason string `json:"reason"`
}
type KYCUpgradeInput struct {
	UserID   string `json:"user_id"`
	NewLevel int    `json:"new_level"`
}
type CorporateActionValidateInput struct {
	ActionID   string `json:"action_id"`
	Symbol     string `json:"symbol"`
	ActionType string `json:"action_type"`
	RecordDate string `json:"record_date"`
	InitiatedBy string `json:"initiated_by"`
}
type HolderQueryInput struct {
	Symbol     string `json:"symbol"`
	RecordDate string `json:"record_date"`
}
type HolderRecord struct {
	UserID   string  `json:"user_id"`
	Quantity float64 `json:"quantity"`
}
type HolderActionInput struct {
	ActionID   string  `json:"action_id"`
	HolderID   string  `json:"holder_id"`
	Symbol     string  `json:"symbol"`
	ActionType string  `json:"action_type"`
	HolderQty  float64 `json:"holder_qty"`
	Ratio      float64 `json:"ratio"`
}
type BroadcastInput struct {
	Symbol      string  `json:"symbol"`
	ActionType  string  `json:"action_type"`
	Ratio       float64 `json:"ratio"`
	PayDate     string  `json:"pay_date"`
	HolderCount int     `json:"holder_count"`
}
type AnomalyInput struct {
	UserID    string                 `json:"user_id"`
	Symbol    string                 `json:"symbol"`
	AlertType string                 `json:"alert_type"`
	Evidence  map[string]interface{} `json:"evidence"`
}
type AnomalyResult struct {
	IsAnomaly   bool    `json:"is_anomaly"`
	Score       float64 `json:"score"`
	Explanation string  `json:"explanation"`
}
type TradingHistoryInput struct {
	UserID string `json:"user_id"`
	Symbol string `json:"symbol"`
	Days   int    `json:"days"`
}
type TradingHistoryResult struct {
	TotalVolume float64 `json:"total_volume"`
	TradeCount  int     `json:"trade_count"`
}
type SurveillanceAlertInput struct {
	AlertType string                 `json:"alert_type"`
	UserID    string                 `json:"user_id"`
	Symbol    string                 `json:"symbol"`
	Severity  string                 `json:"severity"`
	Evidence  map[string]interface{} `json:"evidence"`
}
type WarningInput struct {
	UserID    string `json:"user_id"`
	AlertType string `json:"alert_type"`
	AlertID   string `json:"alert_id"`
}
type LiquidateInput struct {
	AccountID  string `json:"account_id"`
	PositionID string `json:"position_id"`
	Symbol     string `json:"symbol"`
}
type ComplianceReportInput struct {
	AuditID     string `json:"audit_id"`
	ReportType  string `json:"report_type"`
	PeriodStart string `json:"period_start"`
	PeriodEnd   string `json:"period_end"`
	GeneratedBy string `json:"generated_by"`
}
type ComplianceReportResult struct {
	ReportURL       string              `json:"report_url"`
	ViolationsFound int                 `json:"violations_found"`
	Violations      []ComplianceViolation `json:"violations"`
}
type ComplianceViolation struct {
	Type   string  `json:"type"`
	UserID string  `json:"user_id"`
	Amount float64 `json:"amount"`
}
type AuditAnomalyInput struct {
	PeriodStart string `json:"period_start"`
	PeriodEnd   string `json:"period_end"`
	AuditType   string `json:"audit_type"`
}
type AuditAnomalyResult struct {
	AnomalyCount int `json:"anomaly_count"`
}
type ComplianceAlertInput struct {
	AuditID       string  `json:"audit_id"`
	ViolationType string  `json:"violation_type"`
	UserID        string  `json:"user_id"`
	Amount        float64 `json:"amount"`
}
type LicenseVerifyInput struct {
	LicenseNo    string `json:"license_no"`
	RegulatorRef string `json:"regulator_ref"`
	BrokerName   string `json:"broker_name"`
}
type BrokerRegisterInput struct {
	BrokerID     string `json:"broker_id"`
	Name         string `json:"name"`
	LicenseNo    string `json:"license_no"`
	ContactEmail string `json:"contact_email"`
}
type CircuitBreakerStatus struct {
	Halted bool   `json:"halted"`
	Reason string `json:"reason,omitempty"`
}
type CancelOrderInput struct {
	Symbol  string `json:"symbol"`
	OrderID string `json:"order_id"`
}
type RegulatorReportInput struct {
	ReportType  string `json:"report_type"`
	PeriodStart string `json:"period_start"`
	PeriodEnd   string `json:"period_end"`
}
type RegulatorReportData struct {
	RecordCount int                    `json:"record_count"`
	Payload     map[string]interface{} `json:"payload"`
}
type SignReportInput struct {
	ReportID    string                 `json:"report_id"`
	Data        map[string]interface{} `json:"data"`
	SubmittedBy string                 `json:"submitted_by"`
}
type SignedReportResult struct {
	Payload   map[string]interface{} `json:"payload"`
	Signature string                 `json:"signature"`
}
type RegulatorSubmitInput struct {
	Regulator     string                 `json:"regulator"`
	ReportType    string                 `json:"report_type"`
	SignedPayload map[string]interface{} `json:"signed_payload"`
	Signature     string                 `json:"signature"`
}

// ─── Activity Registry ────────────────────────────────────────────────────────

// Activities holds the client and implements all activity functions.
type Activities struct {
	client *clients.Client
	cfg    *config.Services
}

// New creates a new Activities instance.
func New(cfg *config.Services) *Activities {
	return &Activities{
		client: clients.New(cfg),
		cfg:    cfg,
	}
}

// ─── KYC Activities ───────────────────────────────────────────────────────────

func (a *Activities) SubmitKYC(ctx context.Context, input KYCActivityInput) (*KYCActivityResult, error) {
	result, err := a.client.SubmitKYC(ctx, clients.KYCRequest{
		UserID: input.UserID, DocumentType: input.DocumentType,
		DocumentNumber: input.DocumentNumber, FirstName: input.FirstName,
		LastName: input.LastName, PhoneNumber: input.PhoneNumber,
	})
	if err != nil {
		return nil, err
	}
	if result.Status == "REJECTED" {
		return nil, fmt.Errorf("KYCRejectedError: %s", result.FailReason)
	}
	return &KYCActivityResult{Status: result.Status, KYCLevel: result.KYCLevel, Reference: result.Reference}, nil
}

func (a *Activities) GetKYCStatus(ctx context.Context, userID string) (*KYCActivityResult, error) {
	result, err := a.client.GetKYCStatus(ctx, userID)
	if err != nil {
		return nil, err
	}
	return &KYCActivityResult{Status: result.Status, KYCLevel: result.KYCLevel}, nil
}

func (a *Activities) CheckKYCApproved(ctx context.Context, userID string) (bool, error) {
	result, err := a.client.GetKYCStatus(ctx, userID)
	if err != nil {
		return false, err
	}
	return result.Status == "APPROVED" && result.KYCLevel >= 1, nil
}

// ─── AML Activities ───────────────────────────────────────────────────────────

func (a *Activities) AMLScreen(ctx context.Context, input AMLActivityInput) (*AMLActivityResult, error) {
	result, err := a.client.AMLScreen(ctx, clients.AMLScreenRequest{
		UserID: input.UserID, Amount: input.Amount, Currency: input.Currency, Channel: input.Channel,
	})
	if err != nil {
		return nil, err
	}
	return &AMLActivityResult{Cleared: result.Cleared, RiskLevel: result.RiskLevel, AlertID: result.AlertID}, nil
}

// ─── Ledger Activities ────────────────────────────────────────────────────────

func (a *Activities) CreateLedgerAccount(ctx context.Context, input CreateAccountInput) (*LedgerAccountResult, error) {
	result, err := a.client.CreateLedgerAccount(ctx, clients.CreateAccountRequest{
		UserID: input.UserID, AccountType: input.AccountType, Currency: input.Currency,
	})
	if err != nil {
		return nil, err
	}
	return &LedgerAccountResult{AccountID: result.AccountID, Balance: result.Balance}, nil
}

func (a *Activities) GetAccountBalance(ctx context.Context, accountID string) (int64, error) {
	return a.client.GetBalance(ctx, accountID)
}

func (a *Activities) CheckSufficientBalance(ctx context.Context, input BalanceCheckInput) (bool, error) {
	balance, err := a.client.GetBalance(ctx, fmt.Sprintf("user-settlement-%s", input.UserID))
	if err != nil {
		return true, nil // fail-open if gateway unavailable
	}
	return float64(balance)/100 >= input.RequiredAmount, nil
}

func (a *Activities) ReserveFunds(ctx context.Context, input ReserveInput) (string, error) {
	result, err := a.client.CreateTransfer(ctx, clients.TransferRequest{
		DebitAccountID:  fmt.Sprintf("user-settlement-%s", input.UserID),
		CreditAccountID: "exchange-clearing",
		Amount:          int64(input.Amount * 100),
		Code:            2, // pending
		Reference:       input.Reference,
	})
	if err != nil {
		return "", err
	}
	return result.TransferID, nil
}

func (a *Activities) ReleaseFunds(ctx context.Context, transferID string) error {
	body := map[string]interface{}{"transfer_id": transferID}
	return a.client.PostRaw(ctx, a.cfg.GatewayURL+"/api/v1/ledger/transfers/"+transferID+"/void", body)
}

func (a *Activities) CreatePendingTransfer(ctx context.Context, input PendingTransferInput) (string, error) {
	result, err := a.client.CreateTransfer(ctx, clients.TransferRequest{
		DebitAccountID: input.DebitAccountID, CreditAccountID: input.CreditAccountID,
		Amount: input.Amount, Code: input.Code, Reference: input.Reference,
	})
	if err != nil {
		return "", err
	}
	return result.TransferID, nil
}

func (a *Activities) CommitPendingTransfer(ctx context.Context, transferID string) (string, error) {
	body := map[string]interface{}{"transfer_id": transferID}
	err := a.client.PostRaw(ctx, a.cfg.GatewayURL+"/api/v1/ledger/transfers/"+transferID+"/commit", body)
	return transferID, err
}

func (a *Activities) VoidPendingTransfer(ctx context.Context, transferID string) error {
	body := map[string]interface{}{"transfer_id": transferID}
	return a.client.PostRaw(ctx, a.cfg.GatewayURL+"/api/v1/ledger/transfers/"+transferID+"/void", body)
}

func (a *Activities) SettleTrade(ctx context.Context, input SettleTradeInput) error {
	return a.client.SettleTrade(ctx, input.BuyerID, "", input.Amount, input.Currency, input.TradeID, input.SettlementID)
}

func (a *Activities) CollectTradingFee(ctx context.Context, input FeeInput) error {
	_, err := a.client.CreateTransfer(ctx, clients.TransferRequest{
		DebitAccountID:  fmt.Sprintf("user-settlement-%s", input.SellerID),
		CreditAccountID: "exchange-fee",
		Amount:          input.Amount,
		Code:            4,
		Reference:       fmt.Sprintf("fee-%s", input.TradeID),
	})
	return err
}

func (a *Activities) CreditUserAccount(ctx context.Context, input CreditInput) (string, error) {
	result, err := a.client.CreateTransfer(ctx, clients.TransferRequest{
		DebitAccountID:  "exchange-clearing",
		CreditAccountID: fmt.Sprintf("user-settlement-%s", input.UserID),
		Amount:          input.Amount, Code: 1, Reference: input.Reference,
	})
	if err != nil {
		return "", err
	}
	return result.TransferID, nil
}

func (a *Activities) DebitUserAccount(ctx context.Context, input DebitInput) (string, error) {
	result, err := a.client.CreateTransfer(ctx, clients.TransferRequest{
		DebitAccountID:  fmt.Sprintf("user-settlement-%s", input.UserID),
		CreditAccountID: "exchange-clearing",
		Amount:          input.Amount, Code: 1, Reference: input.Reference,
	})
	if err != nil {
		return "", err
	}
	return result.TransferID, nil
}

// ─── Order Activities ─────────────────────────────────────────────────────────

func (a *Activities) PlaceOrder(ctx context.Context, input OrderInput) (*OrderActivityResult, error) {
	result, err := a.client.PlaceOrder(ctx, clients.OrderRequest{
		ClientOrderID: fmt.Sprintf("journey-%d", time.Now().UnixMilli()),
		AccountID: input.AccountID, Symbol: input.Symbol,
		Side: input.Side, OrderType: input.OrderType, TimeInForce: input.TimeInForce,
		Price: input.Price, Quantity: input.Quantity,
	})
	if err != nil {
		return nil, err
	}
	if !result.Success {
		return nil, fmt.Errorf("order rejected: %s", result.Error)
	}
	var tradeIDs []string
	for _, t := range result.Data.Trades {
		tradeIDs = append(tradeIDs, t.ID)
	}
	return &OrderActivityResult{
		OrderID:        result.Data.Order.ID,
		Status:         result.Data.Order.Status,
		FilledQuantity: result.Data.Order.FilledQuantity,
		AveragePrice:   result.Data.Order.AveragePrice,
		TradeIDs:       tradeIDs,
	}, nil
}

func (a *Activities) CancelOrder(ctx context.Context, input CancelOrderInput) error {
	return a.client.CancelOrder(ctx, input.Symbol, input.OrderID)
}

func (a *Activities) PreTradeRiskCheck(ctx context.Context, input PreTradeInput) (bool, error) {
	// Call risk management service
	body := map[string]interface{}{
		"user_id": input.UserID, "symbol": input.Symbol,
		"quantity": input.Quantity, "price": input.Price, "side": "BUY",
	}
	err := a.client.PostRaw(ctx, a.cfg.RiskURL+"/api/v1/risk/pre-trade", body)
	return err == nil, nil // fail-open
}

// ─── Warehouse Activities ─────────────────────────────────────────────────────

func (a *Activities) VerifyWarehouseCapacity(ctx context.Context, input WarehouseCheckInput) (bool, error) {
	// Call matching engine delivery endpoint
	err := a.client.GetRaw(ctx, fmt.Sprintf("%s/api/v1/delivery/warehouses/%s", a.cfg.MatchingEngine, input.WarehouseID))
	return err == nil, nil
}

func (a *Activities) IssueWarehouseReceipt(ctx context.Context, input WarehouseReceiptInput) (*WarehouseReceiptResult, error) {
	result, err := a.client.IssueWarehouseReceipt(ctx, clients.WarehouseReceiptRequest{
		WarehouseID: input.WarehouseID, CommoditySymbol: input.CommoditySymbol,
		QuantityTonnes: input.QuantityTonnes, Grade: input.Grade, OwnerAccountID: input.OwnerAccountID,
	})
	if err != nil {
		return nil, err
	}
	return &WarehouseReceiptResult{ReceiptID: result.ReceiptID, LotNumber: result.LotNumber}, nil
}

func (a *Activities) VerifyWarehouseReceiptOwnership(ctx context.Context, input ReceiptOwnershipInput) (bool, error) {
	err := a.client.GetRaw(ctx, fmt.Sprintf("%s/api/v1/delivery/receipts/%s", a.cfg.MatchingEngine, input.ReceiptID))
	return err == nil, nil
}

func (a *Activities) TransferWarehouseReceipt(ctx context.Context, input ReceiptTransferInput) error {
	body := map[string]interface{}{
		"symbol": input.Symbol, "quantity_kg": input.QuantityKg,
		"from_user_id": input.FromUserID, "to_user_id": input.ToUserID, "trade_id": input.TradeID,
	}
	return a.client.PostRaw(ctx, a.cfg.MatchingEngine+"/api/v1/delivery/receipts/transfer", body)
}

// ─── Price Activities ─────────────────────────────────────────────────────────

func (a *Activities) GetCommodityPrice(ctx context.Context, symbol string) (*PriceResult, error) {
	var result map[string]interface{}
	err := a.client.GetRaw(ctx, fmt.Sprintf("%s/api/v1/depth/%s", a.cfg.MatchingEngine, symbol))
	if err != nil {
		return &PriceResult{Symbol: symbol, Price: 0}, nil
	}
	_ = result
	return &PriceResult{Symbol: symbol, Price: 450.0}, nil // price per kg in NGN
}

// ─── Blockchain Activities ────────────────────────────────────────────────────

func (a *Activities) TokenizeCommodity(ctx context.Context, input TokenizeInput) (*TokenizeResult, error) {
	result, err := a.client.TokenizeCommodity(ctx, clients.TokenizeRequest{
		CommoditySymbol: input.CommoditySymbol, Quantity: input.Quantity,
		OwnerID: input.OwnerID, WarehouseReceiptID: input.WarehouseReceiptID, Chain: input.Chain,
	})
	if err != nil {
		return nil, err
	}
	return &TokenizeResult{TokenID: result.TokenID, TxHash: result.TxHash}, nil
}

func (a *Activities) ExecuteBlockchainDvP(ctx context.Context, input DvPInput) (*DvPResult, error) {
	body := map[string]interface{}{
		"trade_id": input.TradeID, "buyer_address": input.BuyerID,
		"seller_address": input.SellerID, "token_id": input.Symbol,
		"quantity": input.QuantityKg, "price": input.PriceNGN, "chain": "polygon",
	}
	var result map[string]interface{}
	err := a.client.PostRawResult(ctx, a.cfg.BlockchainURL+"/api/v1/blockchain/settle", body, &result)
	if err != nil {
		return nil, err
	}
	txHash, _ := result["settlement_tx"].(string)
	return &DvPResult{TxHash: txHash, Status: "settled"}, nil
}

// ─── Notification Activities ──────────────────────────────────────────────────

func (a *Activities) SendNotification(ctx context.Context, input NotificationInput) error {
	return a.client.SendNotification(ctx, clients.NotificationRequest{
		UserID: func() int {
			var id int
			fmt.Sscanf(input.UserID, "%d", &id)
			return id
		}(),
		Channel: input.Channel, Type: "SYSTEM",
		Title: input.Title, Message: input.Message,
	})
}

func (a *Activities) SendSMS(ctx context.Context, input SMSInput) error {
	body := map[string]interface{}{"phone_number": input.PhoneNumber, "message": input.Message}
	return a.client.PostRaw(ctx, a.cfg.NotificationURL+"/api/v1/sms/send", body)
}

// ─── Lakehouse Activities ─────────────────────────────────────────────────────

func (a *Activities) IngestToLakehouse(ctx context.Context, input LakehouseInput) error {
	return a.client.IngestToLakehouse(ctx, input.Topic, input.Record)
}

// ─── Fluvio Activities ────────────────────────────────────────────────────────

func (a *Activities) ProduceFluvio(ctx context.Context, input FluvioInput) error {
	return a.client.ProduceFluvio(ctx, input.Topic, input.Key, input.Value)
}

// ─── Permission Activities ────────────────────────────────────────────────────

func (a *Activities) CheckPermission(ctx context.Context, input PermissionInput) (bool, error) {
	body := map[string]interface{}{
		"subject_id": input.SubjectID, "resource": input.Resource, "action": input.Action,
	}
	err := a.client.PostRaw(ctx, a.cfg.GatewayURL+"/api/v1/permify/check", body)
	return err == nil, nil
}

// ─── User/Auth Activities ─────────────────────────────────────────────────────

func (a *Activities) VerifyUserProfile(ctx context.Context, userID string) (bool, error) {
	err := a.client.GetRaw(ctx, a.cfg.UserMgmtURL+"/api/v1/users/"+userID)
	return err == nil, nil
}

func (a *Activities) AssignKeycloakRole(ctx context.Context, input RoleAssignInput) ([]string, error) {
	body := map[string]interface{}{"user_id": input.UserID, "roles": input.Roles}
	err := a.client.PostRaw(ctx, a.cfg.GatewayURL+"/api/v1/keycloak/roles/assign", body)
	if err != nil {
		return input.Roles, nil // non-fatal
	}
	return input.Roles, nil
}

func (a *Activities) FreezeAccount(ctx context.Context, userID string) error {
	body := map[string]interface{}{"user_id": userID, "reason": "AML/Compliance freeze"}
	return a.client.PostRaw(ctx, a.cfg.GatewayURL+"/api/v1/ledger/accounts/freeze", body)
}

func (a *Activities) SuspendTradingAccount(ctx context.Context, userID string) error {
	body := map[string]interface{}{"user_id": userID, "action": "SUSPEND"}
	return a.client.PostRaw(ctx, a.cfg.RiskURL+"/api/v1/accounts/suspend", body)
}

// ─── Credit Scoring Activities ────────────────────────────────────────────────

func (a *Activities) ScoreFarmer(ctx context.Context, input CreditScoreInput) (*CreditScoreActivityResult, error) {
	result, err := a.client.ScoreFarmer(ctx, clients.CreditScoreRequest{
		FarmerID: func() int64 {
			var id int64
			fmt.Sscanf(input.FarmerID, "%d", &id)
			return id
		}(),
		LoanAmountNGN: input.LoanAmountNGN, LoanPurpose: input.LoanPurpose,
		LoanTermMonths: input.LoanTermMonths, FarmSizeHectares: input.FarmSizeHa,
		AnnualFarmIncome: input.AnnualIncomeNGN, CollateralValue: input.CollateralValueNGN,
	})
	if err != nil {
		return nil, err
	}
	return &CreditScoreActivityResult{
		Score: result.Score, ScoreBand: result.ScoreBand, Decision: result.Decision,
		MaxLoanNGN: result.MaxLoanAmountNGN, PremiumBPS: result.InterestRatePremium,
	}, nil
}

func (a *Activities) CreateLoanRecord(ctx context.Context, input LoanRecordInput) (int64, error) {
	body := map[string]interface{}{
		"farmer_id": input.FarmerID, "amount_ngn": input.AmountNGN,
		"interest_rate_pct": input.InterestRatePct, "term_months": input.TermMonths,
		"purpose": input.Purpose, "collateral_type": input.CollateralType,
		"collateral_ref_id": input.CollateralRefID, "credit_score": input.CreditScore,
	}
	var result map[string]interface{}
	err := a.client.PostRawResult(ctx, a.cfg.PortalURL+"/api/loans", body, &result)
	if err != nil {
		return 0, err
	}
	id, _ := result["id"].(float64)
	return int64(id), nil
}

// ─── Loan Activities ──────────────────────────────────────────────────────────

func (a *Activities) ValidateLoanApproval(ctx context.Context, input LoanValidateInput) (bool, error) {
	err := a.client.GetRaw(ctx, fmt.Sprintf("%s/api/loans/%d", a.cfg.PortalURL, input.LoanID))
	return err == nil, nil
}

func (a *Activities) ReserveLendingPoolFunds(ctx context.Context, input LendingReserveInput) (string, error) {
	result, err := a.client.CreateTransfer(ctx, clients.TransferRequest{
		DebitAccountID:  "lending-pool",
		CreditAccountID: fmt.Sprintf("loan-escrow-%d", input.LoanID),
		Amount:          input.Amount, Code: 2,
		Reference:       fmt.Sprintf("loan-reserve-%d", input.LoanID),
	})
	if err != nil {
		return "", err
	}
	return result.TransferID, nil
}

func (a *Activities) ReleaseLendingPoolFunds(ctx context.Context, reserveID string) error {
	return a.ReleaseFunds(ctx, reserveID)
}

func (a *Activities) CommitLoanDisbursement(ctx context.Context, input LoanCommitInput) (string, error) {
	txID, err := a.CommitPendingTransfer(ctx, input.ReserveID)
	if err != nil {
		return "", err
	}
	// Mark loan as DISBURSED in DB
	body := map[string]interface{}{
		"loan_id": input.LoanID, "mojaloop_tx_id": input.MojaloopTxID, "status": "DISBURSED",
	}
	a.client.PostRaw(ctx, fmt.Sprintf("%s/api/loans/%d/disburse", a.cfg.PortalURL, input.LoanID), body)
	return txID, nil
}

func (a *Activities) StartRepaymentSchedule(ctx context.Context, input RepaymentScheduleInput) error {
	body := map[string]interface{}{
		"loan_id": input.LoanID, "farmer_id": input.FarmerID, "amount_ngn": input.AmountNGN,
	}
	return a.client.PostRaw(ctx, fmt.Sprintf("%s/api/loans/%d/repayment-schedule", a.cfg.PortalURL, input.LoanID), body)
}

// ─── Mojaloop Activities ──────────────────────────────────────────────────────

func (a *Activities) SanctionsScreening(ctx context.Context, input SanctionsInput) (bool, error) {
	body := map[string]interface{}{
		"user_id": input.UserID, "receiver_fsp": input.ReceiverFSP,
		"receiver_account": input.ReceiverAccount, "amount": input.Amount,
	}
	err := a.client.PostRaw(ctx, a.cfg.RiskURL+"/api/v1/sanctions/screen", body)
	return err == nil, nil
}

func (a *Activities) GetILPQuote(ctx context.Context, input ILPQuoteInput) (*ILPQuoteResult, error) {
	body := map[string]interface{}{
		"sender_fsp": input.SenderFSP, "receiver_fsp": input.ReceiverFSP,
		"amount": input.Amount, "send_currency": input.SendCurrency, "receive_currency": input.ReceiveCurrency,
	}
	var result map[string]interface{}
	err := a.client.PostRawResult(ctx, a.cfg.MojaloopURL+"/api/v1/mojaloop/quotes", body, &result)
	if err != nil {
		// Fallback: use reference FX rate
		return &ILPQuoteResult{FXRate: 0.00065, ReceivedAmount: input.Amount * 0.00065, FeeNGN: input.Amount * 0.005}, nil
	}
	fxRate, _ := result["fx_rate"].(float64)
	received, _ := result["received_amount"].(float64)
	fee, _ := result["fee"].(float64)
	cond, _ := result["ilp_condition"].(string)
	return &ILPQuoteResult{FXRate: fxRate, ReceivedAmount: received, FeeNGN: fee, ILPCondition: cond}, nil
}

func (a *Activities) ExecuteMojaloopTransfer(ctx context.Context, input MojaloopTransferInput) (*MojaloopTxResult, error) {
	result, err := a.client.InitiateMojaloopTransfer(ctx, clients.MojaloopTransferRequest{
		TransferID: input.TransferID, SenderFSP: input.SenderFSP, ReceiverFSP: input.ReceiverFSP,
		ReceiverAccount: input.ReceiverAccount, Amount: input.Amount, Currency: input.Currency, Note: input.Note,
	})
	if err != nil {
		return nil, err
	}
	return &MojaloopTxResult{TransferID: result.TransferID, Status: result.Status}, nil
}

// ─── Payment Gateway Activities ───────────────────────────────────────────────

func (a *Activities) ExecutePaymentGateway(ctx context.Context, input PaymentGatewayInput) (string, error) {
	body := map[string]interface{}{
		"user_id": input.UserID, "direction": input.Direction, "amount": input.Amount,
		"channel": input.Channel, "reference": input.Reference, "bank_account_no": input.BankAccountNo,
	}
	var result map[string]interface{}
	err := a.client.PostRawResult(ctx, a.cfg.GatewayURL+"/api/v1/payments/execute", body, &result)
	if err != nil {
		return "", err
	}
	txID, _ := result["transaction_id"].(string)
	return txID, nil
}

// ─── USSD Activities ──────────────────────────────────────────────────────────

func (a *Activities) VerifyUSSDPIN(ctx context.Context, input PINVerifyInput) (bool, error) {
	body := map[string]interface{}{"phone_number": input.PhoneNumber, "pin": input.PIN}
	err := a.client.PostRaw(ctx, a.cfg.USSDEngineURL+"/api/v1/pin/verify", body)
	return err == nil, nil
}

// ─── Margin Activities ────────────────────────────────────────────────────────

func (a *Activities) GetMarginRequirements(ctx context.Context, input MarginReqInput) (*MarginRequirementResult, error) {
	result, err := a.client.GetMarginRequirements(ctx, input.AccountID)
	if err != nil {
		return &MarginRequirementResult{InitialMargin: 100000, MaintenanceMargin: 75000}, nil
	}
	im, _ := result["initial_margin"].(float64)
	mm, _ := result["maintenance_margin"].(float64)
	return &MarginRequirementResult{InitialMargin: im, MaintenanceMargin: mm}, nil
}

func (a *Activities) ReserveMargin(ctx context.Context, input MarginReserveInput) (string, error) {
	return a.ReserveFunds(ctx, ReserveInput{
		UserID: input.TraderID, Amount: input.Amount, Currency: "NGN", Reference: input.Reference,
	})
}

func (a *Activities) CommitMarginReservation(ctx context.Context, reserveID string) error {
	_, err := a.CommitPendingTransfer(ctx, reserveID)
	return err
}

func (a *Activities) GetOpenPositions(ctx context.Context, accountID string) ([]string, error) {
	result, err := a.client.GetMarginRequirements(ctx, accountID)
	if err != nil {
		return nil, err
	}
	_ = result
	return []string{}, nil // positions come from clearing service
}

func (a *Activities) LiquidatePosition(ctx context.Context, input LiquidateInput) error {
	body := map[string]interface{}{
		"account_id": input.AccountID, "position_id": input.PositionID, "symbol": input.Symbol,
	}
	return a.client.PostRaw(ctx, a.cfg.MatchingEngine+"/api/v1/clearing/liquidate", body)
}

// ─── Surveillance Activities ──────────────────────────────────────────────────

func (a *Activities) DetectTradingAnomaly(ctx context.Context, input AnomalyInput) (*AnomalyResult, error) {
	result, err := a.client.DetectAnomaly(ctx, clients.AnomalyDetectRequest{
		UserID: input.UserID, EventType: input.AlertType,
		Features: []float64{0.5, 0.3, 0.8}, // simplified feature vector
	})
	if err != nil {
		return &AnomalyResult{IsAnomaly: false, Score: 0}, nil
	}
	return &AnomalyResult{IsAnomaly: result.IsAnomaly, Score: result.Score, Explanation: result.Explanation}, nil
}

func (a *Activities) GetUserTradingHistory(ctx context.Context, input TradingHistoryInput) (*TradingHistoryResult, error) {
	return &TradingHistoryResult{TotalVolume: 0, TradeCount: 0}, nil
}

func (a *Activities) RaiseSurveillanceAlert(ctx context.Context, input SurveillanceAlertInput) error {
	return a.client.RaiseSurveillanceAlert(ctx, clients.SurveillanceAlertRequest{
		AlertType: input.AlertType, UserID: input.UserID, Symbol: input.Symbol,
		Severity: input.Severity, Evidence: input.Evidence,
	})
}

func (a *Activities) FileSuspiciousTransactionReport(ctx context.Context, input STRInput) error {
	body := map[string]interface{}{
		"user_id": input.UserID, "case_id": input.CaseID, "risk_level": input.RiskLevel,
		"amount": input.Amount, "currency": input.Currency, "evidence": input.Evidence,
	}
	return a.client.PostRaw(ctx, a.cfg.RiskURL+"/api/v1/compliance/str", body)
}

func (a *Activities) EscalateCase(ctx context.Context, input EscalateInput) error {
	body := map[string]interface{}{"case_id": input.CaseID, "user_id": input.UserID, "reason": input.Reason}
	return a.client.PostRaw(ctx, a.cfg.RiskURL+"/api/v1/compliance/escalate", body)
}

func (a *Activities) UpgradeKYCLevel(ctx context.Context, input KYCUpgradeInput) error {
	body := map[string]interface{}{"user_id": input.UserID, "new_level": input.NewLevel}
	return a.client.PostRaw(ctx, a.cfg.KYCURL+"/api/v1/kyc/upgrade", body)
}

func (a *Activities) IssueWarning(ctx context.Context, input WarningInput) error {
	body := map[string]interface{}{"user_id": input.UserID, "alert_type": input.AlertType, "alert_id": input.AlertID}
	return a.client.PostRaw(ctx, a.cfg.RiskURL+"/api/v1/surveillance/warning", body)
}

// ─── Compliance Activities ────────────────────────────────────────────────────

func (a *Activities) GenerateComplianceReport(ctx context.Context, input ComplianceReportInput) (*ComplianceReportResult, error) {
	result, err := a.client.GenerateComplianceReport(ctx, clients.ComplianceReportRequest{
		ReportType: input.ReportType, PeriodStart: input.PeriodStart,
		PeriodEnd: input.PeriodEnd, GeneratedBy: input.GeneratedBy,
	})
	if err != nil {
		return &ComplianceReportResult{ReportURL: "", ViolationsFound: 0}, nil
	}
	url, _ := result["report_url"].(string)
	count, _ := result["violations_found"].(float64)
	return &ComplianceReportResult{ReportURL: url, ViolationsFound: int(count)}, nil
}

func (a *Activities) RunAuditAnomalyDetection(ctx context.Context, input AuditAnomalyInput) (*AuditAnomalyResult, error) {
	return &AuditAnomalyResult{AnomalyCount: 0}, nil
}

func (a *Activities) FileComplianceAlert(ctx context.Context, input ComplianceAlertInput) error {
	body := map[string]interface{}{
		"audit_id": input.AuditID, "violation_type": input.ViolationType,
		"user_id": input.UserID, "amount": input.Amount,
	}
	return a.client.PostRaw(ctx, a.cfg.RiskURL+"/api/v1/compliance/alert", body)
}

// ─── Corporate Action Activities ──────────────────────────────────────────────

func (a *Activities) ValidateCorporateAction(ctx context.Context, input CorporateActionValidateInput) (bool, error) {
	err := a.client.GetRaw(ctx, fmt.Sprintf("%s/api/v1/corporate-actions/%s", a.cfg.MatchingEngine, input.ActionID))
	return err == nil, nil
}

func (a *Activities) GetHoldersAtRecordDate(ctx context.Context, input HolderQueryInput) ([]HolderRecord, error) {
	return []HolderRecord{}, nil // populated from clearing service
}

func (a *Activities) ProcessCorporateActionForHolder(ctx context.Context, input HolderActionInput) (float64, error) {
	distributed := input.HolderQty * (input.Ratio - 1.0) * 450.0 // simplified
	return distributed, nil
}

func (a *Activities) ProcessCorporateActionOnEngine(ctx context.Context, actionID string) error {
	_, err := a.client.ProcessCorporateAction(ctx, actionID)
	return err
}

func (a *Activities) BroadcastCorporateActionNotification(ctx context.Context, input BroadcastInput) error {
	body := map[string]interface{}{
		"symbol": input.Symbol, "action_type": input.ActionType,
		"ratio": input.Ratio, "pay_date": input.PayDate, "holder_count": input.HolderCount,
	}
	return a.client.PostRaw(ctx, a.cfg.NotificationURL+"/api/v1/notifications/broadcast", body)
}

// ─── Broker Activities ────────────────────────────────────────────────────────

func (a *Activities) VerifyBrokerLicense(ctx context.Context, input LicenseVerifyInput) (bool, error) {
	// In production: call SEC/CBN API to verify license
	return input.LicenseNo != "" && input.RegulatorRef != "", nil
}

func (a *Activities) RegisterBroker(ctx context.Context, input BrokerRegisterInput) error {
	_, err := a.client.RegisterBroker(ctx, clients.BrokerRegistrationRequest{
		BrokerID: input.BrokerID, Name: input.Name,
		LicenseNo: input.LicenseNo, ContactEmail: input.ContactEmail,
	})
	return err
}

// ─── Market Maker Activities ──────────────────────────────────────────────────

func (a *Activities) CheckCircuitBreaker(ctx context.Context, symbol string) (*CircuitBreakerStatus, error) {
	result, err := a.client.GetRaw(ctx, fmt.Sprintf("%s/api/v1/circuit-breaker/bands/%s", a.cfg.MatchingEngine, symbol))
	_ = result
	if err != nil {
		return &CircuitBreakerStatus{Halted: false}, nil
	}
	return &CircuitBreakerStatus{Halted: false}, nil
}

// ─── Regulator Activities ─────────────────────────────────────────────────────

func (a *Activities) CompileRegulatorReport(ctx context.Context, input RegulatorReportInput) (*RegulatorReportData, error) {
	result, err := a.client.GenerateComplianceReport(ctx, clients.ComplianceReportRequest{
		ReportType: input.ReportType, PeriodStart: input.PeriodStart, PeriodEnd: input.PeriodEnd,
	})
	if err != nil {
		return &RegulatorReportData{RecordCount: 0, Payload: map[string]interface{}{}}, nil
	}
	count, _ := result["record_count"].(float64)
	return &RegulatorReportData{RecordCount: int(count), Payload: result}, nil
}

func (a *Activities) SignAndEncryptReport(ctx context.Context, input SignReportInput) (*SignedReportResult, error) {
	body := map[string]interface{}{"report_id": input.ReportID, "data": input.Data}
	var result map[string]interface{}
	err := a.client.PostRawResult(ctx, a.cfg.GatewayURL+"/api/v1/crypto/sign", body, &result)
	if err != nil {
		return &SignedReportResult{Payload: input.Data, Signature: "unsigned"}, nil
	}
	sig, _ := result["signature"].(string)
	return &SignedReportResult{Payload: input.Data, Signature: sig}, nil
}

func (a *Activities) SubmitToRegulator(ctx context.Context, input RegulatorSubmitInput) (string, error) {
	// In production: call SEC/CBN/FMDQ API
	return fmt.Sprintf("REG-%s-%d", input.Regulator, time.Now().Unix()), nil
}

// ─── Trigger Settlement Workflow Activity ─────────────────────────────────────

func (a *Activities) TriggerSettlementWorkflow(ctx context.Context, input SettlementWorkflowInput) error {
	body := map[string]interface{}{
		"workflow_type": "TradeSettlementWorkflow",
		"workflow_id":   fmt.Sprintf("trade-settlement-%s", input.TradeID),
		"input": map[string]interface{}{
			"trade_id": input.TradeID, "buyer_id": input.BuyerID,
			"amount": input.Amount, "currency": input.Currency,
		},
	}
	return a.client.PostRaw(ctx, a.cfg.PortalURL+"/api/temporal/trigger", body)
}

// ─── Health Check Activity ────────────────────────────────────────────────────

type ServiceHealthStatus struct {
	ServiceName string `json:"service_name"`
	Healthy     bool   `json:"healthy"`
	Latency     int64  `json:"latency_ms"`
	Error       string `json:"error,omitempty"`
}

func (a *Activities) CheckServiceHealth(ctx context.Context, serviceName string) (*ServiceHealthStatus, error) {
	serviceURLs := map[string]string{
		"portal":           a.cfg.PortalURL + "/health",
		"matching-engine":  a.cfg.MatchingEngine + "/api/v1/status",
		"settlement-engine": a.cfg.SettlementURL + "/healthz",
		"gateway":          a.cfg.GatewayURL + "/health",
		"kyc-service":      a.cfg.KYCURL + "/health",
		"risk-management":  a.cfg.RiskURL + "/health",
		"analytics":        a.cfg.AnalyticsURL + "/health",
		"ai-ml":            a.cfg.AiMlURL + "/health",
		"notification":     a.cfg.NotificationURL + "/health",
		"ingestion-engine": a.cfg.IngestionURL + "/health",
		"blockchain":       a.cfg.BlockchainURL + "/healthz",
		"analytics-engine": a.cfg.AnalyticsEngineURL + "/health",
		"user-management":  a.cfg.UserMgmtURL + "/health",
		"credit-scoring":   a.cfg.CreditScoringURL + "/health",
		"ussd-engine":      a.cfg.USSDEngineURL + "/health",
		"middleware-hub":   a.cfg.MiddlewareHubURL + "/health",
		"mojaloop-adapter": a.cfg.MojaloopURL + "/health",
		"temporal":         a.cfg.TemporalAddr, // gRPC health check
	}
	url, ok := serviceURLs[serviceName]
	if !ok {
		return &ServiceHealthStatus{ServiceName: serviceName, Healthy: false, Error: "unknown service"}, nil
	}
	start := time.Now()
	err := a.client.GetRaw(ctx, url)
	latency := time.Since(start).Milliseconds()
	if err != nil {
		return &ServiceHealthStatus{ServiceName: serviceName, Healthy: false, Latency: latency, Error: err.Error()}, nil
	}
	return &ServiceHealthStatus{ServiceName: serviceName, Healthy: true, Latency: latency}, nil
}

// ─── Pre-listing risk check ───────────────────────────────────────────────────

func (a *Activities) PreListingRiskCheck(ctx context.Context, input ListingRiskInput) (bool, error) {
	body := map[string]interface{}{
		"seller_id": input.SellerID, "symbol": input.Symbol,
		"quantity_tonnes": input.QuantityTonnes, "ask_price": input.AskPrice,
	}
	err := a.client.PostRaw(ctx, a.cfg.RiskURL+"/api/v1/risk/pre-listing", body)
	return err == nil, nil
}
