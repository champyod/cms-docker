import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { LEGACY_REDIRECT_RULES } from '@/lib/navigation/redirects';
import { ROUTE_REGISTRY } from '@/lib/navigation/registry';
import { SUPPORTED_LOCALES } from '@/lib/locales';

// WHY this asserts on source text rather than on a rendered page: a link that names a route with
// no page behind it is invisible until a reader clicks it, and the app has one page tree — so the
// check is that no file names a path outside it. The oracle is the filesystem, not the manifest,
// because the manifest covers the authenticated routes only while links may also lead to the
// public ones (sign-in) and to the locale root.

const SRC = 'src';
const PAGE_ROOT = 'src/app/[locale]';

/** Every in-app target a file can state as a literal: a link, a push, a replace, a redirect. */
const LITERAL_TARGET = /(?:href=|router\.(?:push|replace)\(|redirect\()\s*["'`](\/(?:\$\{[^}]*\}|[^"'`{}])*)/g;

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(absolute);
    return entry.isFile() && /\.(ts|tsx)$/.test(entry.name) ? [absolute] : [];
  });
}

/** The page suffixes the app serves, such as `auth/login` and `people/users/[id]`. */
function pageSuffixes(directory: string, prefix = ''): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isDirectory()) {
      const nested = prefix === '' && entry.name.startsWith('(') ? prefix : `${prefix}${entry.name}/`;
      return pageSuffixes(join(directory, entry.name), nested);
    }
    return entry.name === 'page.tsx' ? [prefix.replace(/\/$/, '')] : [];
  });
}

const PAGES = pageSuffixes(PAGE_ROOT);

/** A page segment `[id]` stands for whatever a link states, so compare segment by segment. */
function hasPage(suffix: string): boolean {
  const stated = suffix === '' ? [] : suffix.split('/');
  return PAGES.some((page) => {
    const served = page === '' ? [] : page.split('/');
    return served.length === stated.length
      && served.every((segment, index) => segment === stated[index] || /^\[.+\]$/.test(segment));
  });
}

describe('in-app link targets', () => {
  it('names a declared route id at every buildRoute call site', () => {
    const declared = new Set<string>(ROUTE_REGISTRY.map((route) => route.id));
    const offenders: string[] = [];
    for (const file of sourceFiles(SRC)) {
      for (const match of readFileSync(file, 'utf8').matchAll(/buildRoute\(\s*[^,]+,\s*'([^']+)'/g)) {
        if (!declared.has(match[1])) offenders.push(`${file}: ${match[1]}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('points every literal in-app target at a page the app serves or a declared legacy path', () => {
    const legacy = new Set([
      ...ROUTE_REGISTRY.flatMap((route) => route.legacyPaths),
      ...LEGACY_REDIRECT_RULES.map((rule) => rule.path),
    ]);
    const offenders: string[] = [];
    for (const file of sourceFiles(SRC)) {
      for (const match of readFileSync(file, 'utf8').matchAll(LITERAL_TARGET)) {
        // A `${...}` is a locale or an id the file supplies at run time; the check is on the path.
        const segments = match[1].replace(/\$\{[^}]*\}/g, '*').split('/').filter(Boolean);
        const rooted = segments[0] === '*' || (SUPPORTED_LOCALES as readonly string[]).includes(segments[0])
          ? segments.slice(1)
          : segments;
        if (hasPage(rooted.join('/')) || legacy.has(match[1])) continue;
        offenders.push(`${file}: ${match[1]}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
