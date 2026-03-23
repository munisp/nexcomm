# NEXCOM Exchange — Commodity Trading Platform

A full-stack, production-ready commodity exchange platform for African agricultural markets. Built on React 19 + TypeScript + tRPC + PostgreSQL with 20 microservices, mobile apps (Flutter + React Native), USSD/WhatsApp/Telegram channels, and a blockchain settlement layer.

---

## Platform Overview

| Layer | Technology | Description |
|---|---|---|
| **Web PWA** | React 19 + Vite + Tailwind 4 | 118 pages, installable PWA, offline support |
| **API** | tRPC 11 + Express 4 | 215-table PostgreSQL schema, 70+ routers |
| **Flutter App** | Flutter 3.x + Dart | 19 screens, live order book, banking |
| **React Native App** | Expo + React Native | 15 screens, biometric auth, push alerts |
| **USSD Engine** | Rust (Axum) | Africa's Talking integration, full menu tree |
| **Bot Logic** | Python (FastAPI) | NLP intent classifier, WhatsApp + Telegram |
| **Channel Gateway** | Go (Gin) | WhatsApp Meta Cloud + Telegram Bot webhooks |
| **Core Banking** | Go | Temenos/Finacle/Mambu adapters, agri-banking |
| **Matching Engine** | Rust | High-performance order matching, FIX protocol |
| **Settlement Engine** | Rust | DvP settlement, TigerBeetle ledger integration |
| **Blockchain** | Go (Hyperledger Fabric) | Warehouse receipt tokenization, smart contracts |
| **Indices Service** | Go (gRPC) | NAXI, NGGI, AOXI, WACCI commodity indices |
| **Ingestion Engine** | TypeScript | TimescaleDB OHLCV, real-time price feeds |
| **Analytics** | Python | Market analytics, ML price prediction |

---

## Quick Start (Local Development)

### Prerequisites

- Node.js 22+ and pnpm
- PostgreSQL 14+ (local or remote)
- Git

### One-Command Restore

```bash
# 1. Unzip the archive
unzip nexcom-platform-complete.zip
cd nexcom-exchange

# 2. Install dependencies
pnpm install

# 3. Set environment variables
cp .env.example .env
# Edit .env with your DATABASE_URL and other secrets

# 4. Push schema + seed demo data
pnpm db:setup

# 5. Start development server
pnpm dev
```

The platform will be available at **http://localhost:3000**.

### Environment Variables

Create a `.env` file in the project root:

```env
# Database (required)
DATABASE_URL=postgresql://nexcom:nexcom_secure_2026@127.0.0.1:5432/nexcom

# Auth (auto-generated if not set)
JWT_SECRET=your-jwt-secret-here

# Manus OAuth (for hosted deployment)
VITE_APP_ID=your-app-id
OAUTH_SERVER_URL=https://api.manus.im
VITE_OAUTH_PORTAL_URL=https://manus.im

# Channel integrations (optional for local dev)
AFRICASTALKING_API_KEY=your-key
AFRICASTALKING_USERNAME=sandbox
WHATSAPP_ACCESS_TOKEN=your-token
WHATSAPP_PHONE_NUMBER_ID=your-phone-id
WHATSAPP_VERIFY_TOKEN=your-verify-token
TELEGRAM_BOT_TOKEN=your-bot-token
CHANNEL_GATEWAY_URL=http://localhost:8080

# Push notifications (optional)
VAPID_PUBLIC_KEY=your-vapid-public
VAPID_PRIVATE_KEY=your-vapid-private
VAPID_SUBJECT=mailto:admin@nexcom.exchange

# Kafka (optional - graceful degradation in dev)
KAFKA_BROKERS=localhost:9092
```

### Database Setup

```bash
# Push schema migrations
pnpm db:push

# Seed with demo data (6 users, 12 orders, 7 WRs, 22 watchlist entries, etc.)
pnpm db:seed

# Reset and re-seed
pnpm db:reset
```

---

## Docker Compose — Full Stack

Run all 30+ services with a single command:

```bash
docker compose up -d
```

### Services Included

