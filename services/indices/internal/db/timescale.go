// Package db provides TimescaleDB query helpers for the NEXCOM Commodity
// Indices Service. All time-series data (ticks, OHLCV, index values) is
// stored in TimescaleDB hypertables with automatic compression and retention.
package db

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/nexcom/indices/internal/models"
	"github.com/rs/zerolog/log"
)

// TimescaleDB wraps a pgxpool connection for time-series queries
type TimescaleDB struct {
	pool *pgxpool.Pool
}

// NewTimescaleDB creates a new TimescaleDB client from a connection string
func NewTimescaleDB(ctx context.Context, dsn string) (*TimescaleDB, error) {
	cfg, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		return nil, fmt.Errorf("parse dsn: %w", err)
	}

	// Pool tuning for time-series workloads
	cfg.MaxConns = 20
	cfg.MinConns = 5
	cfg.MaxConnLifetime = 30 * time.Minute
	cfg.MaxConnIdleTime = 5 * time.Minute

	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		return nil, fmt.Errorf("create pool: %w", err)
	}

	if err := pool.Ping(ctx); err != nil {
		return nil, fmt.Errorf("ping timescaledb: %w", err)
	}

	log.Info().Msg("Connected to TimescaleDB")
	return &TimescaleDB{pool: pool}, nil
}

// Close closes the connection pool
func (db *TimescaleDB) Close() {
	db.pool.Close()
}

// ─────────────────────────────────────────────────────────────
// Write operations
// ─────────────────────────────────────────────────────────────

// InsertTick inserts a single price tick into commodity_ticks
func (db *TimescaleDB) InsertTick(ctx context.Context, symbol string, price, bid, ask, volume float64) error {
	_, err := db.pool.Exec(ctx, `
		INSERT INTO commodity_ticks (time, symbol, price, bid, ask, volume)
		VALUES ($1, $2, $3, $4, $5, $6)
	`, time.Now(), symbol, price, bid, ask, volume)
	return err
}

// InsertTicksBatch inserts multiple ticks in a single transaction for efficiency
func (db *TimescaleDB) InsertTicksBatch(ctx context.Context, ticks []TickRecord) error {
	tx, err := db.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin tx: %w", err)
	}
	defer tx.Rollback(ctx)

	for _, tick := range ticks {
		_, err := tx.Exec(ctx, `
			INSERT INTO commodity_ticks (time, symbol, price, bid, ask, volume, source)
			VALUES ($1, $2, $3, $4, $5, $6, $7)
		`, tick.Time, tick.Symbol, tick.Price, tick.Bid, tick.Ask, tick.Volume, tick.Source)
		if err != nil {
			return fmt.Errorf("insert tick %s: %w", tick.Symbol, err)
		}
	}

	return tx.Commit(ctx)
}

// InsertIndexValue records a calculated index value
func (db *TimescaleDB) InsertIndexValue(ctx context.Context, indexID string, value, open, high, low, change, changePct float64) error {
	_, err := db.pool.Exec(ctx, `
		INSERT INTO index_values (time, index_id, value, open, high, low, change, change_percent)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
	`, time.Now(), indexID, value, open, high, low, change, changePct)
	return err
}

// ─────────────────────────────────────────────────────────────
// Read operations
// ─────────────────────────────────────────────────────────────

// GetLatestPrice returns the most recent tick for a commodity
func (db *TimescaleDB) GetLatestPrice(ctx context.Context, symbol string) (*models.CommodityPrice, error) {
	row := db.pool.QueryRow(ctx, `
		SELECT
			t.symbol,
			c.name,
			t.price,
			t.bid,
			t.ask,
			t.volume,
			t.time,
			c.currency,
			c.unit,
			c.exchange,
			c.quality_grade
		FROM commodity_ticks t
		JOIN commodities c ON c.symbol = t.symbol
		WHERE t.symbol = $1
		ORDER BY t.time DESC
		LIMIT 1
	`, symbol)

	var p models.CommodityPrice
	err := row.Scan(
		&p.Symbol, &p.Name, &p.Price, &p.Bid, &p.Ask,
		&p.Volume, &p.Timestamp, &p.Currency, &p.Unit,
		&p.Exchange, &p.QualityGrade,
	)
	if err != nil {
		return nil, fmt.Errorf("get latest price for %s: %w", symbol, err)
	}

	// Calculate change vs previous day close
	var prevClose float64
	err = db.pool.QueryRow(ctx, `
		SELECT LAST(price, time)
		FROM commodity_ticks
		WHERE symbol = $1
		  AND time >= NOW() - INTERVAL '2 days'
		  AND time < time_bucket('1 day', NOW())
	`, symbol).Scan(&prevClose)
	if err == nil && prevClose > 0 {
		p.Close = prevClose
		p.Change = p.Price - prevClose
		p.ChangePercent = (p.Change / prevClose) * 100
	}

	return &p, nil
}

