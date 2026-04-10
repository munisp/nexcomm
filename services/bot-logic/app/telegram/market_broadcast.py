"""
Telegram Market Open/Close Broadcaster
========================================
Sends daily market summary broadcasts to all opted-in Telegram users:
  • 08:00 WAT (UTC+1) — Market Open summary with top movers
  • 16:00 WAT (UTC+1) — Market Close summary with day's performance

Uses APScheduler (AsyncIOScheduler) for cron-style scheduling.
Runs as a background component inside the FastAPI app.

Telegram users opt in by starting the bot or sending /subscribe.
Their chat_ids are stored in telegram_contacts.chat_id.
"""

import asyncio
import logging
import os
from datetime import datetime, timezone, timedelta
from typing import Optional

import httpx
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger

from app.db.pool import get_pool

logger = logging.getLogger(__name__)

CHANNEL_GATEWAY_URL = os.getenv("CHANNEL_GATEWAY_URL", "http://channel-gateway:8082")
# WAT = UTC+1; cron runs in UTC so 08:00 WAT = 07:00 UTC, 16:00 WAT = 15:00 UTC
MARKET_OPEN_HOUR_UTC = int(os.getenv("MARKET_OPEN_HOUR_UTC", "7"))
MARKET_CLOSE_HOUR_UTC = int(os.getenv("MARKET_CLOSE_HOUR_UTC", "15"))

# Top N commodities to include in the broadcast
TOP_N = 5


# ─── DB helpers ───────────────────────────────────────────────────────────────

async def get_opted_in_telegram_users(pool) -> list[dict]:
    """Fetch all Telegram users who have opted in to market broadcasts."""
    rows = await pool.fetch(
        """
        SELECT tc.chat_id, tc.display_name
        FROM telegram_contacts tc
        WHERE tc.status = 'ACTIVE'
          AND tc.market_broadcasts = TRUE
        ORDER BY tc.created_at ASC
        """
    )
    return [dict(r) for r in rows]


async def get_top_movers(pool, n: int = 5) -> list[dict]:
    """Fetch the top N commodities by absolute price change percentage."""
    rows = await pool.fetch(
        """
        SELECT symbol, price::float8, change_pct::float8, high::float8, low::float8,
               volume::float8
        FROM live_prices
        ORDER BY ABS(change_pct) DESC
        LIMIT $1
        """,
        n,
    )
    return [dict(r) for r in rows]


async def get_market_summary(pool) -> dict:
    """Fetch aggregate market statistics for the broadcast."""
    row = await pool.fetchrow(
        """
        SELECT
            COUNT(*) AS total_symbols,
            COUNT(*) FILTER (WHERE change_pct > 0) AS gainers,
            COUNT(*) FILTER (WHERE change_pct < 0) AS losers,
            COUNT(*) FILTER (WHERE change_pct = 0) AS unchanged,
            COALESCE(SUM(volume::float8), 0) AS total_volume
        FROM live_prices
        """
    )
    return dict(row) if row else {
        "total_symbols": 0,
        "gainers": 0,
        "losers": 0,
        "unchanged": 0,
        "total_volume": 0.0,
    }


# ─── Message builders ─────────────────────────────────────────────────────────

def build_market_open_message(movers: list[dict], summary: dict) -> str:
    """Build the 08:00 WAT market open broadcast message."""
    now_wat = datetime.now(timezone(timedelta(hours=1)))
    date_str = now_wat.strftime("%A, %d %b %Y")

    lines = [
        "🌅 *NEXCOM Exchange — Market Open*",
        f"_{date_str} | 08:00 WAT_",
        "",
        "Good morning, Traders! 🌾",
        "The NEXCOM agricultural commodity exchange is now *OPEN*.",
        "",
        f"📊 *Market Overview*",
        f"• Active Symbols: {summary.get('total_symbols', 0)}",
        f"• Yesterday's Gainers: {summary.get('gainers', 0)} 🟢",
        f"• Yesterday's Losers: {summary.get('losers', 0)} 🔴",
        f"• Total Volume: {summary.get('total_volume', 0):,.0f} MT",
        "",
        "🔥 *Top Movers (Opening)*",
    ]

    for m in movers:
        arrow = "📈" if m.get("change_pct", 0) >= 0 else "📉"
        sign = "+" if m.get("change_pct", 0) >= 0 else ""
        lines.append(
            f"{arrow} *{m['symbol']}* ₦{m['price']:,.0f}/MT "
            f"({sign}{m.get('change_pct', 0):.2f}%)"
        )

    lines += [
        "",
        "💡 *Quick Commands*",
        "• /price MAIZE — get live quote",
        "• /trade BUY MAIZE 100 — place order",
        "• /portfolio — view positions",
        "• /alert set MAIZE ABOVE 300000 — set price alert",
        "",
        "_Trade responsibly. NEXCOM Exchange._",
    ]
    return "\n".join(lines)


