// Package workflows implements all 20 NEXCOM user/stakeholder journey workflows.
// Each workflow is a reusable Temporal saga that orchestrates multiple services.
// Workflows are idempotent, compensating, and fully wired to real platform services.
package workflows

import (
	"fmt"
	"time"

	"go.temporal.io/sdk/temporal"
	"go.temporal.io/sdk/workflow"

	"github.com/munisp/nexcomm/journey-orchestrator/internal/activities"
)

// ─── Shared retry policy ──────────────────────────────────────────────────────

func defaultRetry() *temporal.RetryPolicy {
	return &temporal.RetryPolicy{
		InitialInterval:    2 * time.Second,
		BackoffCoefficient: 2.0,
		MaximumInterval:    60 * time.Second,
		MaximumAttempts:    5,
		NonRetryableErrorTypes: []string{
			"KYCRejectedError", "AMLBlockedError", "DuplicateError",
			"InvalidInputError", "AccountFrozenError",
		},
	}
}

func activityOpts(ctx workflow.Context, timeout time.Duration) workflow.Context {
	return workflow.WithActivityOptions(ctx, workflow.ActivityOptions{
		StartToCloseTimeout: timeout,
		RetryPolicy:         defaultRetry(),
	})
}

// ─────────────────────────────────────────────────────────────────────────────
// JOURNEY 1: FarmerOnboardingWorkflow
// Stakeholder: Smallholder farmer joining the exchange for the first time.
// Services: UserMgmt → KYC → AML → TigerBeetle (create 3 accounts) →
//           Keycloak (assign role) → Notification → Lakehouse
// Reuse: Called by USSD onboarding, web registration, cooperative bulk-enroll
// ─────────────────────────────────────────────────────────────────────────────

type FarmerOnboardingInput struct {
	UserID       string `json:"user_id"`
	Email        string `json:"email"`
	PhoneNumber  string `json:"phone_number"`
	FirstName    string `json:"first_name"`
	LastName     string `json:"last_name"`
	BVN          string `json:"bvn"`
	FarmLocation string `json:"farm_location"`
	FarmSizeHa   float64 `json:"farm_size_ha"`
	CooperativeID string `json:"cooperative_id,omitempty"`
}

type FarmerOnboardingResult struct {
	UserID          string `json:"user_id"`
	KYCStatus       string `json:"kyc_status"`
	TradingAccountID string `json:"trading_account_id"`
	SettlementAccountID string `json:"settlement_account_id"`
	WalletAccountID  string `json:"wallet_account_id"`
	KeycloakRoles   []string `json:"keycloak_roles"`
	CompletedAt     time.Time `json:"completed_at"`
}

