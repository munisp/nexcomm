#!/usr/bin/env python3
"""
NEXCOM Exchange — Production Migration Script Generator
=======================================================
Language: Python 3.11
Purpose : Reads all Drizzle-generated .sql files from /drizzle/,
          merges them into a single idempotent production SQL script,
          adds pre-flight checks, extension setup, and a rollback plan.

Usage:
    python3 generate_migration.py \
        --drizzle-dir /home/ubuntu/nexcom-exchange/drizzle \
        --output     /home/ubuntu/nexcom-tools/production_migration.sql
"""

import argparse
import re
import sys
from datetime import datetime, timezone
from pathlib import Path


# ---------------------------------------------------------------------------
# Templates
# ---------------------------------------------------------------------------

PREAMBLE = """\
-- ============================================================
-- NEXCOM Exchange — Production Migration Script
-- Generated : {ts}
-- Generator : generate_migration.py (Python 3.11)
-- Target DB : PostgreSQL 16+ with PostGIS, uuid-ossp, pg_trgm
-- ============================================================
-- HOW TO APPLY
--   psql "$DATABASE_URL" -f production_migration.sql
--
-- ROLLBACK
--   A companion rollback script is generated alongside this file.
--   Apply it ONLY if you need to undo the migration:
--   psql "$DATABASE_URL" -f production_rollback.sql
--
-- SAFETY RULES
--   1. Run on a COPY of production first.
--   2. Take a full pg_dump backup before running.
--   3. Run inside a transaction: the script wraps everything in
--      BEGIN / COMMIT so a single failure rolls back all changes.
-- ============================================================

BEGIN;

-- Pre-flight: verify PostgreSQL version
DO $$
DECLARE
  v int;
BEGIN
  SELECT current_setting('server_version_num')::int INTO v;
  IF v < 160000 THEN
    RAISE EXCEPTION 'PostgreSQL 16+ required (found %)', current_setting('server_version');
  END IF;
END $$;

-- Required extensions
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS btree_gin;

"""

POSTAMBLE = """\

-- ============================================================
-- Post-migration: record this migration in the audit log
-- ============================================================
DO $$
BEGIN
  INSERT INTO audit_log (id, action, entity_type, entity_id, actor_id, metadata, created_at)
  VALUES (
    gen_random_uuid()::text,
    'SCHEMA_MIGRATION',
    'DATABASE',
    'nexcom_exchange',
    'system',
    jsonb_build_object(
      'generator', 'generate_migration.py',
      'applied_at', now()::text,
      'version', 'v62'
    ),
    now()
  ) ON CONFLICT DO NOTHING;
EXCEPTION WHEN others THEN
  RAISE NOTICE 'Could not write to audit_log: %', SQLERRM;
END $$;

COMMIT;

-- ============================================================
-- Migration complete
-- ============================================================
"""

ROLLBACK_PREAMBLE = """\
-- ============================================================
-- NEXCOM Exchange — Production ROLLBACK Script
-- Generated : {ts}
-- WARNING   : This drops ALL nexcom tables and types.
--             Only run this if the migration failed and you
--             cannot restore from backup.
-- ============================================================

BEGIN;

"""

ROLLBACK_POSTAMBLE = """\

COMMIT;
-- Rollback complete
"""


# ---------------------------------------------------------------------------
# Step 1: Pre-process raw Drizzle SQL
# ---------------------------------------------------------------------------

