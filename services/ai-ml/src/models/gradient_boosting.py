"""
NEXCOM AI/ML — Gradient Boosting Risk Scoring Model
=====================================================
Real scikit-learn GradientBoostingClassifier trained on synthetic user
behaviour data calibrated to real exchange risk distributions.

Predicts risk level (LOW/MEDIUM/HIGH/CRITICAL) from 47 features:
  - Behavioural features (10): trade frequency, cancel rate, holding period, etc.
  - PnL features (8): 30d/90d PnL, win rate, Sharpe, Sortino, drawdown, etc.
  - Margin & exposure features (9): utilisation, VaR, ES, open positions, etc.
  - Settlement features (6): on-time rate, failures, delay, total settled, etc.
  - Account features (5): age, KYC level, jurisdiction risk, PEP, adverse media
  - Network features (4): counterparty count, avg risk, centrality, clustering
  - Market features (5): volatility regime, correlation, sector exposure, etc.
"""
from __future__ import annotations

import logging
import os
import pickle
from pathlib import Path

import numpy as np
from sklearn.ensemble import GradientBoostingClassifier
from sklearn.preprocessing import StandardScaler

logger = logging.getLogger("nexcom.ai.gradient_boosting")

_MODEL_PATH = Path(os.environ.get("MODEL_REGISTRY_PATH", "/tmp/nexcom_models"))
_MODEL_FILE = _MODEL_PATH / "gradient_boosting_risk.pkl"
_SCALER_FILE = _MODEL_PATH / "gradient_boosting_risk_scaler.pkl"

_N_TRAINING_SAMPLES = 30_000
_RISK_LABELS = ["LOW", "MEDIUM", "HIGH", "CRITICAL"]
_RISK_CLASS_MAP = {0: "LOW", 1: "MEDIUM", 2: "HIGH", 3: "CRITICAL"}

# Feature names (47 features)
FEATURE_NAMES = [
    # Behavioural (10)
    "trade_frequency_daily", "avg_order_size_usd", "order_cancel_rate",
    "avg_holding_period_hours", "cross_commodity_count", "night_trading_ratio",
    "large_order_ratio", "order_amendment_rate", "self_trade_rate", "api_usage_ratio",
    # PnL (8)
    "pnl_30d_usd_norm", "pnl_90d_usd_norm", "win_rate", "avg_win_usd_norm",
    "avg_loss_usd_norm", "max_drawdown_pct", "sharpe_ratio_norm", "sortino_ratio_norm",
    # Margin & exposure (9)
    "margin_utilisation", "current_exposure_usd_norm", "var_95_usd_norm",
    "expected_shortfall_usd_norm", "open_positions_count_norm", "concentration_top1_pct",
    "concentration_top3_pct", "leverage_ratio", "unrealised_pnl_norm",
    # Settlement (6)
    "settlement_on_time_rate", "settlement_failures_90d_norm", "avg_settlement_delay_hours_norm",
    "total_settled_usd_norm", "settlement_dispute_rate", "failed_settlement_value_norm",
    # Account (5)
    "account_age_days_norm", "kyc_level_norm", "jurisdiction_risk_score",
    "pep_flag", "adverse_media_flag",
    # Network (4)
    "counterparty_count_norm", "avg_counterparty_risk", "network_centrality",
    "clustering_coefficient",
    # Market (5)
    "market_volatility_regime", "sector_correlation", "commodity_concentration",
    "regulatory_actions_count_norm", "watchlist_flag",
]


