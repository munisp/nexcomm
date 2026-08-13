// Package temporal provides a production-grade Temporal workflow client for
// NEXCOM Exchange. Uses the official go.temporal.io/sdk with real gRPC
// connectivity, replacing the previous TCP simulation. Maintains the same
// public interface so callers in server.go require no changes.
package temporal

import (
	"context"
	"errors"
	"fmt"
	"log"
	"sync"
	"time"

	temporalclient "go.temporal.io/sdk/client"
	temporalretry "go.temporal.io/sdk/temporal"
	"go.temporal.io/sdk/worker"
	"go.temporal.io/sdk/workflow"

	"github.com/munisp/NGApp/services/gateway/internal/models"
)

// ─── Task queue names ─────────────────────────────────────────────────────────
const (
	TaskQueueTrading    = "nexcom-trading"
	TaskQueueSettlement = "nexcom-settlement"
	TaskQueueKYC        = "nexcom-kyc"
	TaskQueueMargin     = "nexcom-margin"
)

// ─── Workflow type names ──────────────────────────────────────────────────────
const (
	WorkflowOrderLifecycle  = "OrderLifecycleWorkflow"
	WorkflowSettlement      = "SettlementWorkflow"
	WorkflowKYCVerification = "KYCVerificationWorkflow"
	WorkflowMarginCall      = "MarginCallWorkflow"
)

// WorkflowExecution represents a running workflow (preserved for callers).
type WorkflowExecution struct {
	WorkflowID string      `json:"workflowId"`
	RunID      string      `json:"runId"`
	Status     string      `json:"status"`
	TaskQueue  string      `json:"taskQueue"`
	StartedAt  time.Time   `json:"startedAt"`
	Input      interface{} `json:"input,omitempty"`
}

// Client wraps the official Temporal Go SDK. Workflow state is authoritative
// only when it is accepted and persisted by Temporal.
type Client struct {
	tc           temporalclient.Client
	workers      []worker.Worker
	host         string
	connected    bool
	fallbackMode bool
	mu           sync.RWMutex
}

// NewClient creates a Temporal client that connects via the official SDK.
func NewClient(host string) *Client {
	c := &Client{host: host}
	c.connect()
	return c
}

func (c *Client) connect() {
	log.Printf("[Temporal] Connecting to %s", c.host)

	tc, err := temporalclient.Dial(temporalclient.Options{
		HostPort:  c.host,
		Namespace: "default",
	})
	if err != nil {
		log.Printf("[Temporal] Cannot connect to %s: %v", c.host, err)
		c.mu.Lock()
		c.connected = false
		c.fallbackMode = false
		c.mu.Unlock()
		return
	}

	c.mu.Lock()
	c.tc = tc
	c.connected = true
	c.fallbackMode = false
	c.mu.Unlock()
	log.Printf("[Temporal] Connected to %s (official SDK, gRPC verified)", c.host)

	// Start workers for all task queues
	c.startWorkers()
}

// startWorkers registers and starts Temporal workers for all NEXCOM task queues.
func (c *Client) startWorkers() {
	queues := []struct {
		name      string
		workflows []interface{}
	}{
		{
			name:      TaskQueueTrading,
			workflows: []interface{}{OrderLifecycleWorkflow},
		},
		{
			name:      TaskQueueSettlement,
			workflows: []interface{}{SettlementWorkflow},
		},
		{
			name:      TaskQueueKYC,
			workflows: []interface{}{KYCVerificationWorkflow},
		},
		{
			name:      TaskQueueMargin,
			workflows: []interface{}{MarginCallWorkflow},
		},
	}

	activities := &Activities{}

	for _, q := range queues {
		w := worker.New(c.tc, q.name, worker.Options{
			MaxConcurrentWorkflowTaskPollers:   4,
			MaxConcurrentActivityTaskPollers:   8,
			MaxConcurrentActivityExecutionSize: 100,
		})
		for _, wf := range q.workflows {
			w.RegisterWorkflow(wf)
		}
		w.RegisterActivity(activities)

		if err := w.Start(); err != nil {
			log.Printf("[Temporal] WARN: Failed to start worker for queue %s: %v", q.name, err)
		} else {
			log.Printf("[Temporal] Worker started for task queue: %s", q.name)
			c.mu.Lock()
			c.workers = append(c.workers, w)
			c.mu.Unlock()
		}
	}
}

