// NEXCOM Exchange Mobile App Configuration
// Runtime values come from app.config.ts `extra` (driven by EXPO_PUBLIC_*
// environment variables / eas.json build profiles) via expo-constants.
// No hardcoded hosts — set EXPO_PUBLIC_API_URL / EXPO_PUBLIC_KEYCLOAK_URL.
import ExpoConstants from 'expo-constants';

const extra = (ExpoConstants.expoConfig?.extra ?? {}) as {
  apiUrl?: string;
  keycloakUrl?: string;
  keycloakRealm?: string;
  keycloakClientId?: string;
  appEnv?: string;
  eas?: { projectId?: string };
};

export const CONFIG = {
  // Portal/server base URL (tRPC at `${BASE_URL}/api/trpc`)
  BASE_URL: extra.apiUrl ?? 'https://nexcom.exchange',

  // Keycloak OIDC (PKCE public client) endpoints
  KEYCLOAK_URL: extra.keycloakUrl ?? 'https://nexcom.exchange/auth',
  KEYCLOAK_REALM: extra.keycloakRealm ?? 'nexcom',
  KEYCLOAK_CLIENT_ID: extra.keycloakClientId ?? 'nexcom-mobile',
  
  // App metadata
  APP_NAME: 'NEXCOM Exchange',
  APP_VERSION: '1.0.0',

  // EAS project id (only present when EXPO_EAS_PROJECT_ID was set at build
  // time — see app.config.ts). Used for Expo push token registration.
  EAS_PROJECT_ID: extra.eas?.projectId,
  
  // Feature flags
  FEATURES: {
    BIOMETRIC_AUTH: true,
    PUSH_NOTIFICATIONS: true,
    OFFLINE_MODE: true,
    DARK_MODE_DEFAULT: true,
    FIELD_AGENT_GPS: true,
    BARCODE_SCANNER: true,
  },
  
  // Trading configuration
  TRADING: {
    DEFAULT_CURRENCY: 'NGN',
    SUPPORTED_CURRENCIES: ['NGN', 'USD', 'GHS', 'KES', 'ZAR', 'ETB', 'XOF'],
    ORDER_REFRESH_INTERVAL_MS: 2000,
    PRICE_REFRESH_INTERVAL_MS: 1000,
  },
  
  // Notification channels
  NOTIFICATIONS: {
    TRADE_ALERTS: 'trade-alerts',
    PRICE_ALERTS: 'price-alerts',
    WAREHOUSE_UPDATES: 'warehouse-updates',
    LOAN_UPDATES: 'loan-updates',
    FIELD_AGENT: 'field-agent',
  },
};

export const COLORS = {
  primary: '#10b981',       // Emerald green - NEXCOM brand
  primaryDark: '#059669',
  primaryLight: '#34d399',
  secondary: '#f59e0b',     // Amber - commodity gold
  background: '#0a0f1a',    // Deep navy
  surface: '#111827',       // Card background
  surfaceAlt: '#1f2937',    // Elevated surface
  border: '#374151',
  text: '#f9fafb',
  textMuted: '#9ca3af',
  textDim: '#6b7280',
  success: '#10b981',
  warning: '#f59e0b',
  error: '#ef4444',
  info: '#3b82f6',
  buy: '#10b981',
  sell: '#ef4444',
  neutral: '#6b7280',
};

export const TYPOGRAPHY = {
  fontFamily: {
    regular: 'System',
    medium: 'System',
    bold: 'System',
    mono: 'Courier',
  },
  sizes: {
    xs: 11,
    sm: 13,
    base: 15,
    lg: 17,
    xl: 20,
    '2xl': 24,
    '3xl': 30,
    '4xl': 36,
  },
};

// Convenience URL exports used by screen components
export const API_BASE_URL = CONFIG.BASE_URL;
export const WS_BASE_URL = CONFIG.BASE_URL.replace(/^https?/, (p) => (p === 'https' ? 'wss' : 'ws'));

// Font helpers used by screen components
export const FONTS = {
  heading: { fontFamily: TYPOGRAPHY.fontFamily.bold, fontWeight: '700' as const },
  subheading: { fontFamily: TYPOGRAPHY.fontFamily.medium, fontWeight: '600' as const },
  body: { fontFamily: TYPOGRAPHY.fontFamily.regular, fontWeight: '400' as const },
  mono: { fontFamily: TYPOGRAPHY.fontFamily.mono, fontWeight: '400' as const },
};

// Spacing scale used by screen components
export const SPACING = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  '2xl': 32,
  '3xl': 48,
};
