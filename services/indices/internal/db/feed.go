// Package db — feed.go implements the price feed ingestion loop.
// It polls the NEXCOM matching engine for executed trades and writes
// price ticks to TimescaleDB, then recalculates index values.
package db

import (
	"context"
	"time"

	"github.com/nexcom/indices/internal/calculator"
	"github.com/nexcom/indices/internal/models"
	"github.com/redis/go-redis/v9"
	"github.com/rs/zerolog/log"
)

// PriceFeedConfig holds configuration for the price feed ingestion loop
type PriceFeedConfig struct {
	// PollInterval is how often to poll for new prices
	PollInterval time.Duration
	// IndexCalcInterval is how often to recalculate and persist index values
	IndexCalcInterval time.Duration
	// RedisAddr is the Redis address for the price cache
	RedisAddr string
	// RedisPassword is the Redis password (empty for no auth)
	RedisPassword string
}

// DefaultPriceFeedConfig returns sensible defaults
func DefaultPriceFeedConfig() PriceFeedConfig {
	return PriceFeedConfig{
		PollInterval:      5 * time.Second,
		IndexCalcInterval: 30 * time.Second,
		RedisAddr:         "localhost:6379",
	}
}

// PriceFeed manages the ingestion of live price data into TimescaleDB
type PriceFeed struct {
	db      *TimescaleDB
	redis   *redis.Client
	calc    *calculator.Calculator
	indices []models.CommodityIndex
	cfg     PriceFeedConfig
}

// NewPriceFeed creates a new price feed ingestion service
func NewPriceFeed(db *TimescaleDB, cfg PriceFeedConfig, indices []models.CommodityIndex) *PriceFeed {
	rdb := redis.NewClient(&redis.Options{
		Addr:     cfg.RedisAddr,
		Password: cfg.RedisPassword,
		DB:       0,
	})

	return &PriceFeed{
		db:      db,
		redis:   rdb,
		calc:    calculator.NewCalculator(),
		indices: indices,
		cfg:     cfg,
	}
}

// Start begins the price feed ingestion loop (blocking until ctx is cancelled)
func (f *PriceFeed) Start(ctx context.Context) {
	log.Info().
		Dur("poll_interval", f.cfg.PollInterval).
		Dur("index_calc_interval", f.cfg.IndexCalcInterval).
		Msg("Price feed ingestion started")

	tickTicker := time.NewTicker(f.cfg.PollInterval)
	indexTicker := time.NewTicker(f.cfg.IndexCalcInterval)
	defer tickTicker.Stop()
	defer indexTicker.Stop()

	for {
		select {
		case <-ctx.Done():
			log.Info().Msg("Price feed ingestion stopped")
			return

		case <-tickTicker.C:
			if err := f.ingestPriceTicks(ctx); err != nil {
				log.Error().Err(err).Msg("Failed to ingest price ticks")
			}

		case <-indexTicker.C:
			if err := f.recalculateIndices(ctx); err != nil {
				log.Error().Err(err).Msg("Failed to recalculate indices")
			}
		}
	}
}

// ingestPriceTicks fetches the latest prices from Redis and writes to TimescaleDB
// Redis is the live price cache populated by the NEXCOM matching engine
func (f *PriceFeed) ingestPriceTicks(ctx context.Context) error {
	// Get all commodity symbols from Redis hash "nexcom:prices"
	prices, err := f.redis.HGetAll(ctx, "nexcom:prices").Result()
	if err != nil {
		return err
	}

	if len(prices) == 0 {
		log.Debug().Msg("No live prices in Redis cache")
		return nil
	}

	ticks := make([]TickRecord, 0, len(prices))
	now := time.Now()

	for symbol, priceStr := range prices {
		var price, bid, ask, volume float64
		// Parse price data from Redis (format: "price:bid:ask:volume")
		_, err := parseRedisPrice(priceStr, &price, &bid, &ask, &volume)
		if err != nil {
			log.Warn().Str("symbol", symbol).Str("raw", priceStr).Msg("Failed to parse Redis price")
			continue
		}

		ticks = append(ticks, TickRecord{
			Time:   now,
			Symbol: symbol,
			Price:  price,
			Bid:    bid,
			Ask:    ask,
			Volume: volume,
			Source: "NEXCOM_MATCHING_ENGINE",
		})
	}

	if len(ticks) == 0 {
		return nil
	}

	if err := f.db.InsertTicksBatch(ctx, ticks); err != nil {
		return err
	}

	log.Debug().Int("count", len(ticks)).Msg("Ingested price ticks")
	return nil
}

