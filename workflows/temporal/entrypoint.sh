#!/bin/sh
# Selects the correct Temporal worker binary based on the WORKER environment variable.
# Valid values: deposit | withdrawal | loan

set -e

WORKER="${WORKER:-deposit}"

echo "[Temporal Worker] Starting worker: $WORKER"
echo "[Temporal Worker] Temporal address: ${TEMPORAL_ADDRESS:-temporal:7233}"
echo "[Temporal Worker] Namespace: ${TEMPORAL_NAMESPACE:-nexcom}"

case "$WORKER" in
  deposit)
    exec /bin/worker-deposit
    ;;
  withdrawal)
    exec /bin/worker-withdrawal
    ;;
  loan)
    exec /bin/worker-loan
    ;;
  *)
    echo "ERROR: Unknown WORKER value '$WORKER'. Must be one of: deposit, withdrawal, loan"
    exit 1
    ;;
esac
