#!/usr/bin/env python3
"""
remove_mem_fallbacks.py
Removes in-memory fallback patterns from tRPC router files.

Pattern to remove:
  const db = await getDb();
  if (!db) {
    ... in-memory fallback code ...
  }
  // DB path continues here

Replaced with:
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

Also removes top-level _mem* Map declarations and _*Seq counter declarations.
"""
import re
import sys
import os
from pathlib import Path

ROUTER_DIR = Path(__file__).parent.parent / "server" / "routers"

# Files to process
TARGET_FILES = [
    "aiMlRouter.ts",
    "brokerRouter.ts",
    "clearingHouseRouter.ts",
    "derivativesRouter.ts",
    "deviceSessionRouter.ts",
    "farmerRouter.ts",
    "investorRelationsRouter.ts",
    "ipAllowlistRouter.ts",
    "marketMakerOnboardingRouter.ts",
    "marketMakerRouter.ts",
    "optionsRouter.ts",
    "regulatoryReportingRouter.ts",
    "settlementEngineRouter.ts",
    "surveillanceRouter.ts",
    "totpRouter.ts",
    "traderRouter.ts",
    "velocityLimitRouter.ts",
    "warehouseInventory.ts",
    "warehouseOpRouter.ts",
    "webauthnRouter.ts",
    "webhookRouter.ts",
    "withdrawalVerificationRouter.ts",
]

DB_NULL_CHECK = re.compile(
    r'if \(!db\)\s*\{[^}]*(?:\{[^}]*\}[^}]*)?\}',
    re.DOTALL
)

# More robust: match balanced braces for if (!db) { ... }
def find_if_not_db_blocks(text: str):
    """Find all 'if (!db) { ... }' blocks with balanced braces."""
    results = []
    pattern = re.compile(r'if\s*\(\s*!db\s*\)\s*\{')
    for m in pattern.finditer(text):
        start = m.start()
        brace_start = m.end() - 1  # position of opening {
        depth = 1
        i = brace_start + 1
        while i < len(text) and depth > 0:
            if text[i] == '{':
                depth += 1
            elif text[i] == '}':
                depth -= 1
            i += 1
        end = i  # position after closing }
        results.append((start, end, text[start:end]))
    return results


def remove_mem_declarations(text: str) -> str:
    """Remove top-level _mem* Map declarations and _*Seq counters."""
    # Remove lines like: const _memXxx = new Map<...>();
    text = re.sub(r'^const _mem\w+ = new Map<[^>]*>\(\);\n', '', text, flags=re.MULTILINE)
    # Remove lines like: let _memSeq = 1; or let _cbrSeq = 1; let _cbeSeq = 1; etc.
    text = re.sub(r'^let _\w+Seq\s*=\s*\d+;\s*', '', text, flags=re.MULTILINE)
    # Remove type declarations for Mem* types
    text = re.sub(r'^type Mem\w+ = \{[^;]+\};\n', '', text, flags=re.MULTILINE)
    # Remove multi-line type declarations
    text = re.sub(r'^type Mem\w+ = \{.*?\};\n', '', text, flags=re.MULTILINE | re.DOTALL)
    return text


def process_file(filepath: Path) -> tuple[bool, int]:
    """Process a single file. Returns (changed, blocks_removed)."""
    original = filepath.read_text(encoding='utf-8')
    text = original

    # Find and replace if (!db) { ... } blocks
    blocks = find_if_not_db_blocks(text)
    if not blocks:
        return False, 0

    # Process in reverse order to preserve positions
    blocks_removed = 0
    for start, end, block_text in reversed(blocks):
        replacement = 'if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable — please try again" });'
        text = text[:start] + replacement + text[end:]
        blocks_removed += 1

    # Remove in-memory declarations
    text = remove_mem_declarations(text)

    # Ensure TRPCError is imported if not already
    if 'TRPCError' not in original and blocks_removed > 0:
        text = 'import { TRPCError } from "@trpc/server";\n' + text

    if text != original:
        filepath.write_text(text, encoding='utf-8')
        return True, blocks_removed
    return False, 0


def main():
    total_changed = 0
    total_blocks = 0
    for filename in TARGET_FILES:
        filepath = ROUTER_DIR / filename
        if not filepath.exists():
            print(f"  SKIP (not found): {filename}")
            continue
        changed, blocks = process_file(filepath)
        if changed:
            print(f"  FIXED ({blocks} blocks): {filename}")
            total_changed += 1
            total_blocks += blocks
        else:
            print(f"  OK (no changes): {filename}")
    print(f"\nSummary: {total_changed} files changed, {total_blocks} in-memory fallback blocks removed")


if __name__ == "__main__":
    main()
