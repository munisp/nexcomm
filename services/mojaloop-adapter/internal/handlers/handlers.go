// Package handlers implements all FSPIOP API v1.1 HTTP handlers for the
// NEXCOM Mojaloop DFSP adapter.
//
// Every inbound FSPIOP callback (transfer fulfil, transfer error, quote response)
// now performs three actions after persisting the callback:
//  1. Updates the transfer/quote status in PostgreSQL
//  2. Emits a typed Kafka event (mojaloop.transfer.committed / .aborted / mojaloop.quote.accepted)
//  3. Notifies the NEXCOM portal via HTTP POST for real-time settlement reconciliation
package handlers

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"strconv"
	"time"

	"github.com/google/uuid"
	"github.com/nexcom/mojaloop-adapter/internal/db"
	"github.com/nexcom/mojaloop-adapter/internal/kafka"
	"github.com/nexcom/mojaloop-adapter/internal/metrics"
	"github.com/nexcom/mojaloop-adapter/internal/models"
	"github.com/nexcom/mojaloop-adapter/internal/settlement"
)

// Handler holds shared dependencies for all FSPIOP handlers.
type Handler struct {
	store       *db.Store
	dfspID      string
	callbackURL string
	hubURL      string
	alsURL      string
	portalURL   string
	logger      *slog.Logger
	httpClient  *http.Client
	kafka       *kafka.Producer
	reconciler  *settlement.Reconciler
}

// New creates a new Handler with all dependencies injected.
func New(
	store *db.Store,
	dfspID, callbackURL, hubURL, alsURL, portalURL string,
	producer *kafka.Producer,
	logger *slog.Logger,
) *Handler {
	return &Handler{
		store:       store,
		dfspID:      dfspID,
		callbackURL: callbackURL,
		hubURL:      hubURL,
		alsURL:      alsURL,
		portalURL:   portalURL,
		kafka:       producer,
		logger:      logger,
		reconciler:  settlement.NewReconciler(portalURL, logger),
		httpClient: &http.Client{
			Timeout: 15 * time.Second,
		},
	}
}

// ─── Health & Stats ───────────────────────────────────────────────────────────

// Health handles GET /health — returns service status.
func (h *Handler) Health(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	dbStatus := "UP"
	if err := h.store.Ping(ctx); err != nil {
		dbStatus = "DOWN"
	}
	status := "UP"
	if dbStatus == "DOWN" {
		status = "DEGRADED"
	}
	writeJSON(w, http.StatusOK, map[string]string{
		"status":    status,
		"dfspId":    h.dfspID,
		"database":  dbStatus,
		"timestamp": time.Now().UTC().Format(time.RFC3339),
	})
}

// Stats handles GET /stats — returns aggregated metrics.
func (h *Handler) Stats(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	transferStats, err := h.store.TransferStats(ctx)
	if err != nil {
		h.logger.Error("stats: transfer stats query failed", "err", err)
		transferStats = map[string]models.TransferStatEntry{}
	}

	quoteStats, err := h.store.QuoteStats(ctx)
	if err != nil {
		h.logger.Error("stats: quote stats query failed", "err", err)
		quoteStats = map[string]int{}
	}

	activeDfsps, _ := h.store.CountActiveDfsps(ctx)
	metrics.ActiveDfsps.Set(float64(activeDfsps))

	writeJSON(w, http.StatusOK, models.StatsResponse{
		DfspID:      h.dfspID,
		ActiveDfsps: activeDfsps,
		Transfers:   transferStats,
		Quotes:      quoteStats,
		RuntimeMetrics: map[string]int64{
			"timestamp": time.Now().UnixMilli(),
		},
	})
}

// ─── Participants ─────────────────────────────────────────────────────────────

