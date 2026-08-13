package workflows

import (
	"fmt"
	"time"

	"go.temporal.io/sdk/temporal"
	"go.temporal.io/sdk/workflow"

	"github.com/munisp/nexcomm/journey-orchestrator/internal/activities"
)

// ─────────────────────────────────────────────────────────────────────────────
// JOURNEY 11: USSDMobileTradeWorkflow
// Stakeholder: Rural farmer trading via feature phone (USSD *347*99#).
// Services: USSD engine → PIN verify → Balance check → Matching engine →
//           TigerBeetle → Kafka → Notification (SMS) → Lakehouse
// Reuse: Called by Africa's Talking USSD callback, IVR, WhatsApp bot
// ─────────────────────────────────────────────────────────────────────────────

type USSDMobileTradeInput struct {
	SessionID   string  `json:"session_id"`
	PhoneNumber string  `json:"phone_number"`
	UserID      string  `json:"user_id"`
	Symbol      string  `json:"symbol"`
	Side        string  `json:"side"` // "BUY" | "SELL"
	QuantityKg  float64 `json:"quantity_kg"`
	PIN         string  `json:"pin"` // hashed PIN
}

type USSDMobileTradeResult struct {
	OrderID     string    `json:"order_id"`
	Status      string    `json:"status"`
	FilledQtyKg float64   `json:"filled_qty_kg"`
	AvgPriceNGN float64   `json:"avg_price_ngn"`
	SMSRef      string    `json:"sms_ref"`
	CompletedAt time.Time `json:"completed_at"`
}

func USSDMobileTradeWorkflow(ctx workflow.Context, input USSDMobileTradeInput) (*USSDMobileTradeResult, error) {
	logger := workflow.GetLogger(ctx)
	logger.Info("USSDMobileTradeWorkflow started", "phone", input.PhoneNumber, "symbol", input.Symbol)

	ctx2m := activityOpts(ctx, 2*time.Minute)
	ctx30s := activityOpts(ctx, 30*time.Second)

	result := &USSDMobileTradeResult{}

	// Step 1: Verify PIN
	var pinOK bool
	if err := workflow.ExecuteActivity(ctx30s, activities.VerifyUSSDPIN, activities.PINVerifyInput{
		PhoneNumber: input.PhoneNumber, PIN: input.PIN,
	}).Get(ctx, &pinOK); err != nil || !pinOK {
		return nil, temporal.NewApplicationError("InvalidInputError", "PIN_INVALID", "Invalid PIN")
	}

	// Step 2: Get current market price
	var priceResult activities.PriceResult
	workflow.ExecuteActivity(ctx30s, activities.GetCommodityPrice, input.Symbol).Get(ctx, &priceResult)

	// Step 3: Check balance for BUY
	if input.Side == "BUY" {
		requiredAmount := priceResult.Price * input.QuantityKg * 1.02
		var balanceOK bool
		if err := workflow.ExecuteActivity(ctx30s, activities.CheckSufficientBalance, activities.BalanceCheckInput{
			UserID: input.UserID, RequiredAmount: requiredAmount, Currency: "NGN",
		}).Get(ctx, &balanceOK); err != nil || !balanceOK {
			// Send SMS: insufficient balance
			workflow.ExecuteActivity(ctx30s, activities.SendSMS, activities.SMSInput{
				PhoneNumber: input.PhoneNumber,
				Message:     fmt.Sprintf("NEXCOM: Insufficient balance. Need ₦%.2f. Dial *347*99# to deposit.", requiredAmount),
			})
			return nil, temporal.NewApplicationError("InvalidInputError", "INSUFFICIENT_BALANCE", "Insufficient balance")
		}
	}

	// Step 4: Place market order via matching engine
	var orderResult activities.OrderActivityResult
	if err := workflow.ExecuteActivity(ctx2m, activities.PlaceOrder, activities.OrderInput{
		AccountID: input.UserID, Symbol: input.Symbol,
		Side: input.Side, OrderType: "MARKET", TimeInForce: "IOC",
		Quantity: input.QuantityKg,
	}).Get(ctx, &orderResult); err != nil {
		workflow.ExecuteActivity(ctx30s, activities.SendSMS, activities.SMSInput{
			PhoneNumber: input.PhoneNumber,
			Message:     fmt.Sprintf("NEXCOM: Order failed for %s. Please try again. Dial *347*99#", input.Symbol),
		})
		return nil, fmt.Errorf("place USSD order: %w", err)
	}
	result.OrderID = orderResult.OrderID
	result.FilledQtyKg = orderResult.FilledQuantity
	result.AvgPriceNGN = orderResult.AveragePrice
	result.Status = orderResult.Status

	// Step 5: Send SMS confirmation
	smsRef := fmt.Sprintf("NX%s", orderResult.OrderID[:6])
	result.SMSRef = smsRef
	workflow.ExecuteActivity(ctx30s, activities.SendSMS, activities.SMSInput{
		PhoneNumber: input.PhoneNumber,
		Message: fmt.Sprintf("NEXCOM: %s %.2fkg %s @ ₦%.2f/kg. Total: ₦%.2f. Ref: %s",
			input.Side, result.FilledQtyKg, input.Symbol, result.AvgPriceNGN,
			result.FilledQtyKg*result.AvgPriceNGN, smsRef),
	})

	// Step 6: Ingest to Lakehouse
	workflow.ExecuteActivity(ctx30s, activities.IngestToLakehouse, activities.LakehouseInput{
		Topic: "nexcom.ussd.trades",
		Record: map[string]interface{}{
			"session_id": input.SessionID, "phone_number": input.PhoneNumber,
			"user_id": input.UserID, "symbol": input.Symbol,
			"side": input.Side, "quantity_kg": input.QuantityKg,
			"filled_qty_kg": result.FilledQtyKg, "avg_price_ngn": result.AvgPriceNGN,
			"order_id": result.OrderID, "executed_at": workflow.Now(ctx),
		},
	})

	result.CompletedAt = workflow.Now(ctx)
	return result, nil
}

// ─────────────────────────────────────────────────────────────────────────────
// JOURNEY 12: CreditScoringAndLoanApprovalWorkflow
// Stakeholder: Farmer applying for an agricultural input loan.
// Services: Credit scoring (Rust) → Risk check → Loan approval → TigerBeetle
//           (reserve lending pool) → Notification → Lakehouse
// Reuse: Called by banking dashboard, USSD loan menu, cooperative bulk-apply
// ─────────────────────────────────────────────────────────────────────────────

