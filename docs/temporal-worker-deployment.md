# NEXCOM Temporal Worker Deployment Guide

This document explains how to deploy the three NEXCOM Temporal workflow workers
(`deposit`, `withdrawal`, `loan`) to Kubernetes, and how to wire the
`TEMPORAL_ADDRESS` secret in both the Node.js server and the Go workers.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  NEXCOM Node.js Server                                          │
│  server/temporal/temporalClient.ts                              │
│  → triggerTemporalWorkflow("DepositWorkflow", input, id)        │
└───────────────────────┬─────────────────────────────────────────┘
                        │  gRPC (port 7233)
                        ▼
┌─────────────────────────────────────────────────────────────────┐
│  Temporal Server / Temporal Cloud                               │
│  Address: $TEMPORAL_ADDRESS  Namespace: $TEMPORAL_NAMESPACE     │
└───────────────────────┬─────────────────────────────────────────┘
                        │  Task Queue: nexcom-fund-flows
          ┌─────────────┼─────────────┐
          ▼             ▼             ▼
┌──────────────┐ ┌──────────────┐ ┌──────────────┐
│  Deposit     │ │  Withdrawal  │ │  Loan        │
│  Worker (Go) │ │  Worker (Go) │ │  Worker (Go) │
│  2 replicas  │ │  2 replicas  │ │  2 replicas  │
└──────────────┘ └──────────────┘ └──────────────┘
```

---

## Option A — Temporal Cloud (recommended for production)

### 1. Create a Temporal Cloud account

Sign up at [cloud.temporal.io](https://cloud.temporal.io) and create a namespace
(e.g. `nexcom.acct123`).

### 2. Generate mTLS certificates

```bash
# Using the Temporal Cloud UI or tcld CLI
tcld namespace accepted-client-ca add \
  --namespace nexcom.acct123 \
  --ca-certificate-file ca.pem
```

### 3. Create the Kubernetes secret

```bash
kubectl create secret generic nexcom-temporal-secret \
  --namespace nexcom \
  --from-literal=TEMPORAL_ADDRESS=nexcom.acct123.tmprl.cloud:7233 \
  --from-literal=TEMPORAL_NAMESPACE=nexcom.acct123 \
  --from-file=TEMPORAL_TLS_CERT=client.pem \
  --from-file=TEMPORAL_TLS_KEY=client.key
```

### 4. Set the Manus project secret

In the Manus Secrets panel (or via the Manus CLI), add:

| Key | Value |
|-----|-------|
| `TEMPORAL_ADDRESS` | `nexcom.acct123.tmprl.cloud:7233` |
| `TEMPORAL_NAMESPACE` | `nexcom.acct123` |
| `TEMPORAL_TLS_CERT` | Base64-encoded client certificate PEM |
| `TEMPORAL_TLS_KEY` | Base64-encoded client key PEM |

The Node.js `temporalClient.ts` will automatically detect the `.tmprl.cloud`
suffix and enable TLS, then decode the base64 PEM values.

---

## Option B — Self-hosted Temporal (docker-compose / K8s)

The project's `docker-compose.yml` already includes a Temporal service.
For local development, no additional configuration is needed — the client
defaults to `localhost:7233` with no TLS.

For a self-hosted K8s deployment:

```bash
# Install Temporal via Helm
helm repo add temporal https://go.temporal.io/helm-charts
helm install temporal temporal/temporal \
  --namespace temporal \
  --set server.replicaCount=1

# Create the nexcom namespace in Temporal
kubectl exec -it temporal-admintools-0 -n temporal -- \
  tctl --namespace nexcom namespace register
```

Then set the secret:

```bash
kubectl create secret generic nexcom-temporal-secret \
  --namespace nexcom \
  --from-literal=TEMPORAL_ADDRESS=temporal-frontend.temporal.svc.cluster.local:7233 \
  --from-literal=TEMPORAL_NAMESPACE=nexcom
```

---

## Building and Deploying the Workers

### Build the Docker image

```bash
cd workflows/temporal
docker build -t nexcom/temporal-workers:latest .
docker push nexcom/temporal-workers:latest
```

### Deploy to Kubernetes

```bash
# Create the nexcom namespace (if not already created)
kubectl apply -f infra/k8s/temporal-workers.yaml

# Verify workers are running
kubectl get pods -n nexcom -l app=temporal-worker
```

Expected output:
```
NAME                                        READY   STATUS    RESTARTS   AGE
temporal-worker-deposit-7d9f8b4c6-abc12    1/1     Running   0          30s
temporal-worker-deposit-7d9f8b4c6-def34    1/1     Running   0          30s
temporal-worker-withdrawal-6c8e7a3b5-ghi56 1/1     Running   0          30s
temporal-worker-withdrawal-6c8e7a3b5-jkl78 1/1     Running   0          30s
temporal-worker-loan-5b7d6c2a4-mno90       1/1     Running   0          30s
temporal-worker-loan-5b7d6c2a4-pqr12       1/1     Running   0          30s
```

---

## Workflow Task Queues

All workers listen on the `nexcom-fund-flows` task queue. The Node.js server
triggers workflows using `triggerTemporalWorkflow()` which always targets this
queue.

| Workflow | Go file | Task Queue |
|----------|---------|------------|
| `DepositWorkflow` | `workflows/temporal/deposit/workflow.go` | `nexcom-fund-flows` |
| `WithdrawalWorkflow` | `workflows/temporal/withdrawal/workflow.go` | `nexcom-fund-flows` |
| `LoanDisbursementWorkflow` | `workflows/temporal/loan/workflow.go` | `nexcom-fund-flows` |

---

## Monitoring

Temporal provides a built-in Web UI at port 8080 (self-hosted) or via the
Temporal Cloud dashboard. Key metrics to monitor:

- **Workflow execution latency** — should be < 5s for deposits/withdrawals
- **Activity failure rate** — any failure triggers saga compensation
- **Pending workflow count** — should be near 0 in steady state
- **Task queue backlog** — scale up workers if backlog > 100
