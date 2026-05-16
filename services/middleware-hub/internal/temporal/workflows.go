// Package temporal provides Temporal workflow definitions for NEXCOM.
// Implements durable, fault-tolerant workflows for settlement processing,
// KYC review pipelines, AML screening, and commodity delivery coordination.
package temporal

import (
	"fmt"
	"time"

	"go.temporal.io/sdk/activity"
	"go.temporal.io/sdk/temporal"
	"go.temporal.io/sdk/workflow"
)

// Task queue names for worker routing
const (
	TaskQueueSettlement = "nexcom-settlement"
	TaskQueueKYC        = "nexcom-kyc"
	TaskQueueAML        = "nexcom-aml"
	TaskQueueDelivery   = "nexcom-delivery"
	TaskQueueAudit      = "nexcom-audit"
)

// SettlementInput represents the input for a settlement workflow
type SettlementInput struct {
	TradeID      string  `json:"trade_id"`
	BuyerID      string  `json:"buyer_id"`
	SellerID     string  `json:"seller_id"`
	Symbol       string  `json:"symbol"`
	Quantity     float64 `json:"quantity"`
	Price        float64 `json:"price"`
	Total        float64 `json:"total"`
	Currency     string  `json:"currency"`
	BuyerDFSP    string  `json:"buyer_dfsp"`
	SellerDFSP   string  `json:"seller_dfsp"`
	T0Requested  bool    `json:"t0_requested"`
}

// SettlementResult represents the output of a settlement workflow
type SettlementResult struct {
	SettlementID string    `json:"settlement_id"`
	Status       string    `json:"status"` // SETTLED | FAILED | REVERSED
	TigerBeetleID uint64   `json:"tigerbeetle_id"`
	MojaloopTxID string    `json:"mojaloop_tx_id"`
	SettledAt    time.Time `json:"settled_at"`
	IsT0         bool      `json:"is_t0"`
	LatencyMs    int64     `json:"latency_ms"`
}

// KYCWorkflowInput represents the input for a KYC review workflow
type KYCWorkflowInput struct {
	UserID       string `json:"user_id"`
	DFSPID       string `json:"dfsp_id,omitempty"`
	DocumentURLs []string `json:"document_urls"`
	EntityType   string `json:"entity_type"` // INDIVIDUAL | CORPORATE
	RiskLevel    string `json:"risk_level"`  // LOW | MEDIUM | HIGH
}

// KYCWorkflowResult represents the output of a KYC review workflow
type KYCWorkflowResult struct {
	Status      string    `json:"status"` // APPROVED | REJECTED | EDD_REQUIRED
	ReviewerID  string    `json:"reviewer_id"`
	RiskScore   float64   `json:"risk_score"`
	Flags       []string  `json:"flags"`
	CompletedAt time.Time `json:"completed_at"`
}

// AMLScreeningInput represents the input for an AML screening workflow
type AMLScreeningInput struct {
	UserID      string  `json:"user_id"`
	Amount      float64 `json:"amount"`
	Currency    string  `json:"currency"`
	CounterID   string  `json:"counter_id"`
	TxType      string  `json:"tx_type"` // TRADE | DEPOSIT | WITHDRAWAL | TRANSFER
	IPAddress   string  `json:"ip_address"`
}

// AMLScreeningResult represents the output of an AML screening workflow
type AMLScreeningResult struct {
	Cleared     bool     `json:"cleared"`
	RiskScore   float64  `json:"risk_score"`
	Flags       []string `json:"flags"`
	RequiresEDD bool     `json:"requires_edd"`
	BlockTx     bool     `json:"block_tx"`
}

