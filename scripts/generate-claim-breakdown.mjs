#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const index = args.indexOf(name);
  return index === -1 ? fallback : args[index + 1] ?? fallback;
};
const root = path.resolve(arg("--root", process.cwd()));
const source = path.resolve(root, arg("--source", "todo.md"));
const outDir = path.resolve(root, arg("--out", "assurance/claims"));
const revision = process.env.GITHUB_SHA || "HEAD";

const classificationRules = [
  { key: "funds-and-ledger", match: /\b(ledger|fund|funds|payment|transfer|settlement|deposit|withdrawal|bank|loan|repay|margin|collateral|credit|wallet|invoice|fee)\b/i, severity: "critical", components: ["authoritative ledger or durable transaction store", "idempotency/reconciliation component", "authorization policy", "audit trail", "real-dependency integration test", "concurrency and crash-recovery test"] },
  { key: "identity-and-authorization", match: /\b(auth|authori[sz]|permission|role|rbac|pbac|keycloak|permify|mfa|totp|passkey|session|jwt|token|kyc)\b/i, severity: "critical", components: ["identity provider", "server-side authorization middleware", "policy store", "audit event", "negative and cross-tenant test"] },
  { key: "security-and-privacy", match: /\b(security|vulnerab|privacy|gdpr|ndpr|pci|secret|encrypt|waf|zero.trust|network.policy|penetration|sanction|aml|sar|pep)\b/i, severity: "critical", components: ["threat model", "security control implementation", "secret/configuration management", "adversarial test", "compliance evidence"] },
  { key: "workflow-and-resilience", match: /\b(workflow|saga|temporal|retry|dead.letter|dlq|requeue|chaos|failover|recovery|rollback|outage|partition|idempoten)\b/i, severity: "high", components: ["durable workflow/state machine", "retry and compensation handler", "outbox/inbox or reconciliation process", "fault-injection test", "operational alert/runbook"] },
  { key: "api-and-integration", match: /\b(api|router|trpc|gateway|apisix|webhook|consumer|kafka|fluvio|dapr|integration|endpoint|grpc|service)\b/i, severity: "high", components: ["registered endpoint/consumer", "request/event contract", "authorization and input validation", "real dependency integration test", "observability"] },
  { key: "data-and-schema", match: /\b(database|postgres|schema|migration|table|seed|backfill|replica|cache|redis|opensearch|lakehouse)\b/i, severity: "high", components: ["schema and migration", "constraint/index validation", "data lifecycle/retention control", "backup/restore test", "production-shaped seed data"] },
  { key: "client-experience", match: /\b(ui|page|screen|dashboard|mobile|flutter|react.native|pwa|form|route|navigation|us(sd|er))\b/i, severity: "medium", components: ["registered client route", "live API/client wiring", "loading/error/authorization state", "browser/device E2E test", "accessibility and observability"] },
  { key: "deployment-and-operations", match: /\b(docker|kubernetes|helm|deploy|ci|cd|github.action|monitor|prometheus|grafana|alert|health|sidecar|metrics|performance|load|scale)\b/i, severity: "high", components: ["deployment manifest", "least-privilege runtime configuration", "health/telemetry", "staging/canary test", "rollback and incident runbook"] },
];

function csvCell(value) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function classify(claim) {
  const matched = classificationRules.filter((rule) => rule.match.test(claim));
  const groups = matched.length ? matched : [{ key: "general-platform", severity: "medium", components: ["authoritative requirement", "implementation trace", "unit/contract/integration/E2E test", "security review", "operational runbook"] }];
  const rank = { critical: 0, high: 1, medium: 2, low: 3 };
  const severity = groups.map((group) => group.severity).sort((a, b) => rank[a] - rank[b])[0];
  const components = [...new Set(groups.flatMap((group) => group.components))];
  return { categories: groups.map((group) => group.key), severity, components };
}

function buildRemediation(record) {
  return [
    `Define acceptance criteria and authoritative owner for ${record.id}.`,
    `Trace the stated capability through ${record.components.join(", ")}.`,
    "Implement or correct every missing link; do not suppress the claim or downgrade a test.",
    "Add a regression test that fails against the prior gap and execute real dependency/E2E evidence where applicable.",
    "Record the exact revision, evidence artifact, residual risk, and qualified approver in the feature-claim manifest.",
  ].join(" ");
}

