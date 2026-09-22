"""
47-feature fraud/risk feature matrix + .npz export.

Feature names and order are EXACTLY those of
services/ai-ml/src/routes/risk_scoring.py and
services/ai-ml/src/models/gradient_boosting.py (FEATURE_NAMES), so the
`.npz` produced here satisfies the RISK_TRAINING_DATA_PATH contract that
gradient_boosting._train_model enforces: keys "features" float32 (n,47) and
"labels" int64 in {0,1,2,3}, >=100 rows, >=2 classes.

Features are REAL: computed from gold/silver tables (user behaviour
aggregates, mark-to-market trade PnL, settlement history, account metadata,
networkx graph statistics, market volatility) — never RNG-synthesised.

Labels (severity): 0=LOW clean, 1=MEDIUM structuring-only,
2=HIGH spoofing/account-takeover, 3=CRITICAL wash-trading/double-pledge/multi-type.

Closes audit A3 gaps: "routes RNG-synthesise all 47 features per request" and
"nothing in the repo produces the .npz the GBM requires".

CLI: python -m mlplatform.features.fraud_features --base-path /data/lakehouse \
        [--out $RISK_TRAINING_DATA_PATH]
"""
from __future__ import annotations

import logging
import os
from pathlib import Path

import networkx as nx
import numpy as np
import pandas as pd

from mlplatform.data.schema import COMMODITY_NAMES
from mlplatform.lakehouse.silver import read_silver
from mlplatform.lakehouse.storage import read_table

logger = logging.getLogger("mlplatform.features.fraud_features")

# Exact contract — keep in sync with services/ai-ml/src/models/gradient_boosting.py
FEATURE_NAMES = [
    # Behavioural (10)
    "trade_frequency_daily", "avg_order_size_usd", "order_cancel_rate",
    "avg_holding_period_hours", "cross_commodity_count", "night_trading_ratio",
    "large_order_ratio", "order_amendment_rate", "self_trade_rate", "api_usage_ratio",
    # PnL (8)
    "pnl_30d_usd_norm", "pnl_90d_usd_norm", "win_rate", "avg_win_usd_norm",
    "avg_loss_usd_norm", "max_drawdown_pct", "sharpe_ratio_norm", "sortino_ratio_norm",
    # Margin & exposure (9)
    "margin_utilisation", "current_exposure_usd_norm", "var_95_usd_norm",
    "expected_shortfall_usd_norm", "open_positions_count_norm", "concentration_top1_pct",
    "concentration_top3_pct", "leverage_ratio", "unrealised_pnl_norm",
    # Settlement (6)
    "settlement_on_time_rate", "settlement_failures_90d_norm", "avg_settlement_delay_hours_norm",
    "total_settled_usd_norm", "settlement_dispute_rate", "failed_settlement_value_norm",
    # Account (5)
    "account_age_days_norm", "kyc_level_norm", "jurisdiction_risk_score",
    "pep_flag", "adverse_media_flag",
    # Network (4)
    "counterparty_count_norm", "avg_counterparty_risk", "network_centrality",
    "clustering_coefficient",
    # Market (5)
    "market_volatility_regime", "sector_correlation", "commodity_concentration",
    "regulatory_actions_count_norm", "watchlist_flag",
]
assert len(FEATURE_NAMES) == 47

NGN_PER_USD = 1600.0

# Numeric columns produced by gold/user_behavior, network stats and PnL stats
# (CSV round-trips lose dtypes, so we re-coerce explicitly).
_BEHAVIOR_NUMERIC = [
    "txn_count", "trade_count", "order_count", "cancel_count", "cancel_rate",
    "active_days", "txns_per_day", "total_amount_ngn", "avg_amount_ngn",
    "max_amount_ngn", "large_order_ratio", "night_trading_ratio", "weekend_ratio",
    "distinct_commodities", "distinct_counterparties", "distinct_devices",
    "distinct_ips", "distinct_states", "deposit_count", "sub_threshold_deposit_ratio",
    "settlement_count", "settlement_on_time_rate", "avg_settlement_delay_hours",
    "failed_settlement_count", "account_age_days_at_max", "receipt_uses",
    "distinct_receipts",
    "net_counterparty_count", "net_self_trade_rate", "net_centrality",
    "net_clustering", "net_avg_counterparty_risk",
    "pnl_30d_usd", "pnl_90d_usd", "win_rate", "avg_win_usd", "avg_loss_usd",
    "max_drawdown_pct", "sharpe", "sortino", "var_95_usd", "es_95_usd",
    "total_pnl_usd",
]