// SettlementWorkflow orchestrates the full T+0 settlement lifecycle
func SettlementWorkflow(ctx workflow.Context, input SettlementInput) (*SettlementResult, error) {
	logger := workflow.GetLogger(ctx)
	logger.Info("Starting settlement workflow", "trade_id", input.TradeID)

	startTime := workflow.Now(ctx)

	// Retry policy for activities
	retryPolicy := &temporal.RetryPolicy{
		InitialInterval:    time.Second,
		BackoffCoefficient: 2.0,
		MaximumInterval:    30 * time.Second,
		MaximumAttempts:    5,
	}

	activityOptions := workflow.ActivityOptions{
		StartToCloseTimeout: 30 * time.Second,
		RetryPolicy:         retryPolicy,
	}
	ctx = workflow.WithActivityOptions(ctx, activityOptions)

	// Step 1: AML screening before settlement
	var amlResult AMLScreeningResult
	if err := workflow.ExecuteActivity(ctx, ScreenAMLActivity, AMLScreeningInput{
		UserID:    input.BuyerID,
		Amount:    input.Total,
		Currency:  input.Currency,
		CounterID: input.SellerID,
		TxType:    "TRADE",
	}).Get(ctx, &amlResult); err != nil {
		return nil, fmt.Errorf("AML screening failed: %w", err)
	}

	if amlResult.BlockTx {
		return &SettlementResult{
			SettlementID: fmt.Sprintf("BLOCKED-%s", input.TradeID),
			Status:       "BLOCKED_AML",
		}, nil
	}

	// Step 2: Lock commodity tokens on blockchain
	var tokenLockID string
	if err := workflow.ExecuteActivity(ctx, LockCommodityTokenActivity, input).Get(ctx, &tokenLockID); err != nil {
		return nil, fmt.Errorf("token lock failed: %w", err)
	}

	// Step 3: Initiate Mojaloop transfer
	var mojaloopTxID string
	if err := workflow.ExecuteActivity(ctx, InitiateMojaloopTransferActivity, input).Get(ctx, &mojaloopTxID); err != nil {
		// Compensate: unlock tokens
		_ = workflow.ExecuteActivity(ctx, UnlockCommodityTokenActivity, tokenLockID).Get(ctx, nil)
		return nil, fmt.Errorf("mojaloop transfer failed: %w", err)
	}

	// Step 4: Record in TigerBeetle double-entry ledger
	var tbID uint64
	if err := workflow.ExecuteActivity(ctx, RecordTigerBeetleActivity, input, mojaloopTxID).Get(ctx, &tbID); err != nil {
		return nil, fmt.Errorf("tigerbeetle recording failed: %w", err)
	}

	// Step 5: Transfer commodity tokens on blockchain
	if err := workflow.ExecuteActivity(ctx, TransferCommodityTokenActivity, input, tokenLockID).Get(ctx, nil); err != nil {
		return nil, fmt.Errorf("token transfer failed: %w", err)
	}

	// Step 6: Emit settlement event to Kafka
	if err := workflow.ExecuteActivity(ctx, EmitSettlementEventActivity, input, mojaloopTxID, tbID).Get(ctx, nil); err != nil {
		logger.Warn("Settlement event emission failed (non-critical)", "error", err)
	}

	latencyMs := workflow.Now(ctx).Sub(startTime).Milliseconds()
	isT0 := latencyMs < 5000 // T+0 if settled within 5 seconds

	result := &SettlementResult{
		SettlementID:  fmt.Sprintf("SETTLE-%s", input.TradeID),
		Status:        "SETTLED",
		TigerBeetleID: tbID,
		MojaloopTxID:  mojaloopTxID,
		SettledAt:     workflow.Now(ctx),
		IsT0:          isT0,
		LatencyMs:     latencyMs,
	}

	logger.Info("Settlement workflow completed",
		"settlement_id", result.SettlementID,
		"latency_ms", latencyMs,
		"is_t0", isT0,
	)

	return result, nil
}

