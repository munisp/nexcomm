"""
Gold layer: REAL computation of the feature definitions registered (but never
computed) in services/ingestion-engine/lakehouse/gold.py.

Produces, from silver tables:
  - gold/price_features     per (commodity, date): return_1d/5d/20d,
                            volatility_realized_20d/60d, ma_5/10/20/50,
                            ema_12/26, rsi_14, macd(+signal,histogram),
                            bollinger_upper/lower, atr_14 — implementing the
                            formulas in the ingestion-engine feature store.
  - gold/volume_features    per (commodity, date): vwap, volume_24h,
                            trade_count, buy_sell_ratio, large_trade_pct.
  - gold/risk_features      per (commodity, date): var_95_1d, var_99_1d,
                            cvar_99, max_drawdown_20d, sharpe_ratio_20d.
  - gold/user_behavior      per user aggregates feeding credit + fraud models.
  - gold/graph_edges        payer/payee transaction edge list.
  - gold/price_sequences.npz  (T,F) feature sequences + next-day log-return
                            targets per commodity for PriceLSTM.

Only definitions whose source data actually exists in silver are computed;
no fabricated sentiment/positions/COT values are emitted.

Closes audit A3 gap "Silver/Gold metadata-only": feature *definitions* existed,
feature *data* did not.
"""
from __future__ import annotations

import logging
from pathlib import Path

import numpy as np
import pandas as pd

from mlplatform.lakehouse.silver import read_silver
from mlplatform.lakehouse.storage import write_table

logger = logging.getLogger("mlplatform.lakehouse.gold")


# ── Indicator helpers (formulas per ingestion-engine/lakehouse/gold.py) ──────
def _ema(series: pd.Series, span: int) -> pd.Series:
    return series.ewm(span=span, adjust=False).mean()


def _rsi(close: pd.Series, period: int = 14) -> pd.Series:
    delta = close.diff()
    gain = delta.clip(lower=0).ewm(alpha=1 / period, adjust=False).mean()
    loss = (-delta.clip(upper=0)).ewm(alpha=1 / period, adjust=False).mean()
    rs = gain / loss.replace(0, np.nan)
    return 100 - 100 / (1 + rs)


def _atr(high: pd.Series, low: pd.Series, close: pd.Series, period: int = 14) -> pd.Series:
    prev_close = close.shift(1)
    tr = pd.concat([
        high - low,
        (high - prev_close).abs(),
        (low - prev_close).abs(),
    ], axis=1).max(axis=1)
    return tr.ewm(span=period, adjust=False).mean()


def compute_price_features(prices: pd.DataFrame) -> pd.DataFrame:
    """gold/price_features — per (commodity, date)."""
    if prices.empty:
        return pd.DataFrame()
    prices = prices.copy()
    for c in ("open", "high", "low", "close", "volume_mt"):
        prices[c] = pd.to_numeric(prices[c], errors="coerce")
    prices = prices.dropna(subset=["close"]).sort_values(["commodity", "date"])
    frames = []
    for commodity, g in prices.groupby("commodity"):
        g = g.reset_index(drop=True)
        close = g["close"]
        log_close = np.log(close)
        out = pd.DataFrame({"commodity": commodity, "date": g["date"]})
        out["close"] = close
        out["return_1d"] = log_close.diff(1)
        out["return_5d"] = log_close.diff(5)
        out["return_20d"] = log_close.diff(20)
        out["volatility_realized_20d"] = out["return_1d"].rolling(20).std() * np.sqrt(252)
        out["volatility_realized_60d"] = out["return_1d"].rolling(60).std() * np.sqrt(252)
        for w in (5, 10, 20, 50):
            out[f"ma_{w}"] = close.rolling(w).mean()
        out["ema_12"] = _ema(close, 12)
        out["ema_26"] = _ema(close, 26)
        out["rsi_14"] = _rsi(close, 14)
        out["macd"] = out["ema_12"] - out["ema_26"]
        out["macd_signal"] = _ema(out["macd"], 9)
        out["macd_histogram"] = out["macd"] - out["macd_signal"]
        std20 = close.rolling(20).std()
        out["bollinger_upper"] = out["ma_20"] + 2 * std20
        out["bollinger_lower"] = out["ma_20"] - 2 * std20
        out["atr_14"] = _atr(g["high"], g["low"], close, 14)
        frames.append(out)
    return pd.concat(frames, ignore_index=True)


