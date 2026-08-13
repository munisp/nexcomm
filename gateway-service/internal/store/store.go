package store

import (
	"fmt"
	"math"
	"sort"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/munisp/NGApp/services/gateway/internal/models"
)

// Store provides in-memory data storage with full CRUD operations.
// In production: backed by PostgreSQL + TimescaleDB with Redis caching.
type Store struct {
	mu            sync.RWMutex
	commodities   []models.Commodity
	orders        map[string]models.Order           // orderID -> Order
	trades        map[string]models.Trade           // tradeID -> Trade
	positions     map[string]models.Position        // positionID -> Position
	alerts        map[string]models.PriceAlert      // alertID -> Alert
	users         map[string]models.User            // userID -> User
	sessions      map[string]models.Session         // sessionID -> Session
	preferences   map[string]models.UserPreferences // userID -> Preferences
	notifications map[string][]models.Notification  // userID -> []Notification
	tickers       map[string]models.MarketTicker    // symbol -> Ticker
	accounts      map[string]models.Account         // accountID -> Account
	auditLog      []models.AuditEntry               // append-only audit log
}

func New() *Store {
	s := &Store{
		orders:        make(map[string]models.Order),
		trades:        make(map[string]models.Trade),
		positions:     make(map[string]models.Position),
		alerts:        make(map[string]models.PriceAlert),
		users:         make(map[string]models.User),
		sessions:      make(map[string]models.Session),
		preferences:   make(map[string]models.UserPreferences),
		notifications: make(map[string][]models.Notification),
		tickers:       make(map[string]models.MarketTicker),
		accounts:      make(map[string]models.Account),
		auditLog:      make([]models.AuditEntry, 0),
	}
	// Production data must be loaded from durable upstream services. The gateway
	// does not seed a demo account, orders, trades, positions, or market prices.
	return s
}

// ============================================================
// Commodities / Markets
// ============================================================

func (s *Store) GetCommodities() []models.Commodity {
	s.mu.RLock()
	defer s.mu.RUnlock()
	result := make([]models.Commodity, len(s.commodities))
	copy(result, s.commodities)
	return result
}

func (s *Store) GetCommodity(symbol string) (models.Commodity, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	for _, c := range s.commodities {
		if c.Symbol == symbol {
			return c, true
		}
	}
	return models.Commodity{}, false
}

func (s *Store) SearchCommodities(query string) []models.Commodity {
	s.mu.RLock()
	defer s.mu.RUnlock()
	var results []models.Commodity
	for _, c := range s.commodities {
		if containsIgnoreCase(c.Symbol, query) || containsIgnoreCase(c.Name, query) || containsIgnoreCase(c.Category, query) {
			results = append(results, c)
		}
	}
	return results
}

func (s *Store) GetTicker(symbol string) (models.MarketTicker, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	t, ok := s.tickers[symbol]
	return t, ok
}

func (s *Store) GetOrderBook(symbol string) models.OrderBook {
	// Order-book depth is authoritative only when received from the matching
	// engine/Fluvio stream. Returning generated depth would be market-data fraud.
	return models.OrderBook{Symbol: symbol}
}

func (s *Store) GetCandles(symbol string, interval string, limit int) []models.OHLCVCandle {
	// Historical OHLCV must come from the lakehouse or a real market-data
	// provider. This legacy store has no durable time-series source.
	return nil
}

// ============================================================
// Orders CRUD
// ============================================================

func (s *Store) GetOrders(userID string, status string) []models.Order {
	s.mu.RLock()
	defer s.mu.RUnlock()
	var result []models.Order
	for _, o := range s.orders {
		if o.UserID == userID {
			if status == "" || string(o.Status) == status {
				result = append(result, o)
			}
		}
	}
	sort.Slice(result, func(i, j int) bool {
		return result[i].CreatedAt.After(result[j].CreatedAt)
	})
	return result
}

func (s *Store) GetOrder(orderID string) (models.Order, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	o, ok := s.orders[orderID]
	return o, ok
}

