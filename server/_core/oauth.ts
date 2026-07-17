/**
 * NEXCOM Exchange — OIDC / Auth routes
 *
 * Replaced Manus OAuth with Keycloak OIDC (authorization-code flow).
 * The frontend redirects the user to Keycloak via /api/auth/login, and
 * Keycloak redirects back to /api/oauth/callback with ?code=&state=.
 *
 * No Manus dependencies.
 */
import { COOKIE_NAME, REFRESH_TOKEN_COOKIE, REFRESH_TTL_MS, SESSION_TTL_MS } from "@shared/const";
import type { Express, Request, Response } from "express";
import * as db from "../db";
import { issueRefreshToken, consumeRefreshToken, revokeAllRefreshTokens } from "../refreshTokens";
import { getSessionCookieOptions } from "./cookies";
import { sdk } from "./sdk";

const KEYCLOAK_BASE = process.env.KEYCLOAK_URL ?? "http://localhost:8080";
const KEYCLOAK_REALM = process.env.KEYCLOAK_REALM ?? "nexcom";
const KEYCLOAK_CLIENT_ID = process.env.KEYCLOAK_CLIENT_ID ?? "nexcom-exchange";
const KEYCLOAK_CLIENT_SECRET = process.env.KEYCLOAK_CLIENT_SECRET ?? "";

function keycloakUrl(path: string) {
  return `${KEYCLOAK_BASE}/realms/${KEYCLOAK_REALM}${path}`;
}

function getQueryParam(req: Request, key: string): string | undefined {
  const value = req.query[key];
  return typeof value === "string" ? value : undefined;
}

/** Set the access token cookie (8-hour TTL) */
function setAccessCookie(res: Response, req: Request, token: string) {
  const cookieOptions = getSessionCookieOptions(req);
  res.cookie(COOKIE_NAME, token, { ...cookieOptions, maxAge: SESSION_TTL_MS });
}

/** Set the refresh token cookie (7-day TTL, HttpOnly, Secure) */
function setRefreshCookie(res: Response, req: Request, rawToken: string) {
  const cookieOptions = getSessionCookieOptions(req);
  res.cookie(REFRESH_TOKEN_COOKIE, rawToken, {
    ...cookieOptions,
    maxAge: REFRESH_TTL_MS,
    path: "/api/auth",
  });
}

