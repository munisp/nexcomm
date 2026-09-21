"""
Gold serving feature store — closes the offline/online skew for fraud serving.

train_fraud.build_txn_dataset derives 7 of its 13 numerics from transaction
HISTORY (payer_prior_txn_velocity, device_user_count_norm, ip_user_count_norm,
payer_device_new, amount_vs_payer_median, price_dev context, account tenure).
A single inference request cannot compute these, so this module materialises
per-account LATEST values at gold-build time using the EXACT same derivation
semantics as training (see mlplatform/training/train_fraud.py NUM_TRANSFORMS —
the transform strings in the registered feature_schema.json reference these
columns by name).

Tables written under gold/:
  serving_features            one row per payer account:
      payer_id                    account key (join on request payer_id)
      payer_prior_txn_velocity    clip(txn_count / 100, 0, 1)  [NUM_NAMES[6]]
      txn_count                   raw lifetime txn count
      payer_median_amount_ngn     median(amount_ngn | payer) — serving computes
                                  amount_vs_payer_median =
                                  clip(amount/median - 1, -5, 5) / 5  [NUM_NAMES[12]]
      last_amount_ngn             most recent txn amount (fallback defaults)
      last_device_id              most recent device
      last_ip_address             most recent IP
      device_user_count_norm      clip(nunique(payer|last device)/10, 0, 1)  [NUM_NAMES[9]]
      ip_user_count_norm          clip(nunique(payer|last ip)/10, 0, 1)  [NUM_NAMES[10]]
      payer_device_new            0.0 for the stored (known) device; serving sets
                                  1.0 when request (payer, device) not in
                                  serving_payer_devices  [NUM_NAMES[11]]
      account_age_days            days since first txn (as of data horizon)
      credit_*                    the 12 CreditNet inputs (same transforms as
                                  training/train_credit.py NUM_TRANSFORMS)
      computed_at                 data-horizon timestamp (max txn ts, ISO)
  serving_commodity_price_median  (commodity, median_price_ngn) for price_dev
  serving_device_user_counts      (device_id, user_count)
  serving_ip_user_counts          (ip_address, user_count)
  serving_payer_devices           (payer_id, device_id) known-device membership
"""
from __future__ import annotations

import logging
from pathlib import Path

import numpy as np
import pandas as pd

from mlplatform.lakehouse.silver import read_silver
from mlplatform.lakehouse.storage import read_table, write_table

logger = logging.getLogger("mlplatform.lakehouse.gold_serving")

SERVING_FEATURE_COLUMNS = [
    "payer_id", "payer_prior_txn_velocity", "txn_count",
    "payer_median_amount_ngn", "last_amount_ngn",
    "last_device_id", "last_ip_address",
    "device_user_count_norm", "ip_user_count_norm", "payer_device_new",
    "account_age_days",
    "credit_log_txn_count", "credit_txns_per_day_norm", "credit_log_total_amount",
    "credit_cancel_rate", "credit_night_trading_ratio",
    "credit_settlement_on_time_rate", "credit_avg_settlement_delay_norm",
    "credit_failed_settlements_norm", "credit_account_age_norm",
    "credit_kyc_level_norm", "credit_distinct_commodities_norm",
    "credit_distinct_counterparties_norm",
    "computed_at",
]


