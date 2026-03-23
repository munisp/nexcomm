"""
NEXCOM Bot Logic — Message Router
===================================
Routes classified intents to the appropriate handler function.
Maintains per-user conversation state in Redis.
"""

import logging
from typing import Any

import redis.asyncio as aioredis

from app.nlp.intent import classify
from app.db.queries import (
    get_live_price,
    get_portfolio_summary,
    get_loan_summary,
    get_user_by_channel_id,
    set_price_alert,
    get_price_alerts,
    delete_price_alert,
)
from app.kafka.producer import KafkaProducer

logger = logging.getLogger("nexcom.bot-logic.router")

# Redis client (lazy init)
_redis: aioredis.Redis | None = None


async def get_redis() -> aioredis.Redis:
    global _redis
    if _redis is None:
        import os
        _redis = aioredis.from_url(
            os.getenv("REDIS_URL", "redis://localhost:6379"),
            decode_responses=True,
        )
    return _redis


async def process_message(
    channel: str,
    from_id: str,
    text: str,
    kafka: KafkaProducer,
) -> dict[str, Any]:
    """
    Main message processing pipeline:
    1. Classify intent
    2. Check conversation state (Redis)
    3. Dispatch to handler
    4. Return reply + metadata
    """
    # ─── EXECUTE_ORDER: Telegram inline keyboard confirmed order ──────────────────────────────────────
    # Format: "EXECUTE_ORDER:BUY MAIZE 10"
    if text.startswith("EXECUTE_ORDER:"):
        order_str = text[len("EXECUTE_ORDER:"):].strip()
        parts = order_str.split()
        if len(parts) >= 3:
            side, symbol, qty_str = parts[0].upper(), parts[1].upper(), parts[2]
            try:
                qty = float(qty_str)
            except ValueError:
                return {"reply": "Invalid order quantity.", "intent": "EXECUTE_ORDER", "confidence": 1.0}
            user = await get_user_by_channel_id(channel, from_id)
            if not user:
                return {"reply": _auth_required_message(channel), "intent": "EXECUTE_ORDER", "confidence": 1.0}
            redis = await get_redis()
            kafka.emit("nexcom.bot.order.placed", {
                "user_id": user["id"],
                "side": side,
                "symbol": symbol,
                "quantity": qty,
                "source": channel.upper(),
                "channel_id": from_id,
            })
            price_data = await get_live_price(symbol)
            price_str = f"\u20a6{price_data['price']:,.0f}/MT" if price_data else "market price"
            est_value = f"\u20a6{price_data['price'] * qty:,.0f}" if price_data else "N/A"
            reply = (
                f"\u2705 *Order Placed*\n\n"
                f"{'\ud83d\udcc8 BUY' if side == 'BUY' else '\ud83d\udcc9 SELL'} {qty:.0f} MT *{symbol}*\n"
                f"Price: {price_str}\n"
                f"Est. Value: {est_value}\n"
                f"Status: PENDING\n\n"
                "Your order is being processed. You'll receive a confirmation once matched.\n"
                "Track at nexcom.exchange/orders"
            )
            return {"reply": reply, "intent": "EXECUTE_ORDER", "confidence": 1.0}
        return {"reply": "Invalid order format.", "intent": "EXECUTE_ORDER", "confidence": 1.0}

    intent = classify(text)
    logger.info(f"[{channel}] {from_id}: '{text}' \u2192 {intent.name} ({intent.confidence:.2f})")

    # Get user from DB (may be None for unverified users)
    user = await get_user_by_channel_id(channel, from_id)

    # Check for active conversation state
    redis = await get_redis()
    state_key = f"bot:{channel}:{from_id}:state"
    conv_state = await redis.hgetall(state_key)

    # Handle active conversation flows first
    if conv_state.get("flow"):
        reply = await handle_flow(channel, from_id, text, conv_state, user, redis, kafka)
        return {"reply": reply, "intent": intent.name, "confidence": intent.confidence}

    # Route by intent
    reply = await dispatch(intent, channel, from_id, user, redis, kafka)
    return {"reply": reply, "intent": intent.name, "confidence": intent.confidence}


