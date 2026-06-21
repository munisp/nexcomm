// Package loan implements Temporal workflows for the loan disbursement lifecycle.
// Orchestrates: credit scoring → collateral check → TigerBeetle pending debit (collateral hold) →
// TigerBeetle credit (loan disbursement) → Kafka event → Lakehouse ingest → repayment schedule.
// Uses saga compensation to guarantee atomicity.
package loan

import (
	"fmt"
	"time"

	"go.temporal.io/sdk/temporal"
	"go.temporal.io/sdk/workflow"
)

// LoanDisbursementInput is the input to the LoanDisbursementWorkflow.
type LoanDisbursementInput struct {
	LoanID          string  `json:"loan_id"`
	UserID          string  `json:"user_id"`
	Amount          float64 `json:"amount"`          // minor units
	Currency        string  `json:"currency"`
	CollateralType  string  `json:"collateral_type"` // "warehouse_receipt" | "crop_standing" | "cash"
	CollateralID    string  `json:"collateral_id"`
	InterestRate    float64 `json:"interest_rate"`   // annual rate e.g. 0.12 = 12%
	TenorDays       int     `json:"tenor_days"`
	DisbursalMethod string  `json:"disbursal_method"` // "mojaloop" | "bank_transfer"
	Destination     string  `json:"destination"`
}

// LoanDisbursementOutput is the final result.
type LoanDisbursementOutput struct {
	LoanID           string    `json:"loan_id"`
	Status           string    `json:"status"`
	LedgerTxID       string    `json:"ledger_tx_id"`
	CollateralHoldID string    `json:"collateral_hold_id"`
	ExternalTxID     string    `json:"external_tx_id"`
	RepaymentDate    time.Time `json:"repayment_date"`
	CompletedAt      time.Time `json:"completed_at"`
	FailureReason    string    `json:"failure_reason,omitempty"`
}

