package workflows

import (
	"fmt"
	"time"

	"go.temporal.io/sdk/temporal"
	"go.temporal.io/sdk/workflow"

	"github.com/munisp/nexcomm/journey-orchestrator/internal/activities"
)

// ─────────────────────────────────────────────────────────────────────────────
// JOURNEY 6: TradeSettlementWorkflow (T+2 DvP)
// Stakeholder: Exchange clearing house settling a completed trade.
// Services: TigerBeetle (2-phase commit) → Settlement engine → Blockchain DvP →
//           Mojaloop (if cross-FSP) → Notification → Lakehouse
// Reuse: Called by SpotTradeWorkflow, FuturesSettlementWorkflow, CorporateActionWorkflow
// ─────────────────────────────────────────────────────────────────────────────

type TradeSettlementInput struct {
	SettlementID string  `json:"settlement_id"`
	TradeID      string  `json:"trade_id"`
	BuyerID      string  `json:"buyer_id"`
	SellerID     string  `json:"seller_id"`
	Symbol       string  `json:"symbol"`
	QuantityKg   float64 `json:"quantity_kg"`
	PriceNGN     float64 `json:"price_ngn"`
	GrossAmount  float64 `json:"gross_amount"`
	Currency     string  `json:"currency"`
	SettlementType string `json:"settlement_type"` // "T0_BLOCKCHAIN" | "T2_TRADITIONAL"
}

type TradeSettlementResult struct {
	SettlementID    string `json:"settlement_id"`
	Status          string `json:"status"` // "SETTLED" | "FAILED" | "REVERSED"
	LedgerTxID      string `json:"ledger_tx_id"`
	BlockchainTxHash string `json:"blockchain_tx_hash,omitempty"`
	MojaloopTxID    string `json:"mojaloop_tx_id,omitempty"`
	SettledAt       time.Time `json:"settled_at"`
}

