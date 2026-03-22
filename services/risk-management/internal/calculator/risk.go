// Package calculator implements risk calculation logic including margin,
// position limits, and circuit breaker management.
package calculator

import (
	"sync"
	"time"

	"github.com/nexcom-exchange/risk-management/internal/position"
	"github.com/shopspring/decimal"
	"go.uber.org/zap"
)

// MarginConfig defines margin requirements per commodity category
type MarginConfig struct {
	InitialMargin      decimal.Decimal `json:"initial_margin"`      // % required to open
	MaintenanceMargin  decimal.Decimal `json:"maintenance_margin"`  // % to maintain
	MaxLeverage        decimal.Decimal `json:"max_leverage"`
}

// RiskSummary represents the aggregate risk profile for a user
type RiskSummary struct {
	UserID            string          `json:"user_id"`
	TotalEquity       decimal.Decimal `json:"total_equity"`
	TotalMarginUsed   decimal.Decimal `json:"total_margin_used"`
	FreeMargin        decimal.Decimal `json:"free_margin"`
	MarginLevel       decimal.Decimal `json:"margin_level"` // equity / margin * 100
	UnrealizedPnL     decimal.Decimal `json:"unrealized_pnl"`
	RealizedPnL       decimal.Decimal `json:"realized_pnl"`
	RiskScore         int             `json:"risk_score"` // 0-100
	PositionCount     int             `json:"position_count"`
	MarginCallPending bool            `json:"margin_call_pending"`
	UpdatedAt         time.Time       `json:"updated_at"`
}

// RiskCheckResult represents the result of a pre-trade risk check
type RiskCheckResult struct {
	Approved       bool            `json:"approved"`
	Reason         string          `json:"reason,omitempty"`
	MarginRequired decimal.Decimal `json:"margin_required"`
	MarginAvail    decimal.Decimal `json:"margin_available"`
	PositionLimit  bool            `json:"within_position_limit"`
	CircuitBreaker bool            `json:"circuit_breaker_clear"`
}

// CircuitBreakerStatus represents the current circuit breaker state
type CircuitBreakerStatus struct {
	Symbol      string    `json:"symbol"`
	Triggered   bool      `json:"triggered"`
	Reason      string    `json:"reason,omitempty"`
	TriggeredAt time.Time `json:"triggered_at,omitempty"`
	ResumesAt   time.Time `json:"resumes_at,omitempty"`
}

// RiskCalculator handles all risk computations
type RiskCalculator struct {
	positionMgr    *position.Manager
	marginConfigs  map[string]MarginConfig
	circuitBreakers map[string]*CircuitBreakerStatus
	mu             sync.RWMutex
	logger         *zap.Logger
}

// NewRiskCalculator creates a new risk calculator
func NewRiskCalculator(pm *position.Manager, logger *zap.Logger) *RiskCalculator {
	rc := &RiskCalculator{
		positionMgr:    pm,
		marginConfigs:  make(map[string]MarginConfig),
		circuitBreakers: make(map[string]*CircuitBreakerStatus),
		logger:         logger,
	}
	rc.initDefaultMargins()
	return rc
}

func (rc *RiskCalculator) initDefaultMargins() {
	// Agricultural commodities: lower leverage for farmers
	agriMargin := MarginConfig{
		InitialMargin:     decimal.NewFromFloat(0.10), // 10%
		MaintenanceMargin: decimal.NewFromFloat(0.05), // 5%
		MaxLeverage:       decimal.NewFromInt(10),
	}
	for _, sym := range []string{"MAIZE", "WHEAT", "SOYBEAN", "RICE", "COFFEE", "COCOA", "COTTON", "SUGAR", "PALM_OIL", "CASHEW"} {
		rc.marginConfigs[sym] = agriMargin
	}

	// Precious metals
	metalMargin := MarginConfig{
		InitialMargin:     decimal.NewFromFloat(0.05), // 5%
		MaintenanceMargin: decimal.NewFromFloat(0.03), // 3%
		MaxLeverage:       decimal.NewFromInt(20),
	}
	for _, sym := range []string{"GOLD", "SILVER", "COPPER"} {
		rc.marginConfigs[sym] = metalMargin
	}

	// Energy
	energyMargin := MarginConfig{
		InitialMargin:     decimal.NewFromFloat(0.08),
		MaintenanceMargin: decimal.NewFromFloat(0.04),
		MaxLeverage:       decimal.NewFromInt(12),
	}
	for _, sym := range []string{"CRUDE_OIL", "BRENT", "NAT_GAS"} {
		rc.marginConfigs[sym] = energyMargin
	}

	// Carbon credits
	rc.marginConfigs["CARBON"] = MarginConfig{
		InitialMargin:     decimal.NewFromFloat(0.15),
		MaintenanceMargin: decimal.NewFromFloat(0.10),
		MaxLeverage:       decimal.NewFromInt(5),
	}
}

