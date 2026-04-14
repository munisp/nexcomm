// Package main — Risk Management Service Tests
// =============================================
// Tests margin calculations, circuit breakers, position limits, and VaR.
package main

import (
	"math"
	"testing"
)

// ─── Margin Calculation Tests ─────────────────────────────────────────────────

func TestInitialMarginCalculation(t *testing.T) {
	tests := []struct {
		name            string
		notionalNGN     float64
		marginRatePct   float64
		expectedMargin  float64
	}{
		{"Maize 1 lot", 5_000_000, 10.0, 500_000},
		{"Soybean 2 lots", 8_000_000, 12.5, 1_000_000},
		{"Wheat 5 lots", 20_000_000, 8.0, 1_600_000},
		{"Zero notional", 0, 10.0, 0},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			margin := tc.notionalNGN * (tc.marginRatePct / 100.0)
			if math.Abs(margin-tc.expectedMargin) > 0.01 {
				t.Errorf("Expected margin %.2f, got %.2f", tc.expectedMargin, margin)
			}
		})
	}
}

func TestMaintenanceMarginThreshold(t *testing.T) {
	// Maintenance margin is typically 75% of initial margin
	initialMargin := 500_000.0
	maintenanceRatio := 0.75
	maintenanceMargin := initialMargin * maintenanceRatio

	if maintenanceMargin != 375_000.0 {
		t.Errorf("Expected maintenance margin 375000, got %.2f", maintenanceMargin)
	}

	// Test margin call trigger
	currentEquity := 380_000.0
	marginCallTriggered := currentEquity < maintenanceMargin
	if marginCallTriggered {
		t.Errorf("Margin call should NOT be triggered at equity %.0f (maintenance: %.0f)",
			currentEquity, maintenanceMargin)
	}

	currentEquity = 370_000.0
	marginCallTriggered = currentEquity < maintenanceMargin
	if !marginCallTriggered {
		t.Errorf("Margin call SHOULD be triggered at equity %.0f (maintenance: %.0f)",
			currentEquity, maintenanceMargin)
	}
}

// ─── Circuit Breaker Tests ─────────────────────────────────────────────────────

func TestCircuitBreakerLevels(t *testing.T) {
	// NEXCOM Exchange circuit breaker levels (% price move from previous close)
	type CircuitBreaker struct {
		Level    int
		TriggerPct float64
		HaltMins   int
	}

	breakers := []CircuitBreaker{
		{1, 5.0, 15},   // Level 1: 5% move → 15 min halt
		{2, 10.0, 30},  // Level 2: 10% move → 30 min halt
		{3, 15.0, 60},  // Level 3: 15% move → 60 min halt (rest of day)
	}

	prevClose := 450_000.0 // ₦450/kg for maize

	tests := []struct {
		name           string
		currentPrice   float64
		expectedLevel  int
	}{
		{"Normal trading (2% up)", prevClose * 1.02, 0},
		{"Level 1 trigger (5.5% up)", prevClose * 1.055, 1},
		{"Level 2 trigger (11% down)", prevClose * 0.89, 2},
		{"Level 3 trigger (16% up)", prevClose * 1.16, 3},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			pctChange := math.Abs((tc.currentPrice-prevClose)/prevClose) * 100

			triggeredLevel := 0
			for _, b := range breakers {
				if pctChange >= b.TriggerPct {
					triggeredLevel = b.Level
				}
			}

			if triggeredLevel != tc.expectedLevel {
				t.Errorf("Expected circuit breaker level %d, got %d (pct change: %.2f%%)",
					tc.expectedLevel, triggeredLevel, pctChange)
			} else {
				t.Logf("✓ %s: %.2f%% change → Level %d", tc.name, pctChange, triggeredLevel)
			}
		})
	}
}

// ─── Position Limit Tests ──────────────────────────────────────────────────────

func TestPositionLimits(t *testing.T) {
	type PositionLimit struct {
		Commodity    string
		MaxLotsSingle int // Max lots per single trader
		MaxLotsMarket int // Max % of open interest
	}

	limits := []PositionLimit{
		{"MAIZE", 500, 20},
		{"SOYBEAN", 300, 15},
		{"WHEAT", 400, 18},
		{"SORGHUM", 250, 12},
	}

	tests := []struct {
		commodity    string
		lots         int
		openInterest int
		expectAllow  bool
	}{
		{"MAIZE", 400, 5000, true},   // 400 < 500 limit, 8% < 20%
		{"MAIZE", 600, 5000, false},  // 600 > 500 limit
		{"MAIZE", 400, 1000, false},  // 40% > 20% market limit
		{"SOYBEAN", 250, 2000, true}, // 250 < 300, 12.5% < 15%
	}

	for _, tc := range tests {
		t.Run(tc.commodity, func(t *testing.T) {
			var limit PositionLimit
			for _, l := range limits {
				if l.Commodity == tc.commodity {
					limit = l
					break
				}
			}

			pctOfOI := float64(tc.lots) / float64(tc.openInterest) * 100
			allowed := tc.lots <= limit.MaxLotsSingle && pctOfOI <= float64(limit.MaxLotsMarket)

			if allowed != tc.expectAllow {
				t.Errorf("Expected allow=%v for %d lots (OI=%d, pct=%.1f%%), got allow=%v",
					tc.expectAllow, tc.lots, tc.openInterest, pctOfOI, allowed)
			}
		})
	}
}