def build_serving_features(base_path: str | Path, write: bool = True) -> pd.DataFrame:
    """Materialise gold/serving_features (+ context tables) from silver data."""
    base_path = Path(base_path)
    txns = read_silver(base_path, "transactions")
    if txns.empty:
        raise ValueError("no silver transactions; run bronze→silver first")
    t = txns.copy()
    t["timestamp"] = pd.to_datetime(t["timestamp"], utc=True, errors="coerce")
    t = t.dropna(subset=["timestamp"]).sort_values("timestamp")
    t["amount_ngn"] = pd.to_numeric(t["amount_ngn"], errors="coerce").fillna(0.0)
    horizon = t["timestamp"].max()

    # device/ip user counts (same derivation as train-time groupby.nunique)
    dev_counts = t.groupby("device_id")["payer_id"].nunique()
    ip_counts = t.groupby("ip_address")["payer_id"].nunique()

    rows = []
    for uid, g in t.groupby("payer_id", sort=False):
        last = g.iloc[-1]
        first = g.iloc[0]
        dev = str(last["device_id"])
        ip = str(last["ip_address"])
        rows.append({
            "payer_id": uid,
            "payer_prior_txn_velocity": float(np.clip(len(g) / 100.0, 0, 1)),
            "txn_count": int(len(g)),
            "payer_median_amount_ngn": float(g["amount_ngn"].median()),
            "last_amount_ngn": float(last["amount_ngn"]),
            "last_device_id": dev,
            "last_ip_address": ip,
            "device_user_count_norm": float(np.clip(dev_counts.get(dev, 1) / 10.0, 0, 1)),
            "ip_user_count_norm": float(np.clip(ip_counts.get(ip, 1) / 10.0, 0, 1)),
            "payer_device_new": 0.0,
            "account_age_days": float(max(0, (horizon - first["timestamp"]).days)),
            "computed_at": horizon.isoformat(),
        })
    sf = pd.DataFrame(rows)

    # ── credit model inputs (same transforms as train_credit.py) ─────────────
    users = read_silver(base_path, "users")
    ub = read_table(base_path / "gold", "user_behavior")
    if ub.empty:
        from mlplatform.lakehouse.gold import compute_user_behavior

        ub = compute_user_behavior(txns, users)
    if not ub.empty and not users.empty:
        ub = ub.copy()
        for c in ub.columns:
            if c != "user_id":
                ub[c] = pd.to_numeric(ub[c], errors="coerce").fillna(0)
        u = users[["user_id", "kyc_level", "created_at"]].copy()
        created = pd.to_datetime(u["created_at"], utc=True, errors="coerce")
        u["account_age_days"] = (horizon - created).dt.days.fillna(30).clip(lower=1)
        u["kyc_level"] = pd.to_numeric(u["kyc_level"], errors="coerce").fillna(1)
        m = sf.merge(ub, left_on="payer_id", right_on="user_id", how="left") \
              .merge(u[["user_id", "kyc_level", "account_age_days"]],
                     left_on="payer_id", right_on="user_id", how="left",
                     suffixes=("", "_u"))
        m = m.fillna(0)
        sf["credit_log_txn_count"] = np.log1p(m["txn_count_y"].fillna(m["txn_count_x"])) / 8.0
        sf["credit_txns_per_day_norm"] = (m["txns_per_day"] / 20.0).clip(0, 1)
        sf["credit_log_total_amount"] = np.log1p(m["total_amount_ngn"]) / 25.0
        sf["credit_cancel_rate"] = m["cancel_rate"].clip(0, 1)
        sf["credit_night_trading_ratio"] = m["night_trading_ratio"].clip(0, 1)
        sf["credit_settlement_on_time_rate"] = m["settlement_on_time_rate"].clip(0, 1)
        sf["credit_avg_settlement_delay_norm"] = (m["avg_settlement_delay_hours"] / 72.0).clip(0, 1)
        sf["credit_failed_settlements_norm"] = (m["failed_settlement_count"] / 10.0).clip(0, 1)
        sf["credit_account_age_norm"] = (m["account_age_days_u"].fillna(m["account_age_days"]) / 2000.0).clip(0, 1)
        sf["credit_kyc_level_norm"] = (m["kyc_level"] / 4.0).clip(0, 1)
        sf["credit_distinct_commodities_norm"] = (m["distinct_commodities"] / 10.0).clip(0, 1)
        sf["credit_distinct_counterparties_norm"] = (m["distinct_counterparties"] / 50.0).clip(0, 1)
    else:
        for c in SERVING_FEATURE_COLUMNS:
            if c.startswith("credit_"):
                sf[c] = 0.0

    sf = sf[SERVING_FEATURE_COLUMNS]

    # ── context tables ────────────────────────────────────────────────────────
    t_price = t[t["commodity"] != ""]
    t_price["price_ngn_per_mt"] = pd.to_numeric(t_price["price_ngn_per_mt"], errors="coerce")
    commodity_median = (
        t_price.groupby("commodity")["price_ngn_per_mt"].median()
        .reset_index().rename(columns={"price_ngn_per_mt": "median_price_ngn"})
    )
    device_counts_df = dev_counts.reset_index()
    device_counts_df.columns = ["device_id", "user_count"]
    ip_counts_df = ip_counts.reset_index()
    ip_counts_df.columns = ["ip_address", "user_count"]
    payer_devices = t[["payer_id", "device_id"]].drop_duplicates()

    if write:
        gold = base_path / "gold"
        write_table(sf, root=gold, table="serving_features", partition_col=None)
        write_table(commodity_median, root=gold, table="serving_commodity_price_median", partition_col=None)
        write_table(device_counts_df, root=gold, table="serving_device_user_counts", partition_col=None)
        write_table(ip_counts_df, root=gold, table="serving_ip_user_counts", partition_col=None)
        write_table(payer_devices, root=gold, table="serving_payer_devices", partition_col=None)
        logger.info("serving store written: %d accounts, %d devices, %d ips, %d payer-device pairs",
                    len(sf), len(device_counts_df), len(ip_counts_df), len(payer_devices))
    return sf


def main(argv: list[str] | None = None) -> None:
    import argparse

    parser = argparse.ArgumentParser(description="Build gold serving feature store")
    parser.add_argument("--base-path", "--lakehouse-path", "--data-dir",
                        dest="base_path", required=True)
    args = parser.parse_args(argv)
    logging.basicConfig(level=logging.INFO)
    sf = build_serving_features(args.base_path)
    print(f"gold/serving_features: {len(sf)} accounts")


if __name__ == "__main__":
    main()
