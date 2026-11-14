import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { NAVIGATION_GROUPS, ROUTE_REGISTRY } from '@/lib/navigation/registry';

/**
 * The manifest is the product's promise: every entry is a link the sidebar draws and a URL the URL
 * bar can be typed into. So it has to be true in both directions — a route with no page is a dead
 * link (the 404 the operator hit on the landing), and a page with no route is unreachable work.
 *
 * WHY filesystem assertions rather than reading registry source with a regex: the descriptors are
 * built by helpers (`directPageRoute`, `recordRoute`) and spread across five modules, so a regex
 * over the text silently misses the multi-line ones — it produced a 45-route false alarm when this
 * check was first attempted by hand. Importing the objects cannot drift from them.
 */

const PANEL_ROOT = path.resolve(__dirname, '..');
const APP = path.join(PANEL_ROOT, 'src/app/[locale]');
const ROUTE_GROUPS = ['(authenticated)'] as const;

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

/** Where a route path would live on disk, in any of the layout groups it could belong to. */
function candidatesFor(routePath: string): string[] {
  const rel = routePath === '/' ? '' : routePath.replace(/^\//, '');
  return ROUTE_GROUPS.flatMap((group) => [
    path.join(APP, group, rel, 'page.tsx'),
    path.join(APP, group, rel, 'route.ts'),
    path.join(APP, rel, 'page.tsx'),
    path.join(APP, rel, 'route.ts'),
  ]);
}

describe('every route the manifest names has a page behind it', () => {
  it('resolves each descriptor path to a page or route file', () => {
    const missing = ROUTE_REGISTRY.filter(
      (route) => !candidatesFor(route.path).some((candidate) => fs.existsSync(candidate)),
    ).map((route) => `${route.id} → ${route.path}`);

    // A registry entry with no page is a link that 404s — the exact class of defect that put a 404
    // on the landing page for every admin without the wildcard grant.
    expect(missing).toEqual([]);
  });

  it('gives no two routes the same path', () => {
    const seen = new Map<string, string[]>();
    for (const route of ROUTE_REGISTRY) {
      seen.set(route.path, [...(seen.get(route.path) ?? []), route.id]);
    }
    const collisions = [...seen.entries()]
      .filter(([, ids]) => ids.length > 1)
      .map(([routePath, ids]) => `${routePath}: ${ids.join(', ')}`);
    // Two descriptors on one path means one permission set silently wins over the other.
    expect(collisions).toEqual([]);
  });

  it('names only routes it defines, from groups the sidebar can order', () => {
    const ids = new Set(ROUTE_REGISTRY.map((route) => route.id));
    for (const group of NAVIGATION_GROUPS) {
      for (const id of group.routeIds) expect(ids.has(id), `${group.id} → ${id}`).toBe(true);
    }
  });
});

/**
 * True when the file defines nothing — it only forwards another module's exports.
 *
 * WHY counts of keywords instead of parsing: the question is narrow ("does this file introduce a
 * second definition?"), and a shim that ever grows a `const`, a `function` or a JSX element is no
 * longer a shim. The check is deliberately blunt in that direction.
 */
function isPureReExport(file: string): boolean {
  const code = fs
    .readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//') && !line.trim().startsWith("'use client'"))
    .join('\n');
  const forwards = /export\s*\{[\s\S]*\}\s*from\s*'[^']+'/.test(code);
  const defines = /\b(const|let|var|function|class|interface|enum)\b/.test(code) ||
    /=>|return\s*\(|<[A-Z]/.test(code);
  return forwards && !defines;
}

describe('no component is defined twice', () => {
  it('keeps every component basename unique under src/components', () => {
    const byName = new Map<string, string[]>();
    for (const file of walk(path.join(PANEL_ROOT, 'src/components'))) {
      if (!file.endsWith('.tsx') && !file.endsWith('.ts')) continue;
      const name = path.basename(file);
      if (name === 'index.ts' || name === 'index.tsx') continue;
      byName.set(name, [...(byName.get(name) ?? []), path.relative(PANEL_ROOT, file)]);
    }
    const duplicates = [...byName.entries()]
      .filter(([, files]) => files.length > 1)
      .map(([name, files]) => `${name}: ${files.join(' | ')}`);
    // The operator's bar: no per-page copy of a component that already exists. A second file with
    // the same basename is how that starts, and it is invisible once both are imported.
    //
    // WHY a re-export is allowed and a clone is not: a shim that only forwards another module's
    // exports keeps ONE definition while old import paths keep working (the core boundary forbids
    // core from importing a feature folder, so the shim lives on the feature side). A file with its
    // own definitions is a second source of truth and is what this test refuses.
    // The invariant: one file defines, the rest only forward. Two files that both define is a
    // second source of truth, whichever order the filesystem lists them in.
    const clones = duplicates.filter((entry) => {
      const files = entry.split(': ')[1].split(' | ').map((file) => path.join(PANEL_ROOT, file));
      return files.filter((file) => !isPureReExport(file)).length > 1;
    });
    expect(clones).toEqual([]);
  });
});
