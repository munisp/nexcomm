// Package deposit implements Temporal workflows for the deposit lifecycle.
// Orchestrates: KYC check → AML screening → TigerBeetle credit → Kafka event → Lakehouse ingest.
// Uses saga compensation to guarantee atomicity: any failure triggers full rollback.
package deposit

import (
	"fmt"
	"time"

	"go.temporal.io/sdk/temporal"
	"go.temporal.io/sdk/workflow"
)

// DepositInput is the input to the DepositWorkflow.
type DepositInput struct {
	DepositID   string  `json:"deposit_id"`
	UserID      string  `json:"user_id"`
	Amount      float64 `json:"amount"`       // in minor units (cents/kobo)
	Currency    string  `json:"currency"`     // e.g. "NGN"
	Channel     string  `json:"channel"`      // "stripe" | "mojaloop" | "bank_transfer"
	Reference   string  `json:"reference"`    // external payment reference
	CallbackURL string  `json:"callback_url"` // optional webhook on completion
}

// DepositOutput is the final result of the DepositWorkflow.
type DepositOutput struct {
	DepositID    string    `json:"deposit_id"`
	Status       string    `json:"status"` // "completed" | "failed" | "reversed"
	LedgerTxID   string    `json:"ledger_tx_id"`
	KafkaOffset  int64     `json:"kafka_offset"`
	LakehouseKey string    `json:"lakehouse_key"`
	CompletedAt  time.Time `json:"completed_at"`
	FailureReason string   `json:"failure_reason,omitempty"`
}

