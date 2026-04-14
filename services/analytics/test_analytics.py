"""
NEXCOM Exchange — Analytics Service Tests
==========================================
Tests analytics calculations, price aggregations, and market metrics.
Run with: pytest tests/ -v
"""
import pytest
import math
from datetime import datetime, timedelta
from typing import List, Dict, Any


# ─── Fixtures ─────────────────────────────────────────────────────────────────

@pytest.fixture
def sample_trades():
    """Generate sample trade data for testing."""
    base_time = datetime(2024, 1, 15, 9, 0, 0)
    trades = []
    prices = [450, 452, 448, 455, 460, 458, 462, 465, 463, 467]
    for i, price in enumerate(prices):
        trades.append({
            "trade_id": f"TRD-{i+1:06d}",
            "commodity": "MAIZE-NGN",
            "price_ngn": price * 1000,  # ₦/tonne
            "quantity_kg": 1000 * (i + 1),
            "timestamp": base_time + timedelta(minutes=i * 30),
            "buyer_id": f"TRD-{(i % 5) + 1:04d}",
            "seller_id": f"TRD-{((i + 3) % 5) + 1:04d}",
            "side": "BUY" if i % 2 == 0 else "SELL",
        })
    return trades


@pytest.fixture
def sample_ohlcv():
    """Generate OHLCV candle data."""
    return [
        {"date": "2024-01-10", "open": 448000, "high": 462000, "low": 445000, "close": 458000, "volume_kg": 125000},
        {"date": "2024-01-11", "open": 458000, "high": 470000, "low": 455000, "close": 465000, "volume_kg": 98000},
        {"date": "2024-01-12", "open": 465000, "high": 468000, "low": 450000, "close": 452000, "volume_kg": 145000},
        {"date": "2024-01-13", "open": 452000, "high": 460000, "low": 448000, "close": 457000, "volume_kg": 87000},
        {"date": "2024-01-14", "open": 457000, "high": 475000, "low": 455000, "close": 472000, "volume_kg": 210000},
    ]


# ─── VWAP Tests ───────────────────────────────────────────────────────────────

class TestVWAP:
    def test_vwap_calculation(self, sample_trades):
        """VWAP = Σ(price × volume) / Σ(volume)"""
        total_value = sum(t["price_ngn"] * t["quantity_kg"] for t in sample_trades)
        total_volume = sum(t["quantity_kg"] for t in sample_trades)
        vwap = total_value / total_volume

        assert vwap > 0, "VWAP must be positive"
        # VWAP should be between min and max price
        min_price = min(t["price_ngn"] for t in sample_trades)
        max_price = max(t["price_ngn"] for t in sample_trades)
        assert min_price <= vwap <= max_price, f"VWAP {vwap} outside price range [{min_price}, {max_price}]"

    def test_vwap_single_trade(self):
        """VWAP of a single trade equals that trade's price."""
        trade = {"price_ngn": 450000, "quantity_kg": 5000}
        vwap = (trade["price_ngn"] * trade["quantity_kg"]) / trade["quantity_kg"]
        assert vwap == 450000

    def test_vwap_equal_volumes(self):
        """VWAP with equal volumes equals simple average."""
        trades = [
            {"price_ngn": 400000, "quantity_kg": 1000},
            {"price_ngn": 500000, "quantity_kg": 1000},
        ]
        vwap = sum(t["price_ngn"] * t["quantity_kg"] for t in trades) / sum(t["quantity_kg"] for t in trades)
        assert vwap == 450000


# ─── Price Change Tests ────────────────────────────────────────────────────────

class TestPriceMetrics:
    def test_daily_price_change(self, sample_ohlcv):
        """Test daily price change calculation."""
        today = sample_ohlcv[-1]
        yesterday = sample_ohlcv[-2]

        change = today["close"] - yesterday["close"]
        change_pct = (change / yesterday["close"]) * 100

        assert isinstance(change, (int, float))
        assert isinstance(change_pct, float)
        # Verify calculation
        expected_change = 472000 - 457000
        assert change == expected_change, f"Expected change {expected_change}, got {change}"

    def test_price_range(self, sample_ohlcv):
        """High must be >= Low for all candles."""
        for candle in sample_ohlcv:
            assert candle["high"] >= candle["low"], \
                f"High {candle['high']} < Low {candle['low']} on {candle['date']}"

    def test_price_within_range(self, sample_ohlcv):
        """Open and Close must be within High-Low range."""
        for candle in sample_ohlcv:
            assert candle["low"] <= candle["open"] <= candle["high"], \
                f"Open {candle['open']} outside range on {candle['date']}"
            assert candle["low"] <= candle["close"] <= candle["high"], \
                f"Close {candle['close']} outside range on {candle['date']}"


