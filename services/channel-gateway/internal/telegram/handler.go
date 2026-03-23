/*
 * Telegram Bot Handler (Go)
 * ==========================
 * Handles Telegram Bot API webhook updates.
 *
 * Commands:
 *   /start       — welcome + registration
 *   /help        — command list
 *   /price       — commodity price (e.g. /price MAIZE)
 *   /portfolio   — portfolio summary (requires verification)
 *   /trade       — place order (requires verification)
 *   /loan        — loan status (requires verification)
 *   /alert       — set price alert (e.g. /alert MAIZE 50000)
 *   /verify      — link Telegram to NEXCOM account
 *   /unsubscribe — opt out of notifications
 *
 * Inline keyboards are used for multi-step flows (trade confirmation, alert setup).
 */

package telegram

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"
	"go.uber.org/zap"

	"github.com/nexcom/channel-gateway/internal/kafka"
)

// Config holds Telegram Bot API credentials
type Config struct {
	BotToken    string
	WebhookPath string
	BotLogicURL string
}

// Handler handles Telegram webhook updates
type Handler struct {
	db     *pgxpool.Pool
	kafka  *kafka.Producer
	log    *zap.SugaredLogger
	config Config
	client *http.Client
	apiURL string
}

func NewHandler(db *pgxpool.Pool, kp *kafka.Producer, log *zap.SugaredLogger, cfg Config) *Handler {
	return &Handler{
		db:     db,
		kafka:  kp,
		log:    log,
		config: cfg,
		client: &http.Client{Timeout: 10 * time.Second},
		apiURL: fmt.Sprintf("https://api.telegram.org/bot%s", cfg.BotToken),
	}
}

// ─── Telegram Update Types ────────────────────────────────────────────────────

type Update struct {
	UpdateID      int64          `json:"update_id"`
	Message       *TgMessage     `json:"message,omitempty"`
	CallbackQuery *CallbackQuery `json:"callback_query,omitempty"`
}

type TgMessage struct {
	MessageID int64    `json:"message_id"`
	From      *TgUser  `json:"from,omitempty"`
	Chat      TgChat   `json:"chat"`
	Text      string   `json:"text,omitempty"`
	Date      int64    `json:"date"`
}

type TgUser struct {
	ID        int64  `json:"id"`
	IsBot     bool   `json:"is_bot"`
	FirstName string `json:"first_name"`
	LastName  string `json:"last_name"`
	Username  string `json:"username"`
}

type TgChat struct {
	ID   int64  `json:"id"`
	Type string `json:"type"`
}

type CallbackQuery struct {
	ID      string     `json:"id"`
	From    TgUser     `json:"from"`
	Message *TgMessage `json:"message,omitempty"`
	Data    string     `json:"data"`
}

// ─── Webhook Handler ──────────────────────────────────────────────────────────

// HandleUpdate processes Telegram Bot API webhook updates
func (h *Handler) HandleUpdate(c *gin.Context) {
	var update Update
	if err := c.ShouldBindJSON(&update); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid JSON"})
		return
	}

	// Process asynchronously
	go h.processUpdate(update)

	// Always respond 200 immediately to Telegram
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (h *Handler) processUpdate(update Update) {
	if update.Message != nil {
		h.processMessage(update.Message)
	} else if update.CallbackQuery != nil {
		h.processCallbackQuery(update.CallbackQuery)
	}
}

