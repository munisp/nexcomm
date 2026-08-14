#!/usr/bin/env node
/**
 * rbac-seed.mjs — Local RBAC relationship seeder for Permify
 *
 * Mirrors the relationship-seeding step from .github/workflows/rbac-check.yml
 * so developers can bootstrap a local Permify instance without reading CI YAML.
 *
 * Usage:
 *   pnpm rbac:seed                     # seed all relationships
 *   pnpm rbac:seed --dry-run           # print what would be seeded, no HTTP calls
 *
 * After seeding, run permission checks:
 *   pnpm permify:check exchange admin user:1 exchange:nexcom
 *   pnpm permify:check exchange admin user:2 exchange:nexcom   # should exit 1 (denied)
 *
 * Prerequisites:
 *   - Permify running on localhost:3476 (start with: pnpm services:start)
 *   - PERMIFY_TENANT_ID env var (defaults to "nexcom")
 *   - PERMIFY_API_KEY env var (optional, for authenticated Permify instances)
 */

import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Config ────────────────────────────────────────────────────────────────────
const HOST      = process.env.PERMIFY_HOST      ?? "http://localhost:3476";
const TENANT_ID = process.env.PERMIFY_TENANT_ID ?? "nexcom";
const API_KEY   = process.env.PERMIFY_API_KEY   ?? "";
const DRY_RUN   = process.argv.includes("--dry-run");

function authHeaders() {
  const h = { "Content-Type": "application/json" };
  if (API_KEY) h["Authorization"] = `Bearer ${API_KEY}`;
  return h;
}

// ── Relationship tuples (mirrors CI YAML seed step) ──────────────────────────
/**
 * Each tuple: [entityType, entityId, relation, subjectType, subjectId]
 *
 * Roles seeded:
 *   user:1  → admin of exchange:nexcom
 *   user:2  → member of exchange:nexcom
 *   user:3  → kyc_officer of exchange:nexcom
 *   user:4  → compliance_officer of exchange:nexcom
 *   user:5  → settlement_officer of exchange:nexcom
 *
 * Resource ownership:
 *   order:1           owned by user:2
 *   kyc_application:1 owned by user:2
 *   aml_flag:1        owned by user:2
 *   settlement:1      belongs to exchange:nexcom
 */
const RELATIONSHIPS = [
  // Exchange-level roles
  ["exchange", "nexcom", "admin",               "user", "1"],
  ["exchange", "nexcom", "member",              "user", "2"],
  ["exchange", "nexcom", "kyc_officer",         "user", "3"],
  ["exchange", "nexcom", "compliance_officer",  "user", "4"],
  ["exchange", "nexcom", "settlement_officer",  "user", "5"],
  // Resource ownership
  ["order",           "1", "owner",    "user",     "2"],
  ["kyc_application", "1", "owner",    "user",     "2"],
  ["aml_flag",        "1", "owner",    "user",     "2"],
  ["settlement",      "1", "exchange", "exchange", "nexcom"],
];

// ── Seed a single relationship tuple ─────────────────────────────────────────
async function seedRelationship(entityType, entityId, relation, subjectType, subjectId) {
  const label = `${entityType}:${entityId}#${relation}@${subjectType}:${subjectId}`;

  if (DRY_RUN) {
    console.log(`  [dry-run] would seed: ${label}`);
    return;
  }

  const url = `${HOST}/v1/tenants/${TENANT_ID}/relationships/write`;
  const body = JSON.stringify({
    metadata: { snap_token: "", schema_version: "" },
    tuples: [{
      entity:   { type: entityType, id: entityId },
      relation,
      subject:  { type: subjectType, id: subjectId, relation: "" },
    }],
  });

  const res = await fetch(url, { method: "POST", headers: authHeaders(), body });
  if (!res.ok) {
    const text = await res.text();
    // 409 / already-exists is fine — idempotent seeding
    if (res.status === 409 || text.includes("already exists")) {
      console.log(`  ↩  already exists: ${label}`);
      return;
    }
    throw new Error(`HTTP ${res.status} seeding ${label}: ${text}`);
  }
  console.log(`  ✅ seeded: ${label}`);
}

// ── Health check ──────────────────────────────────────────────────────────────
async function checkPermifyHealth() {
  try {
    const res = await fetch(`${HOST}/healthz`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return true;
  } catch (err) {
    return false;
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  const authenticationConfigured = Boolean(API_KEY);
  console.log("╔══════════════════════════════════════════════════════╗");
  console.log("║          NEXCOM RBAC Relationship Seeder             ║");
  console.log("╚══════════════════════════════════════════════════════╝");
  console.log(`  Host      : ${HOST}`);
  console.log(`  Tenant    : ${TENANT_ID}`);
  console.log(`  Authentication configured: ${authenticationConfigured ? "yes" : "no"}`);
  console.log(`  Mode      : ${DRY_RUN ? "DRY RUN (no HTTP calls)" : "LIVE"}`);
  console.log("");

  if (!DRY_RUN) {
    console.log("Checking Permify health…");
    const healthy = await checkPermifyHealth();
    if (!healthy) {
      console.error(
        "❌  Permify is not reachable at " + HOST + "\n" +
        "    Start it with:  pnpm services:start\n" +
        "    Or set PERMIFY_HOST to the correct address."
      );
      process.exit(1);
    }
    console.log("✅  Permify is healthy\n");
  }

  console.log(`Seeding ${RELATIONSHIPS.length} relationship tuples…`);
  let failed = 0;
  for (const [et, eid, rel, st, sid] of RELATIONSHIPS) {
    try {
      await seedRelationship(et, eid, rel, st, sid);
    } catch (err) {
      console.error(`  ❌ FAILED: ${err.message}`);
      failed++;
    }
  }

  console.log("");
  if (failed > 0) {
    console.error(`❌  ${failed} relationship(s) failed to seed. Check errors above.`);
    process.exit(1);
  }

  console.log("✅  All relationships seeded successfully.");
  console.log("");
  console.log("Quick permission checks you can run now:");
  console.log("  pnpm permify:check exchange admin user:1 exchange:nexcom   # → ALLOWED");
  console.log("  pnpm permify:check exchange admin user:2 exchange:nexcom   # → DENIED");
  console.log("  pnpm permify:check kyc_application approve user:3 kyc_application:1  # → ALLOWED");
  console.log("  pnpm permify:check settlement approve user:5 settlement:1  # → ALLOWED");
}

main().catch((err) => {
  console.error("[rbac-seed] Fatal error:", err);
  process.exit(1);
});
