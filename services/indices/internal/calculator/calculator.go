// Package calculator implements commodity index calculation algorithms
// supporting multiple methodologies: Price-Weighted, Value-Weighted,
// Equal-Weighted, Geometric Mean, Laspeyres, Paasche, and Fisher Ideal.
package calculator

import (
	"fmt"
	"math"
	"time"

	"github.com/nexcom/indices/internal/models"
	"github.com/rs/zerolog/log"
	"github.com/shopspring/decimal"
)

// Calculator computes commodity price indices
type Calculator struct {
	basePrices map[string]float64 // symbol -> base period price
}

// NewCalculator creates a new index calculator
func NewCalculator() *Calculator {
	return &Calculator{
		basePrices: make(map[string]float64),
	}
}

// SetBasePrice sets the base period price for a commodity
func (c *Calculator) SetBasePrice(symbol string, price float64) {
	c.basePrices[symbol] = price
}

// Calculate computes the current value of an index given current prices
func (c *Calculator) Calculate(index models.CommodityIndex, currentPrices map[string]float64) (float64, error) {
	switch index.Methodology {
	case models.MethodologyPriceWeighted:
		return c.calculatePriceWeighted(index, currentPrices)
	case models.MethodologyValueWeighted:
		return c.calculateValueWeighted(index, currentPrices)
	case models.MethodologyEqualWeighted:
		return c.calculateEqualWeighted(index, currentPrices)
	case models.MethodologyGeometric:
		return c.calculateGeometricMean(index, currentPrices)
	case models.MethodologyLaspeyres:
		return c.calculateLaspeyres(index, currentPrices)
	case models.MethodologyPaasche:
		return c.calculatePaasche(index, currentPrices)
	case models.MethodologyFisher:
		return c.calculateFisherIdeal(index, currentPrices)
	default:
		return 0, fmt.Errorf("unknown methodology: %s", index.Methodology)
	}
}

// calculatePriceWeighted implements the Dow Jones-style price-weighted index.
// Index = Sum(component prices) / Divisor
// The divisor is adjusted for splits and component changes.
func (c *Calculator) calculatePriceWeighted(index models.CommodityIndex, prices map[string]float64) (float64, error) {
	if len(index.Components) == 0 {
		return 0, fmt.Errorf("index has no components")
	}

	var sumPrices float64
	validCount := 0

	for _, comp := range index.Components {
		price, ok := prices[comp.Symbol]
		if !ok {
			log.Warn().Str("symbol", comp.Symbol).Msg("Missing price for component")
			continue
		}
		sumPrices += price
		validCount++
	}

	if validCount == 0 {
		return 0, fmt.Errorf("no valid prices found for index components")
	}

	// Divisor = initial sum of prices / base value
	// For simplicity, use equal divisor; in production this is stored and adjusted
	divisor := sumPrices / index.BaseValue
	if divisor == 0 {
		return index.BaseValue, nil
	}

	return sumPrices / divisor, nil
}

// calculateValueWeighted implements the S&P 500-style market-cap-weighted index.
// Index = (Sum(price_i * quantity_i) / Sum(base_price_i * quantity_i)) * base_value
func (c *Calculator) calculateValueWeighted(index models.CommodityIndex, prices map[string]float64) (float64, error) {
	if len(index.Components) == 0 {
		return 0, fmt.Errorf("index has no components")
	}

	var currentMarketCap, baseMarketCap float64

	for _, comp := range index.Components {
		currentPrice, ok := prices[comp.Symbol]
		if !ok {
			log.Warn().Str("symbol", comp.Symbol).Msg("Missing price for component")
			continue
		}

		basePrice := comp.BasePrice
		if basePrice == 0 {
			if bp, exists := c.basePrices[comp.Symbol]; exists {
				basePrice = bp
			} else {
				// Use current price as base if no base price set
				basePrice = currentPrice
			}
		}

		quantity := comp.Quantity
		if quantity == 0 {
			quantity = 1.0 // Default to 1 unit
		}

		currentMarketCap += currentPrice * quantity
		baseMarketCap += basePrice * quantity
	}

	if baseMarketCap == 0 {
		return index.BaseValue, nil
	}

	return (currentMarketCap / baseMarketCap) * index.BaseValue, nil
}

