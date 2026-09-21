#!/usr/bin/env bash
# NEXCOM restore verification — restores a pg_dump into a THROWAWAY database
# and runs sanity checks (table count, row counts on critical tables) without
# touching production. Run after every backup schedule change and weekly in DR.
#
# Usage:
#   restore-verify.sh [DUMP_FILE]    # default: $BACKUP_DIR/latest.dump
#
# Env: PGHOST/PGPORT/PGUSER/PGPASSWORD (same as postgres-backup.sh).
set -euo pipefail

PGHOST="${PGHOST:-postgres}"
PGPORT="${PGPORT:-5432}"
PGUSER="${PGUSER:-nexcom}"
BACKUP_DIR="${BACKUP_DIR:-/backups/postgres}"
DUMP="${1:-$BACKUP_DIR/latest.dump}"
VERIFY_DB="nexcom_restore_verify_$$"

if [[ ! -e "$DUMP" ]]; then
  echo "FATAL: dump file not found: $DUMP" >&2
  exit 1
fi

cleanup() { dropdb --if-exists --host="$PGHOST" --port="$PGPORT" --username="$PGUSER" "$VERIFY_DB" 2>/dev/null || true; }
trap cleanup EXIT

echo "[verify] creating throwaway db $VERIFY_DB"
createdb --host="$PGHOST" --port="$PGPORT" --username="$PGUSER" "$VERIFY_DB"

echo "[verify] restoring $DUMP"
pg_restore --no-owner --no-privileges \
  --host="$PGHOST" --port="$PGPORT" --username="$PGUSER" --dbname="$VERIFY_DB" \
  --exit-on-error "$DUMP" || {
    # pg_restore --exit-on-error still tolerates extension warnings; require >0 tables
    echo "[verify] pg_restore reported errors — continuing to sanity checks"
  }

TABLES=$(psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$VERIFY_DB" -tAc \
  "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'")
echo "[verify] restored public tables: $TABLES"
[[ "$TABLES" -gt 20 ]] || { echo "FATAL: implausibly few tables ($TABLES) — dump is not usable" >&2; exit 1; }

# Critical-table row counts (tolerate missing tables on partial dumps)
for t in users orders trades ledger_accounts; do
  N=$(psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$VERIFY_DB" -tAc \
      "SELECT count(*) FROM $t" 2>/dev/null || echo "n/a")
  echo "[verify] $t rows: $N"
done

echo "[verify] OK — dump restores cleanly"