type LoanApplicationInput struct {
	FarmerID           string  `json:"farmer_id"`
	LoanAmountNGN      float64 `json:"loan_amount_ngn"`
	LoanPurpose        string  `json:"loan_purpose"` // "INPUT_FINANCING" | "EQUIPMENT" | "WR_FINANCING"
	LoanTermMonths     int     `json:"loan_term_months"`
	CollateralType     string  `json:"collateral_type"` // "WAREHOUSE_RECEIPT" | "LAND_TITLE"
	CollateralRefID    string  `json:"collateral_ref_id"`
	CollateralValueNGN float64 `json:"collateral_value_ngn"`
	FarmSizeHa         float64 `json:"farm_size_ha"`
	AnnualIncomeNGN    float64 `json:"annual_income_ngn"`
}

type LoanApplicationResult struct {
	LoanID            int64     `json:"loan_id"`
	Decision          string    `json:"decision"` // "APPROVED" | "CONDITIONAL" | "REJECTED"
	ApprovedAmountNGN float64   `json:"approved_amount_ngn"`
	InterestRatePct   float64   `json:"interest_rate_pct"`
	CreditScore       int       `json:"credit_score"`
	ScoreBand         string    `json:"score_band"`
	Conditions        []string  `json:"conditions,omitempty"`
	CompletedAt       time.Time `json:"completed_at"`
}

func LoanApplicationWorkflow(ctx workflow.Context, input LoanApplicationInput) (*LoanApplicationResult, error) {
	logger := workflow.GetLogger(ctx)
	logger.Info("LoanApplicationWorkflow started", "farmer_id", input.FarmerID, "amount", input.LoanAmountNGN)

	ctx5m := activityOpts(ctx, 5*time.Minute)
	ctx2m := activityOpts(ctx, 2*time.Minute)
	ctx30s := activityOpts(ctx, 30*time.Second)

	result := &LoanApplicationResult{}

	// Step 1: Run credit scoring
	var scoreResult activities.CreditScoreActivityResult
	if err := workflow.ExecuteActivity(ctx5m, activities.ScoreFarmer, activities.CreditScoreInput{
		FarmerID: input.FarmerID, LoanAmountNGN: input.LoanAmountNGN,
		LoanPurpose: input.LoanPurpose, LoanTermMonths: input.LoanTermMonths,
		FarmSizeHa: input.FarmSizeHa, AnnualIncomeNGN: input.AnnualIncomeNGN,
		CollateralValueNGN: input.CollateralValueNGN,
	}).Get(ctx, &scoreResult); err != nil {
		return nil, fmt.Errorf("credit scoring: %w", err)
	}
	result.CreditScore = scoreResult.Score
	result.ScoreBand = scoreResult.ScoreBand

	// Step 2: Apply decision logic
	baseRate := 18.0 // 18% base rate (CBN MPR + spread)
	switch scoreResult.Decision {
	case "AUTO_APPROVE":
		result.Decision = "APPROVED"
		result.ApprovedAmountNGN = min(input.LoanAmountNGN, scoreResult.MaxLoanNGN)
		result.InterestRatePct = baseRate + float64(scoreResult.PremiumBPS)/100.0
	case "APPROVE_WITH_CONDITIONS":
		result.Decision = "CONDITIONAL"
		result.ApprovedAmountNGN = min(input.LoanAmountNGN*0.75, scoreResult.MaxLoanNGN)
		result.InterestRatePct = baseRate + float64(scoreResult.PremiumBPS)/100.0 + 2.0
		result.Conditions = []string{"Collateral pledge required", "Quarterly farm visit", "Insurance required"}
	case "MANUAL_REVIEW":
		result.Decision = "CONDITIONAL"
		result.ApprovedAmountNGN = min(input.LoanAmountNGN*0.5, scoreResult.MaxLoanNGN)
		result.InterestRatePct = baseRate + float64(scoreResult.PremiumBPS)/100.0 + 4.0
		result.Conditions = []string{"Manual review by credit officer required"}
	default:
		result.Decision = "REJECTED"
		result.ApprovedAmountNGN = 0
	}

	// Step 3: If approved, create loan record in DB
	if result.Decision != "REJECTED" {
		var loanID int64
		if err := workflow.ExecuteActivity(ctx2m, activities.CreateLoanRecord, activities.LoanRecordInput{
			FarmerID: input.FarmerID, AmountNGN: result.ApprovedAmountNGN,
			InterestRatePct: result.InterestRatePct, TermMonths: input.LoanTermMonths,
			Purpose: input.LoanPurpose, CollateralType: input.CollateralType,
			CollateralRefID: input.CollateralRefID, CreditScore: result.CreditScore,
		}).Get(ctx, &loanID); err != nil {
			return nil, fmt.Errorf("create loan record: %w", err)
		}
		result.LoanID = loanID
	}

	// Step 4: Notify farmer
	var msg string
	switch result.Decision {
	case "APPROVED":
		msg = fmt.Sprintf("Congratulations! Loan of ₦%.2f approved at %.1f%% p.a. Loan ID: %d",
			result.ApprovedAmountNGN, result.InterestRatePct, result.LoanID)
	case "CONDITIONAL":
		msg = fmt.Sprintf("Loan conditionally approved for ₦%.2f at %.1f%% p.a. Conditions apply. Loan ID: %d",
			result.ApprovedAmountNGN, result.InterestRatePct, result.LoanID)
	default:
		msg = fmt.Sprintf("Loan application declined. Credit score: %d (%s). Improve your score and reapply.", result.CreditScore, result.ScoreBand)
	}
	workflow.ExecuteActivity(ctx30s, activities.SendNotification, activities.NotificationInput{
		UserID: input.FarmerID, Channel: "sms", Title: "Loan Decision", Message: msg,
	})

	// Step 5: Ingest to Lakehouse
	workflow.ExecuteActivity(ctx30s, activities.IngestToLakehouse, activities.LakehouseInput{
		Topic: "nexcom.loans.applications",
		Record: map[string]interface{}{
			"farmer_id": input.FarmerID, "loan_id": result.LoanID,
			"decision": result.Decision, "credit_score": result.CreditScore,
			"approved_amount_ngn": result.ApprovedAmountNGN, "interest_rate_pct": result.InterestRatePct,
			"loan_purpose": input.LoanPurpose, "applied_at": workflow.Now(ctx),
		},
	})

	result.CompletedAt = workflow.Now(ctx)
	return result, nil
}

func min(a, b float64) float64 {
	if a < b {
		return a
	}
	return b
}