def compute_volume_features(txns: pd.DataFrame) -> pd.DataFrame:
    """gold/volume_features — per (commodity, date) from TRADE txns."""
    if txns.empty:
        return pd.DataFrame()
    t = txns.copy()
    t["amount_ngn"] = pd.to_numeric(t["amount_ngn"], errors="coerce")
    t["quantity_mt"] = pd.to_numeric(t["quantity_mt"], errors="coerce")
    t = t[(t["type"] == "TRADE") & (t["commodity"] != "") & t["amount_ngn"].notna()]
    if t.empty:
        return pd.DataFrame()
    frames = []
    for (commodity, d), g in t.groupby(["commodity", "date"]):
        vol = g["quantity_mt"].sum()
        vwap = float((g["amount_ngn"]).sum() / vol) if vol > 0 else np.nan
        n = len(g)
        buys = int((g["side"] == "BUY").sum())
        sells = int((g["side"] == "SELL").sum())
        threshold = g["quantity_mt"].quantile(0.95) if n >= 20 else np.inf
        large_pct = float(g.loc[g["quantity_mt"] >= threshold, "quantity_mt"].sum() / vol) if vol > 0 else 0.0
        frames.append({
            "commodity": commodity, "date": d, "vwap": vwap,
            "volume_24h": float(vol), "trade_count": n,
            "buy_sell_ratio": buys / max(1, sells),
            "large_trade_pct": large_pct,
            "notional_volume_ngn": float(g["amount_ngn"].sum()),
        })
    return pd.DataFrame(frames)


def compute_risk_features(price_features: pd.DataFrame) -> pd.DataFrame:
    """gold/risk_features — VaR/CVaR/drawdown/Sharpe per (commodity, date)."""
    if price_features.empty:
        return pd.DataFrame()
    frames = []
    for commodity, g in price_features.groupby("commodity"):
        g = g.sort_values("date").reset_index(drop=True)
        r = g["return_1d"]
        out = pd.DataFrame({"commodity": commodity, "date": g["date"]})
        out["var_95_1d"] = r.rolling(60, min_periods=20).quantile(0.05)
        out["var_99_1d"] = r.rolling(60, min_periods=20).quantile(0.01)

        def _cvar99(window: pd.Series) -> float:
            q = window.quantile(0.01)
            tail = window[window <= q]
            return float(tail.mean()) if len(tail) else float(q)

        out["cvar_99"] = r.rolling(60, min_periods=20).apply(_cvar99, raw=False)
        close = g["close"]
        roll_max = close.rolling(20, min_periods=5).max()
        drawdown = (roll_max - close) / roll_max
        out["max_drawdown_20d"] = drawdown.rolling(20, min_periods=5).max()
        mean_r = r.rolling(20, min_periods=10).mean()
        std_r = r.rolling(20, min_periods=10).std()
        out["sharpe_ratio_20d"] = (mean_r / std_r.replace(0, np.nan)) * np.sqrt(252)
        frames.append(out)
    return pd.concat(frames, ignore_index=True)


