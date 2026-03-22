package models

import "time"

// ============================================================
// Core Domain Models
// ============================================================

type OrderSide string
type OrderType string
type OrderStatus string
type KYCStatus string
type AccountTier string
type AlertCondition string
type SettlementStatus string

const (
	SideBuy  OrderSide = "BUY"
	SideSell OrderSide = "SELL"

	TypeMarket    OrderType = "MARKET"
	TypeLimit     OrderType = "LIMIT"
	TypeStop      OrderType = "STOP"
	TypeStopLimit OrderType = "STOP_LIMIT"

	StatusPending   OrderStatus = "PENDING"
	StatusOpen      OrderStatus = "OPEN"
	StatusPartial   OrderStatus = "PARTIAL"
	StatusFilled    OrderStatus = "FILLED"
	StatusCancelled OrderStatus = "CANCELLED"
	StatusRejected  OrderStatus = "REJECTED"

	KYCNone     KYCStatus = "NONE"
	KYCPending  KYCStatus = "PENDING"
	KYCVerified KYCStatus = "VERIFIED"
	KYCRejected KYCStatus = "REJECTED"

	TierFarmer        AccountTier = "farmer"
	TierRetailTrader  AccountTier = "retail_trader"
	TierInstitutional AccountTier = "institutional"
	TierCooperative   AccountTier = "cooperative"

	ConditionAbove AlertCondition = "above"
	ConditionBelow AlertCondition = "below"

	SettlementPending SettlementStatus = "pending"
	SettlementSettled SettlementStatus = "settled"
	SettlementFailed  SettlementStatus = "failed"
)

type Commodity struct {
	ID               string  `json:"id"`
	Symbol           string  `json:"symbol"`
	Name             string  `json:"name"`
	Category         string  `json:"category"`
	Unit             string  `json:"unit"`
	TickSize         float64 `json:"tickSize"`
	LotSize          int     `json:"lotSize"`
	LastPrice        float64 `json:"lastPrice"`
	Change24h        float64 `json:"change24h"`
	ChangePercent24h float64 `json:"changePercent24h"`
	Volume24h        float64 `json:"volume24h"`
	High24h          float64 `json:"high24h"`
	Low24h           float64 `json:"low24h"`
	Open24h          float64 `json:"open24h"`
}

type Order struct {
	ID             string      `json:"id"`
	UserID         string      `json:"userId"`
	Symbol         string      `json:"symbol"`
	Side           OrderSide   `json:"side"`
	Type           OrderType   `json:"type"`
	Status         OrderStatus `json:"status"`
	Quantity       float64     `json:"quantity"`
	Price          float64     `json:"price"`
	StopPrice      float64     `json:"stopPrice,omitempty"`
	FilledQuantity float64     `json:"filledQuantity"`
	AveragePrice   float64     `json:"averagePrice"`
	CreatedAt      time.Time   `json:"createdAt"`
	UpdatedAt      time.Time   `json:"updatedAt"`
}

type Trade struct {
	ID               string           `json:"id"`
	OrderID          string           `json:"orderId"`
	UserID           string           `json:"userId"`
	Symbol           string           `json:"symbol"`
	Side             OrderSide        `json:"side"`
	Price            float64          `json:"price"`
	Quantity         float64          `json:"quantity"`
	Fee              float64          `json:"fee"`
	Timestamp        time.Time        `json:"timestamp"`
	SettlementStatus SettlementStatus `json:"settlementStatus"`
}

type Position struct {
	ID                   string    `json:"id"`
	UserID               string    `json:"userId"`
	Symbol               string    `json:"symbol"`
	Side                 OrderSide `json:"side"`
	Quantity             float64   `json:"quantity"`
	AverageEntryPrice    float64   `json:"averageEntryPrice"`
	CurrentPrice         float64   `json:"currentPrice"`
	UnrealizedPnl        float64   `json:"unrealizedPnl"`
	UnrealizedPnlPercent float64   `json:"unrealizedPnlPercent"`
	RealizedPnl          float64   `json:"realizedPnl"`
	Margin               float64   `json:"margin"`
	LiquidationPrice     float64   `json:"liquidationPrice"`
}

type PortfolioSummary struct {
	TotalValue       float64    `json:"totalValue"`
	TotalPnl         float64    `json:"totalPnl"`
	TotalPnlPercent  float64    `json:"totalPnlPercent"`
	AvailableBalance float64    `json:"availableBalance"`
	MarginUsed       float64    `json:"marginUsed"`
	MarginAvailable  float64    `json:"marginAvailable"`
	Positions        []Position `json:"positions"`
}