// ─────────────────────────────────────────────────────────────────────────────
// JOURNEY 13: LoanDisbursementAndRepaymentWorkflow
// Stakeholder: Approved loan being disbursed and repayment being tracked.
// Services: TigerBeetle (reserve lending pool) → Mojaloop (disburse to bank) →
//           Repayment schedule → Notification → Lakehouse
// Reuse: Called by loan approval workflow, manual disbursement, cooperative bulk-disburse
// ─────────────────────────────────────────────────────────────────────────────

type LoanDisbursementInput struct {
	LoanID      int64   `json:"loan_id"`
	FarmerID    string  `json:"farmer_id"`
	AmountNGN   float64 `json:"amount_ngn"`
	BankAccount string  `json:"bank_account"`
	BankCode    string  `json:"bank_code"`
	ApprovedBy  string  `json:"approved_by"`
}

type LoanDisbursementResult struct {
	LoanID       int64     `json:"loan_id"`
	Status       string    `json:"status"`
	MojaloopTxID string    `json:"mojaloop_tx_id"`
	LedgerTxID   string    `json:"ledger_tx_id"`
	DisbursedAt  time.Time `json:"disbursed_at"`
}

func LoanDisbursementWorkflow(ctx workflow.Context, input LoanDisbursementInput) (*LoanDisbursementResult, error) {
	logger := workflow.GetLogger(ctx)
	logger.Info("LoanDisbursementWorkflow started", "loan_id", input.LoanID)

	ctx5m := activityOpts(ctx, 5*time.Minute)
	ctx2m := activityOpts(ctx, 2*time.Minute)
	ctx30s := activityOpts(ctx, 30*time.Second)

	result := &LoanDisbursementResult{LoanID: input.LoanID}

	// Step 1: Validate loan approval
	var loanValid bool
	if err := workflow.ExecuteActivity(ctx2m, activities.ValidateLoanApproval, activities.LoanValidateInput{
		LoanID: input.LoanID, ApprovedBy: input.ApprovedBy,
	}).Get(ctx, &loanValid); err != nil || !loanValid {
		return nil, temporal.NewApplicationError("InvalidInputError", "LOAN_NOT_APPROVED", "Loan not in approved state")
	}

	// Step 2: Reserve funds from lending pool (TigerBeetle)
	var reserveID string
	if err := workflow.ExecuteActivity(ctx2m, activities.ReserveLendingPoolFunds, activities.LendingReserveInput{
		LoanID: input.LoanID, Amount: int64(input.AmountNGN * 100),
	}).Get(ctx, &reserveID); err != nil {
		return nil, fmt.Errorf("reserve lending pool: %w", err)
	}

	// Step 3: Initiate Mojaloop transfer to farmer's bank
	var mojaTx activities.MojaloopTxResult
	if err := workflow.ExecuteActivity(ctx5m, activities.ExecuteMojaloopTransfer, activities.MojaloopTransferInput{
		TransferID: fmt.Sprintf("loan-disburse-%d", input.LoanID),
		SenderFSP:  "nexcom", ReceiverFSP: input.BankCode,
		ReceiverAccount: input.BankAccount,
		Amount:          input.AmountNGN, Currency: "NGN",
		Note: fmt.Sprintf("NEXCOM Loan #%d disbursement", input.LoanID),
	}).Get(ctx, &mojaTx); err != nil {
		// Compensation: release lending pool reservation
		workflow.ExecuteActivity(ctx30s, activities.ReleaseLendingPoolFunds, reserveID)
		return nil, fmt.Errorf("Mojaloop disbursement: %w", err)
	}
	result.MojaloopTxID = mojaTx.TransferID

	// Step 4: Commit TigerBeetle transfer and mark loan DISBURSED
	var ledgerTxID string
	if err := workflow.ExecuteActivity(ctx2m, activities.CommitLoanDisbursement, activities.LoanCommitInput{
		LoanID: input.LoanID, ReserveID: reserveID, MojaloopTxID: mojaTx.TransferID,
	}).Get(ctx, &ledgerTxID); err != nil {
		return nil, fmt.Errorf("commit disbursement: %w", err)
	}
	result.LedgerTxID = ledgerTxID

	// Step 5: Start repayment schedule
	workflow.ExecuteActivity(ctx30s, activities.StartRepaymentSchedule, activities.RepaymentScheduleInput{
		LoanID: input.LoanID, FarmerID: input.FarmerID, AmountNGN: input.AmountNGN,
	})

	// Step 6: Notify farmer
	workflow.ExecuteActivity(ctx30s, activities.SendNotification, activities.NotificationInput{
		UserID: input.FarmerID, Channel: "sms",
		Title: "Loan Disbursed",
		Message: fmt.Sprintf("₦%.2f has been sent to your bank account. Loan ID: %d. Ref: %s",
			input.AmountNGN, input.LoanID, result.MojaloopTxID),
	})

	// Step 7: Ingest to Lakehouse
	workflow.ExecuteActivity(ctx30s, activities.IngestToLakehouse, activities.LakehouseInput{
		Topic: "nexcom.loans.disbursements",
		Record: map[string]interface{}{
			"loan_id": input.LoanID, "farmer_id": input.FarmerID,
			"amount_ngn": input.AmountNGN, "mojaloop_tx_id": result.MojaloopTxID,
			"ledger_tx_id": ledgerTxID, "disbursed_at": workflow.Now(ctx),
		},
	})

	result.Status = "DISBURSED"
	result.DisbursedAt = workflow.Now(ctx)
	return result, nil
}

// ─────────────────────────────────────────────────────────────────────────────
// JOURNEY 14: CorporateActionWorkflow
// Stakeholder: Exchange processing a corporate action (stock split, dividend, etc.)
// Services: Matching engine (corporate actions) → TigerBeetle (distribute funds) →
//           Blockchain (update token supply) → Notification (all holders) → Lakehouse
// Reuse: Called by exchange admin, issuer portal, automated corporate action processor
// ─────────────────────────────────────────────────────────────────────────────

type CorporateActionInput struct {
	ActionID    string  `json:"action_id"`
	Symbol      string  `json:"symbol"`
	ActionType  string  `json:"action_type"` // "DIVIDEND" | "STOCK_SPLIT" | "RIGHTS_ISSUE"
	RecordDate  string  `json:"record_date"`
	PayDate     string  `json:"pay_date"`
	Ratio       float64 `json:"ratio"` // e.g. 1.1 = 10% dividend, 2.0 = 2-for-1 split
	InitiatedBy string  `json:"initiated_by"`
}

type CorporateActionResult struct {
	ActionID         string    `json:"action_id"`
	ProcessedHolders int       `json:"processed_holders"`
	TotalDistributed float64   `json:"total_distributed_ngn"`
	Status           string    `json:"status"`
	CompletedAt      time.Time `json:"completed_at"`
}