func TradeSettlementWorkflow(ctx workflow.Context, input TradeSettlementInput) (*TradeSettlementResult, error) {
	logger := workflow.GetLogger(ctx)
	logger.Info("TradeSettlementWorkflow started", "settlement_id", input.SettlementID)

	ctx5m := activityOpts(ctx, 5*time.Minute)
	ctx2m := activityOpts(ctx, 2*time.Minute)
	ctx30s := activityOpts(ctx, 30*time.Second)

	result := &TradeSettlementResult{SettlementID: input.SettlementID}

	// Step 1: Create pending TigerBeetle transfer (2-phase)
	var pendingTxID string
	if err := workflow.ExecuteActivity(ctx2m, activities.CreatePendingTransfer, activities.PendingTransferInput{
		DebitAccountID:  fmt.Sprintf("user-settlement-%s", input.BuyerID),
		CreditAccountID: fmt.Sprintf("user-settlement-%s", input.SellerID),
		Amount:          int64(input.GrossAmount * 100), // NGN → kobo
		Code:            1, // TransferSettlement
		Reference:       input.SettlementID,
	}).Get(ctx, &pendingTxID); err != nil {
		return nil, fmt.Errorf("create pending transfer: %w", err)
	}

	// Step 2: Validate both parties have sufficient balances
	var buyerBalanceOK, sellerBalanceOK bool
	workflow.ExecuteActivity(ctx30s, activities.CheckSufficientBalance, activities.BalanceCheckInput{
		UserID: input.BuyerID, RequiredAmount: input.GrossAmount, Currency: input.Currency,
	}).Get(ctx, &buyerBalanceOK)

	if !buyerBalanceOK {
		// Void pending transfer
		workflow.ExecuteActivity(ctx30s, activities.VoidPendingTransfer, pendingTxID)
		result.Status = "FAILED"
		workflow.ExecuteActivity(ctx30s, activities.SendNotification, activities.NotificationInput{
			UserID: input.BuyerID, Channel: "email",
			Title: "Settlement Failed", Message: "Insufficient funds for settlement. Please top up your account.",
		})
		return result, nil
	}
	_ = sellerBalanceOK

	// Step 3: Commit TigerBeetle transfer
	var ledgerTxID string
	if err := workflow.ExecuteActivity(ctx2m, activities.CommitPendingTransfer, pendingTxID).Get(ctx, &ledgerTxID); err != nil {
		// Compensation: void pending transfer
		workflow.ExecuteActivity(ctx30s, activities.VoidPendingTransfer, pendingTxID)
		return nil, fmt.Errorf("commit transfer: %w", err)
	}
	result.LedgerTxID = ledgerTxID

	// Step 4: Blockchain DvP (T+0 only)
	if input.SettlementType == "T0_BLOCKCHAIN" {
		var dvpResult activities.DvPResult
		if err := workflow.ExecuteActivity(ctx5m, activities.ExecuteBlockchainDvP, activities.DvPInput{
			TradeID: input.TradeID, BuyerID: input.BuyerID, SellerID: input.SellerID,
			Symbol: input.Symbol, QuantityKg: input.QuantityKg, PriceNGN: input.PriceNGN,
		}).Get(ctx, &dvpResult); err != nil {
			logger.Warn("Blockchain DvP failed (non-fatal)", "error", err)
		} else {
			result.BlockchainTxHash = dvpResult.TxHash
		}
	}

	// Step 5: Fee collection (0.1% to exchange-fee account)
	feeAmount := int64(input.GrossAmount * 0.001 * 100) // 0.1% in kobo
	workflow.ExecuteActivity(ctx30s, activities.CollectTradingFee, activities.FeeInput{
		SellerID: input.SellerID, Amount: feeAmount, TradeID: input.TradeID,
	})

	// Step 6: Notify both parties
	workflow.ExecuteActivity(ctx30s, activities.SendNotification, activities.NotificationInput{
		UserID: input.BuyerID, Channel: "push",
		Title: "Settlement Complete",
		Message: fmt.Sprintf("Trade %s settled. ₦%.2f debited from your account.", input.TradeID, input.GrossAmount),
	})
	workflow.ExecuteActivity(ctx30s, activities.SendNotification, activities.NotificationInput{
		UserID: input.SellerID, Channel: "push",
		Title: "Settlement Complete",
		Message: fmt.Sprintf("Trade %s settled. ₦%.2f credited to your account.", input.TradeID, input.GrossAmount),
	})

	// Step 7: Ingest to Lakehouse
	workflow.ExecuteActivity(ctx30s, activities.IngestToLakehouse, activities.LakehouseInput{
		Topic: "nexcom.settlement.completed",
		Record: map[string]interface{}{
			"settlement_id": input.SettlementID, "trade_id": input.TradeID,
			"buyer_id": input.BuyerID, "seller_id": input.SellerID,
			"gross_amount": input.GrossAmount, "currency": input.Currency,
			"ledger_tx_id": result.LedgerTxID, "blockchain_tx_hash": result.BlockchainTxHash,
			"settlement_type": input.SettlementType, "settled_at": workflow.Now(ctx),
		},
	})

	result.Status = "SETTLED"
	result.SettledAt = workflow.Now(ctx)
	return result, nil
}

// ─────────────────────────────────────────────────────────────────────────────
// JOURNEY 7: FuturesTradingWorkflow
// Stakeholder: Institutional trader placing a futures contract.
// Services: Pre-trade risk → Margin calculation → TigerBeetle (margin reserve) →
//           Matching engine (futures) → Clearing → Notification → Lakehouse
// Reuse: Called by institutional portal, broker routing, algorithmic trading
// ─────────────────────────────────────────────────────────────────────────────

type FuturesTradingInput struct {
	TraderID      string  `json:"trader_id"`
	ContractSymbol string `json:"contract_symbol"` // e.g. "MAIZE-DEC25"
	Side          string  `json:"side"` // "BUY" | "SELL"
	Contracts     int     `json:"contracts"` // number of standard contracts
	OrderType     string  `json:"order_type"` // "MARKET" | "LIMIT"
	LimitPrice    float64 `json:"limit_price,omitempty"`
	IdempotencyKey string `json:"idempotency_key"`
}

type FuturesTradingResult struct {
	OrderID          string  `json:"order_id"`
	FilledContracts  int     `json:"filled_contracts"`
	AvgPrice         float64 `json:"avg_price"`
	InitialMarginNGN float64 `json:"initial_margin_ngn"`
	MarginAccountID  string  `json:"margin_account_id"`
	Status           string  `json:"status"`
	CompletedAt      time.Time `json:"completed_at"`
}

