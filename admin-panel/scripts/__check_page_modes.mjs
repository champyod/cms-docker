#!/usr/bin/env bun
/**
 * Mode-coverage gate.
 *
 * The panel ships four visual modes that must all work: light, dark, high contrast, and the two
 * densities. Declaring them in one stylesheet is not enough - this gate checks that each mode is
 * actually wired, and that row height comes from one place instead of being retyped per list.
 *
 * Usage: bun scripts/__check_page_modes.mjs [--root <dir>]
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

// Overridable so a negative control can point at a fixture tree.
const ROOT = resolve(process.env.MODES_ROOT ?? process.cwd());
const CSS = readFileSync(join(ROOT, 'src/app/globals.css'), 'utf8');
const TABLE = readFileSync(join(ROOT, 'src/components/core/ResponsiveTable.tsx'), 'utf8');

const problems = [];

/** Each entry is a mode and the selectors that prove it exists in the token layer. */
const MODES = [
  { name: 'light', selectors: [':root', '.light {'] },
  { name: 'dark', selectors: ['.dark {'] },
  { name: 'high contrast (light)', selectors: ['.high-contrast {'] },
  { name: 'high contrast (dark)', selectors: ['.dark.high-contrast {'] },
  { name: 'density', selectors: ['html.density-compact'] },
];

for (const mode of MODES) {
  for (const selector of mode.selectors) {
    if (!CSS.includes(selector)) problems.push(`${mode.name}: no rule for \`${selector}\``);
  }
}

/**
 * A mode that exists only in the stylesheet is a mode nobody can reach.
 *
 * This is the defect the gate was blind to: `.high-contrast` was written, measured and shipped,
 * and no control ever applied the class, so the palette was decoration. Each mode therefore names
 * the code that must apply it, and that code is read rather than assumed.
 */
function sourceText(dir, out = '') {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out += sourceText(full);
    else if (/\.(ts|tsx)$/.test(entry)) out += readFileSync(full, 'utf8');
  }
  return out;
}

const SOURCE = sourceText(join(ROOT, 'src'));

const REACHABLE = [
  { mode: 'high contrast', token: "'high-contrast'", applies: 'a control or hook toggles the class' },
  { mode: 'density', token: 'density-compact', applies: 'a control toggles the density class' },
];

for (const { mode, token, applies } of REACHABLE) {
  if (!SOURCE.includes(token)) problems.push(`${mode}: nothing in src/ applies it (${applies})`);
}

// Row height belongs to one constant: two lists that pick their own are already two rhythms.
const rowHeight = /export const ROW_HEIGHT_CLASS = '([^']+)'/.exec(TABLE);
if (!rowHeight) {
  problems.push('row height: ResponsiveTable does not export ROW_HEIGHT_CLASS');
} else {
  const value = rowHeight[1];
  if (!/\bh-10\b/.test(value)) problems.push(`row height: comfortable row height missing from "${value}"`);
  if (!/\bdensity:h-8\b/.test(value)) problems.push(`row height: compact variant missing from "${value}"`);
}

if (problems.length) {
  console.error(`page modes: ${problems.length} problem(s)`);
  for (const line of problems) console.error(`  - ${line}`);
  process.exit(1);
}
console.log(`page modes: OK - ${MODES.length} modes wired, row height from one constant`);
