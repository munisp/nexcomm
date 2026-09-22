/**
 * NEXCOM Mobile — dynamic Expo config.
 *
 * Single source of runtime configuration. Values come from EXPO_PUBLIC_*
 * environment variables (EAS profiles set these in eas.json); `extra` is
 * readable at runtime via expo-constants and constants/config.ts.
 *
 *   EXPO_PUBLIC_API_URL          Portal/server base URL (tRPC + REST)
 *   EXPO_PUBLIC_KEYCLOAK_URL     Keycloak base URL (no trailing slash)
 *   EXPO_PUBLIC_KEYCLOAK_REALM   Keycloak realm (default "nexcom")
 *   EXPO_PUBLIC_KEYCLOAK_CLIENT_ID  Public OIDC client for the mobile app
 *   EXPO_EAS_PROJECT_ID          EAS project id — enables OTA updates when set
 */
import { ExpoConfig, ConfigContext } from 'expo/config';

const isDev = process.env.APP_ENV === 'development' || process.env.NODE_ENV === 'development';

const apiUrl =
  process.env.EXPO_PUBLIC_API_URL ??
  (isDev ? 'http://localhost:3000' : 'https://nexcom.exchange');

const keycloakUrl =
  process.env.EXPO_PUBLIC_KEYCLOAK_URL ??
  (isDev ? 'http://localhost:8080' : 'https://nexcom.exchange/auth');

const easProjectId = process.env.EXPO_EAS_PROJECT_ID;

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: 'NEXCOM Exchange',
  slug: 'nexcom-exchange',
  version: '1.0.0',
  orientation: 'portrait',
  icon: './assets/images/icon.png',
  scheme: 'nexcom',
  userInterfaceStyle: 'dark',
  splash: {
    image: './assets/images/splash.png',
    resizeMode: 'contain',
    backgroundColor: '#0a0e1a',
  },
  assetBundlePatterns: ['**/*'],
  ios: {
    supportsTablet: true,
    bundleIdentifier: 'exchange.nexcom.app',
    buildNumber: '1',
    infoPlist: {
      NSFaceIDUsageDescription:
        'NEXCOM uses Face ID to securely authenticate your trading account.',
      NSCameraUsageDescription:
        'NEXCOM uses the camera to scan QR codes for warehouse receipts and KYC document capture.',
      NSPhotoLibraryUsageDescription:
        'NEXCOM accesses your photo library to upload KYC documents.',
      NSLocationWhenInUseUsageDescription:
        'NEXCOM uses your location to help field agents navigate to farmer locations.',
      NSMicrophoneUsageDescription:
        'NEXCOM uses the microphone for voice-based commodity search.',
      UIBackgroundModes: ['fetch', 'remote-notification'],
    },
    associatedDomains: ['applinks:nexcom.exchange'],
    config: { usesNonExemptEncryption: false },
  },
  android: {
    adaptiveIcon: {
      foregroundImage: './assets/images/adaptive-icon.png',
      backgroundColor: '#0a0f1a',
    },
    package: 'exchange.nexcom.app',
    versionCode: 1,
    permissions: [
      'android.permission.CAMERA',
      'android.permission.USE_BIOMETRIC',
      'android.permission.USE_FINGERPRINT',
      'android.permission.ACCESS_FINE_LOCATION',
      'android.permission.ACCESS_COARSE_LOCATION',
      'android.permission.RECEIVE_BOOT_COMPLETED',
      'android.permission.VIBRATE',
      'android.permission.INTERNET',
    ],
    intentFilters: [
      {
        action: 'VIEW',
        autoVerify: true,
        data: [{ scheme: 'https', host: 'nexcom.exchange', pathPrefix: '/' }],
        category: ['BROWSABLE', 'DEFAULT'],
      },
      {
        action: 'VIEW',
        data: [{ scheme: 'nexcom' }],
        category: ['BROWSABLE', 'DEFAULT'],
      },
    ],
  },
  web: {
    bundler: 'metro',
    output: 'static',
    favicon: './assets/images/favicon.png',
  },
  plugins: [
    'expo-router',
    'expo-secure-store',
    [
      'expo-local-authentication',
      {
        faceIDPermission:
          'Allow NEXCOM Exchange to use Face ID for secure authentication.',
      },
    ],
    [
      'expo-notifications',
      {
        icon: './assets/images/notification-icon.png',
        color: '#00d4aa',
        // Custom sounds: add assets/sounds/*.wav here once the files exist.
      },
    ],
  ],
  extra: {
    apiUrl,
    keycloakUrl,
    keycloakRealm: process.env.EXPO_PUBLIC_KEYCLOAK_REALM ?? 'nexcom',
    keycloakClientId: process.env.EXPO_PUBLIC_KEYCLOAK_CLIENT_ID ?? 'nexcom-mobile',
    appEnv: process.env.APP_ENV ?? (isDev ? 'development' : 'production'),
    ...(easProjectId ? { eas: { projectId: easProjectId } } : {}),
  },
  owner: 'nexcom-exchange',
  runtimeVersion: { policy: 'appVersion' },
  // OTA updates are only wired once a real EAS project id is provided —
  // shipping a placeholder updates URL breaks launch, so it is opt-in.
  ...(easProjectId
    ? {
        updates: {
          url: `https://u.expo.dev/${easProjectId}`,
          enabled: true,
          checkAutomatically: 'ON_LOAD',
          fallbackToCacheTimeout: 0,
        },
      }
    : {}),
});