if (!fs.existsSync(source)) throw new Error(`Claim source not found: ${source}`);
const lines = fs.readFileSync(source, "utf8").split("\n");
let headings = [];
const records = [];
for (let index = 0; index < lines.length; index += 1) {
  const line = lines[index];
  const heading = line.match(/^(#{1,6})\s+(.+?)\s*$/);
  if (heading) {
    const depth = heading[1].length;
    headings = headings.filter((item) => item.depth < depth);
    headings.push({ depth, title: heading[2] });
    continue;
  }
  const checked = line.match(/^\s*[-*]\s*\[[xX]\]\s+(.+?)\s*$/);
  if (!checked) continue;
  const classification = classify(checked[1]);
  const record = {
    id: `CLAIM-${String(records.length + 1).padStart(4, "0")}`,
    source: { file: path.relative(root, source).split(path.sep).join("/"), line: index + 1 },
    section: headings.map((item) => item.title).join(" > ") || "Unsectioned",
    claim: checked[1],
    status: "blocked",
    severity: classification.severity,
    categories: classification.categories,
    components: classification.components,
    evidenceRequired: ["authoritative requirement", "implementation trace", "unit or component test", "real-dependency integration test", "public-interface E2E test", "security and audit evidence", "revision-pinned execution log"],
  };
  record.remediation = buildRemediation(record);
  records.push(record);
}

const byCategory = Object.fromEntries(classificationRules.map((rule) => [rule.key, 0]));
const bySeverity = { critical: 0, high: 0, medium: 0, low: 0 };
const bySection = new Map();
for (const record of records) {
  bySeverity[record.severity] += 1;
  for (const category of record.categories) byCategory[category] = (byCategory[category] ?? 0) + 1;
  bySection.set(record.section, (bySection.get(record.section) ?? 0) + 1);
}

fs.mkdirSync(outDir, { recursive: true });
const jsonPath = path.join(outDir, "unverified-completion-claims.json");
const csvPath = path.join(outDir, "unverified-completion-claims.csv");
const markdownPath = path.join(outDir, "unverified-completion-claims-summary.md");
const generatedAt = new Date().toISOString();
fs.writeFileSync(jsonPath, `${JSON.stringify({ schemaVersion: 1, generatedAt, revision, source: path.relative(root, source), summary: { total: records.length, bySeverity, byCategory, bySection: Object.fromEntries(bySection) }, claims: records }, null, 2)}\n`);
const csvRows = [["id", "source_file", "source_line", "section", "claim", "status", "severity", "categories", "equivalent_components", "evidence_required", "remediation"]];
for (const record of records) csvRows.push([record.id, record.source.file, record.source.line, record.section, record.claim, record.status, record.severity, record.categories.join(" | "), record.components.join(" | "), record.evidenceRequired.join(" | "), record.remediation]);
fs.writeFileSync(csvPath, `${csvRows.map((row) => row.map(csvCell).join(",")).join("\n")}\n`);

const table = (entries, first, second) => ["| " + first + " | " + second + " |", "|---|---:|", ...entries.map(([key, value]) => `| ${key} | ${value} |`)].join("\n");
const summary = [
  "# Unverified Completion Claims — Detailed Remediation Breakdown",
  "",
  `Generated at **${generatedAt}** for revision **${revision}** from ${path.relative(root, source)}. Every checked item is treated as a **BLOCKED** assertion until its implementation and all required evidence are recorded and re-executed.`,
  "",
  "## Overall inventory",
  "",
  `The inventory contains **${records.length}** unverified completion claims. The CSV and JSON companion files contain one fully traceable remediation record per claim, including source line, heading/phase, risk tier, equivalent components to discover in any codebase, required evidence, and an explicit remediation sequence.`,
  "",
  table(Object.entries(bySeverity), "Risk tier", "Claims"),
  "",
  "## Functional risk categories",
  "",
  table(Object.entries(byCategory).filter(([, value]) => value > 0).sort((a, b) => b[1] - a[1]), "Equivalent component category", "Claims tagged"),
  "",
  "## Source phases and workstreams",
  "",
  table([...bySection.entries()].sort((a, b) => b[1] - a[1]), "TODO section", "Claims"),
  "",
  "## Remediation protocol applied to every claim",
  "",
  "For each individual CSV/JSON record, the plan requires: define acceptance criteria and ownership; discover and trace equivalent entry points, authorization, business logic, persistence, events, audit, client wiring, recovery, and operations components; implement the missing behavior; add a regression test; validate through real dependencies and public-interface E2E testing; and record revision-pinned evidence. A claim cannot be marked verified by documentation, test names, mocked responses, code appearance, or a green partial suite.",
  "",
  "## Prioritization rule",
  "",
  "Remediate Critical claims first, especially financial integrity, authorization, privacy, security, and compliance flows. Next address High claims that affect workflows, integrations, data stores, or deployment operations. Then resolve Medium client-experience and general platform claims. Where a single shared component supports many claims, repair and verify the shared component first, then execute each claim’s individual evidence path; shared implementation does not automatically verify every consumer journey.",
  "",
  "## Detailed claim records",
  "",
  "Use `unverified-completion-claims.csv` for spreadsheet filtering and `unverified-completion-claims.json` for programmatic remediation tracking. They enumerate every claim individually rather than hiding the 1,218 assertions behind an aggregate score.",
].join("\n");
fs.writeFileSync(markdownPath, `${summary}\n`);
console.log(`Generated ${records.length} claim records.`);
console.log(`JSON: ${path.relative(root, jsonPath)}`);
console.log(`CSV: ${path.relative(root, csvPath)}`);
console.log(`Summary: ${path.relative(root, markdownPath)}`);
