/*
 * WhatsApp Business API Handler (Meta Cloud API)
 * ================================================
 * Handles:
 *   - GET /webhook/whatsapp  → Meta webhook verification challenge
 *   - POST /webhook/whatsapp → Inbound messages (text, buttons, lists)
 *   - POST /send/whatsapp    → Outbound messages (called internally)
 *
 * Message flow:
 *   Meta → POST /webhook/whatsapp
 *        → parse message type
 *        → persist to DB (whatsapp_messages)
 *        → forward to Python bot-logic service
 *        → bot-logic returns response text
 *        → send reply via Meta Graph API
 *        → emit Kafka event
 */

package whatsapp

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"
	"go.uber.org/zap"

	"github.com/nexcom/channel-gateway/internal/kafka"
)

// Config holds WhatsApp Business API credentials
type Config struct {
	VerifyToken    string
	AccessToken    string
	PhoneNumberID  string
	BusinessAcctID string
	BotLogicURL    string
}

// Handler handles WhatsApp webhook events
type Handler struct {
	db     *pgxpool.Pool
	kafka  *kafka.Producer
	log    *zap.SugaredLogger
	config Config
	client *http.Client
}

func NewHandler(db *pgxpool.Pool, kp *kafka.Producer, log *zap.SugaredLogger, cfg Config) *Handler {
	return &Handler{
		db:     db,
		kafka:  kp,
		log:    log,
		config: cfg,
		client: &http.Client{Timeout: 10 * time.Second},
	}
}

// ─── Webhook Verification ─────────────────────────────────────────────────────

// VerifyWebhook handles the GET challenge from Meta when setting up the webhook
func (h *Handler) VerifyWebhook(c *gin.Context) {
	mode := c.Query("hub.mode")
	token := c.Query("hub.verify_token")
	challenge := c.Query("hub.challenge")

	if mode == "subscribe" && token == h.config.VerifyToken {
		h.log.Infow("WhatsApp webhook verified")
		c.String(http.StatusOK, challenge)
		return
	}
	h.log.Warnw("WhatsApp webhook verification failed", "mode", mode, "token", token)
	c.JSON(http.StatusForbidden, gin.H{"error": "verification failed"})
}

// ─── Inbound Message Handling ─────────────────────────────────────────────────

// WebhookPayload is the top-level Meta Cloud API webhook payload
type WebhookPayload struct {
	Object string  `json:"object"`
	Entry  []Entry `json:"entry"`
}

type Entry struct {
	ID      string   `json:"id"`
	Changes []Change `json:"changes"`
}

type Change struct {
	Value ChangeValue `json:"value"`
	Field string      `json:"field"`
}

type ChangeValue struct {
	MessagingProduct string    `json:"messaging_product"`
	Metadata         Metadata  `json:"metadata"`
	Contacts         []Contact `json:"contacts"`
	Messages         []Message `json:"messages"`
	Statuses         []Status  `json:"statuses"`
}

type Metadata struct {
	DisplayPhoneNumber string `json:"display_phone_number"`
	PhoneNumberID      string `json:"phone_number_id"`
}

type Contact struct {
	Profile Profile `json:"profile"`
	WaID    string  `json:"wa_id"`
}

type Profile struct {
	Name string `json:"name"`
}

type Message struct {
	From      string      `json:"from"`
	ID        string      `json:"id"`
	Timestamp string      `json:"timestamp"`
	Type      string      `json:"type"`
	Text      *TextBody   `json:"text,omitempty"`
	Button    *ButtonBody `json:"button,omitempty"`
	Interactive *Interactive `json:"interactive,omitempty"`
}

type TextBody struct {
	Body string `json:"body"`
}

type ButtonBody struct {
	Payload string `json:"payload"`
	Text    string `json:"text"`
}

type Interactive struct {
	Type        string      `json:"type"`
	ButtonReply *ButtonReply `json:"button_reply,omitempty"`
	ListReply   *ListReply  `json:"list_reply,omitempty"`
}

type ButtonReply struct {
	ID    string `json:"id"`
	Title string `json:"title"`
}

type ListReply struct {
	ID          string `json:"id"`
	Title       string `json:"title"`
	Description string `json:"description"`
}

type Status struct {
	ID           string `json:"id"`
	Status       string `json:"status"`
	Timestamp    string `json:"timestamp"`
	RecipientID  string `json:"recipient_id"`
}

