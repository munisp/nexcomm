"""
Gold Layer — Business-ready analytics and ML Feature Store.

The Gold layer contains aggregated, business-ready data and the ML feature
store. All tables are optimized for analytical queries via DataFusion and
ML model consumption via Ray.

Sub-layers:
  1. Analytics: Trading analytics, market statistics, P&L reports
  2. Risk Reports: Regulatory and internal risk reports
  3. Regulatory Reports: CMA, EMIR, large trader, COT reports
  4. ML Feature Store: Price, volume, sentiment, geospatial, risk features
  5. Data Quality: DQ check results and reconciliation

Feature Store Design:
  - Point-in-time correct: Features are computed as of a specific timestamp
    to prevent lookahead bias in backtesting
  - Versioned: Each feature computation is versioned via Delta Lake
  - Partitioned: By (date, symbol) for fast lookup
  - Documented: Each feature has description, computation logic, update frequency
"""

import logging
from datetime import datetime, timezone

logger = logging.getLogger("ingestion-engine.gold")


class FeatureDefinition:
    """Defines a single ML feature in the feature store."""

    def __init__(
        self,
        name: str,
        description: str,
        computation: str,
        update_frequency: str,
        source_tables: list[str],
        data_type: str = "float64",
    ):
        self.name = name
        self.description = description
        self.computation = computation
        self.update_frequency = update_frequency
        self.source_tables = source_tables
        self.data_type = data_type

    def to_dict(self) -> dict:
        return {
            "name": self.name,
            "description": self.description,
            "computation": self.computation,
            "update_frequency": self.update_frequency,
            "source_tables": self.source_tables,
            "data_type": self.data_type,
        }


