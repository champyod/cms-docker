import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// A `'use server'` module may only export async functions. A runtime value (a
// re-exported constant, an object) is not a server action, and Next rejects the
// module — the route that imports it then fails instead of rendering.
const SRC = path.resolve(__dirname, '../src');

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(full));
    else if (entry.isFile() && (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx'))) out.push(full);
  }
  return out;
}

const ALLOWED_EXPORT = /^export (async function|function|type|interface|enum|default async function|default function|\* )/;

function offendingExports(file: string): string[] {
  const source = readFileSync(file, 'utf8');
  if (!/^\s*['"]use server['"]/.test(source)) return [];
  return source
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('export ') && !ALLOWED_EXPORT.test(line));
}

describe("'use server' modules", () => {
  it('export only async functions', () => {
    const offenders = sourceFiles(SRC)
      .map((file) => ({ file: path.relative(SRC, file), lines: offendingExports(file) }))
      .filter((entry) => entry.lines.length > 0);
    expect(offenders).toEqual([]);
  });
});