# Static jurisdiction (state) risk scores — composite of historical fraud
# case frequency and KYC-evidence quality; in production fed by compliance.
_JURISDICTION_RISK = {
    "Lagos": 0.55, "Kano": 0.45, "Kaduna": 0.40, "Borno": 0.75, "Yobe": 0.70,
    "Zamfara": 0.70, "Sokoto": 0.55, "FCT": 0.30, "Rivers": 0.50, "Bayelsa": 0.55,
    "Delta": 0.50, "Benue": 0.45, "Plateau": 0.40, "Taraba": 0.55, "Adamawa": 0.60,
}

# Label severity mapping
_SEVERITY = {
    "structuring": 1,
    "spoofing": 2,
    "account_takeover": 2,
    "wash_trading": 3,
    "receipt_double_pledge": 3,
}


def _norm_log(x: pd.Series | float, scale: float) -> pd.Series:
    return (np.log1p(np.clip(x, 0, None)) / np.log1p(scale)).clip(0, 1)


def _load_inputs(base_path: Path) -> dict[str, pd.DataFrame]:
    base_path = Path(base_path)
    return {
        "txns": read_silver(base_path, "transactions"),
        "users": read_silver(base_path, "users"),
        "labels": read_silver(base_path, "fraud_labels"),
        "prices": read_silver(base_path, "prices_daily"),
        "user_behavior": read_table(base_path / "gold", "user_behavior"),
        "price_features": read_table(base_path / "gold", "price_features"),
    }


def compute_network_stats(txns: pd.DataFrame) -> pd.DataFrame:
    """Network features per account: counterparty count, device/IP sharing
    (self-trade proxy), degree centrality, clustering, avg counterparty risk."""
    t = txns.copy()
    t["amount_ngn"] = pd.to_numeric(t["amount_ngn"], errors="coerce").fillna(0)
    t = t[t["payee_id"].astype(str).str.startswith("U")]

    # device/ip sharing map
    dev_users: dict[str, set] = {}
    ip_users: dict[str, set] = {}
    for dev, uid in zip(t["device_id"].astype(str), t["payer_id"].astype(str)):
        dev_users.setdefault(dev, set()).add(uid)
    for ip, uid in zip(t["ip_address"].astype(str), t["payer_id"].astype(str)):
        ip_users.setdefault(ip, set()).add(uid)

    g = nx.Graph()
    per_user_cp: dict[str, set] = {}
    per_user_trades: dict[str, int] = {}
    per_user_self: dict[str, int] = {}
    for payer, payee in zip(t["payer_id"].astype(str), t["payee_id"].astype(str)):
        g.add_edge(payer, payee)
        per_user_cp.setdefault(payer, set()).add(payee)
        per_user_cp.setdefault(payee, set()).add(payer)
        per_user_trades[payer] = per_user_trades.get(payer, 0) + 1
    # self-trade: trade with counterparty that shares a device or IP
    shared_pair_cache: dict[tuple[str, str], bool] = {}

    def _shares(a: str, b: str) -> bool:
        key = (a, b) if a < b else (b, a)
        if key in shared_pair_cache:
            return shared_pair_cache[key]
        shared = False
        for dev, us in dev_users.items():
            if len(us) > 1 and a in us and b in us:
                shared = True
                break
        if not shared:
            for ip, us in ip_users.items():
                if len(us) > 1 and a in us and b in us:
                    shared = True
                    break
        shared_pair_cache[key] = shared
        return shared

    for payer, payee in zip(t["payer_id"].astype(str), t["payee_id"].astype(str)):
        if _shares(payer, payee):
            per_user_self[payer] = per_user_self.get(payer, 0) + 1

    centrality = nx.degree_centrality(g) if g.number_of_nodes() else {}
    clustering = nx.clustering(g) if g.number_of_nodes() else {}

    # behavioural risk proxy per user (no labels — safe for inference)
    t2 = txns.copy()
    t2["timestamp"] = pd.to_datetime(t2["timestamp"], utc=True, errors="coerce")
    risk_rows = {}
    for uid, grp in t2.groupby("payer_id"):
        cancel = float((grp["status"] == "CANCELLED").mean())
        night = float(grp["timestamp"].dt.hour.isin([22, 23, 0, 1, 2, 3, 4]).mean())
        amt = pd.to_numeric(grp["amount_ngn"], errors="coerce")
        large = float((amt >= 10_000_000).mean())
        risk_rows[str(uid)] = (cancel + night + large) / 3.0

    users = sorted(set(t["payer_id"].astype(str)) | set(t["payee_id"].astype(str)))
    rows = []
    for uid in users:
        cps = per_user_cp.get(uid, set())
        cp_risk = float(np.mean([risk_rows.get(c, 0.0) for c in cps])) if cps else 0.0
        trades = per_user_trades.get(uid, 0)
        rows.append({
            "user_id": uid,
            "net_counterparty_count": len(cps),
            "net_self_trade_rate": per_user_self.get(uid, 0) / trades if trades else 0.0,
            "net_centrality": float(centrality.get(uid, 0.0)),
            "net_clustering": float(clustering.get(uid, 0.0)),
            "net_avg_counterparty_risk": cp_risk,
        })
    return pd.DataFrame(rows)