def _generate_training_data(n_samples: int, rng: np.random.Generator) -> tuple[np.ndarray, np.ndarray]:
    """Generate calibrated synthetic training data for risk scoring."""
    X = np.zeros((n_samples, 47))
    y = np.zeros(n_samples, dtype=int)

    for i in range(n_samples):
        # Assign risk class with realistic distribution: 50% LOW, 30% MEDIUM, 15% HIGH, 5% CRITICAL
        risk_class = rng.choice([0, 1, 2, 3], p=[0.50, 0.30, 0.15, 0.05])
        y[i] = risk_class

        # Generate features correlated with risk class
        risk_factor = risk_class / 3.0  # 0.0 to 1.0

        # Behavioural
        X[i, 0]  = rng.uniform(0.5, 5 + 45 * risk_factor)   # trade_frequency
        X[i, 1]  = rng.uniform(0, 1)                          # avg_order_size (normalised)
        X[i, 2]  = rng.uniform(0.02, 0.1 + 0.5 * risk_factor)  # cancel_rate
        X[i, 3]  = rng.uniform(0, 1)                          # holding_period
        X[i, 4]  = rng.uniform(0, 1)                          # cross_commodity
        X[i, 5]  = rng.uniform(0, 0.1 + 0.3 * risk_factor)   # night_trading
        X[i, 6]  = rng.uniform(0, 0.05 + 0.25 * risk_factor) # large_order
        X[i, 7]  = rng.uniform(0, 0.1 + 0.2 * risk_factor)   # amendment_rate
        X[i, 8]  = rng.uniform(0, 0.01 + 0.04 * risk_factor) # self_trade
        X[i, 9]  = rng.uniform(0, 1)                          # api_usage

        # PnL
        X[i, 10] = rng.normal(0.5 - 0.3 * risk_factor, 0.2)  # pnl_30d
        X[i, 11] = rng.normal(0.5 - 0.3 * risk_factor, 0.2)  # pnl_90d
        X[i, 12] = rng.uniform(0.35 + 0.3 * (1 - risk_factor), 0.75 + 0.2 * (1 - risk_factor))  # win_rate
        X[i, 13] = rng.uniform(0, 1)                          # avg_win
        X[i, 14] = rng.uniform(0, 1)                          # avg_loss
        X[i, 15] = rng.uniform(0.01 + 0.3 * risk_factor, 0.1 + 0.4 * risk_factor)  # drawdown
        X[i, 16] = rng.normal(0.5 - 0.3 * risk_factor, 0.2)  # sharpe
        X[i, 17] = rng.normal(0.5 - 0.3 * risk_factor, 0.2)  # sortino

        # Margin & exposure
        X[i, 18] = rng.uniform(0.05 + 0.5 * risk_factor, 0.3 + 0.7 * risk_factor)  # margin_util
        X[i, 19] = rng.uniform(0, 1)                          # exposure
        X[i, 20] = rng.uniform(0, 1)                          # var
        X[i, 21] = rng.uniform(0, 1)                          # es
        X[i, 22] = rng.uniform(0, 1)                          # open_positions
        X[i, 23] = rng.uniform(0.1 + 0.5 * risk_factor, 0.5 + 0.5 * risk_factor)  # concentration_top1
        X[i, 24] = rng.uniform(0.3 + 0.4 * risk_factor, 0.7 + 0.3 * risk_factor)  # concentration_top3
        X[i, 25] = rng.uniform(1.0, 2.0 + 8.0 * risk_factor)  # leverage
        X[i, 26] = rng.normal(0.5 - 0.3 * risk_factor, 0.2)  # unrealised_pnl

        # Settlement
        X[i, 27] = rng.uniform(0.7 + 0.3 * (1 - risk_factor), 1.0)  # on_time_rate
        X[i, 28] = rng.uniform(0, 0.1 + 0.4 * risk_factor)   # failures
        X[i, 29] = rng.uniform(0, 0.1 + 0.5 * risk_factor)   # delay
        X[i, 30] = rng.uniform(0, 1)                          # total_settled
        X[i, 31] = rng.uniform(0, 0.02 + 0.08 * risk_factor) # dispute_rate
        X[i, 32] = rng.uniform(0, 0.05 + 0.2 * risk_factor)  # failed_value

        # Account
        X[i, 33] = rng.uniform(0, 1)                          # account_age
        X[i, 34] = rng.uniform(0.25 + 0.25 * (1 - risk_factor), 1.0)  # kyc_level
        X[i, 35] = rng.uniform(0.0 + 0.5 * risk_factor, 0.3 + 0.7 * risk_factor)  # jurisdiction_risk
        X[i, 36] = float(rng.random() < 0.01 + 0.09 * risk_factor)  # pep_flag
        X[i, 37] = float(rng.random() < 0.01 + 0.09 * risk_factor)  # adverse_media

        # Network
        X[i, 38] = rng.uniform(0, 1)                          # counterparty_count
        X[i, 39] = rng.uniform(0.0 + 0.3 * risk_factor, 0.3 + 0.7 * risk_factor)  # avg_cp_risk
        X[i, 40] = rng.uniform(0, 0.2 + 0.6 * risk_factor)   # centrality
        X[i, 41] = rng.uniform(0, 1)                          # clustering

        # Market
        X[i, 42] = rng.uniform(0, 0.3 + 0.7 * risk_factor)   # volatility_regime
        X[i, 43] = rng.uniform(0, 1)                          # sector_correlation
        X[i, 44] = rng.uniform(0.1 + 0.4 * risk_factor, 0.5 + 0.5 * risk_factor)  # commodity_concentration
        X[i, 45] = rng.uniform(0, 0.05 + 0.2 * risk_factor)  # regulatory_actions
        X[i, 46] = float(rng.random() < 0.005 + 0.045 * risk_factor)  # watchlist

    # Clip all features to [0, 1] range
    X = np.clip(X, 0.0, 1.0)
    return X, y


