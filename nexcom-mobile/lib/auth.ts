/**
 * NEXCOM Mobile — OIDC (Keycloak) auth with Authorization Code + PKCE.
 *
 * The portal authenticates browsers via /api/auth/login → Keycloak → cookie.
 * Mobile cannot rely on cookies, so it talks to Keycloak DIRECTLY using a
 * public client with PKCE (no client secret on device):
 *
 *   Keycloak /protocol/openid-connect/auth  (via expo-auth-session browser)
 *     → redirect nexcom://auth/callback?code=…
 *     → Keycloak /protocol/openid-connect/token (code + code_verifier)
 *     → Keycloak access_token (JWT)
 *
 * The server accepts that JWT as `Authorization: Bearer <token>` — see
 * server/_core/sdk.ts authenticateRequest() Bearer path (introspection).
 *
 * The public client (default id "nexcom-mobile", realm "nexcom") must exist in
 * Keycloak with:
 *   - Client authentication: OFF (public)
 *   - Standard flow: ON, PKCE: S256
 *   - Valid redirect URIs: nexcom://auth/callback (and the Expo Go proxy URL
 *     for development)
 * See README-mobile.md for provisioning steps.
 */
import * as AuthSession from 'expo-auth-session';
import * as SecureStore from 'expo-secure-store';
import { CONFIG } from '../constants/config';

const ACCESS_KEY = 'nexcom.access_token';
const REFRESH_KEY = 'nexcom.refresh_token';
const EXPIRY_KEY = 'nexcom.access_token_expiry';

function realmBase(): string {
  return `${CONFIG.KEYCLOAK_URL}/realms/${CONFIG.KEYCLOAK_REALM}`;
}

export const discovery: AuthSession.DiscoveryDocument = {
  authorizationEndpoint: `${realmBase()}/protocol/openid-connect/auth`,
  tokenEndpoint: `${realmBase()}/protocol/openid-connect/token`,
  endSessionEndpoint: `${realmBase()}/protocol/openid-connect/logout`,
};

/** The in-app redirect handled by app/auth/callback.tsx. */
export function getRedirectUri(): string {
  return AuthSession.makeRedirectUri({
    scheme: 'nexcom',
    path: 'auth/callback',
  });
}

export interface TokenSet {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number; // epoch ms
}

async function persistTokens(tokens: TokenSet): Promise<void> {
  await SecureStore.setItemAsync(ACCESS_KEY, tokens.accessToken);
  if (tokens.refreshToken) {
    await SecureStore.setItemAsync(REFRESH_KEY, tokens.refreshToken);
  }
  await SecureStore.setItemAsync(EXPIRY_KEY, String(tokens.expiresAt));
}

/** Restore the persisted token set (null when never logged in). */
export async function restoreTokens(): Promise<TokenSet | null> {
  try {
    const accessToken = await SecureStore.getItemAsync(ACCESS_KEY);
    if (!accessToken) return null;
    const refreshToken = (await SecureStore.getItemAsync(REFRESH_KEY)) ?? undefined;
    const expiresAt = Number((await SecureStore.getItemAsync(EXPIRY_KEY)) ?? 0);
    return { accessToken, refreshToken, expiresAt };
  } catch {
    return null;
  }
}

export async function clearTokens(): Promise<void> {
  await Promise.all([
    SecureStore.deleteItemAsync(ACCESS_KEY),
    SecureStore.deleteItemAsync(REFRESH_KEY),
    SecureStore.deleteItemAsync(EXPIRY_KEY),
  ]);
}

/**
 * Exchange an authorization code for tokens using the PKCE verifier from the
 * in-flight AuthSession request. Called by the login screen (and by the
 * auth/callback deep-link route as a fallback when the session API does not
 * deliver the response in-process).
 */
export async function exchangeCodeForTokens(
  request: AuthSession.AuthRequest,
  code: string,
): Promise<TokenSet> {
  const result = await AuthSession.exchangeCodeAsync(
    {
      clientId: CONFIG.KEYCLOAK_CLIENT_ID,
      code,
      redirectUri: getRedirectUri(),
      extraParams: request.codeVerifier ? { code_verifier: request.codeVerifier } : {},
    },
    discovery,
  );
  const tokens: TokenSet = {
    accessToken: result.accessToken,
    refreshToken: result.refreshToken,
    expiresAt: Date.now() + (result.expiresIn ?? 300) * 1000,
  };
  await persistTokens(tokens);
  return tokens;
}

/**
 * Return a usable access token, refreshing via the refresh_token grant when
 * the access token is within 30s of expiry. Returns null when unauthenticated
 * or the refresh fails (caller should route to /auth).
 */
export async function getValidAccessToken(): Promise<string | null> {
  const tokens = await restoreTokens();
  if (!tokens) return null;
  if (Date.now() < tokens.expiresAt - 30_000) return tokens.accessToken;
  if (!tokens.refreshToken) {
    await clearTokens();
    return null;
  }
  try {
    const refreshed = await AuthSession.refreshAsync(
      {
        clientId: CONFIG.KEYCLOAK_CLIENT_ID,
        refreshToken: tokens.refreshToken,
      },
      discovery,
    );
    const next: TokenSet = {
      accessToken: refreshed.accessToken,
      refreshToken: refreshed.refreshToken ?? tokens.refreshToken,
      expiresAt: Date.now() + (refreshed.expiresIn ?? 300) * 1000,
    };
    await persistTokens(next);
    return next.accessToken;
  } catch {
    await clearTokens();
    return null;
  }
}

/** Best-effort Keycloak logout + local token wipe. */
export async function signOut(): Promise<void> {
  const tokens = await restoreTokens();
  if (tokens?.refreshToken) {
    try {
      await fetch(discovery.tokenEndpoint!.replace('/token', '/logout'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: CONFIG.KEYCLOAK_CLIENT_ID,
          refresh_token: tokens.refreshToken,
        }).toString(),
      });
    } catch {
      // Best effort — local wipe below is authoritative for the app.
    }
  }
  await clearTokens();
}
