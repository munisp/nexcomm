// Package lakehouse provides Delta Lake / Apache Iceberg writer integration for NEXCOM.
// Implements the Bronze (raw), Silver (cleaned), and Gold (aggregated) layer pipeline.
// Data is written as Parquet files to S3-compatible object storage.
package lakehouse

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"strings"
	"time"

	"go.uber.org/zap"
)

// Layer constants for the medallion architecture
const (
	LayerBronze = "bronze" // Raw, unprocessed events
	LayerSilver = "silver" // Cleaned, deduplicated, enriched
	LayerGold   = "gold"   // Aggregated, business-ready analytics
)

// Table names in each layer
const (
	// Bronze layer — raw events
	BronzeTradeEvents    = "bronze.trade_events"
	BronzeOrderBook      = "bronze.order_book_snapshots"
	BronzeSettlements    = "bronze.settlements"
	BronzeKYCEvents      = "bronze.kyc_events"
	BronzeAMLFlags       = "bronze.aml_flags"
	BronzeBlockchain     = "bronze.blockchain_events"
	BronzeMojaloop       = "bronze.mojaloop_transfers"
	BronzeMarketData     = "bronze.market_data_ticks"

	// Silver layer — cleaned and enriched
	SilverTrades         = "silver.trades"
	SilverSettlements    = "silver.settlements"
	SilverUserProfiles   = "silver.user_profiles"
	SilverCommodityPrices = "silver.commodity_prices"
	SilverAMLScores      = "silver.aml_scores"

	// Gold layer — aggregated analytics
	GoldDailyVolume      = "gold.daily_volume"
	GoldUserActivity     = "gold.user_activity"
	GoldCommodityIndex   = "gold.commodity_price_index"
	GoldRiskMetrics      = "gold.risk_metrics"
	GoldSettlementStats  = "gold.settlement_stats"
)

// WriteRequest represents a batch write request to the lakehouse
type WriteRequest struct {
	Table     string                   `json:"table"`
	Layer     string                   `json:"layer"`
	Records   []map[string]interface{} `json:"records"`
	Partition map[string]string        `json:"partition,omitempty"` // e.g., {"date": "2026-03-05", "symbol": "WHEAT"}
	Schema    string                   `json:"schema,omitempty"`    // JSON Schema for validation
}

// WriteResult represents the result of a lakehouse write
type WriteResult struct {
	Table       string    `json:"table"`
	RecordCount int       `json:"record_count"`
	BytesWritten int64    `json:"bytes_written"`
	PartitionPath string  `json:"partition_path"`
	WrittenAt   time.Time `json:"written_at"`
}

// QueryRequest represents a query against the lakehouse
type QueryRequest struct {
	SQL       string            `json:"sql"`
	Params    map[string]string `json:"params,omitempty"`
	MaxRows   int               `json:"max_rows,omitempty"`
	TimeoutMs int               `json:"timeout_ms,omitempty"`
}

// QueryResult represents the result of a lakehouse query
type QueryResult struct {
	Columns []string                 `json:"columns"`
	Rows    []map[string]interface{} `json:"rows"`
	Total   int                      `json:"total"`
	QueryMs int64                    `json:"query_ms"`
}

// Writer provides lakehouse write operations
type Writer struct {
	httpClient *http.Client
	baseURL    string
	logger     *zap.SugaredLogger
}

// NewWriter creates a new lakehouse writer
func NewWriter(logger *zap.SugaredLogger) *Writer {
	baseURL := os.Getenv("LAKEHOUSE_URL")
	if baseURL == "" {
		baseURL = "http://localhost:8011" // analytics-engine
	}
	return &Writer{
		httpClient: &http.Client{Timeout: 30 * time.Second},
		baseURL:    baseURL,
		logger:     logger,
	}
}

// WriteBronze writes raw events to the Bronze layer
func (w *Writer) WriteBronze(ctx context.Context, table string, records []map[string]interface{}) (*WriteResult, error) {
	return w.write(ctx, WriteRequest{
		Table:   table,
		Layer:   LayerBronze,
		Records: records,
		Partition: map[string]string{
			"date": time.Now().UTC().Format("2006-01-02"),
			"hour": fmt.Sprintf("%02d", time.Now().UTC().Hour()),
		},
	})
}

// WriteSilver writes cleaned data to the Silver layer
func (w *Writer) WriteSilver(ctx context.Context, table string, records []map[string]interface{}) (*WriteResult, error) {
	return w.write(ctx, WriteRequest{
		Table:   table,
		Layer:   LayerSilver,
		Records: records,
		Partition: map[string]string{
			"date": time.Now().UTC().Format("2006-01-02"),
		},
	})
}

// WriteGold writes aggregated data to the Gold layer
func (w *Writer) WriteGold(ctx context.Context, table string, records []map[string]interface{}) (*WriteResult, error) {
	return w.write(ctx, WriteRequest{
		Table:   table,
		Layer:   LayerGold,
		Records: records,
		Partition: map[string]string{
			"date": time.Now().UTC().Format("2006-01-02"),
		},
	})
}

