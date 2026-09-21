"""
Bronze layer: raw append with schema validation against data/schema.py
contracts. Bronze is append-only, partitioned by date (parquet via storage.py
when pyarrow is present, CSV otherwise).
"""
from __future__ import annotations

import logging
from pathlib import Path

import pandas as pd

from mlplatform.data.schema import BRONZE_TABLES
from mlplatform.lakehouse.storage import read_table, write_table

logger = logging.getLogger("mlplatform.lakehouse.bronze")


class SchemaViolation(ValueError):
    """Raised when appended rows do not satisfy the bronze column contract."""


def validate(table: str, df: pd.DataFrame) -> pd.DataFrame:
    if table not in BRONZE_TABLES:
        raise SchemaViolation(f"unknown bronze table '{table}'")
    required, _ = BRONZE_TABLES[table]
    missing = [c for c in required if c not in df.columns]
    if missing:
        raise SchemaViolation(f"bronze/{table}: missing required columns {missing}")
    return df


def append_raw(df: pd.DataFrame, table: str, base_path: str | Path,
               partition_col: str | None = None) -> dict:
    """Validate and append raw records to a bronze table."""
    df = validate(table, df)
    default_part = BRONZE_TABLES[table][1]
    part = partition_col or (default_part if default_part in df.columns else None)
    res = write_table(df, root=Path(base_path) / "bronze", table=table, partition_col=part)
    logger.info("bronze append %s: %d rows (%s)", table, res["rows"], res["format"])
    return res


def read_bronze(base_path: str | Path, table: str) -> pd.DataFrame:
    cols = BRONZE_TABLES[table][0] if table in BRONZE_TABLES else None
    df = read_table(Path(base_path) / "bronze", table)
    if cols and not df.empty:
        for c in cols:
            if c not in df.columns:
                df[c] = pd.NA
    return df