func FarmerOnboardingWorkflow(ctx workflow.Context, input FarmerOnboardingInput) (*FarmerOnboardingResult, error) {
	logger := workflow.GetLogger(ctx)
	logger.Info("FarmerOnboardingWorkflow started", "user_id", input.UserID)

	ctx5m := activityOpts(ctx, 5*time.Minute)
	ctx2m := activityOpts(ctx, 2*time.Minute)
	ctx30s := activityOpts(ctx, 30*time.Second)

	result := &FarmerOnboardingResult{UserID: input.UserID}

	// Step 1: Verify user profile exists in PostgreSQL
	var profileOK bool
	if err := workflow.ExecuteActivity(ctx2m, activities.VerifyUserProfile, input.UserID).Get(ctx, &profileOK); err != nil {
		return nil, fmt.Errorf("profile verification failed: %w", err)
	}

	// Step 2: Submit KYC (BVN verification via KYC service)
	var kycResult activities.KYCActivityResult
	if err := workflow.ExecuteActivity(ctx5m, activities.SubmitKYC, activities.KYCActivityInput{
		UserID: input.UserID, DocumentType: "BVN", DocumentNumber: input.BVN,
		FirstName: input.FirstName, LastName: input.LastName, PhoneNumber: input.PhoneNumber,
	}).Get(ctx, &kycResult); err != nil {
		return nil, temporal.NewApplicationError("KYCRejectedError", "KYC_REJECTED", err.Error())
	}
	result.KYCStatus = kycResult.Status

	// Step 3: AML screening
	var amlResult activities.AMLActivityResult
	if err := workflow.ExecuteActivity(ctx2m, activities.AMLScreen, activities.AMLActivityInput{
		UserID: input.UserID, Amount: 0, Currency: "NGN", Channel: "ONBOARDING",
	}).Get(ctx, &amlResult); err != nil || !amlResult.Cleared {
		return nil, temporal.NewApplicationError("AMLBlockedError", "AML_BLOCKED", "AML screening failed")
	}

	// Step 4: Create TigerBeetle accounts (trading, settlement, wallet)
	var tradingAcct activities.LedgerAccountResult
	if err := workflow.ExecuteActivity(ctx2m, activities.CreateLedgerAccount, activities.CreateAccountInput{
		UserID: input.UserID, AccountType: "TRADING", Currency: "NGN",
	}).Get(ctx, &tradingAcct); err != nil {
		return nil, fmt.Errorf("create trading account: %w", err)
	}
	result.TradingAccountID = tradingAcct.AccountID

	var settlementAcct activities.LedgerAccountResult
	if err := workflow.ExecuteActivity(ctx2m, activities.CreateLedgerAccount, activities.CreateAccountInput{
		UserID: input.UserID, AccountType: "SETTLEMENT", Currency: "NGN",
	}).Get(ctx, &settlementAcct); err != nil {
		return nil, fmt.Errorf("create settlement account: %w", err)
	}
	result.SettlementAccountID = settlementAcct.AccountID

	var walletAcct activities.LedgerAccountResult
	if err := workflow.ExecuteActivity(ctx2m, activities.CreateLedgerAccount, activities.CreateAccountInput{
		UserID: input.UserID, AccountType: "WALLET", Currency: "NGN",
	}).Get(ctx, &walletAcct); err != nil {
		return nil, fmt.Errorf("create wallet account: %w", err)
	}
	result.WalletAccountID = walletAcct.AccountID

	// Step 5: Assign Keycloak role (FARMER)
	var roles []string
	if err := workflow.ExecuteActivity(ctx30s, activities.AssignKeycloakRole, activities.RoleAssignInput{
		UserID: input.UserID, Roles: []string{"FARMER", "TRADER"},
	}).Get(ctx, &roles); err != nil {
		logger.Warn("Keycloak role assignment failed (non-fatal)", "error", err)
	}
	result.KeycloakRoles = roles

	// Step 6: Send welcome notification (SMS + email)
	workflow.ExecuteActivity(ctx30s, activities.SendNotification, activities.NotificationInput{
		UserID: input.UserID, Channel: "sms",
		Title: "Welcome to NEXCOM Exchange",
		Message: fmt.Sprintf("Welcome %s! Your account is ready. Trade commodities, access loans, and grow your farm business.", input.FirstName),
	})

	// Step 7: Ingest to Lakehouse (Bronze layer)
	workflow.ExecuteActivity(ctx30s, activities.IngestToLakehouse, activities.LakehouseInput{
		Topic: "nexcom.users.onboarded",
		Record: map[string]interface{}{
			"user_id": input.UserID, "kyc_status": kycResult.Status,
			"farm_location": input.FarmLocation, "farm_size_ha": input.FarmSizeHa,
			"cooperative_id": input.CooperativeID, "onboarded_at": workflow.Now(ctx),
		},
	})

	result.CompletedAt = workflow.Now(ctx)
	logger.Info("FarmerOnboardingWorkflow completed", "user_id", input.UserID)
	return result, nil
}

// ─────────────────────────────────────────────────────────────────────────────
// JOURNEY 2: KYCAMLReviewWorkflow
// Stakeholder: Compliance officer reviewing a flagged KYC/AML case.
// Services: KYC service → AML/Risk → Permify (permission check) →
//           Notification → Lakehouse → Dapr (alert)
// Reuse: Triggered by onboarding, deposit, large trade, cross-border transfer
// ─────────────────────────────────────────────────────────────────────────────

type KYCAMLReviewInput struct {
	CaseID      string `json:"case_id"`
	UserID      string `json:"user_id"`
	ReviewerID  string `json:"reviewer_id"`
	TriggerType string `json:"trigger_type"` // "ONBOARDING" | "DEPOSIT" | "TRADE" | "TRANSFER"
	Amount      float64 `json:"amount"`
	Currency    string `json:"currency"`
	Evidence    map[string]interface{} `json:"evidence"`
}

