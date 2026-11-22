#!/usr/bin/env bun
/**
 * Banned-character gate.
 *
 * DESIGN.md 19 bans two marks from anything a reader sees: the em dash and the middle dot. Both are
 * allowed inside a source comment, which no reader sees, so this gate skips comment lines and counts
 * every other occurrence.
 *
 * It counts rather than forbids because the panel inherited both marks in reader-visible strings. The
 * baseline may only fall: it is written here, and a run that finds fewer prints the number the baseline
 * can be lowered to.
 *
 * Usage: bun scripts/__check_banned_characters.mjs [--root <dir>]
 * Exit 0 when the count is at or under the baseline, 1 when it is above.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const ROOT = resolve(process.env.BANNED_ROOT ?? process.cwd());
const BASELINE = Number(process.env.BANNED_BASELINE ?? 28);
const BANNED = [
  { mark: '·', name: 'middle dot' },
  { mark: '—', name: 'em dash' },
];

/** A line whose text is a comment: it carries no reader-visible string. */
function isComment(line) {
  const trimmed = line.trimStart();
  return trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*');
}

/**
 * The part of a line a reader can see: everything before a trailing ` // ` comment.
 * Why the spaces: `https://` carries a double slash too, and cutting there would hide a real mark.
 */
function codePart(line) {
  const at = line.indexOf(' // ');
  return at === -1 ? line : line.slice(0, at);
}

/**
 * Tracks a JSX comment block, which opens with `{/*` and closes with `*}` on a later line.
 * Why: the marks inside one are comments, and reading them as copy counted a false positive on a
 * comment that happened to sit on its own line.
 */
function trackJsxComment(line, open) {
  if (!open && line.includes('{/*') && !line.includes('*/}')) return true;
  if (open && line.includes('*/}')) return false;
  return open;
}

function files(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) files(full, out);
    else if (/\.(tsx?|json)$/.test(entry)) out.push(full);
  }
  return out;
}

const hits = [];
for (const file of [...files(join(ROOT, 'src'))]) {
  const lines = readFileSync(file, 'utf8').split('\n');
  let inJsxComment = false;
  lines.forEach((line, index) => {
    const wasInComment = inJsxComment;
    inJsxComment = trackJsxComment(line, inJsxComment);
    if (wasInComment || isComment(line)) return;
    for (const { mark, name } of BANNED) {
      if (codePart(line).includes(mark)) hits.push(`${relative(ROOT, file)}:${index + 1}: ${name}`);
    }
  });
}

if (hits.length > BASELINE) {
  console.error(`banned characters: ${hits.length} in reader-visible text, baseline is ${BASELINE}`);
  for (const hit of hits.slice(0, 25)) console.error(`  - ${hit}`);
  if (hits.length > 25) console.error(`  ... ${hits.length - 25} more`);
  process.exit(1);
}

console.log(
  `banned characters: OK - ${hits.length} in reader-visible text` +
    (hits.length < BASELINE ? `, baseline ${BASELINE} may be lowered to ${hits.length}` : ''),
);
