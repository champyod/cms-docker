#!/usr/bin/env bun
/**
 * Token-coverage gate.
 *
 * The chain that lets a page claim to be measured in four modes is:
 *   tokens are measured in every mode  ->  primitives use only measured tokens  ->  pages use only primitives.
 * The first link is the token gate, the third is the mode-readiness gate. This is the second: a
 * colour utility naming a token that does not exist, or a raw palette class inside a primitive,
 * silently escapes every measurement because there is nothing to measure.
 *
 * Usage: bun scripts/__check_token_coverage.mjs [--root <dir>]
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const ROOT = resolve(process.env.COVERAGE_ROOT ?? process.cwd());
const CSS = readFileSync(join(ROOT, 'src/app/globals.css'), 'utf8');
const CORE = join(ROOT, 'src/components/core');

/** Colour utilities Tailwind generates from a token: bg-<token>, text-<token>, border-<token>, ... */
const COLOUR_UTILITY = /\b(?:bg|text|border|ring|fill|stroke|from|via|to|outline|divide|accent|caret|decoration)-(?!\[)([a-z][a-z0-9-]*)\b/g;
/** Classes that are structure or state, not colour, and share the same prefix space. */
const NOT_A_TOKEN = new Set([
  'left', 'right', 'center', 'justify', 'start', 'end', 'top', 'bottom', 'baseline', 'middle',
  'wrap', 'nowrap', 'balance', 'pretty', 'ellipsis', 'clip', 'xs', 'sm', 'base', 'lg', 'xl', '2xl', '3xl',
  'none', 'auto', 'inherit', 'current', 'transparent', 'white', 'black', 'full', 'min', 'max', 'fit',
  'hidden', 'solid', 'dashed', 'dotted', 'double', 'collapse', 'separate', 'spacing', 'offset',
  'shadow', 'opacity', 'blur', 'b', 't', 'l', 'r', 'x', 'y', 's', 'e', '0', '1', '2', '4', '8',
  'open', 'closed', 'first', 'last', 'odd', 'even', 'in', 'out', 'placeholder', 'selection',
  'offset', 'reveal', 'inherit-colour',
]);
const PALETTE = /^(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}$/;

/** Every `--name:` the stylesheet defines, in any block. */
const DEFINED = new Set([...CSS.matchAll(/--([a-z0-9-]+):/g)].map((m) => m[1]));

function files(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) files(full, out);
    else if (/\.(tsx?|mjs)$/.test(entry)) out.push(full);
  }
  return out;
}

const problems = [];
let checked = 0;

// A size must name a step of the one ladder (DESIGN.md 20). `text-[13px]` and `text-3xl` are the two
// ways to leave it: one writes a number, the other reaches past the sixth step into Tailwind's
// defaults. Both are counted rather than forbidden, because the four sites left are display numbers
// larger than the top step (a 404 numeral, a gauge value, a status glyph) and each needs its own
// decision. Nothing below 12px remains: the operator raised the nine 10px labels onto text-xs.
const OFF_LADDER = /text-(?:\[[0-9.]+(?:px|rem)\]|(?:3xl|4xl|5xl|6xl|7xl|8xl|9xl))/g;
const LADDER_BASELINE = 4;

for (const file of files(CORE)) {
  const source = readFileSync(file, 'utf8');
  for (const [, token] of source.matchAll(COLOUR_UTILITY)) {
    if (NOT_A_TOKEN.has(token) || /^[a-z]?-?\d/.test(token)) continue;
    if (/^(?:offset|opacity|shadow|blur)-?\d/.test(token)) continue;
    // `text-page` is a type step, not a colour: the scale lives in --text-<name>.
    if (DEFINED.has(`text-${token}`) && !DEFINED.has(token)) continue;
    checked += 1;
    if (PALETTE.test(token)) {
      problems.push(`${relative(ROOT, file)}: "${token}" is a palette colour; a primitive must use a token`);
      continue;
    }
    // bg-background maps to --background; bg-muted-foreground to --muted-foreground.
    if (!DEFINED.has(token) && !DEFINED.has(`color-${token}`)) {
      problems.push(`${relative(ROOT, file)}: "${token}" is not a token the stylesheet defines`);
    }
  }
}

const offLadder = [];
for (const file of files(join(ROOT, 'src'))) {
  const source = readFileSync(file, 'utf8');
  for (const [hit] of source.matchAll(OFF_LADDER)) {
    offLadder.push(`${relative(ROOT, file)}: ${hit}`);
  }
}
if (offLadder.length > LADDER_BASELINE) {
  problems.push(`type ladder: ${offLadder.length} sizes off the ladder, baseline is ${LADDER_BASELINE}`);
  for (const hit of offLadder.slice(0, 10)) problems.push(`  ${hit}`);
} else if (offLadder.length < LADDER_BASELINE) {
  console.log(`type ladder: ${offLadder.length} off the ladder, baseline ${LADDER_BASELINE} may be lowered to ${offLadder.length}`);
}

if (problems.length) {
  console.error(`token coverage: ${problems.length} problem(s) across the primitives`);
  for (const problem of [...new Set(problems)].slice(0, 20)) console.error(`  - ${problem}`);
  process.exit(1);
}

console.log(`token coverage: OK - ${checked} colour utilities across the primitives name defined tokens`);