// LoanDisbursementWorkflow is the durable, idempotent loan disbursement saga.
func LoanDisbursementWorkflow(ctx workflow.Context, input LoanDisbursementInput) (*LoanDisbursementOutput, error) {
	logger := workflow.GetLogger(ctx)
	logger.Info("LoanDisbursementWorkflow started", "loan_id", input.LoanID)

	retryPolicy := &temporal.RetryPolicy{
		InitialInterval:    3 * time.Second,
		BackoffCoefficient: 2.0,
		MaximumInterval:    60 * time.Second,
		MaximumAttempts:    5,
		NonRetryableErrorTypes: []string{
			"CreditScoreFailedError",
			"CollateralInsufficientError",
			"KYCFailedError",
			"DuplicateLoanError",
		},
	}
	ao := workflow.ActivityOptions{
		StartToCloseTimeout: 5 * time.Minute,
		RetryPolicy:         retryPolicy,
	}
	ctx = workflow.WithActivityOptions(ctx, ao)

	var compensations []func(workflow.Context) error

	// ── Step 1: Credit scoring ────────────────────────────────────────────────
	var creditResult CreditScoreResult
	if err := workflow.ExecuteActivity(ctx, CreditScoringActivity, CreditScoreInput{
		UserID:         input.UserID,
		RequestedAmount: input.Amount,
		TenorDays:      input.TenorDays,
	}).Get(ctx, &creditResult); err != nil {
		return failLoan(input.LoanID, fmt.Sprintf("credit scoring error: %v", err)), nil
	}
	if !creditResult.Approved {
		return failLoan(input.LoanID, fmt.Sprintf("credit score insufficient: %s", creditResult.Reason)), nil
	}

	// ── Step 2: Collateral valuation and hold ────────────────────────────────
	var collateralResult CollateralHoldResult
	if err := workflow.ExecuteActivity(ctx, HoldCollateralActivity, CollateralHoldInput{
		UserID:         input.UserID,
		CollateralType: input.CollateralType,
		CollateralID:   input.CollateralID,
		LoanAmount:     input.Amount,
		LoanID:         input.LoanID,
	}).Get(ctx, &collateralResult); err != nil {
		return failLoan(input.LoanID, fmt.Sprintf("collateral hold failed: %v", err)), nil
	}
	if !collateralResult.Success {
		return failLoan(input.LoanID, fmt.Sprintf("collateral insufficient: %s", collateralResult.Reason)), nil
	}
	compensations = append(compensations, func(ctx workflow.Context) error {
		return workflow.ExecuteActivity(ctx, ReleaseCollateralActivity, collateralResult.HoldID).Get(ctx, nil)
	})

	// ── Step 3: TigerBeetle pending debit on loan pool (reserve disbursement funds) ──
	var pendingResult PendingTransferResult
	if err := workflow.ExecuteActivity(ctx, CreatePendingLoanDebitActivity, PendingDebitInput{
		UserID:    "exchange-loan-pool",
		Amount:    int64(input.Amount),
		Reference: input.LoanID,
		Code:      7, // TransferLoanDisbursement
	}).Get(ctx, &pendingResult); err != nil {
		runCompensations(ctx, compensations, logger)
		return failLoan(input.LoanID, fmt.Sprintf("loan fund reservation failed: %v", err)), nil
	}
	compensations = append(compensations, func(ctx workflow.Context) error {
		return workflow.ExecuteActivity(ctx, VoidPendingLoanDebitActivity, pendingResult.PendingID).Get(ctx, nil)
	})

	// ── Step 4: Mark loan as DISBURSING ──────────────────────────────────────
	if err := workflow.ExecuteActivity(ctx, MarkLoanDisbursingActivity, input.LoanID).Get(ctx, nil); err != nil {
		runCompensations(ctx, compensations, logger)
		return failLoan(input.LoanID, fmt.Sprintf("failed to mark disbursing: %v", err)), nil
	}
	compensations = append(compensations, func(ctx workflow.Context) error {
		return workflow.ExecuteActivity(ctx, MarkLoanFailedActivity, input.LoanID).Get(ctx, nil)
	})

	// ── Step 5: Execute external disbursement (Mojaloop / bank) ──────────────
	var transferResult ExternalTransferResult
	if err := workflow.ExecuteActivity(ctx, DisburseLoanExternallyActivity, ExternalTransferInput{
		LoanID:      input.LoanID,
		UserID:      input.UserID,
		Amount:      input.Amount,
		Currency:    input.Currency,
		Channel:     input.DisbursalMethod,
		Destination: input.Destination,
		Reference:   input.LoanID,
	}).Get(ctx, &transferResult); err != nil {
		runCompensations(ctx, compensations, logger)
		return failLoan(input.LoanID, fmt.Sprintf("external disbursement failed: %v", err)), nil
	}

	// ── Step 6: Commit TigerBeetle pending transfer ───────────────────────────
	if err := workflow.ExecuteActivity(ctx, CommitLoanDebitActivity, CommitDebitInput{
		PendingID: pendingResult.PendingID,
		Reference: transferResult.ExternalTxID,
	}).Get(ctx, nil); err != nil {
		_ = workflow.ExecuteActivity(ctx, AlertOpsActivity, AlertInput{
			Severity: "CRITICAL",
			Message:  fmt.Sprintf("Loan %s: external disbursement %s succeeded but TigerBeetle commit failed: %v", input.LoanID, transferResult.ExternalTxID, err),
		}).Get(ctx, nil)
	}

	// ── Step 7: Credit user's settlement account (loan proceeds) ─────────────
	var creditResult2 LedgerCreditResult
	_ = workflow.ExecuteActivity(ctx, CreditLoanProceedsActivity, LedgerCreditInput{
		UserID:    input.UserID,
		Amount:    int64(input.Amount),
		Reference: input.LoanID,
		Code:      7,
	}).Get(ctx, &creditResult2)

	// ── Step 8: Mark loan ACTIVE ──────────────────────────────────────────────
	repaymentDate := workflow.Now(ctx).AddDate(0, 0, input.TenorDays)
	_ = workflow.ExecuteActivity(ctx, MarkLoanActiveActivity, MarkLoanActiveInput{
		LoanID:        input.LoanID,
		LedgerTxID:    pendingResult.PendingID,
		ExternalTxID:  transferResult.ExternalTxID,
		RepaymentDate: repaymentDate,
	}).Get(ctx, nil)

	// ── Step 9: Emit Kafka event ───────────────────────────────────────────────
	_ = workflow.ExecuteActivity(ctx, EmitLoanKafkaEventActivity, KafkaEmitInput{
		Topic: "nexcom.banking.loan-disbursed",
		Payload: map[string]interface{}{
			"loan_id":        input.LoanID,
			"user_id":        input.UserID,
			"amount":         input.Amount,
			"currency":       input.Currency,
			"tenor_days":     input.TenorDays,
			"repayment_date": repaymentDate,
			"ledger_tx_id":   pendingResult.PendingID,
		},
	}).Get(ctx, nil)

	// ── Step 10: Ingest to Lakehouse ──────────────────────────────────────────
	_ = workflow.ExecuteActivity(ctx, IngestLoanToLakehouseActivity, LakehouseIngestInput{
		Table: "bronze.loans",
		Payload: map[string]interface{}{
			"loan_id":          input.LoanID,
			"user_id":          input.UserID,
			"amount":           input.Amount,
			"currency":         input.Currency,
			"interest_rate":    input.InterestRate,
			"tenor_days":       input.TenorDays,
			"collateral_type":  input.CollateralType,
			"collateral_id":    input.CollateralID,
			"collateral_hold":  collateralResult.HoldID,
			"ledger_tx_id":     pendingResult.PendingID,
			"external_tx_id":   transferResult.ExternalTxID,
			"repayment_date":   repaymentDate,
			"status":           "active",
		},
	}).Get(ctx, nil)

	logger.Info("LoanDisbursementWorkflow completed", "loan_id", input.LoanID)
	return &LoanDisbursementOutput{
		LoanID:           input.LoanID,
		Status:           "active",
		LedgerTxID:       pendingResult.PendingID,
		CollateralHoldID: collateralResult.HoldID,
		ExternalTxID:     transferResult.ExternalTxID,
		RepaymentDate:    repaymentDate,
		CompletedAt:      workflow.Now(ctx),
	}, nil
}

func runCompensations(ctx workflow.Context, compensations []func(workflow.Context) error, logger workflow.Logger) {
	for i := len(compensations) - 1; i >= 0; i-- {
		if err := compensations[i](ctx); err != nil {
			logger.Error("Compensation step failed", "index", i, "error", err)
		}
	}
}

func failLoan(loanID, reason string) *LoanDisbursementOutput {
	return &LoanDisbursementOutput{
		LoanID:        loanID,
		Status:        "failed",
		FailureReason: reason,
		CompletedAt:   time.Now(),
	}
}
