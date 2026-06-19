#!/usr/bin/env python3
"""
Replace hardcoded Tailwind gray/zinc/slate/neutral classes with NEXCOM design tokens.
Maps the most common patterns to their semantic equivalents.
"""
import os
import re
import glob

# Mapping: (pattern, replacement)
# Order matters — more specific patterns first
REPLACEMENTS = [
    # Background surfaces
    (r"bg-gray-950\b", "bg-background"),
    (r"bg-zinc-950\b", "bg-background"),
    (r"bg-slate-950\b", "bg-background"),
    (r"bg-neutral-950\b", "bg-background"),
    (r"bg-gray-900\b", "bg-card"),
    (r"bg-zinc-900\b", "bg-card"),
    (r"bg-slate-900\b", "bg-card"),
    (r"bg-neutral-900\b", "bg-card"),
    (r"bg-gray-800\b", "bg-secondary"),
    (r"bg-zinc-800\b", "bg-secondary"),
    (r"bg-slate-800\b", "bg-secondary"),
    (r"bg-neutral-800\b", "bg-secondary"),
    (r"bg-gray-700\b", "bg-muted"),
    (r"bg-zinc-700\b", "bg-muted"),
    (r"bg-slate-700\b", "bg-muted"),
    (r"bg-neutral-700\b", "bg-muted"),
    # Text colors
    (r"text-gray-100\b", "text-foreground"),
    (r"text-zinc-100\b", "text-foreground"),
    (r"text-slate-100\b", "text-foreground"),
    (r"text-gray-200\b", "text-foreground"),
    (r"text-zinc-200\b", "text-foreground"),
    (r"text-slate-200\b", "text-foreground"),
    (r"text-gray-300\b", "text-muted-foreground"),
    (r"text-zinc-300\b", "text-muted-foreground"),
    (r"text-slate-300\b", "text-muted-foreground"),
    (r"text-gray-400\b", "text-muted-foreground"),
    (r"text-zinc-400\b", "text-muted-foreground"),
    (r"text-slate-400\b", "text-muted-foreground"),
    (r"text-gray-500\b", "text-muted-foreground"),
    (r"text-zinc-500\b", "text-muted-foreground"),
    (r"text-slate-500\b", "text-muted-foreground"),
    # Border colors
    (r"border-gray-700\b", "border-border"),
    (r"border-zinc-700\b", "border-border"),
    (r"border-slate-700\b", "border-border"),
    (r"border-gray-800\b", "border-border"),
    (r"border-zinc-800\b", "border-border"),
    (r"border-slate-800\b", "border-border"),
    (r"border-gray-600\b", "border-border"),
    (r"border-zinc-600\b", "border-border"),
    (r"border-slate-600\b", "border-border"),
    # Divide colors
    (r"divide-gray-700\b", "divide-border"),
    (r"divide-zinc-700\b", "divide-border"),
    (r"divide-gray-800\b", "divide-border"),
    (r"divide-zinc-800\b", "divide-border"),
    # Hover states
    (r"hover:bg-gray-800\b", "hover:bg-secondary"),
    (r"hover:bg-zinc-800\b", "hover:bg-secondary"),
    (r"hover:bg-slate-800\b", "hover:bg-secondary"),
    (r"hover:bg-gray-700\b", "hover:bg-muted"),
    (r"hover:bg-zinc-700\b", "hover:bg-muted"),
    (r"hover:bg-slate-700\b", "hover:bg-muted"),
    # Ring colors
    (r"ring-gray-700\b", "ring-border"),
    (r"ring-zinc-700\b", "ring-border"),
    # Placeholder colors
    (r"placeholder-gray-500\b", "placeholder-muted-foreground"),
    (r"placeholder-zinc-500\b", "placeholder-muted-foreground"),
]

def fix_file(filepath):
    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()
    
    original = content
    count = 0
    for pattern, replacement in REPLACEMENTS:
        new_content, n = re.subn(pattern, replacement, content)
        count += n
        content = new_content
    
    if content != original:
        with open(filepath, 'w', encoding='utf-8') as f:
            f.write(content)
        return count
    return 0

def main():
    pages_dir = "/home/ubuntu/nexcom-exchange/client/src/pages"
    components_dir = "/home/ubuntu/nexcom-exchange/client/src/components"
    
    total_files = 0
    total_replacements = 0
    
    for directory in [pages_dir, components_dir]:
        for filepath in glob.glob(os.path.join(directory, "**/*.tsx"), recursive=True):
            n = fix_file(filepath)
            if n > 0:
                total_files += 1
                total_replacements += n
                print(f"  Fixed {n:3d} instances in {os.path.relpath(filepath, '/home/ubuntu/nexcom-exchange')}")
    
    print(f"\nTotal: {total_replacements} replacements across {total_files} files")

if __name__ == "__main__":
    main()