func FuturesTradingWorkflow(ctx workflow.Context, input FuturesTradingInput) (*FuturesTradingResult, error) {
	logger := workflow.GetLogger(ctx)
	logger.Info("FuturesTradingWorkflow started", "trader_id", input.TraderID, "contract", input.ContractSymbol)

	ctx2m := activityOpts(ctx, 2*time.Minute)
	ctx30s := activityOpts(ctx, 30*time.Second)

	result := &FuturesTradingResult{}

	// Step 1: Get margin requirements for this contract
	var marginReq activities.MarginRequirementResult
	if err := workflow.ExecuteActivity(ctx2m, activities.GetMarginRequirements, activities.MarginReqInput{
		AccountID: input.TraderID, Symbol: input.ContractSymbol, Contracts: input.Contracts,
	}).Get(ctx, &marginReq); err != nil {
		return nil, fmt.Errorf("get margin requirements: %w", err)
	}
	result.InitialMarginNGN = marginReq.InitialMargin

	// Step 2: Verify sufficient margin balance
	var balanceOK bool
	if err := workflow.ExecuteActivity(ctx30s, activities.CheckSufficientBalance, activities.BalanceCheckInput{
		UserID: input.TraderID, RequiredAmount: marginReq.InitialMargin, Currency: "NGN",
	}).Get(ctx, &balanceOK); err != nil || !balanceOK {
		return nil, temporal.NewApplicationError("InvalidInputError", "INSUFFICIENT_MARGIN", "Insufficient margin balance")
	}

	// Step 3: Reserve initial margin (TigerBeetle pending)
	var marginReserveID string
	if err := workflow.ExecuteActivity(ctx2m, activities.ReserveMargin, activities.MarginReserveInput{
		TraderID: input.TraderID, Amount: marginReq.InitialMargin,
		Symbol: input.ContractSymbol, Reference: input.IdempotencyKey,
	}).Get(ctx, &marginReserveID); err != nil {
		return nil, fmt.Errorf("reserve margin: %w", err)
	}
	result.MarginAccountID = marginReserveID

	// Step 4: Place futures order on matching engine
	var orderResult activities.OrderActivityResult
	if err := workflow.ExecuteActivity(ctx2m, activities.PlaceOrder, activities.OrderInput{
		AccountID: input.TraderID, Symbol: input.ContractSymbol,
		Side: input.Side, OrderType: input.OrderType,
		Quantity: float64(input.Contracts), Price: input.LimitPrice,
	}).Get(ctx, &orderResult); err != nil {
		// Compensation: release margin
		workflow.ExecuteActivity(ctx30s, activities.ReleaseFunds, marginReserveID)
		return nil, fmt.Errorf("place futures order: %w", err)
	}
	result.OrderID = orderResult.OrderID
	result.FilledContracts = int(orderResult.FilledQuantity)
	result.AvgPrice = orderResult.AveragePrice
	result.Status = orderResult.Status

	// Step 5: Commit margin reservation
	workflow.ExecuteActivity(ctx30s, activities.CommitMarginReservation, marginReserveID)

	// Step 6: Notify trader
	workflow.ExecuteActivity(ctx30s, activities.SendNotification, activities.NotificationInput{
		UserID: input.TraderID, Channel: "push",
		Title: "Futures Order Executed",
		Message: fmt.Sprintf("%s %d contracts %s @ %.2f. Margin reserved: ₦%.2f",
			input.Side, result.FilledContracts, input.ContractSymbol, result.AvgPrice, result.InitialMarginNGN),
	})

	// Step 7: Ingest to Lakehouse
	workflow.ExecuteActivity(ctx30s, activities.IngestToLakehouse, activities.LakehouseInput{
		Topic: "nexcom.futures.orders",
		Record: map[string]interface{}{
			"order_id": result.OrderID, "trader_id": input.TraderID,
			"contract": input.ContractSymbol, "side": input.Side,
			"filled_contracts": result.FilledContracts, "avg_price": result.AvgPrice,
			"initial_margin_ngn": result.InitialMarginNGN, "executed_at": workflow.Now(ctx),
		},
	})

	result.CompletedAt = workflow.Now(ctx)
	return result, nil
}