func (h *Handler) processMessage(msg *TgMessage) {
	if msg.From == nil || msg.From.IsBot {
		return
	}

	ctx := context.Background()
	chatID := msg.Chat.ID
	telegramID := fmt.Sprintf("%d", msg.From.ID)
	text := strings.TrimSpace(msg.Text)

	h.log.Infow("Telegram message", "from", telegramID, "text", text)

	// Upsert contact
	contactID := h.upsertContact(ctx, msg.From)

	// Persist inbound message
	h.persistMessage(ctx, contactID, int(msg.MessageID), "INBOUND", "", text)

	// Parse command
	var reply string
	var keyboard *InlineKeyboard

	if strings.HasPrefix(text, "/") {
		reply, keyboard = h.handleCommand(ctx, chatID, telegramID, text)
	} else {
		// Forward to Python bot-logic for NLP
		reply = h.forwardToBotLogic(telegramID, text, "telegram")
	}

	if reply != "" {
		sentMsgID := h.sendMessage(chatID, reply, keyboard)
		h.persistMessage(ctx, contactID, sentMsgID, "OUTBOUND", "", reply)
	}

	// Emit Kafka event
	h.kafka.Emit("nexcom.telegram.message.received", map[string]interface{}{
		"contact_id":  contactID,
		"telegram_id": telegramID,
		"text":        text,
		"timestamp":   time.Now().UTC().Format(time.RFC3339),
	})

	// Update interaction count
	h.db.Exec(ctx,
		"UPDATE telegram_contacts SET total_commands = total_commands + 1, last_interaction_at = NOW() WHERE telegram_id = $1",
		telegramID,
	)
}

func (h *Handler) processCallbackQuery(cb *CallbackQuery) {
	ctx := context.Background()
	telegramID := fmt.Sprintf("%d", cb.From.ID)
	chatID := cb.Message.Chat.ID

	h.log.Infow("Telegram callback", "from", telegramID, "data", cb.Data)

	// Acknowledge the callback immediately
	h.answerCallbackQuery(cb.ID, "")

	contactID := h.getContactID(ctx, telegramID)

	// ─── Order confirmation callbacks ────────────────────────────────────────
	if cb.Data == "order:cancel" {
		sentMsgID := h.sendMessage(chatID, "❌ Order cancelled. No position was opened.", nil)
		h.persistMessage(ctx, contactID, sentMsgID, "OUTBOUND", "", "Order cancelled.")
		return
	}

	if strings.HasPrefix(cb.Data, "order:confirm:") {
		// Format: order:confirm:SIDE:SYMBOL:QTY
		parts := strings.SplitN(cb.Data, ":", 5)
		if len(parts) == 5 {
			side, symbol, qty := parts[2], parts[3], parts[4]
			// Forward to bot-logic to execute the trade
			executeCmd := fmt.Sprintf("EXECUTE_ORDER:%s %s %s", side, symbol, qty)
			reply := h.forwardToBotLogic(telegramID, executeCmd, "telegram")
			if reply == "" {
				reply = fmt.Sprintf(
					"⏳ Order submitted: *%s %s MT of %s*\n\nYou will receive a confirmation once matched.",
					side, qty, symbol,
				)
			}
			sentMsgID := h.sendMessage(chatID, reply, nil)
			h.persistMessage(ctx, contactID, sentMsgID, "OUTBOUND", "", reply)
			// Emit Kafka event for order submission
			h.kafka.Emit("nexcom.telegram.order.submitted", map[string]interface{}{
				"telegram_id": telegramID,
				"side":        side,
				"symbol":      symbol,
				"qty":         qty,
				"timestamp":   time.Now().UTC().Format(time.RFC3339),
			})
		}
		return
	}

	// ─── trade:BUY / trade:SELL shortcut callbacks ───────────────────────────
	if strings.HasPrefix(cb.Data, "trade:") {
		side := strings.ToUpper(strings.TrimPrefix(cb.Data, "trade:"))
		reply := fmt.Sprintf(
			"To place a *%s* order, use:\n/trade %s SYMBOL QUANTITY\n\nExample: /trade %s MAIZE 10",
			side, side, side,
		)
		sentMsgID := h.sendMessage(chatID, reply, nil)
		h.persistMessage(ctx, contactID, sentMsgID, "OUTBOUND", "", reply)
		return
	}

	// ─── cmd:* shortcut callbacks (from /start quick-action buttons) ─────────
	if strings.HasPrefix(cb.Data, "cmd:") {
		cmd := strings.TrimPrefix(cb.Data, "cmd:")
		var reply string
		var keyboard *InlineKeyboard
		switch cmd {
		case "price":
			reply = "Usage: /price SYMBOL\nExample: /price MAIZE\n\nAvailable: MAIZE, SORGHUM, SOYBEANS, SESAME, COCOA, COTTON, GINGER, GROUNDNUT"
		case "portfolio":
			reply = h.forwardToBotLogic(telegramID, "/portfolio", "telegram")
		case "loan":
			reply = h.forwardToBotLogic(telegramID, "/loan", "telegram")
		case "alert":
			reply = "*Price Alerts* 🔔\n\n/alert set SYMBOL PRICE [ABOVE|BELOW]\n/alert list\n/alert delete ID"
		case "verify":
			reply = "Use /verify YOUR_CODE to link your NEXCOM account.\n\nGet your code at nexcom.exchange → Settings → Telegram"
		default:
			reply = h.forwardToBotLogic(telegramID, "CALLBACK:"+cb.Data, "telegram")
		}
		if reply != "" {
			sentMsgID := h.sendMessage(chatID, reply, keyboard)
			h.persistMessage(ctx, contactID, sentMsgID, "OUTBOUND", "", reply)
		}
		return
	}

	// ─── Fallback: forward to bot-logic ──────────────────────────────────────
	reply := h.forwardToBotLogic(telegramID, "CALLBACK:"+cb.Data, "telegram")
	if reply != "" {
		sentMsgID := h.sendMessage(chatID, reply, nil)
		h.persistMessage(ctx, contactID, sentMsgID, "OUTBOUND", "", reply)
	}
}