func CorporateActionWorkflow(ctx workflow.Context, input CorporateActionInput) (*CorporateActionResult, error) {
	logger := workflow.GetLogger(ctx)
	logger.Info("CorporateActionWorkflow started", "action_id", input.ActionID, "symbol", input.Symbol)

	ctx5m := activityOpts(ctx, 5*time.Minute)
	ctx2m := activityOpts(ctx, 2*time.Minute)
	ctx30s := activityOpts(ctx, 30*time.Second)

	result := &CorporateActionResult{ActionID: input.ActionID}

	// Step 1: Validate corporate action (check symbol exists, dates valid)
	var actionValid bool
	if err := workflow.ExecuteActivity(ctx2m, activities.ValidateCorporateAction, activities.CorporateActionValidateInput{
		ActionID: input.ActionID, Symbol: input.Symbol, ActionType: input.ActionType,
		RecordDate: input.RecordDate, InitiatedBy: input.InitiatedBy,
	}).Get(ctx, &actionValid); err != nil || !actionValid {
		return nil, temporal.NewApplicationError("InvalidInputError", "ACTION_INVALID", "Corporate action validation failed")
	}

	// Step 2: Get all holders as of record date
	var holders []activities.HolderRecord
	if err := workflow.ExecuteActivity(ctx5m, activities.GetHoldersAtRecordDate, activities.HolderQueryInput{
		Symbol: input.Symbol, RecordDate: input.RecordDate,
	}).Get(ctx, &holders); err != nil {
		return nil, fmt.Errorf("get holders: %w", err)
	}

	// Step 3: Process action for each holder
	var totalDistributed float64
	for _, holder := range holders {
		var distributed float64
		if err := workflow.ExecuteActivity(ctx2m, activities.ProcessCorporateActionForHolder, activities.HolderActionInput{
			ActionID: input.ActionID, HolderID: holder.UserID,
			Symbol: input.Symbol, ActionType: input.ActionType,
			HolderQty: holder.Quantity, Ratio: input.Ratio,
		}).Get(ctx, &distributed); err != nil {
			logger.Warn("Corporate action failed for holder", "holder_id", holder.UserID, "error", err)
			continue
		}
		totalDistributed += distributed
		result.ProcessedHolders++
	}
	result.TotalDistributed = totalDistributed

	// Step 4: Process via matching engine
	workflow.ExecuteActivity(ctx2m, activities.ProcessCorporateActionOnEngine, input.ActionID)

	// Step 5: Broadcast notification to all holders
	workflow.ExecuteActivity(ctx30s, activities.BroadcastCorporateActionNotification, activities.BroadcastInput{
		Symbol: input.Symbol, ActionType: input.ActionType,
		Ratio: input.Ratio, PayDate: input.PayDate,
		HolderCount: result.ProcessedHolders,
	})

	// Step 6: Ingest to Lakehouse
	workflow.ExecuteActivity(ctx30s, activities.IngestToLakehouse, activities.LakehouseInput{
		Topic: "nexcom.corporate_actions.processed",
		Record: map[string]interface{}{
			"action_id": input.ActionID, "symbol": input.Symbol,
			"action_type": input.ActionType, "processed_holders": result.ProcessedHolders,
			"total_distributed_ngn": result.TotalDistributed, "processed_at": workflow.Now(ctx),
		},
	})

	result.Status = "COMPLETED"
	result.CompletedAt = workflow.Now(ctx)
	return result, nil
}

// ─────────────────────────────────────────────────────────────────────────────
// JOURNEY 15: MarketSurveillanceWorkflow
// Stakeholder: Surveillance officer investigating a market manipulation alert.
// Services: Matching engine (surveillance) → AI/ML (anomaly detection) →
//           Risk management → Permify → Notification → Lakehouse
// Reuse: Called by automated surveillance engine, compliance officer, regulator
// ─────────────────────────────────────────────────────────────────────────────

type SurveillanceInput struct {
	AlertID    string                 `json:"alert_id"`
	AlertType  string                 `json:"alert_type"` // "SPOOFING" | "WASH_TRADING" | "FRONT_RUNNING" | "LAYERING"
	UserID     string                 `json:"user_id"`
	Symbol     string                 `json:"symbol"`
	Severity   string                 `json:"severity"` // "LOW" | "MEDIUM" | "HIGH" | "CRITICAL"
	Evidence   map[string]interface{} `json:"evidence"`
	ReviewerID string                 `json:"reviewer_id"`
}

type SurveillanceResult struct {
	AlertID       string    `json:"alert_id"`
	Decision      string    `json:"decision"` // "DISMISSED" | "WARNING" | "SUSPENDED" | "REFERRED_TO_REGULATOR"
	AccountFrozen bool      `json:"account_frozen"`
	STRFiled      bool      `json:"str_filed"`
	CompletedAt   time.Time `json:"completed_at"`
}

