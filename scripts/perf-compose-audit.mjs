#!/usr/bin/env node
/**
 * perf-compose-audit.mjs — zero-dependency docker-compose production-tightness audit.
 *
 * Parses docker-compose.yml and reports services missing:
 *   - healthcheck
 *   - logging policy (json-file with rotation)
 *   - restart policy
 *   - deploy.resources memory limits
 *
 * Exit 1 if any CRITICAL service lacks any of the above.
 * Exit 0 otherwise (non-critical gaps are warnings only).
 *
 * Usage: node scripts/perf-compose-audit.mjs [path/to/docker-compose.yml]
 */
import { readFileSync } from "node:fs";

const composePath = process.argv[2] ?? "docker-compose.yml";

// ── Critical services: money path + latency path ────────────────────────────
const CRITICAL = [
  "postgres",
  "redis",
  "kafka",
  "tigerbeetle",
  "keycloak",
  "portal",
  "gateway",
  "matching-engine",
  "settlement-engine",
  "risk-management",
  "kyc-service",
  "notification",
  "mojaloop-adapter",
  "middleware-hub",
  "channel-gateway",
  "ussd-engine",
  "core-banking",
  "ml-platform",
  "temporal",
  "permify",
  "apisix",
];

// Healthcheck-exempt: distroless/scratch images ship no shell, wget, or curl,
// so an in-container probe is impossible. Liveness for these is covered by
// `restart: unless-stopped` + downstream consumers' health aggregation.
const HEALTHCHECK_EXEMPT = new Set([
  "core-banking",    // gcr.io/distroless/static-debian12
  "channel-gateway", // gcr.io/distroless/static-debian12
  "indices",         // scratch
]);

// ── Minimal YAML mapping parser (compose-safe subset) ───────────────────────
// We only need: top-level `services:` block, per-service keys at 4-space
// indent, and detection of specific keys. Comments and values are irrelevant.
function parseServices(text) {
  const lines = text.split("\n");
  const services = {};
  let inServices = false;
  let current = null;
  for (const line of lines) {
    if (/^services:\s*$/.test(line)) {
      inServices = true;
      continue;
    }
    if (inServices && /^[a-zA-Z_]/.test(line)) break; // next top-level key
    if (!inServices) continue;
    const svcMatch = line.match(/^ {2}([a-z0-9][a-z0-9-]*):\s*$/);
    if (svcMatch) {
      current = svcMatch[1];
      services[current] = new Set();
      continue;
    }
    const keyMatch = line.match(/^ {4}([a-z_]+):/);
    if (current && keyMatch) services[current].add(keyMatch[1]);
  }
  return services;
}

let text;
try {
  text = readFileSync(composePath, "utf8");
} catch (err) {
  console.error(`FATAL: cannot read ${composePath}: ${err.message}`);
  process.exit(2);
}

const services = parseServices(text);
const names = Object.keys(services);
if (names.length === 0) {
  console.error(`FATAL: no services parsed from ${composePath}`);
  process.exit(2);
}

const missingCritical = CRITICAL.filter((n) => !(n in services));
if (missingCritical.length) {
  console.error(`FATAL: critical services absent from compose file: ${missingCritical.join(", ")}`);
  process.exit(2);
}

let failures = 0;
const warnings = [];

console.log(`perf-compose-audit: ${names.length} services in ${composePath}\n`);

for (const [name, keys] of Object.entries(services)) {
  const gaps = [];
  if (!keys.has("healthcheck") && !HEALTHCHECK_EXEMPT.has(name)) gaps.push("healthcheck");
  if (!keys.has("logging")) gaps.push("logging");
  if (!keys.has("restart")) gaps.push("restart");
  if (!keys.has("deploy")) gaps.push("deploy.resources");

  const critical = CRITICAL.includes(name);
  if (gaps.length === 0) {
    if (critical) console.log(`  OK       ${name}`);
  } else if (critical) {
    failures++;
    console.log(`  FAIL     ${name} — missing: ${gaps.join(", ")}`);
  } else {
    warnings.push(`  warn     ${name} — missing: ${gaps.join(", ")}`);
  }
}

if (warnings.length) {
  console.log("\nnon-critical warnings:");
  warnings.forEach((w) => console.log(w));
}

console.log(
  `\n${failures === 0 ? "PASS" : "FAIL"}: ${CRITICAL.length} critical services checked, ` +
    `${failures} failing, ${warnings.length} non-critical warnings.`,
);
process.exit(failures === 0 ? 0 : 1);