// ─── Command Router ───────────────────────────────────────────────────────────

func (h *Handler) handleCommand(ctx context.Context, chatID int64, telegramID, text string) (string, *InlineKeyboard) {
	parts := strings.Fields(text)
	cmd := strings.ToLower(parts[0])
	args := parts[1:]

	switch cmd {
	case "/start":
		return h.cmdStart(ctx, telegramID, args)
	case "/help":
		return h.cmdHelp(), nil
	case "/price":
		return h.cmdPrice(args), nil
	case "/portfolio":
		return h.forwardToBotLogic(telegramID, text, "telegram"), nil
	case "/trade":
		return h.cmdTrade(args)
	case "/loan":
		return h.forwardToBotLogic(telegramID, text, "telegram"), nil
	case "/alert":
		return h.cmdAlert(telegramID, args), nil
	case "/verify":
		return h.cmdVerify(ctx, telegramID, args)
	case "/unsubscribe":
		return h.cmdUnsubscribe(ctx, telegramID)
	default:
		return fmt.Sprintf("Unknown command: %s\nType /help for available commands.", cmd), nil
	}
}

func (h *Handler) cmdStart(ctx context.Context, telegramID string, args []string) (string, *InlineKeyboard) {
	// Check if already verified
	var isVerified bool
	h.db.QueryRow(ctx, "SELECT is_verified FROM telegram_contacts WHERE telegram_id = $1", telegramID).Scan(&isVerified)

	if isVerified {
		return "Welcome back to *NEXCOM Exchange*! 🌾\n\nType /help for available commands.", &InlineKeyboard{
			InlineKeyboard: [][]InlineButton{
				{
					{Text: "💰 Price Check", CallbackData: "cmd:price"},
					{Text: "📊 Portfolio", CallbackData: "cmd:portfolio"},
				},
				{
					{Text: "🏦 Loan Status", CallbackData: "cmd:loan"},
					{Text: "🔔 Set Alert", CallbackData: "cmd:alert"},
				},
			},
		}
	}

	return `Welcome to *NEXCOM Exchange* 🌾

Nigeria's premier commodity exchange platform.

To get started:
1. Create an account at nexcom.exchange
2. Link your Telegram with /verify YOUR_CODE

*Available commands (no account needed):*
• /price SYMBOL — Live commodity prices
• /help — All commands

Type /verify to link your account.`, &InlineKeyboard{
		InlineKeyboard: [][]InlineButton{
			{{Text: "🔗 Link Account", CallbackData: "cmd:verify"}},
		},
	}
}

