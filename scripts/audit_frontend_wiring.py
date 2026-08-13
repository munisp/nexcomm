#!/usr/bin/env python3
"""Identify registered React pages without an evident live backend data path."""
from __future__ import annotations

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
APP = ROOT / "client/src/App.tsx"
PAGES = ROOT / "client/src/pages"

IMPORT_RE = re.compile(r'const\s+(\w+)\s*=\s+lazy\(\(\)\s*=>\s*import\("\./pages/([^"/]+)"\)\)')
ROUTE_RE = re.compile(r'<Route\s+path="([^"]+)"\s+component=\{([^}]+)\}')
LIVE_PATTERNS = {
    "trpc": re.compile(r'\btrpc\.[A-Za-z0-9_.]+\.use(?:Query|Mutation|SuspenseQuery)\b'),
    "fetch": re.compile(r'\bfetch\s*\('),
    "api_client": re.compile(r'\b(?:api|apiClient|gatewayClient|axios)\s*[.(]'),
    "react_query": re.compile(r'\buse(?:Query|Mutation|SuspenseQuery)\s*\('),
    "websocket": re.compile(r'\b(?:WebSocket|EventSource)\s*\('),
}
SYNTHETIC_PATTERNS = {
    "mock_word": re.compile(r'\b(mock|simulated|dummy|fake|placeholder|sampleData)\b', re.I),
    "random": re.compile(r'\bMath\.random\s*\('),
    "hardcoded_market_arrays": re.compile(r'(?:prices|orders|trades|positions|transactions|metrics)\s*=\s*\[', re.I),
}


def content(path: Path) -> str:
    return path.read_text(encoding="utf-8", errors="replace")


def main() -> int:
    app = content(APP)
    aliases = {alias: page for alias, page in IMPORT_RE.findall(app)}
    route_rows = []
    for path, component in ROUTE_RE.findall(app):
        normalized_component = component.strip()
        if normalized_component.startswith("() =>"):
            continue
        page = aliases.get(normalized_component)
        route_rows.append({"path": path, "component": normalized_component, "page": page})

    page_rows = []
    for page in sorted(PAGES.glob("*.tsx")):
        text = content(page)
        live = sorted(name for name, pattern in LIVE_PATTERNS.items() if pattern.search(text))
        synthetic = sorted(name for name, pattern in SYNTHETIC_PATTERNS.items() if pattern.search(text))
        page_rows.append({
            "page": page.stem,
            "file": str(page.relative_to(ROOT)),
            "live_data_signals": live,
            "synthetic_signals": synthetic,
            "registered_routes": [row["path"] for row in route_rows if row["page"] == page.stem],
        })

    registered = {row["page"] for row in route_rows if row["page"]}
    report = {
        "registered_route_count": len(route_rows),
        "registered_page_count": len(registered),
        "page_file_count": len(page_rows),
        "registered_pages_without_live_data_signal": [row for row in page_rows if row["page"] in registered and not row["live_data_signals"]],
        "registered_pages_with_synthetic_signal": [row for row in page_rows if row["page"] in registered and row["synthetic_signals"]],
        "unregistered_page_files": [row for row in page_rows if row["page"] not in registered],
        "all_pages": page_rows,
    }
    destination = ROOT / ".audit_frontend_wiring.json"
    destination.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({
        "output": str(destination),
        "registered_route_count": report["registered_route_count"],
        "registered_page_count": report["registered_page_count"],
        "page_file_count": report["page_file_count"],
        "registered_pages_without_live_data_signal": len(report["registered_pages_without_live_data_signal"]),
        "registered_pages_with_synthetic_signal": len(report["registered_pages_with_synthetic_signal"]),
        "unregistered_page_files": len(report["unregistered_page_files"]),
    }, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