// GetOHLCV returns OHLCV candles for a commodity over a time range
// timeframe: "1m", "5m", "15m", "1h", "4h", "1d", "1w"
func (db *TimescaleDB) GetOHLCV(ctx context.Context, symbol, timeframe string, from, to time.Time, limit int) ([]models.HistoricalDataPoint, error) {
	interval := timeframeToInterval(timeframe)

	rows, err := db.pool.Query(ctx, `
		SELECT
			time_bucket($1::interval, time) AS bucket,
			FIRST(price, time)              AS open,
			MAX(price)                      AS high,
			MIN(price)                      AS low,
			LAST(price, time)               AS close,
			SUM(volume)                     AS volume
		FROM commodity_ticks
		WHERE symbol = $2
		  AND time BETWEEN $3 AND $4
		GROUP BY bucket
		ORDER BY bucket DESC
		LIMIT $5
	`, interval, symbol, from, to, limit)
	if err != nil {
		return nil, fmt.Errorf("query ohlcv: %w", err)
	}
	defer rows.Close()

	var points []models.HistoricalDataPoint
	for rows.Next() {
		var p models.HistoricalDataPoint
		if err := rows.Scan(&p.Timestamp, &p.Open, &p.High, &p.Low, &p.Close, &p.Volume); err != nil {
			return nil, err
		}
		points = append(points, p)
	}

	return points, rows.Err()
}

// GetIndexHistory returns historical index values
func (db *TimescaleDB) GetIndexHistory(ctx context.Context, indexID, timeframe string, from, to time.Time, limit int) ([]models.HistoricalDataPoint, error) {
	interval := timeframeToInterval(timeframe)

	rows, err := db.pool.Query(ctx, `
		SELECT
			time_bucket($1::interval, time) AS bucket,
			FIRST(value, time)              AS open,
			MAX(value)                      AS high,
			MIN(value)                      AS low,
			LAST(value, time)               AS close,
			0::double precision             AS volume
		FROM index_values
		WHERE index_id = $2
		  AND time BETWEEN $3 AND $4
		GROUP BY bucket
		ORDER BY bucket DESC
		LIMIT $5
	`, interval, indexID, from, to, limit)
	if err != nil {
		return nil, fmt.Errorf("query index history: %w", err)
	}
	defer rows.Close()

	var points []models.HistoricalDataPoint
	for rows.Next() {
		var p models.HistoricalDataPoint
		if err := rows.Scan(&p.Timestamp, &p.Open, &p.High, &p.Low, &p.Close, &p.Volume); err != nil {
			return nil, err
		}
		points = append(points, p)
	}

	return points, rows.Err()
}

// GetAllLatestPrices returns the latest price for every active commodity
func (db *TimescaleDB) GetAllLatestPrices(ctx context.Context) (map[string]models.CommodityPrice, error) {
	rows, err := db.pool.Query(ctx, `
		SELECT DISTINCT ON (t.symbol)
			t.symbol,
			c.name,
			t.price,
			COALESCE(t.bid, t.price - t.price * 0.001) AS bid,
			COALESCE(t.ask, t.price + t.price * 0.001) AS ask,
			t.volume,
			t.time,
			c.currency,
			c.unit,
			c.exchange,
			c.quality_grade
		FROM commodity_ticks t
		JOIN commodities c ON c.symbol = t.symbol
		WHERE c.is_active = TRUE
		  AND t.time >= NOW() - INTERVAL '24 hours'
		ORDER BY t.symbol, t.time DESC
	`)
	if err != nil {
		return nil, fmt.Errorf("get all latest prices: %w", err)
	}
	defer rows.Close()

	result := make(map[string]models.CommodityPrice)
	for rows.Next() {
		var p models.CommodityPrice
		if err := rows.Scan(
			&p.Symbol, &p.Name, &p.Price, &p.Bid, &p.Ask,
			&p.Volume, &p.Timestamp, &p.Currency, &p.Unit,
			&p.Exchange, &p.QualityGrade,
		); err != nil {
			log.Warn().Err(err).Msg("Scan price row failed")
			continue
		}
		result[p.Symbol] = p
	}

	return result, rows.Err()
}

// GetMarketStats returns 24h stats for a commodity (high, low, open, volume)
func (db *TimescaleDB) GetMarketStats(ctx context.Context, symbol string) (high, low, open, volume float64, err error) {
	err = db.pool.QueryRow(ctx, `
		SELECT
			MAX(price)          AS high,
			MIN(price)          AS low,
			FIRST(price, time)  AS open,
			SUM(volume)         AS volume
		FROM commodity_ticks
		WHERE symbol = $1
		  AND time >= NOW() - INTERVAL '24 hours'
	`, symbol).Scan(&high, &low, &open, &volume)
	return
}

// GetVolatility computes the realized volatility over a window
func (db *TimescaleDB) GetVolatility(ctx context.Context, symbol string, window time.Duration) (float64, error) {
	var vol float64
	err := db.pool.QueryRow(ctx, `
		WITH log_returns AS (
			SELECT
				LN(price / LAG(price) OVER (ORDER BY time)) AS lr
			FROM commodity_ticks
			WHERE symbol = $1
			  AND time >= NOW() - $2::interval
		)
		SELECT STDDEV(lr) * SQRT(252) AS annualized_vol
		FROM log_returns
		WHERE lr IS NOT NULL
	`, symbol, window.String()).Scan(&vol)
	return vol, err
}

// ─────────────────────────────────────────────────────────────
// Helper types and functions
// ─────────────────────────────────────────────────────────────

// TickRecord represents a single price tick for batch insertion
type TickRecord struct {
	Time   time.Time
	Symbol string
	Price  float64
	Bid    float64
	Ask    float64
	Volume float64
	Source string
}

// timeframeToInterval converts a timeframe string to a PostgreSQL interval
func timeframeToInterval(tf string) string {
	switch tf {
	case "1m":
		return "1 minute"
	case "5m":
		return "5 minutes"
	case "15m":
		return "15 minutes"
	case "1h":
		return "1 hour"
	case "4h":
		return "4 hours"
	case "1d":
		return "1 day"
	case "1w":
		return "1 week"
	case "1M":
		return "1 month"
	default:
		return "1 day"
	}
}