// ─── Workflow starters ────────────────────────────────────────────────────────

// StartOrderWorkflow initiates the OrderLifecycleWorkflow for a new order.
func (c *Client) StartOrderWorkflow(ctx context.Context, orderID string, input interface{}) (*WorkflowExecution, error) {
	workflowID := "order-" + orderID
	log.Printf("[Temporal] Starting OrderLifecycleWorkflow: workflowID=%s fallback=%v", workflowID, c.IsFallback())

	if c.IsFallback() || !c.IsConnected() {
		return nil, errors.New("Temporal is unavailable")
	}

	opts := temporalclient.StartWorkflowOptions{
		ID:                       workflowID,
		TaskQueue:                TaskQueueTrading,
		WorkflowExecutionTimeout: 24 * time.Hour,
		WorkflowRunTimeout:       1 * time.Hour,
		WorkflowTaskTimeout:      10 * time.Second,
	}

	var wfInput models.OrderWorkflowInput
	if inp, ok := input.(models.OrderWorkflowInput); ok {
		wfInput = inp
	}

	run, err := c.tc.ExecuteWorkflow(ctx, opts, OrderLifecycleWorkflow, wfInput)
	if err != nil {
		return nil, fmt.Errorf("start OrderLifecycleWorkflow: %w", err)
	}

	return &WorkflowExecution{
		WorkflowID: run.GetID(),
		RunID:      run.GetRunID(),
		Status:     "RUNNING",
		TaskQueue:  TaskQueueTrading,
		StartedAt:  time.Now(),
		Input:      input,
	}, nil
}

// StartSettlementWorkflow initiates the SettlementWorkflow for a completed trade.
func (c *Client) StartSettlementWorkflow(ctx context.Context, tradeID string, input interface{}) (*WorkflowExecution, error) {
	workflowID := "settlement-" + tradeID
	log.Printf("[Temporal] Starting SettlementWorkflow: workflowID=%s", workflowID)

	if c.IsFallback() || !c.IsConnected() {
		return nil, errors.New("Temporal is unavailable")
	}

	opts := temporalclient.StartWorkflowOptions{
		ID:                       workflowID,
		TaskQueue:                TaskQueueSettlement,
		WorkflowExecutionTimeout: 48 * time.Hour,
		WorkflowRunTimeout:       2 * time.Hour,
		WorkflowTaskTimeout:      30 * time.Second,
	}

	var wfInput models.SettlementWorkflowInput
	if inp, ok := input.(models.SettlementWorkflowInput); ok {
		wfInput = inp
	}

	run, err := c.tc.ExecuteWorkflow(ctx, opts, SettlementWorkflow, wfInput)
	if err != nil {
		return nil, fmt.Errorf("start SettlementWorkflow: %w", err)
	}

	return &WorkflowExecution{
		WorkflowID: run.GetID(),
		RunID:      run.GetRunID(),
		Status:     "RUNNING",
		TaskQueue:  TaskQueueSettlement,
		StartedAt:  time.Now(),
		Input:      input,
	}, nil
}

// StartKYCWorkflow initiates the KYCVerificationWorkflow for a user.
func (c *Client) StartKYCWorkflow(ctx context.Context, userID string, input interface{}) (*WorkflowExecution, error) {
	workflowID := "kyc-" + userID
	log.Printf("[Temporal] Starting KYCVerificationWorkflow: workflowID=%s", workflowID)

	if c.IsFallback() || !c.IsConnected() {
		return nil, errors.New("Temporal is unavailable")
	}

	opts := temporalclient.StartWorkflowOptions{
		ID:                       workflowID,
		TaskQueue:                TaskQueueKYC,
		WorkflowExecutionTimeout: 72 * time.Hour,
		WorkflowRunTimeout:       24 * time.Hour,
		WorkflowTaskTimeout:      60 * time.Second,
	}

	var wfInput KYCWorkflowInput
	if inp, ok := input.(KYCWorkflowInput); ok {
		wfInput = inp
	} else if m, ok := input.(map[string]string); ok {
		wfInput = KYCWorkflowInput{UserID: m["userId"]}
	}

	run, err := c.tc.ExecuteWorkflow(ctx, opts, KYCVerificationWorkflow, wfInput)
	if err != nil {
		return nil, fmt.Errorf("start KYCVerificationWorkflow: %w", err)
	}

	return &WorkflowExecution{
		WorkflowID: run.GetID(),
		RunID:      run.GetRunID(),
		Status:     "RUNNING",
		TaskQueue:  TaskQueueKYC,
		StartedAt:  time.Now(),
		Input:      input,
	}, nil
}