// KYCReviewWorkflow orchestrates the KYC review pipeline with human-in-the-loop
func KYCReviewWorkflow(ctx workflow.Context, input KYCWorkflowInput) (*KYCWorkflowResult, error) {
	logger := workflow.GetLogger(ctx)
	logger.Info("Starting KYC review workflow", "user_id", input.UserID)

	activityOptions := workflow.ActivityOptions{
		StartToCloseTimeout: 5 * time.Minute,
		RetryPolicy: &temporal.RetryPolicy{
			MaximumAttempts: 3,
		},
	}
	ctx = workflow.WithActivityOptions(ctx, activityOptions)

	// Step 1: Automated document verification
	var docScore float64
	if err := workflow.ExecuteActivity(ctx, VerifyDocumentsActivity, input).Get(ctx, &docScore); err != nil {
		return nil, fmt.Errorf("document verification failed: %w", err)
	}

	// Step 2: Sanctions and PEP screening
	var sanctionsCleared bool
	if err := workflow.ExecuteActivity(ctx, ScreenSanctionsActivity, input).Get(ctx, &sanctionsCleared); err != nil {
		return nil, fmt.Errorf("sanctions screening failed: %w", err)
	}

	// Step 3: AML risk scoring
	var amlRiskScore float64
	if err := workflow.ExecuteActivity(ctx, ComputeAMLRiskScoreActivity, input).Get(ctx, &amlRiskScore); err != nil {
		return nil, fmt.Errorf("AML risk scoring failed: %w", err)
	}

	// Step 4: Human review for high-risk or EDD cases
	requiresHumanReview := amlRiskScore > 0.7 || !sanctionsCleared || input.RiskLevel == "HIGH"

	var reviewerID string
	if requiresHumanReview {
		// Signal channel for human reviewer decision
		reviewSignal := workflow.GetSignalChannel(ctx, "kyc-review-decision")

		// Wait up to 5 business days for human review
		selector := workflow.NewSelector(ctx)
		timerFired := false

		timer := workflow.NewTimer(ctx, 5*24*time.Hour)
		selector.AddFuture(timer, func(f workflow.Future) {
			timerFired = true
		})
		selector.AddReceive(reviewSignal, func(c workflow.ReceiveChannel, more bool) {
			c.Receive(ctx, &reviewerID)
		})

		selector.Select(ctx)

		if timerFired {
			return &KYCWorkflowResult{
				Status:      "TIMEOUT",
				CompletedAt: workflow.Now(ctx),
			}, nil
		}
	}

	// Step 5: Determine final status
	status := "APPROVED"
	if !sanctionsCleared {
		status = "REJECTED"
	} else if amlRiskScore > 0.5 {
		status = "EDD_REQUIRED"
	}

	result := &KYCWorkflowResult{
		Status:      status,
		ReviewerID:  reviewerID,
		RiskScore:   amlRiskScore,
		CompletedAt: workflow.Now(ctx),
	}

	// Step 6: Notify user and publish KYC update event
	if err := workflow.ExecuteActivity(ctx, NotifyKYCDecisionActivity, input, result).Get(ctx, nil); err != nil {
		logger.Warn("KYC notification failed (non-critical)", "error", err)
	}

	return result, nil
}

// AMLScreeningWorkflow performs automated AML screening for a transaction
func AMLScreeningWorkflow(ctx workflow.Context, input AMLScreeningInput) (*AMLScreeningResult, error) {
	activityOptions := workflow.ActivityOptions{
		StartToCloseTimeout: 10 * time.Second,
		RetryPolicy: &temporal.RetryPolicy{
			MaximumAttempts: 3,
		},
	}
	ctx = workflow.WithActivityOptions(ctx, activityOptions)

	var result AMLScreeningResult
	if err := workflow.ExecuteActivity(ctx, ScreenAMLActivity, input).Get(ctx, &result); err != nil {
		return nil, fmt.Errorf("AML screening activity failed: %w", err)
	}

	return &result, nil
}

// Activity stubs — implementations are in activities.go
var (
	ScreenAMLActivity               = activity.RegisterOptions{Name: "ScreenAML"}
	LockCommodityTokenActivity      = activity.RegisterOptions{Name: "LockCommodityToken"}
	UnlockCommodityTokenActivity    = activity.RegisterOptions{Name: "UnlockCommodityToken"}
	InitiateMojaloopTransferActivity = activity.RegisterOptions{Name: "InitiateMojaloopTransfer"}
	RecordTigerBeetleActivity       = activity.RegisterOptions{Name: "RecordTigerBeetle"}
	TransferCommodityTokenActivity  = activity.RegisterOptions{Name: "TransferCommodityToken"}
	EmitSettlementEventActivity     = activity.RegisterOptions{Name: "EmitSettlementEvent"}
	VerifyDocumentsActivity         = activity.RegisterOptions{Name: "VerifyDocuments"}
	ScreenSanctionsActivity         = activity.RegisterOptions{Name: "ScreenSanctions"}
	ComputeAMLRiskScoreActivity     = activity.RegisterOptions{Name: "ComputeAMLRiskScore"}
	NotifyKYCDecisionActivity       = activity.RegisterOptions{Name: "NotifyKYCDecision"}
)