func MarketSurveillanceWorkflow(ctx workflow.Context, input SurveillanceInput) (*SurveillanceResult, error) {
	logger := workflow.GetLogger(ctx)
	logger.Info("MarketSurveillanceWorkflow started", "alert_id", input.AlertID, "type", input.AlertType)

	ctx2m := activityOpts(ctx, 2*time.Minute)
	ctx30s := activityOpts(ctx, 30*time.Second)

	result := &SurveillanceResult{AlertID: input.AlertID}

	// Step 1: Run AI/ML anomaly detection on trading pattern
	var anomalyResult activities.AnomalyResult
	workflow.ExecuteActivity(ctx2m, activities.DetectTradingAnomaly, activities.AnomalyInput{
		UserID: input.UserID, Symbol: input.Symbol, AlertType: input.AlertType,
		Evidence: input.Evidence,
	}).Get(ctx, &anomalyResult)

	// Step 2: Get full trading history for user
	var tradingHistory activities.TradingHistoryResult
	workflow.ExecuteActivity(ctx2m, activities.GetUserTradingHistory, activities.TradingHistoryInput{
		UserID: input.UserID, Symbol: input.Symbol, Days: 30,
	}).Get(ctx, &tradingHistory)

	// Step 3: Decision logic based on severity and AI score
	switch {
	case input.Severity == "CRITICAL" || anomalyResult.Score > 0.9:
		result.Decision = "REFERRED_TO_REGULATOR"
		result.AccountFrozen = true
		result.STRFiled = true
		workflow.ExecuteActivity(ctx30s, activities.FreezeAccount, input.UserID)
		workflow.ExecuteActivity(ctx2m, activities.FileSuspiciousTransactionReport, activities.STRInput{
			UserID: input.UserID, CaseID: input.AlertID, RiskLevel: "CRITICAL",
			Amount: tradingHistory.TotalVolume, Currency: "NGN", Evidence: input.Evidence,
		})
		workflow.ExecuteActivity(ctx30s, activities.RaiseSurveillanceAlert, activities.SurveillanceAlertInput{
			AlertType: input.AlertType, UserID: input.UserID, Symbol: input.Symbol,
			Severity: "CRITICAL", Evidence: input.Evidence,
		})
	case input.Severity == "HIGH" || anomalyResult.Score > 0.7:
		result.Decision = "SUSPENDED"
		result.AccountFrozen = true
		workflow.ExecuteActivity(ctx30s, activities.SuspendTradingAccount, input.UserID)
	case input.Severity == "MEDIUM" || anomalyResult.Score > 0.5:
		result.Decision = "WARNING"
		workflow.ExecuteActivity(ctx30s, activities.IssueWarning, activities.WarningInput{
			UserID: input.UserID, AlertType: input.AlertType, AlertID: input.AlertID,
		})
	default:
		result.Decision = "DISMISSED"
	}

	// Step 4: Notify reviewer
	workflow.ExecuteActivity(ctx30s, activities.SendNotification, activities.NotificationInput{
		UserID: input.ReviewerID, Channel: "in_app",
		Title: fmt.Sprintf("Surveillance Alert %s: %s", input.AlertID, result.Decision),
		Message: fmt.Sprintf("Alert type: %s. User: %s. Symbol: %s. Decision: %s. STR filed: %v",
			input.AlertType, input.UserID, input.Symbol, result.Decision, result.STRFiled),
	})

	// Step 5: Ingest to Lakehouse
	workflow.ExecuteActivity(ctx30s, activities.IngestToLakehouse, activities.LakehouseInput{
		Topic: "nexcom.surveillance.alerts",
		Record: map[string]interface{}{
			"alert_id": input.AlertID, "alert_type": input.AlertType,
			"user_id": input.UserID, "symbol": input.Symbol,
			"severity": input.Severity, "decision": result.Decision,
			"account_frozen": result.AccountFrozen, "str_filed": result.STRFiled,
			"ai_anomaly_score": anomalyResult.Score, "reviewed_at": workflow.Now(ctx),
		},
	})

	result.CompletedAt = workflow.Now(ctx)
	return result, nil
}

// ─────────────────────────────────────────────────────────────────────────────
// JOURNEY 16: ComplianceAuditWorkflow
// Stakeholder: Compliance officer running a periodic regulatory audit.
// Services: Analytics → AI/ML → Lakehouse (Gold layer) → Report generation →
//           Notification → Dapr (alert if violations found)
// Reuse: Called by daily/weekly/monthly compliance scheduler, regulator request
// ─────────────────────────────────────────────────────────────────────────────

type ComplianceAuditInput struct {
	AuditID     string `json:"audit_id"`
	AuditType   string `json:"audit_type"` // "DAILY_POSITION" | "STR" | "CTR" | "TRADE_SURVEILLANCE"
	PeriodStart string `json:"period_start"`
	PeriodEnd   string `json:"period_end"`
	RequestedBy string `json:"requested_by"`
}

type ComplianceAuditResult struct {
	AuditID         string    `json:"audit_id"`
	ReportURL       string    `json:"report_url"`
	ViolationsFound int       `json:"violations_found"`
	AlertsFiled     int       `json:"alerts_filed"`
	Status          string    `json:"status"`
	CompletedAt     time.Time `json:"completed_at"`
}

func ComplianceAuditWorkflow(ctx workflow.Context, input ComplianceAuditInput) (*ComplianceAuditResult, error) {
	logger := workflow.GetLogger(ctx)
	logger.Info("ComplianceAuditWorkflow started", "audit_id", input.AuditID, "type", input.AuditType)

	ctx5m := activityOpts(ctx, 5*time.Minute)
	ctx30s := activityOpts(ctx, 30*time.Second)

	result := &ComplianceAuditResult{AuditID: input.AuditID}

	// Step 1: Check permission
	var permitted bool
	if err := workflow.ExecuteActivity(ctx30s, activities.CheckPermission, activities.PermissionInput{
		SubjectID: input.RequestedBy, Resource: "compliance_report", Action: "generate",
	}).Get(ctx, &permitted); err != nil || !permitted {
		return nil, temporal.NewApplicationError("InvalidInputError", "PERMISSION_DENIED", "Insufficient permissions")
	}

	// Step 2: Generate compliance report from analytics/lakehouse
	var reportResult activities.ComplianceReportResult
	if err := workflow.ExecuteActivity(ctx5m, activities.GenerateComplianceReport, activities.ComplianceReportInput{
		AuditID: input.AuditID, ReportType: input.AuditType,
		PeriodStart: input.PeriodStart, PeriodEnd: input.PeriodEnd,
		GeneratedBy: input.RequestedBy,
	}).Get(ctx, &reportResult); err != nil {
		return nil, fmt.Errorf("generate report: %w", err)
	}
	result.ReportURL = reportResult.ReportURL
	result.ViolationsFound = reportResult.ViolationsFound

	// Step 3: Run AI anomaly detection on the audit period
	var anomalyResult activities.AuditAnomalyResult
	workflow.ExecuteActivity(ctx5m, activities.RunAuditAnomalyDetection, activities.AuditAnomalyInput{
		PeriodStart: input.PeriodStart, PeriodEnd: input.PeriodEnd, AuditType: input.AuditType,
	}).Get(ctx, &anomalyResult)
	result.ViolationsFound += anomalyResult.AnomalyCount

	// Step 4: File alerts for violations
	if result.ViolationsFound > 0 {
		for _, violation := range reportResult.Violations {
			workflow.ExecuteActivity(ctx30s, activities.FileComplianceAlert, activities.ComplianceAlertInput{
				AuditID: input.AuditID, ViolationType: violation.Type,
				UserID: violation.UserID, Amount: violation.Amount,
			})
			result.AlertsFiled++
		}
	}

	// Step 5: Notify compliance officer
	workflow.ExecuteActivity(ctx30s, activities.SendNotification, activities.NotificationInput{
		UserID: input.RequestedBy, Channel: "email",
		Title: fmt.Sprintf("Compliance Audit %s Complete", input.AuditType),
		Message: fmt.Sprintf("Audit %s completed. Violations: %d. Alerts filed: %d. Report: %s",
			input.AuditID, result.ViolationsFound, result.AlertsFiled, result.ReportURL),
	})

	// Step 6: Ingest to Lakehouse
	workflow.ExecuteActivity(ctx30s, activities.IngestToLakehouse, activities.LakehouseInput{
		Topic: "nexcom.compliance.audits",
		Record: map[string]interface{}{
			"audit_id": input.AuditID, "audit_type": input.AuditType,
			"period_start": input.PeriodStart, "period_end": input.PeriodEnd,
			"violations_found": result.ViolationsFound, "alerts_filed": result.AlertsFiled,
			"report_url": result.ReportURL, "completed_at": workflow.Now(ctx),
		},
	})

	result.Status = "COMPLETED"
	result.CompletedAt = workflow.Now(ctx)
	return result, nil
}

