# NEXCOM Wazuh SIEM — Deployment Guide

This directory contains all Kubernetes manifests required to deploy Wazuh 4.9 as the NEXCOM security information and event management (SIEM) platform. The deployment provides ISO 27001 controls A.8.15 (information logging), A.8.16 (monitoring activities), and A.8.8 (vulnerability management).

## Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│                    wazuh namespace                       │
│                                                          │
│  ┌──────────────┐    ┌──────────────┐    ┌───────────┐  │
│  │ Wazuh Manager│◄───│ Wazuh Agents │    │  Wazuh    │  │
│  │ (StatefulSet)│    │ (DaemonSet)  │    │ Dashboard │  │
│  │  port 1514   │    │  all nodes   │    │ port 5601 │  │
│  └──────┬───────┘    └──────────────┘    └─────┬─────┘  │
│         │                                       │        │
│         ▼                                       ▼        │
│  ┌──────────────────────────────────────────────────┐   │
│  │           Wazuh Indexer (OpenSearch)              │   │
│  │                   port 9200                       │   │
│  └──────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
         │
         ▼ alerts
┌─────────────────┐
│  PagerDuty /    │
│  Slack webhook  │
└─────────────────┘
```

## Prerequisites

- Kubernetes 1.28+ with `kubectl` configured
- Helm 3.12+
- `cert-manager` deployed (for TLS certificate management)
- At least 3 nodes with 4 CPU / 8GB RAM each for Wazuh components
- `fast-ssd` StorageClass available (or modify PVC specs)

## Step 1: Create the Wazuh namespace and secrets

```bash
# Create namespace
kubectl apply -f wazuh-manager-deployment.yaml --dry-run=client  # validate first
kubectl create namespace wazuh

# Create TLS certificates (using cert-manager)
kubectl apply -f - <<EOF
apiVersion: cert-manager.io/v1
kind: Certificate
metadata:
  name: wazuh-tls
  namespace: wazuh
spec:
  secretName: wazuh-tls-secret
  issuerRef:
    name: nexcom-ca-issuer
    kind: ClusterIssuer
  dnsNames:
    - wazuh-manager-service.wazuh.svc.cluster.local
    - wazuh-indexer-service.wazuh.svc.cluster.local
    - siem.nexcom.exchange
EOF

# Create Wazuh Indexer credentials (use strong random passwords)
kubectl create secret generic wazuh-indexer-credentials \
  --namespace wazuh \
  --from-literal=username=wazuh_admin \
  --from-literal=password="$(openssl rand -base64 32)"

# Create Wazuh Dashboard credentials
kubectl create secret generic wazuh-dashboard-credentials \
  --namespace wazuh \
  --from-literal=username=wazuh_dashboard \
  --from-literal=password="$(openssl rand -base64 32)"

# Create Wazuh Agent registration password
kubectl create secret generic wazuh-agent-credentials \
  --namespace wazuh \
  --from-literal=registration-password="$(openssl rand -base64 32)"

# Create PgBouncer exporter DSN (for metrics)
kubectl create secret generic pgbouncer-exporter-credentials \
  --namespace nexcom-db \
  --from-literal=dsn="postgresql://pgbouncer_monitor:PASSWORD@pgbouncer-service:5432/pgbouncer"
```

## Step 2: Deploy Wazuh Indexer (OpenSearch)

```bash
# Add Wazuh Helm repository
helm repo add wazuh https://packages.wazuh.com/4.x/helm
helm repo update

# Deploy Wazuh Indexer
helm install wazuh-indexer wazuh/wazuh-indexer \
  --namespace wazuh \
  --set replicas=3 \
  --set resources.requests.memory=2Gi \
  --set resources.limits.memory=4Gi \
  --set persistence.size=100Gi \
  --set persistence.storageClass=fast-ssd \
  --set tls.secretName=wazuh-tls-secret

# Wait for Indexer to be ready
kubectl rollout status statefulset/wazuh-indexer -n wazuh --timeout=300s
```

## Step 3: Apply ConfigMaps and deploy Manager

```bash
# Apply ConfigMaps (rules and ossec.conf)
kubectl apply -f wazuh-configmap.yaml