// ─── Loan Disbursement Workflow ───────────────────────────────────────────────

// LoanDisbursementInput represents the input for a loan disbursement workflow
type LoanDisbursementInput struct {
	LoanID               string  `json:"loan_id"`
	UserID               string  `json:"user_id"`
	Amount               float64 `json:"amount"`
	Currency             string  `json:"currency"`
	DisbursementAccount  string  `json:"disbursement_account"`
	TenorMonths          int     `json:"tenor_months"`
}

// LoanDisbursementResult represents the result of a loan disbursement workflow
type LoanDisbursementResult struct {
	DisbursementID  string    `json:"disbursement_id"`
	Status          string    `json:"status"`
	TigerBeetleID   uint64    `json:"tiger_beetle_id"`
	CompletedAt     time.Time `json:"completed_at"`
}

// LoanDisbursementWorkflow orchestrates the full loan disbursement pipeline:
// CreditCheck → ReserveFunds → DisburseLoan → EmitLoanEvent
func LoanDisbursementWorkflow(ctx workflow.Context, input LoanDisbursementInput) (*LoanDisbursementResult, error) {
	logger := workflow.GetLogger(ctx)
	logger.Info("Starting loan disbursement workflow", "loan_id", input.LoanID, "user_id", input.UserID)

	activityOptions := workflow.ActivityOptions{
		StartToCloseTimeout: 2 * time.Minute,
		RetryPolicy: &temporal.RetryPolicy{
			MaximumAttempts:        3,
			InitialInterval:        5 * time.Second,
			BackoffCoefficient:     2.0,
			MaximumInterval:        30 * time.Second,
		},
	}
	ctx = workflow.WithActivityOptions(ctx, activityOptions)

	// Step 1: Credit check via credit-scoring service
	var creditApproved bool
	if err := workflow.ExecuteActivity(ctx, CreditCheckActivity, input).Get(ctx, &creditApproved); err != nil {
		return nil, fmt.Errorf("credit check failed: %w", err)
	}
	if !creditApproved {
		return &LoanDisbursementResult{
			DisbursementID: fmt.Sprintf("LOAN-REJECTED-%s", input.LoanID),
			Status:         "REJECTED",
			CompletedAt:    workflow.Now(ctx),
		}, nil
	}

	// Step 2: Reserve funds in TigerBeetle
	var tbID uint64
	if err := workflow.ExecuteActivity(ctx, ReserveFundsActivity, input).Get(ctx, &tbID); err != nil {
		return nil, fmt.Errorf("reserve funds failed: %w", err)
	}

	// Step 3: Disburse loan via core-banking
	var disbursementID string
	if err := workflow.ExecuteActivity(ctx, DisburseLoanActivity, input, tbID).Get(ctx, &disbursementID); err != nil {
		return nil, fmt.Errorf("loan disbursement failed: %w", err)
	}

	// Step 4: Emit loan event to Kafka (non-critical)
	if err := workflow.ExecuteActivity(ctx, EmitLoanEventActivity, input, disbursementID).Get(ctx, nil); err != nil {
		logger.Warn("Loan event emission failed (non-critical)", "error", err)
	}

	result := &LoanDisbursementResult{
		DisbursementID: disbursementID,
		Status:         "DISBURSED",
		TigerBeetleID:  tbID,
		CompletedAt:    workflow.Now(ctx),
	}
	logger.Info("Loan disbursement workflow completed", "disbursement_id", disbursementID, "loan_id", input.LoanID)
	return result, nil
}

