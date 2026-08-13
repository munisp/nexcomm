#!/usr/bin/env python3
"""Static audit for production-integrity gaps in the NEXCOM repository.

This scanner deliberately treats generated artifacts, tests, and documentation as
non-production by default. It reports suspicious production code for human review;
it does not silently rewrite source.
"""
from __future__ import annotations

import argparse
import json
import re
from collections import Counter
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Iterable

SOURCE_SUFFIXES = {".ts", ".tsx", ".js", ".mjs", ".go", ".py", ".rs", ".sql", ".yaml", ".yml"}
EXCLUDED_DIRS = {".git", "node_modules", "dist", "build", "coverage", "target", ".next", ".venv", "venv", "test-results", "playwright-report"}
TEST_MARKERS = (".test.", ".spec.", "/tests/", "/test/", "_test.go", "test_")
DOC_MARKERS = ("/docs/", "/references/", "README", "AUDIT", "REPORT", "/monitoring/", "/infra/")

@dataclass(frozen=True)
class Finding:
    severity: str
    category: str
    path: str
    line: int
    excerpt: str
    rationale: str


def is_source(path: Path) -> bool:
    return path.suffix.lower() in SOURCE_SUFFIXES and not any(part in EXCLUDED_DIRS for part in path.parts)


def is_test_or_doc(rel: str) -> bool:
    return any(marker in rel for marker in TEST_MARKERS + DOC_MARKERS)


def iter_source(root: Path) -> Iterable[Path]:
    for path in root.rglob("*"):
        if path.is_file() and is_source(path):
            yield path


def load_lines(path: Path) -> list[str]:
    try:
        return path.read_text(encoding="utf-8", errors="replace").splitlines()
    except OSError:
        return []


def finding(severity: str, category: str, root: Path, path: Path, line: int, excerpt: str, rationale: str) -> Finding:
    return Finding(severity, category, str(path.relative_to(root)), line, excerpt.strip()[:320], rationale)


def scan_silent_mockware(root: Path, paths: Iterable[Path]) -> list[Finding]:
    findings: list[Finding] = []
    # Patterns are intentionally conservative: results require a success-like return,
    # synthetic output, or security behavior in a non-test, non-doc runtime file.
    patterns = [
        ("CRITICAL", "fabricated_auth", re.compile(r"mock-(?:access|refresh|id)-token|return mock claims|without signature verification", re.I), "Authentication can appear successful without a verified identity-provider result."),
        ("CRITICAL", "fail_open_authz", re.compile(r"allow-all|Default:\s*allow|return true,?\s*nil|return true;", re.I), "Authorization or a security control may permit access after dependency failure."),
        ("CRITICAL", "synthetic_financial_state", re.compile(r"in-memory (?:ledger|workflows?)|fallback.*(?:ledger|workflow)|simulated(?:SSE|Snapshot| price)|seedData", re.I), "Financial or workflow state may be manufactured in-process rather than durably executed."),
        ("HIGH", "mock_response", re.compile(r"\b(mock|simulated|dummy|fake|placeholder|hardcoded)\b", re.I), "Runtime source references a mock, synthetic, dummy, fake, placeholder, or hard-coded output."),
        ("HIGH", "silent_success", re.compile(r"fallback.*return nil|return nil\s*//\s*(?:No-op|fallback)|source[\"']?\s*[:=].*fallback", re.I), "A dependency failure may be acknowledged as a successful no-op or fallback response."),
        ("HIGH", "randomized_result", re.compile(r"random\.(?:randint|uniform|choice)|Math\.random\(|UnixNano\(\)%", re.I), "Production response generation includes random data; verify it is not a user-visible fabricated result."),
        ("MEDIUM", "unfinished_work", re.compile(r"\b(TODO|FIXME|XXX|not implemented|implement me)\b", re.I), "Production source contains unfinished-work marker."),
    ]
    for path in paths:
        rel = str(path.relative_to(root))
        if is_test_or_doc(rel):
            continue
        for number, text in enumerate(load_lines(path), 1):
            for severity, category, regex, rationale in patterns:
                if regex.search(text):
                    findings.append(finding(severity, category, root, path, number, text, rationale))
                    break
    return findings


