#!/usr/bin/env bash
# NEXCOM Exchange — Start all Python microservices locally
# Usage: pnpm services:start
# Requires: Python 3.11+, pip packages installed per service
#
# For full stack (including Kafka, Redis, TigerBeetle):
#   docker compose up -d kafka redis postgres tigerbeetle
#   pnpm services:start

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
LAKEHOUSE_BASE="${LAKEHOUSE_BASE:-/tmp/nexcom-lakehouse}"
KAFKA_BROKERS="${KAFKA_BROKERS:-localhost:9092}"
LOG_DIR="${PROJECT_ROOT}/.service-logs"

mkdir -p "$LOG_DIR"
mkdir -p "$LAKEHOUSE_BASE"

echo "╔══════════════════════════════════════════════════════════════╗"
echo "║         NEXCOM Exchange — Python Microservices               ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""
echo "  Lakehouse base : $LAKEHOUSE_BASE"
echo "  Kafka brokers  : $KAFKA_BROKERS"
echo "  Log directory  : $LOG_DIR"
echo ""

# ── Helper: start a Python FastAPI service ────────────────────────────────────
start_service() {
  local name="$1"
  local dir="$2"
  local port="$3"
  local env_extra="${4:-}"

  echo "▶  Starting $name on port $port..."
  (
    cd "$PROJECT_ROOT/$dir"
    export KAFKA_BROKERS="$KAFKA_BROKERS"
    export LAKEHOUSE_BASE_PATH="$LAKEHOUSE_BASE"
    export PORT="$port"
    # shellcheck disable=SC2086
    eval "$env_extra"
    python3 -m uvicorn main:app \
      --host 0.0.0.0 \
      --port "$port" \
      --reload \
      --log-level info \
      >> "$LOG_DIR/${name}.log" 2>&1 &
    echo $! > "$LOG_DIR/${name}.pid"
  )
  echo "   PID $(cat "$LOG_DIR/${name}.pid") → $LOG_DIR/${name}.log"
}

# ── Start services ─────────────────────────────────────────────────────────────
start_service "ingestion-engine" "services/ingestion-engine" "8009" \
  "export LAKEHOUSE_BASE=/tmp/nexcom-lakehouse"

sleep 1  # Give ingestion engine a head start (others depend on it)

start_service "ai-ml" "services/ai-ml/src" "8007" \
  "export INGESTION_ENGINE_URL=http://localhost:8009 LAKEHOUSE_BASE_PATH=/tmp/nexcom-lakehouse"

start_service "analytics" "services/analytics" "8006" \
  "export AIML_SERVICE_URL=http://localhost:8007 INGESTION_ENGINE_URL=http://localhost:8009 LAKEHOUSE_BASE_PATH=/tmp/nexcom-lakehouse"

echo ""
echo "✓ All services started. Tail logs with:"
echo "  tail -f $LOG_DIR/ingestion-engine.log"
echo "  tail -f $LOG_DIR/ai-ml.log"
echo "  tail -f $LOG_DIR/analytics.log"
echo ""
echo "  Health checks:"
echo "  curl http://localhost:8009/health"
echo "  curl http://localhost:8007/health"
echo "  curl http://localhost:8006/health"
echo ""
echo "  Stop all services: pnpm services:stop"
