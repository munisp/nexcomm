"""
NEXCOM Exchange - AI/ML Service
Provides price forecasting, risk scoring, anomaly detection, and sentiment analysis.
Models load verified persisted artifacts, or train only from explicit real-data
exports. CPU inference is reported ready only after those requirements are met.
"""
import asyncio
import logging
import os
from contextlib import asynccontextmanager

import structlog
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from src.routes import forecasting, risk_scoring, anomaly, sentiment

logger = structlog.get_logger()
_log = logging.getLogger("nexcom.ai")


async def _initialize_models() -> None:
    """Load verified CPU model artifacts or train from configured real-data exports."""
    loop = asyncio.get_event_loop()

    def _train_all():
        _log.info("[AI/ML] Initializing Isolation Forest model...")
        from src.models.isolation_forest import get_isolation_forest_model
        get_isolation_forest_model()
        _log.info("[AI/ML] Isolation Forest ready.")

        _log.info("[AI/ML] Initializing Gradient Boosting risk model...")
        from src.models.gradient_boosting import get_gradient_boosting_model
        get_gradient_boosting_model()
        _log.info("[AI/ML] Gradient Boosting risk model ready.")

        _log.info("[AI/ML] Initializing LSTM forecaster...")
        from src.models.lstm_forecaster import LSTMForecaster
        forecaster = LSTMForecaster()
        forecaster._ensure_weights()
        _log.info("[AI/ML] LSTM forecaster ready.")

        _log.info("[AI/ML] All models initialized and ready for CPU inference.")

    await loop.run_in_executor(None, _train_all)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifecycle management with explicit model-artifact readiness."""
    logger.info("Starting NEXCOM AI/ML Service — loading verified CPU models...")
    app.state.models_ready = False
    app.state.model_error = None
    try:
        await _initialize_models()
    except Exception as exc:
        app.state.model_error = str(exc)
        _log.exception("[AI/ML] Model initialization failed; inference remains unavailable")
    else:
        app.state.models_ready = True
        logger.info("NEXCOM AI/ML Service ready for CPU inference.")
    yield
    logger.info("Shutting down NEXCOM AI/ML Service...")


app = FastAPI(
    title="NEXCOM AI/ML Service",
    description=(
        "Price forecasting (LSTM-Attention), risk scoring (Gradient Boosting), "
        "anomaly detection (Isolation Forest + GNN), and sentiment analysis. "
        "All models run on CPU via scikit-learn."
    ),
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Health endpoints
@app.get("/healthz", tags=["health"])
async def health():
    return {
        "status": "healthy" if app.state.models_ready else "degraded",
        "service": "ai-ml",
        "version": "1.0.0",
        "models_ready": app.state.models_ready,
        "model_error": app.state.model_error,
    }


@app.get("/readyz", tags=["health"])
async def ready():
    """Returns ready only after all models are initialized."""
    if not app.state.models_ready:
        from fastapi import Response
        return Response(
            status_code=503,
            content='{"status":"model_artifacts_unavailable"}',
            media_type="application/json",
        )
    return {"status": "ready", "models": ["isolation_forest", "gradient_boosting", "lstm_forecaster", "sentiment"]}


@app.get("/api/v1/ai/models", tags=["models"])
async def list_models():
    """List all available AI/ML models with their metadata."""
    return {
        "models": [
            {
                "id": "isolation_forest",
                "name": "Isolation Forest Anomaly Detector",
                "type": "anomaly_detection",
                "framework": "scikit-learn",
                "n_estimators": 200,
                "contamination": 0.03,
                "features": 8,
                "inference": "cpu",
            },
            {
                "id": "gradient_boosting_risk",
                "name": "Gradient Boosting Risk Scorer",
                "type": "risk_scoring",
                "framework": "scikit-learn",
                "n_estimators": 200,
                "features": 47,
                "classes": ["LOW", "MEDIUM", "HIGH", "CRITICAL"],
                "inference": "cpu",
            },
            {
                "id": "lstm_attention_forecaster",
                "name": "LSTM-Attention Price Forecaster",
                "type": "forecasting",
                "framework": "numpy (CPU-native)",
                "hidden_dim": 64,
                "attention_heads": 4,
                "seq_len": 24,
                "inference": "cpu",
            },
            {
                "id": "sentiment_nlp",
                "name": "Multi-Source Sentiment Analyser",
                "type": "sentiment",
                "framework": "numpy + NLP rules",
                "sources": ["news", "social", "technical", "volume", "cot"],
                "inference": "cpu",
            },
        ]
    }


# Mount route modules
app.include_router(forecasting.router, prefix="/api/v1/ai", tags=["forecasting"])
app.include_router(risk_scoring.router, prefix="/api/v1/ai", tags=["risk-scoring"])
app.include_router(anomaly.router, prefix="/api/v1/ai", tags=["anomaly-detection"])
app.include_router(sentiment.router, prefix="/api/v1/ai", tags=["sentiment"])

if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", "8007"))
    uvicorn.run("src.main:app", host="0.0.0.0", port=port, reload=False, workers=1)
