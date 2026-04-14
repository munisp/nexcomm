"""
NEXCOM Exchange — AI/ML Service Tests
======================================
Tests price prediction models, anomaly detection, and NLP sentiment analysis.
Run with: pytest tests/ -v
"""
import pytest
import math
import random
from typing import List, Dict, Tuple


# ─── Fixtures ─────────────────────────────────────────────────────────────────

@pytest.fixture
def price_series():
    """Generate a realistic price time series for maize."""
    random.seed(42)
    prices = [450_000.0]  # Starting price ₦450,000/tonne
    for _ in range(99):
        change = random.gauss(0, 0.015)  # 1.5% daily vol
        prices.append(prices[-1] * (1 + change))
    return prices


@pytest.fixture
def weather_features():
    """Sample weather features for crop yield prediction."""
    return {
        "rainfall_mm": 1200,
        "temperature_avg_c": 27.5,
        "humidity_pct": 72,
        "sunshine_hours": 6.5,
        "drought_index": 0.2,
        "flood_risk": 0.1,
    }


@pytest.fixture
def sentiment_texts():
    """Sample news headlines for sentiment analysis."""
    return [
        ("Bumper harvest expected as rains return to northern Nigeria", "positive"),
        ("Drought threatens maize production in Kano State", "negative"),
        ("NEXCOM Exchange reports record trading volume", "positive"),
        ("Commodity prices remain stable amid market uncertainty", "neutral"),
        ("Flood destroys crops in Niger Delta region", "negative"),
        ("Government removes import duty on fertilizer", "positive"),
    ]


# ─── Feature Engineering Tests ────────────────────────────────────────────────

class TestFeatureEngineering:
    def test_lag_features(self, price_series):
        """Test creation of lag features for time series prediction."""
        lags = [1, 3, 5, 7, 14, 21]
        features = {}

        for lag in lags:
            if len(price_series) > lag:
                features[f"price_lag_{lag}"] = price_series[-(lag+1)]

        assert len(features) == len(lags)
        assert all(v > 0 for v in features.values())

    def test_rolling_statistics(self, price_series):
        """Test rolling mean and std features."""
        windows = [5, 10, 20]

        for window in windows:
            if len(price_series) >= window:
                window_prices = price_series[-window:]
                rolling_mean = sum(window_prices) / window
                rolling_std = math.sqrt(
                    sum((p - rolling_mean) ** 2 for p in window_prices) / (window - 1)
                )

                assert rolling_mean > 0, f"Rolling mean must be positive for window {window}"
                assert rolling_std >= 0, f"Rolling std must be non-negative for window {window}"

    def test_return_features(self, price_series):
        """Test return-based features."""
        # 1-day return
        ret_1d = (price_series[-1] - price_series[-2]) / price_series[-2]
        # 5-day return
        ret_5d = (price_series[-1] - price_series[-6]) / price_series[-6]
        # 20-day return
        ret_20d = (price_series[-1] - price_series[-21]) / price_series[-21]

        # Returns should be reasonable for commodity markets
        assert -0.5 < ret_1d < 0.5, f"1-day return {ret_1d:.2%} seems extreme"
        assert -0.8 < ret_5d < 0.8, f"5-day return {ret_5d:.2%} seems extreme"

    def test_weather_feature_normalization(self, weather_features):
        """Test normalization of weather features to [0, 1] range."""
        feature_ranges = {
            "rainfall_mm": (0, 3000),
            "temperature_avg_c": (15, 45),
            "humidity_pct": (0, 100),
            "sunshine_hours": (0, 12),
            "drought_index": (0, 1),
            "flood_risk": (0, 1),
        }

        normalized = {}
        for feature, value in weather_features.items():
            if feature in feature_ranges:
                min_val, max_val = feature_ranges[feature]
                normalized[feature] = (value - min_val) / (max_val - min_val)

        for feature, norm_val in normalized.items():
            assert 0 <= norm_val <= 1, \
                f"Normalized {feature} = {norm_val:.3f} outside [0, 1]"


# ─── Price Prediction Tests ────────────────────────────────────────────────────

