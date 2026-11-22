#!/usr/bin/env bun
/**
 * Page-archetype discrepancy gate.
 *
 * Five archetypes exist so that 76 pages share a structure instead of each drawing its own. That
 * only holds if a page's declaration and its code agree, so this gate reads
 * src/components/patterns/registry.ts and the page files:
 *
 *   1. a route declared in the registry must render the archetype component for its kind
 *   2. a route that is not declared is counted debt, and the count may only fall
 *
 * Usage: bun scripts/__check_page_archetypes.mjs [--update]
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const ROOT = resolve(process.cwd());
// Both the tree and the registry are overridable so a negative control runs against a throwaway
// fixture tree instead of leaving probe pages inside the repository.
const REGISTRY = resolve(
  process.env.ARCHETYPES_REGISTRY ?? join(ROOT, 'src/components/patterns/registry.ts')
);
const { ARCHETYPE_COMPONENT, PAGE_ARCHETYPE_BY_ROUTE } = await import(REGISTRY);

const PAGES_ROOT = resolve(
  process.env.ARCHETYPES_PAGES_ROOT ?? join(ROOT, 'src/app/[locale]/(authenticated)')
);
const BASELINE = resolve(process.env.ARCHETYPES_BASELINE ?? join(ROOT, 'scripts/page-archetypes-baseline.json'));

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (entry === 'page.tsx') out.push(full);
  }
  return out;
}

function routeFor(file) {
  const rel = relative(PAGES_ROOT, file).replaceAll('\\', '/');
  const withoutFile = rel.replace(/\/?page\.tsx$/, '');
  if (!withoutFile) return '/';
  return `/${withoutFile.replace(/\[([^\]]+)\]/g, ':$1')}`;
}

const pages = walk(PAGES_ROOT).map((file) => ({ file, route: routeFor(file) }));
const declared = [];
const undeclared = [];
const problems = [];

for (const page of pages) {
  const kind = PAGE_ARCHETYPE_BY_ROUTE[page.route];
  if (!kind) {
    undeclared.push(page.route);
    continue;
  }
  const component = ARCHETYPE_COMPONENT[kind];
  const source = readFileSync(page.file, 'utf8');
  const importsIt = new RegExp(`import\\s*\\{[^}]*\\b${component}\\b[^}]*\\}\\s*from\\s*'@/components/patterns/`).test(source);
  const rendersIt = new RegExp(`<${component}[\\s>]`).test(source);
  if (!importsIt || !rendersIt) {
    problems.push(`${page.route} declares "${kind}" but does not render <${component}>`);
    continue;
  }
  declared.push(`${page.route} -> ${kind}`);
}

// A declared route with no page file is a stale declaration, which is its own kind of drift.
const routesOnDisk = new Set(pages.map((p) => p.route));
for (const route of Object.keys(PAGE_ARCHETYPE_BY_ROUTE)) {
  if (!routesOnDisk.has(route)) problems.push(`registry declares ${route}, but no page.tsx exists`);
}

if (process.argv.includes('--update')) {
  writeFileSync(BASELINE, `${JSON.stringify({ undeclared: undeclared.sort() }, null, 2)}\n`);
  console.log(`page archetypes: baseline written with ${undeclared.length} undeclared of ${pages.length} pages`);
  process.exit(0);
}

const baseline = JSON.parse(readFileSync(BASELINE, 'utf8'));
const allowed = new Set(baseline.undeclared);
for (const route of undeclared) {
  if (!allowed.has(route)) problems.push(`${route} has no archetype and is not in the baseline (new page, or a route renamed)`);
}

if (problems.length) {
  console.error(`page archetypes: ${problems.length} problem(s)`);
  for (const line of problems) console.error(`  - ${line}`);
  console.error('  Declare the route in src/components/patterns/registry.ts and render its archetype component.');
  process.exit(1);
}

const progress = baseline.undeclared.length - undeclared.length;
console.log(
  `page archetypes: OK - ${declared.length} declared, ${undeclared.length} undeclared of ${pages.length} pages` +
    (progress > 0 ? `, ${progress} fewer than the baseline` : '')
);
