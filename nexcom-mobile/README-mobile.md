# NEXCOM Mobile (React Native / Expo) — CANONICAL mobile app

This is the official NEXCOM Exchange mobile app. The Flutter app (`nexcom-flutter/`) is archived — see `nexcom-flutter/ARCHIVED.md`.

## Stack

- Expo SDK 52 + expo-router (file-based navigation)
- tRPC react-query client typed against the monorepo `server/routers.ts`
- Keycloak OIDC login with Authorization Code + PKCE (`expo-auth-session`), tokens in `expo-secure-store`
- Push via `expo-notifications` → portal `notifications.registerPushToken`
- Deep links: `nexcom://` scheme + `https://nexcom.exchange` App/Universal Links

## Configuration

All runtime config is env-driven via `app.config.ts` → `Constants.expoConfig.extra`:

| Env var | Dev default | Production |
|---|---|---|
| `EXPO_PUBLIC_API_URL` | `http://localhost:3000` | `https://nexcom.exchange` |
| `EXPO_PUBLIC_KEYCLOAK_URL` | `http://localhost:8080` | `https://nexcom.exchange/auth` |
| `EXPO_PUBLIC_KEYCLOAK_REALM` | `nexcom` | `nexcom` |
| `EXPO_PUBLIC_KEYCLOAK_CLIENT_ID` | `nexcom-mobile` | `nexcom-mobile` |
| `EXPO_EAS_PROJECT_ID` | (unset) | set to enable OTA `expo-updates` |

EAS build profiles in `eas.json` set the first four per environment. There are **no hardcoded hosts** in app code.

## Keycloak provisioning (one-time)

The mobile login uses a **public** OIDC client (no secret on device). In the `nexcom` realm create client `nexcom-mobile` with:

- Client authentication: **OFF** (public)
- Standard flow: **ON**, PKCE code challenge method: **S256**
- Valid redirect URIs: `nexcom://auth/callback` (plus the Expo Go auth proxy URL for dev builds)
- Web origins: `nexcom://`

The resulting Keycloak access token is accepted by the server's `Authorization: Bearer` path (`server/_core/sdk.ts → verifyKeycloakToken`, introspection). Note: the user must exist in the portal DB (first sign-in via web portal creates it) — mobile login does not auto-provision users yet.

## Brand assets

`assets/images/*` are **generated**, not hand-made: `node scripts/generate-assets.mjs` (pure-Node PNG writer, no dependencies) emits icon (1024), adaptive icon, splash (1242×2436), notification icon (96), favicon (48). Re-run after brand changes.

## Auth flow

1. `app/auth/index.tsx` → `AuthSession.useAuthRequest` (PKCE) → Keycloak login in a secure browser session.
2. Redirect `nexcom://auth/callback` (`app/auth/callback.tsx` fallback route).
3. Code → tokens at Keycloak token endpoint; persisted in SecureStore (`lib/auth.ts`).
4. `_layout.tsx` bootstraps from SecureStore on cold start; `AuthGate` redirects unauthenticated users to `/auth`.
5. Every tRPC request gets a fresh `Authorization: Bearer` via `getValidAccessToken()` (auto-refresh 30s before expiry).

## Deferred / follow-ups

- OTA updates: wire `EXPO_EAS_PROJECT_ID` (updates block is opt-in in `app.config.ts`).
- Custom notification sounds (`assets/sounds/*.wav`) — plugin slot documented in `app.config.ts`.
- Android FCM push needs `google-services.json` (add `googleServicesFile` to `app.config.ts` android section when available).
- Biometric quick-unlock (`expo-local-authentication` installed; enroll flow not yet built).
- Offline cache (react-native-mmkv installed; React Query persistence not yet wired).
- Mobile liveness capture (portal has `LivenessChallengeModal`; mobile KYC currently uploads documents only).