// StartMarginCallWorkflow initiates the MarginCallWorkflow for a user account.
func (c *Client) StartMarginCallWorkflow(ctx context.Context, userID string, input MarginCallInput) (*WorkflowExecution, error) {
	workflowID := "margin-call-" + userID + "-" + time.Now().Format("20060102-150405")
	log.Printf("[Temporal] Starting MarginCallWorkflow: workflowID=%s", workflowID)

	if c.IsFallback() || !c.IsConnected() {
		return nil, errors.New("Temporal is unavailable")
	}

	opts := temporalclient.StartWorkflowOptions{
		ID:                       workflowID,
		TaskQueue:                TaskQueueMargin,
		WorkflowExecutionTimeout: 4 * time.Hour,
		WorkflowRunTimeout:       2 * time.Hour,
		WorkflowTaskTimeout:      30 * time.Second,
	}

	run, err := c.tc.ExecuteWorkflow(ctx, opts, MarginCallWorkflow, input)
	if err != nil {
		return nil, fmt.Errorf("start MarginCallWorkflow: %w", err)
	}

	return &WorkflowExecution{
		WorkflowID: run.GetID(),
		RunID:      run.GetRunID(),
		Status:     "RUNNING",
		TaskQueue:  TaskQueueMargin,
		StartedAt:  time.Now(),
		Input:      input,
	}, nil
}

// ─── Workflow control ─────────────────────────────────────────────────────────

// SignalWorkflow sends a signal to a running workflow.
func (c *Client) SignalWorkflow(ctx context.Context, workflowID string, signalName string, data interface{}) error {
	log.Printf("[Temporal] Signaling workflow=%s signal=%s", workflowID, signalName)
	if c.IsFallback() || !c.IsConnected() {
		return errors.New("Temporal is unavailable")
	}
	return c.tc.SignalWorkflow(ctx, workflowID, "", signalName, data)
}

// CancelWorkflow cancels a running workflow.
func (c *Client) CancelWorkflow(ctx context.Context, workflowID string) error {
	log.Printf("[Temporal] Cancelling workflow=%s", workflowID)
	if c.IsFallback() || !c.IsConnected() {
		return errors.New("Temporal is unavailable")
	}
	return c.tc.CancelWorkflow(ctx, workflowID, "")
}

// QueryWorkflow queries workflow state.
func (c *Client) QueryWorkflow(ctx context.Context, workflowID string, queryType string) (interface{}, error) {
	if c.IsFallback() || !c.IsConnected() {
		return nil, errors.New("Temporal is unavailable")
	}

	resp, err := c.tc.QueryWorkflow(ctx, workflowID, "", queryType)
	if err != nil {
		return nil, err
	}
	var result interface{}
	if err := resp.Get(&result); err != nil {
		return nil, err
	}
	return result, nil
}

// GetWorkflowStatus returns the execution status.
func (c *Client) GetWorkflowStatus(ctx context.Context, workflowID string) (string, error) {
	if c.IsFallback() || !c.IsConnected() {
		return "", errors.New("Temporal is unavailable")
	}

	resp, err := c.tc.DescribeWorkflowExecution(ctx, workflowID, "")
	if err != nil {
		return "UNKNOWN", err
	}
	return resp.WorkflowExecutionInfo.Status.String(), nil
}

// ListWorkflows is retained for backward compatibility. The API must use the
// Temporal visibility API rather than a local process cache.
func (c *Client) ListWorkflows() []*WorkflowExecution { return nil }

// ─── Status ───────────────────────────────────────────────────────────────────

func (c *Client) IsConnected() bool {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.connected
}

func (c *Client) IsFallback() bool {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.fallbackMode
}

// Close gracefully shuts down all workers and the Temporal client.
func (c *Client) Close() {
	c.mu.Lock()
	defer c.mu.Unlock()
	for _, w := range c.workers {
		w.Stop()
	}
	if c.tc != nil {
		c.tc.Close()
	}
	c.connected = false
	log.Println("[Temporal] Connection closed")
}