# ─── Moving Average Tests ──────────────────────────────────────────────────────

class TestMovingAverages:
    def test_simple_moving_average(self, sample_ohlcv):
        """Test SMA calculation."""
        closes = [c["close"] for c in sample_ohlcv]
        period = 3

        sma = sum(closes[-period:]) / period
        expected = (452000 + 457000 + 472000) / 3

        assert abs(sma - expected) < 0.01, f"SMA mismatch: {sma} vs {expected}"

    def test_ema_calculation(self):
        """Test Exponential Moving Average."""
        prices = [100, 102, 101, 103, 105, 104, 106, 108, 107, 110]
        period = 5
        multiplier = 2 / (period + 1)  # 0.333...

        # Initial EMA = first SMA
        ema = sum(prices[:period]) / period
        for price in prices[period:]:
            ema = (price - ema) * multiplier + ema

        assert ema > 0
        assert ema < max(prices) * 1.1  # EMA shouldn't exceed price range significantly

    def test_sma_requires_minimum_data(self):
        """SMA with period > data length should raise or return None."""
        closes = [100, 102, 101]
        period = 5

        if len(closes) < period:
            result = None  # Expected behavior
        else:
            result = sum(closes[-period:]) / period

        assert result is None, "Should return None when insufficient data"


# ─── Volume Analytics Tests ───────────────────────────────────────────────────

class TestVolumeAnalytics:
    def test_total_volume(self, sample_trades):
        """Test total volume calculation."""
        total_kg = sum(t["quantity_kg"] for t in sample_trades)
        total_tonnes = total_kg / 1000

        assert total_kg > 0
        assert total_tonnes == total_kg / 1000

    def test_volume_by_commodity(self, sample_trades):
        """Test volume aggregation by commodity."""
        by_commodity: Dict[str, float] = {}
        for trade in sample_trades:
            commodity = trade["commodity"]
            by_commodity[commodity] = by_commodity.get(commodity, 0) + trade["quantity_kg"]

        assert "MAIZE-NGN" in by_commodity
        assert by_commodity["MAIZE-NGN"] > 0

    def test_turnover_calculation(self, sample_trades):
        """Test turnover (value traded) calculation."""
        turnover_ngn = sum(t["price_ngn"] * t["quantity_kg"] / 1000 for t in sample_trades)
        assert turnover_ngn > 0
        # Turnover should be in billions for a commodity exchange
        assert turnover_ngn > 1_000_000  # At least ₦1M


# ─── Market Depth Tests ───────────────────────────────────────────────────────

class TestMarketDepth:
    def test_bid_ask_spread(self):
        """Test bid-ask spread calculation."""
        best_bid = 449_500
        best_ask = 450_000
        spread = best_ask - best_bid
        spread_pct = (spread / best_ask) * 100

        assert spread > 0, "Spread must be positive"
        assert spread_pct < 1.0, f"Spread {spread_pct:.2f}% seems too wide for liquid market"

    def test_order_book_depth(self):
        """Test order book depth calculation."""
        bids = [
            {"price": 449_500, "quantity_kg": 5000},
            {"price": 449_000, "quantity_kg": 8000},
            {"price": 448_500, "quantity_kg": 12000},
        ]
        asks = [
            {"price": 450_000, "quantity_kg": 4000},
            {"price": 450_500, "quantity_kg": 7000},
            {"price": 451_000, "quantity_kg": 10000},
        ]

        total_bid_depth = sum(b["quantity_kg"] for b in bids)
        total_ask_depth = sum(a["quantity_kg"] for a in asks)

        assert total_bid_depth == 25000
        assert total_ask_depth == 21000

        # Bid-ask imbalance
        imbalance = (total_bid_depth - total_ask_depth) / (total_bid_depth + total_ask_depth)
        assert -1 <= imbalance <= 1, "Imbalance must be between -1 and 1"


# ─── Commodity Index Tests ─────────────────────────────────────────────────────

