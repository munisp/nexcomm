"""
Loan Approval Notification Consumer
=====================================
Consumes the `nexcom.loan.approved` Kafka topic and sends multi-channel
notifications to borrowers when their loan application is approved or
rejected by the core banking system (CBS).

Runs as a background asyncio task inside the FastAPI app.

Topic payload (JSON):
  {
    "application_id":  789,
    "user_id":         456,
    "bank_name":       "First Bank Nigeria",
    "loan_purpose":    "COMMODITY_PURCHASE",
    "approved_amount": 5000000.00,
    "interest_rate":   12.5,
    "tenor_months":    6,
    "status":          "APPROVED" | "REJECTED" | "DISBURSED",
    "rejection_reason": null,
    "disbursed_at":    "2026-03-23T10:15:00Z",
    "repayment_due":   "2026-09-23T00:00:00Z",
    "event_time":      "2026-03-23T10:15:00Z"
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
KAFKA_TOPIC = "nexcom.loan.approved"
KAFKA_GROUP_ID = "bot-logic-loan-notifications"
CHANNEL_GATEWAY_URL = os.getenv("CHANNEL_GATEWAY_URL", "http://channel-gateway:8082")


# ─── DB helpers ───────────────────────────────────────────────────────────────

async def get_user_contacts(pool, user_id: int) -> dict:
    """
    Fetch WhatsApp and Telegram contacts for a user.
    Returns a dict with keys: whatsapp_wa_id, whatsapp_name,
    telegram_chat_id, telegram_name.
    """
    row = await pool.fetchrow(
        """
        SELECT
            u.phone,
            wc.wa_id          AS whatsapp_wa_id,
            wc.display_name   AS whatsapp_name,
            tc.telegram_id    AS telegram_chat_id,
            tc.first_name     AS telegram_name
        FROM users u
        LEFT JOIN whatsapp_contacts wc
               ON wc.phone = u.phone AND wc.status = 'ACTIVE'
        LEFT JOIN telegram_contacts tc
               ON tc.user_id = u.id
              AND tc.is_verified = TRUE
              AND tc.status = 'ACTIVE'
        WHERE u.id = $1
        LIMIT 1
        """,
        user_id,
    )
    return dict(row) if row else {}


# ─── Message builders ─────────────────────────────────────────────────────────

def _fmt_date(iso: str | None) -> str:
    if not iso:
        return "N/A"
    try:
        dt = datetime.fromisoformat(iso.replace("Z", "+00:00"))
        return dt.strftime("%d %b %Y")
    except Exception:
        return iso


def build_whatsapp_loan_message(display_name: str, event: dict) -> str:
    """Build a human-readable WhatsApp loan notification."""
    status = event.get("status", "APPROVED")
    app_id = event.get("application_id", 0)
    bank = event.get("bank_name", "Your Bank")

    if status == "APPROVED":
        amount = float(event.get("approved_amount", 0))
        rate = float(event.get("interest_rate", 0))
        tenor = int(event.get("tenor_months", 0))
        due = _fmt_date(event.get("repayment_due"))
        return (
            f"🏦 *NEXCOM Loan Update*\n\n"
            f"Hello {display_name or 'Valued Customer'},\n\n"
            f"Great news! Your loan application has been *APPROVED* ✅\n\n"
            f"• Bank: *{bank}*\n"
            f"• Approved Amount: *₦{amount:,.2f}*\n"
            f"• Interest Rate: *{rate:.2f}% p.a.*\n"
            f"• Tenor: *{tenor} months*\n"
            f"• Repayment Due: *{due}*\n"
            f"• Application ID: #{app_id}\n\n"
            f"Funds will be disbursed to your NEXCOM wallet shortly.\n\n"
            f"Reply with *BALANCE* to check your wallet balance.\n\n"
            f"_NEXCOM Exchange_"
        )
    elif status == "DISBURSED":
        amount = float(event.get("approved_amount", 0))
        disbursed = _fmt_date(event.get("disbursed_at"))
        due = _fmt_date(event.get("repayment_due"))
        return (
            f"💸 *NEXCOM Loan Disbursed*\n\n"
            f"Hello {display_name or 'Valued Customer'},\n\n"
            f"Your loan has been *DISBURSED* to your NEXCOM wallet 🎉\n\n"
            f"• Bank: *{bank}*\n"
            f"• Amount Disbursed: *₦{amount:,.2f}*\n"
            f"• Disbursement Date: *{disbursed}*\n"
            f"• Repayment Due: *{due}*\n"
            f"• Application ID: #{app_id}\n\n"
            f"Reply with *BALANCE* to confirm your wallet balance.\n\n"
            f"_NEXCOM Exchange_"
        )
    else:  # REJECTED
        reason = event.get("rejection_reason") or "Please contact support for details."
        return (
            f"❌ *NEXCOM Loan Update*\n\n"
            f"Hello {display_name or 'Valued Customer'},\n\n"
            f"Unfortunately, your loan application has been *REJECTED*.\n\n"
            f"• Bank: *{bank}*\n"
            f"• Application ID: #{app_id}\n"
            f"• Reason: {reason}\n\n"
            f"You may reapply after addressing the above or contact our support team.\n\n"
            f"_NEXCOM Exchange_"
        )


def build_telegram_loan_message(first_name: str, event: dict) -> str:
    """Build a Telegram MarkdownV2 loan notification."""
    status = event.get("status", "APPROVED")
    app_id = event.get("application_id", 0)
    bank = event.get("bank_name", "Your Bank").replace(".", "\\.").replace("-", "\\-")

    if status == "APPROVED":
        amount = float(event.get("approved_amount", 0))
        rate = float(event.get("interest_rate", 0))
        tenor = int(event.get("tenor_months", 0))
        due = _fmt_date(event.get("repayment_due"))
        return (
            f"🏦 *Loan Approved* ✅\n\n"
            f"Hello {first_name or 'Trader'},\n\n"
            f"Your loan application with *{bank}* has been approved\\!\n\n"
            f"💰 Amount: *₦{amount:,.2f}*\n"
            f"📈 Rate: *{rate:.2f}% p\\.a\\.*\n"
            f"📅 Tenor: *{tenor} months*\n"
            f"🗓 Due: *{due}*\n"
            f"🔖 Ref: \\#{app_id}\n\n"
            f"Funds will be disbursed to your NEXCOM wallet shortly\\."
        )
    elif status == "DISBURSED":
        amount = float(event.get("approved_amount", 0))
        disbursed = _fmt_date(event.get("disbursed_at"))
        due = _fmt_date(event.get("repayment_due"))
        return (
            f"💸 *Loan Disbursed* 🎉\n\n"
            f"Hello {first_name or 'Trader'},\n\n"
            f"₦{amount:,.2f} from *{bank}* has been credited to your NEXCOM wallet\\!\n\n"
            f"📅 Disbursed: *{disbursed}*\n"
            f"🗓 Repayment Due: *{due}*\n"
            f"🔖 Ref: \\#{app_id}"
        )
    else:
        reason = (event.get("rejection_reason") or "Please contact support\\.").replace(".", "\\.")
        return (
            f"❌ *Loan Application Update*\n\n"
            f"Hello {first_name or 'Trader'},\n\n"
            f"Your loan application with *{bank}* was not approved\\.\n\n"
            f"Reason: {reason}\n"
            f"🔖 Ref: \\#{app_id}\n\n"
            f"You may reapply after addressing the above\\."
        )


# ─── Channel senders ──────────────────────────────────────────────────────────

async def send_whatsapp(wa_id: str, message: str) -> bool:
    """Send a loan notification via the Go channel-gateway WhatsApp endpoint."""
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(
                f"{CHANNEL_GATEWAY_URL}/internal/whatsapp/send",
                json={"to": wa_id, "message": message},
                headers={"X-Internal-Key": os.getenv("INTERNAL_API_KEY", "nexcom-internal")},
            )
            return resp.status_code == 200
    except Exception as exc:
        logger.error("WhatsApp loan notification error: %s", exc)
        return False


async def send_telegram(chat_id: str, message: str) -> bool:
    """Send a loan notification via the Go channel-gateway Telegram endpoint."""
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(
                f"{CHANNEL_GATEWAY_URL}/internal/telegram/send",
                json={"chat_id": chat_id, "message": message, "parse_mode": "MarkdownV2"},
                headers={"X-Internal-Key": os.getenv("INTERNAL_API_KEY", "nexcom-internal")},
            )
            return resp.status_code == 200
    except Exception as exc:
        logger.error("Telegram loan notification error: %s", exc)
        return False


# ─── Event handler ────────────────────────────────────────────────────────────

async def handle_loan_event(pool, event: dict) -> None:
    """Process a single nexcom.loan.approved event and dispatch notifications."""
    user_id = event.get("user_id")
    if not user_id:
        logger.warning("Loan event missing user_id: %s", event)
        return

    contacts = await get_user_contacts(pool, user_id)
    if not contacts:
        logger.debug("No contacts for user_id=%d, skipping loan notification", user_id)
        return

    status = event.get("status", "APPROVED")
    app_id = event.get("application_id", "?")
    sent_any = False

    # WhatsApp notification
    wa_id = contacts.get("whatsapp_wa_id")
    if wa_id:
        msg = build_whatsapp_loan_message(
            display_name=contacts.get("whatsapp_name") or "",
            event=event,
        )
        ok = await send_whatsapp(wa_id=wa_id, message=msg)
        if ok:
            logger.info("Loan WhatsApp sent: user_id=%d app_id=%s status=%s", user_id, app_id, status)
            sent_any = True
        else:
            logger.warning("Loan WhatsApp failed: user_id=%d app_id=%s", user_id, app_id)

    # Telegram notification
    tg_chat_id = contacts.get("telegram_chat_id")
    if tg_chat_id:
        msg = build_telegram_loan_message(
            first_name=contacts.get("telegram_name") or "",
            event=event,
        )
        ok = await send_telegram(chat_id=str(tg_chat_id), message=msg)
        if ok:
            logger.info("Loan Telegram sent: user_id=%d app_id=%s status=%s", user_id, app_id, status)
            sent_any = True
        else:
            logger.warning("Loan Telegram failed: user_id=%d app_id=%s", user_id, app_id)

    if not sent_any:
        logger.info(
            "No channels available for loan notification: user_id=%d app_id=%s",
            user_id, app_id,
        )


# ─── Kafka consumer loop ──────────────────────────────────────────────────────

async def run_loan_notification_consumer() -> None:
    """
    Background task: consume nexcom.loan.approved Kafka topic and send
    WhatsApp + Telegram notifications for each loan status change.

    Falls back to a no-op if aiokafka is unavailable or Kafka is unreachable.
    """
    try:
        from aiokafka import AIOKafkaConsumer
    except ImportError:
        logger.warning(
            "aiokafka not installed — loan notification consumer disabled. "
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
            "Loan notification consumer started: topic=%s group=%s brokers=%s",
            KAFKA_TOPIC,
            KAFKA_GROUP_ID,
            KAFKA_BROKERS,
        )
        async for msg in consumer:
            try:
                event = msg.value
                logger.debug("Received loan event: %s", event)
                await handle_loan_event(pool, event)
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                logger.error(
                    "Error handling loan event: %s | event=%s",
                    exc,
                    msg.value,
                    exc_info=True,
                )
    except asyncio.CancelledError:
        logger.info("Loan notification consumer shutting down")
    except Exception as exc:
        logger.error(
            "Loan notification consumer failed to start (Kafka unavailable?): %s", exc
        )
        logger.info("Running without loan notification consumer (Kafka not available)")
    finally:
        try:
            await consumer.stop()
        except Exception:
            pass
