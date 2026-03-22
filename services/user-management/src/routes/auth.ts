// Authentication routes: login, logout, token refresh, MFA
// Delegates to Keycloak for actual authentication via OpenID Connect
import { Router, Request, Response } from 'express';

export const authRouter = Router();

// Login (delegates to Keycloak token endpoint)
authRouter.post('/login', async (req: Request, res: Response) => {
  const { username, password } = req.body;

  if (!username || !password) {
    res.status(400).json({ error: 'Username and password required' });
    return;
  }

  // In production: Exchange credentials with Keycloak token endpoint
  // POST ${KEYCLOAK_URL}/realms/nexcom/protocol/openid-connect/token
  // grant_type=password, client_id=nexcom-api, username, password

  res.json({
    access_token: 'placeholder-jwt',
    token_type: 'Bearer',
    expires_in: 900,
    refresh_token: 'placeholder-refresh',
    scope: 'openid profile email',
  });
});

// Refresh token
authRouter.post('/refresh', async (req: Request, res: Response) => {
  const { refresh_token } = req.body;

  if (!refresh_token) {
    res.status(400).json({ error: 'Refresh token required' });
    return;
  }

  // In production: Exchange refresh token with Keycloak
  res.json({
    access_token: 'placeholder-jwt-refreshed',
    token_type: 'Bearer',
    expires_in: 900,
    refresh_token: 'placeholder-refresh-new',
  });
});

// Logout
authRouter.post('/logout', async (req: Request, res: Response) => {
  // In production: Revoke token at Keycloak
  // POST ${KEYCLOAK_URL}/realms/nexcom/protocol/openid-connect/logout
  res.json({ message: 'Logged out successfully' });
});

// USSD authentication endpoint (for feature phone farmers)
authRouter.post('/ussd/auth', async (req: Request, res: Response) => {
  const { phone, pin } = req.body;

  if (!phone || !pin) {
    res.status(400).json({ error: 'Phone and PIN required' });
    return;
  }

  // Validate phone + PIN against user database
  // Generate a short-lived session token for USSD gateway
  res.json({
    session_id: 'ussd-session-placeholder',
    expires_in: 300, // 5 minutes for USSD sessions
  });
});