// ─────────────────────────────────────────────────────────────────────────────
// JOURNEY 8: MarginCallWorkflow
// Stakeholder: Exchange risk management issuing a margin call.
// Services: Risk management → TigerBeetle (check balance) → Notification →
//           Auto-liquidation (if not met) → Matching engine (cancel orders) →
//           Settlement → Lakehouse
// Reuse: Called by risk engine on price movement, daily mark-to-market
// ─────────────────────────────────────────────────────────────────────────────

type MarginCallInput struct {
	AccountID       string  `json:"account_id"`
	Symbol          string  `json:"symbol"`
	CurrentMargin   float64 `json:"current_margin"`
	RequiredMargin  float64 `json:"required_margin"`
	MaintenanceMargin float64 `json:"maintenance_margin"`
	Deadline        time.Time `json:"deadline"` // when auto-liquidation triggers
}

type MarginCallResult struct {
	AccountID    string `json:"account_id"`
	Outcome      string `json:"outcome"` // "MET" | "LIQUIDATED" | "PARTIAL"
	AmountTopUp  float64 `json:"amount_top_up"`
	LiquidatedPositions []string `json:"liquidated_positions,omitempty"`
	CompletedAt  time.Time `json:"completed_at"`
}

func MarginCallWorkflow(ctx workflow.Context, input MarginCallInput) (*MarginCallResult, error) {
	logger := workflow.GetLogger(ctx)
	logger.Info("MarginCallWorkflow started", "account_id", input.AccountID, "symbol", input.Symbol)

	ctx2m := activityOpts(ctx, 2*time.Minute)
	ctx30s := activityOpts(ctx, 30*time.Second)

	result := &MarginCallResult{AccountID: input.AccountID}
	deficit := input.RequiredMargin - input.CurrentMargin

	// Step 1: Notify trader of margin call
	workflow.ExecuteActivity(ctx30s, activities.SendNotification, activities.NotificationInput{
		UserID: input.AccountID, Channel: "sms",
		Title: "URGENT: Margin Call",
		Message: fmt.Sprintf("Margin call on %s. Deposit ₦%.2f by %s or positions will be liquidated.",
			input.Symbol, deficit, input.Deadline.Format("15:04 MST")),
	})

	// Step 2: Wait for top-up (signal) or deadline
	topUpSignal := workflow.GetSignalChannel(ctx, "margin_top_up")
	timerFired := workflow.NewTimer(ctx, time.Until(input.Deadline))

	var topUpAmount float64
	selector := workflow.NewSelector(ctx)
	selector.AddReceive(topUpSignal, func(c workflow.ReceiveChannel, more bool) {
		c.Receive(ctx, &topUpAmount)
	})
	selector.AddFuture(timerFired, func(f workflow.Future) {})
	selector.Select(ctx)

	// Step 3: Check if margin call was met
	var currentBalance int64
	workflow.ExecuteActivity(ctx30s, activities.GetAccountBalance, input.AccountID).Get(ctx, &currentBalance)

	if float64(currentBalance)/100 >= input.RequiredMargin {
		result.Outcome = "MET"
		result.AmountTopUp = topUpAmount
	} else {
		// Auto-liquidate positions
		result.Outcome = "LIQUIDATED"
		var positions []string
		workflow.ExecuteActivity(ctx2m, activities.GetOpenPositions, input.AccountID).Get(ctx, &positions)

		for _, posID := range positions {
			workflow.ExecuteActivity(ctx2m, activities.LiquidatePosition, activities.LiquidateInput{
				AccountID: input.AccountID, PositionID: posID, Symbol: input.Symbol,
			})
		}
		result.LiquidatedPositions = positions

		workflow.ExecuteActivity(ctx30s, activities.SendNotification, activities.NotificationInput{
			UserID: input.AccountID, Channel: "email",
			Title: "Positions Liquidated",
			Message: fmt.Sprintf("%d positions liquidated due to margin call on %s.", len(positions), input.Symbol),
		})
	}

	// Step 4: Ingest to Lakehouse
	workflow.ExecuteActivity(ctx30s, activities.IngestToLakehouse, activities.LakehouseInput{
		Topic: "nexcom.risk.margin_calls",
		Record: map[string]interface{}{
			"account_id": input.AccountID, "symbol": input.Symbol,
			"deficit": deficit, "outcome": result.Outcome,
			"liquidated_count": len(result.LiquidatedPositions),
			"resolved_at": workflow.Now(ctx),
		},
	})

	result.CompletedAt = workflow.Now(ctx)
	return result, nil
}