class GoldLayerManager:
    """Manages the Gold (business-ready) layer and ML Feature Store."""

    def __init__(self, base_path: str):
        self.base_path = base_path
        self._feature_store: dict[str, list[FeatureDefinition]] = {}
        self._initialize_feature_store()
        logger.info(f"Gold layer initialized at {base_path}")

    def _initialize_feature_store(self):
        """Define all ML features organized by category."""

        # ── Price Features ───────────────────────────────────────────
        self._feature_store["price_features"] = [
            FeatureDefinition("return_1d", "1-day log return", "ln(close_t / close_{t-1})", "1h", ["silver.ohlcv"]),
            FeatureDefinition("return_5d", "5-day log return", "ln(close_t / close_{t-5})", "1h", ["silver.ohlcv"]),
            FeatureDefinition("return_20d", "20-day log return", "ln(close_t / close_{t-20})", "1h", ["silver.ohlcv"]),
            FeatureDefinition("volatility_realized_20d", "20-day realized volatility", "std(return_1d, window=20) * sqrt(252)", "1h", ["silver.ohlcv"]),
            FeatureDefinition("volatility_realized_60d", "60-day realized volatility", "std(return_1d, window=60) * sqrt(252)", "1h", ["silver.ohlcv"]),
            FeatureDefinition("volatility_implied", "Implied volatility from options", "Black-76 implied vol", "1h", ["silver.market_data"]),
            FeatureDefinition("ma_5", "5-period simple moving average", "mean(close, window=5)", "1h", ["silver.ohlcv"]),
            FeatureDefinition("ma_10", "10-period simple moving average", "mean(close, window=10)", "1h", ["silver.ohlcv"]),
            FeatureDefinition("ma_20", "20-period simple moving average", "mean(close, window=20)", "1h", ["silver.ohlcv"]),
            FeatureDefinition("ma_50", "50-period simple moving average", "mean(close, window=50)", "1h", ["silver.ohlcv"]),
            FeatureDefinition("ma_200", "200-period simple moving average", "mean(close, window=200)", "1d", ["silver.ohlcv"]),
            FeatureDefinition("ema_12", "12-period exponential moving average", "ema(close, span=12)", "1h", ["silver.ohlcv"]),
            FeatureDefinition("ema_26", "26-period exponential moving average", "ema(close, span=26)", "1h", ["silver.ohlcv"]),
            FeatureDefinition("rsi_14", "14-period Relative Strength Index", "100 - 100/(1+RS)", "1h", ["silver.ohlcv"]),
            FeatureDefinition("macd", "MACD line", "ema_12 - ema_26", "1h", ["silver.ohlcv"]),
            FeatureDefinition("macd_signal", "MACD signal line", "ema(macd, span=9)", "1h", ["silver.ohlcv"]),
            FeatureDefinition("macd_histogram", "MACD histogram", "macd - macd_signal", "1h", ["silver.ohlcv"]),
            FeatureDefinition("bollinger_upper", "Upper Bollinger Band", "ma_20 + 2*std(close, 20)", "1h", ["silver.ohlcv"]),
            FeatureDefinition("bollinger_lower", "Lower Bollinger Band", "ma_20 - 2*std(close, 20)", "1h", ["silver.ohlcv"]),
            FeatureDefinition("atr_14", "14-period Average True Range", "ema(true_range, 14)", "1h", ["silver.ohlcv"]),
            FeatureDefinition("basis_vs_cme", "Basis vs CME reference price", "nexcom_price - cme_price", "1h", ["silver.ohlcv", "silver.market_data"]),
            FeatureDefinition("calendar_spread", "Front-back month spread", "front_close - back_close", "1h", ["silver.ohlcv"]),
        ]

        # ── Volume Features ──────────────────────────────────────────
        self._feature_store["volume_features"] = [
            FeatureDefinition("vwap", "Volume Weighted Average Price", "sum(price*volume) / sum(volume)", "5m", ["silver.trades"]),
            FeatureDefinition("volume_1h", "1-hour volume", "sum(quantity, window=1h)", "5m", ["silver.trades"]),
            FeatureDefinition("volume_24h", "24-hour volume", "sum(quantity, window=24h)", "5m", ["silver.trades"]),
            FeatureDefinition("volume_ratio", "Volume vs 20d average", "volume_1h / mean(volume_1h, 20d)", "1h", ["silver.trades"]),
            FeatureDefinition("trade_count_1h", "Hourly trade count", "count(trades, window=1h)", "5m", ["silver.trades"]),
            FeatureDefinition("notional_volume_usd", "Notional volume in USD", "sum(price * qty * multiplier)", "1h", ["silver.trades"]),
            FeatureDefinition("open_interest", "Open interest (futures)", "sum(long_positions)", "1h", ["silver.positions"]),
            FeatureDefinition("open_interest_change", "Change in open interest", "OI_t - OI_{t-1}", "1h", ["silver.positions"]),
            FeatureDefinition("buy_sell_ratio", "Buy/sell aggressor ratio", "count(buy_agg) / count(sell_agg)", "1h", ["silver.trades"]),
            FeatureDefinition("large_trade_pct", "% of volume from large trades", "vol(qty > 95th_pctile) / total_vol", "1h", ["silver.trades"]),
        ]

        # ── Sentiment Features ───────────────────────────────────────
        self._feature_store["sentiment_features"] = [
            FeatureDefinition("news_sentiment_24h", "24h rolling news sentiment", "mean(sentiment_score, window=24h)", "1h", ["silver.alternative"]),
            FeatureDefinition("news_sentiment_7d", "7-day rolling news sentiment", "mean(sentiment_score, window=7d)", "1h", ["silver.alternative"]),
            FeatureDefinition("social_sentiment_1h", "1h social media sentiment", "mean(sentiment_score, window=1h)", "15m", ["silver.alternative"]),
            FeatureDefinition("news_volume_24h", "24h news article count", "count(articles, window=24h)", "1h", ["silver.alternative"]),
            FeatureDefinition("social_buzz_ratio", "Social mention vs baseline", "mentions_1h / mean(mentions_1h, 30d)", "1h", ["silver.alternative"]),
            FeatureDefinition("cot_commercial_net", "COT commercial net position", "commercial_long - commercial_short", "weekly", ["silver.clearing"]),
            FeatureDefinition("cot_managed_money_net", "COT managed money net position", "mm_long - mm_short", "weekly", ["silver.clearing"]),
            FeatureDefinition("cot_change_commercial", "Week-over-week COT change", "net_t - net_{t-1}", "weekly", ["silver.clearing"]),
            FeatureDefinition("event_disruption_score", "Supply disruption event score", "weighted_sum(disruption_events)", "1h", ["silver.alternative"]),
            FeatureDefinition("policy_change_score", "Policy change impact score", "weighted_sum(policy_events)", "1h", ["silver.alternative"]),
        ]

        # ── Geospatial Features ──────────────────────────────────────
        self._feature_store["geospatial_features"] = [
            FeatureDefinition("ndvi_production_index", "NDVI-based crop production index", "mean(ndvi) over production_region", "daily", ["silver.alternative", "geospatial.production_regions"]),
            FeatureDefinition("ndvi_anomaly", "NDVI deviation from 5-year mean", "(ndvi - ndvi_5yr_mean) / ndvi_5yr_std", "daily", ["silver.alternative"]),
            FeatureDefinition("weather_impact_score", "Weather impact on production", "weighted(precip_anomaly, temp_anomaly)", "6h", ["silver.alternative", "geospatial.weather_grids"]),
            FeatureDefinition("drought_index", "Palmer Drought Severity Index proxy", "composite(precip, temp, soil_moisture)", "daily", ["silver.alternative"]),
            FeatureDefinition("shipping_congestion_index", "Port congestion score", "vessels_waiting / port_capacity", "1h", ["silver.alternative", "geospatial.port_locations"]),
            FeatureDefinition("shipping_ton_miles", "Commodity ton-miles in transit", "sum(cargo_mt * distance_nm) for active vessels", "1h", ["silver.alternative"]),
            FeatureDefinition("supply_chain_score", "Composite supply chain health", "weighted(port_throughput, shipping_time, warehouse_util)", "1h", ["silver.alternative", "geospatial.enriched"]),
            FeatureDefinition("warehouse_utilization", "Warehouse capacity utilization", "current_stock / total_capacity per warehouse", "1h", ["silver.iot_anomalies", "geospatial.warehouse_locations"]),
            FeatureDefinition("delivery_time_estimate", "Estimated delivery time (hours)", "ML model(origin, dest, current_traffic)", "1h", ["geospatial.enriched"]),
            FeatureDefinition("regional_production_forecast", "Seasonal production forecast", "ML model(ndvi, weather, historical_yield)", "daily", ["silver.alternative", "geospatial.production_regions"]),
        ]

        # ── Risk Features ────────────────────────────────────────────
        self._feature_store["risk_features"] = [
            FeatureDefinition("var_99_1d", "99% 1-day Value at Risk", "historical_sim(returns, 0.01)", "1h", ["silver.risk_metrics"]),
            FeatureDefinition("var_95_1d", "95% 1-day Value at Risk", "historical_sim(returns, 0.05)", "1h", ["silver.risk_metrics"]),
            FeatureDefinition("cvar_99", "Conditional VaR (Expected Shortfall)", "mean(losses | loss > VaR_99)", "1h", ["silver.risk_metrics"]),
            FeatureDefinition("margin_utilization", "Margin utilization ratio", "used_margin / total_collateral", "5m", ["silver.positions", "silver.clearing"]),
            FeatureDefinition("concentration_hhi", "Herfindahl–Hirschman Index", "sum(position_share^2)", "1h", ["silver.positions"]),
            FeatureDefinition("max_drawdown_20d", "20-day maximum drawdown", "max(peak - trough) / peak", "1h", ["silver.positions"]),
            FeatureDefinition("sharpe_ratio_20d", "20-day Sharpe ratio", "mean(excess_return) / std(return)", "1d", ["silver.positions"]),
            FeatureDefinition("leverage_ratio", "Portfolio leverage ratio", "gross_exposure / equity", "1h", ["silver.positions", "silver.clearing"]),
        ]

    def status(self) -> dict:
        total_features = sum(len(features) for features in self._feature_store.values())
        return {
            "status": "healthy",
            "base_path": self.base_path,
            "feature_categories": len(self._feature_store),
            "total_features": total_features,
            "categories": {
                cat: len(features) for cat, features in self._feature_store.items()
            },
        }

    def list_features(self, category: str | None = None) -> dict:
        if category and category in self._feature_store:
            return {
                category: [f.to_dict() for f in self._feature_store[category]]
            }
        return {
            cat: [f.to_dict() for f in features]
            for cat, features in self._feature_store.items()
        }

    def feature_count(self) -> int:
        return sum(len(features) for features in self._feature_store.values())
