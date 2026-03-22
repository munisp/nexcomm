// Package settlement provides the settlement reconciliation hook for the
// Mojaloop DFSP adapter. When a COMMITTED transfer fulfil callback is received
// from the Mojaloop hub, this package notifies the NEXCOM portal's internal
// settlement webhook so that the portal can:
//
//  1. Insert a settlement record into the PostgreSQL settlements table
//  2. Post a TigerBeetle ledger transfer via the settlement engine
//  3. Emit a nexcom.settlement.completed Kafka event for the lakehouse
//
// The reconciler is fire-and-forget with exponential back-off retry (3 attempts).
// If all retries fail the event is written to a dead-letter log for manual
// reconciliation.
package settlement

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"time"
)

// CommittedTransfer is the payload sent to the portal settlement webhook.
type CommittedTransfer struct {
	TransferID   string  `json:"transferId"`
	SettlementID string  `json:"settlementId,omitempty"`
	PayerFspID   string  `json:"payerFspId"`
	PayeeFspID   string  `json:"payeeFspId"`
	Amount       float64 `json:"amount"`
	Currency     string  `json:"currency"`
	Fulfilment   string  `json:"fulfilment,omitempty"`
	CommittedAt  int64   `json:"committedAt"` // Unix milliseconds
	Source       string  `json:"source"`      // always "mojaloop-adapter"
}

// Reconciler notifies the portal when a Mojaloop transfer is committed.
type Reconciler struct {
	portalURL  string
	httpClient *http.Client
	logger     *slog.Logger
}

// NewReconciler creates a Reconciler that will POST committed transfers to
// portalURL/api/internal/mojaloop/settlement-callback.
func NewReconciler(portalURL string, logger *slog.Logger) *Reconciler {
	return &Reconciler{
		portalURL: portalURL,
		httpClient: &http.Client{
			Timeout: 10 * time.Second,
		},
		logger: logger,
	}
}

// NotifyCommitted sends the committed transfer to the portal with 3-attempt
// exponential back-off. The call is non-blocking — it runs in a goroutine.
func (r *Reconciler) NotifyCommitted(ctx context.Context, t CommittedTransfer) {
	t.Source = "mojaloop-adapter"
	if t.CommittedAt == 0 {
		t.CommittedAt = time.Now().UnixMilli()
	}
	go func() {
		if err := r.notifyWithRetry(ctx, t); err != nil {
			r.logger.Error("settlement reconciler: all retries exhausted",
				"transferId", t.TransferID,
				"err", err,
			)
			r.writeDeadLetter(t, err)
		}
	}()
}

// notifyWithRetry attempts to POST the payload up to 3 times with back-off.
func (r *Reconciler) notifyWithRetry(ctx context.Context, t CommittedTransfer) error {
	payload, err := json.Marshal(t)
	if err != nil {
		return fmt.Errorf("marshal: %w", err)
	}

	url := r.portalURL + "/api/internal/mojaloop/settlement-callback"
	delays := []time.Duration{0, 2 * time.Second, 6 * time.Second}

	var lastErr error
	for attempt, delay := range delays {
		if delay > 0 {
			select {
			case <-time.After(delay):
			case <-ctx.Done():
				return ctx.Err()
			}
		}

		req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(payload))
		if err != nil {
			lastErr = err
			continue
		}
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("X-Source", "mojaloop-adapter")

		resp, err := r.httpClient.Do(req)
		if err != nil {
			lastErr = fmt.Errorf("attempt %d: %w", attempt+1, err)
			r.logger.Warn("settlement reconciler: POST failed",
				"attempt", attempt+1,
				"transferId", t.TransferID,
				"err", err,
			)
			continue
		}
		resp.Body.Close()

		if resp.StatusCode >= 200 && resp.StatusCode < 300 {
			r.logger.Info("settlement reconciler: notified portal",
				"transferId", t.TransferID,
				"status", resp.StatusCode,
				"attempt", attempt+1,
			)
			return nil
		}

		lastErr = fmt.Errorf("attempt %d: HTTP %d", attempt+1, resp.StatusCode)
		r.logger.Warn("settlement reconciler: non-2xx response",
			"attempt", attempt+1,
			"transferId", t.TransferID,
			"status", resp.StatusCode,
		)
	}
	return lastErr
}

// writeDeadLetter logs the failed transfer to stderr in structured JSON for
// manual reconciliation. In production this should write to a dead-letter queue.
func (r *Reconciler) writeDeadLetter(t CommittedTransfer, err error) {
	r.logger.Error("settlement reconciler: dead-letter",
		"transferId", t.TransferID,
		"payerFspId", t.PayerFspID,
		"payeeFspId", t.PayeeFspID,
		"amount", t.Amount,
		"currency", t.Currency,
		"committedAt", t.CommittedAt,
		"error", err.Error(),
	)
}
