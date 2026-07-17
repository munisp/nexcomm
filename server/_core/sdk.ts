/**
 * NEXCOM Exchange — Auth SDK (self-hosted, no Manus dependencies)
 *
 * Replaces the Manus WebDevAuthPublicService gRPC-web proxy with a direct
 * Keycloak OIDC flow.  Cookie-based sessions continue to use the same
 * HS256 JWT format so existing sessions remain valid after the migration.
 *
 * Auth flow:
 *   1. /api/auth/login  → redirect to Keycloak authorisation endpoint
 *   2. Keycloak         → redirect to /api/oauth/callback?code=…&state=…
 *   3. /api/oauth/callback → exchange code for tokens, upsert user, set cookie
 *
 * No Manus dependencies.
 */

import { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";
import { ForbiddenError } from "@shared/_core/errors";
import type { Request } from "express";
import { SignJWT, jwtVerify } from "jose";
import type { User } from "../../drizzle/schema";
import * as db from "../db";
import { ENV } from "./env";

// ── Utilities ──────────────────────────────────────────────────────────────────

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0;

function parseCookieHeader(header: string | undefined): Map<string, string> {
  if (!header) return new Map();
  return new Map(
    header.split(";").map(pair => {
      const idx = pair.indexOf("=");
      if (idx < 0) return [pair.trim(), ""] as [string, string];
      return [pair.slice(0, idx).trim(), decodeURIComponent(pair.slice(idx + 1).trim())] as [string, string];
    })
  );
}

// ── Session payload ────────────────────────────────────────────────────────────

export type SessionPayload = {
  /** User's unique identifier (Keycloak sub or internal UUID) */
  openId: string;
  /** Client ID — kept for backward compatibility with existing sessions */
  appId: string;
  name: string;
};

// ── Keycloak OIDC helpers ──────────────────────────────────────────────────────

export function getKeycloakBaseUrl(): string {
  return `${ENV.keycloakUrl}/realms/${ENV.keycloakRealm}`;
}

export function getAuthorizationUrl(redirectUri: string, state: string): string {
  const url = new URL(`${getKeycloakBaseUrl()}/protocol/openid-connect/auth`);
  url.searchParams.set("client_id", ENV.keycloakClientId);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "openid profile email");
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("state", state);
  return url.toString();
}

export async function exchangeCodeForTokens(code: string, redirectUri: string): Promise<{
  access_token: string;
  refresh_token?: string;
  id_token?: string;
  expires_in: number;
}> {
  const tokenUrl = `${getKeycloakBaseUrl()}/protocol/openid-connect/token`;
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: ENV.keycloakClientId,
    client_secret: ENV.keycloakClientSecret,
    code,
    redirect_uri: redirectUri,
  });
  const resp = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
    signal: AbortSignal.timeout(10_000),
  });
  if (!resp.ok) {
    const detail = await resp.text().catch(() => "");
    throw new Error(`Keycloak token exchange failed (${resp.status}): ${detail}`);
  }
  return resp.json();
}

export async function getUserInfoFromToken(accessToken: string): Promise<{
  sub: string;
  name?: string;
  preferred_username?: string;
  email?: string;
  email_verified?: boolean;
}> {
  const userInfoUrl = `${getKeycloakBaseUrl()}/protocol/openid-connect/userinfo`;
  const resp = await fetch(userInfoUrl, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(10_000),
  });
  if (!resp.ok) {
    const detail = await resp.text().catch(() => "");
    throw new Error(`Keycloak userinfo failed (${resp.status}): ${detail}`);
  }
  return resp.json();
}

// ── SDKServer ──────────────────────────────────────────────────────────────────

class SDKServer {
  private getSessionSecret() {
    return new TextEncoder().encode(ENV.cookieSecret);
  }

  async createSessionToken(
    openId: string,
    options: { expiresInMs?: number; name?: string } = {}
  ): Promise<string> {
    return this.signSession(
      { openId, appId: ENV.keycloakClientId, name: options.name ?? "" },
      options
    );
  }

  async signSession(
    payload: SessionPayload,
    options: { expiresInMs?: number } = {}
  ): Promise<string> {
    const issuedAt = Date.now();
    const expiresInMs = options.expiresInMs ?? ONE_YEAR_MS;
    const expirationSeconds = Math.floor((issuedAt + expiresInMs) / 1000);
    const secretKey = this.getSessionSecret();
    return new SignJWT({
      openId: payload.openId,
      appId: payload.appId,
      name: payload.name,
    })
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .setExpirationTime(expirationSeconds)
      .sign(secretKey);
  }

  async verifySession(
    cookieValue: string | undefined | null
  ): Promise<{ openId: string; appId: string; name: string } | null> {
    if (!cookieValue) {
      console.warn("[Auth] Missing session cookie");
      return null;
    }
    try {
      const secretKey = this.getSessionSecret();
      const { payload } = await jwtVerify(cookieValue, secretKey, {
        algorithms: ["HS256"],
      });
      const { openId, appId, name } = payload as Record<string, unknown>;
      if (!isNonEmptyString(openId) || !isNonEmptyString(appId) || !isNonEmptyString(name)) {
        console.warn("[Auth] Session payload missing required fields");
        return null;
      }
      return { openId, appId, name };
    } catch (error) {
      console.warn("[Auth] Session verification failed", String(error));
      return null;
    }
  }

  async authenticateRequest(req: Request): Promise<User> {
    // ── Keycloak Bearer token path (API clients / SSO) ─────────────────────
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith("Bearer ")) {
      const bearerToken = authHeader.slice(7);
      try {
        const { verifyKeycloakToken } = await import("../keycloak/keycloakClient");
        const claims = await verifyKeycloakToken(bearerToken);
        if (claims) {
          const nexcomUserId = claims.nexcomUserId
            ? parseInt(claims.nexcomUserId, 10)
            : null;
          if (nexcomUserId && !isNaN(nexcomUserId)) {
            const user = await db.getUserById(nexcomUserId);
            if (user) {
              setImmediate(() =>
                db.upsertUser({ openId: user.openId, lastSignedIn: new Date() }).catch(() => {})
              );
              return user;
            }
          }
          if (claims.email) {
            const userByEmail = await db.getUserByEmail(claims.email);
            if (userByEmail) {
              setImmediate(() =>
                db.upsertUser({ openId: userByEmail.openId, lastSignedIn: new Date() }).catch(() => {})
              );
              return userByEmail;
            }
          }
        }
      } catch {
        // Keycloak unavailable — fall through to cookie auth
      }
    }

    // ── Cookie-based session path (primary) ───────────────────────────────
    const cookies = parseCookieHeader(req.headers.cookie);
    const sessionCookie = cookies.get(COOKIE_NAME);
    const session = await this.verifySession(sessionCookie);
    if (!session) {
      throw ForbiddenError("Invalid session cookie");
    }

    const signedInAt = new Date();
    let user = await db.getUserByOpenId(session.openId);

    if (!user) {
      // User not in DB — create a minimal record from session data
      try {
        await db.upsertUser({
          openId: session.openId,
          name: session.name || null,
          lastSignedIn: signedInAt,
        });
        user = await db.getUserByOpenId(session.openId);
      } catch (error) {
        console.error("[Auth] Failed to create user from session:", error);
        throw ForbiddenError("Failed to sync user info");
      }
    }

    if (!user) throw ForbiddenError("User not found");

    await db.upsertUser({ openId: user.openId, lastSignedIn: signedInAt });
    return user;
  }
}

export const sdk = new SDKServer();
