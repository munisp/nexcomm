// Package sync implements the Postgres → OpenSearch CDC sync engine.
// It polls each NEXCOM table for rows updated since the last sync watermark,
// then bulk-indexes the changes into the corresponding OpenSearch index.
// The watermark is stored in a dedicated postgres table (opensearch_sync_state)
// so restarts are safe and idempotent.
package sync

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/nexcom/opensearch-sync/internal/mapping"
	"github.com/opensearch-project/opensearch-go/v4/opensearchapi"
	"github.com/rs/zerolog/log"
)

// Syncer orchestrates all table sync jobs.
type Syncer struct {
	pg *pgxpool.Pool
	os *opensearchapi.Client
}

// New creates a Syncer and ensures all OpenSearch indices and the watermark
// table exist.
func New(pg *pgxpool.Pool, os *opensearchapi.Client) (*Syncer, error) {
	s := &Syncer{pg: pg, os: os}
	if err := s.ensureWatermarkTable(context.Background()); err != nil {
		return nil, fmt.Errorf("watermark table: %w", err)
	}
	if err := s.ensureIndices(context.Background()); err != nil {
		return nil, fmt.Errorf("ensure indices: %w", err)
	}
	return s, nil
}

// Run starts the continuous sync loop, sleeping intervalSeconds between passes.
func (s *Syncer) Run(ctx context.Context, intervalSeconds int) {
	ticker := time.NewTicker(time.Duration(intervalSeconds) * time.Second)
	defer ticker.Stop()
	log.Info().Int("interval_s", intervalSeconds).Msg("[OpenSearchSync] Starting sync loop")
	// Run once immediately on startup.
	s.syncAll(ctx)
	for {
		select {
		case <-ctx.Done():
			log.Info().Msg("[OpenSearchSync] Context cancelled, stopping")
			return
		case <-ticker.C:
			s.syncAll(ctx)
		}
	}
}

// syncAll runs one pass over every registered table.
func (s *Syncer) syncAll(ctx context.Context) {
	jobs := []tableJob{
		{table: "orders", index: mapping.IndexOrders, idCol: "id", tsCol: "updated_at"},
		{table: "users", index: mapping.IndexUsers, idCol: "id", tsCol: "updated_at"},
		{table: "kyc_queue", index: mapping.IndexKycQueue, idCol: "id", tsCol: "updated_at"},
		{table: "aml_flags", index: mapping.IndexAmlFlags, idCol: "id", tsCol: "updated_at"},
		{table: "warehouses", index: mapping.IndexWarehouses, idCol: "id", tsCol: "updated_at"},
		{table: "warehouse_receipts", index: mapping.IndexReceipts, idCol: "id", tsCol: "updated_at"},
		{table: "notifications", index: mapping.IndexNotifications, idCol: "id", tsCol: "created_at"},
		{table: "audit_log", index: mapping.IndexAuditLog, idCol: "id", tsCol: "created_at"},
	}
	for _, j := range jobs {
		if err := s.syncTable(ctx, j); err != nil {
			log.Error().Err(err).Str("table", j.table).Msg("[OpenSearchSync] sync error")
		}
	}
}

type tableJob struct {
	table string
	index string
	idCol string
	tsCol string
}