// ─── Workflow input/output types ──────────────────────────────────────────────

// KYCWorkflowInput is the input for the KYC verification workflow.
type KYCWorkflowInput struct {
	UserID       string `json:"userId"`
	DocumentURL  string `json:"documentUrl,omitempty"`
	DocumentType string `json:"documentType,omitempty"`
}

// MarginCallInput is the input for the margin call workflow.
type MarginCallInput struct {
	UserID         string  `json:"userId"`
	AccountID      string  `json:"accountId"`
	CurrentBalance float64 `json:"currentBalance"`
	RequiredMargin float64 `json:"requiredMargin"`
	Deficit        float64 `json:"deficit"`
}

// ─── Workflow definitions ─────────────────────────────────────────────────────

// OrderLifecycleWorkflow manages the full lifecycle of a commodity order:
// validation → margin reservation → matching → settlement trigger → completion.
func OrderLifecycleWorkflow(ctx workflow.Context, input models.OrderWorkflowInput) error {
	logger := workflow.GetLogger(ctx)
	logger.Info("OrderLifecycleWorkflow started", "orderId", input.OrderID, "symbol", input.Symbol)

	activityOpts := workflow.ActivityOptions{
		StartToCloseTimeout: 30 * time.Second,
		RetryPolicy: &temporal_retry_policy{
			InitialInterval:    time.Second,
			BackoffCoefficient: 2.0,
			MaximumInterval:    30 * time.Second,
			MaximumAttempts:    3,
		},
	}
	ctx = workflow.WithActivityOptions(ctx, activityOpts)

	activities := &Activities{}

	// Step 1: Validate order
	if err := workflow.ExecuteActivity(ctx, activities.ValidateOrder, input).Get(ctx, nil); err != nil {
		logger.Error("Order validation failed", "error", err)
		_ = workflow.ExecuteActivity(ctx, activities.UpdateOrderStatus, input.OrderID, "REJECTED", err.Error()).Get(ctx, nil)
		return err
	}

	// Step 2: Reserve margin
	var marginReserved bool
	if err := workflow.ExecuteActivity(ctx, activities.ReserveMargin, input).Get(ctx, &marginReserved); err != nil || !marginReserved {
		logger.Error("Margin reservation failed", "orderId", input.OrderID)
		_ = workflow.ExecuteActivity(ctx, activities.UpdateOrderStatus, input.OrderID, "REJECTED", "insufficient margin").Get(ctx, nil)
		return err
	}

	// Step 3: Submit to matching engine
	_ = workflow.ExecuteActivity(ctx, activities.UpdateOrderStatus, input.OrderID, "OPEN", "").Get(ctx, nil)
	logger.Info("Order submitted to matching engine", "orderId", input.OrderID)

	// Step 4: Wait for fill signal (up to 24h for limit orders)
	fillCh := workflow.GetSignalChannel(ctx, "order-filled")
	cancelCh := workflow.GetSignalChannel(ctx, "order-cancelled")

	selector := workflow.NewSelector(ctx)
	var fillSignal struct {
		TradeID  string  `json:"tradeId"`
		FilledAt float64 `json:"filledAt"`
		Qty      float64 `json:"qty"`
	}
	var cancelled bool

	selector.AddReceive(fillCh, func(c workflow.ReceiveChannel, more bool) {
		c.Receive(ctx, &fillSignal)
	})
	selector.AddReceive(cancelCh, func(c workflow.ReceiveChannel, more bool) {
		cancelled = true
	})

	// For market orders, don't wait for signal — proceed immediately
	if input.Type != "MARKET" {
		selector.Select(ctx)
	}

	if cancelled {
		_ = workflow.ExecuteActivity(ctx, activities.ReleaseMargin, input.OrderID).Get(ctx, nil)
		_ = workflow.ExecuteActivity(ctx, activities.UpdateOrderStatus, input.OrderID, "CANCELLED", "user cancelled").Get(ctx, nil)
		logger.Info("Order cancelled", "orderId", input.OrderID)
		return nil
	}

	// Step 5: Mark order as filled
	_ = workflow.ExecuteActivity(ctx, activities.UpdateOrderStatus, input.OrderID, "FILLED", "").Get(ctx, nil)
	logger.Info("OrderLifecycleWorkflow completed", "orderId", input.OrderID)
	return nil
}