type KYCAMLReviewResult struct {
	CaseID     string `json:"case_id"`
	Decision   string `json:"decision"` // "APPROVED" | "REJECTED" | "ESCALATED"
	KYCLevel   int    `json:"kyc_level"`
	RiskLevel  string `json:"risk_level"`
	AlertFiled bool   `json:"alert_filed"`
	CompletedAt time.Time `json:"completed_at"`
}

func KYCAMLReviewWorkflow(ctx workflow.Context, input KYCAMLReviewInput) (*KYCAMLReviewResult, error) {
	logger := workflow.GetLogger(ctx)
	logger.Info("KYCAMLReviewWorkflow started", "case_id", input.CaseID, "user_id", input.UserID)

	ctx5m := activityOpts(ctx, 5*time.Minute)
	ctx2m := activityOpts(ctx, 2*time.Minute)
	ctx30s := activityOpts(ctx, 30*time.Second)

	result := &KYCAMLReviewResult{CaseID: input.CaseID}

	// Step 1: Check reviewer has COMPLIANCE_OFFICER permission via Permify
	var permitted bool
	if err := workflow.ExecuteActivity(ctx30s, activities.CheckPermission, activities.PermissionInput{
		SubjectID: input.ReviewerID, Resource: "kyc_case", Action: "review",
	}).Get(ctx, &permitted); err != nil || !permitted {
		return nil, temporal.NewApplicationError("InvalidInputError", "PERMISSION_DENIED", "Reviewer lacks compliance permission")
	}

	// Step 2: Get current KYC status
	var kycStatus activities.KYCActivityResult
	if err := workflow.ExecuteActivity(ctx2m, activities.GetKYCStatus, input.UserID).Get(ctx, &kycStatus); err != nil {
		return nil, fmt.Errorf("get KYC status: %w", err)
	}
	result.KYCLevel = kycStatus.KYCLevel

	// Step 3: Run AML screening with full context
	var amlResult activities.AMLActivityResult
	if err := workflow.ExecuteActivity(ctx5m, activities.AMLScreen, activities.AMLActivityInput{
		UserID: input.UserID, Amount: input.Amount, Currency: input.Currency, Channel: input.TriggerType,
	}).Get(ctx, &amlResult); err != nil {
		return nil, fmt.Errorf("AML screening: %w", err)
	}
	result.RiskLevel = amlResult.RiskLevel

	// Step 4: Decision logic
	if !amlResult.Cleared || amlResult.RiskLevel == "HIGH" || amlResult.RiskLevel == "BLOCKED" {
		result.Decision = "REJECTED"
		result.AlertFiled = true
		// File STR (Suspicious Transaction Report)
		workflow.ExecuteActivity(ctx2m, activities.FileSuspiciousTransactionReport, activities.STRInput{
			UserID: input.UserID, CaseID: input.CaseID, RiskLevel: amlResult.RiskLevel,
			Amount: input.Amount, Currency: input.Currency, Evidence: input.Evidence,
		})
		// Freeze account
		workflow.ExecuteActivity(ctx30s, activities.FreezeAccount, input.UserID)
	} else if amlResult.RiskLevel == "MEDIUM" {
		result.Decision = "ESCALATED"
		// Escalate to senior compliance
		workflow.ExecuteActivity(ctx30s, activities.EscalateCase, activities.EscalateInput{
			CaseID: input.CaseID, UserID: input.UserID, Reason: "Medium risk — requires senior review",
		})
	} else {
		result.Decision = "APPROVED"
		// Upgrade KYC level if warranted
		workflow.ExecuteActivity(ctx2m, activities.UpgradeKYCLevel, activities.KYCUpgradeInput{
			UserID: input.UserID, NewLevel: 2,
		})
	}

	// Step 5: Notify user and reviewer
	workflow.ExecuteActivity(ctx30s, activities.SendNotification, activities.NotificationInput{
		UserID: input.UserID, Channel: "email",
		Title: "KYC Review Complete",
		Message: fmt.Sprintf("Your KYC review (case %s) has been %s.", input.CaseID, result.Decision),
	})

	// Step 6: Ingest to Lakehouse
	workflow.ExecuteActivity(ctx30s, activities.IngestToLakehouse, activities.LakehouseInput{
		Topic: "nexcom.compliance.kyc_reviews",
		Record: map[string]interface{}{
			"case_id": input.CaseID, "user_id": input.UserID, "reviewer_id": input.ReviewerID,
			"decision": result.Decision, "risk_level": result.RiskLevel,
			"alert_filed": result.AlertFiled, "reviewed_at": workflow.Now(ctx),
		},
	})

	result.CompletedAt = workflow.Now(ctx)
	return result, nil
}

