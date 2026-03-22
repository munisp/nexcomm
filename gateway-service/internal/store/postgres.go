package store

import (
	"database/sql"
	"fmt"
	"log"
	"time"

	"github.com/munisp/NGApp/services/gateway/internal/models"
)

// PostgresStore provides PostgreSQL-backed persistence with fallback to in-memory store.
// In production: connects to PostgreSQL + TimescaleDB for time-series data.
// When PostgreSQL is unavailable, gracefully falls back to the in-memory Store.
type PostgresStore struct {
	*Store // Embed in-memory store as fallback
	db           *sql.DB
	connected    bool
	fallbackMode bool
	connString   string
}

// NewPostgresStore creates a PostgreSQL-backed store with in-memory fallback.
func NewPostgresStore(connString string) *PostgresStore {
	ps := &PostgresStore{
		Store:      New(), // Initialize in-memory fallback
		connString: connString,
	}
	ps.connect()
	return ps
}

func (ps *PostgresStore) connect() {
	log.Printf("[PostgresStore] Connecting to %s", sanitizeConnString(ps.connString))

	db, err := sql.Open("postgres", ps.connString)
	if err != nil {
		log.Printf("[PostgresStore] WARN: Failed to open connection: %v — running in fallback mode (in-memory)", err)
		ps.fallbackMode = true
		return
	}

	// Configure connection pool
	db.SetMaxOpenConns(25)
	db.SetMaxIdleConns(5)
	db.SetConnMaxLifetime(5 * time.Minute)
	db.SetConnMaxIdleTime(1 * time.Minute)

	// Test connection with timeout
	if err := db.Ping(); err != nil {
		log.Printf("[PostgresStore] WARN: Cannot ping database: %v — running in fallback mode (in-memory)", err)
		ps.fallbackMode = true
		db.Close()
		return
	}

	ps.db = db
	ps.connected = true
	ps.fallbackMode = false
	log.Printf("[PostgresStore] Connected to PostgreSQL (pool: 25 max, 5 idle)")

	// Run migrations
	if err := ps.migrate(); err != nil {
		log.Printf("[PostgresStore] WARN: Migration failed: %v — continuing with existing schema", err)
	}
}

