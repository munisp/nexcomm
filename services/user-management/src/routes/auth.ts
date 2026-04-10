/**
 * Authentication routes: login, logout, token refresh, MFA
 * Delegates to Keycloak for actual authentication via OpenID Connect.
 *
 * Environment variables:
 *   KEYCLOAK_URL    — e.g. https://auth.nexcom.io (no trailing slash)
 *   KEYCLOAK_REALM  — e.g. nexcom (default: nexcom)
 *   KEYCLOAK_CLIENT — e.g. nexcom-api (default: nexcom-api)
 *   KEYCLOAK_SECRET — client secret for confidential clients
 */
import { Router, Request, Response } from 'express';

export const authRouter = Router();

const KEYCLOAK_URL = process.env.KEYCLOAK_URL ?? '';
const KEYCLOAK_REALM = process.env.KEYCLOAK_REALM ?? 'nexcom';
const KEYCLOAK_CLIENT = process.env.KEYCLOAK_CLIENT ?? 'nexcom-api';
const KEYCLOAK_SECRET = process.env.KEYCLOAK_SECRET ?? '';

function tokenEndpoint(): string {
  return `${KEYCLOAK_URL}/realms/${KEYCLOAK_REALM}/protocol/openid-connect/token`;
}

// Login (delegates to Keycloak token endpoint)
authRouter.post('/login', async (req: Request, res: Response) => {
  const { username, password } = req.body as { username?: string; password?: string };

  if (!username || !password) {
    res.status(400).json({ error: 'Username and password required' });
    return;
  }

  if (!KEYCLOAK_URL) {
    res.status(503).json({ error: 'Authentication service not configured' });
    return;
  }

  try {
    const params = new URLSearchParams({
      grant_type: 'password',
      client_id: KEYCLOAK_CLIENT,
      client_secret: KEYCLOAK_SECRET,
      username,
      password,
      scope: 'openid profile email',
    });
    const kcRes = await fetch(tokenEndpoint(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
      signal: AbortSignal.timeout(10_000),
    });
    const data = await kcRes.json() as Record<string, unknown>;
    if (!kcRes.ok) {
      res.status(401).json({ error: (data.error_description as string) ?? 'Authentication failed' });
      return;
    }
    res.json({ access_token: data.access_token, token_type: data.token_type ?? 'Bearer',
      expires_in: data.expires_in, refresh_token: data.refresh_token, scope: data.scope });
  } catch (err) {
    console.error('[Auth] Login failed:', err);
    res.status(502).json({ error: 'Authentication service unavailable' });
  }
});

// Refresh token
authRouter.post('/refresh', async (req: Request, res: Response) => {
  const { refresh_token } = req.body as { refresh_token?: string };

  if (!refresh_token) {
    res.status(400).json({ error: 'Refresh token required' });
    return;
  }

  if (!KEYCLOAK_URL) {
    res.status(503).json({ error: 'Authentication service not configured' });
    return;
  }

  try {
    const params = new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: KEYCLOAK_CLIENT,
      client_secret: KEYCLOAK_SECRET,
      refresh_token,
    });
    const kcRes = await fetch(tokenEndpoint(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
      signal: AbortSignal.timeout(10_000),
    });
    const data = await kcRes.json() as Record<string, unknown>;
    if (!kcRes.ok) {
      res.status(401).json({ error: (data.error_description as string) ?? 'Token refresh failed' });
      return;
    }
    res.json({ access_token: data.access_token, token_type: data.token_type ?? 'Bearer',
      expires_in: data.expires_in, refresh_token: data.refresh_token });
  } catch (err) {
    console.error('[Auth] Token refresh failed:', err);
    res.status(502).json({ error: 'Authentication service unavailable' });
  }
});

// Logout
authRouter.post('/logout', async (req: Request, res: Response) => {
  const { refresh_token } = req.body as { refresh_token?: string };
  if (KEYCLOAK_URL && refresh_token) {
    try {
      const params = new URLSearchParams({
        client_id: KEYCLOAK_CLIENT, client_secret: KEYCLOAK_SECRET, refresh_token,
      });
      await fetch(`${KEYCLOAK_URL}/realms/${KEYCLOAK_REALM}/protocol/openid-connect/logout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params.toString(),
        signal: AbortSignal.timeout(5_000),
      });
    } catch (err) {
      console.warn('[Auth] Keycloak logout failed (non-fatal):', err);
    }
  }
  res.json({ message: 'Logged out successfully' });
});

// USSD authentication endpoint (for feature phone farmers)
authRouter.post('/ussd/auth', async (req: Request, res: Response) => {
  const { phone, pin } = req.body as { phone?: string; pin?: string };

  if (!phone || !pin) {
    res.status(400).json({ error: 'Phone and PIN required' });
    return;
  }

  if (!KEYCLOAK_URL) {
    res.status(503).json({ error: 'Authentication service not configured' });
    return;
  }

  // USSD sessions require a custom Keycloak PIN authenticator.
  // Return 501 until the Keycloak USSD extension is deployed.
  res.status(501).json({
    error: 'USSD authentication not yet implemented',
    hint: 'Deploy the Keycloak USSD authenticator extension and set KEYCLOAK_URL',
  });
});
