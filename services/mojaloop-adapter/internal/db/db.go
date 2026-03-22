// Package db provides PostgreSQL connection pooling and all query helpers
// for the NEXCOM Mojaloop DFSP adapter using pgx/v5.
package db

import (
	"context"
	"encoding/json"
	"fmt"
	"strconv"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/nexcom/mojaloop-adapter/internal/models"
)

// Store wraps a pgxpool.Pool and exposes all query helpers.
type Store struct {
	pool *pgxpool.Pool
}

// New creates a new Store with a connection pool.
func New(ctx context.Context, databaseURL string, maxConns int32) (*Store, error) {
	cfg, err := pgxpool.ParseConfig(databaseURL)
	if err != nil {
		return nil, fmt.Errorf("parse db config: %w", err)
	}
	cfg.MaxConns = maxConns
	cfg.MinConns = 2
	cfg.MaxConnLifetime = 30 * time.Minute
	cfg.MaxConnIdleTime = 5 * time.Minute
	cfg.HealthCheckPeriod = 1 * time.Minute

	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		return nil, fmt.Errorf("create pool: %w", err)
	}
	if err := pool.Ping(ctx); err != nil {
		return nil, fmt.Errorf("ping db: %w", err)
	}
	return &Store{pool: pool}, nil
}

// Close releases all pool connections.
func (s *Store) Close() {
	s.pool.Close()
}

// Ping checks the database connection.
func (s *Store) Ping(ctx context.Context) error {
	return s.pool.Ping(ctx)
}

// ─── Transfer queries ─────────────────────────────────────────────────────────

// InsertTransfer persists a new transfer record and returns its ID.
func (s *Store) InsertTransfer(ctx context.Context, t *models.DBTransfer) (int, error) {
	const q = `
		INSERT INTO mojaloop_transfers
			(transfer_id, quote_id, payer_fsp_id, payee_fsp_id,
			 payer_identifier, payee_identifier, amount, currency,
			 ilp_packet, condition, expiration, status)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
		RETURNING id`
	var id int
	err := s.pool.QueryRow(ctx, q,
		t.TransferID, t.QuoteID, t.PayerFspID, t.PayeeFspID,
		t.PayerIdentifier, t.PayeeIdentifier, t.Amount, t.Currency,
		t.IlpPacket, t.Condition, t.Expiration, t.Status,
	).Scan(&id)
	return id, err
}

// GetTransferByID fetches a transfer row by its UUID.
func (s *Store) GetTransferByID(ctx context.Context, transferID string) (*models.DBTransfer, error) {
	const q = `
		SELECT id, transfer_id, quote_id, payer_fsp_id, payee_fsp_id,
		       payer_identifier, payee_identifier, amount, currency,
		       ilp_packet, condition, fulfilment, expiration, status,
		       error_code, error_description, nexcom_settlement_id, nexcom_order_id,
		       reserved_at, committed_at, aborted_at, created_at, updated_at
		FROM mojaloop_transfers
		WHERE transfer_id = $1`
	row := s.pool.QueryRow(ctx, q, transferID)
	return scanTransfer(row)
}

// UpdateTransferStatus updates the status and relevant timestamp of a transfer.
func (s *Store) UpdateTransferStatus(ctx context.Context, transferID string, status models.TransferStatus, fulfilment *string, errCode *string, errDesc *string) error {
	now := time.Now().UTC()
	var q string
	var args []any

	switch status {
	case models.TransferReserved:
		q = `UPDATE mojaloop_transfers SET status=$1, reserved_at=$2, updated_at=$3 WHERE transfer_id=$4`
		args = []any{status, now, now, transferID}
	case models.TransferCommitted:
		q = `UPDATE mojaloop_transfers SET status=$1, fulfilment=$2, committed_at=$3, updated_at=$4 WHERE transfer_id=$5`
		args = []any{status, fulfilment, now, now, transferID}
	case models.TransferAborted:
		q = `UPDATE mojaloop_transfers SET status=$1, error_code=$2, error_description=$3, aborted_at=$4, updated_at=$5 WHERE transfer_id=$6`
		args = []any{status, errCode, errDesc, now, now, transferID}
	case models.TransferExpired:
		q = `UPDATE mojaloop_transfers SET status=$1, updated_at=$2 WHERE transfer_id=$3`
		args = []any{status, now, transferID}
	default:
		q = `UPDATE mojaloop_transfers SET status=$1, updated_at=$2 WHERE transfer_id=$3`
		args = []any{status, now, transferID}
	}

	_, err := s.pool.Exec(ctx, q, args...)
	return err
}

