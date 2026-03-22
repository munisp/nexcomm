// Package settlement implements Temporal workflows for the settlement process.
// Orchestrates: ledger reservation → Mojaloop transfer → blockchain confirmation → finalization.
package settlement

import (
	"fmt"
	"time"

	"go.temporal.io/sdk/temporal"
	"go.temporal.io/sdk/workflow"
)

// SettlementInput represents the input to start a settlement workflow
type SettlementInput struct {
	TradeID        string  `json:"trade_id"`
	BuyerID        string  `json:"buyer_id"`
	SellerID       string  `json:"seller_id"`
	Symbol         string  `json:"symbol"`
	Quantity       float64 `json:"quantity"`
	Price          float64 `json:"price"`
	SettlementType string  `json:"settlement_type"` // "blockchain_t0" or "traditional_t2"
}

// SettlementOutput represents the final settlement result
type SettlementOutput struct {
	SettlementID string    `json:"settlement_id"`
	Status       string    `json:"status"`
	LedgerTxID   string    `json:"ledger_tx_id"`
	MojaloopID   string    `json:"mojaloop_id,omitempty"`
	BlockchainTx string    `json:"blockchain_tx,omitempty"`
	SettledAt    time.Time `json:"settled_at"`
}

// SettlementWorkflow orchestrates the full settlement lifecycle
func SettlementWorkflow(ctx workflow.Context, input SettlementInput) (*SettlementOutput, error) {
	logger := workflow.GetLogger(ctx)
	logger.Info("Starting settlement workflow", "trade_id", input.TradeID)

	activityOpts := workflow.ActivityOptions{
		StartToCloseTimeout: 2 * time.Minute,
		RetryPolicy: &temporal.RetryPolicy{
			InitialInterval:    2 * time.Second,
			BackoffCoefficient: 2.0,
			MaximumInterval:    time.Minute,
			MaximumAttempts:    5,
		},
	}
	ctx = workflow.WithActivityOptions(ctx, activityOpts)

	totalValue := input.Quantity * input.Price

	// Step 1: Reserve funds in TigerBeetle (pending transfer)
	var ledgerResult LedgerReservationResult
	err := workflow.ExecuteActivity(ctx, ReserveFundsActivity, ReserveFundsInput{
		BuyerID:  input.BuyerID,
		SellerID: input.SellerID,
		Amount:   totalValue,
		TradeID:  input.TradeID,
	}).Get(ctx, &ledgerResult)
	if err != nil {
		return nil, fmt.Errorf("fund reservation failed: %w", err)
	}

	// Step 2: Branch based on settlement type
	var blockchainTx string
	if input.SettlementType == "blockchain_t0" {
		// T+0: On-chain settlement via smart contract
		var chainResult BlockchainSettleResult
		err = workflow.ExecuteActivity(ctx, BlockchainSettleActivity, BlockchainSettleInput{
			TradeID:  input.TradeID,
			BuyerID:  input.BuyerID,
			SellerID: input.SellerID,
			Symbol:   input.Symbol,
			Quantity: input.Quantity,
			Price:    input.Price,
		}).Get(ctx, &chainResult)
		if err != nil {
			// Rollback: void the pending transfer
			_ = workflow.ExecuteActivity(ctx, VoidReservationActivity, ledgerResult.TransferID).Get(ctx, nil)
			return nil, fmt.Errorf("blockchain settlement failed: %w", err)
		}
		blockchainTx = chainResult.TxHash
	}

	// Step 3: Finalize the TigerBeetle transfer (pending → posted)
	err = workflow.ExecuteActivity(ctx, PostTransferActivity, ledgerResult.TransferID).Get(ctx, nil)
	if err != nil {
		return nil, fmt.Errorf("transfer posting failed: %w", err)
	}

	// Step 4: Process via Mojaloop if cross-DFSP
	var mojaloopID string
	if needsMojaloopSettlement(input) {
		var mojResult MojaloopResult
		err = workflow.ExecuteActivity(ctx, MojaloopSettleActivity, MojaloopSettleInput{
			TradeID:  input.TradeID,
			BuyerID:  input.BuyerID,
			SellerID: input.SellerID,
			Amount:   totalValue,
		}).Get(ctx, &mojResult)
		if err != nil {
			logger.Warn("Mojaloop settlement failed, manual resolution needed", "error", err)
		} else {
			mojaloopID = mojResult.TransferID
		}
	}

	// Step 5: Send settlement confirmation
	_ = workflow.ExecuteActivity(ctx, SendSettlementConfirmationActivity, SettlementConfirmInput{
		TradeID:  input.TradeID,
		BuyerID:  input.BuyerID,
		SellerID: input.SellerID,
		Status:   "settled",
	}).Get(ctx, nil)

	return &SettlementOutput{
		SettlementID: ledgerResult.TransferID,
		Status:       "settled",
		LedgerTxID:   ledgerResult.TransferID,
		MojaloopID:   mojaloopID,
		BlockchainTx: blockchainTx,
		SettledAt:    workflow.Now(ctx),
	}, nil
}

func needsMojaloopSettlement(input SettlementInput) bool {
	// In production: check if buyer and seller are in different DFSPs
	return false
}

// --- Activity Input/Output Types ---

type ReserveFundsInput struct {
	BuyerID  string  `json:"buyer_id"`
	SellerID string  `json:"seller_id"`
	Amount   float64 `json:"amount"`
	TradeID  string  `json:"trade_id"`
}

type LedgerReservationResult struct {
	TransferID string `json:"transfer_id"`
	Status     string `json:"status"`
}

type BlockchainSettleInput struct {
	TradeID  string  `json:"trade_id"`
	BuyerID  string  `json:"buyer_id"`
	SellerID string  `json:"seller_id"`
	Symbol   string  `json:"symbol"`
	Quantity float64 `json:"quantity"`
	Price    float64 `json:"price"`
}

type BlockchainSettleResult struct {
	TxHash string `json:"tx_hash"`
	Status string `json:"status"`
}

type MojaloopSettleInput struct {
	TradeID  string  `json:"trade_id"`
	BuyerID  string  `json:"buyer_id"`
	SellerID string  `json:"seller_id"`
	Amount   float64 `json:"amount"`
}

type MojaloopResult struct {
	TransferID string `json:"transfer_id"`
	Status     string `json:"status"`
}

type SettlementConfirmInput struct {
	TradeID  string `json:"trade_id"`
	BuyerID  string `json:"buyer_id"`
	SellerID string `json:"seller_id"`
	Status   string `json:"status"`
}