func (s *Store) CreateOrder(order models.Order) models.Order {
	s.mu.Lock()
	defer s.mu.Unlock()
	order.ID = "ord-" + uuid.New().String()[:8]
	order.Status = models.StatusOpen
	order.CreatedAt = time.Now()
	order.UpdatedAt = time.Now()
	s.orders[order.ID] = order
	return order
}

func (s *Store) CancelOrder(orderID string) (models.Order, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	order, ok := s.orders[orderID]
	if !ok {
		return models.Order{}, fmt.Errorf("order not found: %s", orderID)
	}
	if order.Status != models.StatusOpen && order.Status != models.StatusPartial {
		return order, fmt.Errorf("cannot cancel order with status: %s", order.Status)
	}
	order.Status = models.StatusCancelled
	order.UpdatedAt = time.Now()
	s.orders[orderID] = order
	return order, nil
}

// ============================================================
// Trades
// ============================================================

func (s *Store) GetTrades(userID string, symbol string, limit int) []models.Trade {
	s.mu.RLock()
	defer s.mu.RUnlock()
	var result []models.Trade
	for _, t := range s.trades {
		if t.UserID == userID {
			if symbol == "" || t.Symbol == symbol {
				result = append(result, t)
			}
		}
	}
	sort.Slice(result, func(i, j int) bool {
		return result[i].Timestamp.After(result[j].Timestamp)
	})
	if limit > 0 && len(result) > limit {
		result = result[:limit]
	}
	return result
}

func (s *Store) GetTrade(tradeID string) (models.Trade, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	t, ok := s.trades[tradeID]
	return t, ok
}

// ============================================================
// Positions
// ============================================================

func (s *Store) GetPositions(userID string) []models.Position {
	s.mu.RLock()
	defer s.mu.RUnlock()
	var result []models.Position
	for _, p := range s.positions {
		if p.UserID == userID {
			result = append(result, p)
		}
	}
	return result
}

func (s *Store) ClosePosition(positionID string) (models.Position, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	pos, ok := s.positions[positionID]
	if !ok {
		return models.Position{}, fmt.Errorf("position not found: %s", positionID)
	}
	delete(s.positions, positionID)
	return pos, nil
}

// ============================================================
// Portfolio
// ============================================================

func (s *Store) GetPortfolio(userID string) models.PortfolioSummary {
	s.mu.RLock()
	defer s.mu.RUnlock()

	var positions []models.Position
	totalValue := 0.0
	totalPnl := 0.0
	marginUsed := 0.0

	for _, p := range s.positions {
		if p.UserID == userID {
			positions = append(positions, p)
			totalValue += p.CurrentPrice * p.Quantity
			totalPnl += p.UnrealizedPnl
			marginUsed += p.Margin
		}
	}

	totalValue += 50000 // available cash
	return models.PortfolioSummary{
		TotalValue:       math.Round(totalValue*100) / 100,
		TotalPnl:         math.Round(totalPnl*100) / 100,
		TotalPnlPercent:  math.Round(totalPnl/totalValue*10000) / 100,
		AvailableBalance: 50000,
		MarginUsed:       math.Round(marginUsed*100) / 100,
		MarginAvailable:  math.Round((100000-marginUsed)*100) / 100,
		Positions:        positions,
	}
}

// ============================================================
// Alerts CRUD
// ============================================================

func (s *Store) GetAlerts(userID string) []models.PriceAlert {
	s.mu.RLock()
	defer s.mu.RUnlock()
	var result []models.PriceAlert
	for _, a := range s.alerts {
		if a.UserID == userID {
			result = append(result, a)
		}
	}
	sort.Slice(result, func(i, j int) bool {
		return result[i].CreatedAt.After(result[j].CreatedAt)
	})
	return result
}

func (s *Store) CreateAlert(alert models.PriceAlert) models.PriceAlert {
	s.mu.Lock()
	defer s.mu.Unlock()
	alert.ID = "alt-" + uuid.New().String()[:8]
	alert.Active = true
	alert.CreatedAt = time.Now()
	alert.UpdatedAt = time.Now()
	s.alerts[alert.ID] = alert
	return alert
}

