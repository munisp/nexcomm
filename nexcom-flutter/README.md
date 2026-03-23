# NEXCOM Exchange — Flutter App

Cross-platform Flutter application for the NEXCOM African Commodity Trading Platform. Provides full feature parity with the React Native mobile app and the PWA.

## Architecture

```
nexcom-flutter/
├── lib/
│   ├── main.dart                    # Entry point, Firebase init
│   ├── router.dart                  # go_router navigation (13 routes)
│   ├── theme.dart                   # Dark/light themes matching PWA colors
│   ├── providers/
│   │   └── auth_provider.dart       # Riverpod auth state (AsyncNotifier)
│   ├── services/
│   │   ├── api_service.dart         # Dio HTTP client wrapping all tRPC endpoints
│   │   └── notification_service.dart # FCM + local notifications
│   ├── screens/
│   │   ├── shell/main_shell.dart    # Bottom nav shell (5 tabs)
│   │   ├── auth/login_screen.dart   # OAuth login
│   │   ├── dashboard/               # Portfolio overview + market summary
│   │   ├── markets/                 # Live prices, search, tabs, detail
│   │   ├── trade/                   # Order placement + open orders
│   │   ├── portfolio/               # Positions + trade history
│   │   ├── warehouse/               # Receipts list + detail
│   │   ├── profile/                 # Profile + KYC
│   │   ├── alerts/                  # Price alerts CRUD
│   │   ├── farmer/                  # Field agent + farmer detail
│   │   ├── notifications/           # Notification inbox
│   │   └── settings/                # Settings + push notification prefs
│   └── widgets/
│       ├── price_change_badge.dart  # Reusable ±% badge
│       ├── stat_card.dart           # KPI stat card
│       └── loading_shimmer.dart     # Shimmer loading placeholders
└── pubspec.yaml                     # Dependencies
```

## Platform Parity

| Feature                  | PWA (React) | React Native | Flutter |
|--------------------------|:-----------:|:------------:|:-------:|
| Dashboard / Portfolio    | ✅          | ✅           | ✅      |
| Live Markets + Search    | ✅          | ✅           | ✅      |
| Order Placement          | ✅          | ✅           | ✅      |
| Order Book               | ✅          | ✅           | ✅      |
| Portfolio + P&L          | ✅          | ✅           | ✅      |
| Warehouse Receipts       | ✅          | ✅           | ✅      |
| KYC Verification         | ✅          | ✅           | ✅      |
| Price Alerts (CRUD)      | ✅          | ✅           | ✅      |
| Push Notifications       | ✅          | ✅           | ✅      |
| Field Agent / Farmers    | ✅          | ✅           | ✅      |
| Notification Inbox       | ✅          | ✅           | ✅      |
| Settings                 | ✅          | ✅           | ✅      |
| Dark Theme               | ✅          | ✅           | ✅      |
| Biometric Auth           | ❌          | ❌           | ✅      |
| Offline Cache (Hive)     | ❌          | ❌           | ✅      |

## Setup

### Prerequisites
- Flutter SDK ≥ 3.16.0
- Dart SDK ≥ 3.2.0
- Android Studio / Xcode

### Installation

```bash
flutter pub get
flutter run
```

### Configuration

Set the API base URL via `--dart-define`:

```bash
flutter run --dart-define=API_BASE_URL=https://nexcom-exchange.manus.space
```

For production builds:

```bash
flutter build apk --dart-define=API_BASE_URL=https://nexcom-exchange.manus.space
flutter build ios --dart-define=API_BASE_URL=https://nexcom-exchange.manus.space
```

### Firebase Setup (Push Notifications)

1. Create a Firebase project at https://console.firebase.google.com
2. Add Android/iOS apps with package name `com.nexcom.exchange`
3. Download `google-services.json` → `android/app/`
4. Download `GoogleService-Info.plist` → `ios/Runner/`
5. Run `flutter pub get && flutter run`

## State Management

All state is managed with **Riverpod 2.x**:

- `authStateProvider` — `AsyncNotifier<AuthState>` for login/logout
- `FutureProvider.autoDispose` — per-screen data fetching with automatic cleanup
- `FutureProvider.family` — parameterized queries (e.g., `_farmerProvider(id)`)

## API Integration

All backend calls go through `NexcomApiService` in `lib/services/api_service.dart`, which wraps the tRPC HTTP endpoints. The tRPC batch format (`/api/trpc/{procedure}`) is handled transparently — responses are unwrapped from the `result.data` envelope automatically.

## Testing

```bash
flutter test
```

## Build

```bash
# Android APK
flutter build apk --release

# Android App Bundle (Play Store)
flutter build appbundle --release

# iOS (requires macOS + Xcode)
flutter build ios --release
```
