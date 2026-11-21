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

/**
 * Every in-app target a file can state as a literal: a link, a push, a replace, a redirect.
 *
 * WHY the optional brace and the alternation on the first character: `href={"/x"}` and
 * `href={`/${locale}/x`}` are the two most idiomatic Next link shapes, and the first version of
 * this pattern matched neither — it required the quote to follow `href=` directly and the path to
 * begin with a slash, so a hard-coded dead link in either shape passed silently. A target may
 * therefore open with a brace, and may begin with the `${...}` a file interpolates its locale into
 * (the normalisation below already reads a leading interpolation as the locale slot).
 *
 * WHY the navigator is named rather than `\w+\.`: `Array.prototype.push` is called on every list in
 * this codebase, so a pattern that read `anything.push("...")` as a link would fail on this test's
 * own source before it ever caught a real dead link.
 */
const LITERAL_TARGET = /(?:href=|(?:router|history|navigation)\.(?:push|replace)\(|redirect\()\s*\{?\s*["'`]((?:\/|\$\{)[^"'`]*)/g;

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

/** The targets in one source text that name no page the app serves and no declared legacy path. */
function unresolvedTargets(source: string, legacy: ReadonlySet<string>): string[] {
  const offenders: string[] = [];
  for (const match of source.matchAll(LITERAL_TARGET)) {
    // A `${...}` is the locale, an id or a whole path the file computed at run time, and a
    // `#fragment` or `?query` is not part of the path — so the check runs on what remains.
    const target = match[1].replace(/\$\{[^}]*\}/g, '*').replace(/[#?].*$/, '');
    // An interpolation this pattern could not close — a computed path, or an expression with a
    // quote inside it — names nothing the filesystem can resolve: there is no claim to check.
    if (target.includes('${')) continue;
    const segments = target.split('/').filter(Boolean);
    // A leading locale or a leading interpolation is not a segment of the app's tree, so the
    // check starts after it. Nothing left to check is not a failure: the target names no
    // segment the filesystem could resolve.
    const rooted = segments[0] === '*' || (SUPPORTED_LOCALES as readonly string[]).includes(segments[0])
      ? segments.slice(1)
      : segments;
    if (rooted.length === 0) continue;
    if (hasPage(rooted.join('/')) || legacy.has(match[1])) continue;
    offenders.push(match[1]);
  }
  return offenders;
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
    const offenders = sourceFiles(SRC).flatMap((file) =>
      unresolvedTargets(readFileSync(file, 'utf8'), legacy).map((target) => `${file}: ${target}`),
    );
    expect(offenders).toEqual([]);
  });

  it('reads the idiomatic link shapes, and never an array push', () => {
    const targets = (source: string): string[] =>
      [...source.matchAll(LITERAL_TARGET)].map((match) => match[1]);

    expect(targets('href="/system/docs"')).toEqual(['/system/docs']);
    // The two shapes the first version of this pattern missed: the braced literal and the
    // template literal whose first segment is the locale.
    expect(targets('href={"/system/docs"}')).toEqual(['/system/docs']);
    expect(targets('href={`/${locale}/system/docs`}')).toEqual(['/${locale}/system/docs']);
    expect(targets("router.push('/system/docs')")).toEqual(['/system/docs']);
    expect(targets("navigation.replace('/system/docs')")).toEqual(['/system/docs']);
    expect(targets('redirect("/system/docs")')).toEqual(['/system/docs']);
    // An array's `push` takes the same shape and is not a link, which is why the navigators are
    // named: this pattern is matched against this very file.
    expect(targets('offenders.push(`${file}: ${match[1]}`)')).toEqual([]);
  });

  it('flags a target the app does not serve, in every shape it reads', () => {
    const nothing = new Set<string>();

    // The negative control for the widened pattern: a dead link is caught in the braced and the
    // template shape, not only in the bare literal the first version could read.
    expect(unresolvedTargets('href="/system/nonexistent-page"', nothing))
      .toEqual(['/system/nonexistent-page']);
    expect(unresolvedTargets('href={"/system/nonexistent-page"}', nothing))
      .toEqual(['/system/nonexistent-page']);
    expect(unresolvedTargets('href={`/${locale}/system/nonexistent-page`}', nothing))
      .toEqual(['/${locale}/system/nonexistent-page']);
    // And a target the app does serve is not one.
    expect(unresolvedTargets('href="/system/docs"', nothing)).toEqual([]);
    expect(unresolvedTargets('href={`/${locale}/people/users/${id}`}', nothing)).toEqual([]);
  });
});