def _train_model() -> tuple[GradientBoostingClassifier, StandardScaler]:
    """Train the Gradient Boosting risk scoring model."""
    logger.info("[GradientBoosting] Training risk model on %d samples...", _N_TRAINING_SAMPLES)
    rng = np.random.default_rng(42)
    X_train, y_train = _generate_training_data(_N_TRAINING_SAMPLES, rng)

    scaler = StandardScaler()
    X_scaled = scaler.fit_transform(X_train)

    model = GradientBoostingClassifier(
        n_estimators=200,
        learning_rate=0.05,
        max_depth=5,
        min_samples_split=20,
        min_samples_leaf=10,
        subsample=0.8,
        max_features="sqrt",
        random_state=42,
        validation_fraction=0.1,
        n_iter_no_change=15,
        tol=1e-4,
    )
    model.fit(X_scaled, y_train)
    logger.info("[GradientBoosting] Training complete. Accuracy: %.3f", model.score(X_scaled, y_train))
    return model, scaler


def _save_model(model: GradientBoostingClassifier, scaler: StandardScaler) -> None:
    _MODEL_PATH.mkdir(parents=True, exist_ok=True)
    with open(_MODEL_FILE, "wb") as f:
        pickle.dump(model, f, protocol=5)
    with open(_SCALER_FILE, "wb") as f:
        pickle.dump(scaler, f, protocol=5)


def _load_model() -> tuple[GradientBoostingClassifier, StandardScaler] | None:
    if not _MODEL_FILE.exists() or not _SCALER_FILE.exists():
        return None
    try:
        with open(_MODEL_FILE, "rb") as f:
            model = pickle.load(f)
        with open(_SCALER_FILE, "rb") as f:
            scaler = pickle.load(f)
        logger.info("[GradientBoosting] Loaded pre-trained model from %s", _MODEL_FILE)
        return model, scaler
    except Exception as e:
        logger.warning("[GradientBoosting] Failed to load model: %s — retraining", e)
        return None


_model_instance: GradientBoostingClassifier | None = None
_scaler_instance: StandardScaler | None = None


def get_gradient_boosting_model() -> tuple[GradientBoostingClassifier, StandardScaler]:
    """Return the singleton trained Gradient Boosting model and scaler."""
    global _model_instance, _scaler_instance
    if _model_instance is None or _scaler_instance is None:
        loaded = _load_model()
        if loaded is not None:
            _model_instance, _scaler_instance = loaded
        else:
            _model_instance, _scaler_instance = _train_model()
            _save_model(_model_instance, _scaler_instance)
    return _model_instance, _scaler_instance


def predict_risk(features: np.ndarray) -> dict:
    """
    Predict risk level from a 47-dimensional feature vector.
    Returns: {risk_class: str, risk_score: int, probabilities: dict}
    """
    model, scaler = get_gradient_boosting_model()
    X = scaler.transform(features.reshape(1, -1))
    pred_class = int(model.predict(X)[0])
    proba = model.predict_proba(X)[0]

    # Convert to 0-100 risk score (weighted sum of class probabilities)
    risk_score = int(round(
        proba[0] * 15 +   # LOW: center at 15
        proba[1] * 40 +   # MEDIUM: center at 40
        proba[2] * 70 +   # HIGH: center at 70
        proba[3] * 90     # CRITICAL: center at 90
    ))

    return {
        "risk_class": _RISK_CLASS_MAP[pred_class],
        "risk_score": min(100, max(0, risk_score)),
        "probabilities": {
            "LOW": float(round(proba[0], 4)),
            "MEDIUM": float(round(proba[1], 4)),
            "HIGH": float(round(proba[2], 4)),
            "CRITICAL": float(round(proba[3], 4)),
        },
        "feature_importance": _get_top_features(model, features),
    }


def _get_top_features(model: GradientBoostingClassifier, features: np.ndarray, top_n: int = 5) -> list[dict]:
    """Return the top N most influential features for this prediction."""
    importances = model.feature_importances_
    # Contribution = importance * feature_value (normalised)
    contributions = importances * np.abs(features)
    top_indices = np.argsort(contributions)[::-1][:top_n]
    return [
        {
            "feature": FEATURE_NAMES[idx],
            "importance": float(round(importances[idx], 4)),
            "value": float(round(features[idx], 4)),
        }
        for idx in top_indices
    ]
