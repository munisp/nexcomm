"""
WhatsApp Price Alert Broadcaster
=================================
Polls the price_alerts table every 60 seconds, checks live_prices,
and sends WhatsApp messages when a threshold is crossed.

Runs as a background asyncio task inside the FastAPI app.
"""

import asyncio
import logging
import os
from datetime import datetime, timezone
from typing import Optional

import httpx

from app.db.pool import get_pool

logger = logging.getLogger(__name__)

CHANNEL_GATEWAY_URL = os.getenv("CHANNEL_GATEWAY_URL", "http://channel-gateway:8082")
POLL_INTERVAL_SECS = int(os.getenv("ALERT_POLL_INTERVAL", "60"))


# ─── DB helpers ───────────────────────────────────────────────────────────────

async def fetch_active_alerts(pool) -> list[dict]:
    """Fetch all active price alerts that have a WhatsApp contact opted in."""
    rows = await pool.fetch(
        """
        SELECT
            pa.id,
            pa.user_id,
            pa.symbol,
            pa.condition,
            pa.target_price::float8 AS target_price,
            pa.triggered_at,
            u.phone,
            wc.wa_id,
            wc.display_name
        FROM price_alerts pa
        JOIN users u ON u.id = pa.user_id
        LEFT JOIN whatsapp_contacts wc ON wc.phone = u.phone AND wc.status = 'ACTIVE'
        WHERE pa.triggered_at IS NULL
          AND (wc.wa_id IS NOT NULL)
        ORDER BY pa.created_at ASC
        """
    )
    return [dict(r) for r in rows]


async def fetch_live_price(pool, symbol: str) -> Optional[float]:
    """Fetch the latest price for a symbol from live_prices."""
    row = await pool.fetchrow(
        "SELECT price::float8 FROM live_prices WHERE symbol = $1 LIMIT 1",
        symbol,
    )
    return row["price"] if row else None


async def mark_alert_triggered(pool, alert_id: int) -> None:
    """Mark a price alert as triggered so it is not re-sent."""
    await pool.execute(
        "UPDATE price_alerts SET triggered_at = NOW() WHERE id = $1",
        alert_id,
    )


# ─── Threshold check ──────────────────────────────────────────────────────────

def is_threshold_crossed(condition: str, current_price: float, target_price: float) -> bool:
    """Return True if the alert condition is satisfied."""
    if condition == "ABOVE":
        return current_price >= target_price
    elif condition == "BELOW":
        return current_price <= target_price
    elif condition == "CROSS_ABOVE":
        return current_price >= target_price
    elif condition == "CROSS_BELOW":
        return current_price <= target_price
    return False


# ─── WhatsApp sender ──────────────────────────────────────────────────────────

async def send_whatsapp_alert(
    wa_id: str,
    display_name: str,
    symbol: str,
    condition: str,
    target_price: float,
    current_price: float,
) -> bool:
    """Send a WhatsApp alert message via the Go channel-gateway."""
    condition_text = {
        "ABOVE": "risen above",
        "BELOW": "fallen below",
        "CROSS_ABOVE": "crossed above",
        "CROSS_BELOW": "crossed below",
    }.get(condition, "reached")

    direction_emoji = "📈" if "ABOVE" in condition else "📉"
    message = (
        f"{direction_emoji} *NEXCOM Price Alert*\n\n"
        f"Hello {display_name or 'Trader'},\n\n"
        f"*{symbol}* has {condition_text} your target of *₦{target_price:,.2f}/MT*.\n\n"
        f"Current price: *₦{current_price:,.2f}/MT*\n\n"
        f"Reply with:\n"
        f"• *PRICE {symbol}* — get latest quote\n"
        f"• *TRADE BUY {symbol} <qty>* — place buy order\n"
        f"• *ALERT LIST* — view all your alerts\n\n"
        f"_NEXCOM Exchange — {datetime.now(timezone.utc).strftime('%d %b %Y %H:%M UTC')}_"
    )

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(
                f"{CHANNEL_GATEWAY_URL}/internal/whatsapp/send",
                json={"to": wa_id, "message": message},
                headers={"X-Internal-Key": os.getenv("INTERNAL_API_KEY", "nexcom-internal")},
            )
            if resp.status_code == 200:
                logger.info(
                    "WhatsApp alert sent: symbol=%s wa_id=%s condition=%s",
                    symbol, wa_id, condition,
                )
                return True
            else:
                logger.warning(
                    "WhatsApp alert failed: status=%d body=%s",
                    resp.status_code, resp.text[:200],
                )
                return False
    except Exception as exc:
        logger.error("WhatsApp alert send error: %s", exc)
        return False


# ─── Main broadcast loop ──────────────────────────────────────────────────────

async def run_alert_broadcaster() -> None:
    """
    Background task: poll price_alerts every POLL_INTERVAL_SECS seconds.
    For each active alert, check if the current price crosses the threshold.
    If so, send a WhatsApp message and mark the alert as triggered.
    """
    logger.info(
        "WhatsApp alert broadcaster started (interval=%ds)", POLL_INTERVAL_SECS
    )
    pool = await get_pool()

    while True:
        try:
            alerts = await fetch_active_alerts(pool)
            logger.debug("Checking %d active WhatsApp price alerts", len(alerts))

            for alert in alerts:
                symbol = alert["symbol"]
                condition = alert["condition"]
                target_price = alert["target_price"]
                wa_id = alert.get("wa_id")
                display_name = alert.get("display_name") or ""

                if not wa_id:
                    continue  # No WhatsApp contact for this user

                current_price = await fetch_live_price(pool, symbol)
                if current_price is None:
                    logger.debug("No live price for symbol=%s", symbol)
                    continue

                if is_threshold_crossed(condition, current_price, target_price):
                    sent = await send_whatsapp_alert(
                        wa_id=wa_id,
                        display_name=display_name,
                        symbol=symbol,
                        condition=condition,
                        target_price=target_price,
                        current_price=current_price,
                    )
                    if sent:
                        await mark_alert_triggered(pool, alert["id"])
                        logger.info(
                            "Alert #%d triggered: %s %s %.2f (current=%.2f)",
                            alert["id"], symbol, condition, target_price, current_price,
                        )

        except asyncio.CancelledError:
            logger.info("WhatsApp alert broadcaster shutting down")
            break
        except Exception as exc:
            logger.error("Alert broadcaster error: %s", exc, exc_info=True)

        await asyncio.sleep(POLL_INTERVAL_SECS)
