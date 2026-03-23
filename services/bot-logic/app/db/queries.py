"""
NEXCOM Bot Logic — Database Query Helpers
==========================================
Async PostgreSQL queries using asyncpg.
"""

import logging
from typing import Optional

from app.db.pool import get_pool

logger = logging.getLogger("nexcom.bot-logic.db")


async def get_live_price(symbol: str) -> Optional[dict]:
    """Get the latest live price for a commodity symbol."""
    pool = await get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            """SELECT price::float8 as price, change_pct::float8 as change_pct,
                      high::float8 as high, low::float8 as low,
                      TO_CHAR(updated_at, 'DD Mon HH24:MI UTC') as updated_at
               FROM live_prices WHERE symbol = $1 LIMIT 1""",
            symbol,
        )
        return dict(row) if row else None


async def get_portfolio_summary(user_id: int) -> Optional[dict]:
    """Get portfolio summary for a user."""
    pool = await get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            """SELECT COUNT(*) as position_count,
                      COALESCE(SUM(quantity::float8 * avg_cost::float8), 0) as total_value,
                      COALESCE(SUM(unrealized_pnl::float8), 0) as total_pnl
               FROM positions WHERE user_id = $1""",
            user_id,
        )
        if not row or row["position_count"] == 0:
            return None

        open_orders = await conn.fetchval(
            "SELECT COUNT(*) FROM orders WHERE user_id = $1 AND status IN ('PENDING','PARTIAL')",
            user_id,
        )
        return {
            "total_value": float(row["total_value"]),
            "total_pnl": float(row["total_pnl"]),
            "position_count": int(row["position_count"]),
            "open_order_count": int(open_orders or 0),
        }


async def get_loan_summary(user_id: int) -> Optional[dict]:
    """Get active loan summary for a user."""
    pool = await get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            """SELECT bank_name,
                      requested_amount_ngn::float8 as amount,
                      status,
                      COALESCE(TO_CHAR(repayment_due_date, 'DD Mon YYYY'), 'N/A') as due_date,
                      COALESCE(approved_amount_ngn::float8, 0) as balance
               FROM bank_financing_applications
               WHERE user_id = $1 AND status NOT IN ('CLOSED','REJECTED','CANCELLED')
               ORDER BY created_at DESC LIMIT 1""",
            user_id,
        )
        return dict(row) if row else None


async def get_user_by_channel_id(channel: str, channel_id: str) -> Optional[dict]:
    """Get user linked to a WhatsApp or Telegram channel ID."""
    pool = await get_pool()
    async with pool.acquire() as conn:
        if channel == "whatsapp":
            row = await conn.fetchrow(
                """SELECT u.id, u.name, u.email, u.role
                   FROM users u
                   JOIN whatsapp_contacts wc ON wc.user_id = u.id
                   WHERE wc.wa_id = $1 AND wc.is_verified = true
                   LIMIT 1""",
                channel_id,
            )
        elif channel == "telegram":
            row = await conn.fetchrow(
                """SELECT u.id, u.name, u.email, u.role
                   FROM users u
                   JOIN telegram_contacts tc ON tc.user_id = u.id
                   WHERE tc.telegram_id = $1 AND tc.is_verified = true
                   LIMIT 1""",
                channel_id,
            )
        else:
            return None
        return dict(row) if row else None


async def set_price_alert(
    user_id: int,
    symbol: str,
    target_price: float,
    condition: str = "ABOVE",
) -> int:
    """Create a price alert for a user. Returns the new alert id."""
    pool = await get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            """INSERT INTO price_alerts (user_id, symbol, condition, target_price, triggered, notified)
               VALUES ($1, $2, $3::alert_condition, $4, false, false)
               RETURNING id""",
            user_id, symbol.upper(), condition.upper(), target_price,
        )
        return row["id"] if row else 0


async def get_price_alerts(user_id: int) -> list:
    """List all active (non-triggered) price alerts for a user."""
    pool = await get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """SELECT id, symbol, condition, target_price::float8 as target_price,
                      triggered, TO_CHAR(created_at, 'DD Mon HH24:MI') as created_at
               FROM price_alerts
               WHERE user_id = $1 AND triggered = false
               ORDER BY created_at DESC""",
            user_id,
        )
        return [dict(r) for r in rows]


async def delete_price_alert(user_id: int, alert_id: int) -> bool:
    """Delete a price alert by id (only if it belongs to the user). Returns True if deleted."""
    pool = await get_pool()
    async with pool.acquire() as conn:
        result = await conn.execute(
            "DELETE FROM price_alerts WHERE id = $1 AND user_id = $2",
            alert_id, user_id,
        )
        return result == "DELETE 1"
