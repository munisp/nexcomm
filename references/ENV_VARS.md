# NEXCOM Exchange — Environment Variables Reference

All system-injected variables (DATABASE_URL, JWT_SECRET, etc.) are documented in the main README.
This file documents **all** variables used in the codebase that operators must configure for production.

---

## Platform-Injected (Manus Managed)

These variables are automatically injected by the Manus platform. Do not set them manually.

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | MySQL/TiDB connection string (primary DB) |
| `JWT_SECRET` | Session cookie signing secret |
| `VITE_APP_ID` | Manus OAuth application ID |
| `OAUTH_SERVER_URL` | Manus OAuth backend base URL |
| `VITE_OAUTH_PORTAL_URL` | Manus login portal URL (frontend) |
| `OWNER_OPEN_ID` | Owner's Manus OpenID |
| `BUILT_IN_FORGE_API_URL` | Manus built-in APIs base URL |
| `BUILT_IN_FORGE_API_KEY` | Bearer token for server-side Manus APIs |
| `VITE_FRONTEND_FORGE_API_KEY` | Bearer token for frontend Manus APIs |
| `VITE_FRONTEND_FORGE_API_URL` | Manus built-in APIs URL for frontend |
| `STRIPE_SECRET_KEY` | Stripe secret key for payment processing |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook signing secret |
| `VAPID_PRIVATE_KEY` | VAPID private key for Web Push notifications |
| `VAPID_PUBLIC_KEY` | VAPID public key for Web Push notifications |
| `VAPID_SUBJECT` | VAPID subject (mailto: or URL) |
| `BOT_LOGIC_URL` | Python bot-logic microservice URL |
| `CHANNEL_GATEWAY_URL` | USSD/WhatsApp channel gateway URL |
| `CORE_BANKING_URL` | Core banking system URL |
| `INDICES_SERVICE_URL` | Indices aggregation service URL |
| `USSD_ENGINE_URL` | USSD engine URL |

---

## PostgreSQL (Read Replica)

| Variable | Default | Description |
|----------|---------|-------------|
| `NEXCOM_PG_URL` | *(none)* | Primary PostgreSQL connection string (used by tests and direct PG queries) |
| `NEXCOM_PG_READ_URL` | `$NEXCOM_PG_URL` | Read-replica PostgreSQL URL; falls back to primary if not set |

---

## Microservices

| Variable | Default | Description |
|----------|---------|-------------|
| `KYC_SERVICE_URL` | `http://localhost:3002` | Python KYC Service (OCR, liveness, KYB) |
| `CREDIT_SCORING_URL` | `http://localhost:8010` | Rust credit-scoring microservice |
| `FRAUD_ENGINE_URL` | `http://localhost:8011` | Python fraud-engine microservice |
| `CRYPTO_GUARD_URL` | `http://localhost:8012` | Rust crypto-guard microservice |
| `DDOS_GUARD_URL` | `http://localhost:8013` | Go ddos-guard microservice |
| `AML_ALERT_URL` | `http://localhost:8014` | Go aml-alert-subscriber microservice |
| `AML_ALERT_SUBSCRIBER_URL` | `http://localhost:8014` | Alias for AML_ALERT_URL |
| `OPENSEARCH_URL` | `http://localhost:9200` | OpenSearch endpoint |
| `OPENSEARCH_SYNC_URL` | `http://localhost:8016` | opensearch-sync microservice URL |
| `MIDDLEWARE_HUB_URL` | `http://localhost:8015` | Go middleware-hub microservice |
| `AIML_SERVICE_URL` | `http://localhost:8020` | AI/ML inference service |
| `ANALYTICS_ENGINE_URL` | `http://localhost:8021` | Analytics aggregation engine |
| `INGESTION_ENGINE_URL` | `http://localhost:8022` | Data ingestion engine |
| `RISK_SERVICE_URL` | `http://localhost:8023` | Risk management service |
| `NOTIFICATION_SERVICE_URL` | `http://localhost:8024` | Notification dispatch service |
| `USER_MANAGEMENT_URL` | `http://localhost:8025` | User management service |
| `GATEWAY_SERVICE_URL` | `http://localhost:8026` | API gateway service |
| `GATEWAY_URL` | `http://localhost:8026` | Alias for GATEWAY_SERVICE_URL |
| `BLOCKCHAIN_SERVICE_URL` | `http://localhost:8030` | Blockchain/on-chain settlement service |
| `SEDONA_URL` | `http://localhost:8031` | Apache Sedona geospatial service |

---

## Trading Engine

| Variable | Default | Description |
|----------|---------|-------------|
| `MATCHING_ENGINE_URL` | `http://localhost:8001` | Order matching engine URL |
| `MATCHING_ENGINE_PORT` | `8001` | Matching engine listen port |
| `TRADING_ENGINE_URL` | `http://localhost:8002` | Trading engine URL |
| `TRADING_ENGINE_PORT` | `8002` | Trading engine listen port |
| `SETTLEMENT_ENGINE_URL` | `http://localhost:8003` | Settlement engine URL |
| `SETTLEMENT_ENGINE_PORT` | `8003` | Settlement engine listen port |
| `RISK_MANAGEMENT_PORT` | `8004` | Risk management service listen port |