func (h *Handler) cmdHelp() string {
	return `*NEXCOM Exchange Bot Commands* 🌾

*Public (no login required):*
/price SYMBOL — Live price (e.g. /price MAIZE)
/help — This message

*Account required (/verify first):*
/portfolio — Your positions & P&L
/trade BUY|SELL SYMBOL QTY — Place order
/loan — Active loan status
/alert set SYMBOL PRICE [ABOVE|BELOW] — Set price alert
/alert list — View active alerts
/alert delete ID — Delete an alert

*Account management:*
/verify CODE — Link your NEXCOM account
/unsubscribe — Stop notifications

Visit nexcom.exchange for full platform access.`
}

func (h *Handler) cmdPrice(args []string) string {
	if len(args) == 0 {
		return "Usage: /price SYMBOL\nExample: /price MAIZE\n\nAvailable: MAIZE, SORGHUM, SOYBEANS, SESAME, COCOA, COTTON, GINGER, GROUNDNUT"
	}
	symbol := strings.ToUpper(args[0])
	// Forward to bot-logic for real price lookup
	return fmt.Sprintf("Fetching price for *%s*...\n\nFor live prices, use /price %s after linking your account with /verify", symbol, symbol)
}

func (h *Handler) cmdTrade(args []string) (string, *InlineKeyboard) {
	if len(args) < 3 {
		return "Usage: /trade BUY|SELL SYMBOL QUANTITY\nExample: /trade BUY MAIZE 10\n\nRequires account verification (/verify)", &InlineKeyboard{
			InlineKeyboard: [][]InlineButton{
				{
					{Text: "📈 Buy Order", CallbackData: "trade:BUY"},
					{Text: "📉 Sell Order", CallbackData: "trade:SELL"},
				},
			},
		}
	}
	side := strings.ToUpper(args[0])
	symbol := strings.ToUpper(args[1])
	qty := args[2]

	return fmt.Sprintf("*Order Preview*\n%s %s %s MT\n\nConfirm this order?", side, symbol, qty), &InlineKeyboard{
		InlineKeyboard: [][]InlineButton{
			{
				{Text: "✅ Confirm", CallbackData: fmt.Sprintf("order:confirm:%s:%s:%s", side, symbol, qty)},
				{Text: "❌ Cancel", CallbackData: "order:cancel"},
			},
		},
	}
}

func (h *Handler) cmdAlert(telegramID string, args []string) string {
	if len(args) == 0 {
		// Show alert help menu
		return "*Price Alerts* 🔔\n\nManage your commodity price alerts:\n\n" +
			"/alert set SYMBOL PRICE [ABOVE|BELOW] — Create alert\n" +
			"/alert list — View active alerts\n" +
			"/alert delete ID — Delete an alert\n\n" +
			"Examples:\n" +
			"  /alert set GINGER 500 ABOVE\n" +
			"  /alert set MAIZE 50000 BELOW\n" +
			"  /alert list\n" +
			"  /alert delete 42"
	}

	subCmd := strings.ToLower(args[0])
	switch subCmd {
	case "set":
		if len(args) < 3 {
			return "Usage: /alert set SYMBOL PRICE [ABOVE|BELOW]\n" +
				"Example: /alert set GINGER 500 ABOVE"
		}
		symbol := strings.ToUpper(args[1])
		price := args[2]
		condition := "ABOVE"
		if len(args) >= 4 {
			condition = strings.ToUpper(args[3])
		}
		return h.forwardToBotLogic(telegramID,
			fmt.Sprintf("alert set %s %s %s", symbol, price, condition), "telegram")

	case "list":
		return h.forwardToBotLogic(telegramID, "alert list", "telegram")

	case "delete", "del", "remove":
		if len(args) < 2 {
			return "Usage: /alert delete ID\nExample: /alert delete 42\n\nType /alert list to see your alert IDs."
		}
		alertID := args[1]
		return h.forwardToBotLogic(telegramID,
			fmt.Sprintf("alert delete %s", alertID), "telegram")

	default:
		// Legacy: /alert SYMBOL PRICE (backward compat with old format)
		if len(args) >= 2 {
			symbol := strings.ToUpper(args[0])
			price := args[1]
			return h.forwardToBotLogic(telegramID,
				fmt.Sprintf("alert set %s %s ABOVE", symbol, price), "telegram")
		}
		return "Usage: /alert set SYMBOL PRICE\nExample: /alert set GINGER 500"
	}
}