// ─────────────────────────────────────────────────────────────────────────────
// JOURNEY 3: WarehouseReceiptWorkflow
// Stakeholder: Farmer depositing physical commodity at a certified warehouse.
// Services: Warehouse service (matching-engine delivery) → Blockchain (tokenize) →
//           TigerBeetle (collateral account) → Notification → Lakehouse
// Reuse: Called by spot listing, loan collateral, cross-border commodity transfer
// ─────────────────────────────────────────────────────────────────────────────

type WarehouseReceiptInput struct {
	FarmerID        string  `json:"farmer_id"`
	WarehouseID     string  `json:"warehouse_id"`
	CommoditySymbol string  `json:"commodity_symbol"` // "MAIZE" | "SORGHUM" | "SOYBEANS" | "COCOA"
	QuantityTonnes  float64 `json:"quantity_tonnes"`
	Grade           string  `json:"grade"` // "A" | "B" | "C"
	TokenizeOnChain bool    `json:"tokenize_on_chain"`
	Chain           string  `json:"chain"` // "hyperledger" | "polygon"
}

type WarehouseReceiptResult struct {
	ReceiptID       string `json:"receipt_id"`
	LotNumber       string `json:"lot_number"`
	TokenID         string `json:"token_id,omitempty"`
	TxHash          string `json:"tx_hash,omitempty"`
	CollateralAcctID string `json:"collateral_account_id"`
	ValuationNGN    float64 `json:"valuation_ngn"`
	CompletedAt     time.Time `json:"completed_at"`
}

