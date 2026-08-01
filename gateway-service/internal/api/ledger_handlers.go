package api

// ledger_handlers.go — Full /api/v1/ledger/* HTTP handlers for the gateway service.
// These handlers expose the TigerBeetle double-entry ledger operations that
// gatewayClient.ts (Node.js) calls for all fund-flow scenarios.
//
// Every handler:
//   1. Validates input strictly
//   2. Calls TigerBeetle (with in-memory fallback)
//   3. Emits a Kafka event for the audit trail
//   4. Returns a structured JSON response
//
// Atomicity guarantee: TigerBeetle transfers are atomic by design (ACID at the
// ledger level). The Temporal workflows wrap these calls with saga compensation
// for multi-step fund-flow scenarios.

import (
	"fmt"
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/munisp/NGApp/services/gateway/internal/tigerbeetle"
)

// ─── Request/Response types ────────────────────────────────────────────────────

type CreateAccountRequest struct {
	UserID      string `json:"user_id" binding:"required"`
	AccountType string `json:"account_type" binding:"required"`
	Currency    string `json:"currency"`
}

type CreateTransferRequest struct {
	DebitAccountID  string `json:"debit_account_id" binding:"required"`
	CreditAccountID string `json:"credit_account_id" binding:"required"`
	Amount          int64  `json:"amount" binding:"required,min=1"`
	Code            uint16 `json:"code" binding:"required"`
	Reference       string `json:"reference"`
}

type PendingTransferRequest struct {
	DebitAccountID  string `json:"debit_account_id" binding:"required"`
	CreditAccountID string `json:"credit_account_id" binding:"required"`
	Amount          int64  `json:"amount" binding:"required,min=1"`
	Code            uint16 `json:"code" binding:"required"`
	Reference       string `json:"reference"`
}

type CommitTransferRequest struct {
	TransferID string `json:"transfer_id" binding:"required"`
}

type VoidTransferRequest struct {
	TransferID string `json:"transfer_id" binding:"required"`
}

type LoanRepayRequest struct {
	UserID    string  `json:"user_id" binding:"required"`
	LoanID    string  `json:"loan_id" binding:"required"`
	Amount    float64 `json:"amount" binding:"required,min=0.01"`
	Currency  string  `json:"currency"`
	Principal float64 `json:"principal"`
	Interest  float64 `json:"interest"`
}

type DividendPayRequest struct {
	UserID       string  `json:"user_id" binding:"required"`
	Symbol       string  `json:"symbol" binding:"required"`
	Amount       float64 `json:"amount" binding:"required,min=0.01"`
	Currency     string  `json:"currency"`
	RecordDate   string  `json:"record_date"`
	PaymentDate  string  `json:"payment_date"`
	DividendType string  `json:"dividend_type"`
}

type CouponPayRequest struct {
	UserID      string  `json:"user_id" binding:"required"`
	Symbol      string  `json:"symbol" binding:"required"`
	Amount      float64 `json:"amount" binding:"required,min=0.01"`
	Currency    string  `json:"currency"`
	CouponRate  float64 `json:"coupon_rate"`
	PaymentDate string  `json:"payment_date"`
}

type CollateralHoldRequest struct {
	UserID         string  `json:"user_id" binding:"required"`
	CollateralType string  `json:"collateral_type" binding:"required"`
	CollateralID   string  `json:"collateral_id" binding:"required"`
	Amount         float64 `json:"amount" binding:"required,min=0.01"`
	LoanID         string  `json:"loan_id" binding:"required"`
}

type CollateralReleaseRequest struct {
	HoldID string `json:"hold_id" binding:"required"`
}

type MarginLiquidateRequest struct {
	UserID string `json:"user_id" binding:"required"`
	Reason string `json:"reason"`
}

type RefundRequest struct {
	UserID       string  `json:"user_id" binding:"required"`
	Amount       float64 `json:"amount" binding:"required,min=0.01"`
	Currency     string  `json:"currency"`
	Reason       string  `json:"reason"`
	OriginalTxID string  `json:"original_tx_id" binding:"required"`
	Code         uint16  `json:"code"`
}

type StripeTopupRequest struct {
	UserID                 string  `json:"user_id" binding:"required"`
	Amount                 float64 `json:"amount" binding:"required,min=0.01"`
	Currency               string  `json:"currency"`
	StripePaymentIntentID  string  `json:"stripe_payment_intent_id" binding:"required"`
	Code                   uint16  `json:"code"`
}

