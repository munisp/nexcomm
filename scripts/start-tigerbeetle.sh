#!/usr/bin/env bash
# ============================================================
# NEXCOM Exchange — TigerBeetle Ledger Startup Script
# ============================================================
# TigerBeetle requires ~2GB RAM and is designed to run on a
# dedicated server or VM. This script manages its lifecycle.
#
# Requirements:
#   - Linux x86_64 with 2GB+ available RAM
#   - tigerbeetle binary at /opt/tigerbeetle/tigerbeetle
#   - Data directory at /var/lib/tigerbeetle/
#
# Usage:
#   ./scripts/start-tigerbeetle.sh [format|start|stop|status]
# ============================================================

set -euo pipefail

TB_BINARY="${TB_BINARY:-/opt/tigerbeetle/tigerbeetle}"
TB_DATA_DIR="${TB_DATA_DIR:-/var/lib/tigerbeetle}"
TB_DATA_FILE="${TB_DATA_DIR}/0_0.tigerbeetle"
TB_PORT="${TIGERBEETLE_PORT:-3001}"
TB_CLUSTER="${TIGERBEETLE_CLUSTER:-0}"
TB_PID_FILE="/tmp/tigerbeetle.pid"
TB_LOG_FILE="/var/log/tigerbeetle.log"

# Download TigerBeetle if not present
install_tigerbeetle() {
  if [[ -f "$TB_BINARY" ]]; then
    echo "TigerBeetle already installed at $TB_BINARY"
    return 0
  fi
  echo "Downloading TigerBeetle 0.16.73..."
  mkdir -p "$(dirname "$TB_BINARY")"
  curl -L -o /tmp/tigerbeetle.zip \
    "https://github.com/tigerbeetle/tigerbeetle/releases/download/0.16.73/tigerbeetle-x86_64-linux.zip"
  unzip -o /tmp/tigerbeetle.zip -d "$(dirname "$TB_BINARY")"
  chmod +x "$TB_BINARY"
  echo "TigerBeetle installed at $TB_BINARY"
}

# Format a new data file
format_data() {
  echo "Formatting TigerBeetle data file at $TB_DATA_FILE..."
  mkdir -p "$TB_DATA_DIR"
  "$TB_BINARY" format \
    --cluster="$TB_CLUSTER" \
    --replica=0 \
    --replica-count=1 \
    "$TB_DATA_FILE"
  echo "Format complete. Data file: $TB_DATA_FILE"
}

# Start TigerBeetle
start_tb() {
  if [[ -f "$TB_PID_FILE" ]] && kill -0 "$(cat "$TB_PID_FILE")" 2>/dev/null; then
    echo "TigerBeetle already running (PID $(cat "$TB_PID_FILE"))"
    return 0
  fi
  if [[ ! -f "$TB_DATA_FILE" ]]; then
    format_data
  fi
  echo "Starting TigerBeetle on port $TB_PORT..."
  nohup "$TB_BINARY" start \
    --addresses="0.0.0.0:${TB_PORT}" \
    "$TB_DATA_FILE" \
    >> "$TB_LOG_FILE" 2>&1 &
  echo $! > "$TB_PID_FILE"
  sleep 2
  if kill -0 "$(cat "$TB_PID_FILE")" 2>/dev/null; then
    echo "TigerBeetle started (PID $(cat "$TB_PID_FILE"))"
  else
    echo "ERROR: TigerBeetle failed to start. Check $TB_LOG_FILE"
    exit 1
  fi
}

# Stop TigerBeetle
stop_tb() {
  if [[ -f "$TB_PID_FILE" ]]; then
    PID=$(cat "$TB_PID_FILE")
    kill "$PID" 2>/dev/null && echo "TigerBeetle stopped (PID $PID)" || echo "Process not running"
    rm -f "$TB_PID_FILE"
  else
    echo "TigerBeetle not running"
  fi
}

# Status check
status_tb() {
  if [[ -f "$TB_PID_FILE" ]] && kill -0 "$(cat "$TB_PID_FILE")" 2>/dev/null; then
    echo "TigerBeetle RUNNING (PID $(cat "$TB_PID_FILE"))"
  else
    echo "TigerBeetle STOPPED"
  fi
}

case "${1:-start}" in
  install) install_tigerbeetle ;;
  format)  format_data ;;
  start)   start_tb ;;
  stop)    stop_tb ;;
  restart) stop_tb; sleep 1; start_tb ;;
  status)  status_tb ;;
  *)
    echo "Usage: $0 [install|format|start|stop|restart|status]"
    exit 1
    ;;
esac
