// Package feeds handles market data ingestion, normalization, and OHLCV aggregation.
// Consumes from Kafka topics and Fluvio streams, stores in TimescaleDB/Redis.
package feeds

import (
	"encoding/json"
	"fmt"
	"sync"
	"time"

	"github.com/shopspring/decimal"
	"go.uber.org/zap"
)

// decodeTick unmarshals a raw feed message into a Tick. Decimal fields are
// decoded from JSON numbers/strings via shopspring/decimal's UnmarshalJSON.
func decodeTick(message []byte, tick *Tick) error {
	return json.Unmarshal(message, tick)
}

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
	// Stale is true when no tick has been received within the staleness
	// threshold — consumers must treat the price as indicative only.
	Stale bool `json:"stale"`
}

// DefaultStaleThreshold is the maximum age of a ticker before it is flagged
// stale. Overridable via SetStaleThreshold (MARKET_DATA_STALENESS_THRESHOLD).
var DefaultStaleThreshold = 60 * time.Second

var staleThreshold = DefaultStaleThreshold

// SetStaleThreshold overrides the staleness threshold used by GetTicker /
// GetMarketSummary / FeedStatus.
func SetStaleThreshold(d time.Duration) {
	if d > 0 {
		staleThreshold = d
	}
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
	// DataFresh is false when any tracked symbol has exceeded the staleness
	// threshold — clients must warn users rather than trade on old prices.
	DataFresh    bool `json:"data_fresh"`
	StaleSymbols int  `json:"stale_symbols"`
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

// GetTicker returns a snapshot of the current ticker for a symbol, with the
// stale flag computed against the staleness threshold — old prices are never
// silently served as fresh.
func (p *Processor) GetTicker(symbol string) (*Ticker, error) {
	p.mu.RLock()
	defer p.mu.RUnlock()

	ticker, exists := p.tickers[symbol]
	if !exists {
		return nil, fmt.Errorf("symbol %s not found", symbol)
	}
	snapshot := *ticker
	snapshot.Stale = time.Since(snapshot.UpdatedAt) > staleThreshold
	return &snapshot, nil
}

// FeedStatus reports feed freshness for the /api/v1/market/health endpoint.
type FeedStatus struct {
	Status        string    `json:"status"` // "fresh" | "degraded" | "no_data"
	LastTickAt    time.Time `json:"last_tick_at"`
	LastTickAgoMs int64     `json:"last_tick_ago_ms"`
	StaleSymbols  []string  `json:"stale_symbols"`
	TotalSymbols  int       `json:"total_symbols"`
	ThresholdMs   int64     `json:"threshold_ms"`
}

// FeedStatus computes aggregate freshness across all tracked symbols.
func (p *Processor) FeedStatus() FeedStatus {
	p.mu.RLock()
	defer p.mu.RUnlock()

	status := FeedStatus{
		Status:       "no_data",
		StaleSymbols: []string{},
		ThresholdMs:  staleThreshold.Milliseconds(),
	}
	for symbol, ticker := range p.tickers {
		status.TotalSymbols++
		if ticker.UpdatedAt.After(status.LastTickAt) {
			status.LastTickAt = ticker.UpdatedAt
		}
		if time.Since(ticker.UpdatedAt) > staleThreshold {
			status.StaleSymbols = append(status.StaleSymbols, symbol)
		}
	}
	if status.TotalSymbols > 0 {
		status.LastTickAgoMs = time.Since(status.LastTickAt).Milliseconds()
		if len(status.StaleSymbols) == 0 {
			status.Status = "fresh"
		} else {
			status.Status = "degraded"
		}
	}
	return status
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

	staleCount := 0
	for _, ticker := range p.tickers {
		summary.TotalVolume24h = summary.TotalVolume24h.Add(ticker.Volume24h)
		if time.Since(ticker.UpdatedAt) > staleThreshold {
			staleCount++
		}
	}
	summary.StaleSymbols = staleCount
	summary.DataFresh = staleCount == 0 && len(p.tickers) > 0

	return summary
}
