# ⚠️ ARCHIVED — nexcom-flutter is no longer the canonical mobile app

**Decision date:** see MOBILE audit (`nexcom-ux/MOBILE_AUDIT.md`).
**Canonical mobile app:** [`nexcom-mobile/`](../nexcom-mobile) (React Native / Expo).

## Why this app was archived

The mobile UX audit of branch `audit-fixes-ml-stack` scored this codebase **2.5/10** and found it did not compile:

1. `lib/screens/auth/login_screen.dart` — corrupted/truncated import (lines 4 & 14) → parse error.
2. **25 of 47 screens** call `apiServiceProvider` / `api.get('path')` — neither exists in `lib/services/api_service.dart` (only the typed `nexcomApi` tRPC client) → app-wide compile failure.
3. `pubspec.yaml` references `assets/images/` + Inter font files that were never committed.
4. Push deep-link service implemented but never instantiated; FCM config files (`firebase_options.dart`, `google-services.json`) absent; offline deps (hive, connectivity_plus) declared but unused.
5. Duplicating a React/tRPC portal in Dart meant every feature had to be built twice with no shared types.

By contrast, `nexcom-mobile` shares the portal's TypeScript/tRPC stack, had ~50 screens already wired to the real `AppRouter`, and was repairable with focused workstreams (auth PKCE, env-driven config, assets, KYC upload, push wiring, resilience).

## What happens here

- No new features. No CI. Not referenced by any build pipeline.
- The KYC upload implementation in `lib/screens/profile/kyc_screen.dart` remains a useful reference for the document-upload contract (`uploadKycDocument`: docId/fileName/mimeType/base64Data).
- To resurrect (not recommended): repair the compile errors above, delete/rewrite the 25 `apiServiceProvider` screens against the typed `nexcomApi` client, add the missing assets, and re-run the parity analysis.