| Service | Port | Description |
|---|---|---|
| PostgreSQL | 5432 | Primary database |
| Redis | 6379 | Session cache, pub/sub |
| Kafka | 9092 | Event streaming |
| Zookeeper | 2181 | Kafka coordination |
| TigerBeetle | 3000 | Financial ledger |
| Temporal | 7233 | Workflow orchestration |
| Permify | 3476 | RBAC authorization |
| APISIX | 9080/9443 | API gateway |
| Keycloak | 8080 | Identity provider |
| OpenSearch | 9200 | Full-text search |
| Kafka UI | 8090 | Kafka management |
| RedisInsight | 8001 | Redis management |
| **nexcom-web** | 3000 | Main web application |
| **matching-engine** | 8001 | Rust order matching |
| **settlement-engine** | 8002 | Rust DvP settlement |
| **blockchain** | 8003 | Hyperledger Fabric node |
| **indices** | 8004 | Go commodity indices (gRPC) |
| **channel-gateway** | 8005 | WhatsApp + Telegram webhooks |
| **bot-logic** | 8006 | Python NLP bot |
| **ussd-engine** | 8007 | Rust USSD handler |
| **core-banking** | 8008 | Go CBS adapters |
| **ingestion-engine** | 8009 | Price feed ingestion |
| **analytics** | 8010 | Python analytics |
| **kyc-service** | 8011 | KYC verification |
| **risk-management** | 8012 | Risk engine |
| **mojaloop-adapter** | 8013 | Mojaloop payments |

### Production Docker Compose

```bash
# Start infrastructure only
docker compose up -d postgres redis kafka zookeeper tigerbeetle

# Start all services
docker compose up -d

# View logs
docker compose logs -f nexcom-web

# Stop everything
docker compose down
```

---

## Mobile Apps

### Flutter (nexcom-flutter/)

```bash
cd nexcom-flutter
flutter pub get
flutter run                    # iOS/Android
flutter build apk --release    # Android APK
flutter build ios --release    # iOS IPA
```

**Screens:** Dashboard, Markets, Trade, Order Book, Warehouse, Banking, Notifications, Profile, Auth, Price Alerts, Field Agents, Farmer Profile, Loan Application

### React Native / Expo (nexcom-mobile/)

```bash
cd nexcom-mobile
pnpm install
npx expo start                 # Development
eas build --platform all       # Production build (requires EAS account)
```

**Screens:** Dashboard, Markets, Trade, Warehouse, Profile, Auth, Trading Detail, Warehouse Detail, Banking, Notifications, Price Alerts, Field Agent, Farmer Profile

---

## Microservices

### Rust Services

```bash
# Matching Engine
cd matching-engine && cargo build --release
./matching-engine

# Settlement Engine
cd settlement-engine && cargo build --release
./settlement-engine

# USSD Engine
cd services/ussd-engine && cargo build --release
./target/release/ussd-engine
```

### Go Services

```bash
# Channel Gateway (WhatsApp + Telegram)
cd services/channel-gateway && go build -o channel-gateway .
./channel-gateway

# Core Banking
cd services/core-banking && go build -o core-banking .
./core-banking

# Commodity Indices (gRPC)
cd services/indices && go build -o indices .
./indices

# Trading Engine
cd services/trading-engine && go build -o trading-engine .
./trading-engine
```

### Python Services

```bash
# Bot Logic (NLP + message routing)
cd services/bot-logic && pip install -r requirements.txt
uvicorn app.main:app --port 8006

# Analytics
cd services/analytics && pip install -r requirements.txt
uvicorn app.main:app --port 8010
```

---

## Pre-built Binaries

The `nexcom-binaries/` directory contains pre-compiled production binaries:

| Binary | Size | Description |
|---|---|---|
| `nexcom-blockchain` | 125 MB | Hyperledger Fabric node |
| `indices` | 28 MB | Go commodity indices service |
| `channel-gateway` | 23 MB | Go WhatsApp + Telegram gateway |
| `core-banking` | 14 MB | Go core banking adapters |
| `trading-engine` | 12 MB | Go trading engine |
| `risk-management` | 12 MB | Go risk management |
| `ussd-engine` | 9 MB | Rust USSD engine |

---

## Testing