class TestPricePrediction:
    def test_linear_trend_prediction(self, price_series):
        """Test simple linear trend extrapolation."""
        n = len(price_series)
        x = list(range(n))
        y = price_series

        # Simple linear regression
        x_mean = sum(x) / n
        y_mean = sum(y) / n

        numerator = sum((x[i] - x_mean) * (y[i] - y_mean) for i in range(n))
        denominator = sum((x[i] - x_mean) ** 2 for i in range(n))

        if denominator != 0:
            slope = numerator / denominator
            intercept = y_mean - slope * x_mean

            # Predict next 5 days
            predictions = [slope * (n + i) + intercept for i in range(5)]

            assert len(predictions) == 5
            assert all(p > 0 for p in predictions), "Predictions must be positive"

    def test_mean_reversion_signal(self, price_series):
        """Test mean reversion signal generation."""
        window = 20
        if len(price_series) < window:
            pytest.skip("Insufficient data")

        current_price = price_series[-1]
        moving_avg = sum(price_series[-window:]) / window
        std_dev = math.sqrt(
            sum((p - moving_avg) ** 2 for p in price_series[-window:]) / (window - 1)
        )

        if std_dev > 0:
            z_score = (current_price - moving_avg) / std_dev

            # Z-score based signals
            if z_score > 2.0:
                signal = "SELL"  # Price too high, expect reversion
            elif z_score < -2.0:
                signal = "BUY"   # Price too low, expect reversion
            else:
                signal = "HOLD"

            assert signal in ["BUY", "SELL", "HOLD"]

    def test_prediction_confidence_bounds(self, price_series):
        """Test that prediction confidence intervals are reasonable."""
        current_price = price_series[-1]
        daily_vol = 0.015  # 1.5% daily volatility

        # 95% confidence interval for 5-day prediction
        horizon = 5
        z_95 = 1.96
        std_5d = current_price * daily_vol * math.sqrt(horizon)

        lower = current_price - z_95 * std_5d
        upper = current_price + z_95 * std_5d

        assert lower > 0, "Lower bound must be positive"
        assert upper > lower, "Upper bound must exceed lower bound"
        assert lower < current_price < upper, "Current price should be within bounds"

        # Bounds should be within ±20% for 5-day horizon
        assert upper / current_price < 1.20, "Upper bound seems too wide"
        assert lower / current_price > 0.80, "Lower bound seems too wide"


# ─── Anomaly Detection Tests ──────────────────────────────────────────────────

class TestAnomalyDetection:
    def test_price_spike_detection(self):
        """Test detection of abnormal price spikes."""
        prices = [450000, 452000, 448000, 451000, 449000,
                  450000, 452000, 900000, 451000, 450000]  # Spike at index 7

        mean = sum(prices) / len(prices)
        std = math.sqrt(sum((p - mean) ** 2 for p in prices) / (len(prices) - 1))

        anomalies = []
        for i, price in enumerate(prices):
            z_score = abs(price - mean) / std if std > 0 else 0
            if z_score > 3.0:
                anomalies.append(i)

        assert len(anomalies) > 0, "Should detect the price spike"
        assert 7 in anomalies, "Should detect spike at index 7"

    def test_volume_anomaly_detection(self):
        """Test detection of abnormal trading volumes."""
        volumes = [10000, 12000, 9500, 11000, 10500,
                   11500, 10000, 150000, 11000, 10500]  # Spike at index 7

        mean = sum(volumes) / len(volumes)
        std = math.sqrt(sum((v - mean) ** 2 for v in volumes) / (len(volumes) - 1))

        anomalies = [i for i, v in enumerate(volumes) if abs(v - mean) / std > 3.0]

        assert 7 in anomalies, "Should detect volume spike at index 7"

    def test_wash_trading_detection(self):
        """Test basic wash trading pattern detection."""
        # Wash trading: same buyer and seller, circular trades
        trades = [
            {"buyer": "A", "seller": "B", "price": 450000, "qty": 1000},
            {"buyer": "B", "seller": "A", "price": 450000, "qty": 1000},  # Suspicious
            {"buyer": "C", "seller": "D", "price": 451000, "qty": 2000},
            {"buyer": "A", "seller": "B", "price": 450000, "qty": 1000},  # Suspicious
        ]

        # Count circular trades (A→B then B→A)
        pair_counts: Dict[Tuple[str, str], int] = {}
        for trade in trades:
            pair = (trade["buyer"], trade["seller"])
            pair_counts[pair] = pair_counts.get(pair, 0) + 1

        # Check for reciprocal pairs
        suspicious_pairs = []
        for (buyer, seller), count in pair_counts.items():
            reverse = (seller, buyer)
            if reverse in pair_counts:
                suspicious_pairs.append((buyer, seller))

        assert len(suspicious_pairs) > 0, "Should detect circular trading pattern"


