#!/usr/bin/env node
/**
 * NEXCOM Mobile — static performance audit (zero dependencies).
 *
 * Scans nexcom-mobile/ for known performance anti-patterns for the low-end
 * Android / 2G-3G target:
 *
 *   ERROR (exit 1):
 *     - FlatList/SectionList rendered without windowing props
 *     - useNativeDriver: false (JS-thread animation)
 *     - base64: true in expo-image-picker calls (memory blow-up)
 *     - console.log outside a __DEV__ guard
 *
 *   WARNING (reported; exit 1 only with STRICT=1):
 *     - files > 200 lines under app/ with no React.memo usage (heuristic)
 *     - inline chart-data transforms in JSX (heuristic)
 *
 * Usage:
 *   node scripts/check-mobile-perf.mjs [path-to-nexcom-mobile]
 *   STRICT=1 node scripts/check-mobile-perf.mjs   # warnings also fail
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const ROOT = resolve(process.argv[2] ?? join(process.cwd(), 'nexcom-mobile'));
const STRICT = process.env.STRICT === '1';

const LIST_TUNING_PROPS = [
  'windowSize',
  'maxToRenderPerBatch',
  'initialNumToRender',
  'updateCellsBatchingPeriod',
  'removeClippedSubviews',
];

/** Recursively collect .ts/.tsx files, skipping noise dirs. */
function collect(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist' || entry.startsWith('.')) continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) collect(full, out);
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
  }
  return out;
}

/** Strip // line comments and block comments so regexes don't match prose. */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => ' '.repeat(m.length))
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

const findings = [];

function report(file, line, severity, rule, detail) {
  findings.push({ file: relative(ROOT, file), line, severity, rule, detail });
}

function lineOf(src, index) {
  return src.slice(0, index).split('\n').length;
}

function auditFile(file) {
  const raw = readFileSync(file, 'utf8');
  const src = stripComments(raw);
  const lines = raw.split('\n');

  // ── 1. FlatList / SectionList without windowing props ────────────────────
  for (const match of src.matchAll(/<(FlatList|SectionList)\b/g)) {
    // Approximate the JSX opening tag: first '>' not part of '=>' or '/>'.
    let end = -1;
    const limit = Math.min(src.length, match.index + 1500);
    for (let i = match.index; i < limit; i++) {
      if (src[i] === '>' && src[i - 1] !== '=' && src[i - 1] !== '/') {
        end = i;
        break;
      }
    }
    const openTag = src.slice(match.index, end === -1 ? limit : end + 1);
    const missing = LIST_TUNING_PROPS.filter((p) => !openTag.includes(p));
    if (missing.length > 0) {
      report(file, lineOf(src, match.index), 'ERROR', 'untuned-list',
        `<${match[1]}> missing: ${missing.join(', ')} (or convert to @shopify/flash-list)`);
    }
  }

  // ── 2. JS-thread animations ──────────────────────────────────────────────
  for (const match of src.matchAll(/useNativeDriver\s*:\s*false/g)) {
    report(file, lineOf(src, match.index), 'ERROR', 'js-thread-animation',
      'useNativeDriver: false runs on the JS thread — use Reanimated worklets or useNativeDriver: true');
  }

  // ── 3. base64 image picker ───────────────────────────────────────────────
  for (const match of src.matchAll(/base64\s*:\s*true/g)) {
    report(file, lineOf(src, match.index), 'ERROR', 'base64-image-picker',
      'base64: true loads the whole image into JS memory — upload the file URI instead');
  }

  // ── 4. console.log outside __DEV__ guards ────────────────────────────────
  lines.forEach((line, i) => {
    if (!/console\.log\s*\(/.test(line)) return;
    // Allow when the line itself or the 2 preceding lines guard with __DEV__.
    const context = lines.slice(Math.max(0, i - 2), i + 1).join('\n');
    if (!/__DEV__/.test(context)) {
      report(file, i + 1, 'ERROR', 'console-log',
        'console.log outside a __DEV__ guard (Hermes keeps strings + call overhead in release)');
    }
  });

  // ── 5. Inline chart-data transforms in JSX (heuristic) ───────────────────
  // Looks for .map/.filter/.reduce over data inside a chart component prop.
  for (const match of src.matchAll(/<(LineChart|BarChart|PieChart|Victory\w+)[^>]*data\s*=\s*\{[^}]*\.(map|filter|reduce)\(/gs)) {
    report(file, lineOf(src, match.index), 'WARN', 'inline-chart-transform',
      'chart data transformed inline in JSX — hoist into useMemo and downsample to <= 60 points');
  }

  // ── 6. Large screen file without React.memo (heuristic) ──────────────────
  if (file.includes(`${join('app')}/`) && lines.length > 200 && !/React\.memo|\bmemo\(/.test(src)) {
    report(file, 1, 'WARN', 'no-react-memo',
      `${lines.length}-line screen with no React.memo — memoize row/heavy child components`);
  }
}

try {
  statSync(ROOT);
} catch {
  console.error(`nexcom-mobile not found at ${ROOT}`);
  process.exit(2);
}

const files = collect(ROOT);
for (const f of files) auditFile(f);

findings.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);

// ── report table ────────────────────────────────────────────────────────────
const cols = { file: 44, line: 5, severity: 8, rule: 22 };
const hr = `${'-'.repeat(cols.file)}-+-${'-'.repeat(cols.line)}-+-${'-'.repeat(cols.severity)}-+-${'-'.repeat(cols.rule)}-+`;
console.log(`\nNEXCOM mobile perf audit — ${files.length} files scanned (${ROOT})\n`);
console.log(hr);
if (findings.length === 0) {
  console.log('  ✔ no findings');
} else {
  for (const f of findings) {
    const file = f.file.length > cols.file ? '…' + f.file.slice(-cols.file + 1) : f.file;
    console.log(
      `  ${file.padEnd(cols.file - 2)} | ${String(f.line).padEnd(cols.line - 1)}| ${f.severity.padEnd(cols.severity - 1)}| ${f.rule.padEnd(cols.rule - 1)}|`,
    );
    console.log(`    ${f.detail}`);
  }
}
console.log(hr);

const errors = findings.filter((f) => f.severity === 'ERROR').length;
const warnings = findings.filter((f) => f.severity === 'WARN').length;
console.log(`  ${errors} error(s), ${warnings} warning(s)${STRICT ? ' (STRICT mode)' : ''}\n`);

if (errors > 0 || (STRICT && warnings > 0)) process.exit(1);