// ─── Settlement Finalize Workflow ─────────────────────────────────────────────

// SettlementFinalizeInput wraps SettlementInput with finalization metadata
type SettlementFinalizeInput struct {
	SettlementInput
	CounterpartyIDs []string `json:"counterparty_ids"`
	LakehousePath   string   `json:"lakehouse_path"`
}

// SettlementFinalizeResult extends SettlementResult with finalization details
type SettlementFinalizeResult struct {
	SettlementResult
	SettlementNoteID string `json:"settlement_note_id"`
	LakehouseRef     string `json:"lakehouse_ref"`
	NotifiedCount    int    `json:"notified_count"`
}

// SettlementFinalizeWorkflow wraps SettlementWorkflow with additional finalization:
// Run core settlement → GenerateSettlementNote → ArchiveToLakehouse → NotifyCounterparties
func SettlementFinalizeWorkflow(ctx workflow.Context, input SettlementFinalizeInput) (*SettlementFinalizeResult, error) {
	logger := workflow.GetLogger(ctx)
	logger.Info("Starting settlement finalize workflow", "trade_id", input.TradeID)

	activityOptions := workflow.ActivityOptions{
		StartToCloseTimeout: 5 * time.Minute,
		RetryPolicy: &temporal.RetryPolicy{
			MaximumAttempts: 3,
		},
	}
	ctx = workflow.WithActivityOptions(ctx, activityOptions)

	// Step 1: Run core settlement workflow as child workflow
	childCtx := workflow.WithChildOptions(ctx, workflow.ChildWorkflowOptions{
		WorkflowID: fmt.Sprintf("settlement-core-%s", input.TradeID),
	})
	var coreResult SettlementResult
	if err := workflow.ExecuteChildWorkflow(childCtx, SettlementWorkflow, input.SettlementInput).Get(ctx, &coreResult); err != nil {
		return nil, fmt.Errorf("core settlement failed: %w", err)
	}

	// Step 2: Generate settlement note
	var noteID string
	if err := workflow.ExecuteActivity(ctx, GenerateSettlementNoteActivity, input, &coreResult).Get(ctx, &noteID); err != nil {
		return nil, fmt.Errorf("settlement note generation failed: %w", err)
	}

	// Step 3: Archive to lakehouse (non-critical)
	var lakehouseRef string
	if err := workflow.ExecuteActivity(ctx, ArchiveToLakehouseActivity, input, &coreResult, noteID).Get(ctx, &lakehouseRef); err != nil {
		logger.Warn("Lakehouse archival failed (non-critical)", "error", err)
		lakehouseRef = ""
	}

	// Step 4: Notify counterparties (non-critical)
	var notifiedCount int
	if err := workflow.ExecuteActivity(ctx, NotifyCounterpartiesActivity, input, &coreResult).Get(ctx, &notifiedCount); err != nil {
		logger.Warn("Counterparty notification failed (non-critical)", "error", err)
		notifiedCount = 0
	}

	result := &SettlementFinalizeResult{
		SettlementResult: coreResult,
		SettlementNoteID: noteID,
		LakehouseRef:     lakehouseRef,
		NotifiedCount:    notifiedCount,
	}
	logger.Info("Settlement finalize workflow completed",
		"settlement_id", coreResult.SettlementID,
		"note_id", noteID,
	)
	return result, nil
}

// Activity stubs for new workflows
var (
	CreditCheckActivity           = activity.RegisterOptions{Name: "CreditCheck"}
	ReserveFundsActivity          = activity.RegisterOptions{Name: "ReserveFunds"}
	DisburseLoanActivity          = activity.RegisterOptions{Name: "DisburseLoan"}
	EmitLoanEventActivity         = activity.RegisterOptions{Name: "EmitLoanEvent"}
	GenerateSettlementNoteActivity = activity.RegisterOptions{Name: "GenerateSettlementNote"}
	ArchiveToLakehouseActivity    = activity.RegisterOptions{Name: "ArchiveToLakehouse"}
	NotifyCounterpartiesActivity  = activity.RegisterOptions{Name: "NotifyCounterparties"}
)