// recalculateIndices computes current index values and persists them
func (f *PriceFeed) recalculateIndices(ctx context.Context) error {
	// Get latest prices from TimescaleDB
	latestPrices, err := f.db.GetAllLatestPrices(ctx)
	if err != nil {
		return err
	}

	// Build price map for calculator
	priceMap := make(map[string]float64, len(latestPrices))
	for sym, p := range latestPrices {
		priceMap[sym] = p.Price
	}

	if len(priceMap) == 0 {
		log.Debug().Msg("No prices available for index calculation")
		return nil
	}

	// Calculate and persist each index
	for _, idx := range f.indices {
		if !idx.IsActive {
			continue
		}

		value, err := f.calc.Calculate(idx, priceMap)
		if err != nil {
			log.Warn().Err(err).Str("index", idx.ID).Msg("Index calculation failed")
			continue
		}

		change, changePct := calculator.CalculateChange(value, idx.BaseValue)

		if err := f.db.InsertIndexValue(ctx,
			idx.ID, value,
			idx.BaseValue,    // open (use base as proxy; in production use previous period open)
			value*1.015,      // high estimate
			value*0.985,      // low estimate
			change, changePct,
		); err != nil {
			log.Warn().Err(err).Str("index", idx.ID).Msg("Failed to persist index value")
			continue
		}

		// Also cache in Redis for fast reads
		f.redis.HSet(ctx, "nexcom:indices", idx.ID, value)

		log.Debug().
			Str("index", idx.ID).
			Float64("value", value).
			Float64("change_pct", changePct).
			Msg("Index recalculated")
	}

	return nil
}

// parseRedisPrice parses a price string from Redis format "price:bid:ask:volume"
func parseRedisPrice(s string, price, bid, ask, volume *float64) (int, error) {
	n, err := fmt.Sscanf(s, "%f:%f:%f:%f", price, bid, ask, volume)
	return n, err
}

// ─────────────────────────────────────────────────────────────
// Cache helpers for the gRPC server
// ─────────────────────────────────────────────────────────────

// RedisCache provides fast read access to the latest prices
type RedisCache struct {
	client *redis.Client
}

// NewRedisCache creates a new Redis cache client
func NewRedisCache(addr, password string) *RedisCache {
	return &RedisCache{
		client: redis.NewClient(&redis.Options{
			Addr:     addr,
			Password: password,
			DB:       0,
		}),
	}
}

// GetPrice returns the latest price for a symbol from Redis
func (c *RedisCache) GetPrice(ctx context.Context, symbol string) (float64, error) {
	val, err := c.client.HGet(ctx, "nexcom:prices", symbol).Float64()
	return val, err
}

// GetAllPrices returns all latest prices from Redis
func (c *RedisCache) GetAllPrices(ctx context.Context) (map[string]float64, error) {
	raw, err := c.client.HGetAll(ctx, "nexcom:prices").Result()
	if err != nil {
		return nil, err
	}

	result := make(map[string]float64, len(raw))
	for sym, val := range raw {
		var price float64
		if _, err := fmt.Sscanf(val, "%f", &price); err == nil {
			result[sym] = price
		}
	}
	return result, nil
}

// GetIndexValue returns the latest calculated index value from Redis
func (c *RedisCache) GetIndexValue(ctx context.Context, indexID string) (float64, error) {
	return c.client.HGet(ctx, "nexcom:indices", indexID).Float64()
}