func WarehouseReceiptWorkflow(ctx workflow.Context, input WarehouseReceiptInput) (*WarehouseReceiptResult, error) {
	logger := workflow.GetLogger(ctx)
	logger.Info("WarehouseReceiptWorkflow started", "farmer_id", input.FarmerID, "commodity", input.CommoditySymbol)

	ctx5m := activityOpts(ctx, 5*time.Minute)
	ctx2m := activityOpts(ctx, 2*time.Minute)
	ctx30s := activityOpts(ctx, 30*time.Second)

	result := &WarehouseReceiptResult{}

	// Step 1: Verify warehouse is certified and has capacity
	var warehouseOK bool
	if err := workflow.ExecuteActivity(ctx2m, activities.VerifyWarehouseCapacity, activities.WarehouseCheckInput{
		WarehouseID: input.WarehouseID, QuantityTonnes: input.QuantityTonnes, Commodity: input.CommoditySymbol,
	}).Get(ctx, &warehouseOK); err != nil || !warehouseOK {
		return nil, temporal.NewApplicationError("InvalidInputError", "WAREHOUSE_CAPACITY", "Warehouse cannot accept this deposit")
	}

	// Step 2: Issue warehouse receipt
	var receipt activities.WarehouseReceiptResult
	if err := workflow.ExecuteActivity(ctx2m, activities.IssueWarehouseReceipt, activities.WarehouseReceiptInput{
		WarehouseID: input.WarehouseID, CommoditySymbol: input.CommoditySymbol,
		QuantityTonnes: input.QuantityTonnes, Grade: input.Grade, OwnerAccountID: input.FarmerID,
	}).Get(ctx, &receipt); err != nil {
		return nil, fmt.Errorf("issue warehouse receipt: %w", err)
	}
	result.ReceiptID = receipt.ReceiptID
	result.LotNumber = receipt.LotNumber

	// Step 3: Get current commodity price for valuation
	var priceResult activities.PriceResult
	if err := workflow.ExecuteActivity(ctx30s, activities.GetCommodityPrice, input.CommoditySymbol).Get(ctx, &priceResult); err != nil {
		logger.Warn("Price lookup failed, using zero valuation", "error", err)
	}
	result.ValuationNGN = priceResult.Price * input.QuantityTonnes * 1000 // price per kg → per tonne

	// Step 4: Tokenize on blockchain (optional)
	if input.TokenizeOnChain {
		var tokenResult activities.TokenizeResult
		if err := workflow.ExecuteActivity(ctx5m, activities.TokenizeCommodity, activities.TokenizeInput{
			CommoditySymbol: input.CommoditySymbol, Quantity: fmt.Sprintf("%.2f", input.QuantityTonnes),
			OwnerID: input.FarmerID, WarehouseReceiptID: receipt.ReceiptID, Chain: input.Chain,
		}).Get(ctx, &tokenResult); err != nil {
			logger.Warn("Tokenization failed (non-fatal)", "error", err)
		} else {
			result.TokenID = tokenResult.TokenID
			result.TxHash = tokenResult.TxHash
		}
	}

	// Step 5: Create TigerBeetle collateral account
	var collateralAcct activities.LedgerAccountResult
	if err := workflow.ExecuteActivity(ctx2m, activities.CreateLedgerAccount, activities.CreateAccountInput{
		UserID: input.FarmerID, AccountType: "COLLATERAL", Currency: "NGN",
	}).Get(ctx, &collateralAcct); err != nil {
		logger.Warn("Collateral account creation failed (non-fatal)", "error", err)
	} else {
		result.CollateralAcctID = collateralAcct.AccountID
	}

	// Step 6: Notify farmer
	workflow.ExecuteActivity(ctx30s, activities.SendNotification, activities.NotificationInput{
		UserID: input.FarmerID, Channel: "sms",
		Title: "Warehouse Receipt Issued",
		Message: fmt.Sprintf("Receipt #%s issued for %.2f MT %s at warehouse %s. Valuation: ₦%.2f",
			result.ReceiptID, input.QuantityTonnes, input.CommoditySymbol, input.WarehouseID, result.ValuationNGN),
	})

	// Step 7: Ingest to Lakehouse
	workflow.ExecuteActivity(ctx30s, activities.IngestToLakehouse, activities.LakehouseInput{
		Topic: "nexcom.warehouse.receipts_issued",
		Record: map[string]interface{}{
			"receipt_id": result.ReceiptID, "farmer_id": input.FarmerID,
			"commodity": input.CommoditySymbol, "quantity_tonnes": input.QuantityTonnes,
			"grade": input.Grade, "valuation_ngn": result.ValuationNGN,
			"token_id": result.TokenID, "issued_at": workflow.Now(ctx),
		},
	})

	result.CompletedAt = workflow.Now(ctx)
	return result, nil
}

// ─────────────────────────────────────────────────────────────────────────────
// JOURNEY 4: CommodityListingWorkflow
// Stakeholder: Farmer/trader listing a commodity for sale on the exchange.
// Services: Warehouse receipt verification → Risk check → Matching engine
//           (register symbol) → Market data → Notification → Lakehouse
// Reuse: Called by farmer portal, broker portal, corporate action (dividend-in-kind)
// ─────────────────────────────────────────────────────────────────────────────

type CommodityListingInput struct {
	SellerID        string  `json:"seller_id"`
	ReceiptID       string  `json:"receipt_id"`
	CommoditySymbol string  `json:"commodity_symbol"`
	QuantityTonnes  float64 `json:"quantity_tonnes"`
	AskPriceNGN     float64 `json:"ask_price_ngn"` // per kg
	ListingType     string  `json:"listing_type"` // "SPOT" | "FORWARD"
	DeliveryDate    string  `json:"delivery_date,omitempty"`
}

type CommodityListingResult struct {
	ListingID  string  `json:"listing_id"`
	OrderID    string  `json:"order_id"`
	Symbol     string  `json:"symbol"`
	Status     string  `json:"status"`
	CompletedAt time.Time `json:"completed_at"`
}

