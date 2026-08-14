#!/usr/bin/env node
/**
 * Deterministic release gate for the Mission-Critical Platform Assurance policy.
 * This checker creates evidence and blocks known unsafe/incomplete conditions.
 * It does not replace the real-dependency, E2E, or human compliance assessment
 * required by assurance/mission-critical-code-assurance-prompt-v2.md.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index === -1 ? fallback : args[index + 1] ?? fallback;
};

const root = path.resolve(option("--root", process.cwd()));
const outputPath = path.resolve(root, option("--output", "assurance/reports/assurance-gate-report.json"));
const policyPath = path.resolve(root, option("--policy", "assurance/policy.json"));
const isFixtureRun = args.includes("--fixture");
const sha = process.env.GITHUB_SHA || process.env.CI_COMMIT_SHA || "HEAD";
const defaultIgnoredDirectories = new Set([
  ".git", "node_modules", "dist", "build", "coverage", "playwright-report", "test-results",
  ".next", ".venv", "venv", "vendor", "target", "__pycache__", ".turbo",
]);
const sourceExtensions = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".py", ".go", ".rs", ".java", ".kt", ".sql", ".sh"]);
const textExtensions = new Set([...sourceExtensions, ".md", ".yml", ".yaml", ".json", ".toml", ".env", ".ini"]);

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function ensureParent(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
}

function relative(file) {
  return path.relative(root, file).split(path.sep).join("/");
}

function safeRead(file) {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return "";
  }
}

function isIgnored(relativePath, policy) {
  const normalised = relativePath.replaceAll("\\", "/");
  if (normalised.split("/").some((segment) => defaultIgnoredDirectories.has(segment))) return true;
  return (policy.ignore ?? []).some((prefix) => normalised === prefix || normalised.startsWith(`${prefix}/`));
}

function listFiles(directory, policy, collected = []) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    const rel = relative(full);
    if (isIgnored(rel, policy)) continue;
    if (entry.isDirectory()) listFiles(full, policy, collected);
    else if (entry.isFile() && textExtensions.has(path.extname(entry.name).toLowerCase())) collected.push(full);
  }
  return collected;
}

const report = {
  schemaVersion: 1,
  gate: "mission-critical-assurance",
  evaluatedAt: new Date().toISOString(),
  repositoryRoot: root,
  revision: sha,
  fixtureRun: isFixtureRun,
  decision: "RELEASEABLE",
  summary: { blocker: 0, critical: 0, high: 0, medium: 0, low: 0, total: 0 },
  findings: [],
  checkedTodoClaims: 0,
  verifiedClaims: 0,
  filesScanned: 0,
};

function addFinding({ id, severity, message, file = null, line = null, evidence = null }) {
  const fingerprint = crypto.createHash("sha256").update([id, file, line, message].join("|")).digest("hex").slice(0, 16);
  if (report.findings.some((finding) => finding.fingerprint === fingerprint)) return;
  report.findings.push({ id, severity, message, file, line, evidence, fingerprint });
  report.summary[severity.toLowerCase()] += 1;
  report.summary.total += 1;
  if (["BLOCKER", "CRITICAL", "HIGH"].includes(severity)) report.decision = "BLOCKED";
}

function lineNumber(content, index) {
  return content.slice(0, index).split("\n").length;
}

function scanRegex(file, content, pattern, finding) {
  pattern.lastIndex = 0;
  let match;
  while ((match = pattern.exec(content)) !== null) {
    addFinding({ ...finding, file: relative(file), line: lineNumber(content, match.index), evidence: match[0].slice(0, 240) });
    if (!pattern.global) break;
  }
}

let policy = { ignore: [] };
if (fs.existsSync(policyPath)) {
  try {
    policy = readJson(policyPath);
  } catch (error) {
    addFinding({ id: "ASSURANCE-POLICY-INVALID", severity: "BLOCKER", message: `Cannot parse policy file: ${error.message}`, file: relative(policyPath) });
  }
} else if (!isFixtureRun) {
  addFinding({ id: "ASSURANCE-POLICY-MISSING", severity: "BLOCKER", message: "Missing assurance/policy.json. Release policy cannot be evaluated." });
}

const files = listFiles(root, policy);
report.filesScanned = files.length;
const checkedClaims = [];
const todoFiles = [];

for (const file of files) {
  const rel = relative(file);
  const content = safeRead(file);
  const extension = path.extname(file).toLowerCase();
  const lines = content.split("\n");

  if (/\b(todo|backlog|roadmap)\b/i.test(path.basename(file))) {
    todoFiles.push(rel);
    lines.forEach((line, index) => {
      const match = line.match(/^\s*[-*]\s*\[[xX]\]\s+(.+?)\s*$/);
      if (match) checkedClaims.push({ source: `${rel}:${index + 1}`, claim: match[1] });
    });
  }

  if (!sourceExtensions.has(extension)) continue;
  const testFile = /(^|\/)(test|tests|__tests__|spec)(\/|\.|$)|\.(test|spec)\.[^.]+$/i.test(rel);
  const codeFile = !testFile;
  const financialExecutionBoundary = /^(server\/(fundFlow|gatewayClient|routers|jobs)|services\/(core-banking|trading-engine|middleware-hub|ussd-engine)|matching-engine|settlement-engine|journey-orchestrator|workflows\/temporal)\//.test(rel);

  scanRegex(file, content, /(?:^|\n)\s*(?:\/\/|#|\/\*|\*)\s*(TODO|FIXME|XXX|HACK|WIP)\b[^\n]*/gi, {
    id: "INCOMPLETE-IMPLEMENTATION", severity: codeFile ? "HIGH" : "MEDIUM",
    message: "Unresolved implementation marker found. Critical paths must be complete or safely and explicitly rejected.",
  });
  scanRegex(file, content, /\b(NotImplemented(?:Error)?|panic\s*\(\s*["']TODO|throw\s+new\s+Error\s*\(\s*["']TODO)\b/gim, {
    id: "INCOMPLETE-IMPLEMENTATION", severity: codeFile ? "HIGH" : "MEDIUM",
    message: "Potential stub or unimplemented execution path found.",
  });
  scanRegex(file, content, /\b(PERMIFY_FAIL_OPEN|FAIL_OPEN|DISABLE_AUTH|SKIP_AUTH|INSECURE_SKIP_VERIFY)\b\s*(?:=|:)\s*(?:true|["']true["'])/gi, {
    id: "INSECURE-FAIL-OPEN", severity: "CRITICAL",
    message: "Fail-open or security-bypass configuration is prohibited in release evidence.",
  });
  scanRegex(file, content, /\b[A-Za-z][A-Za-z0-9_-]*(?:api[_-]?key|secret|token|password|private[_-]?key)\b\s*(?::|=)\s*["'][^"'${}\\\n]{8,}["']/gi, {
    id: "HARD-CODED-SECRET", severity: "CRITICAL",
    message: "Potential hard-coded secret found. Use a managed secret reference and ensure it is never logged.",
  });
  scanRegex(file, content, /(?:console\.(?:log|info|debug)|logger\.(?:debug|info|warn|error))\s*\([^\n]*(?:secret|password|authorization|cookie|api[_ -]?key|private[_ -]?key)/gi, {
    id: "SENSITIVE-LOGGING", severity: "CRITICAL",
    message: "Potential secret, password, authorization value, cookie, API key, or private key is written to application logs.",
  });
  if (financialExecutionBoundary) {
    scanRegex(file, content, /\b(amount|balance|fee|principal|interest)\s*(?::|=)\s*(?:number|float(?:32|64)?|f(?:32|64))\b/gi, {
      id: "UNSAFE-MONEY-REPRESENTATION", severity: "HIGH",
      message: "Potential floating-point representation at a financial execution boundary. Use the approved exact amount policy and test rounding/conservation.",
    });
  }
  scanRegex(file, content, /\b(?:idempotencyKey|idempotency_key)\s*\?\s*:/g, {
    id: "OPTIONAL-IDEMPOTENCY-KEY", severity: "HIGH",
    message: "An idempotency key is optional on a source contract. Retryable critical effects require a mandatory, payload-bound durable operation identity.",
  });

  if (testFile && policy.strictNoTestDoubles === true) {
    scanRegex(file, content, /\b(?:vi|jest)\.(?:mock|stub(?:Global|Env)?)\b|\bmock(?:ResolvedValue|ReturnValue|Implementation)\b|\bmonkeypatch\b|\bunittest\.mock\b|\bpytest[-_]?mock\b/gi, {
      id: "MOCKED-RELEASE-EVIDENCE", severity: "HIGH",
      message: "Mock, stub, or monkey-patch detected in a test. It is not acceptable as real integration or end-to-end release evidence.",
    });
  }
}

report.checkedTodoClaims = checkedClaims.length;
const featureManifestPath = path.resolve(root, policy.featureManifest ?? "assurance/feature-claims.json");
let featureManifest = null;
if (!fs.existsSync(featureManifestPath)) {
  addFinding({ id: "FEATURE-CLAIM-MANIFEST-MISSING", severity: "BLOCKER", message: "Missing feature-claim manifest. Claimed capabilities cannot be traced to evidence." });
} else {
  try {
    featureManifest = readJson(featureManifestPath);
    if (!Array.isArray(featureManifest.claims)) throw new Error("expected a claims array");
  } catch (error) {
    addFinding({ id: "FEATURE-CLAIM-MANIFEST-INVALID", severity: "BLOCKER", message: `Feature-claim manifest is invalid: ${error.message}`, file: relative(featureManifestPath) });
  }
}

if (featureManifest) {
  const claimBySource = new Map();
  for (const claim of featureManifest.claims) {
    if (claim?.source?.file && Number.isInteger(claim?.source?.line)) claimBySource.set(`${claim.source.file}:${claim.source.line}`, claim);
  }
  for (const todoClaim of checkedClaims) {
    const claim = claimBySource.get(todoClaim.source);
    if (!claim) {
      addFinding({ id: "UNVERIFIED-COMPLETION-CLAIM", severity: "BLOCKER", message: `Checked TODO claim has no feature-claim record: ${todoClaim.claim}`, file: todoClaim.source.split(":")[0], line: Number(todoClaim.source.split(":").at(-1)) });
      continue;
    }
    const requiredEvidence = ["unit", "integration", "e2e", "faultInjection", "security", "audit"];
    const missing = requiredEvidence.filter((key) => typeof claim.evidence?.[key] !== "string" || claim.evidence[key].trim() === "");
    const verifiedAtCurrentRevision = claim.lastVerifiedCommit === "HEAD" || claim.lastVerifiedCommit === sha;
    if (claim.status !== "verified" || missing.length > 0 || !verifiedAtCurrentRevision || !Array.isArray(claim.implementation) || claim.implementation.length === 0) {
      addFinding({ id: "UNVERIFIED-COMPLETION-CLAIM", severity: "BLOCKER", message: `Checked TODO claim lacks verified, current, complete evidence: ${todoClaim.claim}`, file: todoClaim.source.split(":")[0], line: Number(todoClaim.source.split(":").at(-1)), evidence: JSON.stringify({ status: claim.status, missingEvidence: missing, lastVerifiedCommit: claim.lastVerifiedCommit }) });
    } else {
      report.verifiedClaims += 1;
    }
  }
}

const compliancePath = path.resolve(root, policy.complianceMatrix ?? "assurance/compliance-control-matrix.json");
const requiredProfiles = policy.requiredComplianceProfiles ?? [];
if (requiredProfiles.length > 0) {
  if (!fs.existsSync(compliancePath)) {
    addFinding({ id: "COMPLIANCE-MATRIX-MISSING", severity: "BLOCKER", message: "Required compliance matrix is missing." });
  } else {
    try {
      const matrix = readJson(compliancePath);
      const controls = Array.isArray(matrix.controls) ? matrix.controls : [];
      for (const profile of requiredProfiles) {
        const profileControls = controls.filter((control) => control.profile === profile && control.status === "verified" && control.owner && control.evidence && control.retention);
        if (profileControls.length === 0) addFinding({ id: "COMPLIANCE-PROFILE-UNVERIFIED", severity: "BLOCKER", message: `No verified compliance control evidence found for required profile: ${profile}.`, file: relative(compliancePath) });
      }
    } catch (error) {
      addFinding({ id: "COMPLIANCE-MATRIX-INVALID", severity: "BLOCKER", message: `Compliance matrix is invalid: ${error.message}`, file: relative(compliancePath) });
    }
  }
}

const auditPolicyPath = path.resolve(root, policy.auditPolicy ?? "assurance/audit-trail-policy.json");
if (policy.requireAuditPolicy) {
  if (!fs.existsSync(auditPolicyPath)) {
    addFinding({ id: "AUDIT-TRAIL-POLICY-MISSING", severity: "BLOCKER", message: "Audit-trail policy/evidence file is missing." });
  } else {
    try {
      const auditPolicy = readJson(auditPolicyPath);
      const requiredFields = ["status", "scope", "integrityMechanism", "accessControl", "retention", "restoreTestEvidence", "exportTestEvidence"];
      const missing = requiredFields.filter((field) => typeof auditPolicy[field] !== "string" || auditPolicy[field].trim() === "");
      if (auditPolicy.status !== "verified" || missing.length > 0) {
        addFinding({ id: "AUDIT-TRAIL-UNVERIFIED", severity: "BLOCKER", message: "Audit-trail policy does not contain verified integrity, access, retention, restoration, and export evidence.", file: relative(auditPolicyPath), evidence: JSON.stringify({ status: auditPolicy.status, missing }) });
      }
    } catch (error) {
      addFinding({ id: "AUDIT-TRAIL-POLICY-INVALID", severity: "BLOCKER", message: `Audit-trail policy is invalid: ${error.message}`, file: relative(auditPolicyPath) });
    }
  }
}

report.findings.sort((a, b) => ["BLOCKER", "CRITICAL", "HIGH", "MEDIUM", "LOW"].indexOf(a.severity) - ["BLOCKER", "CRITICAL", "HIGH", "MEDIUM", "LOW"].indexOf(b.severity) || String(a.file).localeCompare(String(b.file)) || (a.line ?? 0) - (b.line ?? 0));
ensureParent(outputPath);
fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(`Assurance gate decision: ${report.decision}`);
console.log(`Scanned ${report.filesScanned} files; checked TODO claims: ${report.checkedTodoClaims}; verified claims: ${report.verifiedClaims}.`);
console.log(`Findings: ${report.summary.total} (blocker=${report.summary.blocker}, critical=${report.summary.critical}, high=${report.summary.high}, medium=${report.summary.medium}, low=${report.summary.low}).`);
console.log(`Report: ${relative(outputPath)}`);
for (const finding of report.findings.slice(0, 50)) console.log(`[${finding.severity}] ${finding.id}${finding.file ? ` ${finding.file}${finding.line ? `:${finding.line}` : ""}` : ""} — ${finding.message}`);
if (report.findings.length > 50) console.log(`Additional findings omitted from console: ${report.findings.length - 50}. See the JSON report.`);
process.exit(report.decision === "RELEASEABLE" ? 0 : 1);