// ─────────────────────────────────────────────────────────────────────────────
// JOURNEY 17: BrokerOnboardingWorkflow
// Stakeholder: Broker-dealer registering to trade on behalf of clients.
// Services: KYC (enhanced due diligence) → Permify (assign broker role) →
//           Matching engine (register broker) → TigerBeetle (create accounts) →
//           Notification → Lakehouse
// Reuse: Called by exchange admin, broker self-registration portal
// ─────────────────────────────────────────────────────────────────────────────

type BrokerOnboardingInput struct {
	BrokerID     string `json:"broker_id"`
	Name         string `json:"name"`
	LicenseNo    string `json:"license_no"`
	RegulatorRef string `json:"regulator_ref"` // SEC/CBN registration number
	ContactEmail string `json:"contact_email"`
	ContactPhone string `json:"contact_phone"`
	ApprovedBy   string `json:"approved_by"`
}

type BrokerOnboardingResult struct {
	BrokerID         string    `json:"broker_id"`
	Status           string    `json:"status"`
	TradingAccountID string    `json:"trading_account_id"`
	ClientPoolAcctID string    `json:"client_pool_account_id"`
	KeycloakRoles    []string  `json:"keycloak_roles"`
	CompletedAt      time.Time `json:"completed_at"`
}

func BrokerOnboardingWorkflow(ctx workflow.Context, input BrokerOnboardingInput) (*BrokerOnboardingResult, error) {
	logger := workflow.GetLogger(ctx)
	logger.Info("BrokerOnboardingWorkflow started", "broker_id", input.BrokerID)

	ctx2m := activityOpts(ctx, 2*time.Minute)
	ctx30s := activityOpts(ctx, 30*time.Second)

	result := &BrokerOnboardingResult{BrokerID: input.BrokerID}

	// Step 1: Verify license with regulator API
	var licenseValid bool
	if err := workflow.ExecuteActivity(ctx2m, activities.VerifyBrokerLicense, activities.LicenseVerifyInput{
		LicenseNo: input.LicenseNo, RegulatorRef: input.RegulatorRef, BrokerName: input.Name,
	}).Get(ctx, &licenseValid); err != nil || !licenseValid {
		return nil, temporal.NewApplicationError("InvalidInputError", "LICENSE_INVALID", "Broker license verification failed")
	}

	// Step 2: Register broker on matching engine
	workflow.ExecuteActivity(ctx2m, activities.RegisterBroker, activities.BrokerRegisterInput{
		BrokerID: input.BrokerID, Name: input.Name, LicenseNo: input.LicenseNo,
		ContactEmail: input.ContactEmail,
	})

	// Step 3: Create TigerBeetle accounts (trading + client pool)
	var tradingAcct activities.LedgerAccountResult
	workflow.ExecuteActivity(ctx2m, activities.CreateLedgerAccount, activities.CreateAccountInput{
		UserID: input.BrokerID, AccountType: "BROKER_TRADING", Currency: "NGN",
	}).Get(ctx, &tradingAcct)
	result.TradingAccountID = tradingAcct.AccountID

	var clientPoolAcct activities.LedgerAccountResult
	workflow.ExecuteActivity(ctx2m, activities.CreateLedgerAccount, activities.CreateAccountInput{
		UserID: input.BrokerID, AccountType: "BROKER_CLIENT_POOL", Currency: "NGN",
	}).Get(ctx, &clientPoolAcct)
	result.ClientPoolAcctID = clientPoolAcct.AccountID

	// Step 4: Assign Keycloak roles
	var roles []string
	workflow.ExecuteActivity(ctx30s, activities.AssignKeycloakRole, activities.RoleAssignInput{
		UserID: input.BrokerID, Roles: []string{"BROKER", "TRADER", "MARKET_PARTICIPANT"},
	}).Get(ctx, &roles)
	result.KeycloakRoles = roles

	// Step 5: Notify broker and admin
	workflow.ExecuteActivity(ctx30s, activities.SendNotification, activities.NotificationInput{
		UserID: input.BrokerID, Channel: "email",
		Title:   "Broker Registration Approved",
		Message: fmt.Sprintf("Welcome to NEXCOM Exchange! Your broker account is active. License: %s", input.LicenseNo),
	})

	// Step 6: Ingest to Lakehouse
	workflow.ExecuteActivity(ctx30s, activities.IngestToLakehouse, activities.LakehouseInput{
		Topic: "nexcom.brokers.onboarded",
		Record: map[string]interface{}{
			"broker_id": input.BrokerID, "name": input.Name,
			"license_no": input.LicenseNo, "regulator_ref": input.RegulatorRef,
			"trading_account_id": result.TradingAccountID, "onboarded_at": workflow.Now(ctx),
		},
	})

	result.Status = "ACTIVE"
	result.CompletedAt = workflow.Now(ctx)
	return result, nil
}

// ─────────────────────────────────────────────────────────────────────────────
// JOURNEY 18: MarketMakerQuoteWorkflow
// Stakeholder: Market maker maintaining continuous two-sided quotes.
// Services: Matching engine (submit bid/ask) → Risk check (spread/inventory) →
//           Circuit breaker check → Fluvio (real-time quote stream) → Lakehouse
// Reuse: Called by market maker portal, automated quoting engine, liquidity program
// ─────────────────────────────────────────────────────────────────────────────

type MarketMakerQuoteInput struct {
	MarketMakerID string  `json:"market_maker_id"`
	Symbol        string  `json:"symbol"`
	BidPrice      float64 `json:"bid_price"`
	AskPrice      float64 `json:"ask_price"`
	BidSizeKg     float64 `json:"bid_size_kg"`
	AskSizeKg     float64 `json:"ask_size_kg"`
	ValidForMs    int64   `json:"valid_for_ms"` // quote validity in milliseconds
}