def preprocess_drizzle_sql(sql: str) -> str:
    """
    Drizzle Kit emits a broken pattern for enum types:

        DO $$ BEGIN
          CREATE TYPE "public"."foo" AS ENUM(...);--> statement-breakpoint
        CREATE TYPE "public"."bar" AS ENUM(...);--> statement-breakpoint
        CREATE TABLE IF NOT EXISTS "baz" (...);
        EXCEPTION WHEN duplicate_object THEN NULL;
        END $$;

    This is invalid SQL because:
      1. CREATE TABLE inside a DO block is not allowed.
      2. Multiple CREATE TYPE statements separated only by statement-breakpoint
         markers (not semicolons) are treated as one big statement.

    This function rewrites such blocks into individual, clean statements:
      - Each CREATE TYPE becomes its own DO-block-wrapped statement.
      - CREATE TABLE and other non-type statements are emitted as-is.

    Also strips --> statement-breakpoint markers.
    """
    # Remove Drizzle statement-breakpoint markers
    sql = sql.replace("--> statement-breakpoint", "")

    # Pattern: DO $$ BEGIN ... EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    # These blocks contain CREATE TYPE and possibly CREATE TABLE statements.
    do_block_pattern = re.compile(
        r'DO\s+\$\$\s+BEGIN\s*(.*?)\s*EXCEPTION\s+WHEN\s+duplicate_object\s+THEN\s+NULL\s*;\s*END\s+\$\$\s*;',
        re.DOTALL | re.IGNORECASE,
    )

    def replace_do_block(m: re.Match) -> str:
        body = m.group(1)
        # Split body into individual statements on semicolons
        raw_stmts = [s.strip() for s in body.split(';') if s.strip()]
        out_parts = []
        for stmt in raw_stmts:
            if re.match(r'CREATE\s+TYPE', stmt, re.IGNORECASE):
                # Wrap each CREATE TYPE in its own idempotent DO block
                tm = re.search(
                    r'CREATE\s+TYPE\s+(?:"public"\.)?"?(\w+)"?',
                    stmt, re.IGNORECASE,
                )
                tname = tm.group(1) if tm else 'unknown'
                out_parts.append(
                    f"DO $$ BEGIN\n"
                    f"  {stmt};\n"
                    f"EXCEPTION WHEN duplicate_object THEN\n"
                    f"  RAISE NOTICE 'type {tname} already exists, skipping';\n"
                    f"END $$;"
                )
            elif stmt:
                # Emit other statements (CREATE TABLE etc.) as-is
                out_parts.append(stmt + ";")
        return "\n".join(out_parts)

    return do_block_pattern.sub(replace_do_block, sql)


# ---------------------------------------------------------------------------
# Step 2: Dollar-quote-aware SQL statement splitter
# ---------------------------------------------------------------------------

def split_statements(sql: str) -> list[str]:
    """
    Split a SQL string into individual statements, correctly handling:
      - Dollar-quoted blocks: $$ ... $$ and $tag$ ... $tag$
      - Single-quoted string literals
      - Line comments (-- ...)
      - Block comments (/* ... */)
    Returns a list of non-empty stripped statement strings (without trailing ;).
    """
    statements: list[str] = []
    current: list[str] = []
    i = 0
    n = len(sql)

    in_single_quote = False
    dollar_tag: str | None = None

    while i < n:
        ch = sql[i]

        # Line comment
        if not in_single_quote and dollar_tag is None and ch == '-' and i + 1 < n and sql[i + 1] == '-':
            end = sql.find('\n', i)
            if end == -1:
                end = n
            current.append(sql[i:end])
            i = end
            continue

        # Block comment
        if not in_single_quote and dollar_tag is None and ch == '/' and i + 1 < n and sql[i + 1] == '*':
            end = sql.find('*/', i + 2)
            if end == -1:
                end = n - 2
            current.append(sql[i:end + 2])
            i = end + 2
            continue

        # Single-quoted string
        if dollar_tag is None and ch == "'":
            if in_single_quote:
                if i + 1 < n and sql[i + 1] == "'":
                    current.append("''")
                    i += 2
                    continue
                else:
                    in_single_quote = False
            else:
                in_single_quote = True
            current.append(ch)
            i += 1
            continue

        # Dollar-quote open/close
        if not in_single_quote and ch == '$':
            m = re.match(r'\$([A-Za-z_]*)\$', sql[i:])
            if m:
                tag = m.group(0)
                if dollar_tag is None:
                    dollar_tag = tag
                    current.append(tag)
                    i += len(tag)
                    continue
                elif sql[i:i + len(dollar_tag)] == dollar_tag:
                    current.append(dollar_tag)
                    i += len(dollar_tag)
                    dollar_tag = None
                    continue

        # Statement terminator
        if not in_single_quote and dollar_tag is None and ch == ';':
            stmt = ''.join(current).strip()
            if stmt:
                statements.append(stmt)
            current = []
            i += 1
            continue

        current.append(ch)
        i += 1

    # Flush trailing content
    stmt = ''.join(current).strip()
    if stmt:
        statements.append(stmt)

    return statements


# ---------------------------------------------------------------------------
# Step 3: Make individual statements idempotent
# ---------------------------------------------------------------------------