func (h *Handler) cmdVerify(ctx context.Context, telegramID string, args []string) (string, *InlineKeyboard) {
	if len(args) == 0 {
		// Generate verification code
		code := generateVerificationCode()
		_, err := h.db.Exec(ctx,
			`UPDATE telegram_contacts SET verification_code = $1, verification_expires_at = NOW() + INTERVAL '15 minutes'
			 WHERE telegram_id = $2`,
			code, telegramID,
		)
		if err != nil {
			return "Error generating verification code. Please try again.", nil
		}
		return fmt.Sprintf(`To link your NEXCOM account:

1. Go to nexcom.exchange/settings/telegram
2. Enter this code: *%s*
3. Code expires in 15 minutes

Or provide your code directly: /verify YOUR_CODE`, code), nil
	}

	// Verify the code
	code := args[0]
	var userID int
	err := h.db.QueryRow(ctx,
		`SELECT user_id FROM telegram_contacts
		 WHERE telegram_id = $1 AND verification_code = $2 AND verification_expires_at > NOW()`,
		telegramID, code,
	).Scan(&userID)

	if err != nil {
		return "Invalid or expired code. Type /verify to get a new code.", nil
	}

	h.db.Exec(ctx,
		`UPDATE telegram_contacts SET is_verified = true, verification_code = NULL, updated_at = NOW() WHERE telegram_id = $1`,
		telegramID,
	)

	return "✅ Account linked successfully!\n\nYou can now use:\n/portfolio — View positions\n/trade — Place orders\n/loan — Loan status\n/alert — Set price alerts", &InlineKeyboard{
		InlineKeyboard: [][]InlineButton{
			{
				{Text: "📊 My Portfolio", CallbackData: "cmd:portfolio"},
				{Text: "💰 Price Check", CallbackData: "cmd:price"},
			},
		},
	}
}

func (h *Handler) cmdUnsubscribe(ctx context.Context, telegramID string) (string, *InlineKeyboard) {
	return "Are you sure you want to stop receiving NEXCOM notifications?", &InlineKeyboard{
		InlineKeyboard: [][]InlineButton{
			{
				{Text: "✅ Yes, unsubscribe", CallbackData: "unsubscribe:confirm"},
				{Text: "❌ No, keep notifications", CallbackData: "unsubscribe:cancel"},
			},
		},
	}
}

// ─── Telegram API Helpers ─────────────────────────────────────────────────────

type InlineKeyboard struct {
	InlineKeyboard [][]InlineButton `json:"inline_keyboard"`
}

type InlineButton struct {
	Text         string `json:"text"`
	CallbackData string `json:"callback_data,omitempty"`
	URL          string `json:"url,omitempty"`
}

