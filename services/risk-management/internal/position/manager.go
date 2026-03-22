// Package position manages trading positions and P&L tracking.
package position

import (
	"sync"
	"time"

	"github.com/shopspring/decimal"
	"go.uber.org/zap"
)

// Position represents a user's position in a commodity
type Position struct {
	PositionID    string          `json:"position_id"`
	UserID        string          `json:"user_id"`
	Symbol        string          `json:"symbol"`
	Quantity      decimal.Decimal `json:"quantity"`       // Positive=long, Negative=short
	AvgPrice      decimal.Decimal `json:"avg_price"`
	UnrealizedPnL decimal.Decimal `json:"unrealized_pnl"`
	RealizedPnL   decimal.Decimal `json:"realized_pnl"`
	MarginUsed    decimal.Decimal `json:"margin_used"`
	UpdatedAt     time.Time       `json:"updated_at"`
}

// Manager handles position lifecycle
type Manager struct {
	positions map[string]map[string]*Position // userID -> symbol -> position
	mu        sync.RWMutex
	logger    *zap.Logger
}

// NewManager creates a new position manager
func NewManager(logger *zap.Logger) *Manager {
	return &Manager{
		positions: make(map[string]map[string]*Position),
		logger:    logger,
	}
}

// GetUserPositions returns all positions for a user
func (m *Manager) GetUserPositions(userID string) []*Position {
	m.mu.RLock()
	defer m.mu.RUnlock()

	var result []*Position
	if userPositions, exists := m.positions[userID]; exists {
		for _, pos := range userPositions {
			result = append(result, pos)
		}
	}
	return result
}

// UpdatePosition updates or creates a position based on a trade execution
func (m *Manager) UpdatePosition(userID, symbol string, quantity, price decimal.Decimal) {
	m.mu.Lock()
	defer m.mu.Unlock()

	if _, exists := m.positions[userID]; !exists {
		m.positions[userID] = make(map[string]*Position)
	}

	pos, exists := m.positions[userID][symbol]
	if !exists {
		pos = &Position{
			UserID:   userID,
			Symbol:   symbol,
			Quantity: decimal.Zero,
			AvgPrice: decimal.Zero,
		}
		m.positions[userID][symbol] = pos
	}

	// Update position using weighted average
	if pos.Quantity.Sign() == quantity.Sign() || pos.Quantity.IsZero() {
		// Adding to position
		totalCost := pos.AvgPrice.Mul(pos.Quantity.Abs()).Add(price.Mul(quantity.Abs()))
		pos.Quantity = pos.Quantity.Add(quantity)
		if !pos.Quantity.IsZero() {
			pos.AvgPrice = totalCost.Div(pos.Quantity.Abs())
		}
	} else {
		// Reducing or reversing position
		closedQty := decimal.Min(pos.Quantity.Abs(), quantity.Abs())
		pnl := closedQty.Mul(price.Sub(pos.AvgPrice))
		if pos.Quantity.IsNegative() {
			pnl = pnl.Neg()
		}
		pos.RealizedPnL = pos.RealizedPnL.Add(pnl)
		pos.Quantity = pos.Quantity.Add(quantity)

		if pos.Quantity.Sign() != pos.Quantity.Sub(quantity).Sign() && !pos.Quantity.IsZero() {
			pos.AvgPrice = price
		}
	}

	pos.UpdatedAt = time.Now().UTC()
}
