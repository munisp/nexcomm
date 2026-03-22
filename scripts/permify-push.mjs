#!/usr/bin/env node
/**
 * scripts/permify-push.mjs
 * Manages the NEXCOM Permify RBAC schema.
 *
 * Subcommands:
 *   push   — Write permify.perm to the Permify server (default)
 *   check  — Test a resource/action/subject triple against the Permify server
 *
 * Usage:
 *   pnpm permify:push
 *   pnpm permify:check exchange admin user:42
 *   pnpm permify:check order view user:7 order:99
 *
 *   # With explicit env:
 *   PERMIFY_HOST=http://localhost:3476 PERMIFY_TENANT_ID=nexcom node scripts/permify-push.mjs push
 *   PERMIFY_HOST=http://localhost:3476 node scripts/permify-push.mjs check kyc_application approve user:5 kyc_application:12
 *
 * Environment variables:
 *   PERMIFY_HOST       — Permify gRPC-gateway base URL  (default: http://localhost:3476)
 *   PERMIFY_TENANT_ID  — Tenant ID                       (default: t1)
 *   PERMIFY_API_KEY    — Bearer token if auth is enabled  (optional)
 *
 * check syntax:
 *   pnpm permify:check <resource_type> <permission> <subject_type>:<subject_id> [<resource_type>:<resource_id>]
 *
 *   Examples:
 *     pnpm permify:check exchange admin user:42
 *     pnpm permify:check order view user:7 order:99
 *     pnpm permify:check kyc_application approve user:5 kyc_application:12
 */

import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCHEMA_PATH = resolve(__dirname, "../permify.perm");

const HOST      = process.env.PERMIFY_HOST      ?? "http://localhost:3476";
const TENANT_ID = process.env.PERMIFY_TENANT_ID ?? "t1";
const API_KEY   = process.env.PERMIFY_API_KEY   ?? "";

function authHeaders() {
  const h = { "Content-Type": "application/json" };
  if (API_KEY) h["Authorization"] = `Bearer ${API_KEY}`;
  return h;
}

// ── push ──────────────────────────────────────────────────────────────────────
async function cmdPush() {
  console.log(`[permify:push] Reading schema from ${SCHEMA_PATH}`);
  const schema = readFileSync(SCHEMA_PATH, "utf8");

  const url = `${HOST}/v1/tenants/${TENANT_ID}/schemas/write`;
  console.log(`[permify:push] POST ${url}`);

  const res = await fetch(url, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ schema }),
  });

  const body = await res.text();

  if (!res.ok) {
    console.error(`[permify:push] ❌ HTTP ${res.status}: ${body}`);
    process.exit(1);
  }

  let parsed;
  try { parsed = JSON.parse(body); } catch { parsed = body; }

  console.log(`[permify:push] ✅ Schema written successfully`);
  console.log(`[permify:push] Schema version : ${parsed?.schema_version ?? "(unknown)"}`);
  console.log(`[permify:push] Tenant         : ${TENANT_ID}`);
}

// ── check ─────────────────────────────────────────────────────────────────────
/**
 * Calls the Permify permission check endpoint.
 *
 * Permify v0.x REST body:
 * {
 *   "metadata": { "snap_token": "", "schema_version": "", "depth": 20 },
 *   "entity":   { "type": "<resource_type>", "id": "<resource_id>" },
 *   "permission": "<permission>",
 *   "subject":  { "type": "<subject_type>", "id": "<subject_id>", "relation": "" }
 * }
 */
async function cmdCheck(args) {
  // Parse positional args:
  //   <resource_type> <permission> <subject_type>:<subject_id> [<resource_type>:<resource_id>]
  if (args.length < 3) {
    console.error(
      "Usage: pnpm permify:check <resource_type> <permission> <subject_type>:<subject_id> [<resource_type>:<resource_id>]\n" +
      "Examples:\n" +
      "  pnpm permify:check exchange admin user:42\n" +
      "  pnpm permify:check order view user:7 order:99\n" +
      "  pnpm permify:check kyc_application approve user:5 kyc_application:12"
    );
    process.exit(1);
  }

  const resourceType = args[0];
  const permission   = args[1];
  const subjectRaw   = args[2];
  const entityRaw    = args[3] ?? null; // optional explicit resource:id

  // Parse subject — format: type:id
  const subjectParts = subjectRaw.split(":");
  if (subjectParts.length < 2) {
    console.error(`[permify:check] ❌ Invalid subject format "${subjectRaw}". Expected "type:id" (e.g. user:42)`);
    process.exit(1);
  }
  const subjectType = subjectParts[0];
  const subjectId   = subjectParts.slice(1).join(":"); // handle UUIDs with colons

  // Parse entity — if provided use it, otherwise use resourceType with id "1" as a wildcard probe
  let entityType = resourceType;
  let entityId   = "1";
  if (entityRaw) {
    const entityParts = entityRaw.split(":");
    if (entityParts.length < 2) {
      console.error(`[permify:check] ❌ Invalid entity format "${entityRaw}". Expected "type:id" (e.g. order:99)`);
      process.exit(1);
    }
    entityType = entityParts[0];
    entityId   = entityParts.slice(1).join(":");
  }

  const url = `${HOST}/v1/tenants/${TENANT_ID}/permissions/check`;

  const payload = {
    metadata: { snap_token: "", schema_version: "", depth: 20 },
    entity:   { type: entityType, id: entityId },
    permission,
    subject:  { type: subjectType, id: subjectId, relation: "" },
  };

  console.log(`[permify:check] POST ${url}`);
  console.log(`[permify:check] Entity    : ${entityType}:${entityId}`);
  console.log(`[permify:check] Permission: ${permission}`);
  console.log(`[permify:check] Subject   : ${subjectType}:${subjectId}`);

  const res = await fetch(url, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(payload),
  });

  const body = await res.text();

  if (!res.ok) {
    console.error(`[permify:check] ❌ HTTP ${res.status}: ${body}`);
    process.exit(1);
  }

  let parsed;
  try { parsed = JSON.parse(body); } catch { parsed = { raw: body }; }

  // Permify returns { "can": "CHECK_RESULT_ALLOWED" | "CHECK_RESULT_DENIED", ... }
  const result = parsed?.can ?? parsed?.result ?? "(unknown)";
  const allowed = result === "CHECK_RESULT_ALLOWED" || result === true || result === "ALLOWED";

  if (allowed) {
    console.log(`[permify:check] ✅ ALLOWED — ${subjectType}:${subjectId} CAN ${permission} on ${entityType}:${entityId}`);
  } else {
    console.log(`[permify:check] ⛔ DENIED  — ${subjectType}:${subjectId} CANNOT ${permission} on ${entityType}:${entityId}`);
    console.log(`[permify:check] Result: ${result}`);
    // Exit 1 so CI pipelines can detect denied checks
    process.exit(1);
  }
}

// ── entrypoint ────────────────────────────────────────────────────────────────
async function main() {
  // argv[2] is the subcommand; remaining args are passed to the handler
  const [,, subcommand, ...rest] = process.argv;

  switch (subcommand) {
    case "push":
    case undefined:
      await cmdPush();
      break;
    case "check":
      await cmdCheck(rest);
      break;
    default:
      console.error(`[permify] Unknown subcommand "${subcommand}". Available: push, check`);
      process.exit(1);
  }
}

main().catch((err) => {
  console.error("[permify] Fatal error:", err);
  process.exit(1);
});
