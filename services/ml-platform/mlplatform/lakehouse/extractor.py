"""
Production Postgres → Bronze extractor.

Two real modes:
  1. psycopg2 available AND DATABASE_URL set: incremental extraction using an
     `updated_at` watermark per table, persisted in bronze/_watermarks.json.
  2. Otherwise: CSV export contract — reads `{export_dir}/{table}.csv` files
     (the contract DBAs/CDC jobs write) with the same incremental watermarking.

Closes audit A3 gap: nothing in the repo moved production data into any
training pipeline (psycopg2 was declared but never imported in ai-ml).
"""
from __future__ import annotations

import json
import logging
from pathlib import Path

import pandas as pd

from mlplatform.data.schema import BRONZE_TABLES, PRODUCTION_TABLE_MAP
from mlplatform.lakehouse.storage import write_table

logger = logging.getLogger("mlplatform.lakehouse.extractor")

try:
    import psycopg2  # type: ignore
    import psycopg2.extras  # type: ignore

    _HAS_PSYCOPG2 = True
except ImportError:  # optional dependency
    psycopg2 = None
    _HAS_PSYCOPG2 = False


def _watermark_path(base_path: str | Path) -> Path:
    return Path(base_path) / "bronze" / "_watermarks.json"


def load_watermarks(base_path: str | Path) -> dict[str, str]:
    p = _watermark_path(base_path)
    if p.is_file():
        return json.loads(p.read_text())
    return {}


def save_watermarks(base_path: str | Path, wm: dict[str, str]) -> None:
    p = _watermark_path(base_path)
    p.parent.mkdir(parents=True, exist_ok=True)
    tmp = p.with_suffix(".tmp")
    tmp.write_text(json.dumps(wm, indent=2, sort_keys=True))
    tmp.replace(p)


def _extract_postgres(database_url: str, base_path: str | Path,
                      tables: dict[str, str]) -> dict[str, int]:
    watermarks = load_watermarks(base_path)
    counts: dict[str, int] = {}
    conn = psycopg2.connect(database_url)
    try:
        for pg_table, bronze_table in tables.items():
            required, part_col = BRONZE_TABLES[bronze_table]
            wm = watermarks.get(bronze_table)
            where = f"WHERE updated_at > %s" if wm else ""
            query = f"SELECT * FROM {pg_table} {where} ORDER BY updated_at ASC"
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                cur.execute(query, (wm,) if wm else ())
                rows = cur.fetchall()
            if not rows:
                counts[bronze_table] = 0
                continue
            df = pd.DataFrame([dict(r) for r in rows])
            for col in required:
                if col not in df.columns:
                    df[col] = pd.NA
            df = df[required]
            df["date"] = pd.to_datetime(df["updated_at"]).dt.strftime("%Y-%m-%d")
            res = write_table(df, root=Path(base_path) / "bronze", table=bronze_table,
                              partition_col=part_col)
            watermarks[bronze_table] = pd.to_datetime(df["updated_at"]).max().isoformat()
            counts[bronze_table] = res["rows"]
    finally:
        conn.close()
    save_watermarks(base_path, watermarks)
    return counts


def _extract_csv(export_dir: str | Path, base_path: str | Path,
                 tables: dict[str, str]) -> dict[str, int]:
    """CSV export contract: {export_dir}/{table}.csv with the schema columns."""
    watermarks = load_watermarks(base_path)
    counts: dict[str, int] = {}
    for src_table, bronze_table in tables.items():
        csv_path = Path(export_dir) / f"{src_table}.csv"
        if not csv_path.is_file():
            logger.info("extract contract: no file %s (skipping %s)", csv_path, bronze_table)
            counts[bronze_table] = 0
            continue
        required, part_col = BRONZE_TABLES[bronze_table]
        df = pd.read_csv(csv_path, dtype=str)
        missing = [c for c in required if c not in df.columns]
        if missing:
            raise ValueError(f"extract contract violation: {csv_path} missing columns {missing}")
        df = df[required]
        wm_col = "updated_at" if "updated_at" in df.columns else part_col
        wm = watermarks.get(bronze_table)
        if wm and wm_col in df.columns:
            df = df[df[wm_col].astype(str) > wm]
        if df.empty:
            counts[bronze_table] = 0
            continue
        if part_col not in df.columns or df[part_col].isna().all():
            if "updated_at" in df.columns:
                df[part_col] = pd.to_datetime(df["updated_at"], errors="coerce").dt.strftime("%Y-%m-%d")
            elif "timestamp" in df.columns:
                df[part_col] = pd.to_datetime(df["timestamp"], errors="coerce").dt.strftime("%Y-%m-%d")
            else:
                df[part_col] = pd.Timestamp.utcnow().strftime("%Y-%m-%d")
            df[part_col] = df[part_col].fillna(pd.Timestamp.utcnow().strftime("%Y-%m-%d"))
        res = write_table(df, root=Path(base_path) / "bronze", table=bronze_table,
                          partition_col=part_col)
        if wm_col in df.columns:
            watermarks[bronze_table] = str(df[wm_col].astype(str).max())
        counts[bronze_table] = res["rows"]
    save_watermarks(base_path, watermarks)
    return counts


def extract(base_path: str | Path,
            database_url: str | None = None,
            export_dir: str | Path | None = None,
            tables: dict[str, str] | None = None) -> dict[str, int]:
    """Extract production tables into bronze. Returns per-table row counts."""
    tables = tables or PRODUCTION_TABLE_MAP
    if database_url and _HAS_PSYCOPG2:
        logger.info("extracting from Postgres into bronze at %s", base_path)
        return _extract_postgres(database_url, base_path, tables)
    if database_url and not _HAS_PSYCOPG2:
        logger.warning("DATABASE_URL set but psycopg2 not importable; using CSV contract")
    if export_dir is None:
        export_dir = Path(base_path) / "extract"
    logger.info("extracting from CSV contract dir %s into bronze at %s", export_dir, base_path)
    return _extract_csv(export_dir, base_path, tables)


def main(argv: list[str] | None = None) -> None:
    import argparse

    parser = argparse.ArgumentParser(description="Extract production data into bronze")
    parser.add_argument("--base-path", "--lakehouse-path", "--data-dir", dest="base_path", required=True)
    parser.add_argument("--database-url", default=None)
    parser.add_argument("--export-dir", default=None)
    args = parser.parse_args(argv)
    logging.basicConfig(level=logging.INFO)
    counts = extract(args.base_path, database_url=args.database_url, export_dir=args.export_dir)
    for table, n in counts.items():
        print(f"  {table}: {n} rows extracted")


if __name__ == "__main__":
    main()