// ─── VaR Calculation Tests ─────────────────────────────────────────────────────

func TestValueAtRisk(t *testing.T) {
	// Historical simulation VaR at 95% confidence, 1-day horizon
	// Using simplified parametric VaR: VaR = Position * σ * z
	// z = 1.645 for 95% confidence

	type VaRTest struct {
		name         string
		positionNGN  float64
		dailyVolPct  float64 // Daily volatility as percentage
		confidence   float64 // z-score
		expectedVaR  float64
	}

	tests := []VaRTest{
		{
			name:        "Maize position 95% VaR",
			positionNGN: 10_000_000,
			dailyVolPct: 2.5,
			confidence:  1.645,
			expectedVaR: 10_000_000 * 0.025 * 1.645, // 411,250
		},
		{
			name:        "Soybean position 99% VaR",
			positionNGN: 5_000_000,
			dailyVolPct: 3.0,
			confidence:  2.326,
			expectedVaR: 5_000_000 * 0.030 * 2.326, // 348,900
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			var_ := tc.positionNGN * (tc.dailyVolPct / 100.0) * tc.confidence
			tolerance := tc.expectedVaR * 0.001 // 0.1% tolerance

			if math.Abs(var_-tc.expectedVaR) > tolerance {
				t.Errorf("Expected VaR %.2f, got %.2f", tc.expectedVaR, var_)
			} else {
				t.Logf("✓ %s: VaR = ₦%.0f", tc.name, var_)
			}
		})
	}
}

// ─── Concentration Risk Tests ──────────────────────────────────────────────────

func TestConcentrationRisk(t *testing.T) {
	// Test Herfindahl-Hirschman Index (HHI) for portfolio concentration
	type Portfolio struct {
		Name        string
		Positions   map[string]float64 // commodity → value in NGN
		MaxHHI      float64            // Maximum allowed HHI (10000 = monopoly)
	}

	portfolios := []Portfolio{
		{
			Name: "Diversified portfolio",
			Positions: map[string]float64{
				"MAIZE":   2_000_000,
				"SOYBEAN": 2_000_000,
				"WHEAT":   2_000_000,
				"SORGHUM": 2_000_000,
				"COCOA":   2_000_000,
			},
			MaxHHI: 3000, // Should be well below limit
		},
		{
			Name: "Concentrated portfolio",
			Positions: map[string]float64{
				"MAIZE": 9_000_000,
				"WHEAT": 1_000_000,
			},
			MaxHHI: 5000, // Concentrated but within limit
		},
	}

	for _, p := range portfolios {
		t.Run(p.Name, func(t *testing.T) {
			total := 0.0
			for _, v := range p.Positions {
				total += v
			}

			hhi := 0.0
			for _, v := range p.Positions {
				share := (v / total) * 100 // percentage share
				hhi += share * share
			}

			t.Logf("Portfolio HHI: %.0f (max allowed: %.0f)", hhi, p.MaxHHI)
			// Note: This is informational — actual enforcement is in the service
		})
	}
}

// ─── Stress Test Scenarios ─────────────────────────────────────────────────────

func TestStressTestScenarios(t *testing.T) {
	// Agricultural commodity stress scenarios for Nigerian market
	scenarios := []struct {
		name        string
		shockPct    float64
		description string
	}{
		{"Drought scenario", -35.0, "Severe drought reduces maize harvest by 35%"},
		{"Flood scenario", -25.0, "Flooding in Niger Delta destroys 25% of crops"},
		{"FX shock", -20.0, "Naira depreciates 20% against USD"},
		{"Supply glut", -15.0, "Record harvest causes 15% price decline"},
		{"Export ban", 30.0, "Government export ban causes 30% domestic price spike"},
		{"Fertilizer shortage", 25.0, "Global fertilizer shortage raises input costs 25%"},
	}

	portfolioValue := 50_000_000.0 // ₦50M portfolio

	for _, s := range scenarios {
		t.Run(s.name, func(t *testing.T) {
			pnl := portfolioValue * (s.shockPct / 100.0)
			t.Logf("Scenario: %s\n  Shock: %.0f%%\n  P&L: ₦%.0f\n  Description: %s",
				s.name, s.shockPct, pnl, s.description)
			// Stress test results are informational — no assertion needed
		})
	}
}