// write performs the actual HTTP write to the lakehouse ingestion engine
func (w *Writer) write(ctx context.Context, req WriteRequest) (*WriteResult, error) {
	data, err := json.Marshal(req)
	if err != nil {
		return nil, fmt.Errorf("marshal error: %w", err)
	}

	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost,
		fmt.Sprintf("%s/api/v1/lakehouse/write", w.baseURL),
		strings.NewReader(string(data)),
	)
	if err != nil {
		return nil, fmt.Errorf("request creation error: %w", err)
	}
	httpReq.Header.Set("Content-Type", "application/json")

	resp, err := w.httpClient.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("lakehouse write error: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusCreated {
		return nil, fmt.Errorf("lakehouse returned status %d", resp.StatusCode)
	}

	var result WriteResult
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("decode error: %w", err)
	}

	w.logger.Debugw("Wrote to lakehouse",
		"table", req.Table,
		"layer", req.Layer,
		"records", len(req.Records),
	)

	return &result, nil
}

// Query executes a SQL query against the lakehouse (Spark SQL / Trino)
func (w *Writer) Query(ctx context.Context, req QueryRequest) (*QueryResult, error) {
	if req.MaxRows == 0 {
		req.MaxRows = 1000
	}
	if req.TimeoutMs == 0 {
		req.TimeoutMs = 30000
	}

	data, err := json.Marshal(req)
	if err != nil {
		return nil, fmt.Errorf("marshal error: %w", err)
	}

	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost,
		fmt.Sprintf("%s/api/v1/lakehouse/query", w.baseURL),
		strings.NewReader(string(data)),
	)
	if err != nil {
		return nil, fmt.Errorf("request creation error: %w", err)
	}
	httpReq.Header.Set("Content-Type", "application/json")

	resp, err := w.httpClient.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("lakehouse query error: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("lakehouse query returned status %d", resp.StatusCode)
	}

	var result QueryResult
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("decode error: %w", err)
	}

	return &result, nil
}

// WriteTradeEvent writes a trade event to the Bronze layer
func (w *Writer) WriteTradeEvent(ctx context.Context, event map[string]interface{}) error {
	_, err := w.WriteBronze(ctx, BronzeTradeEvents, []map[string]interface{}{event})
	return err
}

// WriteSettlementEvent writes a settlement event to the Bronze layer
func (w *Writer) WriteSettlementEvent(ctx context.Context, event map[string]interface{}) error {
	_, err := w.WriteBronze(ctx, BronzeSettlements, []map[string]interface{}{event})
	return err
}

// WriteMarketDataTick writes a market data tick to the Bronze layer
func (w *Writer) WriteMarketDataTick(ctx context.Context, tick map[string]interface{}) error {
	_, err := w.WriteBronze(ctx, BronzeMarketData, []map[string]interface{}{tick})
	return err
}

// WriteAMLFlag writes an AML flag event to the Bronze layer
func (w *Writer) WriteAMLFlag(ctx context.Context, flag map[string]interface{}) error {
	_, err := w.WriteBronze(ctx, BronzeAMLFlags, []map[string]interface{}{flag})
	return err
}

// GetDailyVolume queries the Gold layer for daily trading volume
func (w *Writer) GetDailyVolume(ctx context.Context, date string, symbol string) (*QueryResult, error) {
	sql := fmt.Sprintf(
		"SELECT symbol, SUM(quantity) as total_qty, SUM(total) as total_value, COUNT(*) as trade_count FROM %s WHERE date = '%s'",
		GoldDailyVolume, date,
	)
	if symbol != "" {
		sql += fmt.Sprintf(" AND symbol = '%s'", symbol)
	}
	sql += " GROUP BY symbol ORDER BY total_value DESC"

	return w.Query(ctx, QueryRequest{SQL: sql})
}

// GetSettlementStats queries the Gold layer for settlement performance metrics
func (w *Writer) GetSettlementStats(ctx context.Context, date string) (*QueryResult, error) {
	sql := fmt.Sprintf(
		`SELECT 
			COUNT(*) as total_settlements,
			SUM(CASE WHEN is_t0 THEN 1 ELSE 0 END) as t0_count,
			AVG(latency_ms) as avg_latency_ms,
			MAX(latency_ms) as max_latency_ms,
			SUM(amount) as total_settled_value
		FROM %s WHERE date = '%s'`,
		GoldSettlementStats, date,
	)
	return w.Query(ctx, QueryRequest{SQL: sql})
}

// HealthCheck verifies lakehouse connectivity
func (w *Writer) HealthCheck(ctx context.Context) bool {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet,
		fmt.Sprintf("%s/health", w.baseURL),
		nil,
	)
	if err != nil {
		return false
	}
	resp, err := w.httpClient.Do(req)
	if err != nil {
		return false
	}
	defer resp.Body.Close()
	return resp.StatusCode == http.StatusOK
}