type MarketMakerQuoteResult struct {
	BidOrderID  string    `json:"bid_order_id"`
	AskOrderID  string    `json:"ask_order_id"`
	SpreadBps   float64   `json:"spread_bps"`
	Status      string    `json:"status"`
	CompletedAt time.Time `json:"completed_at"`
}

func MarketMakerQuoteWorkflow(ctx workflow.Context, input MarketMakerQuoteInput) (*MarketMakerQuoteResult, error) {
	logger := workflow.GetLogger(ctx)
	logger.Info("MarketMakerQuoteWorkflow started", "mm_id", input.MarketMakerID, "symbol", input.Symbol)

	ctx2m := activityOpts(ctx, 2*time.Minute)
	ctx30s := activityOpts(ctx, 30*time.Second)

	result := &MarketMakerQuoteResult{}

	// Step 1: Check circuit breaker status
	var cbStatus activities.CircuitBreakerStatus
	if err := workflow.ExecuteActivity(ctx30s, activities.CheckCircuitBreaker, input.Symbol).Get(ctx, &cbStatus); err == nil && cbStatus.Halted {
		return nil, temporal.NewApplicationError("InvalidInputError", "CIRCUIT_BREAKER_HALTED", "Trading halted for symbol")
	}

	// Step 2: Validate spread (min 5 bps, max 500 bps)
	spreadBps := (input.AskPrice - input.BidPrice) / input.BidPrice * 10000
	result.SpreadBps = spreadBps
	if spreadBps < 5 || spreadBps > 500 {
		return nil, temporal.NewApplicationError("InvalidInputError", "INVALID_SPREAD", fmt.Sprintf("Spread %.1f bps out of allowed range [5, 500]", spreadBps))
	}

	// Step 3: Submit bid order
	var bidResult activities.OrderActivityResult
	if err := workflow.ExecuteActivity(ctx2m, activities.PlaceOrder, activities.OrderInput{
		AccountID: input.MarketMakerID, Symbol: input.Symbol,
		Side: "BUY", OrderType: "LIMIT", TimeInForce: "GTC",
		Quantity: input.BidSizeKg, Price: input.BidPrice,
	}).Get(ctx, &bidResult); err != nil {
		return nil, fmt.Errorf("submit bid: %w", err)
	}
	result.BidOrderID = bidResult.OrderID

	// Step 4: Submit ask order
	var askResult activities.OrderActivityResult
	if err := workflow.ExecuteActivity(ctx2m, activities.PlaceOrder, activities.OrderInput{
		AccountID: input.MarketMakerID, Symbol: input.Symbol,
		Side: "SELL", OrderType: "LIMIT", TimeInForce: "GTC",
		Quantity: input.AskSizeKg, Price: input.AskPrice,
	}).Get(ctx, &askResult); err != nil {
		// Compensation: cancel bid
		workflow.ExecuteActivity(ctx30s, activities.CancelOrder, activities.CancelOrderInput{
			Symbol: input.Symbol, OrderID: result.BidOrderID,
		})
		return nil, fmt.Errorf("submit ask: %w", err)
	}
	result.AskOrderID = askResult.OrderID

	// Step 5: Emit Fluvio real-time quote
	workflow.ExecuteActivity(ctx30s, activities.ProduceFluvio, activities.FluvioInput{
		Topic: "nexcom.marketdata.quotes",
		Key:   fmt.Sprintf("%s-%s", input.Symbol, input.MarketMakerID),
		Value: map[string]interface{}{
			"symbol": input.Symbol, "mm_id": input.MarketMakerID,
			"bid": input.BidPrice, "ask": input.AskPrice,
			"bid_size_kg": input.BidSizeKg, "ask_size_kg": input.AskSizeKg,
			"spread_bps": spreadBps,
		},
	})

	// Step 6: Ingest to Lakehouse
	workflow.ExecuteActivity(ctx30s, activities.IngestToLakehouse, activities.LakehouseInput{
		Topic: "nexcom.marketmaker.quotes",
		Record: map[string]interface{}{
			"mm_id": input.MarketMakerID, "symbol": input.Symbol,
			"bid_price": input.BidPrice, "ask_price": input.AskPrice,
			"spread_bps": spreadBps, "bid_order_id": result.BidOrderID,
			"ask_order_id": result.AskOrderID, "quoted_at": workflow.Now(ctx),
		},
	})

	result.Status = "ACTIVE"
	result.CompletedAt = workflow.Now(ctx)
	return result, nil
}

// ─────────────────────────────────────────────────────────────────────────────
// JOURNEY 19: RegulatorReportingWorkflow
// Stakeholder: Exchange submitting mandatory regulatory reports to SEC/CBN.
// Services: Analytics (Gold layer) → Compliance → Lakehouse → External regulator API →
//           Notification → Audit trail
// Reuse: Called by daily/weekly/monthly scheduler, on-demand regulator request
// ─────────────────────────────────────────────────────────────────────────────

type RegulatorReportInput struct {
	ReportID    string `json:"report_id"`
	ReportType  string `json:"report_type"` // "DAILY_TRADE_REPORT" | "WEEKLY_POSITION" | "MONTHLY_STR" | "ANNUAL_AUDIT"
	Regulator   string `json:"regulator"`   // "SEC" | "CBN" | "FMDQ" | "NGX"
	PeriodStart string `json:"period_start"`
	PeriodEnd   string `json:"period_end"`
	SubmittedBy string `json:"submitted_by"`
}

type RegulatorReportResult struct {
	ReportID         string    `json:"report_id"`
	SubmissionRef    string    `json:"submission_ref"`
	RecordsSubmitted int       `json:"records_submitted"`
	Status           string    `json:"status"`
	CompletedAt      time.Time `json:"completed_at"`
}

