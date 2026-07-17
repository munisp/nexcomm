#!/usr/bin/env tsx
/**
 * NEXCOM Exchange — Keycloak Realm Bootstrap
 *
 * Idempotently provisions:
 *   - The "nexcom" realm (imported from infra/keycloak/nexcom-realm.json)
 *   - The "nexcom-exchange" OIDC client with correct redirect URIs
 *   - Realm roles: admin, user, broker, field_agent, collateral_manager
 *   - An initial admin user (NEXCOM_ADMIN_EMAIL / NEXCOM_ADMIN_PASSWORD)
 *
 * Usage:
 *   pnpm tsx scripts/keycloak-bootstrap.ts
 *
 * Environment variables (all have defaults for Docker Compose):
 *   KEYCLOAK_URL              http://keycloak:8080
 *   KEYCLOAK_REALM            nexcom
 *   KEYCLOAK_CLIENT_ID        nexcom-exchange
 *   KEYCLOAK_CLIENT_SECRET    nexcom-exchange-secret
 *   KEYCLOAK_ADMIN            admin
 *   KEYCLOAK_ADMIN_PASSWORD   admin
 *   NEXCOM_ADMIN_EMAIL        admin@nexcom.exchange
 *   NEXCOM_ADMIN_PASSWORD     NexcomAdmin2026!
 *   APP_BASE_URL              http://localhost:3000
 */

import { readFileSync } from "fs";
import { join } from "path";

const KC_URL = process.env.KEYCLOAK_URL ?? "http://keycloak:8080";
const KC_REALM = process.env.KEYCLOAK_REALM ?? "nexcom";
const KC_CLIENT_ID = process.env.KEYCLOAK_CLIENT_ID ?? "nexcom-exchange";
const KC_CLIENT_SECRET = process.env.KEYCLOAK_CLIENT_SECRET ?? "nexcom-exchange-secret";
const KC_ADMIN = process.env.KEYCLOAK_ADMIN ?? "admin";
const KC_ADMIN_PASSWORD = process.env.KEYCLOAK_ADMIN_PASSWORD ?? "admin";
const NEXCOM_ADMIN_EMAIL = process.env.NEXCOM_ADMIN_EMAIL ?? "admin@nexcom.exchange";
const NEXCOM_ADMIN_PASSWORD = process.env.NEXCOM_ADMIN_PASSWORD ?? "NexcomAdmin2026!";
const APP_BASE_URL = process.env.APP_BASE_URL ?? "http://localhost:3000";

// ── Helpers ──────────────────────────────────────────────────────────────────