// HandleInbound processes inbound WhatsApp messages from Meta
func (h *Handler) HandleInbound(c *gin.Context) {
	// Verify HMAC signature
	body, err := io.ReadAll(c.Request.Body)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "cannot read body"})
		return
	}

	if !h.verifySignature(c.GetHeader("X-Hub-Signature-256"), body) {
		h.log.Warnw("WhatsApp signature verification failed")
		c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid signature"})
		return
	}

	var payload WebhookPayload
	if err := json.Unmarshal(body, &payload); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid JSON"})
		return
	}

	// Process each message asynchronously
	go h.processPayload(payload)

	// Always respond 200 immediately to Meta
	c.JSON(http.StatusOK, gin.H{"status": "received"})
}

func (h *Handler) processPayload(payload WebhookPayload) {
	for _, entry := range payload.Entry {
		for _, change := range entry.Changes {
			// Handle delivery status updates
			for _, status := range change.Value.Statuses {
				h.updateMessageStatus(status)
			}

			// Handle inbound messages
			for i, msg := range change.Value.Messages {
				var contactName string
				if i < len(change.Value.Contacts) {
					contactName = change.Value.Contacts[i].Profile.Name
				}
				h.processMessage(msg, change.Value.Contacts, contactName)
			}
		}
	}
}

func (h *Handler) processMessage(msg Message, contacts []Contact, displayName string) {
	ctx := context.Background()

	// Extract text from message
	var text string
	switch msg.Type {
	case "text":
		if msg.Text != nil {
			text = msg.Text.Body
		}
	case "button":
		if msg.Button != nil {
			text = msg.Button.Payload
		}
	case "interactive":
		if msg.Interactive != nil {
			if msg.Interactive.ButtonReply != nil {
				text = msg.Interactive.ButtonReply.ID
			} else if msg.Interactive.ListReply != nil {
				text = msg.Interactive.ListReply.ID
			}
		}
	default:
		h.log.Infow("Unsupported message type", "type", msg.Type, "from", msg.From)
		h.sendTextMessage(msg.From, "Sorry, I can only process text messages. Type *help* for available commands.")
		return
	}

	h.log.Infow("WhatsApp message received", "from", msg.From, "type", msg.Type, "text", text)

	// Upsert contact
	contactID := h.upsertContact(ctx, msg.From, displayName)

	// Persist inbound message
	h.persistMessage(ctx, contactID, msg.ID, "INBOUND", msg.Type, text)

	// Forward to Python bot-logic service
	response := h.forwardToBotLogic(msg.From, text, "whatsapp")

	// Send reply
	if response != "" {
		wamid := h.sendTextMessage(msg.From, response)
		// Persist outbound message
		h.persistMessage(ctx, contactID, wamid, "OUTBOUND", "text", response)
	}

	// Emit Kafka event
	h.kafka.Emit("nexcom.whatsapp.message.received", map[string]interface{}{
		"contact_id":   contactID,
		"phone":        msg.From,
		"message_type": msg.Type,
		"text":         text,
		"wamid":        msg.ID,
		"timestamp":    time.Now().UTC().Format(time.RFC3339),
	})
}

// ─── Outbound Message Sending ─────────────────────────────────────────────────