---

## Infrastructure

| Variable | Default | Description |
|----------|---------|-------------|
| `REDIS_URL` | `redis://localhost:6379` | Redis connection string (caching, sessions, pub/sub) |
| `KAFKA_BROKERS` | `localhost:9092` | Comma-separated Kafka broker addresses |
| `TIGERBEETLE_ADDRESSES` | `localhost:3000` | TigerBeetle ledger cluster addresses |
| `TEMPORAL_HOST` | `localhost:7233` | Temporal workflow engine host |
| `PORT` | `3000` | Server listen port |
| `GATEWAY_PORT` | `8080` | API gateway listen port |
| `GRPC_PORT` | `50051` | gRPC server listen port |

---

## Mojaloop / Interoperability

| Variable | Default | Description |
|----------|---------|-------------|
| `MOJALOOP_ADAPTER_URL` | `http://localhost:4000` | Mojaloop scheme adapter URL |
| `MOJALOOP_HUB_URL` | `http://ml-api-adapter:3000` | Mojaloop hub API adapter URL |
| `NEXCOM_DFSP_ID` | `nexcom` | DFSP identifier for Mojaloop interoperability |

---

## Email / SMTP

| Variable | Default | Description |
|----------|---------|-------------|
| `EMAIL_ENABLED` | `false` | Enable email sending (`true`/`false`) |
| `EMAIL_FROM` | `noreply@nexcom.exchange` | From address for outbound emails |
| `SENDGRID_API_KEY` | *(none)* | SendGrid API key (used when SMTP not configured) |
| `SMTP_HOST` | *(none)* | SMTP server hostname |
| `SMTP_PORT` | `587` | SMTP server port |
| `SMTP_SECURE` | `false` | Use TLS for SMTP (`true`/`false`) |
| `SMTP_USER` | *(none)* | SMTP authentication username |
| `SMTP_PASS` | *(none)* | SMTP authentication password |

---

## Messaging Channels

| Variable | Default | Description |
|----------|---------|-------------|
| `AFRICASTALKING_API_KEY` | *(none)* | Africa's Talking API key (SMS/USSD) |
| `AFRICASTALKING_USERNAME` | `sandbox` | Africa's Talking username |
| `WHATSAPP_ACCESS_TOKEN` | *(none)* | WhatsApp Business API access token |
| `WHATSAPP_PHONE_NUMBER_ID` | *(none)* | WhatsApp Business phone number ID |
| `WHATSAPP_VERIFY_TOKEN` | *(none)* | WhatsApp webhook verification token |
| `TELEGRAM_BOT_TOKEN` | *(none)* | Telegram bot token for notifications |

---

## Security & Access Control

| Variable | Default | Description |
|----------|---------|-------------|
| `CORS_ORIGINS` | `http://localhost:5173` | Comma-separated allowed CORS origins |
| `INTERNAL_SECRET` | *(none)* | Shared secret for internal service-to-service calls |
| `INTERNAL_JOB_SECRET` | *(none)* | Shared secret for scheduled job heartbeat endpoints |
| `HA_ADMIN_TOKEN` | *(none)* | High-availability admin token for cluster operations |
| `PERMIFY_URL` | `http://localhost:3476` | Permify PBAC engine URL |
| `PERMIFY_TENANT` | `t1` | Permify tenant identifier |
| `PERMIFY_FAIL_OPEN` | `false` | If `true`, allow access when Permify is unreachable |

---

## Feature Flags

| Variable | Default | Description |
|----------|---------|-------------|
| `ENABLE_BLOCKCHAIN` | `false` | Enable on-chain settlement via blockchain router |
| `ENABLE_CRYPTO_GUARD` | `false` | Enable crypto-guard transaction screening |
| `DISABLE_ENGINES` | `false` | Disable all trading engine connections (useful for testing) |
| `LEADER_ELECTION_ENABLED` | `false` | Enable distributed leader election for HA deployments |

---

## Kubernetes / Cloud

| Variable | Default | Description |
|----------|---------|-------------|
| `KEDA_NAMESPACE` | `default` | Kubernetes namespace for KEDA autoscaler |
| `PORTAL_URL` | `https://nexcom.exchange` | Public portal URL (used in notification links) |

---

## Runtime

| Variable | Default | Description |
|----------|---------|-------------|
| `NODE_ENV` | `development` | Node.js environment (`development`/`production`/`test`) |
| `RUST_LOG` | `info` | Rust microservice log level (`trace`/`debug`/`info`/`warn`/`error`) |

---

## Notes

1. All URLs default to `localhost` for local development. In production, replace with internal service discovery URLs (e.g., Kubernetes service names or Docker Compose service names).
2. Variables injected by the Manus platform (`DATABASE_URL`, `JWT_SECRET`, `STRIPE_*`, `VAPID_*`, etc.) do not need to be set manually.
3. The `BOT_LOGIC_URL` is already injected by the Manus platform — no manual configuration needed.
4. For Kubernetes deployments, use a `ConfigMap` for non-sensitive variables and `Secret` objects for API keys, tokens, and passwords.
5. The `.env.example` file in the project root contains a minimal set of variables for local development. This file is the authoritative reference for all variables.
