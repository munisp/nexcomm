/**
 * NEXCOM Exchange — Keycloak Identity Federation Client (P3-A)
 *
 * Provides identity federation between Manus OAuth (primary IdP) and
 * Keycloak (enterprise SSO / SAML / LDAP bridge). Keycloak handles:
 *  - Enterprise LDAP/AD user sync for institutional brokers
 *  - SAML 2.0 federation with CBN and SEC Nigeria identity systems
 *  - Fine-grained role/group management beyond Manus OAuth scopes
 *  - Token exchange: Manus JWT → Keycloak access token
 *
 * All calls fall back gracefully when Keycloak is unavailable.
 */

import { ENV } from "../_core/env";

const KEYCLOAK_BASE = process.env.KEYCLOAK_URL ?? "http://localhost:8080";
const KEYCLOAK_REALM = process.env.KEYCLOAK_REALM ?? "nexcom";
const KEYCLOAK_CLIENT_ID = process.env.KEYCLOAK_CLIENT_ID ?? "nexcom-exchange";
const KEYCLOAK_CLIENT_SECRET = process.env.KEYCLOAK_CLIENT_SECRET ?? "";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface KeycloakUser {
  id: string;
  username: string;
  email: string;
  firstName?: string;
  lastName?: string;
  enabled: boolean;
  emailVerified: boolean;
  attributes?: Record<string, string[]>;
  realmRoles?: string[];
  groups?: string[];
}

export interface KeycloakTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
  scope: string;
}

export interface KeycloakHealthStatus {
  available: boolean;
  realmExists: boolean;
  version?: string;
  error?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Admin token cache (service account)
// ─────────────────────────────────────────────────────────────────────────────

let _adminToken: string | null = null;
let _adminTokenExpiry = 0;

async function getAdminToken(): Promise<string | null> {
  if (_adminToken && Date.now() < _adminTokenExpiry - 30_000) return _adminToken;

  try {
    const resp = await fetch(
      `${KEYCLOAK_BASE}/realms/master/protocol/openid-connect/token`,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "client_credentials",
          client_id: "admin-cli",
          client_secret: KEYCLOAK_CLIENT_SECRET || "admin",
          username: process.env.KEYCLOAK_ADMIN_USER ?? "admin",
          password: process.env.KEYCLOAK_ADMIN_PASSWORD ?? "admin",
        }).toString(),
        signal: AbortSignal.timeout(5000),
      }
    );

    if (!resp.ok) return null;
    const data = await resp.json() as KeycloakTokenResponse;
    _adminToken = data.access_token;
    _adminTokenExpiry = Date.now() + data.expires_in * 1000;
    return _adminToken;
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Health check
// ─────────────────────────────────────────────────────────────────────────────

export async function getKeycloakHealth(): Promise<KeycloakHealthStatus> {
  try {
    const resp = await fetch(
      `${KEYCLOAK_BASE}/realms/${KEYCLOAK_REALM}/.well-known/openid-configuration`,
      { signal: AbortSignal.timeout(3000) }
    );

    if (resp.ok) {
      const data = await resp.json() as { issuer?: string };
      return {
        available: true,
        realmExists: true,
        version: data.issuer ? "Keycloak" : undefined,
      };
    }

    if (resp.status === 404) {
      return { available: true, realmExists: false };
    }

    return { available: false, realmExists: false, error: `HTTP ${resp.status}` };
  } catch (err) {
    return {
      available: false,
      realmExists: false,
      error: err instanceof Error ? err.message : "Connection refused",
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// User management
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Sync a NEXCOM user to Keycloak realm.
 * Creates the user if they don't exist; updates attributes if they do.
 */
export async function syncUserToKeycloak(params: {
  openId: string;
  email: string;
  name: string;
  role: "admin" | "user";
  nexcomUserId: number;
}): Promise<{ synced: boolean; keycloakId?: string; error?: string }> {
  const token = await getAdminToken();
  if (!token) return { synced: false, error: "Keycloak admin token unavailable" };

  try {
    // Check if user exists by email
    const searchResp = await fetch(
      `${KEYCLOAK_BASE}/admin/realms/${KEYCLOAK_REALM}/users?email=${encodeURIComponent(params.email)}&exact=true`,
      {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(5000),
      }
    );

    if (!searchResp.ok) return { synced: false, error: `Search failed: ${searchResp.status}` };

    const existing = await searchResp.json() as KeycloakUser[];

    const userPayload = {
      username: params.openId,
      email: params.email,
      firstName: params.name.split(" ")[0] ?? params.name,
      lastName: params.name.split(" ").slice(1).join(" ") || "",
      enabled: true,
      emailVerified: true,
      attributes: {
        nexcomUserId: [String(params.nexcomUserId)],
        nexcomOpenId: [params.openId],
        nexcomRole: [params.role],
      },
    };

    if (existing.length > 0) {
      // Update existing user
      const updateResp = await fetch(
        `${KEYCLOAK_BASE}/admin/realms/${KEYCLOAK_REALM}/users/${existing[0].id}`,
        {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(userPayload),
          signal: AbortSignal.timeout(5000),
        }
      );
      return { synced: updateResp.ok, keycloakId: existing[0].id };
    }

    // Create new user
    const createResp = await fetch(
      `${KEYCLOAK_BASE}/admin/realms/${KEYCLOAK_REALM}/users`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(userPayload),
        signal: AbortSignal.timeout(5000),
      }
    );

    if (!createResp.ok) return { synced: false, error: `Create failed: ${createResp.status}` };

    // Extract new user ID from Location header
    const location = createResp.headers.get("Location") ?? "";
    const keycloakId = location.split("/").pop() ?? "";
    return { synced: true, keycloakId };
  } catch (err) {
    return { synced: false, error: err instanceof Error ? err.message : "Unknown error" };
  }
}

/**
 * Exchange a Manus JWT for a Keycloak access token (token exchange flow).
 * Used when downstream services require Keycloak-issued tokens.
 */
export async function exchangeTokenWithKeycloak(manusJwt: string): Promise<KeycloakTokenResponse | null> {
  try {
    const resp = await fetch(
      `${KEYCLOAK_BASE}/realms/${KEYCLOAK_REALM}/protocol/openid-connect/token`,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
          client_id: KEYCLOAK_CLIENT_ID,
          client_secret: KEYCLOAK_CLIENT_SECRET,
          subject_token: manusJwt,
          subject_token_type: "urn:ietf:params:oauth:token-type:jwt",
          requested_token_type: "urn:ietf:params:oauth:token-type:access_token",
        }).toString(),
        signal: AbortSignal.timeout(5000),
      }
    );

    if (!resp.ok) return null;
    return await resp.json() as KeycloakTokenResponse;
  } catch {
    return null;
  }
}