// ListTransfers returns a paginated list of transfers with optional filters.
func (s *Store) ListTransfers(ctx context.Context, status *models.TransferStatus, currency *string, limit, offset int) ([]*models.DBTransfer, int, error) {
	where := "WHERE 1=1"
	args := []any{}
	idx := 1

	if status != nil {
		where += fmt.Sprintf(" AND status=$%d", idx)
		args = append(args, *status)
		idx++
	}
	if currency != nil {
		where += fmt.Sprintf(" AND currency=$%d", idx)
		args = append(args, *currency)
		idx++
	}

	countQ := "SELECT COUNT(*) FROM mojaloop_transfers " + where
	var total int
	if err := s.pool.QueryRow(ctx, countQ, args...).Scan(&total); err != nil {
		return nil, 0, err
	}

	args = append(args, limit, offset)
	dataQ := fmt.Sprintf(`
		SELECT id, transfer_id, quote_id, payer_fsp_id, payee_fsp_id,
		       payer_identifier, payee_identifier, amount, currency,
		       ilp_packet, condition, fulfilment, expiration, status,
		       error_code, error_description, nexcom_settlement_id, nexcom_order_id,
		       reserved_at, committed_at, aborted_at, created_at, updated_at
		FROM mojaloop_transfers %s
		ORDER BY created_at DESC
		LIMIT $%d OFFSET $%d`, where, idx, idx+1)

	rows, err := s.pool.Query(ctx, dataQ, args...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	var transfers []*models.DBTransfer
	for rows.Next() {
		t, err := scanTransfer(rows)
		if err != nil {
			return nil, 0, err
		}
		transfers = append(transfers, t)
	}
	return transfers, total, rows.Err()
}

// ─── Quote queries ────────────────────────────────────────────────────────────

// InsertQuote persists a new quote record.
func (s *Store) InsertQuote(ctx context.Context, q *models.DBQuote) (int, error) {
	const query = `
		INSERT INTO mojaloop_quotes
			(quote_id, transaction_id, payer_fsp_id, payee_fsp_id,
			 payer_identifier, payee_identifier, amount_type, amount, currency,
			 expiration, status)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
		RETURNING id`
	var id int
	err := s.pool.QueryRow(ctx, query,
		q.QuoteID, q.TransactionID, q.PayerFspID, q.PayeeFspID,
		q.PayerIdentifier, q.PayeeIdentifier, q.AmountType, q.Amount, q.Currency,
		q.Expiration, q.Status,
	).Scan(&id)
	return id, err
}

// UpdateQuoteAccepted updates a quote with the ILP packet and condition on acceptance.
func (s *Store) UpdateQuoteAccepted(ctx context.Context, quoteID, ilpPacket, condition, transferAmount, feeAmount, feeCurrency string) error {
	const q = `
		UPDATE mojaloop_quotes
		SET status='ACCEPTED', ilp_packet=$1, condition=$2,
		    transfer_amount=$3, fee_amount=$4, fee_currency=$5, updated_at=NOW()
		WHERE quote_id=$6`
	_, err := s.pool.Exec(ctx, q, ilpPacket, condition, transferAmount, feeAmount, feeCurrency, quoteID)
	return err
}

// UpdateQuoteRejected marks a quote as rejected.
func (s *Store) UpdateQuoteRejected(ctx context.Context, quoteID, reason string) error {
	const q = `UPDATE mojaloop_quotes SET status='REJECTED', reject_reason=$1, updated_at=NOW() WHERE quote_id=$2`
	_, err := s.pool.Exec(ctx, q, reason, quoteID)
	return err
}

// GetQuoteByID fetches a quote row by its UUID.
func (s *Store) GetQuoteByID(ctx context.Context, quoteID string) (*models.DBQuote, error) {
	const q = `
		SELECT id, quote_id, transaction_id, payer_fsp_id, payee_fsp_id,
		       payer_identifier, payee_identifier, amount_type, amount, currency,
		       fee_amount, fee_currency, transfer_amount, ilp_packet, condition,
		       expiration, status, reject_reason, nexcom_settlement_id, created_at, updated_at
		FROM mojaloop_quotes WHERE quote_id=$1`
	row := s.pool.QueryRow(ctx, q, quoteID)
	return scanQuote(row)
}

// ListQuotes returns a paginated list of quotes.
func (s *Store) ListQuotes(ctx context.Context, status *models.QuoteStatus, limit, offset int) ([]*models.DBQuote, int, error) {
	where := "WHERE 1=1"
	args := []any{}
	idx := 1

	if status != nil {
		where += fmt.Sprintf(" AND status=$%d", idx)
		args = append(args, *status)
		idx++
	}

	var total int
	if err := s.pool.QueryRow(ctx, "SELECT COUNT(*) FROM mojaloop_quotes "+where, args...).Scan(&total); err != nil {
		return nil, 0, err
	}

	args = append(args, limit, offset)
	dataQ := fmt.Sprintf(`
		SELECT id, quote_id, transaction_id, payer_fsp_id, payee_fsp_id,
		       payer_identifier, payee_identifier, amount_type, amount, currency,
		       fee_amount, fee_currency, transfer_amount, ilp_packet, condition,
		       expiration, status, reject_reason, nexcom_settlement_id, created_at, updated_at
		FROM mojaloop_quotes %s
		ORDER BY created_at DESC
		LIMIT $%d OFFSET $%d`, where, idx, idx+1)

	rows, err := s.pool.Query(ctx, dataQ, args...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	var quotes []*models.DBQuote
	for rows.Next() {
		qt, err := scanQuote(rows)
		if err != nil {
			return nil, 0, err
		}
		quotes = append(quotes, qt)
	}
	return quotes, total, rows.Err()
}

// ─── DFSP queries ─────────────────────────────────────────────────────────────

// ListDfsps returns all registered DFSPs.
func (s *Store) ListDfsps(ctx context.Context, activeOnly bool) ([]*models.DBDfsp, error) {
	q := `SELECT id, fsp_id, name, country, currencies, is_active, endpoint_url, callback_url, created_at, updated_at FROM mojaloop_dfsps`
	if activeOnly {
		q += " WHERE is_active=true"
	}
	q += " ORDER BY name"

	rows, err := s.pool.Query(ctx, q)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var dfsps []*models.DBDfsp
	for rows.Next() {
		d := &models.DBDfsp{}
		var currenciesJSON []byte
		if err := rows.Scan(&d.ID, &d.FspID, &d.Name, &d.Country, &currenciesJSON, &d.IsActive, &d.EndpointURL, &d.CallbackURL, &d.CreatedAt, &d.UpdatedAt); err != nil {
			return nil, err
		}
		if currenciesJSON != nil {
			_ = json.Unmarshal(currenciesJSON, &d.Currencies)
		}
		dfsps = append(dfsps, d)
	}
	return dfsps, rows.Err()
}

// UpsertDfsp inserts or updates a DFSP registration.
func (s *Store) UpsertDfsp(ctx context.Context, fspID, name, currency string) error {
	const q = `
		INSERT INTO mojaloop_dfsps (fsp_id, name, currencies, is_active)
		VALUES ($1, $2, $3::jsonb, true)
		ON CONFLICT (fsp_id) DO UPDATE
		SET name=$2, is_active=true, updated_at=NOW()`
	currencies, _ := json.Marshal([]string{currency})
	_, err := s.pool.Exec(ctx, q, fspID, name, string(currencies))
	return err
}

// CountActiveDfsps returns the count of active DFSPs.
func (s *Store) CountActiveDfsps(ctx context.Context) (int, error) {
	var count int
	err := s.pool.QueryRow(ctx, "SELECT COUNT(*) FROM mojaloop_dfsps WHERE is_active=true").Scan(&count)
	return count, err
}

// ─── Party queries ────────────────────────────────────────────────────────────

// GetParty looks up a party by type and identifier.
func (s *Store) GetParty(ctx context.Context, partyIDType, partyIdentifier string) (*models.DBParty, error) {
	const q = `
		SELECT id, party_id_type, party_identifier, fsp_id,
		       first_name, last_name, date_of_birth, merchant_class_code,
		       currency, supported_currencies, is_active, created_at, updated_at
		FROM mojaloop_parties
		WHERE party_id_type=$1 AND party_identifier=$2 AND is_active=true
		LIMIT 1`
	row := s.pool.QueryRow(ctx, q, partyIDType, partyIdentifier)
	return scanParty(row)
}

// ─── Stats queries ────────────────────────────────────────────────────────────

// TransferStats returns aggregated transfer stats grouped by status.
func (s *Store) TransferStats(ctx context.Context) (map[string]models.TransferStatEntry, error) {
	const q = `
		SELECT status, COUNT(*) as cnt, COALESCE(SUM(amount::numeric), 0) as total
		FROM mojaloop_transfers
		GROUP BY status`
	rows, err := s.pool.Query(ctx, q)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	result := make(map[string]models.TransferStatEntry)
	for rows.Next() {
		var status string
		var cnt int
		var total float64
		if err := rows.Scan(&status, &cnt, &total); err != nil {
			return nil, err
		}
		result[status] = models.TransferStatEntry{Count: cnt, TotalAmount: total}
	}
	return result, rows.Err()
}

// QuoteStats returns aggregated quote stats grouped by status.
func (s *Store) QuoteStats(ctx context.Context) (map[string]int, error) {
	const q = `SELECT status, COUNT(*) FROM mojaloop_quotes GROUP BY status`
	rows, err := s.pool.Query(ctx, q)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	result := make(map[string]int)
	for rows.Next() {
		var status string
		var cnt int
		if err := rows.Scan(&status, &cnt); err != nil {
			return nil, err
		}
		result[status] = cnt
	}
	return result, rows.Err()
}

// ─── Callback queries ─────────────────────────────────────────────────────────

// InsertCallback stores an inbound FSPIOP callback for audit.
func (s *Store) InsertCallback(ctx context.Context, callbackType, resourceID string, payload []byte) error {
	const q = `
		INSERT INTO mojaloop_callbacks (callback_type, resource_id, payload, processed)
		VALUES ($1, $2, $3, false)`
	_, err := s.pool.Exec(ctx, q, callbackType, resourceID, payload)
	return err
}

// ─── Scanner helpers ──────────────────────────────────────────────────────────

type scanner interface {
	Scan(dest ...any) error
}

func scanTransfer(row scanner) (*models.DBTransfer, error) {
	t := &models.DBTransfer{}
	err := row.Scan(
		&t.ID, &t.TransferID, &t.QuoteID, &t.PayerFspID, &t.PayeeFspID,
		&t.PayerIdentifier, &t.PayeeIdentifier, &t.Amount, &t.Currency,
		&t.IlpPacket, &t.Condition, &t.Fulfilment, &t.Expiration, &t.Status,
		&t.ErrorCode, &t.ErrorDescription, &t.NexcomSettlementID, &t.NexcomOrderID,
		&t.ReservedAt, &t.CommittedAt, &t.AbortedAt, &t.CreatedAt, &t.UpdatedAt,
	)
	if err != nil {
		return nil, err
	}
	return t, nil
}

func scanQuote(row scanner) (*models.DBQuote, error) {
	q := &models.DBQuote{}
	err := row.Scan(
		&q.ID, &q.QuoteID, &q.TransactionID, &q.PayerFspID, &q.PayeeFspID,
		&q.PayerIdentifier, &q.PayeeIdentifier, &q.AmountType, &q.Amount, &q.Currency,
		&q.FeeAmount, &q.FeeCurrency, &q.TransferAmount, &q.IlpPacket, &q.Condition,
		&q.Expiration, &q.Status, &q.RejectReason, &q.NexcomSettlementID, &q.CreatedAt, &q.UpdatedAt,
	)
	if err != nil {
		return nil, err
	}
	return q, nil
}

func scanParty(row scanner) (*models.DBParty, error) {
	p := &models.DBParty{}
	var currenciesJSON []byte
	err := row.Scan(
		&p.ID, &p.PartyIDType, &p.PartyIdentifier, &p.FspID,
		&p.FirstName, &p.LastName, &p.DateOfBirth, &p.MerchantClassCode,
		&p.Currency, &currenciesJSON, &p.IsActive, &p.CreatedAt, &p.UpdatedAt,
	)
	if err != nil {
		return nil, err
	}
	if currenciesJSON != nil {
		_ = json.Unmarshal(currenciesJSON, &p.SupportedCurrencies)
	}
	return p, nil
}

// AmountToFloat converts a string amount to float64 for arithmetic.
func AmountToFloat(s string) float64 {
	f, _ := strconv.ParseFloat(s, 64)
	return f
}
