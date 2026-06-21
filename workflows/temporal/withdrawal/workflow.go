// Package withdrawal implements Temporal workflows for the withdrawal lifecycle.
// Orchestrates: balance check → AML screening → TigerBeetle debit (pending) →
// Mojaloop/bank transfer → TigerBeetle commit → Kafka event → Lakehouse ingest.
// Uses saga compensation to guarantee atomicity.
package withdrawal

import (
	"fmt"
	"time"

	"go.temporal.io/sdk/temporal"
	"go.temporal.io/sdk/workflow"
)

// WithdrawalInput is the input to the WithdrawalWorkflow.
type WithdrawalInput struct {
	WithdrawalID  string  `json:"withdrawal_id"`
	UserID        string  `json:"user_id"`
	Amount        float64 `json:"amount"`    // minor units
	Currency      string  `json:"currency"`
	Channel       string  `json:"channel"`   // "mojaloop" | "bank_transfer" | "mobile_money"
	Destination   string  `json:"destination"` // account number / phone / IBAN
	BankCode      string  `json:"bank_code"`
	Reference     string  `json:"reference"`
}

// WithdrawalOutput is the final result of the WithdrawalWorkflow.
type WithdrawalOutput struct {
	WithdrawalID  string    `json:"withdrawal_id"`
	Status        string    `json:"status"` // "completed" | "failed" | "reversed"
	LedgerTxID    string    `json:"ledger_tx_id"`
	MojaloopTxID  string    `json:"mojaloop_tx_id,omitempty"`
	CompletedAt   time.Time `json:"completed_at"`
	FailureReason string    `json:"failure_reason,omitempty"`
}

