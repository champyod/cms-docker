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

/**
 * The layout owns the page's headings and its cards.
 *
 * A page that writes its own `<h2>` or imports Card is drawing structure of its own - the reason the
 * layouts exist - and it will disagree with the next page about which level a section title is.
 */
const OWNED_BY_LAYOUT = [

  { pattern: /<h[1-3][\s>]/, rule: 'renders its own heading (the layout owns the page heading levels)' },
  { pattern: /variant="h1"/, rule: 'renders a heading through the text primitive' },
  { pattern: /from '@\/components\/core\/Card'/, rule: 'imports Card (a page supplies facts, the layout supplies the card)' },
];

const problems = [];

/**
 * A page either names itself or is named by its shell.
 *
 * `ownsHeader={false}` with a title is a prop the layout never renders - the shell takes the name
 * from the navigation registry. The title slot became optional once this was noticed; these pages
 * still pass one, and the count may only fall, one page per session.
 */
// Ceilings are overridable so a fixture can prove the ratchet fails when a page adds one back.
const ceiling = (prop, fallback) => Number(process.env[`SHELL_DEBT_${prop.toUpperCase()}`] ?? fallback);
const SHELL_OWNED_PROPS = [
  { prop: 'title', pattern: /ownsHeader=\{false\}[^>]*title=/s, ceiling: ceiling('title', 34) },
  { prop: 'description', pattern: /ownsHeader=\{false\}[^>]*description=/s, ceiling: ceiling('description', 2) },
];
const shellOwnedDebt = new Map(SHELL_OWNED_PROPS.map((entry) => [entry.prop, []]));

for (const page of pages) {
  const kind = PAGE_ARCHETYPE_BY_ROUTE[page.route];
  if (!kind) {
    undeclared.push(page.route);
    continue;
  }
  const source = readFileSync(page.file, 'utf8');

  for (const entry of SHELL_OWNED_PROPS) {
    if (entry.pattern.test(source)) shellOwnedDebt.get(entry.prop).push(page.route);
  }

  // A layout whose required content slot is an empty literal renders a frame over nothing, which
  // reads as a page that failed rather than one whose subject does not exist yet. The page must say
  // why in its state.
  const emptySlot = /(?:sections|facts|groups|modes)=\{\s*\[\s*\]\s*\}/.exec(source);
  if (emptySlot && !/\bstate=/.test(source)) {
    problems.push(`${page.route} passes an empty ${emptySlot[0].split('=')[0]} and no state to say why`);
  }

  // A declared page supplies facts to its layout; headings and cards are the layout's.
  for (const { pattern, rule } of OWNED_BY_LAYOUT) {
    if (pattern.test(source)) problems.push(`${page.route} ${rule}`);
  }

  // A redirect owns no surface: it must forward, and it must not render a page shell of its own.
  if (kind === 'redirect') {
    if (!/resolveLegacyRedirect|redirect\(/.test(source)) {
      problems.push(`${page.route} declares "redirect" but does not forward anywhere`);
    } else if (/<PageSurface|<ListPage|<DetailPage|<SettingsPage|<DashboardPage/.test(source)) {
      problems.push(`${page.route} declares "redirect" but renders a page surface`);
    } else {
      declared.push(`${page.route} -> redirect`);
    }
    continue;
  }

  const component = ARCHETYPE_COMPONENT[kind];
  const importsIt = new RegExp(`import\\s*\\{[^}]*\\b${component}\\b[^}]*\\}\\s*from\\s*'@/components/patterns/`).test(source);
  const rendersIt = new RegExp(`<${component}[\\s>]`).test(source);
  if (!importsIt || !rendersIt) {
    problems.push(`${page.route} declares "${kind}" but does not render <${component}>`);
    continue;
  }

  // Five module groups render the title, the description and the trail in their own shell. A page
  // inside one of them must not render the identity again, so it says so explicitly.
  const MODULE_GROUPS = ['/ranking', '/administration', '/security', '/infrastructure', '/system'];
  if (MODULE_GROUPS.some((group) => page.route === group || page.route.startsWith(`${group}/`))) {
    if (!/ownsHeader=\{false\}/.test(source)) {
      problems.push(`${page.route} sits under a module shell but does not pass ownsHeader={false} to <${component}>`);
      continue;
    }
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

for (const entry of SHELL_OWNED_PROPS) {
  const debt = shellOwnedDebt.get(entry.prop);
  if (debt.length > entry.ceiling) {
    problems.push(
      `${debt.length} pages pass a ${entry.prop} the shell owns, above the ${entry.ceiling} this branch inherited`
    );
  }
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
    (progress > 0 ? `, ${progress} fewer than the baseline` : '') +
    [...shellOwnedDebt]
      .filter(([, debt]) => debt.length > 0)
      .map(([prop, debt]) => `, ${debt.length} page(s) still pass a ${prop} their shell owns`)
      .join('')
);
