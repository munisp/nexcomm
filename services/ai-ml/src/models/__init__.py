"""
NEXCOM AI/ML — Model Registry
Provides lazy-loaded, CPU-trained scikit-learn models for production inference.
All models are trained on startup using synthetic data calibrated to real commodity
market distributions, then persisted to disk for fast reload.
"""
from .isolation_forest import get_isolation_forest_model
from .gradient_boosting import get_gradient_boosting_model
from .lstm_forecaster import LSTMForecaster

__all__ = [
    "get_isolation_forest_model",
    "get_gradient_boosting_model",
    "LSTMForecaster",
]
