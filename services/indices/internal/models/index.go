package models

import "time"

// IndexCategory represents the category of a commodity index
type IndexCategory string

const (
	CategoryGrain     IndexCategory = "GRAIN"
	CategoryOilseed   IndexCategory = "OILSEED"
	CategoryCashCrop  IndexCategory = "CASH_CROP"
	CategoryLivestock IndexCategory = "LIVESTOCK"
	CategoryComposite IndexCategory = "COMPOSITE"
)

// IndexMethodology defines how an index is calculated
type IndexMethodology string

const (
	MethodologyPriceWeighted  IndexMethodology = "PRICE_WEIGHTED"
	MethodologyValueWeighted  IndexMethodology = "VALUE_WEIGHTED"
	MethodologyEqualWeighted  IndexMethodology = "EQUAL_WEIGHTED"
	MethodologyGeometric      IndexMethodology = "GEOMETRIC_MEAN"
	MethodologyLaspeyres      IndexMethodology = "LASPEYRES"
	MethodologyPaasche        IndexMethodology = "PAASCHE"
	MethodologyFisher         IndexMethodology = "FISHER_IDEAL"
)

// CommodityIndex represents a named commodity price index
type CommodityIndex struct {
	ID           string           `json:"id" db:"id"`
	Name         string           `json:"name" db:"name"`
	Description  string           `json:"description" db:"description"`
	Category     IndexCategory    `json:"category" db:"category"`
	Methodology  IndexMethodology `json:"methodology" db:"methodology"`
	Currency     string           `json:"currency" db:"currency"`
	BaseDate     time.Time        `json:"base_date" db:"base_date"`
	BaseValue    float64          `json:"base_value" db:"base_value"`
	Components   []IndexComponent `json:"components"`
	CurrentValue float64          `json:"current_value"`
	Change       float64          `json:"change"`
	ChangePercent float64         `json:"change_percent"`
	High         float64          `json:"high"`
	Low          float64          `json:"low"`
	Open         float64          `json:"open"`
	Timestamp    time.Time        `json:"timestamp"`
	IsActive     bool             `json:"is_active" db:"is_active"`
}

// IndexComponent represents a single commodity in an index
type IndexComponent struct {
	Symbol     string  `json:"symbol" db:"symbol"`
	Name       string  `json:"name" db:"name"`
	Weight     float64 `json:"weight" db:"weight"`
	BasePrice  float64 `json:"base_price" db:"base_price"`
	LastPrice  float64 `json:"last_price"`
	Quantity   float64 `json:"quantity" db:"quantity"` // for value-weighted
}

// CommodityPrice represents the current market price of a commodity
type CommodityPrice struct {
	Symbol        string    `json:"symbol" db:"symbol"`
	Name          string    `json:"name" db:"name"`
	Price         float64   `json:"price" db:"price"`
	Bid           float64   `json:"bid" db:"bid"`
	Ask           float64   `json:"ask" db:"ask"`
	High          float64   `json:"high" db:"high"`
	Low           float64   `json:"low" db:"low"`
	Open          float64   `json:"open" db:"open"`
	Close         float64   `json:"close" db:"close"`
	Change        float64   `json:"change"`
	ChangePercent float64   `json:"change_percent"`
	Volume        float64   `json:"volume" db:"volume"`
	Currency      string    `json:"currency" db:"currency"`
	Unit          string    `json:"unit" db:"unit"`
	Exchange      string    `json:"exchange" db:"exchange"`
	QualityGrade  string    `json:"quality_grade" db:"quality_grade"`
	Timestamp     time.Time `json:"timestamp" db:"timestamp"`
}

// HistoricalDataPoint represents a single OHLCV data point
type HistoricalDataPoint struct {
	Timestamp time.Time `json:"timestamp" db:"timestamp"`
	Open      float64   `json:"open" db:"open"`
	High      float64   `json:"high" db:"high"`
	Low       float64   `json:"low" db:"low"`
	Close     float64   `json:"close" db:"close"`
	Volume    float64   `json:"volume" db:"volume"`
}

// MarketSummary represents a summary of market activity
type MarketSummary struct {
	Items     []MarketSummaryItem `json:"items"`
	Gainers   int                 `json:"gainers"`
	Losers    int                 `json:"losers"`
	Unchanged int                 `json:"unchanged"`
	Timestamp time.Time           `json:"timestamp"`
}