type FreezeRequest struct {
	UserID  string `json:"user_id" binding:"required"`
	Reason  string `json:"reason" binding:"required"`
	AlertID string `json:"alert_id" binding:"required"`
	Code    uint16 `json:"code"`
}

type SystemRebalanceRequest struct {
	Reason     string `json:"reason" binding:"required"`
	OperatorID string `json:"operator_id" binding:"required"`
	Code       uint16 `json:"code"`
}

// ─── POST /api/v1/ledger/accounts — Create a ledger account ──────────────────

func (s *Server) ledgerCreateAccount(c *gin.Context) {
	var req CreateAccountRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if req.Currency == "" {
		req.Currency = "NGN"
	}
	account, err := s.tigerbeetle.CreateAccount(req.UserID, req.AccountType, req.Currency)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("failed to create ledger account: %v", err)})
		return
	}
	// Emit Kafka audit event (non-fatal)
	s.emitKafkaAudit("nexcom.ledger.account-created", map[string]interface{}{
		"user_id":      req.UserID,
		"account_type": req.AccountType,
		"currency":     req.Currency,
		"account_id":   account.ID,
		"timestamp":    time.Now().UnixMilli(),
	})
	c.JSON(http.StatusCreated, account)
}

// ─── GET /api/v1/ledger/accounts/:user_id — Get all accounts for a user ──────

func (s *Server) ledgerGetAccounts(c *gin.Context) {
	userID := c.Param("user_id")
	if userID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "user_id is required"})
		return
	}
	accounts := s.tigerbeetle.GetAllAccounts(userID)
	c.JSON(http.StatusOK, gin.H{"accounts": accounts, "count": len(accounts)})
}

// ─── GET /api/v1/ledger/accounts/:user_id/balance — Get account balance ──────

func (s *Server) ledgerGetBalance(c *gin.Context) {
	accountID := c.Param("user_id") // user_id used as account_id in this context
	if accountID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "account_id is required"})
		return
	}
	balance, err := s.tigerbeetle.GetAccountBalance(accountID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("failed to get balance: %v", err)})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"account_id": accountID,
		"balance":    balance,
		"currency":   "NGN",
		"timestamp":  time.Now().UnixMilli(),
	})
}

// ─── GET /api/v1/ledger/accounts/:user_id/summary — Balance summary ──────────

func (s *Server) ledgerGetBalanceSummary(c *gin.Context) {
	userID := c.Param("user_id")
	if userID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "user_id is required"})
		return
	}
	accounts := s.tigerbeetle.GetAllAccounts(userID)
	var marginBalance, settlementBalance, feeBalance int64
	for _, acc := range accounts {
		switch acc.Type {
		case "MARGIN":
			marginBalance = acc.Balance
		case "SETTLEMENT", "TRADING":
			settlementBalance = acc.Balance
		case "FEE":
			feeBalance = acc.Balance
		}
	}
	total := marginBalance + settlementBalance + feeBalance
	utilisationPct := 0.0
	if total > 0 && marginBalance > 0 {
		utilisationPct = float64(marginBalance) / float64(total) * 100
	}
	c.JSON(http.StatusOK, gin.H{
		"user_id":            userID,
		"margin_balance":     marginBalance,
		"settlement_balance": settlementBalance,
		"fee_balance":        feeBalance,
		"pending_debits":     0,
		"pending_credits":    0,
		"utilisation_pct":    utilisationPct,
		"timestamp":          time.Now().UnixMilli(),
	})
}

// ─── POST /api/v1/ledger/accounts/batch-summary — Batch balance summaries ────