def compute_pnl_stats(txns: pd.DataFrame, prices: pd.DataFrame) -> pd.DataFrame:
    """Per-user mark-to-market PnL stats from TRADE rows vs daily closes."""
    t = txns.copy()
    t = t[(t["type"] == "TRADE") & (t["commodity"] != "")]
    if t.empty or prices.empty:
        return pd.DataFrame(columns=["user_id"])
    t["amount_ngn"] = pd.to_numeric(t["amount_ngn"], errors="coerce")
    t["quantity_mt"] = pd.to_numeric(t["quantity_mt"], errors="coerce")
    t["price_ngn_per_mt"] = pd.to_numeric(t["price_ngn_per_mt"], errors="coerce")
    p = prices.copy()
    p["close"] = pd.to_numeric(p["close"], errors="coerce")
    p = p.sort_values(["commodity", "date"])
    next_close = p.groupby("commodity")["close"].shift(-1)
    p["next_close"] = next_close
    close_map = {(c, d): (cl, nc) for c, d, cl, nc in
                 zip(p["commodity"], p["date"], p["close"], p["next_close"])}

    sign = np.where(t["side"] == "BUY", 1.0, -1.0)
    keys = list(zip(t["commodity"], t["date"]))
    nxt = np.array([close_map.get(k, (np.nan, np.nan))[1] for k in keys])
    entry = t["price_ngn_per_mt"].to_numpy(dtype=float)
    qty = t["quantity_mt"].to_numpy(dtype=float)
    pnl = np.where(np.isfinite(nxt) & (entry > 0), sign * qty * (nxt - entry), 0.0)
    t = t.assign(pnl_ngn=pnl)
    t["date"] = t["date"].astype(str)
    daily = t.groupby(["payer_id", "date"])["pnl_ngn"].sum().reset_index()

    all_dates = sorted(daily["date"].unique())
    cutoff_30 = all_dates[-30] if len(all_dates) > 30 else all_dates[0]
    cutoff_90 = all_dates[-90] if len(all_dates) > 90 else all_dates[0]

    rows = []
    for uid, g in daily.groupby("payer_id"):
        g = g.sort_values("date")
        pnl_usd = g["pnl_ngn"].to_numpy() / NGN_PER_USD
        dates = g["date"].to_numpy()
        pnl_30 = pnl_usd[dates >= cutoff_30].sum()
        pnl_90 = pnl_usd[dates >= cutoff_90].sum()
        wins = pnl_usd[pnl_usd > 0]
        losses = pnl_usd[pnl_usd < 0]
        equity = np.cumsum(pnl_usd)
        peak = np.maximum.accumulate(np.maximum(equity, 0) + 1.0)
        drawdown = (peak - equity) / peak
        mean_r = pnl_usd.mean()
        std_r = pnl_usd.std() or 1.0
        downside = losses.std() if len(losses) > 1 else std_r
        sharpe = mean_r / std_r * np.sqrt(252)
        sortino = mean_r / (downside or 1.0) * np.sqrt(252)
        var95 = np.quantile(pnl_usd, 0.05) if len(pnl_usd) >= 5 else pnl_usd.min()
        tail = pnl_usd[pnl_usd <= var95]
        es95 = tail.mean() if len(tail) else var95
        rows.append({
            "user_id": uid,
            "pnl_30d_usd": pnl_30, "pnl_90d_usd": pnl_90,
            "win_rate": len(wins) / max(1, len(pnl_usd)),
            "avg_win_usd": wins.mean() if len(wins) else 0.0,
            "avg_loss_usd": abs(losses.mean()) if len(losses) else 0.0,
            "max_drawdown_pct": float(drawdown.max()) if len(drawdown) else 0.0,
            "sharpe": float(sharpe), "sortino": float(sortino),
            "var_95_usd": abs(float(var95)), "es_95_usd": abs(float(es95)),
            "total_pnl_usd": float(pnl_usd.sum()),
        })
    return pd.DataFrame(rows)


