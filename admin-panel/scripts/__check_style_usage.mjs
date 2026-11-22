#!/usr/bin/env bun
/**
 * Style-usage gate.
 *
 * The token gate proves the tokens are correct; this one proves the code uses them. A decision
 * that only lives in globals.css is a suggestion - the panel still shipped 3px focus rings in 37
 * places and a second type ladder in Typography until this gate existed.
 *
 * Rules, each a decision from DESIGN-PREFERENCE:
 *   1. focus rings are 2px (topic 6, WCAG 2.4.13)  -> no `ring-[3px]`
 *   2. sizes come from the 12 x 1.2 chain (topic 2) -> no raw `text-xl`-style sizes in Typography
 *
 * Usage: bun scripts/__check_style_usage.mjs [rootDir]
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const ROOT = resolve(process.argv[2] ?? 'src');
const problems = [];

const RULES = [
  {
    id: 'focus-ring',
    test: (source) => /ring-\[3px\]/.test(source),
    message: 'uses ring-[3px]; the decision (topic 6) is a 2px ring - use ring-2',
  },
  {
    id: 'type-scale',
    match: /Typography\.tsx$/,
    test: (source) => /\btext-(3xl|2xl|xl|lg|base|sm|xs)\b/.test(source),
    message: 'uses a Tailwind size step; the type scale is the 12 x 1.2 chain - use var(--text-*)',
  },
];

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(tsx|ts|css)$/.test(full)) out.push(full);
  }
  return out;
}

for (const file of walk(ROOT)) {
  const rel = relative(resolve('.'), file).replaceAll('\\', '/');
  if (rel.endsWith('globals.css')) continue; // the token block is where sizes are declared
  // Comments are prose, not code: a comment explaining why text-xl is banned must not trip the
  // rule that bans it. Class strings stay, because that is where the utilities actually live.
  const source = readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
  for (const rule of RULES) {
    if (rule.match && !rule.match.test(file)) continue;
    if (rule.test(source)) problems.push(`${rel}: ${rule.message}`);
  }
}

if (problems.length) {
  console.error(`style usage: ${problems.length} problem(s)`);
  for (const line of problems) console.error(`  - ${line}`);
  process.exit(1);
}
console.log(`style usage: OK - ${RULES.length} rules hold across ${walk(ROOT).length} files`);