// ─────────────────────────────────────────────────────────────────────────────
// JOURNEY 9: CrossBorderFXWorkflow
// Stakeholder: Exporter sending commodity proceeds cross-border via Mojaloop.
// Services: Sanctions screening → ILP Quote (Mojaloop) → TigerBeetle reserve →
//           Mojaloop transfer → TigerBeetle commit → Fluvio → Lakehouse
// Reuse: Called by cross-border payments, diaspora remittance, trade finance
// ─────────────────────────────────────────────────────────────────────────────

type CrossBorderFXInput struct {
	TransferID      string  `json:"transfer_id"`
	SenderUserID    string  `json:"sender_user_id"`
	ReceiverFSP     string  `json:"receiver_fsp"`
	ReceiverAccount string  `json:"receiver_account"`
	AmountNGN       float64 `json:"amount_ngn"`
	ReceiveCurrency string  `json:"receive_currency"` // "USD" | "GHS" | "KES"
	Note            string  `json:"note"`
	IdempotencyKey  string  `json:"idempotency_key"`
}

type CrossBorderFXResult struct {
	TransferID      string  `json:"transfer_id"`
	Status          string  `json:"status"`
	FXRate          float64 `json:"fx_rate"`
	ReceivedAmount  float64 `json:"received_amount"`
	FeeNGN          float64 `json:"fee_ngn"`
	MojaloopTxID    string  `json:"mojaloop_tx_id"`
	CompletedAt     time.Time `json:"completed_at"`
}

func CrossBorderFXWorkflow(ctx workflow.Context, input CrossBorderFXInput) (*CrossBorderFXResult, error) {
	logger := workflow.GetLogger(ctx)
	logger.Info("CrossBorderFXWorkflow started", "transfer_id", input.TransferID)

	ctx5m := activityOpts(ctx, 5*time.Minute)
	ctx2m := activityOpts(ctx, 2*time.Minute)
	ctx30s := activityOpts(ctx, 30*time.Second)

	result := &CrossBorderFXResult{TransferID: input.TransferID}

	// Step 1: Sanctions screening
	var sanctionsOK bool
	if err := workflow.ExecuteActivity(ctx2m, activities.SanctionsScreening, activities.SanctionsInput{
		UserID: input.SenderUserID, ReceiverFSP: input.ReceiverFSP,
		ReceiverAccount: input.ReceiverAccount, Amount: input.AmountNGN,
	}).Get(ctx, &sanctionsOK); err != nil || !sanctionsOK {
		return nil, temporal.NewApplicationError("AMLBlockedError", "SANCTIONS_BLOCKED", "Sanctions screening failed")
	}

	// Step 2: Get ILP quote from Mojaloop
	var quote activities.ILPQuoteResult
	if err := workflow.ExecuteActivity(ctx2m, activities.GetILPQuote, activities.ILPQuoteInput{
		SenderFSP: "nexcom", ReceiverFSP: input.ReceiverFSP,
		Amount: input.AmountNGN, SendCurrency: "NGN", ReceiveCurrency: input.ReceiveCurrency,
	}).Get(ctx, &quote); err != nil {
		return nil, fmt.Errorf("ILP quote: %w", err)
	}
	result.FXRate = quote.FXRate
	result.ReceivedAmount = quote.ReceivedAmount
	result.FeeNGN = quote.FeeNGN

	// Step 3: Reserve funds (TigerBeetle pending)
	var reserveID string
	if err := workflow.ExecuteActivity(ctx2m, activities.ReserveFunds, activities.ReserveInput{
		UserID: input.SenderUserID, Amount: input.AmountNGN + result.FeeNGN,
		Currency: "NGN", Reference: input.IdempotencyKey,
	}).Get(ctx, &reserveID); err != nil {
		return nil, fmt.Errorf("reserve funds: %w", err)
	}

	// Step 4: Execute Mojaloop transfer
	var mojaTx activities.MojaloopTxResult
	if err := workflow.ExecuteActivity(ctx5m, activities.ExecuteMojaloopTransfer, activities.MojaloopTransferInput{
		TransferID: input.TransferID, SenderFSP: "nexcom",
		ReceiverFSP: input.ReceiverFSP, ReceiverAccount: input.ReceiverAccount,
		Amount: input.AmountNGN, Currency: "NGN", Note: input.Note,
		ILPCondition: quote.ILPCondition,
	}).Get(ctx, &mojaTx); err != nil {
		// Compensation: void reservation
		workflow.ExecuteActivity(ctx30s, activities.ReleaseFunds, reserveID)
		return nil, fmt.Errorf("Mojaloop transfer: %w", err)
	}
	result.MojaloopTxID = mojaTx.TransferID
	result.Status = mojaTx.Status

	// Step 5: Commit TigerBeetle transfer
	workflow.ExecuteActivity(ctx2m, activities.CommitPendingTransfer, reserveID)

	// Step 6: Notify sender
	workflow.ExecuteActivity(ctx30s, activities.SendNotification, activities.NotificationInput{
		UserID: input.SenderUserID, Channel: "sms",
		Title: "Transfer Complete",
		Message: fmt.Sprintf("₦%.2f sent. Recipient receives %.2f %s. Rate: %.4f. Ref: %s",
			input.AmountNGN, result.ReceivedAmount, input.ReceiveCurrency, result.FXRate, result.MojaloopTxID),
	})

	// Step 7: Emit Fluvio
	workflow.ExecuteActivity(ctx30s, activities.ProduceFluvio, activities.FluvioInput{
		Topic: "nexcom.crossborder.completed",
		Key:   input.TransferID,
		Value: map[string]interface{}{
			"transfer_id": input.TransferID, "sender_id": input.SenderUserID,
			"amount_ngn": input.AmountNGN, "received_amount": result.ReceivedAmount,
			"receive_currency": input.ReceiveCurrency, "fx_rate": result.FXRate,
		},
	})

	// Step 8: Ingest to Lakehouse
	workflow.ExecuteActivity(ctx30s, activities.IngestToLakehouse, activities.LakehouseInput{
		Topic: "nexcom.crossborder.transfers",
		Record: map[string]interface{}{
			"transfer_id": input.TransferID, "sender_id": input.SenderUserID,
			"receiver_fsp": input.ReceiverFSP, "amount_ngn": input.AmountNGN,
			"received_amount": result.ReceivedAmount, "receive_currency": input.ReceiveCurrency,
			"fx_rate": result.FXRate, "fee_ngn": result.FeeNGN,
			"mojaloop_tx_id": result.MojaloopTxID, "completed_at": workflow.Now(ctx),
		},
	})

	result.CompletedAt = workflow.Now(ctx)
	return result, nil
}