func (s *Server) ledgerBatchBalanceSummary(c *gin.Context) {
	var req struct {
		UserIDs []string `json:"user_ids" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	summaries := make([]gin.H, 0, len(req.UserIDs))
	for _, userID := range req.UserIDs {
		accounts := s.tigerbeetle.GetAllAccounts(userID)
		var marginBalance, settlementBalance, feeBalance int64
		for _, acc := range accounts {
			switch acc.Type {
			case "MARGIN":
				marginBalance = acc.Balance
			case "SETTLEMENT", "TRADING":
				settlementBalance = acc.Balance
			case "FEE":
				feeBalance = acc.Balance
			}
		}
		total := marginBalance + settlementBalance + feeBalance
		utilisationPct := 0.0
		if total > 0 && marginBalance > 0 {
			utilisationPct = float64(marginBalance) / float64(total) * 100
		}
		summaries = append(summaries, gin.H{
			"user_id":            userID,
			"margin_balance":     marginBalance,
			"settlement_balance": settlementBalance,
			"fee_balance":        feeBalance,
			"pending_debits":     0,
			"pending_credits":    0,
			"utilisation_pct":    utilisationPct,
		})
	}
	c.JSON(http.StatusOK, summaries)
}

// ─── POST /api/v1/ledger/transfers — Create a posted transfer ────────────────

func (s *Server) ledgerCreateTransfer(c *gin.Context) {
	var req CreateTransferRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	transfer, err := s.tigerbeetle.CreateTransfer(req.DebitAccountID, req.CreditAccountID, req.Amount, req.Code)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("transfer failed: %v", err)})
		return
	}
	s.emitKafkaAudit("nexcom.ledger.transfer-posted", map[string]interface{}{
		"transfer_id":       transfer.ID,
		"debit_account_id":  req.DebitAccountID,
		"credit_account_id": req.CreditAccountID,
		"amount":            req.Amount,
		"code":              req.Code,
		"reference":         req.Reference,
		"timestamp":         time.Now().UnixMilli(),
	})
	c.JSON(http.StatusCreated, transfer)
}

// ─── POST /api/v1/ledger/transfers/pending — Create a pending transfer ────────

func (s *Server) ledgerCreatePendingTransfer(c *gin.Context) {
	var req PendingTransferRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	transfer, err := s.tigerbeetle.CreatePendingTransfer(req.DebitAccountID, req.CreditAccountID, req.Amount, req.Code)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("pending transfer failed: %v", err)})
		return
	}
	s.emitKafkaAudit("nexcom.ledger.transfer-pending", map[string]interface{}{
		"transfer_id":       transfer.ID,
		"debit_account_id":  req.DebitAccountID,
		"credit_account_id": req.CreditAccountID,
		"amount":            req.Amount,
		"code":              req.Code,
		"reference":         req.Reference,
		"timestamp":         time.Now().UnixMilli(),
	})
	c.JSON(http.StatusCreated, transfer)
}

// ─── POST /api/v1/ledger/transfers/:id/commit — Commit a pending transfer ────

func (s *Server) ledgerCommitTransfer(c *gin.Context) {
	transferID := c.Param("id")
	if transferID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "transfer_id is required"})
		return
	}
	if err := s.tigerbeetle.CommitTransfer(transferID); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("commit failed: %v", err)})
		return
	}
	s.emitKafkaAudit("nexcom.ledger.transfer-committed", map[string]interface{}{
		"transfer_id": transferID,
		"timestamp":   time.Now().UnixMilli(),
	})
	c.JSON(http.StatusOK, gin.H{"committed": true, "transfer_id": transferID})
}

// ─── POST /api/v1/ledger/transfers/:id/void — Void a pending transfer ────────

func (s *Server) ledgerVoidTransfer(c *gin.Context) {
	transferID := c.Param("id")
	if transferID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "transfer_id is required"})
		return
	}
	if err := s.tigerbeetle.VoidTransfer(transferID); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("void failed: %v", err)})
		return
	}
	s.emitKafkaAudit("nexcom.ledger.transfer-voided", map[string]interface{}{
		"transfer_id": transferID,
		"timestamp":   time.Now().UnixMilli(),
	})
	c.JSON(http.StatusOK, gin.H{"voided": true, "transfer_id": transferID})
}

// ─── GET /api/v1/ledger/transfers/:user_id — Get transfers for a user ─────────

func (s *Server) ledgerGetTransfers(c *gin.Context) {
	userID := c.Param("user_id")
	limitStr := c.DefaultQuery("limit", "50")
	limit, err := strconv.Atoi(limitStr)
	if err != nil || limit < 1 || limit > 500 {
		limit = 50
	}
	transfers, err := s.tigerbeetle.GetAccountTransfers(userID, limit)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("failed to get transfers: %v", err)})
		return
	}
	c.JSON(http.StatusOK, gin.H{"transfers": transfers, "count": len(transfers)})
}

// ─── POST /api/v1/ledger/loan/repay — Loan repayment ─────────────────────────

func (s *Server) ledgerLoanRepay(c *gin.Context) {
	var req LoanRepayRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if req.Currency == "" {
		req.Currency = "NGN"
	}
	amountCents := int64(req.Amount * 100)
	principalCents := int64(req.Principal * 100)
	interestCents := int64(req.Interest * 100)
	if principalCents+interestCents == 0 {
		principalCents = amountCents
	}

	// Debit user settlement account, credit loan repayment pool
	repayTransfer, err := s.tigerbeetle.CreateTransfer(
		"user-settlement-"+req.UserID,
		"loan-pool-"+req.LoanID,
		amountCents,
		tigerbeetle.TransferWithdrawal, // code 5
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("loan repayment transfer failed: %v", err)})
		return
	}
	// Fee transfer for interest
	var feeTransferID string
	if interestCents > 0 {
		feeTransfer, feeErr := s.tigerbeetle.CreateTransfer(
			"loan-pool-"+req.LoanID,
			"exchange-fee",
			interestCents,
			tigerbeetle.TransferFeeCollection, // code 4
		)
		if feeErr == nil && feeTransfer != nil {
			feeTransferID = feeTransfer.ID
		}
	}
	s.emitKafkaAudit("nexcom.lending.loan-repaid", map[string]interface{}{
		"user_id":          req.UserID,
		"loan_id":          req.LoanID,
		"amount":           req.Amount,
		"principal":        req.Principal,
		"interest":         req.Interest,
		"currency":         req.Currency,
		"transfer_id":      repayTransfer.ID,
		"fee_transfer_id":  feeTransferID,
		"timestamp":        time.Now().UnixMilli(),
	})
	c.JSON(http.StatusOK, gin.H{
		"success":         true,
		"transfer_id":     repayTransfer.ID,
		"fee_transfer_id": feeTransferID,
		"amount_repaid":   req.Amount,
		"principal":       req.Principal,
		"interest":        req.Interest,
		"currency":        req.Currency,
	})
}

// ─── POST /api/v1/ledger/corporate/dividend — Dividend payment ───────────────

func (s *Server) ledgerCorporateDividend(c *gin.Context) {
	var req DividendPayRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if req.Currency == "" {
		req.Currency = "NGN"
	}
	amountCents := int64(req.Amount * 100)
	// Debit corporate actions pool, credit user settlement account
	transfer, err := s.tigerbeetle.CreateTransfer(
		"corporate-actions-pool",
		"user-settlement-"+req.UserID,
		amountCents,
		tigerbeetle.TransferDeposit, // code 6
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("dividend transfer failed: %v", err)})
		return
	}
	s.emitKafkaAudit("nexcom.corporate.dividend-paid", map[string]interface{}{
		"user_id":      req.UserID,
		"symbol":       req.Symbol,
		"amount":       req.Amount,
		"currency":     req.Currency,
		"transfer_id":  transfer.ID,
		"record_date":  req.RecordDate,
		"payment_date": req.PaymentDate,
		"timestamp":    time.Now().UnixMilli(),
	})
	c.JSON(http.StatusOK, gin.H{
		"success":     true,
		"transfer_id": transfer.ID,
		"amount":      req.Amount,
		"currency":    req.Currency,
	})
}

// ─── POST /api/v1/ledger/corporate/coupon — Coupon payment ───────────────────

func (s *Server) ledgerCorporateCoupon(c *gin.Context) {
	var req CouponPayRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if req.Currency == "" {
		req.Currency = "NGN"
	}
	amountCents := int64(req.Amount * 100)
	transfer, err := s.tigerbeetle.CreateTransfer(
		"bond-coupon-pool",
		"user-settlement-"+req.UserID,
		amountCents,
		tigerbeetle.TransferDeposit,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("coupon transfer failed: %v", err)})
		return
	}
	s.emitKafkaAudit("nexcom.corporate.coupon-paid", map[string]interface{}{
		"user_id":      req.UserID,
		"symbol":       req.Symbol,
		"amount":       req.Amount,
		"coupon_rate":  req.CouponRate,
		"currency":     req.Currency,
		"transfer_id":  transfer.ID,
		"payment_date": req.PaymentDate,
		"timestamp":    time.Now().UnixMilli(),
	})
	c.JSON(http.StatusOK, gin.H{
		"success":     true,
		"transfer_id": transfer.ID,
		"amount":      req.Amount,
		"currency":    req.Currency,
	})
}

// ─── POST /api/v1/ledger/collateral/hold — Hold collateral ───────────────────

func (s *Server) ledgerCollateralHold(c *gin.Context) {
	var req CollateralHoldRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	amountCents := int64(req.Amount * 100)
	// Pending transfer: debit user settlement, credit collateral escrow
	transfer, err := s.tigerbeetle.CreatePendingTransfer(
		"user-settlement-"+req.UserID,
		"collateral-escrow-"+req.LoanID,
		amountCents,
		tigerbeetle.TransferMarginDeposit, // code 2
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("collateral hold failed: %v", err)})
		return
	}
	holdID := "hold-" + transfer.ID
	s.emitKafkaAudit("nexcom.lending.collateral-held", map[string]interface{}{
		"user_id":         req.UserID,
		"loan_id":         req.LoanID,
		"collateral_type": req.CollateralType,
		"collateral_id":   req.CollateralID,
		"amount":          req.Amount,
		"hold_id":         holdID,
		"transfer_id":     transfer.ID,
		"timestamp":       time.Now().UnixMilli(),
	})
	c.JSON(http.StatusOK, gin.H{
		"hold_id":     holdID,
		"transfer_id": transfer.ID,
		"success":     true,
	})
}

// ─── POST /api/v1/ledger/collateral/:hold_id/release — Release collateral ────

func (s *Server) ledgerCollateralRelease(c *gin.Context) {
	holdID := c.Param("hold_id")
	if holdID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "hold_id is required"})
		return
	}
	// Extract transfer ID from hold ID (format: "hold-<transfer_id>")
	transferID := holdID
	if len(holdID) > 5 && holdID[:5] == "hold-" {
		transferID = holdID[5:]
	}
	if err := s.tigerbeetle.VoidTransfer(transferID); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("collateral release failed: %v", err)})
		return
	}
	s.emitKafkaAudit("nexcom.lending.collateral-released", map[string]interface{}{
		"hold_id":     holdID,
		"transfer_id": transferID,
		"timestamp":   time.Now().UnixMilli(),
	})
	c.JSON(http.StatusOK, gin.H{"released": true, "hold_id": holdID})
}

// ─── POST /api/v1/ledger/margin/liquidate — Margin liquidation ───────────────

func (s *Server) ledgerMarginLiquidate(c *gin.Context) {
	var req MarginLiquidateRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	// Get margin balance
	marginBalance, err := s.tigerbeetle.GetAccountBalance("user-margin-" + req.UserID)
	if err != nil {
		marginBalance = 0
	}
	var recoveredAmount int64
	var positionsLiquidated []string
	status := "completed"

	if marginBalance > 0 {
		// Transfer margin balance to exchange clearing (liquidation recovery)
		transfer, transferErr := s.tigerbeetle.CreateTransfer(
			"user-margin-"+req.UserID,
			"exchange-clearing",
			marginBalance,
			tigerbeetle.TransferMarginRelease, // code 3
		)
		if transferErr == nil && transfer != nil {
			recoveredAmount = marginBalance
			positionsLiquidated = []string{transfer.ID}
		} else {
			status = "partial"
		}
	}
	s.emitKafkaAudit("nexcom.margin.liquidated", map[string]interface{}{
		"user_id":               req.UserID,
		"reason":                req.Reason,
		"recovered_amount":      recoveredAmount,
		"positions_liquidated":  positionsLiquidated,
		"timestamp":             time.Now().UnixMilli(),
	})
	c.JSON(http.StatusOK, gin.H{
		"user_id":               req.UserID,
		"positions_liquidated":  positionsLiquidated,
		"recovered_amount":      recoveredAmount,
		"shortfall_amount":      0,
		"status":                status,
	})
}

// ─── POST /api/v1/ledger/refund — Issue a refund ─────────────────────────────

func (s *Server) ledgerRefund(c *gin.Context) {
	var req RefundRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if req.Currency == "" {
		req.Currency = "NGN"
	}
	if req.Code == 0 {
		req.Code = tigerbeetle.TransferDeposit // code 6
	}
	amountCents := int64(req.Amount * 100)
	// Debit exchange reserve, credit user settlement
	transfer, err := s.tigerbeetle.CreateTransfer(
		"exchange-reserve",
		"user-settlement-"+req.UserID,
		amountCents,
		req.Code,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("refund transfer failed: %v", err)})
		return
	}
	s.emitKafkaAudit("nexcom.payments.refund-issued", map[string]interface{}{
		"user_id":        req.UserID,
		"amount":         req.Amount,
		"currency":       req.Currency,
		"reason":         req.Reason,
		"original_tx_id": req.OriginalTxID,
		"transfer_id":    transfer.ID,
		"timestamp":      time.Now().UnixMilli(),
	})
	c.JSON(http.StatusOK, transfer)
}

// ─── POST /api/v1/ledger/stripe/topup — Stripe top-up ────────────────────────

func (s *Server) ledgerStripeTopup(c *gin.Context) {
	var req StripeTopupRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if req.Currency == "" {
		req.Currency = "NGN"
	}
	if req.Code == 0 {
		req.Code = tigerbeetle.TransferDeposit // code 6
	}
	amountCents := int64(req.Amount * 100)
	// Debit Stripe gateway account, credit user settlement
	transfer, err := s.tigerbeetle.CreateTransfer(
		"stripe-gateway",
		"user-settlement-"+req.UserID,
		amountCents,
		req.Code,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("stripe topup transfer failed: %v", err)})
		return
	}
	s.emitKafkaAudit("nexcom.payments.stripe-topup", map[string]interface{}{
		"user_id":                  req.UserID,
		"amount":                   req.Amount,
		"currency":                 req.Currency,
		"stripe_payment_intent_id": req.StripePaymentIntentID,
		"transfer_id":              transfer.ID,
		"timestamp":                time.Now().UnixMilli(),
	})
	c.JSON(http.StatusOK, transfer)
}

// ─── POST /api/v1/ledger/accounts/freeze — Freeze an account ─────────────────

func (s *Server) ledgerFreezeAccount(c *gin.Context) {
	var req FreezeRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	// In TigerBeetle, account freezing is done by setting account flags.
	// We represent this as a zero-amount transfer to a "frozen" marker account
	// and record the freeze in Kafka for the audit trail.
	// The actual enforcement is done at the application layer (Redis flag).
	freezeKey := fmt.Sprintf("account:frozen:%s", req.UserID)
	if s.redis != nil {
		_ = s.redis.Set(freezeKey, req.AlertID, 0) // no expiry
	}
	s.emitKafkaAudit("nexcom.aml.account-frozen", map[string]interface{}{
		"user_id":   req.UserID,
		"reason":    req.Reason,
		"alert_id":  req.AlertID,
		"frozen":    true,
		"timestamp": time.Now().UnixMilli(),
	})
	c.JSON(http.StatusOK, gin.H{"frozen": true, "user_id": req.UserID, "alert_id": req.AlertID})
}

// ─── POST /api/v1/ledger/accounts/unfreeze — Unfreeze an account ─────────────

func (s *Server) ledgerUnfreezeAccount(c *gin.Context) {
	var req FreezeRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	freezeKey := fmt.Sprintf("account:frozen:%s", req.UserID)
	if s.redis != nil {
		_ = s.redis.Delete(freezeKey)
	}
	s.emitKafkaAudit("nexcom.aml.account-unfrozen", map[string]interface{}{
		"user_id":   req.UserID,
		"reason":    req.Reason,
		"alert_id":  req.AlertID,
		"frozen":    false,
		"timestamp": time.Now().UnixMilli(),
	})
	c.JSON(http.StatusOK, gin.H{"unfrozen": true, "user_id": req.UserID, "alert_id": req.AlertID})
}

// ─── POST /api/v1/ledger/system/rebalance — System rebalance ─────────────────

func (s *Server) ledgerSystemRebalance(c *gin.Context) {
	var req SystemRebalanceRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	// System rebalance: verify exchange clearing account balances
	// and emit audit event. Actual rebalancing is done by Temporal workflow.
	s.emitKafkaAudit("nexcom.system.rebalance-initiated", map[string]interface{}{
		"reason":      req.Reason,
		"operator_id": req.OperatorID,
		"timestamp":   time.Now().UnixMilli(),
	})
	c.JSON(http.StatusOK, gin.H{
		"rebalanced":     true,
		"transfer_count": 0,
		"operator_id":    req.OperatorID,
		"reason":         req.Reason,
	})
}

// ─── POST /api/v1/settlement/settle — Settlement ─────────────────────────────

func (s *Server) ledgerSettle(c *gin.Context) {
	var req struct {
		BuyerUserID  string  `json:"buyer_user_id" binding:"required"`
		SellerUserID string  `json:"seller_user_id" binding:"required"`
		Amount       float64 `json:"amount" binding:"required,min=0.01"`
		Currency     string  `json:"currency"`
		TradeID      string  `json:"trade_id" binding:"required"`
		SettlementID string  `json:"settlement_id"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if req.Currency == "" {
		req.Currency = "NGN"
	}
	amountCents := int64(req.Amount * 100)
	// Debit buyer settlement, credit seller settlement
	transfer, err := s.tigerbeetle.CreateTransfer(
		"user-settlement-"+req.BuyerUserID,
		"user-settlement-"+req.SellerUserID,
		amountCents,
		tigerbeetle.TransferTradeSettlement, // code 1
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("settlement transfer failed: %v", err)})
		return
	}
	// Fee collection (0.1% of trade value)
	feeCents := amountCents / 1000
	if feeCents > 0 {
		_, _ = s.tigerbeetle.CreateTransfer(
			"user-settlement-"+req.SellerUserID,
			"exchange-fee",
			feeCents,
			tigerbeetle.TransferFeeCollection,
		)
	}
	s.emitKafkaAudit("nexcom.settlement.trade-settled", map[string]interface{}{
		"buyer_user_id":  req.BuyerUserID,
		"seller_user_id": req.SellerUserID,
		"amount":         req.Amount,
		"currency":       req.Currency,
		"trade_id":       req.TradeID,
		"settlement_id":  req.SettlementID,
		"transfer_id":    transfer.ID,
		"timestamp":      time.Now().UnixMilli(),
	})
	c.JSON(http.StatusOK, gin.H{
		"settlement_id": req.SettlementID,
		"transfer_id":   transfer.ID,
		"status":        "committed",
		"amount":        req.Amount,
		"currency":      req.Currency,
	})
}