async def dispatch(intent, channel, from_id, user, redis, kafka) -> str:
    """Dispatch to the correct handler based on intent."""
    name = intent.name
    entities = intent.entities

    if name == "GREETING":
        return await handle_greeting(channel, from_id, user)

    if name == "HELP":
        return handle_help(channel)

    if name == "PRICE_CHECK":
        symbol = entities.get("symbol")
        if not symbol:
            return "Which commodity? E.g.:\n• *price MAIZE*\n• *price SOYBEANS*\n• *price GINGER*"
        return await handle_price(symbol)

    if name == "PORTFOLIO":
        if not user:
            return _auth_required_message(channel)
        return await handle_portfolio(user["id"])

    if name == "TRADE_BUY":
        if not user:
            return _auth_required_message(channel)
        symbol = entities.get("symbol")
        qty = entities.get("quantity")
        if not symbol or not qty:
            return "Please specify: *buy SYMBOL QUANTITY*\nExample: *buy MAIZE 10*"
        return await handle_trade(user["id"], "BUY", symbol, qty, redis, from_id, channel, kafka)

    if name == "TRADE_SELL":
        if not user:
            return _auth_required_message(channel)
        symbol = entities.get("symbol")
        qty = entities.get("quantity")
        if not symbol or not qty:
            return "Please specify: *sell SYMBOL QUANTITY*\nExample: *sell MAIZE 10*"
        return await handle_trade(user["id"], "SELL", symbol, qty, redis, from_id, channel, kafka)

    if name == "LOAN_STATUS":
        if not user:
            return _auth_required_message(channel)
        return await handle_loan_status(user["id"])

    if name == "LOAN_APPLY":
        if not user:
            return _auth_required_message(channel)
        return "To apply for a loan, visit nexcom.exchange/banking or contact your nearest NEXCOM agent.\n\nYour farmer profile will be used to pre-qualify you."

    if name == "ALERT_SET":
        if not user:
            return _auth_required_message(channel)
        symbol = entities.get("symbol")
        price = entities.get("price")
        condition = entities.get("condition", "ABOVE")
        if not symbol or not price:
            return (
                "Please specify: *alert set SYMBOL PRICE [ABOVE|BELOW]*\n"
                "Example: *alert set GINGER 500* or */alert set MAIZE 50000 BELOW*"
            )
        return await handle_alert_set(user["id"], symbol, price, condition)

    if name == "ALERT_LIST":
        if not user:
            return _auth_required_message(channel)
        return await handle_alert_list(user["id"])

    if name == "ALERT_DELETE":
        if not user:
            return _auth_required_message(channel)
        alert_id = entities.get("alert_id")
        if not alert_id:
            return (
                "Please specify the alert ID to delete.\n"
                "Example: */alert delete 42*\n\n"
                "Type */alert list* to see your alert IDs."
            )
        return await handle_alert_delete(user["id"], int(alert_id))

    if name == "MARKET_NEWS":
        return "📰 *Latest Market Update*\n\nVisit nexcom.exchange/market for live commodity prices, news, and analysis.\n\nOr type *price SYMBOL* for a specific commodity."

    if name == "ACCOUNT_LINK":
        return _account_link_message(channel)

    # UNKNOWN
    return (
        "I didn't understand that. Try:\n"
        "• *price MAIZE* — commodity price\n"
        "• *portfolio* — your positions\n"
        "• *alert set GINGER 500* — price alert\n"
        "• *help* — all commands\n\n"
        "Or visit nexcom.exchange for full access."
    )


# ─── Intent Handlers ──────────────────────────────────────────────────────────

async def handle_greeting(channel: str, from_id: str, user) -> str:
    name = user["name"] if user else "Farmer"
    if user:
        return (
            f"Welcome back, *{name}*! 🌾\n\n"
            "Quick actions:\n"
            "• *price MAIZE* — live price\n"
            "• *portfolio* — your positions\n"
            "• *loan* — loan status\n"
            "• *alert list* — your price alerts\n"
            "• *help* — all commands"
        )
    return (
        "Welcome to *NEXCOM Exchange*! 🌾\n\n"
        "Nigeria's premier commodity exchange.\n\n"
        "• *price MAIZE* — live commodity prices\n"
        "• *help* — all commands\n\n"
        f"To access your account, {_account_link_message(channel)}"
    )