func RegulatorReportingWorkflow(ctx workflow.Context, input RegulatorReportInput) (*RegulatorReportResult, error) {
	logger := workflow.GetLogger(ctx)
	logger.Info("RegulatorReportingWorkflow started", "report_id", input.ReportID, "regulator", input.Regulator)

	ctx5m := activityOpts(ctx, 5*time.Minute)
	ctx2m := activityOpts(ctx, 2*time.Minute)
	ctx30s := activityOpts(ctx, 30*time.Second)

	result := &RegulatorReportResult{ReportID: input.ReportID}

	// Step 1: Compile report data from Gold lakehouse layer
	var reportData activities.RegulatorReportData
	if err := workflow.ExecuteActivity(ctx5m, activities.CompileRegulatorReport, activities.RegulatorReportInput{
		ReportType: input.ReportType, PeriodStart: input.PeriodStart, PeriodEnd: input.PeriodEnd,
	}).Get(ctx, &reportData); err != nil {
		return nil, fmt.Errorf("compile report: %w", err)
	}
	result.RecordsSubmitted = reportData.RecordCount

	// Step 2: Sign and encrypt report (crypto-guard service)
	var signedReport activities.SignedReportResult
	if err := workflow.ExecuteActivity(ctx2m, activities.SignAndEncryptReport, activities.SignReportInput{
		ReportID: input.ReportID, Data: reportData.Payload, SubmittedBy: input.SubmittedBy,
	}).Get(ctx, &signedReport); err != nil {
		return nil, fmt.Errorf("sign report: %w", err)
	}

	// Step 3: Submit to regulator API
	var submissionRef string
	if err := workflow.ExecuteActivity(ctx5m, activities.SubmitToRegulator, activities.RegulatorSubmitInput{
		Regulator: input.Regulator, ReportType: input.ReportType,
		SignedPayload: signedReport.Payload, Signature: signedReport.Signature,
	}).Get(ctx, &submissionRef); err != nil {
		return nil, fmt.Errorf("submit to regulator: %w", err)
	}
	result.SubmissionRef = submissionRef

	// Step 4: Notify submitter
	workflow.ExecuteActivity(ctx30s, activities.SendNotification, activities.NotificationInput{
		UserID: input.SubmittedBy, Channel: "email",
		Title:   fmt.Sprintf("%s Report Submitted to %s", input.ReportType, input.Regulator),
		Message: fmt.Sprintf("Report %s submitted. Ref: %s. Records: %d.", input.ReportID, submissionRef, result.RecordsSubmitted),
	})

	// Step 5: Ingest to Lakehouse (immutable audit trail)
	workflow.ExecuteActivity(ctx30s, activities.IngestToLakehouse, activities.LakehouseInput{
		Topic: "nexcom.regulatory.submissions",
		Record: map[string]interface{}{
			"report_id": input.ReportID, "report_type": input.ReportType,
			"regulator": input.Regulator, "submission_ref": submissionRef,
			"records_submitted": result.RecordsSubmitted, "submitted_at": workflow.Now(ctx),
		},
	})

	result.Status = "SUBMITTED"
	result.CompletedAt = workflow.Now(ctx)
	return result, nil
}

// ─────────────────────────────────────────────────────────────────────────────
// JOURNEY 20: PlatformHealthCheckWorkflow
// Stakeholder: SRE/DevOps engineer verifying all platform services are healthy.
// Services: All 18 services → Lakehouse (health metrics) → Notification (alerts) →
//           Dapr (pub/sub health events) → Dashboard update
// Reuse: Called by Kubernetes liveness probe, scheduled health check, incident response
// ─────────────────────────────────────────────────────────────────────────────

type PlatformHealthInput struct {
	CheckID     string   `json:"check_id"`
	Services    []string `json:"services"` // empty = check all
	AlertOnFail bool     `json:"alert_on_fail"`
	AlertUserID string   `json:"alert_user_id"`
}

type ServiceHealthStatus struct {
	ServiceName string `json:"service_name"`
	Healthy     bool   `json:"healthy"`
	Latency     int64  `json:"latency_ms"`
	Error       string `json:"error,omitempty"`
}

type PlatformHealthResult struct {
	CheckID        string                `json:"check_id"`
	HealthyCount   int                   `json:"healthy_count"`
	UnhealthyCount int                   `json:"unhealthy_count"`
	Services       []ServiceHealthStatus `json:"services"`
	OverallHealthy bool                  `json:"overall_healthy"`
	CompletedAt    time.Time             `json:"completed_at"`
}

func PlatformHealthCheckWorkflow(ctx workflow.Context, input PlatformHealthInput) (*PlatformHealthResult, error) {
	logger := workflow.GetLogger(ctx)
	logger.Info("PlatformHealthCheckWorkflow started", "check_id", input.CheckID)

	ctx30s := activityOpts(ctx, 30*time.Second)

	result := &PlatformHealthResult{CheckID: input.CheckID}

	allServices := []string{
		"portal", "matching-engine", "settlement-engine", "gateway",
		"kyc-service", "risk-management", "analytics", "ai-ml",
		"notification", "ingestion-engine", "blockchain", "analytics-engine",
		"user-management", "credit-scoring", "ussd-engine", "middleware-hub",
		"mojaloop-adapter", "temporal",
	}
	checkList := input.Services
	if len(checkList) == 0 {
		checkList = allServices
	}

	// Check all services in parallel using workflow.Go
	type healthCheck struct {
		name   string
		future workflow.Future
	}
	var checks []healthCheck
	for _, svc := range checkList {
		f := workflow.ExecuteActivity(ctx30s, activities.CheckServiceHealth, svc)
		checks = append(checks, healthCheck{name: svc, future: f})
	}

	// Collect results
	for _, check := range checks {
		var status ServiceHealthStatus
		if err := check.future.Get(ctx, &status); err != nil {
			status = ServiceHealthStatus{ServiceName: check.name, Healthy: false, Error: err.Error()}
		}
		result.Services = append(result.Services, status)
		if status.Healthy {
			result.HealthyCount++
		} else {
			result.UnhealthyCount++
		}
	}

	result.OverallHealthy = result.UnhealthyCount == 0

	// Alert on failures
	if !result.OverallHealthy && input.AlertOnFail && input.AlertUserID != "" {
		var unhealthyNames []string
		for _, s := range result.Services {
			if !s.Healthy {
				unhealthyNames = append(unhealthyNames, s.ServiceName)
			}
		}
		workflow.ExecuteActivity(ctx30s, activities.SendNotification, activities.NotificationInput{
			UserID: input.AlertUserID, Channel: "push",
			Title:   "NEXCOM Platform Health Alert",
			Message: fmt.Sprintf("%d services unhealthy: %v", result.UnhealthyCount, unhealthyNames),
		})
	}

	// Ingest health metrics to Lakehouse
	workflow.ExecuteActivity(ctx30s, activities.IngestToLakehouse, activities.LakehouseInput{
		Topic: "nexcom.platform.health",
		Record: map[string]interface{}{
			"check_id": input.CheckID, "healthy_count": result.HealthyCount,
			"unhealthy_count": result.UnhealthyCount, "overall_healthy": result.OverallHealthy,
			"checked_at": workflow.Now(ctx),
		},
	})

	result.CompletedAt = workflow.Now(ctx)
	logger.Info("PlatformHealthCheckWorkflow completed",
		"healthy", result.HealthyCount, "unhealthy", result.UnhealthyCount)
	return result, nil
}
