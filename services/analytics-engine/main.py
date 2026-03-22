"""
NEXCOM Analytics Engine — FastAPI (Port 8006)
=============================================
Market microstructure analytics, OHLCV candles, volume analysis,
price discovery, exchange statistics, and portfolio analytics.

Endpoints:
  GET  /health
  GET  /api/v1/analytics/microstructure/{symbol}
  GET  /api/v1/analytics/volume/{symbol}
  GET  /api/v1/analytics/price-discovery/{symbol}
  GET  /api/v1/analytics/exchange/stats
  GET  /api/v1/analytics/top-movers
  GET  /api/v1/analytics/most-active
  GET  /api/v1/analytics/ohlcv/{symbol}
  GET  /api/v1/analytics/trades/{symbol}
  GET  /api/v1/analytics/portfolio/{user_id}
  GET  /api/v1/analytics/liquidity/{symbol}
  POST /api/v1/analytics/market-impact
  GET  /api/v1/analytics/exchange/report
"""
from __future__ import annotations

import hashlib
import math
import os
import time
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

# ─── Configuration ────────────────────────────────────────────────────────────
ENVIRONMENT = os.getenv("ENVIRONMENT", "development")
MATCHING_ENGINE_URL = os.getenv("MATCHING_ENGINE_URL", "http://localhost:8080")
INGESTION_ENGINE_URL = os.getenv("INGESTION_ENGINE_URL", "http://localhost:8009")
DATABASE_URL = os.getenv("DATABASE_URL", "")
PORT = int(os.getenv("ANALYTICS_ENGINE_PORT", "8006"))

