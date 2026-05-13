# NEXCOM Exchange — Environment Variables Reference

All system-injected variables (DATABASE_URL, JWT_SECRET, etc.) are documented in the main README.
This file documents the **additional** variables used in the codebase that operators must configure.

## Microservices

| Variable | Default | Description |
|----------|---------|-------------|
| `KYC_SERVICE_URL` | `http://localhost:3002` | Python KYC Service (OCR, liveness, KYB) |
| `CREDIT_SCORING_URL` | `http://localhost:8010` | Rust credit-scoring microservice |
| `FRAUD_ENGINE_URL` | `http://localhost:8011` | Python fraud-engine microservice |
| `CRYPTO_GUARD_URL` | `http://localhost:8012` | Rust crypto-guard microservice |
| `DDOS_GUARD_URL` | `http://localhost:8013` | Go ddos-guard microservice |
| `AML_ALERT_URL` | `http://localhost:8014` | Go aml-alert-subscriber microservice |
| `OPENSEARCH_URL` | `http://localhost:9200` | OpenSearch / opensearch-sync endpoint |
| `MIDDLEWARE_HUB_URL` | `http://localhost:8015` | Go middleware-hub microservice |
| `BOT_LOGIC_URL` | `http://localhost:8016` | Python bot-logic microservice |

## External Integrations

| Variable | Default | Description |
|----------|---------|-------------|
| `INDICES_SERVICE_URL` | `http://localhost:3010` | Indices aggregation service |
| `CORE_BANKING_URL` | `http://localhost:3020` | Core banking system (fiat deposits/withdrawals) |
| `CHANNEL_GATEWAY_URL` | `http://localhost:3030` | USSD/WhatsApp channel gateway |
| `USSD_ENGINE_URL` | `http://localhost:3031` | USSD engine for feature phone access |

## Feature Flags

| Variable | Default | Description |
|----------|---------|-------------|
| `ENABLE_BLOCKCHAIN` | `false` | Enable on-chain settlement via blockchain router |
| `ENABLE_CRYPTO_GUARD` | `false` | Enable crypto-guard transaction screening |

## Notes

- All URLs default to localhost for local development.
- In production, replace with internal service discovery URLs (e.g., Kubernetes service names).
- Variables injected by the Manus platform (DATABASE_URL, JWT_SECRET, STRIPE_*, VAPID_*, etc.) do not need to be set manually.
- The `BOT_LOGIC_URL` is already injected by the platform — no manual configuration needed.