func (s *Store) UpdateAlert(alertID string, active *bool) (models.PriceAlert, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	alert, ok := s.alerts[alertID]
	if !ok {
		return models.PriceAlert{}, fmt.Errorf("alert not found: %s", alertID)
	}
	if active != nil {
		alert.Active = *active
	}
	alert.UpdatedAt = time.Now()
	s.alerts[alertID] = alert
	return alert, nil
}

func (s *Store) DeleteAlert(alertID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, ok := s.alerts[alertID]; !ok {
		return fmt.Errorf("alert not found: %s", alertID)
	}
	delete(s.alerts, alertID)
	return nil
}

// ============================================================
// User / Account
// ============================================================

func (s *Store) GetUser(userID string) (models.User, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	u, ok := s.users[userID]
	return u, ok
}

func (s *Store) UpdateUser(userID string, req models.UpdateProfileRequest) (models.User, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	user, ok := s.users[userID]
	if !ok {
		return models.User{}, fmt.Errorf("user not found: %s", userID)
	}
	if req.Name != "" {
		user.Name = req.Name
	}
	if req.Phone != "" {
		user.Phone = req.Phone
	}
	if req.Country != "" {
		user.Country = req.Country
	}
	s.users[userID] = user
	return user, nil
}

func (s *Store) GetPreferences(userID string) (models.UserPreferences, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	p, ok := s.preferences[userID]
	return p, ok
}

func (s *Store) UpdatePreferences(userID string, req models.UpdatePreferencesRequest) (models.UserPreferences, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	prefs, ok := s.preferences[userID]
	if !ok {
		prefs = models.UserPreferences{UserID: userID}
	}
	if req.OrderFilled != nil {
		prefs.OrderFilled = *req.OrderFilled
	}
	if req.PriceAlerts != nil {
		prefs.PriceAlerts = *req.PriceAlerts
	}
	if req.MarginWarnings != nil {
		prefs.MarginWarnings = *req.MarginWarnings
	}
	if req.MarketNews != nil {
		prefs.MarketNews = *req.MarketNews
	}
	if req.SettlementUpdates != nil {
		prefs.SettlementUpdates = *req.SettlementUpdates
	}
	if req.SystemMaintenance != nil {
		prefs.SystemMaintenance = *req.SystemMaintenance
	}
	if req.EmailNotifications != nil {
		prefs.EmailNotifications = *req.EmailNotifications
	}
	if req.SMSNotifications != nil {
		prefs.SMSNotifications = *req.SMSNotifications
	}
	if req.PushNotifications != nil {
		prefs.PushNotifications = *req.PushNotifications
	}
	if req.USSDNotifications != nil {
		prefs.USSDNotifications = *req.USSDNotifications
	}
	if req.DefaultCurrency != nil {
		prefs.DefaultCurrency = *req.DefaultCurrency
	}
	if req.TimeZone != nil {
		prefs.TimeZone = *req.TimeZone
	}
	if req.DefaultChartPeriod != nil {
		prefs.DefaultChartPeriod = *req.DefaultChartPeriod
	}
	s.preferences[userID] = prefs
	return prefs, nil
}

func (s *Store) GetSessions(userID string) []models.Session {
	s.mu.RLock()
	defer s.mu.RUnlock()
	var result []models.Session
	for _, sess := range s.sessions {
		if sess.UserID == userID {
			result = append(result, sess)
		}
	}
	return result
}

func (s *Store) RevokeSession(sessionID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	sess, ok := s.sessions[sessionID]
	if !ok {
		return fmt.Errorf("session not found: %s", sessionID)
	}
	sess.Active = false
	s.sessions[sessionID] = sess
	return nil
}

// ============================================================
// Notifications
// ============================================================

func (s *Store) GetNotifications(userID string) []models.Notification {
	s.mu.RLock()
	defer s.mu.RUnlock()
	notifs := s.notifications[userID]
	result := make([]models.Notification, len(notifs))
	copy(result, notifs)
	return result
}

func (s *Store) MarkNotificationRead(notifID string, userID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	notifs := s.notifications[userID]
	for i, n := range notifs {
		if n.ID == notifID {
			notifs[i].Read = true
			s.notifications[userID] = notifs
			return nil
		}
	}
	return fmt.Errorf("notification not found: %s", notifID)
}