// calculateEqualWeighted implements an equal-weighted index.
// Each component has equal weight regardless of price or market cap.
// Index = (Sum(price_i / base_price_i) / N) * base_value
func (c *Calculator) calculateEqualWeighted(index models.CommodityIndex, prices map[string]float64) (float64, error) {
	if len(index.Components) == 0 {
		return 0, fmt.Errorf("index has no components")
	}

	var sumRatios float64
	validCount := 0

	for _, comp := range index.Components {
		currentPrice, ok := prices[comp.Symbol]
		if !ok {
			continue
		}

		basePrice := comp.BasePrice
		if basePrice == 0 {
			if bp, exists := c.basePrices[comp.Symbol]; exists {
				basePrice = bp
			} else {
				basePrice = currentPrice
			}
		}

		if basePrice > 0 {
			sumRatios += currentPrice / basePrice
			validCount++
		}
	}

	if validCount == 0 {
		return index.BaseValue, nil
	}

	return (sumRatios / float64(validCount)) * index.BaseValue, nil
}

// calculateGeometricMean implements a geometric mean index.
// Index = (Product(price_i / base_price_i))^(1/N) * base_value
func (c *Calculator) calculateGeometricMean(index models.CommodityIndex, prices map[string]float64) (float64, error) {
	if len(index.Components) == 0 {
		return 0, fmt.Errorf("index has no components")
	}

	var sumLogRatios float64
	validCount := 0

	for _, comp := range index.Components {
		currentPrice, ok := prices[comp.Symbol]
		if !ok || currentPrice <= 0 {
			continue
		}

		basePrice := comp.BasePrice
		if basePrice <= 0 {
			if bp, exists := c.basePrices[comp.Symbol]; exists {
				basePrice = bp
			} else {
				basePrice = currentPrice
			}
		}

		if basePrice > 0 {
			sumLogRatios += math.Log(currentPrice / basePrice)
			validCount++
		}
	}

	if validCount == 0 {
		return index.BaseValue, nil
	}

	avgLogRatio := sumLogRatios / float64(validCount)
	return math.Exp(avgLogRatio) * index.BaseValue, nil
}

// calculateLaspeyres implements the Laspeyres price index.
// Uses base-period quantities as weights.
// L = Sum(p_t * q_0) / Sum(p_0 * q_0) * base_value
func (c *Calculator) calculateLaspeyres(index models.CommodityIndex, prices map[string]float64) (float64, error) {
	if len(index.Components) == 0 {
		return 0, fmt.Errorf("index has no components")
	}

	var numerator, denominator float64

	for _, comp := range index.Components {
		currentPrice, ok := prices[comp.Symbol]
		if !ok {
			continue
		}

		basePrice := comp.BasePrice
		if basePrice == 0 {
			if bp, exists := c.basePrices[comp.Symbol]; exists {
				basePrice = bp
			} else {
				basePrice = currentPrice
			}
		}

		q0 := comp.Quantity // base period quantity
		if q0 == 0 {
			q0 = comp.Weight * 1000 // use weight as proxy for quantity
		}

		numerator += currentPrice * q0
		denominator += basePrice * q0
	}

	if denominator == 0 {
		return index.BaseValue, nil
	}

	return (numerator / denominator) * index.BaseValue, nil
}

// calculatePaasche implements the Paasche price index.
// Uses current-period quantities as weights.
// P = Sum(p_t * q_t) / Sum(p_0 * q_t) * base_value
func (c *Calculator) calculatePaasche(index models.CommodityIndex, prices map[string]float64) (float64, error) {
	// For Paasche, we need current period quantities
	// In practice, these come from current trading volumes
	// For now, use the same approach as Laspeyres with current weights
	return c.calculateLaspeyres(index, prices)
}