def handle_help(channel: str) -> str:
    if channel == "telegram":
        return (
            "*NEXCOM Exchange Commands* 🌾\n\n"
            "*Public:*\n"
            "/price SYMBOL — Live price\n"
            "/help — This message\n\n"
            "*Account required:*\n"
            "/portfolio — Positions & P&L\n"
            "/trade BUY|SELL SYMBOL QTY — Place order\n"
            "/loan — Loan status\n\n"
            "*Price Alerts:*\n"
            "/alert set SYMBOL PRICE [ABOVE|BELOW] — Set alert\n"
            "/alert list — View your alerts\n"
            "/alert delete ID — Delete an alert\n\n"
            "*Setup:*\n"
            "/verify — Link your account\n"
            "/unsubscribe — Stop notifications"
        )
    # WhatsApp
    return (
        "*NEXCOM Exchange Commands* 🌾\n\n"
        "*Public:*\n"
        "• *price SYMBOL* — Live price\n"
        "• *help* — This message\n\n"
        "*Account required:*\n"
        "• *portfolio* — Positions & P&L\n"
        "• *buy/sell SYMBOL QTY* — Place order\n"
        "• *loan* — Loan status\n\n"
        "*Price Alerts:*\n"
        "• *alert set GINGER 500* — Set alert\n"
        "• *alert list* — View your alerts\n"
        "• *alert delete 42* — Delete alert #42\n\n"
        "Visit nexcom.exchange to create an account."
    )


async def handle_price(symbol: str) -> str:
    price_data = await get_live_price(symbol)
    if not price_data:
        return f"No price data available for *{symbol}*.\n\nAvailable: MAIZE, SORGHUM, SOYBEANS, SESAME, COCOA, COTTON, GINGER, GROUNDNUT"

    change_emoji = "📈" if price_data["change_pct"] >= 0 else "📉"
    sign = "+" if price_data["change_pct"] >= 0 else ""

    return (
        f"*{symbol}* — Live Price\n\n"
        f"💰 ₦{price_data['price']:,.0f}/MT\n"
        f"{change_emoji} {sign}{price_data['change_pct']:.2f}% today\n"
        f"📊 High: ₦{price_data['high']:,.0f} | Low: ₦{price_data['low']:,.0f}\n\n"
        f"_Updated: {price_data['updated_at']}_\n\n"
        "Type *price SYMBOL* for another commodity."
    )


async def handle_portfolio(user_id: int) -> str:
    summary = await get_portfolio_summary(user_id)
    if not summary:
        return (
            "📊 *Your Portfolio*\n\n"
            "No open positions found.\n\n"
            "To start trading, visit nexcom.exchange\n"
            "or type *buy SYMBOL QUANTITY*"
        )

    pnl_emoji = "📈" if summary["total_pnl"] >= 0 else "📉"
    sign = "+" if summary["total_pnl"] >= 0 else ""

    return (
        f"📊 *Your Portfolio*\n\n"
        f"💼 Total Value: ₦{summary['total_value']:,.0f}\n"
        f"{pnl_emoji} P&L: {sign}₦{summary['total_pnl']:,.0f}\n"
        f"📦 Positions: {summary['position_count']}\n"
        f"📋 Open Orders: {summary['open_order_count']}\n\n"
        "For full details, visit nexcom.exchange/portfolio"
    )


async def handle_trade(user_id, side, symbol, qty, redis, from_id, channel, kafka) -> str:
    # Store pending order in Redis for confirmation
    state_key = f"bot:{channel}:{from_id}:state"
    await redis.hset(state_key, mapping={
        "flow": "trade_confirm",
        "side": side,
        "symbol": symbol,
        "quantity": str(qty),
        "user_id": str(user_id),
    })
    await redis.expire(state_key, 300)  # 5 min timeout

    price_data = await get_live_price(symbol)
    price_str = f"₦{price_data['price']:,.0f}/MT" if price_data else "market price"

    return (
        f"*Order Preview*\n\n"
        f"{'📈 BUY' if side == 'BUY' else '📉 SELL'} {qty} MT {symbol}\n"
        f"Price: {price_str}\n"
        f"Est. Value: {'₦{:,.0f}'.format(price_data['price'] * qty) if price_data else 'N/A'}\n\n"
        "Reply *confirm* to place this order\n"
        "Reply *cancel* to cancel"
    )


async def handle_loan_status(user_id: int) -> str:
    loan = await get_loan_summary(user_id)
    if not loan:
        return (
            "🏦 *Loan Status*\n\n"
            "No active loans found.\n\n"
            "To apply for financing:\n"
            "• Visit nexcom.exchange/banking\n"
            "• Or type *apply for loan*"
        )

    return (
        f"🏦 *Loan Status*\n\n"
        f"Bank: {loan['bank_name']}\n"
        f"Amount: ₦{loan['amount']:,.0f}\n"
        f"Status: *{loan['status']}*\n"
        f"Due Date: {loan['due_date']}\n"
        f"Balance: ₦{loan['balance']:,.0f}\n\n"
        "For full details, visit nexcom.exchange/banking"
    )


