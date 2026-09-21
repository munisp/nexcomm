"""
Silver layer: cleaning, deduplication and conformed dimensions.

Reads bronze tables, enforces types, drops exact/late duplicates (keep the
latest `updated_at` per natural key), filters impossible values, and writes
conformed silver tables: transactions, users, devices, prices_daily,
fraud_labels.
"""
from __future__ import annotations

import logging
from pathlib import Path

import pandas as pd

from mlplatform.data.schema import BRONZE_TABLES
from mlplatform.lakehouse.storage import read_table, write_table

logger = logging.getLogger("mlplatform.lakehouse.silver")

_NATURAL_KEYS = {
    "transactions": "transaction_id",
    "users": "user_id",
    "devices": "device_id",
    "prices_daily": None,  # composite: (date, commodity)
    "fraud_labels": "transaction_id",
}


def _dedupe(df: pd.DataFrame, key: str) -> pd.DataFrame:
    if df.empty or key not in df.columns:
        return df
    if "updated_at" in df.columns:
        df = df.sort_values("updated_at")
    return df.drop_duplicates(subset=[key], keep="last").reset_index(drop=True)


def _clean_transactions(df: pd.DataFrame) -> pd.DataFrame:
    if df.empty:
        return df
    df = _dedupe(df, "transaction_id")
    df["timestamp"] = pd.to_datetime(df["timestamp"], utc=True, errors="coerce")
    df = df.dropna(subset=["timestamp"])
    for col in ("quantity_mt", "price_ngn_per_mt", "amount_ngn", "settlement_delay_hours"):
        df[col] = pd.to_numeric(df[col], errors="coerce")
    df["amount_ngn"] = df["amount_ngn"].clip(lower=0)
    df["quantity_mt"] = df["quantity_mt"].clip(lower=0)
    df["is_cross_border"] = df["is_cross_border"].astype(str).str.lower().isin(["true", "1", "t"])
    df["date"] = df["timestamp"].dt.strftime("%Y-%m-%d")
    return df.sort_values("timestamp").reset_index(drop=True)


def _clean_users(df: pd.DataFrame) -> pd.DataFrame:
    if df.empty:
        return df
    df = _dedupe(df, "user_id")
    df["created_at"] = pd.to_datetime(df["created_at"], utc=True, errors="coerce")
    df["updated_at"] = pd.to_datetime(df["updated_at"], utc=True, errors="coerce")
    df["kyc_level"] = pd.to_numeric(df["kyc_level"], errors="coerce").fillna(1).astype(int).clip(1, 4)
    for col in ("pep_flag", "adverse_media_flag"):
        df[col] = df[col].astype(str).str.lower().isin(["true", "1", "t"])
    df["date"] = df["updated_at"].dt.strftime("%Y-%m-%d")
    return df.reset_index(drop=True)


def _clean_devices(df: pd.DataFrame) -> pd.DataFrame:
    if df.empty:
        return df
    df = _dedupe(df, "device_id")
    for col in ("first_seen", "last_seen"):
        df[col] = pd.to_datetime(df[col], utc=True, errors="coerce")
    df["date"] = df["last_seen"].dt.strftime("%Y-%m-%d")
    return df.reset_index(drop=True)


def _clean_prices(df: pd.DataFrame) -> pd.DataFrame:
    if df.empty:
        return df
    for col in ("open", "high", "low", "close", "volume_mt"):
        df[col] = pd.to_numeric(df[col], errors="coerce")
    df = df.dropna(subset=["close"])
    df = df[df["close"] > 0]
    df = df.drop_duplicates(subset=["date", "commodity"], keep="last")
    return df.sort_values(["commodity", "date"]).reset_index(drop=True)


def _clean_labels(df: pd.DataFrame) -> pd.DataFrame:
    if df.empty:
        return df
    df = _dedupe(df, "transaction_id")
    df["is_fraud"] = df["is_fraud"].astype(str).str.lower().isin(["true", "1", "t"])
    return df.reset_index(drop=True)


_CLEANERS = {
    "transactions": _clean_transactions,
    "users": _clean_users,
    "devices": _clean_devices,
    "prices_daily": _clean_prices,
    "fraud_labels": _clean_labels,
}


def build_silver(base_path: str | Path, tables: list[str] | None = None) -> dict[str, int]:
    """Bronze → silver for all known tables. Returns silver row counts."""
    base_path = Path(base_path)
    tables = tables or list(BRONZE_TABLES.keys())
    counts: dict[str, int] = {}
    for table in tables:
        raw = read_table(base_path / "bronze", table)
        cleaned = _CLEANERS[table](raw) if table in _CLEANERS else raw
        # silver is rebuilt as a full snapshot each run
        silver_dir = base_path / "silver" / table
        if silver_dir.is_dir():
            import shutil

            shutil.rmtree(silver_dir)
        if cleaned.empty:
            counts[table] = 0
            continue
        part_col = "date" if "date" in cleaned.columns else None
        res = write_table(cleaned, root=base_path / "silver", table=table, partition_col=part_col)
        counts[table] = res["rows"]
        logger.info("silver %s: %d rows", table, res["rows"])
    return counts


def read_silver(base_path: str | Path, table: str) -> pd.DataFrame:
    """Read a silver table. Consumers re-apply dtypes as needed (CSV round-trip)."""
    return read_table(Path(base_path) / "silver", table)


def main(argv: list[str] | None = None) -> None:
    import argparse

    parser = argparse.ArgumentParser(description="Build silver layer from bronze")
    parser.add_argument("--base-path", "--lakehouse-path", "--data-dir", dest="base_path", required=True)
    args = parser.parse_args(argv)
    logging.basicConfig(level=logging.INFO)
    counts = build_silver(args.base_path)
    for table, n in counts.items():
        print(f"  silver/{table}: {n} rows")


if __name__ == "__main__":
    main()