// ─────────────────────────────────────────────────────────────────────────────
// JOURNEY 10: DepositWithdrawalWorkflow
// Stakeholder: User depositing or withdrawing funds from the exchange.
// Services: KYC check → AML screen → TigerBeetle (credit/debit) →
//           Stripe/Mojaloop (payment gateway) → Notification → Lakehouse
// Reuse: Called by web portal, mobile app, USSD, bank transfer webhook
// ─────────────────────────────────────────────────────────────────────────────

type DepositWithdrawalInput struct {
	UserID         string  `json:"user_id"`
	Direction      string  `json:"direction"` // "DEPOSIT" | "WITHDRAWAL"
	AmountNGN      float64 `json:"amount_ngn"`
	Channel        string  `json:"channel"` // "stripe" | "mojaloop" | "bank_transfer"
	Reference      string  `json:"reference"`
	BankAccountNo  string  `json:"bank_account_no,omitempty"`
	IdempotencyKey string  `json:"idempotency_key"`
}

type DepositWithdrawalResult struct {
	TransactionID string  `json:"transaction_id"`
	Status        string  `json:"status"`
	AmountNGN     float64 `json:"amount_ngn"`
	FeeNGN        float64 `json:"fee_ngn"`
	LedgerTxID    string  `json:"ledger_tx_id"`
	CompletedAt   time.Time `json:"completed_at"`
}

