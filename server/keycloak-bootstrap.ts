/**
 * NEXCOM Exchange — Keycloak Realm Bootstrap (server module)
 *
 * Called during server startup to idempotently provision:
 *   - The "nexcom" realm
 *   - The "nexcom-exchange" OIDC client with correct redirect URIs
 *   - Realm roles: admin, user, broker, field_agent, collateral_manager
 *   - An initial admin user (NEXCOM_ADMIN_EMAIL / NEXCOM_ADMIN_PASSWORD)
 *
 * Gracefully degrades when Keycloak is unavailable (logs a warning, does not
 * crash the server). Safe to call on every startup — all operations are
 * idempotent (create-or-skip).
 *
 * Environment variables (all have Docker Compose defaults):
 *   KEYCLOAK_URL              http://keycloak:8080
 *   KEYCLOAK_REALM            nexcom
 *   KEYCLOAK_CLIENT_ID        nexcom-exchange
 *   KEYCLOAK_CLIENT_SECRET    nexcom-exchange-secret
 *   KEYCLOAK_ADMIN            admin
 *   KEYCLOAK_ADMIN_PASSWORD   nexcom-admin-secret
 *   NEXCOM_ADMIN_EMAIL        admin@nexcom.exchange
 *   NEXCOM_ADMIN_PASSWORD     NexcomAdmin2026!
 *   APP_BASE_URL              http://localhost:3000
 */

const KC_URL     = process.env.KEYCLOAK_URL             ?? "http://keycloak:8080";
const KC_REALM   = process.env.KEYCLOAK_REALM           ?? "nexcom";
const KC_CLIENT  = process.env.KEYCLOAK_CLIENT_ID       ?? "nexcom-exchange";
const KC_SECRET  = process.env.KEYCLOAK_CLIENT_SECRET   ?? "nexcom-exchange-secret";
const KC_ADMIN   = process.env.KEYCLOAK_ADMIN           ?? "admin";
const KC_ADMIN_PW = process.env.KEYCLOAK_ADMIN_PASSWORD ?? "nexcom-admin-secret";
const APP_URL    = process.env.APP_BASE_URL             ?? "http://localhost:3000";
const ADMIN_EMAIL = process.env.NEXCOM_ADMIN_EMAIL      ?? "admin@nexcom.exchange";
const ADMIN_PW    = process.env.NEXCOM_ADMIN_PASSWORD   ?? "NexcomAdmin2026!";

function log(msg: string) {
  console.log(`[Keycloak Bootstrap] ${msg}`);
}

async function getAdminToken(): Promise<string> {
  const res = await fetch(
    `${KC_URL}/realms/master/protocol/openid-connect/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "password",
        client_id: "admin-cli",
        username: KC_ADMIN,
        password: KC_ADMIN_PW,
      }),
      signal: AbortSignal.timeout(10_000),
    }
  );
  if (!res.ok) throw new Error(`Failed to get admin token: ${res.status} ${await res.text()}`);
  const data = await res.json() as { access_token: string };
  return data.access_token;
}

async function kcFetch(
  token: string,
  path: string,
  method = "GET",
  body?: unknown
): Promise<Response> {
  return fetch(`${KC_URL}/admin/realms${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(10_000),
  });
}

async function ensureRealm(token: string): Promise<void> {
  const check = await kcFetch(token, `/${KC_REALM}`);
  if (check.status === 404) {
    log(`Creating realm "${KC_REALM}"…`);
    const res = await fetch(`${KC_URL}/admin/realms`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        realm: KC_REALM,
        enabled: true,
        displayName: "NEXCOM Exchange",
        registrationAllowed: false,
        loginWithEmailAllowed: true,
        duplicateEmailsAllowed: false,
        resetPasswordAllowed: true,
        editUsernameAllowed: false,
        bruteForceProtected: true,
        accessTokenLifespan: 900,
        ssoSessionIdleTimeout: 1800,
        ssoSessionMaxLifespan: 36000,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok && res.status !== 409) {
      throw new Error(`Failed to create realm: ${res.status} ${await res.text()}`);
    }
    log(`Realm "${KC_REALM}" created`);
  } else {
    log(`Realm "${KC_REALM}" already exists — skipping`);
  }
}

async function ensureRoles(token: string): Promise<void> {
  const roles = ["admin", "user", "broker", "field_agent", "collateral_manager"];
  for (const role of roles) {
    const check = await kcFetch(token, `/${KC_REALM}/roles/${role}`);
    if (check.status === 404) {
      const res = await kcFetch(token, `/${KC_REALM}/roles`, "POST", {
        name: role,
        description: `NEXCOM ${role} role`,
      });
      if (!res.ok && res.status !== 409) {
        log(`Warning: could not create role "${role}": ${res.status}`);
      } else {
        log(`Role "${role}" created`);
      }
    }
  }
}