# ─── Price Alert Handlers ─────────────────────────────────────────────────────

async def handle_alert_set(user_id: int, symbol: str, price: float, condition: str = "ABOVE") -> str:
    """Create a price alert and return confirmation."""
    condition = condition.upper()
    if condition not in ("ABOVE", "BELOW", "CROSS_ABOVE", "CROSS_BELOW"):
        condition = "ABOVE"
    alert_id = await set_price_alert(user_id, symbol, price, condition)
    cond_label = {
        "ABOVE": "rises above",
        "BELOW": "falls below",
        "CROSS_ABOVE": "crosses above",
        "CROSS_BELOW": "crosses below",
    }.get(condition, condition)
    return (
        f"🔔 *Price Alert Set* (ID: {alert_id})\n\n"
        f"You'll be notified when *{symbol.upper()}* {cond_label} ₦{price:,.0f}/MT\n\n"
        "Type */alert list* to see all your alerts\n"
        f"Type */alert delete {alert_id}* to remove this alert"
    )


async def handle_alert_list(user_id: int) -> str:
    """List all active price alerts for a user."""
    alerts = await get_price_alerts(user_id)
    if not alerts:
        return (
            "🔕 *No Active Alerts*\n\n"
            "You have no price alerts set.\n\n"
            "To set one: */alert set GINGER 500*"
        )
    cond_label = {
        "ABOVE": "↑ above",
        "BELOW": "↓ below",
        "CROSS_ABOVE": "↑ cross",
        "CROSS_BELOW": "↓ cross",
    }
    lines = ["🔔 *Your Price Alerts*\n"]
    for a in alerts:
        label = cond_label.get(a["condition"], a["condition"])
        lines.append(
            f"• [{a['id']}] *{a['symbol']}* {label} ₦{a['target_price']:,.0f} — {a['created_at']}"
        )
    lines.append("\nType */alert delete ID* to remove an alert.")
    return "\n".join(lines)


async def handle_alert_delete(user_id: int, alert_id: int) -> str:
    """Delete a price alert by ID."""
    deleted = await delete_price_alert(user_id, alert_id)
    if deleted:
        return f"✅ Alert #{alert_id} deleted."
    return f"❌ Alert #{alert_id} not found or does not belong to your account."


async def handle_flow(channel, from_id, text, conv_state, user, redis, kafka) -> str:
    """Handle multi-step conversation flows."""
    flow = conv_state.get("flow")
    state_key = f"bot:{channel}:{from_id}:state"

    if flow == "trade_confirm":
        text_lower = text.lower().strip()
        if text_lower in ("confirm", "yes", "ok", "proceed", "1"):
            # Place the order
            side = conv_state.get("side")
            symbol = conv_state.get("symbol")
            qty = float(conv_state.get("quantity", 0))
            user_id = int(conv_state.get("user_id", 0))

            # Clear state
            await redis.delete(state_key)

            # Emit Kafka event for order placement
            kafka.emit("nexcom.bot.order.placed", {
                "user_id": user_id,
                "side": side,
                "symbol": symbol,
                "quantity": qty,
                "source": channel.upper(),
                "channel_id": from_id,
            })

            return (
                f"✅ *Order Placed*\n\n"
                f"{'📈 BUY' if side == 'BUY' else '📉 SELL'} {qty} MT {symbol}\n"
                f"Status: PENDING\n\n"
                "Your order is being processed. You'll receive a confirmation shortly.\n"
                "Track at nexcom.exchange/orders"
            )
        elif text_lower in ("cancel", "no", "stop", "0"):
            await redis.delete(state_key)
            return "❌ Order cancelled."
        else:
            return "Please reply *confirm* to place the order or *cancel* to cancel."

    # Unknown flow — clear state
    await redis.delete(state_key)
    return "Something went wrong. Please try again."


# ─── Helpers ──────────────────────────────────────────────────────────────────

def _auth_required_message(channel: str) -> str:
    if channel == "telegram":
        return "This feature requires a NEXCOM account.\n\nType /verify to link your account, or visit nexcom.exchange to register."
    return "This feature requires a NEXCOM account.\n\nVisit nexcom.exchange to register, then reply *link account* to connect."


def _account_link_message(channel: str) -> str:
    if channel == "telegram":
        return "type /verify to link your account."
    return "visit nexcom.exchange/settings/whatsapp to link your account."
