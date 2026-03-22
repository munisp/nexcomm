"""
NEXCOM Exchange - AI/ML Service
Provides price forecasting, risk scoring, anomaly detection, and sentiment analysis.
Consumes market data from Kafka, produces predictions and alerts.
"""

import os
from contextlib import asynccontextmanager

import structlog
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from src.routes import forecasting, risk_scoring, anomaly, sentiment

logger = structlog.get_logger()


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifecycle management."""
    logger.info("Starting NEXCOM AI/ML Service...")
    # Initialize ML models on startup
    yield
    logger.info("Shutting down NEXCOM AI/ML Service...")


app = FastAPI(
    title="NEXCOM AI/ML Service",
    description="Price forecasting, risk scoring, anomaly detection, and sentiment analysis",
    version="0.1.0",
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
@app.get("/healthz")
async def health():
    return {"status": "healthy", "service": "ai-ml"}


@app.get("/readyz")
async def ready():
    return {"status": "ready"}


# Mount route modules
app.include_router(forecasting.router, prefix="/api/v1/ai", tags=["forecasting"])
app.include_router(risk_scoring.router, prefix="/api/v1/ai", tags=["risk-scoring"])
app.include_router(anomaly.router, prefix="/api/v1/ai", tags=["anomaly-detection"])
app.include_router(sentiment.router, prefix="/api/v1/ai", tags=["sentiment"])

if __name__ == "__main__":
    import uvicorn

    port = int(os.environ.get("PORT", "8007"))
    uvicorn.run("src.main:app", host="0.0.0.0", port=port, reload=False)