async function getAdminToken(): Promise<string> {
  const resp = await fetch(`${KC_URL}/realms/master/protocol/openid-connect/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "password",
      client_id: "admin-cli",
      username: KC_ADMIN,
      password: KC_ADMIN_PASSWORD,
    }),
  });
  if (!resp.ok) {
    const detail = await resp.text().catch(() => "");
    throw new Error(`Failed to get Keycloak admin token (${resp.status}): ${detail}`);
  }
  const data = await resp.json() as { access_token: string };
  return data.access_token;
}

async function kcFetch(
  token: string,
  path: string,
  options: RequestInit = {}
): Promise<Response> {
  const url = `${KC_URL}/admin/realms${path}`;
  return fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(options.headers ?? {}),
    },
  });
}

function log(msg: string) {
  console.log(`[Keycloak Bootstrap] ${msg}`);
}

// ── Step 1: Ensure realm exists ───────────────────────────────────────────────

async function ensureRealm(token: string): Promise<void> {
  const checkResp = await kcFetch(token, `/${KC_REALM}`);
  if (checkResp.status === 200) {
    log(`Realm "${KC_REALM}" already exists — skipping creation`);
    return;
  }
  log(`Creating realm "${KC_REALM}" from nexcom-realm.json…`);
  const realmJson = JSON.parse(
    readFileSync(join(__dirname, "../infra/keycloak/nexcom-realm.json"), "utf-8")
  );
  const createResp = await fetch(`${KC_URL}/admin/realms`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(realmJson),
  });
  if (!createResp.ok && createResp.status !== 409) {
    const detail = await createResp.text().catch(() => "");
    throw new Error(`Failed to create realm (${createResp.status}): ${detail}`);
  }
  log(`Realm "${KC_REALM}" created`);
}

// ── Step 2: Ensure roles exist ────────────────────────────────────────────────

async function ensureRoles(token: string): Promise<void> {
  const roles = ["admin", "user", "broker", "field_agent", "collateral_manager"];
  const existingResp = await kcFetch(token, `/${KC_REALM}/roles`);
  const existing: Array<{ name: string }> = existingResp.ok ? await existingResp.json() : [];
  const existingNames = new Set(existing.map((r) => r.name));

  for (const role of roles) {
    if (existingNames.has(role)) {
      log(`Role "${role}" already exists`);
      continue;
    }
    const resp = await kcFetch(token, `/${KC_REALM}/roles`, {
      method: "POST",
      body: JSON.stringify({ name: role, description: `NEXCOM ${role} role` }),
    });
    if (resp.ok || resp.status === 409) {
      log(`Role "${role}" created`);
    } else {
      log(`Warning: could not create role "${role}" (${resp.status})`);
    }
  }
}

// ── Step 3: Ensure OIDC client exists and has correct redirect URIs ───────────

async function ensureClient(token: string): Promise<void> {
  const listResp = await kcFetch(token, `/${KC_REALM}/clients?clientId=${KC_CLIENT_ID}`);
  const clients: Array<{ id: string; clientId: string }> = listResp.ok ? await listResp.json() : [];

  const redirectUris = [
    `${APP_BASE_URL}/api/oauth/callback`,
    "http://localhost:3000/api/oauth/callback",
    "http://localhost:4001/api/oauth/callback",
    "https://*.nexcom.exchange/api/oauth/callback",
    "https://nexcom.exchange/api/oauth/callback",
  ];

  const webOrigins = [
    APP_BASE_URL,
    "http://localhost:3000",
    "http://localhost:4001",
    "https://nexcom.exchange",
    "https://*.nexcom.exchange",
  ];

  if (clients.length > 0) {
    const clientUuid = clients[0].id;
    log(`Client "${KC_CLIENT_ID}" already exists — updating redirect URIs…`);
    const updateResp = await kcFetch(token, `/${KC_REALM}/clients/${clientUuid}`, {
      method: "PUT",
      body: JSON.stringify({
        clientId: KC_CLIENT_ID,
        secret: KC_CLIENT_SECRET,
        redirectUris,
        webOrigins,
        standardFlowEnabled: true,
        publicClient: false,
        attributes: { "pkce.code.challenge.method": "S256" },
      }),
    });
    if (updateResp.ok || updateResp.status === 204) {
      log(`Client "${KC_CLIENT_ID}" updated`);
    } else {
      log(`Warning: could not update client (${updateResp.status})`);
    }
    return;
  }

  log(`Creating client "${KC_CLIENT_ID}"…`);
  const createResp = await kcFetch(token, `/${KC_REALM}/clients`, {
    method: "POST",
    body: JSON.stringify({
      clientId: KC_CLIENT_ID,
      name: "NEXCOM Exchange Web App",
      enabled: true,
      clientAuthenticatorType: "client-secret",
      secret: KC_CLIENT_SECRET,
      redirectUris,
      webOrigins,
      standardFlowEnabled: true,
      implicitFlowEnabled: false,
      directAccessGrantsEnabled: false,
      serviceAccountsEnabled: false,
      publicClient: false,
      protocol: "openid-connect",
      attributes: { "pkce.code.challenge.method": "S256" },
      fullScopeAllowed: true,
    }),
  });
  if (createResp.ok || createResp.status === 201 || createResp.status === 409) {
    log(`Client "${KC_CLIENT_ID}" created`);
  } else {
    const detail = await createResp.text().catch(() => "");
    throw new Error(`Failed to create client (${createResp.status}): ${detail}`);
  }
}

// ── Step 4: Ensure initial admin user exists ──────────────────────────────────

async function ensureAdminUser(token: string): Promise<void> {
  const searchResp = await kcFetch(
    token,
    `/${KC_REALM}/users?email=${encodeURIComponent(NEXCOM_ADMIN_EMAIL)}&exact=true`
  );
  const users: Array<{ id: string; email: string }> = searchResp.ok ? await searchResp.json() : [];

  let userId: string;

  if (users.length > 0) {
    userId = users[0].id;
    log(`Admin user "${NEXCOM_ADMIN_EMAIL}" already exists`);
  } else {
    log(`Creating admin user "${NEXCOM_ADMIN_EMAIL}"…`);
    const createResp = await kcFetch(token, `/${KC_REALM}/users`, {
      method: "POST",
      body: JSON.stringify({
        username: NEXCOM_ADMIN_EMAIL,
        email: NEXCOM_ADMIN_EMAIL,
        firstName: "NEXCOM",
        lastName: "Admin",
        enabled: true,
        emailVerified: true,
        credentials: [
          { type: "password", value: NEXCOM_ADMIN_PASSWORD, temporary: false },
        ],
      }),
    });
    if (!createResp.ok && createResp.status !== 201 && createResp.status !== 409) {
      const detail = await createResp.text().catch(() => "");
      log(`Warning: could not create admin user (${createResp.status}): ${detail}`);
      return;
    }
    // Get the newly created user's ID
    const refetchResp = await kcFetch(
      token,
      `/${KC_REALM}/users?email=${encodeURIComponent(NEXCOM_ADMIN_EMAIL)}&exact=true`
    );
    const newUsers: Array<{ id: string }> = refetchResp.ok ? await refetchResp.json() : [];
    if (newUsers.length === 0) {
      log("Warning: could not retrieve newly created admin user ID");
      return;
    }
    userId = newUsers[0].id;
    log(`Admin user created with ID ${userId}`);
  }

  // Assign the "admin" realm role
  const rolesResp = await kcFetch(token, `/${KC_REALM}/roles/admin`);
  if (!rolesResp.ok) {
    log("Warning: could not fetch admin role for assignment");
    return;
  }
  const adminRole = await rolesResp.json() as { id: string; name: string };
  const assignResp = await kcFetch(token, `/${KC_REALM}/users/${userId}/role-mappings/realm`, {
    method: "POST",
    body: JSON.stringify([adminRole]),
  });
  if (assignResp.ok || assignResp.status === 204) {
    log(`Admin role assigned to "${NEXCOM_ADMIN_EMAIL}"`);
  } else {
    log(`Warning: could not assign admin role (${assignResp.status})`);
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  log(`Connecting to Keycloak at ${KC_URL}…`);

  // Wait for Keycloak to be ready (up to 60 seconds)
  let ready = false;
  for (let i = 0; i < 12; i++) {
    try {
      const resp = await fetch(`${KC_URL}/health/ready`, { signal: AbortSignal.timeout(5000) });
      if (resp.ok) { ready = true; break; }
    } catch {
      // not ready yet
    }
    log(`Waiting for Keycloak to be ready… (attempt ${i + 1}/12)`);
    await new Promise((r) => setTimeout(r, 5000));
  }

  if (!ready) {
    // Try the older /auth/health endpoint (Keycloak < 20)
    try {
      const resp = await fetch(`${KC_URL}/auth/health/ready`, { signal: AbortSignal.timeout(5000) });
      ready = resp.ok;
    } catch {
      // ignore
    }
  }

  if (!ready) {
    log("Warning: Keycloak health check timed out — proceeding anyway");
  } else {
    log("Keycloak is ready");
  }

  const token = await getAdminToken();
  log("Admin token obtained");

  await ensureRealm(token);
  await ensureRoles(token);
  await ensureClient(token);
  await ensureAdminUser(token);

  log("Bootstrap complete ✓");
  log(`Login URL: ${KC_URL}/realms/${KC_REALM}/protocol/openid-connect/auth`);
  log(`Admin console: ${KC_URL}/admin/${KC_REALM}/console`);
}

main().catch((err) => {
  console.error("[Keycloak Bootstrap] FATAL:", err.message);
  process.exit(1);
});
