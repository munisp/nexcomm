// Package feeds handles market data ingestion, normalization, and OHLCV aggregation.
// Consumes from Kafka topics and Fluvio streams, stores in TimescaleDB/Redis.
package feeds

import (
	"fmt"
	"sync"
	"time"

	"github.com/shopspring/decimal"
	"go.uber.org/zap"
)

// Tick represents a normalized market data tick
type Tick struct {
	Symbol    string          `json:"symbol"`
	Price     decimal.Decimal `json:"price"`
	Volume    decimal.Decimal `json:"volume"`
	Bid       decimal.Decimal `json:"bid"`
	Ask       decimal.Decimal `json:"ask"`
	Timestamp time.Time       `json:"timestamp"`
	Source    string          `json:"source"`
}

// Ticker represents real-time ticker data for a symbol
type Ticker struct {
	Symbol        string          `json:"symbol"`
	Last          decimal.Decimal `json:"last"`
	Change        decimal.Decimal `json:"change"`
	ChangePercent decimal.Decimal `json:"change_percent"`
	High24h       decimal.Decimal `json:"high_24h"`
	Low24h        decimal.Decimal `json:"low_24h"`
	Volume24h     decimal.Decimal `json:"volume_24h"`
	VWAP          decimal.Decimal `json:"vwap"`
	Bid           decimal.Decimal `json:"bid"`
	Ask           decimal.Decimal `json:"ask"`
	Spread        decimal.Decimal `json:"spread"`
	UpdatedAt     time.Time       `json:"updated_at"`
}

// Candle represents an OHLCV candlestick
type Candle struct {
	Timestamp time.Time       `json:"timestamp"`
	Open      decimal.Decimal `json:"open"`
	High      decimal.Decimal `json:"high"`
	Low       decimal.Decimal `json:"low"`
	Close     decimal.Decimal `json:"close"`
	Volume    decimal.Decimal `json:"volume"`
}

// MarketSummary represents the 24h market overview
type MarketSummary struct {
	TotalVolume24h   decimal.Decimal `json:"total_volume_24h"`
	ActiveSymbols    int             `json:"active_symbols"`
	TopGainers       []Ticker        `json:"top_gainers"`
	TopLosers        []Ticker        `json:"top_losers"`
	MostActive       []Ticker        `json:"most_active"`
	LastUpdated      time.Time       `json:"last_updated"`
}

// Processor handles tick ingestion, normalization, and aggregation
type Processor struct {
	tickers map[string]*Ticker
	mu      sync.RWMutex
	logger  *zap.Logger
}

// NewProcessor creates a new market data processor
func NewProcessor(logger *zap.Logger) *Processor {
	return &Processor{
		tickers: make(map[string]*Ticker),
		logger:  logger,
	}
}

// ProcessTick processes a raw tick and updates the ticker state
func (p *Processor) ProcessTick(tick Tick) error {
	p.mu.Lock()
	defer p.mu.Unlock()

	ticker, exists := p.tickers[tick.Symbol]
	if !exists {
		ticker = &Ticker{
			Symbol:    tick.Symbol,
			Last:      tick.Price,
			High24h:   tick.Price,
			Low24h:    tick.Price,
			Volume24h: decimal.Zero,
			Bid:       tick.Bid,
			Ask:       tick.Ask,
		}
		p.tickers[tick.Symbol] = ticker
	}

	// Update ticker
	previousPrice := ticker.Last
	ticker.Last = tick.Price
	ticker.Change = tick.Price.Sub(previousPrice)
	if !previousPrice.IsZero() {
		ticker.ChangePercent = ticker.Change.Div(previousPrice).Mul(decimal.NewFromInt(100))
	}
	ticker.Volume24h = ticker.Volume24h.Add(tick.Volume)
	ticker.Bid = tick.Bid
	ticker.Ask = tick.Ask
	ticker.Spread = tick.Ask.Sub(tick.Bid)
	ticker.UpdatedAt = time.Now().UTC()

	if tick.Price.GreaterThan(ticker.High24h) {
		ticker.High24h = tick.Price
	}
	if tick.Price.LessThan(ticker.Low24h) {
		ticker.Low24h = tick.Price
	}

	return nil
}

// GetTicker returns the current ticker for a symbol
func (p *Processor) GetTicker(symbol string) (*Ticker, error) {
	p.mu.RLock()
	defer p.mu.RUnlock()

	ticker, exists := p.tickers[symbol]
	if !exists {
		return nil, fmt.Errorf("symbol %s not found", symbol)
	}
	return ticker, nil
}

// GetCandles returns OHLCV candles for a symbol
func (p *Processor) GetCandles(symbol, interval, limit string) ([]Candle, error) {
	// In production: query TimescaleDB continuous aggregates
	// SELECT time_bucket(interval, timestamp), FIRST(price), MAX(price),
	//        MIN(price), LAST(price), SUM(volume)
	// FROM market_data WHERE symbol = $1
	// GROUP BY 1 ORDER BY 1 DESC LIMIT $2
	return []Candle{}, nil
}

// GetMarketSummary returns 24h market overview across all symbols
func (p *Processor) GetMarketSummary() *MarketSummary {
	p.mu.RLock()
	defer p.mu.RUnlock()

	summary := &MarketSummary{
		TotalVolume24h: decimal.Zero,
		ActiveSymbols:  len(p.tickers),
		TopGainers:     []Ticker{},
		TopLosers:      []Ticker{},
		MostActive:     []Ticker{},
		LastUpdated:    time.Now().UTC(),
	}

	for _, ticker := range p.tickers {
		summary.TotalVolume24h = summary.TotalVolume24h.Add(ticker.Volume24h)
	}

	return summary
}