# ─── App Setup ────────────────────────────────────────────────────────────────
app = FastAPI(
    title="NEXCOM Analytics Engine",
    version="1.0.0",
    description="Market microstructure analytics, OHLCV, volume analysis, and exchange statistics",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ─── Instrument registry ──────────────────────────────────────────────────────
INSTRUMENTS = {
    "GINGER-NG-SPOT": {"name": "Ginger (Nigeria)", "category": "SPICE", "base_price": 1850, "currency": "NGN"},
    "MAIZE-NG-SPOT": {"name": "Maize (Nigeria)", "category": "GRAIN", "base_price": 290, "currency": "NGN"},
    "SORGHUM-NG-SPOT": {"name": "Sorghum (Nigeria)", "category": "GRAIN", "base_price": 185, "currency": "NGN"},
    "SOYBEANS-NG-SPOT": {"name": "Soybeans (Nigeria)", "category": "OILSEED", "base_price": 520, "currency": "NGN"},
    "SESAME-NG-SPOT": {"name": "Sesame (Nigeria)", "category": "OILSEED", "base_price": 1100, "currency": "NGN"},
    "COWPEA-NG-SPOT": {"name": "Cowpea (Nigeria)", "category": "LEGUME", "base_price": 650, "currency": "NGN"},
    "COCOA-SPOT": {"name": "Cocoa", "category": "SOFT", "base_price": 3200, "currency": "USD"},
    "COFFEE-SPOT": {"name": "Coffee", "category": "SOFT", "base_price": 185, "currency": "USD"},
    "COTTON-SPOT": {"name": "Cotton", "category": "FIBER", "base_price": 82, "currency": "USD"},
    "PALM-OIL-SPOT": {"name": "Palm Oil", "category": "OILSEED", "base_price": 920, "currency": "USD"},
    "GROUNDNUT-SPOT": {"name": "Groundnut", "category": "OILSEED", "base_price": 1250, "currency": "NGN"},
    "WHEAT-FUTURES": {"name": "Wheat Futures", "category": "GRAIN", "base_price": 610, "currency": "USD"},
    "CORN-FUTURES": {"name": "Corn Futures", "category": "GRAIN", "base_price": 480, "currency": "USD"},
    "SOYBEAN-FUTURES": {"name": "Soybean Futures", "category": "OILSEED", "base_price": 1380, "currency": "USD"},
    "CRUDE-OIL-WTI": {"name": "Crude Oil WTI", "category": "ENERGY", "base_price": 78.5, "currency": "USD"},
    "CRUDE-OIL-BRENT": {"name": "Crude Oil Brent", "category": "ENERGY", "base_price": 82.3, "currency": "USD"},
    "NATURAL-GAS": {"name": "Natural Gas", "category": "ENERGY", "base_price": 2.85, "currency": "USD"},
    "GOLD-SPOT": {"name": "Gold Spot", "category": "METAL", "base_price": 2050, "currency": "USD"},
    "SILVER-SPOT": {"name": "Silver Spot", "category": "METAL", "base_price": 24.5, "currency": "USD"},
    "COPPER-LME": {"name": "Copper LME", "category": "METAL", "base_price": 8750, "currency": "USD"},
}

# ─── Deterministic price simulation ──────────────────────────────────────────
def _seed_price(symbol: str, ts_seconds: int, base: float) -> float:
    """Deterministic price based on symbol + timestamp seed (no Math.random)."""
    h = int(hashlib.md5(f"{symbol}:{ts_seconds // 300}".encode()).hexdigest(), 16)
    drift = ((h % 10000) / 10000 - 0.5) * 0.02  # ±1%
    return round(base * (1 + drift), 6)


def _generate_ohlcv(symbol: str, interval_seconds: int, num_candles: int, base_price: float) -> List[Dict]:
    """Generate deterministic OHLCV candles for a symbol."""
    now_ts = int(time.time())
    candles = []
    price = base_price
    for i in range(num_candles, 0, -1):
        ts = now_ts - i * interval_seconds
        h = int(hashlib.md5(f"{symbol}:{ts}".encode()).hexdigest(), 16)
        open_p = price
        close_p = price * (1 + ((h % 10000) / 10000 - 0.5) * 0.015)
        high_p = max(open_p, close_p) * (1 + (h % 100) / 10000)
        low_p = min(open_p, close_p) * (1 - (h % 100) / 10000)
        volume = round(((h % 5000) + 500) * (base_price / 1000 if base_price > 1000 else 1), 2)
        candles.append({
            "timestamp": ts * 1000,
            "open": round(open_p, 6),
            "high": round(high_p, 6),
            "low": round(low_p, 6),
            "close": round(close_p, 6),
            "volume": volume,
        })
        price = close_p
    return candles


INTERVAL_SECONDS = {
    "1m": 60, "5m": 300, "15m": 900, "1h": 3600,
    "4h": 14400, "1d": 86400, "1w": 604800,
}

# ─── Health ───────────────────────────────────────────────────────────────────
@app.get("/health")
async def health():
    return {
        "status": "ok",
        "service": "analytics-engine",
        "version": "1.0.0",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "instruments": len(INSTRUMENTS),
    }


# ─── Market Microstructure ────────────────────────────────────────────────────
@app.get("/api/v1/analytics/microstructure/{symbol}")
async def get_market_microstructure(symbol: str):
    info = INSTRUMENTS.get(symbol)
    if not info:
        raise HTTPException(status_code=404, detail=f"Symbol {symbol} not found")
    base = info["base_price"]
    ts = int(time.time())
    price = _seed_price(symbol, ts, base)
    spread = price * 0.0015
    h = int(hashlib.md5(f"{symbol}:{ts // 300}".encode()).hexdigest(), 16)
    return {
        "symbol": symbol,
        "name": info["name"],
        "bid": round(price - spread / 2, 6),
        "ask": round(price + spread / 2, 6),
        "mid": round(price, 6),
        "spread": round(spread, 6),
        "spread_bps": round((spread / price) * 10000, 2),
        "bid_depth": round(((h % 1000) + 100) * 0.1, 2),
        "ask_depth": round(((h % 800) + 80) * 0.1, 2),
        "imbalance": round(((h % 200) - 100) / 100, 4),
        "tick_size": 0.5 if base > 1000 else (0.1 if base > 100 else 0.01),
        "last_trade_price": round(price, 6),
        "last_trade_size": round(((h % 500) + 10) * 0.1, 2),
        "trades_per_minute": round((h % 20) + 1, 1),
        "price_impact_1pct": round(price * 0.01 * ((h % 500) + 100) / 1000, 2),
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }


# ─── Volume Analysis ──────────────────────────────────────────────────────────
@app.get("/api/v1/analytics/volume/{symbol}")
async def get_volume_analysis(symbol: str, period: str = Query("1d")):
    info = INSTRUMENTS.get(symbol)
    if not info:
        raise HTTPException(status_code=404, detail=f"Symbol {symbol} not found")
    base = info["base_price"]
    ts = int(time.time())
    h = int(hashlib.md5(f"{symbol}:{ts // 3600}:{period}".encode()).hexdigest(), 16)
    total_volume = round(((h % 50000) + 5000) * (base / 1000 if base > 1000 else 1), 2)
    buy_volume = round(total_volume * (0.45 + (h % 100) / 1000), 2)
    sell_volume = round(total_volume - buy_volume, 2)
    return {
        "symbol": symbol,
        "period": period,
        "total_volume": total_volume,
        "buy_volume": buy_volume,
        "sell_volume": sell_volume,
        "buy_sell_ratio": round(buy_volume / sell_volume if sell_volume > 0 else 1.0, 4),
        "vwap": round(_seed_price(symbol, ts, base) * (1 + (h % 100 - 50) / 10000), 6),
        "volume_profile": [
            {"price_level": round(base * (0.97 + i * 0.01), 4), "volume": round(total_volume * ((h >> i) % 100) / 1000, 2)}
            for i in range(7)
        ],
        "large_trades": round((h % 10) + 1, 0),
        "avg_trade_size": round(total_volume / max(1, (h % 200) + 50), 2),
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }


# ─── Price Discovery ──────────────────────────────────────────────────────────
@app.get("/api/v1/analytics/price-discovery/{symbol}")
async def get_price_discovery(symbol: str):
    info = INSTRUMENTS.get(symbol)
    if not info:
        raise HTTPException(status_code=404, detail=f"Symbol {symbol} not found")
    base = info["base_price"]
    ts = int(time.time())
    price = _seed_price(symbol, ts, base)
    h = int(hashlib.md5(f"{symbol}:{ts // 3600}".encode()).hexdigest(), 16)
    return {
        "symbol": symbol,
        "current_price": round(price, 6),
        "fair_value": round(price * (1 + (h % 200 - 100) / 10000), 6),
        "premium_discount": round((h % 200 - 100) / 10000, 6),
        "price_efficiency": round(0.85 + (h % 1500) / 10000, 4),
        "information_ratio": round(0.3 + (h % 700) / 10000, 4),
        "price_discovery_score": round(0.7 + (h % 300) / 10000, 4),
        "reference_prices": {
            "spot": round(price, 6),
            "1m_avg": round(price * (1 + (h % 100 - 50) / 10000), 6),
            "5m_avg": round(price * (1 + (h % 80 - 40) / 10000), 6),
            "1h_avg": round(price * (1 + (h % 60 - 30) / 10000), 6),
        },
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }


# ─── Exchange Statistics ──────────────────────────────────────────────────────
@app.get("/api/v1/analytics/exchange/stats")
async def get_exchange_stats():
    ts = int(time.time())
    h = int(hashlib.md5(f"exchange:{ts // 3600}".encode()).hexdigest(), 16)
    total_volume_usd = round(((h % 10000000) + 1000000), 2)
    return {
        "total_volume_24h_usd": total_volume_usd,
        "total_trades_24h": (h % 50000) + 5000,
        "active_symbols": len(INSTRUMENTS),
        "active_traders": (h % 500) + 50,
        "open_orders": (h % 2000) + 200,
        "market_cap_usd": round(total_volume_usd * 12.5, 2),
        "avg_trade_size_usd": round(total_volume_usd / max(1, (h % 50000) + 5000), 2),
        "top_category_by_volume": "GRAIN",
        "exchange_uptime_pct": 99.97,
        "latency_p99_ms": round(0.8 + (h % 50) / 100, 2),
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }


# ─── Top Movers ───────────────────────────────────────────────────────────────
@app.get("/api/v1/analytics/top-movers")
async def get_top_movers(limit: int = Query(10), direction: str = Query("both")):
    ts = int(time.time())
    movers = []
    for symbol, info in INSTRUMENTS.items():
        h = int(hashlib.md5(f"{symbol}:{ts // 3600}".encode()).hexdigest(), 16)
        change_pct = round(((h % 2000) - 1000) / 100, 2)  # ±10%
        price = _seed_price(symbol, ts, info["base_price"])
        movers.append({
            "symbol": symbol,
            "name": info["name"],
            "price": round(price, 6),
            "change_pct": change_pct,
            "volume": round(((h % 10000) + 1000) * (info["base_price"] / 1000 if info["base_price"] > 1000 else 1), 2),
            "currency": info["currency"],
        })
    movers.sort(key=lambda x: x["change_pct"], reverse=True)
    gainers = [m for m in movers if m["change_pct"] > 0][:limit]
    losers = sorted([m for m in movers if m["change_pct"] < 0], key=lambda x: x["change_pct"])[:limit]
    if direction == "gainers":
        return {"gainers": gainers, "losers": []}
    elif direction == "losers":
        return {"gainers": [], "losers": losers}
    return {"gainers": gainers[:limit], "losers": losers[:limit]}


# ─── Most Active ──────────────────────────────────────────────────────────────
@app.get("/api/v1/analytics/most-active")
async def get_most_active(limit: int = Query(10)):
    ts = int(time.time())
    active = []
    for symbol, info in INSTRUMENTS.items():
        h = int(hashlib.md5(f"{symbol}:{ts // 3600}".encode()).hexdigest(), 16)
        volume = round(((h % 50000) + 5000) * (info["base_price"] / 1000 if info["base_price"] > 1000 else 1), 2)
        active.append({
            "symbol": symbol,
            "name": info["name"],
            "volume": volume,
            "trades": (h % 5000) + 500,
            "price": round(_seed_price(symbol, ts, info["base_price"]), 6),
            "currency": info["currency"],
        })
    active.sort(key=lambda x: x["volume"], reverse=True)
    return {"symbols": active[:limit]}


# ─── OHLCV Candles ────────────────────────────────────────────────────────────
@app.get("/api/v1/analytics/ohlcv/{symbol}")
async def get_ohlcv(
    symbol: str,
    interval: str = Query("1d"),
    limit: int = Query(100),
    from_ts: Optional[int] = Query(None, alias="from"),
    to_ts: Optional[int] = Query(None, alias="to"),
):
    info = INSTRUMENTS.get(symbol)
    if not info:
        raise HTTPException(status_code=404, detail=f"Symbol {symbol} not found")
    interval_secs = INTERVAL_SECONDS.get(interval, 86400)
    candles = _generate_ohlcv(symbol, interval_secs, min(limit, 1000), info["base_price"])
    # Filter by time range if provided
    if from_ts:
        candles = [c for c in candles if c["timestamp"] >= from_ts * 1000]
    if to_ts:
        candles = [c for c in candles if c["timestamp"] <= to_ts * 1000]
    return {
        "symbol": symbol,
        "interval": interval,
        "candles": candles,
        "count": len(candles),
    }


# ─── Trade History ────────────────────────────────────────────────────────────
@app.get("/api/v1/analytics/trades/{symbol}")
async def get_trade_history(symbol: str, limit: int = Query(50)):
    info = INSTRUMENTS.get(symbol)
    if not info:
        raise HTTPException(status_code=404, detail=f"Symbol {symbol} not found")
    base = info["base_price"]
    ts = int(time.time())
    trades = []
    for i in range(min(limit, 500)):
        trade_ts = ts - i * 30  # ~30s apart
        h = int(hashlib.md5(f"{symbol}:{trade_ts}:{i}".encode()).hexdigest(), 16)
        price = _seed_price(symbol, trade_ts, base)
        qty = round(((h % 1000) + 10) * 0.01, 4)
        trades.append({
            "trade_id": f"TRD-{symbol}-{trade_ts}-{h % 10000:04d}",
            "symbol": symbol,
            "price": round(price, 6),
            "quantity": qty,
            "value": round(price * qty, 2),
            "side": "BUY" if h % 2 == 0 else "SELL",
            "timestamp": trade_ts * 1000,
        })
    return {"symbol": symbol, "trades": trades, "count": len(trades)}


# ─── Portfolio Analytics ──────────────────────────────────────────────────────
@app.get("/api/v1/analytics/portfolio/{user_id}")
async def get_portfolio_analytics(user_id: int, period: str = Query("1m")):
    ts = int(time.time())
    h = int(hashlib.md5(f"portfolio:{user_id}:{period}:{ts // 3600}".encode()).hexdigest(), 16)
    # Generate equity curve
    period_days = {"1d": 1, "1w": 7, "1m": 30, "3m": 90, "6m": 180, "1y": 365, "all": 730}.get(period, 30)
    base_value = 100000 + (h % 900000)
    equity_curve = []
    value = base_value
    for i in range(period_days, 0, -1):
        day_ts = ts - i * 86400
        dh = int(hashlib.md5(f"eq:{user_id}:{day_ts}".encode()).hexdigest(), 16)
        drift = ((dh % 10000) / 10000 - 0.47) * 0.04
        value = value * (1 + drift)
        equity_curve.append({"timestamp": day_ts * 1000, "value": round(value, 2)})
    current_value = round(value, 2)
    pnl = round(current_value - base_value, 2)
    pnl_pct = round((pnl / base_value) * 100, 4)
    return {
        "user_id": user_id,
        "period": period,
        "current_value": current_value,
        "cost_basis": base_value,
        "unrealized_pnl": pnl,
        "unrealized_pnl_pct": pnl_pct,
        "realized_pnl": round((h % 50000) - 25000, 2),
        "sharpe_ratio": round(0.5 + (h % 2000) / 1000, 4),
        "max_drawdown_pct": round(-(h % 1500) / 100, 4),
        "win_rate": round(0.45 + (h % 200) / 1000, 4),
        "equity_curve": equity_curve,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }


# ─── Liquidity Metrics ────────────────────────────────────────────────────────
@app.get("/api/v1/analytics/liquidity/{symbol}")
async def get_liquidity_metrics(symbol: str):
    info = INSTRUMENTS.get(symbol)
    if not info:
        raise HTTPException(status_code=404, detail=f"Symbol {symbol} not found")
    base = info["base_price"]
    ts = int(time.time())
    h = int(hashlib.md5(f"{symbol}:{ts // 3600}".encode()).hexdigest(), 16)
    price = _seed_price(symbol, ts, base)
    return {
        "symbol": symbol,
        "bid_ask_spread_bps": round(10 + (h % 40), 2),
        "market_depth_usd": round(((h % 1000000) + 100000), 2),
        "turnover_ratio": round(0.01 + (h % 500) / 10000, 4),
        "amihud_illiquidity": round((h % 1000) / 1000000, 8),
        "kyle_lambda": round((h % 100) / 10000, 6),
        "resiliency_score": round(0.6 + (h % 400) / 1000, 4),
        "depth_1pct": round(((h % 100000) + 10000), 2),
        "depth_2pct": round(((h % 200000) + 20000), 2),
        "depth_5pct": round(((h % 500000) + 50000), 2),
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }


# ─── Market Impact ────────────────────────────────────────────────────────────
class MarketImpactRequest(BaseModel):
    symbol: str
    side: str
    quantity: float


@app.post("/api/v1/analytics/market-impact")
async def get_market_impact(req: MarketImpactRequest):
    info = INSTRUMENTS.get(req.symbol)
    if not info:
        raise HTTPException(status_code=404, detail=f"Symbol {req.symbol} not found")
    base = info["base_price"]
    ts = int(time.time())
    price = _seed_price(req.symbol, ts, base)
    # Kyle's lambda model: impact = lambda * sqrt(quantity)
    h = int(hashlib.md5(f"{req.symbol}:{ts // 3600}".encode()).hexdigest(), 16)
    kyle_lambda = (h % 100) / 10000
    impact_bps = round(kyle_lambda * math.sqrt(req.quantity) * 100, 4)
    impact_price = round(price * (1 + impact_bps / 10000) if req.side == "BUY" else price * (1 - impact_bps / 10000), 6)
    return {
        "symbol": req.symbol,
        "side": req.side,
        "quantity": req.quantity,
        "current_price": round(price, 6),
        "estimated_fill_price": impact_price,
        "estimated_impact_bps": impact_bps,
        "estimated_impact_pct": round(impact_bps / 100, 4),
        "estimated_slippage_usd": round(abs(impact_price - price) * req.quantity, 2),
        "market_depth_available": round(((h % 100000) + 10000), 2),
        "fills_required": max(1, round(req.quantity / max(1, (h % 1000) + 100))),
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }


# ─── Exchange Report ──────────────────────────────────────────────────────────
@app.get("/api/v1/analytics/exchange/report")
async def get_exchange_report(
    from_ts: int = Query(..., alias="from"),
    to_ts: int = Query(..., alias="to"),
    format: str = Query("json"),
):
    from_dt = datetime.fromtimestamp(from_ts, tz=timezone.utc)
    to_dt = datetime.fromtimestamp(to_ts, tz=timezone.utc)
    h = int(hashlib.md5(f"report:{from_ts}:{to_ts}".encode()).hexdigest(), 16)
    duration_days = max(1, (to_ts - from_ts) // 86400)
    total_trades = (h % 100000) + 10000
    total_volume = round(((h % 100000000) + 10000000), 2)
    report = {
        "period": {
            "from": from_dt.isoformat(),
            "to": to_dt.isoformat(),
            "duration_days": duration_days,
        },
        "summary": {
            "total_trades": total_trades,
            "total_volume_usd": total_volume,
            "avg_daily_volume": round(total_volume / duration_days, 2),
            "unique_traders": (h % 1000) + 100,
            "new_registrations": (h % 200) + 20,
            "settlements_completed": (h % 50000) + 5000,
            "settlement_failures": (h % 50),
            "circuit_breaker_triggers": (h % 5),
        },
        "by_category": {
            "GRAIN": {"volume": round(total_volume * 0.35, 2), "trades": round(total_trades * 0.35)},
            "SPICE": {"volume": round(total_volume * 0.20, 2), "trades": round(total_trades * 0.20)},
            "OILSEED": {"volume": round(total_volume * 0.15, 2), "trades": round(total_trades * 0.15)},
            "ENERGY": {"volume": round(total_volume * 0.12, 2), "trades": round(total_trades * 0.12)},
            "METAL": {"volume": round(total_volume * 0.10, 2), "trades": round(total_trades * 0.10)},
            "OTHER": {"volume": round(total_volume * 0.08, 2), "trades": round(total_trades * 0.08)},
        },
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }
    if format == "csv":
        # Return CSV-formatted summary
        lines = ["metric,value"]
        for k, v in report["summary"].items():
            lines.append(f"{k},{v}")
        return {"csv": "\n".join(lines), "format": "csv"}
    return report


# ─── Entry point ──────────────────────────────────────────────────────────────
if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=PORT)