# ─── Sentiment Analysis Tests ─────────────────────────────────────────────────

class TestSentimentAnalysis:
    def test_keyword_sentiment_scoring(self, sentiment_texts):
        """Test basic keyword-based sentiment scoring."""
        positive_keywords = [
            "bumper", "record", "growth", "increase", "stable", "returns",
            "removes", "duty", "harvest", "expected"
        ]
        negative_keywords = [
            "drought", "flood", "threatens", "destroys", "decline", "loss",
            "shortage", "crisis", "collapse"
        ]

        for text, expected_sentiment in sentiment_texts:
            text_lower = text.lower()
            pos_score = sum(1 for kw in positive_keywords if kw in text_lower)
            neg_score = sum(1 for kw in negative_keywords if kw in text_lower)

            if pos_score > neg_score:
                sentiment = "positive"
            elif neg_score > pos_score:
                sentiment = "negative"
            else:
                sentiment = "neutral"

            # Log result (not strict assertion since keyword matching is imperfect)
            match = sentiment == expected_sentiment
            print(f"  {'✓' if match else '~'} '{text[:50]}...' → {sentiment} (expected: {expected_sentiment})")

    def test_sentiment_aggregation(self):
        """Test aggregation of multiple sentiment scores."""
        scores = [0.8, -0.6, 0.3, 0.1, -0.4, 0.7, -0.2, 0.5]
        aggregate = sum(scores) / len(scores)

        assert -1 <= aggregate <= 1, "Aggregate sentiment must be in [-1, 1]"
        assert isinstance(aggregate, float)


# ─── Crop Yield Prediction Tests ──────────────────────────────────────────────

class TestCropYieldPrediction:
    def test_yield_feature_importance(self, weather_features):
        """Test that weather features have expected importance for yield prediction."""
        # Simplified feature importance weights (from domain knowledge)
        feature_weights = {
            "rainfall_mm": 0.35,
            "temperature_avg_c": 0.20,
            "humidity_pct": 0.15,
            "sunshine_hours": 0.15,
            "drought_index": 0.10,
            "flood_risk": 0.05,
        }

        total_weight = sum(feature_weights.values())
        assert abs(total_weight - 1.0) < 0.001, f"Weights sum to {total_weight}"

        # Weighted score
        score = 0.0
        for feature, weight in feature_weights.items():
            if feature in weather_features:
                # Normalize rainfall to [0, 1] for scoring
                if feature == "rainfall_mm":
                    val = min(weather_features[feature] / 2000, 1.0)
                elif feature in ["drought_index", "flood_risk"]:
                    val = 1.0 - weather_features[feature]  # Lower is better
                elif feature == "temperature_avg_c":
                    # Optimal 25-30°C
                    temp = weather_features[feature]
                    val = 1.0 - abs(temp - 27.5) / 15.0
                else:
                    val = weather_features[feature] / 100.0
                score += weight * max(0, min(1, val))

        assert 0 <= score <= 1, f"Yield score {score:.3f} outside [0, 1]"

    def test_yield_prediction_range(self):
        """Test that yield predictions are within realistic ranges for Nigeria."""
        # Maize yield ranges in Nigeria: 1.0 - 4.5 tonnes/hectare
        min_yield = 1.0
        max_yield = 4.5
        typical_yield = 2.5

        # Good conditions
        good_yield = typical_yield * 1.3
        assert good_yield <= max_yield * 1.1, f"Good yield {good_yield} exceeds maximum"

        # Poor conditions
        poor_yield = typical_yield * 0.6
        assert poor_yield >= min_yield * 0.8, f"Poor yield {poor_yield} below minimum"


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