// syncTable fetches rows newer than the watermark and bulk-indexes them.
func (s *Syncer) syncTable(ctx context.Context, j tableJob) error {
	watermark, err := s.getWatermark(ctx, j.table)
	if err != nil {
		return err
	}

	// Query rows updated since watermark. We use a generic JSON cast so we
	// don't need per-table structs — OpenSearch accepts arbitrary JSON docs.
	query := fmt.Sprintf(
		`SELECT row_to_json(t) FROM %s t WHERE %s > $1 ORDER BY %s ASC LIMIT 500`,
		j.table, j.tsCol, j.tsCol,
	)
	rows, err := s.pg.Query(ctx, query, watermark)
	if err != nil {
		// Table may not exist yet (schema migration pending) — skip silently.
		if strings.Contains(err.Error(), "does not exist") {
			return nil
		}
		return fmt.Errorf("query %s: %w", j.table, err)
	}
	defer rows.Close()

	var docs []map[string]any
	var latestTS time.Time
	for rows.Next() {
		var raw json.RawMessage
		if err := rows.Scan(&raw); err != nil {
			return err
		}
		var doc map[string]any
		if err := json.Unmarshal(raw, &doc); err != nil {
			return err
		}
		docs = append(docs, doc)
		// Track latest timestamp for watermark update.
		if ts, ok := doc[j.tsCol]; ok {
			if tsStr, ok := ts.(string); ok {
				if t, err := time.Parse(time.RFC3339Nano, tsStr); err == nil && t.After(latestTS) {
					latestTS = t
				}
			}
		}
	}
	if err := rows.Err(); err != nil {
		return err
	}
	if len(docs) == 0 {
		return nil
	}

	// Build NDJSON bulk body.
	var buf bytes.Buffer
	for _, doc := range docs {
		id := fmt.Sprintf("%v", doc[j.idCol])
		meta := fmt.Sprintf(`{"index":{"_index":%q,"_id":%q}}`, j.index, id)
		body, _ := json.Marshal(doc)
		buf.WriteString(meta + "\n")
		buf.Write(body)
		buf.WriteByte('\n')
	}

	resp, err := s.os.Bulk(
		ctx,
		opensearchapi.BulkReq{Body: &buf},
	)
	if err != nil {
		return fmt.Errorf("bulk index %s: %w", j.index, err)
	}
	if resp.Errors {
		log.Warn().Str("index", j.index).Msg("[OpenSearchSync] bulk had errors")
	}

	log.Info().
		Str("table", j.table).
		Int("docs", len(docs)).
		Msg("[OpenSearchSync] indexed")

	if !latestTS.IsZero() {
		return s.setWatermark(ctx, j.table, latestTS)
	}
	return nil
}

// ensureWatermarkTable creates the sync state table if it does not exist.
func (s *Syncer) ensureWatermarkTable(ctx context.Context) error {
	_, err := s.pg.Exec(ctx, `
		CREATE TABLE IF NOT EXISTS opensearch_sync_state (
			table_name  TEXT PRIMARY KEY,
			watermark   TIMESTAMPTZ NOT NULL DEFAULT '1970-01-01T00:00:00Z'
		)
	`)
	return err
}

func (s *Syncer) getWatermark(ctx context.Context, table string) (time.Time, error) {
	var t time.Time
	err := s.pg.QueryRow(ctx,
		`SELECT watermark FROM opensearch_sync_state WHERE table_name = $1`, table,
	).Scan(&t)
	if err != nil {
		// Row missing — return epoch so we sync everything.
		return time.Unix(0, 0), nil
	}
	return t, nil
}

func (s *Syncer) setWatermark(ctx context.Context, table string, t time.Time) error {
	_, err := s.pg.Exec(ctx, `
		INSERT INTO opensearch_sync_state (table_name, watermark)
		VALUES ($1, $2)
		ON CONFLICT (table_name) DO UPDATE SET watermark = EXCLUDED.watermark
	`, table, t)
	return err
}

// ensureIndices creates OpenSearch indices with their mappings if absent.
func (s *Syncer) ensureIndices(ctx context.Context) error {
	for name, body := range mapping.All() {
		exists, err := s.indexExists(ctx, name)
		if err != nil {
			return err
		}
		if exists {
			continue
		}
		_, err = s.os.Indices.Create(ctx, opensearchapi.IndicesCreateReq{
			Index: name,
			Body:  strings.NewReader(body),
		})
		if err != nil {
			return fmt.Errorf("create index %s: %w", name, err)
		}
		log.Info().Str("index", name).Msg("[OpenSearchSync] index created")
	}
	return nil
}

func (s *Syncer) indexExists(ctx context.Context, name string) (bool, error) {
	resp, err := s.os.Indices.Exists(ctx, opensearchapi.IndicesExistsReq{Indices: []string{name}})
	if err != nil {
		return false, err
	}
	return resp.StatusCode == 200, nil
}