def compute_user_behavior(txns: pd.DataFrame, users: pd.DataFrame) -> pd.DataFrame:
    """gold/user_behavior — per-user aggregates used by credit + fraud models.

    Everything here is computed from the user's own transaction history
    (no labels) so it can be used at inference time without leakage.
    """
    if txns.empty or users.empty:
        return pd.DataFrame()
    t = txns.copy()
    t["amount_ngn"] = pd.to_numeric(t["amount_ngn"], errors="coerce")
    t["timestamp"] = pd.to_datetime(t["timestamp"], utc=True, errors="coerce")
    t = t.dropna(subset=["timestamp"])
    now = t["timestamp"].max()

    rows = []
    for uid, g in t.groupby("payer_id"):
        g = g.sort_values("timestamp")
        active_days = max(1, g["timestamp"].dt.date.nunique())
        trades = g[g["type"] == "TRADE"]
        orders = g[g["type"] == "ORDER"]
        deposits = g[g["type"] == "DEPOSIT"]
        settlements = g[g["type"] == "SETTLEMENT"].copy()
        settlements["settlement_delay_hours"] = pd.to_numeric(
            settlements["settlement_delay_hours"], errors="coerce")
        night = g["timestamp"].dt.hour.isin([22, 23, 0, 1, 2, 3, 4])
        first_seen = g["timestamp"].min()
        rows.append({
            "user_id": uid,
            "txn_count": len(g),
            "trade_count": len(trades),
            "order_count": len(orders),
            "cancel_count": int((g["status"] == "CANCELLED").sum()),
            "cancel_rate": float((g["status"] == "CANCELLED").mean()),
            "active_days": active_days,
            "txns_per_day": len(g) / active_days,
            "total_amount_ngn": float(g["amount_ngn"].sum()),
            "avg_amount_ngn": float(g["amount_ngn"].mean()),
            "max_amount_ngn": float(g["amount_ngn"].max()),
            "large_order_ratio": float((g["amount_ngn"] >= 10_000_000).mean()),
            "night_trading_ratio": float(night.mean()),
            "weekend_ratio": float((g["timestamp"].dt.weekday >= 5).mean()),
            "distinct_commodities": int(g.loc[g["commodity"] != "", "commodity"].nunique()),
            "distinct_counterparties": int(g["payee_id"].nunique()),
            "distinct_devices": int(g["device_id"].nunique()),
            "distinct_ips": int(g["ip_address"].nunique()),
            "distinct_states": int(g["state"].nunique()),
            "deposit_count": len(deposits),
            "sub_threshold_deposit_ratio": float(
                ((deposits["amount_ngn"] >= 5_000_000) & (deposits["amount_ngn"] < 10_000_000)).mean()
            ) if len(deposits) else 0.0,
            "settlement_count": len(settlements),
            "settlement_on_time_rate": float((settlements["settlement_delay_hours"] <= 24).mean())
            if len(settlements) else 1.0,
            "avg_settlement_delay_hours": float(settlements["settlement_delay_hours"].mean())
            if len(settlements) else 0.0,
            "failed_settlement_count": int((settlements["status"] == "FAILED").sum()),
            "account_age_days_at_max": float((now - first_seen).days),
            "receipt_uses": int((g["receipt_id"] != "").sum()),
            "distinct_receipts": int(g.loc[g["receipt_id"] != "", "receipt_id"].nunique()),
        })
    ub = pd.DataFrame(rows)
    # aggregates only, keyed by user_id — consumers join to users themselves
    return ub


def compute_graph_edges(txns: pd.DataFrame) -> pd.DataFrame:
    """gold/graph_edges — aggregated payer→payee transaction edge list."""
    if txns.empty:
        return pd.DataFrame()
    t = txns.copy()
    t["amount_ngn"] = pd.to_numeric(t["amount_ngn"], errors="coerce").fillna(0)
    t = t[t["payee_id"].astype(str).str.startswith("U")]  # account↔account only
    edges = (
        t.groupby(["payer_id", "payee_id"])
        .agg(txn_count=("transaction_id", "count"), total_amount_ngn=("amount_ngn", "sum"))
        .reset_index()
    )
    return edges


