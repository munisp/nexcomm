# NEXCOM Exchange — React Native Mobile App

A comprehensive React Native mobile application for the NEXCOM Exchange platform, Africa's premier institutional commodity exchange. Built with Expo Router and designed for both iOS and Android.

## Features

### Core Trading
- **Real-time Market Prices** — Live commodity price feeds for 15+ African commodities
- **Order Placement** — Full order management: LIMIT, MARKET, STOP, STOP_LIMIT orders
- **Order Book** — Live bid/ask depth with visual depth bars
- **Trade History** — Recent trades with side indicators
- **Watchlist** — Personalized commodity watchlist

### Warehouse Management
- **Warehouse Receipt Management** — View, pledge, transfer, and sell WRs
- **Blockchain Verification** — On-chain tokenized receipts with hash verification
- **Quality Reports** — Moisture, foreign matter, and grade tracking
- **Inspection Scheduling** — Automated inspection due date alerts

### Field Agent Tools
- **Farmer Onboarding** — Digital KYC and registration
- **Crop Reporting** — Seasonal yield and area reporting
- **GPS Navigation** — Navigate to farmer locations
- **Loan Assessment** — Field-based loan evaluation
- **Task Management** — Prioritized visit scheduling

### Financial Services
- **Input Financing** — Loan application and tracking
- **Fixed Income** — Agricultural bonds and treasury bills
- **Portfolio Overview** — P&L, balance, margin tracking

### Security & UX
- **Biometric Authentication** — Face ID / Fingerprint login
- **Offline Support** — Core data available without internet
- **Push Notifications** — Price alerts, trade confirmations, loan updates
- **Dark Mode** — Default dark theme optimized for trading

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | React Native 0.76 + Expo 52 |
| Navigation | Expo Router 4 (file-based) |
| State | Zustand |
| API | tRPC + React Query |
| Auth | Expo SecureStore + Biometrics |
| Storage | MMKV (fast key-value) |
| Charts | Victory Native + React Native Chart Kit |
| Lists | Shopify FlashList |
| Notifications | Expo Notifications |

## Project Structure

```
nexcom-mobile/
├── app/
│   ├── _layout.tsx          # Root layout with providers
│   ├── tabs/
│   │   ├── _layout.tsx      # Bottom tab navigator
│   │   ├── index.tsx        # Dashboard screen
│   │   ├── markets.tsx      # Markets/price list
│   │   ├── trade.tsx        # Order placement
│   │   ├── warehouse.tsx    # Warehouse receipts
│   │   └── profile.tsx      # User profile & settings
│   ├── auth/
│   │   └── index.tsx        # Login / Register
│   ├── trading/
│   │   └── [symbol].tsx     # Commodity detail + order book
│   ├── warehouse/
│   │   └── [id].tsx         # Warehouse receipt detail
│   └── farmer/
│       ├── index.tsx        # Field agent dashboard
│       └── [id].tsx         # Farmer profile detail
├── components/
│   ├── ui/                  # Reusable UI components
│   ├── charts/              # Chart components
│   └── trading/             # Trading-specific components
├── constants/
│   └── config.ts            # App config, colors, typography
├── lib/
│   ├── trpc.ts              # tRPC client setup
│   └── store.ts             # Zustand state stores
└── assets/
    └── images/              # App icons and splash screen
```

## Getting Started

### Prerequisites
- Node.js 18+
- pnpm or npm
- Expo CLI: `npm install -g expo-cli`
- iOS: Xcode 15+ (macOS only)
- Android: Android Studio + SDK 34

### Installation

```bash
cd nexcom-mobile
npm install

# Start development server
npx expo start

# Run on iOS simulator
npx expo start --ios

# Run on Android emulator
npx expo start --android
```

### Environment Configuration

Update `constants/config.ts` with your NEXCOM Exchange server URL:

```typescript
export const CONFIG = {
  BASE_URL: 'https://your-nexcom-exchange.manus.space',
  // ...
};
```

## Building for Production

### Using EAS Build (Recommended)

```bash
# Install EAS CLI
npm install -g eas-cli

# Configure EAS
eas build:configure

# Build for Android
eas build --platform android --profile production

# Build for iOS
eas build --platform ios --profile production
```

### Local Build

```bash
# Android APK
npx expo run:android --variant release

# iOS (requires macOS + Xcode)
npx expo run:ios --configuration Release
```

## API Integration

The mobile app connects to the NEXCOM Exchange backend via tRPC:

```typescript
// lib/trpc.ts
const trpcClient = getTRPCClient('https://nexcom-exchange.manus.space');

// Usage in components
const { data: markets } = trpc.markets.getAll.useQuery();
const placeOrder = trpc.trading.placeOrder.useMutation();
```

## Screens Overview

| Screen | Route | Description |
|--------|-------|-------------|
| Dashboard | `/tabs` | Portfolio overview, market summary, alerts |
| Markets | `/tabs/markets` | Full commodity price list with search/filter |
| Trade | `/tabs/trade` | Order placement form |
| Warehouse | `/tabs/warehouse` | Warehouse receipt list |
| Profile | `/tabs/profile` | Account settings, KYC, preferences |
| Auth | `/auth` | Login and registration |
| Trading Detail | `/trading/[symbol]` | Chart, order book, trade history |
| WR Detail | `/warehouse/[id]` | Receipt details, blockchain info, actions |
| Field Agent | `/farmer` | Agent dashboard with tasks |
| Farmer Profile | `/farmer/[id]` | Farmer details, crops, loans |

## PWA Parity

The mobile app maintains feature parity with the NEXCOM Exchange PWA:

| Feature | PWA | Mobile |
|---------|-----|--------|
| Real-time prices | ✅ | ✅ |
| Order placement | ✅ | ✅ |
| Warehouse receipts | ✅ | ✅ |
| Field agent tools | ✅ | ✅ |
| Input financing | ✅ | ✅ |
| Fixed income board | ✅ | ✅ |
| Biometric auth | ❌ | ✅ |
| Push notifications | ✅ | ✅ |
| Offline mode | ✅ | ✅ |
| GPS navigation | ❌ | ✅ |
| Camera/KYC scan | ❌ | ✅ |

## License

Proprietary — NEXCOM Exchange © 2024. All rights reserved.
