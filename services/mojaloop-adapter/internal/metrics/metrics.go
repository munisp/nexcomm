// Package metrics registers and exposes Prometheus metrics for the
// NEXCOM Mojaloop DFSP adapter.
package metrics

import (
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"
)

var (
	// TransfersTotal counts transfers by status.
	TransfersTotal = promauto.NewCounterVec(prometheus.CounterOpts{
		Namespace: "nexcom",
		Subsystem: "mojaloop",
		Name:      "transfers_total",
		Help:      "Total number of Mojaloop transfers by final status.",
	}, []string{"status", "currency"})

	// TransferDuration tracks transfer round-trip latency in seconds.
	TransferDuration = promauto.NewHistogramVec(prometheus.HistogramOpts{
		Namespace: "nexcom",
		Subsystem: "mojaloop",
		Name:      "transfer_duration_seconds",
		Help:      "Latency of transfer lifecycle from PENDING to terminal state.",
		Buckets:   []float64{0.1, 0.25, 0.5, 1, 2, 5, 10, 30},
	}, []string{"status"})

	// QuotesTotal counts quotes by status.
	QuotesTotal = promauto.NewCounterVec(prometheus.CounterOpts{
		Namespace: "nexcom",
		Subsystem: "mojaloop",
		Name:      "quotes_total",
		Help:      "Total number of quote requests by status.",
	}, []string{"status"})

	// QuoteDuration tracks quote negotiation latency.
	QuoteDuration = promauto.NewHistogram(prometheus.HistogramOpts{
		Namespace: "nexcom",
		Subsystem: "mojaloop",
		Name:      "quote_duration_seconds",
		Help:      "Latency of quote negotiation.",
		Buckets:   []float64{0.05, 0.1, 0.25, 0.5, 1, 2, 5},
	})

	// PartyLookupDuration tracks ALS party lookup latency.
	PartyLookupDuration = promauto.NewHistogram(prometheus.HistogramOpts{
		Namespace: "nexcom",
		Subsystem: "mojaloop",
		Name:      "party_lookup_duration_seconds",
		Help:      "Latency of account lookup service (ALS) party resolution.",
		Buckets:   []float64{0.05, 0.1, 0.25, 0.5, 1, 2},
	})

	// CallbacksReceived counts inbound FSPIOP callbacks by type.
	CallbacksReceived = promauto.NewCounterVec(prometheus.CounterOpts{
		Namespace: "nexcom",
		Subsystem: "mojaloop",
		Name:      "callbacks_received_total",
		Help:      "Total number of inbound FSPIOP callbacks by type.",
	}, []string{"type"})

	// HTTPRequestDuration tracks HTTP handler latency.
	HTTPRequestDuration = promauto.NewHistogramVec(prometheus.HistogramOpts{
		Namespace: "nexcom",
		Subsystem: "mojaloop",
		Name:      "http_request_duration_seconds",
		Help:      "HTTP handler latency by method and path.",
		Buckets:   prometheus.DefBuckets,
	}, []string{"method", "path", "status"})

	// ActiveDfsps tracks the number of registered active DFSPs.
	ActiveDfsps = promauto.NewGauge(prometheus.GaugeOpts{
		Namespace: "nexcom",
		Subsystem: "mojaloop",
		Name:      "active_dfsps",
		Help:      "Number of currently active registered DFSPs.",
	})

	// TransferAmountTotal tracks total transfer value by currency.
	TransferAmountTotal = promauto.NewCounterVec(prometheus.CounterOpts{
		Namespace: "nexcom",
		Subsystem: "mojaloop",
		Name:      "transfer_amount_total",
		Help:      "Cumulative transfer amount by currency (committed only).",
	}, []string{"currency"})
)
