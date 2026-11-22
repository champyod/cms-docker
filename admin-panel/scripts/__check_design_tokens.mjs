#!/usr/bin/env bun
/**
 * Design-token gate.
 *
 * The token block in src/app/globals.css is the contract decided in
 * admin-panel/DESIGN-PREFERENCE.md. This gate measures that contract instead of trusting it:
 * every text pair must reach 4.5:1, every graphic pair 3:1 (WCAG 1.4.3 and 1.4.11), the type
 * scale must be the 12 x 1.2 chain, and the radius scale must be Carbon's (0 / 2 / 4 / full).
 *
 * Usage: bun scripts/__check_design_tokens.mjs [path-to-css]
 * Exit 0 when the contract holds, 1 when it does not, with one line per violation.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const CSS_PATH = resolve(process.argv[2] ?? 'src/app/globals.css');
const TEXT_MIN = 4.5;
const GRAPHIC_MIN = 3;

const css = readFileSync(CSS_PATH, 'utf8');

/** Pull `--name: value;` pairs out of one top-level rule whose selector list matches. */
function block(selectorRegex) {
  const m = selectorRegex.exec(css);
  if (!m) throw new Error(`block not found: ${selectorRegex}`);
  const body = css.slice(m.index + m[0].length, css.indexOf('}', m.index + m[0].length));
  const out = {};
  for (const [, name, value] of body.matchAll(/--([a-z0-9-]+):\s*([^;]+);/g)) out[name] = value.trim();
  return out;
}

const light = block(/^:root,\s*\n\.light\s*\{/m);
const dark = block(/^\.dark\s*\{/m);
// High contrast is an override layer, so a mode is its base block plus the overrides on top. It is
// measured like any other mode: a palette nobody measures is a palette nobody can claim.
const highContrast = { ...light, ...block(/^\.high-contrast\s*\{/m) };
const darkHighContrast = { ...dark, ...block(/^\.dark\.high-contrast\s*\{/m) };
const MODES = [
  ['light', light],
  ['dark', dark],
  ['high-contrast', highContrast],
  ['dark high-contrast', darkHighContrast],
];

/** sRGB relative luminance for #rgb/#rrggbb; oklch() is not accepted here by design. */
function luminance(value) {
  const hex = value.trim();
  if (!/^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(hex)) {
    throw new Error(`not a hex colour: ${value} (the gate only measures values it can prove)`);
  }
  const h = hex.length === 4 ? hex.slice(1).split('').map((c) => c + c).join('') : hex.slice(1);
  const [r, g, b] = [0, 2, 4].map((i) => {
    const c = parseInt(h.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a, b) {
  const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
}

const TEXT_PAIRS = [
  ['foreground', 'background'],
  ['card-foreground', 'card'],
  ['popover-foreground', 'popover'],
  ['muted-foreground', 'background'],
  ['muted-foreground', 'muted'],
  ['primary-foreground', 'primary'],
  ['secondary-foreground', 'secondary'],
  ['accent-foreground', 'accent'],
  ['destructive-foreground', 'destructive'],
  ['success-foreground', 'success'],
  ['warning-foreground', 'warning'],
  ['info-foreground', 'info'],
];

const GRAPHIC_PAIRS = [
  ['primary', 'background'],
  ['ring', 'background'],
  ['success', 'background'],
  ['warning', 'background'],
  ['info', 'background'],
  ['destructive', 'background'],
];

const REQUIRED = [
  'background', 'foreground', 'card', 'card-foreground', 'popover', 'popover-foreground',
  'primary', 'primary-foreground', 'secondary', 'secondary-foreground', 'muted',
  'muted-foreground', 'accent', 'accent-foreground', 'destructive', 'destructive-foreground',
  'success', 'success-foreground', 'warning', 'warning-foreground', 'info', 'info-foreground',
  'border', 'input', 'ring', 'text-label', 'text-body', 'text-card', 'text-section',
  'text-page', 'text-display', 'motion-fast', 'motion-moderate', 'motion-slow', 'ease-standard',
];

const TYPE_CHAIN = { 'text-label': 12, 'text-body': 14.4, 'text-card': 17.28, 'text-section': 20.74, 'text-page': 24.88, 'text-display': 29.86 };
const RADIUS_ALLOWED = new Set(['0px', '2px', '4px', '9999px']);

const problems = [];
const lines = [];

for (const [mode, tokens] of MODES) {
  for (const name of REQUIRED) {
    if (!(name in tokens)) problems.push(`${mode}: token --${name} is missing`);
  }
  for (const [fg, bg] of TEXT_PAIRS) {
    if (!(fg in tokens) || !(bg in tokens)) continue;
    const c = contrast(tokens[fg], tokens[bg]);
    lines.push(`${mode} text  ${fg} on ${bg}: ${c.toFixed(2)}:1`);
    if (c < TEXT_MIN) problems.push(`${mode}: ${fg} on ${bg} measures ${c.toFixed(2)}:1, below ${TEXT_MIN}:1`);
  }
  for (const [fg, bg] of GRAPHIC_PAIRS) {
    if (!(fg in tokens) || !(bg in tokens)) continue;
    const c = contrast(tokens[fg], tokens[bg]);
    lines.push(`${mode} graphic ${fg} on ${bg}: ${c.toFixed(2)}:1`);
    if (c < GRAPHIC_MIN) problems.push(`${mode}: ${fg} on ${bg} measures ${c.toFixed(2)}:1, below ${GRAPHIC_MIN}:1 for a graphic`);
  }
}

for (const [name, expected] of Object.entries(TYPE_CHAIN)) {
  for (const [mode, tokens] of MODES) {
    const value = tokens[name];
    if (!value) continue;
    const px = Number.parseFloat(value);
    if (Math.abs(px - expected) > 0.01) {
      problems.push(`${mode}: ${name} is ${value}, the 12 x 1.2 chain gives ${expected}px`);
    }
  }
}

for (const [, name, value] of css.matchAll(/--(radius(?:-[a-z0-9]+)?):\s*([^;]+);/g)) {
  const v = value.trim();
  if (RADIUS_ALLOWED.has(v) || v.startsWith('calc')) continue;
  problems.push(`radius: --${name} is ${v}; Carbon's scale allows only ${[...RADIUS_ALLOWED].join(', ')}`);
}

if (process.env.DESIGN_GATE_VERBOSE) console.log(lines.join('\n'));

if (problems.length) {
  console.error(`design tokens: ${problems.length} problem(s) in ${CSS_PATH}`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log(`design tokens: OK - ${lines.length} measured pairs, ${Object.keys(TYPE_CHAIN).length} type steps, radius scale clean`);
