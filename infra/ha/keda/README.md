# NEXCOM Exchange — KEDA Autoscaling Setup

## Prerequisites

```bash
# 1. Install KEDA 2.x
helm repo add kedacore https://kedacore.github.io/charts
helm repo update
helm install keda kedacore/keda --namespace keda --create-namespace

# 2. Install Prometheus Operator (for ServiceMonitors)
helm repo add prometheus-community https://prometheus-community.github.io/helm-charts
helm install kube-prometheus-stack prometheus-community/kube-prometheus-stack \
  --namespace monitoring --create-namespace

# 3. Create the nexcom namespace
kubectl create namespace nexcom
```

## Create Secrets

```bash
# Kafka credentials
kubectl create secret generic nexcom-kafka-credentials \
  --from-literal=bootstrapServers="broker1:9092,broker2:9092,broker3:9092" \
  --from-literal=saslUsername="nexcom" \
  --from-literal=saslPassword="<your-kafka-password>" \
  -n nexcom

# Redis credentials
kubectl create secret generic nexcom-redis-credentials \
  --from-literal=address="redis-master.nexcom.svc.cluster.local:6379" \
  --from-literal=password="<your-redis-password>" \
  -n nexcom
```

## Deploy

```bash
# Apply in order
kubectl apply -f keda-trigger-auth.yaml
kubectl apply -f scaled-objects.yaml
kubectl apply -f prometheus-service-monitor.yaml

# Verify ScaledObjects are active
kubectl get scaledobjects -n nexcom
kubectl describe scaledobject matching-engine-scaledobject -n nexcom
```

## Scaling Behaviour Summary

| Engine | Min Pods | Max Pods | Primary Trigger | Threshold |
|---|---|---|---|---|
| MatchingEngine | 3 | 20 | Kafka `orders.incoming` lag | 500 msgs |
| SettlementEngine | 2 | 10 | Kafka `settlement.pending` lag | 100 msgs |
| GatewayService | 3 | 15 | Kafka `api.requests` lag | 1000 msgs |
| TradingEngine | 2 | 12 | Kafka `trades.pending` lag | 300 msgs |
| RiskManagement | 2 | 8 | Kafka `risk.checks` lag | 200 msgs |

## Never-Offline Guarantees

- `minReplicaCount` is set to ≥ 2 for all engines (≥ 3 for critical engines)
- `fallback.replicas` ensures KEDA falls back to the minimum HA count if triggers fail
- `scaleDown.stabilizationWindowSeconds` is set high (300–600s) to prevent premature scale-down
- PodDisruptionBudgets in `../matching-engine/deployment.yaml` ensure at least 2 pods survive node drains
