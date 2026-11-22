#!/usr/bin/env bun
/**
 * Status-colour gate.
 *
 * Colour in this panel means state. A `text-warning` on a username, a `text-primary` on a page
 * count, or a `text-info` on a task name teaches the reader that colour is decoration - and once
 * that is learned, the one place colour *does* matter stops working.
 *
 * The only files that may name a status colour are the primitives that render a status. Everywhere
 * else is debt, counted per file: it may fall, never rise.
 *
 * Usage: bun scripts/__check_status_colour.mjs [--update]
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const ROOT = resolve(process.cwd());
const SRC = resolve(process.env.STATUS_COLOUR_SRC ?? join(ROOT, 'src'));
const BASELINE = resolve(process.env.STATUS_COLOUR_BASELINE ?? join(ROOT, 'scripts', 'status-colour-baseline.json'));

/** Files whose job is to render a status: they are where a status colour belongs. */
const ALLOWED = [
  /^src\/components\/core\/StatusBadge\.tsx$/,
  /^src\/components\/core\/StatusPill\.tsx$/,
  /^src\/components\/core\/Badge\.tsx$/,
  /^src\/components\/ui\/badge\.tsx$/, // the variant map the core Badge adapts
  /^src\/components\/core\/InlineAlert\.tsx$/,
  /^src\/components\/patterns\//,
  /^src\/components\/dashboard\/DashboardSurface\.tsx$/, // the one place a status glyph is tinted
];

const PATTERNS = [
  /\btext-(warning|info|primary|success|destructive)\b/g,
  /\bbg-(warning|info|primary|success|destructive)\/\d+\b/g,
];

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(tsx|ts)$/.test(full)) out.push(full);
  }
  return out;
}

const counts = {};
const offenders = [];
for (const file of walk(SRC)) {
  const rel = relative(ROOT, file).replaceAll('\\', '/');
  if (ALLOWED.some((rx) => rx.test(rel))) continue;
  // Comments explain; they do not render.
  const source = readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
  let hits = 0;
  for (const pattern of PATTERNS) hits += [...source.matchAll(pattern)].length;
  if (hits === 0) continue;
  counts[rel] = hits;
  offenders.push([rel, hits]);
}

const total = Object.values(counts).reduce((a, b) => a + b, 0);

if (process.argv.includes('--update')) {
  writeFileSync(BASELINE, `${JSON.stringify({ total, files: counts }, null, 2)}\n`);
  console.log(`status colour: baseline written with ${total} in ${offenders.length} files`);
  process.exit(0);
}

const baseline = JSON.parse(readFileSync(BASELINE, 'utf8'));
const regressions = offenders.filter(([file, hits]) => hits > (baseline.files[file] ?? 0));

if (regressions.length) {
  console.error(`status colour: ${regressions.length} file(s) got worse (total ${total}, baseline ${baseline.total})`);
  for (const [file, hits] of regressions.sort((a, b) => b[1] - a[1]).slice(0, 15)) {
    console.error(`  - ${file}: ${hits}, baseline allows ${baseline.files[file] ?? 0}`);
  }
  console.error('  Render the state through StatusBadge / StatusPill / Badge, or drop the colour.');
  process.exit(1);
}

const saved = baseline.total - total;
console.log(
  `status colour: OK - ${total} in ${offenders.length} files` + (saved > 0 ? `, ${saved} fewer than the baseline` : '')
);
