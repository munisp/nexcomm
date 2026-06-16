# NEXCOM Exchange — Developer Tools

## generate_migration.py

Python script that processes all 61 Drizzle migration files and produces a single idempotent production migration SQL file.

**Features:**
- Dollar-quote-aware SQL statement splitter
- Handles Drizzle's malformed DO blocks
- Wraps CREATE TYPE, CREATE INDEX, ALTER TABLE, ADD CONSTRAINT in idempotent DO blocks
- Strips CONCURRENTLY (incompatible with transactions)
- Catches: duplicate_object, duplicate_table, undefined_column, undefined_table, datatype_mismatch

**Usage:**
```bash
python3 generate_migration.py
# Outputs: production-migration.sql (944 statements)
```

## schema-diff/

Rust binary that queries `pg_catalog` and compares the live database schema against a known baseline.

**Usage:**
```bash
cargo build --release
./target/release/schema-diff --dsn "postgres://user:pass@host/db"
```

**Output:** Table count, column count, constraint count, index count, enum count, and any drift items (ERROR/WARN/INFO).