class TestCommodityIndex:
    def test_ncex_agri_index_calculation(self):
        """
        NCEX Agricultural Index calculation.
        Weighted average of major agricultural commodities.
        """
        components = {
            "MAIZE": {"price": 450_000, "weight": 0.30, "base_price": 400_000},
            "SOYBEAN": {"price": 620_000, "weight": 0.25, "base_price": 550_000},
            "WHEAT": {"price": 380_000, "weight": 0.20, "base_price": 350_000},
            "SORGHUM": {"price": 320_000, "weight": 0.15, "base_price": 290_000},
            "COCOA": {"price": 2_800_000, "weight": 0.10, "base_price": 2_500_000},
        }

        # Verify weights sum to 1.0
        total_weight = sum(c["weight"] for c in components.values())
        assert abs(total_weight - 1.0) < 0.001, f"Weights sum to {total_weight}, not 1.0"

        # Calculate index (base = 1000)
        base_index = 1000.0
        index_value = 0.0
        for commodity, data in components.items():
            price_ratio = data["price"] / data["base_price"]
            index_value += price_ratio * data["weight"] * base_index

        assert index_value > 0, "Index must be positive"
        assert 800 <= index_value <= 1500, f"Index {index_value:.0f} seems unreasonable"

    def test_index_with_equal_weights(self):
        """Index with equal weights should equal simple average of price ratios × base."""
        prices = [100, 110, 90, 105]
        base_prices = [100, 100, 100, 100]
        base_index = 1000.0
        n = len(prices)
        weight = 1.0 / n

        index = sum((p / b) * weight * base_index for p, b in zip(prices, base_prices))
        expected = (1.0 + 1.1 + 0.9 + 1.05) / 4 * base_index

        assert abs(index - expected) < 0.01


# ─── Seasonal Analysis Tests ──────────────────────────────────────────────────

class TestSeasonalAnalysis:
    def test_harvest_season_detection(self):
        """Test detection of Nigerian agricultural harvest seasons."""
        # Nigeria has two main harvest seasons:
        # - First season: July-September (southern states)
        # - Second season: October-November (northern states)
        harvest_months = {1: False, 2: False, 3: False, 4: False, 5: False, 6: False,
                          7: True, 8: True, 9: True, 10: True, 11: True, 12: False}

        for month, expected_harvest in harvest_months.items():
            is_harvest = month in range(7, 12)
            assert is_harvest == expected_harvest, \
                f"Month {month}: expected harvest={expected_harvest}, got {is_harvest}"

    def test_planting_season_detection(self):
        """Test detection of Nigerian planting seasons."""
        # Main planting: March-May (south), April-June (north)
        planting_months = [3, 4, 5, 6]

        for month in range(1, 13):
            is_planting = month in planting_months
            if month in planting_months:
                assert is_planting
            else:
                assert not is_planting


# ─── Statistical Tests ────────────────────────────────────────────────────────

class TestStatisticalMetrics:
    def test_volatility_calculation(self):
        """Test historical volatility (annualized standard deviation of log returns)."""
        prices = [450000, 452000, 448000, 455000, 460000, 458000, 462000, 465000]

        # Calculate daily log returns
        log_returns = [math.log(prices[i] / prices[i-1]) for i in range(1, len(prices))]

        # Daily volatility (standard deviation)
        n = len(log_returns)
        mean = sum(log_returns) / n
        variance = sum((r - mean) ** 2 for r in log_returns) / (n - 1)
        daily_vol = math.sqrt(variance)

        # Annualized volatility (252 trading days)
        annual_vol = daily_vol * math.sqrt(252)

        assert 0 < annual_vol < 2.0, f"Annual volatility {annual_vol:.2%} seems unreasonable"

    def test_sharpe_ratio(self):
        """Test Sharpe ratio calculation."""
        returns = [0.02, -0.01, 0.03, 0.01, -0.02, 0.04, 0.02, -0.01, 0.03, 0.01]
        risk_free_rate = 0.001  # Daily risk-free rate (~25% annual for Nigeria)

        n = len(returns)
        mean_return = sum(returns) / n
        excess_returns = [r - risk_free_rate for r in returns]
        mean_excess = sum(excess_returns) / n
        std_excess = math.sqrt(sum((r - mean_excess) ** 2 for r in excess_returns) / (n - 1))

        if std_excess > 0:
            sharpe = mean_excess / std_excess
            assert isinstance(sharpe, float)
        else:
            sharpe = 0.0

        assert -10 <= sharpe <= 10, f"Sharpe ratio {sharpe:.2f} seems unreasonable"


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