type PriceAlert struct {
	ID          string         `json:"id"`
	UserID      string         `json:"userId"`
	Symbol      string         `json:"symbol"`
	Condition   AlertCondition `json:"condition"`
	TargetPrice float64        `json:"targetPrice"`
	Active      bool           `json:"active"`
	CreatedAt   time.Time      `json:"createdAt"`
	UpdatedAt   time.Time      `json:"updatedAt"`
}

type User struct {
	ID          string      `json:"id"`
	Email       string      `json:"email"`
	Name        string      `json:"name"`
	AccountTier AccountTier `json:"accountTier"`
	KYCStatus   KYCStatus   `json:"kycStatus"`
	Phone       string      `json:"phone,omitempty"`
	Country     string      `json:"country,omitempty"`
	CreatedAt   time.Time   `json:"createdAt"`
}

type Session struct {
	ID        string    `json:"id"`
	UserID    string    `json:"userId"`
	Device    string    `json:"device"`
	Location  string    `json:"location"`
	IP        string    `json:"ip"`
	Active    bool      `json:"active"`
	CreatedAt time.Time `json:"createdAt"`
	LastSeen  time.Time `json:"lastSeen"`
}

type UserPreferences struct {
	UserID              string `json:"userId"`
	OrderFilled         bool   `json:"orderFilled"`
	PriceAlerts         bool   `json:"priceAlerts"`
	MarginWarnings      bool   `json:"marginWarnings"`
	MarketNews          bool   `json:"marketNews"`
	SettlementUpdates   bool   `json:"settlementUpdates"`
	SystemMaintenance   bool   `json:"systemMaintenance"`
	EmailNotifications  bool   `json:"emailNotifications"`
	SMSNotifications    bool   `json:"smsNotifications"`
	PushNotifications   bool   `json:"pushNotifications"`
	USSDNotifications   bool   `json:"ussdNotifications"`
	DefaultCurrency     string `json:"defaultCurrency"`
	TimeZone            string `json:"timeZone"`
	DefaultChartPeriod  string `json:"defaultChartPeriod"`
}

type Notification struct {
	ID        string    `json:"id"`
	UserID    string    `json:"userId"`
	Type      string    `json:"type"`
	Title     string    `json:"title"`
	Message   string    `json:"message"`
	Read      bool      `json:"read"`
	Timestamp time.Time `json:"timestamp"`
}

type OrderBookLevel struct {
	Price    float64 `json:"price"`
	Quantity float64 `json:"quantity"`
	Total    float64 `json:"total"`
}

type OrderBook struct {
	Symbol        string           `json:"symbol"`
	Bids          []OrderBookLevel `json:"bids"`
	Asks          []OrderBookLevel `json:"asks"`
	Spread        float64          `json:"spread"`
	SpreadPercent float64          `json:"spreadPercent"`
	LastUpdate    int64            `json:"lastUpdate"`
}

type OHLCVCandle struct {
	Time   int64   `json:"time"`
	Open   float64 `json:"open"`
	High   float64 `json:"high"`
	Low    float64 `json:"low"`
	Close  float64 `json:"close"`
	Volume float64 `json:"volume"`
}

type MarketTicker struct {
	Symbol           string  `json:"symbol"`
	LastPrice        float64 `json:"lastPrice"`
	Bid              float64 `json:"bid"`
	Ask              float64 `json:"ask"`
	Change24h        float64 `json:"change24h"`
	ChangePercent24h float64 `json:"changePercent24h"`
	Volume24h        float64 `json:"volume24h"`
	High24h          float64 `json:"high24h"`
	Low24h           float64 `json:"low24h"`
	Timestamp        int64   `json:"timestamp"`
}

// ============================================================
// Request/Response types
// ============================================================

type CreateOrderRequest struct {
	Symbol    string    `json:"symbol" binding:"required"`
	Side      OrderSide `json:"side" binding:"required"`
	Type      OrderType `json:"type" binding:"required"`
	Quantity  float64   `json:"quantity" binding:"required,gt=0"`
	Price     float64   `json:"price,omitempty"`
	StopPrice float64   `json:"stopPrice,omitempty"`
}

type CreateAlertRequest struct {
	Symbol      string         `json:"symbol" binding:"required"`
	Condition   AlertCondition `json:"condition" binding:"required"`
	TargetPrice float64        `json:"targetPrice" binding:"required,gt=0"`
}

type UpdateAlertRequest struct {
	Active *bool `json:"active,omitempty"`
}

type UpdateProfileRequest struct {
	Name    string `json:"name,omitempty"`
	Phone   string `json:"phone,omitempty"`
	Country string `json:"country,omitempty"`
}

