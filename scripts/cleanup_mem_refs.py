#!/usr/bin/env python3
"""
cleanup_mem_refs.py
Removes remaining in-memory Map declarations and helper functions
that reference removed Mem* types, replacing them with nothing
(the DB path is the only path now).
"""
import re
from pathlib import Path

ROUTER_DIR = Path(__file__).parent.parent / "server" / "routers"


def remove_mem_map_declarations(text: str) -> str:
    """Remove lines like: const _xxx = new Map<number, MemXxx>(); """
    text = re.sub(r'^(?:export )?const _\w+ = new Map<[^>]*Mem[^>]*>\(\);\n', '', text, flags=re.MULTILINE)
    # Also remove let _xxxSeq = N; lines
    text = re.sub(r'^let _\w+Seq\s*=\s*\d+;?\s*', '', text, flags=re.MULTILINE)
    # Remove MemLedger array declarations
    text = re.sub(r'^const _mem\w+:\s*Mem\w+\[\]\s*=\s*\[\];\n', '', text, flags=re.MULTILINE)
    return text


def remove_mem_helper_functions(text: str) -> str:
    """Remove helper functions that only use _mem* Maps."""
    # Remove function _getActiveLimit and similar that reference _memLimits etc.
    # Pattern: function _xxx(...) { ... } where body only references _mem* vars
    # We'll remove specific known functions
    patterns = [
        # velocityLimitRouter: _getActiveLimit function
        r'function _getActiveLimit\(.*?\}\n',
    ]
    for p in patterns:
        text = re.sub(p, '', text, flags=re.DOTALL)
    return text


def remove_mem_comment_blocks(text: str) -> str:
    """Remove '// ─── In-memory fallback stores' comment blocks."""
    text = re.sub(r'^// ─+\s*In-memory fallback stores\s*─*\n', '', text, flags=re.MULTILINE)
    text = re.sub(r'^// ── In-memory fallback stores\s*─*\n', '', text, flags=re.MULTILINE)
    return text


def add_missing_type_declarations(filepath: Path, text: str) -> str:
    """
    For surveillanceRouter and investorRelationsRouter, the Mem* types
    were used in Map<number, MemXxx> declarations. Since we're removing
    those declarations, we just need to ensure the types are gone.
    The Map declarations themselves will be removed by remove_mem_map_declarations.
    """
    return text


def process_file(filepath: Path) -> bool:
    original = filepath.read_text(encoding='utf-8')
    text = original
    text = remove_mem_comment_blocks(text)
    text = remove_mem_map_declarations(text)
    text = remove_mem_helper_functions(text)
    if text != original:
        filepath.write_text(text, encoding='utf-8')
        return True
    return False


FILES = [
    "surveillanceRouter.ts",
    "investorRelationsRouter.ts",
    "velocityLimitRouter.ts",
]

for f in FILES:
    fp = ROUTER_DIR / f
    if fp.exists():
        changed = process_file(fp)
        print(f"  {'FIXED' if changed else 'OK'}: {f}")
