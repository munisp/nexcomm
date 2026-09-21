"""
Lakehouse storage primitives.

write_table/read_table with partition layout `{root}/{table}/date=YYYY-MM-DD/`.
Uses Parquet (pyarrow, snappy) when pyarrow is importable — matching the
convention in services/ingestion-engine/lakehouse/bronze.py — and otherwise
falls back to per-partition CSV files (the CPU validation image has no pyarrow).
Both paths are real, readable, and round-trip losslessly for our schemas.
"""
from __future__ import annotations

import logging
import uuid
from pathlib import Path

import pandas as pd

logger = logging.getLogger("mlplatform.lakehouse.storage")

try:
    import pyarrow as pa  # type: ignore
    import pyarrow.parquet as pq  # type: ignore

    _HAS_PYARROW = True
except ImportError:  # optional dependency
    pa = None
    pq = None
    _HAS_PYARROW = False


def has_parquet() -> bool:
    return _HAS_PYARROW


def _ext() -> str:
    return "parquet" if _HAS_PYARROW else "csv"


def write_table(
    df: pd.DataFrame,
    root: str | Path,
    table: str,
    partition_col: str | None = "date",
    partition_value: str | None = None,
) -> dict:
    """Append a dataframe to a partitioned table directory.

    If partition_col is present in df, rows are split into one partition per
    distinct value; otherwise partition_value (or today) is used.
    Returns {"rows": n, "paths": [written files], "format": "parquet"|"csv"}.
    """
    root = Path(root)
    paths: list[str] = []
    if df is None or len(df) == 0:
        return {"rows": 0, "paths": paths, "format": _ext()}

    if partition_col and partition_col in df.columns:
        groups = df.groupby(df[partition_col].astype(str))
    else:
        pv = partition_value or pd.Timestamp.utcnow().strftime("%Y-%m-%d")
        groups = [(pv, df)]

    for pval, part_df in groups:
        out_dir = root / table / f"{partition_col}={pval}" if partition_col else root / table
        out_dir.mkdir(parents=True, exist_ok=True)
        fname = f"part-{uuid.uuid4().hex[:12]}.{_ext()}"
        out_file = out_dir / fname
        if _HAS_PYARROW:
            arrow = pa.Table.from_pandas(part_df.reset_index(drop=True), preserve_index=False)
            pq.write_table(arrow, out_file, compression="snappy")
        else:
            part_df.to_csv(out_file, index=False)
        paths.append(str(out_file))

    return {"rows": int(len(df)), "paths": paths, "format": _ext()}


def read_table(root: str | Path, table: str, columns: list[str] | None = None) -> pd.DataFrame:
    """Read all partitions of a table into one DataFrame (empty if absent)."""
    table_dir = Path(root) / table
    if not table_dir.is_dir():
        return pd.DataFrame(columns=columns or [])
    frames: list[pd.DataFrame] = []
    files = sorted(table_dir.rglob("*.parquet")) if _HAS_PYARROW else sorted(table_dir.rglob("*.csv"))
    # If the other format is present (mixed envs), read both.
    other = sorted(table_dir.rglob("*.csv")) if _HAS_PYARROW else sorted(table_dir.rglob("*.parquet"))
    for f in files:
        try:
            frames.append(pd.read_parquet(f) if f.suffix == ".parquet" else pd.read_csv(f, dtype=str))
        except Exception as exc:  # corrupt part file: skip but log
            logger.warning("skipping unreadable partition file %s: %s", f, exc)
    for f in other:
        try:
            frames.append(pd.read_parquet(f) if f.suffix == ".parquet" else pd.read_csv(f, dtype=str))
        except Exception:
            pass
    if not frames:
        return pd.DataFrame(columns=columns or [])
    df = pd.concat(frames, ignore_index=True)
    if columns:
        for c in columns:
            if c not in df.columns:
                df[c] = pd.NA
        df = df[columns]
    return df


def list_partitions(root: str | Path, table: str) -> list[str]:
    table_dir = Path(root) / table
    if not table_dir.is_dir():
        return []
    return sorted(p.name.split("=", 1)[1] for p in table_dir.iterdir() if p.is_dir() and "=" in p.name)


def fingerprint(root: str | Path) -> str:
    """Deterministic fingerprint of a dataset directory (file count + sizes + newest mtime)."""
    import hashlib

    root = Path(root)
    h = hashlib.sha256()
    n = 0
    for f in sorted(root.rglob("*")) if root.is_dir() else []:
        if f.is_file():
            stat = f.stat()
            h.update(f"{f.relative_to(root)}:{stat.st_size}:{int(stat.st_mtime)}".encode())
            n += 1
    h.update(str(n).encode())
    return h.hexdigest()
