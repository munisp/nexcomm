# EAS Build Setup Guide — NEXCOM Exchange Mobile

This guide walks through setting up Expo Application Services (EAS) for building and submitting the NEXCOM Exchange mobile app to the App Store and Google Play.

## Prerequisites

- [Expo account](https://expo.dev/signup) (free tier works for development)
- Apple Developer account ($99/year) for iOS production builds
- Google Play Developer account ($25 one-time) for Android production builds
- Node.js 20+, npm, and the EAS CLI

## Step 1 — Install EAS CLI

```bash
npm install -g eas-cli
eas login
```

## Step 2 — Initialize EAS Project

```bash
cd nexcom-mobile
eas init
```

This creates a project on expo.dev and returns a `projectId`. Replace the two `REPLACE_WITH_EAS_PROJECT_ID` placeholders in `app.json` with the actual ID:

```json
"extra": {
  "eas": { "projectId": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" }
},
"updates": {
  "url": "https://u.expo.dev/xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
}
```

## Step 3 — Configure Credentials

### iOS (requires macOS or EAS managed credentials)

```bash
# EAS manages certificates and provisioning profiles automatically
eas credentials --platform ios
```

Update `eas.json` with your Apple Team ID and App Store Connect App ID:

```json
"submit": {
  "production": {
    "ios": {
      "appleId": "your-apple-id@example.com",
      "ascAppId": "1234567890",
      "appleTeamId": "ABCDE12345"
    }
  }
}
```

### Android

1. Create a Google Play service account:
   - Go to [Google Play Console](https://play.google.com/console) → Setup → API access
   - Create a service account with "Release Manager" role
   - Download the JSON key file

2. Place the key at `nexcom-mobile/google-service-account.json` (gitignored)

3. For Firebase push notifications, download `google-services.json` from Firebase Console and place it at `nexcom-mobile/google-services.json`

## Step 4 — Build Profiles

| Profile | Platform | Output | Use Case |
|---------|----------|--------|----------|
| `development` | iOS Simulator + Android APK | Debug build with dev client | Local development |
| `preview` | iOS + Android APK | Release build | Internal testing via TestFlight/internal track |
| `production` | iOS + Android AAB | Store-ready | App Store + Google Play |

## Step 5 — Run Your First Build

```bash
# Development build (runs on simulator/emulator)
eas build --platform all --profile development

# Preview build (share with testers)
eas build --platform all --profile preview

# Production build (submit to stores)
eas build --platform all --profile production
```

## Step 6 — OTA Updates (Expo Updates)

For JavaScript-only changes (no native code changes), use OTA updates to push instantly to all users without a full build:

```bash
# Push update to preview channel
eas update --channel preview --message "Fix order placement bug"

# Push update to production channel
eas update --channel production --message "v1.0.1 — Price alert improvements"
```

**When to use OTA vs full build:**

| Change Type | OTA Update | Full Build |
|-------------|-----------|------------|
| UI/UX changes | ✅ | ❌ |
| Bug fixes (JS only) | ✅ | ❌ |
| New screens (no native deps) | ✅ | ❌ |
| New native packages | ❌ | ✅ |
| `app.json` changes | ❌ | ✅ |
| iOS/Android config changes | ❌ | ✅ |

## Step 7 — GitHub Actions CI/CD

Add the `EXPO_TOKEN` secret to your GitHub repository:

1. Go to [expo.dev/accounts/settings/access-tokens](https://expo.dev/accounts/settings/access-tokens)
2. Create a new token with "Owner" scope
3. Add it to GitHub: **Settings → Secrets → Actions → New secret** named `EXPO_TOKEN`

The included workflow (`.github/workflows/eas-build.yml`) will:
- Run TypeScript checks on every PR
- Build preview APKs on every push to `main`
- Publish OTA updates on every push to `main`
- Build production AAB/IPA and submit to stores on version tags (`v1.0.0`)

## Step 8 — App Store Submission Checklist

### iOS (App Store Connect)
- [ ] App icon: 1024×1024 PNG (no alpha channel)
- [ ] Screenshots: 6.7" iPhone, 12.9" iPad
- [ ] Privacy policy URL
- [ ] App description and keywords
- [ ] Age rating questionnaire
- [ ] Export compliance (set `usesNonExemptEncryption: false` in `app.json`)

### Android (Google Play Console)
- [ ] Feature graphic: 1024×500 PNG
- [ ] Screenshots: Phone + 7" tablet + 10" tablet
- [ ] Privacy policy URL
- [ ] Content rating questionnaire
- [ ] Data safety form

## Troubleshooting

**Build fails with "Missing credentials":**
```bash
eas credentials --platform ios  # re-run credential setup
```

**OTA update not appearing in app:**
- Ensure `runtimeVersion` in `app.json` matches the installed build
- Check update channel: `eas update:list --channel production`

**Android build fails with Gradle error:**
```bash
# Clear EAS build cache
eas build --platform android --profile production --clear-cache
```
