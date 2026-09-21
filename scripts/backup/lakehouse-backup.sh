#!/usr/bin/env bash
# NEXCOM lakehouse backup — archives the shared Delta Lake / Parquet storage
# (docker volume `lakehouse_data`, mounted at /data/lakehouse in the data
# services) into a versioned tarball with retention rotation.
#
# The Nessie catalog is PostgreSQL-backed, so it is covered by
# scripts/backup/postgres-backup.sh — this script covers the object files only.
#
# Usage: lakehouse-backup.sh
#
# Env:
#   LAKEHOUSE_PATH          source directory      (default: /data/lakehouse)
#   BACKUP_DIR              archive destination   (default: /backups/lakehouse)
#   BACKUP_RETENTION_DAYS   keep N days           (default: 14)
set -euo pipefail

LAKEHOUSE_PATH="${LAKEHOUSE_PATH:-/data/lakehouse}"
BACKUP_DIR="${BACKUP_DIR:-/backups/lakehouse}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-14}"

if [[ ! -d "$LAKEHOUSE_PATH" ]]; then
  echo "FATAL: lakehouse path not found: $LAKEHOUSE_PATH" >&2
  exit 1
fi

mkdir -p "$BACKUP_DIR"
TS="$(date -u +%Y%m%d_%H%M%S)"
ARCHIVE="$BACKUP_DIR/lakehouse_${TS}.tar.gz"

echo "[lakehouse] archiving $LAKEHOUSE_PATH -> $ARCHIVE"
# --warning=no-file-changed: Delta writers may mutate files mid-archive; a
# warning must not fail the cron job, but a hard error still will.
tar --warning=no-file-changed -czf "$ARCHIVE" -C "$LAKEHOUSE_PATH" .

# Sanity: non-empty archive
[[ -s "$ARCHIVE" ]] || { echo "FATAL: empty archive produced" >&2; exit 1; }

ln -sfn "$ARCHIVE" "$BACKUP_DIR/latest.tar.gz"
find "$BACKUP_DIR" -name 'lakehouse_*.tar.gz' -mtime "+${RETENTION_DAYS}" -delete
echo "[lakehouse] OK ($(du -h "$ARCHIVE" | cut -f1)). Kept last ${RETENTION_DAYS} days in $BACKUP_DIR"
