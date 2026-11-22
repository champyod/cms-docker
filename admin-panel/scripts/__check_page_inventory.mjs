#!/usr/bin/env bun
/**
 * Page-inventory gate.
 *
 * The inventory is what stops a layout from being a coat of paint: a page may only declare a
 * layout once it can say which facts it supplies. This gate holds three lines:
 *
 *   1. every page that renders a surface has a row in PAGE-INVENTORY.md
 *   2. a page whose layout is declared in the registry must have its facts written
 *   3. the number of rows still marked "to inventory" may only fall
 *
 * Usage: bun scripts/__check_page_inventory.mjs [--update]
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const ROOT = resolve(process.cwd());
// Overridable so a negative control can exercise the registry rules against a fixture.
const REGISTRY = resolve(
  process.env.INVENTORY_REGISTRY ?? join(ROOT, 'src/components/patterns/registry.ts')
);
const { PAGE_ARCHETYPE_BY_ROUTE } = await import(REGISTRY);
const PAGES_ROOT = resolve(
  process.env.INVENTORY_PAGES_ROOT ?? join(ROOT, 'src/app/[locale]/(authenticated)')
);
const DOC = resolve(process.env.INVENTORY_DOC ?? join(ROOT, 'PAGE-INVENTORY.md'));
const BASELINE = resolve(process.env.INVENTORY_BASELINE ?? join(ROOT, 'scripts/page-inventory-baseline.json'));

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (entry === 'page.tsx') out.push(full);
  }
  return out;
}

const routes = walk(PAGES_ROOT).map((file) =>
  `/${relative(PAGES_ROOT, file).replaceAll('\\', '/').replace(/\/?page\.tsx$/, '').replace(/\[([^\]]+)\]/g, ':$1')}`
    .replace(/^\/$/, '/')
);
const contentRoutes = routes.filter((route) => PAGE_ARCHETYPE_BY_ROUTE[route] !== 'redirect');

const doc = readFileSync(DOC, 'utf8');
const rows = new Map();
for (const line of doc.split('\n')) {
  const match = /^\|\s*`([^`]+)`\s*\|\s*([a-z]+)\s*\|\s*(.*?)\s*\|\s*$/.exec(line);
  if (match) rows.set(match[1], { archetype: match[2], facts: match[3] });
}

const problems = [];
const undocumented = [];

for (const route of contentRoutes) {
  const row = rows.get(route);
  if (!row) {
    undocumented.push(route);
    problems.push(`${route} renders a surface but has no row in PAGE-INVENTORY.md`);
    continue;
  }
  if (row.facts === '— *to inventory*' || row.facts.length === 0) {
    undocumented.push(route);
    if (PAGE_ARCHETYPE_BY_ROUTE[route]) {
      problems.push(`${route} declares the "${PAGE_ARCHETYPE_BY_ROUTE[route]}" layout but its facts are not inventoried`);
    }
  }
}

const stale = [...rows.keys()].filter((route) => !routes.includes(route));
for (const route of stale) problems.push(`PAGE-INVENTORY.md lists ${route}, which has no page`);

if (process.argv.includes('--update')) {
  writeFileSync(BASELINE, `${JSON.stringify({ undocumented: undocumented.sort() }, null, 2)}\n`);
  console.log(`page inventory: baseline written with ${undocumented.length} of ${contentRoutes.length} pages undocumented`);
  process.exit(0);
}

const baseline = JSON.parse(readFileSync(BASELINE, 'utf8'));
const allowed = new Set(baseline.undocumented);
for (const route of undocumented) {
  if (!allowed.has(route)) problems.push(`${route} became undocumented (new page, or a row was removed)`);
}

if (problems.length) {
  console.error(`page inventory: ${problems.length} problem(s)`);
  for (const line of problems.slice(0, 20)) console.error(`  - ${line}`);
  if (problems.length > 20) console.error(`  ... ${problems.length - 20} more`);
  process.exit(1);
}

const progress = baseline.undocumented.length - undocumented.length;
const documented = contentRoutes.length - undocumented.length;
console.log(
  `page inventory: OK - ${documented} of ${contentRoutes.length} pages documented` +
    (progress > 0 ? `, ${progress} more than the baseline` : '')
);
