# NEXCOM — Grafana OnCall (Open-Source PagerDuty Alternative)

Grafana OnCall replaces PagerDuty for NEXCOM's on-call alerting. It is fully open-source (Apache 2.0), self-hosted on Kubernetes, and integrates natively with Wazuh SIEM, Slack, and the Grafana OnCall mobile app.

---

## Architecture

```
Wazuh Manager ──webhook──► Grafana OnCall Engine ──► Escalation Policy
                                                    ├── Slack #nexcom-security-alerts
                                                    ├── Mobile Push (iOS / Android)
                                                    └── Email (SMTP)

Grafana UI ──────────────► OnCall Plugin ──────────► On-Call Schedule
                                                    └── Incident Management
```

---

## Deployment Order

```bash
# 1. Create namespace, RBAC, and ServiceAccount
kubectl apply -f 00-namespace-rbac.yaml

# 2. Deploy PostgreSQL and Redis dependencies
kubectl apply -f 01-dependencies.yaml
kubectl rollout status statefulset/grafana-oncall-postgres -n monitoring
kubectl rollout status deployment/grafana-oncall-redis -n monitoring

# 3. Deploy Grafana OnCall engine and Celery workers
kubectl apply -f 02-oncall-engine.yaml
kubectl rollout status deployment/grafana-oncall-engine -n monitoring

# 4. Deploy Grafana with OnCall plugin
kubectl apply -f 03-grafana.yaml
kubectl rollout status deployment/grafana -n monitoring

# 5. Deploy Wazuh → OnCall integration
kubectl apply -f 04-wazuh-integration.yaml
```

---

## Initial Configuration

### Step 1 — Change default passwords

Before deploying to production, update these values in the manifests:

| Secret | Key | Default | Action |
|--------|-----|---------|--------|
| `grafana-oncall-postgres-secret` | `POSTGRES_PASSWORD` | `oncall_secure_2026_CHANGEME` | Generate strong password |
| `grafana-oncall-secret` | `SECRET_KEY` | `CHANGEME_generate_...` | `python3 -c "import secrets; print(secrets.token_hex(32))"` |
| `grafana-secret` | `GF_SECURITY_ADMIN_PASSWORD` | `nexcom_grafana_CHANGEME_2026` | Set strong admin password |

### Step 2 — Access Grafana

```bash
# Port-forward for initial setup (before DNS is configured)
kubectl port-forward -n monitoring svc/grafana 3000:3000

# Open: http://localhost:3000
# Login: admin / nexcom_grafana_CHANGEME_2026
```

### Step 3 — Configure Grafana OnCall plugin

1. Navigate to **Configuration → Plugins → Grafana OnCall**
2. Click **Initialize OnCall**
3. Set **OnCall API URL**: `http://grafana-oncall.monitoring.svc.cluster.local:8080`
4. Click **Connect**

### Step 4 — Create Wazuh webhook integration

1. In Grafana, go to **OnCall → Integrations → New Integration**
2. Select **Webhook**
3. Name: `Wazuh SIEM`
4. Copy the generated webhook URL (format: `https://oncall.nexcom.exchange/integrations/v1/webhook/<TOKEN>/`)
5. Update the `ONCALL_WEBHOOK_URL` in `04-wazuh-integration.yaml`:
   ```yaml
   ONCALL_WEBHOOK_URL: "https://oncall.nexcom.exchange/integrations/v1/webhook/<YOUR_TOKEN>/"
   ```
6. Re-apply and restart Wazuh:
   ```bash
   kubectl apply -f 04-wazuh-integration.yaml
   kubectl rollout restart statefulset/wazuh-manager -n wazuh
   ```

### Step 5 — Seed escalation policies

```bash
kubectl cp 05-escalation-policy.yaml monitoring/$(kubectl get pod -n monitoring -l app=grafana-oncall,component=engine -o jsonpath='{.items[0].metadata.name}'):/tmp/
kubectl exec -n monitoring deploy/grafana-oncall-engine -- python manage.py shell < /tmp/seed-policy.py
```

### Step 6 — Add team members to on-call schedule

1. Go to **OnCall → Users** → invite team members
2. Each user installs the **Grafana OnCall mobile app** (iOS / Android)
3. Go to **OnCall → Schedules → NEXCOM Security On-Call**
4. Add users to the rotation

### Step 7 — Configure Slack (optional)

1. Create a Slack app at https://api.slack.com/apps
2. Add **Incoming Webhooks** and **Bot Token Scopes**: `chat:write`, `channels:read`
3. In Grafana OnCall → **Settings → Slack** → enter Bot Token and Signing Secret
4. Invite the bot to `#nexcom-security-alerts`

---

## Alert Routing

| Wazuh Level | Priority | Escalation Chain | Response Time |
|-------------|----------|-----------------|---------------|
| 13–15 | P0 | Critical → 5 min → re-notify → 10 min → whole team | Immediate |
| 10–12 | P1 | Critical → 5 min → re-notify → 10 min → whole team | < 5 min |
| 7–9 | P2 | Medium → 15 min → re-notify | < 15 min |
| 4–6 | P3 | Medium → 15 min → re-notify | < 30 min |
| 0–3 | P4 | Info only (no escalation) | Best effort |

---

## Helm Chart Alternative

For production deployments, the official Grafana OnCall Helm chart is recommended:

```bash
helm repo add grafana https://grafana.github.io/helm-charts
helm repo update
helm install grafana-oncall grafana/oncall \
  --namespace monitoring \
  --create-namespace \
  --values 05-escalation-policy.yaml  # contains helm-values.yaml section
```

---

## Comparison: Grafana OnCall vs PagerDuty

| Feature | Grafana OnCall (OSS) | PagerDuty |
|---------|---------------------|-----------|
| Cost | Free (self-hosted) | $21–$41/user/month |
| On-call schedules | ✅ | ✅ |
| Escalation policies | ✅ | ✅ |
| Mobile push alerts | ✅ (iOS + Android) | ✅ |
| Slack integration | ✅ | ✅ |
| Wazuh webhook | ✅ (custom script) | ✅ (custom script) |
| Grafana native | ✅ (plugin) | ❌ |
| Data sovereignty | ✅ (self-hosted) | ❌ (SaaS) |
| ISO 27001 alignment | ✅ (on-prem data) | Requires DPA |
| Maintenance overhead | Medium | None |

---

## Troubleshooting

```bash
# Check OnCall engine logs
kubectl logs -n monitoring deploy/grafana-oncall-engine --tail=100

# Check Celery worker logs
kubectl logs -n monitoring deploy/grafana-oncall-celery-worker --tail=50

# Test webhook manually
curl -X POST https://oncall.nexcom.exchange/integrations/v1/webhook/<TOKEN>/ \
  -H "Content-Type: application/json" \
  -d '{"title":"Test Alert","message":"Manual test from NEXCOM","state":"alerting","severity":"warning"}'

# Check Wazuh integration script
kubectl exec -n wazuh statefulset/wazuh-manager -- \
  ls -la /var/ossec/integrations/custom-oncall.py
```