func (s *Store) MarkAllNotificationsRead(userID string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	notifs := s.notifications[userID]
	for i := range notifs {
		notifs[i].Read = true
	}
	s.notifications[userID] = notifs
}

// ============================================================
// Helpers
// ============================================================

func containsIgnoreCase(s, substr string) bool {
	return len(s) >= len(substr) &&
		(s == substr ||
			len(substr) == 0 ||
			indexIgnoreCase(s, substr) >= 0)
}

func indexIgnoreCase(s, substr string) int {
	sl := toLower(s)
	subl := toLower(substr)
	for i := 0; i <= len(sl)-len(subl); i++ {
		if sl[i:i+len(subl)] == subl {
			return i
		}
	}
	return -1
}

func toLower(s string) string {
	b := make([]byte, len(s))
	for i := 0; i < len(s); i++ {
		c := s[i]
		if c >= 'A' && c <= 'Z' {
			c += 'a' - 'A'
		}
		b[i] = c
	}
	return string(b)
}

// ============================================================
// Accounts CRUD
// ============================================================

func (s *Store) GetAccounts() []models.Account {
	s.mu.RLock()
	defer s.mu.RUnlock()
	var result []models.Account
	for _, a := range s.accounts {
		result = append(result, a)
	}
	return result
}

func (s *Store) GetAccount(id string) (models.Account, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	a, ok := s.accounts[id]
	return a, ok
}

func (s *Store) CreateAccount(req models.CreateAccountRequest) models.Account {
	s.mu.Lock()
	defer s.mu.Unlock()
	account := models.Account{
		ID:        "acc-" + uuid.New().String()[:8],
		UserID:    req.UserID,
		Type:      req.Type,
		Currency:  req.Currency,
		Balance:   0,
		Available: 0,
		Locked:    0,
		Status:    "active",
		Tier:      models.TierRetailTrader,
		CreatedAt: time.Now(),
		UpdatedAt: time.Now(),
	}
	s.accounts[account.ID] = account
	s.auditLog = append(s.auditLog, models.AuditEntry{
		ID:        "aud-" + uuid.New().String()[:8],
		UserID:    req.UserID,
		Action:    "CREATE_ACCOUNT",
		Resource:  "account:" + account.ID,
		Details:   fmt.Sprintf("Created %s account in %s", req.Type, req.Currency),
		Timestamp: time.Now(),
	})
	return account
}

func (s *Store) UpdateAccount(id string, req models.UpdateAccountRequest) (models.Account, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	account, ok := s.accounts[id]
	if !ok {
		return models.Account{}, false
	}
	if req.Status != nil {
		account.Status = *req.Status
	}
	if req.Tier != nil {
		account.Tier = models.AccountTier(*req.Tier)
	}
	account.UpdatedAt = time.Now()
	s.accounts[id] = account
	s.auditLog = append(s.auditLog, models.AuditEntry{
		ID:        "aud-" + uuid.New().String()[:8],
		UserID:    account.UserID,
		Action:    "UPDATE_ACCOUNT",
		Resource:  "account:" + id,
		Details:   "Account updated",
		Timestamp: time.Now(),
	})
	return account, true
}

func (s *Store) DeleteAccount(id string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	account, ok := s.accounts[id]
	if !ok {
		return false
	}
	delete(s.accounts, id)
	s.auditLog = append(s.auditLog, models.AuditEntry{
		ID:        "aud-" + uuid.New().String()[:8],
		UserID:    account.UserID,
		Action:    "DELETE_ACCOUNT",
		Resource:  "account:" + id,
		Details:   "Account deleted",
		Timestamp: time.Now(),
	})
	return true
}

// ============================================================
// Audit Log
// ============================================================

func (s *Store) GetAuditLog() []models.AuditEntry {
	s.mu.RLock()
	defer s.mu.RUnlock()
	result := make([]models.AuditEntry, len(s.auditLog))
	copy(result, s.auditLog)
	return result
}

func (s *Store) GetAuditEntry(id string) (models.AuditEntry, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	for _, e := range s.auditLog {
		if e.ID == id {
			return e, true
		}
	}
	return models.AuditEntry{}, false
}
