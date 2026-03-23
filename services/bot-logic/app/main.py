"""
NEXCOM Exchange — Bot Logic Service (Python)
=============================================
FastAPI service that handles command parsing and NLP intent routing
for WhatsApp and Telegram channels.

Called by the Go channel-gateway on every inbound message.

Architecture:
  - FastAPI on :8040
  - Redis for session state (conversation context per user)
  - PostgreSQL for user data, prices, portfolios, loans
  - Kafka for event emission
  - Intent NLP layer for natural language command parsing

Endpoints:
  POST /process          — Main entry: parse intent + generate reply
  POST /notify/whatsapp  — Push notification to WhatsApp user
  POST /notify/telegram  — Push notification to Telegram user
  GET  /health           — Health check
  GET  /metrics          — Prometheus metrics
"""

import asyncio
import os
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from prometheus_fastapi_instrumentator import Instrumentator

from app.db.pool import init_db, close_db
from app.kafka.producer import KafkaProducer
from app.handlers.router import process_message
from app.handlers.notify import send_whatsapp_notification, send_telegram_notification

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("nexcom.bot-logic")


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup and shutdown lifecycle."""
    from app.alerts.broadcaster import run_alert_broadcaster
    logger.info("Starting NEXCOM Bot Logic Service...")
    await init_db()
    app.state.kafka = KafkaProducer(
        brokers=os.getenv("KAFKA_BROKERS", "localhost:9092")
    )
    # Start WhatsApp price alert broadcaster as a background task
    broadcaster_task = asyncio.create_task(run_alert_broadcaster())
    app.state.broadcaster_task = broadcaster_task
    logger.info("Bot Logic Service ready on :8040 (alert broadcaster running)")
    yield
    logger.info("Shutting down Bot Logic Service...")
    broadcaster_task.cancel()
    try:
        await broadcaster_task
    except asyncio.CancelledError:
        pass
    await close_db()
    app.state.kafka.close()


app = FastAPI(
    title="NEXCOM Bot Logic Service",
    description="NLP intent routing for WhatsApp and Telegram channels",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Prometheus metrics
Instrumentator().instrument(app).expose(app)


# ─── Request/Response Models ──────────────────────────────────────────────────

class ProcessRequest(BaseModel):
    channel: str          # "whatsapp" | "telegram"
    from_: str            # phone number or telegram_id
    text: str             # message text or command

    class Config:
        populate_by_name = True
        fields = {"from_": "from"}


class ProcessResponse(BaseModel):
    reply: str
    intent: str | None = None
    confidence: float | None = None


class NotifyRequest(BaseModel):
    to: str               # phone number or telegram_id
    message: str
    message_type: str = "text"


# ─── Endpoints ────────────────────────────────────────────────────────────────

@app.post("/process", response_model=ProcessResponse)
async def process(req: ProcessRequest):
    """
    Main entry point: parse intent and generate reply.
    Called by the Go channel-gateway on every inbound message.
    """
    try:
        result = await process_message(
            channel=req.channel,
            from_id=req.from_,
            text=req.text,
            kafka=app.state.kafka,
        )
        return ProcessResponse(**result)
    except Exception as e:
        logger.error(f"Error processing message from {req.from_}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/notify/whatsapp")
async def notify_whatsapp(req: NotifyRequest):
    """Send a push notification to a WhatsApp user."""
    channel_gateway_url = os.getenv("CHANNEL_GATEWAY_URL", "http://localhost:8030")
    success = await send_whatsapp_notification(
        channel_gateway_url, req.to, req.message
    )
    return {"status": "sent" if success else "failed", "to": req.to}


@app.post("/notify/telegram")
async def notify_telegram(req: NotifyRequest):
    """Send a push notification to a Telegram user."""
    channel_gateway_url = os.getenv("CHANNEL_GATEWAY_URL", "http://localhost:8030")
    success = await send_telegram_notification(
        channel_gateway_url, req.to, req.message
    )
    return {"status": "sent" if success else "failed", "to": req.to}


@app.get("/health")
async def health():
    return {"status": "healthy", "service": "nexcom-bot-logic"}
