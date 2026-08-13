#!/usr/bin/env node
/**
 * Create a deterministic local-only digest input for Helm dry-run validation.
 * All references use example.invalid and must never be supplied to deployment CI.
 */
import { writeFileSync } from "node:fs";

const services = [
  "nexcomExchange", "matchingEngine", "tradingEngine", "riskManagement", "kycService",
  "amlAlertSubscriber", "analyticsEngine", "analytics", "aiMl", "blockchain", "botLogic",
  "channelGateway", "coreBanking", "creditScoring", "cryptoGuard", "ddosGuard", "fluvioSidecar",
  "fraudEngine", "indices", "ingestionEngine", "marketData", "middlewareHub", "mojaloopAdapter",
  "notification", "opensearchSync", "pbac", "temporalWorkers", "userManagement", "ussdEngine",
];

const output = process.argv[2] ?? "test-results/local-mock-image-digests.json";
const mock = Object.fromEntries(services.map((service, index) => {
  const digest = (index + 1).toString(16).padStart(2, "0").repeat(32);
  const image = service.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
  return [service, `registry.example.invalid/nexcom/${image}@sha256:${digest}`];
}));
writeFileSync(output, `${JSON.stringify(mock, null, 2)}\n`, { mode: 0o600 });
console.log(`Wrote ${services.length} local-only mock image references to ${output}`);