def build_market_close_message(movers: list[dict], summary: dict) -> str:
    """Build the 16:00 WAT market close broadcast message."""
    now_wat = datetime.now(timezone(timedelta(hours=1)))
    date_str = now_wat.strftime("%A, %d %b %Y")

    lines = [
        "🌆 *NEXCOM Exchange — Market Close*",
        f"_{date_str} | 16:00 WAT_",
        "",
        "Good afternoon, Traders! 🌾",
        "The NEXCOM agricultural commodity exchange is now *CLOSED*.",
        "",
        f"📊 *Day Summary*",
        f"• Gainers: {summary.get('gainers', 0)} 🟢  "
        f"Losers: {summary.get('losers', 0)} 🔴  "
        f"Flat: {summary.get('unchanged', 0)} ⚪",
        f"• Total Volume: {summary.get('total_volume', 0):,.0f} MT",
        "",
        "📉📈 *Top Movers (Close)*",
    ]

    for m in movers:
        arrow = "📈" if m.get("change_pct", 0) >= 0 else "📉"
        sign = "+" if m.get("change_pct", 0) >= 0 else ""
        lines.append(
            f"{arrow} *{m['symbol']}* ₦{m['price']:,.0f}/MT "
            f"({sign}{m.get('change_pct', 0):.2f}%) | "
            f"H: ₦{m.get('high', 0):,.0f} L: ₦{m.get('low', 0):,.0f}"
        )

    lines += [
        "",
        "🌙 *After-Hours*",
        "• /alert set SYMBOL ABOVE/BELOW PRICE — set overnight alerts",
        "• /portfolio — review your day's P&L",
        "• Market reopens tomorrow at 08:00 WAT",
        "",
        "_NEXCOM Exchange — Connecting Africa's Agricultural Markets._",
    ]
    return "\n".join(lines)


# ─── Telegram sender ──────────────────────────────────────────────────────────

async def send_telegram_broadcast(chat_id: str, message: str) -> bool:
    """Send a broadcast message to a Telegram chat via the Go channel-gateway."""
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(
                f"{CHANNEL_GATEWAY_URL}/internal/telegram/send",
                json={"chat_id": chat_id, "message": message, "parse_mode": "Markdown"},
                headers={"X-Internal-Key": os.getenv("INTERNAL_API_KEY", os.getenv("JWT_SECRET", ""))},
            )
            if resp.status_code == 200:
                return True
            logger.warning(
                "Telegram broadcast failed: chat_id=%s status=%d body=%s",
                chat_id,
                resp.status_code,
                resp.text[:200],
            )
            return False
    except Exception as exc:
        logger.error("Telegram broadcast send error: %s", exc)
        return False


# ─── Broadcast jobs ───────────────────────────────────────────────────────────

async def broadcast_market_open() -> None:
    """Job: send market open summary to all opted-in Telegram users."""
    logger.info("Running market open broadcast...")
    pool = await get_pool()
    try:
        users = await get_opted_in_telegram_users(pool)
        movers = await get_top_movers(pool, TOP_N)
        summary = await get_market_summary(pool)
        message = build_market_open_message(movers, summary)

        sent = 0
        for user in users:
            ok = await send_telegram_broadcast(str(user["chat_id"]), message)
            if ok:
                sent += 1

        logger.info(
            "Market open broadcast complete: %d/%d sent", sent, len(users)
        )
    except Exception as exc:
        logger.error("Market open broadcast error: %s", exc, exc_info=True)


async def broadcast_market_close() -> None:
    """Job: send market close summary to all opted-in Telegram users."""
    logger.info("Running market close broadcast...")
    pool = await get_pool()
    try:
        users = await get_opted_in_telegram_users(pool)
        movers = await get_top_movers(pool, TOP_N)
        summary = await get_market_summary(pool)
        message = build_market_close_message(movers, summary)

        sent = 0
        for user in users:
            ok = await send_telegram_broadcast(str(user["chat_id"]), message)
            if ok:
                sent += 1

        logger.info(
            "Market close broadcast complete: %d/%d sent", sent, len(users)
        )
    except Exception as exc:
        logger.error("Market close broadcast error: %s", exc, exc_info=True)


# ─── Scheduler setup ──────────────────────────────────────────────────────────

def create_market_broadcast_scheduler() -> AsyncIOScheduler:
    """
    Create and configure the APScheduler for market broadcasts.

    Schedule (UTC):
      • 07:00 UTC (08:00 WAT) Mon–Fri — Market Open
      • 15:00 UTC (16:00 WAT) Mon–Fri — Market Close
    """
    scheduler = AsyncIOScheduler(timezone="UTC")

    # Market Open: 08:00 WAT = 07:00 UTC, weekdays only
    scheduler.add_job(
        broadcast_market_open,
        trigger=CronTrigger(
            hour=MARKET_OPEN_HOUR_UTC,
            minute=0,
            day_of_week="mon-fri",
            timezone="UTC",
        ),
        id="market_open_broadcast",
        name="Telegram Market Open Broadcast",
        replace_existing=True,
        misfire_grace_time=300,  # 5 min grace period
    )

    # Market Close: 16:00 WAT = 15:00 UTC, weekdays only
    scheduler.add_job(
        broadcast_market_close,
        trigger=CronTrigger(
            hour=MARKET_CLOSE_HOUR_UTC,
            minute=0,
            day_of_week="mon-fri",
            timezone="UTC",
        ),
        id="market_close_broadcast",
        name="Telegram Market Close Broadcast",
        replace_existing=True,
        misfire_grace_time=300,
    )

    return scheduler


async def start_market_broadcast_scheduler() -> Optional[AsyncIOScheduler]:
    """Start the market broadcast scheduler. Returns the scheduler instance."""
    try:
        scheduler = create_market_broadcast_scheduler()
        scheduler.start()
        logger.info(
            "Market broadcast scheduler started: "
            "open=%02d:00 UTC, close=%02d:00 UTC (Mon–Fri)",
            MARKET_OPEN_HOUR_UTC,
            MARKET_CLOSE_HOUR_UTC,
        )
        return scheduler
    except Exception as exc:
        logger.error("Failed to start market broadcast scheduler: %s", exc)
        return None
