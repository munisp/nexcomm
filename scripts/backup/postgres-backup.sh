#!/usr/bin/env bash
# NEXCOM Postgres backup — cron/compose friendly pg_dump with retention rotation.
#
# Usage:
#   postgres-backup.sh                 # dump + rotate
#   BACKUP_RETENTION_DAYS=14 postgres-backup.sh
#
# Env:
#   PGHOST / PGPORT / PGUSER / PGPASSWORD / PGDATABASE  (standard libpq vars)
#   BACKUP_DIR                 dump destination       (default: /backups/postgres)
#   BACKUP_RETENTION_DAYS      keep N days of dumps   (default: 14)
#
# Output: $BACKUP_DIR/nexcom_YYYYMMDD_HHMMSS.dump  (pg_dump custom format,
# compressed — restorable with pg_restore). A `latest.dump` symlink is updated
# after every successful run.
set -euo pipefail

PGHOST="${PGHOST:-postgres}"
PGPORT="${PGPORT:-5432}"
PGUSER="${PGUSER:-nexcom}"
PGDATABASE="${PGDATABASE:-nexcom}"
BACKUP_DIR="${BACKUP_DIR:-/backups/postgres}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-14}"

if [[ -z "${PGPASSWORD:-}" ]]; then
  echo "FATAL: PGPASSWORD is not set (use PGPASSWORD or a .pgpass file)" >&2
  exit 1
fi

mkdir -p "$BACKUP_DIR"
TS="$(date -u +%Y%m%d_%H%M%S)"
OUT="$BACKUP_DIR/nexcom_${TS}.dump"

echo "[backup] pg_dump $PGDATABASE@$PGHOST:$PGPORT -> $OUT"
pg_dump --format=custom --compress=6 --no-owner --no-privileges \
  --host="$PGHOST" --port="$PGPORT" --username="$PGUSER" --dbname="$PGDATABASE" \
  --file="$OUT"

# Sanity: custom-format dumps start with PGDMP magic
head -c 5 "$OUT" | grep -q PGDMP || { echo "FATAL: dump file failed magic check" >&2; exit 1; }

ln -sfn "$OUT" "$BACKUP_DIR/latest.dump"

# Retention rotation: delete dumps older than RETENTION_DAYS
find "$BACKUP_DIR" -name 'nexcom_*.dump' -mtime "+${RETENTION_DAYS}" -delete

SIZE="$(du -h "$OUT" | cut -f1)"
echo "[backup] OK ($SIZE). Kept last ${RETENTION_DAYS} days in $BACKUP_DIR"