// SendMessage handles internal POST /send/whatsapp requests from the tRPC notification service
func (h *Handler) SendMessage(c *gin.Context) {
	var req struct {
		To      string `json:"to" binding:"required"`
		Message string `json:"message" binding:"required"`
		Type    string `json:"type"` // "text" | "template"
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	wamid := h.sendTextMessage(req.To, req.Message)
	c.JSON(http.StatusOK, gin.H{"wamid": wamid, "status": "sent"})
}

// sendTextMessage sends a plain text WhatsApp message via Meta Graph API
func (h *Handler) sendTextMessage(to, text string) string {
	if h.config.AccessToken == "" || h.config.PhoneNumberID == "" {
		h.log.Warnw("WhatsApp not configured — skipping send", "to", to)
		return ""
	}

	payload := map[string]interface{}{
		"messaging_product": "whatsapp",
		"recipient_type":    "individual",
		"to":                to,
		"type":              "text",
		"text":              map[string]string{"body": text},
	}

	body, _ := json.Marshal(payload)
	url := fmt.Sprintf("https://graph.facebook.com/v19.0/%s/messages", h.config.PhoneNumberID)

	req, err := http.NewRequest("POST", url, bytes.NewReader(body))
	if err != nil {
		h.log.Errorw("Failed to create WhatsApp request", "error", err)
		return ""
	}
	req.Header.Set("Authorization", "Bearer "+h.config.AccessToken)
	req.Header.Set("Content-Type", "application/json")

	resp, err := h.client.Do(req)
	if err != nil {
		h.log.Errorw("WhatsApp send failed", "error", err, "to", to)
		return ""
	}
	defer resp.Body.Close()

	var result struct {
		Messages []struct {
			ID string `json:"id"`
		} `json:"messages"`
	}
	json.NewDecoder(resp.Body).Decode(&result)

	if len(result.Messages) > 0 {
		return result.Messages[0].ID
	}
	return ""
}

// ─── Database helpers ─────────────────────────────────────────────────────────

func (h *Handler) upsertContact(ctx context.Context, waID, displayName string) int {
	var id int
	err := h.db.QueryRow(ctx,
		`INSERT INTO whatsapp_contacts (phone_number, wa_id, display_name, last_message_at, total_messages, created_at, updated_at)
		 VALUES ($1, $2, $3, NOW(), 1, NOW(), NOW())
		 ON CONFLICT (wa_id) DO UPDATE SET
		   display_name = COALESCE(EXCLUDED.display_name, whatsapp_contacts.display_name),
		   last_message_at = NOW(),
		   total_messages = whatsapp_contacts.total_messages + 1,
		   updated_at = NOW()
		 RETURNING id`,
		"+"+waID, waID, displayName,
	).Scan(&id)
	if err != nil {
		h.log.Errorw("Failed to upsert WhatsApp contact", "error", err, "wa_id", waID)
	}
	return id
}

func (h *Handler) persistMessage(ctx context.Context, contactID int, wamid, direction, msgType, body string) {
	_, err := h.db.Exec(ctx,
		`INSERT INTO whatsapp_messages (contact_id, wamid, direction, message_type, body, status, created_at, updated_at)
		 VALUES ($1, $2, $3, $4, $5, 'SENT', NOW(), NOW())
		 ON CONFLICT (wamid) DO NOTHING`,
		contactID, wamid, direction, msgType, body,
	)
	if err != nil {
		h.log.Errorw("Failed to persist WhatsApp message", "error", err)
	}
}

func (h *Handler) updateMessageStatus(status Status) {
	ctx := context.Background()
	_, err := h.db.Exec(ctx,
		`UPDATE whatsapp_messages SET status = $1, updated_at = NOW() WHERE wamid = $2`,
		status.Status, status.ID,
	)
	if err != nil {
		h.log.Errorw("Failed to update WhatsApp message status", "error", err)
	}
}

// ─── Bot Logic Forwarding ─────────────────────────────────────────────────────

type BotLogicRequest struct {
	Channel string `json:"channel"`
	From    string `json:"from"`
	Text    string `json:"text"`
}

type BotLogicResponse struct {
	Reply string `json:"reply"`
}

func (h *Handler) forwardToBotLogic(from, text, channel string) string {
	if h.config.BotLogicURL == "" {
		return h.fallbackResponse(text)
	}

	reqBody, _ := json.Marshal(BotLogicRequest{Channel: channel, From: from, Text: text})
	resp, err := h.client.Post(
		h.config.BotLogicURL+"/process",
		"application/json",
		bytes.NewReader(reqBody),
	)
	if err != nil {
		h.log.Warnw("Bot logic service unavailable", "error", err)
		return h.fallbackResponse(text)
	}
	defer resp.Body.Close()

	var result BotLogicResponse
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return h.fallbackResponse(text)
	}
	return result.Reply
}

func (h *Handler) fallbackResponse(text string) string {
	switch {
	case text == "" || text == "hi" || text == "hello" || text == "start":
		return "Welcome to *NEXCOM Exchange* 🌾\n\nType one of:\n• *price MAIZE* — get commodity price\n• *portfolio* — view your positions\n• *help* — all commands"
	case len(text) > 5 && text[:5] == "price":
		return "Price check is available. Please log in at nexcom.exchange to get live prices."
	default:
		return "Type *help* for available commands, or visit nexcom.exchange"
	}
}

// ─── Signature Verification ───────────────────────────────────────────────────

func (h *Handler) verifySignature(signature string, body []byte) bool {
	if h.config.AccessToken == "" {
		return true // Skip verification in dev mode
	}
	if len(signature) < 7 {
		return false
	}
	mac := hmac.New(sha256.New, []byte(h.config.AccessToken))
	mac.Write(body)
	expected := "sha256=" + hex.EncodeToString(mac.Sum(nil))
	return hmac.Equal([]byte(signature), []byte(expected))
}
