package store

import (
	"fmt"
	"math"
	"math/rand"
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
	orders        map[string]models.Order        // orderID -> Order
	trades        map[string]models.Trade        // tradeID -> Trade
	positions     map[string]models.Position     // positionID -> Position
	alerts        map[string]models.PriceAlert   // alertID -> Alert
	users         map[string]models.User         // userID -> User
	sessions      map[string]models.Session      // sessionID -> Session
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
	s.seedData()
	return s
}

func (s *Store) seedData() {
	s.commodities = seedCommodities()
	for _, c := range s.commodities {
		s.tickers[c.Symbol] = models.MarketTicker{
			Symbol:           c.Symbol,
			LastPrice:        c.LastPrice,
			Bid:              c.LastPrice * 0.999,
			Ask:              c.LastPrice * 1.001,
			Change24h:        c.Change24h,
			ChangePercent24h: c.ChangePercent24h,
			Volume24h:        c.Volume24h,
			High24h:          c.High24h,
			Low24h:           c.Low24h,
			Timestamp:        time.Now().UnixMilli(),
		}
	}

	// Seed demo user
	demoUserID := "usr-001"
	s.users[demoUserID] = models.User{
		ID:          demoUserID,
		Email:       "trader@nexcom.exchange",
		Name:        "Alex Trader",
		AccountTier: models.TierRetailTrader,
		KYCStatus:   models.KYCVerified,
		Phone:       "+254712345678",
		Country:     "Kenya",
		CreatedAt:   time.Now().Add(-90 * 24 * time.Hour),
	}

	s.preferences[demoUserID] = models.UserPreferences{
		UserID:             demoUserID,
		OrderFilled:        true,
		PriceAlerts:        true,
		MarginWarnings:     true,
		MarketNews:         false,
		SettlementUpdates:  true,
		SystemMaintenance:  true,
		EmailNotifications: true,
		SMSNotifications:   false,
		PushNotifications:  true,
		USSDNotifications:  false,
		DefaultCurrency:    "USD",
		TimeZone:           "Africa/Nairobi",
		DefaultChartPeriod: "1D",
	}

	s.sessions[demoUserID] = models.Session{
		ID:        "sess-001",
		UserID:    demoUserID,
		Device:    "Chrome 120 / macOS",
		Location:  "Nairobi, Kenya",
		IP:        "196.201.214.100",
		Active:    true,
		CreatedAt: time.Now().Add(-2 * time.Hour),
		LastSeen:  time.Now(),
	}

	// Seed orders
	symbols := []string{"MAIZE", "GOLD", "COFFEE", "CRUDE_OIL", "WHEAT"}
	sides := []models.OrderSide{models.SideBuy, models.SideSell}
	types := []models.OrderType{models.TypeLimit, models.TypeMarket}
	statuses := []models.OrderStatus{models.StatusOpen, models.StatusFilled, models.StatusCancelled, models.StatusPartial}

	for i := 0; i < 12; i++ {
		oid := fmt.Sprintf("ord-%03d", i+1)
		sym := symbols[i%len(symbols)]
		side := sides[i%2]
		otype := types[i%len(types)]
		status := statuses[i%len(statuses)]
		price := s.tickers[sym].LastPrice * (0.95 + rand.Float64()*0.1)
		qty := float64(rand.Intn(50)+1) * 10

		filled := 0.0
		if status == models.StatusFilled {
			filled = qty
		} else if status == models.StatusPartial {
			filled = qty * (0.3 + rand.Float64()*0.5)
		}

		s.orders[oid] = models.Order{
			ID:             oid,
			UserID:         demoUserID,
			Symbol:         sym,
			Side:           side,
			Type:           otype,
			Status:         status,
			Quantity:        qty,
			Price:           math.Round(price*100) / 100,
			FilledQuantity:  math.Round(filled*100) / 100,
			AveragePrice:    math.Round(price*1.001*100) / 100,
			CreatedAt:       time.Now().Add(-time.Duration(i) * time.Hour),
			UpdatedAt:       time.Now().Add(-time.Duration(i) * 30 * time.Minute),
		}
	}

	// Seed trades
	for i := 0; i < 8; i++ {
		tid := fmt.Sprintf("trd-%03d", i+1)
		sym := symbols[i%len(symbols)]
		side := sides[i%2]
		price := s.tickers[sym].LastPrice * (0.98 + rand.Float64()*0.04)
		qty := float64(rand.Intn(30)+1) * 10
		settlementStatus := models.SettlementSettled
		if i < 2 {
			settlementStatus = models.SettlementPending
		}

		s.trades[tid] = models.Trade{
			ID:               tid,
			OrderID:          fmt.Sprintf("ord-%03d", i+1),
			UserID:           demoUserID,
			Symbol:           sym,
			Side:             side,
			Price:            math.Round(price*100) / 100,
			Quantity:         qty,
			Fee:              math.Round(price*qty*0.001*100) / 100,
			Timestamp:        time.Now().Add(-time.Duration(i) * 2 * time.Hour),
			SettlementStatus: settlementStatus,
		}
	}

	// Seed positions
	positionData := []struct {
		symbol string
		side   models.OrderSide
		qty    float64
	}{
		{"MAIZE", models.SideBuy, 500},
		{"GOLD", models.SideBuy, 50},
		{"COFFEE", models.SideSell, 200},
		{"CRUDE_OIL", models.SideBuy, 100},
		{"WHEAT", models.SideSell, 300},
	}

	for i, pd := range positionData {
		pid := fmt.Sprintf("pos-%03d", i+1)
		ticker := s.tickers[pd.symbol]
		entry := ticker.LastPrice * (0.92 + rand.Float64()*0.16)
		pnl := (ticker.LastPrice - entry) * pd.qty
		if pd.side == models.SideSell {
			pnl = (entry - ticker.LastPrice) * pd.qty
		}
		pnlPct := (pnl / (entry * pd.qty)) * 100

		s.positions[pid] = models.Position{
			ID:                   pid,
			UserID:               demoUserID,
			Symbol:               pd.symbol,
			Side:                 pd.side,
			Quantity:             pd.qty,
			AverageEntryPrice:    math.Round(entry*100) / 100,
			CurrentPrice:         ticker.LastPrice,
			UnrealizedPnl:        math.Round(pnl*100) / 100,
			UnrealizedPnlPercent: math.Round(pnlPct*100) / 100,
			RealizedPnl:          math.Round(rand.Float64()*5000*100) / 100,
			Margin:               math.Round(entry*pd.qty*0.1*100) / 100,
			LiquidationPrice:     math.Round(entry*0.8*100) / 100,
		}
	}

	// Seed alerts
	alertData := []struct {
		symbol    string
		condition models.AlertCondition
		target    float64
		active    bool
	}{
		{"MAIZE", models.ConditionAbove, 285.00, true},
		{"GOLD", models.ConditionBelow, 1950.00, true},
		{"COFFEE", models.ConditionAbove, 165.00, false},
		{"CRUDE_OIL", models.ConditionBelow, 72.00, true},
	}

	for i, ad := range alertData {
		aid := fmt.Sprintf("alt-%03d", i+1)
		s.alerts[aid] = models.PriceAlert{
			ID:          aid,
			UserID:      demoUserID,
			Symbol:      ad.symbol,
			Condition:   ad.condition,
			TargetPrice: ad.target,
			Active:      ad.active,
			CreatedAt:   time.Now().Add(-time.Duration(i*24) * time.Hour),
			UpdatedAt:   time.Now().Add(-time.Duration(i*12) * time.Hour),
		}
	}

	// Seed notifications
	s.notifications[demoUserID] = []models.Notification{
		{ID: "notif-001", UserID: demoUserID, Type: "order_filled", Title: "Order Filled", Message: "Your BUY order for 100 MAIZE has been filled at $278.50", Read: false, Timestamp: time.Now().Add(-30 * time.Minute)},
		{ID: "notif-002", UserID: demoUserID, Type: "price_alert", Title: "Price Alert Triggered", Message: "GOLD has crossed above $2,050.00", Read: false, Timestamp: time.Now().Add(-2 * time.Hour)},
		{ID: "notif-003", UserID: demoUserID, Type: "margin_warning", Title: "Margin Warning", Message: "Your COFFEE SHORT position margin is at 85%", Read: false, Timestamp: time.Now().Add(-4 * time.Hour)},
		{ID: "notif-004", UserID: demoUserID, Type: "settlement", Title: "Settlement Complete", Message: "Trade TRD-005 has been settled via TigerBeetle ledger", Read: true, Timestamp: time.Now().Add(-6 * time.Hour)},
		{ID: "notif-005", UserID: demoUserID, Type: "system", Title: "System Maintenance", Message: "Scheduled maintenance window: Sunday 02:00-04:00 EAT", Read: true, Timestamp: time.Now().Add(-24 * time.Hour)},
	}
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
	s.mu.RLock()
	ticker, ok := s.tickers[symbol]
	s.mu.RUnlock()

	if !ok {
		return models.OrderBook{Symbol: symbol}
	}

	bids := make([]models.OrderBookLevel, 15)
	asks := make([]models.OrderBookLevel, 15)
	bidTotal := 0.0
	askTotal := 0.0

	for i := 0; i < 15; i++ {
		bidPrice := ticker.LastPrice * (1 - float64(i)*0.001)
		askPrice := ticker.LastPrice * (1 + float64(i+1)*0.001)
		bidQty := float64(rand.Intn(500)+50) * 10
		askQty := float64(rand.Intn(500)+50) * 10
		bidTotal += bidQty
		askTotal += askQty

		bids[i] = models.OrderBookLevel{
			Price:    math.Round(bidPrice*100) / 100,
			Quantity: bidQty,
			Total:    bidTotal,
		}
		asks[i] = models.OrderBookLevel{
			Price:    math.Round(askPrice*100) / 100,
			Quantity: askQty,
			Total:    askTotal,
		}
	}

	spread := asks[0].Price - bids[0].Price
	return models.OrderBook{
		Symbol:        symbol,
		Bids:          bids,
		Asks:          asks,
		Spread:        math.Round(spread*100) / 100,
		SpreadPercent: math.Round(spread/ticker.LastPrice*10000) / 100,
		LastUpdate:    time.Now().UnixMilli(),
	}
}

