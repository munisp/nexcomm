// Package matching implements the core order matching engine for NEXCOM Exchange.
// Supports FIFO (Price-Time Priority) and Pro-Rata matching algorithms.
package matching
import (
	"context"
	"fmt"
	"sync"
	"time"
	"github.com/google/uuid"
	"github.com/shopspring/decimal"
	"go.uber.org/zap"
	"github.com/nexcom-exchange/trading-engine/internal/middleware"
)

// Side represents the order side (BUY or SELL)
type Side string

const (
	SideBuy  Side = "BUY"
	SideSell Side = "SELL"
)

// OrderType represents the type of order
type OrderType string

const (
	OrderTypeMarket    OrderType = "MARKET"
	OrderTypeLimit     OrderType = "LIMIT"
	OrderTypeStop      OrderType = "STOP"
	OrderTypeStopLimit OrderType = "STOP_LIMIT"
	OrderTypeIOC       OrderType = "IOC" // Immediate or Cancel
	OrderTypeFOK       OrderType = "FOK" // Fill or Kill
)

// OrderStatus represents the current state of an order
type OrderStatus string

const (
	StatusPending   OrderStatus = "PENDING"
	StatusOpen      OrderStatus = "OPEN"
	StatusPartial   OrderStatus = "PARTIAL"
	StatusFilled    OrderStatus = "FILLED"
	StatusCancelled OrderStatus = "CANCELLED"
	StatusRejected  OrderStatus = "REJECTED"
)

// Order represents a trading order in the matching engine
type Order struct {
	ID              string          `json:"order_id"`
	UserID          string          `json:"user_id"`
	Symbol          string          `json:"symbol"`
	Side            Side            `json:"side"`
	Type            OrderType       `json:"order_type"`
	Quantity        decimal.Decimal `json:"quantity"`
	FilledQuantity  decimal.Decimal `json:"filled_quantity"`
	Price           decimal.Decimal `json:"price"`
	StopPrice       decimal.Decimal `json:"stop_price,omitempty"`
	Status          OrderStatus     `json:"status"`
	TimeInForce     string          `json:"time_in_force"`
	ClientOrderID   string          `json:"client_order_id,omitempty"`
	CreatedAt       time.Time       `json:"created_at"`
	UpdatedAt       time.Time       `json:"updated_at"`
}

// RemainingQuantity returns the unfilled portion of the order
func (o *Order) RemainingQuantity() decimal.Decimal {
	return o.Quantity.Sub(o.FilledQuantity)
}

// IsFilled returns true if the order is completely filled
func (o *Order) IsFilled() bool {
	return o.FilledQuantity.GreaterThanOrEqual(o.Quantity)
}

// Trade represents an executed trade between two orders
type Trade struct {
	ID            string          `json:"trade_id"`
	Symbol        string          `json:"symbol"`
	BuyerOrderID  string          `json:"buyer_order_id"`
	SellerOrderID string          `json:"seller_order_id"`
	BuyerID       string          `json:"buyer_id"`
	SellerID      string          `json:"seller_id"`
	Price         decimal.Decimal `json:"price"`
	Quantity      decimal.Decimal `json:"quantity"`
	TotalValue    decimal.Decimal `json:"total_value"`
	ExecutedAt    time.Time       `json:"executed_at"`
}

// Engine is the core matching engine managing all order books
type Engine struct {
	books        map[string]*OrderBook
	orders       map[string]*Order
	recentTrades map[string][]Trade
	mu           sync.RWMutex
	logger       *zap.Logger
	mw           *middleware.Client // fund-flow middleware (Kafka, TigerBeetle, Fluvio, Temporal)
}

// NewEngine creates a new matching engine instance
func NewEngine(logger *zap.Logger) *Engine {
	mwClient := middleware.NewClient(logger)
	return &Engine{
		books:        make(map[string]*OrderBook),
		orders:       make(map[string]*Order),
		recentTrades: make(map[string][]Trade),
		logger:       logger,
		mw:           mwClient,
	}
}

// CreateBook initializes an order book for a given symbol
func (e *Engine) CreateBook(symbol string) {
	e.mu.Lock()
	defer e.mu.Unlock()
	e.books[symbol] = NewOrderBook(symbol)
	e.recentTrades[symbol] = make([]Trade, 0, 1000)
}