// SettlementWorkflow handles T+1 settlement for completed trades:
// TigerBeetle transfer → confirmation → notification.
func SettlementWorkflow(ctx workflow.Context, input models.SettlementWorkflowInput) error {
	logger := workflow.GetLogger(ctx)
	logger.Info("SettlementWorkflow started", "tradeId", input.TradeID)

	activityOpts := workflow.ActivityOptions{
		StartToCloseTimeout: 60 * time.Second,
		RetryPolicy: &temporal_retry_policy{
			InitialInterval:    2 * time.Second,
			BackoffCoefficient: 2.0,
			MaximumInterval:    60 * time.Second,
			MaximumAttempts:    5,
		},
	}
	ctx = workflow.WithActivityOptions(ctx, activityOpts)

	activities := &Activities{}

	// Step 1: Validate trade exists and is in correct state
	if err := workflow.ExecuteActivity(ctx, activities.ValidateTrade, input.TradeID).Get(ctx, nil); err != nil {
		logger.Error("Trade validation failed", "tradeId", input.TradeID, "error", err)
		return err
	}

	// Step 2: Execute TigerBeetle double-entry transfer
	if err := workflow.ExecuteActivity(ctx, activities.ExecuteSettlementTransfer, input).Get(ctx, nil); err != nil {
		logger.Error("Settlement transfer failed", "tradeId", input.TradeID, "error", err)
		return err
	}

	// Step 3: Update trade status to SETTLED
	if err := workflow.ExecuteActivity(ctx, activities.UpdateTradeStatus, input.TradeID, "SETTLED").Get(ctx, nil); err != nil {
		logger.Error("Failed to update trade status", "error", err)
		return err
	}

	// Step 4: Send settlement confirmation notifications
	_ = workflow.ExecuteActivity(ctx, activities.SendSettlementNotification, input).Get(ctx, nil)

	logger.Info("SettlementWorkflow completed", "tradeId", input.TradeID)
	return nil
}

// KYCVerificationWorkflow manages the KYC document verification process:
// document upload → automated checks → manual review queue → approval/rejection.
func KYCVerificationWorkflow(ctx workflow.Context, input KYCWorkflowInput) error {
	logger := workflow.GetLogger(ctx)
	logger.Info("KYCVerificationWorkflow started", "userId", input.UserID)

	activityOpts := workflow.ActivityOptions{
		StartToCloseTimeout: 120 * time.Second,
		RetryPolicy: &temporal_retry_policy{
			InitialInterval:    5 * time.Second,
			BackoffCoefficient: 2.0,
			MaximumInterval:    120 * time.Second,
			MaximumAttempts:    3,
		},
	}
	ctx = workflow.WithActivityOptions(ctx, activityOpts)

	activities := &Activities{}

	// Step 1: Run automated document checks (OCR, liveness, sanctions screening)
	var autoCheckPassed bool
	if err := workflow.ExecuteActivity(ctx, activities.RunAutomatedKYCChecks, input).Get(ctx, &autoCheckPassed); err != nil {
		logger.Error("Automated KYC checks failed", "userId", input.UserID, "error", err)
		_ = workflow.ExecuteActivity(ctx, activities.UpdateKYCStatus, input.UserID, "FAILED", "automated check error").Get(ctx, nil)
		return err
	}

	if !autoCheckPassed {
		_ = workflow.ExecuteActivity(ctx, activities.UpdateKYCStatus, input.UserID, "REJECTED", "automated checks failed").Get(ctx, nil)
		logger.Info("KYC auto-check failed", "userId", input.UserID)
		return nil
	}

	// Step 2: Queue for manual review
	_ = workflow.ExecuteActivity(ctx, activities.UpdateKYCStatus, input.UserID, "UNDER_REVIEW", "").Get(ctx, nil)

	// Step 3: Wait for manual review decision (up to 72 hours)
	reviewCh := workflow.GetSignalChannel(ctx, "kyc-review-decision")
	timerCtx, cancelTimer := workflow.WithCancel(ctx)
	timerFired := workflow.NewTimer(timerCtx, 72*time.Hour)

	var decision struct {
		Approved   bool   `json:"approved"`
		Reason     string `json:"reason"`
		ReviewerID string `json:"reviewerId"`
	}
	var timedOut bool

	selector := workflow.NewSelector(ctx)
	selector.AddReceive(reviewCh, func(c workflow.ReceiveChannel, more bool) {
		c.Receive(ctx, &decision)
		cancelTimer()
	})
	selector.AddFuture(timerFired, func(f workflow.Future) {
		timedOut = true
	})
	selector.Select(ctx)

	if timedOut {
		_ = workflow.ExecuteActivity(ctx, activities.UpdateKYCStatus, input.UserID, "PENDING", "review timeout — re-queued").Get(ctx, nil)
		logger.Warn("KYC review timed out", "userId", input.UserID)
		return nil
	}

	status := "APPROVED"
	if !decision.Approved {
		status = "REJECTED"
	}
	_ = workflow.ExecuteActivity(ctx, activities.UpdateKYCStatus, input.UserID, status, decision.Reason).Get(ctx, nil)
	_ = workflow.ExecuteActivity(ctx, activities.SendKYCDecisionNotification, input.UserID, status, decision.Reason).Get(ctx, nil)

	logger.Info("KYCVerificationWorkflow completed", "userId", input.UserID, "status", status)
	return nil
}

