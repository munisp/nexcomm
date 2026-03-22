// services/aml-alert-subscriber/main.go
//
// AML Alert Subscriber — Go microservice that:
//   1. Subscribes to the Kafka topic "aml.flag.created" via Dapr pub/sub.
//   2. Calls the NEXCOM portal tRPC API to insert a SECURITY_ALERT notification
//      for the flagged user.
//
// Dapr pub/sub route: POST /aml-flag-created
// Dapr subscription file: components/aml-pubsub-subscription.yaml
//
// Environment variables:
//   DAPR_HTTP_PORT        — Dapr sidecar HTTP port (default: 3500)
//   PORTAL_API_URL        — NEXCOM portal internal API base URL (default: http://nexcom-portal:3000)
//   PORTAL_SERVICE_TOKEN  — Bearer token for the portal's internal service-to-service endpoint
//   PORT                  — This service's HTTP port (default: 8091)

package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"
)

// ─── Types ────────────────────────────────────────────────────────────────────

// AmlFlagCreatedEvent is the payload published to the "aml.flag.created" Kafka topic.
type AmlFlagCreatedEvent struct {
	FlagID     int64   `json:"flagId"`
	UserID     int     `json:"userId"`
	RuleID     int64   `json:"ruleId"`
	RuleName   string  `json:"ruleName"`
	Severity   string  `json:"severity"`   // "CRITICAL" | "HIGH" | "MEDIUM" | "LOW"
	Amount     float64 `json:"amount"`
	Currency   string  `json:"currency"`
	DetectedAt string  `json:"detectedAt"` // RFC3339
	Notes      string  `json:"notes"`
}

// DaprCloudEvent wraps the Dapr CloudEvent envelope.
type DaprCloudEvent struct {
	ID          string          `json:"id"`
	Source      string          `json:"source"`
	Type        string          `json:"type"`
	SpecVersion string          `json:"specversion"`
	DataContent string          `json:"datacontenttype"`
	Data        json.RawMessage `json:"data"`
}

// DaprSubscription is the response body for GET /dapr/subscribe.
type DaprSubscription struct {
	PubSubName string `json:"pubsubname"`
	Topic      string `json:"topic"`
	Route      string `json:"route"`
}

// NotificationPayload is the body sent to the portal's internal notification endpoint.
type NotificationPayload struct {
	UserID   int    `json:"userId"`
	Title    string `json:"title"`
	Message  string `json:"message"`
	Type     string `json:"type"`     // "SECURITY_ALERT"
	Metadata any    `json:"metadata"`
}

// ─── Config ───────────────────────────────────────────────────────────────────

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

// ─── Main ─────────────────────────────────────────────────────────────────────

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo}))
	slog.SetDefault(logger)

	port           := getEnv("PORT", "8091")
	portalAPIURL   := getEnv("PORTAL_API_URL", "http://nexcom-portal:3000")
	serviceToken   := getEnv("PORTAL_SERVICE_TOKEN", "")

	mux := http.NewServeMux()

	// ── Dapr subscription registration ────────────────────────────────────────
	mux.HandleFunc("GET /dapr/subscribe", func(w http.ResponseWriter, r *http.Request) {
		subs := []DaprSubscription{
			{
				PubSubName: "nexcom-pubsub",
				Topic:      "aml.flag.created",
				Route:      "/aml-flag-created",
			},
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(subs)
	})

	// ── Health check ──────────────────────────────────────────────────────────
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		fmt.Fprint(w, `{"status":"ok"}`)
	})

	// ── AML flag event handler ─────────────────────────────────────────────────
	mux.HandleFunc("POST /aml-flag-created", func(w http.ResponseWriter, r *http.Request) {
		body, err := io.ReadAll(io.LimitReader(r.Body, 1<<20))
		if err != nil {
			slog.Error("failed to read request body", "err", err)
			http.Error(w, "bad request", http.StatusBadRequest)
			return
		}
		defer r.Body.Close()

		// Unwrap Dapr CloudEvent envelope
		var ce DaprCloudEvent
		if err := json.Unmarshal(body, &ce); err != nil {
			slog.Error("failed to parse CloudEvent", "err", err)
			http.Error(w, "bad request", http.StatusBadRequest)
			return
		}

		var event AmlFlagCreatedEvent
		if err := json.Unmarshal(ce.Data, &event); err != nil {
			slog.Error("failed to parse AmlFlagCreatedEvent", "err", err)
			http.Error(w, "bad request", http.StatusBadRequest)
			return
		}

		slog.Info("AML flag received",
			"flagId", event.FlagID,
			"userId", event.UserID,
			"severity", event.Severity,
			"ruleName", event.RuleName,
		)

		// Build notification
		severityEmoji := map[string]string{
			"CRITICAL": "🚨",
			"HIGH":     "⚠️",
			"MEDIUM":   "🔶",
			"LOW":      "🔵",
		}
		emoji := severityEmoji[event.Severity]
		if emoji == "" {
			emoji = "⚠️"
		}

		title := fmt.Sprintf("%s AML Alert — %s Severity", emoji, event.Severity)
		message := fmt.Sprintf(
			"Your account has been flagged by the AML system. Rule: %s. "+
				"Amount: %.2f %s. Please contact compliance if you believe this is an error.",
			event.RuleName, event.Amount, event.Currency,
		)

		notif := NotificationPayload{
			UserID:  event.UserID,
			Title:   title,
			Message: message,
			Type:    "SECURITY_ALERT",
			Metadata: map[string]any{
				"flagId":     event.FlagID,
				"ruleId":     event.RuleID,
				"ruleName":   event.RuleName,
				"severity":   event.Severity,
				"amount":     event.Amount,
				"currency":   event.Currency,
				"detectedAt": event.DetectedAt,
			},
		}

		if err := sendNotification(portalAPIURL, serviceToken, notif); err != nil {
			slog.Error("failed to send notification", "err", err, "userId", event.UserID)
			// Return 500 so Dapr retries
			http.Error(w, "notification delivery failed", http.StatusInternalServerError)
			return
		}

		slog.Info("SECURITY_ALERT notification sent",
			"userId", event.UserID,
			"flagId", event.FlagID,
		)

		w.WriteHeader(http.StatusOK)
		fmt.Fprint(w, `{"status":"SUCCESS"}`)
	})

	// ── HTTP server ───────────────────────────────────────────────────────────
	srv := &http.Server{
		Addr:         ":" + port,
		Handler:      mux,
		ReadTimeout:  10 * time.Second,
		WriteTimeout: 10 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	go func() {
		slog.Info("AML alert subscriber listening", "port", port)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			slog.Error("server error", "err", err)
			os.Exit(1)
		}
	}()

	<-ctx.Done()
	slog.Info("Shutting down AML alert subscriber...")
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	srv.Shutdown(shutdownCtx)
	slog.Info("AML alert subscriber stopped")
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

// sendNotification POSTs a SECURITY_ALERT notification to the portal's internal API.
func sendNotification(portalURL, token string, notif NotificationPayload) error {
	payload, err := json.Marshal(notif)
	if err != nil {
		return fmt.Errorf("marshal notification: %w", err)
	}

	url := portalURL + "/api/internal/notifications"
	req, err := http.NewRequest(http.MethodPost, url, bytes.NewReader(payload))
	if err != nil {
		return fmt.Errorf("create request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("http request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		return fmt.Errorf("portal returned HTTP %d: %s", resp.StatusCode, string(body))
	}
	return nil
}