type UpdatePreferencesRequest struct {
	OrderFilled         *bool   `json:"orderFilled,omitempty"`
	PriceAlerts         *bool   `json:"priceAlerts,omitempty"`
	MarginWarnings      *bool   `json:"marginWarnings,omitempty"`
	MarketNews          *bool   `json:"marketNews,omitempty"`
	SettlementUpdates   *bool   `json:"settlementUpdates,omitempty"`
	SystemMaintenance   *bool   `json:"systemMaintenance,omitempty"`
	EmailNotifications  *bool   `json:"emailNotifications,omitempty"`
	SMSNotifications    *bool   `json:"smsNotifications,omitempty"`
	PushNotifications   *bool   `json:"pushNotifications,omitempty"`
	USSDNotifications   *bool   `json:"ussdNotifications,omitempty"`
	DefaultCurrency     *string `json:"defaultCurrency,omitempty"`
	TimeZone            *string `json:"timeZone,omitempty"`
	DefaultChartPeriod  *string `json:"defaultChartPeriod,omitempty"`
}

type ChangePasswordRequest struct {
	CurrentPassword string `json:"currentPassword" binding:"required"`
	NewPassword     string `json:"newPassword" binding:"required,min=8"`
}

type LoginRequest struct {
	Email    string `json:"email" binding:"required,email"`
	Password string `json:"password" binding:"required"`
}

type LoginResponse struct {
	AccessToken  string `json:"accessToken"`
	RefreshToken string `json:"refreshToken"`
	IDToken      string `json:"idToken"`
	ExpiresIn    int    `json:"expiresIn"`
	TokenType    string `json:"tokenType"`
}

type RefreshRequest struct {
	RefreshToken string `json:"refreshToken" binding:"required"`
}

type APIResponse struct {
	Success bool        `json:"success"`
	Data    interface{} `json:"data,omitempty"`
	Error   string      `json:"error,omitempty"`
	Meta    interface{} `json:"meta,omitempty"`
}

type PaginationMeta struct {
	Total  int `json:"total"`
	Page   int `json:"page"`
	Limit  int `json:"limit"`
	Pages  int `json:"pages"`
}

// Kafka event types
type OrderEvent struct {
	EventType string `json:"eventType"`
	Order     Order  `json:"order"`
	Timestamp int64  `json:"timestamp"`
}

type TradeEvent struct {
	EventType string `json:"eventType"`
	Trade     Trade  `json:"trade"`
	Timestamp int64  `json:"timestamp"`
}

type MarketDataEvent struct {
	EventType string       `json:"eventType"`
	Ticker    MarketTicker `json:"ticker"`
	Timestamp int64        `json:"timestamp"`
}

// TigerBeetle transfer
type LedgerTransfer struct {
	ID              string  `json:"id"`
	DebitAccountID  string  `json:"debitAccountId"`
	CreditAccountID string  `json:"creditAccountId"`
	Amount          float64 `json:"amount"`
	Currency        string  `json:"currency"`
	Reference       string  `json:"reference"`
	Status          string  `json:"status"`
}

// Temporal workflow
type OrderWorkflowInput struct {
	OrderID string `json:"orderId"`
	UserID  string `json:"userId"`
	Symbol  string `json:"symbol"`
	Side    string `json:"side"`
	Type    string `json:"type"`
	Price   float64 `json:"price"`
	Qty     float64 `json:"quantity"`
}

type SettlementWorkflowInput struct {
	TradeID  string  `json:"tradeId"`
	BuyerID  string  `json:"buyerId"`
	SellerID string  `json:"sellerId"`
	Amount   float64 `json:"amount"`
	Symbol   string  `json:"symbol"`
}

// ============================================================
// Account & Audit Log Models (Improvement #18)
// ============================================================

type Account struct {
	ID        string      `json:"id"`
	UserID    string      `json:"userId"`
	Type      string      `json:"type"`
	Currency  string      `json:"currency"`
	Balance   float64     `json:"balance"`
	Available float64     `json:"available"`
	Locked    float64     `json:"locked"`
	Status    string      `json:"status"`
	Tier      AccountTier `json:"tier"`
	CreatedAt time.Time   `json:"createdAt"`
	UpdatedAt time.Time   `json:"updatedAt"`
}

type CreateAccountRequest struct {
	UserID   string `json:"userId" binding:"required"`
	Type     string `json:"type" binding:"required"`
	Currency string `json:"currency" binding:"required"`
}

type UpdateAccountRequest struct {
	Status *string  `json:"status,omitempty"`
	Tier   *string  `json:"tier,omitempty"`
}

type AuditEntry struct {
	ID        string    `json:"id"`
	UserID    string    `json:"userId"`
	Action    string    `json:"action"`
	Resource  string    `json:"resource"`
	Details   string    `json:"details"`
	IP        string    `json:"ip"`
	Timestamp time.Time `json:"timestamp"`
}
