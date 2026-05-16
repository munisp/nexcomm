/**
 * NEXCOM Exchange — Permify RBAC Schema Bootstrap
 *
 * Writes the NEXCOM RBAC schema to Permify on first boot and seeds the
 * initial admin relationships. Runs once at startup; idempotent (safe to
 * re-run — Permify upserts the schema version).
 *
 * Schema covers:
 *   - exchange          (platform-level resource)
 *   - order             (trading orders)
 *   - settlement        (settlement records)
 *   - kyc_application   (KYC applications)
 *   - aml_flag          (AML alerts / flags)
 *   - user_account      (user management)
 */

const PERMIFY_URL = process.env.PERMIFY_URL ?? "http://localhost:3476";
const PERMIFY_TENANT = process.env.PERMIFY_TENANT ?? "nexcom";
const PERMIFY_TIMEOUT_MS = 5_000;

/** The canonical NEXCOM RBAC schema in Permify DSL */
const NEXCOM_SCHEMA = `
entity user {}

entity exchange {
  relation admin @user
  relation operator @user
  relation compliance @user

  permission admin   = admin
  permission manage  = admin or operator
  permission view    = admin or operator or compliance
  permission export  = admin or compliance
}

entity order {
  relation owner @user
  relation broker @user
  relation exchange_admin @exchange#admin

  permission view    = owner or broker or exchange_admin
  permission create  = owner or broker
  permission edit    = owner or broker
  permission delete  = owner or exchange_admin
  permission approve = exchange_admin
}

entity settlement {
  relation initiator @user
  relation approver @user
  relation exchange_admin @exchange#admin

  permission view    = initiator or approver or exchange_admin
  permission approve = approver or exchange_admin
  permission reject  = approver or exchange_admin
  permission export  = exchange_admin
}

entity kyc_application {
  relation applicant @user
  relation reviewer @user
  relation exchange_admin @exchange#admin

  permission view    = applicant or reviewer or exchange_admin
  permission approve = reviewer or exchange_admin
  permission reject  = reviewer or exchange_admin
  permission manage  = exchange_admin
}

entity aml_flag {
  relation reporter @user
  relation compliance_officer @user
  relation exchange_admin @exchange#admin

  permission view      = reporter or compliance_officer or exchange_admin
  permission escalate  = compliance_officer or exchange_admin
  permission resolve   = compliance_officer or exchange_admin
  permission export    = exchange_admin
}

entity user_account {
  relation owner @user
  relation admin @exchange#admin

  permission view   = owner or admin
  permission edit   = owner or admin
  permission manage = admin
  permission delete = admin
}
`.trim();

async function writeSchema(): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PERMIFY_TIMEOUT_MS);
    const res = await fetch(
      `${PERMIFY_URL}/v1/tenants/${PERMIFY_TENANT}/schemas/write`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ schema: NEXCOM_SCHEMA }),
        signal: controller.signal,
      }
    );
    clearTimeout(timer);
    if (!res.ok) {
      const body = await res.text().catch(() => "(no body)");
      console.warn(`[Permify Bootstrap] Schema write failed HTTP ${res.status}: ${body}`);
      return null;
    }
    const data = (await res.json()) as { schema_version?: string };
    return data.schema_version ?? "unknown";
  } catch (err) {
    console.warn(`[Permify Bootstrap] Schema write error: ${(err as Error).message}`);
    return null;
  }
}

async function writeRelationship(
  entityType: string,
  entityId: string,
  relation: string,
  subjectType: string,
  subjectId: string,
  schemaVersion: string
): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PERMIFY_TIMEOUT_MS);
    const res = await fetch(
      `${PERMIFY_URL}/v1/tenants/${PERMIFY_TENANT}/relationships/write`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          metadata: { schema_version: schemaVersion },
          tuples: [
            {
              entity: { type: entityType, id: entityId },
              relation,
              subject: { type: subjectType, id: subjectId },
            },
          ],
        }),
        signal: controller.signal,
      }
    );
    clearTimeout(timer);
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Bootstrap the Permify RBAC schema and seed initial relationships.
 *
 * - Writes the NEXCOM schema (idempotent — Permify versions schemas)
 * - Seeds the OWNER_OPEN_ID user as exchange#admin (if env var is set)
 * - Gracefully degrades: if Permify is unreachable, logs a warning and
 *   continues startup (PERMIFY_FAIL_OPEN controls runtime behaviour)
 */
export async function bootstrapPermify(): Promise<void> {
  console.log("[Permify Bootstrap] Writing NEXCOM RBAC schema...");

  const schemaVersion = await writeSchema();
  if (!schemaVersion) {
    console.warn(
      "[Permify Bootstrap] Could not write schema — Permify may be offline. " +
      "RBAC will use fail-open/closed policy (PERMIFY_FAIL_OPEN env var)."
    );
    return;
  }

  console.log(`[Permify Bootstrap] Schema written (version: ${schemaVersion})`);

  // Seed the platform owner as exchange admin
  const ownerOpenId = process.env.OWNER_OPEN_ID;
  if (ownerOpenId) {
    const ok = await writeRelationship(
      "exchange", "nexcom",
      "admin",
      "user", ownerOpenId,
      schemaVersion
    );
    if (ok) {
      console.log(`[Permify Bootstrap] Seeded exchange#admin for owner ${ownerOpenId}`);
    } else {
      console.warn(`[Permify Bootstrap] Could not seed exchange#admin for owner ${ownerOpenId}`);
    }
  }

  console.log("[Permify Bootstrap] Done.");
}

/**
 * Health-check gate: returns true if Permify is reachable and the NEXCOM
 * tenant exists. Used by /api/health/deep to surface Permify status.
 */
export async function checkPermifyHealth(): Promise<{
  reachable: boolean;
  tenant: string;
  latencyMs: number;
}> {
  const start = Date.now();
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PERMIFY_TIMEOUT_MS);
    const res = await fetch(
      `${PERMIFY_URL}/v1/tenants/${PERMIFY_TENANT}/schemas/list`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ page_size: 1, continuous_token: "" }),
        signal: controller.signal,
      }
    );
    clearTimeout(timer);
    return { reachable: res.ok, tenant: PERMIFY_TENANT, latencyMs: Date.now() - start };
  } catch {
    return { reachable: false, tenant: PERMIFY_TENANT, latencyMs: Date.now() - start };
  }
}
