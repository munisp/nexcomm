/**
 * NEXCOM Exchange — Permify RBAC Schema Bootstrap
 *
 * Writes the NEXCOM RBAC schema to Permify on first boot and seeds the
 * initial admin relationships. Runs once at startup; idempotent (safe to
 * re-run — Permify upserts the schema version).
 *
 * Schema covers:
 *   - exchange               (platform-level resource)
 *   - order                  (trading orders)
 *   - settlement             (settlement records)
 *   - kyc_application        (KYC applications)
 *   - aml_flag               (AML alerts / flags)
 *   - user_account           (user management)
 *   - deposit                (fiat / crypto deposits)
 *   - withdrawal             (fiat / crypto withdrawals)
 *   - warehouse_receipt      (commodity warehouse receipts)
 *   - loan                   (bank financing / agricultural loans)
 *   - margin_call            (margin calls / liquidation events)
 *   - cross_border_transfer  (Mojaloop cross-border transfers)
 */

const PERMIFY_URL = process.env.PERMIFY_URL ?? "http://localhost:3476";
const PERMIFY_TENANT = process.env.PERMIFY_TENANT ?? process.env.PERMIFY_TENANT_ID ?? "t1";
const PERMIFY_TIMEOUT_MS = 5_000;

/**
 * The canonical NEXCOM RBAC schema in Permify DSL.
 *
 * Single source of truth: the repo-root `permify.perm` file, which is also
 * validated by permify validate on CI and deployed to Permify's bundle service.
 * The previously inline "reduced" schema here had drifted from that file
 * (split-brain) — we now load it from disk and refuse to bootstrap a reduced
 * substitute.
 */
import { readFileSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";

function loadPermifySchema(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    resolve(here, "../permify.perm"),       // repo root, relative to this module
    resolve(process.cwd(), "permify.perm"), // repo root, when cwd = repo root
  ];
  for (const candidate of candidates) {
    try {
      const schema = readFileSync(candidate, "utf8").trim();
      if (schema.length > 0) return schema;
    } catch { /* try next candidate */ }
  }
  throw new Error(
    `[Permify Bootstrap] Could not load permify.perm from repo root (tried: ${candidates.join(", ")}). ` +
    "Refusing to bootstrap with a reduced inline schema — fix the file path or restore permify.perm."
  );
}

let _schemaCache: string | null = null;

/**
 * Lazily load the canonical schema. Returns null (with an operator-visible
 * warning) when permify.perm cannot be found, so a missing file degrades
 * authorization to fail-closed instead of crashing the process at import time.
 */
function getPermifySchema(): string | null {
  if (_schemaCache) return _schemaCache;
  try {
    _schemaCache = loadPermifySchema();
    return _schemaCache;
  } catch (err) {
    console.warn((err as Error).message);
    return null;
  }
}

async function writeSchema(): Promise<string | null> {
  const schema = getPermifySchema();
  if (!schema) return null; // warning already logged by getPermifySchema()
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PERMIFY_TIMEOUT_MS);
    const res = await fetch(
      `${PERMIFY_URL}/v1/tenants/${PERMIFY_TENANT}/schemas/write`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ schema }),
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
 * - Records an operator-visible warning if Permify is unreachable. Protected
 *   runtime operations remain fail-closed until authorization is restored.
 */
export async function bootstrapPermify(): Promise<void> {
  console.log("[Permify Bootstrap] Writing NEXCOM RBAC schema...");

  const schemaVersion = await writeSchema();
  if (!schemaVersion) {
    console.warn(
      "[Permify Bootstrap] Could not write schema — Permify may be offline. " +
      "Protected operations will deny access until authorization is restored."
    );
    return;
  }

  console.log(`[Permify Bootstrap] Schema written (version: ${schemaVersion})`);

  // Seed the platform owner as exchange admin
  const ownerOpenId = process.env.OWNER_OPEN_ID ?? process.env.OWNER_EMAIL;
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