async function ensureClient(token: string): Promise<void> {
  const listRes = await kcFetch(token, `/${KC_REALM}/clients?clientId=${encodeURIComponent(KC_CLIENT)}`);
  const clients = await listRes.json() as Array<{ id: string; clientId: string }>;

  const redirectUris = [
    `${APP_URL}/api/oauth/callback`,
    "http://localhost:3000/api/oauth/callback",
    "http://localhost:4001/api/oauth/callback",
  ];
  const webOrigins = [APP_URL, "http://localhost:3000", "http://localhost:4001"];

  if (clients.length === 0) {
    log(`Creating client "${KC_CLIENT}"…`);
    const res = await kcFetch(token, `/${KC_REALM}/clients`, "POST", {
      clientId: KC_CLIENT,
      name: "NEXCOM Exchange",
      enabled: true,
      protocol: "openid-connect",
      publicClient: false,
      secret: KC_SECRET,
      standardFlowEnabled: true,
      implicitFlowEnabled: false,
      directAccessGrantsEnabled: false,
      serviceAccountsEnabled: false,
      authorizationServicesEnabled: false,
      redirectUris,
      webOrigins,
      attributes: {
        "pkce.code.challenge.method": "S256",
        "access.token.lifespan": "900",
        "client.session.idle.timeout": "1800",
      },
    });
    if (!res.ok && res.status !== 409) {
      log(`Warning: could not create client "${KC_CLIENT}": ${res.status} ${await res.text()}`);
    } else {
      log(`Client "${KC_CLIENT}" created`);
    }
  } else {
    // Update redirect URIs to ensure they include the current APP_URL
    const clientId = clients[0].id;
    await kcFetch(token, `/${KC_REALM}/clients/${clientId}`, "PUT", {
      ...clients[0],
      redirectUris,
      webOrigins,
      secret: KC_SECRET,
    });
    log(`Client "${KC_CLIENT}" already exists — redirect URIs refreshed`);
  }
}

async function ensureAdminUser(token: string): Promise<void> {
  const search = await kcFetch(token, `/${KC_REALM}/users?email=${encodeURIComponent(ADMIN_EMAIL)}&exact=true`);
  const users = await search.json() as Array<{ id: string }>;

  if (users.length === 0) {
    log(`Creating admin user "${ADMIN_EMAIL}"…`);
    const res = await kcFetch(token, `/${KC_REALM}/users`, "POST", {
      username: ADMIN_EMAIL,
      email: ADMIN_EMAIL,
      enabled: true,
      emailVerified: true,
      credentials: [{ type: "password", value: ADMIN_PW, temporary: false }],
    });
    if (!res.ok) {
      log(`Warning: could not create admin user: ${res.status}`);
      return;
    }
    // Assign admin role
    const location = res.headers.get("Location") ?? "";
    const userId = location.split("/").pop();
    if (userId) {
      const roleRes = await kcFetch(token, `/${KC_REALM}/roles/admin`);
      if (roleRes.ok) {
        const role = await roleRes.json();
        await kcFetch(token, `/${KC_REALM}/users/${userId}/role-mappings/realm`, "POST", [role]);
        log(`Admin user "${ADMIN_EMAIL}" created and assigned admin role`);
      }
    }
  } else {
    log(`Admin user "${ADMIN_EMAIL}" already exists — skipping`);
  }
}

/**
 * Idempotently bootstrap the Keycloak realm, client, roles, and admin user.
 * Gracefully degrades when Keycloak is unavailable.
 */
export async function bootstrapKeycloak(): Promise<void> {
  // Quick connectivity check — skip if Keycloak is not reachable
  try {
    const ping = await fetch(`${KC_URL}/health/ready`, { signal: AbortSignal.timeout(3_000) });
    if (!ping.ok) {
      log(`Keycloak not ready (${ping.status}) — skipping bootstrap`);
      return;
    }
  } catch {
    log("Keycloak unreachable — skipping bootstrap (will retry on next startup)");
    return;
  }

  try {
    log(`Bootstrapping Keycloak at ${KC_URL}…`);
    const token = await getAdminToken();
    await ensureRealm(token);
    await ensureRoles(token);
    await ensureClient(token);
    await ensureAdminUser(token);
    log("Bootstrap complete ✓");
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    log(`Bootstrap error (non-fatal): ${msg}`);
  }
}
