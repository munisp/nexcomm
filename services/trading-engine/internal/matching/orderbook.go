package matching

import (
	"container/heap"
	"time"

	"github.com/google/uuid"
	"github.com/shopspring/decimal"
)

// OrderBook represents a two-sided order book for a single symbol.
// Implements Price-Time Priority (FIFO) matching algorithm.
type OrderBook struct {
	Symbol    string
	Bids      *PriorityQueue // Max-heap: highest price first
	Asks      *PriorityQueue // Min-heap: lowest price first
	LastPrice decimal.Decimal
	LastQty   decimal.Decimal
}

// NewOrderBook creates a new order book for the given symbol
func NewOrderBook(symbol string) *OrderBook {
	bids := &PriorityQueue{side: SideBuy}
	asks := &PriorityQueue{side: SideSell}
	heap.Init(bids)
	heap.Init(asks)
	return &OrderBook{
		Symbol: symbol,
		Bids:   bids,
		Asks:   asks,
	}
}

// MatchOrder attempts to match an incoming order against the order book.
// Returns a slice of trades that resulted from the matching.
func (ob *OrderBook) MatchOrder(order *Order) []Trade {
	var trades []Trade

	var oppositeQueue *PriorityQueue
	if order.Side == SideBuy {
		oppositeQueue = ob.Asks
	} else {
		oppositeQueue = ob.Bids
	}

	for oppositeQueue.Len() > 0 && !order.IsFilled() {
		best := oppositeQueue.Peek()

		// Check if prices cross
		if !canMatch(order, best) {
			break
		}

		// Determine fill quantity
		fillQty := decimal.Min(order.RemainingQuantity(), best.RemainingQuantity())
		fillPrice := best.Price // Maker price (passive order)

		// Execute the match
		trade := executeTrade(order, best, fillPrice, fillQty)
		trades = append(trades, trade)

		// Update last price
		ob.LastPrice = fillPrice
		ob.LastQty = fillQty

		// Update filled quantities
		order.FilledQuantity = order.FilledQuantity.Add(fillQty)
		best.FilledQuantity = best.FilledQuantity.Add(fillQty)

		// Remove fully filled passive order from the book
		if best.IsFilled() {
			best.Status = StatusFilled
			best.UpdatedAt = time.Now().UTC()
			heap.Pop(oppositeQueue)
		} else {
			best.Status = StatusPartial
			best.UpdatedAt = time.Now().UTC()
		}
	}

	// If order still has remaining quantity and is a limit order, add to book
	if !order.IsFilled() && order.Type == OrderTypeLimit {
		ob.addToBook(order)
	}

	return trades
}

// RemoveOrder removes an order from the book (for cancellations)
func (ob *OrderBook) RemoveOrder(order *Order) {
	var queue *PriorityQueue
	if order.Side == SideBuy {
		queue = ob.Bids
	} else {
		queue = ob.Asks
	}
	queue.Remove(order.ID)
}

// GetDepth returns the order book depth at the given number of levels
func (ob *OrderBook) GetDepth(levels int) (bids, asks []PriceLevel) {
	bids = ob.Bids.GetLevels(levels)
	asks = ob.Asks.GetLevels(levels)
	return
}

// addToBook inserts a limit order into the appropriate side of the book
func (ob *OrderBook) addToBook(order *Order) {
	if order.Side == SideBuy {
		heap.Push(ob.Bids, order)
	} else {
		heap.Push(ob.Asks, order)
	}
}

// canMatch returns true if the aggressor order can match with the passive order
func canMatch(aggressor, passive *Order) bool {
	if aggressor.Type == OrderTypeMarket {
		return true
	}
	if aggressor.Side == SideBuy {
		// Buy limit: aggressor price >= passive ask price
		return aggressor.Price.GreaterThanOrEqual(passive.Price)
	}
	// Sell limit: aggressor price <= passive bid price
	return aggressor.Price.LessThanOrEqual(passive.Price)
}