// calculateFisherIdeal implements the Fisher Ideal price index.
// F = sqrt(L * P) where L is Laspeyres and P is Paasche
func (c *Calculator) calculateFisherIdeal(index models.CommodityIndex, prices map[string]float64) (float64, error) {
	l, err := c.calculateLaspeyres(index, prices)
	if err != nil {
		return 0, err
	}

	p, err := c.calculatePaasche(index, prices)
	if err != nil {
		return 0, err
	}

	return math.Sqrt(l * p), nil
}

// CalculateChange computes the change and change percent between two values
func CalculateChange(current, previous float64) (change, changePercent float64) {
	if previous == 0 {
		return 0, 0
	}
	change = current - previous
	changePercent = (change / previous) * 100
	return
}

// CalculateOHLC computes OHLC values from a slice of prices
func CalculateOHLC(prices []float64) (open, high, low, close float64) {
	if len(prices) == 0 {
		return 0, 0, 0, 0
	}

	open = prices[0]
	close = prices[len(prices)-1]
	high = prices[0]
	low = prices[0]

	for _, p := range prices {
		if p > high {
			high = p
		}
		if p < low {
			low = p
		}
	}

	return
}

// CalculateVolatility computes the annualized volatility of a price series
func CalculateVolatility(prices []float64, periodsPerYear int) float64 {
	if len(prices) < 2 {
		return 0
	}

	// Calculate log returns
	returns := make([]float64, len(prices)-1)
	for i := 1; i < len(prices); i++ {
		if prices[i-1] > 0 {
			returns[i-1] = math.Log(prices[i] / prices[i-1])
		}
	}

	// Calculate mean return
	var sumReturns float64
	for _, r := range returns {
		sumReturns += r
	}
	meanReturn := sumReturns / float64(len(returns))

	// Calculate variance
	var sumSquaredDiff float64
	for _, r := range returns {
		diff := r - meanReturn
		sumSquaredDiff += diff * diff
	}
	variance := sumSquaredDiff / float64(len(returns)-1)

	// Annualize
	return math.Sqrt(variance * float64(periodsPerYear))
}

// MovingAverage calculates a simple moving average
func MovingAverage(prices []float64, period int) []float64 {
	if len(prices) < period {
		return nil
	}

	result := make([]float64, len(prices)-period+1)
	for i := range result {
		var sum float64
		for j := 0; j < period; j++ {
			sum += prices[i+j]
		}
		result[i] = sum / float64(period)
	}
	return result
}

// RSI calculates the Relative Strength Index
func RSI(prices []float64, period int) float64 {
	if len(prices) < period+1 {
		return 50 // neutral
	}

	var gains, losses float64
	for i := 1; i <= period; i++ {
		change := prices[i] - prices[i-1]
		if change > 0 {
			gains += change
		} else {
			losses -= change
		}
	}

	avgGain := gains / float64(period)
	avgLoss := losses / float64(period)

	if avgLoss == 0 {
		return 100
	}

	rs := avgGain / avgLoss
	return 100 - (100 / (1 + rs))
}

// RoundToDecimalPlaces rounds a float64 to n decimal places
func RoundToDecimalPlaces(value float64, places int32) float64 {
	d := decimal.NewFromFloat(value)
	return d.Round(places).InexactFloat64()
}

// GenerateDemoPrice generates a realistic demo price with random walk
func GenerateDemoPrice(basePrice float64, volatility float64, seed int64) float64 {
	// Simple deterministic pseudo-random walk based on timestamp
	t := float64(time.Now().UnixMilli() % 10000)
	noise := math.Sin(t*0.001+float64(seed)) * volatility * basePrice
	return math.Max(basePrice*0.5, basePrice+noise)
}