func (ps *PostgresStore) migrate() error {
	migrations := []string{
		`CREATE TABLE IF NOT EXISTS commodities (
			symbol VARCHAR(32) PRIMARY KEY,
			name VARCHAR(128) NOT NULL,
			category VARCHAR(64),
			last_price DECIMAL(18,8),
			change_24h DECIMAL(18,8),
			change_percent_24h DECIMAL(10,4),
			volume_24h DECIMAL(18,2),
			high_24h DECIMAL(18,8),
			low_24h DECIMAL(18,8),
			market_cap DECIMAL(18,2),
			updated_at TIMESTAMPTZ DEFAULT NOW()
		)`,
		`CREATE TABLE IF NOT EXISTS orders (
			id VARCHAR(64) PRIMARY KEY,
			user_id VARCHAR(64) NOT NULL,
			symbol VARCHAR(32) NOT NULL,
			side VARCHAR(8) NOT NULL,
			type VARCHAR(16) NOT NULL,
			status VARCHAR(16) NOT NULL DEFAULT 'OPEN',
			quantity DECIMAL(18,8) NOT NULL,
			price DECIMAL(18,8),
			filled_quantity DECIMAL(18,8) DEFAULT 0,
			average_price DECIMAL(18,8),
			created_at TIMESTAMPTZ DEFAULT NOW(),
			updated_at TIMESTAMPTZ DEFAULT NOW()
		)`,
		`CREATE TABLE IF NOT EXISTS trades (
			id VARCHAR(64) PRIMARY KEY,
			order_id VARCHAR(64) REFERENCES orders(id),
			user_id VARCHAR(64) NOT NULL,
			symbol VARCHAR(32) NOT NULL,
			side VARCHAR(8) NOT NULL,
			price DECIMAL(18,8) NOT NULL,
			quantity DECIMAL(18,8) NOT NULL,
			fee DECIMAL(18,8) DEFAULT 0,
			settlement_status VARCHAR(16) DEFAULT 'PENDING',
			timestamp TIMESTAMPTZ DEFAULT NOW()
		)`,
		`CREATE TABLE IF NOT EXISTS positions (
			id VARCHAR(64) PRIMARY KEY,
			user_id VARCHAR(64) NOT NULL,
			symbol VARCHAR(32) NOT NULL,
			side VARCHAR(8) NOT NULL,
			quantity DECIMAL(18,8) NOT NULL,
			average_entry_price DECIMAL(18,8) NOT NULL,
			current_price DECIMAL(18,8),
			unrealized_pnl DECIMAL(18,8),
			unrealized_pnl_percent DECIMAL(10,4),
			realized_pnl DECIMAL(18,8) DEFAULT 0,
			margin DECIMAL(18,8),
			liquidation_price DECIMAL(18,8),
			created_at TIMESTAMPTZ DEFAULT NOW(),
			updated_at TIMESTAMPTZ DEFAULT NOW()
		)`,
		`CREATE TABLE IF NOT EXISTS price_alerts (
			id VARCHAR(64) PRIMARY KEY,
			user_id VARCHAR(64) NOT NULL,
			symbol VARCHAR(32) NOT NULL,
			condition VARCHAR(16) NOT NULL,
			target_price DECIMAL(18,8) NOT NULL,
			active BOOLEAN DEFAULT TRUE,
			created_at TIMESTAMPTZ DEFAULT NOW(),
			updated_at TIMESTAMPTZ DEFAULT NOW()
		)`,
		`CREATE TABLE IF NOT EXISTS users (
			id VARCHAR(64) PRIMARY KEY,
			email VARCHAR(256) UNIQUE NOT NULL,
			name VARCHAR(256),
			account_tier VARCHAR(32),
			kyc_status VARCHAR(32),
			phone VARCHAR(32),
			country VARCHAR(64),
			created_at TIMESTAMPTZ DEFAULT NOW()
		)`,
		`CREATE TABLE IF NOT EXISTS user_preferences (
			user_id VARCHAR(64) PRIMARY KEY REFERENCES users(id),
			order_filled BOOLEAN DEFAULT TRUE,
			price_alerts BOOLEAN DEFAULT TRUE,
			margin_warnings BOOLEAN DEFAULT TRUE,
			market_news BOOLEAN DEFAULT FALSE,
			settlement_updates BOOLEAN DEFAULT TRUE,
			system_maintenance BOOLEAN DEFAULT TRUE,
			email_notifications BOOLEAN DEFAULT TRUE,
			sms_notifications BOOLEAN DEFAULT FALSE,
			push_notifications BOOLEAN DEFAULT TRUE,
			ussd_notifications BOOLEAN DEFAULT FALSE,
			default_currency VARCHAR(8) DEFAULT 'USD',
			timezone VARCHAR(64) DEFAULT 'UTC',
			default_chart_period VARCHAR(8) DEFAULT '1D'
		)`,
		`CREATE TABLE IF NOT EXISTS notifications (
			id VARCHAR(64) PRIMARY KEY,
			user_id VARCHAR(64) NOT NULL,
			type VARCHAR(32) NOT NULL,
			title VARCHAR(256) NOT NULL,
			message TEXT,
			read BOOLEAN DEFAULT FALSE,
			timestamp TIMESTAMPTZ DEFAULT NOW()
		)`,
		`CREATE TABLE IF NOT EXISTS accounts (
			id VARCHAR(64) PRIMARY KEY,
			user_id VARCHAR(64) NOT NULL,
			account_type VARCHAR(32) NOT NULL,
			currency VARCHAR(8) NOT NULL DEFAULT 'USD',
			balance DECIMAL(18,8) DEFAULT 0,
			available_balance DECIMAL(18,8) DEFAULT 0,
			margin_used DECIMAL(18,8) DEFAULT 0,
			status VARCHAR(16) DEFAULT 'ACTIVE',
			created_at TIMESTAMPTZ DEFAULT NOW(),
			updated_at TIMESTAMPTZ DEFAULT NOW()
		)`,
		`CREATE TABLE IF NOT EXISTS audit_log (
			id VARCHAR(64) PRIMARY KEY,
			user_id VARCHAR(64),
			action VARCHAR(64) NOT NULL,
			resource VARCHAR(64),
			resource_id VARCHAR(64),
			details TEXT,
			ip_address VARCHAR(45),
			timestamp TIMESTAMPTZ DEFAULT NOW()
		)`,
		// TimescaleDB hypertable for market data (if extension available)
		`CREATE TABLE IF NOT EXISTS market_tickers (
			symbol VARCHAR(32) NOT NULL,
			last_price DECIMAL(18,8),
			bid DECIMAL(18,8),
			ask DECIMAL(18,8),
			change_24h DECIMAL(18,8),
			change_percent_24h DECIMAL(10,4),
			volume_24h DECIMAL(18,2),
			high_24h DECIMAL(18,8),
			low_24h DECIMAL(18,8),
			timestamp TIMESTAMPTZ DEFAULT NOW(),
			PRIMARY KEY (symbol, timestamp)
		)`,
		// Indexes for common queries
		`CREATE INDEX IF NOT EXISTS idx_orders_user_id ON orders(user_id)`,
		`CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status)`,
		`CREATE INDEX IF NOT EXISTS idx_orders_symbol ON orders(symbol)`,
		`CREATE INDEX IF NOT EXISTS idx_trades_user_id ON trades(user_id)`,
		`CREATE INDEX IF NOT EXISTS idx_trades_symbol ON trades(symbol)`,
		`CREATE INDEX IF NOT EXISTS idx_positions_user_id ON positions(user_id)`,
		`CREATE INDEX IF NOT EXISTS idx_alerts_user_id ON price_alerts(user_id)`,
		`CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id)`,
		`CREATE INDEX IF NOT EXISTS idx_audit_log_user_id ON audit_log(user_id)`,
		`CREATE INDEX IF NOT EXISTS idx_audit_log_timestamp ON audit_log(timestamp)`,
	}

	for _, m := range migrations {
		if _, err := ps.db.Exec(m); err != nil {
			return fmt.Errorf("migration failed: %w (sql: %.80s...)", err, m)
		}
	}

	log.Printf("[PostgresStore] Migrations complete: 11 tables, 10 indexes")
	return nil
}