// WithdrawalWorkflow is the durable, idempotent withdrawal saga.
func WithdrawalWorkflow(ctx workflow.Context, input WithdrawalInput) (*WithdrawalOutput, error) {
	logger := workflow.GetLogger(ctx)
	logger.Info("WithdrawalWorkflow started", "withdrawal_id", input.WithdrawalID)

	retryPolicy := &temporal.RetryPolicy{
		InitialInterval:    2 * time.Second,
		BackoffCoefficient: 2.0,
		MaximumInterval:    60 * time.Second,
		MaximumAttempts:    5,
		NonRetryableErrorTypes: []string{
			"InsufficientFundsError",
			"AMLBlockedError",
			"KYCFailedError",
			"DuplicateWithdrawalError",
		},
	}
	ao := workflow.ActivityOptions{
		StartToCloseTimeout: 3 * time.Minute,
		RetryPolicy:         retryPolicy,
	}
	ctx = workflow.WithActivityOptions(ctx, ao)

	var compensations []func(workflow.Context) error

	// ── Step 1: Idempotency check ─────────────────────────────────────────────
	var idempotencyResult IdempotencyCheckResult
	if err := workflow.ExecuteActivity(ctx, CheckWithdrawalIdempotencyActivity, input.WithdrawalID).Get(ctx, &idempotencyResult); err == nil && idempotencyResult.AlreadyProcessed {
		return &WithdrawalOutput{
			WithdrawalID: input.WithdrawalID,
			Status:       "completed",
			LedgerTxID:   idempotencyResult.LedgerTxID,
			CompletedAt:  idempotencyResult.ProcessedAt,
		}, nil
	}

	// ── Step 2: Balance check ─────────────────────────────────────────────────
	var balanceResult BalanceCheckResult
	if err := workflow.ExecuteActivity(ctx, CheckBalanceActivity, BalanceCheckInput{
		UserID:   input.UserID,
		Amount:   input.Amount,
		Currency: input.Currency,
	}).Get(ctx, &balanceResult); err != nil {
		return failWithdrawal(input.WithdrawalID, fmt.Sprintf("balance check error: %v", err)), nil
	}
	if !balanceResult.Sufficient {
		return failWithdrawal(input.WithdrawalID, "insufficient funds"), nil
	}

	// ── Step 3: AML velocity check ────────────────────────────────────────────
	var amlResult AMLCheckResult
	if err := workflow.ExecuteActivity(ctx, AMLVelocityCheckActivity, AMLCheckInput{
		UserID:    input.UserID,
		Amount:    input.Amount,
		Currency:  input.Currency,
		Direction: "debit",
	}).Get(ctx, &amlResult); err == nil && amlResult.Blocked {
		return failWithdrawal(input.WithdrawalID, fmt.Sprintf("AML blocked: %s", amlResult.Reason)), nil
	}

	// ── Step 4: TigerBeetle pending debit (reserve funds) ────────────────────
	var pendingResult PendingTransferResult
	if err := workflow.ExecuteActivity(ctx, CreatePendingDebitActivity, PendingDebitInput{
		UserID:    input.UserID,
		Amount:    int64(input.Amount),
		Reference: input.WithdrawalID,
		Code:      5, // TransferWithdrawal
	}).Get(ctx, &pendingResult); err != nil {
		return failWithdrawal(input.WithdrawalID, fmt.Sprintf("fund reservation failed: %v", err)), nil
	}
	compensations = append(compensations, func(ctx workflow.Context) error {
		return workflow.ExecuteActivity(ctx, VoidPendingDebitActivity, pendingResult.PendingID).Get(ctx, nil)
	})

	// ── Step 5: Mark withdrawal as PROCESSING ─────────────────────────────────
	if err := workflow.ExecuteActivity(ctx, MarkWithdrawalProcessingActivity, input.WithdrawalID).Get(ctx, nil); err != nil {
		runCompensations(ctx, compensations, logger)
		return failWithdrawal(input.WithdrawalID, fmt.Sprintf("failed to mark processing: %v", err)), nil
	}
	compensations = append(compensations, func(ctx workflow.Context) error {
		return workflow.ExecuteActivity(ctx, MarkWithdrawalFailedActivity, input.WithdrawalID).Get(ctx, nil)
	})

	// ── Step 6: Execute external transfer (Mojaloop / bank) ──────────────────
	var transferResult ExternalTransferResult
	if err := workflow.ExecuteActivity(ctx, ExecuteExternalTransferActivity, ExternalTransferInput{
		WithdrawalID: input.WithdrawalID,
		UserID:       input.UserID,
		Amount:       input.Amount,
		Currency:     input.Currency,
		Channel:      input.Channel,
		Destination:  input.Destination,
		BankCode:     input.BankCode,
		Reference:    input.Reference,
	}).Get(ctx, &transferResult); err != nil {
		runCompensations(ctx, compensations, logger)
		return failWithdrawal(input.WithdrawalID, fmt.Sprintf("external transfer failed: %v", err)), nil
	}

	// ── Step 7: Commit TigerBeetle pending transfer ───────────────────────────
	if err := workflow.ExecuteActivity(ctx, CommitPendingDebitActivity, CommitDebitInput{
		PendingID: pendingResult.PendingID,
		Reference: transferResult.ExternalTxID,
	}).Get(ctx, nil); err != nil {
		// External transfer succeeded but ledger commit failed — critical: alert ops
		_ = workflow.ExecuteActivity(ctx, AlertOpsActivity, AlertInput{
			Severity: "CRITICAL",
			Message:  fmt.Sprintf("Withdrawal %s: external transfer %s succeeded but TigerBeetle commit failed: %v", input.WithdrawalID, transferResult.ExternalTxID, err),
		}).Get(ctx, nil)
		// Still mark completed since funds were sent
	}

	// ── Step 8: Mark withdrawal COMPLETED ─────────────────────────────────────
	_ = workflow.ExecuteActivity(ctx, MarkWithdrawalCompletedActivity, MarkWithdrawalCompletedInput{
		WithdrawalID: input.WithdrawalID,
		LedgerTxID:   pendingResult.PendingID,
		ExternalTxID: transferResult.ExternalTxID,
	}).Get(ctx, nil)

	// ── Step 9: Emit Kafka event ───────────────────────────────────────────────
	_ = workflow.ExecuteActivity(ctx, EmitWithdrawalKafkaEventActivity, KafkaEmitInput{
		Topic: "nexcom.banking.withdrawal-completed",
		Payload: map[string]interface{}{
			"withdrawal_id":  input.WithdrawalID,
			"user_id":        input.UserID,
			"amount":         input.Amount,
			"currency":       input.Currency,
			"channel":        input.Channel,
			"external_tx_id": transferResult.ExternalTxID,
			"ledger_tx_id":   pendingResult.PendingID,
		},
	}).Get(ctx, nil)

	// ── Step 10: Emit Fluvio real-time event ──────────────────────────────────
	_ = workflow.ExecuteActivity(ctx, EmitFluvioEventActivity, FluvioEmitInput{
		Topic: "nexcom.banking.payment-sent",
		Payload: map[string]interface{}{
			"user_id":  input.UserID,
			"amount":   input.Amount,
			"currency": input.Currency,
			"channel":  input.Channel,
		},
	}).Get(ctx, nil)

	// ── Step 11: Ingest to Lakehouse ──────────────────────────────────────────
	_ = workflow.ExecuteActivity(ctx, IngestWithdrawalToLakehouseActivity, LakehouseIngestInput{
		Table: "bronze.withdrawals",
		Payload: map[string]interface{}{
			"withdrawal_id":  input.WithdrawalID,
			"user_id":        input.UserID,
			"amount":         input.Amount,
			"currency":       input.Currency,
			"channel":        input.Channel,
			"external_tx_id": transferResult.ExternalTxID,
			"ledger_tx_id":   pendingResult.PendingID,
			"status":         "completed",
		},
	}).Get(ctx, nil)

	logger.Info("WithdrawalWorkflow completed", "withdrawal_id", input.WithdrawalID)
	return &WithdrawalOutput{
		WithdrawalID: input.WithdrawalID,
		Status:       "completed",
		LedgerTxID:   pendingResult.PendingID,
		MojaloopTxID: transferResult.ExternalTxID,
		CompletedAt:  workflow.Now(ctx),
	}, nil
}

func runCompensations(ctx workflow.Context, compensations []func(workflow.Context) error, logger workflow.Logger) {
	for i := len(compensations) - 1; i >= 0; i-- {
		if err := compensations[i](ctx); err != nil {
			logger.Error("Compensation step failed", "index", i, "error", err)
		}
	}
}

func failWithdrawal(withdrawalID, reason string) *WithdrawalOutput {
	return &WithdrawalOutput{
		WithdrawalID:  withdrawalID,
		Status:        "failed",
		FailureReason: reason,
		CompletedAt:   time.Now(),
	}
}