def _labels_per_user(labels: pd.DataFrame) -> pd.Series:
    if labels.empty:
        return pd.Series(dtype=int)
    df = labels.copy()
    df["is_fraud"] = df["is_fraud"].astype(str).str.lower().isin(["true", "1", "t"])
    df = df[df["is_fraud"]]
    sev = {}
    for uid, grp in df.groupby(df["user_id"].astype(str)):
        types = set(grp["fraud_type"].astype(str))
        s = max((_SEVERITY.get(t, 1) for t in types), default=0)
        if len(types) >= 2:
            s = 3
        sev[uid] = s
    return pd.Series(sev)


def build_feature_matrix(base_path: str | Path) -> tuple[np.ndarray, np.ndarray, list[str], list[str]]:
    """Build the 47-feature matrix. Returns (X float32, y int64, names, user_ids)."""
    base_path = Path(base_path)
    inputs = _load_inputs(base_path)
    txns, users, labels = inputs["txns"], inputs["users"], inputs["labels"]
    ub = inputs["user_behavior"]
    if txns.empty or users.empty:
        raise ValueError("silver transactions/users required; run the pipeline first")
    if ub.empty:
        from mlplatform.lakehouse.gold import compute_user_behavior

        ub = compute_user_behavior(txns, users)

    users = users.copy()
    now = pd.to_datetime(txns["timestamp"], utc=True, errors="coerce").max()
    users["created_at"] = pd.to_datetime(users["created_at"], utc=True, errors="coerce")
    users["account_age_days"] = (now - users["created_at"]).dt.days.fillna(30).clip(lower=1)

    net = compute_network_stats(txns)
    pnl = compute_pnl_stats(txns, inputs["prices"])

    df = users.merge(ub, on="user_id", how="left")
    df = df.merge(net, on="user_id", how="left").merge(pnl, on="user_id", how="left")
    for col in _BEHAVIOR_NUMERIC:
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors="coerce")
    df[_BEHAVIOR_NUMERIC] = df[[c for c in _BEHAVIOR_NUMERIC if c in df.columns]].fillna(0)
    df = df.fillna(0)

    # Market context: user's top commodity volatility + correlation to basket
    pf = inputs["price_features"]
    vol_regime: dict[str, float] = {}
    corr_basket: dict[str, float] = {}
    if not pf.empty:
        pf = pf.copy()
        pf["volatility_realized_20d"] = pd.to_numeric(pf["volatility_realized_20d"], errors="coerce")
        pf["return_1d"] = pd.to_numeric(pf["return_1d"], errors="coerce")
        vol_regime = pf.groupby("commodity")["volatility_realized_20d"].mean().to_dict()
        pivot = pf.pivot_table(index="date", columns="commodity", values="return_1d")
        basket = pivot.mean(axis=1)
        for c in COMMODITY_NAMES:
            if c in pivot.columns:
                corr_basket[c] = float(pivot[c].corr(basket)) if pivot[c].std() > 0 else 0.0
    max_vol = max(vol_regime.values()) if vol_regime else 1.0

    def _top_commodity(uid: str) -> str:
        g = txns[(txns["payer_id"] == uid) & (txns["commodity"] != "")]
        if g.empty:
            return ""
        vc = g["commodity"].value_counts()
        return str(vc.index[0]) if len(vc) else ""

    n = len(df)
    X = np.zeros((n, 47), dtype=np.float64)

    # Behavioural
    X[:, 0] = (df["txns_per_day"] / 50.0).clip(0, 1)
    X[:, 1] = _norm_log(df["avg_amount_ngn"] / NGN_PER_USD, 100_000)
    X[:, 2] = df["cancel_rate"].clip(0, 1)
    X[:, 3] = ((df["active_days"] * 24.0) / df["trade_count"].replace(0, np.nan)).fillna(720).clip(0, 720) / 720.0
    X[:, 4] = (df["distinct_commodities"] / len(COMMODITY_NAMES)).clip(0, 1)
    X[:, 5] = df["night_trading_ratio"].clip(0, 1)
    X[:, 6] = df["large_order_ratio"].clip(0, 1)
    X[:, 7] = df["cancel_rate"].clip(0, 1) * 0.7  # amendment proxy from order lifecycle
    X[:, 8] = df["net_self_trade_rate"].clip(0, 1)
    tch = txns.copy()
    tch["is_web"] = (tch["channel"] == "web").astype(float)
    api_share = tch.groupby("payer_id")["is_web"].mean()
    X[:, 9] = df["user_id"].map(api_share).fillna(0.0).clip(0, 1)

    # PnL
    X[:, 10] = (0.5 + df["pnl_30d_usd"] / 20_000).clip(0, 1)
    X[:, 11] = (0.5 + df["pnl_90d_usd"] / 60_000).clip(0, 1)
    X[:, 12] = df["win_rate"].clip(0, 1)
    X[:, 13] = _norm_log(df["avg_win_usd"], 50_000)
    X[:, 14] = _norm_log(df["avg_loss_usd"], 50_000)
    X[:, 15] = df["max_drawdown_pct"].clip(0, 1)
    X[:, 16] = ((df["sharpe"] + 3) / 6).clip(0, 1)
    X[:, 17] = ((df["sortino"] + 3) / 6).clip(0, 1)

    # Margin & exposure
    deposits = txns[txns["type"] == "DEPOSIT"].copy()
    deposits["amount_ngn"] = pd.to_numeric(deposits["amount_ngn"], errors="coerce")
    dep_total = deposits.groupby("payer_id")["amount_ngn"].sum()
    gross = txns.copy()
    gross["amount_ngn"] = pd.to_numeric(gross["amount_ngn"], errors="coerce")
    gross_total = gross[gross["type"].isin(["TRADE", "ORDER"])].groupby("payer_id")["amount_ngn"].sum()
    dep_mapped = df["user_id"].map(dep_total).fillna(0) + 1.0
    gross_mapped = df["user_id"].map(gross_total).fillna(0)
    X[:, 18] = (gross_mapped / dep_mapped).clip(0, 1)
    X[:, 19] = _norm_log(df["max_amount_ngn"] / NGN_PER_USD, 100_000)
    X[:, 20] = _norm_log(df["var_95_usd"], 50_000)
    X[:, 21] = _norm_log(df["es_95_usd"], 80_000)
    X[:, 22] = (df["distinct_commodities"] / 20.0).clip(0, 1)

    # commodity concentration (top1/top3/HHI) from trade volume mix
    tvol = txns[(txns["commodity"] != "")].copy()
    tvol["amount_ngn"] = pd.to_numeric(tvol["amount_ngn"], errors="coerce").fillna(0)
    mix = tvol.groupby(["payer_id", "commodity"])["amount_ngn"].sum().reset_index()
    top1, top3, hhi = {}, {}, {}
    for uid, g in mix.groupby("payer_id"):
        shares = (g["amount_ngn"] / max(g["amount_ngn"].sum(), 1.0)).sort_values(ascending=False)
        top1[uid] = float(shares.iloc[0])
        top3[uid] = float(shares.iloc[:3].sum())
        hhi[uid] = float((shares ** 2).sum())
    X[:, 23] = df["user_id"].map(top1).fillna(0.0)
    X[:, 24] = df["user_id"].map(top3).fillna(0.0)
    X[:, 25] = ((gross_mapped / dep_mapped).clip(0, 10)) / 10.0
    X[:, 26] = (0.5 + df["total_pnl_usd"] / 100_000).clip(0, 1)

    # Settlement
    X[:, 27] = df["settlement_on_time_rate"].clip(0, 1)
    X[:, 28] = (df["failed_settlement_count"] / 5.0).clip(0, 1)
    X[:, 29] = (df["avg_settlement_delay_hours"] / 48.0).clip(0, 1)
    settled = txns[(txns["type"] == "SETTLEMENT") & (txns["status"] == "SETTLED")].copy()
    settled["amount_ngn"] = pd.to_numeric(settled["amount_ngn"], errors="coerce")
    settled_total = settled.groupby("payer_id")["amount_ngn"].sum()
    failed_val = txns[(txns["type"] == "SETTLEMENT") & (txns["status"] == "FAILED")].copy()
    failed_val["amount_ngn"] = pd.to_numeric(failed_val["amount_ngn"], errors="coerce")
    failed_total = failed_val.groupby("payer_id")["amount_ngn"].sum()
    X[:, 30] = _norm_log(df["user_id"].map(settled_total).fillna(0) / NGN_PER_USD, 20_000_000)
    all_settle = txns[txns["type"] == "SETTLEMENT"]
    dispute = all_settle.groupby("payer_id")["status"].apply(lambda s: float((s == "FAILED").mean()))
    X[:, 31] = df["user_id"].map(dispute).fillna(0.0).clip(0, 1)
    X[:, 32] = (df["user_id"].map(failed_total).fillna(0) /
                (df["user_id"].map(settled_total).fillna(0) + 1.0)).clip(0, 1)

    # Account
    X[:, 33] = (df["account_age_days"] / 2000.0).clip(0, 1)
    X[:, 34] = (pd.to_numeric(df["kyc_level"], errors="coerce").fillna(1) / 4.0).clip(0, 1)
    X[:, 35] = df["state"].map(_JURISDICTION_RISK).fillna(0.35)
    X[:, 36] = df["pep_flag"].astype(str).str.lower().isin(["true", "1", "t"]).astype(float)
    X[:, 37] = df["adverse_media_flag"].astype(str).str.lower().isin(["true", "1", "t"]).astype(float)

    # Network
    X[:, 38] = (df["net_counterparty_count"] / 50.0).clip(0, 1)
    X[:, 39] = df["net_avg_counterparty_risk"].clip(0, 1)
    X[:, 40] = (df["net_centrality"] * 10).clip(0, 1)
    X[:, 41] = df["net_clustering"].clip(0, 1)

    # Market
    top_comm = df["user_id"].map(_top_commodity)
    X[:, 42] = top_comm.map(lambda c: vol_regime.get(c, 0.0) / (max_vol or 1.0)).clip(0, 1)
    X[:, 43] = top_comm.map(lambda c: (corr_basket.get(c, 0.0) + 1) / 2).clip(0, 1)
    X[:, 44] = df["user_id"].map(hhi).fillna(0.0).clip(0, 1)
    # regulatory_actions proxy: days with >=3 sub-threshold deposits (structuring signal)
    dep = txns[txns["type"] == "DEPOSIT"].copy()
    dep["amount_ngn"] = pd.to_numeric(dep["amount_ngn"], errors="coerce")
    sub = dep[(dep["amount_ngn"] >= 5_000_000) & (dep["amount_ngn"] < 10_000_000)]
    hits = sub.groupby(["payer_id", "date"]).size()
    reg_actions = hits[hits >= 3].groupby("payer_id").size()
    X[:, 45] = (df["user_id"].map(reg_actions).fillna(0) / 5.0).clip(0, 1)
    X[:, 46] = ((df["cancel_rate"] > 0.5) | (df["night_trading_ratio"] > 0.4) |
                (df["user_id"].map(reg_actions).fillna(0) > 0)).astype(float)

    X = np.nan_to_num(np.clip(X, 0.0, 1.0)).astype(np.float32)

    sev = _labels_per_user(labels)
    y = df["user_id"].map(sev).fillna(0).astype(np.int64).to_numpy()
    return X, y, FEATURE_NAMES, df["user_id"].astype(str).tolist()


