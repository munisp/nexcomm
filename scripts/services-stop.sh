#!/usr/bin/env bash
# NEXCOM Exchange — Stop all Python microservices
# Usage: pnpm services:stop

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
LOG_DIR="${PROJECT_ROOT}/.service-logs"

echo "Stopping NEXCOM Python microservices..."

for pid_file in "$LOG_DIR"/*.pid; do
  [ -f "$pid_file" ] || continue
  name="$(basename "$pid_file" .pid)"
  pid="$(cat "$pid_file")"
  if kill -0 "$pid" 2>/dev/null; then
    kill "$pid"
    echo "  Stopped $name (PID $pid)"
  else
    echo "  $name (PID $pid) was not running"
  fi
  rm -f "$pid_file"
done

echo "Done."
