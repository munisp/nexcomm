"""
NEXCOM Bot Logic — Outbound Notification Helpers
=================================================
Sends notifications to users via the channel-gateway service.
"""

import logging
import httpx

logger = logging.getLogger("nexcom.bot-logic.notify")


async def send_whatsapp_notification(
    channel_gateway_url: str,
    to: str,
    message: str,
) -> bool:
    """Send a WhatsApp notification via the Go channel-gateway."""
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(
                f"{channel_gateway_url}/send/whatsapp",
                json={"to": to, "message": message, "type": "text"},
                headers={"X-Internal-Token": _get_internal_token()},
            )
            return resp.status_code == 200
    except Exception as e:
        logger.error(f"WhatsApp notification failed: {e}")
        return False


async def send_telegram_notification(
    channel_gateway_url: str,
    to: str,
    message: str,
) -> bool:
    """Send a Telegram notification via the Go channel-gateway."""
    try:
        chat_id = int(to)
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(
                f"{channel_gateway_url}/send/telegram",
                json={"chat_id": chat_id, "message": message},
                headers={"X-Internal-Token": _get_internal_token()},
            )
            return resp.status_code == 200
    except Exception as e:
        logger.error(f"Telegram notification failed: {e}")
        return False


def _get_internal_token() -> str:
    import os
    return os.getenv("INTERNAL_API_TOKEN", "")
