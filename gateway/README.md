# NEXCOM Exchange — API Gateway & WAF

This directory contains the complete API gateway and Web Application Firewall (WAF) stack for NEXCOM Exchange, built on **Apache APISIX** and **open-appsec**.

## Architecture

```
Internet
    │
    ▼
┌─────────────────────────────────────────┐
│  APISIX (port 9080/9443)                │
│  ┌─────────────────────────────────┐    │
│  │  open-appsec ML WAF Plugin      │    │
│  │  (IPC shared with APISIX)       │    │
│  └─────────────────────────────────┘    │
│  Routes: 14 routes covering all APIs    │
└─────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────┐
│  NEXCOM Exchange Backend (port 3000)    │
│  ├── tRPC API (/api/trpc/*)             │
│  ├── OAuth (/api/oauth/*)               │
│  ├── Stripe Webhooks                    │
│  └── WebSocket (/ws)                    │
└─────────────────────────────────────────┘
    │
    ├── Go DDoS Guard (port 8888)
    ├── Rust Crypto Guard (port 8765)
    ├── Python Fraud Engine (port 8000)
    ├── FIX Gateway (port 8080)
    ├── Indices Service (port 8081)
    └── Core Banking (port 8090)
```

## Components

| Component | Image | Purpose |
|---|---|---|
| APISIX | `ghcr.io/openappsec/apisix-attachment:latest` | API gateway with open-appsec plugin |
| open-appsec Agent | `ghcr.io/openappsec/agent:latest` | ML-based WAF (prevent mode) |
| APISIX Dashboard | `apache/apisix-dashboard:3.0.1-alpine` | Web UI for route management |
| Prometheus | `prom/prometheus:v2.51.0` | Metrics collection |
| Grafana | `grafana/grafana:10.4.0` | Metrics dashboards |

## Quick Start

**1. Start the main NEXCOM stack first:**

```bash
docker compose up -d
```

**2. Start the gateway stack:**

```bash
docker compose -f gateway/docker-compose.gateway.yml up -d
```

**3. Verify APISIX is running:**

```bash
curl http://localhost:9080/health
```

**4. Access management UIs:**

| Service | URL | Default Credentials |
|---|---|---|
| APISIX Dashboard | http://localhost:9000 | admin / nexcom-admin-change-in-production |
| Grafana | http://localhost:3001 | admin / nexcom-grafana-admin |
| Prometheus | http://localhost:9090 | — |

## Configuration Files

```
gateway/
├── docker-compose.gateway.yml          # Gateway stack definition
├── apisix/
│   └── apisix-standalone.yaml          # APISIX routes, upstreams, plugins
├── apisix-dashboard/
│   └── conf.yaml                       # Dashboard configuration
├── open-appsec/
│   ├── appsec-config/
│   │   └── agent.conf                  # Agent settings
│   └── appsec-localconfig/
│       └── local_policy.yaml           # WAF policy (prevent mode)
├── prometheus/
│   └── prometheus.yml                  # Prometheus scrape config
└── grafana/
    └── provisioning/                   # Auto-provisioned dashboards
```

## WAF Policy Details

The open-appsec policy (`local_policy.yaml`) implements two protection tiers:

**Standard tier** (`nexcom-financial-practice`) — applied to all routes:
- Web attack prevention (SQLi, XSS, path traversal, command injection)
- Anti-bot protection on auth endpoints
- CSRF protection active
- Minimum confidence: medium (reduces false positives)
- Max body size: 2 MB

**Strict tier** (`nexcom-strict-practice`) — applied to admin and banking routes:
- All standard protections plus
- Minimum confidence: low (catches more attacks)
- Max body size: 512 KB
- Max URL size: 4 KB

## Rate Limiting

APISIX enforces per-IP rate limits on all routes:

| Route | Rate | Burst |
|---|---|---|
| Frontend | 100 req/s | 200 |
| tRPC API | 200 req/s | 400 |
| OAuth | 20 req/s | 30 |
| Admin API | 50 req/s | 100 |
| Banking API | 100 req/s + 1000/hour per user | 150 |
| FIX Gateway | 500 req/s | 1000 |

## Production Hardening Checklist

Before going live, complete these steps:

1. **Change all default passwords** in `apisix-dashboard/conf.yaml` and the Grafana `GF_SECURITY_ADMIN_PASSWORD` env var.
2. **Set `APPSEC_USER_EMAIL`** in your `.env` file to receive open-appsec security reports.
3. **Restrict APISIX Admin API** (port 9180) to internal IPs only — never expose to the internet.
4. **Enable TLS** on APISIX port 9443 with your SSL certificate.
5. **Set `APPSEC_AGENT_TOKEN`** if using open-appsec cloud-connected mode for centralized policy management.
6. **Restrict APISIX Dashboard** (port 9000) to VPN/internal network only.
7. **Add IP allowlist** for admin routes in `apisix-standalone.yaml` (commented section under `nexcom-admin-api`).

## Updating Routes

Edit `gateway/apisix/apisix-standalone.yaml` and restart APISIX:

```bash
docker compose -f gateway/docker-compose.gateway.yml restart apisix
```

Changes take effect within 30 seconds (APISIX polls the config file).

## Logs

```bash
# APISIX access logs
docker logs nexcom-apisix

# open-appsec WAF events (JSON format)
docker exec nexcom-appsec-agent tail -f /var/log/nano_agent/nano_agent.log

# Blocked requests
docker exec nexcom-appsec-agent grep "Prevent" /var/log/nano_agent/nano_agent.log
```

## open-appsec Learning Mode

open-appsec uses ML to learn your application's normal traffic patterns. For the first 24-48 hours in a new environment, set `mode: prevent-learn` in `local_policy.yaml` to allow the model to learn before enforcing. After the learning period, switch to `mode: prevent`.

## References

- [APISIX Documentation](https://apisix.apache.org/docs/)
- [open-appsec Documentation](https://docs.openappsec.io/)
- [open-appsec APISIX Integration](https://www.openappsec.io/post/announcing-open-appsec-waf-integration-with-apache-apisix-api-gateway)
- [open-appsec GitHub](https://github.com/openappsec/openappsec)