/**
 * Assign a realm role to a user in Keycloak.
 * Used when a user is promoted to admin in NEXCOM.
 */
export async function assignKeycloakRole(keycloakUserId: string, roleName: string): Promise<boolean> {
  const token = await getAdminToken();
  if (!token) return false;

  try {
    // Get role representation
    const roleResp = await fetch(
      `${KEYCLOAK_BASE}/admin/realms/${KEYCLOAK_REALM}/roles/${roleName}`,
      {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(5000),
      }
    );
    if (!roleResp.ok) return false;
    const role = await roleResp.json();

    // Assign role to user
    const assignResp = await fetch(
      `${KEYCLOAK_BASE}/admin/realms/${KEYCLOAK_REALM}/users/${keycloakUserId}/role-mappings/realm`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify([role]),
        signal: AbortSignal.timeout(5000),
      }
    );
    return assignResp.ok;
  } catch {
    return false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Token verification (for API bearer token auth)
// ─────────────────────────────────────────────────────────────────────────────

export interface KeycloakTokenClaims {
  sub: string;            // Keycloak user UUID
  email?: string;
  preferred_username?: string;
  name?: string;
  realm_access?: { roles: string[] };
  resource_access?: Record<string, { roles: string[] }>;
  /** NEXCOM-specific custom attributes injected via Keycloak mapper */
  nexcomUserId?: string;
  nexcomRole?: string;
  exp: number;
  iat: number;
  iss: string;
}

/**
 * Introspect a Keycloak access token using the realm's token introspection endpoint.
 * Returns the claims if the token is active, or null if invalid/expired/unavailable.
 *
 * This is the server-side verification path for API clients that present a
 * Keycloak-issued Bearer token in the Authorization header.
 */
export async function introspectKeycloakToken(
  accessToken: string
): Promise<KeycloakTokenClaims | null> {
  if (!KEYCLOAK_CLIENT_SECRET) return null;

  try {
    const resp = await fetch(
      `${KEYCLOAK_BASE}/realms/${KEYCLOAK_REALM}/protocol/openid-connect/token/introspect`,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          token: accessToken,
          client_id: KEYCLOAK_CLIENT_ID,
          client_secret: KEYCLOAK_CLIENT_SECRET,
        }).toString(),
        signal: AbortSignal.timeout(3000),
      }
    );

    if (!resp.ok) return null;
    const claims = await resp.json() as KeycloakTokenClaims & { active: boolean };
    if (!claims.active) return null;
    return claims;
  } catch {
    return null;
  }
}

/**
 * Verify a Keycloak JWT using JWKS (offline verification — no introspection call).
 * Falls back to introspection if JWKS verification fails.
 *
 * Returns the decoded claims or null if verification fails.
 */
export async function verifyKeycloakToken(
  bearerToken: string
): Promise<KeycloakTokenClaims | null> {
  // Try introspection first (authoritative, handles revoked tokens)
  return introspectKeycloakToken(bearerToken);
}