```bash
# Run all tests (782 tests)
pnpm test

# Run with coverage
pnpm test --coverage

# Python NLP tests (18 tests)
cd services/bot-logic && python -m pytest tests/ -v
```

---

## Project Structure

```
nexcom-exchange/
├── client/src/pages/      # 118 PWA pages
├── server/                # tRPC routers + Express server
├── drizzle/               # 215-table schema + 44 migrations
├── services/              # 20 microservices
│   ├── blockchain/        # Hyperledger Fabric chaincode
│   ├── bot-logic/         # Python NLP bot (FastAPI)
│   ├── channel-gateway/   # Go WhatsApp + Telegram (Gin)
│   ├── core-banking/      # Go CBS adapters
│   ├── indices/           # Go commodity indices (gRPC)
│   ├── ingestion-engine/  # TypeScript price feed
│   ├── ussd-engine/       # Rust USSD (Axum)
│   └── ...17 more
├── matching-engine/       # Rust order matching
├── settlement-engine/     # Rust DvP settlement
├── nexcom-flutter/        # Flutter mobile app
├── nexcom-mobile/         # React Native / Expo app
├── infra/                 # Kubernetes + Helm charts
├── infrastructure/        # Terraform IaC
├── chaincode/             # Fabric chaincode (Go)
├── contracts/             # Smart contract ABIs
├── workflows/             # Temporal workflow definitions
├── docker-compose.yml     # Full 30+ service stack
└── scripts/               # DB seed, migration scripts
nexcom-binaries/
├── nexcom-blockchain      # 125 MB Fabric node binary
├── indices                # 28 MB indices binary
├── channel-gateway        # 23 MB gateway binary
├── core-banking           # 14 MB CBS binary
├── trading-engine         # 12 MB trading binary
├── risk-management        # 12 MB risk binary
└── ussd-engine            # 9 MB USSD binary
```

---

## Architecture

```
                    ┌─────────────────────────────────┐
                    │         APISIX Gateway           │
                    │    (Rate limiting, Auth, TLS)    │
                    └──────────────┬──────────────────┘
                                   │
              ┌────────────────────┼────────────────────┐
              │                    │                    │
     ┌────────▼──────┐   ┌────────▼──────┐   ┌────────▼──────┐
     │  Web PWA      │   │  Flutter App  │   │  React Native │
     │  (118 pages)  │   │  (19 screens) │   │  (15 screens) │
     └────────┬──────┘   └───────────────┘   └───────────────┘
              │
     ┌────────▼──────────────────────────────────────────────┐
     │              tRPC API (Express 4)                     │
     │         70+ routers, JWT auth, WebSocket              │
     └──┬──────────┬──────────┬──────────┬──────────────────┘
        │          │          │          │
   ┌────▼───┐ ┌────▼───┐ ┌────▼───┐ ┌────▼────────────┐
   │Postgres│ │ Redis  │ │ Kafka  │ │  TimescaleDB    │
   │215 tbl │ │session │ │events  │ │  OHLCV/prices   │
   └────────┘ └────────┘ └───┬────┘ └─────────────────┘
                              │
        ┌─────────────────────┼─────────────────────┐
        │                     │                     │
   ┌────▼──────┐        ┌─────▼──────┐       ┌─────▼──────┐
   │  Matching │        │ Settlement │       │ Blockchain │
   │  Engine   │        │  Engine    │       │  (Fabric)  │
   │  (Rust)   │        │  (Rust)    │       │  (Go)      │
   └───────────┘        └────────────┘       └────────────┘
        │
   ┌────▼──────────────────────────────────────────────────┐
   │              Channel Services                         │
   │  USSD (Rust) │ WhatsApp/Telegram (Go) │ Bot (Python) │
   └───────────────────────────────────────────────────────┘
```

---

## Production Deployment

### Kubernetes

```bash
cd infra/
kubectl apply -f namespaces.yaml
kubectl apply -f configmaps/
kubectl apply -f deployments/
kubectl apply -f services/
kubectl apply -f ingress.yaml
```

### Terraform (AWS/GCP/Azure)

```bash
cd infrastructure/
terraform init
terraform plan
terraform apply
```

---

## License

Proprietary — NEXCOM Exchange. All rights reserved.
