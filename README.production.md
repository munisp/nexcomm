# NEXCOM Exchange — Production Deployment Guide

## Overview

NEXCOM Exchange is a full-stack African commodity exchange platform comprising:
- **Web Portal** (React 19 + tRPC + Express, port 3000)
- **React Native App** (Expo, iOS + Android)
- **Flutter App** (iOS + Android + Web)
- **Go Services**: channel-gateway (8082), aml-alert-subscriber (8091)
- **Python Services**: bot-logic (8083), analytics-engine (8006), ai-ml (8007), analytics (8009), kyc-service (8086)
- **Rust Services**: matching-engine (8080), settlement-engine (8005), ussd-engine (8084)

---

## Required Environment Variables

### Core Platform (set in Manus Secrets panel)

| Variable | Description | Default |
|---|---|---|
| `DATABASE_URL` | MySQL/TiDB connection string | (auto-injected) |
| `JWT_SECRET` | Session cookie signing secret | (auto-injected) |
| `VITE_APP_ID` | Manus OAuth app ID | (auto-injected) |
| `OAUTH_SERVER_URL` | Manus OAuth backend URL | (auto-injected) |
| `VITE_OAUTH_PORTAL_URL` | Manus login portal URL | (auto-injected) |
| `BUILT_IN_FORGE_API_KEY` | Manus built-in API key | (auto-injected) |
| `BUILT_IN_FORGE_API_URL` | Manus built-in API URL | (auto-injected) |
| `STRIPE_SECRET_KEY` | Stripe secret key | (auto-injected) |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook secret | (auto-injected) |
| `VITE_STRIPE_PUBLISHABLE_KEY` | Stripe publishable key | (auto-injected) |

### Microservice URLs (set in production)

| Variable | Description | Default |
|---|---|---|
| `CORE_BANKING_URL` | Core banking service URL | `http://localhost:8090` |
| `CHANNEL_GATEWAY_URL` | Channel gateway URL | `http://localhost:8082` |
| `BOT_LOGIC_URL` | Bot logic service URL | `http://localhost:8083` |
| `USSD_ENGINE_URL` | USSD engine URL | `http://localhost:8084` |
| `INDICES_SERVICE_URL` | Indices service URL | `http://localhost:8081` |

### Channel Gateway Secrets (optional, for WhatsApp/Telegram/SMS)

| Variable | Description | Default |
|---|---|---|
| `WHATSAPP_ACCESS_TOKEN` | Meta WhatsApp Business API token | `""` |
| `WHATSAPP_PHONE_NUMBER_ID` | WhatsApp phone number ID | `""` |
| `WHATSAPP_VERIFY_TOKEN` | WhatsApp webhook verify token | `nexcom-wa-verify` |
| `TELEGRAM_BOT_TOKEN` | Telegram bot token | `""` |
| `AFRICASTALKING_API_KEY` | Africa's Talking SMS API key | `""` |
| `AFRICASTALKING_USERNAME` | Africa's Talking username | `sandbox` |

### Email (optional, for transactional emails)

| Variable | Description | Default |
|---|---|---|
| `SENDGRID_API_KEY` | SendGrid API key | `""` |
| `SMTP_HOST` | SMTP server host | `""` |
| `SMTP_PORT` | SMTP port | `587` |
| `SMTP_USER` | SMTP username | `""` |
| `SMTP_PASS` | SMTP password | `""` |
| `EMAIL_FROM` | From address | `noreply@nexcom.exchange` |
| `EMAIL_ENABLED` | Enable email sending | `true` |

### Web Push (optional, for browser push notifications)

| Variable | Description | Default |
|---|---|---|
| `VAPID_PUBLIC_KEY` | VAPID public key | `""` |
| `VAPID_PRIVATE_KEY` | VAPID private key | `""` |
| `VAPID_SUBJECT` | VAPID subject (mailto:) | `mailto:admin@nexcom.exchange` |

Generate VAPID keys: `npx web-push generate-vapid-keys`

### Infrastructure (optional, for direct DB/cache access)

| Variable | Description | Default |
|---|---|---|
| `KAFKA_BROKERS` | Kafka broker list | `localhost:9092` |
| `REDIS_URL` | Redis connection URL | `redis://localhost:6379` |
| `NEXCOM_PG_URL` | PostgreSQL direct URL | `""` |
| `NEXCOM_PG_READ_URL` | PostgreSQL read replica URL | `""` |
| `INTERNAL_SECRET` | Cross-service auth secret | `nexcom-internal-2026` |

---

## Stripe Setup

1. Claim your Stripe sandbox at the URL shown in the Manus project settings
2. Use test card `4242 4242 4242 4242` for testing
3. Go to Settings → Payment to configure live keys after Stripe KYC

---

## React Native Build

```bash
cd nexcom-mobile
pnpm install
# Development
npx expo start
# iOS build
eas build --platform ios
# Android build
eas build --platform android
```

Update `constants/config.ts` → `BASE_URL` to point to your production server.

---

## Flutter Build

```bash
cd nexcom-flutter
flutter pub get
# Development
flutter run
# iOS release
flutter build ios --release
# Android release
flutter build apk --release
```

Update `lib/services/api_service.dart` → `baseUrl` to point to your production server.

---

## Go Services Build

```bash
# Channel Gateway
cd services/channel-gateway
go build -o channel-gateway ./cmd/server/
./channel-gateway

# AML Alert Subscriber
cd services/aml-alert-subscriber
go build -o aml-alert-subscriber .
./aml-alert-subscriber
```

---

## Python Services

```bash
# Bot Logic
cd services/bot-logic
pip install -r requirements.txt
uvicorn app.main:app --host 0.0.0.0 --port 8083

# Analytics Engine
cd services/analytics-engine
pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 8006

# KYC Service
cd services/kyc-service
pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 8086
```

---

## Rust Services

```bash
# Matching Engine
cd services/matching-engine
cargo build --release
./target/release/matching-engine

# Settlement Engine
cd services/settlement-engine
cargo build --release
./target/release/settlement-engine

# USSD Engine
cd services/ussd-engine
cargo build --release
./target/release/ussd-engine
```

---

## Database Migrations

```bash
cd nexcom-exchange
pnpm db:push
```

---

## Health Checks

- Portal: `GET /api/health`
- Matching Engine: `GET http://localhost:8080/health`
- Channel Gateway: `GET http://localhost:8082/health`
- Bot Logic: `GET http://localhost:8083/health`
- USSD Engine: `GET http://localhost:8084/health`
- Analytics Engine: `GET http://localhost:8006/health`

Admin Platform Health dashboard: `/admin/platform-health`

---

## Security Checklist

- [ ] Change `INTERNAL_SECRET` from default value
- [ ] Set `JWT_SECRET` to a strong random value (min 32 chars)
- [ ] Configure VAPID keys for web push
- [ ] Enable HTTPS/TLS termination at load balancer
- [ ] Set `NODE_ENV=production`
- [ ] Configure CORS origins in `server/_core/index.ts`
- [ ] Enable rate limiting (configured via `API_RATE_LIMIT_PER_MINUTE`)
- [ ] Review IP allowlist settings in Admin → Security
- [ ] Enable 2FA/TOTP for all admin accounts

---

## Support

Email: support@nexcom.exchange
Admin: admin@nexcom.exchange