func (s *Store) GetCandles(symbol string, interval string, limit int) []models.OHLCVCandle {
	s.mu.RLock()
	ticker, ok := s.tickers[symbol]
	s.mu.RUnlock()

	if !ok {
		return nil
	}

	candles := make([]models.OHLCVCandle, limit)
	var intervalDuration time.Duration
	switch interval {
	case "1m":
		intervalDuration = time.Minute
	case "5m":
		intervalDuration = 5 * time.Minute
	case "15m":
		intervalDuration = 15 * time.Minute
	case "1h":
		intervalDuration = time.Hour
	case "4h":
		intervalDuration = 4 * time.Hour
	case "1d":
		intervalDuration = 24 * time.Hour
	default:
		intervalDuration = time.Hour
	}

	basePrice := ticker.LastPrice
	for i := limit - 1; i >= 0; i-- {
		t := time.Now().Add(-time.Duration(i) * intervalDuration)
		open := basePrice * (0.98 + rand.Float64()*0.04)
		closeP := basePrice * (0.98 + rand.Float64()*0.04)
		high := math.Max(open, closeP) * (1 + rand.Float64()*0.02)
		low := math.Min(open, closeP) * (1 - rand.Float64()*0.02)
		vol := float64(rand.Intn(10000)+1000) * 10

		candles[limit-1-i] = models.OHLCVCandle{
			Time:   t.Unix(),
			Open:   math.Round(open*100) / 100,
			High:   math.Round(high*100) / 100,
			Low:    math.Round(low*100) / 100,
			Close:  math.Round(closeP*100) / 100,
			Volume: vol,
		}
		basePrice = closeP
	}
	return candles
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
	if req.OrderFilled != nil { prefs.OrderFilled = *req.OrderFilled }
	if req.PriceAlerts != nil { prefs.PriceAlerts = *req.PriceAlerts }
	if req.MarginWarnings != nil { prefs.MarginWarnings = *req.MarginWarnings }
	if req.MarketNews != nil { prefs.MarketNews = *req.MarketNews }
	if req.SettlementUpdates != nil { prefs.SettlementUpdates = *req.SettlementUpdates }
	if req.SystemMaintenance != nil { prefs.SystemMaintenance = *req.SystemMaintenance }
	if req.EmailNotifications != nil { prefs.EmailNotifications = *req.EmailNotifications }
	if req.SMSNotifications != nil { prefs.SMSNotifications = *req.SMSNotifications }
	if req.PushNotifications != nil { prefs.PushNotifications = *req.PushNotifications }
	if req.USSDNotifications != nil { prefs.USSDNotifications = *req.USSDNotifications }
	if req.DefaultCurrency != nil { prefs.DefaultCurrency = *req.DefaultCurrency }
	if req.TimeZone != nil { prefs.TimeZone = *req.TimeZone }
	if req.DefaultChartPeriod != nil { prefs.DefaultChartPeriod = *req.DefaultChartPeriod }
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

func seedCommodities() []models.Commodity {
	return []models.Commodity{
		{ID: "cmd-001", Symbol: "MAIZE", Name: "Yellow Maize", Category: "agricultural", Unit: "MT", TickSize: 0.25, LotSize: 10, LastPrice: 278.50, Change24h: 3.25, ChangePercent24h: 1.18, Volume24h: 145230, High24h: 280.00, Low24h: 274.50, Open24h: 275.25},
		{ID: "cmd-002", Symbol: "WHEAT", Name: "Hard Red Wheat", Category: "agricultural", Unit: "MT", TickSize: 0.25, LotSize: 10, LastPrice: 342.75, Change24h: -2.50, ChangePercent24h: -0.72, Volume24h: 98450, High24h: 346.00, Low24h: 340.25, Open24h: 345.25},
		{ID: "cmd-003", Symbol: "COFFEE", Name: "Arabica Coffee", Category: "agricultural", Unit: "MT", TickSize: 0.05, LotSize: 5, LastPrice: 157.80, Change24h: 4.30, ChangePercent24h: 2.80, Volume24h: 67890, High24h: 159.00, Low24h: 152.50, Open24h: 153.50},
		{ID: "cmd-004", Symbol: "COCOA", Name: "Premium Cocoa", Category: "agricultural", Unit: "MT", TickSize: 1.00, LotSize: 10, LastPrice: 3245.00, Change24h: -45.00, ChangePercent24h: -1.37, Volume24h: 23450, High24h: 3300.00, Low24h: 3220.00, Open24h: 3290.00},
		{ID: "cmd-005", Symbol: "SESAME", Name: "White Sesame", Category: "agricultural", Unit: "MT", TickSize: 0.50, LotSize: 5, LastPrice: 1850.00, Change24h: 25.00, ChangePercent24h: 1.37, Volume24h: 12340, High24h: 1860.00, Low24h: 1820.00, Open24h: 1825.00},
		{ID: "cmd-006", Symbol: "GOLD", Name: "Gold", Category: "metals", Unit: "oz", TickSize: 0.10, LotSize: 1, LastPrice: 2045.30, Change24h: 12.80, ChangePercent24h: 0.63, Volume24h: 234560, High24h: 2050.00, Low24h: 2030.00, Open24h: 2032.50},
		{ID: "cmd-007", Symbol: "SILVER", Name: "Silver", Category: "metals", Unit: "oz", TickSize: 0.01, LotSize: 50, LastPrice: 23.45, Change24h: 0.35, ChangePercent24h: 1.52, Volume24h: 178900, High24h: 23.60, Low24h: 23.00, Open24h: 23.10},
		{ID: "cmd-008", Symbol: "CRUDE_OIL", Name: "Brent Crude Oil", Category: "energy", Unit: "bbl", TickSize: 0.01, LotSize: 100, LastPrice: 78.45, Change24h: -1.20, ChangePercent24h: -1.51, Volume24h: 456780, High24h: 80.00, Low24h: 77.80, Open24h: 79.65},
		{ID: "cmd-009", Symbol: "NAT_GAS", Name: "Natural Gas", Category: "energy", Unit: "MMBtu", TickSize: 0.001, LotSize: 100, LastPrice: 2.85, Change24h: 0.08, ChangePercent24h: 2.89, Volume24h: 345670, High24h: 2.90, Low24h: 2.75, Open24h: 2.77},
		{ID: "cmd-010", Symbol: "VCU", Name: "Verified Carbon Units", Category: "carbon", Unit: "tCO2e", TickSize: 0.01, LotSize: 100, LastPrice: 15.20, Change24h: 0.45, ChangePercent24h: 3.05, Volume24h: 89012, High24h: 15.50, Low24h: 14.70, Open24h: 14.75},
	}
}