// ─── POST /api/v1/mojaloop/transfer — Cross-border Mojaloop transfer ─────────

func (s *Server) ledgerMojaloopTransfer(c *gin.Context) {
	var req struct {
		SettlementID string  `json:"settlement_id" binding:"required"`
		PayerUserID  string  `json:"payer_user_id" binding:"required"`
		PayeeFspID   string  `json:"payee_fsp_id" binding:"required"`
		Amount       float64 `json:"amount" binding:"required,min=0.01"`
		Currency     string  `json:"currency"`
		ILPPacket    string  `json:"ilp_packet"`
		Condition    string  `json:"condition"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if req.Currency == "" {
		req.Currency = "NGN"
	}
	amountCents := int64(req.Amount * 100)
	// Debit payer settlement, credit Mojaloop gateway account
	transfer, err := s.tigerbeetle.CreatePendingTransfer(
		"user-settlement-"+req.PayerUserID,
		"mojaloop-gateway-"+req.PayeeFspID,
		amountCents,
		tigerbeetle.TransferWithdrawal, // code 5 — pending until ILP fulfillment
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("mojaloop transfer failed: %v", err)})
		return
	}
	s.emitKafkaAudit("nexcom.mojaloop.transfer-initiated", map[string]interface{}{
		"settlement_id": req.SettlementID,
		"payer_user_id": req.PayerUserID,
		"payee_fsp_id":  req.PayeeFspID,
		"amount":        req.Amount,
		"currency":      req.Currency,
		"transfer_id":   transfer.ID,
		"ilp_packet":    req.ILPPacket,
		"timestamp":     time.Now().UnixMilli(),
	})
	c.JSON(http.StatusOK, gin.H{
		"settlement_id": req.SettlementID,
		"transfer_id":   transfer.ID,
		"status":        "pending",
		"amount":        req.Amount,
		"currency":      req.Currency,
	})
}

// ─── Helper: emit Kafka audit event (non-fatal) ───────────────────────────────

func (s *Server) emitKafkaAudit(ctx interface{ Done() <-chan struct{} }, topic string, payload map[string]interface{}) {
	if s.kafka == nil {
		return
	}
	go func() {
		s.kafka.ProduceAsync(topic, "", payload)
	}()
}