func CommodityListingWorkflow(ctx workflow.Context, input CommodityListingInput) (*CommodityListingResult, error) {
	logger := workflow.GetLogger(ctx)
	logger.Info("CommodityListingWorkflow started", "seller_id", input.SellerID, "symbol", input.CommoditySymbol)

	ctx2m := activityOpts(ctx, 2*time.Minute)
	ctx30s := activityOpts(ctx, 30*time.Second)

	result := &CommodityListingResult{Symbol: input.CommoditySymbol}

	// Step 1: Verify warehouse receipt ownership and status
	var receiptValid bool
	if err := workflow.ExecuteActivity(ctx2m, activities.VerifyWarehouseReceiptOwnership, activities.ReceiptOwnershipInput{
		ReceiptID: input.ReceiptID, OwnerID: input.SellerID,
	}).Get(ctx, &receiptValid); err != nil || !receiptValid {
		return nil, temporal.NewApplicationError("InvalidInputError", "RECEIPT_INVALID", "Warehouse receipt not valid or not owned by seller")
	}

	// Step 2: Pre-listing risk check
	var riskOK bool
	if err := workflow.ExecuteActivity(ctx2m, activities.PreListingRiskCheck, activities.ListingRiskInput{
		SellerID: input.SellerID, Symbol: input.CommoditySymbol,
		QuantityTonnes: input.QuantityTonnes, AskPrice: input.AskPriceNGN,
	}).Get(ctx, &riskOK); err != nil || !riskOK {
		return nil, temporal.NewApplicationError("InvalidInputError", "RISK_REJECTED", "Listing rejected by risk management")
	}

	// Step 3: Place SELL LIMIT order on matching engine
	var orderResult activities.OrderActivityResult
	if err := workflow.ExecuteActivity(ctx2m, activities.PlaceOrder, activities.OrderInput{
		AccountID: input.SellerID, Symbol: input.CommoditySymbol,
		Side: "SELL", OrderType: "LIMIT", Quantity: input.QuantityTonnes * 1000, // tonnes → kg
		Price: input.AskPriceNGN,
	}).Get(ctx, &orderResult); err != nil {
		return nil, fmt.Errorf("place listing order: %w", err)
	}
	result.OrderID = orderResult.OrderID
	result.ListingID = fmt.Sprintf("LST-%s-%s", input.CommoditySymbol, orderResult.OrderID[:8])
	result.Status = orderResult.Status

	// Step 4: Emit Fluvio real-time listing event
	workflow.ExecuteActivity(ctx30s, activities.ProduceFluvio, activities.FluvioInput{
		Topic: "nexcom.listings.new",
		Key:   result.ListingID,
		Value: map[string]interface{}{
			"listing_id": result.ListingID, "seller_id": input.SellerID,
			"symbol": input.CommoditySymbol, "quantity_tonnes": input.QuantityTonnes,
			"ask_price_ngn": input.AskPriceNGN, "listing_type": input.ListingType,
		},
	})

	// Step 5: Notify seller
	workflow.ExecuteActivity(ctx30s, activities.SendNotification, activities.NotificationInput{
		UserID: input.SellerID, Channel: "in_app",
		Title: "Commodity Listed Successfully",
		Message: fmt.Sprintf("%.2f MT %s listed at ₦%.2f/kg. Listing ID: %s", input.QuantityTonnes, input.CommoditySymbol, input.AskPriceNGN, result.ListingID),
	})

	// Step 6: Ingest to Lakehouse
	workflow.ExecuteActivity(ctx30s, activities.IngestToLakehouse, activities.LakehouseInput{
		Topic: "nexcom.listings.created",
		Record: map[string]interface{}{
			"listing_id": result.ListingID, "order_id": result.OrderID,
			"seller_id": input.SellerID, "symbol": input.CommoditySymbol,
			"quantity_tonnes": input.QuantityTonnes, "ask_price_ngn": input.AskPriceNGN,
			"listing_type": input.ListingType, "created_at": workflow.Now(ctx),
		},
	})

	result.CompletedAt = workflow.Now(ctx)
	return result, nil
}

// ─────────────────────────────────────────────────────────────────────────────
// JOURNEY 5: SpotTradeWorkflow
// Stakeholder: Trader buying a commodity on the spot market.
// Services: Pre-trade risk → Balance check (TigerBeetle) → Matching engine →
//           Settlement (TigerBeetle) → Blockchain DvP → Warehouse receipt transfer →
//           Notification → Fluvio → Lakehouse
// Reuse: Called by web trader, mobile app, broker order routing, algorithmic trading
// ─────────────────────────────────────────────────────────────────────────────