func DepositWithdrawalWorkflow(ctx workflow.Context, input DepositWithdrawalInput) (*DepositWithdrawalResult, error) {
	logger := workflow.GetLogger(ctx)
	logger.Info("DepositWithdrawalWorkflow started", "user_id", input.UserID, "direction", input.Direction)

	ctx2m := activityOpts(ctx, 2*time.Minute)
	ctx30s := activityOpts(ctx, 30*time.Second)

	result := &DepositWithdrawalResult{AmountNGN: input.AmountNGN}

	// Step 1: KYC check
	var kycOK bool
	if err := workflow.ExecuteActivity(ctx2m, activities.CheckKYCApproved, input.UserID).Get(ctx, &kycOK); err != nil || !kycOK {
		return nil, temporal.NewApplicationError("KYCRejectedError", "KYC_REQUIRED", "KYC not approved for this operation")
	}

	// Step 2: AML screening
	var amlResult activities.AMLActivityResult
	if err := workflow.ExecuteActivity(ctx2m, activities.AMLScreen, activities.AMLActivityInput{
		UserID: input.UserID, Amount: input.AmountNGN, Currency: "NGN", Channel: input.Direction,
	}).Get(ctx, &amlResult); err != nil || !amlResult.Cleared {
		return nil, temporal.NewApplicationError("AMLBlockedError", "AML_BLOCKED", "Transaction blocked by AML")
	}

	// Step 3: For withdrawals, check sufficient balance
	if input.Direction == "WITHDRAWAL" {
		var balanceOK bool
		if err := workflow.ExecuteActivity(ctx30s, activities.CheckSufficientBalance, activities.BalanceCheckInput{
			UserID: input.UserID, RequiredAmount: input.AmountNGN, Currency: "NGN",
		}).Get(ctx, &balanceOK); err != nil || !balanceOK {
			return nil, temporal.NewApplicationError("InvalidInputError", "INSUFFICIENT_BALANCE", "Insufficient balance for withdrawal")
		}
	}

	// Step 4: Execute payment gateway
	var gatewayTxID string
	if err := workflow.ExecuteActivity(ctx2m, activities.ExecutePaymentGateway, activities.PaymentGatewayInput{
		UserID: input.UserID, Direction: input.Direction, Amount: input.AmountNGN,
		Channel: input.Channel, Reference: input.Reference,
		BankAccountNo: input.BankAccountNo,
	}).Get(ctx, &gatewayTxID); err != nil {
		return nil, fmt.Errorf("payment gateway: %w", err)
	}
	result.TransactionID = gatewayTxID

	// Step 5: Update TigerBeetle ledger
	var ledgerTxID string
	if input.Direction == "DEPOSIT" {
		if err := workflow.ExecuteActivity(ctx2m, activities.CreditUserAccount, activities.CreditInput{
			UserID: input.UserID, Amount: int64(input.AmountNGN * 100),
			Currency: "NGN", Reference: gatewayTxID,
		}).Get(ctx, &ledgerTxID); err != nil {
			return nil, fmt.Errorf("credit ledger: %w", err)
		}
	} else {
		if err := workflow.ExecuteActivity(ctx2m, activities.DebitUserAccount, activities.DebitInput{
			UserID: input.UserID, Amount: int64(input.AmountNGN * 100),
			Currency: "NGN", Reference: gatewayTxID,
		}).Get(ctx, &ledgerTxID); err != nil {
			return nil, fmt.Errorf("debit ledger: %w", err)
		}
	}
	result.LedgerTxID = ledgerTxID
	result.FeeNGN = input.AmountNGN * 0.005 // 0.5% fee
	result.Status = "COMPLETED"

	// Step 6: Notify user
	direction := "deposited to"
	if input.Direction == "WITHDRAWAL" {
		direction = "withdrawn from"
	}
	workflow.ExecuteActivity(ctx30s, activities.SendNotification, activities.NotificationInput{
		UserID: input.UserID, Channel: "push",
		Title: fmt.Sprintf("%s Successful", input.Direction),
		Message: fmt.Sprintf("₦%.2f has been %s your NEXCOM account. Ref: %s", input.AmountNGN, direction, gatewayTxID),
	})

	// Step 7: Ingest to Lakehouse
	workflow.ExecuteActivity(ctx30s, activities.IngestToLakehouse, activities.LakehouseInput{
		Topic: fmt.Sprintf("nexcom.funds.%s", input.Direction),
		Record: map[string]interface{}{
			"transaction_id": gatewayTxID, "user_id": input.UserID,
			"direction": input.Direction, "amount_ngn": input.AmountNGN,
			"fee_ngn": result.FeeNGN, "channel": input.Channel,
			"ledger_tx_id": ledgerTxID, "completed_at": workflow.Now(ctx),
		},
	})

	result.CompletedAt = workflow.Now(ctx)
	return result, nil
}
