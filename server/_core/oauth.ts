import { COOKIE_NAME, REFRESH_TOKEN_COOKIE, REFRESH_TTL_MS, SESSION_TTL_MS } from "@shared/const";
import type { Express, Request, Response } from "express";
import * as db from "../db";
import { issueRefreshToken, consumeRefreshToken, revokeAllRefreshTokens } from "../refreshTokens";
import { getSessionCookieOptions } from "./cookies";
import { sdk } from "./sdk";

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
    // Restrict refresh token to the /api/auth path to reduce attack surface
    path: "/api/auth",
  });
}

export function registerOAuthRoutes(app: Express) {
  // ── OAuth callback (Manus OAuth) ─────────────────────────────────────────
  app.get("/api/oauth/callback", async (req: Request, res: Response) => {
    const code = getQueryParam(req, "code");
    const state = getQueryParam(req, "state");

    if (!code || !state) {
      res.status(400).json({ error: "code and state are required" });
      return;
    }

    try {
      const tokenResponse = await sdk.exchangeCodeForToken(code, state);
      const userInfo = await sdk.getUserInfo(tokenResponse.accessToken);

      if (!userInfo.openId) {
        res.status(400).json({ error: "openId missing from user info" });
        return;
      }

      await db.upsertUser({
        openId: userInfo.openId,
        name: userInfo.name || null,
        email: userInfo.email ?? null,
        loginMethod: userInfo.loginMethod ?? userInfo.platform ?? null,
        lastSignedIn: new Date(),
      });

      const user = await db.getUserByOpenId(userInfo.openId);

      // Issue short-lived access token (8h)
      const sessionToken = await sdk.createSessionToken(userInfo.openId, {
        name: userInfo.name || "",
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
      console.error("[OAuth] Callback failed", error);
      res.status(500).json({ error: "OAuth callback failed" });
    }
  });

  // ── Token refresh endpoint ────────────────────────────────────────────────
  // POST /api/auth/refresh — exchange refresh token for new access + refresh tokens
  app.post("/api/auth/refresh", async (req: Request, res: Response) => {
    const rawRefreshToken = req.cookies?.[REFRESH_TOKEN_COOKIE];

    if (!rawRefreshToken) {
      res.status(401).json({
        error: "No refresh token",
        code: "REFRESH_TOKEN_MISSING",
      });
      return;
    }

    try {
      const result = await consumeRefreshToken(rawRefreshToken);

      if (!result) {
        // Clear both cookies on invalid/expired/reused refresh token
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

      // Issue new access token
      const sessionToken = await sdk.createSessionToken(user.openId, {
        name: user.name || "",
        expiresInMs: SESSION_TTL_MS,
      });
      setAccessCookie(res, req, sessionToken);

      // Issue new refresh token in the same family (sliding window rotation)
      const ip = (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ?? req.ip;
      const ua = req.headers["user-agent"] ?? "";
      const newRefresh = await issueRefreshToken(user.id, {
        ip,
        userAgent: ua,
        family: result.family, // keep same family for revocation tracking
      });
      if (newRefresh) {
        setRefreshCookie(res, req, newRefresh.raw);
      }

      res.json({
        ok: true,
        expiresIn: SESSION_TTL_MS / 1000,
        message: "Access token refreshed",
      });
    } catch (error) {
      console.error("[OAuth] Token refresh failed", error);
      res.status(500).json({ error: "Token refresh failed" });
    }
  });

  // ── Logout (also revokes refresh tokens) ─────────────────────────────────
  // This is handled by the tRPC auth.logout mutation, but we also expose a
  // REST endpoint for non-tRPC clients (mobile apps, etc.)
  app.post("/api/auth/logout", async (req: Request, res: Response) => {
    const cookieOptions = getSessionCookieOptions(req);

    // Revoke refresh token if present
    const rawRefreshToken = req.cookies?.[REFRESH_TOKEN_COOKIE];
    if (rawRefreshToken) {
      const result = await consumeRefreshToken(rawRefreshToken).catch(() => null);
      if (result) {
        // Revoke all tokens for this user on explicit logout
        await revokeAllRefreshTokens(result.userId).catch(() => {});
      }
    }

    res.clearCookie(COOKIE_NAME, { ...cookieOptions, path: "/" });
    res.clearCookie(REFRESH_TOKEN_COOKIE, { ...cookieOptions, path: "/api/auth" });
    res.json({ ok: true });
  });
}
