import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import en from '@/dictionaries/en.json';
import th from '@/dictionaries/th.json';
import { NAVIGATION_GROUPS, ROUTE_REGISTRY } from '@/lib/navigation/registry';

type DictionaryShape = typeof en;

const DICTIONARIES: readonly (readonly [string, DictionaryShape])[] = [
  ['en', en],
  ['th', th],
];

const PARITY_CONSUMERS: readonly string[] = [
  'src/components/layout/Sidebar.tsx',
  'src/components/layout/SidebarNavItem.tsx',
  'src/components/layout/MobileBottomBar.tsx',
  'src/components/layout/FullScreenNavOverlay.tsx',
  'src/components/palette/CommandPaletteItems.tsx',
];

const REQUIRED_LABEL_KEYS: readonly string[] = [
  ...ROUTE_REGISTRY.filter((route) => route.enabled).map((route) => route.labelKey),
  ...NAVIGATION_GROUPS.map((group) => group.labelKey),
];

function readDictionaryLabel(dictionary: DictionaryShape, labelKey: string): string {
  let current: unknown = dictionary;
  for (const segment of labelKey.split('.')) {
    if (typeof current !== 'object' || current === null) {
      throw new Error(`Missing dictionary key: ${labelKey}`);
    }
    current = Reflect.get(current, segment);
  }
  if (typeof current !== 'string') {
    throw new Error(`Dictionary key is not a label: ${labelKey}`);
  }
  return current;
}

describe('navigation dictionary parity', () => {
  it('has a non-empty English and Thai label for every enabled route and group', () => {
    for (const labelKey of REQUIRED_LABEL_KEYS) {
      expect(labelKey.trim(), labelKey).not.toBe('');
      for (const [locale, dictionary] of DICTIONARIES) {
        expect(readDictionaryLabel(dictionary, labelKey).trim(), `${locale} ${labelKey}`).not.toBe('');
      }
    }
  });

  it('keeps the two dictionaries structurally identical', () => {
    // Why a shape walk and not a label check: a key that exists in one locale and
    // not the other renders an empty string in the missing locale, which the
    // per-label assertion above would never see because it only walks keys the
    // registry already declares.
    function keyPaths(value: unknown, prefix: string): string[] {
      if (typeof value !== 'object' || value === null) return [prefix];
      return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) =>
        keyPaths(child, `${prefix}.${key}`),
      );
    }

    const enPaths = new Set(keyPaths(en, ''));
    const thPaths = new Set(keyPaths(th, ''));
    expect([...enPaths].filter((path) => !thPaths.has(path)).sort()).toEqual([]);
    expect([...thPaths].filter((path) => !enPaths.has(path)).sort()).toEqual([]);
  });

  it('carries no hard-coded replacement label in a shell consumer', () => {
    const offenders: string[] = [];
    for (const file of PARITY_CONSUMERS) {
      const source = readFileSync(file, 'utf8');
      if (/\blabel\s*=\s*["'`](Dashboard|Contests|Tasks|Users|Teams|Submissions|Documentation|Search|Audit|Ranking|Settings|Maintenance|Appearance)["'`]/.test(source)) {
        offenders.push(file);
      }
    }
    expect(offenders).toEqual([]);
  });
});