// GetRiskSummary computes the aggregate risk profile for a user
func (rc *RiskCalculator) GetRiskSummary(userID string) *RiskSummary {
	positions := rc.positionMgr.GetUserPositions(userID)

	summary := &RiskSummary{
		UserID:        userID,
		TotalEquity:   decimal.Zero,
		TotalMarginUsed: decimal.Zero,
		UnrealizedPnL: decimal.Zero,
		RealizedPnL:   decimal.Zero,
		PositionCount: len(positions),
		UpdatedAt:     time.Now().UTC(),
	}

	for _, pos := range positions {
		summary.UnrealizedPnL = summary.UnrealizedPnL.Add(pos.UnrealizedPnL)
		summary.RealizedPnL = summary.RealizedPnL.Add(pos.RealizedPnL)
		summary.TotalMarginUsed = summary.TotalMarginUsed.Add(pos.MarginUsed)
	}

	// Calculate margin level
	if !summary.TotalMarginUsed.IsZero() {
		summary.MarginLevel = summary.TotalEquity.Div(summary.TotalMarginUsed).Mul(decimal.NewFromInt(100))
	}

	summary.FreeMargin = summary.TotalEquity.Sub(summary.TotalMarginUsed)

	// Margin call if margin level < 100%
	if summary.MarginLevel.LessThan(decimal.NewFromInt(100)) && !summary.TotalMarginUsed.IsZero() {
		summary.MarginCallPending = true
	}

	// Risk score: 0 (low risk) to 100 (high risk)
	summary.RiskScore = rc.calculateRiskScore(summary)

	return summary
}

// CheckOrder performs pre-trade risk validation
func (rc *RiskCalculator) CheckOrder(userID, symbol, side, quantity, price string) *RiskCheckResult {
	rc.mu.RLock()
	defer rc.mu.RUnlock()

	result := &RiskCheckResult{
		Approved:       true,
		PositionLimit:  true,
		CircuitBreaker: true,
	}

	// Check circuit breaker
	if cb, exists := rc.circuitBreakers[symbol]; exists && cb.Triggered {
		result.Approved = false
		result.CircuitBreaker = false
		result.Reason = "circuit breaker triggered for " + symbol
		return result
	}

	// Calculate margin required
	qty := decimal.RequireFromString(quantity)
	prc := decimal.RequireFromString(price)
	notional := qty.Mul(prc)

	config, exists := rc.marginConfigs[symbol]
	if !exists {
		result.Approved = false
		result.Reason = "unknown symbol: " + symbol
		return result
	}

	result.MarginRequired = notional.Mul(config.InitialMargin)

	return result
}

// GetCircuitBreakerStatus returns all circuit breaker states
func (rc *RiskCalculator) GetCircuitBreakerStatus() []*CircuitBreakerStatus {
	rc.mu.RLock()
	defer rc.mu.RUnlock()

	var statuses []*CircuitBreakerStatus
	for _, cb := range rc.circuitBreakers {
		statuses = append(statuses, cb)
	}
	return statuses
}

// GetMarginRequirements returns margin configuration for a symbol
func (rc *RiskCalculator) GetMarginRequirements(symbol string) *MarginConfig {
	rc.mu.RLock()
	defer rc.mu.RUnlock()

	if config, exists := rc.marginConfigs[symbol]; exists {
		return &config
	}
	return nil
}

func (rc *RiskCalculator) calculateRiskScore(summary *RiskSummary) int {
	score := 0

	// High margin utilization increases risk
	if !summary.TotalEquity.IsZero() {
		utilization := summary.TotalMarginUsed.Div(summary.TotalEquity).Mul(decimal.NewFromInt(100))
		score += int(utilization.IntPart()) / 2
	}

	// Unrealized losses increase risk
	if summary.UnrealizedPnL.IsNegative() {
		score += 20
	}

	// Many positions increase risk
	if summary.PositionCount > 10 {
		score += 10
	}

	if score > 100 {
		score = 100
	}
	return score
}
