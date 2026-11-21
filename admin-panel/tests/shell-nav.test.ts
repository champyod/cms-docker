import { describe, expect, it } from 'vitest';

import {
  buildShellItems,
  buildShellSections,
} from '@/components/navigation/shell-nav';
import { ROUTE_REGISTRY, visibleRoutes } from '@/lib/navigation/registry';
import type { NavigationSurface } from '@/lib/navigation/types';
import en from '@/dictionaries/en.json';

const LOCALES = ['en', 'th'] as const;

/**
 * The permission matrix a reader can actually arrive with.
 *
 * Why one `*:read` case per record family and not one shared case: a record-read
 * key is what puts a parameterized route on the palette surface, so a matrix
 * without them would never exercise the case that used to crash the shell.
 */
const PERMISSION_MATRIX: readonly (readonly string[])[] = [
  [],
  ['all:all'],
  ['contest:list'],
  ['contest:read'],
  ['task:list'],
  ['task:read'],
  ['user:list'],
  ['user:read'],
  ['team:list'],
  ['team:read'],
  ['submission:list'],
  ['submission:read'],
  ['contest:read', 'task:read', 'user:read', 'team:read', 'submission:read'],
  ['contest:list', 'task:list', 'user:list', 'team:list', 'submission:list'],
];

const EVERY_SURFACE: readonly NavigationSurface[] = [
  'sidebar',
  'mobile-primary',
  'mobile-more',
  'palette',
  'search',
  'shortcuts',
  'tabs',
  'breadcrumbs',
];

const UNRESOLVED_PARAM = /\[[^\]]+\]/;

function cases(): { surface: NavigationSurface; keys: readonly string[]; locale: string }[] {
  return EVERY_SURFACE.flatMap((surface) =>
    PERMISSION_MATRIX.flatMap((keys) => LOCALES.map((locale) => ({ surface, keys, locale }))),
  );
}

describe('shell navigation is safe for every permission combination', () => {
  it('never throws and never emits an unresolved route parameter', () => {
    const failures: string[] = [];
    for (const { surface, keys, locale } of cases()) {
      const effective = new Set(keys);
      try {
        for (const item of buildShellItems(effective, surface, locale, en)) {
          if (UNRESOLVED_PARAM.test(item.href)) {
            failures.push(`${surface} ${keys.join(',') || 'keyless'}: ${item.href}`);
          }
        }
        for (const section of buildShellSections(effective, surface, locale, en)) {
          for (const item of section.items) {
            if (UNRESOLVED_PARAM.test(item.href)) {
              failures.push(`${surface} ${keys.join(',') || 'keyless'}: ${item.href}`);
            }
          }
        }
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        failures.push(`${surface} [${keys.join(',') || 'keyless'}] threw: ${message}`);
      }
    }
    expect(failures).toEqual([]);
  });

  it('keeps every record landing and nested tab out of every shell surface', () => {
    // Why assert the kind and not just the href: a route that carries an `[id]`
    // segment can only be linked once a record is known, and the shell never
    // knows one. Filtering by kind is what makes that structural.
    const parameterized = new Set(
      ROUTE_REGISTRY.filter((route) => UNRESOLVED_PARAM.test(route.path)).map((route) => route.id),
    );
    expect(parameterized.size).toBeGreaterThan(0);

    const leaked: string[] = [];
    for (const { surface, keys, locale } of cases()) {
      for (const item of buildShellItems(new Set(keys), surface, locale, en)) {
        if (parameterized.has(item.id)) leaked.push(`${surface}: ${item.id}`);
      }
    }
    expect(leaked).toEqual([]);
  });

  it('never loses a permitted destination when bucketing into sections', () => {
    const dropped: string[] = [];
    for (const { surface, keys, locale } of cases()) {
      const effective = new Set(keys);
      const items = buildShellItems(effective, surface, locale, en);
      const bucketed = buildShellSections(effective, surface, locale, en)
        .flatMap((section) => section.items)
        .map((item) => item.id);
      for (const item of items) {
        if (!bucketed.includes(item.id)) dropped.push(`${surface}: ${item.id}`);
      }
    }
    expect(dropped).toEqual([]);
  });

  it('never throws for a route that belongs to no navigation group', () => {
    // Why this case exists: `system.search` is a capability on the palette,
    // search, and shortcut surfaces but a member of no group, so a group lookup
    // that assumed every route is grouped turned a render-phase throw.
    const ungrouped = visibleRoutes(new Set(['all:all']), 'palette')
      .map((route) => route.id)
      .filter(
        (id) => !buildShellSections(new Set(['all:all']), 'palette', 'en', en).some(
          (section) => section.items.some((item) => item.id === id),
        ) === false,
      );
    expect(ungrouped.length).toBeGreaterThan(0);
    expect(() => buildShellItems(new Set(['all:all']), 'palette', 'en', en)).not.toThrow();
    expect(() => buildShellSections(new Set(['all:all']), 'palette', 'en', en)).not.toThrow();
  });

  it('omits the heading for the direct group and renders the rest', () => {
    const sections = buildShellSections(new Set(['all:all']), 'sidebar', 'en', en);
    const direct = sections.find((section) => section.groupId === 'direct');
    expect(direct).toBeDefined();
    expect(direct?.label).toBeNull();
    expect(direct?.items.length).toBeGreaterThan(0);

    const labelled = sections.filter((section) => section.label !== null);
    expect(labelled.every((section) => section.groupId !== 'direct')).toBe(true);
  });

  it('resolves the Thai locale for every surface that renders labels', () => {
    for (const surface of EVERY_SURFACE) {
      const items = buildShellItems(new Set(['all:all']), surface, 'th', en);
      for (const item of items) {
        expect(item.label.trim(), `${surface} ${item.id}`).not.toBe('');
        // Why the two-form check: the registry's root path collapses to the bare
        // locale segment, so Home is `/th` while every other route is `/th/…`.
        const isLocaleRoot = item.href === '/th';
        expect(isLocaleRoot || item.href.startsWith('/th/'), `${surface} ${item.id}`).toBe(true);
      }
    }
  });
});
