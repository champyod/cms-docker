#!/usr/bin/env bun
/**
 * Mode-readiness gate.
 *
 * A page can only be measured in light, dark, high contrast and both densities if every colour it
 * paints comes from a token: a literal `#f5f5f5`, a `text-amber-300` or an `rgb(...)` looks the same
 * in all four modes, which means the mode was never really applied to it.
 *
 * Scope is the declared pages and the components they render directly - the surfaces that claim to
 * be on the system. Undeclared pages are debt tracked by the archetype gate, not measured here.
 *
 * Usage: bun scripts/__check_page_modes_per_page.mjs [--update]
 */
import { readdirSync, readFileSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

const ROOT = resolve(process.cwd());
// Every input is overridable: a gate whose fixtures cannot reach its rules cannot be falsified.
const REGISTRY = resolve(
  process.env.PER_PAGE_REGISTRY ?? join(ROOT, 'src/components/patterns/registry.ts')
);
const { PAGE_ARCHETYPE_BY_ROUTE } = await import(REGISTRY);
const PAGES_ROOT = resolve(
  process.env.PER_PAGE_PAGES_ROOT ?? join(ROOT, 'src/app/[locale]/(authenticated)')
);
const BASELINE = resolve(process.env.PER_PAGE_BASELINE ?? join(ROOT, 'scripts/page-mode-baseline.json'));

const RAW_COLOUR = [
  /#[0-9a-fA-F]{3,8}\b/g,
  /\brgba?\(/g,
  /\boklch\(/g,
  /\bhsla?\(/g,
  /\b(?:text|bg|border|ring|fill|stroke)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}\b/g,
];

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (entry === 'page.tsx') out.push(full);
  }
  return out;
}

function strip(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    // class names that merely mention a colour word inside a longer token are not literals
    .replace(/data-[a-z-]+="[^"]*"/g, '');
}

/** Directly imported local components, resolved through the `@/` alias. */
function directComponents(source) {
  const found = [];
  for (const [, spec] of source.matchAll(/from\s+'@\/(components\/[^']+)'/g)) {
    for (const candidate of [`${spec}.tsx`, `${spec}/index.tsx`]) {
      const full = join(ROOT, 'src', candidate);
      if (existsSync(full)) {
        found.push(full);
        break;
      }
    }
  }
  return found;
}

const offenders = {};
const declaredRoutes = Object.entries(PAGE_ARCHETYPE_BY_ROUTE).filter(([, kind]) => kind !== 'redirect');

for (const page of walk(PAGES_ROOT)) {
  const route = `/${relative(PAGES_ROOT, page).replaceAll('\\', '/').replace(/\/?page\.tsx$/, '').replace(/\[([^\]]+)\]/g, ':$1')}`;
  if (!PAGE_ARCHETYPE_BY_ROUTE[route] || PAGE_ARCHETYPE_BY_ROUTE[route] === 'redirect') continue;

  const files = [page, ...directComponents(readFileSync(page, 'utf8'))];
  let hits = 0;
  const places = [];
  for (const file of files) {
    const source = strip(readFileSync(file, 'utf8'));
    for (const pattern of RAW_COLOUR) {
      const matches = [...source.matchAll(pattern)];
      if (matches.length) {
        hits += matches.length;
        places.push(`${relative(ROOT, file).replaceAll('\\', '/')}: ${matches.map((m) => m[0]).slice(0, 3).join(', ')}`);
      }
    }
  }
  if (hits) offenders[route] = { hits, places: places.slice(0, 3) };
}

const total = Object.values(offenders).reduce((sum, entry) => sum + entry.hits, 0);

if (process.argv.includes('--update')) {
  writeFileSync(BASELINE, `${JSON.stringify({ total, routes: offenders }, null, 2)}\n`);
  console.log(`mode readiness: baseline written - ${total} raw colour(s) across ${Object.keys(offenders).length} declared page(s)`);
  process.exit(0);
}

const baseline = existsSync(BASELINE)
  ? JSON.parse(readFileSync(BASELINE, 'utf8'))
  : { total: 0, routes: {} };

const regressions = Object.entries(offenders).filter(
  ([route, entry]) => entry.hits > (baseline.routes[route]?.hits ?? 0)
);

if (regressions.length) {
  console.error(`mode readiness: ${regressions.length} declared page(s) cannot be measured in four modes`);
  for (const [route, entry] of regressions) {
    console.error(`  - ${route}: ${entry.hits} raw colour(s), baseline allows ${baseline.routes[route]?.hits ?? 0}`);
    for (const place of entry.places) console.error(`      ${place}`);
  }
  console.error('  Use a token (var(--primary), text-muted-foreground, ...) so the mode can reach it.');
  process.exit(1);
}

const saved = baseline.total - total;
console.log(
  `mode readiness: OK - ${declaredRoutes.length} declared page(s) paint only tokens` +
    (saved > 0 ? `, ${saved} fewer raw colour(s) than the baseline` : '')
);
