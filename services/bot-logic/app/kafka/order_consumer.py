"""
WhatsApp Order Status Update Consumer
======================================
Consumes the `nexcom.order.matched` Kafka topic and sends WhatsApp
notifications to traders when their orders are matched/filled.

Runs as a background asyncio task inside the FastAPI app.

Topic payload (JSON):
  {
    "order_id":     123,
    "user_id":      456,
    "symbol":       "MAIZE",
    "side":         "BUY",
    "filled_qty":   500.0,
    "avg_price":    285000.0,
    "status":       "FILLED",
    "matched_at":   "2026-03-23T10:15:00Z"
  }
"""

import asyncio
import json
import logging
import os
from datetime import datetime, timezone

import httpx

from app.db.pool import get_pool

logger = logging.getLogger(__name__)

KAFKA_BROKERS = os.getenv("KAFKA_BROKERS", "localhost:9092")
KAFKA_TOPIC = "nexcom.order.matched"
KAFKA_GROUP_ID = "bot-logic-order-updates"
CHANNEL_GATEWAY_URL = os.getenv("CHANNEL_GATEWAY_URL", "http://channel-gateway:8082")


# ─── DB helpers ───────────────────────────────────────────────────────────────

async def get_whatsapp_contact(pool, user_id: int) -> dict | None:
    """Fetch WhatsApp contact for a user (phone + wa_id + display_name)."""
    row = await pool.fetchrow(
        """
        SELECT wc.wa_id, wc.display_name, u.phone
        FROM users u
        LEFT JOIN whatsapp_contacts wc ON wc.phone = u.phone AND wc.status = 'ACTIVE'
        WHERE u.id = $1
        LIMIT 1
        """,
        user_id,
    )
    return dict(row) if row else None


# ─── Message builder ──────────────────────────────────────────────────────────

def build_order_fill_message(
    display_name: str,
    symbol: str,
    side: str,
    filled_qty: float,
    avg_price: float,
    order_id: int,
    status: str,
    matched_at: str,
) -> str:
    """Build a human-readable WhatsApp order fill notification."""
    side_emoji = "🟢" if side == "BUY" else "🔴"
    status_label = {
        "FILLED": "Fully Filled ✅",
        "PARTIALLY_FILLED": "Partially Filled ⚠️",
        "CANCELLED": "Cancelled ❌",
    }.get(status, status)

    total_value = filled_qty * avg_price
    try:
        dt = datetime.fromisoformat(matched_at.replace("Z", "+00:00"))
        time_str = dt.strftime("%d %b %Y %H:%M UTC")
    except Exception:
        time_str = matched_at

    return (
        f"{side_emoji} *NEXCOM Order Update*\n\n"
        f"Hello {display_name or 'Trader'},\n\n"
        f"Your *{side}* order has been updated:\n\n"
        f"• Commodity: *{symbol}*\n"
        f"• Filled Qty: *{filled_qty:,.2f} MT*\n"
        f"• Avg Price: *₦{avg_price:,.2f}/MT*\n"
        f"• Total Value: *₦{total_value:,.2f}*\n"
        f"• Status: *{status_label}*\n"
        f"• Order ID: #{order_id}\n"
        f"• Time: {time_str}\n\n"
        f"Reply with:\n"
        f"• *PORTFOLIO* — view your positions\n"
        f"• *PRICE {symbol}* — get latest quote\n\n"
        f"_NEXCOM Exchange_"
    )


# ─── WhatsApp sender ──────────────────────────────────────────────────────────

async def send_order_update(wa_id: str, message: str) -> bool:
    """Send an order update message via the Go channel-gateway."""
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(
                f"{CHANNEL_GATEWAY_URL}/internal/whatsapp/send",
                json={"to": wa_id, "message": message},
                headers={"X-Internal-Key": os.getenv("INTERNAL_API_KEY", os.getenv("JWT_SECRET", ""))},
            )
            if resp.status_code == 200:
                return True
            logger.warning(
                "Order update send failed: status=%d body=%s",
                resp.status_code,
                resp.text[:200],
            )
            return False
    except Exception as exc:
        logger.error("Order update send error: %s", exc)
        return False


# ─── Event handler ────────────────────────────────────────────────────────────

async def handle_order_matched_event(pool, event: dict) -> None:
    """Process a single nexcom.order.matched event."""
    user_id = event.get("user_id")
    if not user_id:
        logger.warning("Order matched event missing user_id: %s", event)
        return

    contact = await get_whatsapp_contact(pool, user_id)
    if not contact or not contact.get("wa_id"):
        logger.debug("No WhatsApp contact for user_id=%d, skipping notification", user_id)
        return

    message = build_order_fill_message(
        display_name=contact.get("display_name") or "",
        symbol=event.get("symbol", "UNKNOWN"),
        side=event.get("side", "BUY"),
        filled_qty=float(event.get("filled_qty", 0)),
        avg_price=float(event.get("avg_price", 0)),
        order_id=int(event.get("order_id", 0)),
        status=event.get("status", "FILLED"),
        matched_at=event.get("matched_at", datetime.now(timezone.utc).isoformat()),
    )

    sent = await send_order_update(wa_id=contact["wa_id"], message=message)
    if sent:
        logger.info(
            "Order update sent: user_id=%d order_id=%s symbol=%s status=%s",
            user_id,
            event.get("order_id"),
            event.get("symbol"),
            event.get("status"),
        )
    else:
        logger.warning(
            "Order update failed: user_id=%d order_id=%s",
            user_id,
            event.get("order_id"),
        )


# ─── Kafka consumer loop ──────────────────────────────────────────────────────

async def run_order_update_consumer() -> None:
    """
    Background task: consume nexcom.order.matched Kafka topic and
    send WhatsApp notifications for each matched order.

    Falls back to a no-op loop if aiokafka is unavailable or Kafka is
    unreachable (e.g., local dev without Kafka).
    """
    try:
        from aiokafka import AIOKafkaConsumer
    except ImportError:
        logger.warning(
            "aiokafka not installed — order update consumer disabled. "
            "Install with: pip install aiokafka"
        )
        return

    pool = await get_pool()
    consumer = AIOKafkaConsumer(
        KAFKA_TOPIC,
        bootstrap_servers=KAFKA_BROKERS,
        group_id=KAFKA_GROUP_ID,
        auto_offset_reset="latest",
        enable_auto_commit=True,
        value_deserializer=lambda v: json.loads(v.decode("utf-8")),
    )

    try:
        await consumer.start()
        logger.info(
            "Order update consumer started: topic=%s group=%s brokers=%s",
            KAFKA_TOPIC,
            KAFKA_GROUP_ID,
            KAFKA_BROKERS,
        )
        async for msg in consumer:
            try:
                event = msg.value
                logger.debug("Received order.matched event: %s", event)
                await handle_order_matched_event(pool, event)
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                logger.error(
                    "Error handling order.matched event: %s | event=%s",
                    exc,
                    msg.value,
                    exc_info=True,
                )
    except asyncio.CancelledError:
        logger.info("Order update consumer shutting down")
    except Exception as exc:
        logger.error(
            "Order update consumer failed to start (Kafka unavailable?): %s", exc
        )
        logger.info("Running without order update consumer (Kafka not available)")
    finally:
        try:
            await consumer.stop()
        except Exception:
            pass