// MarketSummaryItem represents a single item in the market summary
type MarketSummaryItem struct {
	Symbol        string  `json:"symbol"`
	Name          string  `json:"name"`
	Price         float64 `json:"price"`
	ChangePercent float64 `json:"change_percent"`
	Volume        float64 `json:"volume"`
	Trend         string  `json:"trend"` // "UP", "DOWN", "FLAT"
}

// PredefinedIndices contains the standard NEXCOM commodity indices
var PredefinedIndices = []CommodityIndex{
	{
		ID:          "NAXI",
		Name:        "NEXCOM Agri Index",
		Description: "Composite index tracking 15 major agricultural commodities traded on NEXCOM Exchange",
		Category:    CategoryComposite,
		Methodology: MethodologyValueWeighted,
		Currency:    "NGN",
		BaseValue:   10000,
		IsActive:    true,
		Components: []IndexComponent{
			{Symbol: "MAIZE", Name: "White Maize", Weight: 0.20},
			{Symbol: "SOYBEAN", Name: "Soybean", Weight: 0.15},
			{Symbol: "SORGHUM", Name: "Sorghum", Weight: 0.12},
			{Symbol: "COCOA", Name: "Cocoa Beans", Weight: 0.10},
			{Symbol: "SESAME", Name: "Sesame Seeds", Weight: 0.08},
			{Symbol: "CASHEW", Name: "Cashew Nuts", Weight: 0.08},
			{Symbol: "COTTON", Name: "Cotton Lint", Weight: 0.07},
			{Symbol: "GROUNDNUT", Name: "Groundnut", Weight: 0.07},
			{Symbol: "RICE", Name: "Paddy Rice", Weight: 0.06},
			{Symbol: "WHEAT", Name: "Wheat", Weight: 0.05},
			{Symbol: "MILLET", Name: "Pearl Millet", Weight: 0.02},
		},
	},
	{
		ID:          "NGGI",
		Name:        "Nigeria Grain Index",
		Description: "Price-weighted index of major grain commodities in Nigeria",
		Category:    CategoryGrain,
		Methodology: MethodologyPriceWeighted,
		Currency:    "NGN",
		BaseValue:   5000,
		IsActive:    true,
		Components: []IndexComponent{
			{Symbol: "MAIZE", Name: "White Maize", Weight: 0.35},
			{Symbol: "SORGHUM", Name: "Sorghum", Weight: 0.25},
			{Symbol: "RICE", Name: "Paddy Rice", Weight: 0.20},
			{Symbol: "WHEAT", Name: "Wheat", Weight: 0.12},
			{Symbol: "MILLET", Name: "Pearl Millet", Weight: 0.08},
		},
	},
	{
		ID:          "AOXI",
		Name:        "Africa Oilseed Index",
		Description: "Equal-weighted index of oilseed commodities across Sub-Saharan Africa",
		Category:    CategoryOilseed,
		Methodology: MethodologyEqualWeighted,
		Currency:    "USD",
		BaseValue:   1000,
		IsActive:    true,
		Components: []IndexComponent{
			{Symbol: "SOYBEAN", Name: "Soybean", Weight: 0.25},
			{Symbol: "SESAME", Name: "Sesame Seeds", Weight: 0.25},
			{Symbol: "GROUNDNUT", Name: "Groundnut", Weight: 0.25},
			{Symbol: "SUNFLOWER", Name: "Sunflower Seed", Weight: 0.25},
		},
	},
	{
		ID:          "WACCI",
		Name:        "West Africa Cash Crop Index",
		Description: "Value-weighted index of cash crops in West Africa",
		Category:    CategoryCashCrop,
		Methodology: MethodologyValueWeighted,
		Currency:    "USD",
		BaseValue:   2000,
		IsActive:    true,
		Components: []IndexComponent{
			{Symbol: "COCOA", Name: "Cocoa Beans", Weight: 0.40},
			{Symbol: "CASHEW", Name: "Cashew Nuts", Weight: 0.25},
			{Symbol: "COTTON", Name: "Cotton Lint", Weight: 0.20},
			{Symbol: "COFFEE", Name: "Arabica Coffee", Weight: 0.15},
		},
	},
}
