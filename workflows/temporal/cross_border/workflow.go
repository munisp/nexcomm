// Package cross_border implements the Temporal workflow for cross-border fund transfers
// using the Mojaloop ILP (Interledger Protocol) pattern:
//
//   Phase 1 — Quote:   GET /quotes from Mojaloop → receive ILP packet + condition
//   Phase 2 — Reserve: POST /transfers with RESERVED state → TigerBeetle code-2 pending
//   Phase 3 — Execute: POST /transfers with COMMITTED state → TigerBeetle code-12 commit
//   Phase 4 — Confirm: Emit Kafka + Fluvio + Lakehouse
//
// Compensation (saga rollback):
//   - POST /transfers with ABORTED state to Mojaloop
//   - TigerBeetle code-10 reversal
//   - Emit Kafka nexcom.cross_border.failed + Dapr alert
//
// Idempotency: workflow ID = "xborder-{transferId}"
package cross_border

import (
	"fmt"
	"time"

	"go.temporal.io/sdk/temporal"
	"go.temporal.io/sdk/workflow"
)

type CrossBorderInput struct {
	TransferID      string  `json:"transfer_id"`
	SenderUserID    string  `json:"sender_user_id"`
	ReceiverFSP     string  `json:"receiver_fsp"`
	ReceiverAccount string  `json:"receiver_account"`
	Amount          float64 `json:"amount"`
	SendCurrency    string  `json:"send_currency"`
	ReceiveCurrency string  `json:"receive_currency"`
	Note            string  `json:"note"`
	IdempotencyKey  string  `json:"idempotency_key"`
}

type CrossBorderResult struct {
	TransferID      string  `json:"transfer_id"`
	ILPPacket       string  `json:"ilp_packet"`
	ExchangeRate    float64 `json:"exchange_rate"`
	FeeAmount       float64 `json:"fee_amount"`
	TBTransferID    string  `json:"tb_transfer_id"`
	Status          string  `json:"status"`
	CompletedAt     string  `json:"completed_at"`
}

func CrossBorderWorkflow(ctx workflow.Context, input CrossBorderInput) (*CrossBorderResult, error) {
	logger := workflow.GetLogger(ctx)
	logger.Info("CrossBorderWorkflow started", "transferId", input.TransferID)

	retryPolicy := &temporal.RetryPolicy{
		InitialInterval:        2 * time.Second,
		BackoffCoefficient:     2.0,
		MaximumInterval:        60 * time.Second,
		MaximumAttempts:        3,
		NonRetryableErrorTypes: []string{"TRANSFER_REJECTED", "ACCOUNT_FROZEN", "SANCTIONS_BLOCKED"},
	}
	actCtx := workflow.WithActivityOptions(ctx, workflow.ActivityOptions{
		StartToCloseTimeout: 60 * time.Second,
		RetryPolicy:         retryPolicy,
	})

	result := &CrossBorderResult{TransferID: input.TransferID}

	// ── Phase 1: Sanctions screening ─────────────────────────────────────────
	var sanctionsClean bool
	if err := workflow.ExecuteActivity(actCtx, SanctionsScreeningActivity, input).Get(actCtx, &sanctionsClean); err != nil || !sanctionsClean {
		_ = workflow.ExecuteActivity(actCtx, EmitCrossBorderFailedActivity, input, "SANCTIONS_BLOCKED").Get(actCtx, nil)
		return nil, temporal.NewNonRetryableApplicationError("SANCTIONS_BLOCKED", "SANCTIONS_BLOCKED", nil)
	}

	// ── Phase 2: ILP Quote ────────────────────────────────────────────────────
	var quoteResult ILPQuoteResult
	if err := workflow.ExecuteActivity(actCtx, GetILPQuoteActivity, input).Get(actCtx, &quoteResult); err != nil {
		_ = workflow.ExecuteActivity(actCtx, EmitCrossBorderFailedActivity, input, "QUOTE_FAILED").Get(actCtx, nil)
		return nil, fmt.Errorf("ILP quote failed: %w", err)
	}
	result.ILPPacket = quoteResult.ILPPacket
	result.ExchangeRate = quoteResult.ExchangeRate
	result.FeeAmount = quoteResult.FeeAmount

	// ── Phase 3: Reserve funds (TigerBeetle code-2 pending) ──────────────────
	var tbTransferID string
	if err := workflow.ExecuteActivity(actCtx, ReserveFundsActivity, input, quoteResult).Get(actCtx, &tbTransferID); err != nil {
		_ = workflow.ExecuteActivity(actCtx, EmitCrossBorderFailedActivity, input, "RESERVE_FAILED").Get(actCtx, nil)
		return nil, fmt.Errorf("fund reservation failed: %w", err)
	}
	result.TBTransferID = tbTransferID

	// ── Phase 4: Execute Mojaloop transfer ───────────────────────────────────
	if err := workflow.ExecuteActivity(actCtx, ExecuteMojaloopTransferActivity, input, quoteResult).Get(actCtx, nil); err != nil {
		// Compensate: abort Mojaloop + reverse TigerBeetle
		_ = workflow.ExecuteActivity(actCtx, AbortMojaloopTransferActivity, input).Get(actCtx, nil)
		_ = workflow.ExecuteActivity(actCtx, ReverseFundsReservationActivity, tbTransferID, input).Get(actCtx, nil)
		_ = workflow.ExecuteActivity(actCtx, EmitCrossBorderFailedActivity, input, "EXECUTE_FAILED").Get(actCtx, nil)
		return nil, fmt.Errorf("Mojaloop transfer execution failed: %w", err)
	}

	// ── Phase 5: Commit TigerBeetle transfer (code-12) ───────────────────────
	if err := workflow.ExecuteActivity(actCtx, CommitCrossBorderTransferActivity, tbTransferID, input).Get(actCtx, nil); err != nil {
		logger.Warn("TigerBeetle commit failed after Mojaloop success — manual reconciliation required", "tbTransferID", tbTransferID)
		// Emit reconciliation alert — do NOT reverse (Mojaloop already executed)
		_ = workflow.ExecuteActivity(actCtx, EmitReconciliationAlertActivity, input, tbTransferID).Get(actCtx, nil)
	}

	// ── Phase 6: Emit events ──────────────────────────────────────────────────
	_ = workflow.ExecuteActivity(actCtx, EmitCrossBorderCompletedActivity, input, result).Get(actCtx, nil)
	_ = workflow.ExecuteActivity(actCtx, IngestCrossBorderToLakehouseActivity, input, result).Get(actCtx, nil)

	result.Status = "COMPLETED"
	result.CompletedAt = workflow.Now(ctx).UTC().Format(time.RFC3339)
	logger.Info("CrossBorderWorkflow completed", "transferId", input.TransferID)
	return result, nil
}