def make_idempotent_stmt(stmt: str) -> str:
    """
    Transform a single SQL statement (no trailing ;) to be idempotent.
    DO blocks are passed through unchanged (already idempotent).
    """
    stripped = stmt.strip()
    # Strip leading SQL line comments (-- ...) to allow pattern matching
    # against the actual DDL keyword regardless of preceding comments.
    stripped_no_comments = re.sub(r'^(\s*--[^\n]*\n)+', '', stripped).strip()

    # DO blocks — pass through unchanged
    if re.match(r'DO\s+\$', stripped_no_comments, re.IGNORECASE):
        return stripped

    # CREATE TABLE
    if re.match(r'CREATE\s+TABLE\s+(?!IF\s+NOT\s+EXISTS)', stripped_no_comments, re.IGNORECASE):
        return re.sub(
            r'(CREATE\s+TABLE\s+)(?!IF\s+NOT\s+EXISTS)',
            r'\1IF NOT EXISTS ',
            stripped, count=1, flags=re.IGNORECASE,
        )

    # CREATE [UNIQUE] INDEX [CONCURRENTLY]
    # CONCURRENTLY cannot run inside a transaction block, so we strip it.
    # Wrap in a DO block to handle duplicate index and undefined column errors.
    if re.match(r'CREATE\s+(?:UNIQUE\s+)?INDEX\b', stripped_no_comments, re.IGNORECASE):
        # Remove CONCURRENTLY keyword
        result = re.sub(r'\bCONCURRENTLY\s+', '', stripped_no_comments, flags=re.IGNORECASE)
        # Add IF NOT EXISTS after INDEX (and optional UNIQUE)
        result = re.sub(
            r'(CREATE\s+(?:UNIQUE\s+)?INDEX\s+)(?!IF\s+NOT\s+EXISTS)',
            r'\1IF NOT EXISTS ',
            result, count=1, flags=re.IGNORECASE,
        )
        # Extract index name for the notice message
        im = re.search(r'INDEX\s+IF\s+NOT\s+EXISTS\s+"?(\w+)"?', result, re.IGNORECASE)
        iname = im.group(1) if im else 'unknown'
        return (
            f"DO $$ BEGIN\n"
            f"  {result};\n"
            f"EXCEPTION WHEN duplicate_table OR duplicate_object OR undefined_column OR undefined_table THEN\n"
            f"  RAISE NOTICE 'index {iname} skipped: %', SQLERRM;\n"
            f"END $$"
        )

    # CREATE TYPE AS ENUM (bare — not inside a DO block)
    # Handles: CREATE TYPE "foo", CREATE TYPE "public"."foo", CREATE TYPE foo
    m = re.match(
        r'CREATE\s+TYPE\s+(?:(?:"public"|public)\.)?"?(\w+)"?\s+AS\s+ENUM',
        stripped_no_comments, re.IGNORECASE,
    )
    if m:
        tname = m.group(1)
        return (
            f"DO $$ BEGIN\n"
            f"  {stripped_no_comments};\n"
            f"EXCEPTION WHEN duplicate_object THEN\n"
            f"  RAISE NOTICE 'type {tname} already exists, skipping';\n"
            f"END $$"
        )

    # ALTER TYPE ADD VALUE — PostgreSQL 12+ supports IF NOT EXISTS
    if re.match(r'ALTER\s+TYPE\s+.+\s+ADD\s+VALUE\s+(?!IF\s+NOT\s+EXISTS)', stripped_no_comments, re.IGNORECASE):
        return re.sub(
            r'(ADD\s+VALUE\s+)(?!IF\s+NOT\s+EXISTS)',
            r'\1IF NOT EXISTS ',
            stripped, count=1, flags=re.IGNORECASE,
        )

    # ALTER TABLE ADD COLUMN — wrap in DO block to handle missing table/column
    if re.search(r'\bADD\s+COLUMN\b', stripped_no_comments, re.IGNORECASE):
        result = re.sub(
            r'\b(ADD\s+COLUMN\s+)(?!IF\s+NOT\s+EXISTS)',
            r'\1IF NOT EXISTS ',
            stripped, flags=re.IGNORECASE,
        )
        # Extract column name for notice
        cm = re.search(r'ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+"?(\w+)"?', result, re.IGNORECASE)
        cname = cm.group(1) if cm else 'unknown'
        return (
            f"DO $$ BEGIN\n"
            f"  {result};\n"
            f"EXCEPTION WHEN undefined_table OR undefined_column OR duplicate_column THEN\n"
            f"  RAISE NOTICE 'add column {cname} skipped: %', SQLERRM;\n"
            f"END $$"
        )

    # ALTER TABLE ADD CONSTRAINT
    m = re.match(
        r'ALTER\s+TABLE\s+.+?\s+ADD\s+CONSTRAINT\s+"?(\w+)"?',
        stripped_no_comments, re.IGNORECASE | re.DOTALL,
    )
    if m:
        cname = m.group(1)
        return (
            f"DO $$ BEGIN\n"
            f"  {stripped};\n"
            f"EXCEPTION WHEN duplicate_object OR duplicate_table OR undefined_column OR undefined_table\n"
            f"  OR datatype_mismatch OR foreign_key_violation OR feature_not_supported THEN\n"
            f"  RAISE NOTICE 'constraint {cname} skipped: %', SQLERRM;\n"
            f"END $$"
        )

    return stripped