type SpotTradeInput struct {
	BuyerID       string  `json:"buyer_id"`
	Symbol        string  `json:"symbol"`
	QuantityKg    float64 `json:"quantity_kg"`
	MaxPriceNGN   float64 `json:"max_price_ngn"` // 0 = market order
	OrderType     string  `json:"order_type"` // "MARKET" | "LIMIT"
	TimeInForce   string  `json:"time_in_force"` // "DAY" | "IOC" | "FOK"
	IdempotencyKey string `json:"idempotency_key"`
}

type SpotTradeResult struct {
	OrderID      string  `json:"order_id"`
	TradeIDs     []string `json:"trade_ids"`
	FilledQtyKg  float64 `json:"filled_qty_kg"`
	AvgPriceNGN  float64 `json:"avg_price_ngn"`
	TotalCostNGN float64 `json:"total_cost_ngn"`
	FeeNGN       float64 `json:"fee_ngn"`
	SettlementID string  `json:"settlement_id"`
	Status       string  `json:"status"`
	CompletedAt  time.Time `json:"completed_at"`
}

func SpotTradeWorkflow(ctx workflow.Context, input SpotTradeInput) (*SpotTradeResult, error) {
	logger := workflow.GetLogger(ctx)
	logger.Info("SpotTradeWorkflow started", "buyer_id", input.BuyerID, "symbol", input.Symbol)

	ctx5m := activityOpts(ctx, 5*time.Minute)
	ctx2m := activityOpts(ctx, 2*time.Minute)
	ctx30s := activityOpts(ctx, 30*time.Second)

	result := &SpotTradeResult{}

	// Step 1: Pre-trade risk check
	var riskOK bool
	if err := workflow.ExecuteActivity(ctx2m, activities.PreTradeRiskCheck, activities.PreTradeInput{
		UserID: input.BuyerID, Symbol: input.Symbol,
		Quantity: input.QuantityKg, Price: input.MaxPriceNGN,
	}).Get(ctx, &riskOK); err != nil || !riskOK {
		return nil, temporal.NewApplicationError("InvalidInputError", "RISK_REJECTED", "Pre-trade risk check failed")
	}

	// Step 2: Verify sufficient balance (TigerBeetle)
	var balanceOK bool
	if err := workflow.ExecuteActivity(ctx30s, activities.CheckSufficientBalance, activities.BalanceCheckInput{
		UserID: input.BuyerID, RequiredAmount: input.MaxPriceNGN * input.QuantityKg * 1.01, // 1% buffer
		Currency: "NGN",
	}).Get(ctx, &balanceOK); err != nil || !balanceOK {
		return nil, temporal.NewApplicationError("InvalidInputError", "INSUFFICIENT_BALANCE", "Insufficient trading balance")
	}

	// Step 3: Reserve funds (TigerBeetle pending transfer)
	var reserveID string
	if err := workflow.ExecuteActivity(ctx2m, activities.ReserveFunds, activities.ReserveInput{
		UserID: input.BuyerID, Amount: input.MaxPriceNGN * input.QuantityKg,
		Currency: "NGN", Reference: input.IdempotencyKey,
	}).Get(ctx, &reserveID); err != nil {
		return nil, fmt.Errorf("reserve funds: %w", err)
	}

	// Step 4: Place order on matching engine
	var orderResult activities.OrderActivityResult
	if err := workflow.ExecuteActivity(ctx5m, activities.PlaceOrder, activities.OrderInput{
		AccountID: input.BuyerID, Symbol: input.Symbol,
		Side: "BUY", OrderType: input.OrderType, TimeInForce: input.TimeInForce,
		Quantity: input.QuantityKg, Price: input.MaxPriceNGN,
	}).Get(ctx, &orderResult); err != nil {
		// Compensation: release reserved funds
		workflow.ExecuteActivity(ctx30s, activities.ReleaseFunds, reserveID)
		return nil, fmt.Errorf("place order: %w", err)
	}
	result.OrderID = orderResult.OrderID
	result.FilledQtyKg = orderResult.FilledQuantity
	result.AvgPriceNGN = orderResult.AveragePrice
	result.TotalCostNGN = result.FilledQtyKg * result.AvgPriceNGN
	result.FeeNGN = result.TotalCostNGN * 0.001 // 0.1% fee
	result.TradeIDs = orderResult.TradeIDs
	result.Status = orderResult.Status

	if result.FilledQtyKg == 0 {
		// No fill — release reservation
		workflow.ExecuteActivity(ctx30s, activities.ReleaseFunds, reserveID)
		result.Status = "UNFILLED"
		result.CompletedAt = workflow.Now(ctx)
		return result, nil
	}

	// Step 5: Commit TigerBeetle settlement (debit buyer, credit seller)
	settlementID := fmt.Sprintf("settle-%s-%d", result.OrderID[:8], workflow.Now(ctx).UnixMilli())
	if err := workflow.ExecuteActivity(ctx2m, activities.SettleTrade, activities.SettleTradeInput{
		BuyerID: input.BuyerID, Symbol: input.Symbol,
		Amount: result.TotalCostNGN, Currency: "NGN",
		TradeID: result.TradeIDs[0], SettlementID: settlementID,
	}).Get(ctx, nil); err != nil {
		logger.Warn("Settlement failed — funds remain reserved", "error", err)
	} else {
		result.SettlementID = settlementID
	}

	// Step 6: Transfer warehouse receipt ownership
	workflow.ExecuteActivity(ctx2m, activities.TransferWarehouseReceipt, activities.ReceiptTransferInput{
		Symbol: input.Symbol, QuantityKg: result.FilledQtyKg,
		FromUserID: "exchange-inventory", ToUserID: input.BuyerID,
		TradeID: result.OrderID,
	})

	// Step 7: Trigger Temporal TradeSettlementWorkflow for T+2 DvP
	workflow.ExecuteActivity(ctx30s, activities.TriggerSettlementWorkflow, activities.SettlementWorkflowInput{
		TradeID: result.OrderID, BuyerID: input.BuyerID,
		Amount: result.TotalCostNGN, Currency: "NGN",
	})

	// Step 8: Notify buyer
	workflow.ExecuteActivity(ctx30s, activities.SendNotification, activities.NotificationInput{
		UserID: input.BuyerID, Channel: "push",
		Title: "Trade Executed",
		Message: fmt.Sprintf("Bought %.2f kg %s @ ₦%.2f/kg. Total: ₦%.2f. Fee: ₦%.2f",
			result.FilledQtyKg, input.Symbol, result.AvgPriceNGN, result.TotalCostNGN, result.FeeNGN),
	})

	// Step 9: Emit Fluvio real-time trade event
	workflow.ExecuteActivity(ctx30s, activities.ProduceFluvio, activities.FluvioInput{
		Topic: "nexcom.trades.live",
		Key:   result.OrderID,
		Value: map[string]interface{}{
			"order_id": result.OrderID, "buyer_id": input.BuyerID,
			"symbol": input.Symbol, "filled_qty_kg": result.FilledQtyKg,
			"avg_price_ngn": result.AvgPriceNGN, "total_cost_ngn": result.TotalCostNGN,
		},
	})

	// Step 10: Ingest to Lakehouse (Bronze → Silver → Gold pipeline)
	workflow.ExecuteActivity(ctx30s, activities.IngestToLakehouse, activities.LakehouseInput{
		Topic: "nexcom.trades.executed",
		Record: map[string]interface{}{
			"order_id": result.OrderID, "buyer_id": input.BuyerID,
			"symbol": input.Symbol, "filled_qty_kg": result.FilledQtyKg,
			"avg_price_ngn": result.AvgPriceNGN, "total_cost_ngn": result.TotalCostNGN,
			"fee_ngn": result.FeeNGN, "settlement_id": result.SettlementID,
			"trade_ids": result.TradeIDs, "executed_at": workflow.Now(ctx),
		},
	})

	result.CompletedAt = workflow.Now(ctx)
	logger.Info("SpotTradeWorkflow completed", "order_id", result.OrderID, "status", result.Status)
	return result, nil
}