// PlaceOrder validates and places an order into the matching engine
func (e *Engine) PlaceOrder(ctx context.Context, order *Order) (*Order, error) {
	e.mu.Lock()
	defer e.mu.Unlock()

	book, exists := e.books[order.Symbol]
	if !exists {
		return nil, fmt.Errorf("symbol %s not found", order.Symbol)
	}

	// Assign order ID and timestamps
	order.ID = uuid.New().String()
	order.Status = StatusOpen
	order.CreatedAt = time.Now().UTC()
	order.UpdatedAt = order.CreatedAt

	// Store the order
	e.orders[order.ID] = order

	// Attempt to match the order
	trades := book.MatchOrder(order)

	// Process executed trades
	for _, trade := range trades {
		e.recentTrades[order.Symbol] = append(e.recentTrades[order.Symbol], trade)

		// Keep only last 1000 trades per symbol
		if len(e.recentTrades[order.Symbol]) > 1000 {
			e.recentTrades[order.Symbol] = e.recentTrades[order.Symbol][1:]
		}

		e.logger.Info("Trade executed",
			zap.String("trade_id", trade.ID),
			zap.String("symbol", trade.Symbol),
			zap.String("price", trade.Price.String()),
			zap.String("quantity", trade.Quantity.String()),
		)

		// ── FUND-FLOW: Atomic middleware integration ──────────────────────────
		// Every trade fill MUST trigger TigerBeetle settlement, Kafka event,
		// Fluvio stream, and Lakehouse ingest. This is non-blocking.
		grossAmount, _ := trade.TotalValue.Float64()
		price, _ := trade.Price.Float64()
		qty, _ := trade.Quantity.Float64()
		e.mw.ProcessTradeFill(ctx, middleware.TradeEvent{
			TradeID:        trade.ID,
			Symbol:         trade.Symbol,
			BuyerOrderID:   trade.BuyerOrderID,
			SellerOrderID:  trade.SellerOrderID,
			BuyerUserID:    trade.BuyerID,
			SellerUserID:   trade.SellerID,
			Price:          price,
			Quantity:       qty,
			GrossAmount:    grossAmount,
			FeeAmount:      grossAmount * 0.001, // 0.1% platform fee
			Currency:       "USD",
			ExecutedAt:     trade.ExecutedAt.UTC().Format(time.RFC3339),
			IdempotencyKey: trade.ID,
		})
	}

	// Update order status
	if order.IsFilled() {
		order.Status = StatusFilled
	} else if order.FilledQuantity.GreaterThan(decimal.Zero) {
		order.Status = StatusPartial
	}

	// Handle IOC orders - cancel remaining if not fully filled
	if order.Type == OrderTypeIOC && !order.IsFilled() {
		order.Status = StatusCancelled
	}

	// Handle FOK orders - reject if not fully fillable (already checked in matching)
	if order.Type == OrderTypeFOK && !order.IsFilled() {
		order.Status = StatusRejected
		return order, nil
	}

	order.UpdatedAt = time.Now().UTC()
	return order, nil
}

// CancelOrder cancels an existing order
func (e *Engine) CancelOrder(ctx context.Context, orderID string) error {
	e.mu.Lock()
	defer e.mu.Unlock()

	order, exists := e.orders[orderID]
	if !exists {
		return fmt.Errorf("order %s not found", orderID)
	}

	if order.Status == StatusFilled || order.Status == StatusCancelled {
		return fmt.Errorf("cannot cancel order with status %s", order.Status)
	}

	book, exists := e.books[order.Symbol]
	if !exists {
		return fmt.Errorf("symbol %s not found", order.Symbol)
	}

	book.RemoveOrder(order)
	order.Status = StatusCancelled
	order.UpdatedAt = time.Now().UTC()

	e.logger.Info("Order cancelled", zap.String("order_id", orderID))
	return nil
}

// GetOrder retrieves an order by ID
func (e *Engine) GetOrder(ctx context.Context, orderID string) (*Order, error) {
	e.mu.RLock()
	defer e.mu.RUnlock()

	order, exists := e.orders[orderID]
	if !exists {
		return nil, fmt.Errorf("order %s not found", orderID)
	}
	return order, nil
}

// GetRecentTrades retrieves recent trades for a symbol
func (e *Engine) GetRecentTrades(ctx context.Context, symbol string, limit int) ([]Trade, error) {
	e.mu.RLock()
	defer e.mu.RUnlock()

	trades, exists := e.recentTrades[symbol]
	if !exists {
		return nil, fmt.Errorf("symbol %s not found", symbol)
	}

	if len(trades) > limit {
		return trades[len(trades)-limit:], nil
	}
	return trades, nil
}

// EngineStats holds Prometheus-ready counters for the trading engine.
type EngineStats struct {
	TotalOrders  int64
	TotalTrades  int64
	ActiveOrders int64
}

// Stats returns a snapshot of engine metrics for Prometheus scraping.
func (e *Engine) Stats() EngineStats {
	e.mu.RLock()
	defer e.mu.RUnlock()
	var totalTrades int64
	for _, trades := range e.recentTrades {
		totalTrades += int64(len(trades))
	}
	activeOrders := int64(0)
	for _, o := range e.orders {
		if o.Status == StatusOpen || o.Status == StatusPartial {
			activeOrders++
		}
	}
	return EngineStats{
		TotalOrders:  int64(len(e.orders)),
		TotalTrades:  totalTrades,
		ActiveOrders: activeOrders,
	}
}

// NewOrderFromRequest creates a new Order from API request parameters
func NewOrderFromRequest(userID, symbol, side, orderType, quantity, price, stopPrice, timeInForce, clientID string) *Order {
	order := &Order{
		UserID:        userID,
		Symbol:        symbol,
		Side:          Side(side),
		Type:          OrderType(orderType),
		Quantity:      decimal.RequireFromString(quantity),
		FilledQuantity: decimal.Zero,
		TimeInForce:   timeInForce,
		ClientOrderID: clientID,
	}

	if price != "" {
		order.Price = decimal.RequireFromString(price)
	}
	if stopPrice != "" {
		order.StopPrice = decimal.RequireFromString(stopPrice)
	}
	if timeInForce == "" {
		order.TimeInForce = "GTC"
	}

	return order
}