// DepositWorkflow is the durable, idempotent deposit saga.
// Compensation steps run in reverse order on any failure.
func DepositWorkflow(ctx workflow.Context, input DepositInput) (*DepositOutput, error) {
	logger := workflow.GetLogger(ctx)
	logger.Info("DepositWorkflow started", "deposit_id", input.DepositID, "user_id", input.UserID)

	retryPolicy := &temporal.RetryPolicy{
		InitialInterval:    2 * time.Second,
		BackoffCoefficient: 2.0,
		MaximumInterval:    30 * time.Second,
		MaximumAttempts:    5,
		NonRetryableErrorTypes: []string{
			"KYCFailedError",
			"AMLBlockedError",
			"DuplicateDepositError",
			"InvalidAmountError",
		},
	}

	ao := workflow.ActivityOptions{
		StartToCloseTimeout: 2 * time.Minute,
		RetryPolicy:         retryPolicy,
	}
	ctx = workflow.WithActivityOptions(ctx, ao)

	// ── Saga compensation stack ────────────────────────────────────────────────
	var compensations []func(workflow.Context) error

	// ── Step 1: Idempotency check (prevent double-credit) ─────────────────────
	var idempotencyResult IdempotencyCheckResult
	if err := workflow.ExecuteActivity(ctx, CheckDepositIdempotencyActivity, input.DepositID).Get(ctx, &idempotencyResult); err != nil {
		return failDeposit(input.DepositID, fmt.Sprintf("idempotency check failed: %v", err)), nil
	}
	if idempotencyResult.AlreadyProcessed {
		logger.Info("Deposit already processed — returning cached result", "deposit_id", input.DepositID)
		return &DepositOutput{
			DepositID:   input.DepositID,
			Status:      "completed",
			LedgerTxID:  idempotencyResult.LedgerTxID,
			CompletedAt: idempotencyResult.ProcessedAt,
		}, nil
	}

	// ── Step 2: KYC / compliance check ────────────────────────────────────────
	var kycResult KYCCheckResult
	if err := workflow.ExecuteActivity(ctx, CheckKYCStatusActivity, input.UserID).Get(ctx, &kycResult); err != nil {
		return failDeposit(input.DepositID, fmt.Sprintf("KYC check error: %v", err)), nil
	}
	if !kycResult.Approved {
		return failDeposit(input.DepositID, fmt.Sprintf("KYC not approved: %s", kycResult.Reason)), nil
	}

	// ── Step 3: AML velocity check ────────────────────────────────────────────
	var amlResult AMLCheckResult
	if err := workflow.ExecuteActivity(ctx, AMLVelocityCheckActivity, AMLCheckInput{
		UserID:    input.UserID,
		Amount:    input.Amount,
		Currency:  input.Currency,
		Direction: "credit",
	}).Get(ctx, &amlResult); err != nil {
		return failDeposit(input.DepositID, fmt.Sprintf("AML check error: %v", err)), nil
	}
	if amlResult.Blocked {
		return failDeposit(input.DepositID, fmt.Sprintf("AML blocked: %s", amlResult.Reason)), nil
	}

	// ── Step 4: Mark deposit as PROCESSING (DB state) ─────────────────────────
	if err := workflow.ExecuteActivity(ctx, MarkDepositProcessingActivity, input.DepositID).Get(ctx, nil); err != nil {
		return failDeposit(input.DepositID, fmt.Sprintf("failed to mark processing: %v", err)), nil
	}
	compensations = append(compensations, func(ctx workflow.Context) error {
		return workflow.ExecuteActivity(ctx, MarkDepositFailedActivity, input.DepositID).Get(ctx, nil)
	})

	// ── Step 5: TigerBeetle credit (settlement account) ───────────────────────
	var ledgerResult LedgerCreditResult
	if err := workflow.ExecuteActivity(ctx, CreditSettlementAccountActivity, LedgerCreditInput{
		UserID:    input.UserID,
		Amount:    int64(input.Amount),
		Reference: input.DepositID,
		Code:      6, // TransferDeposit
	}).Get(ctx, &ledgerResult); err != nil {
		runCompensations(ctx, compensations, logger)
		return failDeposit(input.DepositID, fmt.Sprintf("ledger credit failed: %v", err)), nil
	}
	compensations = append(compensations, func(ctx workflow.Context) error {
		return workflow.ExecuteActivity(ctx, ReverseLedgerCreditActivity, ledgerResult.TransferID).Get(ctx, nil)
	})

	// ── Step 6: Mark deposit as COMPLETED (DB state) ──────────────────────────
	if err := workflow.ExecuteActivity(ctx, MarkDepositCompletedActivity, MarkDepositCompletedInput{
		DepositID:  input.DepositID,
		LedgerTxID: ledgerResult.TransferID,
	}).Get(ctx, nil); err != nil {
		runCompensations(ctx, compensations, logger)
		return failDeposit(input.DepositID, fmt.Sprintf("failed to mark completed: %v", err)), nil
	}

	// ── Step 7: Emit Kafka event (nexcom.banking.deposit-completed) ───────────
	var kafkaResult KafkaEmitResult
	_ = workflow.ExecuteActivity(ctx, EmitDepositKafkaEventActivity, KafkaEmitInput{
		Topic:   "nexcom.banking.deposit-completed",
		Payload: map[string]interface{}{
			"deposit_id":   input.DepositID,
			"user_id":      input.UserID,
			"amount":       input.Amount,
			"currency":     input.Currency,
			"channel":      input.Channel,
			"ledger_tx_id": ledgerResult.TransferID,
		},
	}).Get(ctx, &kafkaResult) // non-fatal: Kafka failure does not roll back the deposit

	// ── Step 8: Emit Fluvio real-time event ───────────────────────────────────
	_ = workflow.ExecuteActivity(ctx, EmitFluvioEventActivity, FluvioEmitInput{
		Topic:   "nexcom.banking.payment-received",
		Payload: map[string]interface{}{
			"user_id":  input.UserID,
			"amount":   input.Amount,
			"currency": input.Currency,
			"channel":  input.Channel,
		},
	}).Get(ctx, nil) // non-fatal

	// ── Step 9: Ingest to Lakehouse (immutable audit trail) ───────────────────
	var lakehouseResult LakehouseIngestResult
	_ = workflow.ExecuteActivity(ctx, IngestDepositToLakehouseActivity, LakehouseIngestInput{
		Table:   "bronze.deposits",
		Payload: map[string]interface{}{
			"deposit_id":   input.DepositID,
			"user_id":      input.UserID,
			"amount":       input.Amount,
			"currency":     input.Currency,
			"channel":      input.Channel,
			"reference":    input.Reference,
			"ledger_tx_id": ledgerResult.TransferID,
			"status":       "completed",
		},
	}).Get(ctx, &lakehouseResult) // non-fatal

	// ── Step 10: Push notification to user ────────────────────────────────────
	_ = workflow.ExecuteActivity(ctx, SendDepositNotificationActivity, NotificationInput{
		UserID:  input.UserID,
		Title:   "Deposit Confirmed",
		Message: fmt.Sprintf("%.2f %s has been credited to your account.", input.Amount/100, input.Currency),
		Channel: "push",
	}).Get(ctx, nil) // non-fatal

	logger.Info("DepositWorkflow completed", "deposit_id", input.DepositID, "ledger_tx_id", ledgerResult.TransferID)
	return &DepositOutput{
		DepositID:    input.DepositID,
		Status:       "completed",
		LedgerTxID:   ledgerResult.TransferID,
		KafkaOffset:  kafkaResult.Offset,
		LakehouseKey: lakehouseResult.Key,
		CompletedAt:  workflow.Now(ctx),
	}, nil
}

// runCompensations executes all registered compensation functions in LIFO order.
func runCompensations(ctx workflow.Context, compensations []func(workflow.Context) error, logger workflow.Logger) {
	for i := len(compensations) - 1; i >= 0; i-- {
		if err := compensations[i](ctx); err != nil {
			logger.Error("Compensation step failed", "index", i, "error", err)
		}
	}
}

func failDeposit(depositID, reason string) *DepositOutput {
	return &DepositOutput{
		DepositID:     depositID,
		Status:        "failed",
		FailureReason: reason,
		CompletedAt:   time.Now(),
	}
}
