#!/usr/bin/env node
/**
 * Deterministic source-contract validation for controls that require live
 * infrastructure to exercise end-to-end. This is not a replacement for staging
 * evidence; it prevents known permissive or fabricated-result implementations
 * from returning to the deployable source tree.
 */
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const checks = [];

function source(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function requirePresent(name, relativePath, pattern) {
  const content = source(relativePath);
  checks.push({
    name,
    file: relativePath,
    pass: pattern.test(content),
    expected: pattern.toString(),
  });
}

function requireAbsent(name, relativePath, pattern) {
  const content = source(relativePath);
  checks.push({
    name,
    file: relativePath,
    pass: !pattern.test(content),
    forbidden: pattern.toString(),
  });
}

requireAbsent("Order-book websocket has no random price generation", "server/ws/orderBookServer.ts", /Math\.random|SEED_PRICES|buildBook\(|tickPrice\(|source:\s*["']simulated/i);
requirePresent("Order-book websocket explicitly reports unavailable authoritative data", "server/ws/orderBookServer.ts", /AUTHORITATIVE_MARKET_DATA_UNAVAILABLE/);
requirePresent("Order-book websocket identifies matching-engine source", "server/ws/orderBookServer.ts", /source:\s*["']matching-engine/);

requireAbsent("Fund-flow contracts do not permit optional idempotency keys", "server/fundFlow.ts", /idempotencyKey\s*\?/);
requireAbsent("Fund-flow has no detached fire-and-forget execution helper", "server/fundFlow.ts", /fireAndForget\s*\(/);
requirePresent("Fund-flow atomically reserves idempotency keys", "server/fundFlow.ts", /cacheSetIfAbsentStrict/);
requirePresent("Fund-flow awaits all critical middleware", "server/fundFlow.ts", /await runCriticalMiddleware\(/);
requirePresent("Cache layer provides atomic strict set-if-absent", "server/cache.ts", /cacheSetIfAbsentStrict/);
requirePresent("Cache layer rejects unavailable strict dependencies", "server/cache.ts", /CacheUnavailableError/);

requireAbsent("Test configuration has no Permify fail-open switch", "vitest.config.ts", /PERMIFY_FAIL_OPEN/);
requireAbsent("Test configuration has no committed VAPID private key", "vitest.config.ts", /VAPID_PRIVATE_KEY:\s*["'][^"']{8,}/);
requireAbsent("Test configuration has no committed Keycloak client secret", "vitest.config.ts", /KEYCLOAK_CLIENT_SECRET:\s*["'][^"']{8,}/);

requireAbsent("Core banking does not default to a mock provider", "services/core-banking/cmd/server/main.go", /getEnv\(["']CBS_PROVIDER["'],\s*["']mock["']\)/);
requireAbsent("Core banking does not instantiate a mock adapter in provider selection", "services/core-banking/cmd/server/main.go", /cbs\s*=\s*&mockAdapter/);
requirePresent("Core banking requires an explicit provider", "services/core-banking/cmd/server/main.go", /CBS_PROVIDER must be one of temenos, finacle, or mambu/);
requirePresent("Core banking requires provider configuration", "services/core-banking/cmd/server/main.go", /requiredEnv\(log,/);

requireAbsent("Warehouse receipt workflow does not use zero valuation fallback", "journey-orchestrator/internal/workflows/journeys_1_5.go", /using zero valuation|non-fatal/);
requirePresent("Warehouse receipt workflow rejects failed authoritative pricing", "journey-orchestrator/internal/workflows/journeys_1_5.go", /authoritative commodity price lookup/);
requirePresent("Warehouse receipt workflow requires ledger account result", "journey-orchestrator/internal/workflows/journeys_1_5.go", /InvalidLedgerAccount/);
requirePresent("Warehouse receipt workflow requires immutable audit acknowledgement", "journey-orchestrator/internal/workflows/journeys_1_5.go", /warehouse receipt lakehouse ingestion/);

requireAbsent("Permify bootstrap does not downgrade schema-write failure", "infra/permify/push-schema.sh", /warning.*schema|non-fatal/i);
requirePresent("Permify bootstrap validates schema-write response", "infra/permify/push-schema.sh", /schema write|schema.*response/i);
requirePresent("Gateway Permify client requires HTTPS", "gateway-service/internal/permify/client.go", /https/);
requirePresent("Gateway Permify client requires a token", "gateway-service/internal/permify/client.go", /PERMIFY_AUTH_TOKEN_FILE|token/i);

const failures = checks.filter((check) => !check.pass);
const report = {
  generatedAt: new Date().toISOString(),
  kind: "deterministic-fail-closed-control-validation",
  pass: failures.length === 0,
  summary: { total: checks.length, passed: checks.length - failures.length, failed: failures.length },
  checks,
};

const output = process.env.FAIL_CLOSED_CONTROL_REPORT ?? "test-results/fail-closed-control-validation.json";
fs.mkdirSync(path.dirname(path.resolve(root, output)), { recursive: true });
fs.writeFileSync(path.resolve(root, output), `${JSON.stringify(report, null, 2)}\n`);
for (const failure of failures) {
  console.error(`FAIL ${failure.name} (${failure.file})`);
}
console.log(`Fail-closed controls: ${report.summary.passed}/${report.summary.total} passed; report: ${output}`);
process.exit(failures.length === 0 ? 0 : 1);