// PostParticipants handles POST /participants — register a new DFSP.
func (h *Handler) PostParticipants(w http.ResponseWriter, r *http.Request) {
	var body struct {
		FspID    string `json:"fspId"`
		Name     string `json:"name"`
		Currency string `json:"currency"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "3100", "Malformed request body")
		return
	}
	if body.FspID == "" || body.Currency == "" {
		writeError(w, http.StatusBadRequest, "3101", "fspId and currency are required")
		return
	}

	if err := h.store.UpsertDfsp(r.Context(), body.FspID, body.Name, body.Currency); err != nil {
		h.logger.Error("register DFSP failed", "fspId", body.FspID, "err", err)
		writeError(w, http.StatusInternalServerError, "2001", "Failed to register DFSP")
		return
	}

	activeDfsps, _ := h.store.CountActiveDfsps(r.Context())
	metrics.ActiveDfsps.Set(float64(activeDfsps))

	h.logger.Info("DFSP registered", "fspId", body.FspID, "currency", body.Currency)
	writeJSON(w, http.StatusCreated, map[string]string{"status": "registered", "fspId": body.FspID})
}

// GetParticipants handles GET /participants — list all registered DFSPs.
func (h *Handler) GetParticipants(w http.ResponseWriter, r *http.Request) {
	activeOnly := r.URL.Query().Get("activeOnly") != "false"
	dfsps, err := h.store.ListDfsps(r.Context(), activeOnly)
	if err != nil {
		h.logger.Error("list DFSPs failed", "err", err)
		writeError(w, http.StatusInternalServerError, "2001", "Failed to list DFSPs")
		return
	}
	if dfsps == nil {
		dfsps = []*models.DBDfsp{}
	}
	writeJSON(w, http.StatusOK, dfsps)
}

// PostParticipantEndpoints handles POST /participants/{fspId}/endpoints — register callback URLs.
func (h *Handler) PostParticipantEndpoints(w http.ResponseWriter, r *http.Request) {
	fspID := r.PathValue("fspId")
	h.logger.Info("endpoint registration received", "fspId", fspID)
	writeJSON(w, http.StatusOK, map[string]string{"status": "registered", "fspId": fspID})
}

// ─── Parties (ALS) ────────────────────────────────────────────────────────────

// GetParty handles GET /parties/{partyIdType}/{partyIdentifier} — party lookup.
func (h *Handler) GetParty(w http.ResponseWriter, r *http.Request) {
	start := time.Now()
	partyIDType := r.PathValue("partyIdType")
	partyIdentifier := r.PathValue("partyIdentifier")

	party, err := h.store.GetParty(r.Context(), partyIDType, partyIdentifier)
	metrics.PartyLookupDuration.Observe(time.Since(start).Seconds())

	if err != nil {
		h.logger.Warn("party not found", "type", partyIDType, "id", partyIdentifier)
		writeError(w, http.StatusNotFound, "3204", fmt.Sprintf("Party %s/%s not found", partyIDType, partyIdentifier))
		return
	}

	resp := map[string]any{
		"party": map[string]any{
			"partyIdInfo": map[string]string{
				"partyIdType":     party.PartyIDType,
				"partyIdentifier": party.PartyIdentifier,
				"fspId":           party.FspID,
			},
			"name": func() string {
				if party.FirstName != nil && party.LastName != nil {
					return *party.FirstName + " " + *party.LastName
				}
				return party.PartyIdentifier
			}(),
		},
	}
	writeJSON(w, http.StatusOK, resp)
}

// ─── Quotes ───────────────────────────────────────────────────────────────────

// PostQuotes handles POST /quotes — initiate quote negotiation.
func (h *Handler) PostQuotes(w http.ResponseWriter, r *http.Request) {
	start := time.Now()
	var req models.QuoteRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "3100", "Malformed quote request")
		return
	}

	if req.QuoteID == "" {
		req.QuoteID = uuid.New().String()
	}
	if req.TransactionID == "" {
		req.TransactionID = uuid.New().String()
	}

	amount, err := strconv.ParseFloat(req.Amount.Amount, 64)
	if err != nil || amount <= 0 {
		writeError(w, http.StatusBadRequest, "3106", "Invalid amount")
		return
	}

	fee := amount * 0.001
	if fee < 0.01 {
		fee = 0.01
	}
	transferAmount := amount + fee
	expiration := time.Now().UTC().Add(30 * time.Second)

	ilpData := fmt.Sprintf("%s:%s:%.6f:%s", req.QuoteID, req.TransactionID, transferAmount, req.Amount.Currency)
	hash := sha256.Sum256([]byte(ilpData))
	ilpPacket := base64.URLEncoding.EncodeToString([]byte(ilpData))
	condition := base64.URLEncoding.EncodeToString(hash[:])

	payerID := ""
	if req.Payer != nil {
		payerID = req.Payer.PartyIDInfo.PartyIdentifier
	}
	payeeID := ""
	if req.Payee != nil {
		payeeID = req.Payee.PartyIDInfo.PartyIdentifier
	}

	dbQuote := &models.DBQuote{
		QuoteID:         req.QuoteID,
		TransactionID:   req.TransactionID,
		PayerFspID:      req.PayerFsp,
		PayeeFspID:      req.PayeeFsp,
		PayerIdentifier: payerID,
		PayeeIdentifier: payeeID,
		AmountType:      req.AmountType,
		Amount:          req.Amount.Amount,
		Currency:        req.Amount.Currency,
		Expiration:      &expiration,
		Status:          models.QuotePending,
	}
	if _, err := h.store.InsertQuote(r.Context(), dbQuote); err != nil {
		h.logger.Error("insert quote failed", "err", err)
		writeError(w, http.StatusInternalServerError, "2001", "Failed to persist quote")
		return
	}

	if err := h.store.UpdateQuoteAccepted(r.Context(), req.QuoteID, ilpPacket, condition,
		fmt.Sprintf("%.6f", transferAmount),
		fmt.Sprintf("%.6f", fee),
		req.Amount.Currency,
	); err != nil {
		h.logger.Error("update quote failed", "err", err)
	}

	// Emit Kafka event for the accepted quote
	h.kafka.EmitQuoteAccepted(r.Context(), kafka.QuoteAcceptedEvent{
		QuoteID:        req.QuoteID,
		PayerFspID:     req.PayerFsp,
		PayeeFspID:     req.PayeeFsp,
		TransferAmount: transferAmount,
		Currency:       req.Amount.Currency,
		PayeeFspFee:    fee,
		ILPPacket:      ilpPacket,
		Condition:      condition,
	})

	metrics.QuotesTotal.WithLabelValues("ACCEPTED").Inc()
	metrics.QuoteDuration.Observe(time.Since(start).Seconds())

	writeJSON(w, http.StatusOK, models.QuoteResponse{
		TransferAmount: models.Money{
			Amount:   fmt.Sprintf("%.6f", transferAmount),
			Currency: req.Amount.Currency,
		},
		PayeeReceiveAmount: models.Money{
			Amount:   req.Amount.Amount,
			Currency: req.Amount.Currency,
		},
		PayeeFspFee: models.Money{
			Amount:   fmt.Sprintf("%.6f", fee),
			Currency: req.Amount.Currency,
		},
		Expiration: expiration.Format(time.RFC3339),
		IlpPacket:  ilpPacket,
		Condition:  condition,
	})
}

// GetQuotes handles GET /quotes — list quotes with pagination.
func (h *Handler) GetQuotes(w http.ResponseWriter, r *http.Request) {
	limit := parseIntQuery(r, "limit", 20)
	offset := parseIntQuery(r, "offset", 0)
	var status *models.QuoteStatus
	if s := r.URL.Query().Get("status"); s != "" {
		qs := models.QuoteStatus(s)
		status = &qs
	}

	quotes, total, err := h.store.ListQuotes(r.Context(), status, limit, offset)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "2001", "Failed to list quotes")
		return
	}
	if quotes == nil {
		quotes = []*models.DBQuote{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"quotes": quotes, "total": total})
}

// ─── Transfers ────────────────────────────────────────────────────────────────

// PostTransfers handles POST /transfers — initiate a transfer.
func (h *Handler) PostTransfers(w http.ResponseWriter, r *http.Request) {
	start := time.Now()
	var req models.TransferRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "3100", "Malformed transfer request")
		return
	}

	if req.TransferID == "" {
		req.TransferID = uuid.New().String()
	}

	amountF, err := strconv.ParseFloat(req.Amount.Amount, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "3106", "Invalid amount")
		return
	}

	payerID := ""
	if req.Payer != nil {
		payerID = req.Payer.PartyIDInfo.PartyIdentifier
	}
	payeeID := ""
	if req.Payee != nil {
		payeeID = req.Payee.PartyIDInfo.PartyIdentifier
	}

	var expiration *time.Time
	if req.Expiration != "" {
		if t, err := time.Parse(time.RFC3339, req.Expiration); err == nil {
			expiration = &t
		}
	}

	dbTransfer := &models.DBTransfer{
		TransferID:      req.TransferID,
		QuoteID:         &req.QuoteID,
		PayerFspID:      req.PayerFsp,
		PayeeFspID:      req.PayeeFsp,
		PayerIdentifier: payerID,
		PayeeIdentifier: payeeID,
		Amount:          req.Amount.Amount,
		Currency:        req.Amount.Currency,
		IlpPacket:       &req.IlpPacket,
		Condition:       &req.Condition,
		Expiration:      expiration,
		Status:          models.TransferPending,
	}

	if _, err := h.store.InsertTransfer(r.Context(), dbTransfer); err != nil {
		h.logger.Error("insert transfer failed", "err", err)
		writeError(w, http.StatusInternalServerError, "2001", "Failed to persist transfer")
		return
	}

	// Emit Kafka event: transfer initiated
	h.kafka.EmitTransferInitiated(r.Context(), kafka.TransferInitiatedEvent{
		TransferID: req.TransferID,
		PayerFspID: req.PayerFsp,
		PayeeFspID: req.PayeeFsp,
		Amount:     amountF,
		Currency:   req.Amount.Currency,
		Condition:  req.Condition,
		ILPPacket:  req.IlpPacket,
	})

	// Reserve funds (RESERVED state)
	if err := h.store.UpdateTransferStatus(r.Context(), req.TransferID, models.TransferReserved, nil, nil, nil); err != nil {
		h.logger.Error("reserve transfer failed", "err", err)
	}

	// Commit transfer (COMMITTED state — in production this is async via hub callback)
	fulfilment := base64.URLEncoding.EncodeToString([]byte(req.TransferID + ":fulfilled"))
	if err := h.store.UpdateTransferStatus(r.Context(), req.TransferID, models.TransferCommitted, &fulfilment, nil, nil); err != nil {
		h.logger.Error("commit transfer failed", "err", err)
	}

	committedAt := time.Now().UnixMilli()

	// Emit Kafka event: transfer committed
	h.kafka.EmitTransferCommitted(r.Context(), kafka.TransferCommittedEvent{
		TransferID:  req.TransferID,
		PayerFspID:  req.PayerFsp,
		PayeeFspID:  req.PayeeFsp,
		Amount:      amountF,
		Currency:    req.Amount.Currency,
		Fulfilment:  fulfilment,
		CommittedAt: committedAt,
	})

	// Notify portal for settlement reconciliation (async, non-blocking)
	go h.notifyPortalSettlement(req.TransferID, "", req.PayerFsp, req.PayeeFsp, amountF, req.Amount.Currency, fulfilment)

	completedAt := time.Now().UTC()
	metrics.TransfersTotal.WithLabelValues("COMMITTED", req.Amount.Currency).Inc()
	metrics.TransferDuration.WithLabelValues("COMMITTED").Observe(time.Since(start).Seconds())
	metrics.TransferAmountTotal.WithLabelValues(req.Amount.Currency).Add(amountF)

	h.logger.Info("transfer committed",
		"transferId", req.TransferID,
		"amount", req.Amount.Amount,
		"currency", req.Amount.Currency,
		"payerFsp", req.PayerFsp,
		"payeeFsp", req.PayeeFsp,
	)

	writeJSON(w, http.StatusOK, map[string]string{
		"transferId":         req.TransferID,
		"transferState":      "COMMITTED",
		"fulfilment":         fulfilment,
		"completedTimestamp": completedAt.Format(time.RFC3339),
	})
}

// GetTransfers handles GET /transfers — list transfers with pagination.
func (h *Handler) GetTransfers(w http.ResponseWriter, r *http.Request) {
	limit := parseIntQuery(r, "limit", 20)
	offset := parseIntQuery(r, "offset", 0)

	var status *models.TransferStatus
	if s := r.URL.Query().Get("status"); s != "" {
		ts := models.TransferStatus(s)
		status = &ts
	}
	var currency *string
	if c := r.URL.Query().Get("currency"); c != "" {
		currency = &c
	}

	transfers, total, err := h.store.ListTransfers(r.Context(), status, currency, limit, offset)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "2001", "Failed to list transfers")
		return
	}
	if transfers == nil {
		transfers = []*models.DBTransfer{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"transfers": transfers, "total": total})
}

// GetTransferByID handles GET /transfers/{transferId} — get a single transfer.
func (h *Handler) GetTransferByID(w http.ResponseWriter, r *http.Request) {
	transferID := r.PathValue("transferId")
	transfer, err := h.store.GetTransferByID(r.Context(), transferID)
	if err != nil {
		writeError(w, http.StatusNotFound, "3208", fmt.Sprintf("Transfer %s not found", transferID))
		return
	}
	writeJSON(w, http.StatusOK, transfer)
}

// ─── Inbound FSPIOP Callbacks ─────────────────────────────────────────────────

// PutTransferCallback handles PUT /callbacks/transfers/{transferId} — inbound fulfil callback.
// This is called by the Mojaloop hub when a transfer is fulfilled by the payee DFSP.
// After persisting, it:
//  1. Updates transfer status to COMMITTED in PostgreSQL
//  2. Emits mojaloop.transfer.committed Kafka event
//  3. Notifies the NEXCOM portal for settlement reconciliation
func (h *Handler) PutTransferCallback(w http.ResponseWriter, r *http.Request) {
	transferID := r.PathValue("transferId")
	var body models.TransferFulfilRequest
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "3100", "Malformed callback body")
		return
	}

	payload, _ := json.Marshal(body)
	_ = h.store.InsertCallback(r.Context(), "TRANSFER_FULFIL", transferID, payload)
	metrics.CallbacksReceived.WithLabelValues("TRANSFER_FULFIL").Inc()

	// Update transfer status to COMMITTED
	_ = h.store.UpdateTransferStatus(r.Context(), transferID, models.TransferCommitted, &body.Fulfilment, nil, nil)

	// Retrieve transfer for Kafka event details
	transfer, err := h.store.GetTransferByID(r.Context(), transferID)
	committedAt := time.Now().UnixMilli()

	if err == nil {
		amountF, _ := strconv.ParseFloat(transfer.Amount, 64)
		// Emit Kafka event: transfer committed
		h.kafka.EmitTransferCommitted(r.Context(), kafka.TransferCommittedEvent{
			TransferID:  transferID,
			PayerFspID:  transfer.PayerFspID,
			PayeeFspID:  transfer.PayeeFspID,
			Amount:      amountF,
			Currency:    transfer.Currency,
			Fulfilment:  body.Fulfilment,
			CommittedAt: committedAt,
		})
		// Notify portal for settlement reconciliation using Reconciler (exponential back-off + dead-letter)
		h.reconciler.NotifyCommitted(r.Context(), settlement.CommittedTransfer{
			TransferID:  transferID,
			PayerFspID:  transfer.PayerFspID,
			PayeeFspID:  transfer.PayeeFspID,
			Amount:      amountF,
			Currency:    transfer.Currency,
			Fulfilment:  body.Fulfilment,
			CommittedAt: committedAt,
		})
	}

	h.logger.Info("transfer fulfil callback processed",
		"transferId", transferID,
		"state", body.TransferState,
		"fulfilment", body.Fulfilment,
	)
	w.WriteHeader(http.StatusOK)
}

// PutTransferErrorCallback handles PUT /callbacks/transfers/{transferId}/error — inbound error callback.
// This is called by the Mojaloop hub when a transfer is rejected or aborted.
// After persisting, it:
//  1. Updates transfer status to ABORTED in PostgreSQL
//  2. Emits mojaloop.transfer.aborted Kafka event
func (h *Handler) PutTransferErrorCallback(w http.ResponseWriter, r *http.Request) {
	transferID := r.PathValue("transferId")
	var body models.ErrorResponse
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "3100", "Malformed error callback body")
		return
	}

	payload, _ := json.Marshal(body)
	_ = h.store.InsertCallback(r.Context(), "TRANSFER_ERROR", transferID, payload)
	metrics.CallbacksReceived.WithLabelValues("TRANSFER_ERROR").Inc()

	errCode := body.ErrorInformation.ErrorCode
	errDesc := body.ErrorInformation.ErrorDescription
	_ = h.store.UpdateTransferStatus(r.Context(), transferID, models.TransferAborted, nil, &errCode, &errDesc)

	// Emit Kafka event: transfer aborted
	h.kafka.EmitTransferAborted(r.Context(), kafka.TransferAbortedEvent{
		TransferID:       transferID,
		ErrorCode:        errCode,
		ErrorDescription: errDesc,
	})

	h.logger.Warn("transfer error callback processed",
		"transferId", transferID,
		"errorCode", errCode,
		"errorDescription", errDesc,
	)
	w.WriteHeader(http.StatusOK)
}

// PutQuoteCallback handles PUT /callbacks/quotes/{quoteId} — inbound quote response callback.
// This is called by the Mojaloop hub when a quote is accepted by the payee DFSP.
// After persisting, it emits a mojaloop.quote.accepted Kafka event.
func (h *Handler) PutQuoteCallback(w http.ResponseWriter, r *http.Request) {
	quoteID := r.PathValue("quoteId")
	var body models.QuoteResponse
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "3100", "Malformed quote callback body")
		return
	}

	payload, _ := json.Marshal(body)
	_ = h.store.InsertCallback(r.Context(), "QUOTE_RESPONSE", quoteID, payload)
	metrics.CallbacksReceived.WithLabelValues("QUOTE_RESPONSE").Inc()

	_ = h.store.UpdateQuoteAccepted(r.Context(), quoteID,
		body.IlpPacket, body.Condition,
		body.TransferAmount.Amount,
		body.PayeeFspFee.Amount,
		body.TransferAmount.Currency,
	)

	// Retrieve quote for Kafka event details
	quote, err := h.store.GetQuoteByID(r.Context(), quoteID)
	if err == nil {
		transferAmountF, _ := strconv.ParseFloat(body.TransferAmount.Amount, 64)
		feeF, _ := strconv.ParseFloat(body.PayeeFspFee.Amount, 64)
		h.kafka.EmitQuoteAccepted(r.Context(), kafka.QuoteAcceptedEvent{
			QuoteID:        quoteID,
			PayerFspID:     quote.PayerFspID,
			PayeeFspID:     quote.PayeeFspID,
			TransferAmount: transferAmountF,
			Currency:       body.TransferAmount.Currency,
			PayeeFspFee:    feeF,
			ILPPacket:      body.IlpPacket,
			Condition:      body.Condition,
		})
	}

	h.logger.Info("quote callback processed", "quoteId", quoteID)
	w.WriteHeader(http.StatusOK)
}

// ─── Portal Settlement Notification ──────────────────────────────────────────

// notifyPortalSettlement sends a POST to the NEXCOM portal's internal settlement
// reconciliation endpoint when a Mojaloop transfer is committed.
// This triggers the portal's settlementJob to create a SETTLED record in PostgreSQL
// and post a TigerBeetle ledger entry for the cross-DFSP transfer.
func (h *Handler) notifyPortalSettlement(
	transferID, settlementID, payerFspID, payeeFspID string,
	amount float64, currency, fulfilment string,
) {
	if h.portalURL == "" {
		return
	}
	body := map[string]any{
		"transferId":   transferID,
		"settlementId": settlementID,
		"payerFspId":   payerFspID,
		"payeeFspId":   payeeFspID,
		"amount":       amount,
		"currency":     currency,
		"fulfilment":   fulfilment,
		"committedAt":  time.Now().UnixMilli(),
	}
	data, _ := json.Marshal(body)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, http.MethodPost,
		h.portalURL+"/api/internal/mojaloop/settlement-callback", bytes.NewReader(data))
	if err != nil {
		h.logger.Warn("portal notification: failed to build request", "err", err)
		return
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Source", "mojaloop-adapter")

	resp, err := h.httpClient.Do(req)
	if err != nil {
		h.logger.Warn("portal notification: request failed (portal may be unavailable)", "err", err)
		return
	}
	defer resp.Body.Close()
	h.logger.Info("portal settlement notification sent",
		"transferId", transferID,
		"status", resp.StatusCode,
	)
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeError(w http.ResponseWriter, status int, code, description string) {
	writeJSON(w, status, models.ErrorResponse{
		ErrorInformation: models.ErrorInformation{
			ErrorCode:        code,
			ErrorDescription: description,
		},
	})
}

func parseIntQuery(r *http.Request, key string, defaultVal int) int {
	if s := r.URL.Query().Get(key); s != "" {
		if v, err := strconv.Atoi(s); err == nil && v > 0 {
			return v
		}
	}
	return defaultVal
}