// executeTrade creates a Trade record from a matched order pair
func executeTrade(aggressor, passive *Order, price, quantity decimal.Decimal) Trade {
	var buyerID, sellerID, buyerOrderID, sellerOrderID string
	if aggressor.Side == SideBuy {
		buyerID = aggressor.UserID
		sellerID = passive.UserID
		buyerOrderID = aggressor.ID
		sellerOrderID = passive.ID
	} else {
		buyerID = passive.UserID
		sellerID = aggressor.UserID
		buyerOrderID = passive.ID
		sellerOrderID = aggressor.ID
	}

	return Trade{
		ID:            uuid.New().String(),
		Symbol:        aggressor.Symbol,
		BuyerOrderID:  buyerOrderID,
		SellerOrderID: sellerOrderID,
		BuyerID:       buyerID,
		SellerID:      sellerID,
		Price:         price,
		Quantity:      quantity,
		TotalValue:    price.Mul(quantity),
		ExecutedAt:    time.Now().UTC(),
	}
}

// PriceLevel represents an aggregated price level in the order book
type PriceLevel struct {
	Price    decimal.Decimal `json:"price"`
	Quantity decimal.Decimal `json:"quantity"`
	Orders   int             `json:"orders"`
}

// PriorityQueue implements a heap for order price-time priority
type PriorityQueue struct {
	orders []*Order
	side   Side
	index  map[string]int // order ID -> index for O(1) removal
}

func (pq *PriorityQueue) Len() int { return len(pq.orders) }

func (pq *PriorityQueue) Less(i, j int) bool {
	if pq.side == SideBuy {
		// Max-heap: higher price = higher priority
		if pq.orders[i].Price.Equal(pq.orders[j].Price) {
			return pq.orders[i].CreatedAt.Before(pq.orders[j].CreatedAt)
		}
		return pq.orders[i].Price.GreaterThan(pq.orders[j].Price)
	}
	// Min-heap: lower price = higher priority
	if pq.orders[i].Price.Equal(pq.orders[j].Price) {
		return pq.orders[i].CreatedAt.Before(pq.orders[j].CreatedAt)
	}
	return pq.orders[i].Price.LessThan(pq.orders[j].Price)
}

func (pq *PriorityQueue) Swap(i, j int) {
	pq.orders[i], pq.orders[j] = pq.orders[j], pq.orders[i]
	if pq.index != nil {
		pq.index[pq.orders[i].ID] = i
		pq.index[pq.orders[j].ID] = j
	}
}

func (pq *PriorityQueue) Push(x interface{}) {
	order := x.(*Order)
	if pq.index == nil {
		pq.index = make(map[string]int)
	}
	pq.index[order.ID] = len(pq.orders)
	pq.orders = append(pq.orders, order)
}

func (pq *PriorityQueue) Pop() interface{} {
	old := pq.orders
	n := len(old)
	order := old[n-1]
	old[n-1] = nil
	pq.orders = old[:n-1]
	delete(pq.index, order.ID)
	return order
}

// Peek returns the top element without removing it
func (pq *PriorityQueue) Peek() *Order {
	if len(pq.orders) == 0 {
		return nil
	}
	return pq.orders[0]
}

// Remove removes an order by ID from the queue
func (pq *PriorityQueue) Remove(orderID string) {
	if idx, ok := pq.index[orderID]; ok {
		heap.Remove(pq, idx)
	}
}

// GetLevels aggregates orders into price levels for the given depth
func (pq *PriorityQueue) GetLevels(depth int) []PriceLevel {
	levels := make(map[string]*PriceLevel)
	var orderedPrices []string

	for _, order := range pq.orders {
		key := order.Price.String()
		if level, exists := levels[key]; exists {
			level.Quantity = level.Quantity.Add(order.RemainingQuantity())
			level.Orders++
		} else {
			levels[key] = &PriceLevel{
				Price:    order.Price,
				Quantity: order.RemainingQuantity(),
				Orders:   1,
			}
			orderedPrices = append(orderedPrices, key)
		}
	}

	result := make([]PriceLevel, 0, depth)
	for i, key := range orderedPrices {
		if i >= depth {
			break
		}
		result = append(result, *levels[key])
	}
	return result
}