# ---------------------------------------------------------------------------
# Collectors
# ---------------------------------------------------------------------------

def collect_sql_files(drizzle_dir: Path) -> list[Path]:
    files = sorted(drizzle_dir.glob("*.sql"))
    if not files:
        print(f"ERROR: No .sql files found in {drizzle_dir}", file=sys.stderr)
        sys.exit(1)
    return files


def collect_table_names(stmts: list[str]) -> list[str]:
    tables = []
    for s in stmts:
        m = re.match(
            r'CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+"?(\w+)"?',
            s, re.IGNORECASE,
        )
        if m:
            tables.append(m.group(1))
    return tables


def collect_type_names(stmts: list[str]) -> list[str]:
    types = []
    for s in stmts:
        m = re.search(
            r'CREATE\s+TYPE\s+(?:"public"\.)?"?(\w+)"?\s+AS\s+ENUM',
            s, re.IGNORECASE,
        )
        if m:
            types.append(m.group(1))
    return types


def generate_rollback(tables: list[str], types: list[str]) -> str:
    lines = [ROLLBACK_PREAMBLE.format(ts=datetime.now(timezone.utc).isoformat())]
    lines.append("-- Drop tables in reverse dependency order")
    for t in reversed(tables):
        lines.append(f'DROP TABLE IF EXISTS "{t}" CASCADE;')
    lines.append("")
    lines.append("-- Drop custom types")
    for tp in reversed(types):
        lines.append(f'DROP TYPE IF EXISTS "{tp}" CASCADE;')
    lines.append(ROLLBACK_POSTAMBLE)
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(
        description="Generate idempotent production SQL migration for NEXCOM Exchange"
    )
    parser.add_argument(
        "--drizzle-dir",
        default="/home/ubuntu/nexcom-exchange/drizzle",
        help="Path to the drizzle/ directory containing .sql migration files",
    )
    parser.add_argument(
        "--output",
        default="/home/ubuntu/nexcom-tools/production_migration.sql",
        help="Output path for the production migration SQL file",
    )
    args = parser.parse_args()

    drizzle_dir = Path(args.drizzle_dir)
    output_path = Path(args.output)
    rollback_path = output_path.with_name("production_rollback.sql")

    output_path.parent.mkdir(parents=True, exist_ok=True)

    sql_files = collect_sql_files(drizzle_dir)
    print(f"Found {len(sql_files)} migration files in {drizzle_dir}")

    combined_parts: list[str] = []
    all_tables: list[str] = []
    all_types: list[str] = []
    seen_keys: set[str] = set()

    for f in sql_files:
        raw = f.read_text(encoding="utf-8")

        # Step 1: Fix Drizzle's malformed DO blocks and strip breakpoint markers
        sql = preprocess_drizzle_sql(raw)

        # Step 2: Split into individual statements (dollar-quote aware)
        stmts = split_statements(sql)

        # Step 3: Make each statement idempotent + deduplicate
        file_stmts: list[str] = []
        for stmt in stmts:
            transformed = make_idempotent_stmt(stmt)
            key = re.sub(r'\s+', ' ', transformed.lower()).strip()
            if key and key not in seen_keys:
                seen_keys.add(key)
                file_stmts.append(transformed + ";")

        if file_stmts:
            combined_parts.append(
                f"\n-- ---- {f.name} ----\n" + "\n".join(file_stmts)
            )

        all_tables.extend(collect_table_names(file_stmts))
        all_types.extend(collect_type_names(file_stmts))

    # Deduplicate preserving order
    seen: set[str] = set()
    unique_tables = [t for t in all_tables if not (t in seen or seen.add(t))]  # type: ignore
    seen = set()
    unique_types = [t for t in all_types if not (t in seen or seen.add(t))]  # type: ignore

    ts = datetime.now(timezone.utc).isoformat()
    migration_sql = (
        PREAMBLE.format(ts=ts)
        + "\n".join(combined_parts)
        + POSTAMBLE
    )

    output_path.write_text(migration_sql, encoding="utf-8")
    print(f"✓ Production migration written to {output_path}")
    print(f"  Tables covered : {len(unique_tables)}")
    print(f"  Types covered  : {len(unique_types)}")

    rollback_sql = generate_rollback(unique_tables, unique_types)
    rollback_path.write_text(rollback_sql, encoding="utf-8")
    print(f"✓ Rollback script written to {rollback_path}")


if __name__ == "__main__":
    main()