// MarginCallWorkflow handles margin calls when a user's account falls below
// maintenance margin: notification → grace period → forced liquidation.
func MarginCallWorkflow(ctx workflow.Context, input MarginCallInput) error {
	logger := workflow.GetLogger(ctx)
	logger.Info("MarginCallWorkflow started", "userId", input.UserID, "deficit", input.Deficit)

	activityOpts := workflow.ActivityOptions{
		StartToCloseTimeout: 30 * time.Second,
		RetryPolicy: &temporal_retry_policy{
			InitialInterval:    time.Second,
			BackoffCoefficient: 2.0,
			MaximumInterval:    30 * time.Second,
			MaximumAttempts:    3,
		},
	}
	ctx = workflow.WithActivityOptions(ctx, activityOpts)

	activities := &Activities{}

	// Step 1: Send margin call notification
	_ = workflow.ExecuteActivity(ctx, activities.SendMarginCallNotification, input).Get(ctx, nil)

	// Step 2: Wait for top-up signal (grace period: 4 hours)
	topUpCh := workflow.GetSignalChannel(ctx, "margin-topped-up")
	timerCtx, cancelTimer := workflow.WithCancel(ctx)
	gracePeriod := workflow.NewTimer(timerCtx, 4*time.Hour)

	var topUpSignal struct {
		Amount float64 `json:"amount"`
	}
	var gracePeriodExpired bool

	selector := workflow.NewSelector(ctx)
	selector.AddReceive(topUpCh, func(c workflow.ReceiveChannel, more bool) {
		c.Receive(ctx, &topUpSignal)
		cancelTimer()
	})
	selector.AddFuture(gracePeriod, func(f workflow.Future) {
		gracePeriodExpired = true
	})
	selector.Select(ctx)

	if !gracePeriodExpired {
		// User topped up — verify and close margin call
		var stillDeficient bool
		_ = workflow.ExecuteActivity(ctx, activities.VerifyMarginTopUp, input.UserID, topUpSignal.Amount).Get(ctx, &stillDeficient)
		if !stillDeficient {
			_ = workflow.ExecuteActivity(ctx, activities.CloseMarginCall, input.UserID, "topped-up").Get(ctx, nil)
			logger.Info("Margin call resolved by top-up", "userId", input.UserID)
			return nil
		}
	}

	// Step 3: Grace period expired — execute forced liquidation
	logger.Warn("Margin call grace period expired — initiating forced liquidation", "userId", input.UserID)
	_ = workflow.ExecuteActivity(ctx, activities.SendForcedLiquidationNotification, input.UserID).Get(ctx, nil)

	if err := workflow.ExecuteActivity(ctx, activities.ExecuteForcedLiquidation, input).Get(ctx, nil); err != nil {
		logger.Error("Forced liquidation failed", "userId", input.UserID, "error", err)
		return err
	}

	_ = workflow.ExecuteActivity(ctx, activities.CloseMarginCall, input.UserID, "liquidated").Get(ctx, nil)
	logger.Info("MarginCallWorkflow completed with forced liquidation", "userId", input.UserID)
	return nil
}

// temporal_retry_policy is an alias for the Temporal retry policy.
type temporal_retry_policy = temporalretry.RetryPolicy