// SendMessage handles internal POST /send/telegram requests
func (h *Handler) SendMessage(c *gin.Context) {
	var req struct {
		ChatID  int64  `json:"chat_id" binding:"required"`
		Message string `json:"message" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	msgID := h.sendMessage(req.ChatID, req.Message, nil)
	c.JSON(http.StatusOK, gin.H{"message_id": msgID, "status": "sent"})
}

func (h *Handler) sendMessage(chatID int64, text string, keyboard *InlineKeyboard) int {
	if h.config.BotToken == "" {
		h.log.Warnw("Telegram not configured — skipping send", "chat_id", chatID)
		return 0
	}

	payload := map[string]interface{}{
		"chat_id":    chatID,
		"text":       text,
		"parse_mode": "Markdown",
	}
	if keyboard != nil {
		payload["reply_markup"] = keyboard
	}

	body, _ := json.Marshal(payload)
	resp, err := h.client.Post(h.apiURL+"/sendMessage", "application/json", bytes.NewReader(body))
	if err != nil {
		h.log.Errorw("Telegram sendMessage failed", "error", err)
		return 0
	}
	defer resp.Body.Close()

	var result struct {
		OK     bool `json:"ok"`
		Result struct {
			MessageID int `json:"message_id"`
		} `json:"result"`
	}
	json.NewDecoder(resp.Body).Decode(&result)
	return result.Result.MessageID
}

func (h *Handler) answerCallbackQuery(callbackID, text string) {
	if h.config.BotToken == "" {
		return
	}
	payload := map[string]interface{}{"callback_query_id": callbackID}
	if text != "" {
		payload["text"] = text
	}
	body, _ := json.Marshal(payload)
	h.client.Post(h.apiURL+"/answerCallbackQuery", "application/json", bytes.NewReader(body))
}

// ─── Database Helpers ─────────────────────────────────────────────────────────

func (h *Handler) upsertContact(ctx context.Context, user *TgUser) int {
	var id int
	telegramID := fmt.Sprintf("%d", user.ID)
	err := h.db.QueryRow(ctx,
		`INSERT INTO telegram_contacts (telegram_id, username, first_name, last_name, last_interaction_at, created_at, updated_at)
		 VALUES ($1, $2, $3, $4, NOW(), NOW(), NOW())
		 ON CONFLICT (telegram_id) DO UPDATE SET
		   username = COALESCE(EXCLUDED.username, telegram_contacts.username),
		   first_name = COALESCE(EXCLUDED.first_name, telegram_contacts.first_name),
		   last_name = COALESCE(EXCLUDED.last_name, telegram_contacts.last_name),
		   last_interaction_at = NOW(),
		   updated_at = NOW()
		 RETURNING id`,
		telegramID, user.Username, user.FirstName, user.LastName,
	).Scan(&id)
	if err != nil {
		h.log.Errorw("Failed to upsert Telegram contact", "error", err)
	}
	return id
}

func (h *Handler) persistMessage(ctx context.Context, contactID, msgID int, direction, command, text string) {
	h.db.Exec(ctx,
		`INSERT INTO telegram_messages (contact_id, telegram_message_id, direction, command, text, created_at)
		 VALUES ($1, $2, $3, $4, $5, NOW())`,
		contactID, msgID, direction, command, text,
	)
}

func (h *Handler) getContactID(ctx context.Context, telegramID string) int {
	var id int
	h.db.QueryRow(ctx, "SELECT id FROM telegram_contacts WHERE telegram_id = $1", telegramID).Scan(&id)
	return id
}

// ─── Bot Logic Forwarding ─────────────────────────────────────────────────────

func (h *Handler) forwardToBotLogic(from, text, channel string) string {
	if h.config.BotLogicURL == "" {
		return h.fallbackResponse(text)
	}

	reqBody, _ := json.Marshal(map[string]string{
		"channel": channel,
		"from":    from,
		"text":    text,
	})
	resp, err := h.client.Post(h.config.BotLogicURL+"/process", "application/json", bytes.NewReader(reqBody))
	if err != nil {
		h.log.Warnw("Bot logic unavailable", "error", err)
		return h.fallbackResponse(text)
	}
	defer resp.Body.Close()

	var result struct {
		Reply string `json:"reply"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return h.fallbackResponse(text)
	}
	return result.Reply
}

func (h *Handler) fallbackResponse(text string) string {
	lower := strings.ToLower(text)
	if strings.Contains(lower, "price") || strings.Contains(lower, "maize") {
		return "Price data is available at nexcom.exchange or via /price SYMBOL"
	}
	return "I'm having trouble connecting right now. Visit nexcom.exchange or try again shortly."
}

// ─── Utilities ────────────────────────────────────────────────────────────────

func generateVerificationCode() string {
	// 6-digit numeric code
	return fmt.Sprintf("%06d", time.Now().UnixNano()%1000000)
}