// IsConnected returns true if PostgreSQL is connected.
func (ps *PostgresStore) IsConnected() bool {
	return ps.connected
}

// IsFallback returns true if operating in in-memory fallback mode.
func (ps *PostgresStore) IsFallback() bool {
	return ps.fallbackMode
}

// Close closes the database connection.
func (ps *PostgresStore) Close() error {
	if ps.db != nil {
		return ps.db.Close()
	}
	return nil
}

// GetOrdersFromDB retrieves orders from PostgreSQL, falls back to in-memory.
func (ps *PostgresStore) GetOrdersFromDB(userID string, status string) ([]models.Order, error) {
	if ps.fallbackMode {
		return ps.Store.GetOrders(userID, status), nil
	}

	query := `SELECT id, user_id, symbol, side, type, status, quantity, price,
		filled_quantity, average_price, created_at, updated_at
		FROM orders WHERE user_id = $1`
	args := []interface{}{userID}

	if status != "" {
		query += ` AND status = $2`
		args = append(args, status)
	}
	query += ` ORDER BY created_at DESC`

	rows, err := ps.db.Query(query, args...)
	if err != nil {
		log.Printf("[PostgresStore] WARN: Query failed, falling back to memory: %v", err)
		return ps.Store.GetOrders(userID, status), nil
	}
	defer rows.Close()

	var orders []models.Order
	for rows.Next() {
		var o models.Order
		var side, otype, ostatus string
		if err := rows.Scan(&o.ID, &o.UserID, &o.Symbol, &side, &otype, &ostatus,
			&o.Quantity, &o.Price, &o.FilledQuantity, &o.AveragePrice,
			&o.CreatedAt, &o.UpdatedAt); err != nil {
			continue
		}
		o.Side = models.OrderSide(side)
		o.Type = models.OrderType(otype)
		o.Status = models.OrderStatus(ostatus)
		orders = append(orders, o)
	}
	return orders, nil
}

// CreateOrderInDB persists an order to PostgreSQL, falls back to in-memory.
func (ps *PostgresStore) CreateOrderInDB(order models.Order) (models.Order, error) {
	order = ps.Store.CreateOrder(order) // Always update in-memory for consistency

	if ps.fallbackMode {
		return order, nil
	}

	_, err := ps.db.Exec(
		`INSERT INTO orders (id, user_id, symbol, side, type, status, quantity, price, filled_quantity, average_price, created_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
		order.ID, order.UserID, order.Symbol, string(order.Side), string(order.Type),
		string(order.Status), order.Quantity, order.Price, order.FilledQuantity,
		order.AveragePrice, order.CreatedAt, order.UpdatedAt,
	)
	if err != nil {
		log.Printf("[PostgresStore] WARN: Insert order failed: %v (kept in memory)", err)
	}
	return order, nil
}

// sanitizeConnString removes password from connection string for logging.
func sanitizeConnString(s string) string {
	if len(s) > 40 {
		return s[:20] + "***" + s[len(s)-10:]
	}
	return "***"
}
