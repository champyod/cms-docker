#!/usr/bin/env bun
/**
 * Raw-control ratchet.
 *
 * A primitive only exists if using it is the cheapest path. This gate holds the line at today's
 * counts: a file may lose raw controls, never gain them, and a new file may not arrive with one.
 * The tag list is deliberately small - only controls that already have a primitive - so the gate
 * never asks a page to import a component that does not fit.
 *
 * Hidden inputs are exempt (there is no such thing as a styled hidden field), and the files that
 * implement the primitives are exempt (they are where the raw tag belongs).
 *
 * Usage: bun scripts/__check_raw_controls.mjs [--update]
 */
import { readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const ROOT = resolve(process.cwd());
// The scanner root and the baseline are overridable so a negative control can run against a
// throwaway tree in the scratch directory instead of leaving probe files inside the repo.
const SRC = resolve(process.env.RAW_CONTROLS_SRC ?? join(ROOT, 'src'));
const BASELINE = resolve(process.env.RAW_CONTROLS_BASELINE ?? join(ROOT, 'scripts', 'raw-controls-baseline.json'));

/** tag -> how to count a violation for that tag in a file's source. */
const RULES = [
  { tag: 'button', pattern: /<button\b/g },
  { tag: 'select', pattern: /<select\b/g },
  { tag: 'textarea', pattern: /<textarea\b/g },
  // A hidden input is not a field the person sees or interacts with.
  { tag: 'input', pattern: /<input\b(?:(?!type="hidden")[^>])*>/g, skip: (line) => /type="hidden"/.test(line) },
  { tag: 'table', pattern: /<table\b/g },
];

/** Where a raw tag is legitimate: the primitives themselves and the adapter layer. */
const EXEMPT = [/^src\/components\/ui\//, /^src\/components\/core\/[A-Za-z]+\.tsx$/];

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (full.endsWith('.tsx')) out.push(full);
  }
  return out;
}

const counts = {};
for (const file of walk(SRC)) {
  const rel = relative(ROOT, file).replaceAll('\\', '/');
  if (EXEMPT.some((rx) => rx.test(rel))) continue;
  const source = readFileSync(file, 'utf8');
  const lines = source.split('\n');
  let fileTotal = 0;
  for (const rule of RULES) {
    const global = new RegExp(rule.pattern.source, 'g');
    for (const match of source.matchAll(global)) {
      const line = lines[source.slice(0, match.index).split('\n').length - 1] ?? '';
      const wholeTag = /<input\b[^>]*>/.exec(source.slice(match.index))?.[0] ?? line;
      if (rule.skip?.(wholeTag)) continue;
      fileTotal += 1;
    }
  }
  if (fileTotal) counts[rel] = fileTotal;
}

const total = Object.values(counts).reduce((a, b) => a + b, 0);

if (process.argv.includes('--update')) {
  writeFileSync(BASELINE, `${JSON.stringify({ total, files: counts }, null, 2)}\n`);
  console.log(`raw controls: baseline written with ${total} across ${Object.keys(counts).length} files`);
  process.exit(0);
}

const baseline = JSON.parse(readFileSync(BASELINE, 'utf8'));
const regressions = [];
for (const [file, count] of Object.entries(counts)) {
  const allowed = baseline.files[file] ?? 0;
  if (count > allowed) regressions.push(`${file}: ${count} raw control(s), baseline allows ${allowed}`);
}

if (regressions.length) {
  console.error(`raw controls: ${regressions.length} file(s) got worse (total now ${total}, baseline ${baseline.total})`);
  for (const line of regressions) console.error(`  - ${line}`);
  console.error('  Use the primitive in src/components/core/ (Button, Input, Select, Checkbox, Textarea, Table).');
  process.exit(1);
}

const improved = baseline.total - total;
console.log(
  `raw controls: OK - ${total} raw control(s) across ${Object.keys(counts).length} files` +
    (improved > 0 ? `, ${improved} fewer than the baseline` : '')
);
