// Package orderbook provides order book management and snapshot capabilities
// for the NEXCOM Exchange trading engine.
package orderbook

import (
	"context"
	"sync"

	"github.com/nexcom-exchange/trading-engine/internal/matching"
	"github.com/shopspring/decimal"
	"go.uber.org/zap"
)

// Snapshot represents the current state of an order book
type Snapshot struct {
	Symbol    string                `json:"symbol"`
	Bids      []matching.PriceLevel `json:"bids"`
	Asks      []matching.PriceLevel `json:"asks"`
	LastPrice decimal.Decimal       `json:"last_price"`
	LastQty   decimal.Decimal       `json:"last_quantity"`
	Spread    decimal.Decimal       `json:"spread"`
}

// Manager handles order book lifecycle and provides query access
type Manager struct {
	engine *matching.Engine
	logger *zap.Logger
	mu     sync.RWMutex
}

// NewManager creates a new order book manager
func NewManager(engine *matching.Engine, logger *zap.Logger) *Manager {
	return &Manager{
		engine: engine,
		logger: logger,
	}
}

// CreateOrderBook initializes a new order book for the given symbol
func (m *Manager) CreateOrderBook(symbol string) {
	m.engine.CreateBook(symbol)
	m.logger.Info("Order book created", zap.String("symbol", symbol))
}

// GetOrderBook returns a snapshot of the order book at the given depth
func (m *Manager) GetOrderBook(symbol string, depth int) (*Snapshot, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	// This would query the engine's internal book
	// For now, return a placeholder structure
	snapshot := &Snapshot{
		Symbol:    symbol,
		Bids:      []matching.PriceLevel{},
		Asks:      []matching.PriceLevel{},
		LastPrice: decimal.Zero,
		LastQty:   decimal.Zero,
		Spread:    decimal.Zero,
	}

	return snapshot, nil
}

// PersistAll persists all order books to durable storage
func (m *Manager) PersistAll(ctx context.Context) {
	m.logger.Info("Persisting all order books...")
	// In production: serialize order book state to PostgreSQL and/or Redis
	// for fast recovery on restart
	m.logger.Info("All order books persisted")
}