def scan_routes(root: Path, paths: Iterable[Path]) -> dict[str, list[dict[str, str | int]]]:
    routes: dict[str, list[dict[str, str | int]]] = {"frontend": [], "express": [], "trpc": [], "go": [], "fastapi": []}
    frontend_re = re.compile(r"<Route\s+path=[{\"']+([^}\"']+)")
    express_re = re.compile(r"(?:app|router)\.(get|post|put|patch|delete|use)\(\s*[`\"']([^`\"']+)", re.I)
    go_re = re.compile(r"\.(GET|POST|PUT|PATCH|DELETE|Any)\(\s*[`\"']([^`\"']+)", re.I)
    fastapi_re = re.compile(r"@app\.(get|post|put|patch|delete)\(\s*[`\"']([^`\"']+)", re.I)
    trpc_re = re.compile(r"([A-Za-z][A-Za-z0-9_]*)\s*:\s*(?:publicProcedure|protectedProcedure|adminProcedure|ownerProcedure)", re.I)
    for path in paths:
        rel = str(path.relative_to(root))
        if is_test_or_doc(rel):
            continue
        for number, text in enumerate(load_lines(path), 1):
            for match in frontend_re.finditer(text):
                routes["frontend"].append({"path": match.group(1), "file": rel, "line": number})
            for match in express_re.finditer(text):
                routes["express"].append({"method": match.group(1).upper(), "path": match.group(2), "file": rel, "line": number})
            if path.suffix == ".go":
                for match in go_re.finditer(text):
                    routes["go"].append({"method": match.group(1).upper(), "path": match.group(2), "file": rel, "line": number})
            if path.suffix == ".py":
                for match in fastapi_re.finditer(text):
                    routes["fastapi"].append({"method": match.group(1).upper(), "path": match.group(2), "file": rel, "line": number})
            if path.suffix in {".ts", ".tsx"} and "/server/routers" in "/" + rel:
                for match in trpc_re.finditer(text):
                    routes["trpc"].append({"procedure": match.group(1), "file": rel, "line": number})
    return routes


def scan_schema(root: Path, paths: Iterable[Path]) -> dict[str, object]:
    drizzle_tables: list[dict[str, str | int]] = []
    migrations: list[str] = []
    migrations_with_index: list[str] = []
    for path in paths:
        rel = str(path.relative_to(root))
        lines = load_lines(path)
        if rel.startswith("drizzle/") and path.suffix == ".ts":
            for number, text in enumerate(lines, 1):
                match = re.search(r"(?:pgTable|pgMaterializedView)\(\s*[`\"']([^`\"']+)", text)
                if match:
                    drizzle_tables.append({"table": match.group(1), "file": rel, "line": number})
        if rel.startswith("drizzle/") and path.suffix == ".sql":
            migrations.append(rel)
            if any(re.search(r"\bCREATE\s+(?:UNIQUE\s+)?INDEX\b", text, re.I) for text in lines):
                migrations_with_index.append(rel)
    return {
        "drizzle_tables": drizzle_tables,
        "migration_files": sorted(migrations),
        "migrations_with_index": sorted(migrations_with_index),
    }


def discover_registration_gaps(root: Path, paths: Iterable[Path]) -> list[Finding]:
    findings: list[Finding] = []
    routers_file = root / "server" / "routers.ts"
    if routers_file.exists():
        registered = routers_file.read_text(encoding="utf-8", errors="replace")
        for path in root.glob("server/routers/*Router.ts"):
            rel = str(path.relative_to(root))
            stem = path.stem
            if stem not in registered:
                findings.append(finding("MEDIUM", "potential_unregistered_router", root, path, 1, stem, "Router file is not referenced by server/routers.ts; confirm it is registered via another path."))
    # Flag production Python/Go service entrypoints with no evident health endpoint.
    for path in paths:
        rel = str(path.relative_to(root))
        if is_test_or_doc(rel):
            continue
        if path.name in {"main.py", "main.go"} and (rel.startswith("services/") or rel.startswith("gateway-service/") or rel.startswith("journey-orchestrator/")):
            text = "\n".join(load_lines(path))
            if "/health" not in text and "Health" not in text:
                findings.append(finding("MEDIUM", "missing_health_endpoint", root, path, 1, path.name, "Service entrypoint has no obvious health endpoint registration."))
    return findings


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("root", type=Path, nargs="?", default=Path.cwd())
    parser.add_argument("--output", type=Path, default=Path(".audit_static_report.json"))
    args = parser.parse_args()
    root = args.root.resolve()
    paths = list(iter_source(root))
    routes = scan_routes(root, paths)
    schema = scan_schema(root, paths)
    findings = scan_silent_mockware(root, paths)
    findings.extend(discover_registration_gaps(root, paths))
    findings.sort(key=lambda item: ({"CRITICAL": 0, "HIGH": 1, "MEDIUM": 2, "LOW": 3}.get(item.severity, 9), item.path, item.line))
    report = {
        "root": str(root),
        "source_file_count": len(paths),
        "route_counts": {kind: len(items) for kind, items in routes.items()},
        "routes": routes,
        "schema": schema,
        "finding_counts": dict(Counter(f.severity for f in findings)),
        "category_counts": dict(Counter(f.category for f in findings)),
        "findings": [asdict(item) for item in findings],
    }
    output = args.output if args.output.is_absolute() else root / args.output
    output.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({
        "output": str(output),
        "source_file_count": report["source_file_count"],
        "route_counts": report["route_counts"],
        "finding_counts": report["finding_counts"],
        "category_counts": report["category_counts"],
    }, indent=2))
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
