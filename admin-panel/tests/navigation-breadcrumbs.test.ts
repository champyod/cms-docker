import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import en from '@/dictionaries/en.json';
import th from '@/dictionaries/th.json';
import {
  listBreadcrumbs,
  recordBreadcrumbs,
} from '@/lib/navigation/breadcrumbs';
import { buildRoute } from '@/lib/navigation/routes';
import type { Dictionary } from '@/lib/dictionary';
import type { BreadcrumbItem } from '@/lib/navigation/types';

const LOCALES: readonly (readonly [string, Dictionary])[] = [
  ['en', en],
  ['th', th],
];

const LIST_ROUTE_ID = 'infrastructure.containers' as const;
const RECORD_ROUTE_ID = 'people.user-record' as const;
const RECORD_PARENT_ROUTE_ID = 'people.users' as const;

function labelsOf(crumbs: readonly BreadcrumbItem[]): string[] {
  return crumbs.map((crumb) => crumb.label);
}

function filesUnder(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    return statSync(path).isDirectory() ? filesUnder(path) : [path];
  });
}

function sourceFilesUnder(directory: string): string[] {
  return filesUnder(directory).filter((file) => /\.(ts|tsx)$/.test(file));
}

const BUILDER_CALLS: ReadonlySet<string> = new Set(['listBreadcrumbs', 'recordBreadcrumbs']);
const LOCAL_CRUMB_ARRAY = /\bconst\s+breadcrumbs\b/;
const CRUMB_PROP = /breadcrumbs=\{([^}]*)\}/g;
const BARE_IDENTIFIER = /^[A-Za-z_$][\w$]*$/;