def export_npz(base_path: str | Path, out_path: str | Path | None = None) -> dict:
    """Build the matrix and write the RISK_TRAINING_DATA_PATH .npz contract."""
    from mlplatform.settings import get_settings

    if out_path is None:
        out_path = (get_settings().risk_training_data_path
                    or os.environ.get("RISK_TRAINING_DATA_PATH")
                    or str(Path(base_path) / "gold" / "risk_training.npz"))
    X, y, names, user_ids = build_feature_matrix(base_path)
    out = Path(out_path)
    out.parent.mkdir(parents=True, exist_ok=True)
    np.savez(out, features=X.astype(np.float32), labels=y.astype(np.int64))
    logger.info("risk training export written: %s (n=%d, classes=%s)",
                out, X.shape[0], np.bincount(y).tolist())
    return {"path": str(out), "n": int(X.shape[0]),
            "class_counts": np.bincount(y, minlength=4).tolist()}


def main(argv: list[str] | None = None) -> None:
    import argparse

    parser = argparse.ArgumentParser(description="Export 47-feature risk training matrix (.npz)")
    parser.add_argument("--base-path", "--lakehouse-path", "--data-dir", dest="base_path", required=True)
    parser.add_argument("--out", default=None)
    args = parser.parse_args(argv)
    logging.basicConfig(level=logging.INFO)
    print(export_npz(args.base_path, args.out))


if __name__ == "__main__":
    main()