def build_price_sequences(price_features: pd.DataFrame, seq_len: int = 20,
                          feature_cols: list[str] | None = None) -> dict[str, np.ndarray]:
    """Build (n, seq_len, F) sequences + next-day log-return targets.

    Also emits the per-commodity standardisation stats (stat_commodity,
    feat_mean, feat_std) so serving can reproduce the exact input scaling.
    """
    feature_cols = feature_cols or ["return_1d", "volatility_realized_20d", "rsi_14", "macd_histogram"]
    Xs, ys, owners = [], [], []
    stat_commodity, feat_mean, feat_std = [], [], []
    for commodity, g in price_features.groupby("commodity"):
        g = g.sort_values("date").reset_index(drop=True)
        feats = g[feature_cols].copy()
        feats["rsi_14"] = feats["rsi_14"].fillna(50.0) / 100.0
        feats = feats.fillna(0.0)
        # standardise per commodity for stable LSTM training
        mean = feats.mean()
        std = feats.std().replace(0, 1.0)
        stat_commodity.append(commodity)
        feat_mean.append([float(mean[f]) for f in feature_cols])
        feat_std.append([float(std[f]) for f in feature_cols])
        normed = ((feats - mean) / std).to_numpy(dtype=np.float32)
        target = g["return_1d"].shift(-1).to_numpy(dtype=np.float64)
        for i in range(seq_len, len(g) - 1):
            if not np.isfinite(target[i]):
                continue
            Xs.append(normed[i - seq_len:i])
            ys.append(target[i])
            owners.append(commodity)
    if not Xs:
        return {"X": np.zeros((0, seq_len, len(feature_cols)), dtype=np.float32),
                "y": np.zeros((0,), dtype=np.float32),
                "commodity": np.array([], dtype=str),
                "stat_commodity": np.array([], dtype=str),
                "feat_mean": np.zeros((0, len(feature_cols)), dtype=np.float32),
                "feat_std": np.ones((0, len(feature_cols)), dtype=np.float32)}
    return {
        "X": np.stack(Xs).astype(np.float32),
        "y": np.asarray(ys, dtype=np.float32),
        "commodity": np.asarray(owners),
        "stat_commodity": np.asarray(stat_commodity),
        "feat_mean": np.asarray(feat_mean, dtype=np.float32),
        "feat_std": np.asarray(feat_std, dtype=np.float32),
    }


def build_gold(base_path: str | Path) -> dict[str, int]:
    """Silver → gold. Computes and writes every gold table. Returns row counts."""
    base_path = Path(base_path)
    txns = read_silver(base_path, "transactions")
    users = read_silver(base_path, "users")
    prices = read_silver(base_path, "prices_daily")

    counts: dict[str, int] = {}
    gold_root = base_path / "gold"

    pf = compute_price_features(prices)
    if not pf.empty:
        counts["price_features"] = write_table(pf, root=gold_root, table="price_features",
                                               partition_col=None)["rows"]
    vf = compute_volume_features(txns)
    if not vf.empty:
        counts["volume_features"] = write_table(vf, root=gold_root, table="volume_features",
                                                partition_col="date")["rows"]
    rf = compute_risk_features(pf)
    if not rf.empty:
        counts["risk_features"] = write_table(rf, root=gold_root, table="risk_features",
                                              partition_col=None)["rows"]
    ub = compute_user_behavior(txns, users)
    if not ub.empty:
        counts["user_behavior"] = write_table(ub, root=gold_root, table="user_behavior",
                                              partition_col=None)["rows"]
    edges = compute_graph_edges(txns)
    if not edges.empty:
        counts["graph_edges"] = write_table(edges, root=gold_root, table="graph_edges",
                                            partition_col=None)["rows"]
    seqs = build_price_sequences(pf)
    seq_dir = gold_root / "price_sequences"
    seq_dir.mkdir(parents=True, exist_ok=True)
    np.savez(seq_dir / "sequences.npz", **seqs)
    counts["price_sequences"] = int(seqs["X"].shape[0])

    # serving feature store (closes offline/online skew for history-derived features)
    from mlplatform.lakehouse.gold_serving import build_serving_features

    sf = build_serving_features(base_path)
    counts["serving_features"] = int(len(sf))

    logger.info("gold build complete: %s", counts)
    return counts


def main(argv: list[str] | None = None) -> None:
    import argparse

    parser = argparse.ArgumentParser(description="Build gold layer from silver")
    parser.add_argument("--base-path", "--lakehouse-path", "--data-dir", dest="base_path", required=True)
    args = parser.parse_args(argv)
    logging.basicConfig(level=logging.INFO)
    counts = build_gold(args.base_path)
    for table, n in counts.items():
        print(f"  gold/{table}: {n} rows")


if __name__ == "__main__":
    main()