/** A trail is either built by the shared builder or forwarded untouched. */
function handBuiltCrumbProp(source: string): boolean {
  for (const match of source.matchAll(CRUMB_PROP)) {
    const value = (match[1] ?? '').trim();
    if (value.startsWith('[')) return true;
    const call = value.match(/^([A-Za-z]+)\(/);
    if (call) {
      if (!BUILDER_CALLS.has(call[1])) return true;
    } else if (!BARE_IDENTIFIER.test(value)) {
      return true;
    }
  }
  return false;
}

function handBuiltCrumbOffenders(): string[] {
  return sourceFilesUnder('src').filter((file) => {
    const source = readFileSync(file, 'utf8');
    return handBuiltCrumbProp(source) || LOCAL_CRUMB_ARRAY.test(source);
  });
}

function pageTypeOffenders(): string[] {
  // Why only pages: a page decides what its trail says, and the one way to decide
  // that is to name the item type or build the array. A surface client may still
  // declare the prop so it can forward what its page built.
  return sourceFilesUnder(join('src', 'app')).filter((file) =>
    readFileSync(file, 'utf8').includes('BreadcrumbItem'),
  );
}

describe('list breadcrumb trail', () => {
  it.each(LOCALES)('builds Home / <Group> for a module page in %s', (locale, dictionary) => {
    expect(listBreadcrumbs(locale, 'infrastructure', LIST_ROUTE_ID, dictionary)).toEqual([
      { label: dictionary.navigation.home.label, href: `/${locale}` },
      { label: dictionary.navigation.groups.infrastructure },
    ]);
  });

  it.each(LOCALES)('never names the current module page in %s', (locale, dictionary) => {
    const crumbs = listBreadcrumbs(locale, 'infrastructure', LIST_ROUTE_ID, dictionary);

    expect(labelsOf(crumbs)).not.toContain(dictionary.navigation.infrastructure.containers.label);
  });

  it.each(LOCALES)('leaves the group crumb unlinked in %s', (locale, dictionary) => {
    const crumbs = listBreadcrumbs(locale, 'people', 'people.users', dictionary);

    expect(crumbs).toHaveLength(2);
    expect(crumbs[0]?.href).toBe(`/${locale}`);
    expect(crumbs[1]?.href).toBeUndefined();
  });

  it.each(LOCALES)('drops the group crumb for a group boundary in %s', (locale, dictionary) => {
    const crumbs = listBreadcrumbs(locale, 'system', null, dictionary);

    expect(crumbs).toEqual([{ label: dictionary.navigation.home.label, href: `/${locale}` }]);
  });

  it.each(LOCALES)('never names the current route above its own heading in %s', (locale, dictionary) => {
    const crumbs = listBreadcrumbs(locale, 'evaluation', 'evaluation.lanes', dictionary);

    expect(labelsOf(crumbs)).not.toContain(dictionary.navigation.evaluation.lanes.label);
    expect(crumbs.map((crumb) => crumb.href)).not.toContain(buildRoute(locale, 'evaluation.lanes'));
  });

  it.each(LOCALES)('omits the unlabelled group on a direct page in %s', (locale, dictionary) => {
    const crumbs = listBreadcrumbs(locale, 'direct', 'tasks.list', dictionary);

    expect(crumbs).toEqual([{ label: dictionary.navigation.home.label, href: `/${locale}` }]);
  });

  it('fails the render on a page that claims a group it does not belong to', () => {
    expect(() => listBreadcrumbs('en', 'system', 'people.users', en)).toThrow(
      'Route is not in group system: people.users',
    );
  });
});

describe('record breadcrumb trail', () => {
  it.each(LOCALES)('builds Home / <Group> / <List page> for a record in %s', (locale, dictionary) => {
    expect(
      recordBreadcrumbs(locale, 'people', RECORD_ROUTE_ID, RECORD_PARENT_ROUTE_ID, dictionary),
    ).toEqual([
      { label: dictionary.navigation.home.label, href: `/${locale}` },
      { label: dictionary.navigation.groups.people },
      { label: dictionary.navigation.people.users.label },
    ]);
  });

  it.each(LOCALES)('never names the current record in %s', (locale, dictionary) => {
    const crumbs = recordBreadcrumbs(
      locale,
      'people',
      RECORD_ROUTE_ID,
      RECORD_PARENT_ROUTE_ID,
      dictionary,
    );

    // Why the exact list rather than an exclusion: the trail may only be built
    // from the Home route, the group, and the record's parent list, so naming any
    // other route — the record above all — is the failure this pins down. Thai
    // spells the User list and the User record with one word, so an exclusion on
    // that word would delete a legitimate crumb.
    expect(labelsOf(crumbs)).toEqual([
      dictionary.navigation.home.label,
      dictionary.navigation.groups.people,
      dictionary.navigation.people.users.label,
    ]);
    expect(crumbs.map((crumb) => crumb.href)).not.toContain(
      buildRoute(locale, RECORD_ROUTE_ID, { id: 17 }),
    );
  });

  it.each(LOCALES)('closes the record trail on the list page without an href in %s', (locale, dictionary) => {
    const crumbs = recordBreadcrumbs(
      locale,
      'evaluation',
      'evaluation.submission-record',
      'evaluation.submissions',
      dictionary,
    );

    expect(crumbs[crumbs.length - 1]).toEqual({
      label: dictionary.navigation.evaluation.submissions.label,
    });
  });

  it('links only the first crumb of a record trail', () => {
    const crumbs = recordBreadcrumbs('en', 'people', 'people.team-record', 'people.teams', en);

    expect(crumbs.filter((crumb) => crumb.href !== undefined)).toEqual([
      { label: en.navigation.home.label, href: '/en' },
    ]);
  });

  it('fails the render on a record whose parent list is not its own', () => {
    expect(() => recordBreadcrumbs('en', 'people', 'people.team-record', 'people.users', en)).toThrow(
      'Route is not a record of people.users: people.team-record',
    );
  });
});

describe('breadcrumb construction sites', () => {
  it('has no page that hand-builds a breadcrumbs array', () => {
    expect(handBuiltCrumbOffenders()).toEqual([]);
  });

  it('keeps the BreadcrumbItem type out of every page', () => {
    expect(pageTypeOffenders()).toEqual([]);
  });
});