# Deploy Wazuh Manager
kubectl apply -f wazuh-manager-deployment.yaml

# Wait for Manager to be ready
kubectl rollout status statefulset/wazuh-manager -n wazuh --timeout=300s

# Verify Manager is running
kubectl logs -n wazuh statefulset/wazuh-manager --tail=20
```

## Step 4: Deploy Wazuh Agents on all nodes

```bash
# Deploy DaemonSet (agents run on every node)
kubectl apply -f wazuh-agent-daemonset.yaml

# Verify agents are registered with Manager
kubectl exec -n wazuh statefulset/wazuh-manager -- /var/ossec/bin/agent_control -l
```

## Step 5: Deploy Dashboard and Network Policies

```bash
# Apply Network Policies first (security-first deployment)
kubectl apply -f wazuh-networkpolicy.yaml

# Verify Dashboard is accessible
kubectl rollout status deployment/wazuh-dashboard -n wazuh --timeout=180s

# Get Dashboard URL
echo "Wazuh Dashboard: https://siem.nexcom.exchange"
echo "Credentials: see wazuh-dashboard-credentials secret"
```

## Step 6: Configure NEXCOM-specific alert integrations

### PagerDuty integration (for Critical/High alerts)

```bash
# Add PagerDuty integration key to Wazuh Manager
kubectl exec -n wazuh statefulset/wazuh-manager -- bash -c '
cat >> /var/ossec/etc/ossec.conf << EOF
<integration>
  <name>pagerduty</name>
  <api_key>YOUR_PAGERDUTY_INTEGRATION_KEY</api_key>
  <level>10</level>
  <alert_format>json</alert_format>
</integration>
EOF
/var/ossec/bin/ossec-control restart'
```

### Slack integration (for Medium alerts)

```bash
kubectl exec -n wazuh statefulset/wazuh-manager -- bash -c '
cat >> /var/ossec/etc/ossec.conf << EOF
<integration>
  <name>slack</name>
  <hook_url>https://hooks.slack.com/services/YOUR/SLACK/WEBHOOK</hook_url>
  <level>7</level>
  <alert_format>json</alert_format>
</integration>
EOF
/var/ossec/bin/ossec-control restart'
```

## Verification Checklist

After deployment, verify the following:

- [ ] `kubectl get pods -n wazuh` — all pods Running
- [ ] Wazuh Dashboard accessible at `https://siem.nexcom.exchange`
- [ ] All Kubernetes nodes appear as registered agents in Dashboard
- [ ] File integrity monitoring alerts firing for test file changes in `/etc`
- [ ] PostgreSQL audit logs appearing in Wazuh Dashboard
- [ ] NEXCOM custom rules (100001–100010) visible in Rules section
- [ ] PagerDuty receiving test alert (level 10+)
- [ ] Network policies verified with `kubectl describe networkpolicy -n wazuh`

## ISO 27001 Compliance Mapping

| Wazuh Feature | ISO 27001:2022 Control |
|---|---|
| Log aggregation (all services) | A.8.15 — Information logging |
| Real-time alerting | A.8.16 — Monitoring activities |
| File integrity monitoring | A.8.8 — Vulnerability management |
| Vulnerability scanning | A.8.8 — Vulnerability management |
| Docker/container monitoring | A.8.32 — Change management |
| Kubernetes audit log analysis | A.8.15 — Information logging |
| Custom NEXCOM rules (100001–100010) | A.8.16 — Monitoring activities |
| Compliance dashboards (PCI, ISO) | A.5.36 — Compliance with policies |

## Maintenance

**Log retention**: Wazuh Indexer retains logs for 90 days by default. Configure ILM (Index Lifecycle Management) policies in OpenSearch to archive logs to S3 after 90 days and delete after 1 year (ISO 27001 A.8.15 requires minimum 1-year retention for security logs).

**Rule updates**: Wazuh automatically updates its ruleset from the Wazuh repository. Custom rules in `nexcom-rules.xml` are preserved across updates.

**Agent updates**: Use the DaemonSet rolling update strategy to update agents without downtime: `kubectl set image daemonset/wazuh-agent wazuh-agent=wazuh/wazuh-agent:NEW_VERSION -n wazuh`.