export function registerOAuthRoutes(app: Express) {
  // ── Login redirect → Keycloak ─────────────────────────────────────────────
  // GET /api/auth/login?redirectUri=<frontend-origin>/api/oauth/callback&state=<b64>
  app.get("/api/auth/login", (req: Request, res: Response) => {
    const redirectUri =
      getQueryParam(req, "redirectUri") ??
      `${req.protocol}://${req.get("host")}/api/oauth/callback`;
    const state = getQueryParam(req, "state") ?? Buffer.from(redirectUri).toString("base64");

    const authUrl = new URL(keycloakUrl("/protocol/openid-connect/auth"));
    authUrl.searchParams.set("client_id", KEYCLOAK_CLIENT_ID);
    authUrl.searchParams.set("redirect_uri", redirectUri);
    authUrl.searchParams.set("response_type", "code");
    authUrl.searchParams.set("scope", "openid email profile");
    authUrl.searchParams.set("state", state);

    res.redirect(302, authUrl.toString());
  });

  // ── OIDC callback (Keycloak authorization-code) ───────────────────────────
  app.get("/api/oauth/callback", async (req: Request, res: Response) => {
    const code = getQueryParam(req, "code");
    const state = getQueryParam(req, "state");

    if (!code || !state) {
      res.status(400).json({ error: "code and state are required" });
      return;
    }

    try {
      // Decode redirect URI from state (base64-encoded by the frontend)
      let callbackUri: string;
      try {
        callbackUri = Buffer.from(state, "base64").toString("utf8");
        new URL(callbackUri); // validate
      } catch {
        callbackUri = `${req.protocol}://${req.get("host")}/api/oauth/callback`;
      }

      // Exchange code for tokens with Keycloak
      const tokenBody = new URLSearchParams({
        grant_type: "authorization_code",
        client_id: KEYCLOAK_CLIENT_ID,
        client_secret: KEYCLOAK_CLIENT_SECRET,
        code,
        redirect_uri: callbackUri,
      });
      const tokenResp = await fetch(keycloakUrl("/protocol/openid-connect/token"), {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: tokenBody.toString(),
        signal: AbortSignal.timeout(10_000),
      });
      if (!tokenResp.ok) {
        const detail = await tokenResp.text().catch(() => "");
        throw new Error(`Keycloak token exchange failed (${tokenResp.status}): ${detail}`);
      }
      const tokens = await tokenResp.json() as {
        access_token: string;
        id_token?: string;
        refresh_token?: string;
      };

      // Fetch user info from Keycloak
      const uiResp = await fetch(keycloakUrl("/protocol/openid-connect/userinfo"), {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
        signal: AbortSignal.timeout(10_000),
      });
      if (!uiResp.ok) throw new Error(`Keycloak userinfo failed (${uiResp.status})`);
      const kcUser = await uiResp.json() as {
        sub: string;
        name?: string;
        preferred_username?: string;
        email?: string;
      };

      const openId = kcUser.sub;
      const name = kcUser.name ?? kcUser.preferred_username ?? openId;
      const email = kcUser.email ?? null;

      if (!openId) {
        res.status(400).json({ error: "sub missing from Keycloak userinfo" });
        return;
      }

      await db.upsertUser({
        openId,
        name: name || null,
        email,
        loginMethod: "oidc",
        lastSignedIn: new Date(),
      });

      const user = await db.getUserByOpenId(openId);

      // Issue short-lived session JWT (8h)
      const sessionToken = await sdk.createSessionToken(openId, {
        name: name || "",
        expiresInMs: SESSION_TTL_MS,
      });
      setAccessCookie(res, req, sessionToken);

      // Issue long-lived refresh token (7d) — stored in DB
      if (user) {
        const ip = (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ?? req.ip;
        const ua = req.headers["user-agent"] ?? "";
        const refreshResult = await issueRefreshToken(user.id, { ip, userAgent: ua });
        if (refreshResult) {
          setRefreshCookie(res, req, refreshResult.raw);
        }
      }

      res.redirect(302, "/");
    } catch (error) {
      console.error("[OIDC] Callback failed", error);
      res.status(500).json({ error: "OIDC callback failed" });
    }
  });

  // ── Token refresh endpoint ────────────────────────────────────────────────
  app.post("/api/auth/refresh", async (req: Request, res: Response) => {
    const rawRefreshToken = req.cookies?.[REFRESH_TOKEN_COOKIE];

    if (!rawRefreshToken) {
      res.status(401).json({ error: "No refresh token", code: "REFRESH_TOKEN_MISSING" });
      return;
    }

    try {
      const result = await consumeRefreshToken(rawRefreshToken);

      if (!result) {
        const cookieOptions = getSessionCookieOptions(req);
        res.clearCookie(COOKIE_NAME, { ...cookieOptions, path: "/" });
        res.clearCookie(REFRESH_TOKEN_COOKIE, { ...cookieOptions, path: "/api/auth" });
        res.status(401).json({
          error: "Invalid or expired refresh token",
          code: "REFRESH_TOKEN_INVALID",
        });
        return;
      }

      const user = await db.getUserById(result.userId);
      if (!user) {
        res.status(401).json({ error: "User not found", code: "USER_NOT_FOUND" });
        return;
      }

      const sessionToken = await sdk.createSessionToken(user.openId, {
        name: user.name || "",
        expiresInMs: SESSION_TTL_MS,
      });
      setAccessCookie(res, req, sessionToken);

      const ip = (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ?? req.ip;
      const ua = req.headers["user-agent"] ?? "";
      const newRefresh = await issueRefreshToken(user.id, {
        ip,
        userAgent: ua,
        family: result.family,
      });
      if (newRefresh) {
        setRefreshCookie(res, req, newRefresh.raw);
      }

      res.json({ ok: true, expiresIn: SESSION_TTL_MS / 1000, message: "Access token refreshed" });
    } catch (error) {
      console.error("[Auth] Token refresh failed", error);
      res.status(500).json({ error: "Token refresh failed" });
    }
  });

  // ── Logout ────────────────────────────────────────────────────────────────
  app.post("/api/auth/logout", async (req: Request, res: Response) => {
    const cookieOptions = getSessionCookieOptions(req);

    const rawRefreshToken = req.cookies?.[REFRESH_TOKEN_COOKIE];
    if (rawRefreshToken) {
      const result = await consumeRefreshToken(rawRefreshToken).catch(() => null);
      if (result) {
        await revokeAllRefreshTokens(result.userId).catch(() => {});
      }
    }

    res.clearCookie(COOKIE_NAME, { ...cookieOptions, path: "/" });
    res.clearCookie(REFRESH_TOKEN_COOKIE, { ...cookieOptions, path: "/api/auth" });
    res.json({ ok: true });
  });
}
